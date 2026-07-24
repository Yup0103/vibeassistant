// Mirrors server/src/services/agent-interface.ts's ChatEvent — kept as a
// plain duplicate since the two projects don't share a package for v0.

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
      summary: string;
    }
  | { type: "agent.tool_result"; toolUseId: string; summary: string }
  | {
      type: "agent.chart";
      title: string;
      unit: "inr" | "pct";
      points: { label: string; value: number }[];
      changePct: number;
    }
  | { type: "kite.login_required"; loginUrl: string }
  | { type: "session.idle" }
  | { type: "session.error"; message: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}
