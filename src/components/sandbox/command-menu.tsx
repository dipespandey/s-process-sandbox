"use client";

import { Eye, FileStack, Layers, Moon, Radio, Scale } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { RULES, type Rule } from "@/lib/engine";
import { money } from "@/lib/format";
import { PRESETS, type PresetId } from "@/lib/seed";
import { useStore, type Tab } from "@/lib/store";
import { useAnalysis } from "./analysis-context";
import { TABS } from "./tabs";

export function CommandMenu({ open, onOpenChange, onOpenLive }: { open: boolean; onOpenChange(v: boolean): void; onOpenLive(): void }) {
  const { scenario, alloc } = useAnalysis();
  const select = useStore((s) => s.select);
  const setTab = useStore((s) => s.setTab);
  const setRule = useStore((s) => s.setRule);
  const load = useStore((s) => s.load);
  const look = useStore((s) => s.look);
  const isLive = useStore((s) => s.live.status !== "off");
  const { resolvedTheme, setTheme } = useTheme();
  const run = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command menu" description="Jump to an application or run a command">
      {/* cmdk's input and list read shared state from the <Command> root, so it must wrap them. */}
      <Command>
        <CommandInput placeholder="Search applications, views, rules…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Views">
            {TABS.map((t, i) => (
              <CommandItem key={t.id} onSelect={() => run(() => setTab(t.id as Tab))}>
                <t.icon /> {t.label}
                <CommandShortcut>{i + 1}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Applications">
            {scenario.applications.map((a, i) =>
              a.id === "_hold_" ? null : (
                <CommandItem
                  key={a.id}
                  value={`${a.name} ${a.area}`}
                  onSelect={() =>
                    run(() => {
                      select(a.id);
                      setTab("application");
                    })
                  }
                >
                  <FileStack /> <span className="truncate">{a.name}</span>
                  <CommandShortcut className="tnum">{alloc.totals[i] > 0 ? money(alloc.totals[i]) : "—"}</CommandShortcut>
                </CommandItem>
              ),
            )}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Perspective">
            <CommandItem onSelect={() => run(() => look({ kind: "sigma" }))}>
              <Eye /> Look through Σ (projected final)
            </CommandItem>
            {scenario.funders.map((f) => (
              <CommandItem key={f.id} value={`funder ${f.name}`} onSelect={() => run(() => look({ kind: "funder", id: f.id }))}>
                <Eye /> Look through funder {f.name}
              </CommandItem>
            ))}
            {scenario.recommenders.map((r) => (
              <CommandItem key={r.id} value={`recommender ${r.name}`} onSelect={() => run(() => look({ kind: "rec", id: r.id }))}>
                <Eye /> Look through {r.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Rule">
            {(Object.keys(RULES) as Rule[]).map((r) => (
              <CommandItem key={r} onSelect={() => run(() => setRule(r))}>
                <Scale /> Use {RULES[r].label.toLowerCase()}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Round">
            {!isLive &&
              (Object.keys(PRESETS) as PresetId[]).map((id) => (
                <CommandItem key={id} onSelect={() => run(() => load(PRESETS[id].make()))}>
                  <Layers /> Load {PRESETS[id].label.toLowerCase()}
                </CommandItem>
              ))}
            <CommandItem onSelect={() => run(onOpenLive)}>
              <Radio /> Live session…
            </CommandItem>
            <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              <Moon /> Toggle theme
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
