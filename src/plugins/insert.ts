import { nanoid } from 'nanoid';
import { randomInteger } from '../element/factory';
import type { CustomElement } from '../element/types';
import { selectElements } from '../scene/actions';
import { invalidateStatic } from '../scene/render';
import { scene } from '../scene/Scene';
import { record } from '../state/history';
import { getAppState } from '../state/store';
import { getPlugin } from './registry';
import type { InsertContext, PluginElementInit } from './types';

/**
 * Turn a plugin's init into a real element and put it on the canvas.
 *
 * The identity fields — id, seed, version, versionNonce — are the core's to
 * assign, never a plugin's. A plugin that forgot a seed would shimmer on every
 * repaint; one that reused an id would break collaborative merge. Not asking is
 * simpler than validating.
 */
function materialize(pluginId: string, init: PluginElementInit): CustomElement {
  const state = getAppState();
  return {
    id: nanoid(),
    type: 'custom',
    pluginId,

    x: init.x,
    y: init.y,
    width: init.width,
    height: init.height,
    angle: 0,

    strokeColor: init.strokeColor ?? state.currentItemStrokeColor,
    backgroundColor: init.backgroundColor ?? 'transparent',
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

    data: init.data,
  };
}

/**
 * Insert whatever a plugin makes, select it, and record one undo step —
 * regardless of how many elements it produced.
 */
export function insertPluginElement(
  pluginId: string,
  context: InsertContext,
  seed?: Partial<Record<string, unknown>>,
): void {
  const plugin = getPlugin(pluginId);
  if (!plugin) {
    console.error(`No plugin registered for "${pluginId}"`);
    return;
  }

  let inits: PluginElementInit[];
  try {
    // `seed` is whatever the plugin's own InsertDialog confirmed — opaque here,
    // exactly like `data`.
    const created = plugin.create(context, seed as never);
    inits = Array.isArray(created) ? created : [created];
  } catch (error) {
    console.error(`Plugin "${pluginId}" failed to create an element`, error);
    return;
  }
  if (inits.length === 0) return;

  const elements = inits.map((init) => materialize(pluginId, init));
  for (const element of elements) scene.add(element);

  selectElements(elements);
  invalidateStatic();
  record();
}

/** Where an insert lands: the middle of what the user is currently looking at. */
export function viewportInsertContext(): InsertContext {
  const container = document.querySelector<HTMLElement>('.canvas-stack');
  const rect = container?.getBoundingClientRect();
  const width = rect?.width ?? window.innerWidth;
  const height = rect?.height ?? window.innerHeight;
  const state = getAppState();

  return {
    at: {
      x: width / 2 / state.zoom - state.scrollX,
      y: height / 2 / state.zoom - state.scrollY,
    },
    viewport: { width, height },
  };
}
