import type { ComponentType, ReactNode } from 'react';
import type { CustomElement } from '../element/types';
import type { Point } from '../utils/geometry';

export interface PluginStylePanelProps<Data> {
  element: CustomElement<Data>;
  /** Patch the element's data; the core handles versioning, redraw and undo. */
  update: (patch: Partial<Data>) => void;
}

/**
 * The plugin contract.
 *
 * Adding an element type used to mean editing fifteen files — types, render,
 * hitTest, persist, search, toolbar, and so on. Everything a new element needs
 * now lives behind this interface, so a plugin is one file that registers
 * itself and touches no core code.
 *
 * The core knows only `CustomElement`: a box (x/y/width/height/angle, shared
 * with every other element, so move/resize/rotate/z-order/group/delete/undo all
 * work for free) plus a `data` bag the core never reads. Everything specific to
 * an element type is a method here.
 */

export type PluginCategory = 'basic' | 'text' | 'diagram' | 'data' | 'media';

export interface InsertContext {
  /** Scene point to insert at — the viewport centre, or where the menu opened. */
  at: Point;
  /** Canvas size in CSS pixels, for sizing something sensibly. */
  viewport: { width: number; height: number };
}

export interface RenderContext {
  /**
   * Already translated and rotated into the element's local frame: (0,0) is the
   * element's top-left, so a plugin draws at 0..width, 0..height and never
   * thinks about the viewport.
   */
  ctx: CanvasRenderingContext2D;
  /** Divide any on-screen constant by this to keep it zoom-independent. */
  zoom: number;
  /**
   * Dark theme is active.
   *
   * Only meaningful when the plugin sets `darkMode: 'own'`. With the default
   * ('invert') the canvas filter handles the theme and this is always false,
   * because a plugin that also reacted to it would invert twice.
   */
  dark: boolean;
  /**
   * A live editor is overlaying this element, so it must NOT draw its own text —
   * the textarea is already painting those glyphs, and both at once gives the
   * doubled, offset text. Everything else (paper, borders, chrome) still draws.
   */
  isEditing: boolean;
}

/**
 * Editable text, which is what separates a real object from a coloured box.
 *
 * A plugin that implements this gets double-click-to-edit, a caret, native
 * selection, IME, arrow keys and clipboard — all from a DOM textarea overlaid on
 * the canvas, exactly as the built-in text element does.
 */
export interface PluginTextEditing<Data> {
  getText(element: CustomElement<Data>): string;
  /** Return the NEW data. Never mutate — the core owns versioning. */
  setText(element: CustomElement<Data>, text: string): Data;

  /**
   * How the overlay must look. These have to match what render() draws or the
   * text visibly jumps the moment editing ends.
   */
  editorStyle(element: CustomElement<Data>): {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    color: string;
    /** Inset from the element's box, in scene units. */
    padding: { top: number; right: number; bottom: number; left: number };
    textAlign: 'left' | 'center' | 'right';
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    textDecoration?: string;
    /** 'pre' never wraps (code); 'pre-wrap' wraps at the box (prose). */
    whiteSpace: 'pre' | 'pre-wrap';
  };

  /**
   * Tab inserts this many spaces instead of moving focus. Code blocks want it;
   * prose does not, because Tab is how you leave the field.
   */
  tabInsertsSpaces?: number;
  /** Repeat the previous line's leading whitespace on Enter. */
  autoIndent?: boolean;
}

export interface ElementPlugin<Data = Record<string, unknown>> {
  /** Stable and unique; persisted on every element this plugin creates. */
  id: string;

  // ---- menu presentation

  label: string;
  icon: ReactNode;
  category: PluginCategory;
  /** One line, shown under the label. */
  description?: string;
  /** Extra terms the menu's own search should match. */
  keywords?: string[];

  // ---- behaviour

  /**
   * Build the element(s) to insert. Return several to insert a group.
   * Called with the plugin's own defaults; the core assigns id/seed/version.
   */
  create(context: InsertContext): PluginElementInit<Data> | PluginElementInit<Data>[];

  /** Draw it, in element-local space. */
  render(element: CustomElement<Data>, context: RenderContext): void;

  /**
   * Text this element should be findable by. Optional: elements with nothing
   * to say simply are not indexed beyond their label.
   */
  searchText?(element: CustomElement<Data>): string;

  /**
   * Refine the hit test WITHIN the bounding box, in element-local coordinates
   * (0,0 is the top-left).
   *
   * The core has already confirmed the point is inside the box before calling
   * this, so returning `true` means "the whole box counts" — which is the
   * default when this is omitted. Only implement it for a non-rectangular
   * silhouette, e.g. a diamond, where the corners should not be grabbable.
   */
  hitTest?(element: CustomElement<Data>, local: Point): boolean;

  /**
   * Editable text. Omit for elements that have none — a divider is a divider.
   */
  editing?: PluginTextEditing<Data>;

  /**
   * Controls shown in the style panel while one of these is selected. A plugin
   * owns its own options, so adding a colour picker or a language selector does
   * not touch the panel.
   */
  StylePanel?: ComponentType<PluginStylePanelProps<Data>>;

  /**
   * How the element meets dark mode.
   *
   * 'invert' (default): the canvas-wide CSS invert handles it. Correct for line
   * art — a black stroke becomes a white one for free.
   *
   * 'own': the invert is cancelled for this element and `dark` is passed to
   * render() instead. For elements whose colour IS the point — a yellow sticky
   * must not become brown — so the plugin picks a palette per theme.
   */
  darkMode?: 'invert' | 'own';

  /**
   * Drop unknown or corrupt data from a file rather than trusting it. Return
   * null to reject the element entirely.
   */
  reviveData?(raw: unknown): Data | null;

  /** Smallest sensible size, enforced on resize. */
  minSize?: { width: number; height: number };
}

/** What create() returns: geometry plus the plugin's own data. */
export interface PluginElementInit<Data = Record<string, unknown>> {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Data;
  /** Optional overrides; the current style state is used otherwise. */
  strokeColor?: string;
  backgroundColor?: string;
}
