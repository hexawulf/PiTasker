import { test as setup, expect } from "@playwright/test";
import { password } from "./helpers";

setup("log in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("wrong-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByRole("alert")).toContainText("Invalid username or password");
  await page.getByTestId("login-password").fill(password());
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.context().storageState({ path: ".e2e/state.json" });
});
