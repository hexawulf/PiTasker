import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests never reach the real crontab or the real database:
//  - tests/setup/env.ts puts tests/fake-crontab.sh first on PATH (as `crontab`)
//    with a per-worker FAKE_CRONTAB_FILE and a scratch PITASKER_STATE_DIR;
//  - tests/setup/global-db.ts creates a scratch database (pitasker_test_*)
//    from PITASKER_TEST_PG_URL, migrates it, and server/db.ts refuses any
//    other database while VITEST is set. Without PITASKER_TEST_PG_URL the
//    *.db.test.ts suites are skipped.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client/src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    globalSetup: ["tests/setup/global-db.ts"],
    setupFiles: ["tests/setup/env.ts"],
    restoreMocks: true,
    // DB suites share one scratch database: run files one at a time.
    fileParallelism: false,
  },
});
