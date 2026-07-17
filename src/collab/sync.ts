import { nanoid } from 'nanoid';
import type { ExcaliElement } from '../element/types';
import { invalidateInteractive, invalidateStatic } from '../scene/render';
import { scene } from '../scene/Scene';
import { decryptJson, encryptJson, generateRoomKey, importRoomKey } from './crypto';
import { getUserName, peerId } from './identity';
import {
  clearRemotePeers,
  removeRemotePeer,
  setRemotePointer,
  type Activity,
  type PointerUpdate,
} from './presence';

const SCENE_THROTTLE_MS = 33;
const POINTER_THROTTLE_MS = 50;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export type CollabStatus = 'offline' | 'connecting' | 'connected' | 'error';

interface RoomLink {
  roomId: string;
  key: string;
}

/**
 * Reconciliation, per the build spec.
 *
 * Higher version wins; on a tie, the lower versionNonce wins. Both peers run
 * the identical comparison over the identical pair of values, so they converge
 * on the same answer with no server arbitration and no round trip.
 */
export function shouldAcceptRemote(local: ExcaliElement, remote: ExcaliElement): boolean {
  if (remote.version > local.version) return true;
  if (remote.version < local.version) return false;
  return remote.versionNonce < local.versionNonce;
}

// ------------------------------------------------------------------ state

let socket: WebSocket | null = null;
let roomKey: CryptoKey | null = null;
let currentRoom: RoomLink | null = null;
let status: CollabStatus = 'offline';
let reconnectAttempts = 0;
let reconnectTimer: number | undefined;
let deliberateClose = false;

/** Last version we transmitted per element, so we only send real changes. */
const sentVersions = new Map<string, number>();

let sceneTimer: number | undefined;
let pointerTimer: number | undefined;
let pendingPointer: { x: number; y: number; activity: Activity } | null = null;
/** Last position we know about, so an activity change has somewhere to report from. */
let lastPointer: { x: number; y: number } | null = null;

const listeners = new Set<(status: CollabStatus) => void>();

export const onCollabStatus = (listener: (status: CollabStatus) => void): (() => void) => {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
};

function setStatus(next: CollabStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener(next);
}

export const getCollabStatus = (): CollabStatus => status;
export const getRoomLink = (): string | null =>
  currentRoom ? `${window.location.origin}${window.location.pathname}#room=${currentRoom.roomId},${currentRoom.key}` : null;

// ------------------------------------------------------------------- URL

export function parseRoomFromHash(): RoomLink | null {
  const match = /#room=([^,]+),(.+)$/.exec(window.location.hash);
  if (!match) return null;
  return { roomId: match[1], key: match[2] };
}

// -------------------------------------------------------------- transport

/**
 * Where the relay lives.
 *
 * In production the Worker serves both the app and the relay, so it is the same
 * origin at /ws — no CORS, no second host, no port. In dev it is the standalone
 * Node relay on 3002, because Vite serves the app and knows nothing about
 * WebSockets.
 *
 * The room is in the query rather than only in the join message: the Worker
 * routes to one Durable Object per room, and has to know which before the
 * socket is even accepted.
 */
const serverUrl = (roomId: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const configured = import.meta.env.VITE_COLLAB_URL as string | undefined;

  const base =
    configured ??
    (import.meta.env.DEV
      ? `${protocol}//${window.location.hostname}:3002`
      : `${protocol}//${window.location.host}/ws`);

  return `${base}?room=${encodeURIComponent(roomId)}`;
};

async function send(message: Record<string, unknown>): Promise<void> {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

/** Everything but `join` travels as an opaque encrypted envelope. */
async function sendEncrypted(type: string, payload: unknown): Promise<void> {
  if (!roomKey) return;
  await send({ type, peerId, data: await encryptJson(roomKey, payload) });
}

// ---------------------------------------------------------------- scene io

function collectChanged(): ExcaliElement[] {
  const changed: ExcaliElement[] = [];
  for (const element of scene.getAll()) {
    if (sentVersions.get(element.id) !== element.version) {
      changed.push(element);
      sentVersions.set(element.id, element.version);
    }
  }
  return changed;
}

/** Throttled: a drag mutates elements every frame, but 30/s on the wire is plenty. */
export function broadcastSceneChanges(): void {
  if (status !== 'connected' || sceneTimer !== undefined) return;

  sceneTimer = window.setTimeout(() => {
    sceneTimer = undefined;
    const changed = collectChanged();
    if (changed.length > 0) void sendEncrypted('scene', { elements: changed });
  }, SCENE_THROTTLE_MS);
}

/** Send the whole scene — used to answer a newcomer's request. */
function broadcastFullScene(): void {
  const all = scene.getAll();
  for (const element of all) sentVersions.set(element.id, element.version);
  void sendEncrypted('scene', { elements: all });
}

/**
 * Trailing-edge throttle: the last position in each window is the only one that
 * matters, so intermediate samples are dropped rather than queued. Cursors are
 * smoothed on the receiving end, which is what lets this be as slow as 20Hz
 * without looking like it.
 */
export function broadcastPointer(x: number, y: number, activity: Activity): void {
  if (status !== 'connected') return;
  lastPointer = { x, y };
  pendingPointer = { x, y, activity };
  if (pointerTimer !== undefined) return;

  pointerTimer = window.setTimeout(() => {
    pointerTimer = undefined;
    if (!pendingPointer) return;
    void sendEncrypted('pointer', { ...pendingPointer, name: getUserName() });
    pendingPointer = null;
  }, POINTER_THROTTLE_MS);
}

/**
 * Push presence immediately, bypassing the pointer throttle.
 *
 * Activity changes are rare and meaningful — "started typing" is worth a packet
 * of its own, and waiting for the next mouse move to report it means the badge
 * never appears for someone who is typing without moving the mouse.
 */
export function broadcastActivity(activity: Activity): void {
  if (status !== 'connected') return;
  const at = pendingPointer ?? lastPointer;
  if (!at) return;
  void sendEncrypted('pointer', { x: at.x, y: at.y, activity, name: getUserName() });
}

function mergeRemote(elements: ExcaliElement[]): void {
  const byId = new Map(scene.getAll().map((element) => [element.id, element]));
  let changed = false;

  for (const remote of elements) {
    const local = byId.get(remote.id);

    if (!local) {
      scene.add(remote);
      byId.set(remote.id, remote);
      // Record the version so we do not immediately echo it back.
      sentVersions.set(remote.id, remote.version);
      changed = true;
      continue;
    }

    if (!shouldAcceptRemote(local, remote)) continue;

    // Replace in place: other modules hold references to these objects.
    Object.assign(local, remote);
    sentVersions.set(remote.id, remote.version);
    changed = true;
  }

  if (changed) {
    scene.emit();
    invalidateStatic();
    invalidateInteractive();
  }
}

// ------------------------------------------------------------ connection

function scheduleReconnect(): void {
  if (deliberateClose || !currentRoom) return;
  // Exponential backoff, capped — a relay outage must not become a hot loop.
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts++;
  reconnectTimer = window.setTimeout(() => {
    if (currentRoom) void connect(currentRoom);
  }, delay);
}

async function connect(room: RoomLink): Promise<void> {
  setStatus('connecting');
  currentRoom = room;

  try {
    roomKey = await importRoomKey(room.key);
  } catch {
    setStatus('error');
    return;
  }

  const ws = new WebSocket(serverUrl(room.roomId));
  socket = ws;

  ws.addEventListener('open', () => {
    reconnectAttempts = 0;
    setStatus('connected');
    void send({ type: 'join', roomId: room.roomId, peerId });
  });

  ws.addEventListener('message', async (event) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (message.type) {
      case 'joined': {
        // Peers already present own the canonical scene; ask for it rather than
        // pushing ours over theirs.
        if ((message.peers as number) > 0) void sendEncrypted('request-scene', {});
        else broadcastFullScene();
        return;
      }

      case 'request-scene':
        broadcastFullScene();
        return;

      case 'scene': {
        if (!roomKey || typeof message.data !== 'string') return;
        const payload = await decryptJson<{ elements: ExcaliElement[] }>(roomKey, message.data);
        if (payload?.elements) mergeRemote(payload.elements);
        return;
      }

      case 'pointer': {
        if (!roomKey || typeof message.data !== 'string') return;
        const payload = await decryptJson<PointerUpdate>(roomKey, message.data);
        if (payload && typeof message.peerId === 'string' && message.peerId !== peerId) {
          setRemotePointer(message.peerId, {
            x: payload.x,
            y: payload.y,
            name: payload.name || 'Anonymous',
            activity: payload.activity ?? 'idle',
          });
        }
        return;
      }

      case 'peer-left':
        if (typeof message.peerId === 'string') removeRemotePeer(message.peerId);
        return;

      default:
        return;
    }
  });

  ws.addEventListener('close', () => {
    if (socket === ws) socket = null;
    clearRemotePeers();
    if (!deliberateClose) {
      setStatus('connecting');
      scheduleReconnect();
    } else {
      setStatus('offline');
    }
  });

  ws.addEventListener('error', () => {
    if (status !== 'connecting') setStatus('error');
  });
}

// -------------------------------------------------------------- lifecycle

export async function startSession(): Promise<string | null> {
  const existing = parseRoomFromHash();
  const room = existing ?? { roomId: nanoid(10), key: await generateRoomKey() };

  deliberateClose = false;
  sentVersions.clear();
  // The key rides in the fragment, which browsers never send to the server.
  window.location.hash = `room=${room.roomId},${room.key}`;

  await connect(room);
  return getRoomLink();
}

export function stopSession(): void {
  deliberateClose = true;
  window.clearTimeout(reconnectTimer);
  window.clearTimeout(sceneTimer);
  window.clearTimeout(pointerTimer);
  sceneTimer = undefined;
  pointerTimer = undefined;

  socket?.close();
  socket = null;
  roomKey = null;
  currentRoom = null;
  reconnectAttempts = 0;
  sentVersions.clear();
  clearRemotePeers();
  history.replaceState(null, '', window.location.pathname);
  setStatus('offline');
  invalidateInteractive();
}

/** Rejoin automatically when the page is opened on a room link. */
export async function resumeSessionFromUrl(): Promise<void> {
  const room = parseRoomFromHash();
  if (room) await startSession();
}

export const isCollaborating = (): boolean => status === 'connected';

/**
 * Wire the scene to the transport once, at boot. Every committed change flows
 * through scene.emit(), and the throttle inside broadcastSceneChanges keeps a
 * per-frame drag down to ~30 messages a second.
 */
export function attachCollabBroadcast(): () => void {
  return scene.onChange(broadcastSceneChanges);
}
