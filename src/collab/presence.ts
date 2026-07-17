import { invalidateInteractive } from '../scene/render';

/**
 * Remote presence: cursors, names and what each peer is doing.
 *
 * Ephemeral, exactly like the laser trail — it lives only on the interactive
 * layer, never enters the scene, never enters history and never exports.
 *
 * Cursors are interpolated toward their last reported position rather than
 * snapped to it. Pointers arrive at ~20Hz to keep traffic down, and a cursor
 * that teleports 20 times a second reads as broken; easing toward the target
 * each frame turns the same packets into smooth motion for free.
 */
export type Activity = 'idle' | 'drawing' | 'typing' | 'moving';

export interface RemotePeer {
  id: string;
  name: string;
  color: string;
  activity: Activity;
  /** Where the peer says it is. */
  targetX: number;
  targetY: number;
  /** Where we are drawing it, easing toward the target. */
  x: number;
  y: number;
  lastSeen: number;
}

/** Drop a peer that has gone quiet rather than leaving a ghost cursor. */
const STALE_MS = 15_000;
/** Fraction of the remaining distance closed per frame. */
const EASE = 0.28;
/** Below this we are done moving and the loop can sleep. */
const SETTLE_EPSILON = 0.35;

const peers = new Map<string, RemotePeer>();

/**
 * Distinct hues, deliberately chosen rather than generated: an even hue rotation
 * throws out yellows and greens that vanish on a white canvas.
 */
const COLORS = [
  '#e03131', '#1971c2', '#2f9e44', '#f08c00',
  '#9c36b5', '#0c8599', '#e8590c', '#c2255c',
];

/** Stable per-peer, so a collaborator keeps one colour for the whole session. */
export function colorForPeer(peerId: string): string {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) hash = (hash * 31 + peerId.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** Two letters is what fits an avatar; fall back to the id if a name is odd. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export interface PointerUpdate {
  x: number;
  y: number;
  name: string;
  activity: Activity;
}

export function setRemotePointer(peerId: string, update: PointerUpdate): void {
  const existing = peers.get(peerId);
  const now = performance.now();

  if (existing) {
    existing.targetX = update.x;
    existing.targetY = update.y;
    existing.name = update.name;
    existing.activity = update.activity;
    existing.lastSeen = now;
  } else {
    peers.set(peerId, {
      id: peerId,
      name: update.name,
      color: colorForPeer(peerId),
      activity: update.activity,
      targetX: update.x,
      targetY: update.y,
      // A new cursor starts where it is, not eased in from wherever the last
      // one happened to be.
      x: update.x,
      y: update.y,
      lastSeen: now,
    });
  }
  invalidateInteractive();
}

export function removeRemotePeer(peerId: string): void {
  if (!peers.delete(peerId)) return;
  invalidateInteractive();
  notify();
}

export function clearRemotePeers(): void {
  if (peers.size === 0) return;
  peers.clear();
  invalidateInteractive();
  notify();
}

// ------------------------------------------------------------- subscribers

/** The presence bar is React; the cursors are canvas. Both read this map. */
const listeners = new Set<() => void>();
let revision = 0;

export const subscribePresence = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getPresenceRevision = (): number => revision;

function notify(): void {
  revision++;
  for (const listener of listeners) listener();
}

export const getPeers = (): RemotePeer[] => [...peers.values()];

// ---------------------------------------------------------------- drawing

/** True while any cursor is still easing toward its target. */
export function remoteCursorsAnimating(): boolean {
  for (const peer of peers.values()) {
    if (
      Math.abs(peer.targetX - peer.x) > SETTLE_EPSILON ||
      Math.abs(peer.targetY - peer.y) > SETTLE_EPSILON
    ) {
      return true;
    }
  }
  return false;
}

const ACTIVITY_LABEL: Record<Activity, string> = {
  idle: '',
  drawing: 'drawing',
  typing: 'typing',
  moving: 'moving',
};

export function drawRemoteCursors(
  ctx: CanvasRenderingContext2D,
  now: number,
  zoom: number,
): void {
  let dropped = false;

  for (const [id, peer] of peers) {
    if (now - peer.lastSeen > STALE_MS) {
      peers.delete(id);
      dropped = true;
      continue;
    }

    // Ease toward the last reported position. Frame-rate dependent, but the
    // constant is tuned for 60Hz and the error at 120Hz is imperceptible.
    peer.x += (peer.targetX - peer.x) * EASE;
    peer.y += (peer.targetY - peer.y) * EASE;

    // Everything divided by zoom, so a cursor stays the same size on screen.
    const size = 14 / zoom;

    ctx.save();
    ctx.translate(peer.x, peer.y);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(size * 0.29, size * 0.79);
    ctx.lineTo(size * 0.5, size * 1.21);
    ctx.lineTo(size * 0.71, size * 1.14);
    ctx.lineTo(size * 0.5, size * 0.71);
    ctx.lineTo(size * 0.86, size * 0.71);
    ctx.closePath();

    ctx.fillStyle = peer.color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2 / zoom;
    ctx.stroke();

    const activity = ACTIVITY_LABEL[peer.activity];
    const label = activity ? `${peer.name} · ${activity}` : peer.name;

    const fontSize = 11 / zoom;
    ctx.font = `500 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const padX = 5 / zoom;
    const padY = 3 / zoom;
    const width = ctx.measureText(label).width + padX * 2;
    const height = fontSize + padY * 2;
    const badgeX = size * 0.62;
    const badgeY = size * 1.05;

    ctx.fillStyle = peer.color;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, width, height, 4 / zoom);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, badgeX + padX, badgeY + height / 2);

    ctx.restore();
  }

  if (dropped) notify();
}
