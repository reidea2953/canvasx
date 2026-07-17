import { WebSocketServer } from 'ws';

/**
 * A relay, nothing more.
 *
 * Payloads arrive already encrypted by the client with a key that only ever
 * lives in the URL fragment — fragments are never sent to a server — so this
 * process cannot read scene contents even if it wanted to. It knows room ids
 * and byte counts, and that is all.
 */
const PORT = Number(process.env.PORT ?? 3002);
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/** roomId -> Set<WebSocket> */
const rooms = new Map();

const server = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_BYTES });

function join(socket, roomId) {
  let peers = rooms.get(roomId);
  if (!peers) {
    peers = new Set();
    rooms.set(roomId, peers);
  }
  peers.add(socket);
  socket.roomId = roomId;

  // Tell the newcomer how many peers were already here, so it knows whether to
  // ask for the current scene or to consider itself the origin.
  send(socket, { type: 'joined', peers: peers.size - 1 });
  broadcast(roomId, { type: 'peer-joined' }, socket);
}

function leave(socket) {
  const peers = rooms.get(socket.roomId);
  if (!peers) return;
  peers.delete(socket);
  if (peers.size === 0) rooms.delete(socket.roomId);
  else broadcast(socket.roomId, { type: 'peer-left', peerId: socket.peerId }, socket);
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(roomId, message, except) {
  const peers = rooms.get(roomId);
  if (!peers) return;
  const payload = JSON.stringify(message);
  for (const peer of peers) {
    if (peer !== except && peer.readyState === peer.OPEN) peer.send(payload);
  }
}

server.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // Not ours; ignore rather than disconnect.
    }

    switch (message.type) {
      case 'join':
        if (typeof message.roomId !== 'string' || message.roomId.length > 128) return;
        socket.peerId = typeof message.peerId === 'string' ? message.peerId : undefined;
        join(socket, message.roomId);
        return;

      // Everything below is an opaque encrypted envelope. Relay verbatim.
      case 'scene':
      case 'pointer':
      case 'request-scene':
        if (!socket.roomId) return;
        broadcast(socket.roomId, message, socket);
        return;

      default:
        return;
    }
  });

  socket.on('close', () => leave(socket));
  socket.on('error', () => leave(socket));
});

/** Drop half-open connections rather than broadcasting into the void forever. */
const heartbeat = setInterval(() => {
  for (const peers of rooms.values()) {
    for (const socket of peers) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }
}, 30_000);

server.on('close', () => clearInterval(heartbeat));

console.log(`Relay listening on ws://localhost:${PORT}`);
console.log('Payloads are end-to-end encrypted; this process cannot read them.');
