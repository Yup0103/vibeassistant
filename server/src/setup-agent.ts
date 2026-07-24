/**
 * One-time setup: creates the Managed Agents Agent + Environment declaring
 * Kite MCP and Swiggy MCP, with the permission policy table from the
 * prototype spec baked in (read-only tools always_allow, order/trade tools
 * always_ask). Run with `npm run setup-agent`, then copy the printed IDs
 * into .env as MA_AGENT_ID / MA_ENVIRONMENT_ID.
 *
 * Requires ANTHROPIC_API_KEY. Requires KITE_MCP_URL and SWIGGY_MCP_URL to be
 * set — Kite's hosted URL is fixed (https://mcp.kite.trade/mcp); Swiggy's is
 * whatever your Builders Club dashboard shows for the service(s) you want.
 *
 * NOTE: as documented in the prototype spec, Kite MCP authenticates the
 * connection itself (per-session interactive login), not a portable token —
 * so it is declared here as an mcp_server, but no vault credential is ever
 * created for it. Swiggy's OAuth token belongs in a vault, created separately
 * once you've completed its OAuth flow via /swiggy/oauth/start.
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const KITE_MCP_URL = process.env.KITE_MCP_URL ?? "https://mcp.kite.trade/mcp";
const SWIGGY_MCP_URL = process.env.SWIGGY_MCP_URL ?? "";

async function main() {
  if (!SWIGGY_MCP_URL) {
    console.warn(
      "SWIGGY_MCP_URL is not set in .env — the agent will be created with Kite MCP only. " +
        "Fill it in and re-run once you have it from Swiggy's Builders Club dashboard."
    );
  }

  const environment = await (client as any).beta.environments.create({
    name: "mcp-life-assistant-env",
    config: { type: "cloud", networking: { type: "unrestricted" } },
  });
  console.log(`Environment created: ${environment.id}`);

  const mcpServers = [
    { type: "url", name: "kite", url: KITE_MCP_URL },
    ...(SWIGGY_MCP_URL ? [{ type: "url", name: "swiggy", url: SWIGGY_MCP_URL }] : []),
  ];

  // Permission policy table (from the prototype spec, §4):
  //   view holdings / positions / quotes        -> always_allow
  //   place / modify / cancel a trade order      -> always_ask
  //   search restaurants / groceries, build cart -> always_allow
  //   place an order / complete checkout         -> always_ask
  const tools = [
    {
      type: "mcp_toolset",
      mcp_server_name: "kite",
      default_config: { enabled: true, permission_policy: { type: "always_allow" } },
      configs: [
        { name: "place_order", permission_policy: { type: "always_ask" } },
        { name: "modify_order", permission_policy: { type: "always_ask" } },
        { name: "cancel_order", permission_policy: { type: "always_ask" } },
        { name: "place_gtt", permission_policy: { type: "always_ask" } },
      ],
    },
    ...(SWIGGY_MCP_URL
      ? [
          {
            type: "mcp_toolset",
            mcp_server_name: "swiggy",
            default_config: { enabled: true, permission_policy: { type: "always_allow" } },
            configs: [{ name: "place_order", permission_policy: { type: "always_ask" } }],
          },
        ]
      : []),
  ];

  const agent = await (client as any).beta.agents.create({
    name: "Personal MCP Life Assistant",
    model: "claude-opus-4-8",
    system:
      "You are a personal assistant with access to the user's Zerodha (Kite) portfolio and Swiggy account. " +
      "Always confirm the exact order or trade details back to the user before any action that requires confirmation " +
      "actually executes. Never place an order or trade the tool policy doesn't auto-allow without an explicit " +
      "confirmation event from the user.",
    mcp_servers: mcpServers,
    tools,
  });
  console.log(`Agent created: ${agent.id} (version ${agent.version})`);

  console.log("\nAdd these to server/.env:\n");
  console.log(`MA_AGENT_ID=${agent.id}`);
  console.log(`MA_ENVIRONMENT_ID=${environment.id}`);
}

main().catch((err) => {
  console.error("setup-agent failed:", err);
  process.exit(1);
});
