import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

export function Card({
  className,
  ...props
}: ComponentProps<"section">): React.JSX.Element {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: ComponentProps<"header">): React.JSX.Element {
  return <header className={cn("space-y-1 p-5", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: ComponentProps<"h2">): React.JSX.Element {
  return (
    <h2 className={cn("text-sm font-semibold tracking-tight", className)} {...props} />
  );
}

export function CardDescription({
  className,
  ...props
}: ComponentProps<"p">): React.JSX.Element {
  return (
    <p
      className={cn("text-xs leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: ComponentProps<"div">): React.JSX.Element {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}
