import type { ChatEvent } from "../types";
import { CheckIcon, FoodIcon, TrendingIcon, XIcon } from "../icons";

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
  const isSwiggy = event.server === "swiggy";
  return (
    <div className="card">
      <div className="card-head">
        <div className={`card-icon ${isSwiggy ? "swiggy" : "kite"}`}>
          {isSwiggy ? <FoodIcon size={14} /> : <TrendingIcon size={14} />}
        </div>
        <span className="label">{isSwiggy ? "Swiggy" : "Kite"} · needs confirmation</span>
      </div>
      <div className="body">{event.summary}</div>
      <div className="actions">
        <button className="confirm" disabled={busy} onClick={() => onDecide("allow")}>
          <CheckIcon size={14} /> Confirm
        </button>
        <button className="deny" disabled={busy} onClick={() => onDecide("deny")}>
          <XIcon size={14} /> Deny
        </button>
      </div>
    </div>
  );
}
