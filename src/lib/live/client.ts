"use client";

import { PartySocket } from "partysocket";
import { toast } from "sonner";
import type { Scenario } from "../engine";
import { OFFLINE, useStore } from "../store";
import type { ClientMessage, Op, Role, ServerMessage } from "./protocol";

const ORIGIN = process.env.NEXT_PUBLIC_LIVE_ORIGIN || "";

export interface Invite {
  role: Role;
  rec?: string;
  label: string;
  token: string;
}

export function inviteUrl(room: string, token: string) {
  const base = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  return `${base}#live=${room}&k=${token}`;
}

export function parseLiveHash(hash: string): { room: string; token: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const room = p.get("live"),
    token = p.get("k");
  return room && token && /^[A-Za-z0-9_-]{8,20}$/.test(room) ? { room, token } : null;
}

export async function createSession(scenario: Scenario): Promise<{ room: string; invites: Invite[] }> {
  const res = await fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Could not start session (${res.status})`);
  return res.json();
}

/** Key identifying what an op overwrites; ops are whole-value replacements, so last writer per key wins. */
function opKey(op: Op) {
  switch (op.type) {
    case "evaluation":
      return `e:${op.rec}:${op.app}`;
    case "deference":
      return `d:${op.funder}:${op.rec}`;
    case "budget":
      return `b:${op.funder}`;
    case "veto":
      return `v:${op.funder}:${op.app}`;
    case "simBudget":
      return `s:${op.rec}`;
    default:
      return op.type;
  }
}

let socket: PartySocket | null = null;

export function connect(room: string, token: string) {
  disconnect();
  const store = useStore.getState();
  store.setLive({ ...OFFLINE, status: "connecting", room });
  let seq = 0;
  let first = true;
  const latest = new Map<string, number>();
  const timers = new Map<string, { timer: ReturnType<typeof setTimeout> | null; pending: Op | null; last: number }>();

  const ws = new PartySocket({
    host: ORIGIN ? new URL(ORIGIN).host : window.location.host,
    protocol: ORIGIN.startsWith("http://") ? "ws" : undefined,
    party: "room",
    room,
  });
  socket = ws;

  const send = (msg: ClientMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  const flush = (op: Op) => {
    const s = ++seq;
    latest.set(opKey(op), s);
    send({ type: "op", op, seq: s });
  };

  // Leading + trailing throttle per key: a dragged point streams ~20 updates/s, never floods.
  const sender = (op: Op) => {
    const key = opKey(op);
    const t = timers.get(key) ?? { timer: null, pending: null, last: 0 };
    timers.set(key, t);
    const now = Date.now();
    if (now - t.last >= 50 && !t.timer) {
      t.last = now;
      flush(op);
      return;
    }
    t.pending = op;
    if (!t.timer)
      t.timer = setTimeout(() => {
        t.timer = null;
        t.last = Date.now();
        if (t.pending) flush(t.pending);
        t.pending = null;
      }, 50);
  };

  ws.addEventListener("open", () => send({ type: "auth", token }));
  ws.addEventListener("message", (e) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data as string);
    } catch {
      return;
    }
    const st = useStore.getState();
    switch (msg.type) {
      case "welcome":
        if (first) st.load(msg.scenario);
        else st.replace(msg.scenario);
        first = false;
        st.setSender(sender);
        st.setLive({ status: "live", seat: msg.seat, peers: msg.peers, you: msg.you, version: msg.version, message: null });
        send({ type: "view", app: st.selectedApp });
        // Open each participant on their own part of the round.
        if (msg.seat.role === "recommender" && msg.seat.rec) st.look({ kind: "rec", id: msg.seat.rec });
        if (msg.seat.role === "funder" && msg.seat.funder) st.look({ kind: "funder", id: msg.seat.funder });
        break;
      case "op": {
        const key = opKey(msg.op);
        const mine = msg.by === st.live.you;
        // Re-apply our own echo only if it is our newest op for that key; that converges on server order
        // without snapping a dragged point back to an older position.
        if (!mine || msg.seq === latest.get(key)) st.receive(msg.op);
        st.setLive({ version: msg.version });
        break;
      }
      case "presence":
        st.setLive({ peers: msg.peers });
        break;
      case "reject":
        st.replace(msg.scenario);
        st.setLive({ version: msg.version });
        toast.error(msg.reason);
        break;
      case "error":
        if (msg.code === "auth") {
          st.setLive({ status: "error", message: msg.message });
          st.setSender(null);
          ws.close();
          toast.error(msg.message);
        } else toast.warning(msg.message);
        break;
    }
  });
  ws.addEventListener("close", (e) => {
    const st = useStore.getState();
    if (st.live.status === "live") st.setLive({ status: "connecting", message: "Reconnecting…" });
    if (e.code === 4001 || e.code === 4004) {
      st.setLive({ status: "error", message: e.reason || "Session unavailable" });
      st.setSender(null);
      ws.close();
    }
  });
}

export function sendView(app: string | null) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "view", app } satisfies ClientMessage));
}

export function disconnect() {
  socket?.close();
  socket = null;
  const st = useStore.getState();
  st.setSender(null);
  st.setLive(OFFLINE);
}
