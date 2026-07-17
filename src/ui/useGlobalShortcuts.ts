import { useEffect } from 'react';
import {
  changeZOrder,
  deleteSelected,
  deselectAll,
  duplicateSelected,
  groupSelected,
  selectElements,
  setActiveTool,
  ungroupSelected,
} from '../scene/actions';
import { copySelection, cutSelection } from '../scene/clipboard';
import { DEFAULT_EXPORT, downloadBlob, exportSceneFile, exportToPng } from '../scene/export';
import { invalidateInteractive } from '../scene/render';
import { scene } from '../scene/Scene';
import { resetZoom } from '../scene/viewport';
import { redo, undo } from '../state/history';
import { getAppState, setAppState, type ToolType } from '../state/store';

const TOOL_KEYS: Record<string, ToolType> = {
  v: 'selection', '1': 'selection',
  r: 'rectangle', '2': 'rectangle',
  d: 'diamond', '3': 'diamond',
  o: 'ellipse', '4': 'ellipse',
  a: 'arrow', '5': 'arrow',
  l: 'line', '6': 'line',
  p: 'freedraw', '7': 'freedraw',
  t: 'text', '8': 'text',
  e: 'eraser', '0': 'eraser',
  k: 'laser',
  h: 'hand',
};

/** Keys must never be stolen from a field the user is typing in. */
const isTypingTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  return (
    !!element &&
    (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName))
  );
};

/**
 * Single owner of the keyboard. Tool keys live here too, rather than in the
 * toolbar, so there is one place to reason about precedence.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (modifier) {
        switch (key) {
          case 'f':
            // Take Ctrl+F from the browser: our canvas text is painted pixels,
            // so the native find bar can never see any of it.
            event.preventDefault();
            setAppState({ searchOpen: true });
            return;
          case 'z':
            event.preventDefault();
            event.shiftKey ? redo() : undo();
            return;
          case 'c':
            // Let the browser's own copy run if the user is selecting real text.
            if (window.getSelection()?.toString()) return;
            event.preventDefault();
            void copySelection();
            return;
          case 'x':
            if (window.getSelection()?.toString()) return;
            event.preventDefault();
            void cutSelection();
            return;
          case 's':
            event.preventDefault();
            void exportSceneFile();
            return;
          case 'e':
            if (!event.shiftKey) return;
            event.preventDefault();
            void (async () => {
              const blob = await exportToPng(scene.getNonDeleted(), DEFAULT_EXPORT);
              if (blob) downloadBlob(blob, 'scene.png');
            })();
            return;
          case 'y':
            event.preventDefault();
            redo();
            return;
          case 'd':
            event.preventDefault();
            duplicateSelected();
            return;
          case 'g':
            event.preventDefault();
            event.shiftKey ? ungroupSelected() : groupSelected();
            return;
          case 'a':
            event.preventDefault();
            selectElements(scene.getNonDeleted());
            return;
          case '0':
            event.preventDefault();
            {
              const container = document.querySelector<HTMLElement>('.canvas-stack');
              if (container) resetZoom(container);
            }
            return;
          case ']':
            event.preventDefault();
            changeZOrder(event.shiftKey ? 'front' : 'forward');
            return;
          case '[':
            event.preventDefault();
            changeZOrder(event.shiftKey ? 'back' : 'backward');
            return;
          default:
            return;
        }
      }

      if (event.altKey) {
        // Alt+/ toggles the stats panel.
        if (key === '/') {
          event.preventDefault();
          setAppState((previous) => ({ statsOpen: !previous.statsOpen }));
        }
        return;
      }

      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (key === 'escape') {
        // Step out one level at a time: point editor, then group, then selection.
        const state = getAppState();
        if (state.editingLinearElementId) setAppState({ editingLinearElementId: null });
        else if (state.editingGroupId) setAppState({ editingGroupId: null });
        else deselectAll();
        invalidateInteractive();
        return;
      }

      if (key === 'q') {
        setAppState((previous) => ({ toolLocked: !previous.toolLocked }));
        return;
      }

      // setActiveTool, not setAppState: switching tool is one of the few things
      // allowed to drop a selection, and that rule lives in one place.
      const tool = TOOL_KEYS[key];
      if (tool) setActiveTool(tool);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
