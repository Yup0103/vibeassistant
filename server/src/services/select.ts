import { MockAgentService } from "./mock-agent.js";
import type { AgentService } from "./agent-interface.js";

export const MOCK_MODE = (process.env.MOCK_MODE ?? "true") !== "false";

// The real service is imported lazily so a missing ANTHROPIC_API_KEY /
// MA_AGENT_ID doesn't crash the process when running in mock mode.
const mockInstance = MOCK_MODE ? new MockAgentService() : null;

export const mockAgentInstance: MockAgentService | null = mockInstance;

export const agentService: AgentService = await (async (): Promise<AgentService> => {
  if (MOCK_MODE) return mockInstance as MockAgentService;
  const { RealAgentService } = await import("./agent.js");
  return new RealAgentService();
})();
