import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { hashPassword, verifyPassword } from "../lib/auth";
import { setSessionUserId, clearSession, getSessionUserId } from "../lib/session";

const router: IRouter = Router();

function safeUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    phone: u.phone,
    dietaryPreferences: u.dietaryPreferences ?? [],
    discreetPickup: u.discreetPickup,
    rating: u.rating,
    reviewCount: u.reviewCount,
    // Profile Trust v1 fields. Must be kept in lockstep with `shapeUser` in
    // routes/cookcircle.ts — `/auth/me` uses this shaper and the PATCH route
    // uses the other one, and the frontend type assumes they match.
    profileImageUrl: u.profileImageUrl ?? null,
    aboutMe: u.aboutMe ?? null,
    generalLocation: u.generalLocation ?? null,
  };
}

router.get("/auth/me", async (req: Request, res: Response) => {
  const userId = getSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!u) {
    clearSession(res);
    res.status(401).json({ error: "Session expired — please sign in again" });
    return;
  }
  res.json(safeUser(u));
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || !email.trim()) {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  if (typeof password !== "string" || !password) {
    res.status(400).json({ error: "Password is required" });
    return;
  }
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));
  if (!u || !u.passwordHash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const ok = await verifyPassword(password, u.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  setSessionUserId(res, u.id);
  res.json(safeUser(u));
});

router.post("/auth/register", async (req: Request, res: Response) => {
  const { name, email, password, phone } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length < 2) {
    res.status(400).json({ error: "Name must be at least 2 characters" });
    return;
  }
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
    return;
  }
  const normalizedEmail = email.toLowerCase().trim();
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));
  if (existing) {
    res
      .status(409)
      .json({ error: "An account with this email already exists" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(usersTable)
    .values({
      displayName: name.trim(),
      email: normalizedEmail,
      phone: typeof phone === "string" ? phone.trim() : "",
      passwordHash,
    })
    .returning();
  setSessionUserId(res, created.id);
  res.status(201).json(safeUser(created));
});

router.post("/auth/logout", (_req: Request, res: Response) => {
  clearSession(res);
  res.json({ ok: true });
});

export default router;
