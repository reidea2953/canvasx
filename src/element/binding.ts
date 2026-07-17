import { scene } from '../scene/Scene';
import { rotatePoint, type Point } from '../utils/geometry';
import { clamp } from '../utils/math';
import { getAbsolutePoints, getElementCenter } from './bounds';
import { diamondPoints } from './hitTest';
import { setAbsolutePoints } from './linear';
import { mutateElement } from './mutate';
import {
  isBindableElement,
  isLinearElement,
  type Binding,
  type ExcaliElement,
  type LinearElement,
  type ShapeElement,
} from './types';

/** Air between arrow tip and shape outline. */
const BINDING_GAP = 4;
const EPSILON = 1e-9;

/** How close the pointer must come to a shape to offer a binding. */
export const maxBindingGap = (element: ExcaliElement): number => {
  const smaller = Math.min(element.width, element.height);
  return Math.max(16, Math.min(0.25 * smaller, 32));
};

/**
 * Half the shape's *smaller* dimension. Using the smaller one keeps focus=±1
 * inside an elongated shape, so the aiming ray always still crosses the outline.
 */
const focusHalfExtent = (element: ShapeElement): number =>
  Math.min(element.width, element.height) / 2;

// ------------------------------------------------------- ray intersections

/** Smallest non-negative t where the ray crosses an axis-aligned box. */
function rayBox(origin: Point, direction: Point, element: ShapeElement): number | null {
  const minX = element.x;
  const maxX = element.x + element.width;
  const minY = element.y;
  const maxY = element.y + element.height;

  let tMin = -Infinity;
  let tMax = Infinity;

  if (Math.abs(direction.x) < EPSILON) {
    if (origin.x < minX || origin.x > maxX) return null;
  } else {
    let t1 = (minX - origin.x) / direction.x;
    let t2 = (maxX - origin.x) / direction.x;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }

  if (Math.abs(direction.y) < EPSILON) {
    if (origin.y < minY || origin.y > maxY) return null;
  } else {
    let t1 = (minY - origin.y) / direction.y;
    let t2 = (maxY - origin.y) / direction.y;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }

  if (tMax < tMin || tMax < 0) return null;
  return tMin >= 0 ? tMin : tMax;
}

/** Ray/ellipse in the unit-circle space the ellipse maps to. */
function rayEllipse(origin: Point, direction: Point, element: ShapeElement): number | null {
  const a = element.width / 2;
  const b = element.height / 2;
  if (a <= EPSILON || b <= EPSILON) return null;

  const cx = element.x + a;
  const cy = element.y + b;

  const u = (origin.x - cx) / a;
  const v = (origin.y - cy) / b;
  const du = direction.x / a;
  const dv = direction.y / b;

  const qa = du * du + dv * dv;
  const qb = 2 * (u * du + v * dv);
  const qc = u * u + v * v - 1;
  if (qa < EPSILON) return null;

  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const t1 = (-qb - root) / (2 * qa);
  const t2 = (-qb + root) / (2 * qa);
  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return null;
}

function raySegment(origin: Point, direction: Point, a: Point, b: Point): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const determinant = ex * direction.y - ey * direction.x;
  if (Math.abs(determinant) < EPSILON) return null;

  const dx = a.x - origin.x;
  const dy = a.y - origin.y;
  const t = (dx * ey - dy * ex) / -determinant;
  const u = (dx * direction.y - dy * direction.x) / -determinant;

  if (t < 0 || u < 0 || u > 1) return null;
  return t;
}

function rayPolygon(origin: Point, direction: Point, polygon: Point[]): number | null {
  let best: number | null = null;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const t = raySegment(origin, direction, polygon[j], polygon[i]);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/**
 * Where a ray from `from` toward `toward` first crosses the element's outline,
 * in scene space. Rotation is undone first so each case can assume an
 * axis-aligned shape, then the hit is rotated back.
 */
export function intersectRayWithElement(
  element: ShapeElement,
  from: Point,
  toward: Point,
): Point | null {
  const center = getElementCenter(element);
  const origin = rotatePoint(from, center, -element.angle);
  const target = rotatePoint(toward, center, -element.angle);

  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return null;
  const direction = { x: dx / length, y: dy / length };

  let t: number | null;
  switch (element.type) {
    case 'rectangle':
      t = rayBox(origin, direction, element);
      break;
    case 'ellipse':
      t = rayEllipse(origin, direction, element);
      break;
    case 'diamond':
      t = rayPolygon(origin, direction, diamondPoints(element));
      break;
  }
  if (t === null) return null;

  const local = { x: origin.x + direction.x * t, y: origin.y + direction.y * t };
  return rotatePoint(local, center, element.angle);
}

// ------------------------------------------------------------ focus & gap

/**
 * How far off the far-point→centre axis the arrow was aiming, normalized.
 * Captured once at bind time; replayed by getBindingPoint on every update.
 */
export function calculateFocus(element: ShapeElement, far: Point, tip: Point): number {
  const center = getElementCenter(element);
  const dx = center.x - far.x;
  const dy = center.y - far.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return 0;

  // Unit normal to the far→centre axis.
  const nx = -dy / length;
  const ny = dx / length;

  const extent = focusHalfExtent(element);
  if (extent < EPSILON) return 0;

  const offset = (tip.x - center.x) * nx + (tip.y - center.y) * ny;
  return clamp(offset / extent, -1, 1);
}

/**
 * Replays a stored focus into a concrete endpoint: aim at a point offset from
 * the centre perpendicular to the far→centre axis, intersect the outline, then
 * back off by the gap.
 */
export function getBindingPoint(
  element: ShapeElement,
  far: Point,
  focus: number,
  gap: number,
): Point | null {
  // A reference point inside the shape has no meaningful outline crossing: the
  // ray would exit through the far wall and the gap would push the tip back
  // INSIDE. Happens when bound shapes overlap enough to contain each other's
  // centre. Leave the endpoint where it is rather than invent a wrong one.
  if (distanceToBindable(element, far) < EPSILON) return null;

  const center = getElementCenter(element);
  const dx = center.x - far.x;
  const dy = center.y - far.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return null;

  const nx = -dy / length;
  const ny = dx / length;
  const extent = focusHalfExtent(element);

  const aim: Point = {
    x: center.x + nx * focus * extent,
    y: center.y + ny * focus * extent,
  };

  const hit = intersectRayWithElement(element, far, aim);
  if (!hit) return null;

  // Back off along the ray, toward the far point.
  const hx = hit.x - far.x;
  const hy = hit.y - far.y;
  const hitLength = Math.hypot(hx, hy);
  if (hitLength < EPSILON) return hit;

  // Clamp so the tip can never travel past its own reference point. Without
  // this, two shapes close enough that the outline hit is nearer than `gap`
  // send the tip to the far side of the reference and the arrow visibly points
  // backwards. Clamped, the worst case is a degenerate zero-length arrow.
  const effectiveGap = Math.min(gap, hitLength);

  return {
    x: hit.x - (hx / hitLength) * effectiveGap,
    y: hit.y - (hy / hitLength) * effectiveGap,
  };
}

// -------------------------------------------------------------- hit lookup

/** Zero when the point is inside the shape, else the distance to its outline. */
function distanceToBindable(element: ShapeElement, scenePoint: Point): number {
  const center = getElementCenter(element);
  const point = rotatePoint(scenePoint, center, -element.angle);

  switch (element.type) {
    case 'rectangle': {
      const dx = Math.max(element.x - point.x, 0, point.x - (element.x + element.width));
      const dy = Math.max(element.y - point.y, 0, point.y - (element.y + element.height));
      return Math.hypot(dx, dy);
    }
    case 'ellipse': {
      const a = element.width / 2;
      const b = element.height / 2;
      if (a <= EPSILON || b <= EPSILON) return Infinity;
      const u = (point.x - center.x) / a;
      const v = (point.y - center.y) / b;
      const radial = Math.hypot(u, v);
      return radial <= 1 ? 0 : (radial - 1) * Math.min(a, b);
    }
    case 'diamond': {
      const polygon = diamondPoints(element);
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const p = polygon[i];
        const q = polygon[j];
        if (
          p.y > point.y !== q.y > point.y &&
          point.x < ((q.x - p.x) * (point.y - p.y)) / (q.y - p.y) + p.x
        ) {
          inside = !inside;
        }
      }
      if (inside) return 0;
      let min = Infinity;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const p = polygon[i];
        const q = polygon[j];
        const ex = p.x - q.x;
        const ey = p.y - q.y;
        const lengthSquared = ex * ex + ey * ey;
        let t = lengthSquared === 0 ? 0 : ((point.x - q.x) * ex + (point.y - q.y) * ey) / lengthSquared;
        t = clamp(t, 0, 1);
        min = Math.min(min, Math.hypot(point.x - (q.x + t * ex), point.y - (q.y + t * ey)));
      }
      return min;
    }
  }
}

/** The bindable shape under (or near) the pointer, topmost first. */
export function getHoveredBindable(
  elements: readonly ExcaliElement[],
  scenePoint: Point,
  ignoreId?: string,
): ShapeElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (element.isDeleted || element.locked || element.id === ignoreId) continue;
    if (!isBindableElement(element)) continue;
    if (distanceToBindable(element, scenePoint) <= maxBindingGap(element)) return element;
  }
  return null;
}

// ---------------------------------------------------------------- updating

/**
 * Reentrancy guard. Mutating an arrow can never cascade (arrows are not
 * bindable, so updateBoundElements bails immediately), but Phase 5 adds bound
 * text labels, and a shape→label→shape chain would otherwise spin the tab.
 */
let cascading = false;

/**
 * Recompute an arrow's bound endpoints.
 *
 * The reference point each end aims from is deliberately NOT the arrow's own
 * other endpoint when both ends are bound — it is the other shape's centre.
 * Anchoring to a value that is itself being recomputed is exactly how these
 * systems oscillate; centres are fixed during the update, so this terminates.
 */
export function recomputeArrowBindings(arrow: LinearElement): void {
  if (!arrow.startBinding && !arrow.endBinding) return;

  const absolute = getAbsolutePoints(arrow);
  if (absolute.length < 2) return;
  const last = absolute.length - 1;
  const isMultiPoint = absolute.length > 2;

  const shapeFor = (binding: Binding | null): ShapeElement | null => {
    if (!binding) return null;
    const element = scene.getById(binding.elementId);
    if (!element || element.isDeleted || !isBindableElement(element)) return null;
    return element;
  };

  const startShape = shapeFor(arrow.startBinding);
  const endShape = shapeFor(arrow.endBinding);

  if (arrow.startBinding && startShape) {
    // A multi-point arrow aims from its adjacent point, which is not itself
    // being recomputed and so is stable.
    const far = isMultiPoint
      ? absolute[1]
      : endShape
        ? getElementCenter(endShape)
        : absolute[last];
    const point = getBindingPoint(startShape, far, arrow.startBinding.focus, arrow.startBinding.gap);
    if (point) absolute[0] = point;
  }

  if (arrow.endBinding && endShape) {
    const far = isMultiPoint
      ? absolute[last - 1]
      : startShape
        ? getElementCenter(startShape)
        : absolute[0];
    const point = getBindingPoint(endShape, far, arrow.endBinding.focus, arrow.endBinding.gap);
    if (point) absolute[last] = point;
  }

  setAbsolutePoints(arrow, absolute);
}

/** Called from mutateElement whenever any element changes. */
export function updateBoundElements(changed: ExcaliElement): void {
  // Arrows do not own bindings in this direction, so nothing to cascade.
  if (!isBindableElement(changed)) return;
  const refs = changed.boundElements;
  if (!refs || refs.length === 0) return;
  if (cascading) return;

  cascading = true;
  try {
    for (const ref of refs) {
      if (ref.type !== 'arrow') continue;
      const arrow = scene.getById(ref.id);
      if (!arrow || arrow.isDeleted || !isLinearElement(arrow)) continue;
      recomputeArrowBindings(arrow);
    }
  } finally {
    cascading = false;
  }
}

// ----------------------------------------------------------------- binding

export function bindArrow(
  arrow: LinearElement,
  shape: ShapeElement,
  which: 'start' | 'end',
): void {
  const absolute = getAbsolutePoints(arrow);
  if (absolute.length < 2) return;
  const last = absolute.length - 1;

  const tip = which === 'start' ? absolute[0] : absolute[last];
  const far =
    absolute.length > 2
      ? which === 'start'
        ? absolute[1]
        : absolute[last - 1]
      : which === 'start'
        ? absolute[last]
        : absolute[0];

  const binding: Binding = {
    elementId: shape.id,
    focus: calculateFocus(shape, far, tip),
    gap: BINDING_GAP,
  };

  mutateElement(arrow, which === 'start' ? { startBinding: binding } : { endBinding: binding });

  const refs = shape.boundElements ?? [];
  if (!refs.some((ref) => ref.id === arrow.id)) {
    // This mutation cascades back and snaps the arrow onto the shape at once.
    mutateElement(shape, { boundElements: [...refs, { id: arrow.id, type: 'arrow' }] });
  } else {
    recomputeArrowBindings(arrow);
  }
}

export function unbindArrow(arrow: LinearElement, which: 'start' | 'end'): void {
  const binding = which === 'start' ? arrow.startBinding : arrow.endBinding;
  if (!binding) return;

  mutateElement(arrow, which === 'start' ? { startBinding: null } : { endBinding: null });

  const shape = scene.getById(binding.elementId);
  if (!shape) return;

  // Drop the back-reference only once no end of this arrow still binds it.
  const other = which === 'start' ? arrow.endBinding : arrow.startBinding;
  if (other?.elementId === binding.elementId) return;

  const refs = (shape.boundElements ?? []).filter((ref) => ref.id !== arrow.id);
  mutateElement(shape, { boundElements: refs.length > 0 ? refs : null });
}

/** Clean both directions so tombstones cannot leave dangling references. */
export function onElementsDeleted(deleted: readonly ExcaliElement[]): void {
  const deletedIds = new Set(deleted.map((element) => element.id));

  for (const element of scene.getNonDeleted()) {
    if (isLinearElement(element)) {
      if (element.startBinding && deletedIds.has(element.startBinding.elementId)) {
        mutateElement(element, { startBinding: null });
      }
      if (element.endBinding && deletedIds.has(element.endBinding.elementId)) {
        mutateElement(element, { endBinding: null });
      }
    }
    if (element.boundElements?.some((ref) => deletedIds.has(ref.id))) {
      const refs = element.boundElements.filter((ref) => !deletedIds.has(ref.id));
      mutateElement(element, { boundElements: refs.length > 0 ? refs : null });
    }
  }
}
