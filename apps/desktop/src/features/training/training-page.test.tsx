import { TrainingPage } from "@/features/training/training-page";
import { backend } from "@/lib/backend";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  OllamaModel,
  ServerRecord,
  TrainingDatasetRecord,
  TrainingDatasetGroupRecord,
  TrainingJobRecord,
  TrainingServerRecord,
} from "@tome/types";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const server: TrainingServerRecord = {
  adapter: "tome-training-v1",
  capabilitiesJson: "{}",
  createdAt: "2026-07-28T00:00:00Z",
  id: "training-server",
  isActive: true,
  lastCheckedAt: null,
  lastError: null,
  name: "Windows",
  status: "unknown",
  updatedAt: "2026-07-28T00:00:00Z",
  url: "http://192.168.1.6:11435",
  version: null,
};

const ollamaServer: ServerRecord = {
  createdAt: "2026-07-28T00:00:00Z",
  id: "ollama-server",
  isActive: true,
  lastError: null,
  lastPingMs: 5,
  lastStatus: "connected",
  lastTestedAt: "2026-07-28T00:00:00Z",
  lastVersion: "0.12.0",
  name: "Windows Ollama",
  updatedAt: "2026-07-28T00:00:00Z",
  url: "http://192.168.1.6:11434",
};

const openOllamaModel: OllamaModel = {
  details: {
    families: ["llama"],
    family: "llama",
    parameter_size: "1.1B",
    quantization_level: "Q4_K_M",
  },
  name: "tinyllama:latest",
  size: 638_000_000,
};

const dataset: TrainingDatasetRecord = {
  artifactPath: "/tmp/planning.jsonl",
  checksum: "checksum",
  compressed: false,
  createdAt: "2026-07-28T00:00:00Z",
  fileCount: 1,
  format: "jsonl",
  groupId: "planning-group",
  id: "planning-dataset",
  name: "Planning agent",
  preview: null,
  remoteDatasetId: null,
  size: 1024,
  sourcePath: "/tmp/planning.jsonl",
  trainingServerId: null,
  updatedAt: "2026-07-28T00:00:00Z",
  validationErrorsJson: "[]",
  exclusionsJson: "[]",
  validationStatus: "valid",
};

const datasetGroup: TrainingDatasetGroupRecord = {
  createdAt: "2026-07-28T00:00:00Z",
  id: "planning-group",
  name: "Planning Corpus",
  updatedAt: "2026-07-28T00:00:00Z",
};

const secondDataset: TrainingDatasetRecord = {
  ...dataset,
  id: "planning-dataset-two",
  name: "Planning examples two",
  sourcePath: "/tmp/planning-two.jsonl",
};

const job: TrainingJobRecord = {
  backend: "lora",
  baseModel: "llama3.2:3b",
  cpuUsage: null,
  createdAt: "2026-07-28T00:00:00Z",
  currentEpoch: 0,
  datasetId: dataset.id,
  datasetIds: [dataset.id],
  diskUsage: null,
  error: null,
  etaSeconds: null,
  finishedAt: null,
  gpuUsage: null,
  heartbeatAt: null,
  id: "planning-job",
  learningRate: null,
  loss: null,
  model: "tome-planning-3b:v1",
  parametersJson: "{}",
  progress: 0,
  ramUsage: null,
  remoteJobId: null,
  retryOf: null,
  stage: "Draft",
  startedAt: null,
  status: "draft",
  totalEpochs: 1,
  trainingServerId: null,
  trainingSpeed: null,
  updatedAt: "2026-07-28T00:00:00Z",
  warning: null,
};

function renderTrainingPage(
  trainingDatasets: readonly TrainingDatasetRecord[] = [dataset],
): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["training-servers"], [server]);
  queryClient.setQueryData(["active-server"], ollamaServer);
  queryClient.setQueryData(["models", ollamaServer.url], [openOllamaModel]);
  queryClient.setQueryData(["training-datasets"], trainingDatasets);
  queryClient.setQueryData(["training-dataset-groups"], [datasetGroup]);
  queryClient.setQueryData(["dataset-uploads"], []);
  queryClient.setQueryData(["tasks"], []);
  queryClient.setQueryData(["training-jobs"], [job]);
  queryClient.setQueryData(["training-logs"], []);

  render(
    <QueryClientProvider client={queryClient}>
      <TrainingPage />
    </QueryClientProvider>,
  );
}

describe("Training deletion confirmations", () => {
  it("deletes Training Manager connections and job drafts through Tome dialogs", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const deleteServer = vi
      .spyOn(backend, "deleteTrainingServer")
      .mockResolvedValue(undefined);
    const deleteJob = vi.spyOn(backend, "deleteTrainingJob").mockResolvedValue(undefined);
    renderTrainingPage();

    fireEvent.click(screen.getByLabelText("Delete Windows"));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Remove Windows?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove server" }));
    await waitFor(() => expect(deleteServer).toHaveBeenCalledWith(server.id));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Training Jobs" }));
    fireEvent.click(screen.getByLabelText(`Delete ${job.model} job`));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(`Delete ${job.model}?`)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete job" }));
    await waitFor(() => expect(deleteJob).toHaveBeenCalledWith(job.id));

    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("Training readiness", () => {
  it("checks the worker and source model before training is dispatched", async () => {
    const preflight = vi.spyOn(backend, "preflightTrainingJob").mockResolvedValue({
      checks: [
        {
          id: "source-model",
          message: "Trainable source is accessible",
          resolution: null,
          status: "passed",
        },
      ],
      credentialAccepted: false,
      credentialRequired: false,
      ready: true,
      sourceModel: "meta-llama/Llama-3.2-3B-Instruct",
      sourceStatus: "ready",
    });
    renderTrainingPage();

    fireEvent.click(screen.getByRole("button", { name: "Training Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Check readiness" }));

    await waitFor(() => expect(preflight).toHaveBeenCalledWith(job.id, undefined));
    expect(await screen.findByText("Trainable source is accessible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Train now" })).toBeInTheDocument();
  });

  it("creates token-free jobs from the matching open Ollama base", () => {
    renderTrainingPage();

    fireEvent.click(screen.getByRole("button", { name: "Training Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "New job" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Installed Ollama base model")).toHaveValue(
      "tinyllama:latest",
    );
    expect(
      within(dialog).getByDisplayValue("TinyLlama/TinyLlama-1.1B-Chat-v0.6"),
    ).toHaveAttribute("readonly");
    expect(within(dialog).getByText("Automatic open-base training")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("1")).toBeInTheDocument();
  });
});

describe("Training dataset groups", () => {
  it("keeps an empty group visible so data can be added to it", () => {
    renderTrainingPage([]);

    fireEvent.click(screen.getByRole("button", { name: "Datasets" }));

    expect(
      screen.getByRole("button", { name: `Collapse ${datasetGroup.name}` }),
    ).toBeInTheDocument();
    expect(screen.getByText("0 datasets")).toBeInTheDocument();
    expect(screen.getByText("0 valid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("shows structured row and file recovery actions for validation issues", () => {
    const invalidDataset: TrainingDatasetRecord = {
      ...dataset,
      validationErrorsJson: JSON.stringify([
        {
          canExcludeFile: true,
          canExcludeRow: true,
          code: "invalid_json",
          file: "records.jsonl",
          id: "error:invalid_json:records.jsonl:2",
          message: "records.jsonl line 2: invalid JSON record",
          row: 2,
          severity: "error",
        },
        {
          canExcludeFile: true,
          canExcludeRow: true,
          code: "unrecognized_training_fields",
          file: "metadata.json",
          id: "warning:unrecognized_training_fields:metadata.json:1",
          message: "metadata.json row 1 has no recognized training fields",
          row: 1,
          severity: "warning",
        },
      ]),
      validationStatus: "invalid",
    };
    renderTrainingPage([invalidDataset]);

    fireEvent.click(screen.getByRole("button", { name: "Datasets" }));

    expect(screen.getByText("1 error")).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Exclude row" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Exclude file" })).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Exclude all error rows" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Exclude all warning rows" }),
    ).toBeInTheDocument();
    expect(screen.getByText("records.jsonl · row 2")).toBeInTheDocument();
  });

  it("provides a labeled group deletion action and deletes an empty group", async () => {
    const deleteGroup = vi
      .spyOn(backend, "deleteTrainingDatasetGroup")
      .mockResolvedValue(undefined);
    renderTrainingPage([]);

    fireEvent.click(screen.getByRole("button", { name: "Datasets" }));
    fireEvent.click(
      screen.getByRole("button", { name: `Delete group ${datasetGroup.name}` }),
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(`Delete ${datasetGroup.name}?`)).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete group and datasets" }),
    );

    await waitFor(() => expect(deleteGroup).toHaveBeenCalledWith(datasetGroup.id));
  });

  it("moves existing catalog datasets into a group without revalidation", async () => {
    const assign = vi
      .spyOn(backend, "assignTrainingDatasetsToGroup")
      .mockResolvedValue(undefined);
    renderTrainingPage([{ ...dataset, groupId: null }]);

    fireEvent.click(screen.getByRole("button", { name: "Datasets" }));
    fireEvent.click(screen.getByRole("button", { name: "Existing" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Select all (1)").closest("label")!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 dataset" }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(datasetGroup.id, [dataset.id]),
    );
  });

  it("selects every valid dataset in a group for one training job", () => {
    renderTrainingPage([dataset, secondDataset]);

    fireEvent.click(screen.getByRole("button", { name: "Training Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "New job" }));

    const dialog = screen.getByRole("dialog");
    const groupLabel = within(dialog).getByText(datasetGroup.name).closest("label");
    expect(groupLabel).not.toBeNull();
    const groupCheckbox = within(groupLabel as HTMLLabelElement).getByRole("checkbox");
    expect(groupCheckbox).not.toBeChecked();

    fireEvent.click(groupCheckbox);

    for (const trainingDataset of [dataset, secondDataset]) {
      const datasetLabel = within(dialog)
        .getByText(trainingDataset.name)
        .closest("label");
      expect(datasetLabel).not.toBeNull();
      expect(
        within(datasetLabel as HTMLLabelElement).getByRole("checkbox"),
      ).toBeChecked();
    }
  });

  it("visually nests expanded datasets under their parent group", () => {
    renderTrainingPage([dataset, secondDataset]);

    fireEvent.click(screen.getByRole("button", { name: "Datasets" }));

    for (const trainingDataset of [dataset, secondDataset]) {
      expect(
        screen
          .getByText(trainingDataset.name)
          .closest(`[data-parent-group="${datasetGroup.id}"]`),
      ).not.toBeNull();
    }

    fireEvent.click(
      screen.getByRole("button", { name: `Collapse ${datasetGroup.name}` }),
    );
    expect(screen.queryByText(dataset.name)).not.toBeInTheDocument();
    expect(screen.queryByText(secondDataset.name)).not.toBeInTheDocument();
  });
});
