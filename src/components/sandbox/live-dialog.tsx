"use client";

import { Check, Copy, ExternalLink, Loader2, Radio, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { initials, recColor } from "@/lib/colors";
import { connect, createSession, disconnect, inviteUrl, type Invite } from "@/lib/live/client";
import { ROLE_LABEL } from "@/lib/live/protocol";
import { useStore } from "@/lib/store";

const INVITES_KEY = (room: string) => `s-process-sandbox:invites:${room}`;

export function LiveDialog({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const live = useStore((s) => s.live);
  const scenario = useStore((s) => s.scenario);
  const [busy, setBusy] = useState(false);
  const [created, setInvites] = useState<Invite[] | null>(null);
  // A facilitator who reloads keeps their invite links for this tab (sessionStorage only).
  const invites = created ?? readInvites(live.room);

  async function start() {
    setBusy(true);
    try {
      const { room, invites } = await createSession(scenario);
      setInvites(invites);
      try {
        sessionStorage.setItem(INVITES_KEY(room), JSON.stringify(invites));
      } catch {}
      const me = invites.find((i) => i.role === "facilitator")!;
      history.replaceState(null, "", `#live=${room}&k=${me.token}`);
      connect(room, me.token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start a session");
    } finally {
      setBusy(false);
    }
  }

  function leave() {
    disconnect();
    history.replaceState(null, "", window.location.pathname);
    setInvites(null);
    onOpenChange(false);
  }

  const isLive = live.status === "live" || live.status === "connecting";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-4" /> Live session
          </DialogTitle>
          <DialogDescription>
            Run a meeting on this round: each participant gets their own link and can move only what their role allows. Everyone sees edits
            as they happen.
          </DialogDescription>
        </DialogHeader>

        {!isLive && (
          <div className="grid gap-2 text-sm">
            {[
              ["Facilitator", "edits anything, including the combination rule; holds the invite links"],
              ["Each funder", "owns their own deference curves, budget and final say"],
              ["Each Recommender", "edits only their own curves (including _hold_) and simulated budget"],
              ["Observer", "view-only"],
            ].map(([role, what]) => (
              <div key={role} className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium">{role}</span> <span className="text-muted-foreground">{what}</span>
                </span>
              </div>
            ))}
            <p className="mt-1 text-xs text-muted-foreground">
              Sessions copy the current round to the server and expire after 30 days. Use fictional data only; this is a prototype.
            </p>
          </div>
        )}

        {isLive && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={live.status === "live" ? "default" : "secondary"}>
                {live.status === "live" ? "Connected" : "Reconnecting…"}
              </Badge>
              {live.seat && (
                <span>
                  You are <span className="font-medium">{live.seat.label}</span>
                  {live.seat.role !== "recommender" && live.seat.label !== ROLE_LABEL[live.seat.role]
                    ? ` (${ROLE_LABEL[live.seat.role]})`
                    : ""}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                <Users className="size-3.5" /> {live.peers.length} online
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {live.peers.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                  <span
                    className="inline-flex size-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                    style={{ background: p.rec ? recColor(scenario.recommenders.findIndex((r) => r.id === p.rec)) : "var(--foreground)" }}
                  >
                    {initials(p.label)}
                  </span>
                  {p.label}
                  {p.id === live.you && <span className="text-muted-foreground">(you)</span>}
                </span>
              ))}
            </div>
            {invites && live.seat?.role === "facilitator" ? (
              <div className="max-h-72 overflow-y-auto rounded-lg border">
                {invites.map((inv) => (
                  <InviteRow key={inv.token} room={live.room!} invite={inv} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Invite links are held by the facilitator who started the session.</p>
            )}
          </div>
        )}

        <DialogFooter>
          {isLive ? (
            <Button variant="outline" onClick={leave}>
              Leave session
            </Button>
          ) : (
            <Button onClick={start} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Radio />} Start live session
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteRow({ room, invite }: { room: string; invite: Invite }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(room, invite.token);
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{invite.label}</div>
        <div className="text-xs text-muted-foreground">{ROLE_LABEL[invite.role]}</div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label={`Copy invite link for ${invite.label}`}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        render={<a href={url} target="_blank" rel="noreferrer" aria-label={`Open as ${invite.label} in a new tab`} />}
      >
        <ExternalLink />
      </Button>
    </div>
  );
}

function readInvites(room: string | null): Invite[] | null {
  if (!room || typeof window === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(INVITES_KEY(room)) ?? "null");
  } catch {
    return null;
  }
}
