export const permissionModes = ["ask", "smart", "full"] as const;
export type PermissionMode = (typeof permissionModes)[number];

export const permissionScopes = [
  "filesystem",
  "terminal",
  "internet",
  "git",
  "model-training",
  "dataset-upload",
  "server-management",
] as const;
export type PermissionScope = (typeof permissionScopes)[number];

export const agentKinds = [
  "router",
  "technical",
  "planning",
  "strategy",
  "code-generation",
  "diagnosis",
  "repair",
  "documentation",
  "research",
] as const;
export type AgentKind = (typeof agentKinds)[number];

export const taskStatuses = [
  "pending",
  "running",
  "awaiting-approval",
  "verifying",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "degraded";

export interface HealthStatus {
  readonly application: "Tome";
  readonly status: "ok";
  readonly version: string;
}

export interface NavigationItem {
  readonly id:
    | "dashboard"
    | "chat"
    | "workspace"
    | "projects"
    | "history"
    | "task-queue"
    | "training"
    | "settings";
  readonly label: string;
  readonly path: string;
}

export type ThemeMode = "dark" | "light" | "system";

export interface ServerRecord {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly isActive: boolean;
  readonly lastStatus: string | null;
  readonly lastPingMs: number | null;
  readonly lastVersion: string | null;
  readonly lastError: string | null;
  readonly lastTestedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ServerInput {
  readonly id?: string;
  readonly name: string;
  readonly url: string;
  readonly isActive: boolean;
}

export interface ServerDiagnostics {
  readonly reachable: boolean;
  readonly ollamaResponding: boolean;
  readonly apiAvailable: boolean;
  readonly streamingAvailable: boolean;
  readonly streamingVerified: boolean;
  readonly pingMs: number | null;
  readonly version: string | null;
  readonly installedModels: readonly OllamaModel[];
  readonly runningModels: readonly OllamaModel[];
  readonly error: string | null;
  readonly checkedAt: string;
}

export interface ConnectionHistoryRecord {
  readonly id: string;
  readonly serverId: string;
  readonly status: string;
  readonly pingMs: number | null;
  readonly version: string | null;
  readonly error: string | null;
  readonly testedAt: string;
}

export interface OllamaModelDetails {
  readonly format?: string;
  readonly family?: string;
  readonly families?: readonly string[];
  readonly parameter_size?: string;
  readonly quantization_level?: string;
  readonly parent_model?: string;
}

export interface OllamaModel {
  readonly name: string;
  readonly model?: string;
  readonly modified_at?: string;
  readonly size: number;
  readonly digest?: string;
  readonly details?: OllamaModelDetails;
  readonly expires_at?: string;
  readonly size_vram?: number;
}

export interface OllamaModelInformation {
  readonly license?: string;
  readonly modelfile?: string;
  readonly parameters?: string;
  readonly template?: string;
  readonly details?: OllamaModelDetails;
  readonly model_info?: Readonly<Record<string, unknown>>;
  readonly capabilities?: readonly string[];
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastOpenedAt: string;
}

export interface WorkspaceInput {
  readonly id?: string;
  readonly name: string;
  readonly path: string;
  readonly createDirectory?: boolean;
}

export interface ProjectRecord {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly name: string;
  readonly path: string;
  readonly archivedAt: string | null;
  readonly duplicateOf: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastOpenedAt: string;
}

export interface ProjectInput {
  readonly id?: string;
  readonly workspaceId?: string | null;
  readonly name: string;
  readonly path: string;
  readonly archivedAt?: string | null;
  readonly createDirectory?: boolean;
}

export interface FileTreeNode {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  readonly children: readonly FileTreeNode[];
}

export interface ConversationRecord {
  readonly id: string;
  readonly projectId: string | null;
  readonly title: string;
  readonly model: string | null;
  readonly archivedAt: string | null;
  readonly duplicateOf: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly preview: string | null;
}

export interface ConversationInput {
  readonly id?: string;
  readonly projectId?: string | null;
  readonly title: string;
  readonly model?: string | null;
}

export interface TrainingServerRecord {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly adapter: string;
  readonly isActive: boolean;
  readonly status: "unknown" | "connected" | "degraded" | "disconnected";
  readonly version: string | null;
  readonly capabilitiesJson: string;
  readonly lastError: string | null;
  readonly lastCheckedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TrainingServerInput {
  readonly id?: string;
  readonly name: string;
  readonly url: string;
  readonly adapter?: string;
  readonly isActive: boolean;
}

export interface DatabaseResetResult {
  readonly machine: "local" | "training-manager";
  readonly deletedRecords: number;
  readonly datasets?: number;
  readonly jobs?: number;
  readonly logs?: number;
  readonly uploads?: number;
  readonly warnings: readonly string[];
}

export interface TrainingDatasetRecord {
  readonly id: string;
  readonly groupId: string | null;
  readonly name: string;
  readonly sourcePath: string;
  readonly artifactPath: string | null;
  readonly format: string;
  readonly size: number;
  readonly fileCount: number;
  readonly checksum: string | null;
  readonly compressed: boolean;
  readonly validationStatus: "pending" | "valid" | "invalid";
  readonly validationErrorsJson: string;
  readonly exclusionsJson: string;
  readonly preview: string | null;
  readonly remoteDatasetId: string | null;
  readonly trainingServerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatasetExclusion {
  readonly file: string;
  readonly row?: number | null;
}

export interface DatasetValidationIssue {
  readonly id: string;
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly file: string | null;
  readonly row: number | null;
  readonly canExcludeRow: boolean;
  readonly canExcludeFile: boolean;
}

export interface TrainingDatasetInput {
  readonly id?: string;
  readonly groupId?: string | null;
  readonly name: string;
  readonly sourcePath: string;
  readonly compress: boolean;
  readonly supportedFormats?: readonly string[];
  readonly exclusions?: readonly DatasetExclusion[];
}

export interface TrainingDatasetGroupRecord {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TrainingDatasetGroupInput {
  readonly id?: string;
  readonly name: string;
}

export interface DatasetUploadRecord {
  readonly id: string;
  readonly datasetId: string;
  readonly trainingServerId: string;
  readonly remoteUploadId: string | null;
  readonly status:
    "pending" | "uploading" | "paused" | "completed" | "failed" | "cancelled";
  readonly bytesUploaded: number;
  readonly totalBytes: number;
  readonly chunkSize: number;
  readonly speedBps: number;
  readonly etaSeconds: number | null;
  readonly retryCount: number;
  readonly lastError: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TrainingJobStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "unreachable";

export interface TrainingJobRecord {
  readonly id: string;
  readonly trainingServerId: string | null;
  readonly remoteJobId: string | null;
  readonly datasetId: string;
  readonly datasetIds: readonly string[];
  readonly model: string;
  readonly baseModel: string;
  readonly backend: string;
  readonly parametersJson: string;
  readonly status: TrainingJobStatus;
  readonly stage: string;
  readonly progress: number;
  readonly etaSeconds: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly gpuUsage: number | null;
  readonly cpuUsage: number | null;
  readonly ramUsage: number | null;
  readonly diskUsage: number | null;
  readonly currentEpoch: number;
  readonly totalEpochs: number;
  readonly loss: number | null;
  readonly learningRate: number | null;
  readonly trainingSpeed: number | null;
  readonly heartbeatAt: string | null;
  readonly warning: string | null;
  readonly error: string | null;
  readonly retryOf: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TrainingJobInput {
  readonly id?: string;
  readonly trainingServerId?: string | null;
  readonly datasetIds: readonly string[];
  readonly model: string;
  readonly baseModel: string;
  readonly backend: string;
  readonly parametersJson: string;
  readonly totalEpochs: number;
}

export interface TrainingResourceRecord {
  readonly trainingServerId: string;
  readonly gpuJson: string;
  readonly cpuUsage: number | null;
  readonly ramTotal: number | null;
  readonly ramUsed: number | null;
  readonly diskTotal: number | null;
  readonly diskUsed: number | null;
  readonly queueLength: number;
  readonly capturedAt: string;
}

export interface TrainingLogRecord {
  readonly id: number;
  readonly trainingJobId: string | null;
  readonly level: "debug" | "info" | "warning" | "error";
  readonly message: string;
  readonly cursor: string | null;
  readonly createdAt: string;
}

export type TrainingStreamEvent =
  | {
      readonly type: "uploadProgress";
      readonly uploadId: string;
      readonly bytesUploaded: number;
      readonly totalBytes: number;
      readonly progress: number;
      readonly speedBps: number;
      readonly etaSeconds: number | null;
    }
  | {
      readonly type: "operationProgress";
      readonly operationId: string;
      readonly stage: string;
      readonly message: string;
      readonly progress: number;
      readonly bytesProcessed: number;
      readonly totalBytes: number;
      readonly currentFile: string | null;
    }
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "cancelled" }
  | { readonly type: "complete"; readonly message: string };

export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly dataUrl: string;
}

export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly attachmentsJson: string;
  readonly createdAt: string;
}

export interface MessageInput {
  readonly id?: string;
  readonly conversationId: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly attachmentsJson?: string;
}

export interface TaskRecord {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly progress: number;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly logs: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskInput {
  readonly id?: string;
  readonly kind: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly progress: number;
  readonly startedAt?: string | null;
  readonly endedAt?: string | null;
  readonly logs?: string;
}

export interface LogRecord {
  readonly id: number;
  readonly category: string;
  readonly level: string;
  readonly message: string;
  readonly details: string | null;
  readonly createdAt: string;
}

export interface ModelTestRecord {
  readonly serverId: string;
  readonly model: string;
  readonly testedAt: string;
  readonly status: "completed" | "failed";
  readonly error: string | null;
}

export type StreamEvent =
  | { readonly type: "status"; readonly message: string }
  | {
      readonly type: "progress";
      readonly message: string;
      readonly completed: number | null;
      readonly total: number | null;
      readonly percent: number | null;
    }
  | { readonly type: "token"; readonly content: string }
  | {
      readonly type: "complete";
      readonly total_duration: number | null;
      readonly eval_count: number | null;
      readonly prompt_eval_count: number | null;
    }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "cancelled" };

export interface ChatMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly images?: readonly string[];
}
