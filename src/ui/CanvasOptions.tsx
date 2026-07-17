import { useSyncExternalStore } from 'react';
import { invalidateStatic } from '../scene/render';
import { scene } from '../scene/Scene';
import { canRedo, canUndo, redo, undo } from '../state/history';
import { setAppState, useAppState } from '../state/store';

const DEFAULT_GRID_SIZE = 20;

export function CanvasOptions() {
  const gridSize = useAppState((state) => state.gridSize);
  const snapEnabled = useAppState((state) => state.objectsSnapModeEnabled);

  // Undo availability changes with the scene, which React cannot see directly.
  useSyncExternalStore(scene.subscribe, scene.getRevision);

  return (
    <div className="canvas-options island" role="group" aria-label="Canvas options">
      <button
        className="option"
        onClick={undo}
        disabled={!canUndo()}
        aria-label="Undo (Ctrl+Z)"
        title="Undo (Ctrl+Z)"
      >
        <span aria-hidden="true">↺</span>
      </button>
      <button
        className="option"
        onClick={redo}
        disabled={!canRedo()}
        aria-label="Redo (Ctrl+Shift+Z)"
        title="Redo (Ctrl+Shift+Z)"
      >
        <span aria-hidden="true">↻</span>
      </button>

      <span className="toolbar-divider" />

      <button
        className={gridSize ? 'option active' : 'option'}
        onClick={() => {
          setAppState({ gridSize: gridSize ? null : DEFAULT_GRID_SIZE });
          invalidateStatic();
        }}
        aria-pressed={gridSize !== null}
        aria-label="Toggle grid and grid snapping"
        title="Grid (snaps while on)"
      >
        <span aria-hidden="true">#</span>
      </button>
      <button
        className={snapEnabled ? 'option active' : 'option'}
        onClick={() => setAppState({ objectsSnapModeEnabled: !snapEnabled })}
        aria-pressed={snapEnabled}
        aria-label="Toggle snapping to other objects"
        title="Snap to objects"
      >
        <span aria-hidden="true">⌖</span>
      </button>
    </div>
  );
}
