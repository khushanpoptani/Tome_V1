import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";

function MermaidDiagram({ source }: { readonly source: string }): React.JSX.Element {
  const id = useId().replaceAll(":", "");
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void import("mermaid")
      .then((module) => {
        module.default.initialize({
          securityLevel: "strict",
          startOnLoad: false,
          theme: "neutral",
        });
        return module.default.render(`tome-mermaid-${id}`, source);
      })
      .then((result) => {
        if (active) {
          setSvg(result.svg);
          setError(null);
        }
      })
      .catch((renderError: unknown) => {
        if (active) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : "Invalid Mermaid diagram",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [id, source]);

  if (error !== null) {
    return (
      <pre className="overflow-auto rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[11px] text-red-400">
        {error}
      </pre>
    );
  }
  return (
    <div
      className="overflow-auto rounded-lg bg-white p-4"
      // Mermaid returns an SVG generated from strict-mode source parsing.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function MarkdownContent({
  content,
}: {
  readonly content: string;
}): React.JSX.Element {
  return (
    <div className="prose-tome text-[13px] leading-6">
      <ReactMarkdown
        components={{
          code({ children, className }) {
            const language = /language-(\w+)/.exec(className ?? "")?.[1];
            const source =
              typeof children === "string" || typeof children === "number"
                ? `${children}`.replace(/\n$/, "")
                : "";
            if (language === "mermaid") {
              return <MermaidDiagram source={source} />;
            }
            return className === undefined ? (
              <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">
                {children}
              </code>
            ) : (
              <code className="font-mono text-[11px]">{children}</code>
            );
          },
          img({ alt, src }) {
            return (
              <img
                alt={alt ?? ""}
                className="max-h-96 max-w-full rounded-lg border border-border object-contain"
                loading="lazy"
                src={src}
              />
            );
          },
          pre({ children }) {
            return (
              <pre className="my-3 overflow-auto rounded-lg border border-border bg-background p-3">
                {children}
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
