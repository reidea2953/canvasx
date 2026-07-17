import type { ExcaliElement } from '../element/types';
import { scene } from '../scene/Scene';
import { invalidateInteractive, invalidateStatic } from '../scene/render';
import { getAppState, setAppState } from './store';

interface HistoryEntry {
  elements: ExcaliElement[];
  selectedElementIds: Record<string, true>;
  editingGroupId: string | null;
}

const MAX_ENTRIES = 100;

/**
 * Snapshot-based history, captured at interaction boundaries — never on
 * pointermove, or a single 500-point drag would become 500 undo steps.
 *
 * Section 9 of the build spec: swap this for delta-based history before adding
 * collaboration, since snapshots cannot merge with remote edits.
 */
const stack: HistoryEntry[] = [];
let index = -1;

/** Elements are mutated in place, so every entry needs its own copies. */
const cloneElements = (elements: readonly ExcaliElement[]): ExcaliElement[] =>
  elements.map((element) => ({ ...element, groupIds: [...element.groupIds] }));

function snapshot(): HistoryEntry {
  const state = getAppState();
  return {
    elements: cloneElements(scene.getNonDeleted()),
    selectedElementIds: { ...state.selectedElementIds },
    editingGroupId: state.editingGroupId,
  };
}

function apply(entry: HistoryEntry): void {
  // Clone on the way out too, so later mutations cannot corrupt the stack.
  scene.replaceAll(cloneElements(entry.elements));
  setAppState({
    selectedElementIds: { ...entry.selectedElementIds },
    editingGroupId: entry.editingGroupId,
  });
  invalidateStatic();
  invalidateInteractive();
}

/** Seed the stack with the boot state so the first undo has somewhere to land. */
export function initHistory(): void {
  stack.length = 0;
  stack.push(snapshot());
  index = 0;
}

/** Call once per completed action — on pointerup, not during the gesture. */
export function record(): void {
  // Anything after the current position is a redo branch the user just abandoned.
  stack.length = index + 1;
  stack.push(snapshot());

  if (stack.length > MAX_ENTRIES) stack.shift();
  else index++;
}

export const canUndo = (): boolean => index > 0;
export const canRedo = (): boolean => index < stack.length - 1;

export function undo(): void {
  if (!canUndo()) return;
  index--;
  apply(stack[index]);
}

export function redo(): void {
  if (!canRedo()) return;
  index++;
  apply(stack[index]);
}
