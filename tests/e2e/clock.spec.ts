import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("persists timer state across a reload", async ({ page }) => {
  await page.goto("/");
  const start = page.getByRole("button", { name: "Start the day" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible();

  await page.reload();

  await expect(page.getByText("Working", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Break" })).toBeEnabled();
});

test("serializes simultaneous corrections from two tabs", async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/"), second.goto("/")]);
  await Promise.all([
    first.getByRole("button", { name: "Add time" }).click(),
    second.getByRole("button", { name: "Add time" }).click(),
  ]);

  await Promise.all([
    first.getByRole("button", { name: "Add time", exact: true }).last().click(),
    second.getByRole("button", { name: "Add time", exact: true }).last().click(),
  ]);

  await expect(first.getByLabel("Today: 01:00")).toBeVisible();
  await first.reload();
  await expect(first.getByLabel("Today: 01:00")).toBeVisible();
});

test("meets automated accessibility checks and traps dialog focus", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add time" })).toBeEnabled();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  const trigger = page.getByRole("button", { name: "Add time" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Add worked time" });
  await expect(dialog).toBeVisible();

  for (let index = 0; index < 10; index += 1) await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  const dataTrigger = page.getByRole("button", { name: "History & backup" });
  await dataTrigger.click();
  const dataDialog = page.getByRole("dialog", { name: "History & backup" });
  await expect(dataDialog).toBeVisible();
  const dialogAccessibility = await new AxeBuilder({ page })
    .include(".data-tools-modal")
    .analyze();
  expect(dialogAccessibility.violations).toEqual([]);
  for (let index = 0; index < 10; index += 1) await page.keyboard.press("Tab");
  await expect(dataDialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dataTrigger).toBeFocused();
});

test("serves defense-in-depth response headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
});
