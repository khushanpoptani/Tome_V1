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
  DatasetUploadRecord,
  TrainingDatasetInput,
  TrainingDatasetRecord,
  TrainingJobInput,
  TrainingJobRecord,
  TrainingLogRecord,
  TrainingResourceRecord,
  TrainingServerInput,
  TrainingServerRecord,
  TrainingStreamEvent,
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
  archiveProject: (id: string, archived: boolean) =>
    command<ProjectRecord>("archive_project", { id, archived }),
  duplicateProject: (id: string) => command<ProjectRecord>("duplicate_project", { id }),
  moveConversation: (id: string, projectId: string | null) =>
    command<ConversationRecord>("move_conversation", { id, projectId }),
  duplicateConversation: (id: string, projectId?: string | null) =>
    command<ConversationRecord>("duplicate_conversation", { id, projectId }),
  deleteServer: (id: string) => command<void>("delete_server", { id }),
  deleteWorkspace: (id: string) => command<void>("delete_workspace", { id }),
  deleteModel: (url: string, model: string) =>
    command<void>("delete_ollama_model", { url, model }),
  getActiveServer: () => command<ServerRecord | null>("get_active_server"),
  getSettings: () => command<Array<[string, string]>>("get_settings"),
  listConversations: (
    search?: string,
    projectId?: string | null,
    includeArchived = false,
  ) =>
    command<ConversationRecord[]>("list_conversations", {
      search,
      projectId,
      includeArchived,
    }),
  listConnectionHistory: (serverId: string) =>
    command<ConnectionHistoryRecord[]>("list_connection_history", { serverId }),
  listLogs: (limit = 200) => command<LogRecord[]>("list_logs", { limit }),
  listMessages: (conversationId: string) =>
    command<MessageRecord[]>("list_messages", { conversationId }),
  listModels: (url: string) => command<OllamaModel[]>("list_ollama_models", { url }),
  listModelTests: (serverId: string) =>
    command<ModelTestRecord[]>("list_model_tests", { serverId }),
  listProjects: (includeArchived = false) =>
    command<ProjectRecord[]>("list_projects", { includeArchived }),
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
  listTrainingServers: () => command<TrainingServerRecord[]>("list_training_servers"),
  saveTrainingServer: (input: TrainingServerInput) =>
    command<TrainingServerRecord>("save_training_server", { input }),
  setActiveTrainingServer: (id: string) =>
    command<void>("set_active_training_server", { id }),
  deleteTrainingServer: (id: string) => command<void>("delete_training_server", { id }),
  testTrainingServer: (id: string) =>
    command<TrainingServerRecord>("test_training_server", { id }),
  listTrainingDatasets: () => command<TrainingDatasetRecord[]>("list_training_datasets"),
  saveTrainingDataset: (input: TrainingDatasetInput) =>
    command<TrainingDatasetRecord>("save_training_dataset", { input }),
  deleteTrainingDataset: (id: string) => command<void>("delete_training_dataset", { id }),
  listDatasetUploads: () => command<DatasetUploadRecord[]>("list_dataset_uploads"),
  cancelDatasetUpload: (id: string) => command<void>("cancel_dataset_upload", { id }),
  listTrainingJobs: () => command<TrainingJobRecord[]>("list_training_jobs"),
  saveTrainingJob: (input: TrainingJobInput) =>
    command<TrainingJobRecord>("save_training_job", { input }),
  deleteTrainingJob: (id: string) => command<void>("delete_training_job", { id }),
  dispatchTrainingJob: (id: string) =>
    command<TrainingJobRecord>("dispatch_training_job", { id }),
  refreshTrainingJob: (id: string) =>
    command<TrainingJobRecord>("refresh_training_job", { id }),
  cancelTrainingJob: (id: string) =>
    command<TrainingJobRecord>("cancel_training_job", { id }),
  retryTrainingJob: (id: string) =>
    command<TrainingJobRecord>("retry_training_job", { id }),
  listTrainingLogs: (trainingJobId?: string, limit = 500) =>
    command<TrainingLogRecord[]>("list_training_logs", { trainingJobId, limit }),
  refreshTrainingResources: (trainingServerId: string) =>
    command<TrainingResourceRecord>("refresh_training_resources", {
      trainingServerId,
    }),
  getTrainingResources: (trainingServerId: string) =>
    command<TrainingResourceRecord | null>("get_training_resources", {
      trainingServerId,
    }),
};

export async function startDatasetUpload(
  datasetId: string,
  trainingServerId: string,
  onEvent: (event: TrainingStreamEvent) => void,
): Promise<void> {
  const onEventChannel = new Channel<TrainingStreamEvent>(onEvent);
  await command<void>("start_dataset_upload", {
    datasetId,
    trainingServerId,
    onEvent: onEventChannel,
  });
}

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
