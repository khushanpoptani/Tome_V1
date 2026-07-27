import { navigationItems } from "@tome/config";
import { cn } from "@tome/ui";
import { motion } from "framer-motion";
import {
  FolderCode,
  FolderKanban,
  Gauge,
  History,
  ListTodo,
  MessageSquareText,
  Settings,
  type LucideIcon,
} from "lucide-react";
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
  return (
    <motion.aside
      animate={{ width: collapsed ? 60 : 224 }}
      className="flex shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar"
      initial={false}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <nav
        aria-label="Primary navigation"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
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
    </motion.aside>
  );
}
