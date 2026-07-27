import { permissionModeLabels } from "@tome/config";
import { useShellStore } from "@tome/stores";
import type { PermissionMode } from "@tome/types";
import { Button } from "@tome/ui";
import {
  ArrowUp,
  ChevronDown,
  Mic,
  Paperclip,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export function PromptBar(): React.JSX.Element {
  const permissionMode = useShellStore((state) => state.permissionMode);
  const setPermissionMode = useShellStore((state) => state.setPermissionMode);

  return (
    <div className="border-t border-border bg-workspace/95 px-5 py-4">
      <div className="mx-auto max-w-[900px] rounded-xl border border-border-strong bg-prompt shadow-[0_18px_44px_rgba(0,0,0,0.22)] transition focus-within:border-violet-400/50 focus-within:ring-1 focus-within:ring-violet-400/20">
        <label className="sr-only" htmlFor="tome-prompt">
          Ask Tome
        </label>
        <textarea
          className="min-h-16 w-full resize-none bg-transparent px-4 pt-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          id="tome-prompt"
          placeholder="Ask Tome to build, explain, diagnose, or plan…"
          rows={2}
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              aria-label="Attach files"
              disabled
              size="icon"
              title="Attachments will be enabled with workspace support"
              type="button"
              variant="ghost"
            >
              <Paperclip className="size-4" />
            </Button>
            <Button
              aria-label="Use voice input"
              disabled
              size="icon"
              title="Voice input is not configured"
              type="button"
              variant="ghost"
            >
              <Mic className="size-4" />
            </Button>
            <button
              className="flex h-8 items-center gap-2 rounded-md px-2 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
              type="button"
            >
              <Sparkles className="size-3.5 text-violet-300" />
              <span>No model selected</span>
              <ChevronDown className="size-3" />
            </button>
            <label className="relative flex h-8 items-center gap-2 rounded-md px-2 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground">
              <ShieldCheck className="size-3.5 text-emerald-300" />
              <span>{permissionModeLabels[permissionMode]}</span>
              <select
                aria-label="Permission mode"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => {
                  setPermissionMode(event.target.value as PermissionMode);
                }}
                value={permissionMode}
              >
                <option value="ask">Ask for Approval</option>
                <option value="smart">Smart Approval</option>
                <option value="full">Full Access</option>
              </select>
              <ChevronDown className="size-3" />
            </label>
          </div>
          <Button
            aria-label="Send prompt"
            className="size-8 rounded-lg"
            disabled
            size="icon"
            title="Connect an Ollama server before sending"
            type="button"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-[900px] text-center text-[10px] text-muted-foreground/60">
        Tome can make mistakes. Review plans, approvals, and generated changes.
      </p>
    </div>
  );
}
