# Personal MCP Life Assistant — Prototype

A private, single-user chat assistant that answers questions about your Zerodha portfolio (Kite MCP) and orders food on Swiggy (Swiggy MCP), with every money-moving or order-placing action gated behind an explicit confirmation. Built as a PWA + Node/TypeScript backend on Claude's Managed Agents platform.

This repo is the implementation of two earlier design docs — the market/phasing plan and the prototype spec (scope, architecture, security) — and specifically closes out the researched question of how each MCP server's auth actually works.

**Status: runs fully today in `MOCK_MODE` (no external accounts needed).** The real Managed Agents / Kite MCP / Swiggy MCP integration is written and type-checks, but needs real credentials to run live — see "Going live" below.

## Project layout

```
/server   Node + TypeScript + Express backend
/web      Vite + React + TypeScript PWA frontend
```

## Quick start (mock mode — works right now, no accounts needed)

```sh
cd server
npm install
cp .env.example .env
```

Generate a password hash and fill in `.env`:

```sh
node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"
```

Edit `server/.env`:
```
APP_USER_EMAIL=you@example.com
APP_USER_PASSWORD_HASH=<the hash printed above>
MOCK_MODE=true
```

Start the backend:
```sh
npm run dev            # listens on http://localhost:5174
```

In a second terminal:
```sh
cd web
npm install
npm run dev             # listens on http://localhost:5173, proxies /auth, /chat, /swiggy to :5174
```

Open `http://localhost:5173`, log in, and try:
- **"how's my portfolio doing"** → a mock Kite login prompt appears once, then holdings.
- **"order me lunch"** → a confirm card appears with a mock order summary; nothing happens until you tap Confirm.

Install it as a PWA from the browser's "Install app" / "Add to Home Screen" prompt.

## What's actually implemented

| Area | Mock mode | Real mode |
|---|---|---|
| Login / session | Real — bcrypt + signed httpOnly cookie | Same code, no change needed |
| Chat + SSE streaming | Real — full request/response plumbing | Same code, no change needed |
| Portfolio / Kite | Simulated response + simulated daily login prompt | Real Managed Agents session + Kite MCP `mcp_servers` entry |
| Food ordering / Swiggy | Simulated confirm-then-order flow | Real Managed Agents session + Swiggy MCP `mcp_toolset` with `permission_policy: always_ask` on `place_order` |
| Audit log | Real — every tool call, decision, and result is written to `tool_calls` | Same table, same code |
| Data model | Real — the 5-table SQLite schema from the spec, via Node's built-in `node:sqlite` | Same |

The `AgentService` interface (`server/src/services/agent-interface.ts`) is what makes this swap possible — `mock-agent.ts` and `agent.ts` both implement it, and the routes never know which one they're talking to.

## Going live — what's still needed

1. **Anthropic API key with Managed Agents (beta) access.** Set `ANTHROPIC_API_KEY` in `server/.env`.
2. **Kite MCP** — no account/credentials needed on your side; the hosted URL (`https://mcp.kite.trade/mcp`) is already the default in `.env.example`. Kite authenticates the *connection*, not a portable token (see "Known limitations" below) — nothing else to configure.
3. **Swiggy MCP** — get your server URL from Swiggy's Builders Club dashboard, set `SWIGGY_MCP_URL`. For local testing, `http://localhost:...` redirect URIs work without approval. Before deploying anywhere real, email **builders@swiggy.in** with your production redirect URI, scopes, and use case — this has a manual review, so start it early.
4. Run the one-time setup script to create the Agent + Environment:
   ```sh
   cd server
   npm run setup-agent
   ```
   Copy the two IDs it prints into `.env` as `MA_AGENT_ID` and `MA_ENVIRONMENT_ID`.
5. Set `MOCK_MODE=false` in `.env` and restart the server.
6. Complete the Swiggy OAuth link once via `GET /swiggy/oauth/start` (while logged in) — see `server/src/routes/swiggy-oauth.ts` for the exact PKCE flow. The one remaining TODO in that file is writing the resulting access token into a Managed Agents vault credential (`client.beta.vaults.credentials.create`, type `mcp_oauth`) and attaching it via `vault_ids` on session creation.

## Known limitations (researched, not assumed)

- **Kite has no portable token.** It authenticates the live session itself via an interactive login link — expect that prompt to reappear roughly once a day (Kite access tokens are valid for one trading day), not "connect once and forget."
- **Swiggy tokens expire in 5 days with no refresh grant yet** (v1.0 of their OAuth). Re-run the OAuth flow when it 401s; a "reconnect Swiggy" affordance in the UI is a natural next addition.
- **Managed Agents and both MCP servers are beta/recent** — expect field/event names in `agent.ts` to need small adjustments once you're type-checking against the exact SDK version you install; the `as any` casts in that file mark the spots most likely to need a tweak.
- Single user, single vault, single Agent — deliberately, for v0. Don't build multi-tenancy until there's a second real user.

## Security notes for this scaffold

- Session cookie is httpOnly, signed (`cookie-signature` + `SESSION_SECRET`), `sameSite: lax`. Set `COOKIE_SECURE=true` once served over HTTPS.
- Password is bcrypt-hashed; the hash lives in `.env`, never in source.
- `.env` is gitignored; `.env.example` is checked in with no real values.
- Every tool call (name, server, input, permission, user decision, result) is written to `tool_calls` for audit — query it directly via SQLite to answer "did it actually order what I asked for."
- Order/trade tools are `always_ask` by design (see `server/src/setup-agent.ts`) — loosen this deliberately, one tool at a time, never as a blanket change.
