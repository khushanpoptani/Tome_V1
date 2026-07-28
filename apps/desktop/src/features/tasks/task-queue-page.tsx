import { EmptyState, Modal, PageHeader } from "@/components/common/page";
import { backend, isTauriRuntime } from "@/lib/backend";
import { errorMessage, formatDate } from "@/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskRecord, TaskStatus } from "@tome/types";
import { Badge, Button, Card } from "@tome/ui";
import { Ban, CheckCircle2, CircleDashed, ListTodo, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const statusTone: Readonly<Record<TaskStatus, string>> = {
  "awaiting-approval": "text-amber-400",
  cancelled: "text-muted-foreground",
  completed: "text-emerald-400",
  failed: "text-red-400",
  pending: "text-sky-400",
  running: "text-violet-400",
  verifying: "text-cyan-400",
};

function statusIcon(status: TaskStatus): React.JSX.Element {
  if (status === "completed") return <CheckCircle2 className="size-4" />;
  if (status === "failed") return <XCircle className="size-4" />;
  if (status === "cancelled") return <Ban className="size-4" />;
  return (
    <CircleDashed className={status === "running" ? "size-4 animate-spin" : "size-4"} />
  );
}

export function TaskQueuePage(): React.JSX.Element {
  const [selected, setSelected] = useState<TaskRecord | null>(null);
  const queryClient = useQueryClient();
  const tasks = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listTasks,
    queryKey: ["tasks"],
    refetchInterval: 1_000,
  });
  const clear = useMutation({
    mutationFn: backend.clearFinishedTasks,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Finished tasks cleared.");
    },
  });

  return (
    <div className="min-h-full">
      <PageHeader
        actions={
          <Button
            disabled={
              !tasks.data?.some((task) =>
                ["completed", "failed", "cancelled"].includes(task.status),
              )
            }
            onClick={() => clear.mutate()}
            size="sm"
            variant="outline"
          >
            <Trash2 className="size-3.5" />
            Clear finished
          </Button>
        }
        description="Track dataset preparation, uploads, model downloads, inference checks, and other background work."
        icon={ListTodo}
        title="Task Queue"
      />
      <div className="p-6 lg:p-8">
        {(tasks.data?.length ?? 0) === 0 ? (
          <Card>
            <EmptyState
              description="Model downloads and verification jobs will appear here with live progress and logs."
              icon={ListTodo}
              title="No tasks"
            />
          </Card>
        ) : (
          <div className="grid gap-3">
            {tasks.data?.map((task) => (
              <Card className="p-4" key={task.id}>
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 ${statusTone[task.status]}`}>
                    {statusIcon(task.status)}
                  </span>
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelected(task)}
                    type="button"
                  >
                    <span className="flex items-center gap-2 text-xs font-medium">
                      {task.title}
                      <Badge>{task.status}</Badge>
                    </span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {task.kind} · Started {formatDate(task.startedAt)}
                      {task.endedAt === null
                        ? ""
                        : ` · Ended ${formatDate(task.endedAt)}`}
                    </span>
                    <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-secondary">
                      <span
                        className="block h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${task.progress}%` }}
                      />
                    </span>
                    <span className="mt-1 block text-right text-[9px] text-muted-foreground">
                      {Math.round(task.progress)}%
                    </span>
                  </button>
                  {task.status === "running" &&
                  task.kind !== "dataset-preparation" &&
                  task.kind !== "dataset-delete" ? (
                    <Button
                      onClick={() => {
                        void backend
                          .cancelOperation(task.id)
                          .then((cancelled) => {
                            toast[cancelled ? "success" : "error"](
                              cancelled
                                ? "Cancellation requested."
                                : "The task is no longer running.",
                            );
                          })
                          .catch((error: unknown) => toast.error(errorMessage(error)));
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      {selected === null ? null : (
        <Modal onClose={() => setSelected(null)} title={`${selected.title} logs`}>
          <div className="p-5">
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-4 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {selected.logs.length > 0 ? selected.logs : "No task log entries."}
            </pre>
          </div>
        </Modal>
      )}
    </div>
  );
}
