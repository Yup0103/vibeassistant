import type { ChatEvent, ChatMessage } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<{ email: string }> {
  const res = await fetch("/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return json(res);
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", credentials: "include" });
}

export async function me(): Promise<{ email: string } | null> {
  const res = await fetch("/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  return json(res);
}

export async function getSession(): Promise<{ sessionId: string; mockMode: boolean }> {
  const res = await fetch("/chat/session", { credentials: "include" });
  return json(res);
}

export async function getHistory(sessionId: string): Promise<{ messages: ChatMessage[] }> {
  const res = await fetch(`/chat/history?sessionId=${encodeURIComponent(sessionId)}`, {
    credentials: "include",
  });
  return json(res);
}

export async function kiteMockLoginComplete(sessionId: string): Promise<void> {
  await fetch("/chat/kite-mock-login-complete", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

/**
 * POSTs to an SSE-emitting endpoint and yields parsed ChatEvents as they
 * arrive. Used for both /chat/message and /chat/confirm, which stream their
 * response the same way.
 */
async function* postSSE(url: string, body: unknown): AsyncGenerator<ChatEvent> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error ?? `Request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        yield JSON.parse(line.slice("data: ".length)) as ChatEvent;
      }
    }
  }
}

export function sendMessage(sessionId: string, text: string): AsyncGenerator<ChatEvent> {
  return postSSE("/chat/message", { sessionId, text });
}

export function confirmTool(
  sessionId: string,
  toolUseId: string,
  decision: "allow" | "deny"
): AsyncGenerator<ChatEvent> {
  return postSSE("/chat/confirm", { sessionId, toolUseId, decision });
}
