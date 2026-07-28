"""Tome server-side Hugging Face Transformers + PEFT training worker.

This process is launched only by the Windows Training Manager. It emits newline-delimited
JSON events on stdout and writes all artifacts beneath the assigned job directory.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path
from typing import Any


def emit(kind: str, **values: Any) -> None:
    print(json.dumps({"type": kind, **values}, ensure_ascii=False), flush=True)


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


def read_records(
    dataset_paths: list[Path], parameters: dict[str, Any]
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    files = sorted(
        {
            path.resolve()
            for dataset_path in dataset_paths
            for path in dataset_path.rglob("*")
            if path.is_file()
        }
    )
    if not files:
        raise ValueError("No dataset files found under the selected datasets")
    for path in files:
        suffix = path.suffix.lower()
        if suffix == ".jsonl":
            with path.open("r", encoding="utf-8") as handle:
                records.extend(json.loads(line) for line in handle if line.strip())
        elif suffix == ".json":
            records.extend(read_json_records(path))
        elif suffix == ".csv":
            with path.open("r", encoding="utf-8", newline="") as handle:
                records.extend(dict(row) for row in csv.DictReader(handle))
        elif suffix in {".txt", ".md"}:
            text = path.read_text(encoding="utf-8").strip()
            if text:
                records.append({"text": text})
        elif suffix == ".parquet":
            try:
                import pyarrow.parquet as parquet
            except ImportError as error:
                raise RuntimeError("pyarrow is required for Parquet datasets") from error
            records.extend(parquet.read_table(path).to_pylist())
    if not records:
        raise ValueError("Dataset contains no training records")

    text_field = str(parameters.get("textField", "text"))
    prompt_field = str(parameters.get("promptField", "prompt"))
    response_field = str(parameters.get("responseField", "response"))
    separator = str(parameters.get("separator", "\n\n"))
    normalized: list[dict[str, str]] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f"Dataset record {index + 1} is not an object")
        direct = record.get(text_field)
        if isinstance(direct, str) and direct.strip():
            normalized.append({"text": direct.strip()})
            continue
        prompt = record.get(prompt_field)
        response = record.get(response_field)
        if isinstance(prompt, str) and isinstance(response, str):
            normalized.append({"text": f"{prompt.strip()}{separator}{response.strip()}"})
            continue
        raise ValueError(
            f"Dataset record {index + 1} needs '{text_field}' or "
            f"'{prompt_field}' + '{response_field}' string fields"
        )
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
    raw_dataset_paths = spec.get("datasetPaths") or [spec["datasetPath"]]
    dataset_paths = [Path(value).resolve() for value in raw_dataset_paths]
    epochs = int(spec["epochs"])
    backend = str(spec.get("backend", "lora")).lower()
    if epochs < 1:
        raise ValueError("epochs must be at least 1")
    if backend not in {"transformers", "peft", "lora", "qlora"}:
        raise ValueError(f"Unsupported worker backend: {backend}")

    emit(
        "log",
        level="info",
        message=f"Loading {len(dataset_paths)} selected dataset(s)",
    )
    records = read_records(dataset_paths, parameters)
    emit("log", level="info", message=f"Validated {len(records)} training records")
    dataset = Dataset.from_list(records)

    max_length = int(parameters.get("maxLength", 2048))
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

    tokenized = dataset.map(
        tokenize,
        batched=True,
        remove_columns=dataset.column_names,
        desc="Tokenizing",
    )
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

    emit("progress", stage="Loading base model", progress=2.0, epoch=0)
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
            progress = min(97.0, 3.0 + (state.global_step / max_steps) * 94.0)
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
    arguments = TrainingArguments(
        output_dir=str(checkpoints),
        overwrite_output_dir=False,
        per_device_train_batch_size=int(parameters.get("batchSize", 1)),
        gradient_accumulation_steps=int(parameters.get("gradientAccumulationSteps", 4)),
        num_train_epochs=epochs,
        learning_rate=float(parameters.get("learningRate", 2e-4)),
        warmup_ratio=float(parameters.get("warmupRatio", 0.03)),
        weight_decay=float(parameters.get("weightDecay", 0.0)),
        logging_steps=max(1, int(parameters.get("loggingSteps", 1))),
        save_strategy="epoch",
        save_total_limit=max(1, int(parameters.get("saveTotalLimit", 2))),
        report_to=[],
        fp16=torch.cuda.is_available() and not use_bf16,
        bf16=use_bf16,
        gradient_checkpointing=bool(parameters.get("gradientCheckpointing", True)),
        dataloader_num_workers=int(parameters.get("dataloaderWorkers", 0)),
        seed=int(parameters.get("seed", 42)),
    )
    trainer = Trainer(
        model=model,
        args=arguments,
        train_dataset=tokenized,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
        callbacks=[ProgressCallback()],
    )
    emit("progress", stage="Fine-tuning", progress=3.0, epoch=0, totalEpochs=epochs)
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
