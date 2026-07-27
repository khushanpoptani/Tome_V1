import { EmptyState, inputClassName, Modal, PageHeader } from "@/components/common/page";
import { backend, isTauriRuntime } from "@/lib/backend";
import { errorMessage, formatDate } from "@/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShellStore } from "@tome/stores";
import type { ConversationRecord } from "@tome/types";
import { Badge, Button, Card } from "@tome/ui";
import { History, MessageSquareText, Pencil, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export function HistoryPage(): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<ConversationRecord | null>(null);
  const [title, setTitle] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveConversation = useShellStore((state) => state.setActiveConversation);
  const conversations = useQuery({
    enabled: isTauriRuntime(),
    queryFn: () => backend.listConversations(search),
    queryKey: ["conversations", search],
  });
  const save = useMutation({
    mutationFn: backend.saveConversation,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setRenaming(null);
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Conversation renamed.");
    },
  });
  const remove = useMutation({
    mutationFn: backend.deleteConversation,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Conversation deleted.");
    },
  });

  return (
    <div className="min-h-full">
      <PageHeader
        description="Search, open, rename, and remove locally stored conversations."
        icon={History}
        title="History"
      />
      <div className="p-6 lg:p-8">
        <label className="relative mb-5 block max-w-lg">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            aria-label="Search conversations"
            className={`${inputClassName} pl-9`}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search titles and messages…"
            value={search}
          />
        </label>
        {(conversations.data?.length ?? 0) === 0 ? (
          <Card>
            <EmptyState
              description={
                search.length > 0
                  ? "No stored conversations match your search."
                  : "Your conversations will be stored locally after you start chatting."
              }
              icon={MessageSquareText}
              title={search.length > 0 ? "No results" : "No conversation history"}
            />
          </Card>
        ) : (
          <div className="grid gap-3">
            {conversations.data?.map((conversation) => (
              <Card className="flex items-center gap-3 p-4" key={conversation.id}>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setActiveConversation(conversation);
                    void navigate("/chat");
                  }}
                  type="button"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {conversation.title}
                    {conversation.model === null ? null : (
                      <Badge>{conversation.model}</Badge>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    {conversation.preview ?? "Empty conversation"}
                  </span>
                  <span className="mt-1.5 block text-[9px] text-muted-foreground">
                    {conversation.messageCount} messages · Updated{" "}
                    {formatDate(conversation.updatedAt)}
                  </span>
                </button>
                <Button
                  aria-label={`Rename ${conversation.title}`}
                  onClick={() => {
                    setRenaming(conversation);
                    setTitle(conversation.title);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Delete ${conversation.title}`}
                  onClick={() => {
                    if (
                      window.confirm(`Delete "${conversation.title}" and its messages?`)
                    ) {
                      remove.mutate(conversation.id);
                    }
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
      {renaming === null ? null : (
        <Modal onClose={() => setRenaming(null)} title="Rename conversation">
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate({
                id: renaming.id,
                model: renaming.model,
                projectId: renaming.projectId,
                title,
              });
            }}
          >
            <input
              autoFocus
              className={inputClassName}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setRenaming(null)} type="button" variant="outline">
                Cancel
              </Button>
              <Button type="submit">Rename</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
