import type { TokenKind } from './highlight';

/**
 * Metrics shared by the canvas renderer and the DOM editor.
 *
 * These MUST be one definition. The editor overlays a transparent textarea on a
 * coloured <pre>, and the canvas draws the same code underneath when not
 * editing — three surfaces that have to agree on font, size, line-height and
 * padding to the pixel. Two copies of these numbers would drift, and the
 * symptom is the worst kind: text that looks almost right.
 */
export const CODE_METRICS = {
  font: 'JetBrainsMono, ui-monospace, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.55,
  paddingX: 12,
  paddingY: 12,
  gutterWidth: 34,
  headerHeight: 26,
  radius: 8,
  tabSize: 2,
} as const;

export type CodeTheme = Record<TokenKind, string> & {
  bg: string;
  header: string;
  border: string;
  gutter: string;
  chrome: string;
};

/**
 * Two palettes, authored rather than derived.
 *
 * The block owns its theme independently of the canvas: a code block is a
 * quotation of an editor, and an editor does not change colour because the page
 * around it did. That is why the plugin declares darkMode: 'own'.
 */
export const THEMES: Record<'dark' | 'light', CodeTheme> = {
  dark: {
    bg: '#1e1e24',
    header: '#26262e',
    border: '#33333d',
    gutter: '#5a5a68',
    chrome: '#9a9aa8',
    plain: '#e4e4ec',
    keyword: '#c792ea',
    string: '#a5e075',
    comment: '#6b6b7b',
    number: '#f78c6c',
    punct: '#89ddff',
    type: '#82aaff',
  },
  light: {
    bg: '#fbfbfd',
    header: '#f1f1f5',
    border: '#e2e2ea',
    gutter: '#adadbd',
    chrome: '#6b6b7b',
    plain: '#24242c',
    keyword: '#8b39c4',
    string: '#2a8438',
    comment: '#9a9aa8',
    number: '#c2521a',
    punct: '#0b7285',
    type: '#1a56b8',
  },
};
