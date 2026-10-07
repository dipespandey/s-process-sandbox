import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("s-process-sandbox:guide-dismissed", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("tabpanel", { name: "Σ Overview" })).toBeVisible();
  return errors;
}

const optionTotal = (page: Page, name: RegExp) => page.getByRole("option", { name }).locator("span.tnum").first().innerText();

test("loads without runtime errors and opens on Σ", async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByRole("heading", { name: /Σ projected final allocation/i })).toBeVisible();
  await expect(page.getByRole("img", { name: /Money flowing from funders/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the perspective tree looks through a Recommender's eyes (unilateral allocation)", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Recommender Avery" }).click();
  await expect(page.getByRole("heading", { name: "Avery's unilateral allocation" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Recommender" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "FDV" })).toBeVisible();
  await page.getByRole("button", { name: /^Funder Harlow/ }).click();
  await expect(page.getByRole("heading", { name: "Harlow's grants" })).toBeVisible();
});

test("drag the first-dollar value, see allocations move, then undo it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("3");
  const name = /Harbor Evals/;
  await page.getByRole("option", { name }).click();
  const before = await optionTotal(page, name);
  const handle = page.getByRole("slider", { name: /: First-dollar value$/ }).first();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 160, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => optionTotal(page, name)).not.toBe(before);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => optionTotal(page, name)).toBe(before);
});

test("keyboard moves the last-dollar threshold and the concavity", async ({ page }) => {
  await open(page);
  await page.keyboard.press("3");
  const ldt = page.getByRole("slider", { name: /: Last-dollar threshold$/ }).first();
  await ldt.focus();
  const v0 = Number(await ldt.getAttribute("aria-valuenow"));
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  expect(Number(await ldt.getAttribute("aria-valuenow"))).toBeLessThan(v0);
  const conc = page.getByRole("slider", { name: /: Concavity$/ }).first();
  await conc.focus();
  const c0 = Number(await conc.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowUp");
  expect(Number(await conc.getAttribute("aria-valuenow"))).toBeGreaterThan(c0);
});

test("funder final say keeps that funder's money away", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Funder Harlow/ }).click();
  const toggle = page.getByRole("switch", { name: /^Decline .* for Harlow$/ }).first();
  const label = (await toggle.getAttribute("aria-label"))!;
  const app = label.replace(/^Decline /, "").replace(/ for Harlow$/, "");
  await toggle.click();
  await expect(page.getByRole("switch", { name: `Accept ${app} for Harlow` })).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByText("1 declined")).toBeVisible();
});

test("switching the combination rule reallocates", async ({ page }) => {
  await open(page);
  const first = page.getByRole("option").first();
  const before = `${await first.innerText()}`;
  await page.getByRole("button", { name: "Average" }).click();
  await expect.poll(async () => `${await page.getByRole("option").first().innerText()}`).not.toBe(before);
  await page.keyboard.press("9");
  await expect(page.getByText("Weighted average (current)", { exact: false })).toBeVisible();
});

test("every view renders and the main views have no serious accessibility violations", async ({ page }) => {
  const errors = await open(page);
  for (const key of ["2", "3", "4", "5", "6", "7", "8", "9", "1"]) {
    await page.keyboard.press(key);
    await expect(page.getByRole("tabpanel")).toBeVisible();
    if (key === "2" || key === "1") {
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    }
  }
  expect(errors).toEqual([]);
});

test("share link round-trips the round and rejects tampering", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.getByRole("button", { name: "Average" }).click();
  await page.getByRole("button", { name: "Copy share link" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain("#s=");
  const fresh = await context.newPage();
  await fresh.goto(url);
  await expect(fresh.getByRole("button", { name: "Average" })).toHaveAttribute("aria-pressed", "true");
  const tampered = await context.newPage();
  await tampered.goto(url.slice(0, -20) + "garbage");
  await expect(tampered.getByText("That share link is invalid or corrupted")).toBeVisible();
});

test("stress round: 115 × 12 × 3 stays interactive", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Demo round/ }).click();
  await page.getByRole("menuitem", { name: /Stress test/ }).click();
  await expect(page.getByRole("option")).toHaveCount(115);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Joint" }).click();
  await expect(page.getByRole("button", { name: "Joint" })).toHaveAttribute("aria-pressed", "true");
  expect(Date.now() - t0).toBeLessThan(2000);
});

test("budget slider has a fixed range and can't overfund past saturation", async ({ page }) => {
  await open(page);
  const thumb = page.getByRole("slider", { name: "Round budget" });
  await thumb.focus();
  // Repeatedly pushing to the end must not keep growing the range.
  for (let i = 0; i < 5; i++) await page.keyboard.press("End");
  const max = Number(await thumb.getAttribute("max"));
  expect(max).toBeLessThan(50_000_000);
  expect(Number(await thumb.getAttribute("aria-valuenow"))).toBe(max);
  const top = await page.getByRole("option").first().locator("span.tnum").first().innerText();
  expect(top).toMatch(/^\$\d(\.\d+)?M$/);
});

test("dragging the budget to $0 and back keeps every funder's share", async ({ page }) => {
  await open(page);
  const thumb = page.getByRole("slider", { name: "Round budget" });
  await thumb.focus();
  await page.keyboard.press("Home");
  await expect(page.locator("#budget")).toHaveValue("$0");
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
  for (const name of ["Harlow", "Ines", "Mateo"]) {
    const node = page.getByRole("button", { name: new RegExp(`^Funder ${name} \\(`) });
    await expect(node).not.toHaveAccessibleName(/\(\$0\)/);
  }
});

test("⌘K opens the command menu and jumps to an application without errors", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder("Search applications, views, rules…");
  await expect(input).toBeVisible();
  await input.fill("Lantern");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "Application" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lantern Interpretability Commons" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("opens in light mode even when the system prefers dark", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("tabpanel", { name: "Σ Overview" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);
  await ctx.close();
});
