import { getElementBounds } from '../element/bounds';
import type { ExcaliElement } from '../element/types';
import { getAppState, setAppState, ZOOM_MAX, ZOOM_MIN } from '../state/store';
import { clamp } from '../utils/math';
import { invalidateStatic } from './render';

/**
 * Animated pan/zoom, driven by its own rAF rather than the render loop's.
 *
 * The render loop only wakes when something is dirty; an animation needs a
 * frame every frame regardless. Keeping it separate means the loop's
 * dirty-flag contract stays intact — this just mutates viewport state and
 * invalidates, exactly like a pan gesture would.
 */
const DURATION_MS = 420;
/** Never zoom further in than this just to fill the viewport with one element. */
const MAX_AUTO_ZOOM = 2;
/** Fraction of the viewport the target should occupy. */
const FIT_PADDING = 0.35;

let rafId = 0;

/** Ease-out cubic: fast start, gentle settle. Reads as "the canvas moved for me". */
const ease = (t: number): number => 1 - Math.pow(1 - t, 3);

export function cancelViewportAnimation(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

interface Target {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

function animateTo(target: Target): void {
  cancelViewportAnimation();

  const start = getAppState();
  const from: Target = { scrollX: start.scrollX, scrollY: start.scrollY, zoom: start.zoom };
  const startedAt = performance.now();

  // Nothing to do — don't burn frames easing zero distance.
  if (
    Math.abs(from.scrollX - target.scrollX) < 0.5 &&
    Math.abs(from.scrollY - target.scrollY) < 0.5 &&
    Math.abs(from.zoom - target.zoom) < 0.001
  ) {
    return;
  }

  const step = (now: number) => {
    const t = Math.min(1, (now - startedAt) / DURATION_MS);
    const k = ease(t);

    setAppState({
      // Zoom is geometric, so interpolate it in log space — a linear lerp
      // between 0.2 and 4 spends most of the animation near the high end and
      // feels like it lurches.
      zoom: from.zoom * Math.pow(target.zoom / from.zoom, k),
      scrollX: from.scrollX + (target.scrollX - from.scrollX) * k,
      scrollY: from.scrollY + (target.scrollY - from.scrollY) * k,
    });
    invalidateStatic();

    rafId = t < 1 ? requestAnimationFrame(step) : 0;
  };

  rafId = requestAnimationFrame(step);
}

/** Centre an element in the viewport, zooming to a comfortable size for it. */
export function zoomToElement(element: ExcaliElement, viewport: { width: number; height: number }): void {
  const bounds = getElementBounds(element);
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);

  const fit = Math.min(
    (viewport.width * (1 - FIT_PADDING)) / width,
    (viewport.height * (1 - FIT_PADDING)) / height,
  );
  const state = getAppState();
  // Only ever zoom OUT to reveal something. Yanking the zoom in on every result
  // is disorienting when you are stepping through matches.
  const zoom = clamp(Math.min(fit, MAX_AUTO_ZOOM, Math.max(state.zoom, fit)), ZOOM_MIN, ZOOM_MAX);

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  animateTo({
    zoom,
    scrollX: viewport.width / 2 / zoom - centerX,
    scrollY: viewport.height / 2 / zoom - centerY,
  });
}
