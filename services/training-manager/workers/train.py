"""Tome server-side Hugging Face Transformers + PEFT training worker.

This process is launched only by the Windows Training Manager. It emits newline-delimited
JSON events on stdout and writes all artifacts beneath the assigned job directory.
"""

from __future__ import annotations

import argparse
import csv
import inspect
import json
import math
import sys
import time
from pathlib import Path
from typing import Any


def emit(kind: str, **values: Any) -> None:
    print(json.dumps({"type": kind, **values}, ensure_ascii=False), flush=True)


def create_training_arguments(
    training_arguments_type: Any, values: dict[str, Any]
) -> Any:
    """Build TrainingArguments across supported Transformers versions.

    Transformers occasionally removes or renames constructor options. The worker
    only passes options supported by the installed server version and reports
    ignored compatibility options instead of aborting an otherwise valid job.
    """

    signature = inspect.signature(training_arguments_type)
    accepts_arbitrary_keywords = any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    )
    supported = (
        values
        if accepts_arbitrary_keywords
        else {
            name: value
            for name, value in values.items()
            if name in signature.parameters
        }
    )
    ignored = sorted(set(values) - set(supported))
    if ignored:
        emit(
            "warning",
            message=(
                "The installed Transformers version does not support these "
                f"TrainingArguments options; continuing without them: {', '.join(ignored)}"
            ),
        )
    return training_arguments_type(**supported)


def probe() -> int:
    try:
        import accelerate  # noqa: F401
        import datasets  # noqa: F401
        import peft  # noqa: F401
        import safetensors  # noqa: F401
        import torch
        import transformers  # noqa: F401

        print(
            json.dumps(
                {
                    "ready": True,
                    "cuda": torch.cuda.is_available(),
                    "cudaDevices": torch.cuda.device_count(),
                    "torch": torch.__version__,
                }
            )
        )
        return 0
    except Exception as error:  # pragma: no cover - depends on server environment
        print(f"Training dependency probe failed: {error}", file=sys.stderr)
        return 1


def read_json_records(path: Path) -> list[Any]:
    with path.open("r", encoding="utf-8") as handle:
        try:
            value = json.load(handle)
            return value if isinstance(value, list) else [value]
        except json.JSONDecodeError as document_error:
            handle.seek(0)
            records: list[Any] = []
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError as line_error:
                    raise ValueError(
                        f"{path} line {line_number} is neither valid JSON nor NDJSON: "
                        f"{line_error}"
                    ) from document_error
            if records:
                return records
            raise ValueError(f"{path} contains no JSON records") from document_error


def normalize_record(
    record: Any,
    parameters: dict[str, Any],
    dataset_name: str,
    relative_path: str,
    record_number: int,
    global_record_number: int,
) -> dict[str, str]:
    text_field = str(parameters.get("textField", "text"))
    prompt_field = str(parameters.get("promptField", "prompt"))
    response_field = str(parameters.get("responseField", "response"))
    input_field = str(parameters.get("inputField", "input"))
    separator = str(parameters.get("separator", "\n\n"))
    location = (
        f"Dataset '{dataset_name}', file '{relative_path}', record {record_number} "
        f"(combined record {global_record_number})"
    )
    if not isinstance(record, dict):
        raise ValueError(f"{location} is not an object")
    direct = record.get(text_field)
    if isinstance(direct, str) and direct.strip():
        return {"text": direct.strip()}
    candidate_pairs = [
        (prompt_field, response_field),
        ("prompt", "response"),
        ("instruction", "output"),
    ]
    seen_pairs: set[tuple[str, str]] = set()
    for candidate_prompt, candidate_response in candidate_pairs:
        pair = (candidate_prompt, candidate_response)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        prompt = record.get(candidate_prompt)
        response = record.get(candidate_response)
        if (
            isinstance(prompt, str)
            and prompt.strip()
            and isinstance(response, str)
            and response.strip()
        ):
            input_value = record.get(input_field)
            prompt_parts = [prompt.strip()]
            if isinstance(input_value, str) and input_value.strip():
                prompt_parts.append(input_value.strip())
            return {
                "text": f"{separator.join(prompt_parts)}{separator}{response.strip()}"
            }
    messages = record.get("messages")
    if isinstance(messages, list) and messages:
        parts: list[str] = []
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                prefix = role.strip() if isinstance(role, str) and role.strip() else "message"
                parts.append(f"{prefix}: {content.strip()}")
        if parts:
            return {"text": separator.join(parts)}
    available = ", ".join(sorted(str(key) for key in record.keys())[:12]) or "none"
    raise ValueError(
        f"{location} needs non-empty '{text_field}', "
        f"'{prompt_field}' + '{response_field}', instruction + output, "
        "or messages fields. "
        f"Available fields: {available}"
    )


def read_records(
    dataset_sources: list[tuple[Path, str]], parameters: dict[str, Any]
) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    file_sources: dict[Path, tuple[str, Path]] = {}
    for dataset_path, dataset_name in dataset_sources:
        candidates = (
            [dataset_path] if dataset_path.is_file() else dataset_path.rglob("*")
        )
        for candidate in candidates:
            if candidate.is_file():
                file_sources.setdefault(
                    candidate.resolve(), (dataset_name, dataset_path.resolve())
                )
    files = sorted(file_sources)
    if not files:
        raise ValueError("No dataset files found under the selected datasets")
    max_records = int(parameters.get("maxRecords", 0))
    if max_records < 0:
        raise ValueError("maxRecords must be zero or greater")
    emit(
        "progress",
        stage="Scanning datasets",
        progress=1.0,
        epoch=0,
        message=f"Found {len(files)} supported and auxiliary files to inspect",
    )
    for file_index, dataset_file in enumerate(files, start=1):
        dataset_name, dataset_root = file_sources[dataset_file]
        try:
            relative_path = str(dataset_file.relative_to(dataset_root))
        except ValueError:
            relative_path = dataset_file.name
        suffix = dataset_file.suffix.lower()
        file_records: list[Any] = []
        if suffix == ".jsonl":
            with dataset_file.open("r", encoding="utf-8") as handle:
                for line_number, line in enumerate(handle, start=1):
                    if not line.strip():
                        continue
                    try:
                        file_records.append(json.loads(line))
                    except json.JSONDecodeError as error:
                        raise ValueError(
                            f"Dataset '{dataset_name}', file '{relative_path}', "
                            f"line {line_number} is invalid JSON: {error}"
                        ) from error
        elif suffix == ".json":
            file_records = read_json_records(dataset_file)
        elif suffix == ".csv":
            with dataset_file.open("r", encoding="utf-8", newline="") as handle:
                file_records = [dict(row) for row in csv.DictReader(handle)]
        elif suffix in {".txt", ".md"}:
            text = dataset_file.read_text(encoding="utf-8").strip()
            if text:
                file_records = [{"text": text}]
        elif suffix == ".parquet":
            try:
                import pyarrow.parquet as parquet
            except ImportError as error:
                raise RuntimeError("pyarrow is required for Parquet datasets") from error
            file_records = parquet.read_table(dataset_file).to_pylist()
        for record_number, record in enumerate(file_records, start=1):
            normalized.append(
                normalize_record(
                    record,
                    parameters,
                    dataset_name,
                    relative_path,
                    record_number,
                    len(normalized) + 1,
                )
            )
            if max_records > 0 and len(normalized) >= max_records:
                break
        progress = 1.0 + (file_index / len(files)) * 5.0
        emit(
            "progress",
            stage="Validating records",
            progress=progress,
            epoch=0,
            message=(
                f"Validated {len(normalized)} records through "
                f"{dataset_name}/{relative_path}"
            ),
        )
        if max_records > 0 and len(normalized) >= max_records:
            emit(
                "log",
                level="info",
                message=f"Limited this run to {max_records} records",
            )
            break
    if not normalized:
        raise ValueError("Dataset contains no supported training records")
    return normalized


def run(spec_path: Path) -> int:
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        DataCollatorForLanguageModeling,
        Trainer,
        TrainerCallback,
        TrainingArguments,
    )

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    parameters = dict(spec.get("parameters") or {})
    source_model = str(parameters.get("sourceModel") or spec["baseModel"])
    output_path = Path(spec["outputPath"]).resolve()
    checkpoints = output_path.parent / "checkpoints"
    raw_datasets = spec.get("datasets")
    if isinstance(raw_datasets, list) and raw_datasets:
        dataset_sources = [
            (
                Path(value["path"]).resolve(),
                str(value.get("name") or Path(value["path"]).name),
            )
            for value in raw_datasets
        ]
    else:
        raw_dataset_paths = spec.get("datasetPaths") or [spec["datasetPath"]]
        dataset_sources = [
            (Path(value).resolve(), Path(value).name) for value in raw_dataset_paths
        ]
    epochs = int(spec["epochs"])
    backend = str(spec.get("backend", "lora")).lower()
    if epochs < 1:
        raise ValueError("epochs must be at least 1")
    if backend not in {"transformers", "peft", "lora", "qlora"}:
        raise ValueError(f"Unsupported worker backend: {backend}")

    emit(
        "log",
        level="info",
        message=f"Loading {len(dataset_sources)} selected dataset(s)",
    )
    records = read_records(dataset_sources, parameters)
    emit("log", level="info", message=f"Validated {len(records)} training records")
    dataset = Dataset.from_list(records)

    max_length = int(parameters.get("maxLength", 2048))
    emit("progress", stage="Loading tokenizer", progress=7.0, epoch=0)
    tokenizer = AutoTokenizer.from_pretrained(
        source_model,
        trust_remote_code=bool(parameters.get("trustRemoteCode", False)),
        token=str(parameters["huggingFaceToken"])
        if parameters.get("huggingFaceToken")
        else None,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    def tokenize(batch: dict[str, list[str]]) -> dict[str, Any]:
        return tokenizer(
            batch["text"],
            truncation=True,
            max_length=max_length,
            padding=False,
        )

    emit("progress", stage="Tokenizing", progress=9.0, epoch=0)
    tokenized = dataset.map(
        tokenize,
        batched=True,
        remove_columns=dataset.column_names,
        desc="Tokenizing",
    )
    emit("progress", stage="Tokenization complete", progress=12.0, epoch=0)
    model_kwargs: dict[str, Any] = {
        "trust_remote_code": bool(parameters.get("trustRemoteCode", False)),
        "token": str(parameters["huggingFaceToken"])
        if parameters.get("huggingFaceToken")
        else None,
    }
    if backend == "qlora":
        if not torch.cuda.is_available():
            raise RuntimeError("QLoRA requires a CUDA GPU")
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type=str(parameters.get("quantizationType", "nf4")),
            bnb_4bit_compute_dtype=torch.bfloat16
            if torch.cuda.is_bf16_supported()
            else torch.float16,
            bnb_4bit_use_double_quant=bool(parameters.get("doubleQuantization", True)),
        )
        model_kwargs["device_map"] = "auto"
    elif torch.cuda.is_available():
        model_kwargs["torch_dtype"] = (
            torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        )
        model_kwargs["device_map"] = "auto"

    emit("progress", stage="Loading base model", progress=15.0, epoch=0)
    model = AutoModelForCausalLM.from_pretrained(source_model, **model_kwargs)
    if backend == "qlora":
        model = prepare_model_for_kbit_training(model)
    target_modules = parameters.get("targetModules")
    lora = LoraConfig(
        r=int(parameters.get("loraRank", parameters.get("rank", 16))),
        lora_alpha=int(parameters.get("loraAlpha", 32)),
        lora_dropout=float(parameters.get("loraDropout", 0.05)),
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=list(target_modules) if isinstance(target_modules, list) else None,
    )
    model = get_peft_model(model, lora)
    model.config.use_cache = False

    class ProgressCallback(TrainerCallback):
        started = time.monotonic()

        def on_log(
            self,
            args: TrainingArguments,
            state: Any,
            control: Any,
            logs: dict[str, float] | None = None,
            **_: Any,
        ) -> None:
            logs = logs or {}
            max_steps = max(1, int(state.max_steps))
            progress = min(95.0, 20.0 + (state.global_step / max_steps) * 75.0)
            elapsed = max(0.001, time.monotonic() - self.started)
            emit(
                "progress",
                stage="Fine-tuning",
                progress=progress,
                epoch=int(math.floor(float(state.epoch or 0))),
                totalEpochs=epochs,
                loss=logs.get("loss"),
                learningRate=logs.get("learning_rate"),
                samplesPerSecond=(state.global_step * int(args.per_device_train_batch_size))
                / elapsed,
            )

    use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    arguments = create_training_arguments(
        TrainingArguments,
        {
            "output_dir": str(checkpoints),
            "overwrite_output_dir": False,
            "per_device_train_batch_size": int(parameters.get("batchSize", 1)),
            "gradient_accumulation_steps": int(
                parameters.get("gradientAccumulationSteps", 4)
            ),
            "num_train_epochs": epochs,
            "max_steps": int(parameters.get("maxSteps", -1)),
            "learning_rate": float(parameters.get("learningRate", 2e-4)),
            "warmup_ratio": float(parameters.get("warmupRatio", 0.03)),
            "weight_decay": float(parameters.get("weightDecay", 0.0)),
            "logging_steps": max(1, int(parameters.get("loggingSteps", 1))),
            "save_strategy": "epoch",
            "save_total_limit": max(1, int(parameters.get("saveTotalLimit", 2))),
            "report_to": [],
            "fp16": torch.cuda.is_available() and not use_bf16,
            "bf16": use_bf16,
            "gradient_checkpointing": bool(
                parameters.get("gradientCheckpointing", True)
            ),
            "dataloader_num_workers": int(parameters.get("dataloaderWorkers", 0)),
            "seed": int(parameters.get("seed", 42)),
        },
    )
    trainer = Trainer(
        model=model,
        args=arguments,
        train_dataset=tokenized,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
        callbacks=[ProgressCallback()],
    )
    emit("progress", stage="Fine-tuning", progress=20.0, epoch=0, totalEpochs=epochs)
    trainer.train(resume_from_checkpoint=parameters.get("resumeFromCheckpoint"))
    output_path.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(output_path, safe_serialization=True)
    tokenizer.save_pretrained(output_path)
    emit(
        "complete",
        stage="Adapter exported",
        progress=97.0,
        epoch=epochs,
        totalEpochs=epochs,
        adapterPath=str(output_path),
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--spec", type=Path)
    arguments = parser.parse_args()
    if arguments.probe:
        return probe()
    if arguments.spec is None:
        parser.error("--spec is required unless --probe is used")
    try:
        return run(arguments.spec)
    except Exception as error:
        emit("log", level="error", message=str(error))
        print(f"Training worker failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
