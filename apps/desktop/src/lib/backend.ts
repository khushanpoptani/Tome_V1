import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  ConnectionHistoryRecord,
  ConversationInput,
  ConversationRecord,
  FileTreeNode,
  LogRecord,
  MessageInput,
  MessageRecord,
  ModelTestRecord,
  OllamaModel,
  OllamaModelInformation,
  ProjectInput,
  ProjectRecord,
  ServerDiagnostics,
  ServerInput,
  ServerRecord,
  StreamEvent,
  TaskInput,
  TaskRecord,
  WorkspaceInput,
  WorkspaceRecord,
} from "@tome/types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

async function command<T>(
  name: string,
  argumentsValue?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`${name} is only available in the Tome desktop application.`);
  }
  try {
    return await invoke<T>(name, argumentsValue);
  } catch (error) {
    throw new Error(typeof error === "string" ? error : `Command ${name} failed.`);
  }
}

export const backend = {
  cancelOperation: (requestId: string) =>
    command<boolean>("cancel_operation", { requestId }),
  clearFinishedTasks: () => command<void>("clear_finished_tasks"),
  clearLogs: () => command<void>("clear_logs"),
  deleteConversation: (id: string) => command<void>("delete_conversation", { id }),
  deleteProject: (id: string) => command<void>("delete_project", { id }),
  deleteServer: (id: string) => command<void>("delete_server", { id }),
  deleteWorkspace: (id: string) => command<void>("delete_workspace", { id }),
  deleteModel: (url: string, model: string) =>
    command<void>("delete_ollama_model", { url, model }),
  getActiveServer: () => command<ServerRecord | null>("get_active_server"),
  getSettings: () => command<Array<[string, string]>>("get_settings"),
  listConversations: (search?: string) =>
    command<ConversationRecord[]>("list_conversations", { search }),
  listConnectionHistory: (serverId: string) =>
    command<ConnectionHistoryRecord[]>("list_connection_history", { serverId }),
  listLogs: (limit = 200) => command<LogRecord[]>("list_logs", { limit }),
  listMessages: (conversationId: string) =>
    command<MessageRecord[]>("list_messages", { conversationId }),
  listModels: (url: string) => command<OllamaModel[]>("list_ollama_models", { url }),
  listModelTests: (serverId: string) =>
    command<ModelTestRecord[]>("list_model_tests", { serverId }),
  listProjects: () => command<ProjectRecord[]>("list_projects"),
  listServers: () => command<ServerRecord[]>("list_servers"),
  listTasks: () => command<TaskRecord[]>("list_tasks"),
  listWorkspaces: () => command<WorkspaceRecord[]>("list_workspaces"),
  readFileTree: (path: string) => command<FileTreeNode[]>("read_file_tree", { path }),
  saveConversation: (input: ConversationInput) =>
    command<ConversationRecord>("save_conversation", { input }),
  saveMessage: (input: MessageInput) => command<MessageRecord>("save_message", { input }),
  saveProject: (input: ProjectInput) => command<ProjectRecord>("save_project", { input }),
  saveServer: (input: ServerInput) => command<ServerRecord>("save_server", { input }),
  saveTask: (input: TaskInput) => command<TaskRecord>("save_task", { input }),
  saveModelTest: (
    serverId: string,
    model: string,
    status: "completed" | "failed",
    error?: string,
  ) => command<void>("save_model_test", { serverId, model, status, error }),
  saveWorkspace: (input: WorkspaceInput) =>
    command<WorkspaceRecord>("save_workspace", { input }),
  setActiveServer: (id: string) => command<void>("set_active_server", { id }),
  setSetting: (key: string, value: string) =>
    command<void>("set_setting", { key, value }),
  showModel: (url: string, model: string) =>
    command<OllamaModelInformation>("show_ollama_model", { url, model }),
  testServer: (input: { serverId?: string; url: string; verifyStreaming?: boolean }) =>
    command<ServerDiagnostics>("test_ollama_server", { input }),
};

export async function pullModel(
  requestId: string,
  url: string,
  model: string,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const onEventChannel = new Channel<StreamEvent>(onEvent);
  await command<void>("pull_ollama_model", {
    requestId,
    url,
    model,
    onEvent: onEventChannel,
  });
}

export async function streamChat(
  input: {
    requestId: string;
    url: string;
    model: string;
    messages: readonly ChatMessage[];
  },
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const onEventChannel = new Channel<StreamEvent>(onEvent);
  await command<void>("stream_ollama_chat", {
    input,
    onEvent: onEventChannel,
  });
}
