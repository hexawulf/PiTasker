import fs from "fs";
import {
  initializeApp,
  getApps,
  cert,
  type App,
  type Credential,
} from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

export interface FirebasePublicConfig {
  enabled: boolean;
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
}

export interface VerifiedFirebaseUser {
  email: string;
  uid: string;
  name?: string;
}

export type VerifyIdTokenFn = (idToken: string, checkRevoked: boolean) => Promise<DecodedIdToken>;

let firebaseAdminApp: App | null = null;

export function resetFirebaseAdminForTests(): void {
  firebaseAdminApp = null;
}

export function isFirebaseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const val = (env.FIREBASE_ENABLED || "").trim().toLowerCase();
  return val === "true" || val === "1" || val === "yes";
}

export function getFirebaseAllowedEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.FIREBASE_ALLOWED_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function getFirebasePublicConfig(env: NodeJS.ProcessEnv = process.env): FirebasePublicConfig {
  const enabled = isFirebaseEnabled(env);
  if (!enabled) {
    return { enabled: false };
  }
  return {
    enabled: true,
    apiKey: (env.FIREBASE_CLIENT_API_KEY || "").trim() || undefined,
    authDomain: (env.FIREBASE_CLIENT_AUTH_DOMAIN || "").trim() || undefined,
    projectId: (env.FIREBASE_PROJECT_ID || "").trim() || undefined,
    appId: (env.FIREBASE_CLIENT_APP_ID || "").trim() || undefined,
  };
}

export function getFirebaseAdminApp(env: NodeJS.ProcessEnv = process.env): App {
  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  let credential: Credential;
  let projectId = (env.FIREBASE_PROJECT_ID || "").trim() || undefined;

  const keyPath = (env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();
  const rawJson = (env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();

  if (keyPath) {
    try {
      const content = fs.readFileSync(keyPath, "utf8");
      const parsed = JSON.parse(content);
      credential = cert(parsed);
      if (!projectId && parsed.project_id) {
        projectId = parsed.project_id;
      }
    } catch (err) {
      console.error("[Firebase] Failed to load service account key from " + keyPath + ":", err);
      throw new Error("Failed to load Firebase service account from " + keyPath);
    }
  } else if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      credential = cert(parsed);
      if (!projectId && parsed.project_id) {
        projectId = parsed.project_id;
      }
    } catch (err) {
      console.error("[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", err);
      throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON");
    }
  } else {
    throw new Error("Firebase service account is not configured (set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON)");
  }

  const existingApps = getApps();
  if (existingApps && existingApps.length > 0 && existingApps[0]) {
    firebaseAdminApp = existingApps[0];
    return firebaseAdminApp;
  }

  firebaseAdminApp = initializeApp({
    credential,
    projectId,
  });

  return firebaseAdminApp;
}

export async function verifyFirebaseLogin(
  idToken: string,
  env: NodeJS.ProcessEnv = process.env,
  verifyTokenImpl?: VerifyIdTokenFn,
): Promise<VerifiedFirebaseUser> {
  if (!isFirebaseEnabled(env)) {
    const err: Error & { status?: number } = new Error("Firebase authentication is disabled on this host.");
    err.status = 503;
    throw err;
  }

  if (!idToken || typeof idToken !== "string" || !idToken.trim() || idToken.length > 16_384) {
    const err: Error & { status?: number } = new Error("Missing or invalid ID token.");
    err.status = 400;
    throw err;
  }

  let verifyFn: VerifyIdTokenFn;
  if (verifyTokenImpl) {
    verifyFn = verifyTokenImpl;
  } else {
    let app: App;
    try {
      app = getFirebaseAdminApp(env);
    } catch {
      const err: Error & { status?: number } = new Error("Firebase Admin is not configured properly on the server.");
      err.status = 500;
      throw err;
    }
    verifyFn = (token, checkRevoked) => getAuth(app).verifyIdToken(token, checkRevoked);
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await verifyFn(idToken.trim(), true);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Firebase] Failed to verify ID token:", msg);
    const err: Error & { status?: number } = new Error("Invalid or expired Firebase ID token.");
    err.status = 401;
    throw err;
  }

  const email = (decoded.email || "").trim().toLowerCase();
  if (!email || decoded.email_verified !== true) {
    const err: Error & { status?: number } = new Error("Google account email is missing or not verified.");
    err.status = 403;
    throw err;
  }

  const allowedEmails = getFirebaseAllowedEmails(env);
  if (allowedEmails.length === 0) {
    console.error("[Firebase] No allowed emails configured in FIREBASE_ALLOWED_EMAILS.");
    const err: Error & { status?: number } = new Error("No authorized accounts configured on this host.");
    err.status = 403;
    throw err;
  }

  if (!allowedEmails.includes(email)) {
    console.warn("[Firebase Auth] Access denied: Account " + email + " is not in FIREBASE_ALLOWED_EMAILS.");
    const err: Error & { status?: number } = new Error("Account " + email + " is not authorized to access PiTasker.");
    err.status = 403;
    throw err;
  }

  return {
    email,
    uid: decoded.uid,
    name: decoded.name,
  };
}
