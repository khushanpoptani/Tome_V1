import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { PlaceholderPage } from "@/features/placeholders/placeholder-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { DesktopShell } from "@/layouts/desktop-shell";
import { Navigate, Route, Routes } from "react-router-dom";

export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<DesktopShell />}>
        <Route index element={<DashboardPage />} />
        <Route
          path="chat"
          element={
            <PlaceholderPage
              description="Conversations, streaming responses, and agent activity will live here."
              eyebrow="AI workspace"
              title="Chat"
            />
          }
        />
        <Route
          path="workspace"
          element={
            <PlaceholderPage
              description="Open a workspace to browse source, search symbols, and inspect Git state."
              eyebrow="Local execution"
              title="Workspace"
            />
          }
        />
        <Route
          path="projects"
          element={
            <PlaceholderPage
              description="Create, import, configure, commit, archive, and revisit Tome projects."
              eyebrow="Project lifecycle"
              title="Projects"
            />
          }
        />
        <Route
          path="history"
          element={
            <PlaceholderPage
              description="Past chats, execution plans, verification results, and outputs will appear here."
              eyebrow="Traceability"
              title="History"
            />
          }
        />
        <Route
          path="tasks"
          element={
            <PlaceholderPage
              description="Follow deterministic execution steps, retries, approvals, and verification."
              eyebrow="Execution engine"
              title="Task Queue"
            />
          }
        />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
