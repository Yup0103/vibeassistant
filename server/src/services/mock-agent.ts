import { randomUUID } from "node:crypto";
import type { AgentService, ChatEvent } from "./agent-interface.js";

/**
 * In-memory simulator of the real Managed Agents + MCP flow. Exists so the
 * whole UX — chat, Kite's daily login prompt, Swiggy's confirm-before-order
 * gate — can be exercised end to end with zero external accounts.
 *
 * Rules of thumb baked in here (mirroring the resolved auth research):
 *  - "Kite" access is per-session and expires daily -> simulated as a login
 *    prompt the first time a session asks about the portfolio.
 *  - "Swiggy" ordering is gated by permission_policy: always_ask -> simulated
 *    as a pending tool_use that only completes after confirmTool("allow").
 */

interface SessionState {
  kiteLoggedIn: boolean;
  pendingToolUseId: string | null;
  pendingOrderText: string;
}

const sessions = new Map<string, SessionState>();

function getState(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { kiteLoggedIn: false, pendingToolUseId: null, pendingOrderText: "" };
    sessions.set(sessionId, state);
  }
  return state;
}

const PORTFOLIO_KEYWORDS = ["portfolio", "holding", "holdings", "invest", "stock", "quote", "p&l", "pnl"];
const ORDER_KEYWORDS = ["order", "lunch", "dinner", "breakfast", "food", "hungry", "swiggy", "grocery"];

function matches(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

export class MockAgentService implements AgentService {
  async createSession(_userId: string): Promise<{ sessionId: string }> {
    const sessionId = randomUUID();
    sessions.set(sessionId, { kiteLoggedIn: false, pendingToolUseId: null, pendingOrderText: "" });
    return { sessionId };
  }

  async *sendMessage(sessionId: string, text: string): AsyncGenerator<ChatEvent> {
    const state = getState(sessionId);

    if (state.pendingToolUseId) {
      yield {
        type: "agent.message",
        text: "There's already an order waiting on your confirmation above — tap Confirm or Deny before we do anything else.",
      };
      yield { type: "session.idle" };
      return;
    }

    if (matches(text, PORTFOLIO_KEYWORDS) && !state.kiteLoggedIn) {
      yield {
        type: "kite.login_required",
        // In real mode this is the actual link Kite MCP's `login` tool returns.
        loginUrl: "https://kite.zerodha.com/connect/login?mock=1",
      };
      yield { type: "session.idle" };
      return;
    }

    if (matches(text, PORTFOLIO_KEYWORDS) && state.kiteLoggedIn) {
      yield {
        type: "agent.message",
        text:
          "Your portfolio is worth ₹4,52,300 today (+1.2%, +₹5,380). Top holding: INFY, 340 shares, up 2.1%. " +
          "(Mock data — this is what Kite MCP's read-only holdings/quotes tools would return for real.)",
      };
      yield { type: "session.idle" };
      return;
    }

    if (matches(text, ORDER_KEYWORDS)) {
      const toolUseId = randomUUID();
      state.pendingToolUseId = toolUseId;
      state.pendingOrderText = text;
      yield {
        type: "agent.tool_use",
        toolUseId,
        server: "swiggy",
        toolName: "place_order",
        input: { query: text },
        evaluatedPermission: "ask",
        summary: `Order from your usual place — ₹342, ETA ~35 min. Based on: "${text}"`,
      };
      yield { type: "session.idle" };
      return;
    }

    yield {
      type: "agent.message",
      text:
        "I can check your portfolio (try \"how's my portfolio doing\") or order food (try \"order me lunch\"). " +
        "This is the mock agent — swap MOCK_MODE=false once real credentials are wired up.",
    };
    yield { type: "session.idle" };
  }

  async *confirmTool(
    sessionId: string,
    toolUseId: string,
    decision: "allow" | "deny"
  ): AsyncGenerator<ChatEvent> {
    const state = getState(sessionId);

    if (state.pendingToolUseId !== toolUseId) {
      yield { type: "session.error", message: "That confirmation is no longer pending." };
      yield { type: "session.idle" };
      return;
    }

    state.pendingToolUseId = null;

    if (decision === "deny") {
      yield { type: "agent.tool_result", toolUseId, summary: "Order cancelled — nothing was placed." };
      yield { type: "agent.message", text: "Cancelled. Let me know if you want something else." };
      yield { type: "session.idle" };
      return;
    }

    yield { type: "agent.tool_result", toolUseId, summary: "Order placed. ETA ~35 minutes." };
    yield { type: "agent.message", text: "Done — order's on its way, ETA about 35 minutes." };
    yield { type: "session.idle" };
  }

  /** Mock-only helper: the frontend calls this after the user "clicks through" the fake Kite login link. */
  completeKiteLogin(sessionId: string): void {
    getState(sessionId).kiteLoggedIn = true;
  }
}
