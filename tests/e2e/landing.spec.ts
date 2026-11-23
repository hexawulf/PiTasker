// Public landing page on "/" for signed-out visitors (2.4.0): same-origin only, no CSP violations
// or console errors, axe clean in both themes, no horizontal scroll at 390 px; Sign in → /login.
// Signed in, "/" still goes to /tasks; signed-out deep links still go to /login.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "./helpers";

async function signedOut(browser: Browser, opts: { width?: number; height?: number; scheme?: "light" | "dark" } = {}) {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    colorScheme: opts.scheme ?? "light",
  });
  const page = await ctx.newPage();
  const problems: string[] = [];
  const requests: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const w = window as unknown as { __csp?: string[] };
      (w.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  // Signed out, the session check GET /api/auth/me answers 401 by design and Chromium logs every
  // failed resource load as a console error. Allow exactly that response; anything else fails.
  const expected401 = new Set<string>();
  page.on("response", (r) => {
    if (r.status() === 401 && new URL(r.url()).pathname === "/api/auth/me") expected401.add(r.url());
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const loc = m.location().url;
    if (/status of 401/.test(m.text()) && expected401.has(loc)) return;
    problems.push(`console: ${m.text()} (${loc})`);
  });
  page.on("request", (r) => requests.push(r.url()));
  const foreign = () => {
    const origin = new URL(page.url()).origin;
    return requests.filter((u) => !u.startsWith("data:") && new URL(u).origin !== origin);
  };
  return { ctx, page, problems, foreign };
}

const cspViolations = (page: Page) => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

test("signed-out / shows the landing page, same-origin only", async ({ browser }) => {
  const { ctx, page, problems, foreign } = await signedOut(browser);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "PiTasker" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "What it does" })).toBeVisible();
  await expect(page.getByTestId("landing-preview")).toBeVisible();
  await expect(page.getByTestId("landing-signin")).toBeInViewport();
  await expect(page.locator("footer")).toContainText(/PiTasker v\d+\.\d+\.\d+/);
  await page.waitForLoadState("networkidle");
  expect(foreign()).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
  expect(problems).toEqual([]);
  await ctx.close();
});

test("landing Sign in opens /login, and the login title links back", async ({ browser }) => {
  const { ctx, page } = await signedOut(browser);
  await page.goto("/");
  await page.getByTestId("landing-signin").click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("login-username")).toBeVisible();
  await page.getByRole("link", { name: "PiTasker" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("landing-preview")).toBeVisible();
  await ctx.close();
});

test("signed-out deep link still goes to /login", async ({ browser }) => {
  const { ctx, page } = await signedOut(browser);
  await page.goto("/fleet");
  await expect(page).toHaveURL(/\/login$/);
  await ctx.close();
});

test("signed in, / still goes to /tasks", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByTestId("landing-preview")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`landing axe clean and 390 px without horizontal scroll (${scheme})`, async ({ browser }) => {
    const { ctx, page, problems } = await signedOut(browser, { width: 390, height: 844, scheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "PiTasker" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expect(page.getByTestId("landing-signin")).toBeInViewport();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);
    expect(problems).toEqual([]);
    await ctx.close();
  });
}
