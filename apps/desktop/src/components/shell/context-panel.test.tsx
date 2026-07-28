import { ContextPanel } from "@/components/shell/context-panel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LogRecord, TaskRecord } from "@tome/types";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

const uploadLog: LogRecord = {
  category: "training-upload",
  createdAt: "2026-07-28T12:10:13Z",
  details: "Windows validation exceeded the request timeout",
  id: 1,
  level: "error",
  message: "Dataset upload failed",
};

const unrelatedLog: LogRecord = {
  category: "ollama",
  createdAt: "2026-07-28T12:10:12Z",
  details: null,
  id: 2,
  level: "info",
  message: "Models refreshed",
};

function renderContextPanel(tasks: readonly TaskRecord[] = []): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["tasks"], tasks);
  queryClient.setQueryData(["logs", "context"], [uploadLog, unrelatedLog]);

  render(
    <MemoryRouter initialEntries={["/training"]}>
      <QueryClientProvider client={queryClient}>
        <ContextPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Context panel activity logs", () => {
  it("shows detailed training logs in the right sidebar", () => {
    renderContextPanel();

    expect(screen.getByText("Training logs")).toBeInTheDocument();
    expect(screen.getByText(uploadLog.message)).toBeInTheDocument();
    expect(screen.getByText(uploadLog.details ?? "")).toBeInTheDocument();
    expect(screen.queryByText(unrelatedLog.message)).not.toBeInTheDocument();
  });

  it("guards background progress rendering from non-finite values", () => {
    renderContextPanel([
      {
        createdAt: "2026-07-28T12:10:13Z",
        endedAt: null,
        id: "upload-1",
        kind: "dataset-upload",
        logs: "Uploading",
        progress: Number.NaN,
        startedAt: "2026-07-28T12:10:13Z",
        status: "running",
        title: "Upload planning data",
        updatedAt: "2026-07-28T12:10:13Z",
      },
    ]);

    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
