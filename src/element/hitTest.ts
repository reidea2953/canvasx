import {
  distanceToPolygon,
  distanceToSegment,
  pointInPolygon,
  rotatePoint,
  type Point,
} from '../utils/geometry';
import { boundsIntersect, type Bounds } from '../utils/math';
import { getAbsolutePoints, getElementBounds, getElementCenter, getUnrotatedBounds } from './bounds';
import {
  hasPoints,
  isImageElement,
  isTextElement,
  type ExcaliElement,
  type FreedrawElement,
  type LinearElement,
  type ShapeElement,
} from './types';

/** Grab area in CSS pixels; divided by zoom so it stays constant on screen. */
const HIT_THRESHOLD_PX = 10;

export const diamondPoints = (element: ShapeElement): Point[] => [
  { x: element.x + element.width / 2, y: element.y },
  { x: element.x + element.width, y: element.y + element.height / 2 },
  { x: element.x + element.width / 2, y: element.y + element.height },
  { x: element.x, y: element.y + element.height / 2 },
];

/** Takes any box — text elements have no ShapeType but do have bounds. */
const insideRect = (
  point: Point,
  element: { x: number; y: number; width: number; height: number },
  slack: number,
): boolean =>
  point.x >= element.x - slack &&
  point.x <= element.x + element.width + slack &&
  point.y >= element.y - slack &&
  point.y <= element.y + element.height + slack;

const nearRectOutline = (point: Point, element: ShapeElement, threshold: number): boolean =>
  insideRect(point, element, threshold) &&
  !(
    point.x > element.x + threshold &&
    point.x < element.x + element.width - threshold &&
    point.y > element.y + threshold &&
    point.y < element.y + element.height - threshold
  );

/**
 * The exact point-to-ellipse distance needs a quartic solve. This scales the
 * implicit-form error back into scene units, which is accurate enough for a
 * 10px grab area and vastly cheaper.
 */
function ellipseOutlineDistance(point: Point, element: ShapeElement): number {
  const a = element.width / 2;
  const b = element.height / 2;
  if (a === 0 || b === 0) return Infinity;

  const center = getElementCenter(element);
  const dx = (point.x - center.x) / a;
  const dy = (point.y - center.y) / b;
  return Math.abs(Math.hypot(dx, dy) - 1) * Math.min(a, b);
}

const insideEllipse = (point: Point, element: ShapeElement): boolean => {
  const a = element.width / 2;
  const b = element.height / 2;
  if (a === 0 || b === 0) return false;
  const center = getElementCenter(element);
  const dx = (point.x - center.x) / a;
  const dy = (point.y - center.y) / b;
  return dx * dx + dy * dy <= 1;
};

/** Minimum distance from the point to any segment of the polyline. */
function nearPolyline(
  point: Point,
  element: LinearElement | FreedrawElement,
  threshold: number,
): boolean {
  // Reject early on the bounding box: the difference between a snappy and a
  // laggy hover over a long scribble.
  const bounds = getUnrotatedBounds(element);
  if (
    point.x < bounds.minX - threshold ||
    point.x > bounds.maxX + threshold ||
    point.y < bounds.minY - threshold ||
    point.y > bounds.maxY + threshold
  ) {
    return false;
  }

  const points = getAbsolutePoints(element);
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegment(point, points[i - 1], points[i]) <= threshold) return true;
  }
  return false;
}

export function hitTestElement(
  element: ExcaliElement,
  scenePoint: Point,
  zoom: number,
): boolean {
  const threshold = HIT_THRESHOLD_PX / zoom;

  // Undo the element's rotation so every test below can assume an axis-aligned box.
  const point = rotatePoint(scenePoint, getElementCenter(element), -element.angle);

  if (hasPoints(element)) {
    // A freedraw stroke renders wider than its centreline, so its grab area
    // has to account for the outline's half-width too.
    const width =
      element.type === 'freedraw' ? element.strokeWidth * 2.2 : element.strokeWidth / 2;
    return nearPolyline(point, element, threshold + width);
  }

  // Text and images are solid blocks: anywhere in the box counts, no outline case.
  if (isTextElement(element) || isImageElement(element)) return insideRect(point, element, 0);

  const filled = element.backgroundColor !== 'transparent';

  switch (element.type) {
    case 'rectangle':
      return filled
        ? insideRect(point, element, threshold)
        : nearRectOutline(point, element, threshold);

    case 'ellipse':
      return filled
        ? insideEllipse(point, element) || ellipseOutlineDistance(point, element) < threshold
        : ellipseOutlineDistance(point, element) < threshold;

    case 'diamond': {
      const polygon = diamondPoints(element);
      return filled
        ? pointInPolygon(point, polygon) || distanceToPolygon(point, polygon) < threshold
        : distanceToPolygon(point, polygon) < threshold;
    }
  }
}

/** Topmost wins, so iterate front to back and take the first hit. */
export function getElementAtPosition(
  elements: readonly ExcaliElement[],
  scenePoint: Point,
  zoom: number,
): ExcaliElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (element.isDeleted || element.locked) continue;
    if (hitTestElement(element, scenePoint, zoom)) return element;
  }
  return null;
}

/** Marquee selects on intersection, not containment. */
export function getElementsInBounds(
  elements: readonly ExcaliElement[],
  bounds: Bounds,
): ExcaliElement[] {
  return elements.filter(
    (element) =>
      !element.isDeleted &&
      !element.locked &&
      boundsIntersect(getElementBounds(element), bounds),
  );
}
