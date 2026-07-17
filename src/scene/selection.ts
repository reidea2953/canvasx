import { getElementBounds, getUnrotatedBounds } from '../element/bounds';
import type { TransformBox } from '../element/resize';
import type { ExcaliElement } from '../element/types';
import { rotatePoint, type Point } from '../utils/geometry';

export type HandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

export const RESIZE_HANDLES: Exclude<HandleName, 'rotate'>[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

/** All in CSS pixels; divided by zoom at use so they stay constant on screen. */
const HANDLE_SIZE_PX = 8;
const HANDLE_HIT_SLACK = 1.5;
const ROTATE_OFFSET_PX = 22;

export const handleSize = (zoom: number): number => HANDLE_SIZE_PX / zoom;

/**
 * A single element keeps its own rotation, so its handles rotate with it.
 * A multi-selection uses the union AABB and is always unrotated — that keeps
 * multi-resize a plain affine scale instead of a shear.
 */
export function getSelectionBox(elements: readonly ExcaliElement[]): TransformBox | null {
  if (elements.length === 0) return null;

  if (elements.length === 1) {
    const element = elements[0];
    // Not x..x+width: a linear element's box comes from its points, which may
    // run negative relative to its origin.
    const bounds = getUnrotatedBounds(element);
    return {
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      angle: element.angle,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const element of elements) {
    const bounds = getElementBounds(element);
    if (bounds.minX < minX) minX = bounds.minX;
    if (bounds.minY < minY) minY = bounds.minY;
    if (bounds.maxX > maxX) maxX = bounds.maxX;
    if (bounds.maxY > maxY) maxY = bounds.maxY;
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, angle: 0 };
}

export const boxCenter = (box: TransformBox): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** Handle positions in the box's own unrotated frame. */
function localHandlePositions(box: TransformBox, zoom: number): Record<HandleName, Point> {
  const { x, y, width: w, height: h } = box;
  return {
    nw: { x, y },
    n: { x: x + w / 2, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 },
    rotate: { x: x + w / 2, y: y - ROTATE_OFFSET_PX / zoom },
  };
}

/** Handle positions in scene space, with the box's rotation applied. */
export function getHandlePositions(box: TransformBox, zoom: number): Record<HandleName, Point> {
  const local = localHandlePositions(box, zoom);
  if (box.angle === 0) return local;

  const center = boxCenter(box);
  const rotated = {} as Record<HandleName, Point>;
  for (const name of Object.keys(local) as HandleName[]) {
    rotated[name] = rotatePoint(local[name], center, box.angle);
  }
  return rotated;
}

/**
 * Is the pointer inside the current selection's box?
 *
 * Once something is selected its whole box is a drag target, exactly as in
 * Figma and Excalidraw. Without this, dragging a transparent shape from the
 * middle misses the outline hit-test, reads as a click on empty canvas, and
 * silently drops the selection.
 */
export function isPointInSelectionBox(
  box: TransformBox,
  scenePoint: Point,
  zoom: number,
): boolean {
  // Test in the box's own frame so one comparison covers every rotation.
  const point = rotatePoint(scenePoint, boxCenter(box), -box.angle);
  // A little slack so the edge is grabbable rather than pixel-perfect.
  const slack = 2 / zoom;
  return (
    point.x >= box.x - slack &&
    point.x <= box.x + box.width + slack &&
    point.y >= box.y - slack &&
    point.y <= box.y + box.height + slack
  );
}

export function getHandleAtPosition(
  box: TransformBox,
  scenePoint: Point,
  zoom: number,
): HandleName | null {
  // Test in the box's local frame so one comparison covers every rotation.
  const point = rotatePoint(scenePoint, boxCenter(box), -box.angle);
  const local = localHandlePositions(box, zoom);
  const reach = (handleSize(zoom) / 2) * HANDLE_HIT_SLACK;

  // Rotation first: it sits outside the box and must win any overlap.
  if (Math.hypot(point.x - local.rotate.x, point.y - local.rotate.y) <= reach * 1.4) {
    return 'rotate';
  }

  for (const name of RESIZE_HANDLES) {
    const handle = local[name];
    if (Math.abs(point.x - handle.x) <= reach && Math.abs(point.y - handle.y) <= reach) {
      return name;
    }
  }
  return null;
}

/** The mouse cursor for a handle, accounting for how far the box is rotated. */
export function handleCursor(handle: HandleName, angle: number): string {
  if (handle === 'rotate') return 'grab';

  const baseAngle: Record<Exclude<HandleName, 'rotate'>, number> = {
    e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315,
  };
  const degrees = (baseAngle[handle] + (angle * 180) / Math.PI + 360) % 180;
  if (degrees < 22.5 || degrees >= 157.5) return 'ew-resize';
  if (degrees < 67.5) return 'nwse-resize';
  if (degrees < 112.5) return 'ns-resize';
  return 'nesw-resize';
}
