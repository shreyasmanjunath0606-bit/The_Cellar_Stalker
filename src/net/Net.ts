import type { DataConnection, Peer as PeerType } from 'peerjs';
import type { Difficulty } from '../core/Levels';
import type { StalkerSnapshot } from '../ai/Stalker';
import type { PlayerState } from '../player/Avatar';

export const MAX_PLAYERS = 5;

export interface PlayerInfo {
  id: string;
  name: string;
  /** Slot 0..4: decides colour and spawn point. */
  slot: number;
}

/** Things that change the shared world. The host decides; everyone applies them the same way. */
export type GameEvent =
  | { k: 'pickup'; item: number; by: string }
  | { k: 'step'; station: number; step: number; by: string }
  | { k: 'distract'; id: number; by: string }
  | { k: 'quiet'; id: number }
  | { k: 'shove'; prop: number; d: [number, number, number]; p: [number, number, number]; by: string }
  | { k: 'dart'; stalker: number; by: string }
  | { k: 'caught'; id: string; lives: number }
  | { k: 'escaped'; id: string; route: string }
  | { k: 'wake'; stalker: number }
  | { k: 'instinct' }
  | { k: 'over'; win: boolean; time: number };

export type Msg =
  // lobby
  | { t: 'hello'; name: string }
  | { t: 'roster'; players: PlayerInfo[]; night: number; diff: Difficulty; you: string }
  | { t: 'refuse'; why: string }
  // game
  | { t: 'start'; night: number; diff: Difficulty; seed: number; players: PlayerInfo[] }
  | { t: 'me'; s: PlayerState }
  | { t: 'world'; p: Record<string, PlayerState>; s: StalkerSnapshot[]; time: number; escapeIn: number }
  | { t: 'req'; ev: GameEvent }
  | { t: 'ev'; ev: GameEvent }
  | { t: 'noise'; x: number; y: number; z: number; r: number }
  | { t: 'toast'; text: string; warn: boolean }
  | { t: 'lobby' };

/** A star of connections: every client talks only to the host. */
interface Transport {
  /** Resolves once we are reachable (host) or connected to the host (client). */
  open(): Promise<void>;
  /** Host: send to one client. Client: `to` is ignored, everything goes to the host. */
  send(to: string, data: unknown): void;
  onData: (from: string, data: unknown) => void;
  /** Host only. */
  onJoin: (id: string) => void;
  /** Host: a client left. Client: the host is gone. */
  onLeave: (id: string) => void;
  close(): void;
}

const PREFIX = 'cellar-stalker-v2-';
const HOST = 'host';

/** WebRTC through the public PeerJS broker: works from a static site, no server of our own. */
class PeerTransport implements Transport {
  onData: Transport['onData'] = () => {};
  onJoin: Transport['onJoin'] = () => {};
  onLeave: Transport['onLeave'] = () => {};
  private peer: PeerType | null = null;
  private readonly conns = new Map<string, DataConnection>();
  private closed = false;

  constructor(private readonly code: string, private readonly hosting: boolean) {}

  async open(): Promise<void> {
    const { Peer } = await import('peerjs');
    return new Promise<void>((resolve, reject) => {
      const peer = this.hosting ? new Peer(PREFIX + this.code) : new Peer();
      this.peer = peer;
      let settled = false;
      const fail = (why: string): void => {
        if (settled) return;
        settled = true;
        this.close();
        reject(new Error(why));
      };
      const timer = window.setTimeout(() => fail('Could not reach the matchmaking server. Check your connection.'), 15000);
      const ok = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve();
      };
      peer.on('error', (err) => {
        const type = (err as { type?: string }).type;
        if (type === 'unavailable-id') fail('That room code is already in use. Try again.');
        else if (type === 'peer-unavailable') fail('No game found with that code.');
        else if (!settled) fail('Connection failed. Check your network and try again.');
      });
      peer.on('disconnected', () => {
        // the broker dropped us; existing player links keep working, but try to stay discoverable
        if (!this.closed) peer.reconnect();
      });
      if (this.hosting) {
        peer.on('open', ok);
        peer.on('connection', (conn) => {
          conn.on('open', () => {
            this.conns.set(conn.peer, conn);
            this.onJoin(conn.peer);
          });
          this.wire(conn, conn.peer);
        });
      } else {
        peer.on('open', () => {
          const conn = peer.connect(PREFIX + this.code, { reliable: true });
          conn.on('open', () => {
            this.conns.set(HOST, conn);
            ok();
          });
          this.wire(conn, HOST);
        });
      }
    });
  }

  private wire(conn: DataConnection, id: string): void {
    conn.on('data', (data) => this.onData(id, data));
    const gone = (): void => {
      if (!this.conns.delete(id) || this.closed) return;
      this.onLeave(id);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  send(to: string, data: unknown): void {
    const conn = this.conns.get(this.hosting ? to : HOST);
    if (conn?.open) conn.send(data);
  }

  close(): void {
    this.closed = true;
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}

/**
 * Same-browser transport over a BroadcastChannel, used with `?net=local` to try co-op in
 * several tabs of one machine without touching the network.
 */
class LocalTransport implements Transport {
  onData: Transport['onData'] = () => {};
  onJoin: Transport['onJoin'] = () => {};
  onLeave: Transport['onLeave'] = () => {};
  private readonly ch: BroadcastChannel;
  private readonly me: string;
  private readonly bye = (): void => this.post(this.hosting ? '*' : HOST, 'close', null);

  constructor(code: string, private readonly hosting: boolean) {
    this.ch = new BroadcastChannel(PREFIX + code);
    this.me = hosting ? HOST : `p${Math.random().toString(36).slice(2, 8)}`;
  }

  private post(to: string, kind: string, data: unknown): void {
    this.ch.postMessage({ to, from: this.me, kind, data });
  }

  open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let joined = this.hosting;
      this.ch.onmessage = (e: MessageEvent) => {
        const m = e.data as { to: string; from: string; kind: string; data: unknown };
        if (m.to !== this.me && m.to !== '*') return;
        if (m.kind === 'open' && this.hosting) {
          this.post(m.from, 'ack', null);
          this.onJoin(m.from);
        } else if (m.kind === 'ack' && !joined) {
          joined = true;
          resolve();
        } else if (m.kind === 'data') {
          this.onData(this.hosting ? m.from : HOST, m.data);
        } else if (m.kind === 'close') {
          this.onLeave(this.hosting ? m.from : HOST);
        }
      };
      window.addEventListener('pagehide', this.bye);
      if (this.hosting) return resolve();
      this.post(HOST, 'open', null);
      window.setTimeout(() => {
        if (!joined) reject(new Error('No game found with that code.'));
      }, 1500);
    });
  }

  send(to: string, data: unknown): void {
    this.post(this.hosting ? to : HOST, 'data', data);
  }

  close(): void {
    this.bye();
    window.removeEventListener('pagehide', this.bye);
    this.ch.close();
  }
}

const useLocal = (): boolean => new URLSearchParams(location.search).get('net') === 'local';

export function makeCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they read as 1 and 0
  let s = '';
  for (let i = 0; i < 5; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

/** One co-op session: the lobby roster plus a typed message pipe. The host is the authority. */
export class Net {
  /** Everyone in the room, host first. Kept in step by the host. */
  players: PlayerInfo[] = [];
  /** Night and difficulty the host has picked. */
  night = 1;
  diff: Difficulty = 'easy';
  /** A game is running: the room no longer takes new players. */
  started = false;
  /** Our own player id. */
  id = HOST;

  onMessage: (from: string, msg: Msg) => void = () => {};
  /** The lobby list or settings changed. */
  onRoster: () => void = () => {};
  /** Host: somebody left. */
  onPlayerLeft: (id: string) => void = () => {};
  /** Client: the host went away or refused us. */
  onClosed: (why: string) => void = () => {};

  private constructor(
    private readonly link: Transport,
    readonly code: string,
    readonly hosting: boolean,
    private readonly name: string,
  ) {
    link.onData = (from, data) => this.receive(from, data as Msg);
    link.onJoin = () => {}; // a client introduces itself with 'hello'
    link.onLeave = (id) => {
      if (this.hosting) {
        const was = this.players.length;
        this.players = this.players.filter((p) => p.id !== id);
        if (this.players.length !== was) {
          this.onPlayerLeft(id);
          this.sendRoster();
        }
      } else {
        this.onClosed('The host left the game.');
      }
    };
  }

  static async host(name: string): Promise<Net> {
    const code = makeCode();
    const link: Transport = useLocal() ? new LocalTransport(code, true) : new PeerTransport(code, true);
    const net = new Net(link, code, true, name);
    await link.open();
    net.players = [{ id: HOST, name: name || 'Host', slot: 0 }];
    return net;
  }

  static async join(code: string, name: string): Promise<Net> {
    const link: Transport = useLocal() ? new LocalTransport(code, false) : new PeerTransport(code, false);
    const net = new Net(link, code, false, name);
    await link.open();
    net.id = '';
    link.send(HOST, { t: 'hello', name } satisfies Msg);
    return net;
  }

  private receive(from: string, msg: Msg): void {
    if (!msg || typeof msg !== 'object') return;
    if (this.hosting && msg.t === 'hello') {
      if (this.players.some((p) => p.id === from)) return;
      if (this.started) return this.link.send(from, { t: 'refuse', why: 'That game has already started.' } satisfies Msg);
      if (this.players.length >= MAX_PLAYERS) return this.link.send(from, { t: 'refuse', why: 'That game is full.' } satisfies Msg);
      const used = new Set(this.players.map((p) => p.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      const clean = String(msg.name ?? '').replace(/[^\w \-]/g, '').trim().slice(0, 14) || `Player ${slot + 1}`;
      this.players.push({ id: from, name: clean, slot });
      this.sendRoster();
      return;
    }
    if (!this.hosting && msg.t === 'roster') {
      this.players = msg.players;
      this.night = msg.night;
      this.diff = msg.diff;
      this.id = msg.you;
      this.onRoster();
      return;
    }
    if (!this.hosting && msg.t === 'refuse') {
      this.onClosed(msg.why);
      return;
    }
    // ignore anyone the host has not admitted
    if (this.hosting && !this.players.some((p) => p.id === from)) return;
    this.onMessage(from, msg);
  }

  /** Host: tells everyone who is in the room and what is selected. */
  sendRoster(): void {
    if (!this.hosting) return;
    for (const p of this.players) {
      if (p.id === HOST) continue;
      this.link.send(p.id, { t: 'roster', players: this.players, night: this.night, diff: this.diff, you: p.id } satisfies Msg);
    }
    this.onRoster();
  }

  /** Client: to the host. Host: to every client. */
  send(msg: Msg): void {
    if (!this.hosting) return this.link.send(HOST, msg);
    for (const p of this.players) if (p.id !== HOST) this.link.send(p.id, msg);
  }

  /** Host: to one client. */
  sendTo(id: string, msg: Msg): void {
    if (id !== HOST) this.link.send(id, msg);
  }

  me(): PlayerInfo {
    return this.players.find((p) => p.id === this.id) ?? { id: this.id, name: this.name, slot: 0 };
  }

  close(): void {
    this.link.close();
  }
}
