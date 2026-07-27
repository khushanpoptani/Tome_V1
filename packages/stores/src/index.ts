import type { PermissionMode } from "@tome/types";
import { create } from "zustand";

interface ShellState {
  readonly contextPanelOpen: boolean;
  readonly permissionMode: PermissionMode;
  readonly sidebarCollapsed: boolean;
  readonly setContextPanelOpen: (open: boolean) => void;
  readonly setPermissionMode: (mode: PermissionMode) => void;
  readonly toggleSidebar: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  contextPanelOpen: true,
  permissionMode: "ask",
  sidebarCollapsed: false,
  setContextPanelOpen: (contextPanelOpen) => {
    set({ contextPanelOpen });
  },
  setPermissionMode: (permissionMode) => {
    set({ permissionMode });
  },
  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },
}));
