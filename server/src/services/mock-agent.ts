import { randomUUID } from "node:crypto";
import type { AgentService, ChatEvent } from "./agent-interface.js";

/**
 * In-memory simulator of the real Managed Agents + MCP flow. Exists so the
 * whole UX — chat, Kite's daily login prompt, Swiggy's confirm-before-order
 * gate — can be exercised end to end with zero external accounts.
 *
 * Data shapes below are modeled on the real APIs, researched rather than
 * guessed:
 *  - Stock fields (`previousClose`/`dayChange`/derived `lastPrice`) mirror
 *    Kite Connect v3's quote/holdings endpoints, which report `close_price`,
 *    `last_price`, `day_change`, and `day_change_percentage` computed as
 *    (last_price - close_price) / close_price * 100 — i.e. against the
 *    previous close, not the current price. Price *levels* below are a fixed
 *    demo snapshot (not live data — live prices aren't fetchable server-side
 *    here) but are set to realistic large-cap ranges.
 *  - The Swiggy order flow's wording mirrors Swiggy's public MCP manifest
 *    (github.com/Swiggy/swiggy-mcp-server-manifest): restaurant search →
 *    menu browsing → cart → checkout, checkout currently COD-only per their
 *    docs.
 *
 * Test-only triggers baked in for exercising edge/error paths on demand:
 *  - Kite "session" re-expires every KITE_SESSION_LIMIT portfolio/quote
 *    replies after a login, mirroring Kite's real daily re-login requirement
 *    within a single demo conversation instead of never expiring.
 *  - An order whose text contains "test error" or "simulate failure" fails
 *    on confirm with a `session.error` event, to exercise the UI's error
 *    rendering without editing code.
 */

interface SessionState {
  kiteLoggedIn: boolean;
  kiteQueriesSinceLogin: number;
  pendingToolUseId: string | null;
  pendingOrderText: string;
}

const KITE_SESSION_LIMIT = 6;

const sessions = new Map<string, SessionState>();

function getState(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { kiteLoggedIn: false, kiteQueriesSinceLogin: 0, pendingToolUseId: null, pendingOrderText: "" };
    sessions.set(sessionId, state);
  }
  return state;
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function inr2(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- Market hours (IST, NSE equity session) -------------------------------

function isMarketOpenIST(): boolean {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + 5 * 60 + 30) % (24 * 60);
  const day = now.getUTCDay(); // close enough for a mock; ignores the IST midnight-rollover edge
  const isWeekday = day >= 1 && day <= 5;
  return isWeekday && istMinutes >= 9 * 60 + 15 && istMinutes <= 15 * 60 + 30;
}

function marketClosedNote(): string {
  return isMarketOpenIST() ? "" : " (Markets are closed right now — this reflects today's closing levels.)";
}

// --- Stock data (Kite MCP would return this from holdings/quote tools) ----
// Fixed demo snapshot — realistic large-cap price levels, not live data.

interface Stock {
  name: string;
  previousClose: number;
  dayChange: number;
  qty?: number; // present only for stocks the mock user actually holds
}

function lastPrice(s: Stock): number {
  return s.previousClose + s.dayChange;
}

function dayChangePct(s: Stock): number {
  return (s.dayChange / s.previousClose) * 100;
}

const STOCKS: Record<string, Stock> = {
  RELIANCE: { name: "Reliance Industries", previousClose: 2830.3, dayChange: 17.2, qty: 15 },
  TCS: { name: "Tata Consultancy Services", previousClose: 3925.6, dayChange: -13.3, qty: 12 },
  HDFCBANK: { name: "HDFC Bank", previousClose: 1660.05, dayChange: 18.15, qty: 45 },
  INFY: { name: "Infosys", previousClose: 1529.4, dayChange: 13.4, qty: 55 },
  ICICIBANK: { name: "ICICI Bank", previousClose: 1230.75, dayChange: 16.9, qty: 60 },
  TATAMOTORS: { name: "Tata Motors", previousClose: 755.9, dayChange: -13.6, qty: 70 },
  ITC: { name: "ITC", previousClose: 466.8, dayChange: 2.1, qty: 90 },
  // Not held — quote-only, for breadth/variety.
  SBIN: { name: "State Bank of India", previousClose: 806.9, dayChange: 5.5 },
  BAJFINANCE: { name: "Bajaj Finance", previousClose: 7015.2, dayChange: -35.05 },
  ADANIENT: { name: "Adani Enterprises", previousClose: 3050.85, dayChange: 69.9 },
  WIPRO: { name: "Wipro", previousClose: 268.4, dayChange: 2.85 },
  ZOMATO: { name: "Eternal (Zomato)", previousClose: 298.15, dayChange: -4.4 },
  TATASTEEL: { name: "Tata Steel", previousClose: 168.9, dayChange: 1.35 },
  ASIANPAINT: { name: "Asian Paints", previousClose: 2410.5, dayChange: -18.2 },
  PAYTM: { name: "One97 Communications (Paytm)", previousClose: 912.4, dayChange: 11.1 },
  NIFTY: { name: "Nifty 50", previousClose: 24688.9, dayChange: 123.45 },
  SENSEX: { name: "Sensex", previousClose: 81275.6, dayChange: 367.6 },
};

const STOCK_ALIASES: Record<string, keyof typeof STOCKS> = {
  reliance: "RELIANCE",
  ril: "RELIANCE",
  tcs: "TCS",
  "tata consultancy": "TCS",
  hdfc: "HDFCBANK",
  hdfcbank: "HDFCBANK",
  "hdfc bank": "HDFCBANK",
  infosys: "INFY",
  infy: "INFY",
  icici: "ICICIBANK",
  icicibank: "ICICIBANK",
  "tata motors": "TATAMOTORS",
  tatamotors: "TATAMOTORS",
  itc: "ITC",
  sbi: "SBIN",
  "state bank": "SBIN",
  "bajaj finance": "BAJFINANCE",
  bajfinance: "BAJFINANCE",
  adani: "ADANIENT",
  adanient: "ADANIENT",
  wipro: "WIPRO",
  zomato: "ZOMATO",
  eternal: "ZOMATO",
  "tata steel": "TATASTEEL",
  tatasteel: "TATASTEEL",
  "asian paint": "ASIANPAINT",
  asianpaint: "ASIANPAINT",
  paytm: "PAYTM",
  nifty: "NIFTY",
  sensex: "SENSEX",
};

function findStockSymbol(text: string): keyof typeof STOCKS | null {
  const lower = text.toLowerCase();
  for (const [alias, symbol] of Object.entries(STOCK_ALIASES)) {
    if (lower.includes(alias)) return symbol;
  }
  return null;
}

function holdings() {
  return Object.entries(STOCKS).filter(([, s]) => s.qty) as [string, Stock & { qty: number }][];
}

function computePortfolio() {
  let total = 0;
  let prevTotal = 0;
  for (const [, s] of holdings()) {
    total += lastPrice(s) * s.qty;
    prevTotal += s.previousClose * s.qty;
  }
  const dayChange = total - prevTotal;
  return { total, dayChange, dayChangePct: (dayChange / prevTotal) * 100 };
}

function stockLine(symbol: string, s: Stock): string {
  const last = lastPrice(s);
  const change = dayChangePct(s);
  const dir = s.dayChange > 0 ? "up" : s.dayChange < 0 ? "down" : "unchanged, flat";
  return (
    `${symbol} (${s.name}) is at ${inr2(last)}, ${dir} ${inr2(Math.abs(s.dayChange))} (${pct(change)}) ` +
    `from yesterday's close of ${inr2(s.previousClose)}.`
  );
}

// --- Tiny seeded PRNG so a symbol's synthetic price history is stable across requests ---

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TREND_LABELS = ["5d ago", "4d ago", "3d ago", "2d ago", "Yesterday", "Today"];

function buildTrend(seedKey: string, current: number, changePct: number): { label: string; value: number }[] {
  const random = mulberry32(hashStr(seedKey));
  const values: number[] = [current];
  const yesterday = current / (1 + changePct / 100);
  values.unshift(yesterday);
  let base = yesterday;
  for (let i = 2; i < TREND_LABELS.length; i++) {
    const drift = (random() - 0.5) * 0.02; // +-1% daily noise
    base = base / (1 + drift);
    values.unshift(base);
  }
  return TREND_LABELS.map((label, i) => ({ label, value: Math.round(values[i] * 100) / 100 }));
}

const PORTFOLIO_KEYWORDS = [
  "portfolio",
  "holding",
  "holdings",
  "invest",
  "p&l",
  "pnl",
  "net worth",
  "returns",
];
const QUOTE_KEYWORDS = ["stock", "quote", "share price", "trading at", "price of", "market"];
const MOVERS_KEYWORDS = ["gainers", "losers", "top movers"];
const CHART_KEYWORDS = ["chart", "graph", "trend", "history", "last week", "past week"];
const ORDER_KEYWORDS = [
  "order",
  "lunch",
  "dinner",
  "breakfast",
  "food",
  "hungry",
  "starving",
  "craving",
  "swiggy",
  "grocery",
  "eat",
  "send food",
];

function matches(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

// --- Restaurant data (Swiggy MCP: search -> menu -> cart -> checkout) -----
// Fictitious eateries themed around Mumbai's central suburbs.

interface Restaurant {
  keywords: string[];
  name: string;
  area: string;
  cuisine: string;
  price: number;
  eta: number;
  dish: string;
}

const RESTAURANTS: Restaurant[] = [
  { keywords: ["vada pav", "vadapav", "pav bhaji"], name: "Dadar Vada Pav Express", area: "Dadar", cuisine: "Street food", price: 110, eta: 22, dish: "2x Vada Pav, 1x Misal Pav" },
  { keywords: ["misal"], name: "Kurla Misal Corner", area: "Kurla", cuisine: "Maharashtrian", price: 140, eta: 28, dish: "Kolhapuri Misal, extra farsan" },
  { keywords: ["biryani"], name: "Ghatkopar Biryani House", area: "Ghatkopar", cuisine: "Hyderabadi", price: 329, eta: 38, dish: "Hyderabadi Chicken Biryani (500g)" },
  { keywords: ["dosa", "idli", "south indian", "sambar", "uttapam"], name: "Matunga Idli Express", area: "Matunga", cuisine: "South Indian", price: 189, eta: 25, dish: "4x Idli, 1x Ghee Roast Dosa" },
  { keywords: ["chinese", "noodles", "manchurian", "hakka"], name: "Chembur Chinese Corner", area: "Chembur", cuisine: "Indo-Chinese", price: 349, eta: 35, dish: "Veg Hakka Noodles, Chilli Paneer" },
  { keywords: ["thali", "gujarati"], name: "Vikhroli Gujarati Thali House", area: "Vikhroli", cuisine: "Gujarati thali", price: 289, eta: 40, dish: "Unlimited Gujarati Thali" },
  { keywords: ["punjabi", "north indian", "paneer", "dal makhani", "butter chicken"], name: "Sion Punjabi Dhaba", area: "Sion", cuisine: "North Indian", price: 379, eta: 33, dish: "Butter Chicken, 2x Tandoori Roti" },
  { keywords: ["pizza"], name: "Powai Pizza Point", area: "Powai", cuisine: "Italian", price: 449, eta: 30, dish: "Farmhouse Pizza (Medium)" },
  { keywords: ["sandwich", "frankie", "roll"], name: "Bandra Frankie Stop", area: "Bandra", cuisine: "Quick bites", price: 159, eta: 20, dish: "2x Chicken Frankie" },
  { keywords: ["momo", "momos"], name: "Kanjurmarg Momo Junction", area: "Kanjurmarg", cuisine: "Tibetan / momos", price: 199, eta: 26, dish: "Steamed Chicken Momos (8 pcs)" },
  { keywords: ["dessert", "sweet", "mithai", "ice cream"], name: "Mulund Mithai & Dessert House", area: "Mulund", cuisine: "Sweets & desserts", price: 179, eta: 24, dish: "Gulab Jamun (4 pcs) + Kulfi" },
  { keywords: ["chai", "bun maska", "irani"], name: "Byculla Irani Chai & Bun Maska", area: "Byculla", cuisine: "Irani cafe", price: 99, eta: 18, dish: "Cutting Chai + Bun Maska" },
];

const DEFAULT_RESTAURANT: Restaurant = {
  keywords: [],
  name: "Bhandup Bhavan's Kitchen",
  area: "Bhandup",
  cuisine: "Home-style Maharashtrian",
  price: 249,
  eta: 32,
  dish: "Veg Thali with Sol Kadhi",
};

function findRestaurant(text: string): Restaurant {
  const lower = text.toLowerCase();
  return RESTAURANTS.find((r) => r.keywords.some((k) => lower.includes(k))) ?? DEFAULT_RESTAURANT;
}

const OUT_OF_ZONE_AREAS = [
  "colaba",
  "worli",
  "andheri",
  "malad",
  "borivali",
  "cuffe parade",
  "navi mumbai",
  "thane",
  "juhu",
  "goregaon",
];

function findOutOfZoneArea(text: string): string | null {
  const lower = text.toLowerCase();
  return OUT_OF_ZONE_AREAS.find((a) => lower.includes(a)) ?? null;
}

const SERVICE_AREA_LIST =
  "Dadar, Matunga, Sion, Kurla, Chembur, Ghatkopar, Vikhroli, Kanjurmarg, Bhandup, Mulund, Powai, Bandra, and Byculla";

export class MockAgentService implements AgentService {
  async createSession(_userId: string): Promise<{ sessionId: string }> {
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      kiteLoggedIn: false,
      kiteQueriesSinceLogin: 0,
      pendingToolUseId: null,
      pendingOrderText: "",
    });
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

    const stockSymbol = findStockSymbol(text);
    const wantsChart = matches(text, CHART_KEYWORDS);
    const wantsMovers = matches(text, MOVERS_KEYWORDS);
    const wantsQuote = stockSymbol !== null || matches(text, QUOTE_KEYWORDS);
    const wantsPortfolio = matches(text, PORTFOLIO_KEYWORDS);
    const isKiteDomain = wantsChart || wantsMovers || wantsQuote || wantsPortfolio;

    if (isKiteDomain) {
      if (!state.kiteLoggedIn) {
        yield {
          type: "kite.login_required",
          // In real mode this is the actual link Kite MCP's `login` tool returns.
          loginUrl: "https://kite.zerodha.com/connect/login?mock=1",
        };
        yield { type: "session.idle" };
        return;
      }

      state.kiteQueriesSinceLogin++;
      if (state.kiteQueriesSinceLogin > KITE_SESSION_LIMIT) {
        state.kiteLoggedIn = false;
        state.kiteQueriesSinceLogin = 0;
        yield {
          type: "kite.login_required",
          loginUrl: "https://kite.zerodha.com/connect/login?mock=1",
        };
        yield { type: "session.idle" };
        return;
      }
    }

    if (wantsChart) {
      if (stockSymbol) {
        const s = STOCKS[stockSymbol];
        const changePct = dayChangePct(s);
        yield { type: "agent.message", text: `Here's ${stockSymbol}'s last 6 sessions:` };
        yield {
          type: "agent.chart",
          title: `${stockSymbol} — 6-session trend`,
          unit: "inr",
          points: buildTrend(stockSymbol, lastPrice(s), changePct),
          changePct,
        };
      } else if (matches(text, ["portfolio", "net worth", "holdings"])) {
        const { total, dayChangePct: portPct } = computePortfolio();
        yield { type: "agent.message", text: "Here's your portfolio value over the last 6 sessions:" };
        yield {
          type: "agent.chart",
          title: "Portfolio value — 6-session trend",
          unit: "inr",
          points: buildTrend("PORTFOLIO", total, portPct),
          changePct: portPct,
        };
      } else {
        const s = STOCKS.NIFTY;
        const changePct = dayChangePct(s);
        yield { type: "agent.message", text: "No stock named — here's the Nifty 50's last 6 sessions:" };
        yield {
          type: "agent.chart",
          title: "Nifty 50 — 6-session trend",
          unit: "inr",
          points: buildTrend("NIFTY", lastPrice(s), changePct),
          changePct,
        };
      }
      yield { type: "session.idle" };
      return;
    }

    if (stockSymbol) {
      const s = STOCKS[stockSymbol];
      const held = s.qty ? ` You hold ${s.qty} shares (${inr(lastPrice(s) * s.qty)}).` : " You don't currently hold this one.";
      yield {
        type: "agent.message",
        text: `${stockLine(stockSymbol, s)}${held}${marketClosedNote()}`,
      };
      yield { type: "session.idle" };
      return;
    }

    if (wantsMovers) {
      const sorted = Object.entries(STOCKS).sort((a, b) => dayChangePct(b[1]) - dayChangePct(a[1]));
      const gainers = sorted.slice(0, 3);
      const losers = sorted.slice(-3).reverse();
      const line = (arr: [string, Stock][]) => arr.map(([sym, s]) => `${sym} ${pct(dayChangePct(s))}`).join(", ");
      yield {
        type: "agent.message",
        text: `Top gainers: ${line(gainers)}.\nTop losers: ${line(losers)}.${marketClosedNote()}`,
      };
      yield { type: "session.idle" };
      return;
    }

    if (wantsPortfolio) {
      const { total, dayChange, dayChangePct: portPct } = computePortfolio();
      const rows = holdings()
        .sort((a, b) => lastPrice(b[1]) * b[1].qty - lastPrice(a[1]) * a[1].qty)
        .map(([sym, s]) => `• ${sym} — ${s.qty} shares, ${inr(lastPrice(s) * s.qty)} (${pct(dayChangePct(s))})`)
        .join("\n");
      yield {
        type: "agent.message",
        text:
          `Your portfolio is worth ${inr(total)} today (${pct(portPct)}, ${dayChange >= 0 ? "+" : ""}${inr(dayChange)}).${marketClosedNote()}\n\n` +
          `${rows}`,
      };
      yield { type: "session.idle" };
      return;
    }

    if (wantsQuote) {
      // Generic "how are stocks/markets doing" with no specific ticker named — default snapshot.
      const nifty = STOCKS.NIFTY;
      const sensex = STOCKS.SENSEX;
      yield {
        type: "agent.message",
        text:
          `${stockLine("NIFTY 50", nifty)}\n${stockLine("SENSEX", sensex)}${marketClosedNote()}\n\n` +
          `Ask about a specific stock (e.g. "what's RELIANCE trading at") for more detail.`,
      };
      yield { type: "session.idle" };
      return;
    }

    if (matches(text, ORDER_KEYWORDS)) {
      const outOfZone = findOutOfZoneArea(text);
      if (outOfZone) {
        yield {
          type: "agent.message",
          text: `Swiggy delivery through this assistant is only wired up for central Mumbai suburbs right now (${SERVICE_AREA_LIST}) — ${capitalize(outOfZone)} isn't covered yet. Want to try one of those instead?`,
        };
        yield { type: "session.idle" };
        return;
      }

      const restaurant = findRestaurant(text);
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
        summary:
          `Cart from ${restaurant.name} (${restaurant.cuisine} · ${restaurant.area}):\n` +
          `${restaurant.dish} — ${inr(restaurant.price)}\n` +
          `Delivery ETA ~${restaurant.eta} min\n` +
          `Based on: "${text}"`,
      };
      yield { type: "session.idle" };
      return;
    }

    yield {
      type: "agent.message",
      text:
        "I can check your portfolio (try \"how's my portfolio doing\"), look up a stock (try \"what's RELIANCE trading at\"), " +
        "show a price trend (try \"chart RELIANCE\"), or order food nearby (try \"order vada pav in Dadar\" or \"any biryani nearby\").",
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

    const restaurant = findRestaurant(state.pendingOrderText);
    const orderText = state.pendingOrderText;
    state.pendingToolUseId = null;

    if (decision === "deny") {
      yield { type: "agent.tool_result", toolUseId, summary: "Order cancelled — nothing was placed." };
      yield { type: "agent.message", text: "Cancelled. Let me know if you want something else." };
      yield { type: "session.idle" };
      return;
    }

    // Test-only trigger: exercise the error-rendering path on demand.
    if (/test error|simulate failure/i.test(orderText)) {
      yield { type: "session.error", message: "Payment gateway timed out — please try again." };
      yield { type: "session.idle" };
      return;
    }

    yield {
      type: "agent.tool_result",
      toolUseId,
      summary: `Order confirmed at ${restaurant.name} — ${inr(restaurant.price)}, ETA ~${restaurant.eta} min.`,
    };
    yield {
      type: "agent.message",
      text:
        `Done — ${restaurant.dish} from ${restaurant.name} (${restaurant.area}) is being prepared. ETA ~${restaurant.eta} minutes. ` +
        `(Cash on delivery, per Swiggy MCP's current order-placement support.)`,
    };
    yield { type: "session.idle" };
  }

  /** Mock-only helper: the frontend calls this after the user "clicks through" the fake Kite login link. */
  completeKiteLogin(sessionId: string): void {
    const state = getState(sessionId);
    state.kiteLoggedIn = true;
    state.kiteQueriesSinceLogin = 0;
  }
}
