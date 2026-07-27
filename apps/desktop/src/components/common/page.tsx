import { cn } from "@tome/ui";
import { X, type LucideIcon } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";

export function PageHeader({
  actions,
  description,
  icon: Icon,
  title,
}: {
  readonly actions?: ReactNode;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly title: string;
}): React.JSX.Element {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-5 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary">
          <Icon className="size-4 text-violet-400" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {actions}
    </header>
  );
}

export function EmptyState({
  action,
  description,
  icon: Icon,
  title,
}: {
  readonly action?: ReactNode;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly title: string;
}): React.JSX.Element {
  return (
    <div className="grid min-h-64 place-items-center p-8 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-secondary">
          <Icon className="size-5 text-muted-foreground" />
        </span>
        <p className="mt-4 text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        {action === undefined ? null : <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function Modal({
  children,
  onClose,
  title,
  width = "max-w-lg",
}: PropsWithChildren<{
  readonly onClose: () => void;
  readonly title: string;
  readonly width?: string;
}>): React.JSX.Element {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-5 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
      role="dialog"
    >
      <section
        className={cn(
          "max-h-[85vh] w-full overflow-auto rounded-xl border border-border bg-card shadow-2xl",
          width,
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            aria-label="Close dialog"
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export const inputClassName =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const textAreaClassName =
  "min-h-24 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
