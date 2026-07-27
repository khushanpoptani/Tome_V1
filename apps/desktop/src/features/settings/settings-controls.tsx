import { Card, cn } from "@tome/ui";
import type { PropsWithChildren, ReactNode } from "react";

interface SettingsPanelProps extends PropsWithChildren {
  readonly description: string;
  readonly title: string;
}

export function SettingsPanel({
  children,
  description,
  title,
}: SettingsPanelProps): React.JSX.Element {
  return (
    <Card className="overflow-hidden bg-card/70">
      <header className="border-b border-border/70 px-5 py-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </header>
      <div className="divide-y divide-border/70">{children}</div>
    </Card>
  );
}

interface SettingRowProps {
  readonly control: ReactNode;
  readonly description: string;
  readonly title: string;
}

export function SettingRow({
  control,
  description,
  title,
}: SettingRowProps): React.JSX.Element {
  return (
    <div className="flex min-h-16 items-center justify-between gap-6 px-5 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

interface ChoiceButtonProps {
  readonly active: boolean;
  readonly description: string;
  readonly onClick: () => void;
  readonly title: string;
}

export function ChoiceButton({
  active,
  description,
  onClick,
  title,
}: ChoiceButtonProps): React.JSX.Element {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "rounded-lg border p-3 text-left transition",
        active
          ? "border-violet-400/50 bg-violet-400/10"
          : "border-border bg-background/30 hover:border-border-strong hover:bg-accent/40",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="block text-xs font-medium">{title}</span>
      <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
