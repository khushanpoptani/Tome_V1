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
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastOpenedAt: string;
}

export interface ProjectInput {
  readonly id?: string;
  readonly workspaceId?: string | null;
  readonly name: string;
  readonly path: string;
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
  readonly title: string;
  readonly model: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly preview: string | null;
}

export interface ConversationInput {
  readonly id?: string;
  readonly title: string;
  readonly model?: string | null;
}

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
