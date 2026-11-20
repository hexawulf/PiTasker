// POST /api/auth/firebase-login error mapping, without a database: the
// Firebase verifier and the storage layer are mocked, sessions use the
// in-memory store.
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpError } from "../../server/errors";

vi.mock("../../server/services/firebase-auth", () => ({
  verifyFirebaseLogin: vi.fn(),
  getFirebasePublicConfig: () => ({ enabled: true }),
  isFirebaseEnabled: () => true,
}));
vi.mock("../../server/storage", () => ({
  storage: { getUserByUsername: vi.fn(), getUser: vi.fn() },
}));

const { verifyFirebaseLogin } = await import("../../server/services/firebase-auth");
const { storage } = await import("../../server/storage");
const { createApp } = await import("../../server/app");
const { loginLimiter } = await import("../../server/routes/auth");

const verify = vi.mocked(verifyFirebaseLogin);
const byName = vi.mocked(storage.getUserByUsername);
const byId = vi.mocked(storage.getUser);

let server: Server;
let base = "";

async function login(body: unknown = { idToken: "token" }) {
  const res = await fetch(`${base}/api/auth/firebase-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { message: string; email?: string } };
}

beforeEach(() => {
  server = createApp({ sessionSecret: "route-test-session-secret-0123456789" }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  loginLimiter.reset();
  verify.mockReset();
  byName.mockReset();
  byId.mockReset();
});

afterEach(() => {
  server.close();
});

describe("POST /api/auth/firebase-login", () => {
  it("binds an allowlisted account to the local user and starts a session", async () => {
    verify.mockResolvedValue({ email: "user@example.com", uid: "u1" });
    byName.mockResolvedValue(undefined);
    byId.mockResolvedValue({ id: 1, username: "admin", password: "x" });
    const r = await login();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ message: "Login successful.", email: "user@example.com" });
  });

  it("passes the verifier's status and message through (e.g. not allowlisted)", async () => {
    verify.mockRejectedValue(httpError(403, "Account other@example.com is not authorized to access PiTasker."));
    const r = await login();
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("Account other@example.com is not authorized to access PiTasker.");
  });

  it("answers 400 without an idToken", async () => {
    const r = await login({});
    expect(r.status).toBe(400);
  });

  it("answers 500 with a generic message when the database fails, and logs the error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    verify.mockResolvedValue({ email: "user@example.com", uid: "u1" });
    byName.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const r = await login();
    expect(r.status).toBe(500);
    expect(r.body.message).toBe("Internal server error during Firebase login.");
    expect(JSON.stringify(r.body)).not.toContain("ECONNREFUSED");
    expect(log).toHaveBeenCalled();
  });

  it("answers 500 (not 401) for an unexpected error without a status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    verify.mockRejectedValue(new TypeError("boom"));
    const r = await login();
    expect(r.status).toBe(500);
    expect(r.body.message).not.toContain("boom");
  });
});
