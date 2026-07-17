import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The dark-mode invert filter is written twice: once in CSS (applied to the
 * canvas layers) and once in TS (pre-applied to photos so the CSS one cancels
 * it). They must be byte-identical or the cancellation stops being exact and
 * images quietly turn into negatives — no error, no crash, just a wrong-looking
 * photo that nobody notices until a screenshot arrives.
 *
 * A comment asking future-us to keep them in sync is not a mechanism. This is.
 */
/**
 * cwd, not import.meta.url: the runner bundles each check with esbuild and runs
 * the OUTPUT from a temp directory, so import.meta.url points there rather than
 * at this source file. npm scripts always run with cwd at the package root.
 */
const root = process.cwd();

const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');
const ts = readFileSync(join(root, 'src', 'scene', 'render.ts'), 'utf8');

const failures: string[] = [];

// The filter on the canvas layers, inside the dark-theme rule.
const cssRule = /\.canvas-stack\[data-theme='dark'\]\s+\.layer\s*\{([^}]*)\}/.exec(css);
const cssFilter = cssRule ? /filter:\s*([^;]+);/.exec(cssRule[1])?.[1].trim() : undefined;

// The constant the renderer pre-applies to images.
const tsFilter = /DARK_MODE_FILTER\s*=\s*['"]([^'"]+)['"]/.exec(ts)?.[1].trim();

if (!cssFilter) failures.push('could not find the dark .layer filter in src/index.css');
if (!tsFilter) failures.push('could not find DARK_MODE_FILTER in src/scene/render.ts');

if (cssFilter && tsFilter && cssFilter !== tsFilter) {
  failures.push(
    `filters have drifted apart — photos in dark mode will render inverted\n` +
      `      css: ${cssFilter}\n` +
      `      ts:  ${tsFilter}`,
  );
}

/**
 * The cancellation is only exact for a filter whose operations are each their
 * own inverse at these parameters: invert(100%) undoes itself, and
 * hue-rotate(180deg) twice is a full 360° turn. Anything else — a brightness or
 * saturate, or a different angle — silently breaks the identity.
 */
if (tsFilter) {
  const normalized = tsFilter.replace(/\s+/g, ' ').toLowerCase();
  if (normalized !== 'invert(100%) hue-rotate(180deg)') {
    failures.push(
      `DARK_MODE_FILTER is "${tsFilter}", which is not self-inverse.\n` +
        `      F(F(x)) = x only holds for invert(100%) + hue-rotate(180deg).\n` +
        `      Changing it means images must be compensated some other way.`,
    );
  }
}

// The export path must never compensate: it has no CSS filter to cancel.
if (/renderElementsTo[\s\S]{0,400}?compensateInvert:\s*true/.test(ts)) {
  failures.push('renderElementsTo compensates for an invert it does not have — exports would be negatives');
}

console.log('dark-mode filter coupling');
console.log(`  css .layer filter:     ${cssFilter ?? '(not found)'}`);
console.log(`  DARK_MODE_FILTER:      ${tsFilter ?? '(not found)'}`);
console.log(`  identical:             ${cssFilter === tsFilter}`);
console.log(`  self-inverse:          ${tsFilter === 'invert(100%) hue-rotate(180deg)'}`);
console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
