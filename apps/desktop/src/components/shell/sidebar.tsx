import { inputClassName, Modal } from "@/components/common/page";
import { backend, isTauriRuntime } from "@/lib/backend";
import { errorMessage } from "@/lib/format";
import { navigationItems } from "@tome/config";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellStore } from "@tome/stores";
import type { ConversationRecord, ProjectRecord } from "@tome/types";
import { Button, cn } from "@tome/ui";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  Bot,
  ChevronRight,
  Copy,
  FolderCode,
  FolderKanban,
  FolderOpen,
  Gauge,
  GraduationCap,
  History,
  ListTodo,
  MessageSquarePlus,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { toast } from "sonner";

const icons: Record<(typeof navigationItems)[number]["id"], LucideIcon> = {
  dashboard: Gauge,
  chat: MessageSquareText,
  workspace: FolderCode,
  projects: FolderKanban,
  history: History,
  "task-queue": ListTodo,
  training: GraduationCap,
  settings: Settings,
};

interface SidebarProps {
  readonly collapsed: boolean;
}

type MenuTarget =
  | { readonly kind: "chat"; readonly record: ConversationRecord }
  | { readonly kind: "project"; readonly record: ProjectRecord };

type EditorState =
  | {
      readonly kind: "project";
      readonly id?: string;
      readonly name: string;
      readonly path: string;
    }
  | {
      readonly kind: "chat";
      readonly id?: string;
      readonly model?: string | null;
      readonly projectId: string | null;
      readonly title: string;
    }
  | {
      readonly chatId: string;
      readonly kind: "move";
      readonly projectId: string | null;
      readonly title: string;
    };

function TreeButton({
  active,
  icon: Icon,
  label,
  onClick,
  onContextMenu,
}: {
  readonly active?: boolean;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onClick: () => void;
  readonly onContextMenu: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  return (
    <button
      className={cn(
        "group flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-muted-foreground transition hover:bg-accent/70 hover:text-foreground",
        active && "bg-violet-500/12 text-foreground",
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
      type="button"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <MoreHorizontal className="size-3 opacity-0 group-hover:opacity-70" />
    </button>
  );
}

export function Sidebar({ collapsed }: SidebarProps): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sidebarWidth = useShellStore((state) => state.sidebarWidth);
  const setSidebarCollapsed = useShellStore((state) => state.setSidebarCollapsed);
  const setSidebarWidth = useShellStore((state) => state.setSidebarWidth);
  const contextPanelOpen = useShellStore((state) => state.contextPanelOpen);
  const setContextPanelOpen = useShellStore((state) => state.setContextPanelOpen);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const activeProject = useShellStore((state) => state.activeProject);
  const activeConversation = useShellStore((state) => state.activeConversation);
  const setActiveProject = useShellStore((state) => state.setActiveProject);
  const setActiveConversation = useShellStore((state) => state.setActiveConversation);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [modelsExpanded, setModelsExpanded] = useState(true);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{
    readonly target: MenuTarget;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const projects = useQuery({
    enabled: isTauriRuntime(),
    queryFn: () => backend.listProjects(),
    queryKey: ["projects"],
  });
  const conversations = useQuery({
    enabled: isTauriRuntime(),
    queryFn: () => backend.listConversations(search),
    queryKey: ["conversations", search],
  });

  useEffect(() => {
    if (activeProject !== null) {
      setExpanded((current) => new Set(current).add(activeProject.id));
    }
  }, [activeProject]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    const closeMenu = (): void => setMenu(null);
    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [toggleSidebar]);

  const refreshTree = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const save = useMutation({
    mutationFn: async (value: Exclude<EditorState, { readonly kind: "move" }>) => {
      if (value.kind === "project") {
        return backend.saveProject({
          createDirectory: value.id === undefined,
          ...(value.id === undefined ? {} : { id: value.id }),
          name: value.name,
          path: value.path,
        });
      }
      return backend.saveConversation({
        ...(value.id === undefined ? {} : { id: value.id }),
        ...(value.model === undefined ? {} : { model: value.model }),
        projectId: value.projectId,
        title: value.title,
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (record, value) => {
      setEditor(null);
      refreshTree();
      if (value.kind === "project" && "path" in record) {
        setActiveProject(record);
      } else if (value.kind === "chat" && "messageCount" in record) {
        setActiveConversation(record);
        const project = projects.data?.find((item) => item.id === record.projectId);
        if (project !== undefined) setActiveProject(project);
        void navigate("/chat");
      }
      toast.success(value.id === undefined ? "Created." : "Renamed.");
    },
  });

  const move = useMutation({
    mutationFn: ({ chatId, projectId }: { chatId: string; projectId: string | null }) =>
      backend.moveConversation(chatId, projectId),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (conversation) => {
      setEditor(null);
      refreshTree();
      if (activeConversation?.id === conversation.id) {
        setActiveConversation(conversation);
      }
      toast.success("Chat moved.");
    },
  });

  const projectAction = useMutation({
    mutationFn: async ({
      action,
      project,
    }: {
      readonly action: "archive" | "delete" | "duplicate";
      readonly project: ProjectRecord;
    }) => {
      if (action === "archive") return backend.archiveProject(project.id, true);
      if (action === "duplicate") return backend.duplicateProject(project.id);
      await backend.deleteProject(project.id);
      return null;
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (record, value) => {
      if (activeProject?.id === value.project.id && value.action !== "duplicate") {
        setActiveProject(null);
        setActiveConversation(null);
      }
      if (record !== null && value.action === "duplicate") setActiveProject(record);
      refreshTree();
      toast.success(`Project ${value.action}d.`);
    },
  });

  const chatAction = useMutation({
    mutationFn: async ({
      action,
      chat,
    }: {
      readonly action: "delete" | "duplicate";
      readonly chat: ConversationRecord;
    }) => {
      if (action === "duplicate")
        return backend.duplicateConversation(chat.id, chat.projectId);
      await backend.deleteConversation(chat.id);
      return null;
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (record, value) => {
      if (activeConversation?.id === value.chat.id && value.action === "delete") {
        setActiveConversation(null);
      }
      if (record !== null) {
        setActiveConversation(record);
        void navigate("/chat");
      }
      refreshTree();
      toast.success(`Chat ${value.action}d.`);
    },
  });

  const conversationsByProject = useMemo(() => {
    const grouped = new Map<string | null, ConversationRecord[]>();
    for (const conversation of conversations.data ?? []) {
      const values = grouped.get(conversation.projectId) ?? [];
      values.push(conversation);
      grouped.set(conversation.projectId, values);
    }
    return grouped;
  }, [conversations.data]);

  const handleResizeStart = (event: React.PointerEvent): void => {
    if (collapsed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const handleMove = (moveEvent: PointerEvent): void => {
      setSidebarWidth(startWidth + moveEvent.clientX - startX);
    };
    const handleUp = (): void => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const handleNavigationKeys = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const links = Array.from(
      navigationRef.current?.querySelectorAll<HTMLElement>("a, button") ?? [],
    ).filter((element) => !element.hasAttribute("disabled"));
    if (links.length === 0) return;
    event.preventDefault();
    const current = links.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? links.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + links.length) % links.length
            : (current - 1 + links.length) % links.length;
    links[next]?.focus();
  };

  const openMenu = (event: React.MouseEvent, target: MenuTarget): void => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      target,
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 230),
    });
  };

  const chooseProject = (project: ProjectRecord): void => {
    setActiveProject(project);
    setExpanded((current) => new Set(current).add(project.id));
    void navigate("/projects");
  };

  const chooseChat = (chat: ConversationRecord): void => {
    const project = projects.data?.find((item) => item.id === chat.projectId);
    if (project !== undefined) setActiveProject(project);
    setActiveConversation(chat);
    void navigate("/chat");
  };
  const menuProject = menu?.target.kind === "project" ? menu.target.record : null;
  const menuChat = menu?.target.kind === "chat" ? menu.target.record : null;

  return (
    <>
      <motion.aside
        animate={{ width: collapsed ? 60 : sidebarWidth }}
        className="relative flex shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar"
        initial={false}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <div
          className={cn(
            "flex h-11 shrink-0 items-center border-b border-border px-2",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          {collapsed ? null : (
            <span className="px-2 text-xs font-semibold tracking-tight">Tome</span>
          )}
          <span className="flex">
            <button
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSidebarCollapsed(!collapsed)}
              title={`${collapsed ? "Expand" : "Collapse"} sidebar (⌘B)`}
              type="button"
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </button>
            {collapsed || contextPanelOpen ? null : (
              <button
                aria-label="Open context panel"
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                onClick={() => setContextPanelOpen(true)}
                title="Open context panel"
                type="button"
              >
                <PanelRightOpen className="size-4" />
              </button>
            )}
          </span>
        </div>
        <nav
          aria-label="Primary navigation"
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
          onKeyDown={handleNavigationKeys}
          ref={navigationRef}
        >
          <div className="mb-1 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
            {collapsed ? "•" : "Workspace"}
          </div>
          {navigationItems
            .filter((item) => !["projects", "history"].includes(item.id))
            .map((item) => {
              const Icon = icons[item.id];
              return (
                <NavLink
                  className={({ isActive }) =>
                    cn(
                      "group relative flex h-9 items-center gap-3 rounded-md px-3 text-xs font-medium text-muted-foreground outline-none transition hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "bg-accent text-foreground",
                      collapsed && "justify-center px-0",
                    )
                  }
                  end={item.path === "/"}
                  key={item.id}
                  title={collapsed ? item.label : undefined}
                  to={item.path}
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <motion.span
                          className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary"
                          layoutId="active-navigation"
                        />
                      ) : null}
                      <Icon className="size-4 shrink-0" />
                      {collapsed ? null : <span className="truncate">{item.label}</span>}
                    </>
                  )}
                </NavLink>
              );
            })}

          {collapsed ? (
            <>
              <NavLink
                className={({ isActive }) =>
                  cn(
                    "flex h-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
                    isActive && "bg-accent text-foreground",
                  )
                }
                title="Projects"
                to="/projects"
              >
                <FolderKanban className="size-4" />
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  cn(
                    "flex h-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
                    isActive && "bg-accent text-foreground",
                  )
                }
                title="Training"
                to="/training"
              >
                <GraduationCap className="size-4" />
              </NavLink>
            </>
          ) : (
            <>
              <div className="mt-1 flex h-8 items-center gap-1">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:bg-accent/60"
                  onClick={() => setProjectsExpanded((value) => !value)}
                  type="button"
                >
                  <motion.span animate={{ rotate: projectsExpanded ? 90 : 0 }}>
                    <ChevronRight className="size-3" />
                  </motion.span>
                  Projects
                </button>
                <button
                  aria-label="Create project"
                  className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setEditor({ kind: "project", name: "", path: "" })}
                  title="Create project"
                  type="button"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <AnimatePresence initial={false}>
                {projectsExpanded ? (
                  <motion.div
                    animate={{ height: "auto", opacity: 1 }}
                    className="overflow-hidden"
                    exit={{ height: 0, opacity: 0 }}
                    initial={{ height: 0, opacity: 0 }}
                  >
                    <label className="relative mb-2 block">
                      <Search className="absolute left-2 top-2 size-3 text-muted-foreground" />
                      <input
                        aria-label="Search project chats"
                        className="h-7 w-full rounded border border-border bg-background pl-7 pr-2 text-[10px] outline-none focus:ring-1 focus:ring-ring"
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search chats"
                        value={search}
                      />
                    </label>
                    <div className="space-y-0.5">
                      {projects.data?.map((project) => {
                        const open = expanded.has(project.id) || search.length > 0;
                        const projectChats = conversationsByProject.get(project.id) ?? [];
                        return (
                          <div key={project.id}>
                            <div className="flex items-center">
                              <button
                                aria-label={`${open ? "Collapse" : "Expand"} ${project.name}`}
                                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"
                                onClick={() =>
                                  setExpanded((current) => {
                                    const next = new Set(current);
                                    if (next.has(project.id)) next.delete(project.id);
                                    else next.add(project.id);
                                    return next;
                                  })
                                }
                                type="button"
                              >
                                <motion.span animate={{ rotate: open ? 90 : 0 }}>
                                  <ChevronRight className="size-3" />
                                </motion.span>
                              </button>
                              <div className="min-w-0 flex-1">
                                <TreeButton
                                  active={activeProject?.id === project.id}
                                  icon={open ? FolderOpen : FolderKanban}
                                  label={project.name}
                                  onClick={() => chooseProject(project)}
                                  onContextMenu={(event) =>
                                    openMenu(event, { kind: "project", record: project })
                                  }
                                />
                              </div>
                            </div>
                            <AnimatePresence initial={false}>
                              {open ? (
                                <motion.div
                                  animate={{ height: "auto", opacity: 1 }}
                                  className="ml-6 overflow-hidden border-l border-border pl-1"
                                  exit={{ height: 0, opacity: 0 }}
                                  initial={{ height: 0, opacity: 0 }}
                                >
                                  {projectChats.length === 0 ? (
                                    <button
                                      className="h-7 w-full rounded px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent/50"
                                      onClick={() =>
                                        setEditor({
                                          kind: "chat",
                                          projectId: project.id,
                                          title: "New Chat",
                                        })
                                      }
                                      type="button"
                                    >
                                      + New chat
                                    </button>
                                  ) : (
                                    projectChats.map((chat) => (
                                      <TreeButton
                                        active={activeConversation?.id === chat.id}
                                        icon={MessageSquareText}
                                        key={chat.id}
                                        label={chat.title}
                                        onClick={() => chooseChat(chat)}
                                        onContextMenu={(event) =>
                                          openMenu(event, {
                                            kind: "chat",
                                            record: chat,
                                          })
                                        }
                                      />
                                    ))
                                  )}
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                      {(conversationsByProject.get(null)?.length ?? 0) > 0 ? (
                        <div>
                          <p className="px-2 py-1 text-[9px] uppercase tracking-wide text-muted-foreground/60">
                            Unassigned
                          </p>
                          {conversationsByProject.get(null)?.map((chat) => (
                            <TreeButton
                              active={activeConversation?.id === chat.id}
                              icon={MessageSquareText}
                              key={chat.id}
                              label={chat.title}
                              onClick={() => chooseChat(chat)}
                              onContextMenu={(event) =>
                                openMenu(event, { kind: "chat", record: chat })
                              }
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <div className="mt-2">
                <button
                  className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:bg-accent/60"
                  onClick={() => setModelsExpanded((value) => !value)}
                  type="button"
                >
                  <motion.span animate={{ rotate: modelsExpanded ? 90 : 0 }}>
                    <ChevronRight className="size-3" />
                  </motion.span>
                  Models
                </button>
                <AnimatePresence initial={false}>
                  {modelsExpanded ? (
                    <motion.div
                      animate={{ height: "auto", opacity: 1 }}
                      className="ml-3 overflow-hidden border-l border-border pl-2"
                      exit={{ height: 0, opacity: 0 }}
                      initial={{ height: 0, opacity: 0 }}
                    >
                      <NavLink
                        className={({ isActive }) =>
                          cn(
                            "flex h-7 items-center gap-2 rounded px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground",
                            isActive && "bg-accent text-foreground",
                          )
                        }
                        to="/settings?section=models"
                      >
                        <Bot className="size-3.5" />
                        Inference Models
                      </NavLink>
                      <NavLink
                        className={({ isActive }) =>
                          cn(
                            "flex h-7 items-center gap-2 rounded px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground",
                            isActive && "bg-accent text-foreground",
                          )
                        }
                        to="/training"
                      >
                        <GraduationCap className="size-3.5" />
                        Training
                      </NavLink>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </>
          )}
        </nav>

        <div className="border-t border-border p-2">
          <div
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2",
              collapsed && "justify-center px-0",
            )}
          >
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold">
              T
              <span className="absolute bottom-0 right-0 size-2 rounded-full border-2 border-sidebar bg-emerald-400" />
            </span>
            {collapsed ? null : (
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">
                  Local workspace
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  Ready
                </span>
              </span>
            )}
          </div>
        </div>
        {collapsed ? null : (
          <div
            aria-label="Resize sidebar"
            className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary/40"
            onDoubleClick={() => setSidebarWidth(224)}
            onPointerDown={handleResizeStart}
            role="separator"
          />
        )}
      </motion.aside>

      {menu === null ? null : (
        <div
          className="fixed z-50 w-44 rounded-lg border border-border bg-card p-1 shadow-2xl"
          onPointerDown={(event) => event.stopPropagation()}
          style={{ left: menu.x, top: menu.y }}
        >
          {menuProject !== null ? (
            <>
              <MenuItem
                icon={MessageSquarePlus}
                label="New Chat"
                onClick={() => {
                  setEditor({
                    kind: "chat",
                    projectId: menuProject.id,
                    title: "New Chat",
                  });
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={Pencil}
                label="Rename"
                onClick={() => {
                  setEditor({
                    id: menuProject.id,
                    kind: "project",
                    name: menuProject.name,
                    path: menuProject.path,
                  });
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={Copy}
                label="Duplicate"
                onClick={() => {
                  projectAction.mutate({
                    action: "duplicate",
                    project: menuProject,
                  });
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={Archive}
                label="Archive"
                onClick={() => {
                  projectAction.mutate({
                    action: "archive",
                    project: menuProject,
                  });
                  setMenu(null);
                }}
              />
              <MenuItem
                destructive
                icon={Trash2}
                label="Delete"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete "${menuProject.name}" from Tome and delete its stored chats? Project files remain on disk.`,
                    )
                  ) {
                    projectAction.mutate({
                      action: "delete",
                      project: menuProject,
                    });
                  }
                  setMenu(null);
                }}
              />
            </>
          ) : menuChat !== null ? (
            <>
              <MenuItem
                icon={Pencil}
                label="Rename"
                onClick={() => {
                  setEditor({
                    id: menuChat.id,
                    kind: "chat",
                    model: menuChat.model,
                    projectId: menuChat.projectId,
                    title: menuChat.title,
                  });
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={Copy}
                label="Duplicate"
                onClick={() => {
                  chatAction.mutate({
                    action: "duplicate",
                    chat: menuChat,
                  });
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={FolderOpen}
                label="Move to Project"
                onClick={() => {
                  setEditor({
                    chatId: menuChat.id,
                    kind: "move",
                    projectId: menuChat.projectId,
                    title: menuChat.title,
                  });
                  setMenu(null);
                }}
              />
              <MenuItem
                destructive
                icon={Trash2}
                label="Delete"
                onClick={() => {
                  if (window.confirm(`Delete "${menuChat.title}" and its messages?`)) {
                    chatAction.mutate({
                      action: "delete",
                      chat: menuChat,
                    });
                  }
                  setMenu(null);
                }}
              />
            </>
          ) : null}
        </div>
      )}

      {editor === null ? null : (
        <Modal
          onClose={() => setEditor(null)}
          title={
            editor.kind === "move"
              ? `Move ${editor.title}`
              : editor.id === undefined
                ? editor.kind === "project"
                  ? "Create project"
                  : "Create chat"
                : editor.kind === "project"
                  ? "Rename project"
                  : "Rename chat"
          }
        >
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (editor.kind === "move") {
                move.mutate({
                  chatId: editor.chatId,
                  projectId: editor.projectId,
                });
              } else {
                save.mutate(editor);
              }
            }}
          >
            {editor.kind === "project" ? (
              <>
                <label className="block space-y-1.5 text-xs">
                  <span>Name</span>
                  <input
                    autoFocus
                    className={inputClassName}
                    onChange={(event) =>
                      setEditor({ ...editor, name: event.target.value })
                    }
                    required
                    value={editor.name}
                  />
                </label>
                <label className="block space-y-1.5 text-xs">
                  <span>Directory</span>
                  <input
                    className={inputClassName}
                    disabled={editor.id !== undefined}
                    onChange={(event) =>
                      setEditor({ ...editor, path: event.target.value })
                    }
                    placeholder="/Users/me/Projects/my-project"
                    required
                    value={editor.path}
                  />
                </label>
              </>
            ) : editor.kind === "chat" ? (
              <label className="block space-y-1.5 text-xs">
                <span>Chat title</span>
                <input
                  autoFocus
                  className={inputClassName}
                  onChange={(event) =>
                    setEditor({ ...editor, title: event.target.value })
                  }
                  required
                  value={editor.title}
                />
              </label>
            ) : (
              <label className="block space-y-1.5 text-xs">
                <span>Destination project</span>
                <select
                  autoFocus
                  className={inputClassName}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      projectId: event.target.value || null,
                    })
                  }
                  value={editor.projectId ?? ""}
                >
                  <option value="">Unassigned</option>
                  {projects.data?.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEditor(null)} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={save.isPending || move.isPending} type="submit">
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function MenuItem({
  destructive = false,
  icon: Icon,
  label,
  onClick,
}: {
  readonly destructive?: boolean;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-accent",
        destructive && "text-red-400 hover:bg-red-500/10",
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
