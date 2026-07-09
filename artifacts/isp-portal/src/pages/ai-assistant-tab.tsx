import { useState, useEffect, useRef } from "react";
import {
  useListOpenaiConversations,
  useCreateOpenaiConversation,
  useGetOpenaiConversation,
  useDeleteOpenaiConversation,
  type OpenaiConversationWithMessages,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bot,
  User,
  Send,
  Loader2,
  Plus,
  Trash2,
  Sparkles,
  MessageSquare,
} from "lucide-react";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
}

export function AiAssistantTab() {
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: conversations, refetch: refetchConversations } = useListOpenaiConversations();
  const createConversation = useCreateOpenaiConversation();
  const deleteConversation = useDeleteOpenaiConversation();
  const {
    data: conversation,
    refetch: refetchConversation,
  } = useGetOpenaiConversation<OpenaiConversationWithMessages>(
    conversationId ?? 0,
    { query: { enabled: conversationId != null } } as Parameters<typeof useGetOpenaiConversation<OpenaiConversationWithMessages>>[1],
  );

  useEffect(() => {
    if (conversations && conversations.length > 0 && conversationId == null) {
      setConversationId(conversations[conversations.length - 1].id);
    }
  }, [conversations, conversationId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation, streamingText]);

  const startNewConversation = async () => {
    const created = await createConversation.mutateAsync({
      data: { title: `Diagnostics chat — ${new Date().toLocaleString()}` },
    });
    await refetchConversations();
    setConversationId(created.id);
  };

  const removeConversation = async (id: number) => {
    await deleteConversation.mutateAsync({ id });
    await refetchConversations();
    if (conversationId === id) setConversationId(null);
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content) return;

    let activeId = conversationId;
    if (activeId == null) {
      const created = await createConversation.mutateAsync({
        data: { title: content.slice(0, 60) },
      });
      await refetchConversations();
      activeId = created.id;
      setConversationId(activeId);
    }

    setInput("");
    setSending(true);
    setStreamingText("");

    try {
      const response = await fetch(`/api/openai/conversations/${activeId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.ok || !response.body) {
        const txt = await response.text().catch(() => response.statusText);
        throw new Error(`Server returned ${response.status}: ${txt}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6)) as { content?: string; done?: boolean; error?: string };
          if (payload.error) {
            acc += `\n\n⚠ Error: ${payload.error}`;
            setStreamingText(acc);
          } else if (payload.content) {
            acc += payload.content;
            setStreamingText(acc);
          } else if (payload.done) {
            // stream finished
          }
        }
      }
    } catch (err) {
      setStreamingText((prev) => `${prev}\n\n⚠ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
      setStreamingText("");
      await refetchConversation();
    }
  };

  const messages: DisplayMessage[] = (conversation?.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  return (
    <div className="grid grid-cols-12 gap-4 h-[600px]">
      {/* ── Conversation list ────────────────────────────────────────────── */}
      <div className="col-span-3 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
          <MessageSquare className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800 flex-1">Conversations</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void startNewConversation()}
            className="h-7 w-7 p-0"
            title="New conversation"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {(conversations ?? []).length === 0 && (
              <p className="text-xs text-gray-400 px-2 py-4 text-center">No conversations yet</p>
            )}
            {[...(conversations ?? [])].reverse().map((c) => (
              <div
                key={c.id}
                onClick={() => setConversationId(c.id)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm ${
                  c.id === conversationId ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-700"
                }`}
              >
                <span className="truncate flex-1">{c.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeConversation(c.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Chat panel ───────────────────────────────────────────────────── */}
      <div className="col-span-9 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800 flex-1">AI Diagnostics Assistant</h3>
          <span className="text-xs text-gray-400">Admin only</span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !streamingText && (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 gap-2">
              <Bot className="w-10 h-10 text-gray-300" />
              <p className="text-sm max-w-xs">
                Ask about system health — router status, schema drift, failed payments, open tickets,
                app version — the assistant sees a live snapshot of your system.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <ChatBubble key={i} role={m.role} content={m.content} />
          ))}

          {sending && (
            <ChatBubble role="assistant" content={streamingText || "…"} pending={!streamingText} />
          )}
        </div>

        <div className="border-t border-gray-200 px-4 py-3 flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Ask about system health…"
            disabled={sending}
            className="flex-1"
          />
          <Button
            onClick={() => void sendMessage()}
            disabled={sending || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ role, content, pending }: { role: "user" | "assistant"; content: string; pending?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-blue-600" />
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
          isUser ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
        }`}
      >
        {pending ? (
          <span className="flex items-center gap-1.5 text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
          </span>
        ) : (
          content
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-gray-600" />
        </div>
      )}
    </div>
  );
}
