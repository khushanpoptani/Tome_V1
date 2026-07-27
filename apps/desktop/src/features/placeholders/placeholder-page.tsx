import { Badge, Card } from "@tome/ui";
import { Construction, Sparkles } from "lucide-react";

interface PlaceholderPageProps {
  readonly description: string;
  readonly eyebrow: string;
  readonly title: string;
}

export function PlaceholderPage({
  description,
  eyebrow,
  title,
}: PlaceholderPageProps): React.JSX.Element {
  return (
    <div className="grid h-full min-h-[420px] place-items-center p-8">
      <Card className="w-full max-w-lg bg-card/70 p-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-violet-400/15 bg-violet-400/8 text-violet-200">
          <Construction className="size-5" />
        </span>
        <Badge className="mt-5 border-transparent">
          <Sparkles className="size-3" />
          {eyebrow}
        </Badge>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <p className="mt-5 text-[11px] text-muted-foreground/60">
          Business features begin after foundation review.
        </p>
      </Card>
    </div>
  );
}
