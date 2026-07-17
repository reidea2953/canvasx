import { isPointInSelectionBox } from '../../src/scene/selection';
import { rotatePoint, type Point } from '../../src/utils/geometry';
import type { TransformBox } from '../../src/element/resize';

let seed = 1357;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const centre = (b: TransformBox): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

const failures: string[] = [];
let insideMissed = 0;
let outsideClaimed = 0;
let checks = 0;

for (let trial = 0; trial < 50_000; trial++) {
  const box: TransformBox = {
    x: (rnd() - 0.5) * 800,
    y: (rnd() - 0.5) * 800,
    width: 20 + rnd() * 300,
    height: 20 + rnd() * 300,
    angle: (rnd() - 0.5) * Math.PI * 4,
  };
  const zoom = 0.2 + rnd() * 4;

  // A point known to be INSIDE, expressed in the box's local frame then rotated
  // into the scene — this is the "drag a transparent shape from its middle" case.
  const insideLocal: Point = {
    x: box.x + 2 + rnd() * (box.width - 4),
    y: box.y + 2 + rnd() * (box.height - 4),
  };
  if (!isPointInSelectionBox(box, rotatePoint(insideLocal, centre(box), box.angle), zoom)) {
    insideMissed++;
  }
  checks++;

  // A point known to be well OUTSIDE must not be claimed, or clicking empty
  // canvas would stop clearing the selection.
  const side = Math.floor(rnd() * 4);
  const far = 40 + rnd() * 200;
  const outsideLocal: Point = {
    x: side === 0 ? box.x - far : side === 1 ? box.x + box.width + far : box.x + rnd() * box.width,
    y: side === 2 ? box.y - far : side === 3 ? box.y + box.height + far : box.y + rnd() * box.height,
  };
  if (isPointInSelectionBox(box, rotatePoint(outsideLocal, centre(box), box.angle), zoom)) {
    outsideClaimed++;
  }
  checks++;
}

if (insideMissed > 0) {
  failures.push(`${insideMissed} points inside the box were missed (selection would drop on drag)`);
}
if (outsideClaimed > 0) {
  failures.push(`${outsideClaimed} points outside the box were claimed (empty-canvas click would not deselect)`);
}

console.log('selection-box hit verification');
console.log(`  checks (rotated boxes, zoom 0.2-4.2): ${checks}`);
console.log(`  inside points missed:                 ${insideMissed}`);
console.log(`  outside points wrongly claimed:       ${outsideClaimed}`);
console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
