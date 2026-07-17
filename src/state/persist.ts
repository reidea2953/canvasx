import { DEFAULT_LINE_HEIGHT } from '../element/text';
import {
  isLinearType,
  isShapeType,
  type ExcaliElement,
  type FreedrawElement,
  type ImageElement,
  type LinearElement,
  type TextElement,
} from '../element/types';
import { mutateElement } from '../element/mutate';
import { loadBitmap } from '../scene/files';
import { scene } from '../scene/Scene';
import { invalidateStatic } from '../scene/render';
import { appStore, getAppState, setAppState, type AppState } from './store';

const STORAGE_KEY = 'whiteboard:scene';
const BACKUP_KEY = 'whiteboard:scene:corrupt';
const SAVE_DEBOUNCE_MS = 300;

/** Only viewport, canvas and style preferences survive a reload — not selection. */
type PersistedAppState = Pick<
  AppState,
  | 'scrollX' | 'scrollY' | 'zoom'
  | 'currentItemStrokeColor' | 'currentItemBackgroundColor' | 'currentItemFillStyle'
  | 'currentItemStrokeWidth' | 'currentItemStrokeStyle' | 'currentItemRoughness'
  | 'currentItemOpacity'
  | 'viewBackgroundColor' | 'gridSize' | 'theme'
>;

interface PersistedScene {
  type: 'excalidraw';
  version: 2;
  source: string;
  elements: ExcaliElement[];
  appState: PersistedAppState;
}

const pickPersistedAppState = (state: AppState): PersistedAppState => ({
  scrollX: state.scrollX,
  scrollY: state.scrollY,
  zoom: state.zoom,
  currentItemStrokeColor: state.currentItemStrokeColor,
  currentItemBackgroundColor: state.currentItemBackgroundColor,
  currentItemFillStyle: state.currentItemFillStyle,
  currentItemStrokeWidth: state.currentItemStrokeWidth,
  currentItemStrokeStyle: state.currentItemStrokeStyle,
  currentItemRoughness: state.currentItemRoughness,
  currentItemOpacity: state.currentItemOpacity,
  viewBackgroundColor: state.viewBackgroundColor,
  gridSize: state.gridSize,
  theme: state.theme,
});

let saveTimer: number | undefined;

export function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, SAVE_DEBOUNCE_MS);
}

function save(): void {
  const payload: PersistedScene = {
    type: 'excalidraw',
    version: 2,
    source: window.location.origin,
    // Tombstones are dropped on the way to disk; they only matter in-session.
    elements: scene.getNonDeleted(),
    appState: pickPersistedAppState(getAppState()),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Quota exceeded, or storage disabled in a private window.
    console.warn('Scene save failed', error);
  }
}

/** Fills in fields absent from older or hand-edited files rather than trusting them. */
function reviveElement(raw: Partial<ExcaliElement>): ExcaliElement | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.type !== 'string') return null;
  // Anything not recognised is dropped rather than trusted.
  const known =
    isShapeType(raw.type) ||
    isLinearType(raw.type) ||
    raw.type === 'freedraw' ||
    raw.type === 'text' ||
    raw.type === 'image';
  if (!known) return null;
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return null;

  const base = {
    id: raw.id ?? `restored-${Math.random().toString(36).slice(2)}`,
    x: raw.x,
    y: raw.y,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    angle: raw.angle ?? 0,
    strokeColor: raw.strokeColor ?? '#1e1e1e',
    backgroundColor: raw.backgroundColor ?? 'transparent',
    fillStyle: raw.fillStyle ?? 'hachure',
    strokeWidth: raw.strokeWidth ?? 2,
    strokeStyle: raw.strokeStyle ?? 'solid',
    roughness: raw.roughness ?? 1,
    opacity: raw.opacity ?? 100,
    // A missing seed would otherwise be regenerated every frame and shimmer.
    seed: raw.seed ?? Math.floor(Math.random() * 2 ** 31),
    version: raw.version ?? 1,
    versionNonce: raw.versionNonce ?? Math.floor(Math.random() * 2 ** 31),
    updated: raw.updated ?? Date.now(),
    isDeleted: false,
    groupIds: raw.groupIds ?? [],
    frameId: raw.frameId ?? null,
    boundElements: raw.boundElements ?? null,
    locked: raw.locked ?? false,
    link: raw.link ?? null,
  } as const;

  if (isLinearType(raw.type)) {
    const linear = raw as Partial<LinearElement>;
    const points = linear.points;
    // Two points is the minimum that can be drawn at all.
    if (!Array.isArray(points) || points.length < 2) return null;

    return {
      ...base,
      type: raw.type,
      points: points.map(([x, y]) => [x, y] as [number, number]),
      startBinding: linear.startBinding ?? null,
      endBinding: linear.endBinding ?? null,
      startArrowhead: linear.startArrowhead ?? null,
      endArrowhead: linear.endArrowhead ?? (raw.type === 'arrow' ? 'arrow' : null),
    };
  }

  if (raw.type === 'image') {
    const image = raw as Partial<ImageElement>;
    // Without a fileId the bytes are unreachable; the element is dead weight.
    if (typeof image.fileId !== 'string') return null;
    return {
      ...base,
      type: 'image',
      fileId: image.fileId,
      // Files written before fileName existed simply have none.
      fileName: image.fileName ?? '',
      scale: Array.isArray(image.scale) ? [image.scale[0], image.scale[1]] : [1, 1],
      // Bitmaps are re-decoded from IndexedDB after restore, so start pending.
      status: 'pending',
    };
  }

  if (raw.type === 'text') {
    const text = raw as Partial<TextElement>;
    return {
      ...base,
      type: 'text',
      text: text.text ?? '',
      fontSize: text.fontSize ?? 20,
      fontFamily: text.fontFamily ?? 1,
      textAlign: text.textAlign ?? 'left',
      verticalAlign: text.verticalAlign ?? 'top',
      containerId: text.containerId ?? null,
      lineHeight: text.lineHeight ?? DEFAULT_LINE_HEIGHT,
      // Files written before autoResize existed had hug-the-text behaviour.
      autoResize: text.autoResize ?? text.containerId == null,
    };
  }

  if (raw.type === 'freedraw') {
    const freedraw = raw as Partial<FreedrawElement>;
    const points = freedraw.points;
    if (!Array.isArray(points) || points.length < 2) return null;

    const revived = points.map(([x, y]) => [x, y] as [number, number]);
    return {
      ...base,
      type: 'freedraw',
      points: revived,
      // pressures must stay parallel to points, whatever the file claimed.
      pressures:
        Array.isArray(freedraw.pressures) && freedraw.pressures.length === revived.length
          ? [...freedraw.pressures]
          : revived.map(() => 0.5),
      simulatePressure: freedraw.simulatePressure ?? true,
    };
  }

  return { ...base, type: raw.type };
}

export function restore(): boolean {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return false;

  try {
    const parsed = JSON.parse(stored) as Partial<PersistedScene>;
    const elements = (parsed.elements ?? [])
      .map(reviveElement)
      .filter((element): element is ExcaliElement => element !== null);

    scene.replaceAll(elements);
    if (parsed.appState) setAppState(parsed.appState);
    invalidateStatic();
    void restoreBitmaps(elements);
    return true;
  } catch (error) {
    // Keep the unreadable copy instead of silently destroying the user's work.
    window.localStorage.setItem(BACKUP_KEY, stored);
    window.localStorage.removeItem(STORAGE_KEY);
    console.error('Scene restore failed; corrupt copy kept under', BACKUP_KEY, error);
    return false;
  }
}

/**
 * Element JSON only carries a fileId; the bytes live in IndexedDB. Decoding is
 * async and must not block the first paint, so images render as placeholders
 * until their bitmaps land.
 */
async function restoreBitmaps(elements: readonly ExcaliElement[]): Promise<void> {
  const fileIds = new Set(
    elements.filter((element) => element.type === 'image').map((element) => element.fileId),
  );
  if (fileIds.size === 0) return;

  await Promise.all(
    [...fileIds].map(async (fileId) => {
      const bitmap = await loadBitmap(fileId);
      for (const element of scene.getNonDeleted()) {
        if (element.type === 'image' && element.fileId === fileId) {
          mutateElement(element, { status: bitmap ? 'saved' : 'error' });
        }
      }
    }),
  );
  scene.emit();
  invalidateStatic();
}

export function attachAutoSave(): () => void {
  const unsubscribeScene = scene.onChange(scheduleSave);
  const unsubscribeState = appStore.subscribe(scheduleSave);
  return () => {
    unsubscribeScene();
    unsubscribeState();
  };
}
