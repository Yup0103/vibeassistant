import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { agentService, mockAgentInstance, MOCK_MODE } from "../services/select.js";
import type { ChatEvent } from "../services/agent-interface.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

interface ChatSessionRow {
  id: string;
  user_id: string;
  ma_session_id: string | null;
}

async function getOrCreateSession(userId: string): Promise<ChatSessionRow> {
  const existing = db
    .prepare("SELECT id, user_id, ma_session_id FROM chat_sessions WHERE user_id = ? AND status = 'active' LIMIT 1")
    .get(userId) as ChatSessionRow | undefined;
  if (existing) return existing;

  const { sessionId: maSessionId } = await agentService.createSession(userId);
  const id = randomUUID();
  db.prepare(
    "INSERT INTO chat_sessions (id, user_id, ma_session_id, title, status) VALUES (?, ?, ?, ?, 'active')"
  ).run(id, userId, maSessionId, "Assistant");
  return { id, user_id: userId, ma_session_id: maSessionId };
}

chatRouter.get("/session", async (req: AuthedRequest, res) => {
  const session = await getOrCreateSession(req.userId!);
  res.json({ sessionId: session.id, mockMode: MOCK_MODE });
});

chatRouter.get("/history", (req: AuthedRequest, res) => {
  const sessionId = String(req.query.sessionId ?? "");
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  const rows = db
    .prepare("SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId);
  res.json({ messages: rows });
});

function startSSE(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function sendEvent(res: Response, event: ChatEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function recordMessage(sessionId: string, role: "user" | "assistant", content: string): void {
  if (!content) return;
  db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)").run(
    randomUUID(),
    sessionId,
    role,
    content
  );
}

function recordToolCall(sessionId: string, event: ChatEvent): void {
  if (event.type !== "agent.tool_use") return;
  db.prepare(
    `INSERT INTO tool_calls (id, session_id, tool_name, mcp_server, input_json, evaluated_permission)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    event.toolUseId,
    sessionId,
    event.toolName,
    event.server,
    JSON.stringify(event.input),
    event.evaluatedPermission
  );
}

function recordToolResult(event: ChatEvent, decision?: "allow" | "deny"): void {
  if (event.type !== "agent.tool_result") return;
  db.prepare(
    "UPDATE tool_calls SET result_summary = ?, user_decision = COALESCE(?, user_decision) WHERE id = ?"
  ).run(event.summary, decision ?? null, event.toolUseId);
}

/**
 * Streams ChatEvents from an async generator to the client over SSE, and
 * mirrors user-visible text / tool activity into the audit log and message
 * history tables as it goes.
 */
async function pipeToSSE(
  res: Response,
  sessionId: string,
  gen: AsyncGenerator<ChatEvent>,
  decision?: "allow" | "deny"
): Promise<void> {
  startSSE(res);
  let assistantText = "";
  try {
    for await (const event of gen) {
      if (event.type === "agent.message") assistantText += (assistantText ? "\n" : "") + event.text;
      if (event.type === "agent.tool_use") recordToolCall(sessionId, event);
      if (event.type === "agent.tool_result") recordToolResult(event, decision);
      sendEvent(res, event);
    }
  } catch (err) {
    sendEvent(res, { type: "session.error", message: (err as Error).message });
  } finally {
    if (assistantText) recordMessage(sessionId, "assistant", assistantText);
    res.end();
  }
}

chatRouter.post("/message", async (req: AuthedRequest, res) => {
  const { sessionId, text } = req.body ?? {};
  if (!sessionId || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "sessionId and text are required" });
  }
  const row = db.prepare("SELECT ma_session_id FROM chat_sessions WHERE id = ? AND user_id = ?").get(
    sessionId,
    req.userId!
  ) as { ma_session_id: string } | undefined;
  if (!row) return res.status(404).json({ error: "session not found" });

  recordMessage(sessionId, "user", text);
  await pipeToSSE(res, sessionId, agentService.sendMessage(row.ma_session_id, text));
});

chatRouter.post("/confirm", async (req: AuthedRequest, res) => {
  const { sessionId, toolUseId, decision } = req.body ?? {};
  if (!sessionId || !toolUseId || (decision !== "allow" && decision !== "deny")) {
    return res.status(400).json({ error: "sessionId, toolUseId, and decision ('allow'|'deny') are required" });
  }
  const row = db.prepare("SELECT ma_session_id FROM chat_sessions WHERE id = ? AND user_id = ?").get(
    sessionId,
    req.userId!
  ) as { ma_session_id: string } | undefined;
  if (!row) return res.status(404).json({ error: "session not found" });

  await pipeToSSE(
    res,
    sessionId,
    agentService.confirmTool(row.ma_session_id, toolUseId, decision),
    decision
  );
});

// Mock-mode-only helper: the KiteLoginPrompt component calls this once the
// user "completes" the fake Zerodha login link, so subsequent portfolio
// questions in the mock agent behave as if Kite were authenticated.
chatRouter.post("/kite-mock-login-complete", (req: AuthedRequest, res) => {
  if (!MOCK_MODE || !mockAgentInstance) {
    return res.status(400).json({ error: "only available in MOCK_MODE" });
  }
  const { sessionId } = req.body ?? {};
  const row = db.prepare("SELECT ma_session_id FROM chat_sessions WHERE id = ? AND user_id = ?").get(
    sessionId,
    req.userId!
  ) as { ma_session_id: string } | undefined;
  if (!row) return res.status(404).json({ error: "session not found" });

  mockAgentInstance.completeKiteLogin(row.ma_session_id);
  res.status(204).end();
});
