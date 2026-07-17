import rough from 'roughjs';
import { getElementBounds } from '../element/bounds';
import type { ExcaliElement } from '../element/types';
import { getAppState } from '../state/store';
import type { Bounds } from '../utils/math';
import { getFileBlob, blobToDataUrl } from './files';
import { makeLayer, renderElementsTo } from './render';
import { scene } from './Scene';

export const SOURCE = 'handdrawn-whiteboard';
export const FILE_VERSION = 2;

export interface ExportOptions {
  scale: number;
  padding: number;
  withBackground: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = { scale: 2, padding: 16, withBackground: true };

export function getCommonBounds(elements: readonly ExcaliElement[]): Bounds | null {
  const live = elements.filter((element) => !element.isDeleted);
  if (live.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of live) {
    const bounds = getElementBounds(element);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  return { minX, minY, maxX, maxY };
}

// ----------------------------------------------------------- .excalidraw

/** Files referenced by the given elements, inlined as data URLs for transport. */
async function collectFiles(
  elements: readonly ExcaliElement[],
): Promise<Record<string, { id: string; mimeType: string; dataURL: string }>> {
  const files: Record<string, { id: string; mimeType: string; dataURL: string }> = {};

  for (const element of elements) {
    if (element.type !== 'image' || files[element.fileId]) continue;
    const blob = await getFileBlob(element.fileId);
    if (!blob) continue;
    files[element.fileId] = {
      id: element.fileId,
      mimeType: blob.type || 'image/png',
      dataURL: await blobToDataUrl(blob),
    };
  }
  return files;
}

export async function serializeScene(elements: readonly ExcaliElement[]): Promise<string> {
  const state = getAppState();
  const live = elements.filter((element) => !element.isDeleted);

  return JSON.stringify(
    {
      type: 'excalidraw',
      version: FILE_VERSION,
      source: SOURCE,
      elements: live,
      appState: {
        viewBackgroundColor: state.viewBackgroundColor,
        gridSize: state.gridSize,
      },
      files: await collectFiles(live),
    },
    null,
    2,
  );
}

// ------------------------------------------------------------------- PNG

/** PNG's CRC-32, table built once on first use. */
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Splice a tEXt chunk carrying the scene JSON in just before IEND, so the
 * exported PNG re-imports as an editable scene. A PNG is a signature followed
 * by [length][type][data][crc] chunks; decoders ignore tEXt they don't know.
 */
export async function embedSceneInPng(png: Blob, keyword: string, payload: string): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer());

  const keywordBytes = new TextEncoder().encode(keyword);
  const payloadBytes = new TextEncoder().encode(payload);
  // tEXt data is keyword, a NUL separator, then the text.
  const data = new Uint8Array(keywordBytes.length + 1 + payloadBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(payloadBytes, keywordBytes.length + 1);

  const type = new TextEncoder().encode('tEXt');
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  // The CRC covers the type and the data, but not the length.
  const forCrc = new Uint8Array(type.length + data.length);
  forCrc.set(type, 0);
  forCrc.set(data, type.length);
  view.setUint32(8 + data.length, crc32(forCrc));

  // Walk the chunk list to find IEND rather than assuming its offset.
  let offset = 8;
  let iendAt = bytes.length - 12;
  const reader = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset < bytes.length - 8) {
    const length = reader.getUint32(offset);
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (name === 'IEND') {
      iendAt = offset;
      break;
    }
    offset += 12 + length;
  }

  return new Blob([bytes.subarray(0, iendAt), chunk, bytes.subarray(iendAt)], {
    type: 'image/png',
  });
}

export const PNG_SCENE_KEYWORD = 'whiteboard-scene';

export async function exportToPng(
  elements: readonly ExcaliElement[],
  options: ExportOptions = DEFAULT_EXPORT,
): Promise<Blob | null> {
  const bounds = getCommonBounds(elements);
  if (!bounds) return null;

  const state = getAppState();
  const width = Math.ceil((bounds.maxX - bounds.minX + options.padding * 2) * options.scale);
  const height = Math.ceil((bounds.maxY - bounds.minY + options.padding * 2) * options.scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const layer = makeLayer(canvas);
  const { ctx } = layer;

  if (options.withBackground) {
    ctx.fillStyle = state.viewBackgroundColor;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.scale(options.scale, options.scale);
  ctx.translate(-bounds.minX + options.padding, -bounds.minY + options.padding);

  // Same code path as the screen — that is what guarantees the export matches
  // what the user is looking at.
  renderElementsTo(layer, elements);

  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((blob) => resolve(blob), 'image/png'),
  );
  if (!png) return null;

  const payload = await serializeScene(elements);
  try {
    return await embedSceneInPng(png, PNG_SCENE_KEYWORD, payload);
  } catch (error) {
    // A plain PNG is far better than no PNG.
    console.warn('Could not embed scene in PNG; exporting without it', error);
    return png;
  }
}

/** Read a scene back out of a PNG exported by this app. */
export async function extractSceneFromPng(file: Blob): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const reader = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  let offset = 8;
  while (offset < bytes.length - 8) {
    const length = reader.getUint32(offset);
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (name === 'IEND') break;

    if (name === 'tEXt') {
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      const separator = data.indexOf(0);
      if (separator !== -1) {
        const keyword = decoder.decode(data.subarray(0, separator));
        if (keyword === PNG_SCENE_KEYWORD) return decoder.decode(data.subarray(separator + 1));
      }
    }
    offset += 12 + length;
  }
  return null;
}

// ------------------------------------------------------------------- SVG

const FONT_FILES: [family: string, url: string][] = [
  ['Caveat', '/fonts/Caveat-Regular.woff2'],
  ['Nunito', '/fonts/Nunito-Regular.woff2'],
  ['JetBrainsMono', '/fonts/JetBrainsMono-Regular.woff2'],
];

/**
 * Fonts must travel inside the SVG as base64 @font-face, or the file renders in
 * Times New Roman on any machine that lacks them.
 *
 * NOTE: these are the full latin subsets (~85KB total), not per-export subsets
 * of the glyphs actually used. Proper subsetting needs a tool like glyphhanger
 * and would cut this to a few KB.
 */
async function embeddedFontCss(usedFamilies: Set<string>): Promise<string> {
  const faces: string[] = [];

  for (const [family, url] of FONT_FILES) {
    if (!usedFamilies.has(family)) continue;
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const dataUrl = await blobToDataUrl(await response.blob());
      faces.push(
        `@font-face{font-family:"${family}";src:url(${dataUrl}) format("woff2");font-display:block;}`,
      );
    } catch (error) {
      console.warn(`Could not embed font ${family} in SVG`, error);
    }
  }
  return faces.join('\n');
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export async function exportToSvg(
  elements: readonly ExcaliElement[],
  options: ExportOptions = DEFAULT_EXPORT,
): Promise<string | null> {
  const bounds = getCommonBounds(elements);
  if (!bounds) return null;

  const state = getAppState();
  const width = bounds.maxX - bounds.minX + options.padding * 2;
  const height = bounds.maxY - bounds.minY + options.padding * 2;
  const live = elements.filter((element) => !element.isDeleted);

  // rough.svg() produces the same geometry as the canvas renderer, as paths.
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const rc = rough.svg(host);

  const { renderElementToSvg } = await import('./exportSvg');
  const body: string[] = [];
  const usedFamilies = new Set<string>();

  for (const element of live) {
    body.push(await renderElementToSvg(element, rc, usedFamilies));
  }

  const fontCss = await embeddedFontCss(usedFamilies);
  const background = options.withBackground
    ? `<rect width="${width}" height="${height}" fill="${escapeXml(state.viewBackgroundColor)}"/>`
    : '';
  const payload = await serializeScene(live);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width * options.scale}" height="${height * options.scale}" viewBox="0 0 ${width} ${height}">
<!-- payload:${escapeXml(payload)} -->
<defs><style>${fontCss}</style></defs>
${background}
<g transform="translate(${-bounds.minX + options.padding} ${-bounds.minY + options.padding})">
${body.join('\n')}
</g>
</svg>`;
}

// ------------------------------------------------------------- downloads

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const exportSceneFile = async (): Promise<void> => {
  const json = await serializeScene(scene.getNonDeleted());
  downloadBlob(new Blob([json], { type: 'application/json' }), 'scene.excalidraw');
};
