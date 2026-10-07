import { expect, test } from "@playwright/test";

test("fits a phone without horizontal page scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("tabpanel", { name: "Σ Overview" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // No pane may scroll sideways either (the matrix and charts scroll inside their own frames).
  const sideways = await page.evaluate(() =>
    [...document.querySelectorAll("main, aside, header")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.tagName),
  );
  expect(sideways).toEqual([]);
  await expect(page.getByRole("listbox", { name: /Applications/ })).toBeVisible();
});
