import { getServerByName, routePartykitRequest, Server, type Connection } from "partyserver";
import { ScenarioSchema, type Scenario } from "../src/lib/engine/types";
import {
  ClientMessageSchema,
  MAX_MESSAGE_BYTES,
  applyOp,
  authorize,
  type Peer,
  type Seat,
  type ServerMessage,
} from "../src/lib/live/protocol";

const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SCENARIO_BYTES = 512 * 1024;
const BUCKET = { capacity: 60, refillPerSecond: 30 };

interface ConnState {
  seat?: Seat;
  viewing: string | null;
  tokens: number;
  at: number;
}

interface StoredSeat {
  hash: string;
  seat: Seat;
}

/**
 * One Durable Object per live session. It is the single writer: every op is parsed,
 * authorized against the sender's seat, applied, versioned, persisted, then broadcast.
 * Capability tokens are stored only as SHA-256 hashes.
 */
export class Room extends Server<Env> {
  static options = { hibernate: true };

  private scenario: Scenario | null = null;
  private version = 0;
  private seats: StoredSeat[] = [];

  async onStart() {
    this.scenario = (await this.ctx.storage.get<Scenario>("scenario")) ?? null;
    this.version = (await this.ctx.storage.get<number>("version")) ?? 0;
    this.seats = (await this.ctx.storage.get<StoredSeat[]>("seats")) ?? [];
  }

  /** RPC from the Worker when a session is created. */
  async init(scenario: Scenario, seats: StoredSeat[]) {
    if (this.scenario) throw new Error("Room already initialized");
    this.scenario = scenario;
    this.seats = seats;
    this.version = 1;
    await this.ctx.storage.put({ scenario, seats, version: 1 });
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async onAlarm() {
    for (const c of this.getConnections()) c.close(4004, "Session expired");
    await this.ctx.storage.deleteAll();
  }

  onConnect(conn: Connection<ConnState>) {
    conn.setState({ viewing: null, tokens: BUCKET.capacity, at: Date.now() });
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private peers(): Peer[] {
    const out: Peer[] = [];
    for (const c of this.getConnections<ConnState>()) {
      const s = c.state;
      if (s?.seat)
        out.push({ id: c.id, label: s.seat.label, role: s.seat.role, rec: s.seat.rec, funder: s.seat.funder, viewing: s.viewing });
    }
    return out;
  }

  private broadcastPresence() {
    this.broadcast(JSON.stringify({ type: "presence", peers: this.peers() } satisfies ServerMessage));
  }

  private allow(conn: Connection<ConnState>): boolean {
    const s = conn.state!;
    const now = Date.now();
    const tokens = Math.min(BUCKET.capacity, s.tokens + ((now - s.at) / 1000) * BUCKET.refillPerSecond);
    if (tokens < 1) return false;
    conn.setState({ ...s, tokens: tokens - 1, at: now });
    return true;
  }

  async onMessage(conn: Connection<ConnState>, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) {
      this.send(conn, { type: "error", code: "invalid", message: "Message too large" });
      return;
    }
    if (!this.scenario) {
      this.send(conn, { type: "error", code: "auth", message: "This session does not exist or has expired" });
      conn.close(4004, "Unknown session");
      return;
    }
    if (!this.allow(conn)) {
      this.send(conn, { type: "error", code: "rate", message: "Too many updates; slow down" });
      return;
    }
    let parsed;
    try {
      parsed = ClientMessageSchema.safeParse(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      this.send(conn, { type: "error", code: "invalid", message: "Malformed message" });
      return;
    }
    const msg = parsed.data;
    const state = conn.state!;

    if (msg.type === "auth") {
      const hash = await sha256(msg.token);
      const match = this.seats.find((s) => timingSafeEqual(s.hash, hash));
      if (!match) {
        this.send(conn, { type: "error", code: "auth", message: "This invite link is not valid" });
        conn.close(4001, "Invalid token");
        return;
      }
      conn.setState({ ...state, seat: match.seat });
      this.send(conn, {
        type: "welcome",
        seat: match.seat,
        scenario: this.scenario,
        version: this.version,
        peers: this.peers(),
        you: conn.id,
      });
      this.broadcastPresence();
      return;
    }

    if (!state.seat) {
      this.send(conn, { type: "error", code: "auth", message: "Authenticate first" });
      conn.close(4001, "Unauthenticated");
      return;
    }

    if (msg.type === "view") {
      conn.setState({ ...state, viewing: msg.app });
      this.broadcastPresence();
      return;
    }

    const denied = authorize(state.seat, msg.op, this.scenario);
    if (denied) {
      this.send(conn, { type: "reject", seq: msg.seq, reason: denied, scenario: this.scenario, version: this.version });
      return;
    }
    this.scenario = applyOp(this.scenario, msg.op);
    this.version += 1;
    await this.ctx.storage.put({ scenario: this.scenario, version: this.version });
    const op: ServerMessage = { type: "op", op: msg.op, version: this.version, by: conn.id, label: state.seat.label };
    for (const c of this.getConnections<ConnState>()) {
      if (!c.state?.seat) continue;
      this.send(c, c.id === conn.id ? { ...op, seq: msg.seq } : op);
    }
  }

  onClose() {
    this.broadcastPresence();
  }
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function token(bytes = 24) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function createRoom(request: Request, env: Env) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "Expected JSON" }, 415);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Cross-origin request" }, 403);
  const text = await request.text();
  if (text.length > MAX_SCENARIO_BYTES) return json({ error: "Scenario too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = ScenarioSchema.safeParse((body as { scenario?: unknown })?.scenario);
  if (!parsed.success) return json({ error: "Invalid scenario", issues: parsed.error.issues.slice(0, 5) }, 400);
  const scenario = parsed.data;

  const seats: Seat[] = [
    { role: "facilitator", label: "Facilitator" },
    ...scenario.funders.map((f) => ({ role: "funder" as const, funder: f.id, label: f.name })),
    ...scenario.recommenders.map((r) => ({ role: "recommender" as const, rec: r.id, label: r.name })),
    { role: "observer", label: "Observer" },
  ];
  const issued = seats.map((seat) => ({ seat, token: token() }));
  const stored = await Promise.all(issued.map(async ({ seat, token }) => ({ seat, hash: await sha256(token) })));
  const room = token(9);
  const stub = await getServerByName(env.Room, room);
  await stub.init(scenario, stored);
  return json({ room, invites: issued.map(({ seat, token }) => ({ ...seat, token })) }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/rooms" && request.method === "POST") return createRoom(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    if (url.pathname.startsWith("/parties/")) {
      if (!/^\/parties\/room\/[A-Za-z0-9_-]{8,20}$/.test(url.pathname)) return json({ error: "Not found" }, 404);
      return (await routePartykitRequest(request, env)) ?? json({ error: "Not found" }, 404);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
