import { resizeBox, type TransformBox } from '../../src/element/resize';
import { rotatePoint, type Point } from '../../src/utils/geometry';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const center = (b: TransformBox): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Corners of a box in its own local (unrotated) frame. */
const corners = (b: TransformBox) => ({
  nw: { x: b.x, y: b.y },
  ne: { x: b.x + b.width, y: b.y },
  se: { x: b.x + b.width, y: b.y + b.height },
  sw: { x: b.x, y: b.y + b.height },
});

/** Which corners must not move when a given handle is dragged. */
const ANCHORED: Record<Handle, (keyof ReturnType<typeof corners>)[]> = {
  se: ['nw'], nw: ['se'], ne: ['sw'], sw: ['ne'],
  n: ['sw', 'se'], s: ['nw', 'ne'], e: ['nw', 'sw'], w: ['ne', 'se'],
};

/** Scene position of a named corner, i.e. with the box's rotation applied. */
const cornerScene = (b: TransformBox, name: keyof ReturnType<typeof corners>): Point =>
  rotatePoint(corners(b)[name], center(b), b.angle);

/** Directions a handle is allowed to travel in local space, to avoid flipping. */
const DIR: Record<Handle, { x: number; y: number }> = {
  se: { x: 1, y: 1 }, nw: { x: -1, y: -1 }, ne: { x: 1, y: -1 }, sw: { x: -1, y: 1 },
  n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 },
};

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

let random = 12345;
const rnd = () => {
  random = (random * 1664525 + 1013904223) >>> 0;
  return random / 0x100000000;
};

const EPSILON = 1e-9;
let checks = 0;
let worst = 0;
const failures: string[] = [];

for (let trial = 0; trial < 4000; trial++) {
  const start: TransformBox = {
    x: (rnd() - 0.5) * 1000,
    y: (rnd() - 0.5) * 1000,
    width: 10 + rnd() * 400,
    height: 10 + rnd() * 400,
    // Deliberately includes rotation — the whole point of the criterion.
    angle: (rnd() - 0.5) * Math.PI * 4,
  };

  for (const handle of HANDLES) {
    // Build the pointer in the ORIGINAL local frame, moving the handle in a
    // direction that grows the box, so no flip occurs and the named anchor
    // corner keeps its identity.
    const local = corners(start);
    const handleLocal: Point = {
      x: handle.includes('w') ? local.nw.x : handle.includes('e') ? local.se.x : (local.nw.x + local.se.x) / 2,
      y: handle.includes('n') ? local.nw.y : handle.includes('s') ? local.se.y : (local.nw.y + local.se.y) / 2,
    };
    const travel = 5 + rnd() * 200;
    const pointerLocal: Point = {
      x: handleLocal.x + DIR[handle].x * travel,
      y: handleLocal.y + DIR[handle].y * travel,
    };
    const pointerScene = rotatePoint(pointerLocal, center(start), start.angle);

    const next = resizeBox(start, handle, pointerScene, {
      preserveAspect: false,
      fromCenter: false,
    });

    for (const anchor of ANCHORED[handle]) {
      const before = cornerScene(start, anchor);
      const after = cornerScene(next, anchor);
      const drift = Math.hypot(after.x - before.x, after.y - before.y);
      worst = Math.max(worst, drift);
      checks++;
      if (drift > EPSILON) {
        failures.push(
          `handle=${handle} anchor=${anchor} angle=${start.angle.toFixed(3)} drift=${drift.toExponential(3)}`,
        );
      }
    }
  }
}

// fromCenter must instead pin the centre itself.
let centreWorst = 0;
for (let trial = 0; trial < 1000; trial++) {
  const start: TransformBox = {
    x: (rnd() - 0.5) * 1000,
    y: (rnd() - 0.5) * 1000,
    width: 10 + rnd() * 400,
    height: 10 + rnd() * 400,
    angle: (rnd() - 0.5) * Math.PI * 4,
  };
  const handle = HANDLES[Math.floor(rnd() * HANDLES.length)];
  const pointerScene: Point = { x: (rnd() - 0.5) * 2000, y: (rnd() - 0.5) * 2000 };
  const next = resizeBox(start, handle, pointerScene, { preserveAspect: false, fromCenter: true });
  const before = center(start);
  const after = center(next);
  centreWorst = Math.max(centreWorst, Math.hypot(after.x - before.x, after.y - before.y));
}

console.log(`anchor-pinning: ${checks} checks across rotated boxes`);
console.log(`  worst drift:        ${worst.toExponential(3)} scene units`);
console.log(`  failures (>1e-9):   ${failures.length}`);
for (const failure of failures.slice(0, 5)) console.log(`    ${failure}`);
console.log(`fromCenter centre-pinning worst drift: ${centreWorst.toExponential(3)}`);
console.log(failures.length === 0 && centreWorst < 1e-9 ? '\nPASS' : '\nFAIL');
process.exit(failures.length === 0 && centreWorst < 1e-9 ? 0 : 1);
