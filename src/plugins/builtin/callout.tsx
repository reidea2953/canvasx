import { wrapText } from '../../element/text';
import type { CustomElement } from '../../element/types';
import { registerPlugin } from '../registry';
import type { ElementPlugin, PluginStylePanelProps, RenderContext } from '../types';

export type CalloutKind = 'info' | 'warning' | 'success' | 'error' | 'quote' | 'tip';

export interface CalloutData {
  kind: CalloutKind;
  text: string;
}

/**
 * Each kind carries its own accent, wash and glyph. Colour alone would leave
 * this unreadable for anyone who cannot separate red from green, so the glyph
 * is doing real work rather than decoration.
 */
const KINDS: Record<CalloutKind, { accent: string; wash: string; glyph: string; title: string }> = {
  info: { accent: '#1971c2', wash: '#e7f5ff', glyph: 'i', title: 'Info' },
  warning: { accent: '#f08c00', wash: '#fff9db', glyph: '!', title: 'Warning' },
  success: { accent: '#2f9e44', wash: '#ebfbee', glyph: '✓', title: 'Success' },
  error: { accent: '#e03131', wash: '#fff5f5', glyph: '✕', title: 'Error' },
  quote: { accent: '#868e96', wash: '#f8f9fa', glyph: '“', title: 'Quote' },
  tip: { accent: '#9c36b5', wash: '#f8f0fc', glyph: '★', title: 'Tip' },
};

const WIDTH = 320;
const HEIGHT = 96;
const PADDING = 14;
const BAR_WIDTH = 4;
const GUTTER = 30;
const FONT_SIZE = 14;
const LINE_HEIGHT = 1.45;

const CalloutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="3.4" y="5" width="13.2" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.4 5v10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M9.4 8.6h4.6M9.4 11.4h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const callout: ElementPlugin<CalloutData> = {
  id: 'callout',
  label: 'Callout',
  category: 'text',
  description: 'Info, warning, success, error, quote or tip',
  keywords: ['admonition', 'note', 'banner', 'alert', 'info', 'warning', 'tip', 'quote'],
  icon: <CalloutIcon />,
  minSize: { width: 140, height: 56 },

  create({ at }) {
    return {
      x: at.x - WIDTH / 2,
      y: at.y - HEIGHT / 2,
      width: WIDTH,
      height: HEIGHT,
      data: { kind: 'info', text: '' },
    };
  },

  searchText: (element) => `${KINDS[element.data.kind]?.title ?? ''} ${element.data.text}`,

  StylePanel: ({ element, update }: PluginStylePanelProps<CalloutData>) => (
    <fieldset className="style-group">
      <legend>Kind</legend>
      <div className="options options-wrap">
        {(Object.keys(KINDS) as CalloutKind[]).map((kind) => (
          <button
            key={kind}
            className={kind === element.data.kind ? 'option active' : 'option'}
            onClick={() => update({ kind })}
            aria-pressed={kind === element.data.kind}
            title={KINDS[kind].title}
            style={{ color: KINDS[kind].accent }}
          >
            {KINDS[kind].glyph}
          </button>
        ))}
      </div>
    </fieldset>
  ),

  editing: {
    getText: (element) => element.data.text,
    setText: (element, text) => ({ ...element.data, text }),
    editorStyle: () => ({
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      color: '#1e1e1e',
      // Left inset clears the accent bar and the icon gutter, so the overlay
      // sits exactly where render() puts the body text.
      padding: { top: PADDING + 20, right: PADDING, bottom: 6, left: BAR_WIDTH + GUTTER - 6 },
      textAlign: 'left',
      whiteSpace: 'pre-wrap',
    }),
  },

  render(element: CustomElement<CalloutData>, { ctx, isEditing }: RenderContext) {
    const kind = KINDS[element.data.kind] ?? KINDS.info;
    const { width, height } = element;
    const radius = 6;

    ctx.fillStyle = kind.wash;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, radius);
    ctx.fill();

    ctx.strokeStyle = kind.accent;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The accent bar, clipped to the rounded corners so it does not poke out.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, radius);
    ctx.clip();
    ctx.fillStyle = kind.accent;
    ctx.fillRect(0, 0, BAR_WIDTH, height);
    ctx.restore();

    ctx.fillStyle = kind.accent;
    ctx.font = `700 13px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(kind.glyph, BAR_WIDTH + 10, PADDING + 7);

    ctx.font = `600 12px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(kind.title, BAR_WIDTH + GUTTER - 6, PADDING + 7);

    // The overlay is already painting the body; the header and bar still draw.
    if (isEditing) return;

    const body = element.data.text.trim();
    const textX = BAR_WIDTH + GUTTER - 6;
    const maxWidth = width - textX - PADDING;

    ctx.font = `${FONT_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'alphabetic';

    if (body === '') {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = kind.accent;
      ctx.fillText('Double-click to write', textX, PADDING + 34);
      return;
    }

    ctx.fillStyle = '#1e1e1e';
    const lines = wrapText(body, FONT_SIZE, 2, maxWidth);
    const step = FONT_SIZE * LINE_HEIGHT;
    const top = PADDING + 26;
    const maxLines = Math.max(1, Math.floor((height - top - 6) / step));

    lines.slice(0, maxLines).forEach((line, index) => {
      ctx.fillText(line, textX, top + index * step + FONT_SIZE * 0.8);
    });
    if (lines.length > maxLines) {
      ctx.globalAlpha = 0.5;
      ctx.fillText('…', textX, top + maxLines * step + FONT_SIZE * 0.8);
    }
  },

  reviveData(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as Partial<CalloutData>;
    return {
      kind: data.kind && data.kind in KINDS ? data.kind : 'info',
      text: typeof data.text === 'string' ? data.text : '',
    };
  },
};

registerPlugin(callout);

export { KINDS as CALLOUT_KINDS };
