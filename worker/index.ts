import { RelayRoom } from './RelayRoom';

export { RelayRoom };

interface Env {
  ASSETS: Fetcher;
  RELAY_ROOM: DurableObjectNamespace;
}

/**
 * One Worker serves the whole app: the static build, and the collaboration relay.
 *
 * Same origin for both is not a convenience — it is what makes the deployment
 * work at all. The WebSocket needs no CORS, the room link is the same URL you
 * are already on, and HTTPS makes the page a secure context, which is what
 * Web Crypto requires for the end-to-end encryption. Split across two hosts,
 * each of those becomes a thing to configure and get wrong.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room');
      if (!room) return new Response('Missing room', { status: 400 });

      /**
       * One room, one object. idFromName is a pure hash of the room id, so
       * every peer using the same link independently addresses the same
       * instance — no lookup table, no coordination.
       */
      const id = env.RELAY_ROOM.idFromName(room);
      return env.RELAY_ROOM.get(id).fetch(request);
    }

    // Everything else is the built app.
    return env.ASSETS.fetch(request);
  },
};
