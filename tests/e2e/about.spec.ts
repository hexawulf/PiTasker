import AxeBuilder from "@axe-core/playwright";
import { expect, expectNoHorizontalScroll, test } from "./helpers";

test("About: version, repo and diagnostics from the header", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByRole("button", { name: "About PiTasker" }).click();
  const dialog = page.getByTestId("about-dialog");
  await expect(dialog.getByRole("heading", { name: "About PiTasker" })).toBeVisible();
  await expect(dialog.getByTestId("about-version")).toHaveText(/^Version: v\d+\.\d+\.\d+/);
  await expect(dialog.getByRole("link", { name: "https://github.com/hexawulf/PiTasker" })).toHaveAttribute("rel", /noopener/);
  await expect(dialog.getByTestId("diagnostics-line")).toContainText(/PiTasker v\d+\.\d+\.\d+ · .+@.+ · tasks \d+ \(cron \d+, PiTasker \d+\)/);
  // axe checks colours as rendered: wait for the dialog's open animation (fade/zoom) to finish.
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
    await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    const r = await new AxeBuilder({ page }).include('[data-testid="about-dialog"]').analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("About fits at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tasks");
  await page.getByRole("button", { name: "About PiTasker" }).click();
  await expect(page.getByTestId("about-dialog")).toBeVisible();
  await expectNoHorizontalScroll(page);
});
