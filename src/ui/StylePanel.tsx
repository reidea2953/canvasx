import { useSyncExternalStore } from 'react';
import {
  applyPluginData,
  applyStyleToSelected,
  applyTextStyleTo,
  getSelectedElements,
  type TextStylePatch,
} from '../scene/actions';
import { getPluginFor } from '../plugins/registry';
import { scene } from '../scene/Scene';
import { getBoundTextElement } from '../element/container';
import {
  isCustomElement,
  isLinearElement,
  isLinearType,
  isShapeType,
  isTextElement,
  type Arrowhead,
  type TextElement,
} from '../element/types';
import { setAppState, useAppState, type AppState } from '../state/store';

const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];
const BACKGROUND_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99'];

interface SwatchRowProps {
  label: string;
  colors: string[];
  value: string;
  onChange: (color: string) => void;
}

function SwatchRow({ label, colors, value, onChange }: SwatchRowProps) {
  return (
    <fieldset className="style-group">
      <legend>{label}</legend>
      <div className="swatches">
        {colors.map((color) => (
          <button
            key={color}
            className={color === value ? 'swatch active' : 'swatch'}
            style={color === 'transparent' ? undefined : { background: color, borderColor: color }}
            data-transparent={color === 'transparent' || undefined}
            onClick={() => onChange(color)}
            aria-label={color === 'transparent' ? 'Transparent' : color}
            aria-pressed={color === value}
            title={color}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface OptionRowProps<T extends string | number> {
  label: string;
  options: { value: T; label: string; glyph: string }[];
  value: T;
  onChange: (value: T) => void;
}

function OptionRow<T extends string | number>({ label, options, value, onChange }: OptionRowProps<T>) {
  return (
    <fieldset className="style-group">
      <legend>{label}</legend>
      <div className="options">
        {options.map((option) => (
          <button
            key={String(option.value)}
            className={option.value === value ? 'option active' : 'option'}
            onClick={() => onChange(option.value)}
            aria-label={option.label}
            aria-pressed={option.value === value}
            title={option.label}
          >
            <span aria-hidden="true">{option.glyph}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const ARROWHEAD_OPTIONS: { value: Arrowhead | null; label: string; glyph: string }[] = [
  { value: null, label: 'None', glyph: '—' },
  { value: 'arrow', label: 'Arrow', glyph: '→' },
  { value: 'triangle', label: 'Triangle', glyph: '▶' },
  { value: 'bar', label: 'Bar', glyph: '⊣' },
  { value: 'dot', label: 'Dot', glyph: '●' },
];

/** Separate from OptionRow because null is a real choice here, not "unset". */
function ArrowheadRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Arrowhead | null;
  onChange: (value: Arrowhead | null) => void;
}) {
  return (
    <fieldset className="style-group">
      <legend>{label}</legend>
      <div className="options">
        {ARROWHEAD_OPTIONS.map((option) => (
          <button
            key={option.label}
            className={option.value === value ? 'option active' : 'option'}
            onClick={() => onChange(option.value)}
            aria-label={option.label}
            aria-pressed={option.value === value}
            title={option.label}
          >
            <span aria-hidden="true">{option.glyph}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function StylePanel() {
  const activeTool = useAppState((state) => state.activeTool);
  const state = useAppState((s) => s);
  // Elements mutate in place, so React needs the scene's revision to notice.
  useSyncExternalStore(scene.subscribe, scene.getRevision);

  const selected = getSelectedElements();
  const showForTool =
    isShapeType(activeTool) || isLinearType(activeTool) || activeTool === 'text' || activeTool === 'freedraw';
  if (!showForTool && selected.length === 0) return null;

  /**
   * A single selected plugin element shows its OWN controls instead of the
   * generic ones — a sticky's colour swatches and a code block's language menu
   * have nothing to do with stroke width.
   *
   * This panel never learns which plugins exist; it renders whatever component
   * the plugin registered.
   */
  const solo = selected.length === 1 ? selected[0] : null;
  if (solo && isCustomElement(solo)) {
    const plugin = getPluginFor(solo);
    if (plugin?.StylePanel) {
      const Panel = plugin.StylePanel;
      return (
        <aside className="style-panel island" aria-label={`${plugin.label} options`}>
          <Panel
            element={solo as never}
            update={(patch) => applyPluginData(solo, patch as Record<string, unknown>)}
          />
          <fieldset className="style-group">
            <legend>Opacity</legend>
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={solo.opacity}
              onChange={(event) => applyStyleToSelected({ opacity: Number(event.target.value) })}
              aria-label="Opacity"
            />
          </fieldset>
        </aside>
      );
    }
  }

  // Arrowheads only apply to arrows, so only offer them when arrows are in play.
  const showArrowheads =
    activeTool === 'arrow' || selected.some((element) => element.type === 'arrow');
  const arrowSource = selected.find((element) => element.type === 'arrow');
  const readArrowhead = (which: 'start' | 'end'): Arrowhead | null => {
    if (arrowSource && isLinearElement(arrowSource)) {
      return which === 'start' ? arrowSource.startArrowhead : arrowSource.endArrowhead;
    }
    return which === 'start' ? state.currentItemStartArrowhead : state.currentItemEndArrowhead;
  };

  // Font controls appear for the text tool and for any selected text —
  // including a label bound inside a selected shape.
  const textSource =
    selected.find(isTextElement) ??
    selected.map((element) => getBoundTextElement(element)).find((label) => label !== null) ??
    null;
  const showText = activeTool === 'text' || textSource !== null;

  const readText = <K extends keyof AppState>(
    fromElement: (element: TextElement) => AppState[K],
    key: K,
  ): AppState[K] => (textSource ? fromElement(textSource) : state[key]);

  /** Text style must reach a bound label even when the container is selected. */
  const applyTextStyle = (patch: TextStylePatch) => {
    const targets = new Set<TextElement>();
    for (const element of selected) {
      if (isTextElement(element)) targets.add(element);
      const label = getBoundTextElement(element);
      if (label) targets.add(label);
    }
    if (targets.size === 0) return;
    applyTextStyleTo([...targets], patch);
  };

  /**
   * With a selection, the panel reflects what is selected (taking the first
   * element as representative of a mixed set). With only a tool active, it
   * reflects the style the next element will be created with.
   */
  const source = selected[0];
  const read = <K extends keyof AppState>(
    fromElement: (element: NonNullable<typeof source>) => AppState[K],
    key: K,
  ): AppState[K] => (source ? fromElement(source) : state[key]);

  /** Every edit updates the default AND applies to whatever is selected. */
  const commit = (patch: Partial<AppState>, elementPatch: Record<string, unknown>) => {
    setAppState(patch);
    applyStyleToSelected(elementPatch);
  };

  const backgroundColor = read((element) => element.backgroundColor, 'currentItemBackgroundColor');

  return (
    <aside className="style-panel island" aria-label="Element styles">
      <SwatchRow
        label="Stroke"
        colors={STROKE_COLORS}
        value={read((element) => element.strokeColor, 'currentItemStrokeColor')}
        onChange={(color) =>
          commit({ currentItemStrokeColor: color }, { strokeColor: color })
        }
      />
      <SwatchRow
        label="Background"
        colors={BACKGROUND_COLORS}
        value={backgroundColor}
        onChange={(color) =>
          commit({ currentItemBackgroundColor: color }, { backgroundColor: color })
        }
      />

      {backgroundColor !== 'transparent' && (
        <OptionRow
          label="Fill"
          value={read((element) => element.fillStyle, 'currentItemFillStyle')}
          onChange={(value) => commit({ currentItemFillStyle: value }, { fillStyle: value })}
          options={[
            { value: 'hachure', label: 'Hachure', glyph: '╱' },
            { value: 'cross-hatch', label: 'Cross-hatch', glyph: '╳' },
            { value: 'solid', label: 'Solid', glyph: '■' },
            { value: 'zigzag', label: 'Zigzag', glyph: '⩘' },
          ]}
        />
      )}

      <OptionRow
        label="Stroke width"
        value={read((element) => element.strokeWidth, 'currentItemStrokeWidth')}
        onChange={(value) => commit({ currentItemStrokeWidth: value }, { strokeWidth: value })}
        options={[
          { value: 1, label: 'Thin', glyph: '—' },
          { value: 2, label: 'Bold', glyph: '━' },
          { value: 4, label: 'Extra bold', glyph: '█' },
        ]}
      />

      <OptionRow
        label="Stroke style"
        value={read((element) => element.strokeStyle, 'currentItemStrokeStyle')}
        onChange={(value) => commit({ currentItemStrokeStyle: value }, { strokeStyle: value })}
        options={[
          { value: 'solid', label: 'Solid', glyph: '—' },
          { value: 'dashed', label: 'Dashed', glyph: '╌' },
          { value: 'dotted', label: 'Dotted', glyph: '⋯' },
        ]}
      />

      <OptionRow
        label="Sloppiness"
        value={read((element) => element.roughness, 'currentItemRoughness')}
        onChange={(value) => commit({ currentItemRoughness: value }, { roughness: value })}
        options={[
          { value: 0, label: 'Architect', glyph: '│' },
          { value: 1, label: 'Artist', glyph: '⌇' },
          { value: 2, label: 'Cartoonist', glyph: '⌁' },
        ]}
      />

      {showArrowheads && (
        <>
          <ArrowheadRow
            label="Arrowhead start"
            value={readArrowhead('start')}
            onChange={(value) => {
              setAppState({ currentItemStartArrowhead: value });
              applyStyleToSelected({ startArrowhead: value });
            }}
          />
          <ArrowheadRow
            label="Arrowhead end"
            value={readArrowhead('end')}
            onChange={(value) => {
              setAppState({ currentItemEndArrowhead: value });
              applyStyleToSelected({ endArrowhead: value });
            }}
          />
        </>
      )}

      {showText && (
        <>
          <OptionRow
            label="Font"
            value={readText((element) => element.fontFamily, 'currentItemFontFamily')}
            onChange={(value) => {
              setAppState({ currentItemFontFamily: value });
              applyTextStyle({ fontFamily: value });
            }}
            options={[
              { value: 1, label: 'Hand-drawn', glyph: '✍' },
              { value: 2, label: 'Normal', glyph: 'A' },
              { value: 3, label: 'Code', glyph: '⌨' },
            ]}
          />
          <OptionRow
            label="Font size"
            value={readText((element) => element.fontSize, 'currentItemFontSize')}
            onChange={(value) => {
              setAppState({ currentItemFontSize: value });
              applyTextStyle({ fontSize: value });
            }}
            options={[
              { value: 16, label: 'Small', glyph: 'S' },
              { value: 20, label: 'Medium', glyph: 'M' },
              { value: 28, label: 'Large', glyph: 'L' },
              { value: 36, label: 'Extra large', glyph: 'XL' },
            ]}
          />
          <OptionRow
            label="Text align"
            value={readText((element) => element.textAlign, 'currentItemTextAlign')}
            onChange={(value) => {
              setAppState({ currentItemTextAlign: value });
              applyTextStyle({ textAlign: value });
            }}
            options={[
              { value: 'left', label: 'Left', glyph: '⇤' },
              { value: 'center', label: 'Centre', glyph: '↔' },
              { value: 'right', label: 'Right', glyph: '⇥' },
            ]}
          />
        </>
      )}

      <fieldset className="style-group">
        <legend>Opacity</legend>
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={read((element) => element.opacity, 'currentItemOpacity')}
          onChange={(event) => {
            const opacity = Number(event.target.value);
            commit({ currentItemOpacity: opacity }, { opacity });
          }}
          aria-label="Opacity"
        />
      </fieldset>
    </aside>
  );
}
