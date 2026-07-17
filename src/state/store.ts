import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Arrowhead } from '../element/types';

export type ToolType =
  | 'selection' | 'hand'
  | 'rectangle' | 'diamond' | 'ellipse'
  | 'arrow' | 'line'
  | 'freedraw' | 'text' | 'image' | 'eraser' | 'frame' | 'laser';

export type FillStyle = 'hachure' | 'cross-hatch' | 'solid' | 'zigzag';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
/** 1 = hand-drawn, 2 = normal, 3 = code. See element/text.ts FONT_FAMILY. */
export type FontFamily = 1 | 2 | 3;
export type TextAlign = 'left' | 'center' | 'right';

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 30;

export interface AppState {
  // Viewport
  scrollX: number;
  scrollY: number;
  zoom: number;

  // Tool
  activeTool: ToolType;
  toolLocked: boolean;

  // Selection
  selectedElementIds: Record<string, true>;
  selectedGroupIds: Record<string, true>;
  /** Set when the user has double-clicked into a group to edit its members. */
  editingGroupId: string | null;
  /** Set when a linear element's individual points are being edited. */
  editingLinearElementId: string | null;
  editingTextElementId: string | null;

  // Style applied to the next created element
  currentItemStrokeColor: string;
  currentItemBackgroundColor: string;
  currentItemFillStyle: FillStyle;
  currentItemStrokeWidth: number;
  currentItemStrokeStyle: StrokeStyle;
  currentItemRoughness: 0 | 1 | 2;
  currentItemOpacity: number;
  currentItemStartArrowhead: Arrowhead | null;
  currentItemEndArrowhead: Arrowhead | null;
  currentItemFontFamily: FontFamily;
  currentItemFontSize: number;
  currentItemTextAlign: TextAlign;

  // Canvas
  viewBackgroundColor: string;
  gridSize: number | null;
  objectsSnapModeEnabled: boolean;
  theme: 'light' | 'dark';
  statsOpen: boolean;
}

const initialState: AppState = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,

  activeTool: 'selection',
  toolLocked: false,

  selectedElementIds: {},
  selectedGroupIds: {},
  editingGroupId: null,
  editingLinearElementId: null,
  editingTextElementId: null,

  currentItemStrokeColor: '#1e1e1e',
  currentItemBackgroundColor: 'transparent',
  currentItemFillStyle: 'hachure',
  currentItemStrokeWidth: 2,
  currentItemStrokeStyle: 'solid',
  currentItemRoughness: 1,
  currentItemOpacity: 100,
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: 'arrow',
  currentItemFontFamily: 1,
  currentItemFontSize: 20,
  currentItemTextAlign: 'left',

  viewBackgroundColor: '#ffffff',
  gridSize: 20,
  objectsSnapModeEnabled: false,
  theme: 'light',
  statsOpen: false,
};

export const appStore = createStore<AppState>()(() => initialState);

/**
 * Read the live state without subscribing. The renderer and pointer handlers use
 * this — they must never go through React.
 */
export const getAppState = (): AppState => appStore.getState();

/** Accepts a patch or an updater, mirroring zustand's own setState. */
export const setAppState = (
  patch: Partial<AppState> | ((previous: AppState) => Partial<AppState>),
): void => {
  appStore.setState(patch);
};

/** Subscribe from React chrome. Always pass a narrow selector. */
export function useAppState<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
