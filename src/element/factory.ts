import { nanoid } from 'nanoid';
import { getAppState } from '../state/store';
import { DEFAULT_LINE_HEIGHT } from './text';
import type {
  ExcaliElement,
  FreedrawElement,
  ImageElement,
  LinearElement,
  LinearType,
  ShapeElement,
  ShapeType,
  TextElement,
} from './types';

export const randomInteger = (): number => Math.floor(Math.random() * 2 ** 31);

export interface NewElementGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Builds an element from the current style state. The seed is drawn once here
 * and never changes for the life of the element.
 */
export function newShapeElement(
  type: ShapeType,
  geometry: NewElementGeometry,
): ShapeElement {
  const state = getAppState();
  return {
    id: nanoid(),
    type,
    ...geometry,
    angle: 0,

    strokeColor: state.currentItemStrokeColor,
    backgroundColor: state.currentItemBackgroundColor,
    fillStyle: state.currentItemFillStyle,
    strokeWidth: state.currentItemStrokeWidth,
    strokeStyle: state.currentItemStrokeStyle,
    roughness: state.currentItemRoughness,
    opacity: state.currentItemOpacity,

    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    updated: Date.now(),
    isDeleted: false,

    groupIds: [],
    frameId: null,
    boundElements: null,
    locked: false,
    link: null,
  };
}

/**
 * A linear element starts as two coincident points at the press location; the
 * points[0] === [0,0] invariant holds from creation onward.
 */
export function newLinearElement(type: LinearType, origin: { x: number; y: number }): LinearElement {
  const state = getAppState();
  return {
    id: nanoid(),
    type,
    x: origin.x,
    y: origin.y,
    width: 0,
    height: 0,
    angle: 0,

    strokeColor: state.currentItemStrokeColor,
    // A line's fill would sit under its own stroke; only closed shapes use it.
    backgroundColor: 'transparent',
    fillStyle: state.currentItemFillStyle,
    strokeWidth: state.currentItemStrokeWidth,
    strokeStyle: state.currentItemStrokeStyle,
    roughness: state.currentItemRoughness,
    opacity: state.currentItemOpacity,

    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    updated: Date.now(),
    isDeleted: false,

    groupIds: [],
    frameId: null,
    boundElements: null,
    locked: false,
    link: null,

    points: [
      [0, 0],
      [0, 0],
    ],
    startBinding: null,
    endBinding: null,
    startArrowhead: type === 'arrow' ? state.currentItemStartArrowhead : null,
    endArrowhead: type === 'arrow' ? state.currentItemEndArrowhead : null,
  };
}

export function newFreedrawElement(
  origin: { x: number; y: number },
  simulatePressure: boolean,
): FreedrawElement {
  const state = getAppState();
  return {
    id: nanoid(),
    type: 'freedraw',
    x: origin.x,
    y: origin.y,
    width: 0,
    height: 0,
    angle: 0,

    strokeColor: state.currentItemStrokeColor,
    backgroundColor: 'transparent',
    fillStyle: state.currentItemFillStyle,
    strokeWidth: state.currentItemStrokeWidth,
    strokeStyle: state.currentItemStrokeStyle,
    roughness: state.currentItemRoughness,
    opacity: state.currentItemOpacity,

    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    updated: Date.now(),
    isDeleted: false,

    groupIds: [],
    frameId: null,
    boundElements: null,
    locked: false,
    link: null,

    // The press point IS the origin, so the invariant holds from the start and
    // no renormalization is needed while drawing.
    points: [[0, 0]],
    pressures: [],
    simulatePressure,
  };
}

export function newTextElement(
  origin: { x: number; y: number },
  containerId: string | null = null,
): TextElement {
  const state = getAppState();
  return {
    id: nanoid(),
    type: 'text',
    x: origin.x,
    y: origin.y,
    width: 0,
    height: 0,
    angle: 0,

    strokeColor: state.currentItemStrokeColor,
    backgroundColor: 'transparent',
    fillStyle: state.currentItemFillStyle,
    strokeWidth: state.currentItemStrokeWidth,
    strokeStyle: state.currentItemStrokeStyle,
    roughness: state.currentItemRoughness,
    opacity: state.currentItemOpacity,

    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    updated: Date.now(),
    isDeleted: false,

    groupIds: [],
    frameId: null,
    boundElements: null,
    locked: false,
    link: null,

    text: '',
    fontSize: state.currentItemFontSize,
    fontFamily: state.currentItemFontFamily,
    // A label is always centred in its container; free text follows the tool.
    textAlign: containerId ? 'center' : state.currentItemTextAlign,
    verticalAlign: containerId ? 'middle' : 'top',
    containerId,
    lineHeight: DEFAULT_LINE_HEIGHT,
    // A label is wrapped by its container; free text hugs itself until the user
    // drags a side handle and pins a width.
    autoResize: containerId === null,
  };
}

export function newImageElement(
  fileId: string,
  geometry: NewElementGeometry,
  fileName = '',
): ImageElement {
  const state = getAppState();
  return {
    id: nanoid(),
    type: 'image',
    ...geometry,
    angle: 0,

    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: state.currentItemFillStyle,
    strokeWidth: state.currentItemStrokeWidth,
    strokeStyle: state.currentItemStrokeStyle,
    roughness: state.currentItemRoughness,
    opacity: state.currentItemOpacity,

    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    updated: Date.now(),
    isDeleted: false,

    groupIds: [],
    frameId: null,
    boundElements: null,
    locked: false,
    link: null,

    fileId,
    fileName,
    scale: [1, 1],
    status: 'saved',
  };
}

/** A copy is a separate hand-drawn shape, so it gets a fresh seed and id. */
export function duplicateElement<T extends ExcaliElement>(element: T): T {
  const copy: T = {
    ...element,
    id: nanoid(),
    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    updated: Date.now(),
    // Bindings are relationships of the original, not of the copy.
    boundElements: null,
  };

  if (copy.type === 'arrow' || copy.type === 'line') {
    const linear = copy as unknown as LinearElement;
    linear.points = linear.points.map(([x, y]) => [x, y]);
    linear.startBinding = null;
    linear.endBinding = null;
  }
  if (copy.type === 'freedraw') {
    const freedraw = copy as unknown as FreedrawElement;
    freedraw.points = freedraw.points.map(([x, y]) => [x, y]);
    freedraw.pressures = [...freedraw.pressures];
  }
  return copy;
}
