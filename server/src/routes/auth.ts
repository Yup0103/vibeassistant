import { Router } from "express";
import { db } from "../db.js";
import { verifyPassword, issueSessionCookie, clearSessionCookie, type AuthedRequest } from "../auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = db
    .prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
    .get(email) as { id: string; email: string; password_hash: string } | undefined;

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    // Deliberately vague — don't reveal whether the email exists.
    return res.status(401).json({ error: "invalid_credentials" });
  }

  issueSessionCookie(res, user.id);
  res.json({ email: user.email });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", (req: AuthedRequest, res) => {
  if (!req.userId) return res.status(401).json({ error: "not_authenticated" });
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.userId) as
    | { email: string }
    | undefined;
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  res.json({ email: user.email });
});
