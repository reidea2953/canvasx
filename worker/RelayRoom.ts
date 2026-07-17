/**
 * The collaboration relay, as a Durable Object.
 *
 * A relay has to hold many connections open and broadcast between them — the one
 * thing a stateless Worker cannot do. A Durable Object is a single addressable
 * instance with its own memory, so one room maps to one object and "everyone
 * else in the room" is just its socket list. That is why the Node relay could
 * not simply be lifted onto Workers, and why this is a port rather than a copy.
 *
 * Like the Node version it is a relay and nothing more. Payloads arrive already
 * encrypted with a key that only ever lives in the URL fragment — fragments are
 * never sent to a server — so this object cannot read scene contents even if it
 * wanted to. It knows connection counts and byte counts, and that is all.
 */

interface PeerAttachment {
  peerId?: string;
}

/** Anything larger is not a scene diff; it is a mistake or an attack. */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

export class RelayRoom implements DurableObject {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('This endpoint speaks WebSocket only.', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());

    /**
     * Hibernation, rather than plain accept(): the object can be evicted from
     * memory while its sockets stay open, and is woken only when a message
     * actually arrives. A whiteboard room is idle almost all of the time, so
     * without this we would pay to keep an empty room resident.
     */
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Everyone in this room except the sender. */
  private others(self: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => socket !== self);
  }

  private broadcast(message: unknown, except: WebSocket): void {
    const payload = JSON.stringify(message);
    for (const socket of this.others(except)) {
      try {
        socket.send(payload);
      } catch {
        // A socket that died between the list and the send is not an error
        // worth failing the whole broadcast over.
      }
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    if (raw.length > MAX_MESSAGE_BYTES) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // Not ours; ignore rather than disconnect.
    }

    switch (message.type) {
      case 'join': {
        // The attachment survives hibernation, so a woken object still knows
        // who each socket is without re-asking.
        const peerId = typeof message.peerId === 'string' ? message.peerId : undefined;
        ws.serializeAttachment({ peerId } satisfies PeerAttachment);

        // Tell the newcomer how many were already here, so it knows whether to
        // ask for the current scene or to consider itself the origin.
        ws.send(JSON.stringify({ type: 'joined', peers: this.others(ws).length }));
        this.broadcast({ type: 'peer-joined' }, ws);
        return;
      }

      // Everything below is an opaque encrypted envelope. Relay verbatim.
      case 'scene':
      case 'pointer':
      case 'request-scene':
        this.broadcast(message, ws);
        return;

      default:
        return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const { peerId } = (ws.deserializeAttachment() ?? {}) as PeerAttachment;
    // The closing socket is still in getWebSockets() here, so exclude it.
    this.broadcast({ type: 'peer-left', peerId }, ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}
