import { invalidateFreedrawCache } from '../scene/freedraw';
import { invalidateShapeCache } from '../scene/roughCache';
import { updateBoundElements } from './binding';
import { updateBoundText } from './container';
import { randomInteger } from './factory';
import type { BaseElement, ExcaliElement } from './types';

/**
 * The only sanctioned way to write to an element. Elements are mutated in place
 * — allocating a fresh object per pointermove would thrash the GC once freedraw
 * lands. Everything downstream keys off `version`, so bypassing this function
 * leaves stale geometry in the shape cache.
 *
 * NOTE: this module and ./binding import each other. That is safe because both
 * sides are hoisted function declarations called at runtime, never at module
 * evaluation — but keep it that way.
 */
export function mutateElement<T extends BaseElement>(element: T, updates: Partial<T>): T {
  Object.assign(element, updates);
  element.version++;
  element.versionNonce = randomInteger();
  element.updated = Date.now();
  invalidateShapeCache(element);
  invalidateFreedrawCache(element);

  // Moving or resizing a shape drags its bound arrows and label along with it.
  updateBoundElements(element as unknown as ExcaliElement);
  updateBoundText(element as unknown as ExcaliElement);
  return element;
}
