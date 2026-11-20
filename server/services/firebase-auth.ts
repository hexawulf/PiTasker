import fs from "fs";
import {
  initializeApp,
  getApps,
  cert,
  type App,
  type Credential,
} from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { httpError } from "../errors";

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

  const keyPath = (env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();
  const rawJson = (env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!keyPath && !rawJson) {
    throw new Error("Firebase service account is not configured (set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON)");
  }

  // The key file wins over the inline JSON; the error names which one failed.
  const source = keyPath ? `key file ${keyPath}` : "FIREBASE_SERVICE_ACCOUNT_JSON";
  let credential: Credential;
  let projectId = (env.FIREBASE_PROJECT_ID || "").trim() || undefined;
  try {
    const parsed = JSON.parse(keyPath ? fs.readFileSync(keyPath, "utf8") : rawJson);
    credential = cert(parsed);
    projectId ??= parsed.project_id || undefined;
  } catch (err) {
    console.error(`[Firebase] Failed to load the service account (${source}):`, err);
    throw new Error(keyPath ? "Failed to load Firebase service account from " + keyPath : "Invalid FIREBASE_SERVICE_ACCOUNT_JSON");
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
  if (!isFirebaseEnabled(env)) throw httpError(503, "Firebase authentication is disabled on this host.");

  if (!idToken || typeof idToken !== "string" || !idToken.trim() || idToken.length > 16_384) {
    throw httpError(400, "Missing or invalid ID token.");
  }

  let verifyFn: VerifyIdTokenFn;
  if (verifyTokenImpl) {
    verifyFn = verifyTokenImpl;
  } else {
    let app: App;
    try {
      app = getFirebaseAdminApp(env);
    } catch {
      throw httpError(500, "Firebase Admin is not configured properly on the server.");
    }
    verifyFn = (token, checkRevoked) => getAuth(app).verifyIdToken(token, checkRevoked);
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await verifyFn(idToken.trim(), true);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Firebase] Failed to verify ID token:", msg);
    throw httpError(401, "Invalid or expired Firebase ID token.");
  }

  const email = (decoded.email || "").trim().toLowerCase();
  if (!email || decoded.email_verified !== true) throw httpError(403, "Google account email is missing or not verified.");

  const allowedEmails = getFirebaseAllowedEmails(env);
  if (allowedEmails.length === 0) {
    console.error("[Firebase] No allowed emails configured in FIREBASE_ALLOWED_EMAILS.");
    throw httpError(403, "No authorized accounts configured on this host.");
  }

  if (!allowedEmails.includes(email)) {
    console.warn("[Firebase Auth] Access denied: Account " + email + " is not in FIREBASE_ALLOWED_EMAILS.");
    throw httpError(403, "Account " + email + " is not authorized to access PiTasker.");
  }

  return {
    email,
    uid: decoded.uid,
    name: decoded.name,
  };
}
