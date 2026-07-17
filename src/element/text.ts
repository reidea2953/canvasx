import type { FontFamily } from '../state/store';

/** Family names must match the FontFace registrations in fonts/load.ts. */
export const FONT_FAMILY: Record<FontFamily, string> = {
  1: 'Caveat',
  2: 'Nunito',
  3: 'JetBrainsMono',
};

/** Fallbacks only matter if a woff2 failed to load; measurements assume the real face. */
const FALLBACK: Record<FontFamily, string> = {
  1: 'cursive',
  2: 'sans-serif',
  3: 'monospace',
};

export const DEFAULT_LINE_HEIGHT = 1.25;
/** Air between a container's edge and the label wrapped inside it. */
export const BOUND_TEXT_PADDING = 5;

/**
 * Fraction of font size from the top of the line box down to the baseline.
 * Approximate by design: it keeps the canvas baseline lined up with where the
 * DOM textarea overlay puts the same glyphs, which is what stops text jumping
 * when an edit is committed.
 */
const ASCENDER_RATIO = 0.8;

export const fontString = (fontSize: number, fontFamily: FontFamily): string =>
  `${fontSize}px ${FONT_FAMILY[fontFamily]}, ${FALLBACK[fontFamily]}`;

export const lineHeightPx = (fontSize: number, lineHeight: number): number =>
  fontSize * lineHeight;

export const baselineOffset = (fontSize: number, lineHeight: number, index: number): number =>
  index * lineHeightPx(fontSize, lineHeight) + fontSize * ASCENDER_RATIO;

// ------------------------------------------------------------- measurement

let measureContext: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureContext) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for text measurement');
    measureContext = ctx;
  }
  return measureContext;
}

/**
 * measureText is not free at scale, and wrapping calls it per word. Cached by
 * everything that can change the answer.
 */
const widthCache = new Map<string, number>();
const MAX_CACHE_ENTRIES = 10_000;

export function measureTextWidth(text: string, fontSize: number, fontFamily: FontFamily): number {
  const key = `${fontFamily}|${fontSize}|${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;

  const ctx = getMeasureContext();
  ctx.font = fontString(fontSize, fontFamily);
  const width = ctx.measureText(text).width;

  // Crude bound: text churns during editing and this would grow without limit.
  if (widthCache.size > MAX_CACHE_ENTRIES) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

/** Must be called once the real fonts land, or every cached width is the fallback's. */
export function invalidateTextMeasureCache(): void {
  widthCache.clear();
  measureContext = null;
}

// ---------------------------------------------------------------- wrapping

/** Break a single over-long word at the last character that still fits. */
function breakWord(word: string, fontSize: number, fontFamily: FontFamily, maxWidth: number): string[] {
  const parts: string[] = [];
  let current = '';

  for (const char of word) {
    const next = current + char;
    if (current !== '' && measureTextWidth(next, fontSize, fontFamily) > maxWidth) {
      parts.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current !== '') parts.push(current);
  return parts;
}

/**
 * Greedy word wrap. Mid-word breaks happen only when a single word cannot fit
 * on a line of its own. Explicit newlines are always honoured.
 */
export function wrapText(
  text: string,
  fontSize: number,
  fontFamily: FontFamily,
  maxWidth: number | null,
): string[] {
  if (maxWidth === null || maxWidth <= 0) return text.split('\n');

  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;

      if (measureTextWidth(candidate, fontSize, fontFamily) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line !== '') lines.push(line);

      if (measureTextWidth(word, fontSize, fontFamily) > maxWidth) {
        const pieces = breakWord(word, fontSize, fontFamily, maxWidth);
        lines.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] ?? '';
      } else {
        line = word;
      }
    }
    lines.push(line);
  }

  return lines;
}

export interface TextMetrics {
  lines: string[];
  width: number;
  height: number;
}

export function measureText(
  text: string,
  fontSize: number,
  fontFamily: FontFamily,
  lineHeight: number,
  maxWidth: number | null = null,
): TextMetrics {
  const lines = wrapText(text, fontSize, fontFamily, maxWidth);
  let width = 0;
  for (const line of lines) {
    width = Math.max(width, measureTextWidth(line, fontSize, fontFamily));
  }
  return { lines, width, height: lines.length * lineHeightPx(fontSize, lineHeight) };
}
