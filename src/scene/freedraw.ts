import { getStroke } from 'perfect-freehand';
import type { BaseElement, FreedrawElement } from '../element/types';

/**
 * perfect-freehand returns a closed OUTLINE polygon, not a centreline — it is
 * filled, never stroked. Stroking it draws the hull's edge and looks wrong.
 */
const strokeOptions = (element: FreedrawElement, isDone: boolean) => ({
  size: element.strokeWidth * 4.25,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t: number) => Math.sin((t * Math.PI) / 2),
  simulatePressure: element.simulatePressure,
  // `last` tells the tapering that no more points are coming.
  last: isDone,
  start: { cap: true, taper: 0 },
  end: { cap: true, taper: 0 },
});

/**
 * Quadratic midpoints give a smooth hull rather than a visibly polygonal one.
 * Each segment curves through the current point toward the midpoint of the next.
 * Emitted as SVG path data so canvas and SVG export share one implementation.
 */
function pathDataFromOutline(outline: number[][]): string {
  if (outline.length === 0) return '';

  const parts: string[] = [`M${outline[0][0].toFixed(2)},${outline[0][1].toFixed(2)}`];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    parts.push(
      `Q${x0.toFixed(2)},${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)},${((y0 + y1) / 2).toFixed(2)}`,
    );
  }
  parts.push('Z');
  return parts.join(' ');
}

export function getFreedrawPathData(element: FreedrawElement, isDone = true): string {
  const input = element.points.map(([x, y], i) => [x, y, element.pressures[i] ?? 0.5]);
  return pathDataFromOutline(getStroke(input, strokeOptions(element, isDone)));
}

/**
 * Regenerating the outline of a 3,000-point scribble every frame is a real
 * cost, so it is cached by version exactly like the rough drawables.
 */
const cache = new WeakMap<BaseElement, { version: number; path: Path2D }>();

export function getFreedrawPath(element: FreedrawElement, isDone = true): Path2D {
  const hit = cache.get(element);
  if (hit && hit.version === element.version) return hit.path;

  const path = new Path2D(getFreedrawPathData(element, isDone));
  cache.set(element, { version: element.version, path });
  return path;
}

export const invalidateFreedrawCache = (element: BaseElement): void => {
  cache.delete(element);
};
