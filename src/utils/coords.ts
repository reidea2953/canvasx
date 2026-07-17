import type { AppState } from '../state/store';
import type { Bounds } from './math';

/**
 * Two coordinate spaces exist and must never be confused:
 *   scene    — where elements live; infinite, zoom-independent
 *   viewport — CSS pixels inside the canvas element; what pointer events report
 * Every function here names its inputs for the space they belong to.
 */

export interface ScenePoint {
  x: number;
  y: number;
}

export const sceneToViewport = (
  sceneX: number,
  sceneY: number,
  state: AppState,
): ScenePoint => ({
  x: (sceneX + state.scrollX) * state.zoom,
  y: (sceneY + state.scrollY) * state.zoom,
});

export const viewportToScene = (
  clientX: number,
  clientY: number,
  state: AppState,
  rect: DOMRect,
): ScenePoint => ({
  x: (clientX - rect.left) / state.zoom - state.scrollX,
  y: (clientY - rect.top) / state.zoom - state.scrollY,
});

/**
 * The scene rectangle currently on screen, given the canvas size in CSS pixels.
 * Used to cull elements before drawing them.
 */
export const getVisibleSceneBounds = (
  state: AppState,
  cssWidth: number,
  cssHeight: number,
  padding = 0,
): Bounds => ({
  minX: -state.scrollX - padding,
  minY: -state.scrollY - padding,
  maxX: cssWidth / state.zoom - state.scrollX + padding,
  maxY: cssHeight / state.zoom - state.scrollY + padding,
});
