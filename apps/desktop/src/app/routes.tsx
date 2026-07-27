import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { DesktopShell } from "@/layouts/desktop-shell";
import { readLocalSetting, writeLocalSetting } from "@/lib/local-storage";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const ChatPage = lazy(() =>
  import("@/features/chat/chat-page").then((module) => ({ default: module.ChatPage })),
);
const HistoryPage = lazy(() =>
  import("@/features/history/history-page").then((module) => ({
    default: module.HistoryPage,
  })),
);
const ProjectsPage = lazy(() =>
  import("@/features/projects/projects-page").then((module) => ({
    default: module.ProjectsPage,
  })),
);
const TaskQueuePage = lazy(() =>
  import("@/features/tasks/task-queue-page").then((module) => ({
    default: module.TaskQueuePage,
  })),
);
const WorkspacePage = lazy(() =>
  import("@/features/workspace/workspace-page").then((module) => ({
    default: module.WorkspacePage,
  })),
);

function LazyPage({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-64 place-items-center text-xs text-muted-foreground">
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function NavigationMemory(): null {
  const location = useLocation();
  const navigate = useNavigate();
  const restored = useRef(false);

  useEffect(() => {
    if (!restored.current) {
      restored.current = true;
      const lastPage = readLocalSetting("tome:last-page");
      const shouldRestore = readLocalSetting("tome:restore-last-page") !== "false";
      if (
        shouldRestore &&
        location.pathname === "/" &&
        lastPage !== null &&
        lastPage !== "/"
      ) {
        void navigate(lastPage, { replace: true });
        return;
      }
    }
    writeLocalSetting("tome:last-page", location.pathname);
  }, [location.pathname, navigate]);

  return null;
}

export function AppRoutes(): React.JSX.Element {
  return (
    <>
      <NavigationMemory />
      <Routes>
        <Route element={<DesktopShell />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="chat"
            element={
              <LazyPage>
                <ChatPage />
              </LazyPage>
            }
          />
          <Route
            path="workspace"
            element={
              <LazyPage>
                <WorkspacePage />
              </LazyPage>
            }
          />
          <Route
            path="projects"
            element={
              <LazyPage>
                <ProjectsPage />
              </LazyPage>
            }
          />
          <Route
            path="history"
            element={
              <LazyPage>
                <HistoryPage />
              </LazyPage>
            }
          />
          <Route
            path="tasks"
            element={
              <LazyPage>
                <TaskQueuePage />
              </LazyPage>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </>
  );
}
