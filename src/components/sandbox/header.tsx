"use client";

import { ChevronDown, Command, Download, FileJson, Link2, Moon, Radio, Redo2, RotateCcw, Sun, Undo2, Upload } from "lucide-react";
import { useTheme } from "next-themes";
import { useRef } from "react";
import { toast } from "sonner";
import { useStore as useZustand } from "zustand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { allocate } from "@/lib/engine";
import { initials, recColor } from "@/lib/colors";
import { clearDraft, download, parseScenarioJson, shareUrl } from "@/lib/persist";
import { PRESETS, type PresetId } from "@/lib/seed";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Header({ onOpenLive, onOpenCommand }: { onOpenLive(): void; onOpenCommand(): void }) {
  const scenario = useStore((s) => s.scenario);
  const load = useStore((s) => s.load);
  const live = useStore((s) => s.live);
  const canUndo = useZustand(useStore.temporal, (t) => t.pastStates.length > 0);
  const canRedo = useZustand(useStore.temporal, (t) => t.futureStates.length > 0);
  const { resolvedTheme, setTheme } = useTheme();
  const file = useRef<HTMLInputElement>(null);
  const isLive = live.status !== "off";

  function loadPreset(id: PresetId) {
    if (isLive) return toast.error("Leave the live session before loading another round.");
    load(PRESETS[id].make());
    clearDraft();
    toast.success(`Loaded ${PRESETS[id].label.toLowerCase()}`);
  }

  async function copyShare() {
    const url = shareUrl(scenario);
    await navigator.clipboard.writeText(url);
    toast.success("Link copied", { description: "The whole round is encoded in the link. Nothing is uploaded." });
  }

  function exportCsv() {
    const alloc = allocate(scenario);
    const head = [
      "application",
      "area",
      "ask",
      "allocated",
      ...scenario.funders.map((f) => `from ${f.name}`),
      ...scenario.recommenders.map((r) => `via ${r.name}`),
    ];
    const rows = scenario.applications.map((a, i) => [
      a.name,
      a.area,
      a.ask,
      Math.round(alloc.totals[i]),
      ...alloc.byFunder.map((row) => Math.round(row[i])),
      ...alloc.byRec.map((row) => Math.round(row[i])),
    ]);
    // Neutralize spreadsheet formula prefixes in text cells.
    const cell = (v: string | number) => {
      const s = String(v);
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    download("allocation.csv", [head, ...rows].map((r) => r.map(cell).join(",")).join("\n"), "text/csv");
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3 sm:gap-2">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">S-Process Sandbox</span>
      </div>
      <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="min-w-0 max-w-36 gap-1 font-normal sm:max-w-56" />}>
          <span className="truncate">{scenario.name}</span>
          <ChevronDown className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Load a round</DropdownMenuLabel>
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <DropdownMenuItem key={id} onClick={() => loadPreset(id)} className="flex-col items-start gap-0">
                <span>{PRESETS[id].label}</span>
                <span className="text-xs text-muted-foreground">{PRESETS[id].detail}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => file.current?.click()} disabled={isLive}>
            <Upload /> Import round (JSON)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => download("round.json", JSON.stringify(scenario, null, 2))}>
            <FileJson /> Export round (JSON)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportCsv}>
            <Download /> Export allocation (CSV)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => loadPreset("demo")} disabled={isLive}>
            <RotateCcw /> Reset to demo round
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 2_000_000) return toast.error("File too large");
          const s = parseScenarioJson(await f.text());
          if (!s) return toast.error("That file isn't a valid round");
          load(s);
          toast.success(`Imported ${s.name}`);
        }}
      />
      <Badge variant="outline" className="hidden font-normal text-muted-foreground md:inline-flex">
        Independent prototype · fictional data
      </Badge>

      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onOpenLive}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap transition-[background-color,transform] hover:bg-accent active:scale-[0.96]",
            live.status === "live" && "border-[color-mix(in_oklch,var(--good)_40%,transparent)]",
          )}
        >
          <Radio className={cn("size-3.5", live.status === "live" && "text-[var(--good)]")} />
          {live.status === "off"
            ? "Go live"
            : live.status === "live"
              ? live.seat?.label
              : live.status === "error"
                ? "Session error"
                : "Connecting…"}
          {live.peers.length > 0 && (
            <span className="ml-0.5 flex -space-x-1">
              {live.peers.slice(0, 5).map((p) => (
                <span
                  key={p.id}
                  className="inline-flex size-4 items-center justify-center rounded-full text-[8px] font-semibold text-white ring-2 ring-background"
                  style={{ background: p.rec ? recColor(scenario.recommenders.findIndex((r) => r.id === p.rec)) : "var(--foreground)" }}
                  title={p.label}
                >
                  {initials(p.label)}
                </span>
              ))}
            </span>
          )}
        </button>
        <IconTip label="Copy share link">
          <Button variant="ghost" size="icon-sm" onClick={copyShare} aria-label="Copy share link">
            <Link2 />
          </Button>
        </IconTip>
        <IconTip label={isLive ? "Undo is off in live sessions" : "Undo (⌘Z)"}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => useStore.temporal.getState().undo()}
            disabled={!canUndo || isLive}
            aria-label="Undo"
          >
            <Undo2 />
          </Button>
        </IconTip>
        <IconTip label="Redo (⇧⌘Z)">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => useStore.temporal.getState().redo()}
            disabled={!canRedo || isLive}
            aria-label="Redo"
            className="hidden sm:inline-flex"
          >
            <Redo2 />
          </Button>
        </IconTip>
        <IconTip label="Toggle theme">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            <Sun className="hidden dark:block" />
            <Moon className="dark:hidden" />
          </Button>
        </IconTip>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenCommand}
          className="hidden gap-1.5 text-muted-foreground sm:inline-flex"
          aria-label="Open command menu"
        >
          <Command className="size-3.5" />
          <Kbd>⌘K</Kbd>
        </Button>
      </div>
    </header>
  );
}

function IconTip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect width="24" height="24" rx="6" className="fill-foreground" />
      <path d="M5 7 C 9 7, 10 9, 12 12 S 16 17, 19 17" fill="none" stroke="var(--background)" strokeWidth="2" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="var(--rec-1)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
