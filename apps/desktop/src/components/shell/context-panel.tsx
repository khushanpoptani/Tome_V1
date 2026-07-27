import { useShellStore } from "@tome/stores";
import { Badge, Button, Separator } from "@tome/ui";
import { Bot, CheckCircle2, FileOutput, ListChecks, ScrollText, X } from "lucide-react";

const sections = [
  { icon: Bot, label: "Current Agent", value: "Idle" },
  { icon: ListChecks, label: "Running Tasks", value: "0" },
  { icon: ScrollText, label: "Logs", value: "Quiet" },
  { icon: CheckCircle2, label: "Verification", value: "Not running" },
  { icon: FileOutput, label: "Outputs", value: "None" },
] as const;

export function ContextPanel(): React.JSX.Element {
  const setContextPanelOpen = useShellStore((state) => state.setContextPanelOpen);

  return (
    <aside aria-label="Context panel" className="flex h-full w-[292px] flex-col">
      <header className="flex h-12 items-center justify-between px-4">
        <div>
          <p className="text-xs font-semibold">Context</p>
          <p className="text-[10px] text-muted-foreground">Live task details</p>
        </div>
        <Button
          aria-label="Close context panel"
          onClick={() => {
            setContextPanelOpen(false);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <Separator />

      <div className="space-y-2 overflow-auto p-3">
        {sections.map(({ icon: Icon, label, value }) => (
          <section
            className="rounded-lg border border-border/70 bg-background/35 p-3"
            key={label}
          >
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <Icon className="size-3.5" />
              {label}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">{value}</span>
              {label === "Current Agent" ? (
                <Badge className="border-transparent bg-emerald-500/10 text-emerald-300">
                  Ready
                </Badge>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-auto border-t border-border p-4">
        <div className="rounded-lg bg-violet-500/8 p-3">
          <p className="text-[11px] font-medium text-violet-200">Nothing is running</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Agent state, verification, logs, and generated outputs will appear here.
          </p>
        </div>
      </div>
    </aside>
  );
}
