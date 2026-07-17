import type { RoughSVG } from 'roughjs/bin/svg';
import { getElementCenter } from '../element/bounds';
import { FONT_FAMILY, baselineOffset, wrapText } from '../element/text';
import {
  isFreedrawElement,
  isImageElement,
  isTextElement,
  type ExcaliElement,
  type ImageElement,
  type TextElement,
} from '../element/types';
import { blobToDataUrl, getFileBlob } from './files';
import { getFreedrawPathData } from './freedraw';
import { getShape } from './roughCache';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The same transform the canvas renderer applies: rotate about the element's
 * centre, then land local (0,0) on its x,y.
 */
function transformFor(element: ExcaliElement): string {
  const center = getElementCenter(element);
  const parts = [`translate(${center.x} ${center.y})`];
  if (element.angle !== 0) parts.push(`rotate(${(element.angle * 180) / Math.PI})`);
  parts.push(`translate(${element.x - center.x} ${element.y - center.y})`);
  return parts.join(' ');
}

function textToSvg(element: TextElement, usedFamilies: Set<string>): string {
  const family = FONT_FAMILY[element.fontFamily];
  usedFamilies.add(family);

  const anchor =
    element.textAlign === 'center' ? 'middle' : element.textAlign === 'right' ? 'end' : 'start';
  const anchorX =
    element.textAlign === 'center'
      ? element.width / 2
      : element.textAlign === 'right'
        ? element.width
        : 0;

  const lines = element.containerId
    ? wrapText(element.text, element.fontSize, element.fontFamily, element.width)
    : element.text.split('\n');

  const spans = lines
    .map((line, index) => {
      const y = baselineOffset(element.fontSize, element.lineHeight, index);
      return `<text x="${anchorX}" y="${y}" font-family="${family}" font-size="${element.fontSize}px" fill="${escapeXml(element.strokeColor)}" text-anchor="${anchor}" style="white-space:pre">${escapeXml(line)}</text>`;
    })
    .join('');

  return spans;
}

async function imageToSvg(element: ImageElement): Promise<string> {
  const blob = await getFileBlob(element.fileId);
  if (!blob) return '';
  const dataUrl = await blobToDataUrl(blob);

  const [scaleX, scaleY] = element.scale;
  // Mirror via a scale about the centre; SVG cannot take a negative width.
  const flip =
    scaleX === 1 && scaleY === 1
      ? ''
      : ` transform="translate(${element.width / 2} ${element.height / 2}) scale(${scaleX} ${scaleY}) translate(${-element.width / 2} ${-element.height / 2})"`;

  return `<image href="${dataUrl}" x="0" y="0" width="${element.width}" height="${element.height}" preserveAspectRatio="none"${flip}/>`;
}

/**
 * Rough drawables are generator-agnostic, so the SVG export replays the very
 * same cached geometry the canvas drew — the two cannot drift apart.
 */
export async function renderElementToSvg(
  element: ExcaliElement,
  rc: RoughSVG,
  usedFamilies: Set<string>,
): Promise<string> {
  const opacity = element.opacity / 100;
  const wrapperOpen = `<g transform="${transformFor(element)}"${opacity < 1 ? ` opacity="${opacity}"` : ''}>`;

  let body: string;

  if (isFreedrawElement(element)) {
    body = `<path d="${getFreedrawPathData(element)}" fill="${escapeXml(element.strokeColor)}"/>`;
  } else if (isTextElement(element)) {
    body = textToSvg(element, usedFamilies);
  } else if (isImageElement(element)) {
    body = await imageToSvg(element);
  } else {
    body = getShape(element)
      .map((drawable) => rc.draw(drawable).outerHTML)
      .join('');
  }

  return `${wrapperOpen}${body}</g>`;
}
