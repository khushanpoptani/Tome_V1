import { TrainingPage } from "@/features/training/training-page";
import { backend } from "@/lib/backend";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  TrainingDatasetRecord,
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

const dataset: TrainingDatasetRecord = {
  artifactPath: "/tmp/planning.jsonl",
  checksum: "checksum",
  compressed: false,
  createdAt: "2026-07-28T00:00:00Z",
  fileCount: 1,
  format: "jsonl",
  id: "planning-dataset",
  name: "Planning agent",
  preview: null,
  remoteDatasetId: null,
  size: 1024,
  sourcePath: "/tmp/planning.jsonl",
  trainingServerId: null,
  updatedAt: "2026-07-28T00:00:00Z",
  validationErrorsJson: "[]",
  validationStatus: "valid",
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

function renderTrainingPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["training-servers"], [server]);
  queryClient.setQueryData(["training-datasets"], [dataset]);
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
