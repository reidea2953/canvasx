import { del, get, set } from 'idb-keyval';
import { nanoid } from 'nanoid';

/**
 * Image bytes live in IndexedDB, keyed by fileId; elements only ever reference
 * the id. Inlining base64 into elements destroys JSON performance and blows the
 * localStorage quota within a couple of screenshots.
 */
interface StoredFile {
  mimeType: string;
  blob: Blob;
  created: number;
}

const keyOf = (fileId: string) => `whiteboard:file:${fileId}`;

/** Decoded bitmaps, kept in memory so rendering never awaits. */
const bitmaps = new Map<string, ImageBitmap>();
const inFlight = new Map<string, Promise<ImageBitmap | null>>();

export const getBitmap = (fileId: string): ImageBitmap | null => bitmaps.get(fileId) ?? null;

/** An SVG with no width/height attributes has no intrinsic size to read. */
const SVG_FALLBACK_SIZE = 512;

/**
 * Decode any supported image to a bitmap.
 *
 * createImageBitmap handles PNG/JPEG/WebP/GIF/AVIF directly, but refuses SVG in
 * several browsers — and an SVG without explicit dimensions reports a zero
 * intrinsic size even via <img>. So SVG goes through an <img>, gets a sensible
 * size chosen for it, and is rasterized once at 2x for crispness.
 */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  if (blob.type !== 'image/svg+xml') return createImageBitmap(blob);

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG could not be decoded'));
      image.src = url;
    });

    const width = image.naturalWidth || SVG_FALLBACK_SIZE;
    const height = image.naturalHeight || SVG_FALLBACK_SIZE;

    // Rasterize at 2x so the bitmap still looks sharp when scaled up a little.
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for SVG rasterization');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function storeFile(blob: Blob): Promise<{ fileId: string; bitmap: ImageBitmap }> {
  const fileId = nanoid();
  const bitmap = await decodeImage(blob);
  bitmaps.set(fileId, bitmap);
  const stored: StoredFile = { mimeType: blob.type || 'image/png', blob, created: Date.now() };
  await set(keyOf(fileId), stored);
  return { fileId, bitmap };
}

/** Re-attach an image that came from an imported file rather than a paste. */
export async function storeFileWithId(fileId: string, blob: Blob): Promise<ImageBitmap | null> {
  try {
    const bitmap = await decodeImage(blob);
    bitmaps.set(fileId, bitmap);
    await set(keyOf(fileId), { mimeType: blob.type || 'image/png', blob, created: Date.now() });
    return bitmap;
  } catch (error) {
    console.error(`Could not decode image ${fileId}`, error);
    return null;
  }
}

/** Deduplicated: many elements may reference one file, and boot loads them all at once. */
export function loadBitmap(fileId: string): Promise<ImageBitmap | null> {
  const cached = bitmaps.get(fileId);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(fileId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const stored = await get<StoredFile>(keyOf(fileId));
      if (!stored) return null;
      const bitmap = await decodeImage(stored.blob);
      bitmaps.set(fileId, bitmap);
      return bitmap;
    } catch (error) {
      console.error(`Could not load image ${fileId}`, error);
      return null;
    } finally {
      inFlight.delete(fileId);
    }
  })();

  inFlight.set(fileId, promise);
  return promise;
}

export const getFileBlob = async (fileId: string): Promise<Blob | null> => {
  const stored = await get<StoredFile>(keyOf(fileId));
  return stored?.blob ?? null;
};

export async function deleteFile(fileId: string): Promise<void> {
  bitmaps.delete(fileId);
  await del(keyOf(fileId));
}

export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
