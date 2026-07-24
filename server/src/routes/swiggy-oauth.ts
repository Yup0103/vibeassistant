import { Router } from "express";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { db } from "../db.js";
import { MOCK_MODE } from "../services/select.js";

/**
 * Swiggy MCP's OAuth 2.1 + PKCE flow, per the resolved auth research (see the
 * prototype spec §3): standard RFC 8414/9728 discovery, RFC 7591 Dynamic
 * Client Registration, authorization_code grant only (no refresh token in
 * v1.0 — access tokens last 5 days, then this whole flow runs again).
 *
 * In MOCK_MODE this router isn't wired up (there's nothing real to call) —
 * see index.ts. In real mode, `SWIGGY_MCP_URL` must point at the base URL
 * whose `/.well-known/oauth-authorization-server` Swiggy's dashboard gives
 * you, and the production redirect URI must already be on Swiggy's allowlist
 * (see the prototype spec §6 — email builders@swiggy.in ahead of time).
 */

export const swiggyOAuthRouter = Router();
swiggyOAuthRouter.use(requireAuth);

const SWIGGY_MCP_URL = process.env.SWIGGY_MCP_URL ?? "";
const SWIGGY_REDIRECT_URI = process.env.SWIGGY_REDIRECT_URI ?? "http://localhost:5174/swiggy/oauth/callback";

// In-memory PKCE state, keyed by the `state` param — fine for a single-user
// prototype; a restart mid-flow just means the user starts over.
interface PendingAuth {
  codeVerifier: string;
  userId: string;
}
const pending = new Map<string, PendingAuth>();

let cachedClientId: string | null = process.env.SWIGGY_CLIENT_ID || null;

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function discover(): Promise<{ authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string }> {
  const res = await fetch(new URL("/.well-known/oauth-authorization-server", SWIGGY_MCP_URL).toString());
  if (!res.ok) throw new Error(`OAuth discovery failed: ${res.status}`);
  return res.json() as any;
}

async function ensureClientId(registrationEndpoint: string | undefined): Promise<string> {
  if (cachedClientId) return cachedClientId;
  if (!registrationEndpoint) {
    throw new Error("No SWIGGY_CLIENT_ID configured and the server didn't advertise a registration_endpoint");
  }
  // Dynamic Client Registration (RFC 7591) — one-time, result should be
  // persisted (e.g. back into .env) rather than re-registered on every boot.
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [SWIGGY_REDIRECT_URI],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) throw new Error(`Dynamic client registration failed: ${res.status}`);
  const body = (await res.json()) as { client_id: string };
  cachedClientId = body.client_id;
  console.log(`Registered Swiggy MCP OAuth client: ${cachedClientId} — consider saving this as SWIGGY_CLIENT_ID`);
  return cachedClientId;
}

swiggyOAuthRouter.get("/start", async (req: AuthedRequest, res) => {
  if (MOCK_MODE) return res.status(400).json({ error: "not available in MOCK_MODE" });
  if (!SWIGGY_MCP_URL) return res.status(500).json({ error: "SWIGGY_MCP_URL is not configured" });

  try {
    const { authorization_endpoint, registration_endpoint } = await discover();
    const clientId = await ensureClientId(registration_endpoint);

    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
    const state = randomUUID();
    pending.set(state, { codeVerifier, userId: req.userId! });

    const url = new URL(authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", SWIGGY_REDIRECT_URI);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "mcp:tools mcp:resources");

    res.redirect(url.toString());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

swiggyOAuthRouter.get("/callback", async (req: AuthedRequest, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || !pending.has(state)) {
    return res.status(400).send("Invalid or expired OAuth callback.");
  }
  const { codeVerifier, userId } = pending.get(state)!;
  pending.delete(state);

  try {
    const { token_endpoint } = await discover();
    const tokenRes = await fetch(token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: SWIGGY_REDIRECT_URI,
        code_verifier: codeVerifier,
        client_id: cachedClientId ?? "",
      }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const token = (await tokenRes.json()) as { access_token: string; expires_in?: number };

    // TODO (next real-mode step): write `token.access_token` into a Managed
    // Agents vault credential (client.beta.vaults.credentials.create, type
    // "mcp_oauth", mcp_server_url: SWIGGY_MCP_URL) and attach the vault's ID
    // via `vault_ids` on the session in RealAgentService.createSession().
    // Omit the `refresh` block entirely — Swiggy has no refresh grant in
    // v1.0 (see prototype spec §3), so re-run this whole flow when it 401s,
    // roughly every 5 days.
    db.prepare(
      "INSERT OR REPLACE INTO vault_refs (id, user_id, vault_id, swiggy_credential_id) VALUES (?, ?, NULL, ?)"
    ).run(randomUUID(), userId, `pending-vault-write:${token.access_token.slice(0, 8)}...`);

    res.send("Swiggy account linked. You can close this tab and go back to the assistant.");
  } catch (err) {
    res.status(500).send(`Swiggy OAuth failed: ${(err as Error).message}`);
  }
});
