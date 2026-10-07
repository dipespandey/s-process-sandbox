"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { connect, parseLiveHash, sendView } from "@/lib/live/client";
import { decodeScenario, loadDraft, saveDraft } from "@/lib/persist";
import { useStore, type Tab } from "@/lib/store";
import { AnalysisProvider } from "./analysis-context";
import { ApplicationList } from "./application-list";
import { ApplicationPanel } from "./application-panel";
import { CommandMenu } from "./command-menu";
import { FundersPanel } from "./funders-panel";
import { FurtherPanel } from "./further-panel";
import { Guide } from "./guide";
import { Header } from "./header";
import { LiveDialog } from "./live-dialog";
import { MatrixPanel } from "./matrix-panel";
import { MethodPanel } from "./method-panel";
import { OverviewPanel } from "./overview-panel";
import { PathPanel } from "./path-panel";
import { RecommenderPanel } from "./recommender-panel";
import { RoundControls } from "./round-controls";
import { TABS } from "./tabs";

// The sensitivity panel owns a Web Worker; load it only when opened.
const SensitivityPanel = dynamic(() => import("./sensitivity-panel").then((m) => m.SensitivityPanel), { ssr: false });

const PANELS: Record<Tab, React.ComponentType> = {
  overview: OverviewPanel,
  recommender: RecommenderPanel,
  application: ApplicationPanel,
  funders: FundersPanel,
  matrix: MatrixPanel,
  path: PathPanel,
  further: FurtherPanel,
  sensitivity: SensitivityPanel,
  method: MethodPanel,
};

function useBoot() {
  const ready = useStore((s) => s.booted);
  useEffect(() => {
    const st = useStore.getState();
    const liveHash = parseLiveHash(window.location.hash);
    const shared = window.location.hash.startsWith("#s=") ? decodeScenario(window.location.hash.slice(3)) : null;
    if (liveHash) connect(liveHash.room, liveHash.token);
    else if (window.location.hash.startsWith("#s=")) {
      if (shared) {
        st.load(shared);
        toast.success("Opened a shared round", { description: "Edits stay on this device until you share again." });
      } else toast.error("That share link is invalid or corrupted");
      history.replaceState(null, "", window.location.pathname);
    } else {
      const draft = loadDraft();
      st.load(draft ?? st.scenario);
    }
    st.setBooted();
  }, []);

  // Solo drafts autosave; live sessions are persisted by the server instead.
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.scenario !== prev.scenario && s.live.status === "off") {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => saveDraft(useStore.getState().scenario), 400);
        }
        if (s.selectedApp !== prev.selectedApp && s.live.status === "live") sendView(s.selectedApp);
      }),
    [],
  );
  return ready;
}
let saveTimer: ReturnType<typeof setTimeout>;

function useShortcuts(openCommand: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, [contenteditable=true], [role=slider]");
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openCommand();
        return;
      }
      if (typing) return;
      const st = useStore.getState();
      if (mod && e.key.toLowerCase() === "z" && st.live.status === "off") {
        e.preventDefault();
        const temporal = useStore.temporal.getState();
        if (e.shiftKey) temporal.redo();
        else temporal.undo();
        return;
      }
      if (!mod && !e.altKey && /^[1-9]$/.test(e.key)) st.setTab(TABS[Number(e.key) - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCommand]);
}

export function Sandbox() {
  const ready = useBoot();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const [liveOpen, setLiveOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const reduced = useReducedMotion();
  useShortcuts(() => setCmdOpen(true));
  const Panel = PANELS[tab];

  return (
    <AnalysisProvider>
      <div className="flex h-dvh flex-col overflow-y-auto lg:overflow-hidden" aria-busy={!ready}>
        <Header onOpenLive={() => setLiveOpen(true)} onOpenCommand={() => setCmdOpen(true)} />
        <RoundControls />
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)] lg:min-h-0 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
          <aside className="flex max-h-[60vh] min-h-0 flex-col border-b bg-sidebar lg:max-h-none lg:border-r lg:border-b-0">
            <ApplicationList />
          </aside>
          <main className="flex min-w-0 flex-col lg:min-h-0">
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-0">
              <div className="overflow-x-auto border-b px-2 lg:px-3.5">
                <TabsList variant="line" className="h-10">
                  {TABS.map((t, i) => (
                    <TabsTrigger key={t.id} value={t.id} className="gap-1.5 text-xs" title={`${t.label} (${i + 1})`}>
                      <t.icon className="size-3.5" />
                      {t.short}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>
            <div className="flex-1 lg:min-h-0 lg:overflow-y-auto">
              {ready && <Guide />}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tab}
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full max-w-[1480px] p-4 lg:p-6"
                  role="tabpanel"
                  aria-label={TABS.find((t) => t.id === tab)?.label}
                >
                  {ready && <Panel />}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>
      <LiveDialog open={liveOpen} onOpenChange={setLiveOpen} />
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} onOpenLive={() => setLiveOpen(true)} />
    </AnalysisProvider>
  );
}
