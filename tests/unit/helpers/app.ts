// An API-only app on a random port with a logged-in client (DB suites only).
import fs from "fs";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { createApp, type AppOptions } from "../../../server/app";
import { hashPassword } from "../../../server/auth";
import { pool } from "../../../server/db";
import { storage } from "../../../server/storage";
import { taskScheduler } from "../../../server/services/taskScheduler";

export const PASSWORD = "correct horse battery staple";

export type Client = {
  base: string;
  req: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  close: () => void;
};

export async function resetDb() {
  taskScheduler.stopAll();
  await pool.query("TRUNCATE task_runs, tasks, users, session RESTART IDENTITY CASCADE");
}

export function setCrontab(text: string | null) {
  const f = process.env.FAKE_CRONTAB_FILE!;
  if (text === null) fs.rmSync(f, { force: true });
  else fs.writeFileSync(f, text);
}
export const crontabText = () => (fs.existsSync(process.env.FAKE_CRONTAB_FILE!) ? fs.readFileSync(process.env.FAKE_CRONTAB_FILE!, "utf8") : null);

export async function startApp({ login = true, app: appOpts = {} as AppOptions } = {}): Promise<Client> {
  const app = createApp({ sessionSecret: "db-test-session-secret-0123456789", ...appOpts });
  const server: Server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = "";
  const req: Client["req"] = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed };
  };
  const { loginLimiter } = await import("../../../server/routes/auth");
  loginLimiter.reset();
  if (login) {
    if (!(await storage.getUserByUsername("admin"))) await storage.createUser({ username: "admin", password: await hashPassword(PASSWORD) });
    const r = await req("POST", "/api/auth/login", { username: "admin", password: PASSWORD });
    if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return { base, req, close: () => server.close() };
}
