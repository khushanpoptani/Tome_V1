import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@tome/ui";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Bot,
  FolderOpen,
  MessageSquareText,
  Plus,
  Server,
  Sparkles,
} from "lucide-react";

const overview = [
  {
    detail: "No projects opened yet",
    icon: FolderOpen,
    label: "Recent Projects",
    tone: "text-sky-300",
    value: "0",
  },
  {
    detail: "Execution engine is idle",
    icon: Activity,
    label: "Running Tasks",
    tone: "text-emerald-300",
    value: "0",
  },
  {
    detail: "Configure an Ollama endpoint",
    icon: Server,
    label: "Connected Server",
    tone: "text-amber-300",
    value: "Offline",
  },
  {
    detail: "All local services available",
    icon: Bot,
    label: "System Health",
    tone: "text-violet-300",
    value: "Ready",
  },
] as const;

const quickStarts = [
  {
    description: "Open a local repository and prepare it for AI-assisted work.",
    icon: FolderOpen,
    title: "Open a workspace",
  },
  {
    description: "Connect Tome to an Ollama server over your trusted network.",
    icon: Server,
    title: "Connect Ollama",
  },
  {
    description: "Start a focused engineering conversation with project context.",
    icon: MessageSquareText,
    title: "Start a chat",
  },
] as const;

export function DashboardPage(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-7 lg:px-8">
      <motion.header
        animate={{ opacity: 1, y: 0 }}
        className="mb-7 flex items-end justify-between gap-6"
        initial={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.25 }}
      >
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge className="border-violet-400/15 bg-violet-400/8 text-violet-200">
              <Sparkles className="size-3" />
              Foundation ready
            </Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.025em]">Welcome to Tome</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Your AI software engineering workspace is ready. Connect an Ollama server and
            open a project when you are ready to begin.
          </p>
        </div>
        <Button disabled title="Workspace management is planned for Phase 3">
          <Plus className="size-4" />
          New project
        </Button>
      </motion.header>

      <section
        aria-label="Workspace overview"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {overview.map(({ detail, icon: Icon, label, tone, value }, index) => (
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
                <Icon className={`size-4 ${tone}`} />
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold tracking-tight">{value}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)]">
        <Card className="overflow-hidden bg-card/70">
          <CardHeader className="border-b border-border/70">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Start with Tome</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Three steps to prepare your engineering workspace.
                </p>
              </div>
              <Badge>Getting started</Badge>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-border/70 p-0">
            {quickStarts.map(({ description, icon: Icon, title }, index) => (
              <button
                className="group flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-80"
                disabled
                key={title}
                title="This workflow will be enabled in a later phase"
                type="button"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary/70 text-muted-foreground group-hover:text-violet-200">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <span className="text-muted-foreground/60">0{index + 1}</span>
                    {title}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                    {description}
                  </span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground/50" />
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="flex min-h-72 flex-col bg-card/70">
          <CardHeader className="border-b border-border/70">
            <div className="flex items-center justify-between">
              <CardTitle>Recent activity</CardTitle>
              <span className="text-[10px] text-muted-foreground">Today</span>
            </div>
          </CardHeader>
          <CardContent className="grid flex-1 place-items-center text-center">
            <div className="max-w-52">
              <span className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-secondary/60">
                <Activity className="size-5 text-muted-foreground" />
              </span>
              <p className="mt-3 text-xs font-medium">A quiet workspace</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Project activity, chats, plans, and verification results will collect
                here.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
