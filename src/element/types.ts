import type { FillStyle, FontFamily, StrokeStyle } from '../state/store';

export type ElementType =
  | 'rectangle' | 'diamond' | 'ellipse'
  | 'arrow' | 'line'
  | 'freedraw' | 'text' | 'image' | 'frame';

export type ShapeType = 'rectangle' | 'diamond' | 'ellipse';
export type LinearType = 'arrow' | 'line';

export type Arrowhead = 'arrow' | 'triangle' | 'dot' | 'bar';

export interface BoundElementRef {
  id: string;
  type: 'arrow' | 'text';
}

export interface Binding {
  elementId: string;
  /**
   * Where across the bound shape the arrow aims: 0 is dead centre, ±1 grazes
   * the edge. Fixed at bind time so a bound arrow keeps its character when the
   * shape moves, rather than snapping to the centre.
   */
  focus: number;
  /** Air to leave between the arrow tip and the shape's outline. */
  gap: number;
}

/**
 * Flat and JSON-serializable by contract: no classes, no methods, no
 * prototypes. Elements cross localStorage, postMessage and (later) the wire.
 */
export interface BaseElement {
  id: string;
  type: ElementType;

  // Scene coordinates. Never viewport coordinates.
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;

  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: 0 | 1 | 2;
  opacity: number;

  /**
   * Fixes the rough.js randomness for this element. Without it every repaint
   * regenerates different sketchy geometry and the shape visibly shimmers.
   * Set once at creation; a duplicate gets a new one, a move/resize keeps it.
   */
  seed: number;

  /** Bumped on every mutation. The shape cache and renderer diff against it. */
  version: number;
  /** Random tie-breaker for collaborative merge when versions are equal. */
  versionNonce: number;
  updated: number;

  /** Soft delete — a tombstone can be undone and can lose a merge race. */
  isDeleted: boolean;

  groupIds: string[];
  frameId: string | null;
  boundElements: BoundElementRef[] | null;
  locked: boolean;
  link: string | null;
}

export interface ShapeElement extends BaseElement {
  type: ShapeType;
}

export type LinearPoint = [number, number];

export interface LinearElement extends BaseElement {
  type: LinearType;
  /**
   * Relative to the element's x,y, with points[0] always [0,0]. Because later
   * points may be negative, a linear element's bounds are NOT x..x+width —
   * always go through getUnrotatedBounds().
   */
  points: LinearPoint[];
  startBinding: Binding | null;
  endBinding: Binding | null;
  startArrowhead: Arrowhead | null;
  endArrowhead: Arrowhead | null;
}

export interface FreedrawElement extends BaseElement {
  type: 'freedraw';
  /** Same convention as LinearElement: relative to x,y, points[0] is [0,0]. */
  points: LinearPoint[];
  /** Parallel to points; same length. */
  pressures: number[];
  /** True when the input device reported no real pressure (mouse, most trackpads). */
  simulatePressure: boolean;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle';
  /** Set when this text is a label living inside a container shape. */
  containerId: string | null;
  /** Unitless multiplier of fontSize. */
  lineHeight: number;
  /**
   * True (the default) means the box hugs the text and grows as you type.
   * Dragging a side handle sets it false and pins an explicit wrap width, so
   * the text reflows inside a box the user chose. Corner handles scale
   * fontSize and leave this alone.
   */
  autoResize: boolean;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  /** Key into the IndexedDB blob store. Never inline base64 — see scene/files.ts. */
  fileId: string;
  /**
   * The name it arrived with. Carried purely so the image is findable by name —
   * nothing renders it. Empty for a pasted image, which has no filename.
   */
  fileName: string;
  /** [-1,1] etc. for flips. */
  scale: [number, number];
  status: 'pending' | 'saved' | 'error';
}

/** Widens if a later phase adds frame elements. */
export type ExcaliElement =
  | ShapeElement
  | LinearElement
  | FreedrawElement
  | TextElement
  | ImageElement;

/** Accepts any string so it can narrow a ToolType directly, not just an ElementType. */
export const isShapeType = (type: string): type is ShapeType =>
  type === 'rectangle' || type === 'diamond' || type === 'ellipse';

export const isLinearType = (type: string): type is LinearType =>
  type === 'arrow' || type === 'line';

export const isLinearElement = (element: ExcaliElement): element is LinearElement =>
  isLinearType(element.type);

export const isFreedrawElement = (element: ExcaliElement): element is FreedrawElement =>
  element.type === 'freedraw';

export const isTextElement = (element: ExcaliElement): element is TextElement =>
  element.type === 'text';

export const isImageElement = (element: ExcaliElement): element is ImageElement =>
  element.type === 'image';

/** Shapes that can hold a bound text label. */
export const isContainerElement = (element: ExcaliElement): element is ShapeElement =>
  isShapeType(element.type);

/**
 * Elements whose geometry lives in a points array rather than a width/height
 * box. Their bounds are NOT x..x+width — always go through getUnrotatedBounds.
 */
export const hasPoints = (element: ExcaliElement): element is LinearElement | FreedrawElement =>
  isLinearType(element.type) || element.type === 'freedraw';

/** Only closed shapes can take an arrow binding. */
export const isBindableElement = (element: ExcaliElement): element is ShapeElement =>
  isShapeType(element.type);
