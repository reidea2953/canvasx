import { FONT_FAMILY, wrapText } from '../../element/text';
import type { CustomElement } from '../../element/types';
import type { FontFamily } from '../../state/store';
import { registerPlugin } from '../registry';
import type { ElementPlugin, PluginStylePanelProps, RenderContext } from '../types';

export type StickyColor = 'yellow' | 'pink' | 'blue' | 'green' | 'orange' | 'purple' | 'white';

export interface StickyData {
  text: string;
  color: StickyColor;
  fontFamily: FontFamily;
  fontSize: number;
  textColor: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
}

interface Paper {
  light: { paper: string; edge: string; ink: string };
  /**
   * Authored separately rather than derived. An algorithmic darkening of these
   * pastels lands on mud; a real sticky in dark mode is a saturated, low-value
   * version of itself, and that is a judgement, not a formula.
   */
  dark: { paper: string; edge: string; ink: string };
}

export const STICKY_PALETTE: Record<StickyColor, Paper> = {
  yellow: {
    light: { paper: '#fff3bf', edge: '#f2e08c', ink: '#5c4813' },
    dark: { paper: '#4a3d0f', edge: '#6b5915', ink: '#ffe89e' },
  },
  pink: {
    light: { paper: '#ffdeeb', edge: '#f7c4da', ink: '#6b2843' },
    dark: { paper: '#4d1f31', edge: '#6e2d47', ink: '#ffc9de' },
  },
  blue: {
    light: { paper: '#d0ebff', edge: '#a8d5f5', ink: '#123a5c' },
    dark: { paper: '#12354f', edge: '#1c4d70', ink: '#a9d9ff' },
  },
  green: {
    light: { paper: '#d3f9d8', edge: '#aeeab6', ink: '#1f4d29' },
    dark: { paper: '#173d20', edge: '#22572e', ink: '#a9e8b5' },
  },
  orange: {
    light: { paper: '#ffe8cc', edge: '#f7cfa3', ink: '#6b3410' },
    dark: { paper: '#4f2c10', edge: '#6f3f18', ink: '#ffcf9e' },
  },
  purple: {
    light: { paper: '#e5dbff', edge: '#cbbcf7', ink: '#3c2a68' },
    dark: { paper: '#332352', edge: '#4a3374', ink: '#d5c6ff' },
  },
  white: {
    light: { paper: '#ffffff', edge: '#e0e0e0', ink: '#2b2b2b' },
    dark: { paper: '#2a2a2a', edge: '#3d3d3d', ink: '#ededed' },
  },
};

const SIZE = 180;
export const STICKY_PADDING = 16;
const RADIUS = 6;

export const STICKY_FONT_SIZES = [12, 16, 20, 28] as const;

const StickyIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M3.6 4.4a1 1 0 0 1 1-1h10.8a1 1 0 0 1 1 1v7L12 16.6H4.6a1 1 0 0 1-1-1z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    {/* The turned-up corner is what makes it read as a sticky, not a box. */}
    <path d="M16.4 11.4H12v4.8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const paperOf = (data: StickyData, dark: boolean) =>
  (STICKY_PALETTE[data.color] ?? STICKY_PALETTE.yellow)[dark ? 'dark' : 'light'];

const fontStringFor = (data: StickyData, scale = 1): string =>
  `${data.italic ? 'italic ' : ''}${data.bold ? '700 ' : ''}${data.fontSize * scale}px ${
    FONT_FAMILY[data.fontFamily]
  }, sans-serif`;

// ------------------------------------------------------------ style panel

const SWATCH_ORDER: StickyColor[] = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white'];
const TEXT_COLORS = [null, '#1e1e1e', '#e03131', '#1971c2', '#2f9e44', '#f08c00'];

function StickyStylePanel({ element, update }: PluginStylePanelProps<StickyData>) {
  const data = element.data;

  return (
    <>
      <fieldset className="style-group">
        <legend>Sticky colour</legend>
        <div className="swatches">
          {SWATCH_ORDER.map((color) => (
            <button
              key={color}
              className={color === data.color ? 'swatch active' : 'swatch'}
              style={{
                background: STICKY_PALETTE[color].light.paper,
                borderColor: STICKY_PALETTE[color].light.edge,
              }}
              onClick={() => update({ color })}
              aria-label={color}
              aria-pressed={color === data.color}
              title={color}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="style-group">
        <legend>Text colour</legend>
        <div className="swatches">
          {TEXT_COLORS.map((color) => (
            <button
              key={color ?? 'auto'}
              className={color === data.textColor ? 'swatch active' : 'swatch'}
              style={color ? { background: color, borderColor: color } : undefined}
              data-transparent={color === null || undefined}
              onClick={() => update({ textColor: color })}
              aria-label={color ?? 'Match the sticky'}
              aria-pressed={color === data.textColor}
              // null follows the paper, which is what keeps contrast right in
              // both themes without the user thinking about it.
              title={color ?? 'Auto'}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="style-group">
        <legend>Font</legend>
        <div className="options">
          {([1, 2, 3] as FontFamily[]).map((family) => (
            <button
              key={family}
              className={family === data.fontFamily ? 'option active' : 'option'}
              onClick={() => update({ fontFamily: family })}
              aria-pressed={family === data.fontFamily}
              title={['Hand-drawn', 'Normal', 'Code'][family - 1]}
            >
              {['✍', 'A', '⌨'][family - 1]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="style-group">
        <legend>Font size</legend>
        <div className="options">
          {STICKY_FONT_SIZES.map((size, index) => (
            <button
              key={size}
              className={size === data.fontSize ? 'option active' : 'option'}
              onClick={() => update({ fontSize: size })}
              aria-pressed={size === data.fontSize}
              title={['Small', 'Medium', 'Large', 'Extra large'][index]}
            >
              {['S', 'M', 'L', 'XL'][index]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="style-group">
        <legend>Style</legend>
        <div className="options">
          <button
            className={data.bold ? 'option active' : 'option'}
            onClick={() => update({ bold: !data.bold })}
            aria-pressed={data.bold}
            title="Bold"
            style={{ fontWeight: 700 }}
          >
            B
          </button>
          <button
            className={data.italic ? 'option active' : 'option'}
            onClick={() => update({ italic: !data.italic })}
            aria-pressed={data.italic}
            title="Italic"
            style={{ fontStyle: 'italic' }}
          >
            I
          </button>
          <button
            className={data.underline ? 'option active' : 'option'}
            onClick={() => update({ underline: !data.underline })}
            aria-pressed={data.underline}
            title="Underline"
            style={{ textDecoration: 'underline' }}
          >
            U
          </button>
        </div>
      </fieldset>

      <fieldset className="style-group">
        <legend>Align</legend>
        <div className="options">
          {(['left', 'center', 'right'] as const).map((align, index) => (
            <button
              key={align}
              className={align === data.align ? 'option active' : 'option'}
              onClick={() => update({ align })}
              aria-pressed={align === data.align}
              title={['Left', 'Centre', 'Right'][index]}
            >
              {['⇤', '↔', '⇥'][index]}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

// ---------------------------------------------------------------- plugin

const sticky: ElementPlugin<StickyData> = {
  id: 'sticky',
  label: 'Sticky note',
  category: 'basic',
  description: 'A note you can pile ideas onto',
  keywords: ['note', 'postit', 'post-it', 'memo', 'idea', 'brainstorm', 'figjam'],
  icon: <StickyIcon />,
  minSize: { width: 80, height: 80 },
  // Its colour is the whole point; a yellow sticky must not invert to brown.
  darkMode: 'own',
  StylePanel: StickyStylePanel,

  create({ at }) {
    return {
      x: at.x - SIZE / 2,
      y: at.y - SIZE / 2,
      width: SIZE,
      height: SIZE,
      data: {
        text: '',
        color: 'yellow',
        fontFamily: 1,
        fontSize: 16,
        textColor: null,
        bold: false,
        italic: false,
        underline: false,
        align: 'left',
      },
    };
  },

  searchText: (element) => element.data.text,

  editing: {
    getText: (element) => element.data.text,
    setText: (element, text) => ({ ...element.data, text }),
    editorStyle: (element) => {
      const data = element.data;
      // Light ink: the overlay sits on the light-rendered paper, and the canvas
      // filter inverts BOTH together in dark mode, so authoring for light keeps
      // them matched.
      const ink = data.textColor ?? paperOf(data, false).ink;
      return {
        fontFamily: `${FONT_FAMILY[data.fontFamily]}, sans-serif`,
        fontSize: data.fontSize,
        lineHeight: 1.35,
        color: ink,
        padding: {
          top: STICKY_PADDING,
          right: STICKY_PADDING,
          bottom: STICKY_PADDING,
          left: STICKY_PADDING,
        },
        textAlign: data.align,
        fontWeight: data.bold ? 700 : 400,
        fontStyle: data.italic ? 'italic' : 'normal',
        textDecoration: data.underline ? 'underline' : 'none',
        whiteSpace: 'pre-wrap',
      };
    },
  },

  render(element: CustomElement<StickyData>, { ctx, dark, isEditing }: RenderContext) {
    const data = element.data;
    const paper = paperOf(data, dark);
    const { width, height } = element;

    // A soft drop shadow is what sells "paper resting on the canvas".
    ctx.save();
    ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.16)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = paper.paper;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, RADIUS);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = paper.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, width - 1, height - 1, RADIUS);
    ctx.stroke();

    // The textarea is already painting these glyphs; drawing them here too gives
    // doubled, offset text.
    if (isEditing) return;

    const ink = data.textColor ?? paper.ink;
    const text = data.text;

    if (text.trim() === '') {
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.4;
      ctx.font = `italic ${data.fontSize}px ${FONT_FAMILY[data.fontFamily]}, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText('Double-click to write', STICKY_PADDING, STICKY_PADDING);
      return;
    }

    ctx.fillStyle = ink;
    ctx.font = fontStringFor(data);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = data.align;

    const maxWidth = width - STICKY_PADDING * 2;
    const lines = wrapText(text, data.fontSize, data.fontFamily, maxWidth);
    const step = data.fontSize * 1.35;
    // Clip rather than overflow: a note spilling past its own paper looks
    // broken, and resizing is the obvious fix the user can see they need.
    const maxLines = Math.max(1, Math.floor((height - STICKY_PADDING * 2) / step));
    const anchorX =
      data.align === 'center' ? width / 2 : data.align === 'right' ? width - STICKY_PADDING : STICKY_PADDING;

    lines.slice(0, maxLines).forEach((line, index) => {
      const y = STICKY_PADDING + index * step + data.fontSize * 0.8;
      ctx.fillText(line, anchorX, y);

      if (data.underline) {
        const runWidth = ctx.measureText(line).width;
        const startX =
          data.align === 'center'
            ? anchorX - runWidth / 2
            : data.align === 'right'
              ? anchorX - runWidth
              : anchorX;
        ctx.fillRect(startX, y + 2, runWidth, Math.max(1, data.fontSize / 16));
      }
    });

    if (lines.length > maxLines) {
      ctx.globalAlpha = 0.5;
      ctx.fillText('…', anchorX, STICKY_PADDING + maxLines * step + data.fontSize * 0.8);
    }
  },

  reviveData(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as Partial<StickyData>;
    return {
      text: typeof data.text === 'string' ? data.text : '',
      color: data.color && data.color in STICKY_PALETTE ? data.color : 'yellow',
      fontFamily: data.fontFamily === 2 || data.fontFamily === 3 ? data.fontFamily : 1,
      fontSize: typeof data.fontSize === 'number' && data.fontSize > 0 ? data.fontSize : 16,
      textColor: typeof data.textColor === 'string' ? data.textColor : null,
      bold: data.bold === true,
      italic: data.italic === true,
      underline: data.underline === true,
      align: data.align === 'center' || data.align === 'right' ? data.align : 'left',
    };
  },
};

registerPlugin(sticky);
