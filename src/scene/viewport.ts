import { getAppState, setAppState, ZOOM_MAX, ZOOM_MIN } from '../state/store';
import { viewportToScene } from '../utils/coords';
import { clamp } from '../utils/math';
import { invalidateStatic } from './render';

/**
 * Zoom while keeping the scene point under the cursor pinned to the cursor:
 * measure that point before and after the zoom change, then correct scroll by
 * the difference.
 */
export function zoomAtViewportPoint(
  clientX: number,
  clientY: number,
  nextZoom: number,
  rect: DOMRect,
): void {
  const state = getAppState();
  const before = viewportToScene(clientX, clientY, state, rect);
  const zoom = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
  const after = viewportToScene(clientX, clientY, { ...state, zoom }, rect);

  setAppState({
    zoom,
    scrollX: state.scrollX + (after.x - before.x),
    scrollY: state.scrollY + (after.y - before.y),
  });
  invalidateStatic();
}

export function zoomAtViewportCenter(nextZoom: number, container: HTMLElement): void {
  const rect = container.getBoundingClientRect();
  zoomAtViewportPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, nextZoom, rect);
}

export function resetZoom(container: HTMLElement): void {
  zoomAtViewportCenter(1, container);
}
