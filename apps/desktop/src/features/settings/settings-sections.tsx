import {
  ChoiceButton,
  SettingRow,
  SettingsPanel,
} from "@/features/settings/settings-controls";
import { application, permissionModeLabels } from "@tome/config";
import { useShellStore } from "@tome/stores";
import { permissionModes, type PermissionMode } from "@tome/types";
import { Badge, Button } from "@tome/ui";
import {
  Check,
  CircleAlert,
  Database,
  ExternalLink,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

const selectClassName =
  "h-8 min-w-36 rounded-md border border-border bg-secondary px-2 text-xs text-secondary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function GeneralSettings(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <SettingsPanel
        description="Control how Tome behaves on this Mac."
        title="Application"
      >
        <SettingRow
          control={
            <select className={selectClassName} defaultValue="english">
              <option value="english">English</option>
            </select>
          }
          description="Language used throughout the desktop application."
          title="Language"
        />
        <SettingRow
          control={
            <button
              aria-label="Launch Tome at login"
              aria-pressed="false"
              className="relative h-5 w-9 rounded-full bg-secondary opacity-60"
              disabled
              title="Startup integration is not implemented yet"
              type="button"
            >
              <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-muted-foreground" />
            </button>
          }
          description="Open Tome automatically after you sign in."
          title="Launch at login"
        />
      </SettingsPanel>
    </div>
  );
}

type ThemeChoice = "dark" | "system";

export function AppearanceSettings(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeChoice>("dark");

  return (
    <SettingsPanel
      description="Choose the visual presentation of the Tome workspace."
      title="Theme"
    >
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <ChoiceButton
          active={theme === "dark"}
          description="Use Tome's focused dark workspace."
          onClick={() => {
            setTheme("dark");
          }}
          title="Dark"
        />
        <ChoiceButton
          active={theme === "system"}
          description="Follow the macOS appearance preference."
          onClick={() => {
            setTheme("system");
          }}
          title="System"
        />
      </div>
    </SettingsPanel>
  );
}

export function ServerSettings(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <SettingsPanel
        description="Connect the desktop client to an Ollama server using its network address."
        title="Ollama server"
      >
        <div className="space-y-3 p-5">
          <label className="block text-xs font-medium" htmlFor="server-endpoint">
            Server endpoint
          </label>
          <div className="flex gap-2">
            <input
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue="http://127.0.0.1:11434"
              id="server-endpoint"
              spellCheck="false"
              type="url"
            />
            <Button
              disabled
              title="Server transport begins after foundation review"
              variant="secondary"
            >
              Test connection
            </Button>
          </div>
          <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Server className="size-3" />
            REST and WebSocket transport are not connected yet.
          </p>
        </div>
      </SettingsPanel>
    </div>
  );
}

export function ModelSettings(): React.JSX.Element {
  return (
    <SettingsPanel
      description="Installed and remote Ollama models will be managed here."
      title="Models"
    >
      <div className="grid min-h-52 place-items-center p-6 text-center">
        <div className="max-w-xs">
          <Database className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-3 text-xs font-medium">No server connected</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Connect an Ollama server before installing, comparing, benchmarking, or
            training models.
          </p>
        </div>
      </div>
    </SettingsPanel>
  );
}

const permissionDescriptions: Record<PermissionMode, string> = {
  ask: "Require confirmation before every potentially destructive action.",
  smart: "Apply reviewed policy rules and ask when risk or intent is uncertain.",
  full: "Permit scoped actions without prompts. Intended for trusted environments only.",
};

export function SecuritySettings(): React.JSX.Element {
  const permissionMode = useShellStore((state) => state.permissionMode);
  const setPermissionMode = useShellStore((state) => state.setPermissionMode);

  return (
    <div className="space-y-4">
      <SettingsPanel
        description="Choose how Tome authorizes filesystem, terminal, internet, Git, training, upload, and server actions."
        title="Execution mode"
      >
        <div className="grid gap-3 p-5">
          {permissionModes.map((mode) => (
            <button
              aria-pressed={permissionMode === mode}
              className="flex items-start gap-3 rounded-lg border border-border bg-background/30 p-3 text-left transition hover:border-border-strong aria-pressed:border-violet-400/50 aria-pressed:bg-violet-400/10"
              key={mode}
              onClick={() => {
                setPermissionMode(mode);
              }}
              type="button"
            >
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border">
                {permissionMode === mode ? (
                  <Check className="size-3 text-violet-300" />
                ) : null}
              </span>
              <span>
                <span className="block text-xs font-medium">
                  {permissionModeLabels[mode]}
                </span>
                <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                  {permissionDescriptions[mode]}
                </span>
              </span>
            </button>
          ))}
        </div>
      </SettingsPanel>

      {permissionMode === "full" ? (
        <div className="flex gap-3 rounded-lg border border-amber-400/20 bg-amber-400/8 p-4">
          <CircleAlert className="size-4 shrink-0 text-amber-300" />
          <p className="text-[11px] leading-relaxed text-amber-100/80">
            Full Access is selected in the UI only. No destructive execution services are
            implemented in this foundation.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const logCategories = [
  "Application",
  "AI",
  "Execution",
  "Verification",
  "Training",
  "Performance",
  "Errors",
] as const;

export function LoggingSettings(): React.JSX.Element {
  return (
    <SettingsPanel
      description="Logging capture and retention policies will be finalized before execution features."
      title="Log categories"
    >
      <div className="grid gap-2 p-5 sm:grid-cols-2">
        {logCategories.map((category) => (
          <div
            className="flex items-center justify-between rounded-lg border border-border bg-background/30 px-3 py-2.5"
            key={category}
          >
            <span className="text-xs">{category}</span>
            <Badge className="border-transparent">Planned</Badge>
          </div>
        ))}
      </div>
    </SettingsPanel>
  );
}

export function AboutSettings(): React.JSX.Element {
  return (
    <SettingsPanel
      description="Application identity and foundation status."
      title="About Tome"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{application.name}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              AI software engineering workspace
            </p>
          </div>
          <Badge>Version {application.version}</Badge>
        </div>
        <div className="rounded-lg border border-border bg-background/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <p className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="size-3.5 text-emerald-300" />
            Foundation milestone
          </p>
          <p className="mt-1.5">
            Local deterministic services and remote AI-agent integrations remain
            intentionally inactive pending architecture review.
          </p>
        </div>
        <Button disabled size="sm" variant="outline">
          Documentation
          <ExternalLink className="size-3" />
        </Button>
      </div>
    </SettingsPanel>
  );
}
