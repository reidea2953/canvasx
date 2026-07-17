import rough from 'roughjs';
import type { Drawable } from 'roughjs/bin/core';
import type { BaseElement, ExcaliElement } from '../element/types';
import { generateShape } from './shapes';

/**
 * Rough.js splits into generate (compute hundreds of jittered points) and draw
 * (stroke them). Generation costs roughly 100x the draw, so it must happen once
 * per element version rather than once per frame — this cache is the difference
 * between 60fps and a slideshow at a few hundred elements.
 *
 * WeakMap keyed by the element object: dropped elements evict themselves.
 */
const cache = new WeakMap<BaseElement, { version: number; drawables: Drawable[] }>();

const generator = rough.generator();

/** A list because a linear element is a shaft plus up to two arrowheads. */
export function getShape(element: ExcaliElement): Drawable[] {
  const hit = cache.get(element);
  if (hit && hit.version === element.version) return hit.drawables;

  const drawables = generateShape(element, generator);
  cache.set(element, { version: element.version, drawables });
  return drawables;
}

export const invalidateShapeCache = (element: BaseElement): void => {
  cache.delete(element);
};
