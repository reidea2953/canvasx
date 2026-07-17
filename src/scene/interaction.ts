import {
  getAbsolutePoints,
  getBoxCenter,
  getElementBounds,
  getElementCenter,
  getPointsExtent,
} from '../element/bounds';
import {
  bindArrow,
  getHoveredBindable,
  onElementsDeleted,
  unbindArrow,
} from '../element/binding';
import { attachTextToContainer, getBoundTextElement } from '../element/container';
import {
  newFreedrawElement,
  newLinearElement,
  newShapeElement,
  newTextElement,
} from '../element/factory';
import { selectableGroupId } from '../element/groups';
import { getElementAtPosition, getElementsInBounds, hitTestElement } from '../element/hitTest';
import { pointsAreDegenerate, scalePoints, setAbsolutePoints } from '../element/linear';
import { mutateElement } from '../element/mutate';
import { resizeBox, scaleElementIntoBox, type TransformBox } from '../element/resize';
import {
  isContainerElement,
  isLinearElement,
  isLinearType,
  isShapeType,
  isTextElement,
  type ExcaliElement,
  type FreedrawElement,
  type LinearElement,
  type LinearPoint,
  type ShapeElement,
} from '../element/types';
import { record } from '../state/history';
import { getAppState, setAppState } from '../state/store';
import { getVisibleSceneBounds, viewportToScene, type ScenePoint } from '../utils/coords';
import { rotatePoint, type Point } from '../utils/geometry';
import { type Bounds } from '../utils/math';
import {
  duplicateSelected,
  expandSelectionToGroups,
  getSelectedElements,
  selectElements,
} from './actions';
import { broadcastPointer } from '../collab/sync';
import { addLaserPoint } from './laser';
import { invalidateInteractive, invalidateStatic } from './render';
import { scene } from './Scene';
import {
  getHandleAtPosition,
  getSelectionBox,
  handleCursor,
  isPointInSelectionBox,
  type HandleName,
} from './selection';
import { getObjectSnap, snapToGrid, type SnapGuide } from './snapping';
import { zoomAtViewportPoint } from './viewport';

interface ElementSnapshot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  /** Present only for linear elements, which resize by scaling their points. */
  points?: LinearPoint[];
}

/**
 * One machine owns every pointer gesture. Scattered booleans is how this kind
 * of code rots — later phases add states here, not flags.
 */
export type Interaction =
  | { kind: 'idle' }
  | { kind: 'panning'; lastX: number; lastY: number }
  | { kind: 'selecting'; origin: ScenePoint; current: ScenePoint }
  | {
      kind: 'dragging';
      origin: ScenePoint;
      offsets: Map<string, ScenePoint>;
      moved: boolean;
      guides: SnapGuide[];
    }
  | {
      kind: 'resizing';
      handle: Exclude<HandleName, 'rotate'>;
      startBox: TransformBox;
      snapshots: ElementSnapshot[];
    }
  | { kind: 'rotating'; center: ScenePoint; grabAngle: number; snapshots: ElementSnapshot[] }
  | { kind: 'drawing'; element: ShapeElement; origin: ScenePoint; moved: boolean }
  | {
      kind: 'drawingLinear';
      element: LinearElement;
      origin: ScenePoint;
      moved: boolean;
      startBindable: ShapeElement | null;
      hoveredBindableId: string | null;
    }
  /** Click-click-click polyline mode; survives pointerup until explicitly ended. */
  | {
      kind: 'multiPoint';
      element: LinearElement;
      startBindable: ShapeElement | null;
      hoveredBindableId: string | null;
    }
  | {
      kind: 'editingPoint';
      element: LinearElement;
      pointIndex: number;
      hoveredBindableId: string | null;
    }
  | { kind: 'freedrawing'; element: FreedrawElement }
  /** Elements marked for erase but not yet committed, so the gesture is one undo step. */
  | { kind: 'erasing'; pending: Set<string>; last: ScenePoint }
  | { kind: 'laser' };

let interaction: Interaction = { kind: 'idle' };

/** The renderer reads this to draw in-progress gestures on the interactive layer. */
export const getInteraction = (): Interaction => interaction;

/**
 * Elements the eraser is hovering but has not committed. renderStatic skips
 * them and renderInteractive redraws them faded, so the erase reads as
 * provisional before release.
 */
export const getPendingErase = (): Set<string> | null =>
  interaction.kind === 'erasing' ? interaction.pending : null;

/** Where the eraser ring is drawn. Null whenever the eraser is not in play. */
let eraserCursor: ScenePoint | null = null;
export const getEraserCursor = (): ScenePoint | null => eraserCursor;

/** Radius of the eraser, in CSS pixels. The ring and the hit test share it. */
export const ERASER_RADIUS_PX = 12;

const CLICK_THRESHOLD_PX = 5;
const DEFAULT_SHAPE_SIZE = 100;
const ROTATE_SNAP_RADIANS = (15 * Math.PI) / 180;
const LINEAR_POINT_HIT_PX = 10;
const LINE_HEIGHT = 16;

const snapshotOf = (element: ExcaliElement): ElementSnapshot => ({
  id: element.id,
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
  angle: element.angle,
  points: isLinearElement(element) ? element.points.map(([x, y]) => [x, y]) : undefined,
});

function normalizeWheel(event: WheelEvent): { x: number; y: number } {
  let { deltaX, deltaY } = event;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    deltaX *= LINE_HEIGHT;
    deltaY *= LINE_HEIGHT;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    deltaX *= window.innerHeight;
    deltaY *= window.innerHeight;
  }
  return { x: deltaX, y: deltaY };
}

function updateDrawnGeometry(
  element: ShapeElement,
  origin: ScenePoint,
  pointer: ScenePoint,
  shiftKey: boolean,
  altKey: boolean,
): void {
  let dx = pointer.x - origin.x;
  let dy = pointer.y - origin.y;

  if (shiftKey) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx) * size;
    dy = Math.sign(dy) * size;
  }

  if (altKey) {
    mutateElement(element, {
      x: origin.x - Math.abs(dx),
      y: origin.y - Math.abs(dy),
      width: Math.abs(dx) * 2,
      height: Math.abs(dy) * 2,
    });
    return;
  }

  mutateElement(element, {
    x: Math.min(origin.x, origin.x + dx),
    y: Math.min(origin.y, origin.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  });
}

/**
 * A mouse reports pressure 0.5 and some trackpads report 0, so a raw reading
 * cannot be trusted. Without real pressure, perfect-freehand derives width from
 * velocity instead — which is what gives mouse strokes their taper.
 */
const hasRealPressure = (event: PointerEvent): boolean =>
  event.pointerType === 'pen' && event.pressure > 0 && event.pressure !== 0.5;

const pressureOf = (event: PointerEvent): number =>
  hasRealPressure(event) ? event.pressure : 0.5;

/** Shift constrains a linear segment to 15° increments. */
function constrainAngle(origin: Point, pointer: Point): Point {
  const dx = pointer.x - origin.x;
  const dy = pointer.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return pointer;
  const snapped = Math.round(Math.atan2(dy, dx) / ROTATE_SNAP_RADIANS) * ROTATE_SNAP_RADIANS;
  return { x: origin.x + Math.cos(snapped) * length, y: origin.y + Math.sin(snapped) * length };
}

/**
 * Marks everything the pointer path crossed, not just where it currently is.
 * Testing only the current point lets a fast flick skip straight over elements
 * between frames.
 */
function eraseAlongSegment(from: ScenePoint, to: ScenePoint, zoom: number, pending: Set<string>): boolean {
  // Same radius the ring is drawn at, so what you see is what you erase.
  const reach = ERASER_RADIUS_PX / zoom;
  const segment: Bounds = {
    minX: Math.min(from.x, to.x) - reach,
    minY: Math.min(from.y, to.y) - reach,
    maxX: Math.max(from.x, to.x) + reach,
    maxY: Math.max(from.y, to.y) + reach,
  };

  // Cull to the segment's neighbourhood first: sampling against every element
  // in a 10k scene would cost more than the whole frame budget.
  const candidates = getElementsInBounds(scene.getNonDeleted(), segment);
  if (candidates.length === 0) return false;

  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.min(24, Math.max(1, Math.ceil(distance / reach)));

  let added = false;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const at = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    for (const element of candidates) {
      if (pending.has(element.id)) continue;
      if (hitTestElement(element, at, zoom)) {
        pending.add(element.id);
        added = true;
      }
    }
  }
  return added;
}

const unionBounds = (elements: readonly ExcaliElement[]): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const bounds = getElementBounds(element);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  return { minX, minY, maxX, maxY };
};

/** Index of the linear point under the pointer, or -1. */
function findPointAt(element: LinearElement, scenePoint: Point, zoom: number): number {
  const center = getElementCenter(element);
  const reach = LINEAR_POINT_HIT_PX / zoom;
  const points = getAbsolutePoints(element);

  for (let i = 0; i < points.length; i++) {
    const at = rotatePoint(points[i], center, element.angle);
    if (Math.hypot(scenePoint.x - at.x, scenePoint.y - at.y) <= reach) return i;
  }
  return -1;
}

/** Commit a finished linear element, or discard it if it never got a shape. */
function commitLinear(
  element: LinearElement,
  startBindable: ShapeElement | null,
  endPoint: Point,
): void {
  if (pointsAreDegenerate(element.points)) {
    invalidateInteractive();
    return;
  }

  scene.add(element);

  if (element.type === 'arrow') {
    if (startBindable) bindArrow(element, startBindable, 'start');
    const endBindable = getHoveredBindable(scene.getNonDeleted(), endPoint, element.id);
    // Binding both ends to the same shape would collapse the arrow into itself.
    if (endBindable && endBindable.id !== startBindable?.id) {
      bindArrow(element, endBindable, 'end');
    }
  }

  if (!getAppState().toolLocked) {
    setAppState({ activeTool: 'selection', selectedElementIds: { [element.id]: true } });
  }
  invalidateStatic();
  invalidateInteractive();
  record();
}

export function attachInteractionHandlers(container: HTMLElement): () => void {
  let spaceHeld = false;
  let activePointerId: number | null = null;

  const rect = () => container.getBoundingClientRect();
  const scenePoint = (event: PointerEvent | MouseEvent): ScenePoint =>
    viewportToScene(event.clientX, event.clientY, getAppState(), rect());

  // ------------------------------------------------------------- wheel

  const onWheel = (event: WheelEvent) => {
    // Also suppresses the browser's own ctrl+wheel page zoom.
    event.preventDefault();
    const state = getAppState();
    const delta = normalizeWheel(event);

    // A trackpad pinch arrives as a wheel event with ctrlKey set.
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-delta.y / 100);
      zoomAtViewportPoint(event.clientX, event.clientY, state.zoom * factor, rect());
      return;
    }

    let { x: dx, y: dy } = delta;
    if (event.shiftKey && dx === 0) {
      dx = dy;
      dy = 0;
    }

    setAppState({
      scrollX: state.scrollX - dx / state.zoom,
      scrollY: state.scrollY - dy / state.zoom,
    });
    invalidateStatic();
  };

  // -------------------------------------------------- multi-point plumbing

  const finishMultiPoint = (cancel = false) => {
    if (interaction.kind !== 'multiPoint') return;
    const { element, startBindable } = interaction;

    // The last point is the live preview under the cursor, not a committed one.
    const committed = element.points.slice(0, -1);
    interaction = { kind: 'idle' };

    if (cancel || committed.length < 2) {
      invalidateInteractive();
      if (!cancel) setAppState({ activeTool: 'selection' });
      return;
    }

    setAbsolutePoints(
      element,
      committed.map(([x, y]) => ({ x: element.x + x, y: element.y + y })),
    );
    const points = getAbsolutePoints(element);
    commitLinear(element, startBindable, points[points.length - 1]);
  };

  // --------------------------------------------------------- pointer down

  const startPan = (event: PointerEvent) => {
    activePointerId = event.pointerId;
    container.setPointerCapture(event.pointerId);
    interaction = { kind: 'panning', lastX: event.clientX, lastY: event.clientY };
    container.style.cursor = 'grabbing';
  };

  const startDrawingShape = (event: PointerEvent, tool: ShapeElement['type']) => {
    const state = getAppState();
    let origin = scenePoint(event);
    if (state.gridSize) {
      origin = { x: snapToGrid(origin.x, state.gridSize), y: snapToGrid(origin.y, state.gridSize) };
    }
    const element = newShapeElement(tool, { x: origin.x, y: origin.y, width: 0, height: 0 });
    activePointerId = event.pointerId;
    container.setPointerCapture(event.pointerId);
    interaction = { kind: 'drawing', element, origin, moved: false };
    invalidateInteractive();
  };

  const startDrawingLinear = (event: PointerEvent, tool: LinearElement['type']) => {
    const state = getAppState();
    let origin = scenePoint(event);

    // Binding is decided from where the user actually pressed, before any snap.
    const startBindable =
      tool === 'arrow' ? getHoveredBindable(scene.getNonDeleted(), origin) : null;

    if (state.gridSize) {
      origin = { x: snapToGrid(origin.x, state.gridSize), y: snapToGrid(origin.y, state.gridSize) };
    }

    const element = newLinearElement(tool, origin);
    activePointerId = event.pointerId;
    container.setPointerCapture(event.pointerId);
    interaction = {
      kind: 'drawingLinear',
      element,
      origin,
      moved: false,
      startBindable,
      hoveredBindableId: startBindable?.id ?? null,
    };
    invalidateInteractive();
  };

  /** Create free text at a point and open the editor on it. */
  const startTextEditing = (origin: ScenePoint) => {
    const element = newTextElement(origin);
    scene.add(element);
    setAppState({
      editingTextElementId: element.id,
      activeTool: getAppState().toolLocked ? 'text' : 'selection',
    });
    invalidateInteractive();
  };

  /** Create or open the label bound to a container shape. */
  const editContainerLabel = (shape: ShapeElement) => {
    const existing = getBoundTextElement(shape);
    if (existing) {
      setAppState({ editingTextElementId: existing.id });
      invalidateInteractive();
      return;
    }
    const label = newTextElement({ x: shape.x, y: shape.y }, shape.id);
    scene.add(label);
    attachTextToContainer(label, shape);
    setAppState({ editingTextElementId: label.id });
    invalidateStatic();
    invalidateInteractive();
  };

  const startDragging = (event: PointerEvent, origin: ScenePoint) => {
    // Alt+drag leaves the originals behind and drags fresh copies.
    if (event.altKey) duplicateSelected(0);

    const offsets = new Map<string, ScenePoint>();
    for (const element of getSelectedElements()) {
      offsets.set(element.id, { x: element.x - origin.x, y: element.y - origin.y });
    }
    activePointerId = event.pointerId;
    container.setPointerCapture(event.pointerId);
    interaction = { kind: 'dragging', origin, offsets, moved: false, guides: [] };
  };

  const onPointerDown = (event: PointerEvent) => {
    const state = getAppState();

    // Multi-point mode owns the click: each one commits another point.
    if (interaction.kind === 'multiPoint' && event.button === 0) {
      const element = interaction.element;
      const points = element.points;
      const last = points[points.length - 1];

      // Clicking the previous point again ends the polyline.
      const previous = points[points.length - 2];
      if (
        previous &&
        Math.hypot(last[0] - previous[0], last[1] - previous[1]) * state.zoom < CLICK_THRESHOLD_PX
      ) {
        finishMultiPoint();
        return;
      }

      mutateElement(element, { points: [...points, [last[0], last[1]]] });
      invalidateInteractive();
      return;
    }

    if (activePointerId !== null) return;

    if (event.button === 1 || spaceHeld || state.activeTool === 'hand') {
      event.preventDefault();
      startPan(event);
      return;
    }
    if (event.button !== 0) return;

    if (isShapeType(state.activeTool)) {
      startDrawingShape(event, state.activeTool);
      return;
    }
    if (isLinearType(state.activeTool)) {
      startDrawingLinear(event, state.activeTool);
      return;
    }

    if (state.activeTool === 'freedraw') {
      const origin = scenePoint(event);
      const element = newFreedrawElement(origin, !hasRealPressure(event));
      element.pressures.push(pressureOf(event));
      activePointerId = event.pointerId;
      container.setPointerCapture(event.pointerId);
      interaction = { kind: 'freedrawing', element };
      invalidateInteractive();
      return;
    }

    if (state.activeTool === 'eraser') {
      const origin = scenePoint(event);
      const pending = new Set<string>();
      eraseAlongSegment(origin, origin, state.zoom, pending);
      activePointerId = event.pointerId;
      container.setPointerCapture(event.pointerId);
      interaction = { kind: 'erasing', pending, last: origin };
      eraserCursor = origin;
      invalidateStatic();
      invalidateInteractive();
      return;
    }

    if (state.activeTool === 'laser') {
      const origin = scenePoint(event);
      addLaserPoint(origin.x, origin.y);
      activePointerId = event.pointerId;
      container.setPointerCapture(event.pointerId);
      interaction = { kind: 'laser' };
      return;
    }

    if (state.activeTool === 'text') {
      const origin = scenePoint(event);
      // Clicking an existing text with the text tool edits it rather than
      // stacking a second one on top.
      const hit = getElementAtPosition(scene.getNonDeleted(), origin, state.zoom);
      if (hit && isTextElement(hit)) {
        setAppState({ editingTextElementId: hit.id, activeTool: 'selection' });
        return;
      }
      startTextEditing(origin);
      return;
    }

    if (state.activeTool !== 'selection') return;

    const pointer = scenePoint(event);

    // Point editing takes precedence over everything while it is active.
    if (state.editingLinearElementId) {
      const editing = scene.getById(state.editingLinearElementId);
      if (editing && isLinearElement(editing) && !editing.isDeleted) {
        const index = findPointAt(editing, pointer, state.zoom);
        if (index !== -1) {
          activePointerId = event.pointerId;
          container.setPointerCapture(event.pointerId);
          interaction = {
            kind: 'editingPoint',
            element: editing,
            pointIndex: index,
            hoveredBindableId: null,
          };
          return;
        }
      }
      // A click away from any point leaves the editor.
      setAppState({ editingLinearElementId: null });
    }

    const selected = getSelectedElements();
    const box = getSelectionBox(selected);

    // Handles win over elements — they sit on top and are the smaller target.
    if (box) {
      const handle = getHandleAtPosition(box, pointer, state.zoom);
      if (handle === 'rotate') {
        activePointerId = event.pointerId;
        container.setPointerCapture(event.pointerId);
        const center = getBoxCenter(box);
        interaction = {
          kind: 'rotating',
          center,
          grabAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
          snapshots: selected.map(snapshotOf),
        };
        return;
      }
      if (handle) {
        activePointerId = event.pointerId;
        container.setPointerCapture(event.pointerId);
        interaction = {
          kind: 'resizing',
          handle,
          startBox: { ...box },
          snapshots: selected.map(snapshotOf),
        };
        return;
      }
    }

    // Anywhere inside the selection box drags the selection — even over a
    // transparent shape's empty middle, which no hit-test would report. This is
    // what keeps a selection alive across a move instead of silently dropping it.
    if (box && !event.shiftKey && isPointInSelectionBox(box, pointer, state.zoom)) {
      startDragging(event, pointer);
      return;
    }

    const hit = getElementAtPosition(scene.getNonDeleted(), pointer, state.zoom);

    if (!hit) {
      // Empty canvas is the ONE gesture that clears a selection.
      if (!event.shiftKey) {
        setAppState({ selectedElementIds: {}, editingGroupId: null });
      }
      activePointerId = event.pointerId;
      container.setPointerCapture(event.pointerId);
      interaction = { kind: 'selecting', origin: pointer, current: pointer };
      invalidateInteractive();
      return;
    }

    // A click on a grouped element takes the whole group, unless we have
    // drilled into that group already.
    const groupId = selectableGroupId(hit, state.editingGroupId);
    const targets = groupId ? expandSelectionToGroups([hit]) : [hit];

    if (event.shiftKey) {
      const ids = { ...state.selectedElementIds };
      const alreadySelected = targets.every((element) => ids[element.id]);
      for (const element of targets) {
        if (alreadySelected) delete ids[element.id];
        else ids[element.id] = true;
      }
      setAppState({ selectedElementIds: ids });
      invalidateInteractive();
      return;
    }

    if (!state.selectedElementIds[hit.id]) selectElements(targets);
    startDragging(event, pointer);
  };

  // --------------------------------------------------------- pointer move

  /** Append one sample to the in-progress stroke, in element-local coords. */
  const appendFreedrawPoint = (element: FreedrawElement, event: PointerEvent) => {
    const at = scenePoint(event);
    // Mutating the arrays in place: allocating fresh ones per sample would
    // thrash the GC at 240Hz. mutateElement still bumps the version so the
    // stroke cache and renderer see the change.
    element.points.push([at.x - element.x, at.y - element.y]);
    element.pressures.push(pressureOf(event));
    const extent = getPointsExtent(element.points);
    mutateElement(element, { width: extent.width, height: extent.height });
  };

  const onPointerMove = (event: PointerEvent) => {
    const state = getAppState();

    // Presence: throttled inside, and a no-op when not in a room.
    const at = scenePoint(event);
    broadcastPointer(at.x, at.y);

    // Chrome throttles pointermove to the display rate but buffers the real
    // high-frequency samples (up to 240Hz on a good stylus). Using them costs
    // two lines and is the single biggest win for stroke smoothness.
    if (interaction.kind === 'freedrawing' && activePointerId === event.pointerId) {
      const samples = event.getCoalescedEvents?.() ?? [event];
      for (const sample of samples) appendFreedrawPoint(interaction.element, sample);
      invalidateInteractive();
      return;
    }

    if (interaction.kind === 'laser' && activePointerId === event.pointerId) {
      const samples = event.getCoalescedEvents?.() ?? [event];
      for (const sample of samples) {
        const at = scenePoint(sample);
        addLaserPoint(at.x, at.y);
      }
      return;
    }

    if (interaction.kind === 'erasing' && activePointerId === event.pointerId) {
      eraserCursor = at;
      if (eraseAlongSegment(interaction.last, at, state.zoom, interaction.pending)) {
        invalidateStatic();
      }
      interaction.last = at;
      // Always redraw: the ring follows the pointer even over empty canvas.
      invalidateInteractive();
      return;
    }

    // Multi-point preview follows the cursor with no button held.
    if (interaction.kind === 'multiPoint' && activePointerId === null) {
      const element = interaction.element;
      const points = [...element.points];
      let pointer = scenePoint(event);

      const anchor = points[points.length - 2];
      if (event.shiftKey && anchor) {
        pointer = constrainAngle(
          { x: element.x + anchor[0], y: element.y + anchor[1] },
          pointer,
        );
      }
      if (state.gridSize) {
        pointer = {
          x: snapToGrid(pointer.x, state.gridSize),
          y: snapToGrid(pointer.y, state.gridSize),
        };
      }

      points[points.length - 1] = [pointer.x - element.x, pointer.y - element.y];
      setAbsolutePoints(
        element,
        points.map(([x, y]) => ({ x: element.x + x, y: element.y + y })),
      );

      interaction.hoveredBindableId =
        element.type === 'arrow'
          ? (getHoveredBindable(scene.getNonDeleted(), pointer, element.id)?.id ?? null)
          : null;
      invalidateInteractive();
      return;
    }

    // Hover feedback, only when nothing is in progress.
    if (activePointerId === null) {
      if (state.activeTool === 'eraser') {
        // The eraser needs to show where it will bite.
        eraserCursor = at;
        invalidateInteractive();
      } else if (eraserCursor !== null) {
        eraserCursor = null;
        invalidateInteractive();
      }

      if (state.activeTool === 'selection' && !spaceHeld && !state.editingLinearElementId) {
        const box = getSelectionBox(getSelectedElements());
        const handle = box ? getHandleAtPosition(box, at, state.zoom) : null;
        if (handle) {
          container.style.cursor = handleCursor(handle, box!.angle);
        } else if (box && isPointInSelectionBox(box, at, state.zoom)) {
          // Signals that the whole box is draggable, not just the outline.
          container.style.cursor = 'move';
        } else {
          container.style.cursor = getElementAtPosition(scene.getNonDeleted(), at, state.zoom)
            ? 'move'
            : '';
        }
      }
      return;
    }
    if (activePointerId !== event.pointerId) return;

    switch (interaction.kind) {
      case 'panning': {
        setAppState({
          scrollX: state.scrollX + (event.clientX - interaction.lastX) / state.zoom,
          scrollY: state.scrollY + (event.clientY - interaction.lastY) / state.zoom,
        });
        interaction.lastX = event.clientX;
        interaction.lastY = event.clientY;
        invalidateStatic();
        return;
      }

      case 'selecting': {
        interaction.current = scenePoint(event);
        const marquee = marqueeBounds(interaction.origin, interaction.current);
        selectElements(
          expandSelectionToGroups(getElementsInBounds(scene.getNonDeleted(), marquee)),
        );
        invalidateInteractive();
        return;
      }

      case 'dragging': {
        const pointer = scenePoint(event);
        if (
          Math.hypot(pointer.x - interaction.origin.x, pointer.y - interaction.origin.y) *
            state.zoom >
          CLICK_THRESHOLD_PX
        ) {
          interaction.moved = true;
        }

        const selected = getSelectedElements();

        // Shift locks movement to whichever axis has travelled further.
        let target = pointer;
        if (event.shiftKey) {
          const totalX = Math.abs(pointer.x - interaction.origin.x);
          const totalY = Math.abs(pointer.y - interaction.origin.y);
          target =
            totalX > totalY
              ? { x: pointer.x, y: interaction.origin.y }
              : { x: interaction.origin.x, y: pointer.y };
        }

        for (const element of selected) {
          const offset = interaction.offsets.get(element.id);
          if (!offset) continue;
          let x = target.x + offset.x;
          let y = target.y + offset.y;
          if (state.gridSize) {
            x = snapToGrid(x, state.gridSize);
            y = snapToGrid(y, state.gridSize);
          }
          mutateElement(element, { x, y });
        }

        interaction.guides = [];
        if (state.objectsSnapModeEnabled && !state.gridSize && selected.length > 0) {
          // Only snap against what is on screen — thousands of offscreen
          // candidates is pure waste.
          const selectedIds = new Set(selected.map((element) => element.id));
          const canvasRect = rect();
          const visible = getVisibleSceneBounds(state, canvasRect.width, canvasRect.height);
          const candidates = getElementsInBounds(scene.getNonDeleted(), visible).filter(
            (element) => !selectedIds.has(element.id),
          );

          const snap = getObjectSnap(unionBounds(selected), candidates, state.zoom);
          interaction.guides = snap.guides;
          if (snap.dx !== 0 || snap.dy !== 0) {
            for (const element of selected) {
              mutateElement(element, { x: element.x + snap.dx, y: element.y + snap.dy });
            }
          }
        }

        invalidateStatic();
        invalidateInteractive();
        return;
      }

      case 'resizing': {
        const next = resizeBox(interaction.startBox, interaction.handle, scenePoint(event), {
          preserveAspect: event.shiftKey,
          fromCenter: event.ctrlKey || event.metaKey,
        });
        applyResize(interaction.startBox, next, interaction.snapshots);
        invalidateStatic();
        invalidateInteractive();
        return;
      }

      case 'rotating': {
        const pointer = scenePoint(event);
        const { center, grabAngle, snapshots } = interaction;
        let delta = Math.atan2(pointer.y - center.y, pointer.x - center.x) - grabAngle;
        if (event.shiftKey) delta = Math.round(delta / ROTATE_SNAP_RADIANS) * ROTATE_SNAP_RADIANS;
        applyRotation(center, delta, snapshots);
        invalidateStatic();
        invalidateInteractive();
        return;
      }

      case 'drawing': {
        let pointer = scenePoint(event);
        if (state.gridSize) {
          pointer = {
            x: snapToGrid(pointer.x, state.gridSize),
            y: snapToGrid(pointer.y, state.gridSize),
          };
        }
        if (
          Math.hypot(pointer.x - interaction.origin.x, pointer.y - interaction.origin.y) *
            state.zoom >
          CLICK_THRESHOLD_PX
        ) {
          interaction.moved = true;
        }
        updateDrawnGeometry(
          interaction.element,
          interaction.origin,
          pointer,
          event.shiftKey,
          event.altKey,
        );
        // Only the interactive layer is dirty — the committed scene is untouched.
        invalidateInteractive();
        return;
      }

      case 'drawingLinear': {
        let pointer = scenePoint(event);
        if (event.shiftKey) pointer = constrainAngle(interaction.origin, pointer);
        if (state.gridSize) {
          pointer = {
            x: snapToGrid(pointer.x, state.gridSize),
            y: snapToGrid(pointer.y, state.gridSize),
          };
        }
        if (
          Math.hypot(pointer.x - interaction.origin.x, pointer.y - interaction.origin.y) *
            state.zoom >
          CLICK_THRESHOLD_PX
        ) {
          interaction.moved = true;
        }

        setAbsolutePoints(interaction.element, [interaction.origin, pointer]);
        interaction.hoveredBindableId =
          interaction.element.type === 'arrow'
            ? (getHoveredBindable(scene.getNonDeleted(), pointer, interaction.element.id)?.id ??
              null)
            : null;
        invalidateInteractive();
        return;
      }

      case 'editingPoint': {
        const { element, pointIndex } = interaction;
        const center = getElementCenter(element);
        // Points are stored unrotated, so bring the pointer into that frame.
        const pointer = rotatePoint(scenePoint(event), center, -element.angle);

        const absolute = getAbsolutePoints(element);
        absolute[pointIndex] = pointer;
        setAbsolutePoints(element, absolute);

        const isEndpoint = pointIndex === 0 || pointIndex === absolute.length - 1;
        interaction.hoveredBindableId =
          isEndpoint && element.type === 'arrow'
            ? (getHoveredBindable(scene.getNonDeleted(), pointer, element.id)?.id ?? null)
            : null;

        invalidateStatic();
        invalidateInteractive();
        return;
      }

      case 'idle':
        return;
    }
  };

  // ----------------------------------------------------------- pointer up

  const onPointerUp = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    container.releasePointerCapture(event.pointerId);

    switch (interaction.kind) {
      case 'panning':
        container.style.cursor = spaceHeld ? 'grab' : '';
        break;

      case 'selecting':
        break;

      case 'dragging':
        // One undo step per gesture, not one per pointermove.
        if (interaction.moved) record();
        break;

      case 'resizing':
      case 'rotating':
        record();
        break;

      case 'editingPoint': {
        const { element, pointIndex } = interaction;
        const points = getAbsolutePoints(element);
        const which = pointIndex === 0 ? 'start' : pointIndex === points.length - 1 ? 'end' : null;

        // Dragging an endpoint re-decides its binding.
        if (which && element.type === 'arrow') {
          const target = getHoveredBindable(scene.getNonDeleted(), points[pointIndex], element.id);
          const otherBinding = which === 'start' ? element.endBinding : element.startBinding;
          if (target && target.id !== otherBinding?.elementId) bindArrow(element, target, which);
          else unbindArrow(element, which);
        }
        record();
        break;
      }

      case 'drawing': {
        const { element, origin, moved } = interaction;
        // A click without a drag places a default-sized shape.
        if (!moved) {
          mutateElement(element, {
            x: origin.x - DEFAULT_SHAPE_SIZE / 2,
            y: origin.y - DEFAULT_SHAPE_SIZE / 2,
            width: DEFAULT_SHAPE_SIZE,
            height: DEFAULT_SHAPE_SIZE,
          });
        }
        scene.add(element);
        if (!getAppState().toolLocked) {
          setAppState({ activeTool: 'selection', selectedElementIds: { [element.id]: true } });
        }
        invalidateStatic();
        record();
        break;
      }

      case 'drawingLinear': {
        const { element, moved, startBindable } = interaction;
        if (moved) {
          // A press-drag-release is a finished two-point element.
          const points = getAbsolutePoints(element);
          interaction = { kind: 'idle' };
          commitLinear(element, startBindable, points[points.length - 1]);
          return;
        }
        // A click without a drag opens the click-click-click polyline mode.
        interaction = {
          kind: 'multiPoint',
          element,
          startBindable,
          hoveredBindableId: startBindable?.id ?? null,
        };
        invalidateInteractive();
        return;
      }

      case 'freedrawing': {
        const { element } = interaction;
        // A stroke needs at least two samples to have any extent at all.
        if (element.points.length < 2) {
          interaction = { kind: 'idle' };
          invalidateInteractive();
          return;
        }
        scene.add(element);
        if (!getAppState().toolLocked) setAppState({ activeTool: 'selection' });
        invalidateStatic();
        record();
        break;
      }

      case 'erasing': {
        const { pending } = interaction;
        if (pending.size > 0) {
          const erased = scene.getNonDeleted().filter((element) => pending.has(element.id));
          for (const element of erased) mutateElement(element, { isDeleted: true });
          onElementsDeleted(erased);
          scene.emit();
          invalidateStatic();
          // One history entry for the whole sweep, not one per element.
          record();
        }
        break;
      }

      case 'laser':
        // The trail is ephemeral; it fades on its own and is never committed.
        break;

      case 'multiPoint':
      case 'idle':
        return;
    }

    interaction = { kind: 'idle' };
    invalidateInteractive();
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    if (interaction.kind !== 'multiPoint') interaction = { kind: 'idle' };
    container.style.cursor = '';
    invalidateInteractive();
  };

  const onDoubleClick = (event: MouseEvent) => {
    const state = getAppState();

    if (interaction.kind === 'multiPoint') {
      finishMultiPoint();
      return;
    }
    if (state.activeTool !== 'selection') return;

    const pointer = scenePoint(event);
    const hit = getElementAtPosition(scene.getNonDeleted(), pointer, state.zoom);
    if (!hit) {
      // Double-clicking empty canvas is the fastest way to drop a text note.
      startTextEditing(pointer);
      return;
    }

    // A linear element opens its point editor; anything grouped drills in.
    if (isLinearElement(hit)) {
      setAppState({
        editingLinearElementId: hit.id,
        selectedElementIds: { [hit.id]: true },
      });
      invalidateInteractive();
      return;
    }
    if (isTextElement(hit)) {
      setAppState({ editingTextElementId: hit.id });
      invalidateInteractive();
      return;
    }
    // Double-clicking a shape writes a label inside it.
    if (isContainerElement(hit)) {
      editContainerLabel(hit);
      return;
    }
    if (hit.groupIds.length === 0) return;

    setAppState({
      editingGroupId: selectableGroupId(hit, state.editingGroupId),
      selectedElementIds: { [hit.id]: true },
    });
    invalidateInteractive();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Space' && !spaceHeld) {
      spaceHeld = true;
      if (interaction.kind === 'idle') container.style.cursor = 'grab';
    }

    if (interaction.kind === 'multiPoint') {
      if (event.key === 'Enter') {
        event.preventDefault();
        finishMultiPoint();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finishMultiPoint(true);
      }
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
      spaceHeld = false;
      if (interaction.kind === 'idle') container.style.cursor = '';
    }
  };

  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('dblclick', onDoubleClick);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerCancel);
    container.removeEventListener('dblclick', onDoubleClick);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}

// -------------------------------------------------------------- transforms

export const marqueeBounds = (a: ScenePoint, b: ScenePoint): Bounds => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
});

function applyResize(
  startBox: TransformBox,
  nextBox: TransformBox,
  snapshots: ElementSnapshot[],
): void {
  const scaleX = startBox.width === 0 ? 1 : nextBox.width / startBox.width;
  const scaleY = startBox.height === 0 ? 1 : nextBox.height / startBox.height;

  // Single element: the box IS the element, so take the result verbatim. This
  // is the path that keeps the opposite corner of a rotated shape pinned.
  if (snapshots.length === 1) {
    const snapshot = snapshots[0];
    const element = scene.getById(snapshot.id);
    if (!element) return;

    if (isLinearElement(element) && snapshot.points) {
      // A linear element resizes by scaling its points; x,y then has to be
      // rebased so the (possibly negative) extent lands on the new box.
      const points = scalePoints(snapshot.points, scaleX, scaleY);
      const minX = Math.min(...points.map(([x]) => x));
      const minY = Math.min(...points.map(([, y]) => y));
      mutateElement(element, {
        points,
        x: nextBox.x - minX,
        y: nextBox.y - minY,
        width: nextBox.width,
        height: nextBox.height,
      });
      return;
    }

    mutateElement(element, {
      x: nextBox.x,
      y: nextBox.y,
      width: nextBox.width,
      height: nextBox.height,
    });
    return;
  }

  // Multi-selection: the box is unrotated, so each element scales affinely
  // from its snapshot — always from the snapshot, never from its live value,
  // or the error compounds every frame.
  for (const snapshot of snapshots) {
    const element = scene.getById(snapshot.id);
    if (!element) continue;

    const scaled = scaleElementIntoBox(snapshot, startBox, nextBox);
    if (isLinearElement(element) && snapshot.points) {
      mutateElement(element, {
        points: scalePoints(snapshot.points, scaleX, scaleY),
        x: scaled.x,
        y: scaled.y,
        width: scaled.width,
        height: scaled.height,
      });
      continue;
    }
    mutateElement(element, {
      x: scaled.x,
      y: scaled.y,
      width: scaled.width,
      height: scaled.height,
    });
  }
}

function applyRotation(
  center: ScenePoint,
  delta: number,
  snapshots: ElementSnapshot[],
): void {
  for (const snapshot of snapshots) {
    const element = scene.getById(snapshot.id);
    if (!element) continue;

    if (snapshots.length === 1) {
      mutateElement(element, { angle: snapshot.angle + delta });
      continue;
    }

    // A multi-selection rotates each element about its own centre AND orbits
    // that centre about the selection centre.
    const snapshotCenter = getBoxCenter(snapshot);
    const orbited = rotatePoint(snapshotCenter, center, delta);
    mutateElement(element, {
      angle: snapshot.angle + delta,
      x: element.x + (orbited.x - snapshotCenter.x),
      y: element.y + (orbited.y - snapshotCenter.y),
    });
  }
}
