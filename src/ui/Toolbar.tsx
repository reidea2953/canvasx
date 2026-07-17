import { useRef, type ReactNode } from 'react';
import { setActiveTool } from '../scene/actions';
import { insertImage } from '../scene/clipboard';
import { getAppState, setAppState, useAppState, type ToolType } from '../state/store';
import { viewportToScene } from '../utils/coords';
import {
  ArrowIcon,
  DiamondIcon,
  DrawIcon,
  EllipseIcon,
  EraserIcon,
  HandIcon,
  ImageIcon,
  LaserIcon,
  LineIcon,
  LockIcon,
  RectangleIcon,
  SearchIcon,
  SelectionIcon,
  TextIcon,
  UnlockIcon,
} from './Icons';

interface ToolDef {
  tool: ToolType;
  label: string;
  icon: ReactNode;
  keys: string[];
}

/** Everything createImageBitmap decodes, plus SVG via the fallback path. */
export const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/avif';

const NAVIGATE: ToolDef[] = [
  { tool: 'hand', label: 'Hand', icon: <HandIcon />, keys: ['h'] },
  { tool: 'selection', label: 'Select', icon: <SelectionIcon />, keys: ['v', '1'] },
];

const DRAW: ToolDef[] = [
  { tool: 'rectangle', label: 'Rectangle', icon: <RectangleIcon />, keys: ['r', '2'] },
  { tool: 'diamond', label: 'Diamond', icon: <DiamondIcon />, keys: ['d', '3'] },
  { tool: 'ellipse', label: 'Ellipse', icon: <EllipseIcon />, keys: ['o', '4'] },
  { tool: 'arrow', label: 'Arrow', icon: <ArrowIcon />, keys: ['a', '5'] },
  { tool: 'line', label: 'Line', icon: <LineIcon />, keys: ['l', '6'] },
  { tool: 'freedraw', label: 'Draw', icon: <DrawIcon />, keys: ['p', '7'] },
  { tool: 'text', label: 'Text', icon: <TextIcon />, keys: ['t', '8'] },
];

const UTILITY: ToolDef[] = [
  { tool: 'eraser', label: 'Eraser', icon: <EraserIcon />, keys: ['e', '0'] },
  { tool: 'laser', label: 'Laser pointer', icon: <LaserIcon />, keys: ['k'] },
];

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

  const renderTool = ({ tool, label, icon, keys }: ToolDef) => (
    <button
      key={tool}
      className={tool === activeTool ? 'tool active' : 'tool'}
      onClick={() => setActiveTool(tool)}
      aria-label={`${label} — shortcut ${keys.join(' or ')}`}
      aria-pressed={tool === activeTool}
      data-tooltip={label}
      data-key={keys[keys.length - 1]}
    >
      {icon}
    </button>
  );

  return (
    <div className="toolbar island" role="toolbar" aria-label="Tools">
      {NAVIGATE.map(renderTool)}
      <span className="toolbar-divider" role="separator" />
      {DRAW.map(renderTool)}

      <button
        className="tool"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Import an image — PNG, JPG, SVG or WebP"
        data-tooltip="Image"
        data-key="9"
      >
        <ImageIcon />
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
      {UTILITY.map(renderTool)}

      <button
        className="tool"
        onClick={() => setAppState({ searchOpen: true })}
        aria-label="Search the canvas"
        data-tooltip="Search  Ctrl+F"
      >
        <SearchIcon />
      </button>

      <span className="toolbar-divider" role="separator" />
      <button
        className={toolLocked ? 'tool active' : 'tool'}
        onClick={() => setAppState({ toolLocked: !toolLocked })}
        aria-pressed={toolLocked}
        aria-label="Keep the selected tool active after drawing"
        data-tooltip={toolLocked ? 'Tool stays active' : 'Keep tool active'}
        data-key="q"
      >
        {toolLocked ? <LockIcon /> : <UnlockIcon />}
      </button>
    </div>
  );
}
