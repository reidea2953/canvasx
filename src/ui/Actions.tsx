import { useSyncExternalStore } from 'react';
import {
  alignSelected,
  changeZOrder,
  deleteSelected,
  duplicateSelected,
  getSelectedElements,
  groupSelected,
  ungroupSelected,
  type AlignAxis,
} from '../scene/actions';
import { scene } from '../scene/Scene';
import { useAppState } from '../state/store';

interface ActionButtonProps {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled?: boolean;
}

function ActionButton({ label, glyph, onClick, disabled }: ActionButtonProps) {
  return (
    <button
      className="option"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

const ALIGNMENTS: { axis: AlignAxis; label: string; glyph: string }[] = [
  { axis: 'left', label: 'Align left', glyph: '⇤' },
  { axis: 'centerX', label: 'Centre horizontally', glyph: '↔' },
  { axis: 'right', label: 'Align right', glyph: '⇥' },
  { axis: 'top', label: 'Align top', glyph: '⤒' },
  { axis: 'centerY', label: 'Centre vertically', glyph: '↕' },
  { axis: 'bottom', label: 'Align bottom', glyph: '⤓' },
];

export function Actions() {
  // Elements mutate in place, so React needs the scene's revision to notice.
  useSyncExternalStore(scene.subscribe, scene.getRevision);
  useAppState((state) => state.selectedElementIds);

  const selected = getSelectedElements();
  if (selected.length === 0) return null;

  const grouped = selected.some((element) => element.groupIds.length > 0);

  return (
    <div className="actions island" role="group" aria-label="Selection actions">
      <fieldset className="style-group">
        <legend>Layers</legend>
        <div className="options">
          <ActionButton label="Send to back" glyph="⤓" onClick={() => changeZOrder('back')} />
          <ActionButton label="Send backward" glyph="↓" onClick={() => changeZOrder('backward')} />
          <ActionButton label="Bring forward" glyph="↑" onClick={() => changeZOrder('forward')} />
          <ActionButton label="Bring to front" glyph="⤒" onClick={() => changeZOrder('front')} />
        </div>
      </fieldset>

      {selected.length > 1 && (
        <fieldset className="style-group">
          <legend>Align</legend>
          <div className="options options-wrap">
            {ALIGNMENTS.map(({ axis, label, glyph }) => (
              <ActionButton
                key={axis}
                label={label}
                glyph={glyph}
                onClick={() => alignSelected(axis)}
              />
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="style-group">
        <legend>Actions</legend>
        <div className="options">
          <ActionButton
            label="Duplicate (Ctrl+D)"
            glyph="⧉"
            onClick={() => duplicateSelected()}
          />
          <ActionButton label="Delete (Del)" glyph="🗑" onClick={deleteSelected} />
          {selected.length > 1 && (
            <ActionButton label="Group (Ctrl+G)" glyph="⊞" onClick={groupSelected} />
          )}
          {grouped && (
            <ActionButton
              label="Ungroup (Ctrl+Shift+G)"
              glyph="⊟"
              onClick={ungroupSelected}
            />
          )}
        </div>
      </fieldset>
    </div>
  );
}
