import Anthropic from "@anthropic-ai/sdk";
import type { AgentService, ChatEvent } from "./agent-interface.js";

/**
 * Real Managed Agents integration. Requires ANTHROPIC_API_KEY, MA_AGENT_ID,
 * and MA_ENVIRONMENT_ID (created once via `npm run setup-agent`).
 *
 * This is written from the documented Managed Agents API shapes (agents /
 * environments / sessions / events, mcp_toolset with permission_policy).
 * Managed Agents is beta — before flipping MOCK_MODE=false, run `tsc` with
 * the installed @anthropic-ai/sdk types and fix any event/field names that
 * have shifted since this was written; the `as any` casts below are exactly
 * the spots to double-check first.
 */

const client = new Anthropic(); // resolves ANTHROPIC_API_KEY from env

const AGENT_ID = process.env.MA_AGENT_ID ?? "";
const ENVIRONMENT_ID = process.env.MA_ENVIRONMENT_ID ?? "";

function serverNameFor(mcpServerName: string | undefined): "kite" | "swiggy" {
  return mcpServerName?.toLowerCase().includes("kite") ? "kite" : "swiggy";
}

export class RealAgentService implements AgentService {
  constructor() {
    if (!AGENT_ID || !ENVIRONMENT_ID) {
      throw new Error(
        "MA_AGENT_ID / MA_ENVIRONMENT_ID are not set — run `npm run setup-agent` once, then put the printed IDs in .env"
      );
    }
  }

  async createSession(userId: string): Promise<{ sessionId: string }> {
    const session = await (client as any).beta.sessions.create({
      agent: AGENT_ID,
      environment_id: ENVIRONMENT_ID,
      title: `assistant-${userId}`,
    });
    return { sessionId: session.id };
  }

  async *sendMessage(sessionId: string, text: string): AsyncGenerator<ChatEvent> {
    yield* this.streamUntilIdle(sessionId, () =>
      (client as any).beta.sessions.events.send(sessionId, {
        events: [{ type: "user.message", content: [{ type: "text", text }] }],
      })
    );
  }

  async *confirmTool(
    sessionId: string,
    toolUseId: string,
    decision: "allow" | "deny"
  ): AsyncGenerator<ChatEvent> {
    yield* this.streamUntilIdle(sessionId, () =>
      (client as any).beta.sessions.events.send(sessionId, {
        events: [{ type: "user.tool_confirmation", tool_use_id: toolUseId, result: decision }],
      })
    );
  }

  /**
   * Stream-first pattern: open the event stream BEFORE sending, since events
   * emitted before a stream connects are never delivered to it. Reads until
   * the session goes idle with a terminal stop_reason (anything other than
   * "requires_action", which means we're paused on a confirmation we already
   * surfaced to the caller as an agent.tool_use event).
   */
  private async *streamUntilIdle(
    sessionId: string,
    send: () => Promise<unknown>
  ): AsyncGenerator<ChatEvent> {
    const stream = await (client as any).beta.sessions.events.stream(sessionId);
    await send();

    for await (const event of stream as AsyncIterable<any>) {
      switch (event.type) {
        case "agent.message": {
          const text = (event.content ?? [])
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          if (text) yield { type: "agent.message", text };
          break;
        }

        case "agent.mcp_tool_use":
        case "agent.tool_use": {
          if (event.evaluated_permission === "ask") {
            yield {
              type: "agent.tool_use",
              toolUseId: event.id,
              server: serverNameFor(event.mcp_server_name),
              toolName: event.name,
              input: event.input ?? {},
              evaluatedPermission: "ask",
              summary: `${event.name}(${JSON.stringify(event.input ?? {})})`,
            };
          }
          break;
        }

        case "agent.mcp_tool_result":
        case "agent.tool_result": {
          yield {
            type: "agent.tool_result",
            toolUseId: event.tool_use_id ?? "",
            summary: "Tool call completed.",
          };
          break;
        }

        case "session.error": {
          yield { type: "session.error", message: event.error?.message ?? "Unknown session error" };
          break;
        }

        case "session.status_idle": {
          if (event.stop_reason?.type === "requires_action") {
            // Paused on a confirmation — stop here; the frontend renders the
            // confirm card and calls confirmTool() to resume the stream.
            return;
          }
          yield { type: "session.idle" };
          return;
        }

        case "session.status_terminated":
          yield { type: "session.idle" };
          return;

        default:
          break; // span.*, session.status_running, etc. — nothing to surface
      }
    }
  }
}
