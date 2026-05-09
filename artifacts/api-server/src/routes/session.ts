import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getSessionUserId } from "../lib/session";
import { ensureSeed, ensurePasswords } from "./cookcircle-seed";

const router: IRouter = Router();

let seeded = false;
router.use(async (_req, _res, next) => {
  if (!seeded) {
    try {
      await ensureSeed();
      await ensurePasswords();
      seeded = true;
    } catch (err) {
      console.error("session: seed failed", err);
    }
  }
  next();
});

function shapeUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    phone: u.phone,
    dietaryPreferences: u.dietaryPreferences ?? [],
    discreetPickup: u.discreetPickup,
    rating: u.rating,
    reviewCount: u.reviewCount,
  };
}

router.get("/session/me", async (req: Request, res: Response) => {
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
    res.status(404).json({ error: "Session user not found" });
    return;
  }
  res.json(shapeUser(u));
});

export default router;
