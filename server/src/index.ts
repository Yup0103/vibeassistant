import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { readSession } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { swiggyOAuthRouter } from "./routes/swiggy-oauth.js";
import { MOCK_MODE } from "./services/select.js";

const PORT = Number(process.env.PORT ?? 5174);

// Built frontend assets, when deployed as a single service (e.g. Render) that
// serves both the API and the PWA from one origin — avoids cross-origin
// cookies entirely. Absent in local dev, where Vite serves the frontend itself.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.join(__dirname, "..", "..", "web", "dist");

async function bootstrapSingleUser(): Promise<void> {
  const email = process.env.APP_USER_EMAIL;
  const passwordHash = process.env.APP_USER_PASSWORD_HASH;
  if (!email || !passwordHash) {
    console.warn(
      "APP_USER_EMAIL / APP_USER_PASSWORD_HASH are not set in .env — login will always fail until they are.\n" +
        "Generate a hash with: node -e \"console.log(require('bcryptjs').hashSync('your-password', 10))\""
    );
    return;
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, existing.id);
  } else {
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
      randomUUID(),
      email,
      passwordHash
    );
  }
}

async function main() {
  await bootstrapSingleUser();

  const app = express();
  app.use(
    cors({
      origin: (origin, cb) => cb(null, origin ?? true),
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(readSession);

  app.get("/health", (_req, res) => res.json({ ok: true, mockMode: MOCK_MODE }));

  app.use("/auth", authRouter);
  app.use("/chat", chatRouter);
  if (!MOCK_MODE) {
    app.use("/swiggy/oauth", swiggyOAuthRouter);
  }

  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    // SPA fallback — any other GET request (e.g. a hard refresh) still gets the app shell.
    app.get("*", (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
  }

  app.listen(PORT, () => {
    console.log(`MCP Life Assistant server listening on http://localhost:${PORT} (MOCK_MODE=${MOCK_MODE})`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
