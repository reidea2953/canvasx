import { onElementsDeleted } from '../element/binding';
import { getElementBounds } from '../element/bounds';
import { getContainerOf, redrawBoundText } from '../element/container';
import { duplicateElement } from '../element/factory';
import { measureText } from '../element/text';
import { elementsInGroup, makeGroupContiguous, newGroupId, outermostGroupId } from '../element/groups';
import { mutateElement } from '../element/mutate';
import {
  isCustomElement,
  isLinearElement,
  type BaseElement,
  type ExcaliElement,
  type LinearElement,
  type TextElement,
} from '../element/types';
import { record } from '../state/history';
import { getAppState, setAppState, type ToolType } from '../state/store';
import { invalidateInteractive, invalidateStatic } from './render';
import { scene } from './Scene';

/**
 * The single entry point for changing tool.
 *
 * A selection survives moving, resizing, rotating and styling — it is dropped
 * only by clicking empty canvas, Escape, an explicit deselect, or picking a
 * different tool, which is what this handles. Returning to the selection tool
 * keeps whatever was selected.
 */
export function setActiveTool(tool: ToolType): void {
  const state = getAppState();
  if (state.activeTool === tool) return;

  if (tool === 'selection') {
    setAppState({ activeTool: tool });
  } else {
    setAppState({
      activeTool: tool,
      selectedElementIds: {},
      editingGroupId: null,
      editingLinearElementId: null,
      editingTextElementId: null,
      editingPluginElementId: null,
    });
  }
  invalidateInteractive();
}

/** Explicit deselect, without touching the active tool. */
export function deselectAll(): void {
  setAppState({
    selectedElementIds: {},
    editingGroupId: null,
    editingLinearElementId: null,
    editingPluginElementId: null,
  });
  invalidateInteractive();
}

export const getSelectedElements = (): ExcaliElement[] => {
  const { selectedElementIds } = getAppState();
  return scene.getNonDeleted().filter((element) => selectedElementIds[element.id]);
};

export const selectElements = (elements: readonly ExcaliElement[]): void => {
  const ids: Record<string, true> = {};
  for (const element of elements) ids[element.id] = true;
  setAppState({ selectedElementIds: ids });
  invalidateInteractive();
};

const redraw = (): void => {
  scene.emit();
  invalidateStatic();
  invalidateInteractive();
};

// ------------------------------------------------------------- destructive

export function deleteSelected(): void {
  const selected = getSelectedElements();
  if (selected.length === 0) return;

  // Soft delete: a tombstone can be undone and can lose a merge race.
  for (const element of selected) mutateElement(element, { isDeleted: true });
  // Drop references in both directions so nothing points at a tombstone.
  onElementsDeleted(selected);

  setAppState({
    selectedElementIds: {},
    editingLinearElementId: null,
    editingPluginElementId: null,
  });
  redraw();
  record();
}

export function duplicateSelected(offset = 10): void {
  const selected = getSelectedElements();
  if (selected.length === 0) return;

  const copies = selected.map((element) => {
    const copy = duplicateElement(element);
    copy.x += offset;
    copy.y += offset;
    return copy;
  });

  // Members of the same group must stay grouped, under a fresh group id.
  const groupIdMap = new Map<string, string>();
  for (const copy of copies) {
    copy.groupIds = copy.groupIds.map((id) => {
      let next = groupIdMap.get(id);
      if (!next) {
        next = newGroupId();
        groupIdMap.set(id, next);
      }
      return next;
    });
  }

  for (const copy of copies) scene.add(copy);
  selectElements(copies);
  redraw();
  record();
}

// ------------------------------------------------------------------ groups

export function groupSelected(): void {
  const selected = getSelectedElements();
  if (selected.length < 2) return;

  const groupId = newGroupId();
  // Outermost group goes last, since groupIds is ordered innermost first.
  for (const element of selected) {
    mutateElement(element, { groupIds: [...element.groupIds, groupId] });
  }

  const memberIds = new Set(selected.map((element) => element.id));
  scene.replaceAll(makeGroupContiguous(scene.getAll(), memberIds));
  setAppState({ editingGroupId: null });
  redraw();
  record();
}

export function ungroupSelected(): void {
  const selected = getSelectedElements();
  const groupIds = new Set(
    selected.map(outermostGroupId).filter((id): id is string => id !== null),
  );
  if (groupIds.size === 0) return;

  for (const element of selected) {
    const outermost = outermostGroupId(element);
    if (outermost && groupIds.has(outermost)) {
      mutateElement(element, { groupIds: element.groupIds.slice(0, -1) });
    }
  }
  setAppState({ editingGroupId: null });
  redraw();
  record();
}

/** Selection acts on whole groups, so a click on one member takes all of them. */
export function expandSelectionToGroups(elements: ExcaliElement[]): ExcaliElement[] {
  const all = scene.getNonDeleted();
  const result = new Map<string, ExcaliElement>();

  for (const element of elements) {
    const groupId = outermostGroupId(element);
    if (groupId === null || getAppState().editingGroupId === groupId) {
      result.set(element.id, element);
      continue;
    }
    for (const member of elementsInGroup(all, groupId)) result.set(member.id, member);
  }
  return [...result.values()];
}

// ----------------------------------------------------------------- z-order

type ZAction = 'front' | 'back' | 'forward' | 'backward';

export function changeZOrder(action: ZAction): void {
  const selected = getSelectedElements();
  if (selected.length === 0) return;

  const selectedIds = new Set(selected.map((element) => element.id));
  const all = [...scene.getAll()];
  const moving = all.filter((element) => selectedIds.has(element.id));
  const rest = all.filter((element) => !selectedIds.has(element.id));

  if (action === 'front') {
    scene.replaceAll([...rest, ...moving]);
  } else if (action === 'back') {
    scene.replaceAll([...moving, ...rest]);
  } else {
    // Step the whole block one slot, keeping it contiguous so groups survive.
    const first = all.findIndex((element) => selectedIds.has(element.id));
    const last = all.reduce(
      (found, element, i) => (selectedIds.has(element.id) ? i : found),
      -1,
    );
    if (action === 'forward' && last < all.length - 1) {
      const next = all[last + 1];
      scene.replaceAll([
        ...rest.slice(0, rest.indexOf(next)),
        next,
        ...moving,
        ...rest.slice(rest.indexOf(next) + 1),
      ]);
    } else if (action === 'backward' && first > 0) {
      const previous = all[first - 1];
      scene.replaceAll([
        ...rest.slice(0, rest.indexOf(previous)),
        ...moving,
        previous,
        ...rest.slice(rest.indexOf(previous) + 1),
      ]);
    } else {
      return;
    }
  }

  redraw();
  record();
}

// --------------------------------------------------------------- alignment

export type AlignAxis = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

export function alignSelected(axis: AlignAxis): void {
  const selected = getSelectedElements();
  if (selected.length < 2) return;

  const boxes = selected.map((element) => getElementBounds(element));
  const minX = Math.min(...boxes.map((b) => b.minX));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxY = Math.max(...boxes.map((b) => b.maxY));

  selected.forEach((element, i) => {
    const bounds = boxes[i];
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;

    // Nudge by the delta on the element's bounds, which keeps rotated
    // elements aligned by what you can actually see rather than by x/y.
    switch (axis) {
      case 'left':
        mutateElement(element, { x: element.x + (minX - bounds.minX) });
        break;
      case 'right':
        mutateElement(element, { x: element.x + (maxX - bounds.maxX) });
        break;
      case 'centerX':
        mutateElement(element, {
          x: element.x + ((minX + maxX) / 2 - width / 2 - bounds.minX),
        });
        break;
      case 'top':
        mutateElement(element, { y: element.y + (minY - bounds.minY) });
        break;
      case 'bottom':
        mutateElement(element, { y: element.y + (maxY - bounds.maxY) });
        break;
      case 'centerY':
        mutateElement(element, {
          y: element.y + ((minY + maxY) / 2 - height / 2 - bounds.minY),
        });
        break;
    }
  });

  redraw();
  record();
}

// -------------------------------------------------------------- style edit

/**
 * A style edit may never change what an element IS, so `type` and `id` are
 * omitted at the type level rather than merely by convention. Partial
 * <ExcaliElement> would not work regardless: it is a union, so a patch touching
 * an arrow-only field is not assignable to every member.
 */
export type StylePatch = Partial<Omit<BaseElement, 'id' | 'type'>> &
  Partial<Pick<LinearElement, 'startArrowhead' | 'endArrowhead'>>;

export type TextStylePatch = Partial<Pick<TextElement, 'fontSize' | 'fontFamily' | 'textAlign'>>;

/**
 * Text style is applied to explicit TextElements rather than through the
 * generic style path, because changing a font re-wraps the text and can grow
 * the container it lives in.
 */
export function applyTextStyleTo(targets: readonly TextElement[], patch: TextStylePatch): void {
  if (targets.length === 0) return;

  for (const text of targets) {
    // Explicit type argument: inference otherwise widens T to BaseElement and
    // rejects the text-only fields.
    mutateElement<TextElement>(text, patch);
    const container = getContainerOf(text);
    if (container) {
      redrawBoundText(text, container);
    } else {
      const metrics = measureText(text.text, text.fontSize, text.fontFamily, text.lineHeight);
      mutateElement(text, { width: metrics.width, height: metrics.height });
    }
  }
  redraw();
  record();
}

/**
 * Patch a plugin element's own data.
 *
 * The core does not know or care what is in the patch — it only owns
 * versioning, redraw and the undo entry. That split is what keeps `data`
 * genuinely opaque.
 */
export function applyPluginData(element: ExcaliElement, patch: Record<string, unknown>): void {
  if (!isCustomElement(element)) return;
  mutateElement(element, { data: { ...element.data, ...patch } });
  redraw();
  record();
}

export function applyStyleToSelected(patch: StylePatch): void {
  const selected = getSelectedElements();
  if (selected.length === 0) return;

  for (const element of selected) {
    if (isLinearElement(element)) {
      mutateElement(element, patch);
    } else {
      // Arrowheads mean nothing to a rectangle; drop them rather than write
      // fields the element has no use for.
      const { startArrowhead: _start, endArrowhead: _end, ...shapePatch } = patch;
      mutateElement(element, shapePatch);
    }
  }
  redraw();
  record();
}
