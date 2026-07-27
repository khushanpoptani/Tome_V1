import {
  AboutSettings,
  AppearanceSettings,
  GeneralSettings,
  LoggingSettings,
  ModelSettings,
  SecuritySettings,
  ServerSettings,
} from "@/features/settings/settings-sections";
import { cn } from "@tome/ui";
import {
  Bot,
  Info,
  Logs,
  MonitorCog,
  Palette,
  Server,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

type SettingsSection =
  "general" | "appearance" | "server" | "models" | "security" | "logging" | "about";

interface SettingsNavigationItem {
  readonly icon: LucideIcon;
  readonly id: SettingsSection;
  readonly label: string;
}

const navigation: readonly SettingsNavigationItem[] = [
  { icon: Settings2, id: "general", label: "General" },
  { icon: Palette, id: "appearance", label: "Appearance" },
  { icon: Server, id: "server", label: "Server Connection" },
  { icon: Bot, id: "models", label: "Models" },
  { icon: ShieldCheck, id: "security", label: "Security" },
  { icon: Logs, id: "logging", label: "Logging" },
  { icon: Info, id: "about", label: "About" },
] as const;

const content: Readonly<Record<SettingsSection, () => React.JSX.Element>> = {
  general: GeneralSettings,
  appearance: AppearanceSettings,
  server: ServerSettings,
  models: ModelSettings,
  security: SecuritySettings,
  logging: LoggingSettings,
  about: AboutSettings,
};

export function SettingsPage(): React.JSX.Element {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const ActiveContent = content[activeSection];
  const activeLabel =
    navigation.find((item) => item.id === activeSection)?.label ?? "Settings";

  return (
    <div className="min-h-full">
      <header className="border-b border-border px-6 py-5 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg border border-border bg-secondary">
            <MonitorCog className="size-4 text-violet-300" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Configure the Tome desktop workspace.
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-6 px-6 py-6 md:grid-cols-[190px_minmax(0,720px)] lg:px-8">
        <nav
          aria-label="Settings sections"
          className="flex gap-1 overflow-x-auto md:sticky md:top-6 md:block md:self-start md:overflow-visible"
        >
          {navigation.map(({ icon: Icon, id, label }) => (
            <button
              aria-current={activeSection === id ? "page" : undefined}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground md:mb-1 md:w-full",
                activeSection === id && "bg-accent text-foreground",
              )}
              key={id}
              onClick={() => {
                setActiveSection(id);
              }}
              type="button"
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <section aria-labelledby="settings-section-title" className="min-w-0">
          <h2 className="sr-only" id="settings-section-title">
            {activeLabel}
          </h2>
          <ActiveContent />
        </section>
      </div>
    </div>
  );
}
