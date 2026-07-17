import { useSyncExternalStore } from 'react';
import { getUnrotatedBounds } from '../element/bounds';
import { mutateElement } from '../element/mutate';
import { getSelectedElements } from '../scene/actions';
import { invalidateInteractive, invalidateStatic } from '../scene/render';
import { scene } from '../scene/Scene';
import { record } from '../state/history';
import { setAppState, useAppState } from '../state/store';

interface FieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  step?: number;
}

function Field({ label, value, onCommit, step = 1 }: FieldProps) {
  return (
    <label className="stat-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        // Rounded for display; the underlying value keeps its precision until edited.
        value={Math.round(value * 100) / 100}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onCommit(next);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </label>
  );
}

export function StatsPanel() {
  const open = useAppState((state) => state.statsOpen);
  useAppState((state) => state.selectedElementIds);
  // Elements mutate in place, so React needs the scene's revision to notice.
  useSyncExternalStore(scene.subscribe, scene.getRevision);

  if (!open) return null;

  const selected = getSelectedElements();
  const single = selected.length === 1 ? selected[0] : null;

  const commit = (patch: Parameters<typeof mutateElement>[1]) => {
    if (!single) return;
    mutateElement(single, patch);
    scene.emit();
    invalidateStatic();
    invalidateInteractive();
    record();
  };

  const bounds = single ? getUnrotatedBounds(single) : null;

  return (
    <aside className="stats-panel island" aria-label="Stats">
      <div className="stats-header">
        <span>Stats</span>
        <button
          onClick={() => setAppState({ statsOpen: false })}
          aria-label="Close stats"
          title="Close (Alt+/)"
        >
          ✕
        </button>
      </div>

      <dl className="stats-rows">
        <div>
          <dt>Elements</dt>
          <dd>{scene.getNonDeleted().length}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>{selected.length}</dd>
        </div>
      </dl>

      {single && bounds && (
        <>
          <hr />
          <div className="stat-grid">
            <Field label="X" value={bounds.minX} onCommit={(x) => commit({ x: single.x + (x - bounds.minX) })} />
            <Field label="Y" value={bounds.minY} onCommit={(y) => commit({ y: single.y + (y - bounds.minY) })} />
            <Field
              label="W"
              value={single.width}
              onCommit={(width) => commit({ width: Math.max(0, width) })}
            />
            <Field
              label="H"
              value={single.height}
              onCommit={(height) => commit({ height: Math.max(0, height) })}
            />
            <Field
              label="A°"
              value={(single.angle * 180) / Math.PI}
              onCommit={(degrees) => commit({ angle: (degrees * Math.PI) / 180 })}
            />
          </div>
          <p className="stats-note">
            W/H set the element's own box. For lines and drawings that is the
            extent of their points, so editing it scales them.
          </p>
        </>
      )}
    </aside>
  );
}
