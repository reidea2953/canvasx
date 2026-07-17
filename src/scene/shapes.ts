import type { Drawable, Options } from 'roughjs/bin/core';
import type { RoughGenerator } from 'roughjs/bin/generator';
import {
  isFreedrawElement,
  isImageElement,
  isLinearElement,
  isTextElement,
  type Arrowhead,
  type ExcaliElement,
  type LinearElement,
  type LinearPoint,
  type ShapeElement,
} from '../element/types';

export function roughOptions(element: ExcaliElement): Options {
  return {
    seed: element.seed,
    stroke: element.strokeColor,
    strokeWidth: element.strokeWidth,
    roughness: element.roughness,
    fill: element.backgroundColor === 'transparent' ? undefined : element.backgroundColor,
    fillStyle: element.fillStyle,
    fillWeight: element.strokeWidth / 2,
    hachureGap: element.strokeWidth * 4,
    // Dashed/dotted strokes drawn twice read as muddy rather than sketchy.
    disableMultiStroke: element.strokeStyle !== 'solid',
    strokeLineDash:
      element.strokeStyle === 'dashed'
        ? [8, 8]
        : element.strokeStyle === 'dotted'
          ? [1.5, 6]
          : undefined,
    preserveVertices: element.roughness === 0,
  };
}

/** Arrowheads are solid and un-dashed even when the shaft is dashed. */
const arrowheadOptions = (element: LinearElement): Options => ({
  ...roughOptions(element),
  strokeLineDash: undefined,
  disableMultiStroke: true,
});

const ARROWHEAD_MAX_LENGTH = 30;
const ARROWHEAD_SPREAD = (20 * Math.PI) / 180;

/**
 * Arrowheads are built by hand rather than by Rough's own primitives, so they
 * inherit the same seed and roughness as the shaft and read as one drawing.
 * The direction comes from the final segment, which is a good enough tangent
 * even when the shaft is rendered as a curve.
 */
function arrowheadDrawables(
  element: LinearElement,
  which: 'start' | 'end',
  generator: RoughGenerator,
): Drawable[] {
  const head: Arrowhead | null = which === 'start' ? element.startArrowhead : element.endArrowhead;
  if (!head) return [];

  const points = element.points;
  if (points.length < 2) return [];

  const tip: LinearPoint = which === 'start' ? points[0] : points[points.length - 1];
  const prior: LinearPoint = which === 'start' ? points[1] : points[points.length - 2];

  const dx = tip[0] - prior[0];
  const dy = tip[1] - prior[1];
  const segment = Math.hypot(dx, dy);
  if (segment < 1e-6) return [];

  const angle = Math.atan2(dy, dx);
  const size = Math.min(ARROWHEAD_MAX_LENGTH, segment / 2);
  const options = arrowheadOptions(element);

  switch (head) {
    case 'arrow': {
      const barb = (spread: number): Drawable =>
        generator.line(
          tip[0] - size * Math.cos(angle + spread),
          tip[1] - size * Math.sin(angle + spread),
          tip[0],
          tip[1],
          options,
        );
      return [barb(ARROWHEAD_SPREAD), barb(-ARROWHEAD_SPREAD)];
    }

    case 'triangle': {
      const corner = (spread: number): LinearPoint => [
        tip[0] - size * Math.cos(angle + spread),
        tip[1] - size * Math.sin(angle + spread),
      ];
      return [
        generator.polygon([tip, corner(ARROWHEAD_SPREAD), corner(-ARROWHEAD_SPREAD)], {
          ...options,
          fill: element.strokeColor,
          fillStyle: 'solid',
        }),
      ];
    }

    case 'bar': {
      const half = size / 2;
      const perpendicular = angle + Math.PI / 2;
      return [
        generator.line(
          tip[0] - half * Math.cos(perpendicular),
          tip[1] - half * Math.sin(perpendicular),
          tip[0] + half * Math.cos(perpendicular),
          tip[1] + half * Math.sin(perpendicular),
          options,
        ),
      ];
    }

    case 'dot':
      return [
        generator.circle(tip[0], tip[1], Math.max(size / 2, element.strokeWidth * 2), {
          ...options,
          fill: element.strokeColor,
          fillStyle: 'solid',
        }),
      ];
  }
}

function generateLinear(element: LinearElement, generator: RoughGenerator): Drawable[] {
  const points = element.points;
  const options = roughOptions(element);
  const drawables: Drawable[] = [];

  if (points.length === 2) {
    drawables.push(
      generator.line(points[0][0], points[0][1], points[1][0], points[1][1], options),
    );
  } else if (points.length > 2) {
    // Rough's curve is a smooth spline through the points, which is what gives
    // multi-point arrows their hand-drawn sweep.
    drawables.push(generator.curve(points as [number, number][], options));
  }

  drawables.push(...arrowheadDrawables(element, 'start', generator));
  drawables.push(...arrowheadDrawables(element, 'end', generator));
  return drawables;
}

function generateSimpleShape(element: ShapeElement, generator: RoughGenerator): Drawable {
  const options = roughOptions(element);
  const { width: w, height: h } = element;

  switch (element.type) {
    case 'rectangle':
      return generator.rectangle(0, 0, w, h, options);
    case 'ellipse':
      return generator.ellipse(w / 2, h / 2, w, h, options);
    case 'diamond':
      return generator.polygon(
        [
          [w / 2, 0],
          [w, h / 2],
          [w / 2, h],
          [0, h / 2],
        ],
        options,
      );
  }
}

/**
 * Geometry is generated in the element's own local frame, never at its scene
 * position. That is what lets a move reuse the cached drawable and apply the
 * offset with a canvas transform instead of regenerating.
 */
export function generateShape(element: ExcaliElement, generator: RoughGenerator): Drawable[] {
  if (isLinearElement(element)) return generateLinear(element, generator);
  // These three never touch rough: freedraw fills a perfect-freehand outline as
  // a Path2D, text goes to fillText, images to drawImage. The renderer handles
  // each directly and never asks for a Drawable.
  if (isFreedrawElement(element) || isTextElement(element) || isImageElement(element)) return [];
  return [generateSimpleShape(element, generator)];
}
