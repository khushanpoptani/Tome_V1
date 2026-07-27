import { EmptyState, inputClassName, Modal, PageHeader } from "@/components/common/page";
import { backend, isTauriRuntime } from "@/lib/backend";
import { errorMessage, formatDate } from "@/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellStore } from "@tome/stores";
import type { FileTreeNode, ProjectRecord } from "@tome/types";
import { Badge, Button, Card } from "@tome/ui";
import {
  ChevronDown,
  File,
  Folder,
  FolderGit2,
  FolderKanban,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface ProjectForm {
  readonly createDirectory: boolean;
  readonly id?: string;
  readonly name: string;
  readonly path: string;
  readonly workspaceId?: string | null;
}

function Tree({
  nodes,
  level = 0,
}: {
  readonly nodes: readonly FileTreeNode[];
  readonly level?: number;
}): React.JSX.Element {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.path}>
          <div
            className="flex h-7 items-center gap-2 truncate rounded px-2 text-[11px] hover:bg-accent/60"
            style={{ paddingLeft: `${8 + level * 14}px` }}
          >
            {node.isDirectory ? (
              <Folder className="size-3.5 shrink-0 text-amber-400" />
            ) : (
              <File className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          {node.children.length > 0 ? (
            <Tree level={level + 1} nodes={node.children} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ProjectsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const activeProject = useShellStore((state) => state.activeProject);
  const activeWorkspace = useShellStore((state) => state.activeWorkspace);
  const setActiveProject = useShellStore((state) => state.setActiveProject);
  const [form, setForm] = useState<ProjectForm | null>(null);
  const projects = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listProjects,
    queryKey: ["projects"],
  });
  const tree = useQuery({
    enabled: isTauriRuntime() && activeProject !== null,
    queryFn: () => backend.readFileTree(activeProject?.path ?? ""),
    queryKey: ["file-tree", activeProject?.path],
  });
  const save = useMutation({
    mutationFn: backend.saveProject,
    onError: (error) => {
      toast.error(errorMessage(error));
    },
    onSuccess: (project) => {
      setActiveProject(project);
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project saved.");
    },
  });
  const remove = useMutation({
    mutationFn: backend.deleteProject,
    onError: (error) => {
      toast.error(errorMessage(error));
    },
    onSuccess: (_, id) => {
      if (activeProject?.id === id) {
        setActiveProject(null);
      }
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project removed from Tome. Files were not deleted.");
    },
  });
  const openForm = (project?: ProjectRecord, createDirectory = false): void => {
    setForm(
      project === undefined
        ? {
            createDirectory,
            name: "",
            path: "",
            workspaceId: activeWorkspace?.id ?? null,
          }
        : {
            createDirectory: false,
            id: project.id,
            name: project.name,
            path: project.path,
            workspaceId: project.workspaceId,
          },
    );
  };

  return (
    <div className="min-h-full">
      <PageHeader
        actions={
          <div className="flex gap-2">
            <Button onClick={() => openForm()} size="sm" variant="outline">
              <FolderGit2 className="size-3.5" />
              Open
            </Button>
            <Button onClick={() => openForm(undefined, true)} size="sm">
              <Plus className="size-3.5" />
              Create
            </Button>
          </div>
        }
        description="Manage local projects and inspect their file trees."
        icon={FolderKanban}
        title="Projects"
      />
      <div className="grid min-h-[520px] gap-5 p-6 lg:grid-cols-[minmax(280px,0.75fr)_minmax(360px,1.25fr)] lg:p-8">
        <Card className="overflow-hidden">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-xs font-semibold">Projects</h2>
          </header>
          {(projects.data?.length ?? 0) === 0 ? (
            <EmptyState
              description="Open an existing directory or create a project directory."
              icon={FolderKanban}
              title="No projects"
            />
          ) : (
            <div className="divide-y divide-border">
              {projects.data?.map((project) => (
                <div className="flex items-center gap-2 p-3" key={project.id}>
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setActiveProject(project);
                    }}
                    type="button"
                  >
                    <span className="flex items-center gap-2 text-xs font-medium">
                      {project.name}
                      {activeProject?.id === project.id ? <Badge>Current</Badge> : null}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
                      {project.path}
                    </span>
                    <span className="mt-1 block text-[9px] text-muted-foreground">
                      {formatDate(project.lastOpenedAt)}
                    </span>
                  </button>
                  <Button
                    aria-label={`Rename ${project.name}`}
                    onClick={() => openForm(project)}
                    size="icon"
                    variant="ghost"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    aria-label={`Delete ${project.name}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove "${project.name}" from Tome? Files will remain on disk.`,
                        )
                      ) {
                        remove.mutate(project.id);
                      }
                    }}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-xs font-semibold">
                {activeProject?.name ?? "File tree"}
              </h2>
              <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                {activeProject?.path ?? "Select a project"}
              </p>
            </div>
            <Badge className="shrink-0">
              <ChevronDown className="size-3" />
              Git status pending integration
            </Badge>
          </header>
          {activeProject === null ? (
            <EmptyState
              description="Choose a project to browse its current directory structure."
              icon={FolderGit2}
              title="No project selected"
            />
          ) : tree.isError ? (
            <p className="m-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-400">
              {errorMessage(tree.error)}
            </p>
          ) : (
            <div className="max-h-[620px] overflow-auto p-2">
              <Tree nodes={tree.data ?? []} />
            </div>
          )}
        </Card>
      </div>

      {form === null ? null : (
        <Modal
          onClose={() => {
            setForm(null);
          }}
          title={
            form.id === undefined
              ? form.createDirectory
                ? "Create project"
                : "Open project"
              : "Rename project"
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
            <label className="block space-y-1.5 text-xs">
              <span>Directory path</span>
              <input
                className={inputClassName}
                disabled={form.id !== undefined}
                onChange={(event) => {
                  setForm({ ...form, path: event.target.value });
                }}
                placeholder="/Users/you/Projects/my-project"
                required
                value={form.path}
              />
            </label>
            <p className="text-[10px] text-muted-foreground">
              {form.createDirectory
                ? "Tome will create the directory if it does not exist."
                : "Enter the absolute path to an existing project directory."}
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setForm(null)} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={save.isPending} type="submit">
                {save.isPending ? "Saving…" : "Save project"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
