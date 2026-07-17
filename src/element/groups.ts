import { nanoid } from 'nanoid';
import type { ExcaliElement } from './types';

/**
 * groupIds is ordered innermost first, so the outermost group — the one a
 * plain click should select — is the last entry.
 */
export const outermostGroupId = (element: ExcaliElement): string | null =>
  element.groupIds.length > 0 ? element.groupIds[element.groupIds.length - 1] : null;

/**
 * The group a click should act on, given how deep the user has drilled in.
 * Inside an entered group, clicking selects the next level down rather than
 * re-selecting the whole group.
 */
export function selectableGroupId(
  element: ExcaliElement,
  editingGroupId: string | null,
): string | null {
  if (element.groupIds.length === 0) return null;

  if (editingGroupId === null) return outermostGroupId(element);

  const index = element.groupIds.indexOf(editingGroupId);
  // Not part of the group being edited — fall back to its own outermost group.
  if (index === -1) return outermostGroupId(element);
  // The level directly inside the entered group, if any.
  return index > 0 ? element.groupIds[index - 1] : null;
}

export const elementsInGroup = (
  elements: readonly ExcaliElement[],
  groupId: string,
): ExcaliElement[] => elements.filter((element) => element.groupIds.includes(groupId));

export const newGroupId = (): string => nanoid();

/**
 * Reorders so a group's members sit contiguously in z-order, just under the
 * topmost member. Without this, raising one group interleaves it with another
 * and both render shredded.
 */
export function makeGroupContiguous(
  elements: readonly ExcaliElement[],
  memberIds: Set<string>,
): ExcaliElement[] {
  const members: ExcaliElement[] = [];
  const rest: ExcaliElement[] = [];

  for (const element of elements) {
    (memberIds.has(element.id) ? members : rest).push(element);
  }
  if (members.length === 0) return [...elements];

  // Insert where the topmost member currently sits.
  let insertAt = rest.length;
  let seen = 0;
  for (let i = 0; i < elements.length; i++) {
    if (memberIds.has(elements[i].id)) {
      seen++;
      if (seen === members.length) {
        insertAt = i + 1 - members.length;
        break;
      }
    }
  }

  return [...rest.slice(0, insertAt), ...members, ...rest.slice(insertAt)];
}
