"use client";

import { ExternalLink } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { RULES, type Rule } from "@/lib/engine";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const TALK = "https://www.youtube.com/watch?v=jWivz6KidkI";

export function MethodPanel() {
  const rule = useStore((s) => s.scenario.rule);
  return (
    <article className="max-w-3xl text-sm leading-relaxed">
      <h2 className="text-xl font-semibold tracking-tight">How this sandbox works</h2>
      <p className="mt-2 text-muted-foreground">
        An independent prototype, built from Andrew Critch&apos;s public talk on the S-Process and SFF&apos;s public pages, to explore its
        interface and maths. It is not SFC&apos;s software or SFF&apos;s exact algorithm, and every application, Recommender, funder and
        number in it is fictional.
      </p>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <a className="inline-flex items-center gap-1 underline underline-offset-2" href={TALK} target="_blank" rel="noreferrer">
          Critch: &ldquo;S-process funding&rdquo; (Funding the Commons, 2021) <ExternalLink className="size-3" />
        </a>
        <a
          className="inline-flex items-center gap-1 underline underline-offset-2"
          href="https://survivalandflourishing.fund/s-process"
          target="_blank"
          rel="noreferrer"
        >
          SFF: S-Process <ExternalLink className="size-3" />
        </a>
        <a
          className="inline-flex items-center gap-1 underline underline-offset-2"
          href="https://survivalandflourishing.fund/2025/further-opportunities"
          target="_blank"
          rel="noreferrer"
        >
          SFF: 2025 further opportunities <ExternalLink className="size-3" />
        </a>
      </p>

      <h3 className="mt-6 font-medium">Taken from the talk and SFF&apos;s pages</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
        <li>
          Aggregate <span className="text-foreground">marginal value functions</span>, not money. Each curve has a{" "}
          <span className="text-foreground">first-dollar value</span>, a <span className="text-foreground">last-dollar threshold</span> and
          a <span className="text-foreground">concavity</span>; values are relative to your most valuable dollar, which is worth 1.0.
        </li>
        <li>
          A <span className="font-mono text-foreground">_hold_</span> line: the value of keeping money for a future round.
        </li>
        <li>
          Funders draw the same kind of curve over Recommenders: how good is it to route more money through this person&apos;s judgment?
        </li>
        <li>
          Several funders take turns in simulation, each handing out about <span className="text-foreground">0.1% of their budget</span> per
          turn, so nobody goes first and there is no bystander or pile-on effect.
        </li>
        <li>
          Each Recommender sees their <span className="text-foreground">unilateral allocation</span>; Σ shows the projected final
          allocation, a flow from funders through Recommenders, and its disagreements with each Recommender.
        </li>
        <li>
          A <span className="text-foreground">disagreement matrix</span> of FDV, LDT, concavity and difference from projected, used as a
          discussion prompt.
        </li>
        <li>
          <span className="text-foreground">Funder final say</span>, and repeated simulation during discussion.
        </li>
        <li>SFF&apos;s published method for the +$5M / +$15M further opportunities and their publication threshold.</li>
      </ul>

      <h3 className="mt-6 font-medium">My interpretation</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
        <li>
          The curve family: a superellipse from (0, FDV) to (LDT, 0), exponent 2<sup>3·conc</sup>. Zero concavity is a straight line,
          positive holds value until near the threshold, negative drops quickly. Every shape is non-increasing, so greedy allocation is
          optimal for one Recommender.
        </li>
        <li>
          A Recommender&apos;s curve is evaluated at the application&apos;s <em>total</em> funding from everyone, so nobody pays twice for
          the same need.
        </li>
        <li>
          The three combination rules below; the default is my reading of the talk. Final say is modelled as each funder&apos;s veto on
          their own money.
        </li>
        <li>The weights for SFF&apos;s &ldquo;proportional&rdquo; $10M split are each Recommender&apos;s share of delegation so far.</li>
      </ul>

      <h3 className="mt-6 font-medium">Combination rules</h3>
      <div className="mt-2 grid gap-2">
        {(Object.keys(RULES) as Rule[]).map((r) => (
          <div key={r} className={cn("rounded-lg border px-3 py-2.5", r === rule && "border-foreground/30 bg-accent/50")}>
            <div className="font-medium">
              {RULES[r].label} {r === rule && <span className="ml-1 text-xs font-normal text-muted-foreground">(current)</span>}
            </div>
            <p className="text-muted-foreground">{RULES[r].description}</p>
          </div>
        ))}
      </div>

      <h3 className="mt-6 font-medium">What this adds</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
        <li>A plain-language reason for every allocation, and who is on the margin for it.</li>
        <li>Sensitivity analysis (in a Web Worker), the budget path, and the further-opportunities scenarios on the same round.</li>
        <li>Live sessions where the server, not the browser, decides who may change what.</li>
        <li>Keyboard control of every curve handle, screen-reader labels, light and dark themes, and a layout that works on a phone.</li>
      </ul>

      <h3 className="mt-6 font-medium">Properties the test suite checks</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
        <li>Money is conserved across funders, Recommenders and applications, and no funder spends more than their budget.</li>
        <li>
          No application is funded past every evaluator&apos;s last-dollar threshold, and no funder&apos;s money reaches an application they
          declined.
        </li>
        <li>A proportionally larger budget never takes money away from anyone (greedy prefix property).</li>
        <li>With one Recommender, greedy allocation matches a brute-force optimum.</li>
        <li>Under two-stage delegation, scaling all of a Recommender&apos;s curves leaves the allocation unchanged.</li>
        <li>A Recommender can never change a funder&apos;s trust in themselves, or anyone else&apos;s curves.</li>
        <li>A 115 × 12 × 3 round re-runs in a few milliseconds.</li>
      </ul>

      <h3 className="mt-6 font-medium">Keyboard</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted-foreground">
        <dt>
          <Kbd>⌘</Kbd> <Kbd>K</Kbd>
        </dt>
        <dd>Command menu: jump to an application, a perspective, a rule or a view</dd>
        <dt>
          <Kbd>J</Kbd> <Kbd>K</Kbd>
        </dt>
        <dd>Next / previous application (when the list is focused)</dd>
        <dt>
          <Kbd>⌘</Kbd> <Kbd>Z</Kbd> / <Kbd>⇧</Kbd> <Kbd>⌘</Kbd> <Kbd>Z</Kbd>
        </dt>
        <dd>Undo / redo (solo mode)</dd>
        <dt>
          <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd>
        </dt>
        <dd>Move a focused curve handle; hold Shift for bigger steps</dd>
        <dt>
          <Kbd>1</Kbd>–<Kbd>9</Kbd>
        </dt>
        <dd>Switch view</dd>
      </dl>

      <h3 className="mt-6 font-medium">Live sessions</h3>
      <p className="mt-2 text-muted-foreground">
        A live session puts the round in a Cloudflare Durable Object, which is the only writer. Each seat (facilitator, each funder, each
        Recommender, observer) gets its own capability link. The token sits in the URL fragment, so it never reaches server logs or
        referrers. It is sent once over the WebSocket and stored server-side only as a SHA-256 hash. Every edit is validated and checked
        against the sender&apos;s seat by its type before it is applied and broadcast.
      </p>
    </article>
  );
}
