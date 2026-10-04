import type { NextFunction, Request, Response } from "express";
import type session from "express-session";

export interface AuthenticatedSession extends session.Session {
  userId?: number;
  user?: { id: number; username: string };
  authMethod?: string;
  email?: string;
}

export function sessionUser(req: Request): { id: number; username: string } | null {
  const s = req.session as AuthenticatedSession | undefined;
  if (s?.user?.id) return s.user;
  if (s?.userId) return { id: s.userId, username: "" };
  return null;
}

/** Every /api route except login uses this; tests/unit/route-auth.test.ts checks it. */
export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (sessionUser(req)) return next();
  return res.status(401).json({ message: "Unauthorized: You must be logged in to access this resource." });
}
