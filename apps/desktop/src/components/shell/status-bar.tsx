import { permissionModeLabels } from "@tome/config";
import { useShellStore } from "@tome/stores";
import { GitBranch, Radio, ShieldCheck } from "lucide-react";

export function StatusBar(): React.JSX.Element {
  const permissionMode = useShellStore((state) => state.permissionMode);
  const activeProject = useShellStore((state) => state.activeProject);
  const activeServer = useShellStore((state) => state.activeServer);
  const diagnostics = useShellStore((state) => state.diagnostics);

  return (
    <footer className="flex items-center justify-between border-t border-border bg-statusbar px-3 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <GitBranch className="size-3" />
          {activeProject?.name ?? "No project"}
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3 text-emerald-400" />
          {permissionModeLabels[permissionMode]}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Radio
          className={`size-3 ${
            diagnostics?.apiAvailable === true
              ? "text-emerald-400"
              : "text-muted-foreground"
          }`}
        />
        {diagnostics?.apiAvailable === true
          ? `${activeServer?.name ?? "Ollama"} · ${diagnostics.pingMs ?? 0} ms`
          : "Ollama disconnected"}
      </div>
    </footer>
  );
}
