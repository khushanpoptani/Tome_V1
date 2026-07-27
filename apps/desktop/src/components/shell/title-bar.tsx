import { TomeMark } from "@/components/brand/tome-mark";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { application } from "@tome/config";
import { useShellStore } from "@tome/stores";
import { Button } from "@tome/ui";
import { Columns3, Minus, PanelLeft, Search, Square, X } from "lucide-react";

async function runWindowAction(action: "minimize" | "maximize" | "close"): Promise<void> {
  if (!isTauri()) {
    return;
  }

  const window = getCurrentWindow();
  await window[action]();
}

export function TitleBar(): React.JSX.Element {
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const contextPanelOpen = useShellStore((state) => state.contextPanelOpen);
  const setContextPanelOpen = useShellStore((state) => state.setContextPanelOpen);

  return (
    <header
      className="flex select-none items-center border-b border-border bg-titlebar px-2"
      data-tauri-drag-region
    >
      <div className="flex min-w-48 items-center gap-2 pl-1" data-tauri-drag-region>
        <TomeMark className="size-6 rounded-md text-[11px]" />
        <span className="text-xs font-semibold tracking-wide" data-tauri-drag-region>
          {application.name}
        </span>
      </div>

      <div className="flex flex-1 justify-center" data-tauri-drag-region>
        <button
          aria-label="Search Tome"
          className="flex h-7 w-full max-w-[420px] items-center gap-2 rounded-md border border-border/80 bg-background/60 px-3 text-xs text-muted-foreground transition hover:border-border-strong hover:text-foreground"
          type="button"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search Tome</span>
          <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-sans text-[10px]">
            ⌘ K
          </kbd>
        </button>
      </div>

      <div className="flex min-w-48 items-center justify-end">
        <Button
          aria-label="Toggle sidebar"
          onClick={toggleSidebar}
          size="icon"
          type="button"
          variant="ghost"
        >
          <PanelLeft className="size-3.5" />
        </Button>
        <Button
          aria-label="Toggle context panel"
          onClick={() => {
            setContextPanelOpen(!contextPanelOpen);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Columns3 className="size-3.5" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          aria-label="Minimize window"
          onClick={() => void runWindowAction("minimize")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Minus className="size-3.5" />
        </Button>
        <Button
          aria-label="Maximize window"
          onClick={() => void runWindowAction("maximize")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Square className="size-3" />
        </Button>
        <Button
          aria-label="Close window"
          className="hover:bg-red-500 hover:text-white"
          onClick={() => void runWindowAction("close")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}
