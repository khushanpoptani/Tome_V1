import {
  EmptyState,
  inputClassName,
  Modal,
  PageHeader,
  textAreaClassName,
} from "@/components/common/page";
import {
  backend,
  deleteTrainingDataset,
  isTauriRuntime,
  prepareTrainingDataset,
  startDatasetUpload,
} from "@/lib/backend";
import { errorMessage, formatBytes, formatDate } from "@/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type {
  DatasetExclusion,
  DatasetValidationIssue,
  OllamaModel,
  TrainingDatasetGroupRecord,
  TrainingDatasetRecord,
  TrainingJobRecord,
  TrainingStreamEvent,
} from "@tome/types";
import { useShellStore } from "@tome/stores";
import { Badge, Button, Card, cn } from "@tome/ui";
import {
  Activity,
  Archive,
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Clock3,
  ChevronRight,
  Database,
  FileArchive,
  Folder,
  FolderOpen,
  Gauge,
  HardDrive,
  History,
  ListPlus,
  ListChecks,
  Logs,
  MemoryStick,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const sections = [
  ["dashboard", "Dashboard", Gauge],
  ["datasets", "Datasets", Database],
  ["jobs", "Training Jobs", ListChecks],
  ["running", "Running Jobs", Activity],
  ["completed", "Completed Jobs", CheckCircle2],
  ["failed", "Failed Jobs", XCircle],
  ["history", "Training History", History],
  ["resources", "Server Resources", MemoryStick],
] as const;

type SectionId = (typeof sections)[number][0];

interface ServerForm {
  readonly id?: string;
  readonly name: string;
  readonly url: string;
  readonly isActive: boolean;
}

interface DatasetForm {
  readonly id?: string;
  readonly groupId: string | null;
  readonly name: string;
  readonly sourcePath: string;
  readonly compress: boolean;
  readonly supportedFormats: string;
}

interface DatasetPreparationInput {
  readonly id?: string;
  readonly groupId?: string | null;
  readonly name: string;
  readonly sourcePath: string;
  readonly compress: boolean;
  readonly supportedFormats: string | readonly string[];
  readonly exclusions?: readonly DatasetExclusion[];
}

interface DatasetGroupForm {
  readonly id?: string;
  readonly name: string;
}

interface DatasetGroupDeleteConfirmation {
  readonly group: TrainingDatasetGroupRecord;
  readonly datasets: readonly TrainingDatasetRecord[];
}

interface DatasetGroupAssignment {
  readonly datasetIds: readonly string[];
  readonly group: TrainingDatasetGroupRecord;
}

type DatasetListRow =
  | {
      readonly datasets: readonly TrainingDatasetRecord[];
      readonly group: TrainingDatasetGroupRecord | null;
      readonly id: string;
      readonly kind: "group";
    }
  | {
      readonly dataset: TrainingDatasetRecord;
      readonly isLastInGroup: boolean;
      readonly kind: "dataset";
      readonly parentGroupId: string;
    };

interface JobForm {
  readonly datasetIds: readonly string[];
  readonly model: string;
  readonly baseModel: string;
  readonly backend: string;
  readonly totalEpochs: number;
  readonly parametersJson: string;
}

type StreamStatus = "disabled" | "connecting" | "connected" | "fallback";
type OperationProgressEvent = Extract<
  TrainingStreamEvent,
  { readonly type: "operationProgress" }
>;

interface DatasetOperationState {
  readonly kind: "delete" | "prepare";
  readonly event: OperationProgressEvent;
  readonly error: string | null;
}

interface DatasetDeleteConfirmation {
  readonly datasets: readonly TrainingDatasetRecord[];
  readonly mode: "all" | "single";
}

type TrainingDeleteConfirmation =
  | {
      readonly id: string;
      readonly isActive: boolean;
      readonly kind: "server";
      readonly name: string;
    }
  | {
      readonly id: string;
      readonly kind: "job";
      readonly model: string;
      readonly status: TrainingJobRecord["status"];
    };

function percent(value: number | null | undefined): string {
  return `${Math.round(Math.max(0, Math.min(100, value ?? 0)))}%`;
}

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "Calculating";
  }
  if (seconds < 60) {
    return `${Math.max(0, Math.round(seconds))}s`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function Metric({
  detail,
  icon: Icon,
  label,
  value,
}: {
  readonly detail: string;
  readonly icon: typeof Gauge;
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-xl font-semibold">{value}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p>
        </div>
        <span className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-400">
          <Icon className="size-4" />
        </span>
      </div>
    </Card>
  );
}

function ProgressBar({ value }: { readonly value: number }): React.JSX.Element {
  return (
    <div
      aria-label={`${Math.round(value)} percent complete`}
      className="h-1.5 overflow-hidden rounded-full bg-secondary"
      role="progressbar"
    >
      <div
        className="h-full rounded-full bg-violet-500 transition-[width] duration-300"
        style={{ width: percent(value) }}
      />
    </div>
  );
}

function StatusBadge({ value }: { readonly value: string }): React.JSX.Element {
  const tone =
    value === "completed" || value === "valid" || value === "connected"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : value === "failed" || value === "invalid" || value === "disconnected"
        ? "border-red-500/30 bg-red-500/10 text-red-400"
        : value === "running" || value === "uploading"
          ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
          : "text-muted-foreground";
  return <Badge className={tone}>{value}</Badge>;
}

function FieldHelp({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="flex gap-1.5 text-[9px] leading-relaxed text-muted-foreground">
      <CircleHelp className="mt-0.5 size-3 shrink-0" />
      <span>{children}</span>
    </span>
  );
}

function parseValidationIssues(
  dataset: TrainingDatasetRecord,
): readonly DatasetValidationIssue[] {
  try {
    const value: unknown = JSON.parse(dataset.validationErrorsJson);
    if (!Array.isArray(value)) return [];
    const items = value as readonly unknown[];
    return items.flatMap((item, index): readonly DatasetValidationIssue[] => {
      if (typeof item === "string") {
        return [
          {
            canExcludeFile: false,
            canExcludeRow: false,
            code: "legacy_validation_error",
            file: null,
            id: `legacy:${index}:${item}`,
            message: item,
            row: null,
            severity: "error",
          },
        ];
      }
      if (typeof item !== "object" || item === null) {
        return [];
      }
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.message !== "string") return [];
      const message = candidate.message;
      return [
        {
          canExcludeFile: candidate.canExcludeFile === true,
          canExcludeRow: candidate.canExcludeRow === true,
          code: typeof candidate.code === "string" ? candidate.code : "validation_issue",
          file: typeof candidate.file === "string" ? candidate.file : null,
          id:
            typeof candidate.id === "string"
              ? candidate.id
              : `validation:${index}:${message}`,
          message,
          row: typeof candidate.row === "number" ? candidate.row : null,
          severity: candidate.severity === "warning" ? "warning" : "error",
        },
      ];
    });
  } catch {
    return [
      {
        canExcludeFile: false,
        canExcludeRow: false,
        code: "validation_decode_failed",
        file: null,
        id: "validation-decode-failed",
        message: "Validation details could not be decoded.",
        row: null,
        severity: "error",
      },
    ];
  }
}

function parseValidationErrors(dataset: TrainingDatasetRecord): readonly string[] {
  return parseValidationIssues(dataset)
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message);
}

function parseDatasetExclusions(
  dataset: TrainingDatasetRecord,
): readonly DatasetExclusion[] {
  try {
    const value: unknown = JSON.parse(dataset.exclusionsJson);
    if (!Array.isArray(value)) return [];
    const items = value as readonly unknown[];
    return items.flatMap((item): readonly DatasetExclusion[] => {
      if (typeof item !== "object" || item === null) {
        return [];
      }
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.file !== "string") return [];
      const row =
        typeof candidate.row === "number" && candidate.row > 0 ? candidate.row : null;
      const issueCode =
        typeof candidate.issueCode === "string" && candidate.issueCode.length > 0
          ? candidate.issueCode
          : null;
      return [{ file: candidate.file, issueCode, row }];
    });
  } catch {
    return [];
  }
}

function supportsOllamaAdapter(model: OllamaModel): boolean {
  const modelName = `${model.name} ${model.model}`.toLowerCase();
  if (["smollm", "qwen", "phi"].some((family) => modelName.includes(family))) {
    return false;
  }
  if (
    ["llama", "mistral", "mixtral", "gemma"].some((family) => modelName.includes(family))
  ) {
    return true;
  }
  const descriptor = [model.details?.family, ...(model.details?.families ?? [])]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return ["llama", "mistral", "mixtral", "gemma"].some((family) =>
    descriptor.includes(family),
  );
}

export function TrainingPage(): React.JSX.Element {
  const setContextPanelOpen = useShellStore((state) => state.setContextPanelOpen);
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SectionId>("dashboard");
  const [serverForm, setServerForm] = useState<ServerForm | null>(null);
  const [datasetForm, setDatasetForm] = useState<DatasetForm | null>(null);
  const [datasetGroupForm, setDatasetGroupForm] = useState<DatasetGroupForm | null>(null);
  const [datasetGroupDeleteConfirmation, setDatasetGroupDeleteConfirmation] =
    useState<DatasetGroupDeleteConfirmation | null>(null);
  const [datasetGroupAssignment, setDatasetGroupAssignment] =
    useState<DatasetGroupAssignment | null>(null);
  const [collapsedDatasetGroups, setCollapsedDatasetGroups] = useState<
    ReadonlySet<string>
  >(new Set());
  const [datasetDeleteConfirmation, setDatasetDeleteConfirmation] =
    useState<DatasetDeleteConfirmation | null>(null);
  const [trainingDeleteConfirmation, setTrainingDeleteConfirmation] =
    useState<TrainingDeleteConfirmation | null>(null);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<{
    readonly completed: number;
    readonly total: number;
  } | null>(null);
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{
    readonly completed: number;
    readonly failed: number;
    readonly total: number;
  } | null>(null);
  const [jobForm, setJobForm] = useState<JobForm | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [datasetDropGroupId, setDatasetDropGroupId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("disabled");
  const pendingRefreshes = useRef(new Map<string, number>());
  const jobsRef = useRef<readonly TrainingJobRecord[]>([]);
  const operationStarts = useRef(new Map<string, string>());
  const operationLogs = useRef(new Map<string, string[]>());
  const operationTaskWrites = useRef(new Map<string, Promise<void>>());
  const prepareDatasetRef = useRef<
    ((input: DatasetPreparationInput) => Promise<TrainingDatasetRecord>) | undefined
  >(undefined);
  const [uploadProgress, setUploadProgress] = useState<
    Readonly<Record<string, TrainingStreamEvent>>
  >({});
  const [datasetOperations, setDatasetOperations] = useState<
    Readonly<Record<string, DatasetOperationState>>
  >({});

  const servers = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listTrainingServers,
    queryKey: ["training-servers"],
  });
  const ollamaServer = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.getActiveServer,
    queryKey: ["active-server"],
  });
  const ollamaModels = useQuery({
    enabled:
      isTauriRuntime() && ollamaServer.data !== null && ollamaServer.data !== undefined,
    queryFn: () => backend.listModels(ollamaServer.data?.url ?? ""),
    queryKey: ["models", ollamaServer.data?.url],
    refetchInterval: 30_000,
  });
  const datasets = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listTrainingDatasets,
    queryKey: ["training-datasets"],
  });
  const datasetGroups = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listTrainingDatasetGroups,
    queryKey: ["training-dataset-groups"],
  });
  const uploads = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listDatasetUploads,
    queryKey: ["dataset-uploads"],
    refetchInterval: 2_000,
  });
  const tasks = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listTasks,
    queryKey: ["tasks"],
    refetchInterval: 1_000,
  });
  const jobs = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listTrainingJobs,
    queryKey: ["training-jobs"],
    refetchInterval: 5_000,
  });
  const activeServer = servers.data?.find((server) => server.isActive) ?? null;
  const resources = useQuery({
    enabled: isTauriRuntime() && activeServer !== null,
    queryFn: () => backend.getTrainingResources(activeServer?.id ?? ""),
    queryKey: ["training-resources", activeServer?.id],
  });

  useEffect(() => {
    jobsRef.current = jobs.data ?? [];
  }, [jobs.data]);

  const persistOperationTask = (
    id: string,
    kind: string,
    title: string,
    event: OperationProgressEvent,
    status: "cancelled" | "completed" | "failed" | "running" = "running",
    error?: string,
  ): void => {
    const startedAt = operationStarts.current.get(id) ?? new Date().toISOString();
    operationStarts.current.set(id, startedAt);
    const lines = operationLogs.current.get(id) ?? [];
    const nextLine = `${event.stage}: ${error ?? event.message}`;
    if (lines.at(-1) !== nextLine) {
      lines.push(nextLine);
      if (lines.length > 250) lines.splice(0, lines.length - 250);
      operationLogs.current.set(id, lines);
    }
    const input = {
      endedAt: status === "running" ? null : new Date().toISOString(),
      id,
      kind,
      logs: lines.join("\n"),
      progress: event.progress,
      startedAt,
      status,
      title,
    } as const;
    const previousWrite = operationTaskWrites.current.get(id) ?? Promise.resolve();
    const nextWrite = previousWrite
      .catch(() => undefined)
      .then(async () => {
        await backend.saveTask(input);
        await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      });
    operationTaskWrites.current.set(id, nextWrite);
    void nextWrite
      .then(() => {
        if (status !== "running") {
          operationStarts.current.delete(id);
          operationLogs.current.delete(id);
        }
      })
      .finally(() => {
        if (operationTaskWrites.current.get(id) === nextWrite) {
          operationTaskWrites.current.delete(id);
        }
      })
      .catch(() => undefined);
  };

  const showContextLogs = (): void => {
    setContextPanelOpen(true);
    window.setTimeout(() => {
      window.dispatchEvent(new Event("tome:show-context-logs"));
    }, 200);
  };

  const prepareDataset = async (
    input: DatasetPreparationInput,
  ): Promise<TrainingDatasetRecord> => {
    const id = input.id ?? crypto.randomUUID();
    const supportedFormats =
      typeof input.supportedFormats === "string"
        ? input.supportedFormats
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : input.supportedFormats;
    const taskId = `dataset-prepare:${id}`;
    const title = `Prepare ${input.name || "dataset"}`;
    let lastProgress: OperationProgressEvent | null = null;
    toast.info(`Preparing ${input.name || "dataset"}…`);
    try {
      const dataset = await prepareTrainingDataset(
        { ...input, id, supportedFormats },
        (event) => {
          if (event.type !== "operationProgress") return;
          lastProgress = event;
          setDatasetOperations((current) => ({
            ...current,
            [id]: { error: null, event, kind: "prepare" },
          }));
          persistOperationTask(taskId, "dataset-preparation", title, event, "running");
          void queryClient.invalidateQueries({ queryKey: ["training-datasets"] });
        },
      );
      const lastEvent = lastProgress ?? {
        bytesProcessed: dataset.size,
        currentFile: null,
        message:
          dataset.validationStatus === "valid"
            ? "Validation complete"
            : "Validation failed",
        operationId: taskId,
        progress: 100,
        stage:
          dataset.validationStatus === "valid" ? "Ready for Upload" : "Validation Failed",
        totalBytes: dataset.size,
        type: "operationProgress" as const,
      };
      persistOperationTask(
        taskId,
        "dataset-preparation",
        title,
        lastEvent,
        dataset.validationStatus === "valid" ? "completed" : "failed",
        dataset.validationStatus === "valid"
          ? undefined
          : parseValidationErrors(dataset).join("; "),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["training-datasets"] }),
        queryClient.invalidateQueries({ queryKey: ["training-logs"] }),
      ]);
      if (dataset.validationStatus === "valid") {
        setDatasetOperations((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        toast.success(`${dataset.name} validated and is ready for upload.`);
      } else {
        const validationError =
          parseValidationErrors(dataset)[0] ?? "See validation details.";
        setDatasetOperations((current) => ({
          ...current,
          [id]: {
            error: validationError,
            event: { ...lastEvent, message: validationError, stage: "Validation Failed" },
            kind: "prepare",
          },
        }));
        toast.error(`${dataset.name} failed validation: ${validationError}`);
      }
      return dataset;
    } catch (error) {
      const message = errorMessage(error);
      const failureEvent: OperationProgressEvent = {
        bytesProcessed: 0,
        currentFile: null,
        message,
        operationId: taskId,
        progress: 0,
        stage: "Preparation Failed",
        totalBytes: 0,
        type: "operationProgress",
      };
      setDatasetOperations((current) => ({
        ...current,
        [id]: { error: message, event: failureEvent, kind: "prepare" },
      }));
      persistOperationTask(
        taskId,
        "dataset-preparation",
        title,
        failureEvent,
        "failed",
        message,
      );
      toast.error(`Dataset preparation failed: ${message}`);
      throw error;
    }
  };
  prepareDatasetRef.current = prepareDataset;

  const excludeDatasetIssue = (
    dataset: TrainingDatasetRecord,
    issue: DatasetValidationIssue,
    mode: "file" | "row",
  ): void => {
    if (issue.file === null) {
      toast.error("This validation issue is not tied to a removable file.");
      return;
    }
    const existing = parseDatasetExclusions(dataset);
    const nextExclusion: DatasetExclusion = {
      file: issue.file,
      issueCode: null,
      row: mode === "row" ? issue.row : null,
    };
    const retained =
      mode === "file" ? existing.filter((value) => value.file !== issue.file) : existing;
    const exclusions = [
      ...retained,
      ...(retained.some(
        (value) =>
          value.file === nextExclusion.file &&
          (value.row ?? null) === (nextExclusion.row ?? null) &&
          (value.issueCode ?? null) === (nextExclusion.issueCode ?? null),
      )
        ? []
        : [nextExclusion]),
    ];
    toast.info(
      mode === "row"
        ? `Excluding row ${String(issue.row)} from ${issue.file}. Your original file will not be changed.`
        : `Excluding ${issue.file} from the managed upload. Your original file will not be changed.`,
    );
    void prepareDataset({
      compress: true,
      exclusions,
      groupId: dataset.groupId,
      id: dataset.id,
      name: dataset.name,
      sourcePath: dataset.sourcePath,
      supportedFormats: ["jsonl", "json", "csv", "parquet", "txt", "md"],
    }).catch(() => undefined);
  };

  const applyBulkDatasetIssueExclusions = (
    dataset: TrainingDatasetRecord,
    issues: readonly DatasetValidationIssue[],
    severity: DatasetValidationIssue["severity"],
  ): void => {
    const issueCodes = [
      ...new Set(
        issues
          .filter(
            (issue) =>
              issue.severity === severity && issue.canExcludeRow && issue.row !== null,
          )
          .map((issue) => issue.code),
      ),
    ];
    if (issueCodes.length === 0) {
      toast.error(`There are no removable ${severity} rows in this dataset.`);
      return;
    }
    const existing = parseDatasetExclusions(dataset);
    const additions = issueCodes
      .filter(
        (code) =>
          !existing.some(
            (value) =>
              value.file === "*" && value.issueCode === code && value.row == null,
          ),
      )
      .map((issueCode): DatasetExclusion => ({
        file: "*",
        issueCode,
        row: null,
      }));
    if (additions.length === 0) {
      toast.info(`All matching ${severity} rows are already excluded.`);
      return;
    }
    toast.info(
      `Excluding every row matching ${issueCodes.join(", ")}. Hidden issues beyond the display limit are included; source files will not be changed.`,
    );
    void prepareDataset({
      compress: true,
      exclusions: [...existing, ...additions],
      groupId: dataset.groupId,
      id: dataset.id,
      name: dataset.name,
      sourcePath: dataset.sourcePath,
      supportedFormats: ["jsonl", "json", "csv", "parquet", "txt", "md"],
    }).catch(() => undefined);
  };

  const clearDatasetExclusions = (dataset: TrainingDatasetRecord): void => {
    toast.info(
      `Clearing managed exclusions for ${dataset.name}. Source files were never changed.`,
    );
    void prepareDataset({
      compress: true,
      exclusions: [],
      groupId: dataset.groupId,
      id: dataset.id,
      name: dataset.name,
      sourcePath: dataset.sourcePath,
      supportedFormats: ["jsonl", "json", "csv", "parquet", "txt", "md"],
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disposed) return;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragActive(true);
          return;
        }
        setDragActive(false);
        if (event.payload.type !== "drop" || event.payload.paths.length === 0) {
          return;
        }
        const paths = event.payload.paths;
        void Promise.allSettled(
          paths.map((sourcePath) => {
            const filename = sourcePath.split(/[\\/]/).pop() ?? "Dataset";
            const name = filename.replace(/\.[^.]+$/, "") || filename;
            const prepare = prepareDatasetRef.current;
            if (prepare === undefined) {
              return Promise.reject(new Error("Dataset preparation is unavailable."));
            }
            return prepare({
              id: crypto.randomUUID(),
              compress: true,
              groupId: datasetDropGroupId,
              name,
              sourcePath,
              supportedFormats: ["jsonl", "json", "csv", "parquet", "txt", "md"],
            });
          }),
        ).then((results) => {
          const failedCount = results.filter(
            (result) => result.status === "rejected",
          ).length;
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ["training-datasets"] }),
            queryClient.invalidateQueries({ queryKey: ["training-logs"] }),
          ]);
          if (failedCount > 0) {
            const firstFailure = results.find(
              (result): result is PromiseRejectedResult => result.status === "rejected",
            );
            toast.error(
              `${failedCount} dataset operation(s) failed: ${errorMessage(firstFailure?.reason)}`,
            );
          }
        });
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch((error: unknown) => {
        toast.error(`Native dataset drop is unavailable: ${errorMessage(error)}`);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [datasetDropGroupId, queryClient]);

  useEffect(() => {
    if (activeServer === null || activeServer.status !== "connected") {
      setStreamStatus("disabled");
      return;
    }
    let capabilities: {
      websocket?: boolean;
      websocketPath?: string;
    } = {};
    try {
      capabilities = JSON.parse(activeServer.capabilitiesJson) as typeof capabilities;
    } catch {
      setStreamStatus("fallback");
      return;
    }
    if (!capabilities.websocket) {
      setStreamStatus("fallback");
      return;
    }
    const endpoint = new URL(activeServer.url);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}${capabilities.websocketPath ?? "/v1/events/ws"}`;
    endpoint.search = "";
    setStreamStatus("connecting");
    const socket = new WebSocket(endpoint);
    const refreshes = pendingRefreshes.current;
    socket.addEventListener("open", () => setStreamStatus("connected"));
    socket.addEventListener("close", () => setStreamStatus("fallback"));
    socket.addEventListener("error", () => setStreamStatus("fallback"));
    socket.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(String(message.data)) as {
          type?: string;
          jobId?: string;
        };
        if (event.type === "resources") {
          void backend
            .refreshTrainingResources(activeServer.id)
            .then(() =>
              queryClient.invalidateQueries({ queryKey: ["training-resources"] }),
            )
            .catch(() => undefined);
          return;
        }
        if (event.type === "modelRegistered") {
          void queryClient.invalidateQueries({ queryKey: ["models"] });
        }
        if (event.jobId === undefined) return;
        const localJob = jobsRef.current.find((job) => job.remoteJobId === event.jobId);
        if (localJob === undefined || refreshes.has(localJob.id)) return;
        const timer = window.setTimeout(() => {
          refreshes.delete(localJob.id);
          void backend
            .refreshTrainingJob(localJob.id)
            .then(() =>
              Promise.all([
                queryClient.invalidateQueries({ queryKey: ["training-jobs"] }),
                queryClient.invalidateQueries({ queryKey: ["training-logs"] }),
              ]),
            )
            .catch(() => undefined);
        }, 200);
        refreshes.set(localJob.id, timer);
      } catch {
        setStreamStatus("fallback");
      }
    });
    return () => {
      socket.close();
      for (const timer of refreshes.values()) {
        window.clearTimeout(timer);
      }
      refreshes.clear();
    };
  }, [activeServer, queryClient]);

  const refreshAll = (): void => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["training-servers"] }),
      queryClient.invalidateQueries({ queryKey: ["training-dataset-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["training-datasets"] }),
      queryClient.invalidateQueries({ queryKey: ["dataset-uploads"] }),
      queryClient.invalidateQueries({ queryKey: ["training-jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["training-logs"] }),
      queryClient.invalidateQueries({ queryKey: ["training-resources"] }),
    ]);
  };

  useEffect(() => {
    const activeJobs = (jobs.data ?? []).filter(
      (job) =>
        job.remoteJobId !== null &&
        ["queued", "running", "paused", "cancelling", "unreachable"].includes(job.status),
    );
    if (activeJobs.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      void Promise.allSettled(
        activeJobs.map(async (job) => backend.refreshTrainingJob(job.id)),
      ).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["training-jobs"] });
        void queryClient.invalidateQueries({ queryKey: ["training-logs"] });
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [jobs.data, queryClient, streamStatus]);

  useEffect(() => {
    if (activeServer === null || activeServer.status !== "connected") {
      return;
    }
    const refresh = (): void => {
      void backend
        .refreshTrainingResources(activeServer.id)
        .then(() => queryClient.invalidateQueries({ queryKey: ["training-resources"] }))
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, [activeServer, queryClient]);

  const saveServer = useMutation({
    mutationFn: backend.saveTrainingServer,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setServerForm(null);
      refreshAll();
      toast.success("Training server saved.");
    },
  });
  const serverAction = useMutation({
    mutationFn: async ({
      action,
      id,
    }: {
      readonly action: "activate" | "delete" | "test";
      readonly id: string;
    }) => {
      if (action === "activate") {
        await backend.setActiveTrainingServer(id);
      } else if (action === "delete") {
        await backend.deleteTrainingServer(id);
      } else {
        await backend.testTrainingServer(id);
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (_, value) => {
      if (value.action === "delete") {
        setTrainingDeleteConfirmation(null);
      }
      refreshAll();
      toast.success(
        value.action === "test"
          ? "Training server diagnostics updated."
          : value.action === "activate"
            ? "Active training server updated."
            : "Training server removed.",
      );
    },
  });
  const saveDataset = useMutation({
    mutationFn: prepareDataset,
    onSuccess: () => {
      refreshAll();
    },
  });
  const saveDatasetGroup = useMutation({
    mutationFn: backend.saveTrainingDatasetGroup,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (group) => {
      setDatasetGroupForm(null);
      setDatasetDropGroupId(group.id);
      setCollapsedDatasetGroups((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
      refreshAll();
      toast.success(`Dataset group ${group.name} saved.`);
    },
  });
  const assignDatasetsToGroup = useMutation({
    mutationFn: (assignment: DatasetGroupAssignment) =>
      backend.assignTrainingDatasetsToGroup(assignment.group.id, assignment.datasetIds),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (_, assignment) => {
      setDatasetGroupAssignment(null);
      refreshAll();
      toast.success(
        `Added ${assignment.datasetIds.length} dataset${assignment.datasetIds.length === 1 ? "" : "s"} to ${assignment.group.name}.`,
      );
    },
  });
  const saveJob = useMutation({
    mutationFn: backend.saveTrainingJob,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setJobForm(null);
      refreshAll();
      toast.success("Training job draft saved. No training has started.");
    },
  });
  const jobAction = useMutation({
    mutationFn: async ({
      action,
      id,
    }: {
      readonly action: "cancel" | "delete" | "dispatch" | "refresh" | "retry";
      readonly id: string;
    }) => {
      if (action === "cancel") return backend.cancelTrainingJob(id);
      if (action === "delete") return backend.deleteTrainingJob(id);
      if (action === "dispatch") return backend.dispatchTrainingJob(id);
      if (action === "refresh") return backend.refreshTrainingJob(id);
      return backend.retryTrainingJob(id);
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (_, value) => {
      if (value.action === "delete") {
        setTrainingDeleteConfirmation(null);
      }
      refreshAll();
      toast.success(
        value.action === "dispatch"
          ? "Job submitted to the external Training Manager."
          : `Training job ${value.action} completed.`,
      );
    },
  });

  const selectableDatasets = useMemo(
    () => (datasets.data ?? []).filter((dataset) => dataset.validationStatus === "valid"),
    [datasets.data],
  );
  const datasetRows = useMemo<readonly DatasetListRow[]>(() => {
    const allDatasets = datasets.data ?? [];
    const rows: DatasetListRow[] = [];
    for (const group of datasetGroups.data ?? []) {
      const members = allDatasets.filter((dataset) => dataset.groupId === group.id);
      rows.push({ datasets: members, group, id: group.id, kind: "group" });
      if (!collapsedDatasetGroups.has(group.id)) {
        rows.push(
          ...members.map((dataset, index) => ({
            dataset,
            isLastInGroup: index === members.length - 1,
            kind: "dataset" as const,
            parentGroupId: group.id,
          })),
        );
      }
    }
    const ungrouped = allDatasets.filter((dataset) => dataset.groupId === null);
    if (ungrouped.length > 0) {
      const id = "__ungrouped__";
      rows.push({ datasets: ungrouped, group: null, id, kind: "group" });
      if (!collapsedDatasetGroups.has(id)) {
        rows.push(
          ...ungrouped.map((dataset, index) => ({
            dataset,
            isLastInGroup: index === ungrouped.length - 1,
            kind: "dataset" as const,
            parentGroupId: id,
          })),
        );
      }
    }
    return rows;
  }, [collapsedDatasetGroups, datasetGroups.data, datasets.data]);
  const selectableDatasetGroups = useMemo(
    () =>
      (datasetGroups.data ?? [])
        .map((group) => ({
          datasets: selectableDatasets.filter((dataset) => dataset.groupId === group.id),
          group,
        }))
        .filter((entry) => entry.datasets.length > 0),
    [datasetGroups.data, selectableDatasets],
  );
  const datasetGroupAssignmentCandidates = useMemo(
    () =>
      datasetGroupAssignment === null
        ? []
        : (datasets.data ?? []).filter(
            (dataset) => dataset.groupId !== datasetGroupAssignment.group.id,
          ),
    [datasetGroupAssignment, datasets.data],
  );
  const pendingUploadDatasets = useMemo(
    () =>
      selectableDatasets.filter(
        (dataset) =>
          activeServer !== null &&
          (dataset.remoteDatasetId === null ||
            dataset.trainingServerId !== activeServer.id),
      ),
    [activeServer, selectableDatasets],
  );
  const compatibleOllamaModels = useMemo(
    () => (ollamaModels.data ?? []).filter(supportsOllamaAdapter),
    [ollamaModels.data],
  );
  const incompatibleOllamaModels = useMemo(
    () => (ollamaModels.data ?? []).filter((model) => !supportsOllamaAdapter(model)),
    [ollamaModels.data],
  );
  const visibleJobs = useMemo(() => {
    const all = jobs.data ?? [];
    if (section === "running") {
      return all.filter((job) =>
        ["queued", "running", "paused", "cancelling", "unreachable"].includes(job.status),
      );
    }
    if (section === "completed") return all.filter((job) => job.status === "completed");
    if (section === "failed") return all.filter((job) => job.status === "failed");
    if (section === "history")
      return all.filter((job) =>
        ["completed", "failed", "cancelled"].includes(job.status),
      );
    return all;
  }, [jobs.data, section]);
  const running = (jobs.data ?? []).filter((job) =>
    ["queued", "running", "paused", "cancelling"].includes(job.status),
  );
  const completed = (jobs.data ?? []).filter((job) => job.status === "completed");
  const failed = (jobs.data ?? []).filter((job) => job.status === "failed");
  const averageSeconds =
    completed.length === 0
      ? null
      : completed.reduce((total, job) => {
          if (job.startedAt === null || job.finishedAt === null) return total;
          return total + (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000;
        }, 0) / completed.length;
  const earliestEta =
    running
      .map((job) => job.etaSeconds)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)[0] ?? null;

  const beginUpload = async (
    dataset: TrainingDatasetRecord,
    notify = true,
  ): Promise<boolean> => {
    if (activeServer === null) {
      if (notify) {
        toast.error("Configure and activate an external Training Manager first.");
      }
      return false;
    }
    if (notify) {
      toast.info(`Upload started for ${dataset.name}.`);
    }
    let taskId: string | null = null;
    let lastOperationEvent: OperationProgressEvent | null = null;
    let validationNotificationShown = false;
    try {
      await startDatasetUpload(dataset.id, activeServer.id, (event) => {
        setUploadProgress((current) => ({ ...current, [dataset.id]: event }));
        if (event.type === "operationProgress") {
          taskId = event.operationId;
          lastOperationEvent = event;
          persistOperationTask(
            event.operationId,
            "dataset-upload",
            `Upload ${dataset.name}`,
            event,
          );
          if (
            notify &&
            event.stage === "Server Validation" &&
            !validationNotificationShown
          ) {
            validationNotificationShown = true;
            toast.info(`Upload complete. Validating ${dataset.name} on the server…`);
          }
        } else if (event.type === "uploadProgress") {
          taskId = event.uploadId;
          const progressEvent: OperationProgressEvent = {
            bytesProcessed: event.bytesUploaded,
            currentFile: dataset.artifactPath ?? dataset.sourcePath,
            message: `${formatBytes(event.bytesUploaded)} of ${formatBytes(event.totalBytes)}`,
            operationId: event.uploadId,
            progress: event.progress,
            stage: "Uploading",
            totalBytes: event.totalBytes,
            type: "operationProgress",
          };
          lastOperationEvent = progressEvent;
          persistOperationTask(
            event.uploadId,
            "dataset-upload",
            `Upload ${dataset.name}`,
            progressEvent,
          );
        } else if (event.type === "complete") {
          if (taskId !== null && lastOperationEvent !== null) {
            persistOperationTask(
              taskId,
              "dataset-upload",
              `Upload ${dataset.name}`,
              { ...lastOperationEvent, message: event.message, progress: 100 },
              "completed",
            );
          }
          if (notify) {
            toast.success(event.message);
          }
          refreshAll();
        } else if (event.type === "error") {
          if (taskId !== null && lastOperationEvent !== null) {
            persistOperationTask(
              taskId,
              "dataset-upload",
              `Upload ${dataset.name}`,
              lastOperationEvent,
              "failed",
              event.message,
            );
          }
          if (notify) {
            toast.error(event.message);
          }
          refreshAll();
        } else if (event.type === "cancelled") {
          if (taskId !== null && lastOperationEvent !== null) {
            persistOperationTask(
              taskId,
              "dataset-upload",
              `Upload ${dataset.name}`,
              { ...lastOperationEvent, message: "Upload cancelled" },
              "cancelled",
            );
          }
          if (notify) {
            toast.info(`${dataset.name} upload cancelled.`);
          }
          refreshAll();
        }
      });
      return true;
    } catch (error: unknown) {
      const message = errorMessage(error);
      if (taskId !== null && lastOperationEvent !== null) {
        persistOperationTask(
          taskId,
          "dataset-upload",
          `Upload ${dataset.name}`,
          lastOperationEvent,
          "failed",
          message,
        );
      }
      if (notify) {
        toast.error(`Upload failed: ${message}`);
      }
      refreshAll();
      return false;
    }
  };

  const uploadDatasetsSequentially = async (
    targets: readonly TrainingDatasetRecord[],
  ): Promise<void> => {
    if (activeServer === null || activeServer.status !== "connected") {
      toast.error("Connect and activate the Training Manager before uploading.");
      return;
    }
    if (targets.length === 0) {
      toast.info("Every valid dataset is already uploaded to the active server.");
      return;
    }
    setBulkUploadProgress({ completed: 0, failed: 0, total: targets.length });
    toast.info(
      `Queued ${targets.length} dataset${targets.length === 1 ? "" : "s"} for upload.`,
    );
    let failed = 0;
    let attempted = 0;
    let consecutiveFailures = 0;
    for (const dataset of targets) {
      const uploaded = await beginUpload(dataset, false);
      attempted += 1;
      if (uploaded) {
        consecutiveFailures = 0;
      } else {
        failed += 1;
        consecutiveFailures += 1;
      }
      setBulkUploadProgress((current) =>
        current === null
          ? null
          : {
              ...current,
              completed: current.completed + 1,
              failed,
            },
      );
      if (consecutiveFailures >= 3) {
        break;
      }
    }
    setBulkUploadProgress(null);
    refreshAll();
    if (attempted < targets.length) {
      toast.error(
        `Upload queue paused after ${consecutiveFailures} consecutive connection failures. ${targets.length - attempted} datasets remain pending; reconnect and click Upload pending to resume.`,
      );
    } else if (failed === 0) {
      toast.success(
        `${targets.length} dataset${targets.length === 1 ? "" : "s"} uploaded and registered.`,
      );
    } else {
      toast.error(
        `${targets.length - failed} uploads completed; ${failed} failed. Open Datasets to inspect and retry them.`,
      );
    }
  };

  const removeDataset = (
    dataset: TrainingDatasetRecord,
    notify = true,
  ): Promise<void> => {
    const existing = datasetOperations[dataset.id];
    if (existing?.kind === "delete" && existing.error === null) {
      return Promise.resolve();
    }
    const taskId = `dataset-delete:${dataset.id}`;
    const title = `Delete ${dataset.name}`;
    let lastProgress: OperationProgressEvent | null = null;
    const initialEvent: OperationProgressEvent = {
      bytesProcessed: 0,
      currentFile: null,
      message: "Preparing deletion",
      operationId: taskId,
      progress: 0,
      stage: "Deleting Dataset",
      totalBytes: dataset.size,
      type: "operationProgress",
    };
    setDatasetOperations((current) => ({
      ...current,
      [dataset.id]: { error: null, event: initialEvent, kind: "delete" },
    }));
    persistOperationTask(taskId, "dataset-delete", title, initialEvent);
    toast.info(`Deleting ${dataset.name}…`);
    return deleteTrainingDataset(dataset.id, (event) => {
      if (event.type !== "operationProgress") return;
      lastProgress = event;
      setDatasetOperations((current) => ({
        ...current,
        [dataset.id]: { error: null, event, kind: "delete" },
      }));
      persistOperationTask(taskId, "dataset-delete", title, event);
    })
      .then(() => {
        const completeEvent: OperationProgressEvent = {
          bytesProcessed: dataset.size,
          currentFile: null,
          message: "Dataset deleted",
          operationId: taskId,
          progress: 100,
          stage: "Completed",
          totalBytes: dataset.size,
          type: "operationProgress",
        };
        persistOperationTask(taskId, "dataset-delete", title, completeEvent, "completed");
        setDatasetOperations((current) => {
          const next = { ...current };
          delete next[dataset.id];
          return next;
        });
        refreshAll();
        if (notify) {
          toast.success(`${dataset.name} and its managed files were deleted.`);
        }
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        const lastEvent = lastProgress ?? {
          bytesProcessed: 0,
          currentFile: null,
          message,
          operationId: taskId,
          progress: 0,
          stage: "Delete Failed",
          totalBytes: dataset.size,
          type: "operationProgress" as const,
        };
        setDatasetOperations((current) => ({
          ...current,
          [dataset.id]: { error: message, event: lastEvent, kind: "delete" },
        }));
        persistOperationTask(
          taskId,
          "dataset-delete",
          title,
          lastEvent,
          "failed",
          message,
        );
        refreshAll();
        if (notify) {
          toast.error(`Delete failed for ${dataset.name}: ${message}`);
          return;
        }
        throw error;
      });
  };

  const confirmDatasetDeletion = (): void => {
    if (datasetDeleteConfirmation === null) return;
    const targets = datasetDeleteConfirmation.datasets.filter(
      (dataset) =>
        !(
          datasetOperations[dataset.id]?.kind === "delete" &&
          datasetOperations[dataset.id]?.error === null
        ),
    );
    const bulk = datasetDeleteConfirmation.mode === "all";
    setDatasetDeleteConfirmation(null);
    if (!bulk) {
      const target = targets[0];
      if (target !== undefined) void removeDataset(target);
      return;
    }
    if (targets.length === 0) return;
    setBulkDeleteProgress({ completed: 0, total: targets.length });
    void Promise.allSettled(
      targets.map((dataset) =>
        removeDataset(dataset, false).finally(() =>
          setBulkDeleteProgress((current) =>
            current === null ? null : { ...current, completed: current.completed + 1 },
          ),
        ),
      ),
    ).then((results) => {
      const failedCount = results.filter((result) => result.status === "rejected").length;
      const deletedCount = results.length - failedCount;
      setBulkDeleteProgress(null);
      refreshAll();
      if (failedCount === 0) {
        toast.success(`Deleted ${deletedCount} dataset${deletedCount === 1 ? "" : "s"}.`);
      } else {
        toast.error(
          `Deleted ${deletedCount} dataset${deletedCount === 1 ? "" : "s"}; ${failedCount} failed and remain available for retry.`,
        );
      }
    });
  };

  const confirmDatasetGroupDeletion = (): void => {
    if (datasetGroupDeleteConfirmation === null) return;
    const { datasets: members, group } = datasetGroupDeleteConfirmation;
    setDatasetGroupDeleteConfirmation(null);
    if (members.length > 0) {
      setBulkDeleteProgress({ completed: 0, total: members.length });
    }
    void Promise.allSettled(
      members.map((dataset) =>
        removeDataset(dataset, false).finally(() =>
          setBulkDeleteProgress((current) =>
            current === null ? null : { ...current, completed: current.completed + 1 },
          ),
        ),
      ),
    )
      .then(async (results) => {
        const failedCount = results.filter(
          (result) => result.status === "rejected",
        ).length;
        if (failedCount > 0) {
          throw new Error(
            `${failedCount} dataset${failedCount === 1 ? "" : "s"} could not be deleted. The group was preserved.`,
          );
        }
        await backend.deleteTrainingDatasetGroup(group.id);
        setDatasetDropGroupId((current) => (current === group.id ? null : current));
        setCollapsedDatasetGroups((current) => {
          const next = new Set(current);
          next.delete(group.id);
          return next;
        });
        toast.success(
          `Deleted ${group.name} and ${members.length} dataset${members.length === 1 ? "" : "s"}.`,
        );
      })
      .catch((error: unknown) => toast.error(errorMessage(error)))
      .finally(() => {
        setBulkDeleteProgress(null);
        refreshAll();
      });
  };

  return (
    <div className="min-h-full">
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            {activeServer === null ? null : (
              <Badge
                className={cn(
                  streamStatus === "connected"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "text-muted-foreground",
                )}
              >
                {streamStatus === "connected"
                  ? "Live events"
                  : streamStatus === "connecting"
                    ? "Connecting…"
                    : "Polling fallback"}
              </Badge>
            )}
            <Button onClick={refreshAll} size="sm" variant="outline">
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>
        }
        description="Manage external fine-tuning infrastructure without running training on this desktop."
        icon={Activity}
        title="Training"
      />
      <div className="grid min-h-[650px] lg:grid-cols-[190px_minmax(0,1fr)]">
        <nav
          aria-label="Training sections"
          className="border-b border-border bg-panel p-3 lg:border-b-0 lg:border-r"
        >
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
            {sections.map(([id, label, Icon]) => (
              <button
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md px-3 text-left text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground",
                  section === id && "bg-accent text-foreground",
                )}
                key={id}
                onClick={() => setSection(id)}
                type="button"
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        </nav>
        <main className="min-w-0 p-5 lg:p-7">
          {section === "dashboard" ? (
            <div className="space-y-6">
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  detail="Queued or actively training"
                  icon={Activity}
                  label="Active Jobs"
                  value={String(running.length)}
                />
                <Metric
                  detail={`${failed.length} failed`}
                  icon={CheckCircle2}
                  label="Completed Jobs"
                  value={String(completed.length)}
                />
                <Metric
                  detail={duration(averageSeconds)}
                  icon={Clock3}
                  label="Average Training"
                  value={
                    averageSeconds === null ? "No history" : duration(averageSeconds)
                  }
                />
                <Metric
                  detail="Earliest active job estimate"
                  icon={Gauge}
                  label="Next Completion"
                  value={earliestEta === null ? "Unknown" : duration(earliestEta)}
                />
              </section>
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Training Manager servers</h2>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Uses the documented tome-training/v1 adapter; Ollama remains the
                      inference and model registry endpoint.
                    </p>
                  </div>
                  <Button
                    onClick={() =>
                      setServerForm({
                        isActive: (servers.data?.length ?? 0) === 0,
                        name: "",
                        url: "http://192.168.1.6:11435",
                      })
                    }
                    size="sm"
                  >
                    <Plus className="size-3.5" />
                    Add server
                  </Button>
                </div>
                {(servers.data?.length ?? 0) === 0 ? (
                  <Card>
                    <EmptyState
                      action={
                        <Button
                          onClick={() =>
                            setServerForm({
                              isActive: true,
                              name: "Training Manager",
                              url: "http://192.168.1.6:11435",
                            })
                          }
                          size="sm"
                        >
                          Configure server
                        </Button>
                      }
                      description="Tome will store datasets and job drafts locally, but upload and dispatch require an external Training Manager implementing tome-training/v1."
                      icon={Server}
                      title="No training server configured"
                    />
                  </Card>
                ) : (
                  <div className="grid gap-3">
                    {servers.data?.map((server) => (
                      <Card
                        className="flex flex-wrap items-center gap-3 p-4"
                        key={server.id}
                      >
                        <span className="grid size-9 place-items-center rounded-lg bg-secondary">
                          <Server className="size-4 text-violet-400" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold">{server.name}</span>
                            <StatusBadge value={server.status} />
                            {server.isActive ? <Badge>Active</Badge> : null}
                          </div>
                          <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                            {server.url} · {server.adapter}
                          </p>
                          {server.lastError === null ? null : (
                            <p className="mt-1 text-[10px] text-red-400">
                              {server.lastError}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            disabled={serverAction.isPending}
                            onClick={() =>
                              serverAction.mutate({ action: "test", id: server.id })
                            }
                            size="sm"
                            variant="outline"
                          >
                            Test
                          </Button>
                          {server.isActive ? null : (
                            <Button
                              onClick={() =>
                                serverAction.mutate({
                                  action: "activate",
                                  id: server.id,
                                })
                              }
                              size="sm"
                              variant="ghost"
                            >
                              Activate
                            </Button>
                          )}
                          <Button
                            aria-label={`Edit ${server.name}`}
                            onClick={() =>
                              setServerForm({
                                id: server.id,
                                isActive: server.isActive,
                                name: server.name,
                                url: server.url,
                              })
                            }
                            size="icon"
                            variant="ghost"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            aria-label={`Delete ${server.name}`}
                            disabled={serverAction.isPending}
                            onClick={() =>
                              setTrainingDeleteConfirmation({
                                id: server.id,
                                isActive: server.isActive,
                                kind: "server",
                                name: server.name,
                              })
                            }
                            size="icon"
                            variant="ghost"
                          >
                            {serverAction.isPending &&
                            serverAction.variables?.action === "delete" &&
                            serverAction.variables.id === server.id ? (
                              <RefreshCw className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {section === "datasets" ? (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Datasets</h2>
                <div className="flex items-center gap-2">
                  <Button
                    disabled={
                      activeServer === null ||
                      activeServer.status !== "connected" ||
                      pendingUploadDatasets.length === 0 ||
                      bulkUploadProgress !== null ||
                      uploads.data?.some((upload) => upload.status === "uploading")
                    }
                    onClick={() => {
                      void uploadDatasetsSequentially(pendingUploadDatasets);
                    }}
                    size="sm"
                    title={
                      activeServer === null || activeServer.status !== "connected"
                        ? "Connect the active Training Manager first"
                        : pendingUploadDatasets.length === 0
                          ? "All valid datasets are uploaded"
                          : `Upload ${pendingUploadDatasets.length} dataset${pendingUploadDatasets.length === 1 ? "" : "s"} to ${activeServer.name}`
                    }
                    variant="outline"
                  >
                    {bulkUploadProgress === null ? (
                      <UploadCloud className="size-3.5" />
                    ) : (
                      <RefreshCw className="size-3.5 animate-spin" />
                    )}
                    {bulkUploadProgress === null
                      ? `Upload pending (${pendingUploadDatasets.length})`
                      : `Uploading ${bulkUploadProgress.completed}/${bulkUploadProgress.total}`}
                  </Button>
                  <Button
                    className="text-red-400 hover:border-red-500/40 hover:bg-red-500/10"
                    disabled={
                      (datasets.data?.length ?? 0) === 0 ||
                      bulkDeleteProgress !== null ||
                      Object.values(datasetOperations).some(
                        (operation) =>
                          operation.kind === "delete" && operation.error === null,
                      ) ||
                      uploads.data?.some((upload) => upload.status === "uploading")
                    }
                    onClick={() =>
                      setDatasetDeleteConfirmation({
                        datasets: datasets.data ?? [],
                        mode: "all",
                      })
                    }
                    size="sm"
                    variant="outline"
                  >
                    {bulkDeleteProgress === null ? (
                      <Trash2 className="size-3.5" />
                    ) : (
                      <RefreshCw className="size-3.5 animate-spin" />
                    )}
                    {bulkDeleteProgress === null
                      ? "Delete all"
                      : `Deleting ${bulkDeleteProgress.completed}/${bulkDeleteProgress.total}`}
                  </Button>
                  <Button
                    onClick={() => setDatasetGroupForm({ name: "" })}
                    size="sm"
                    variant="outline"
                  >
                    <Folder className="size-3.5" />
                    New group
                  </Button>
                  <Button
                    onClick={() =>
                      setDatasetForm({
                        compress: true,
                        groupId: null,
                        name: "",
                        sourcePath: "",
                        supportedFormats: "jsonl,json,csv,parquet,txt,md",
                      })
                    }
                    size="sm"
                  >
                    <Plus className="size-3.5" />
                    Add dataset
                  </Button>
                </div>
              </div>
              <Card
                className={cn(
                  "mb-4 border-dashed p-5 text-center transition-colors",
                  dragActive && "border-violet-500 bg-violet-500/10",
                )}
              >
                <UploadCloud className="mx-auto size-6 text-violet-400" />
                <p className="mt-2 text-xs font-medium">
                  {dragActive ? "Drop datasets to validate" : "Drag datasets here"}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Drop one or more files or folders. Tome validates and catalogs them
                  locally; upload remains an explicit action.
                </p>
                <label className="mx-auto mt-3 flex max-w-sm items-center justify-center gap-2 text-[10px] text-muted-foreground">
                  <span className="shrink-0">Save dropped data in</span>
                  <select
                    className={cn(inputClassName, "h-8 min-w-0 py-1 text-[10px]")}
                    onChange={(event) =>
                      setDatasetDropGroupId(event.target.value || null)
                    }
                    value={datasetDropGroupId ?? ""}
                  >
                    <option value="">Ungrouped</option>
                    {(datasetGroups.data ?? []).map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
              </Card>
              {(datasets.data?.length ?? 0) === 0 &&
              (datasetGroups.data?.length ?? 0) === 0 ? (
                <Card>
                  <EmptyState
                    description="Create a group, then add a local dataset file or directory. Tome validates it before any network upload."
                    icon={FileArchive}
                    title="No dataset groups"
                  />
                </Card>
              ) : (
                <div className="grid gap-3">
                  {datasetRows.map((row) => {
                    if (row.kind === "group") {
                      const isCollapsed = collapsedDatasetGroups.has(row.id);
                      const validMembers = row.datasets.filter(
                        (dataset) => dataset.validationStatus === "valid",
                      );
                      const pendingMembers = validMembers.filter(
                        (dataset) =>
                          activeServer !== null &&
                          (dataset.remoteDatasetId === null ||
                            dataset.trainingServerId !== activeServer.id),
                      );
                      const groupUploadActive = row.datasets.some((dataset) =>
                        uploads.data?.some(
                          (upload) =>
                            upload.datasetId === dataset.id &&
                            upload.status === "uploading",
                        ),
                      );
                      const assignableDatasets =
                        row.group === null
                          ? []
                          : (datasets.data ?? []).filter(
                              (dataset) => dataset.groupId !== row.group?.id,
                            );
                      return (
                        <Card
                          className={cn(
                            "border-violet-500/20 bg-violet-500/[0.035] px-3 py-2 shadow-none",
                            !isCollapsed && row.datasets.length > 0 && "rounded-b-lg",
                          )}
                          key={`group:${row.id}`}
                        >
                          <div className="grid items-center gap-2 lg:grid-cols-[minmax(12rem,1fr)_auto]">
                            <button
                              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${row.group?.name ?? "Ungrouped"}`}
                              className="flex min-w-0 items-center gap-2 rounded-md py-0.5 text-left"
                              onClick={() =>
                                setCollapsedDatasetGroups((current) => {
                                  const next = new Set(current);
                                  if (next.has(row.id)) next.delete(row.id);
                                  else next.add(row.id);
                                  return next;
                                })
                              }
                              type="button"
                            >
                              <ChevronRight
                                className={cn(
                                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                  !isCollapsed && "rotate-90",
                                )}
                              />
                              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-violet-500/10 text-violet-400">
                                {isCollapsed ? (
                                  <Folder className="size-3.5" />
                                ) : (
                                  <FolderOpen className="size-3.5" />
                                )}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-[11px] font-semibold">
                                  {row.group?.name ?? "Ungrouped"}
                                </span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[9px] text-muted-foreground">
                                  <span className="whitespace-nowrap">
                                    {row.datasets.length} dataset
                                    {row.datasets.length === 1 ? "" : "s"}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="whitespace-nowrap">
                                    {validMembers.length} valid
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="whitespace-nowrap">
                                    {formatBytes(
                                      row.datasets.reduce(
                                        (total, dataset) => total + dataset.size,
                                        0,
                                      ),
                                    )}
                                  </span>
                                </span>
                              </span>
                            </button>
                            <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                              <Button
                                className="h-7 px-2 text-[10px]"
                                disabled={
                                  activeServer === null ||
                                  activeServer.status !== "connected" ||
                                  pendingMembers.length === 0 ||
                                  bulkUploadProgress !== null ||
                                  groupUploadActive
                                }
                                onClick={() => {
                                  void uploadDatasetsSequentially(pendingMembers);
                                }}
                                size="sm"
                                variant="outline"
                              >
                                <UploadCloud className="size-3" />
                                Upload
                                {pendingMembers.length > 0
                                  ? ` (${pendingMembers.length})`
                                  : ""}
                              </Button>
                              <Button
                                className="h-7 px-2 text-[10px]"
                                onClick={() =>
                                  setDatasetForm({
                                    compress: true,
                                    groupId: row.group?.id ?? null,
                                    name: "",
                                    sourcePath: "",
                                    supportedFormats: "jsonl,json,csv,parquet,txt,md",
                                  })
                                }
                                size="sm"
                                variant="outline"
                              >
                                <Plus className="size-3" />
                                Add
                              </Button>
                              {row.group === null ? null : (
                                <>
                                  <Button
                                    className="h-7 px-2 text-[10px]"
                                    disabled={assignableDatasets.length === 0}
                                    onClick={() =>
                                      setDatasetGroupAssignment({
                                        datasetIds: [],
                                        group: row.group as TrainingDatasetGroupRecord,
                                      })
                                    }
                                    size="sm"
                                    variant="outline"
                                  >
                                    <ListPlus className="size-3" />
                                    Existing
                                  </Button>
                                  <Button
                                    aria-label={`Rename ${row.group.name}`}
                                    className="size-7"
                                    onClick={() =>
                                      setDatasetGroupForm({
                                        id: row.group!.id,
                                        name: row.group!.name,
                                      })
                                    }
                                    size="icon"
                                    variant="ghost"
                                  >
                                    <Pencil className="size-3" />
                                  </Button>
                                  <Button
                                    aria-label={`Delete group ${row.group.name}`}
                                    className="h-7 border-red-500/25 px-2 text-[10px] text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                    onClick={() => {
                                      if (groupUploadActive) {
                                        toast.error(
                                          `${row.group!.name} cannot be deleted while one of its datasets is uploading. Wait for the upload to finish or cancel it first.`,
                                        );
                                        return;
                                      }
                                      if (bulkDeleteProgress !== null) {
                                        toast.error(
                                          "Another dataset deletion is still running. Wait for it to finish before deleting this group.",
                                        );
                                        return;
                                      }
                                      setDatasetGroupDeleteConfirmation({
                                        datasets: row.datasets,
                                        group: row.group as TrainingDatasetGroupRecord,
                                      });
                                    }}
                                    size="sm"
                                    title={
                                      groupUploadActive
                                        ? "Wait for the active group upload to finish"
                                        : bulkDeleteProgress !== null
                                          ? "Wait for the current deletion to finish"
                                          : `Delete ${row.group.name}`
                                    }
                                    variant="outline"
                                  >
                                    <Trash2 className="size-3" />
                                    Delete
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    }
                    const dataset = row.dataset;
                    const validationIssues = parseValidationIssues(dataset);
                    const validationErrors = parseValidationErrors(dataset);
                    const validationWarnings = validationIssues.filter(
                      (issue) => issue.severity === "warning",
                    );
                    const appliedExclusions = parseDatasetExclusions(dataset);
                    const removableErrorRows = validationIssues.filter(
                      (issue) =>
                        issue.severity === "error" &&
                        issue.canExcludeRow &&
                        issue.row !== null,
                    );
                    const removableWarningRows = validationIssues.filter(
                      (issue) =>
                        issue.severity === "warning" &&
                        issue.canExcludeRow &&
                        issue.row !== null,
                    );
                    const latest = uploads.data?.find(
                      (upload) => upload.datasetId === dataset.id,
                    );
                    const event = uploadProgress[dataset.id];
                    const operation = datasetOperations[dataset.id];
                    const persistedOperation = tasks.data?.find(
                      (task) =>
                        task.id === `dataset-delete:${dataset.id}` ||
                        task.id === `dataset-prepare:${dataset.id}`,
                    );
                    const persistedUpload = tasks.data?.find(
                      (task) => task.id === latest?.id,
                    );
                    const isDeleting =
                      (operation?.kind === "delete" &&
                        operation.error === null &&
                        operation.event.progress < 100) ||
                      (persistedOperation?.id === `dataset-delete:${dataset.id}` &&
                        persistedOperation.status === "running");
                    const uploadProgressValue =
                      event?.type === "uploadProgress"
                        ? event.progress
                        : event?.type === "operationProgress"
                          ? event.progress
                          : latest === undefined || latest.totalBytes === 0
                            ? 0
                            : (latest.bytesUploaded / latest.totalBytes) * 100;
                    const operationProgressValue =
                      operation?.event.progress ?? persistedOperation?.progress ?? 0;
                    const persistedOperationIsRelevant =
                      persistedOperation?.status === "running" ||
                      (persistedOperation?.status === "failed" &&
                        (persistedOperation.id === `dataset-delete:${dataset.id}` ||
                          dataset.validationStatus === "invalid"));
                    const operationIsVisible =
                      operation !== undefined ||
                      dataset.validationStatus === "pending" ||
                      persistedOperationIsRelevant;
                    const uploadStage =
                      event?.type === "operationProgress"
                        ? event.stage
                        : (persistedUpload?.logs.split("\n").at(-1)?.split(":")[0] ??
                          (latest?.status === "uploading"
                            ? "Uploading"
                            : latest?.status === "completed"
                              ? "Dataset Registered"
                              : latest?.status === "failed"
                                ? "Upload Failed"
                                : (latest?.status ?? "Waiting")));
                    const bytesUploaded =
                      event?.type === "uploadProgress"
                        ? event.bytesUploaded
                        : (latest?.bytesUploaded ?? 0);
                    const totalUploadBytes =
                      event?.type === "uploadProgress"
                        ? event.totalBytes
                        : (latest?.totalBytes ?? dataset.size);
                    const uploadStatus =
                      latest?.status ??
                      (event?.type === "uploadProgress" ? "uploading" : "pending");
                    const uploadComplete =
                      latest?.status === "completed" || event?.type === "complete";
                    const uploadSpeed =
                      event?.type === "uploadProgress"
                        ? event.speedBps
                        : (latest?.speedBps ?? 0);
                    const uploadEta =
                      event?.type === "uploadProgress"
                        ? event.etaSeconds
                        : (latest?.etaSeconds ?? null);
                    return (
                      <div
                        className={cn(
                          "relative ml-3 pl-5 md:ml-5 md:pl-6",
                          "before:absolute before:left-0 before:w-px before:bg-violet-500/20",
                          "after:absolute after:left-0 after:top-7 after:h-px after:w-4 after:bg-violet-500/20 md:after:w-5",
                          row.isLastInGroup
                            ? "before:-top-3 before:h-10"
                            : "before:-top-3 before:-bottom-3",
                        )}
                        data-parent-group={row.parentGroupId}
                        key={dataset.id}
                      >
                        <Card
                          className={cn(
                            "border-l-violet-500/25 p-3.5 shadow-none transition-opacity",
                            isDeleting && "opacity-80",
                          )}
                        >
                          <div className="flex flex-wrap items-start gap-3">
                            <span className="grid size-9 place-items-center rounded-lg bg-secondary">
                              {dataset.compressed ? (
                                <Archive className="size-4 text-violet-400" />
                              ) : (
                                <Database className="size-4 text-violet-400" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold">
                                  {dataset.name}
                                </span>
                                <StatusBadge value={dataset.validationStatus} />
                                <Badge>{dataset.format}</Badge>
                              </div>
                              <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                                {dataset.sourcePath}
                              </p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                {formatBytes(dataset.size)} · {dataset.fileCount} files ·{" "}
                                {dataset.compressed ? "compressed" : "original"}
                                {appliedExclusions.length === 0
                                  ? ""
                                  : ` · ${appliedExclusions.length} exclusion${appliedExclusions.length === 1 ? "" : "s"} applied`}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                disabled={
                                  dataset.validationStatus !== "valid" ||
                                  activeServer === null ||
                                  latest?.status === "uploading" ||
                                  isDeleting
                                }
                                onClick={() => beginUpload(dataset)}
                                size="sm"
                                variant="outline"
                              >
                                <UploadCloud className="size-3.5" />
                                {latest?.status === "failed" ||
                                latest?.status === "cancelled" ||
                                latest?.status === "paused"
                                  ? "Resume"
                                  : latest?.status === "completed"
                                    ? "Replace remote"
                                    : "Upload"}
                              </Button>
                              {latest?.status === "uploading" ? (
                                <Button
                                  onClick={() => {
                                    void backend
                                      .cancelDatasetUpload(latest.id)
                                      .then(() => {
                                        const cancelEvent: OperationProgressEvent = {
                                          bytesProcessed: latest.bytesUploaded,
                                          currentFile:
                                            dataset.artifactPath ?? dataset.sourcePath,
                                          message: "Upload cancellation requested",
                                          operationId: latest.id,
                                          progress: uploadProgressValue,
                                          stage: "Cancelled",
                                          totalBytes: latest.totalBytes,
                                          type: "operationProgress",
                                        };
                                        persistOperationTask(
                                          latest.id,
                                          "dataset-upload",
                                          `Upload ${dataset.name}`,
                                          cancelEvent,
                                          "cancelled",
                                        );
                                        toast.info(
                                          `Cancellation requested for ${dataset.name}.`,
                                        );
                                        refreshAll();
                                      })
                                      .catch((error: unknown) =>
                                        toast.error(errorMessage(error)),
                                      );
                                  }}
                                  size="sm"
                                  variant="ghost"
                                >
                                  <Square className="size-3" />
                                  Cancel
                                </Button>
                              ) : null}
                              <Button
                                aria-label={`Replace ${dataset.name}`}
                                disabled={
                                  isDeleting || dataset.validationStatus === "pending"
                                }
                                onClick={() =>
                                  setDatasetForm({
                                    compress: dataset.compressed,
                                    groupId: dataset.groupId,
                                    id: dataset.id,
                                    name: dataset.name,
                                    sourcePath: dataset.sourcePath,
                                    supportedFormats: "jsonl,json,csv,parquet,txt,md",
                                  })
                                }
                                size="icon"
                                variant="ghost"
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                aria-label={`Delete ${dataset.name}`}
                                disabled={isDeleting || latest?.status === "uploading"}
                                onClick={() =>
                                  setDatasetDeleteConfirmation({
                                    datasets: [dataset],
                                    mode: "single",
                                  })
                                }
                                size="icon"
                                variant="ghost"
                              >
                                {isDeleting ? (
                                  <RotateCcw className="size-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="size-3.5" />
                                )}
                              </Button>
                            </div>
                          </div>
                          {operationIsVisible ? (
                            <div
                              aria-live="polite"
                              className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3"
                            >
                              <div className="mb-2 flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-[11px] font-medium">
                                    {operation?.event.stage ??
                                      (persistedOperation?.status === "failed"
                                        ? "Operation Failed"
                                        : "Preparing Dataset")}
                                  </p>
                                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                                    {operation?.error ??
                                      operation?.event.message ??
                                      persistedOperation?.logs.split("\n").at(-1) ??
                                      "Processing in the background"}
                                  </p>
                                </div>
                                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                  {persistedOperation?.status === "failed" ||
                                  (operation?.error !== null &&
                                    operation?.error !== undefined) ? (
                                    <CircleAlert className="size-3.5 text-red-400" />
                                  ) : (
                                    <RefreshCw className="size-3.5 animate-spin text-violet-400" />
                                  )}
                                  {Math.round(operationProgressValue)}%
                                </span>
                              </div>
                              <ProgressBar value={operationProgressValue} />
                              {operation?.event.currentFile === null ||
                              operation?.event.currentFile === undefined ? null : (
                                <p className="mt-2 truncate font-mono text-[9px] text-muted-foreground">
                                  Current file: {operation.event.currentFile}
                                </p>
                              )}
                              {operation?.event.totalBytes === 0 ||
                              operation?.event.totalBytes === undefined ? null : (
                                <p className="mt-1 text-[9px] text-muted-foreground">
                                  {formatBytes(operation.event.bytesProcessed)} /{" "}
                                  {formatBytes(operation.event.totalBytes)}
                                </p>
                              )}
                            </div>
                          ) : null}
                          {latest === undefined &&
                          event === undefined ? null : uploadComplete ? (
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                              <span className="flex items-center gap-2 text-[10px]">
                                <CheckCircle2 className="size-3.5 text-emerald-400" />
                                <span className="font-medium text-emerald-300">
                                  Dataset registered
                                </span>
                              </span>
                              <span className="text-[9px] text-muted-foreground">
                                {formatBytes(totalUploadBytes)} on{" "}
                                {activeServer?.name ?? "Training Manager"}
                              </span>
                            </div>
                          ) : (
                            <div className="mt-3 rounded-lg border border-border bg-background/50 p-3">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                                <span className="flex items-center gap-2">
                                  <StatusBadge value={uploadStatus} />
                                  <span className="font-medium">{uploadStage}</span>
                                </span>
                                <span className="text-muted-foreground">
                                  {formatBytes(uploadSpeed)}/s · ETA {duration(uploadEta)}
                                </span>
                              </div>
                              <ProgressBar value={uploadProgressValue} />
                              <div className="mt-2 grid gap-1 text-[9px] text-muted-foreground sm:grid-cols-2">
                                <span>
                                  {formatBytes(bytesUploaded)} /{" "}
                                  {formatBytes(totalUploadBytes)} (
                                  {Math.round(uploadProgressValue)}%)
                                </span>
                                <span className="sm:text-right">
                                  Remaining{" "}
                                  {formatBytes(
                                    Math.max(0, totalUploadBytes - bytesUploaded),
                                  )}
                                </span>
                                <span className="truncate sm:col-span-2">
                                  Current file:{" "}
                                  {event?.type === "operationProgress"
                                    ? (event.currentFile ?? "Server-side validation")
                                    : (dataset.artifactPath ?? dataset.sourcePath)}
                                </span>
                              </div>
                              {latest?.lastError === null ||
                              latest?.lastError === undefined ? null : (
                                <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/5 p-2">
                                  <p className="text-[10px] text-red-400">
                                    {latest.lastError}
                                  </p>
                                  <div className="mt-2 flex gap-2">
                                    <Button
                                      onClick={() => beginUpload(dataset)}
                                      size="sm"
                                      variant="outline"
                                    >
                                      <RotateCcw className="size-3" />
                                      Retry
                                    </Button>
                                    <Button
                                      onClick={showContextLogs}
                                      size="sm"
                                      variant="ghost"
                                    >
                                      <Logs className="size-3" />
                                      View logs
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {dataset.preview === null &&
                          validationIssues.length === 0 ? null : (
                            <details className="mt-3 min-w-0 max-w-full overflow-hidden text-[10px]">
                              <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                                <span>Preview and validation</span>
                                {validationErrors.length > 0 ? (
                                  <Badge className="border-red-500/25 bg-red-500/10 text-red-300">
                                    {validationErrors.length} error
                                    {validationErrors.length === 1 ? "" : "s"}
                                  </Badge>
                                ) : null}
                                {validationWarnings.length > 0 ? (
                                  <Badge className="border-amber-500/25 bg-amber-500/10 text-amber-300">
                                    {validationWarnings.length}
                                    {validationWarnings.length === 200 ? "+" : ""} warning
                                    {validationWarnings.length === 1 ? "" : "s"}
                                  </Badge>
                                ) : null}
                              </summary>
                              <div className="mt-2 max-h-56 max-w-full overflow-auto overscroll-contain rounded-lg border border-border bg-background">
                                {dataset.preview === null ? null : (
                                  <pre className="max-w-full whitespace-pre-wrap break-all p-3 font-mono text-[9px]">
                                    {dataset.preview}
                                  </pre>
                                )}
                                {validationIssues.length === 0 ? null : (
                                  <div className="space-y-2 border-t border-border p-3">
                                    {removableErrorRows.length === 0 &&
                                    removableWarningRows.length === 0 &&
                                    appliedExclusions.length === 0 ? null : (
                                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
                                        <div className="mr-auto min-w-48">
                                          <p className="font-medium text-foreground">
                                            Bulk cleanup
                                          </p>
                                          <p className="text-[9px] text-muted-foreground">
                                            Applies to every matching record, including
                                            issues hidden by the display limit. Original
                                            files remain unchanged.
                                          </p>
                                        </div>
                                        {removableErrorRows.length > 0 ? (
                                          <Button
                                            disabled={
                                              operation?.kind === "prepare" &&
                                              operation.error === null
                                            }
                                            onClick={() =>
                                              applyBulkDatasetIssueExclusions(
                                                dataset,
                                                validationIssues,
                                                "error",
                                              )
                                            }
                                            size="sm"
                                            variant="outline"
                                          >
                                            <Ban className="size-3" />
                                            Exclude all error rows
                                          </Button>
                                        ) : null}
                                        {removableWarningRows.length > 0 ? (
                                          <Button
                                            disabled={
                                              operation?.kind === "prepare" &&
                                              operation.error === null
                                            }
                                            onClick={() =>
                                              applyBulkDatasetIssueExclusions(
                                                dataset,
                                                validationIssues,
                                                "warning",
                                              )
                                            }
                                            size="sm"
                                            variant="outline"
                                          >
                                            <Ban className="size-3" />
                                            Exclude all warning rows
                                          </Button>
                                        ) : null}
                                        {appliedExclusions.length > 0 ? (
                                          <Button
                                            disabled={
                                              operation?.kind === "prepare" &&
                                              operation.error === null
                                            }
                                            onClick={() =>
                                              clearDatasetExclusions(dataset)
                                            }
                                            size="sm"
                                            variant="ghost"
                                          >
                                            <RotateCcw className="size-3" />
                                            Clear exclusions
                                          </Button>
                                        ) : null}
                                      </div>
                                    )}
                                    {validationIssues.slice(0, 50).map((issue) => (
                                      <div
                                        className={cn(
                                          "rounded-md border p-2",
                                          issue.severity === "error"
                                            ? "border-red-500/20 bg-red-500/5"
                                            : "border-amber-500/20 bg-amber-500/5",
                                        )}
                                        key={issue.id}
                                      >
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                          <div className="min-w-0 flex-1">
                                            <div className="mb-1 flex items-center gap-1.5">
                                              {issue.severity === "error" ? (
                                                <CircleAlert className="size-3.5 shrink-0 text-red-400" />
                                              ) : (
                                                <CircleHelp className="size-3.5 shrink-0 text-amber-400" />
                                              )}
                                              <span
                                                className={
                                                  issue.severity === "error"
                                                    ? "font-medium text-red-300"
                                                    : "font-medium text-amber-300"
                                                }
                                              >
                                                {issue.severity === "error"
                                                  ? "Error"
                                                  : "Warning"}
                                              </span>
                                              {issue.file === null ? null : (
                                                <span className="truncate font-mono text-[9px] text-muted-foreground">
                                                  {issue.file}
                                                  {issue.row === null
                                                    ? ""
                                                    : ` · row ${issue.row}`}
                                                </span>
                                              )}
                                            </div>
                                            <p className="break-words text-muted-foreground">
                                              {issue.message}
                                            </p>
                                          </div>
                                          <div className="flex shrink-0 flex-wrap gap-1">
                                            {issue.canExcludeRow && issue.row !== null ? (
                                              <Button
                                                disabled={
                                                  operation?.kind === "prepare" &&
                                                  operation.error === null
                                                }
                                                onClick={() =>
                                                  excludeDatasetIssue(
                                                    dataset,
                                                    issue,
                                                    "row",
                                                  )
                                                }
                                                size="sm"
                                                variant="outline"
                                              >
                                                <Ban className="size-3" />
                                                Exclude row
                                              </Button>
                                            ) : null}
                                            {issue.canExcludeFile ? (
                                              <Button
                                                disabled={
                                                  operation?.kind === "prepare" &&
                                                  operation.error === null
                                                }
                                                onClick={() =>
                                                  excludeDatasetIssue(
                                                    dataset,
                                                    issue,
                                                    "file",
                                                  )
                                                }
                                                size="sm"
                                                variant="ghost"
                                              >
                                                <FileArchive className="size-3" />
                                                Exclude file
                                              </Button>
                                            ) : null}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                    {validationIssues.length <= 50 ? null : (
                                      <p className="mt-2 text-muted-foreground">
                                        {validationIssues.length - 50} additional issues
                                        shown by validation but hidden to keep this view
                                        responsive. Bulk cleanup also applies to matching
                                        issues beyond Tome&apos;s stored display limit.
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </details>
                          )}
                        </Card>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}

          {["jobs", "running", "completed", "failed", "history"].includes(section) ? (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">
                    {sections.find(([id]) => id === section)?.[1]}
                  </h2>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Drafts are local. Dispatch explicitly submits a validated dataset to
                    the active external Training Manager.
                  </p>
                </div>
                {section === "jobs" ? (
                  <Button
                    disabled={selectableDatasets.length === 0}
                    onClick={() => {
                      const defaultBaseModel = compatibleOllamaModels[0]?.name ?? "";
                      setJobForm({
                        backend: "auto",
                        baseModel: defaultBaseModel,
                        datasetIds: selectableDatasets[0]
                          ? [selectableDatasets[0].id]
                          : [],
                        model: "",
                        parametersJson:
                          '{\n  "sourceModel": "meta-llama/Llama-3.2-3B",\n  "ollamaAdapterArchitecture": "llama",\n  "learningRate": 0.0002,\n  "batchSize": 2,\n  "maxLength": 2048,\n  "loraRank": 16\n}',
                        totalEpochs: 3,
                      });
                    }}
                    size="sm"
                  >
                    <Plus className="size-3.5" />
                    New job
                  </Button>
                ) : null}
              </div>
              {visibleJobs.length === 0 ? (
                <Card>
                  <EmptyState
                    description={
                      section === "jobs"
                        ? "Create a dataset first, then define a local training job draft."
                        : `There are no ${section} training jobs.`
                    }
                    icon={ListChecks}
                    title="No training jobs"
                  />
                </Card>
              ) : (
                <div className="grid gap-3">
                  {visibleJobs.map((job) => (
                    <JobCard
                      activeServerId={activeServer?.id ?? null}
                      activeServerReady={activeServer?.status === "connected"}
                      datasets={(datasets.data ?? []).filter((dataset) =>
                        job.datasetIds.includes(dataset.id),
                      )}
                      job={job}
                      key={job.id}
                      onAction={(action) => jobAction.mutate({ action, id: job.id })}
                      onRequestDelete={() =>
                        setTrainingDeleteConfirmation({
                          id: job.id,
                          kind: "job",
                          model: job.model,
                          status: job.status,
                        })
                      }
                      onReviewDatasets={() => setSection("datasets")}
                      onViewLogs={showContextLogs}
                      pendingAction={
                        jobAction.isPending && jobAction.variables?.id === job.id
                          ? jobAction.variables.action
                          : null
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {section === "resources" ? (
            <section>
              <h2 className="text-sm font-semibold">Server resources</h2>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Refreshed every ten seconds while the active Training Manager is
                connected.
              </p>
              {activeServer === null ? (
                <Card className="mt-4">
                  <EmptyState
                    description="Select an active Training Manager from the dashboard."
                    icon={Server}
                    title="No active server"
                  />
                </Card>
              ) : resources.data === null || resources.data === undefined ? (
                <Card className="mt-4">
                  <EmptyState
                    action={
                      <Button
                        onClick={() => {
                          void backend
                            .refreshTrainingResources(activeServer.id)
                            .then(refreshAll)
                            .catch((error: unknown) => toast.error(errorMessage(error)));
                        }}
                        size="sm"
                      >
                        Refresh resources
                      </Button>
                    }
                    description="The external server has not returned a resource snapshot."
                    icon={MemoryStick}
                    title="No resource data"
                  />
                </Card>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric
                    detail="Current server utilization"
                    icon={Activity}
                    label="CPU"
                    value={percent(resources.data.cpuUsage)}
                  />
                  <Metric
                    detail={`${formatBytes(resources.data.ramUsed ?? 0)} of ${formatBytes(resources.data.ramTotal ?? 0)}`}
                    icon={MemoryStick}
                    label="RAM"
                    value={percent(
                      resources.data.ramTotal === null || resources.data.ramUsed === null
                        ? null
                        : (resources.data.ramUsed / resources.data.ramTotal) * 100,
                    )}
                  />
                  <Metric
                    detail={`${formatBytes(resources.data.diskUsed ?? 0)} of ${formatBytes(resources.data.diskTotal ?? 0)}`}
                    icon={HardDrive}
                    label="Disk"
                    value={percent(
                      resources.data.diskTotal === null ||
                        resources.data.diskUsed === null
                        ? null
                        : (resources.data.diskUsed / resources.data.diskTotal) * 100,
                    )}
                  />
                  <Metric
                    detail={`Captured ${formatDate(resources.data.capturedAt)}`}
                    icon={ListChecks}
                    label="Queue"
                    value={String(resources.data.queueLength)}
                  />
                  <Card className="p-4 sm:col-span-2 xl:col-span-4">
                    <h3 className="text-xs font-semibold">GPU inventory</h3>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(JSON.parse(resources.data.gpuJson), null, 2)}
                    </pre>
                  </Card>
                </div>
              )}
            </section>
          ) : null}
        </main>
      </div>

      {serverForm === null ? null : (
        <Modal
          onClose={() => setServerForm(null)}
          title={serverForm.id === undefined ? "Add training server" : "Edit server"}
        >
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              saveServer.mutate({ ...serverForm, adapter: "tome-training-v1" });
            }}
          >
            <label className="block space-y-1.5 text-xs">
              <span>Name</span>
              <input
                autoFocus
                className={inputClassName}
                onChange={(event) =>
                  setServerForm({ ...serverForm, name: event.target.value })
                }
                required
                value={serverForm.name}
              />
            </label>
            <label className="block space-y-1.5 text-xs">
              <span>Training Manager URL</span>
              <input
                className={inputClassName}
                onChange={(event) =>
                  setServerForm({ ...serverForm, url: event.target.value })
                }
                placeholder="http://192.168.1.6:11435"
                required
                type="url"
                value={serverForm.url}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                checked={serverForm.isActive}
                onChange={(event) =>
                  setServerForm({ ...serverForm, isActive: event.target.checked })
                }
                type="checkbox"
              />
              Make this the active training server
            </label>
            <p className="rounded-lg bg-secondary p-3 text-[10px] leading-relaxed text-muted-foreground">
              Tome expects the external server to implement <code>tome-training/v1</code>.
              This is separate from your Ollama inference URL.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setServerForm(null)} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={saveServer.isPending} type="submit">
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {datasetDeleteConfirmation === null ? null : (
        <Modal
          onClose={() => setDatasetDeleteConfirmation(null)}
          title={
            datasetDeleteConfirmation.mode === "all"
              ? "Delete all datasets?"
              : `Delete ${datasetDeleteConfirmation.datasets[0]?.name ?? "dataset"}?`
          }
        >
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-red-400" />
                <div>
                  <p className="text-sm font-medium">
                    {datasetDeleteConfirmation.mode === "all"
                      ? `${datasetDeleteConfirmation.datasets.length} datasets will be removed from Tome.`
                      : "This dataset will be removed from Tome."}
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Managed archives, upload metadata, and registered remote copies are
                    deleted. Your original source files and folders are never deleted.
                  </p>
                </div>
              </div>
            </div>
            {datasetDeleteConfirmation.mode === "all" ? (
              <div className="max-h-44 overflow-auto rounded-lg border border-border bg-background/50 p-3">
                {datasetDeleteConfirmation.datasets.map((dataset) => (
                  <p className="truncate py-1 text-[10px]" key={dataset.id}>
                    {dataset.name}
                    <span className="ml-2 text-muted-foreground">
                      {formatBytes(dataset.size)}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setDatasetDeleteConfirmation(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-500"
                onClick={confirmDatasetDeletion}
                type="button"
              >
                <Trash2 className="size-3.5" />
                {datasetDeleteConfirmation.mode === "all"
                  ? "Delete all datasets"
                  : "Delete dataset"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {trainingDeleteConfirmation === null ? null : (
        <Modal
          onClose={() => {
            if (!serverAction.isPending && !jobAction.isPending) {
              setTrainingDeleteConfirmation(null);
            }
          }}
          title={
            trainingDeleteConfirmation.kind === "server"
              ? `Remove ${trainingDeleteConfirmation.name}?`
              : `Delete ${trainingDeleteConfirmation.model}?`
          }
        >
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-red-400" />
                <div>
                  <p className="text-sm font-medium">
                    {trainingDeleteConfirmation.kind === "server"
                      ? "Remove this Training Manager connection from Tome?"
                      : "Delete this training job record from Tome?"}
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {trainingDeleteConfirmation.kind === "server"
                      ? trainingDeleteConfirmation.isActive
                        ? "This is the active Training Manager. Dataset uploads and job dispatch will stop until another server is activated. The Windows service itself will not be uninstalled."
                        : "Only the saved connection and its local connection metadata will be removed. The Windows service itself will not be uninstalled."
                      : trainingDeleteConfirmation.status === "draft"
                        ? "This removes the local draft. No remote training job has been started."
                        : "This removes Tome's local job record and logs. It does not delete exported model files from the Training Manager."}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                disabled={serverAction.isPending || jobAction.isPending}
                onClick={() => setTrainingDeleteConfirmation(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-500"
                disabled={serverAction.isPending || jobAction.isPending}
                onClick={() => {
                  if (trainingDeleteConfirmation.kind === "server") {
                    serverAction.mutate({
                      action: "delete",
                      id: trainingDeleteConfirmation.id,
                    });
                  } else {
                    jobAction.mutate({
                      action: "delete",
                      id: trainingDeleteConfirmation.id,
                    });
                  }
                }}
                type="button"
              >
                {serverAction.isPending || jobAction.isPending ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                {serverAction.isPending || jobAction.isPending
                  ? "Deleting…"
                  : trainingDeleteConfirmation.kind === "server"
                    ? "Remove server"
                    : "Delete job"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {datasetGroupForm === null ? null : (
        <Modal
          onClose={() => setDatasetGroupForm(null)}
          title={
            datasetGroupForm.id === undefined ? "Create dataset group" : "Rename group"
          }
        >
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              saveDatasetGroup.mutate(datasetGroupForm);
            }}
          >
            <label className="block space-y-1.5 text-xs">
              <span>Group name</span>
              <input
                autoFocus
                className={inputClassName}
                onChange={(event) =>
                  setDatasetGroupForm({ ...datasetGroupForm, name: event.target.value })
                }
                placeholder="Planning Agent"
                required
                value={datasetGroupForm.name}
              />
            </label>
            <FieldHelp>
              A group is a reusable dataset collection. Adding the group to a training job
              selects every valid dataset inside it.
            </FieldHelp>
            <div className="flex justify-end gap-2">
              <Button
                disabled={saveDatasetGroup.isPending}
                onClick={() => setDatasetGroupForm(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={saveDatasetGroup.isPending} type="submit">
                {saveDatasetGroup.isPending ? "Saving…" : "Save group"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {datasetGroupAssignment === null ? null : (
        <Modal
          onClose={() => setDatasetGroupAssignment(null)}
          title={`Add existing data to ${datasetGroupAssignment.group.name}`}
          width="max-w-xl"
        >
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span>Available datasets</span>
              <label className="flex cursor-pointer items-center gap-2 text-[10px] text-muted-foreground">
                <input
                  checked={
                    datasetGroupAssignmentCandidates.length > 0 &&
                    datasetGroupAssignmentCandidates.every((dataset) =>
                      datasetGroupAssignment.datasetIds.includes(dataset.id),
                    )
                  }
                  className="accent-violet-500"
                  onChange={(event) =>
                    setDatasetGroupAssignment({
                      ...datasetGroupAssignment,
                      datasetIds: event.target.checked
                        ? datasetGroupAssignmentCandidates.map((dataset) => dataset.id)
                        : [],
                    })
                  }
                  type="checkbox"
                />
                Select all ({datasetGroupAssignmentCandidates.length})
              </label>
            </div>
            <div className="max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-2">
              {datasetGroupAssignmentCandidates.length === 0 ? (
                <p className="p-4 text-center text-[10px] text-muted-foreground">
                  Every dataset is already in this group.
                </p>
              ) : (
                datasetGroupAssignmentCandidates.map((dataset) => {
                  const currentGroup = datasetGroups.data?.find(
                    (group) => group.id === dataset.groupId,
                  );
                  return (
                    <label
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary"
                      key={dataset.id}
                    >
                      <input
                        checked={datasetGroupAssignment.datasetIds.includes(dataset.id)}
                        className="accent-violet-500"
                        onChange={(event) =>
                          setDatasetGroupAssignment({
                            ...datasetGroupAssignment,
                            datasetIds: event.target.checked
                              ? [...datasetGroupAssignment.datasetIds, dataset.id]
                              : datasetGroupAssignment.datasetIds.filter(
                                  (id) => id !== dataset.id,
                                ),
                          })
                        }
                        type="checkbox"
                      />
                      <Database className="size-3.5 shrink-0 text-violet-400" />
                      <span className="min-w-0 flex-1 truncate">{dataset.name}</span>
                      <span className="shrink-0 text-[9px] text-muted-foreground">
                        {currentGroup?.name ?? "Ungrouped"} · {formatBytes(dataset.size)}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <FieldHelp>
              This moves existing catalog records into the group immediately. Dataset
              validation, managed artifacts, and completed upload state are preserved.
            </FieldHelp>
            <div className="flex justify-end gap-2">
              <Button
                disabled={assignDatasetsToGroup.isPending}
                onClick={() => setDatasetGroupAssignment(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  assignDatasetsToGroup.isPending ||
                  datasetGroupAssignment.datasetIds.length === 0
                }
                onClick={() => assignDatasetsToGroup.mutate(datasetGroupAssignment)}
                type="button"
              >
                {assignDatasetsToGroup.isPending ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <ListPlus className="size-3.5" />
                )}
                Add {datasetGroupAssignment.datasetIds.length || ""} dataset
                {datasetGroupAssignment.datasetIds.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {datasetGroupDeleteConfirmation === null ? null : (
        <Modal
          onClose={() => setDatasetGroupDeleteConfirmation(null)}
          title={`Delete ${datasetGroupDeleteConfirmation.group.name}?`}
        >
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-red-400" />
                <div>
                  <p className="text-sm font-medium">
                    Delete this group and all datasets inside it?
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    This removes {datasetGroupDeleteConfirmation.datasets.length} local
                    dataset record
                    {datasetGroupDeleteConfirmation.datasets.length === 1 ? "" : "s"} and
                    any managed ZIP artifacts. Source files outside Tome and already
                    uploaded Training Manager copies are not deleted.
                  </p>
                </div>
              </div>
            </div>
            {datasetGroupDeleteConfirmation.datasets.length === 0 ? null : (
              <div className="max-h-44 overflow-auto rounded-lg border border-border bg-background/50 p-3">
                {datasetGroupDeleteConfirmation.datasets.map((dataset) => (
                  <p className="truncate py-1 text-[10px]" key={dataset.id}>
                    {dataset.name}
                    <span className="ml-2 text-muted-foreground">
                      {formatBytes(dataset.size)}
                    </span>
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setDatasetGroupDeleteConfirmation(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-500"
                onClick={confirmDatasetGroupDeletion}
                type="button"
              >
                <Trash2 className="size-3.5" />
                Delete group and datasets
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {datasetForm === null ? null : (
        <Modal
          onClose={() => setDatasetForm(null)}
          title={datasetForm.id === undefined ? "Add dataset" : "Replace dataset"}
        >
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              setDatasetForm(null);
              saveDataset.mutate({
                ...datasetForm,
                supportedFormats: datasetForm.supportedFormats
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              });
            }}
          >
            <label className="block space-y-1.5 text-xs">
              <span>Dataset name</span>
              <input
                autoFocus
                className={inputClassName}
                onChange={(event) =>
                  setDatasetForm({ ...datasetForm, name: event.target.value })
                }
                required
                value={datasetForm.name}
              />
            </label>
            <label className="block space-y-1.5 text-xs">
              <span>Dataset group</span>
              <select
                className={inputClassName}
                onChange={(event) =>
                  setDatasetForm({
                    ...datasetForm,
                    groupId: event.target.value || null,
                  })
                }
                value={datasetForm.groupId ?? ""}
              >
                <option value="">Ungrouped</option>
                {(datasetGroups.data ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <FieldHelp>
                Group related files so the complete collection can be uploaded or selected
                for training in one action.
              </FieldHelp>
            </label>
            <label className="block space-y-1.5 text-xs">
              <span>Local file or directory path</span>
              <input
                className={inputClassName}
                onChange={(event) =>
                  setDatasetForm({ ...datasetForm, sourcePath: event.target.value })
                }
                placeholder="/Users/me/datasets/instructions.jsonl"
                required
                value={datasetForm.sourcePath}
              />
            </label>
            <label className="block space-y-1.5 text-xs">
              <span>Allowed extensions (comma separated)</span>
              <input
                className={inputClassName}
                onChange={(event) =>
                  setDatasetForm({
                    ...datasetForm,
                    supportedFormats: event.target.value,
                  })
                }
                required
                value={datasetForm.supportedFormats}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                checked={datasetForm.compress}
                onChange={(event) =>
                  setDatasetForm({ ...datasetForm, compress: event.target.checked })
                }
                type="checkbox"
              />
              Compress into a managed ZIP before upload
            </label>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setDatasetForm(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={saveDataset.isPending} type="submit">
                {saveDataset.isPending ? "Validating…" : "Validate and save"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {jobForm === null ? null : (
        <Modal
          onClose={() => setJobForm(null)}
          title="New training job draft"
          width="max-w-2xl"
        >
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              saveJob.mutate({
                ...jobForm,
                trainingServerId: activeServer?.id ?? null,
              });
            }}
          >
            <div className="space-y-1.5 text-xs">
              {selectableDatasetGroups.length === 0 ? null : (
                <div className="mb-3 space-y-1.5">
                  <span>Select by group</span>
                  <div className="grid max-h-32 gap-1 overflow-y-auto overscroll-contain rounded-lg border border-violet-500/20 bg-violet-500/[0.035] p-2 sm:grid-cols-2">
                    {selectableDatasetGroups.map(({ datasets: members, group }) => {
                      const selectedCount = members.filter((dataset) =>
                        jobForm.datasetIds.includes(dataset.id),
                      ).length;
                      const allSelected = selectedCount === members.length;
                      return (
                        <label
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary"
                          key={group.id}
                        >
                          <input
                            checked={allSelected}
                            className="accent-violet-500"
                            onChange={(event) => {
                              const memberIds = members.map((dataset) => dataset.id);
                              setJobForm({
                                ...jobForm,
                                datasetIds: event.target.checked
                                  ? [...new Set([...jobForm.datasetIds, ...memberIds])]
                                  : jobForm.datasetIds.filter(
                                      (id) => !memberIds.includes(id),
                                    ),
                              });
                            }}
                            type="checkbox"
                          />
                          <Folder className="size-3.5 shrink-0 text-violet-400" />
                          <span className="min-w-0 flex-1 truncate">{group.name}</span>
                          <span className="shrink-0 text-[9px] text-muted-foreground">
                            {selectedCount}/{members.length}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <FieldHelp>
                    Selecting a group adds every valid dataset currently stored inside
                    that group. You can still adjust individual datasets below.
                  </FieldHelp>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span>Training datasets</span>
                <label className="flex cursor-pointer items-center gap-2 text-[10px] text-muted-foreground">
                  <input
                    checked={
                      selectableDatasets.length > 0 &&
                      selectableDatasets.every((dataset) =>
                        jobForm.datasetIds.includes(dataset.id),
                      )
                    }
                    className="accent-violet-500"
                    onChange={(event) =>
                      setJobForm({
                        ...jobForm,
                        datasetIds: event.target.checked
                          ? selectableDatasets.map((dataset) => dataset.id)
                          : [],
                      })
                    }
                    type="checkbox"
                  />
                  Select all ({selectableDatasets.length})
                </label>
              </div>
              <div className="max-h-40 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-2">
                {selectableDatasets.map((dataset) => (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary"
                    key={dataset.id}
                  >
                    <input
                      checked={jobForm.datasetIds.includes(dataset.id)}
                      className="accent-violet-500"
                      onChange={(event) =>
                        setJobForm({
                          ...jobForm,
                          datasetIds: event.target.checked
                            ? [...jobForm.datasetIds, dataset.id]
                            : jobForm.datasetIds.filter((id) => id !== dataset.id),
                        })
                      }
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate">{dataset.name}</span>
                    <span className="shrink-0 text-[9px] text-muted-foreground">
                      {formatBytes(dataset.size)}
                    </span>
                  </label>
                ))}
              </div>
              <FieldHelp>
                Select one or more validated datasets. Select all combines every checked
                dataset into one training run; each must be uploaded to the same Training
                Manager before dispatch.
              </FieldHelp>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5 text-xs">
                <span>Output Ollama model</span>
                <input
                  className={inputClassName}
                  onChange={(event) =>
                    setJobForm({ ...jobForm, model: event.target.value })
                  }
                  placeholder="tome-llama:latest"
                  required
                  value={jobForm.model}
                />
                <FieldHelp>
                  The new Ollama name created after training, such as{" "}
                  <code>tome-github:latest</code>. This is an output name, so it is typed
                  rather than selected.
                </FieldHelp>
              </label>
              <div className="block space-y-1.5 text-xs">
                <span className="flex items-center justify-between gap-2">
                  <span>Installed Ollama base model</span>
                  <button
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                    disabled={
                      ollamaModels.isFetching ||
                      ollamaServer.data === null ||
                      ollamaServer.data === undefined
                    }
                    onClick={() => {
                      void ollamaModels.refetch().then((result) => {
                        if (result.isError) {
                          toast.error(
                            `Could not refresh Ollama models: ${errorMessage(result.error)}`,
                          );
                          return;
                        }
                        toast.success(
                          `Refreshed ${result.data?.length ?? 0} installed Ollama model(s).`,
                        );
                      });
                    }}
                    type="button"
                  >
                    <RefreshCw
                      className={cn("size-3", ollamaModels.isFetching && "animate-spin")}
                    />
                    {ollamaModels.isFetching ? "Refreshing…" : "Refresh all"}
                  </button>
                </span>
                <select
                  aria-label="Installed Ollama base model"
                  className={inputClassName}
                  onChange={(event) =>
                    setJobForm({ ...jobForm, baseModel: event.target.value })
                  }
                  required
                  value={jobForm.baseModel}
                >
                  <option value="">
                    {ollamaServer.data === null
                      ? "No active Ollama server"
                      : compatibleOllamaModels.length === 0
                        ? "No adapter-compatible models installed"
                        : "Select an installed model"}
                  </option>
                  {compatibleOllamaModels.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name}
                      {model.details?.parameter_size
                        ? ` · ${model.details.parameter_size}`
                        : ""}
                    </option>
                  ))}
                  {incompatibleOllamaModels.length === 0 ? null : (
                    <optgroup label="Installed · adapter registration unavailable">
                      {incompatibleOllamaModels.map((model) => (
                        <option disabled key={model.name} value={model.name}>
                          {model.name}
                          {model.details?.parameter_size
                            ? ` · ${model.details.parameter_size}`
                            : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <FieldHelp>
                  Refresh all reads the complete installed list directly from the active
                  Ollama server. Llama, Mistral/Mixtral, and Gemma models can currently be
                  selected for Safetensors adapter registration; other installed models
                  remain visible but disabled.
                </FieldHelp>
              </div>
              <label className="block space-y-1.5 text-xs">
                <span>Backend adapter</span>
                <select
                  className={inputClassName}
                  onChange={(event) =>
                    setJobForm({ ...jobForm, backend: event.target.value })
                  }
                  value={jobForm.backend}
                >
                  <option value="auto">Auto (LoRA)</option>
                  <option value="lora">PEFT LoRA</option>
                  <option value="qlora">PEFT QLoRA</option>
                  <option value="peft">PEFT</option>
                  <option value="transformers">Hugging Face Transformers</option>
                </select>
                <FieldHelp>
                  Auto/LoRA trains a small adapter. QLoRA reduces GPU memory with 4-bit
                  loading. Transformers uses the general worker path.
                </FieldHelp>
              </label>
              <label className="block space-y-1.5 text-xs">
                <span>Epochs</span>
                <input
                  className={inputClassName}
                  min={1}
                  onChange={(event) =>
                    setJobForm({
                      ...jobForm,
                      totalEpochs: Number(event.target.value),
                    })
                  }
                  required
                  type="number"
                  value={jobForm.totalEpochs}
                />
                <FieldHelp>
                  One epoch is one complete pass through all selected records. More epochs
                  increase time and overfitting risk.
                </FieldHelp>
              </label>
            </div>
            <label className="block space-y-1.5 text-xs">
              <span>Training parameters (JSON)</span>
              <textarea
                className={`${textAreaClassName} min-h-40 font-mono`}
                onChange={(event) =>
                  setJobForm({ ...jobForm, parametersJson: event.target.value })
                }
                required
                value={jobForm.parametersJson}
              />
              <FieldHelp>
                Advanced worker configuration. It must remain valid JSON; unknown keys are
                ignored by the current worker.
              </FieldHelp>
            </label>
            <dl className="grid gap-x-4 gap-y-2 rounded-lg border border-border bg-background p-3 text-[9px] sm:grid-cols-[auto_1fr]">
              <dt className="font-mono text-foreground">sourceModel</dt>
              <dd className="text-muted-foreground">
                Hugging Face model ID loaded for training. It must be compatible with the
                selected Ollama base model.
              </dd>
              <dt className="font-mono text-foreground">ollamaAdapterArchitecture</dt>
              <dd className="text-muted-foreground">
                Adapter family used during Ollama registration: currently llama, mistral,
                mixtral, or gemma.
              </dd>
              <dt className="font-mono text-foreground">learningRate</dt>
              <dd className="text-muted-foreground">
                Optimizer step size. Lower values are safer but learn more slowly.
              </dd>
              <dt className="font-mono text-foreground">batchSize</dt>
              <dd className="text-muted-foreground">
                Records processed per training step on each device; higher values require
                more GPU memory.
              </dd>
              <dt className="font-mono text-foreground">maxLength</dt>
              <dd className="text-muted-foreground">
                Maximum tokens retained from each record. Longer values increase memory
                and training time.
              </dd>
              <dt className="font-mono text-foreground">loraRank</dt>
              <dd className="text-muted-foreground">
                LoRA adapter capacity. Higher ranks can learn more but create larger,
                slower adapters.
              </dd>
            </dl>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] leading-relaxed text-amber-200">
              Training records must contain a text field or a prompt and response pair.
              Raw GitHub event objects need preprocessing or matching field parameters
              before the worker can train on them.
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setJobForm(null)} type="button" variant="outline">
                Cancel
              </Button>
              <Button
                disabled={saveJob.isPending || jobForm.datasetIds.length === 0}
                type="submit"
              >
                Save draft
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function JobCard({
  activeServerId,
  activeServerReady,
  datasets,
  job,
  onAction,
  onRequestDelete,
  onReviewDatasets,
  onViewLogs,
  pendingAction,
}: {
  readonly activeServerId: string | null;
  readonly activeServerReady: boolean;
  readonly datasets: readonly TrainingDatasetRecord[];
  readonly job: TrainingJobRecord;
  readonly onAction: (
    action: "cancel" | "delete" | "dispatch" | "refresh" | "retry",
  ) => void;
  readonly onRequestDelete: () => void;
  readonly onReviewDatasets: () => void;
  readonly onViewLogs: () => void;
  readonly pendingAction: "cancel" | "delete" | "dispatch" | "refresh" | "retry" | null;
}): React.JSX.Element {
  const active = ["queued", "running", "paused", "cancelling", "unreachable"].includes(
    job.status,
  );
  const missingLocalDatasets = Math.max(0, job.datasetIds.length - datasets.length);
  const missingUploads = datasets.filter(
    (dataset) =>
      dataset.remoteDatasetId === null || dataset.trainingServerId !== activeServerId,
  ).length;
  const dispatchBlocker =
    !activeServerReady || activeServerId === null
      ? "Connect and activate a Training Manager before dispatching."
      : missingLocalDatasets > 0
        ? `${missingLocalDatasets} selected dataset${missingLocalDatasets === 1 ? " is" : "s are"} no longer available locally.`
        : missingUploads > 0
          ? `${missingUploads} selected dataset${missingUploads === 1 ? " must" : "s must"} be uploaded to the active Training Manager before dispatching.`
          : null;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-secondary">
          <Activity className={cn("size-4 text-violet-400", active && "animate-pulse")} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">{job.model}</span>
            <StatusBadge value={job.status} />
            <Badge>{job.backend}</Badge>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {job.model} ← {job.baseModel} ·{" "}
            {datasets.length === 1
              ? datasets[0]?.name
              : `${datasets.length}/${job.datasetIds.length} datasets`}{" "}
            · {job.stage} · Epoch {job.currentEpoch}/{job.totalEpochs} · ETA{" "}
            {duration(job.etaSeconds)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {job.status === "draft" || job.status === "failed" ? (
            <Button
              disabled={pendingAction !== null || dispatchBlocker !== null}
              onClick={() => onAction("dispatch")}
              size="sm"
            >
              <Play className="size-3" />
              Dispatch
            </Button>
          ) : null}
          {active && job.remoteJobId !== null ? (
            <>
              <Button
                disabled={pendingAction !== null}
                onClick={() => onAction("refresh")}
                size="sm"
                variant="outline"
              >
                <RefreshCw className="size-3" />
                Refresh
              </Button>
              <Button
                disabled={pendingAction !== null}
                onClick={() => onAction("cancel")}
                size="sm"
                variant="ghost"
              >
                <Ban className="size-3" />
                Cancel
              </Button>
            </>
          ) : null}
          {["failed", "cancelled"].includes(job.status) && job.remoteJobId !== null ? (
            <Button
              disabled={pendingAction !== null}
              onClick={() => onAction("retry")}
              size="sm"
              variant="outline"
            >
              <RotateCcw className="size-3" />
              Retry
            </Button>
          ) : null}
          {!active ? (
            <Button
              aria-label={`Delete ${job.model} job`}
              disabled={pendingAction !== null}
              onClick={onRequestDelete}
              size="icon"
              variant="ghost"
            >
              {pendingAction === "delete" ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </Button>
          ) : null}
        </div>
      </div>
      {["draft", "failed"].includes(job.status) && dispatchBlocker !== null ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-200">
          <span className="flex items-center gap-2">
            <CircleAlert className="size-3.5 shrink-0" />
            {dispatchBlocker}
          </span>
          {activeServerReady && missingUploads > 0 ? (
            <Button onClick={onReviewDatasets} size="sm" variant="outline">
              <UploadCloud className="size-3" />
              Open Datasets
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3">
        <div className="mb-1.5 flex justify-between text-[9px] text-muted-foreground">
          <span>{percent(job.progress)}</span>
          <span>
            Loss {job.loss?.toFixed(4) ?? "—"} · LR{" "}
            {job.learningRate?.toExponential(2) ?? "—"} ·{" "}
            {job.trainingSpeed === null
              ? "— samples/s"
              : `${job.trainingSpeed.toFixed(2)} samples/s`}
          </span>
        </div>
        <ProgressBar value={job.progress} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] text-muted-foreground sm:grid-cols-4">
        <span>GPU {job.gpuUsage === null ? "Not detected" : percent(job.gpuUsage)}</span>
        <span>Worker CPU {job.cpuUsage === null ? "—" : percent(job.cpuUsage)}</span>
        <span>Worker RAM {job.ramUsage === null ? "—" : formatBytes(job.ramUsage)}</span>
        <span>Disk I/O {job.diskUsage === null ? "—" : formatBytes(job.diskUsage)}</span>
      </div>
      {job.warning === null ? null : (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-[10px] text-amber-400">
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          {job.warning}
        </p>
      )}
      {job.error === null ? null : (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-md bg-red-500/10 p-2 text-[10px] text-red-400">
          <p className="flex min-w-0 flex-1 items-start gap-2">
            <CircleAlert className="mt-0.5 size-3 shrink-0" />
            <span className="break-words">{job.error}</span>
          </p>
          <Button onClick={onViewLogs} size="sm" variant="ghost">
            <Logs className="size-3" />
            View logs
          </Button>
        </div>
      )}
    </Card>
  );
}
