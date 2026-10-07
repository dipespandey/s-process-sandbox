import { expect, test, type Page } from "@playwright/test";
import { demoScenario } from "../../src/lib/seed";

type Invite = { role: string; rec?: string; funder?: string; token: string };

/** Open a raw socket as a seat and send one op; resolve with the server's verdict. */
function forge(page: Page, room: string, token: string, op: unknown) {
  return page.evaluate(
    async ({ room, token, op }) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/parties/room/${room}`);
        ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (m.type === "welcome") ws.send(JSON.stringify({ type: "op", seq: 1, op }));
          if (m.type === "reject") resolve(`reject: ${m.reason}`);
          if (m.type === "op") resolve("accepted");
        };
        setTimeout(() => resolve("timeout"), 5000);
      }),
    { room, token, op },
  );
}

test("live session: every seat is enforced by the server and edits sync", async ({ browser, request }) => {
  const res = await request.post("/api/rooms", { data: { scenario: demoScenario() } });
  expect(res.status()).toBe(201);
  const { room, invites } = (await res.json()) as { room: string; invites: Invite[] };
  expect(invites.filter((i) => i.role === "funder").map((i) => i.funder)).toEqual(["harlow", "ines", "mateo"]);
  const facilitator = invites.find((i) => i.role === "facilitator")!;
  const avery = invites.find((i) => i.rec === "avery")!;
  const harlow = invites.find((i) => i.funder === "harlow")!;

  const ctxA = await browser.newContext();
  const ctxF = await browser.newContext();
  const pa = await ctxA.newPage();
  const pf = await ctxF.newPage();
  await pf.goto(`/#live=${room}&k=${facilitator.token}`);
  await pa.goto(`/#live=${room}&k=${avery.token}`);
  // Each participant opens on their own part of the round.
  await expect(pa.getByRole("heading", { name: "Avery's unilateral allocation" })).toBeVisible();

  // The server refuses, by edit type, anything a seat doesn't own.
  expect(await forge(pa, room, avery.token, { type: "budget", funder: "harlow", value: 1 })).toMatch(/reject: Only that funder/);
  expect(await forge(pa, room, avery.token, { type: "deference", funder: "harlow", rec: "avery", curve: { fdv: 2, ldt: 9e6, conc: 0 } })).toMatch(
    /reject/,
  );
  expect(await forge(pa, room, avery.token, { type: "evaluation", rec: "bram", app: "_hold_", curve: null })).toMatch(/reject/);
  expect(await forge(pa, room, harlow.token, { type: "budget", funder: "ines", value: 1 })).toMatch(/reject/);
  expect(await forge(pa, room, harlow.token, { type: "rule", value: "joint" })).toMatch(/reject: Only the facilitator/);
  expect(await forge(pa, room, harlow.token, { type: "veto", funder: "harlow", app: "seedling-student-research-grants", declined: true })).toBe(
    "accepted",
  );

  // An invalid token is refused outright.
  const bad = await pa.evaluate(
    async ({ room }) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/parties/room/${room}`);
        ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: "x".repeat(32) }));
        ws.onclose = (e) => resolve(String(e.code));
        setTimeout(() => resolve("timeout"), 5000);
      }),
    { room },
  );
  expect(bad).toBe("4001");

  // Avery's own edit reaches the facilitator.
  await pf.keyboard.press("3");
  const name = /Harbor Evals/;
  await pf.getByRole("option", { name }).click();
  const totalF = () => pf.getByRole("option", { name }).locator("span.tnum").first().innerText();
  const before = await totalF();
  await pa.keyboard.press("3");
  await pa.getByRole("option", { name }).click();
  await pa.getByRole("radio", { name: /Avery/ }).click();
  const handle = pa.getByRole("slider", { name: "Avery: First-dollar value" });
  await handle.focus();
  for (let i = 0; i < 4; i++) await pa.keyboard.press("Shift+ArrowDown");
  await expect.poll(totalF, { timeout: 5000 }).not.toBe(before);

  await ctxA.close();
  await ctxF.close();
});

test("room creation validates input", async ({ request }) => {
  expect((await request.post("/api/rooms", { data: { scenario: { nope: 1 } } })).status()).toBe(400);
  expect((await request.post("/api/rooms", { headers: { "content-type": "text/plain" }, data: "x" })).status()).toBe(415);
  expect((await request.get("/parties/room/../../etc")).status()).toBe(404);
});
