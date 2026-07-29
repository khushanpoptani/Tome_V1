import { backend, isTauriRuntime } from "@/lib/backend";
import { formatDate } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useShellStore } from "@tome/stores";
import { Badge, Button, Separator } from "@tome/ui";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  FolderGit2,
  ListChecks,
  ScrollText,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";

export function ContextPanel(): React.JSX.Element {
  const location = useLocation();
  const activeProject = useShellStore((state) => state.activeProject);
  const activeServer = useShellStore((state) => state.activeServer);
  const selectedModel = useShellStore((state) => state.selectedModel);
  const setContextPanelOpen = useShellStore((state) => state.setContextPanelOpen);
  const tasks = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listTasks,
    queryKey: ["tasks"],
    refetchInterval: 2_000,
  });
  const logs = useQuery({
    enabled: isTauriRuntime(),
    queryFn: () => backend.listLogs(100),
    queryKey: ["logs", "context"],
    refetchInterval: 2_000,
  });
  const trainingLogs = useQuery({
    enabled: isTauriRuntime() && location.pathname === "/training",
    queryFn: () => backend.listTrainingLogs(undefined, 100),
    queryKey: ["training-logs"],
    refetchInterval: 2_000,
  });
  const logsSection = useRef<HTMLElement>(null);
  const running = (tasks.data ?? []).filter((task) => task.status === "running");
  const failed = (tasks.data ?? []).filter((task) => task.status === "failed");
  const visibleLogs = useMemo(() => {
    if (location.pathname === "/training") {
      return [
        ...(trainingLogs.data ?? []).map((record) => ({
          category: "training-job",
          createdAt: record.createdAt,
          details:
            record.trainingJobId === null
              ? null
              : `Job ${record.trainingJobId.slice(0, 8)}`,
          id: `training-${record.id}`,
          level: record.level,
          message: record.message,
        })),
        ...(logs.data ?? []).filter((record) => record.category.startsWith("training")),
      ]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 20);
    }
    return (logs.data ?? []).slice(0, 20);
  }, [location.pathname, logs.data, trainingLogs.data]);
  const visibleLogsLoading =
    location.pathname === "/training"
      ? trainingLogs.isLoading || logs.isLoading
      : logs.isLoading;

  useEffect(() => {
    const showLogs = (): void => {
      logsSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("tome:show-context-logs", showLogs);
    return () => window.removeEventListener("tome:show-context-logs", showLogs);
  }, []);

  const sections = [
    { icon: Bot, label: "Chat model", value: selectedModel ?? "None selected" },
    { icon: FolderGit2, label: "Current project", value: activeProject?.name ?? "None" },
    { icon: ListChecks, label: "Running tasks", value: String(running.length) },
    { icon: CheckCircle2, label: "Failed tasks", value: String(failed.length) },
  ] as const;

  return (
    <aside aria-label="Context panel" className="flex h-full w-[292px] flex-col">
      <header className="flex h-12 items-center justify-between px-4">
        <div>
          <p className="text-xs font-semibold">Context</p>
          <p className="text-[10px] text-muted-foreground">Live application state</p>
        </div>
        <Button
          aria-label="Close context panel"
          onClick={() => setContextPanelOpen(false)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <Separator />
      <div className="space-y-2 overflow-auto p-3">
        {sections.map(({ icon: Icon, label, value }) => (
          <section
            className="rounded-lg border border-border/70 bg-background/35 p-3"
            key={label}
          >
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <Icon className="size-3.5" />
              {label}
            </div>
            <span className="block truncate text-xs">{value}</span>
          </section>
        ))}
        {running.length === 0 ? null : (
          <section className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <p className="mb-2 text-[11px] font-medium text-violet-300">
              Background activity
            </p>
            <div className="space-y-3">
              {running.slice(0, 3).map((task) => (
                <div key={task.id}>
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="truncate">{task.title}</span>
                    <span className="text-muted-foreground">
                      {Math.round(Number.isFinite(task.progress) ? task.progress : 0)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-[width]"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(
                            100,
                            Number.isFinite(task.progress) ? task.progress : 0,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 truncate text-[9px] text-muted-foreground">
                    {task.logs.split("\n").at(-1) ?? task.kind}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
        <section
          className="scroll-mt-3 rounded-lg border border-border/70 bg-background/35"
          ref={logsSection}
        >
          <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
            <p className="flex items-center gap-2 text-[11px] font-medium">
              <ScrollText className="size-3.5 text-violet-400" />
              {location.pathname === "/training" ? "Training logs" : "Activity logs"}
            </p>
            <Badge>{visibleLogs.length}</Badge>
          </div>
          <div className="max-h-80 divide-y divide-border/60 overflow-y-auto">
            {visibleLogsLoading ? (
              <p className="p-3 text-[10px] text-muted-foreground">Loading logs…</p>
            ) : visibleLogs.length === 0 ? (
              <p className="p-3 text-[10px] text-muted-foreground">
                No activity has been recorded yet.
              </p>
            ) : (
              visibleLogs.map((record) => (
                <article className="p-3" key={record.id}>
                  <div className="flex items-start gap-2">
                    {record.level === "error" ? (
                      <CircleAlert className="mt-0.5 size-3 shrink-0 text-red-400" />
                    ) : (
                      <span
                        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                          record.level === "warning" ? "bg-amber-400" : "bg-emerald-400"
                        }`}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="break-words text-[10px] leading-4">
                        {record.message}
                      </p>
                      {record.details === null ? null : (
                        <p className="mt-1 break-words text-[9px] leading-3.5 text-muted-foreground">
                          {record.details}
                        </p>
                      )}
                      <p className="mt-1 text-[8px] text-muted-foreground">
                        {record.category} · {formatDate(record.createdAt)}
                      </p>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
      <div className="mt-auto border-t border-border p-4">
        <div className="rounded-lg bg-violet-500/8 p-3">
          <p className="flex items-center gap-2 text-[11px] font-medium text-violet-400">
            <span
              className={`size-2 rounded-full ${activeServer === null ? "bg-muted-foreground" : "bg-emerald-400"}`}
            />
            {activeServer?.name ?? "No server"}
          </p>
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {activeServer?.url ?? "Configure an Ollama connection"}
          </p>
        </div>
        <Badge className="mt-2">SQLite persistence active</Badge>
      </div>
    </aside>
  );
}
