import { useEffect, useRef, useState } from "react";
import { getSession, getHistory, sendMessage, confirmTool, logout } from "../api";
import type { ChatEvent } from "../types";
import { ConfirmCard } from "./ConfirmCard";
import { KiteLoginPrompt } from "./KiteLoginPrompt";

type ToolUseEvent = Extract<ChatEvent, { type: "agent.tool_use" }>;

type TimelineItem =
  | { id: string; kind: "user" | "assistant" | "error"; text: string }
  | { id: string; kind: "tool_use"; event: ToolUseEvent; resolved?: string }
  | { id: string; kind: "kite_login"; loginUrl: string; resolved?: boolean };

let idCounter = 0;
const nextId = () => `item-${++idCounter}`;

export function Chat({ email }: { email: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const lastPendingText = useRef<string>("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      setSessionId(session.sessionId);
      setMockMode(session.mockMode);
      const history = await getHistory(session.sessionId);
      setTimeline(
        history.messages.map((m) => ({ id: nextId(), kind: m.role, text: m.content }))
      );
    })();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [timeline]);

  function append(item: TimelineItem) {
    setTimeline((prev) => [...prev, item]);
  }

  async function consume(gen: AsyncGenerator<ChatEvent>) {
    for await (const event of gen) {
      switch (event.type) {
        case "agent.message":
          append({ id: nextId(), kind: "assistant", text: event.text });
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
        case "kite.login_required":
          append({ id: nextId(), kind: "kite_login", loginUrl: event.loginUrl });
          break;
        case "session.error":
          append({ id: nextId(), kind: "error", text: event.message });
          break;
        case "session.idle":
          break;
      }
    }
  }

  async function handleSend(text: string) {
    if (!sessionId || !text.trim()) return;
    lastPendingText.current = text;
    append({ id: nextId(), kind: "user", text });
    setInput("");
    setBusy(true);
    try {
      await consume(sendMessage(sessionId, text));
    } catch (err) {
      append({ id: nextId(), kind: "error", text: (err as Error).message });
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
      append({ id: nextId(), kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function handleKiteLoginCompleted(itemId: string) {
    setTimeline((prev) => prev.map((i) => (i.id === itemId ? { ...i, resolved: true } as TimelineItem : i)));
    if (lastPendingText.current) void handleSend(lastPendingText.current);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Assistant</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {mockMode && <span className="mock-badge">mock mode</span>}
          <button onClick={() => logout().then(() => window.location.reload())}>Sign out</button>
        </div>
      </header>

      <div className="message-list" ref={listRef}>
        {timeline.map((item) => {
          if (item.kind === "user" || item.kind === "assistant" || item.kind === "error") {
            return (
              <div key={item.id} className={`msg ${item.kind}`}>
                {item.text}
              </div>
            );
          }
          if (item.kind === "tool_use") {
            if (item.resolved) {
              return (
                <div key={item.id} className="card">
                  <span className="label">{item.event.server}</span>
                  <div>{item.resolved}</div>
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
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${email.split("@")[0]}'s assistant…`}
          disabled={busy || !sessionId}
        />
        <button type="submit" disabled={busy || !sessionId || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
