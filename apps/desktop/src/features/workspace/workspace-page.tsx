import { EmptyState, inputClassName, Modal, PageHeader } from "@/components/common/page";
import { PathPickerInput } from "@/components/common/path-picker-input";
import { backend, isTauriRuntime } from "@/lib/backend";
import { errorMessage, formatDate } from "@/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellStore } from "@tome/stores";
import type { WorkspaceRecord } from "@tome/types";
import { Badge, Button, Card } from "@tome/ui";
import { FolderOpen, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface WorkspaceForm {
  readonly createDirectory: boolean;
  readonly id?: string;
  readonly name: string;
  readonly path: string;
}

const emptyForm: WorkspaceForm = {
  createDirectory: false,
  name: "",
  path: "",
};

export function WorkspacePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const activeWorkspace = useShellStore((state) => state.activeWorkspace);
  const setActiveWorkspace = useShellStore((state) => state.setActiveWorkspace);
  const [form, setForm] = useState<WorkspaceForm | null>(null);
  const workspaces = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listWorkspaces,
    queryKey: ["workspaces"],
  });
  const save = useMutation({
    mutationFn: backend.saveWorkspace,
    onError: (error) => {
      toast.error(errorMessage(error));
    },
    onSuccess: (workspace) => {
      setActiveWorkspace(workspace);
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Workspace saved.");
    },
  });
  const remove = useMutation({
    mutationFn: backend.deleteWorkspace,
    onError: (error) => {
      toast.error(errorMessage(error));
    },
    onSuccess: (_, id) => {
      if (activeWorkspace?.id === id) {
        setActiveWorkspace(null);
      }
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Workspace removed from Tome. Files were not deleted.");
    },
  });

  const openForm = (workspace?: WorkspaceRecord, createDirectory = false): void => {
    setForm(
      workspace === undefined
        ? { ...emptyForm, createDirectory }
        : {
            createDirectory: false,
            id: workspace.id,
            name: workspace.name,
            path: workspace.path,
          },
    );
  };

  return (
    <div className="min-h-full">
      <PageHeader
        actions={
          <div className="flex gap-2">
            <Button onClick={() => openForm()} size="sm" variant="outline">
              <FolderOpen className="size-3.5" />
              Open
            </Button>
            <Button onClick={() => openForm(undefined, true)} size="sm">
              <Plus className="size-3.5" />
              Create
            </Button>
          </div>
        }
        description="Create, open, rename, and revisit local workspaces."
        icon={FolderOpen}
        title="Workspace"
      />
      <div className="p-6 lg:p-8">
        {workspaces.isError ? (
          <p className="rounded-lg border border-red-500/20 bg-red-500/8 p-4 text-xs text-red-400">
            {errorMessage(workspaces.error)}
          </p>
        ) : null}
        {(workspaces.data?.length ?? 0) === 0 ? (
          <Card>
            <EmptyState
              action={
                <Button onClick={() => openForm()} size="sm">
                  Open a workspace
                </Button>
              }
              description="Add an existing directory or create a new one. Tome stores only its path and metadata."
              icon={FolderPlus}
              title="No workspaces yet"
            />
          </Card>
        ) : (
          <div className="grid gap-3">
            {workspaces.data?.map((workspace) => (
              <Card className="flex items-center gap-4 p-4" key={workspace.id}>
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary">
                  <FolderOpen className="size-4 text-violet-400" />
                </span>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setActiveWorkspace(workspace);
                    toast.success(`Opened ${workspace.name}`);
                  }}
                  type="button"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {workspace.name}
                    {activeWorkspace?.id === workspace.id ? (
                      <Badge className="text-[9px]">Current</Badge>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                    {workspace.path}
                  </span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    Last opened {formatDate(workspace.lastOpenedAt)}
                  </span>
                </button>
                <Button
                  aria-label={`Rename ${workspace.name}`}
                  onClick={() => openForm(workspace)}
                  size="icon"
                  variant="ghost"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Delete ${workspace.name}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove "${workspace.name}" from Tome? Its files will remain on disk.`,
                      )
                    ) {
                      remove.mutate(workspace.id);
                    }
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>

      {form === null ? null : (
        <Modal
          onClose={() => {
            setForm(null);
          }}
          title={
            form.id === undefined
              ? form.createDirectory
                ? "Create workspace"
                : "Open workspace"
              : "Rename workspace"
          }
        >
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(form);
            }}
          >
            <label className="block space-y-1.5 text-xs">
              <span>Name</span>
              <input
                autoFocus
                className={inputClassName}
                onChange={(event) => {
                  setForm({ ...form, name: event.target.value });
                }}
                required
                value={form.name}
              />
            </label>
            <div className="block space-y-1.5 text-xs">
              <span>Directory path</span>
              <PathPickerInput
                ariaLabel="Workspace directory path"
                disabled={form.id !== undefined}
                kind="directory"
                onChange={(path) => {
                  const name =
                    form.name.trim() === ""
                      ? (path.split(/[\\/]/).filter(Boolean).at(-1) ?? form.name)
                      : form.name;
                  setForm({ ...form, name, path });
                }}
                placeholder="/Users/you/Projects/my-workspace"
                required
                value={form.path}
              />
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {form.createDirectory
                ? "Tome will create the directory if it does not exist."
                : "Enter the absolute path to an existing directory."}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  setForm(null);
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={save.isPending} type="submit">
                {save.isPending ? "Saving…" : "Save workspace"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
