import { getElementBounds } from '../element/bounds';
import { scene } from '../scene/Scene';
import { invalidateInteractive } from './render';

/**
 * A temporary ring around elements search has surfaced.
 *
 * Ephemeral, exactly like the laser trail: it lives only on the interactive
 * layer, never touches the scene, never enters history and never exports. It
 * keeps the RAF loop alive while it pulses and then lets it sleep again.
 */
const FLASH_MS = 2000;
const FOCUS_COLOR = '#1971c2';
const MATCH_COLOR = '#f08c00';

interface Highlight {
  /** Where the flash started; drives the fade. */
  since: number;
  /** The one the user picked, drawn stronger than the rest. */
  focused: boolean;
}

const highlights = new Map<string, Highlight>();

/**
 * @param ids every match, drawn faintly
 * @param focusId the current result, drawn strongly
 */
export function flashElements(ids: readonly string[], focusId: string | null): void {
  const now = performance.now();
  highlights.clear();
  for (const id of ids) highlights.set(id, { since: now, focused: id === focusId });
  invalidateInteractive();
}

export function clearHighlights(): void {
  if (highlights.size === 0) return;
  highlights.clear();
  invalidateInteractive();
}

/** Keeps the RAF loop running while anything is still pulsing. */
export const hasHighlights = (): boolean => highlights.size > 0;

export function drawHighlights(ctx: CanvasRenderingContext2D, now: number, zoom: number): void {
  if (highlights.size === 0) return;

  for (const [id, highlight] of highlights) {
    const age = (now - highlight.since) / FLASH_MS;
    if (age >= 1) {
      highlights.delete(id);
      continue;
    }

    const element = scene.getById(id);
    if (!element || element.isDeleted) {
      highlights.delete(id);
      continue;
    }

    const bounds = getElementBounds(element);
    // Hold full strength for the first half, then fade out — a flash that
    // starts fading immediately is easy to miss.
    const life = age < 0.5 ? 1 : 1 - (age - 0.5) / 0.5;
    // A slow pulse draws the eye without being a strobe.
    const pulse = highlight.focused ? 0.75 + 0.25 * Math.sin(age * Math.PI * 6) : 1;
    const padding = 6 / zoom;

    ctx.save();
    ctx.globalAlpha = life * (highlight.focused ? pulse : 0.45);
    ctx.strokeStyle = highlight.focused ? FOCUS_COLOR : MATCH_COLOR;
    ctx.lineWidth = (highlight.focused ? 2.5 : 1.5) / zoom;
    ctx.setLineDash(highlight.focused ? [] : [5 / zoom, 4 / zoom]);

    const x = bounds.minX - padding;
    const y = bounds.minY - padding;
    const width = bounds.maxX - bounds.minX + padding * 2;
    const height = bounds.maxY - bounds.minY + padding * 2;

    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4 / zoom);
    ctx.stroke();

    if (highlight.focused) {
      ctx.globalAlpha = life * 0.08;
      ctx.fillStyle = FOCUS_COLOR;
      ctx.fill();
    }
    ctx.restore();
  }
}
