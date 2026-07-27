import { permissionModeLabels } from "@tome/config";
import { useShellStore } from "@tome/stores";
import { GitBranch, Radio, ShieldCheck } from "lucide-react";

export function StatusBar(): React.JSX.Element {
  const permissionMode = useShellStore((state) => state.permissionMode);

  return (
    <footer className="flex items-center justify-between border-t border-border bg-statusbar px-3 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <GitBranch className="size-3" />
          No workspace
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3 text-emerald-400" />
          {permissionModeLabels[permissionMode]}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Radio className="size-3 text-muted-foreground" />
        Ollama disconnected
      </div>
    </footer>
  );
}
