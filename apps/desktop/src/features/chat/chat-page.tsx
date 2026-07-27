import { EmptyState, PageHeader } from "@/components/common/page";
import { MarkdownContent } from "@/features/chat/markdown-content";
import { backend, isTauriRuntime, streamChat } from "@/lib/backend";
import { errorMessage } from "@/lib/format";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellStore } from "@tome/stores";
import type {
  Attachment,
  ChatMessage,
  ConversationRecord,
  MessageRecord,
  StreamEvent,
} from "@tome/types";
import { Badge, Button, Card } from "@tome/ui";
import {
  Bot,
  Clipboard,
  Image,
  MessageSquareText,
  Plus,
  RefreshCw,
  Square,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function attachmentsOf(message: MessageRecord): readonly Attachment[] {
  try {
    return JSON.parse(message.attachmentsJson) as Attachment[];
  } catch {
    return [];
  }
}

function chatContent(text: string, attachments: readonly Attachment[]): string {
  const textFiles = attachments.filter(
    (attachment) => !attachment.mimeType.startsWith("image/"),
  );
  if (textFiles.length === 0) {
    return text;
  }
  const bodies = textFiles.map((attachment) => {
    const encoded = attachment.dataUrl.split(",", 2)[1] ?? "";
    try {
      return `\n\nAttachment: ${attachment.name}\n\`\`\`\n${atob(encoded)}\n\`\`\``;
    } catch {
      return `\n\nAttachment: ${attachment.name} (binary content omitted)`;
    }
  });
  return `${text}${bodies.join("")}`;
}

function ollamaImages(attachments: readonly Attachment[]): string[] {
  return attachments
    .filter((attachment) => attachment.mimeType.startsWith("image/"))
    .map((attachment) => attachment.dataUrl.split(",", 2)[1] ?? "")
    .filter(Boolean);
}

export function ChatPage(): React.JSX.Element {
  const activeConversation = useShellStore((state) => state.activeConversation);
  const activeProject = useShellStore((state) => state.activeProject);
  const activeServer = useShellStore((state) => state.activeServer);
  const pendingPrompt = useShellStore((state) => state.pendingPrompt);
  const selectedModel = useShellStore((state) => state.selectedModel);
  const setActiveConversation = useShellStore((state) => state.setActiveConversation);
  const setPendingPrompt = useShellStore((state) => state.setPendingPrompt);
  const [streaming, setStreaming] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  const processedPrompt = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const messages = useQuery({
    enabled: isTauriRuntime() && activeConversation !== null,
    queryFn: () => backend.listMessages(activeConversation?.id ?? ""),
    queryKey: ["messages", activeConversation?.id],
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data, streaming]);

  useEffect(() => {
    if (
      pendingPrompt === null ||
      pendingPrompt.id === processedPrompt.current ||
      activeServer === null ||
      selectedModel === null
    ) {
      return;
    }
    processedPrompt.current = pendingPrompt.id;
    const prompt = pendingPrompt;
    setPendingPrompt(null);

    const run = async (): Promise<void> => {
      setStreamError(null);
      setStats(null);
      let conversation: ConversationRecord;
      if (activeConversation === null) {
        conversation = await backend.saveConversation({
          model: selectedModel,
          projectId: activeProject?.id ?? null,
          title:
            prompt.text.trim().slice(0, 64) ||
            prompt.attachments[0]?.name ||
            "New conversation",
        });
        setActiveConversation(conversation);
      } else {
        conversation = activeConversation;
      }

      const content = chatContent(prompt.text, prompt.attachments);
      const userMessage = await backend.saveMessage({
        attachmentsJson: JSON.stringify(prompt.attachments),
        content,
        conversationId: conversation.id,
        role: "user",
      });
      const prior = activeConversation === null ? [] : (messages.data ?? []);
      const ollamaMessages: ChatMessage[] = [
        ...prior.map((message) => ({
          content: message.content,
          role: message.role,
        })),
        {
          content,
          images: ollamaImages(prompt.attachments),
          role: "user",
        },
      ];
      void queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });

      const nextRequestId = crypto.randomUUID();
      setRequestId(nextRequestId);
      let responseContent = "";
      let completion: Extract<StreamEvent, { type: "complete" }> | null = null;
      try {
        await streamChat(
          {
            messages: ollamaMessages,
            model: selectedModel,
            requestId: nextRequestId,
            url: activeServer.url,
          },
          (event) => {
            if (event.type === "token") {
              responseContent += event.content;
              setStreaming(responseContent);
            } else if (event.type === "complete") {
              completion = event;
            } else if (event.type === "error") {
              setStreamError(event.message);
            } else if (event.type === "cancelled") {
              setStreamError("Generation stopped.");
            }
          },
        );
        if (responseContent.length > 0) {
          await backend.saveMessage({
            content: responseContent,
            conversationId: conversation.id,
            role: "assistant",
          });
        }
        if (completion !== null) {
          const result = completion as Extract<StreamEvent, { type: "complete" }>;
          setStats(
            `${result.eval_count ?? 0} generated tokens · ${result.prompt_eval_count ?? 0} prompt tokens`,
          );
        }
        void queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] });
        void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      } catch (error) {
        setStreamError(errorMessage(error));
        toast.error(errorMessage(error));
      } finally {
        setStreaming("");
        setRequestId(null);
        void userMessage;
      }
    };
    void run().catch((error: unknown) => {
      setStreamError(errorMessage(error));
      toast.error(errorMessage(error));
      setRequestId(null);
    });
  }, [
    activeConversation,
    activeProject?.id,
    activeServer,
    messages.data,
    pendingPrompt,
    queryClient,
    selectedModel,
    setActiveConversation,
    setPendingPrompt,
  ]);

  const regenerate = (): void => {
    const lastUser = [...(messages.data ?? [])]
      .reverse()
      .find((message) => message.role === "user");
    if (lastUser === undefined) {
      return;
    }
    setPendingPrompt({
      attachments: attachmentsOf(lastUser),
      id: crypto.randomUUID(),
      text: lastUser.content,
    });
  };

  return (
    <div className="min-h-full">
      <PageHeader
        actions={
          <Button
            onClick={() => {
              setActiveConversation(null);
              setStreaming("");
              setStreamError(null);
            }}
            size="sm"
            variant="outline"
          >
            <Plus className="size-3.5" />
            New chat
          </Button>
        }
        description={
          activeConversation?.title ??
          "Stream responses from the active Ollama server and store them locally."
        }
        icon={MessageSquareText}
        title="Chat"
      />
      <div className="mx-auto max-w-4xl space-y-4 p-6 pb-10 lg:p-8">
        {activeConversation === null && requestId === null ? (
          <Card>
            <EmptyState
              description="Select a model below, enter a prompt, and press Return. Responses stream into this view."
              icon={Bot}
              title="Start a conversation"
            />
          </Card>
        ) : null}
        {messages.isError ? (
          <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">
            {errorMessage(messages.error)}
          </p>
        ) : null}
        {messages.data?.map((message) => (
          <article
            className={`group flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}
            key={message.id}
          >
            {message.role === "assistant" ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-400">
                <Bot className="size-4" />
              </span>
            ) : null}
            <div
              className={`max-w-[82%] rounded-xl border p-4 ${
                message.role === "user"
                  ? "border-violet-500/20 bg-violet-500/10"
                  : "border-border bg-card"
              }`}
            >
              <MarkdownContent content={message.content} />
              {attachmentsOf(message).some((item) =>
                item.mimeType.startsWith("image/"),
              ) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {attachmentsOf(message)
                    .filter((item) => item.mimeType.startsWith("image/"))
                    .map((item) => (
                      <img
                        alt={item.name}
                        className="max-h-52 max-w-64 rounded-lg border border-border object-contain"
                        key={item.id}
                        src={item.dataUrl}
                      />
                    ))}
                </div>
              ) : null}
              <div className="mt-2 flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
                <button
                  className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    void navigator.clipboard.writeText(message.content);
                    toast.success("Copied.");
                  }}
                  type="button"
                >
                  <Clipboard className="size-3" />
                  Copy
                </button>
                {message.role === "assistant" ? (
                  <button
                    className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground"
                    onClick={regenerate}
                    type="button"
                  >
                    <RefreshCw className="size-3" />
                    Regenerate
                  </button>
                ) : null}
              </div>
            </div>
            {message.role === "user" ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                {attachmentsOf(message).length > 0 ? (
                  <Image className="size-4" />
                ) : (
                  <User className="size-4" />
                )}
              </span>
            ) : null}
          </article>
        ))}
        {requestId === null ? null : (
          <article className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-400">
              <Bot className="size-4 animate-pulse" />
            </span>
            <div className="max-w-[82%] rounded-xl border border-border bg-card p-4">
              {streaming.length > 0 ? (
                <MarkdownContent content={streaming} />
              ) : (
                <span className="text-xs text-muted-foreground">Waiting for tokens…</span>
              )}
              <Button
                className="mt-3"
                onClick={() => {
                  void backend.cancelOperation(requestId);
                }}
                size="sm"
                variant="outline"
              >
                <Square className="size-3" />
                Stop generation
              </Button>
            </div>
          </article>
        )}
        {streamError === null ? null : (
          <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/8 p-3 text-xs text-red-400">
            <span>{streamError}</span>
            <Button onClick={regenerate} size="sm" variant="outline">
              Retry
            </Button>
          </div>
        )}
        {stats === null ? null : <Badge>{stats}</Badge>}
        <div ref={bottom} />
      </div>
    </div>
  );
}
