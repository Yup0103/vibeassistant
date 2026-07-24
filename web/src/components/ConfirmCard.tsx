import type { ChatEvent } from "../types";

type ToolUseEvent = Extract<ChatEvent, { type: "agent.tool_use" }>;

export function ConfirmCard({
  event,
  onDecide,
  busy,
}: {
  event: ToolUseEvent;
  onDecide: (decision: "allow" | "deny") => void;
  busy: boolean;
}) {
  return (
    <div className="card">
      <span className="label">{event.server} · needs your confirmation</span>
      <div>{event.summary}</div>
      <div className="actions">
        <button className="confirm" disabled={busy} onClick={() => onDecide("allow")}>
          Confirm
        </button>
        <button className="deny" disabled={busy} onClick={() => onDecide("deny")}>
          Deny
        </button>
      </div>
    </div>
  );
}
