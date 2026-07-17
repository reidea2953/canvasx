import { shouldAcceptRemote } from '../../src/collab/sync';
import type { ExcaliElement } from '../../src/element/types';

let seed = 24680;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

/** Only the fields the merge rule looks at need to be real. */
const make = (id: string, version: number, versionNonce: number, payload: string) =>
  ({ id, version, versionNonce, x: 0, y: 0, text: payload } as unknown as ExcaliElement);

const failures: string[] = [];
const note = (m: string) => failures.push(m);

// ---- 1. Antisymmetry: two peers must never both think they won -----------

let bothWin = 0;
let neitherWins = 0;

for (let i = 0; i < 200_000; i++) {
  // Deliberately tiny ranges, so version ties and nonce ties are common.
  const a = make('e', Math.floor(rnd() * 3), Math.floor(rnd() * 3), 'a');
  const b = make('e', Math.floor(rnd() * 3), Math.floor(rnd() * 3), 'b');

  const aTakesB = shouldAcceptRemote(a, b);
  const bTakesA = shouldAcceptRemote(b, a);

  const identical = a.version === b.version && a.versionNonce === b.versionNonce;
  if (identical) {
    // A true tie: neither may win, or the two peers would swap forever.
    if (aTakesB || bTakesA) bothWin++;
    continue;
  }
  if (aTakesB && bTakesA) bothWin++;
  if (!aTakesB && !bTakesA) neitherWins++;
}

if (bothWin > 0) note(`${bothWin} pairs where both sides accepted the other (would oscillate)`);
if (neitherWins > 0) note(`${neitherWins} distinct pairs where neither side won (would diverge)`);

// ---- 2. Convergence: order of arrival must not change the outcome --------

/** Apply updates in the given order using the real rule; return the survivor. */
function converge(start: ExcaliElement, updates: ExcaliElement[]): ExcaliElement {
  let current = start;
  for (const update of updates) {
    if (shouldAcceptRemote(current, update)) current = update;
  }
  return current;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

let orderDependent = 0;

for (let trial = 0; trial < 20_000; trial++) {
  const count = 2 + Math.floor(rnd() * 6);
  const updates: ExcaliElement[] = [];
  for (let i = 0; i < count; i++) {
    updates.push(make('e', Math.floor(rnd() * 4), Math.floor(rnd() * 4), `p${i}`));
  }
  const start = make('e', 0, 9, 'start');

  // Every peer sees the same updates but in its own order.
  const first = converge(start, shuffle(updates));
  for (let peer = 0; peer < 6; peer++) {
    const other = converge(start, shuffle(updates));
    if (other.version !== first.version || other.versionNonce !== first.versionNonce) {
      orderDependent++;
      break;
    }
  }
}

if (orderDependent > 0) {
  note(`${orderDependent}/20000 update sets converged differently depending on arrival order`);
}

// ---- 3. The documented rule, spelled out --------------------------------

const cases: [string, ExcaliElement, ExcaliElement, boolean][] = [
  ['higher version wins', make('e', 1, 5, 'l'), make('e', 2, 9, 'r'), true],
  ['lower version loses', make('e', 3, 5, 'l'), make('e', 2, 1, 'r'), false],
  ['tie -> lower nonce wins', make('e', 2, 9, 'l'), make('e', 2, 4, 'r'), true],
  ['tie -> higher nonce loses', make('e', 2, 4, 'l'), make('e', 2, 9, 'r'), false],
  ['exact tie -> no change', make('e', 2, 4, 'l'), make('e', 2, 4, 'r'), false],
];

for (const [label, local, remote, expected] of cases) {
  const actual = shouldAcceptRemote(local, remote);
  if (actual !== expected) note(`rule "${label}": expected ${expected}, got ${actual}`);
}

console.log('collab merge verification');
console.log(`  antisymmetry over 200,000 random pairs:`);
console.log(`    both sides won:        ${bothWin}`);
console.log(`    neither side won:      ${neitherWins}`);
console.log(`  convergence over 20,000 update sets x 6 peers in random orders:`);
console.log(`    order-dependent:       ${orderDependent}`);
console.log(`  documented rule cases:   ${cases.length - failures.filter((f) => f.startsWith('rule')).length}/${cases.length} correct`);
console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
