import { getElementBounds } from '../element/bounds';
import type { ExcaliElement } from '../element/types';
import type { Bounds } from '../utils/math';

/** Snap distance in CSS pixels; divided by zoom so it feels constant on screen. */
const SNAP_THRESHOLD_PX = 5;

export interface SnapGuide {
  /** Scene-space segment to draw on the interactive layer. */
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export const snapToGrid = (value: number, gridSize: number): number =>
  Math.round(value / gridSize) * gridSize;

const verticalLines = (bounds: Bounds): number[] => [
  bounds.minX,
  (bounds.minX + bounds.maxX) / 2,
  bounds.maxX,
];

const horizontalLines = (bounds: Bounds): number[] => [
  bounds.minY,
  (bounds.minY + bounds.maxY) / 2,
  bounds.maxY,
];

/**
 * Compares the moving bounds' three vertical and three horizontal lines against
 * every candidate's equivalents, and returns the offset that snaps the closest
 * pair on each axis. Candidates should already be limited to the viewport —
 * snapping against thousands of offscreen elements is wasted work.
 */
export function getObjectSnap(
  moving: Bounds,
  candidates: readonly ExcaliElement[],
  zoom: number,
): SnapResult {
  const threshold = SNAP_THRESHOLD_PX / zoom;

  let bestX: { delta: number; at: number; other: Bounds } | null = null;
  let bestY: { delta: number; at: number; other: Bounds } | null = null;

  const movingV = verticalLines(moving);
  const movingH = horizontalLines(moving);

  for (const candidate of candidates) {
    const other = getElementBounds(candidate);

    for (const mine of movingV) {
      for (const theirs of verticalLines(other)) {
        const delta = theirs - mine;
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, at: theirs, other };
        }
      }
    }

    for (const mine of movingH) {
      for (const theirs of horizontalLines(other)) {
        const delta = theirs - mine;
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, at: theirs, other };
        }
      }
    }
  }

  const guides: SnapGuide[] = [];

  if (bestX) {
    // Span the guide across both the snapped element and the target.
    const top = Math.min(moving.minY, bestX.other.minY);
    const bottom = Math.max(moving.maxY, bestX.other.maxY);
    guides.push({ from: { x: bestX.at, y: top }, to: { x: bestX.at, y: bottom } });
  }

  if (bestY) {
    const left = Math.min(moving.minX, bestY.other.minX);
    const right = Math.max(moving.maxX, bestY.other.maxX);
    guides.push({ from: { x: left, y: bestY.at }, to: { x: right, y: bestY.at } });
  }

  return { dx: bestX?.delta ?? 0, dy: bestY?.delta ?? 0, guides };
}
