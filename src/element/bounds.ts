import type { Bounds } from '../utils/math';
import type { Point } from '../utils/geometry';
import {
  hasPoints,
  type ExcaliElement,
  type FreedrawElement,
  type LinearElement,
  type LinearPoint,
} from './types';

/** The extent of a linear element's points, which may run negative. */
export function getPointsExtent(points: readonly LinearPoint[]): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (points.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 };
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The element's box before rotation is applied.
 *
 * Shapes are simply x..x+width. Linear elements are NOT: their x,y locates
 * points[0], and later points may be negative, so their box has to come from
 * the points themselves.
 */
export function getUnrotatedBounds(element: ExcaliElement): Bounds {
  if (hasPoints(element)) {
    const extent = getPointsExtent(element.points);
    return {
      minX: element.x + extent.minX,
      minY: element.y + extent.minY,
      maxX: element.x + extent.minX + extent.width,
      maxY: element.y + extent.minY + extent.height,
    };
  }
  return {
    minX: element.x,
    minY: element.y,
    maxX: element.x + element.width,
    maxY: element.y + element.height,
  };
}

/** The point every rotation for this element turns about. */
export function getElementCenter(element: ExcaliElement): Point {
  const bounds = getUnrotatedBounds(element);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/** Centre of a plain box — for snapshots and transform boxes, not elements. */
export const getBoxCenter = (box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/**
 * Axis-aligned scene bounds, expanded to cover the rotated corners — which is
 * what culling and marquee tests need.
 */
export function getElementBounds(element: ExcaliElement): Bounds {
  const bounds = getUnrotatedBounds(element);
  if (element.angle === 0) return bounds;

  const halfWidth = (bounds.maxX - bounds.minX) / 2;
  const halfHeight = (bounds.maxY - bounds.minY) / 2;
  const centerX = bounds.minX + halfWidth;
  const centerY = bounds.minY + halfHeight;

  const cos = Math.abs(Math.cos(element.angle));
  const sin = Math.abs(Math.sin(element.angle));
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;

  return {
    minX: centerX - extentX,
    minY: centerY - extentY,
    maxX: centerX + extentX,
    maxY: centerY + extentY,
  };
}

/** Points in scene space, before the element's rotation is applied. */
export const getAbsolutePoints = (element: LinearElement | FreedrawElement): Point[] =>
  element.points.map(([x, y]) => ({ x: element.x + x, y: element.y + y }));
