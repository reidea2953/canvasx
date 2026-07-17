import type { Point } from '../utils/geometry';
import { getPointsExtent } from './bounds';
import { mutateElement } from './mutate';
import type { LinearElement, LinearPoint } from './types';

/**
 * Writes scene-space points back onto a linear element, restoring the
 * points[0] === [0,0] invariant: the offset is folded into x,y and the extent
 * is recomputed. Every point edit must go through here or the invariant rots.
 */
export function setAbsolutePoints(element: LinearElement, absolute: Point[]): void {
  if (absolute.length === 0) return;

  const origin = absolute[0];
  const points: LinearPoint[] = absolute.map((point) => [
    point.x - origin.x,
    point.y - origin.y,
  ]);
  const extent = getPointsExtent(points);

  mutateElement(element, {
    x: origin.x,
    y: origin.y,
    points,
    width: extent.width,
    height: extent.height,
  });
}

/** Scale points about the element's own origin, for resize. */
export const scalePoints = (
  points: readonly LinearPoint[],
  scaleX: number,
  scaleY: number,
): LinearPoint[] => points.map(([x, y]) => [x * scaleX, y * scaleY]);

export const pointsAreDegenerate = (points: readonly LinearPoint[]): boolean => {
  if (points.length < 2) return true;
  const extent = getPointsExtent(points);
  return extent.width < 1e-6 && extent.height < 1e-6;
};
