import { invalidateInteractive } from '../scene/render';

/**
 * Remote cursors are ephemeral presence, exactly like the laser: they live on
 * the interactive layer, never enter the scene, never enter history, and never
 * export.
 */
export interface RemotePeer {
  id: string;
  x: number;
  y: number;
  lastSeen: number;
}

/** Drop a cursor that has gone quiet rather than leaving a ghost on screen. */
const STALE_MS = 10_000;

const peers = new Map<string, RemotePeer>();

/** Stable per-peer colour, so a collaborator keeps the same one all session. */
const COLORS = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599'];

function colorFor(peerId: string): string {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) hash = (hash * 31 + peerId.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function setRemotePointer(peerId: string, x: number, y: number): void {
  peers.set(peerId, { id: peerId, x, y, lastSeen: performance.now() });
  invalidateInteractive();
}

export function removeRemotePeer(peerId: string): void {
  peers.delete(peerId);
  invalidateInteractive();
}

export function clearRemotePeers(): void {
  peers.clear();
  invalidateInteractive();
}

export const hasRemotePeers = (): boolean => peers.size > 0;

export function drawRemoteCursors(ctx: CanvasRenderingContext2D, zoom: number): void {
  const now = performance.now();

  for (const [id, peer] of peers) {
    if (now - peer.lastSeen > STALE_MS) {
      peers.delete(id);
      continue;
    }

    const color = colorFor(id);
    // Sizes divided by zoom so a cursor stays a constant size on screen.
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

    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();

    // A short id badge: enough to tell two collaborators apart.
    ctx.font = `${11 / zoom}px ui-sans-serif, system-ui, sans-serif`;
    const label = id.slice(0, 4);
    const padding = 4 / zoom;
    const width = ctx.measureText(label).width + padding * 2;
    const height = 16 / zoom;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(size * 0.6, size * 1.1, width, height, 4 / zoom);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, size * 0.6 + padding, size * 1.1 + height / 2);

    ctx.restore();
  }
}
