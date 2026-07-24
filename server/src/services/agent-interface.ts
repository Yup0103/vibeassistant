/**
 * Shared contract between the mock agent (services/mock-agent.ts) and the real
 * Managed Agents client (services/agent.ts). The chat route only talks to this
 * interface, so flipping MOCK_MODE doesn't touch route/UI code at all.
 */

export type EvaluatedPermission = "allow" | "ask";

export type ChatEvent =
  | { type: "agent.message"; text: string }
  | {
      type: "agent.tool_use";
      toolUseId: string;
      server: "kite" | "swiggy";
      toolName: string;
      input: Record<string, unknown>;
      evaluatedPermission: EvaluatedPermission;
      /** Human-readable summary of what this tool call would do — shown on the confirm card. */
      summary: string;
    }
  | { type: "agent.tool_result"; toolUseId: string; summary: string }
  | { type: "kite.login_required"; loginUrl: string }
  | { type: "session.idle" }
  | { type: "session.error"; message: string };

export interface AgentService {
  /** Create (or resume) the conversation session for this user. */
  createSession(userId: string): Promise<{ sessionId: string }>;

  /** Send a user message and stream back events until the turn goes idle. */
  sendMessage(sessionId: string, text: string): AsyncGenerator<ChatEvent>;

  /** Respond to a pending agent.tool_use that was evaluatedPermission "ask". */
  confirmTool(
    sessionId: string,
    toolUseId: string,
    decision: "allow" | "deny"
  ): AsyncGenerator<ChatEvent>;
}
