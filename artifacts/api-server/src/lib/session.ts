import type { Request, Response, NextFunction } from "express";

export const SESSION_COOKIE = "ccUserId";

export function getSessionUserId(req: Request): number | null {
  const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    SESSION_COOKIE
  ];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setSessionUserId(res: Response, userId: number) {
  res.cookie(SESSION_COOKIE, String(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = getSessionUserId(req);
  if (userId === null) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.locals.userId = userId;
  next();
}
