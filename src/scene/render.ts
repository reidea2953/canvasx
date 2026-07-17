import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import { getAbsolutePoints, getElementBounds, getElementCenter, getUnrotatedBounds } from '../element/bounds';
import type { TransformBox } from '../element/resize';
import { baselineOffset, fontString, textWrapWidth, wrapText } from '../element/text';
import {
  hasPoints,
  isCustomElement,
  isFreedrawElement,
  isImageElement,
  isLinearElement,
  isTextElement,
  type CustomElement,
  type ExcaliElement,
  type ImageElement,
  type TextElement,
} from '../element/types';
import { getPluginFor } from '../plugins/registry';
import { drawRemoteCursors, remoteCursorsAnimating } from '../collab/presence';
import { getBitmap } from './files';
import { getFreedrawPath } from './freedraw';
import { drawHighlights, hasHighlights } from './highlight';
import { drawLaser, laserHasTrail } from './laser';
import { getAppState } from '../state/store';
import { getVisibleSceneBounds } from '../utils/coords';
import { rotatePoint } from '../utils/geometry';
import { boundsIntersect, type Bounds } from '../utils/math';
import { getSelectedElements } from './actions';
import {
  ERASER_RADIUS_PX,
  getEraserCursor,
  getInteraction,
  getPendingErase,
  marqueeBounds,
} from './interaction';
import { getShape } from './roughCache';
import { scene } from './Scene';
import {
  boxCenter,
  getHandlePositions,
  getSelectionBox,
  handleSize,
  RESIZE_HANDLES,
} from './selection';
import type { SnapGuide } from './snapping';

export interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rc: RoughCanvas;
}

export interface FrameStats {
  fps: number;
  staticMs: number;
  interactiveMs: number;
  visible: number;
  total: number;
}

let staticLayer: Layer | null = null;
let interactiveLayer: Layer | null = null;

let staticDirty = true;
let interactiveDirty = true;
let rafId = 0;

/**
 * Dev guard for the "nothing draws outside the RAF" rule. Any render reached
 * from a pointer handler instead of frame() trips this immediately.
 */
let inFrame = false;

export const makeLayer = (canvas: HTMLCanvasElement): Layer => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx, rc: rough.canvas(canvas) };
};

export function setLayers(next: { static: Layer; interactive: Layer } | null): void {
  staticLayer = next?.static ?? null;
  interactiveLayer = next?.interactive ?? null;
  if (next) {
    staticDirty = true;
    interactiveDirty = true;
    schedule();
  }
}

export const invalidateStatic = (): void => {
  staticDirty = true;
  schedule();
};

export const invalidateInteractive = (): void => {
  interactiveDirty = true;
  schedule();
};

function schedule(): void {
  if (rafId) return;
  rafId = requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- stats

const frameTimes: number[] = [];
let lastStaticMs = 0;
let lastInteractiveMs = 0;
let lastVisible = 0;
let statsListener: ((stats: FrameStats) => void) | null = null;

export const onFrameStats = (listener: ((stats: FrameStats) => void) | null): void => {
  statsListener = listener;
};

// ---------------------------------------------------------------- the loop

function frame(now: number): void {
  rafId = 0;
  inFrame = true;

  if (staticDirty && staticLayer) {
    const start = performance.now();
    lastVisible = renderStatic(staticLayer);
    lastStaticMs = performance.now() - start;
    staticDirty = false;
  }

  if (interactiveDirty && interactiveLayer) {
    const start = performance.now();
    renderInteractive(interactiveLayer, now);
    lastInteractiveMs = performance.now() - start;
    interactiveDirty = false;
  }

  inFrame = false;

  // Keep the loop alive while anything is animating on its own clock, even
  // though nothing else is dirty — otherwise the laser tail freezes the moment
  // the pointer stops, and search flashes never fade.
  if (laserHasTrail() || hasHighlights() || remoteCursorsAnimating()) invalidateInteractive();

  frameTimes.push(now);
  while (frameTimes.length > 0 && now - frameTimes[0] > 1000) frameTimes.shift();

  statsListener?.({
    fps: frameTimes.length,
    staticMs: lastStaticMs,
    interactiveMs: lastInteractiveMs,
    visible: lastVisible,
    total: scene.count,
  });

}

// ---------------------------------------------------------------- drawing

function assertInFrame(): void {
  if (import.meta.env.DEV && !inFrame) {
    throw new Error('Render called outside the RAF loop — call invalidate*() instead.');
  }
}

/** Applies the shared scene transform. Returns the canvas size in CSS pixels. */
function applySceneTransform(layer: Layer): { cssWidth: number; cssHeight: number } {
  const state = getAppState();
  const dpr = window.devicePixelRatio || 1;
  layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
  layer.ctx.scale(dpr * state.zoom, dpr * state.zoom);
  layer.ctx.translate(state.scrollX, state.scrollY);
  return {
    cssWidth: layer.canvas.width / dpr,
    cssHeight: layer.canvas.height / dpr,
  };
}

/** Returns the number of elements that survived culling. */
function renderStatic(layer: Layer): number {
  assertInFrame();
  const state = getAppState();

  layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
  layer.ctx.fillStyle = state.viewBackgroundColor;
  layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);

  const { cssWidth, cssHeight } = applySceneTransform(layer);

  if (state.gridSize) {
    drawGrid(layer.ctx, state.gridSize, getVisibleSceneBounds(state, cssWidth, cssHeight), state.zoom);
  }

  // Padded so wide rough strokes near the edge do not pop in late.
  const cullBounds = getVisibleSceneBounds(state, cssWidth, cssHeight, 32);

  // Elements the eraser is hovering are drawn faded on the interactive layer
  // instead, so the erase reads as provisional until release.
  const pendingErase = getPendingErase();

  let visible = 0;
  for (const element of scene.getAll()) {
    if (element.isDeleted) continue;
    if (pendingErase?.has(element.id)) continue;
    // The textarea overlay is already painting this one. Drawing it here too
    // is what produced doubled, offset glyphs while typing.
    if (element.id === state.editingTextElementId) continue;
    if (!boundsIntersect(getElementBounds(element), cullBounds)) continue;
    drawElement(element, layer, { compensateInvert: state.theme === 'dark' });
    visible++;
  }
  return visible;
}

const SELECTION_COLOR = '#6965db';
const SNAP_COLOR = '#fa5252';
const BINDING_COLOR = '#4dabf7';
const LINEAR_POINT_RADIUS = 5;

/**
 * MUST stay byte-identical to the `filter` on `.canvas-stack[data-theme='dark']
 * .layer` in index.css.
 *
 * The two are applied one after the other and rely on cancelling exactly (see
 * drawImage). If they ever drift apart, photos in dark mode quietly go wrong
 * again — there is no error, just a bad-looking image.
 */
export const DARK_MODE_FILTER = 'invert(100%) hue-rotate(180deg)';

function renderInteractive(layer: Layer, now: number): void {
  assertInFrame();
  layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
  layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  applySceneTransform(layer);

  const state = getAppState();
  const interaction = getInteraction();
  // This layer carries the same CSS invert as the static one, so anything drawn
  // here needs the same compensation.
  const draw = { compensateInvert: state.theme === 'dark' };

  // Elements mid-gesture live here until release, so the static layer and its
  // thousands of cached drawables stay untouched during the gesture.
  if (interaction.kind === 'drawing' || interaction.kind === 'drawingLinear') {
    drawElement(interaction.element, layer, draw);
  }
  if (interaction.kind === 'freedrawing') {
    drawElement(interaction.element, layer, { ...draw, isInProgress: true });
  }

  // Provisional erases, faded, standing in for what renderStatic skipped.
  if (interaction.kind === 'erasing' && interaction.pending.size > 0) {
    layer.ctx.save();
    layer.ctx.globalAlpha = 0.2;
    for (const element of scene.getNonDeleted()) {
      if (interaction.pending.has(element.id)) drawElement(element, layer, draw);
    }
    layer.ctx.restore();
  }
  if (interaction.kind === 'multiPoint') {
    drawElement(interaction.element, layer, draw);
    drawLinearPointHandles(layer.ctx, interaction.element, state.zoom);
  }

  // Show which shape an arrow would bind to on release.
  const hoveredBindableId =
    interaction.kind === 'drawingLinear' || interaction.kind === 'multiPoint'
      ? interaction.hoveredBindableId
      : interaction.kind === 'editingPoint'
        ? interaction.hoveredBindableId
        : null;
  if (hoveredBindableId) {
    const target = scene.getById(hoveredBindableId);
    if (target) drawBindingHighlight(layer.ctx, target, state.zoom);
  }

  if (interaction.kind === 'selecting') {
    drawMarquee(layer.ctx, marqueeBounds(interaction.origin, interaction.current), state.zoom);
  }

  if (interaction.kind === 'dragging' && interaction.guides.length > 0) {
    drawSnapGuides(layer.ctx, interaction.guides, state.zoom);
  }

  const selected = getSelectedElements();
  const editingLinear =
    state.editingLinearElementId !== null
      ? scene.getById(state.editingLinearElementId)
      : null;

  // A live textarea already frames the text; a selection box and eight handles
  // on top of it just fight the caret for attention.
  const editingText = state.editingTextElementId !== null;

  // Point editing replaces the resize box entirely — two overlapping sets of
  // handles on the same element would be unusable.
  if (editingLinear && !editingLinear.isDeleted) {
    drawElementOutline(layer.ctx, editingLinear, state.zoom);
    drawLinearPointHandles(layer.ctx, editingLinear, state.zoom);
  } else if (
    !editingText &&
    selected.length > 0 &&
    interaction.kind !== 'drawing' &&
    interaction.kind !== 'drawingLinear'
  ) {
    // Individual outlines only help when they aren't just tracing the box.
    if (selected.length > 1) {
      for (const element of selected) drawElementOutline(layer.ctx, element, state.zoom);
    }

    const box = getSelectionBox(selected);
    if (box) {
      const showHandles =
        interaction.kind === 'idle' ||
        interaction.kind === 'resizing' ||
        interaction.kind === 'rotating';
      drawSelectionBox(layer.ctx, box, state.zoom, showHandles);
    }
  }

  drawEraserRing(layer.ctx, state.zoom);
  drawHighlights(layer.ctx, now, state.zoom);

  // Last, so the beam and remote cursors sit above everything else.
  drawLaser(layer.ctx, now, state.zoom);
  drawRemoteCursors(layer.ctx, now, state.zoom);
}

/**
 * The eraser is invisible without this — you cannot aim something you cannot
 * see. Drawn at exactly the radius the hit test uses, so what you see is what
 * you erase.
 */
function drawEraserRing(ctx: CanvasRenderingContext2D, zoom: number): void {
  const at = getEraserCursor();
  if (!at) return;

  const radius = ERASER_RADIUS_PX / zoom;
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(224, 49, 49, 0.10)';
  ctx.fill();
  ctx.strokeStyle = '#e03131';
  ctx.lineWidth = 1.5 / zoom;
  ctx.stroke();
  ctx.restore();
}

/** Line widths are divided by zoom so selection chrome stays a constant size on screen. */
function drawElementOutline(
  ctx: CanvasRenderingContext2D,
  element: ExcaliElement,
  zoom: number,
): void {
  const padding = 2 / zoom;
  const bounds = getUnrotatedBounds(element);
  const center = getElementCenter(element);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(element.angle);
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeRect(
    -width / 2 - padding,
    -height / 2 - padding,
    width + padding * 2,
    height + padding * 2,
  );
  ctx.restore();
}

/** Highlights the shape an arrow would bind to if released now. */
function drawBindingHighlight(
  ctx: CanvasRenderingContext2D,
  element: ExcaliElement,
  zoom: number,
): void {
  const bounds = getUnrotatedBounds(element);
  const center = getElementCenter(element);
  const padding = 4 / zoom;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(element.angle);
  ctx.strokeStyle = BINDING_COLOR;
  ctx.lineWidth = 2 / zoom;
  ctx.strokeRect(
    -(bounds.maxX - bounds.minX) / 2 - padding,
    -(bounds.maxY - bounds.minY) / 2 - padding,
    bounds.maxX - bounds.minX + padding * 2,
    bounds.maxY - bounds.minY + padding * 2,
  );
  ctx.restore();
}

/** Draggable handles for each point of a linear element being edited. */
function drawLinearPointHandles(
  ctx: CanvasRenderingContext2D,
  element: ExcaliElement,
  zoom: number,
): void {
  if (!isLinearElement(element)) return;
  const center = getElementCenter(element);
  const radius = LINEAR_POINT_RADIUS / zoom;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / zoom;

  for (const point of getAbsolutePoints(element)) {
    // Points are stored unrotated, so apply the element's rotation to place them.
    const at = rotatePoint(point, center, element.angle);
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  box: TransformBox,
  zoom: number,
  showHandles: boolean,
): void {
  const padding = 4 / zoom;
  const center = boxCenter(box);

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(box.angle);

  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(
    -box.width / 2 - padding,
    -box.height / 2 - padding,
    box.width + padding * 2,
    box.height + padding * 2,
  );
  ctx.restore();

  if (!showHandles) return;

  const positions = getHandlePositions(box, zoom);
  const size = handleSize(zoom);

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / zoom;

  // The stem connecting the rotation handle to the box.
  const topMid = getHandlePositions(box, zoom).n;
  ctx.beginPath();
  ctx.moveTo(topMid.x, topMid.y);
  ctx.lineTo(positions.rotate.x, positions.rotate.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(positions.rotate.x, positions.rotate.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  for (const name of RESIZE_HANDLES) {
    const handle = positions[name];
    ctx.save();
    // Square handles follow the box's rotation rather than staying upright.
    ctx.translate(handle.x, handle.y);
    ctx.rotate(box.angle);
    ctx.beginPath();
    ctx.rect(-size / 2, -size / 2, size, size);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawMarquee(ctx: CanvasRenderingContext2D, bounds: Bounds, zoom: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(105, 101, 219, 0.08)';
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / zoom;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  ctx.fillRect(bounds.minX, bounds.minY, width, height);
  ctx.strokeRect(bounds.minX, bounds.minY, width, height);
  ctx.restore();
}

function drawSnapGuides(
  ctx: CanvasRenderingContext2D,
  guides: SnapGuide[],
  zoom: number,
): void {
  ctx.save();
  ctx.strokeStyle = SNAP_COLOR;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.beginPath();
  for (const guide of guides) {
    ctx.moveTo(guide.from.x, guide.from.y);
    ctx.lineTo(guide.to.x, guide.to.y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw elements straight onto a layer, outside the RAF loop. Used by export so
 * that the exported image comes off exactly the same code path as the screen.
 */
export function renderElementsTo(layer: Layer, elements: readonly ExcaliElement[]): void {
  for (const element of elements) {
    if (element.isDeleted) continue;
    // No compensateInvert, deliberately and regardless of theme: an export
    // carries no CSS filter to cancel it, so compensating here would ship
    // genuinely inverted photos. Exports are always light.
    drawElement(element, layer);
  }
}

interface DrawOptions {
  /** The stroke has not finished tapering yet; only freedraw cares. */
  isInProgress?: boolean;
  /**
   * True when this canvas carries the dark-mode CSS invert. Screen layers do;
   * export layers never do. See drawImage.
   */
  compensateInvert?: boolean;
}

function drawElement(element: ExcaliElement, layer: Layer, options: DrawOptions = {}): void {
  // A zero-size shape has nothing to draw; a points-based element with real
  // points can still be zero-height (a horizontal line), so it is exempt.
  if (!hasPoints(element) && element.width === 0 && element.height === 0) return;

  const { ctx } = layer;
  ctx.save();
  ctx.globalAlpha = element.opacity / 100;

  // Rotate about the element's centre, then land local (0,0) on the element's
  // x,y — the frame its cached geometry was generated in. This holds for
  // shapes (generated at 0,0,w,h) and points-based elements alike.
  const center = getElementCenter(element);
  ctx.translate(center.x, center.y);
  ctx.rotate(element.angle);
  ctx.translate(element.x - center.x, element.y - center.y);

  if (isFreedrawElement(element)) {
    // The outline is a closed polygon: fill it, never stroke it.
    ctx.fillStyle = element.strokeColor;
    ctx.fill(getFreedrawPath(element, !options.isInProgress));
  } else if (isTextElement(element)) {
    drawText(element, ctx);
  } else if (isImageElement(element)) {
    drawImage(element, ctx, options.compensateInvert === true);
  } else if (isCustomElement(element)) {
    drawCustom(element, ctx, options.compensateInvert === true);
  } else {
    for (const drawable of getShape(element)) layer.rc.draw(drawable);
  }

  ctx.restore();
}

function drawImage(
  element: ImageElement,
  ctx: CanvasRenderingContext2D,
  compensateInvert: boolean,
): void {
  const bitmap = getBitmap(element.fileId);

  if (!bitmap) {
    // Placeholder while the bitmap decodes, so layout does not jump on arrival.
    // Deliberately NOT compensated: it is chrome, and should invert with the
    // theme like every other outline does.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
    ctx.fillRect(0, 0, element.width, element.height);
    ctx.strokeStyle = '#adb5bd';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0, 0, element.width, element.height);
    return;
  }

  /**
   * Dark mode inverts the whole canvas in CSS. That is right for line art —
   * dark strokes on white become light strokes on black — but a photograph has
   * no such symmetry and comes out a washed-out negative.
   *
   * So the photo is pre-inverted with the SAME filter, which the CSS one then
   * cancels, leaving it exactly as authored. That cancellation is exact, not a
   * fudge: with I(x) = 1-x and H the hue-rotate matrix, F(x) = H(1) - H(x), so
   * F(F(x)) = H(1) - H²(1) + H²(x). H² is hue-rotate(360°) = identity and
   * H(1) = 1 (rotation leaves white alone), so F(F(x)) = x.
   *
   * Only for canvases the CSS filter actually covers — never for export, which
   * has no filter and would end up with genuinely inverted photos.
   *
   * ctx.filter is part of the canvas state, so drawElement's save/restore
   * already resets it.
   */
  if (compensateInvert) ctx.filter = DARK_MODE_FILTER;

  // Negative scale flips about the centre; drawImage cannot take a negative size.
  const [scaleX, scaleY] = element.scale;
  ctx.translate(element.width / 2, element.height / 2);
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(bitmap, -element.width / 2, -element.height / 2, element.width, element.height);
}

/**
 * The whole of the core's knowledge about plugin elements: look up the owner and
 * hand it a context. Adding an element type does not touch this function.
 */
function drawCustom(
  element: CustomElement,
  ctx: CanvasRenderingContext2D,
  dark: boolean,
): void {
  const plugin = getPluginFor(element);

  if (!plugin) {
    // A file can outlive the plugin that wrote it. Draw a placeholder rather
    // than throwing or silently vanishing: the data is still there, and the
    // element still moves and deletes like anything else.
    ctx.save();
    ctx.strokeStyle = '#adb5bd';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, element.width, element.height);
    ctx.fillStyle = '#adb5bd';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`Unknown: ${element.pluginId}`, 6, 16);
    ctx.restore();
    return;
  }

  const state = getAppState();
  // 'own' means the element's colour IS the point (a sticky must stay yellow),
  // so the canvas-wide invert is cancelled for it exactly as it is for photos,
  // and the plugin picks its own palette from `dark` instead.
  const ownsDarkMode = plugin.darkMode === 'own';
  if (ownsDarkMode && dark) ctx.filter = DARK_MODE_FILTER;

  ctx.save();
  try {
    plugin.render(element as never, {
      ctx,
      zoom: state.zoom,
      // Always false under 'invert': the filter already handles the theme, and a
      // plugin reacting to it as well would invert twice.
      dark: ownsDarkMode && dark,
      isEditing: state.editingPluginElementId === element.id,
      editingPart:
        state.editingPluginElementId === element.id ? state.editingPluginPart : null,
    });
  } catch (error) {
    // One bad plugin must not take down the frame — every other element on the
    // canvas still has to draw.
    console.error(`Plugin "${element.pluginId}" failed to render`, error);
  } finally {
    ctx.restore();
  }
}

function drawText(element: TextElement, ctx: CanvasRenderingContext2D): void {
  ctx.font = fontString(element.fontSize, element.fontFamily);
  ctx.fillStyle = element.strokeColor;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = element.textAlign;

  // Where the anchor sits depends on the alignment ctx.textAlign expects.
  const anchorX =
    element.textAlign === 'center'
      ? element.width / 2
      : element.textAlign === 'right'
        ? element.width
        : 0;

  // One shared rule for where lines break — see textWrapWidth.
  const lines = wrapText(
    element.text,
    element.fontSize,
    element.fontFamily,
    textWrapWidth(element),
  );

  lines.forEach((line, index) => {
    ctx.fillText(line, anchorX, baselineOffset(element.fontSize, element.lineHeight, index));
  });
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  gridSize: number,
  bounds: Bounds,
  zoom: number,
): void {
  // Below this the grid is finer than the pixels available to draw it.
  if (gridSize * zoom < 4) return;

  const startX = Math.floor(bounds.minX / gridSize) * gridSize;
  const startY = Math.floor(bounds.minY / gridSize) * gridSize;

  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let x = startX; x <= bounds.maxX; x += gridSize) {
    ctx.moveTo(x, bounds.minY);
    ctx.lineTo(x, bounds.maxY);
  }
  for (let y = startY; y <= bounds.maxY; y += gridSize) {
    ctx.moveTo(bounds.minX, y);
    ctx.lineTo(bounds.maxX, y);
  }
  ctx.stroke();
  ctx.restore();
}
