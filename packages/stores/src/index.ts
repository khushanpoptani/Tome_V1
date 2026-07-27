import type {
  Attachment,
  ConversationRecord,
  PermissionMode,
  ProjectRecord,
  ServerDiagnostics,
  ServerRecord,
  ThemeMode,
  WorkspaceRecord,
} from "@tome/types";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

const memoryStorage = new Map<string, string>();

const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage?.getItem(name) ?? memoryStorage.get(name) ?? null;
    } catch {
      return memoryStorage.get(name) ?? null;
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage?.removeItem(name);
    } catch {
      // The in-memory fallback below still keeps the current process consistent.
    }
    memoryStorage.delete(name);
  },
  setItem: (name, value) => {
    try {
      window.localStorage?.setItem(name, value);
    } catch {
      // Restricted webviews and tests fall back to process-local persistence.
    }
    memoryStorage.set(name, value);
  },
};

interface ShellState {
  readonly activeConversation: ConversationRecord | null;
  readonly activeProject: ProjectRecord | null;
  readonly activeServer: ServerRecord | null;
  readonly activeWorkspace: WorkspaceRecord | null;
  readonly contextPanelOpen: boolean;
  readonly diagnostics: ServerDiagnostics | null;
  readonly permissionMode: PermissionMode;
  readonly pendingPrompt: {
    readonly id: string;
    readonly text: string;
    readonly attachments: readonly Attachment[];
  } | null;
  readonly selectedModel: string | null;
  readonly sidebarCollapsed: boolean;
  readonly sidebarWidth: number;
  readonly theme: ThemeMode;
  readonly setActiveConversation: (conversation: ConversationRecord | null) => void;
  readonly setActiveProject: (project: ProjectRecord | null) => void;
  readonly setActiveServer: (server: ServerRecord | null) => void;
  readonly setActiveWorkspace: (workspace: WorkspaceRecord | null) => void;
  readonly setContextPanelOpen: (open: boolean) => void;
  readonly setDiagnostics: (diagnostics: ServerDiagnostics | null) => void;
  readonly setPermissionMode: (mode: PermissionMode) => void;
  readonly setPendingPrompt: (
    prompt: {
      readonly id: string;
      readonly text: string;
      readonly attachments: readonly Attachment[];
    } | null,
  ) => void;
  readonly setSelectedModel: (model: string | null) => void;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly setSidebarWidth: (width: number) => void;
  readonly setTheme: (theme: ThemeMode) => void;
  readonly toggleSidebar: () => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      activeConversation: null,
      activeProject: null,
      activeServer: null,
      activeWorkspace: null,
      contextPanelOpen: true,
      diagnostics: null,
      permissionMode: "ask",
      pendingPrompt: null,
      selectedModel: null,
      sidebarCollapsed: false,
      sidebarWidth: 224,
      theme: "system",
      setActiveConversation: (activeConversation) => {
        set({ activeConversation });
      },
      setActiveProject: (activeProject) => {
        set({ activeProject });
      },
      setActiveServer: (activeServer) => {
        set({ activeServer });
      },
      setActiveWorkspace: (activeWorkspace) => {
        set({ activeWorkspace });
      },
      setContextPanelOpen: (contextPanelOpen) => {
        set({ contextPanelOpen });
      },
      setDiagnostics: (diagnostics) => {
        set({ diagnostics });
      },
      setPermissionMode: (permissionMode) => {
        set({ permissionMode });
      },
      setPendingPrompt: (pendingPrompt) => {
        set({ pendingPrompt });
      },
      setSelectedModel: (selectedModel) => {
        set({ selectedModel });
      },
      setSidebarCollapsed: (sidebarCollapsed) => {
        set({ sidebarCollapsed });
      },
      setSidebarWidth: (sidebarWidth) => {
        set({ sidebarWidth: Math.min(360, Math.max(180, sidebarWidth)) });
      },
      setTheme: (theme) => {
        set({ theme });
      },
      toggleSidebar: () => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
      },
    }),
    {
      name: "tome-shell",
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        activeConversation: state.activeConversation,
        activeProject: state.activeProject,
        activeServer: state.activeServer,
        activeWorkspace: state.activeWorkspace,
        contextPanelOpen: state.contextPanelOpen,
        permissionMode: state.permissionMode,
        selectedModel: state.selectedModel,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        theme: state.theme,
      }),
    },
  ),
);
