import { backend, isTauriRuntime } from "@/lib/backend";
import { useQuery } from "@tanstack/react-query";
import { useShellStore } from "@tome/stores";
import { Badge, Button, Separator } from "@tome/ui";
import { Bot, CheckCircle2, FolderGit2, ListChecks, ScrollText, X } from "lucide-react";

export function ContextPanel(): React.JSX.Element {
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
    queryFn: () => backend.listLogs(20),
    queryKey: ["logs", "context"],
    refetchInterval: 3_000,
  });
  const running = (tasks.data ?? []).filter((task) => task.status === "running");
  const failed = (tasks.data ?? []).filter((task) => task.status === "failed");

  const sections = [
    { icon: Bot, label: "Chat model", value: selectedModel ?? "None selected" },
    { icon: FolderGit2, label: "Current project", value: activeProject?.name ?? "None" },
    { icon: ListChecks, label: "Running tasks", value: String(running.length) },
    { icon: ScrollText, label: "Recent logs", value: String(logs.data?.length ?? 0) },
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
                      {Math.round(task.progress)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-[width]"
                      style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }}
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
