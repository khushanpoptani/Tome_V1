import type { NavigationItem, PermissionMode } from "@tome/types";

export const application = {
  name: "Tome",
  executable: "Tome",
  identifier: "app.tome.desktop",
  version: "0.1.0",
} as const;

export const navigationItems: readonly NavigationItem[] = [
  { id: "dashboard", label: "Dashboard", path: "/" },
  { id: "chat", label: "Chat", path: "/chat" },
  { id: "workspace", label: "Workspace", path: "/workspace" },
  { id: "projects", label: "Projects", path: "/projects" },
  { id: "history", label: "History", path: "/history" },
  { id: "task-queue", label: "Task Queue", path: "/tasks" },
  { id: "settings", label: "Settings", path: "/settings" },
] as const;

export const settingsSections = [
  "General",
  "Appearance",
  "Server Connection",
  "Models",
  "Security",
  "Logging",
  "About",
] as const;

export const permissionModeLabels: Readonly<Record<PermissionMode, string>> = {
  ask: "Ask for Approval",
  smart: "Smart Approval",
  full: "Full Access",
};
