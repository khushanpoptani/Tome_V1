import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

export function Badge({
  className,
  ...props
}: ComponentProps<"span">): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border/80 bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}
