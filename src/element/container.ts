import { scene } from '../scene/Scene';
import { mutateElement } from './mutate';
import { BOUND_TEXT_PADDING, measureText } from './text';
import {
  isTextElement,
  type ExcaliElement,
  type ShapeElement,
  type TextElement,
} from './types';

/** The label living inside a container, if it has one. */
export function getBoundTextElement(container: ExcaliElement): TextElement | null {
  const refs = container.boundElements;
  if (!refs) return null;

  for (const ref of refs) {
    if (ref.type !== 'text') continue;
    const element = scene.getById(ref.id);
    if (element && !element.isDeleted && isTextElement(element)) return element;
  }
  return null;
}

export function getContainerOf(text: TextElement): ShapeElement | null {
  if (!text.containerId) return null;
  const container = scene.getById(text.containerId);
  if (!container || container.isDeleted) return null;
  return container.type === 'rectangle' || container.type === 'diamond' || container.type === 'ellipse'
    ? container
    : null;
}

/**
 * A diamond's usable interior is roughly half its box, and an ellipse's is the
 * inscribed rectangle. Wrapping a label to the full bounding box would push
 * text outside the visible shape.
 */
function usableWidth(container: ShapeElement): number {
  const inner = container.width - BOUND_TEXT_PADDING * 2;
  switch (container.type) {
    case 'diamond':
      return inner * 0.5;
    case 'ellipse':
      return inner / Math.SQRT2;
    default:
      return inner;
  }
}

function minimumHeightFor(container: ShapeElement, textHeight: number): number {
  const needed = textHeight + BOUND_TEXT_PADDING * 2;
  switch (container.type) {
    case 'diamond':
      return needed * 2;
    case 'ellipse':
      return needed * Math.SQRT2;
    default:
      return needed;
  }
}

/**
 * Re-wrap a label to its container, recentre it, and grow the container if the
 * text no longer fits. The container never shrinks below what the user set.
 */
export function redrawBoundText(text: TextElement, container: ShapeElement): void {
  const maxWidth = Math.max(usableWidth(container), text.fontSize);
  const metrics = measureText(text.text, text.fontSize, text.fontFamily, text.lineHeight, maxWidth);

  const requiredHeight = minimumHeightFor(container, metrics.height);
  if (requiredHeight > container.height) {
    // Grow about the centre so the shape does not appear to crawl downward.
    mutateElement(container, {
      y: container.y - (requiredHeight - container.height) / 2,
      height: requiredHeight,
    });
  }

  mutateElement(text, {
    width: maxWidth,
    height: metrics.height,
    x: container.x + container.width / 2 - maxWidth / 2,
    y: container.y + container.height / 2 - metrics.height / 2,
    angle: container.angle,
  });
}

/**
 * Reentrancy guard. redrawBoundText mutates the container when the text
 * outgrows it, and that mutation re-enters here — an unguarded round trip
 * would recurse until the stack blew.
 */
let updating = false;

/** Keep a label glued to its container after the container moves or resizes. */
export function updateBoundText(container: ExcaliElement): void {
  if (updating) return;
  if (container.type !== 'rectangle' && container.type !== 'diamond' && container.type !== 'ellipse') {
    return;
  }
  const text = getBoundTextElement(container);
  if (!text) return;

  updating = true;
  try {
    redrawBoundText(text, container);
  } finally {
    updating = false;
  }
}

export function attachTextToContainer(text: TextElement, container: ShapeElement): void {
  const refs = container.boundElements ?? [];
  if (!refs.some((ref) => ref.id === text.id)) {
    mutateElement(container, { boundElements: [...refs, { id: text.id, type: 'text' }] });
  }
  redrawBoundText(text, container);
}
