import { rotatePoint, type Point } from '../utils/geometry';
import type { HandleName } from '../scene/selection';

export interface TransformBox {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

export interface ResizeOptions {
  preserveAspect: boolean;
  fromCenter: boolean;
}

// The anchor is implicit: whichever edges the handle does NOT move stay put.
const movesLeft = (handle: HandleName) => handle === 'nw' || handle === 'w' || handle === 'sw';
const movesRight = (handle: HandleName) => handle === 'ne' || handle === 'e' || handle === 'se';
const movesTop = (handle: HandleName) => handle === 'nw' || handle === 'n' || handle === 'ne';
const movesBottom = (handle: HandleName) => handle === 'sw' || handle === 's' || handle === 'se';

export const isCornerHandle = (handle: HandleName): boolean =>
  handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';

/**
 * Resize a (possibly rotated) box so the handle opposite the dragged one stays
 * pinned exactly where it was.
 *
 * The trick is to do all the work in the box's *original* local frame — the
 * frame obtained by rotating the scene about the original centre by -angle. In
 * that frame the box is axis-aligned, so resizing is trivial arithmetic. The
 * resulting local centre is then rotated back about the ORIGINAL centre, which
 * is what keeps the anchor fixed. Resizing in scene space instead is what makes
 * rotated shapes drift and shear as you drag them.
 */
export function resizeBox(
  start: TransformBox,
  handle: Exclude<HandleName, 'rotate'>,
  pointerScene: Point,
  options: ResizeOptions,
): TransformBox {
  const center: Point = {
    x: start.x + start.width / 2,
    y: start.y + start.height / 2,
  };

  // Into the original local frame, where the box is axis-aligned.
  const pointer = rotatePoint(pointerScene, center, -start.angle);

  const left = start.x;
  const top = start.y;
  const right = start.x + start.width;
  const bottom = start.y + start.height;

  let nextLeft = left;
  let nextTop = top;
  let nextRight = right;
  let nextBottom = bottom;

  if (options.fromCenter) {
    // Both edges move symmetrically about the centre.
    if (movesLeft(handle) || movesRight(handle)) {
      const half = Math.abs(pointer.x - center.x);
      nextLeft = center.x - half;
      nextRight = center.x + half;
    }
    if (movesTop(handle) || movesBottom(handle)) {
      const half = Math.abs(pointer.y - center.y);
      nextTop = center.y - half;
      nextBottom = center.y + half;
    }
  } else {
    if (movesLeft(handle)) nextLeft = pointer.x;
    if (movesRight(handle)) nextRight = pointer.x;
    if (movesTop(handle)) nextTop = pointer.y;
    if (movesBottom(handle)) nextBottom = pointer.y;
  }

  let width = nextRight - nextLeft;
  let height = nextBottom - nextTop;

  if (options.preserveAspect && isCornerHandle(handle) && start.width > 0 && start.height > 0) {
    const ratio = start.height / start.width;
    // Let the dominant axis win, then derive the other from the original ratio.
    if (Math.abs(width * ratio) > Math.abs(height)) {
      const nextHeight = Math.abs(width) * ratio * Math.sign(height || 1);
      if (movesTop(handle)) nextTop = nextBottom - nextHeight;
      else nextBottom = nextTop + nextHeight;
      height = nextBottom - nextTop;
    } else {
      const nextWidth = (Math.abs(height) / ratio) * Math.sign(width || 1);
      if (movesLeft(handle)) nextLeft = nextRight - nextWidth;
      else nextRight = nextLeft + nextWidth;
      width = nextRight - nextLeft;
    }
  }

  // Dragging a handle past its anchor flips the box; normalize so width/height
  // stay positive and no downstream code sees a negative extent.
  if (width < 0) {
    nextLeft = nextRight;
    width = -width;
  }
  if (height < 0) {
    nextTop = nextBottom;
    height = -height;
  }

  // Back to scene space, rotating about the ORIGINAL centre.
  const localCenter: Point = { x: nextLeft + width / 2, y: nextTop + height / 2 };
  const sceneCenter = rotatePoint(localCenter, center, start.angle);

  return {
    x: sceneCenter.x - width / 2,
    y: sceneCenter.y - height / 2,
    width,
    height,
    angle: start.angle,
  };
}

/**
 * Proportionally map an element from an old selection box into a new one.
 * The selection box is always unrotated, so this is a plain affine scale.
 */
export function scaleElementIntoBox(
  element: TransformBox,
  from: TransformBox,
  to: TransformBox,
): TransformBox {
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;

  return {
    x: to.x + (element.x - from.x) * scaleX,
    y: to.y + (element.y - from.y) * scaleY,
    width: element.width * scaleX,
    height: element.height * scaleY,
    angle: element.angle,
  };
}
