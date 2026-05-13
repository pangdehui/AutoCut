import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Loader2, Send, User, Sparkles } from "lucide-react";
import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { Streamdown } from "streamdown";

/**
 * Message type matching server-side LLM Message interface
 */
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
  /** 消息下方显示的操作按钮 */
  actions?: ReactNode;
};

export type MentionItem = {
  id: number | string;
  label: string;
  thumbnail?: string;
  hint?: string;
};

export type AIChatBoxProps = {
  /**
   * Messages array to display in the chat.
   * Should match the format used by invokeLLM on the server.
   */
  messages: Message[];

  /**
   * Callback when user sends a message.
   * Typically you'll call a tRPC mutation here to invoke the LLM.
   */
  onSendMessage: (content: string) => void;

  /**
   * Whether the AI is currently generating a response
   */
  isLoading?: boolean;

  /**
   * Placeholder text for the input field
   */
  placeholder?: string;

  /**
   * Custom className for the container
   */
  className?: string;

  /**
   * Height of the chat box (default: 600px)
   */
  height?: string | number;

  /**
   * Empty state message to display when no messages
   */
  emptyStateMessage?: string;

  /**
   * Suggested prompts to display in empty state
   * Click to send directly
   */
  suggestedPrompts?: string[];

  /**
   * Optional list of items selectable via "@" mention popup.
   * When provided, typing "@" in the textarea opens an autocomplete.
   */
  mentionItems?: MentionItem[];

  /**
   * Callback when user picks a mention from the popup.
   * The "@query" token will be removed from the input automatically.
   */
  onMention?: (item: MentionItem) => void;
};

/**
 * A ready-to-use AI chat box component that integrates with the LLM system.
 *
 * Features:
 * - Matches server-side Message interface for seamless integration
 * - Markdown rendering with Streamdown
 * - Auto-scrolls to latest message
 * - Loading states
 * - Uses global theme colors from index.css
 *
 * @example
 * ```tsx
 * const ChatPage = () => {
 *   const [messages, setMessages] = useState<Message[]>([
 *     { role: "system", content: "You are a helpful assistant." }
 *   ]);
 *
 *   const chatMutation = trpc.ai.chat.useMutation({
 *     onSuccess: (response) => {
 *       // Assuming your tRPC endpoint returns the AI response as a string
 *       setMessages(prev => [...prev, {
 *         role: "assistant",
 *         content: response
 *       }]);
 *     },
 *     onError: (error) => {
 *       console.error("Chat error:", error);
 *       // Optionally show error message to user
 *     }
 *   });
 *
 *   const handleSend = (content: string) => {
 *     const newMessages = [...messages, { role: "user", content }];
 *     setMessages(newMessages);
 *     chatMutation.mutate({ messages: newMessages });
 *   };
 *
 *   return (
 *     <AIChatBox
 *       messages={messages}
 *       onSendMessage={handleSend}
 *       isLoading={chatMutation.isPending}
 *       suggestedPrompts={[
 *         "Explain quantum computing",
 *         "Write a hello world in Python"
 *       ]}
 *     />
 *   );
 * };
 * ```
 */
export function AIChatBox({
  messages,
  onSendMessage,
  isLoading = false,
  placeholder = "Type your message...",
  className,
  height = "600px",
  emptyStateMessage = "Start a conversation with AI",
  suggestedPrompts,
  mentionItems,
  onMention,
}: AIChatBoxProps) {
  const [input, setInput] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputAreaRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ============ Mention popup state ============
  const [mention, setMention] = useState<{
    open: boolean; query: string; start: number; index: number;
  }>({ open: false, query: "", start: -1, index: 0 });

  const filteredMentions = useMemo(() => {
    if (!mention.open || !mentionItems || mentionItems.length === 0) return [];
    const q = mention.query.toLowerCase();
    if (!q) return mentionItems.slice(0, 8);
    return mentionItems
      .filter((it) => it.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mention.open, mention.query, mentionItems]);

  // Reset highlight index when filtered list changes
  useEffect(() => {
    setMention((m) => (m.index >= filteredMentions.length ? { ...m, index: 0 } : m));
  }, [filteredMentions.length]);

  const detectMention = (value: string, cursor: number) => {
    if (!mentionItems) return;
    let atPos = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === "@") { atPos = i; break; }
      if (ch === " " || ch === "\n" || ch === "\t") break;
    }
    if (atPos >= 0) {
      const q = value.slice(atPos + 1, cursor);
      setMention({ open: true, query: q, start: atPos, index: 0 });
    } else {
      setMention((m) => (m.open ? { open: false, query: "", start: -1, index: 0 } : m));
    }
  };

  const selectMention = (item: MentionItem) => {
    if (!onMention) return;
    onMention(item);
    if (mention.start >= 0) {
      const before = input.slice(0, mention.start);
      const after = input.slice(mention.start + 1 + mention.query.length);
      setInput(before + after);
    }
    setMention({ open: false, query: "", start: -1, index: 0 });
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // Filter out system messages
  const displayMessages = messages.filter((msg) => msg.role !== "system");

  // Calculate min-height for last assistant message to push user message to top
  const [minHeightForLastMessage, setMinHeightForLastMessage] = useState(0);

  useEffect(() => {
    if (containerRef.current && inputAreaRef.current) {
      const containerHeight = containerRef.current.offsetHeight;
      const inputHeight = inputAreaRef.current.offsetHeight;
      const scrollAreaHeight = containerHeight - inputHeight;

      // Reserve space for:
      // - padding (p-4 = 32px top+bottom)
      // - user message: 40px (item height) + 16px (margin-top from space-y-4) = 56px
      // Note: margin-bottom is not counted because it naturally pushes the assistant message down
      const userMessageReservedHeight = 56;
      const calculatedHeight = scrollAreaHeight - 32 - userMessageReservedHeight;

      setMinHeightForLastMessage(Math.max(0, calculatedHeight));
    }
  }, []);

  // Scroll to bottom helper function with smooth animation
  const scrollToBottom = () => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLDivElement;

    if (viewport) {
      requestAnimationFrame(() => {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: 'smooth'
        });
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    onSendMessage(trimmedInput);
    setInput("");
    setMention({ open: false, query: "", start: -1, index: 0 });

    // Scroll immediately after sending
    scrollToBottom();

    // Keep focus on input
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.open && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((m) => ({ ...m, index: (m.index + 1) % filteredMentions.length }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) => ({
          ...m,
          index: (m.index - 1 + filteredMentions.length) % filteredMentions.length,
        }));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(filteredMentions[mention.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention({ open: false, query: "", start: -1, index: 0 });
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !mention.open) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col bg-card text-card-foreground rounded-lg border shadow-sm",
        className
      )}
      style={{ height }}
    >
      {/* Messages Area */}
      <div ref={scrollAreaRef} className="flex-1 overflow-hidden">
        {displayMessages.length === 0 ? (
          <div className="flex h-full flex-col p-4">
            <div className="flex flex-1 flex-col items-center justify-center gap-6 text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <Sparkles className="size-12 opacity-20" />
                <p className="text-sm">{emptyStateMessage}</p>
              </div>

              {suggestedPrompts && suggestedPrompts.length > 0 && (
                <div className="flex max-w-2xl flex-wrap justify-center gap-2">
                  {suggestedPrompts.map((prompt, index) => (
                    <button
                      key={index}
                      onClick={() => onSendMessage(prompt)}
                      disabled={isLoading}
                      className="rounded-lg border border-border bg-card px-4 py-2 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="flex flex-col space-y-4 p-4">
              {displayMessages.map((message, index) => {
                // Apply min-height to last message only if NOT loading (when loading, the loading indicator gets it)
                const isLastMessage = index === displayMessages.length - 1;
                const shouldApplyMinHeight =
                  isLastMessage && !isLoading && minHeightForLastMessage > 0;

                return (
                  <div
                    key={index}
                    className={cn(
                      "flex gap-3",
                      message.role === "user"
                        ? "justify-end items-start"
                        : "justify-start items-start"
                    )}
                    style={
                      shouldApplyMinHeight
                        ? { minHeight: `${minHeightForLastMessage}px` }
                        : undefined
                    }
                  >
                    {message.role === "assistant" && (
                      <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                        <Sparkles className="size-4 text-primary" />
                      </div>
                    )}

                    <div>
                      <div
                        className={cn(
                          "max-w-[80%] rounded-lg px-4 py-2.5",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        )}
                      >
                        {message.role === "assistant" ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <Streamdown>{message.content}</Streamdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap text-sm">
                            {message.content}
                          </p>
                        )}
                      </div>
                      {message.actions && (
                        <div className="mt-2 flex gap-2 flex-wrap">
                          {message.actions}
                        </div>
                      )}
                    </div>

                    {message.role === "user" && (
                      <div className="size-8 shrink-0 mt-1 rounded-full bg-secondary flex items-center justify-center">
                        <User className="size-4 text-secondary-foreground" />
                      </div>
                    )}
                  </div>
                );
              })}

              {isLoading && (
                <div
                  className="flex items-start gap-3"
                  style={
                    minHeightForLastMessage > 0
                      ? { minHeight: `${minHeightForLastMessage}px` }
                      : undefined
                  }
                >
                  <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="size-4 text-primary" />
                  </div>
                  <div className="rounded-lg bg-muted px-4 py-2.5">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Input Area */}
      <form
        ref={inputAreaRef}
        onSubmit={handleSubmit}
        className="relative flex gap-2 p-4 border-t bg-background/50 items-end"
      >
        {/* Mention popup */}
        {mention.open && filteredMentions.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-popover text-popover-foreground border rounded-md shadow-lg z-50 max-h-60 overflow-auto">
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b">
              ↑↓ 选择 · Enter/Tab 确认 · Esc 关闭
            </div>
            {filteredMentions.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                  idx === mention.index ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                )}
                onMouseDown={(e) => { e.preventDefault(); selectMention(item); }}
                onMouseEnter={() => setMention((m) => ({ ...m, index: idx }))}
              >
                {item.thumbnail && (
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="h-8 w-12 object-cover rounded shrink-0 bg-muted"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{item.label}</p>
                  {item.hint && (
                    <p className="text-[10px] text-muted-foreground truncate">{item.hint}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            const v = e.target.value;
            setInput(v);
            detectMention(v, e.target.selectionStart ?? v.length);
          }}
          onKeyUp={(e) => {
            // 光标移动后(箭头键、点击)也要更新 mention 状态
            const t = e.currentTarget;
            detectMention(t.value, t.selectionStart ?? t.value.length);
          }}
          onClick={(e) => {
            const t = e.currentTarget;
            detectMention(t.value, t.selectionStart ?? t.value.length);
          }}
          onBlur={() => {
            // 延迟关闭,避免 mousedown 选中前就关闭
            setTimeout(() => setMention((m) => (m.open ? { ...m, open: false } : m)), 150);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 max-h-32 resize-none min-h-9"
          rows={1}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || isLoading}
          className="shrink-0 h-[38px] w-[38px]"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
