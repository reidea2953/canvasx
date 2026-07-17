import { useRef } from 'react';
import { setActiveTool } from '../scene/actions';
import { insertImage } from '../scene/clipboard';
import { getAppState, setAppState, useAppState, type ToolType } from '../state/store';
import { viewportToScene } from '../utils/coords';

interface ToolDef {
  tool: ToolType;
  label: string;
  glyph: string;
  keys: string[];
}

/** Everything createImageBitmap decodes, plus SVG via the fallback path. */
export const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/avif';

const TOOLS: ToolDef[] = [
  { tool: 'hand', label: 'Hand — pan the canvas', glyph: '✋', keys: ['h'] },
  { tool: 'selection', label: 'Select', glyph: '⬉', keys: ['v', '1'] },
  { tool: 'rectangle', label: 'Rectangle', glyph: '▭', keys: ['r', '2'] },
  { tool: 'diamond', label: 'Diamond', glyph: '◇', keys: ['d', '3'] },
  { tool: 'ellipse', label: 'Ellipse', glyph: '○', keys: ['o', '4'] },
  { tool: 'arrow', label: 'Arrow', glyph: '↗', keys: ['a', '5'] },
  { tool: 'line', label: 'Line', glyph: '╱', keys: ['l', '6'] },
  { tool: 'freedraw', label: 'Draw', glyph: '✎', keys: ['p', '7'] },
  { tool: 'text', label: 'Text', glyph: 'T', keys: ['t', '8'] },
  { tool: 'eraser', label: 'Eraser', glyph: '⌫', keys: ['e', '0'] },
  { tool: 'laser', label: 'Laser pointer', glyph: '✦', keys: ['k'] },
];

/** Tools that only make sense in a group, kept visually apart. */
const PRIMARY_COUNT = 2;

/** Key handling lives in useGlobalShortcuts — this is display and click only. */
export function Toolbar() {
  const activeTool = useAppState((state) => state.activeTool);
  const toolLocked = useAppState((state) => state.toolLocked);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onImageChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset first, so re-picking the same file still fires a change event.
    event.target.value = '';
    if (!file) return;

    const container = document.querySelector<HTMLElement>('.canvas-stack');
    if (!container) return;
    const rect = container.getBoundingClientRect();

    // Land it in the middle of what the user is currently looking at.
    const at = viewportToScene(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      getAppState(),
      rect,
    );
    await insertImage(file, at, { width: rect.width, height: rect.height });
  };

  const renderTool = ({ tool, label, glyph, keys }: ToolDef) => (
    <button
      key={tool}
      className={tool === activeTool ? 'tool active' : 'tool'}
      onClick={() => setActiveTool(tool)}
      aria-label={`${label} — shortcut ${keys.join(' or ')}`}
      aria-pressed={tool === activeTool}
      data-tooltip={`${label}  ${keys.join(' / ')}`}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );

  return (
    <div className="toolbar island" role="toolbar" aria-label="Tools">
      {TOOLS.slice(0, PRIMARY_COUNT).map(renderTool)}
      <span className="toolbar-divider" role="separator" />
      {TOOLS.slice(PRIMARY_COUNT).map(renderTool)}

      <button
        className="tool"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Import an image — PNG, JPG, SVG or WebP"
        data-tooltip="Import image  9"
      >
        <span aria-hidden="true">🖼</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        onChange={onImageChosen}
        style={{ display: 'none' }}
        tabIndex={-1}
        aria-hidden="true"
      />

      <span className="toolbar-divider" role="separator" />
      <button
        className={toolLocked ? 'tool active' : 'tool'}
        onClick={() => setAppState({ toolLocked: !toolLocked })}
        aria-pressed={toolLocked}
        aria-label="Keep the selected tool active after drawing"
        data-tooltip={`Keep tool active  q`}
      >
        <span aria-hidden="true">{toolLocked ? '🔒' : '🔓'}</span>
      </button>
    </div>
  );
}
