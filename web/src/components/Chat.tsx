import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getSession, getHistory, sendMessage, confirmTool, logout } from "../api";
import type { ChatEvent } from "../types";
import { ConfirmCard } from "./ConfirmCard";
import { KiteLoginPrompt } from "./KiteLoginPrompt";
import { Chart } from "./Chart";
import { CheckIcon, LogOutIcon, SendIcon, SparkleIcon } from "../icons";

type ToolUseEvent = Extract<ChatEvent, { type: "agent.tool_use" }>;
type ChartEvent = Extract<ChatEvent, { type: "agent.chart" }>;

type TimelineItem =
  | { id: string; kind: "user" | "assistant" | "error"; text: string; time: string }
  | { id: string; kind: "tool_use"; event: ToolUseEvent; resolved?: string }
  | { id: string; kind: "kite_login"; loginUrl: string; resolved?: boolean }
  | { id: string; kind: "chart"; event: ChartEvent };

let idCounter = 0;
const nextId = () => `item-${++idCounter}`;

const SUGGESTIONS = [
  "How's my portfolio doing?",
  "What's RELIANCE trading at?",
  "Chart RELIANCE",
  "Order vada pav in Dadar",
];

function timeNow(): string {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function timeFrom(iso?: string): string {
  if (!iso) return timeNow();
  const d = new Date(iso.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? timeNow() : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function Chat({ email }: { email: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const lastPendingText = useRef<string>("");
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      setSessionId(session.sessionId);
      setMockMode(session.mockMode);
      const history = await getHistory(session.sessionId);
      setTimeline(
        history.messages.map((m) => ({ id: nextId(), kind: m.role, text: m.content, time: timeFrom(m.created_at) }))
      );
    })();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [timeline, busy]);

  function append(item: TimelineItem) {
    setTimeline((prev) => [...prev, item]);
  }

  async function consume(gen: AsyncGenerator<ChatEvent>) {
    for await (const event of gen) {
      switch (event.type) {
        case "agent.message":
          append({ id: nextId(), kind: "assistant", text: event.text, time: timeNow() });
          break;
        case "agent.tool_use":
          append({ id: nextId(), kind: "tool_use", event });
          break;
        case "agent.tool_result":
          setTimeline((prev) =>
            prev.map((item) =>
              item.kind === "tool_use" && item.event.toolUseId === event.toolUseId
                ? { ...item, resolved: event.summary }
                : item
            )
          );
          break;
        case "agent.chart":
          append({ id: nextId(), kind: "chart", event });
          break;
        case "kite.login_required":
          append({ id: nextId(), kind: "kite_login", loginUrl: event.loginUrl });
          break;
        case "session.error":
          append({ id: nextId(), kind: "error", text: event.message, time: timeNow() });
          break;
        case "session.idle":
          break;
      }
    }
  }

  async function handleSend(text: string) {
    if (!sessionId || !text.trim()) return;
    lastPendingText.current = text;
    append({ id: nextId(), kind: "user", text, time: timeNow() });
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setBusy(true);
    try {
      await consume(sendMessage(sessionId, text));
    } catch (err) {
      append({ id: nextId(), kind: "error", text: (err as Error).message, time: timeNow() });
    } finally {
      setBusy(false);
    }
  }

  async function handleDecide(toolUseId: string, decision: "allow" | "deny") {
    if (!sessionId) return;
    setBusy(true);
    try {
      await consume(confirmTool(sessionId, toolUseId, decision));
    } catch (err) {
      append({ id: nextId(), kind: "error", text: (err as Error).message, time: timeNow() });
    } finally {
      setBusy(false);
    }
  }

  function handleKiteLoginCompleted(itemId: string) {
    setTimeline((prev) => prev.map((i) => (i.id === itemId ? { ...i, resolved: true } as TimelineItem : i)));
    if (lastPendingText.current) void handleSend(lastPendingText.current);
  }

  function handleTextareaInput(value: string) {
    setInput(value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend(input);
    }
  }

  const showTyping = busy && (timeline.length === 0 || timeline[timeline.length - 1].kind === "user");

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-avatar pulse">
          <SparkleIcon size={18} />
        </div>
        <div className="app-header-text">
          <h1>Assistant</h1>
          <div className="subtitle">{email}</div>
        </div>
        {mockMode && <span className="mock-badge">mock mode</span>}
        <button
          className="icon-button"
          aria-label="Sign out"
          onClick={() => logout().then(() => window.location.reload())}
        >
          <LogOutIcon size={17} />
        </button>
      </header>

      {timeline.length === 0 && !busy ? (
        <div className="empty-state">
          <div className="app-avatar">
            <SparkleIcon size={24} />
          </div>
          <h2>Hi, I'm your assistant</h2>
          <p>Ask about your portfolio or get food ordered — I'll always check with you before anything that spends money.</p>
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion-chip" onClick={() => handleSend(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="message-list" ref={listRef}>
          {timeline.map((item) => {
            if (item.kind === "user" || item.kind === "assistant" || item.kind === "error") {
              if (item.kind === "error") return <div key={item.id} className="msg error">{item.text}</div>;
              return (
                <div key={item.id} className={`msg-row ${item.kind}`}>
                  {item.kind === "assistant" && (
                    <div className="bubble-avatar">
                      <SparkleIcon size={13} />
                    </div>
                  )}
                  <div className="msg-col">
                    <div className={`msg ${item.kind}`}>{item.text}</div>
                    <div className="msg-time">{item.time}</div>
                  </div>
                </div>
              );
            }
            if (item.kind === "tool_use") {
              if (item.resolved) {
                return (
                  <div key={item.id} className="resolved-card">
                    <div className="card-icon done">
                      <CheckIcon size={13} />
                    </div>
                    {item.resolved}
                  </div>
                );
              }
              return (
                <ConfirmCard
                  key={item.id}
                  event={item.event}
                  busy={busy}
                  onDecide={(decision) => handleDecide(item.event.toolUseId, decision)}
                />
              );
            }
            if (item.kind === "chart") {
              return <Chart key={item.id} event={item.event} />;
            }
            if (item.kind === "kite_login") {
              if (item.resolved) return null;
              return (
                <KiteLoginPrompt
                  key={item.id}
                  loginUrl={item.loginUrl}
                  mockMode={mockMode}
                  sessionId={sessionId ?? ""}
                  onCompleted={() => handleKiteLoginCompleted(item.id)}
                />
              );
            }
            return null;
          })}
          {showTyping && (
            <div className="msg-row assistant">
              <div className="bubble-avatar">
                <SparkleIcon size={13} />
              </div>
              <div className="typing-bubble">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend(input);
        }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => handleTextareaInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message your assistant…"
          disabled={busy || !sessionId}
        />
        <button className="send-button" type="submit" disabled={busy || !sessionId || !input.trim()} aria-label="Send">
          <SendIcon size={17} />
        </button>
      </form>
    </div>
  );
}
