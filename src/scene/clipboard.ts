import { getElementCenter } from '../element/bounds';
import { duplicateElement, newImageElement, newTextElement } from '../element/factory';
import { newGroupId } from '../element/groups';
import { mutateElement } from '../element/mutate';
import { measureText } from '../element/text';
import type { ExcaliElement } from '../element/types';
import { record } from '../state/history';
import { getAppState } from '../state/store';
import { deleteSelected, getSelectedElements, selectElements } from './actions';
import { exportToPng, getCommonBounds, SOURCE, serializeScene } from './export';
import { storeFile, storeFileWithId, dataUrlToBlob } from './files';
import { invalidateInteractive, invalidateStatic } from './render';
import { scene } from './Scene';

const MIME_INTERNAL = 'application/x-whiteboard-scene';

/** Fraction of the viewport a pasted image may occupy at most. */
const IMAGE_VIEWPORT_FRACTION = 0.5;

export function imageGeometry(
  bitmap: { width: number; height: number },
  at: { x: number; y: number },
  viewport: { width: number; height: number },
  zoom: number,
): { x: number; y: number; width: number; height: number } {
  const maxWidth = (viewport.width / zoom) * IMAGE_VIEWPORT_FRACTION;
  const maxHeight = (viewport.height / zoom) * IMAGE_VIEWPORT_FRACTION;
  // Never upscale: a small image pasted large just looks blurry.
  const fit = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const width = bitmap.width * fit;
  const height = bitmap.height * fit;
  return { x: at.x - width / 2, y: at.y - height / 2, width, height };
}

export async function insertImage(
  blob: Blob,
  at: { x: number; y: number },
  viewport: { width: number; height: number },
): Promise<void> {
  const { fileId, bitmap } = await storeFile(blob);
  const element = newImageElement(fileId, imageGeometry(bitmap, at, viewport, getAppState().zoom));
  scene.add(element);
  selectElements([element]);
  invalidateStatic();
  record();
}

// ------------------------------------------------------------------ copy

/**
 * Copy writes BOTH the scene JSON and a PNG, so pasting into Slack or Figma
 * gives a picture while pasting back here gives editable elements.
 */
export async function copySelection(): Promise<boolean> {
  const selected = getSelectedElements();
  if (selected.length === 0) return false;

  const json = await serializeScene(selected);

  try {
    const png = await exportToPng(selected);
    const items: Record<string, Blob> = {
      'text/plain': new Blob([json], { type: 'text/plain' }),
    };
    if (png) items['image/png'] = png;
    await navigator.clipboard.write([new ClipboardItem(items)]);
    return true;
  } catch {
    // Firefox rejects multi-type writes and some contexts block the async API.
    try {
      await navigator.clipboard.writeText(json);
      return true;
    } catch (error) {
      console.warn('Clipboard write refused', error);
      return false;
    }
  }
}

export async function cutSelection(): Promise<void> {
  // Only delete if the copy actually landed — otherwise cut destroys work.
  const copied = await copySelection();
  if (!copied) return;
  deleteSelected();
}

// ----------------------------------------------------------------- paste

interface ParsedScene {
  elements: ExcaliElement[];
  files?: Record<string, { id: string; mimeType: string; dataURL: string }>;
}

function parseSceneJson(text: string): ParsedScene | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed.type !== 'excalidraw' || !Array.isArray(parsed.elements)) return null;
    return {
      elements: parsed.elements as ExcaliElement[],
      files: parsed.files as ParsedScene['files'],
    };
  } catch {
    return null;
  }
}

/** Paste elements centred on a point, with fresh ids, seeds and group ids. */
export async function pasteElements(
  parsed: ParsedScene,
  at: { x: number; y: number },
): Promise<void> {
  const { elements, files } = parsed;
  if (elements.length === 0) return;

  // Re-attach any images the payload carried before the elements land.
  if (files) {
    await Promise.all(
      Object.values(files).map(async (file) => {
        try {
          await storeFileWithId(file.id, await dataUrlToBlob(file.dataURL));
        } catch (error) {
          console.warn(`Could not restore pasted image ${file.id}`, error);
        }
      }),
    );
  }

  const bounds = getCommonBounds(elements);
  if (!bounds) return;
  const dx = at.x - (bounds.minX + bounds.maxX) / 2;
  const dy = at.y - (bounds.minY + bounds.maxY) / 2;

  const groupIdMap = new Map<string, string>();
  const copies: ExcaliElement[] = [];

  for (const element of elements) {
    const copy = duplicateElement(element);
    copy.groupIds = copy.groupIds.map((id) => {
      let next = groupIdMap.get(id);
      if (!next) {
        next = newGroupId();
        groupIdMap.set(id, next);
      }
      return next;
    });
    mutateElement(copy, { x: copy.x + dx, y: copy.y + dy });
    copies.push(copy);
  }

  for (const copy of copies) scene.add(copy);
  selectElements(copies);
  invalidateStatic();
  invalidateInteractive();
  record();
}

/**
 * Sniff order matters: internal JSON first so a copy from this app round-trips
 * as elements rather than as the PNG that also sits on the clipboard.
 */
export async function handlePaste(
  event: ClipboardEvent,
  at: { x: number; y: number },
  viewport: { width: number; height: number },
): Promise<void> {
  const data = event.clipboardData;
  if (!data) return;

  const text = data.getData('text/plain') || data.getData(MIME_INTERNAL);
  const parsed = text ? parseSceneJson(text) : null;
  if (parsed) {
    await pasteElements(parsed, at);
    return;
  }

  for (const item of Array.from(data.items)) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      if (blob) {
        await insertImage(blob, at, viewport);
        return;
      }
    }
  }

  if (text.trim() !== '') {
    const element = newTextElement(at);
    const metrics = measureText(text, element.fontSize, element.fontFamily, element.lineHeight);
    mutateElement(element, {
      text,
      width: metrics.width,
      height: metrics.height,
      x: at.x - metrics.width / 2,
      y: at.y - metrics.height / 2,
    });
    scene.add(element);
    selectElements([element]);
    invalidateStatic();
    record();
  }
}

export { SOURCE, getElementCenter };
