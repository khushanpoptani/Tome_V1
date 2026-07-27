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
