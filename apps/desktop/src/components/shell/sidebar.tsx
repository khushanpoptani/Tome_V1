import { navigationItems } from "@tome/config";
import { useShellStore } from "@tome/stores";
import { cn } from "@tome/ui";
import { motion } from "framer-motion";
import {
  FolderCode,
  FolderKanban,
  Gauge,
  History,
  ListTodo,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";

const icons: Record<(typeof navigationItems)[number]["id"], LucideIcon> = {
  dashboard: Gauge,
  chat: MessageSquareText,
  workspace: FolderCode,
  projects: FolderKanban,
  history: History,
  "task-queue": ListTodo,
  settings: Settings,
};

interface SidebarProps {
  readonly collapsed: boolean;
}

export function Sidebar({ collapsed }: SidebarProps): React.JSX.Element {
  const sidebarWidth = useShellStore((state) => state.sidebarWidth);
  const setSidebarCollapsed = useShellStore((state) => state.setSidebarCollapsed);
  const setSidebarWidth = useShellStore((state) => state.setSidebarWidth);
  const contextPanelOpen = useShellStore((state) => state.contextPanelOpen);
  const setContextPanelOpen = useShellStore((state) => state.setContextPanelOpen);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [toggleSidebar]);

  const handleResizeStart = (event: React.PointerEvent): void => {
    if (collapsed) {
      return;
    }
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
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const links = Array.from(
      navigationRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [],
    );
    if (links.length === 0) {
      return;
    }
    event.preventDefault();
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
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

  return (
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
            onClick={() => {
              setSidebarCollapsed(!collapsed);
            }}
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
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
        {navigationItems.map((item) => {
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
      </nav>

      <div className="border-t border-border p-2">
        <div
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2",
            collapsed && "justify-center px-0",
          )}
        >
          <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground">
            T
            <span className="absolute bottom-0 right-0 size-2 rounded-full border-2 border-sidebar bg-emerald-400" />
          </span>
          {collapsed ? null : (
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">Local workspace</span>
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
          onDoubleClick={() => {
            setSidebarWidth(224);
          }}
          onPointerDown={handleResizeStart}
          role="separator"
        />
      )}
    </motion.aside>
  );
}
