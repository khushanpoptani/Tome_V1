import { EmptyState } from "@/components/common/page";
import { backend, isTauriRuntime } from "@/lib/backend";
import { formatDate } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { application } from "@tome/config";
import { useShellStore } from "@tome/stores";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@tome/ui";
import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  FolderOpen,
  Gauge,
  MessageSquareText,
  Plus,
  Server,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

export function DashboardPage(): React.JSX.Element {
  const activeServer = useShellStore((state) => state.activeServer);
  const diagnostics = useShellStore((state) => state.diagnostics);
  const navigate = useNavigate();
  const projects = useQuery({
    enabled: isTauriRuntime(),
    queryFn: () => backend.listProjects(),
    queryKey: ["projects"],
  });
  const conversations = useQuery({
    enabled: isTauriRuntime(),
    queryFn: () => backend.listConversations(),
    queryKey: ["conversations", ""],
  });
  const tasks = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listTasks,
    queryKey: ["tasks"],
    refetchInterval: 2_000,
  });
  const models = useQuery({
    enabled: isTauriRuntime() && activeServer !== null,
    queryFn: () => backend.listModels(activeServer?.url ?? ""),
    queryKey: ["models", activeServer?.url],
    refetchInterval: 30_000,
  });
  const runningTasks = (tasks.data ?? []).filter((task) => task.status === "running");
  const loading = [projects, conversations, tasks].some((query) => query.isLoading);
  const systemStatus = loading
    ? "Loading"
    : [projects, conversations, tasks].some((query) => query.isError)
      ? "Degraded"
      : "Ready";

  const overview = [
    {
      detail: activeServer?.url ?? "Configure an Ollama endpoint",
      icon: Server,
      label: "Connected Server",
      value:
        diagnostics?.apiAvailable === true
          ? (activeServer?.name ?? "Connected")
          : "Offline",
    },
    {
      detail: "Available on the active Ollama endpoint",
      icon: Bot,
      label: "Installed Models",
      value: String(models.data?.length ?? 0),
    },
    {
      detail: "Background operations in progress",
      icon: Activity,
      label: "Running Tasks",
      value: String(runningTasks.length),
    },
    {
      detail: `Tome ${application.version}`,
      icon: Gauge,
      label: "System Status",
      value: systemStatus,
    },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-7 lg:px-8">
      <motion.header
        animate={{ opacity: 1, y: 0 }}
        className="mb-7 flex items-end justify-between gap-6"
        initial={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.25 }}
      >
        <div>
          <Badge>
            <Gauge className="size-3" />
            Live workspace
          </Badge>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
            Welcome to Tome
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Server, model, project, conversation, and task status update from their
            persisted sources.
          </p>
        </div>
        <Button onClick={() => void navigate("/projects")}>
          <Plus className="size-4" />
          New project
        </Button>
      </motion.header>

      <section
        aria-label="Workspace overview"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {overview.map(({ detail, icon: Icon, label, value }, index) => (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 10 }}
            key={label}
            transition={{ delay: 0.04 * index, duration: 0.24 }}
          >
            <Card className="h-full bg-card/70">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[11px] font-medium text-muted-foreground">
                  {label}
                </CardTitle>
                <Icon className="size-4 text-violet-400" />
              </CardHeader>
              <CardContent>
                <p className="truncate text-lg font-semibold tracking-tight">{value}</p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">
                  {detail}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border">
            <CardTitle>Recent projects</CardTitle>
            <Button onClick={() => void navigate("/projects")} size="sm" variant="ghost">
              View all
            </Button>
          </CardHeader>
          {(projects.data?.length ?? 0) === 0 ? (
            <EmptyState
              action={
                <Button onClick={() => void navigate("/projects")} size="sm">
                  Add project
                </Button>
              }
              description="Open or create a local project to see it here."
              icon={FolderOpen}
              title="No recent projects"
            />
          ) : (
            <div className="divide-y divide-border">
              {projects.data?.slice(0, 5).map((project) => (
                <button
                  className="block w-full px-5 py-3 text-left hover:bg-accent/50"
                  key={project.id}
                  onClick={() => void navigate("/projects")}
                  type="button"
                >
                  <span className="block text-xs font-medium">{project.name}</span>
                  <span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
                    {project.path}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border">
            <CardTitle>Recent chats</CardTitle>
            <Button onClick={() => void navigate("/history")} size="sm" variant="ghost">
              View all
            </Button>
          </CardHeader>
          {(conversations.data?.length ?? 0) === 0 ? (
            <EmptyState
              action={
                <Button onClick={() => void navigate("/chat")} size="sm">
                  Start chat
                </Button>
              }
              description="Stored conversations will appear here."
              icon={MessageSquareText}
              title="No recent chats"
            />
          ) : (
            <div className="divide-y divide-border">
              {conversations.data?.slice(0, 5).map((conversation) => (
                <button
                  className="block w-full px-5 py-3 text-left hover:bg-accent/50"
                  key={conversation.id}
                  onClick={() => void navigate("/history")}
                  type="button"
                >
                  <span className="block text-xs font-medium">{conversation.title}</span>
                  <span className="mt-1 block text-[9px] text-muted-foreground">
                    {conversation.messageCount} messages ·{" "}
                    {formatDate(conversation.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
