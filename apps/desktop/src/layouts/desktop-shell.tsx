import { ContextPanel } from "@/components/shell/context-panel";
import { PromptBar } from "@/components/shell/prompt-bar";
import { Sidebar } from "@/components/shell/sidebar";
import { StatusBar } from "@/components/shell/status-bar";
import { TitleBar } from "@/components/shell/title-bar";
import { useShellStore } from "@tome/stores";
import { AnimatePresence, motion } from "framer-motion";
import { Outlet } from "react-router-dom";

export function DesktopShell(): React.JSX.Element {
  const contextPanelOpen = useShellStore((state) => state.contextPanelOpen);
  const sidebarCollapsed = useShellStore((state) => state.sidebarCollapsed);

  return (
    <div className="grid h-dvh min-h-[680px] grid-rows-[42px_minmax(0,1fr)_24px] overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 overflow-hidden">
        <Sidebar collapsed={sidebarCollapsed} />
        <div className="flex min-w-0 flex-1">
          <main className="grid min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto] bg-workspace">
            <div className="min-h-0 overflow-auto">
              <Outlet />
            </div>
            <PromptBar />
          </main>
          <AnimatePresence initial={false}>
            {contextPanelOpen ? (
              <motion.div
                animate={{ opacity: 1, width: 292 }}
                className="hidden shrink-0 overflow-hidden border-l border-border bg-panel xl:block"
                exit={{ opacity: 0, width: 0 }}
                initial={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <ContextPanel />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
