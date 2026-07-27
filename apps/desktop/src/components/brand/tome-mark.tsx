import { cn } from "@tome/ui";

interface TomeMarkProps {
  readonly className?: string;
}

export function TomeMark({ className }: TomeMarkProps): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid size-7 place-items-center rounded-lg bg-gradient-to-br from-violet-400 via-violet-500 to-indigo-600 text-[13px] font-black text-white shadow-[0_0_24px_rgba(124,92,255,0.22)]",
        className,
      )}
    >
      T
    </div>
  );
}
