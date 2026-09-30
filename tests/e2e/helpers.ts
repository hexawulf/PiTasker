// Shared E2E fixture. SAFETY: the server under test uses a fake crontab
// (.e2e/crontab) and the scratch database pitasker_e2e; helpers here only
// ever touch those two.
import fs from "fs";
import path from "path";
import pg from "pg";
import { test as base, expect, type Page } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const E2E = path.join(ROOT, ".e2e");
export const CRONTAB = path.join(E2E, "crontab");
export const CURATED = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "crontab.curated"), "utf8");
export const password = () => fs.readFileSync(path.join(E2E, "password"), "utf8").trim();

function dbUrl() {
  const u = new URL(process.env.PITASKER_TEST_PG_URL!);
  u.pathname = "/pitasker_e2e";
  return u.toString();
}

export async function resetState(crontab: string = CURATED) {
  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();
  try {
    await c.query("TRUNCATE task_runs, tasks RESTART IDENTITY CASCADE");
  } finally {
    await c.end();
  }
  fs.writeFileSync(CRONTAB, crontab);
  fs.rmSync(path.join(E2E, "state", "crontab-backups"), { recursive: true, force: true });
}

export const crontab = () => fs.readFileSync(CRONTAB, "utf8");

/** No horizontal page scroll (mobile layout check). */
/**
 * Text in a toast. Scoped to the toast region: Radix also copies the text
 * into a short-lived role="status" announcement, and a page-wide getByText
 * then matches twice (strict-mode violation) if it looks at the wrong moment.
 */
export function toastText(page: Page, text: string | RegExp) {
  return page.getByRole("region", { name: /Notifications/ }).getByText(text);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

export const test = base.extend<{ cleanState: void }>({
  cleanState: [
    async ({}, use) => {
      await resetState();
      await use();
    },
    { auto: true },
  ],
});
export { expect };
