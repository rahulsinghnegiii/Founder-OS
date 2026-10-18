import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bot,
  PanelLeft,
  PanelLeftClose,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useOrchestratorChat, useListMessages, getListMessagesQueryKey } from "@workspace/api-client-react";
import { fetcher } from "@/lib/fetcher";
import { useVoice } from "@/lib/voice/VoiceProvider";
import { VoiceControl } from "@/components/hq/VoiceControl";
import { StreamingText } from "@/components/hq/StreamingText";
import { VoiceStatusBadge } from "@/components/hq/VoiceStatusBadge";
import { StatusPill } from "@/components/hq/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { cn } from "@/lib/utils";

type ChatMsg = { role: "user" | "assistant"; content: string };

type Session = {
  id: string;
  title: string | null;
  type: string;
  status: string;
  summary: string | null;
  pinned: boolean;
  lastMessageAt: string | null;
  createdAt: string;
  messageCount: number;
};

const WELCOME: ChatMsg = {
  role: "assistant",
  content:
    "Hey — I'm your Executive Assistant. Sales is live: ask me which deals are going quiet, who to follow up with, or tell me to draft a follow-up for someone. I can also add leads, tasks, and projects.",
};

function groupBucket(ts: string | null): "today" | "yesterday" | "last7" | "older" {
  if (!ts) return "older";
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 86400000;
  const diff = Math.floor((startOfToday.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / dayMs);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff <= 7) return "last7";
  return "older";
}

const BUCKET_LABELS: Record<string, string> = {
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  older: "Older",
};

const SUGGESTION_CHIPS = [
  { label: "Add a lead", prompt: "Add a new lead" },
  { label: "Deals going quiet?", prompt: "Which deals are going quiet?" },
  { label: "Pipeline status", prompt: "How is the pipeline looking?" },
  { label: "Log a task", prompt: "Add a task" },
  { label: "Start a project", prompt: "Start a new project" },
];

const THOUGHT_STARTERS = [
  "Who should I follow up with today?",
  "Which deals are at risk right now?",
  "Draft a follow-up for my biggest quiet deal.",
];

function formatActiveDuration(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export default function Chat() {
  const queryClient = useQueryClient();
  const voice = useVoice();
  const [message, setMessage] = useState("");
  const [localMessages, setLocalMessages] = useState<ChatMsg[]>([WELCOME]);
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const didResume = useRef(false);
  // Tracks which session `localMessages` was last seeded from so the server
  // sync effect never clobbers an in-flight / optimistic turn.
  const loadedSessionRef = useRef<string | null>("__init__");

  const [historyPinned, setHistoryPinned] = usePersistentState("founderos:ea-history-open", true);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const { mutate: sendMessage, isPending } = useOrchestratorChat();
  const { data: messages, isLoading: historyLoading } = useListMessages(sessionId ?? "");

  const loadSessions = async (q?: string) => {
    setSessionsLoading(true);
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : "";
      const res = await fetcher<{ sessions: Session[] }>(`/api/orchestrator/sessions${qs}`);
      setSessions(res.sessions);
    } catch {
      /* ignore */
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (didResume.current) return;
    if (sessionsLoading) return;
    const active = sessions.filter((s) => s.status === "active");
    if (active.length > 0) {
      const mostRecent = [...active].sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
      )[0];
      setSessionId(mostRecent.id);
      didResume.current = true;
    }
  }, [sessions, sessionsLoading]);

  // Expose our sender to the voice layer so spoken messages flow through the
  // exact same conversation pipeline (and same session) as typed ones.
  const sendRef = useRef<(text: string) => Promise<string>>(() => Promise.resolve(""));
  useEffect(() => {
    voice.registerSender((text) => sendRef.current(text));
    return () => voice.registerSender(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);

  // Sync the visible thread from the server only when we switch INTO a session
  // (explicit open or initial resume) — never while a turn is in flight. Without
  // this guard the stale react-query cache would overwrite the optimistic reply
  // the moment `pendingUserMsg` cleared, hiding the response until a refetch.
  useEffect(() => {
    if (pendingUserMsg) return;
    if (sessionId === loadedSessionRef.current) return;
    // Wait for the server to actually return data (or confirm it's empty)
    // before seeding, so we don't flash stale content.
    if (sessionId && messages === undefined) return;
    if (messages && messages.length > 0) {
      setLocalMessages(
        messages.map((m: { role: string; content: string }) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        })),
      );
    } else if (!sessionId && !fresh) {
      setLocalMessages([WELCOME]);
    }
    loadedSessionRef.current = sessionId;
  }, [messages, pendingUserMsg, sessionId, fresh]);

  useEffect(() => {
    const t = setTimeout(() => loadSessions(search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Keep the conversation pinned to the latest message.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [localMessages, isPending]);

  const invalidateLive = () => {
    ["/api/leads", "/api/projects", "/api/tasks", "/api/notes", "/api/reminders", "/api/meetings", "/api/team-members"].forEach(
      (k) => queryClient.invalidateQueries({ queryKey: [k] }),
    );
  };

  const sendToAssistant = (content: string): Promise<string> => {
    if (!content.trim() || isPending) return Promise.resolve("");
    const uiStart = performance.now();
    setPendingUserMsg(content);
    setLocalMessages((prev) => [...prev, { role: "user", content }]);
    setMessage("");

    return new Promise<string>((resolve) => {
      sendMessage(
        { data: { message: content, conversationId: sessionId ?? undefined } },
        {
          onSuccess: (data: { conversationId: string; reply: string; actions?: unknown[] }) => {
            setSessionId(data.conversationId);
            loadedSessionRef.current = data.conversationId;
            setFresh(false);
            setLocalMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
            setPendingUserMsg(null);
            if ((data.actions?.length ?? 0) > 0) invalidateLive();
            loadSessions(search);
            // Refresh the thread cache so future syncs reflect this turn.
            queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(data.conversationId) });
            if (import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.log("[VOICE-CHAT] request-received", data.conversationId);
              // eslint-disable-next-line no-console
              console.log(`[EA-DESK] UI round-trip: ${Math.round(performance.now() - uiStart)} ms`);
              // eslint-disable-next-line no-console
              console.log("[VOICE-CHAT] response-ready");
            }
            resolve(data.reply);
          },
          onError: () => {
            setPendingUserMsg(null);
            setLocalMessages((prev) => [
              ...prev,
              { role: "assistant", content: "Something went wrong — give it another try." },
            ]);
            resolve("");
          },
        },
      );
    });
  };

  const handleSend = (content: string) => {
    void sendToAssistant(content);
  };

  // Keep the voice layer pointed at the latest sender implementation.
  sendRef.current = sendToAssistant;

  const newChat = () => {
    setFresh(true);
    setSessionId(null);
    setLocalMessages([WELCOME]);
    didResume.current = true;
    setHistoryDrawerOpen(false);
  };

  const openSession = (id: string) => {
    setFresh(false);
    setSessionId(id);
    setPendingUserMsg(null);
    setHistoryDrawerOpen(false);
  };

  const patchSession = async (id: string, patch: Record<string, unknown>) => {
    try {
      await fetcher<{ session: Session }>(`/api/orchestrator/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      } as RequestInit);
    } catch {
      /* ignore */
    }
    loadSessions(search);
  };

  const deleteSession = async (id: string) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await fetcher<{ ok: boolean }>(`/api/orchestrator/sessions/${id}`, { method: "DELETE" } as RequestInit);
    } catch {
      /* ignore */
    }
    if (sessionId === id) newChat();
    loadSessions(search);
  };

  const renameSession = (s: Session) => {
    const next = window.prompt("Rename conversation", s.title ?? "");
    if (next && next.trim()) patchSession(s.id, { title: next.trim() });
  };

  const pinned = sessions.filter((s) => s.pinned && s.status !== "deleted");
  const rest = sessions.filter((s) => !s.pinned && s.status !== "deleted");
  const buckets: Record<string, Session[]> = { pinned, today: [], yesterday: [], last7: [], older: [] };
  for (const s of rest) buckets[groupBucket(s.lastMessageAt)].push(s);

  const isEmptyConversation = localMessages.length <= 1 && !pendingUserMsg;
  const activeSession = sessions.find((s) => s.id === sessionId);
  const activeFor = formatActiveDuration(activeSession?.lastMessageAt ?? activeSession?.createdAt);

  const renderBucket = (key: string, list: Session[]) => {
    if (list.length === 0) return null;
    return (
      <div key={key} className="space-y-2">
        <p className="px-1 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {BUCKET_LABELS[key]}
        </p>
        {list.map((s) => {
          const active = s.id === sessionId;
          return (
            <div
              key={s.id}
              className={cn(
                "group rounded-[1.2rem] border border-border bg-white/88 px-3 py-2.5 shadow-sm transition-transform hover:-translate-y-0.5",
                active && "ring-2 ring-zinc-950",
              )}
            >
              <button onClick={() => openSession(s.id)} className="flex w-full items-start gap-2 text-left">
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{s.title || "New conversation"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.messageCount} messages{s.status === "archived" ? " · Archived" : ""}
                  </p>
                </div>
              </button>
              <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  title={s.pinned ? "Unpin" : "Pin"}
                  onClick={() => patchSession(s.id, { pinned: !s.pinned })}
                  className="rounded-md p-1 text-muted-foreground hover:bg-slate-100"
                >
                  {s.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </button>
                <button title="Rename" onClick={() => renameSession(s)} className="rounded-md p-1 text-muted-foreground hover:bg-slate-100">
                  <PencilIcon />
                </button>
                <button
                  title={s.status === "archived" ? "Unarchive" : "Archive"}
                  onClick={() => patchSession(s.id, { status: s.status === "archived" ? "active" : "archived" })}
                  className="rounded-md p-1 text-muted-foreground hover:bg-slate-100"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
                <button title="Delete" onClick={() => deleteSession(s.id)} className="rounded-md p-1 text-rose-500 hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const historyBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border/60 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">History</p>
          <Button variant="outline" size="sm" onClick={newChat} className="h-8 rounded-[1rem]">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="h-10 rounded-[1.2rem] border-2 border-border bg-white/90 pl-9 text-sm"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {sessionsLoading && sessions.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">Loading…</p>
        ) : (
          ["pinned", "today", "yesterday", "last7", "older"].map((k) => renderBucket(k, buckets[k] ?? []))
        )}
        {!sessionsLoading && sessions.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">No conversations yet.</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      {/* History — collapsible in-flow panel on desktop (default 280px) */}
      {historyPinned ? (
        <aside className="hidden w-[280px] shrink-0 border-r border-border/60 bg-white/70 backdrop-blur-xl xl:flex xl:flex-col">
          {historyBody}
        </aside>
      ) : null}

      {/* History — drawer on mobile/tablet */}
      <Sheet open={historyDrawerOpen} onOpenChange={setHistoryDrawerOpen}>
        <SheetContent side="left" className="w-full max-w-[300px] border-r border-border bg-white p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Conversation history</SheetTitle>
          </SheetHeader>
          {historyBody}
        </SheetContent>
      </Sheet>

      {/* Conversation column: header / conversation / input */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {/* Toggle history: drawer on mobile, pin/unpin on desktop */}
            <button
              onClick={() => setHistoryDrawerOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-white/80 shadow-sm xl:hidden"
              aria-label="Open history"
            >
              <PanelLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => setHistoryPinned((v) => !v)}
              className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-border bg-white/80 shadow-sm transition-transform hover:-translate-y-0.5 xl:flex"
              aria-label={historyPinned ? "Hide history" : "Show history"}
              title={historyPinned ? "Hide history" : "Show history"}
            >
              {historyPinned ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeft className="h-5 w-5" />}
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">EA Desk</p>
              <p className="truncate font-display text-lg font-bold tracking-[-0.05em]">
                {historyLoading ? "Loading…" : fresh ? "New conversation" : "Executive Assistant"}
              </p>
            </div>
          </div>
            <div className="flex items-center gap-2">
              <VoiceStatusBadge />
              <StatusPill label="Signal" value={pendingUserMsg ? "Acting" : "Live"} tone={pendingUserMsg ? "attention" : "active"} />
              <Button variant="outline" size="sm" onClick={newChat} className="hidden rounded-[1.2rem] sm:inline-flex">
              <Plus className="h-3.5 w-3.5" /> New chat
            </Button>
          </div>
        </div>

        {/* Conversation — the single scroll region (>=70% of vertical space) */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="reading-column px-4 py-8 sm:px-6">
            {isEmptyConversation ? (
              <div className="space-y-8">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-[1.5rem] border-2 border-border bg-rose-300 shadow-[6px_6px_0px_var(--shadow-ink)]">
                    <Bot className="h-8 w-8 text-zinc-950" />
                  </div>
                  <div className="space-y-2">
                    <h1 className="font-display text-3xl font-bold tracking-[-0.05em] sm:text-4xl">
                      How can I help you run the company?
                    </h1>
                    <p className="mx-auto max-w-xl text-base text-muted-foreground">
                      I remember our conversations and execute real actions across your workspace — no wall of questions.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Create something</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SUGGESTION_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        onClick={() => handleSend(chip.prompt)}
                        disabled={isPending}
                        className="rounded-[1.2rem] border border-border bg-white/88 px-4 py-3 text-left text-sm text-slate-700 shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Or ask</p>
                  <div className="space-y-2">
                    {THOUGHT_STARTERS.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleSend(prompt)}
                        disabled={isPending}
                        className="w-full rounded-[1.2rem] border border-border bg-white/88 px-4 py-3 text-left text-sm text-slate-700 shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {activeFor && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    Conversation active for {activeFor} · your assistant remembers everything.
                  </p>
                )}
                {localMessages.map((msg, index) => {
                  const isLast = index === localMessages.length - 1;
                  const isStreamingAssistant = msg.role === "assistant" && isLast;
                  return (
                    <div key={`${msg.role}-${index}`} className={cn("flex gap-4", msg.role === "user" && "flex-row-reverse")}>
                      <div
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border-2 border-border shadow-[4px_4px_0px_var(--shadow-ink)]",
                          msg.role === "user" ? "bg-zinc-950 text-white" : "bg-rose-300 text-zinc-950",
                        )}
                      >
                        {msg.role === "user" ? <User className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                      </div>
                      <div
                        className={cn(
                          "max-w-[85%] rounded-[1.6rem] border-2 border-border px-5 py-4 shadow-[5px_5px_0px_var(--shadow-ink)]",
                          msg.role === "user" ? "bg-zinc-950 text-white" : "bg-sky-100/80 text-slate-800",
                        )}
                      >
                        {isStreamingAssistant ? (
                          <StreamingText text={msg.content} className="whitespace-pre-wrap text-[0.95rem] leading-7" />
                        ) : (
                          <p className="whitespace-pre-wrap text-[0.95rem] leading-7">{msg.content}</p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {pendingUserMsg && (isPending || voice.state === "thinking") ? (
                  <div className="flex gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border-2 border-border bg-rose-300 text-zinc-950 shadow-[4px_4px_0px_var(--shadow-ink)]">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div className="rounded-[1.6rem] border-2 border-border bg-sky-100/80 px-5 py-4 shadow-[5px_5px_0px_var(--shadow-ink)]">
                      <div className="flex items-center gap-2">
                        <span className="pulse-dot" />
                        <span className="text-sm text-slate-700">
                          {pendingUserMsg.toLowerCase().startsWith("create") ? "Creating…" : "Thinking…"}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Input — always visible */}
        <div className="shrink-0 border-t border-border/60 bg-white/75 px-4 py-4 backdrop-blur-xl sm:px-6">
          <div className="reading-column space-y-3">
            {!isEmptyConversation ? (
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {SUGGESTION_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() => handleSend(chip.prompt)}
                    disabled={isPending}
                    className="shrink-0 rounded-full border border-border bg-white/85 px-3.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-3">
              <VoiceControl className="shrink-0" />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSend(message);
                }}
                className="flex flex-1 gap-3"
              >
              <Input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Add a lead, start a project, log a task, or just ask…"
                className="h-14 flex-1 rounded-[1.35rem] border-2 border-border bg-white/90 px-5 text-sm shadow-sm focus-visible:ring-2"
                disabled={isPending}
              />
              <Button
                type="submit"
                disabled={isPending || !message.trim()}
                className="h-14 shrink-0 rounded-[1.35rem] bg-zinc-950 px-5 text-white shadow-[5px_5px_0px_var(--shadow-ink)] hover:bg-zinc-900"
              >
                <Send className="h-4 w-4" />
              </Button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
