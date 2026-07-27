import { backend, isTauriRuntime } from "@/lib/backend";
import { formatBytes } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { permissionModeLabels } from "@tome/config";
import { useShellStore } from "@tome/stores";
import type { Attachment, PermissionMode } from "@tome/types";
import { Button } from "@tome/ui";
import { ArrowUp, ChevronDown, Paperclip, ShieldCheck, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

async function toAttachment(file: File): Promise<Attachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error(`Could not encode ${file.name}`));
      }
    });
    reader.addEventListener("error", () => {
      reject(new Error(`Could not read ${file.name}`));
    });
    reader.readAsDataURL(file);
  });
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    dataUrl,
  };
}

export function PromptBar(): React.JSX.Element {
  const activeServer = useShellStore((state) => state.activeServer);
  const permissionMode = useShellStore((state) => state.permissionMode);
  const selectedModel = useShellStore((state) => state.selectedModel);
  const setPendingPrompt = useShellStore((state) => state.setPendingPrompt);
  const setPermissionMode = useShellStore((state) => state.setPermissionMode);
  const setSelectedModel = useShellStore((state) => state.setSelectedModel);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const models = useQuery({
    enabled: isTauriRuntime() && activeServer !== null,
    queryFn: () => backend.listModels(activeServer?.url ?? ""),
    queryKey: ["models", activeServer?.url],
    refetchInterval: 30_000,
  });

  const availableModels = models.data ?? [];
  const effectiveModel =
    availableModels.find((model) => model.name === selectedModel)?.name ??
    availableModels[0]?.name ??
    null;

  const send = (): void => {
    const prompt = text.trim();
    if (activeServer === null) {
      toast.error("Connect an Ollama server before sending a message.");
      void navigate("/settings?section=server");
      return;
    }
    if (effectiveModel === null) {
      toast.error("Install or select an Ollama model before sending a message.");
      void navigate("/settings?section=models");
      return;
    }
    if (prompt.length === 0 && attachments.length === 0) {
      return;
    }
    setSelectedModel(effectiveModel);
    setPendingPrompt({
      attachments,
      id: crypto.randomUUID(),
      text: prompt,
    });
    setText("");
    setAttachments([]);
    void navigate("/chat");
  };

  return (
    <div className="border-t border-border bg-workspace/95 px-5 py-3">
      <div className="mx-auto max-w-[900px] rounded-xl border border-border-strong bg-prompt shadow-[0_18px_44px_rgba(0,0,0,0.16)] transition focus-within:border-violet-400/50 focus-within:ring-1 focus-within:ring-violet-400/20">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((attachment) => (
              <span
                className="flex items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1 text-[10px]"
                key={attachment.id}
              >
                <span className="max-w-32 truncate">{attachment.name}</span>
                <span className="text-muted-foreground">
                  {formatBytes(attachment.size)}
                </span>
                <button
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => {
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    );
                  }}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <label className="sr-only" htmlFor="tome-prompt">
          Ask Tome
        </label>
        <textarea
          className="min-h-14 w-full resize-none bg-transparent px-4 pt-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          id="tome-prompt"
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Ask Tome…"
          rows={2}
          value={text}
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-2">
          <div className="flex min-w-0 items-center gap-1">
            <input
              accept="image/*,.txt,.md,.json,.yaml,.yml,.toml,.csv"
              className="hidden"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                void Promise.all(files.map(toAttachment))
                  .then((next) => {
                    setAttachments((current) => [...current, ...next].slice(0, 8));
                  })
                  .catch((error: unknown) => {
                    toast.error(
                      error instanceof Error ? error.message : "Attachment failed.",
                    );
                  });
                event.target.value = "";
              }}
              ref={fileInput}
              type="file"
            />
            <Button
              aria-label="Attach files"
              onClick={() => {
                fileInput.current?.click();
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Paperclip className="size-4" />
            </Button>
            <label className="relative flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground">
              <Sparkles className="size-3.5 shrink-0 text-violet-300" />
              <span className="max-w-36 truncate">
                {effectiveModel ?? "No model installed"}
              </span>
              <select
                aria-label="Chat model"
                className="absolute inset-0 cursor-pointer opacity-0"
                disabled={availableModels.length === 0}
                onChange={(event) => {
                  setSelectedModel(event.target.value);
                }}
                value={effectiveModel ?? ""}
              >
                {availableModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="size-3 shrink-0" />
            </label>
            <label className="relative flex h-8 items-center gap-2 rounded-md px-2 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground">
              <ShieldCheck className="size-3.5 text-emerald-300" />
              <span>{permissionModeLabels[permissionMode]}</span>
              <select
                aria-label="Permission mode"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => {
                  setPermissionMode(event.target.value as PermissionMode);
                }}
                value={permissionMode}
              >
                <option value="ask">Ask for Approval</option>
                <option value="smart">Smart Approval</option>
                <option value="full">Full Access</option>
              </select>
              <ChevronDown className="size-3" />
            </label>
          </div>
          <Button
            aria-label="Send prompt"
            className="size-8 rounded-lg"
            disabled={text.trim().length === 0 && attachments.length === 0}
            onClick={send}
            size="icon"
            type="button"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
