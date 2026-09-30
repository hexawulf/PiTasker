import express, { type Request, type Response } from "express";
import { comparePassword, hashPassword, passwordProblem } from "../auth";
import { isAuthenticated, sessionUser, type AuthenticatedSession } from "../middleware/authMiddleware";
import { createRateLimiter } from "../middleware/rateLimitLogin";
import { storage } from "../storage";

export const loginLimiter = createRateLimiter();
const router = express.Router();

// A constant-time-ish answer for unknown users: compare against a real hash.
const DUMMY_HASH = "$2b$12$bM/YzN8WAHIsooY3Akx2f.g4jXUvgfrsnBfhziGWsQw3qa/OOpAEa";

router.post("/api/auth/login", loginLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }
  try {
    const user = await storage.getUserByUsername(username);
    const ok = await comparePassword(password, user?.password ?? DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ message: "Invalid username or password." });
    // New session id on login (no fixation).
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ message: "Could not start a session." });
      const s = req.session as AuthenticatedSession;
      s.userId = user.id;
      s.user = { id: user.id, username: user.username };
      req.session.save(() => res.json({ message: "Login successful.", user: { id: user.id, username: user.username } }));
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error during login." });
  }
});

router.post("/api/auth/logout", isAuthenticated, (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Could not log out, please try again." });
    res.clearCookie("pitasker.sid");
    return res.json({ message: "Logout successful." });
  });
});

router.get("/api/auth/me", isAuthenticated, async (req: Request, res: Response) => {
  const u = sessionUser(req)!;
  const user = u.username ? u : await storage.getUser(u.id).then((x) => (x ? { id: x.id, username: x.username } : u));
  res.json({ user });
});

router.post("/api/auth/change-password", isAuthenticated, loginLimiter, async (req: Request, res: Response) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body ?? {};
  const u = sessionUser(req)!;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || typeof confirmNewPassword !== "string") {
    return res.status(400).json({ message: "All password fields are required." });
  }
  if (newPassword !== confirmNewPassword) return res.status(400).json({ message: "New passwords do not match." });
  try {
    const user = await storage.getUser(u.id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (!(await comparePassword(currentPassword, user.password))) {
      return res.status(401).json({ message: "Incorrect current password." });
    }
    const problem = passwordProblem(newPassword, { current: currentPassword, username: user.username });
    if (problem) return res.status(400).json({ message: problem });
    await storage.updateUserPassword(user.id, await hashPassword(newPassword));
    const dropped = await storage.dropOtherSessions(user.id, req.sessionID).catch(() => 0);
    return res.json({ message: "Password changed successfully.", otherSessionsEnded: dropped });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ message: "Internal server error during password change." });
  }
});

export default router;
