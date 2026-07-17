import type { ExcaliElement, ShapeType } from '../element/types';
import { scene } from '../scene/Scene';
import { invalidateStatic } from '../scene/render';

/**
 * Deterministic PRNG so the benchmark scene is identical across reloads —
 * frame timings are only comparable against the same scene.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const STROKES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];
const FILLS = ['transparent', 'transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff'];
const TYPES: ShapeType[] = ['rectangle', 'diamond', 'ellipse'];

export function loadSyntheticScene(count: number): void {
  const random = makeRandom(42);
  const elements: ExcaliElement[] = new Array(count);

  // Area scales with count so density stays constant and zooming out tests
  // culling rather than overdraw.
  const extent = Math.sqrt(count) * 60;

  for (let i = 0; i < count; i++) {
    elements[i] = {
      id: `synthetic-${i}`,
      type: TYPES[Math.floor(random() * TYPES.length)],
      x: random() * extent,
      y: random() * extent * 0.6,
      width: 40 + random() * 120,
      height: 30 + random() * 90,
      angle: 0,
      strokeColor: STROKES[Math.floor(random() * STROKES.length)],
      backgroundColor: FILLS[Math.floor(random() * FILLS.length)],
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      seed: Math.floor(random() * 2 ** 31),
      version: 1,
      versionNonce: Math.floor(random() * 2 ** 31),
      updated: Date.now(),
      isDeleted: false,
      groupIds: [],
      frameId: null,
      boundElements: null,
      locked: false,
      link: null,
    };
  }

  scene.replaceAll(elements);
  invalidateStatic();
}

export function clearScene(): void {
  scene.replaceAll([]);
  invalidateStatic();
}
