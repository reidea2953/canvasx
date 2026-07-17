/**
 * Does the Durable Object relay actually relay?
 *
 * The DO is a port of the Node relay, not a copy — hibernatable sockets, a
 * different lifecycle, per-room addressing that the Node version never had.
 * None of that is exercised by the unit suite, so this drives the real Workers
 * runtime with real sockets.
 *
 * It lives outside `npm run verify` because it needs a built dist/ and takes a
 * few seconds to boot a server; that suite is pure and instant, and worth
 * keeping that way. Run it with `npm run verify:relay`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const PORT = 8788;
const BASE = `ws://127.0.0.1:${PORT}/ws`;
const HTTP = `http://127.0.0.1:${PORT}`;
let failures = 0;

// Spawn wrangler's entry with this same node, rather than the `wrangler` shim:
// the shim is a .cmd on Windows, which node refuses to spawn without a shell,
// and putting a shell in the middle means quoting rules get a vote.
const wranglerBin = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url));
if (!existsSync(wranglerBin)) {
  console.error(`No wrangler at ${wranglerBin} — run npm install.`);
  process.exit(1);
}

const server = spawn(
  process.execPath,
  [wranglerBin, 'dev', '--port', String(PORT), '--local'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
process.on('exit', () => server.kill());

// Wait for the runtime to actually answer, rather than sleeping a guessed
// number of seconds and hoping.
await (async () => {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(HTTP, { signal: AbortSignal.timeout(500) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.error('wrangler dev never came up');
  process.exit(1);
})();

const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures++;
};

function open(room) {
  const ws = new WebSocket(`${BASE}?room=${room}`);
  ws.inbox = [];
  ws.on('message', (raw) => ws.inbox.push(JSON.parse(String(raw))));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const join = (ws, peerId) => ws.send(JSON.stringify({ type: 'join', roomId: 'x', peerId }));
const settle = () => new Promise((r) => setTimeout(r, 250));
const typesOf = (ws) => ws.inbox.map((m) => m.type);

// 1 — a newcomer is told how many peers were already here. This is what decides
//     whether it asks for the scene or declares itself the origin; get it wrong
//     and either the board is blank or it overwrites everyone.
const a = await open('alpha');
join(a, 'peer-a');
await settle();
check('first peer sees an empty room', a.inbox[0]?.type === 'joined' && a.inbox[0]?.peers === 0,
  JSON.stringify(a.inbox[0]));

const b = await open('alpha');
join(b, 'peer-b');
await settle();
check('second peer is told someone is here', b.inbox[0]?.type === 'joined' && b.inbox[0]?.peers === 1,
  JSON.stringify(b.inbox[0]));
check('first peer is notified of the join', typesOf(a).includes('peer-joined'));

// 2 — payloads relay verbatim to others, and never echo to the sender.
a.inbox.length = 0;
b.inbox.length = 0;
a.send(JSON.stringify({ type: 'scene', peerId: 'peer-a', data: 'ciphertext-blob' }));
await settle();
check('scene reaches the other peer', b.inbox[0]?.type === 'scene');
check('ciphertext is passed through untouched', b.inbox[0]?.data === 'ciphertext-blob',
  String(b.inbox[0]?.data));
check('sender does not receive its own scene', a.inbox.length === 0, typesOf(a).join(','));

// 3 — rooms are separate Durable Objects. If this leaks, every board on the
//     deployment is one board.
const c = await open('beta');
join(c, 'peer-c');
await settle();
c.inbox.length = 0;
a.send(JSON.stringify({ type: 'scene', peerId: 'peer-a', data: 'alpha-only' }));
await settle();
check('a different room hears nothing', c.inbox.length === 0, typesOf(c).join(','));
check('a peer in another room does not count as present',
  c.inbox.length === 0 && b.inbox.length >= 1);

// 4 — departure is announced with the right identity, so the cursor is removed
//     rather than left frozen on the canvas.
b.inbox.length = 0;
a.close();
await settle();
const left = b.inbox.find((m) => m.type === 'peer-left');
check('peer-left is broadcast on close', Boolean(left), typesOf(b).join(','));
check('peer-left carries the peer id from the join attachment', left?.peerId === 'peer-a',
  String(left?.peerId));

// 5 — unknown types are ignored, not fatal. A newer client must not be able to
//     kill the room for an older one.
b.inbox.length = 0;
c.send(JSON.stringify({ type: 'some-future-message' }));
c.send('not json at all');
await settle();
check('junk does not close the socket', c.readyState === WebSocket.OPEN);

// 6 — the same Worker serves the app itself.
const page = await fetch(HTTP);
const html = await page.text();
check('the app is served from the same origin', page.ok && html.includes('<div id="root"'),
  `status ${page.status}`);

const ws426 = await fetch(`${HTTP}/ws?room=alpha`);
check('plain GET /ws is refused, not crashed', ws426.status === 426, `status ${ws426.status}`);

const noRoom = await fetch(`${HTTP}/ws`);
check('/ws with no room is a 400', noRoom.status === 400, `status ${noRoom.status}`);

b.close();
c.close();
// The exit handler kills the server — killing it here too tears the handle down
// twice and trips an assertion inside libuv on the way out.
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
