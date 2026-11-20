import type { DecodedIdToken } from "firebase-admin/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFirebaseAdminApp,
  getFirebaseAllowedEmails,
  getFirebasePublicConfig,
  isFirebaseEnabled,
  resetFirebaseAdminForTests,
  verifyFirebaseLogin,
  type VerifyIdTokenFn,
} from "../../server/services/firebase-auth";

function fakeDecoded(overrides: Partial<DecodedIdToken> = {}): DecodedIdToken {
  return {
    aud: "example-project",
    auth_time: 1_700_000_000,
    exp: 1_900_000_000,
    firebase: { identities: {}, sign_in_provider: "google.com" },
    iat: 1_700_000_000,
    iss: "https://securetoken.google.com/example-project",
    sub: "uid-123",
    uid: "uid-123",
    email: "admin@example.com",
    email_verified: true,
    name: "Operator",
    ...overrides,
  };
}

describe("firebase-auth service", () => {
  beforeEach(() => {
    resetFirebaseAdminForTests();
  });

  describe("isFirebaseEnabled", () => {
    it("returns true only for true, 1, or yes (case-insensitive)", () => {
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "true" })).toBe(true);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "TRUE" })).toBe(true);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "1" })).toBe(true);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "yes" })).toBe(true);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "false" })).toBe(false);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "0" })).toBe(false);
      expect(isFirebaseEnabled({})).toBe(false);
    });
  });

  describe("getFirebaseAllowedEmails", () => {
    it("splits, trims, and lowercases comma-separated emails", () => {
      const env = {
        FIREBASE_ALLOWED_EMAILS: "admin@example.com, ops@example.org,  test@EXAMPLE.NET ",
      };
      expect(getFirebaseAllowedEmails(env)).toEqual([
        "admin@example.com",
        "ops@example.org",
        "test@example.net",
      ]);
    });

    it("handles empty or missing variable gracefully", () => {
      expect(getFirebaseAllowedEmails({})).toEqual([]);
      expect(getFirebaseAllowedEmails({ FIREBASE_ALLOWED_EMAILS: "  " })).toEqual([]);
    });
  });

  describe("getFirebasePublicConfig", () => {
    it("returns enabled: false when disabled", () => {
      expect(getFirebasePublicConfig({})).toEqual({ enabled: false });
    });

    it("returns public config parameters when enabled", () => {
      const env = {
        FIREBASE_ENABLED: "true",
        FIREBASE_CLIENT_API_KEY: "AIzaSyFakeKey",
        FIREBASE_CLIENT_AUTH_DOMAIN: "example.firebaseapp.com",
        FIREBASE_PROJECT_ID: "example-project",
        FIREBASE_CLIENT_APP_ID: "1:12345:web:6789",
      };
      expect(getFirebasePublicConfig(env)).toEqual({
        enabled: true,
        apiKey: "AIzaSyFakeKey",
        authDomain: "example.firebaseapp.com",
        projectId: "example-project",
        appId: "1:12345:web:6789",
      });
    });
  });

  describe("getFirebaseAdminApp fail-closed checks", () => {
    it("throws when neither FIREBASE_SERVICE_ACCOUNT_PATH nor FIREBASE_SERVICE_ACCOUNT_JSON is set", () => {
      expect(() => getFirebaseAdminApp({ FIREBASE_ENABLED: "true" })).toThrow(/service account is not configured/i);
    });

    it("throws when FIREBASE_SERVICE_ACCOUNT_PATH points to a missing file", () => {
      expect(() =>
        getFirebaseAdminApp({
          FIREBASE_ENABLED: "true",
          FIREBASE_SERVICE_ACCOUNT_PATH: "/nonexistent/service-account.json",
        }),
      ).toThrow(/Failed to load Firebase service account/i);
    });

    it("throws when FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON", () => {
      expect(() =>
        getFirebaseAdminApp({
          FIREBASE_ENABLED: "true",
          FIREBASE_SERVICE_ACCOUNT_JSON: "{bad-json",
        }),
      ).toThrow(/Invalid FIREBASE_SERVICE_ACCOUNT_JSON/i);
    });
  });

  describe("verifyFirebaseLogin", () => {
    const baseEnv = {
      FIREBASE_ENABLED: "true",
      FIREBASE_ALLOWED_EMAILS: "admin@example.com, ops@example.org",
    };

    it("rejects with status 503 if Firebase is disabled", async () => {
      await expect(verifyFirebaseLogin("some-token", { FIREBASE_ENABLED: "false" })).rejects.toMatchObject({
        status: 503,
      });
    });

    it("rejects with status 400 if token is missing, blank, or oversized", async () => {
      await expect(verifyFirebaseLogin("", baseEnv)).rejects.toMatchObject({ status: 400 });
      await expect(verifyFirebaseLogin("   ", baseEnv)).rejects.toMatchObject({ status: 400 });
      await expect(verifyFirebaseLogin("x".repeat(16_385), baseEnv)).rejects.toMatchObject({ status: 400 });
    });

    it("fails closed with 500 when service account file is missing or unconfigured", async () => {
      await expect(
        verifyFirebaseLogin("valid-token", {
          FIREBASE_ENABLED: "true",
          FIREBASE_SERVICE_ACCOUNT_PATH: "/nonexistent/sa.json",
          FIREBASE_ALLOWED_EMAILS: "admin@example.com",
        }),
      ).rejects.toMatchObject({ status: 500 });

      await expect(
        verifyFirebaseLogin("valid-token", {
          FIREBASE_ENABLED: "true",
          FIREBASE_ALLOWED_EMAILS: "admin@example.com",
        }),
      ).rejects.toMatchObject({ status: 500 });
    });

    it("verifies token with checkRevoked=true and accepts an allowlisted email (case-normalised)", async () => {
      const verifyMock = vi.fn<VerifyIdTokenFn>(async () => fakeDecoded({ email: "ADMIN@EXAMPLE.COM" }));
      const user = await verifyFirebaseLogin("  valid-jwt-token  ", baseEnv, verifyMock);
      expect(verifyMock).toHaveBeenCalledWith("valid-jwt-token", true);
      expect(user).toEqual({
        email: "admin@example.com",
        uid: "uid-123",
        name: "Operator",
      });
    });

    it("rejects with 401 when token is expired, has wrong aud, or is revoked", async () => {
      const expiredMock = vi.fn(async () => {
        throw new Error("Firebase ID token has expired.");
      });
      await expect(verifyFirebaseLogin("expired-token", baseEnv, expiredMock)).rejects.toMatchObject({ status: 401 });

      const wrongAudMock = vi.fn(async () => {
        throw new Error("Firebase ID token has incorrect 'aud' (audience) claim.");
      });
      await expect(verifyFirebaseLogin("wrong-aud-token", baseEnv, wrongAudMock)).rejects.toMatchObject({ status: 401 });

      const revokedMock = vi.fn(async (_t: string, checkRevoked: boolean) => {
        if (checkRevoked) throw new Error("The Firebase ID token has been revoked.");
        return fakeDecoded();
      });
      await expect(verifyFirebaseLogin("revoked-token", baseEnv, revokedMock)).rejects.toMatchObject({ status: 401 });
    });

    it("rejects with 403 when email_verified is false or email is missing", async () => {
      const unverifiedMock = vi.fn(async () => fakeDecoded({ email_verified: false }));
      await expect(verifyFirebaseLogin("unverified-token", baseEnv, unverifiedMock)).rejects.toMatchObject({ status: 403 });

      const noEmailMock = vi.fn(async () => fakeDecoded({ email: undefined }));
      await expect(verifyFirebaseLogin("no-email-token", baseEnv, noEmailMock)).rejects.toMatchObject({ status: 403 });
    });

    it("rejects with 403 when FIREBASE_ALLOWED_EMAILS is empty or email is not allowlisted", async () => {
      const validMock = vi.fn(async () => fakeDecoded({ email: "stranger@example.com" }));
      await expect(verifyFirebaseLogin("stranger-token", baseEnv, validMock)).rejects.toMatchObject({ status: 403 });
      await expect(
        verifyFirebaseLogin("valid-token", { FIREBASE_ENABLED: "true", FIREBASE_ALLOWED_EMAILS: "" }, validMock),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});
