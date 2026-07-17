import { useEffect, useState } from 'react';
import {
  changeZOrder,
  deleteSelected,
  duplicateSelected,
  getSelectedElements,
  groupSelected,
  selectElements,
  ungroupSelected,
} from '../scene/actions';
import { copySelection, cutSelection, pasteElements } from '../scene/clipboard';
import { invalidateStatic } from '../scene/render';
import { scene } from '../scene/Scene';
import { setAppState, useAppState } from '../state/store';
import { viewportToScene } from '../utils/coords';
import { getAppState } from '../state/store';

interface MenuItem {
  label: string;
  hint?: string;
  action: () => void;
  disabled?: boolean;
}

interface Position {
  clientX: number;
  clientY: number;
}

/** Reads the clipboard on demand — permission is only prompted when used. */
async function pasteFromClipboard(at: { x: number; y: number }): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text) as { type?: string; elements?: unknown; files?: unknown };
    if (parsed.type === 'excalidraw' && Array.isArray(parsed.elements)) {
      await pasteElements({ elements: parsed.elements as never, files: parsed.files as never }, at);
    }
  } catch {
    // Clipboard read denied, or the contents were not a scene. Nothing to do.
  }
}

export function ContextMenu() {
  const [position, setPosition] = useState<Position | null>(null);
  const gridSize = useAppState((state) => state.gridSize);
  const snapEnabled = useAppState((state) => state.objectsSnapModeEnabled);

  useEffect(() => {
    const container = document.querySelector<HTMLElement>('.canvas-stack');
    if (!container) return;

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setPosition({ clientX: event.clientX, clientY: event.clientY });
    };
    const dismiss = () => setPosition(null);

    container.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('wheel', dismiss);
    return () => {
      container.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('wheel', dismiss);
    };
  }, []);

  if (!position) return null;

  const container = document.querySelector<HTMLElement>('.canvas-stack');
  const at = container
    ? viewportToScene(position.clientX, position.clientY, getAppState(), container.getBoundingClientRect())
    : { x: 0, y: 0 };

  const selected = getSelectedElements();
  const hasSelection = selected.length > 0;
  const grouped = selected.some((element) => element.groupIds.length > 0);

  // Right-clicking the canvas and right-clicking a selection are different menus.
  const items: (MenuItem | 'separator')[] = hasSelection
    ? [
        { label: 'Cut', hint: 'Ctrl+X', action: () => void cutSelection() },
        { label: 'Copy', hint: 'Ctrl+C', action: () => void copySelection() },
        { label: 'Paste', hint: 'Ctrl+V', action: () => void pasteFromClipboard(at) },
        'separator',
        { label: 'Duplicate', hint: 'Ctrl+D', action: () => duplicateSelected() },
        { label: 'Delete', hint: 'Del', action: deleteSelected },
        'separator',
        {
          label: 'Group selection',
          hint: 'Ctrl+G',
          action: groupSelected,
          disabled: selected.length < 2,
        },
        {
          label: 'Ungroup selection',
          hint: 'Ctrl+Shift+G',
          action: ungroupSelected,
          disabled: !grouped,
        },
        'separator',
        { label: 'Bring to front', hint: 'Ctrl+Shift+]', action: () => changeZOrder('front') },
        { label: 'Bring forward', hint: 'Ctrl+]', action: () => changeZOrder('forward') },
        { label: 'Send backward', hint: 'Ctrl+[', action: () => changeZOrder('backward') },
        { label: 'Send to back', hint: 'Ctrl+Shift+[', action: () => changeZOrder('back') },
      ]
    : [
        { label: 'Paste', hint: 'Ctrl+V', action: () => void pasteFromClipboard(at) },
        {
          label: 'Select all',
          hint: 'Ctrl+A',
          action: () => selectElements(scene.getNonDeleted()),
        },
        'separator',
        {
          label: gridSize ? 'Hide grid' : 'Show grid',
          action: () => {
            setAppState({ gridSize: gridSize ? null : 20 });
            invalidateStatic();
          },
        },
        {
          label: snapEnabled ? 'Disable object snap' : 'Enable object snap',
          action: () => setAppState({ objectsSnapModeEnabled: !snapEnabled }),
        },
      ];

  return (
    <div
      className="context-menu island"
      role="menu"
      // Nudged off the cursor so the first item is not under the pointer.
      style={{ left: `${position.clientX + 2}px`, top: `${position.clientY + 2}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <hr key={`separator-${index}`} />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.action();
              setPosition(null);
            }}
          >
            {item.label}
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
