from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from train import create_training_arguments, normalize_record, read_records


class TrainingDatasetNormalizationTests(unittest.TestCase):
    def test_ignores_unsupported_training_argument_options(self) -> None:
        class InstalledTrainingArguments:
            def __init__(self, output_dir: str, max_steps: int) -> None:
                self.output_dir = output_dir
                self.max_steps = max_steps

        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            arguments = create_training_arguments(
                InstalledTrainingArguments,
                {
                    "output_dir": "checkpoints",
                    "max_steps": 3,
                    "overwrite_output_dir": False,
                },
            )

        self.assertEqual(arguments.output_dir, "checkpoints")
        self.assertEqual(arguments.max_steps, 3)
        event = json.loads(stdout.getvalue())
        self.assertEqual(event["type"], "warning")
        self.assertIn("overwrite_output_dir", event["message"])

    def test_normalizes_instruction_input_and_output(self) -> None:
        record = normalize_record(
            {
                "instruction": "Plan the implementation",
                "input": "A desktop application",
                "output": "1. Inspect requirements\n2. Define milestones",
            },
            {
                "promptField": "instruction",
                "responseField": "output",
                "inputField": "input",
                "separator": "\n\n",
            },
            "Planning",
            "records.json",
            1,
            1,
        )

        self.assertEqual(
            record["text"],
            "Plan the implementation\n\nA desktop application\n\n"
            "1. Inspect requirements\n2. Define milestones",
        )

    def test_reports_dataset_file_and_record_for_an_incompatible_record(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            r"Dataset 'Planning'.*file 'records\.json'.*record 4.*Available fields: id",
        ):
            normalize_record(
                {"id": "missing-training-fields"},
                {"promptField": "instruction", "responseField": "output"},
                "Planning",
                "records.json",
                4,
                12,
            )

    def test_accepts_common_instruction_and_chat_schemas_without_custom_mapping(
        self,
    ) -> None:
        instruction = normalize_record(
            {"instruction": "Plan a release", "output": "Create milestones"},
            {},
            "Planning",
            "instructions.jsonl",
            1,
            1,
        )
        chat = normalize_record(
            {
                "messages": [
                    {"role": "user", "content": "Plan a release"},
                    {"role": "assistant", "content": "Create milestones"},
                ]
            },
            {},
            "Planning",
            "messages.jsonl",
            1,
            2,
        )

        self.assertEqual(instruction["text"], "Plan a release\n\nCreate milestones")
        self.assertEqual(
            chat["text"], "user: Plan a release\n\nassistant: Create milestones"
        )

    def test_max_records_creates_a_bounded_smoke_training_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "records.json").write_text(
                json.dumps(
                    [
                        {"instruction": "Plan A", "output": "Steps A"},
                        {"instruction": "Plan B", "output": "Steps B"},
                        {"id": "would-fail-without-the-limit"},
                    ]
                ),
                encoding="utf-8",
            )
            with contextlib.redirect_stdout(io.StringIO()):
                records = read_records(
                    [(root, "Planning")],
                    {
                        "maxRecords": 2,
                        "promptField": "instruction",
                        "responseField": "output",
                    },
                )

        self.assertEqual(
            [record["text"] for record in records],
            ["Plan A\n\nSteps A", "Plan B\n\nSteps B"],
        )


if __name__ == "__main__":
    unittest.main()
