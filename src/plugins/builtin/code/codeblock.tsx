import type { CustomElement } from '../../../element/types';
import { registerPlugin } from '../../registry';
import type { ElementPlugin, PluginStylePanelProps, RenderContext } from '../../types';
import { LANGUAGES, tokenizeLine, type LanguageId, type TokenKind } from './highlight';

export interface CodeData {
  code: string;
  language: LanguageId;
  showLineNumbers: boolean;
  theme: 'dark' | 'light';
}

const FONT = 'JetBrainsMono, ui-monospace, Consolas, monospace';
const FONT_SIZE = 13;
const LINE_HEIGHT = 1.55;
const PADDING_Y = 12;
const PADDING_X = 12;
const GUTTER_WIDTH = 34;
const RADIUS = 8;
const HEADER_HEIGHT = 26;
const TAB_SPACES = 2;

const DEFAULT_WIDTH = 460;
const DEFAULT_HEIGHT = 200;

/**
 * Two palettes, authored rather than derived.
 *
 * The block owns its theme independently of the canvas: a code block is a
 * quotation of an editor, and an editor does not change colour because the page
 * around it did. That is why darkMode is 'own' below.
 */
const THEMES: Record<'dark' | 'light', Record<TokenKind, string> & {
  bg: string;
  header: string;
  border: string;
  gutter: string;
  chrome: string;
}> = {
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

const CodeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="m7.4 6.6-3.8 3.4 3.8 3.4M12.6 6.6l3.8 3.4-3.8 3.4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const labelFor = (id: LanguageId) => LANGUAGES.find((l) => l.id === id)?.label ?? 'Plain Text';

/** The x where code starts, which depends on whether the gutter is showing. */
const codeLeft = (data: CodeData) => PADDING_X + (data.showLineNumbers ? GUTTER_WIDTH : 0);

// ------------------------------------------------------------ style panel

function CodeStylePanel({ element, update }: PluginStylePanelProps<CodeData>) {
  const data = element.data;

  return (
    <>
      <fieldset className="style-group">
        <legend>Language</legend>
        <select
          className="plugin-select"
          value={data.language}
          onChange={(event) => update({ language: event.target.value as LanguageId })}
          aria-label="Code language"
        >
          {LANGUAGES.map((language) => (
            <option key={language.id} value={language.id}>
              {language.label}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset className="style-group">
        <legend>Theme</legend>
        <div className="options">
          {(['dark', 'light'] as const).map((theme) => (
            <button
              key={theme}
              className={theme === data.theme ? 'option active' : 'option'}
              onClick={() => update({ theme })}
              aria-pressed={theme === data.theme}
              title={theme === 'dark' ? 'Dark' : 'Light'}
            >
              {theme === 'dark' ? '◐' : '◑'}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="style-group">
        <legend>Options</legend>
        <div className="options">
          <button
            className={data.showLineNumbers ? 'option active' : 'option'}
            onClick={() => update({ showLineNumbers: !data.showLineNumbers })}
            aria-pressed={data.showLineNumbers}
            title="Line numbers"
          >
            #
          </button>
          <button
            className="option"
            onClick={() => void navigator.clipboard.writeText(data.code)}
            title="Copy code"
            aria-label="Copy code to clipboard"
          >
            ⧉
          </button>
        </div>
      </fieldset>
    </>
  );
}

// ---------------------------------------------------------------- plugin

const codeblock: ElementPlugin<CodeData> = {
  id: 'code-block',
  label: 'Code block',
  category: 'text',
  description: 'Syntax-highlighted, editable code',
  keywords: ['code', 'snippet', 'syntax', 'programming', 'monospace', 'pre', 'terminal'],
  icon: <CodeIcon />,
  minSize: { width: 200, height: 80 },
  // An editor does not change colour because the page around it did.
  darkMode: 'own',
  StylePanel: CodeStylePanel,

  create({ at }) {
    return {
      x: at.x - DEFAULT_WIDTH / 2,
      y: at.y - DEFAULT_HEIGHT / 2,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      data: { code: '', language: 'javascript', showLineNumbers: true, theme: 'dark' },
    };
  },

  searchText: (element) => `${labelFor(element.data.language)} ${element.data.code}`,

  editing: {
    getText: (element) => element.data.code,
    setText: (element, code) => ({ ...element.data, code }),
    tabInsertsSpaces: TAB_SPACES,
    autoIndent: true,
    editorStyle: (element) => ({
      fontFamily: FONT,
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      color: THEMES[element.data.theme].plain,
      padding: {
        top: HEADER_HEIGHT + PADDING_Y,
        right: PADDING_X,
        bottom: PADDING_Y,
        left: codeLeft(element.data),
      },
      textAlign: 'left',
      // Code must never wrap: a re-flowed line changes what the code MEANS to a
      // reader. It scrolls instead.
      whiteSpace: 'pre',
    }),
  },

  render(element: CustomElement<CodeData>, { ctx, isEditing }: RenderContext) {
    const data = element.data;
    const palette = THEMES[data.theme];
    const { width, height } = element;

    ctx.fillStyle = palette.bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, RADIUS);
    ctx.fill();

    // The header, clipped to the top corners.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, RADIUS);
    ctx.clip();
    ctx.fillStyle = palette.header;
    ctx.fillRect(0, 0, width, HEADER_HEIGHT);
    ctx.restore();

    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, width - 1, height - 1, RADIUS);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT + 0.5);
    ctx.lineTo(width, HEADER_HEIGHT + 0.5);
    ctx.stroke();

    ctx.fillStyle = palette.chrome;
    ctx.font = `11px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(labelFor(data.language), PADDING_X, HEADER_HEIGHT / 2);

    ctx.textAlign = 'right';
    ctx.fillText('⧉ copy', width - PADDING_X, HEADER_HEIGHT / 2);
    ctx.textAlign = 'left';

    // The textarea is already painting the code; drawing it here as well gives
    // doubled, offset glyphs. The chrome above still draws.
    if (isEditing) return;

    const lines = data.code === '' ? [''] : data.code.split('\n');
    const step = FONT_SIZE * LINE_HEIGHT;
    const top = HEADER_HEIGHT + PADDING_Y;
    const left = codeLeft(data);

    if (data.code === '') {
      ctx.fillStyle = palette.comment;
      ctx.font = `italic ${FONT_SIZE}px ${FONT}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('Double-click to write code', left, top + FONT_SIZE);
      return;
    }

    // Clip so long lines scroll under the padding rather than escaping the box.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_HEIGHT, width, height - HEADER_HEIGHT);
    ctx.clip();

    ctx.font = `${FONT_SIZE}px ${FONT}`;
    ctx.textBaseline = 'alphabetic';

    const visible = Math.max(0, Math.floor((height - top - PADDING_Y / 2) / step));
    let inBlockComment = false;

    lines.forEach((line, index) => {
      // Tokenizing every line even when off-screen keeps block-comment state
      // correct; only the drawing is skipped.
      const result = tokenizeLine(line, data.language, inBlockComment);
      inBlockComment = result.inBlockComment;
      if (index >= visible) return;

      const y = top + index * step + FONT_SIZE;

      if (data.showLineNumbers) {
        ctx.fillStyle = palette.gutter;
        ctx.textAlign = 'right';
        ctx.fillText(String(index + 1), PADDING_X + GUTTER_WIDTH - 10, y);
        ctx.textAlign = 'left';
      }

      // Walk the tokens, advancing x by each run's measured width. Monospace
      // would allow arithmetic, but a fallback font may not be, and drifting
      // text is worse than a few measureText calls.
      let x = left;
      for (const token of result.tokens) {
        ctx.fillStyle = palette[token.kind];
        ctx.fillText(token.text, x, y);
        x += ctx.measureText(token.text).width;
      }
    });

    if (lines.length > visible) {
      ctx.fillStyle = palette.chrome;
      ctx.font = `10px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`+${lines.length - visible} more`, width - PADDING_X, height - 6);
    }

    ctx.restore();
  },

  reviveData(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as Partial<CodeData>;
    const known = LANGUAGES.some((language) => language.id === data.language);
    return {
      code: typeof data.code === 'string' ? data.code : '',
      language: known ? data.language! : 'plaintext',
      showLineNumbers: data.showLineNumbers !== false,
      theme: data.theme === 'light' ? 'light' : 'dark',
    };
  },
};

registerPlugin(codeblock);
