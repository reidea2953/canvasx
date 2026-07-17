import { bindArrow, getBindingPoint, recomputeArrowBindings } from '../../src/element/binding';
import { getAbsolutePoints } from '../../src/element/bounds';
import { mutateElement } from '../../src/element/mutate';
import { scene } from '../../src/scene/Scene';
import type { LinearElement, ShapeElement, ShapeType } from '../../src/element/types';

let seed = 987654;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const shape = (id: string, type: ShapeType, x: number, y: number, w: number, h: number): ShapeElement => ({
  id, type, x, y, width: w, height: h, angle: 0,
  strokeColor: '#000', backgroundColor: 'transparent', fillStyle: 'hachure',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
  seed: 1, version: 1, versionNonce: 1, updated: 0, isDeleted: false,
  groupIds: [], frameId: null, boundElements: null, locked: false, link: null,
});

const arrow = (id: string, x: number, y: number, points: [number, number][]): LinearElement => ({
  id, type: 'arrow', x, y, width: 0, height: 0, angle: 0,
  strokeColor: '#000', backgroundColor: 'transparent', fillStyle: 'hachure',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
  seed: 1, version: 1, versionNonce: 1, updated: 0, isDeleted: false,
  groupIds: [], frameId: null, boundElements: null, locked: false, link: null,
  points, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow',
});

/** Signed distance from a point to a rectangle's outline; negative means inside. */
function distanceToRectOutline(p: { x: number; y: number }, r: ShapeElement): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  const outside = Math.hypot(dx, dy);
  if (outside > 0) return outside;
  const inside = Math.min(
    p.x - r.x, r.x + r.width - p.x, p.y - r.y, r.y + r.height - p.y,
  );
  return -inside;
}

const GAP = 4;
const failures: string[] = [];
const note = (message: string) => failures.push(message);

// ---------------------------------------------------------------- setup

const a = shape('A', 'rectangle', 0, 0, 120, 80);
const b = shape('B', 'rectangle', 400, 300, 120, 80);
const link = arrow('R', 60, 40, [[0, 0], [400, 340]]);
scene.replaceAll([a, b, link]);

bindArrow(link, a, 'start');
bindArrow(link, b, 'end');

if (!link.startBinding || !link.endBinding) note('bindArrow did not record both bindings');
const focusStart = link.startBinding!.focus;
const focusEnd = link.endBinding!.focus;

// ------------------------------------------- 1. idempotence (no oscillation)

recomputeArrowBindings(link);
const first = getAbsolutePoints(link).map((p) => ({ ...p }));
for (let i = 0; i < 50; i++) recomputeArrowBindings(link);
const after = getAbsolutePoints(link);

let idempotenceDrift = 0;
for (let i = 0; i < first.length; i++) {
  idempotenceDrift = Math.max(idempotenceDrift, Math.hypot(after[i].x - first[i].x, after[i].y - first[i].y));
}
if (idempotenceDrift > 1e-9) {
  note(`50 recomputes drifted by ${idempotenceDrift.toExponential(3)} — not a fixed point`);
}

// ------------------------------------- 2. focus survives repeated updates

if (Math.abs(link.startBinding!.focus - focusStart) > 1e-12 ||
    Math.abs(link.endBinding!.focus - focusEnd) > 1e-12) {
  note('focus mutated during update — it must be fixed at bind time');
}

// -------------------- 3. move shapes at speed: stays attached, gap holds

let worstGapError = 0;
let worstDrift = 0;
let nanSeen = false;
let gapChecks = 0;
let overlapSkips = 0;
let flips = 0;
let beyondHit = 0;
let clampedCases = 0;

const centreOf = (r: ShapeElement) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

for (let step = 0; step < 3000; step++) {
  // Jump the shapes around hard, including overlapping positions.
  mutateElement(a, { x: (rnd() - 0.5) * 1200, y: (rnd() - 0.5) * 1200 });
  mutateElement(b, { x: (rnd() - 0.5) * 1200, y: (rnd() - 0.5) * 1200 });

  const points = getAbsolutePoints(link);
  const start = points[0];
  const end = points[points.length - 1];

  if ([start.x, start.y, end.x, end.y].some((v) => !Number.isFinite(v))) {
    nanSeen = true;
    break;
  }

  // Each end aims from the OTHER shape's centre. When that centre lands inside
  // the shape being aimed at, there is no outline crossing and the endpoint is
  // deliberately left alone — so the gap is only meaningful otherwise.
  const canBindStart = distanceToRectOutline(centreOf(b), a) > 0;
  const canBindEnd = distanceToRectOutline(centreOf(a), b) > 0;

  if (canBindStart && canBindEnd) {
    /**
     * Three invariants, none of which is "the perpendicular distance equals
     * gap" — the gap runs ALONG THE RAY, so an oblique hit legitimately sits
     * gap*cos(theta) from the outline.
     *   1. no flip: the tip never crosses to the far side of its reference
     *   2. the tip lies between the reference and the outline hit
     *   3. where there is room (hit further than gap), the gap is exact
     */
    const check = (
      tip: { x: number; y: number },
      far: { x: number; y: number },
      target: ShapeElement,
      focus: number,
    ) => {
      // gap=0 recovers the raw outline hit the code aimed at.
      const hit = getBindingPoint(target, far, focus, 0);
      if (!hit) return;

      const rayX = hit.x - far.x;
      const rayY = hit.y - far.y;
      const rayLength = Math.hypot(rayX, rayY);
      if (rayLength < 1e-9) return;

      const tipX = tip.x - far.x;
      const tipY = tip.y - far.y;

      if (tipX * rayX + tipY * rayY < -1e-9) {
        flips++;
        return;
      }
      const along = Math.hypot(tipX, tipY);
      if (along > rayLength + 1e-6) {
        beyondHit++;
        return;
      }
      if (rayLength > GAP + 1e-6) {
        worstGapError = Math.max(worstGapError, Math.abs(Math.hypot(tip.x - hit.x, tip.y - hit.y) - GAP));
        gapChecks++;
      } else {
        clampedCases++;
      }
    };
    check(start, centreOf(b), a, link.startBinding!.focus);
    check(end, centreOf(a), b, link.endBinding!.focus);
  } else {
    overlapSkips++;
  }

  // A further recompute must not move anything: the fixed-point property has
  // to hold at every position, not just the first one — overlapping included.
  const before = points.map((p) => ({ ...p }));
  recomputeArrowBindings(link);
  const settled = getAbsolutePoints(link);
  for (let i = 0; i < before.length; i++) {
    worstDrift = Math.max(worstDrift, Math.hypot(settled[i].x - before[i].x, settled[i].y - before[i].y));
  }
}

if (nanSeen) note('non-finite endpoint produced');
if (gapChecks === 0) note('no non-overlapping steps were sampled — test is not exercising the gap');
if (flips > 0) note(`${flips} tips landed on the far side of their reference point`);
if (beyondHit > 0) note(`${beyondHit} tips landed past the outline hit`);
if (worstGapError > 1e-6) note(`gap error up to ${worstGapError.toExponential(3)} (expected ${GAP})`);
if (worstDrift > 1e-9) note(`re-running update after a move drifted ${worstDrift.toExponential(3)}`);

// ------------------------------- 4. both-ends-bound is the oscillation risk

const shrink = shape('C', 'ellipse', 0, 0, 60, 60);
const grow = shape('D', 'diamond', 200, 0, 60, 60);
const link2 = arrow('R2', 30, 30, [[0, 0], [200, 0]]);
scene.replaceAll([shrink, grow, link2]);
bindArrow(link2, shrink, 'start');
bindArrow(link2, grow, 'end');

let alternating = 0;
let previous = getAbsolutePoints(link2).map((p) => ({ ...p }));
for (let i = 0; i < 200; i++) {
  recomputeArrowBindings(link2);
  const next = getAbsolutePoints(link2);
  const delta = Math.max(
    ...next.map((p, j) => Math.hypot(p.x - previous[j].x, p.y - previous[j].y)),
  );
  if (delta > 1e-9) alternating++;
  previous = next.map((p) => ({ ...p }));
}
if (alternating > 0) note(`ellipse↔diamond pair kept moving on ${alternating}/200 idle recomputes`);

// ---------------------------------------------------------------- report

console.log('binding verification');
console.log(`  idempotence drift over 50 recomputes: ${idempotenceDrift.toExponential(3)}`);
console.log(`  gap exact across ${gapChecks} checks:  ${worstGapError.toExponential(3)} (target ${GAP})`);
console.log(`  tips flipped behind reference:        ${flips}`);
console.log(`  tips past the outline hit:            ${beyondHit}`);
console.log(`  gap clamped (shapes too close):       ${clampedCases}`);
console.log(`  overlapping steps skipped:            ${overlapSkips}/3000`);
console.log(`  worst post-move settle drift:         ${worstDrift.toExponential(3)}`);
console.log(`  both-ends-bound idle movement:        ${alternating}/200`);
console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
