# S-Process Sandbox

**Live:** https://s-process-sandbox.pandey-dipesh50.workers.dev

An interactive, independent prototype of S-Process grant allocation, built from Andrew Critch's public talk
[“S-process funding”](https://www.youtube.com/watch?v=jWivz6KidkI) (Funding the Commons, 2021) and SFF's public
[S-Process](https://survivalandflourishing.fund/s-process) and
[further-opportunities](https://survivalandflourishing.fund/2025/further-opportunities) pages.

Recommenders enter marginal value functions for each application (first-dollar value, last-dollar threshold, concavity) plus a `_hold_`
line. Funders enter the same kind of curve over the Recommenders they trust. A simulation in which the funders take turns, each handing out
0.1% of their budget per turn, turns that into a projected final allocation. The sandbox explains every result, shows each Recommender's
unilateral allocation and their difference from the projection, and adds sensitivity analysis, the budget path, SFF's +$5M / +$15M
method and live multi-seat sessions.

Built by Dipesh Pandey as a work sample. **Not affiliated with SFF or SFC. All applications, Recommenders, funders and numbers are fictional.**

## What to try

1. **Σ Overview**: the projected final allocation as a flow from funders through Recommenders to applications, and Σ's disagreements
   with any Recommender.
2. **The perspective tree** (top left): click Σ, a funder or a Recommender to look through their eyes. A Recommender's view shows their
   unilateral allocation and every curve they entered, with an editable FDV / LDT / CONC table.
3. **Drag a handle**: the dot on the y-axis (first-dollar value), the dot on the x-axis (last-dollar threshold) or the diamond
   (concavity). Every handle also takes arrow keys. The whole round re-runs live, and each application's plain-language explanation updates.
4. **Funders**: each funder's budget, their curves over Recommenders, and their **final say**. Declining an application keeps every one
   of that funder's dollars away from it.
5. **Disagreement matrix**: FDV, LDT, concavity and difference from projected, side by side, as the discussion prompt for a meeting.
6. **Switch the combination rule** to *Average* and watch which applications lose out when specialist views are averaged away.
7. **+$5M / +$15M**, **Sensitivity** (runs in a Web Worker) and **Budget path** (every smaller round is a prefix of a larger one).
8. **Go live**: one capability link per seat (facilitator, each funder, each Recommender, observer); the server enforces who can change what.
9. **Stress test** (round menu): 115 applications × 12 Recommenders × 3 funders still re-runs within a frame.

## Run it

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm test            # engine unit + property tests (Vitest, fast-check)
pnpm preview         # static build + Worker + Durable Object on http://localhost:8788
pnpm test:e2e        # Playwright: perspectives, editing, undo, final say, sharing, live permissions, a11y (axe), mobile
pnpm typecheck && pnpm lint
```

`pnpm dev` runs the UI alone (live sessions need the Worker; set `NEXT_PUBLIC_LIVE_ORIGIN=http://localhost:8788` and run
`npx wrangler dev --port 8788` beside it). Deploy with `pnpm deploy` (uses the account in `wrangler.jsonc`).

## The model

Everything below is in `src/lib/engine`, pure TypeScript with no UI dependencies.

**From the talk and SFF's pages**

- Aggregate marginal value functions, not money. Values are relative to your most valuable dollar (1.0).
- Each curve has a **first-dollar value (FDV)**, a **last-dollar threshold (LDT)** and a **concavity (CONC)**, the parameters shown in the
  S-Process app, plus a `_hold_` curve for "keep this money for a future round".
- Funders draw curves over Recommenders ("how good is it to route more money through this person's judgment?").
- Several funders take turns, each giving about 0.1% of their budget per turn, so there is no ordering effect, bystander effect or pile-on.
- **Unilateral allocation** per Recommender, **Σ projected final allocation**, and a **disagreement matrix** including the difference from projected.
- **Funder final say**, and SFF's +$5M / +$15M method with its publication threshold.

**My interpretation** (labelled as such in the app's Method view)

- The curve family is a superellipse from (0, FDV) to (LDT, 0) with exponent 2^(3·conc). Zero is a straight line, positive holds value
  until near the threshold, negative drops quickly. Every shape is non-increasing, so total utility stays concave.
- A Recommender's curve is evaluated at the application's *total* funding, so nobody pays twice for the same need.
- Three combination rules for each funder's turn: *two-stage delegation* (default: route the slice through the most-trusted Recommender,
  who spends it on their best use, possibly `_hold_`), *joint* (deference × marginal value) and *weighted average*.
- Final say is each funder's veto on their own money. The weights in SFF's "proportional" $10M split are each Recommender's share of
  delegation so far.

### Properties the tests check

`tests/unit/engine.test.ts` uses fast-check over random multi-funder rounds, for every rule:

- Money is conserved across funders, Recommenders and applications; no funder spends more than their budget.
- No application is funded past every evaluator's last-dollar threshold; no funder's money reaches an application they declined.
- A proportionally larger budget never takes money away from anyone (greedy prefix property).
- With one Recommender, greedy allocation matches a brute-force dynamic-programming optimum.
- Under two-stage delegation, scaling all of one Recommender's curves leaves the allocation unchanged.
- The concavity handle round-trips; curves start at FDV, end at LDT and never rise.
- A Recommender can never edit a funder's trust in themselves, anyone else's curves, the rule or a budget.

Re-runs are fast because each step only refreshes the application that changed: marginal values are cached per (Recommender,
application) in typed arrays, and steps are capped at saturation points so a large step can never overfund.

## Architecture

| Layer | Choice |
| --- | --- |
| UI | Next.js 16 (App Router, static export), React 19 with the React Compiler, TypeScript |
| Design system | shadcn/ui on Base UI, Tailwind CSS v4, OKLCH tokens, Geist; light and dark themes |
| Motion | Motion 14: layout re-ordering, spring markers, number tweening; honours reduced motion |
| Charts | Custom SVG + d3-scale/d3-shape for editable curves and the budget path; d3-sankey for the Σ flow; Recharts 3 for bar charts |
| State | Zustand + zundo (one undo entry per drag gesture); share links are lz-string compressed and schema-validated |
| Heavy analysis | Sensitivity runs in a Web Worker via Comlink |
| Realtime | Cloudflare Worker + Durable Object (PartyServer, SQLite-backed, hibernating WebSockets) |
| Validation | One set of zod schemas shared by browser and server |

### Live-session security

- One **capability token per seat**, 192 bits, carried in the URL **fragment** so it never reaches server logs or `Referer`. It is sent
  once over the WebSocket and stored server-side only as a SHA-256 hash (constant-time compare).
- The Durable Object is the **single writer**. Every message is size-capped, rate-limited per connection (token bucket) and parsed with
  zod. It is then **authorized by edit type against the sender's seat**, re-normalized, versioned, persisted and broadcast.
  - Recommenders edit only their own curves (including `_hold_`) and simulated budget.
  - Each funder edits only their own deference, budget and final say.
  - Only the facilitator changes the rule; observers are read-only.
- Clients apply edits optimistically and converge on server order: a client re-applies its own echo only if it is its newest op for that key.
- Room creation checks content type, origin and size, and validates the whole scenario. Sessions expire after 30 days (DO alarm).
- Static assets ship with CSP, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` and `nosniff`.

## Limitations

- This is not SFC's software or SFF's algorithm. The talk is from 2021, the real app has surely moved on, and the curve family and
  combination rules here are interpretations.
- Live sessions are a prototype: there are no accounts, and invite links are bearer credentials. Undo is per-device and off in live mode.
- Speculation Grants, matching pledges and recorded discussion notes are not modelled.
- Categorical colour is reserved for Recommender identity and validated for the first eight; beyond that, Recommenders fold to a neutral
  grey and are told apart by name.
