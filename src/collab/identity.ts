import { nanoid } from 'nanoid';

/**
 * Who this browser is, to other people in the room.
 *
 * The name is persisted so you keep the same identity across reloads and
 * reconnects — a collaborator whose name changes every refresh is worse than no
 * name at all. The peer id is per-session by design: it keys the cursor, and a
 * stale one surviving a reload would collide with the live one.
 */
const NAME_KEY = 'whiteboard:user-name';

const ADJECTIVES = [
  'Swift', 'Quiet', 'Bright', 'Clever', 'Calm', 'Bold',
  'Keen', 'Warm', 'Sharp', 'Kind', 'Brave', 'Lucid',
];
const ANIMALS = [
  'Otter', 'Falcon', 'Heron', 'Fox', 'Ibex', 'Lynx',
  'Raven', 'Marten', 'Badger', 'Osprey', 'Tapir', 'Wren',
];

const randomName = (): string =>
  `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${
    ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  }`;

/** New every session: it identifies a connection, not a person. */
export const peerId = nanoid(8);

let cachedName: string | null = null;

export function getUserName(): string {
  if (cachedName !== null) return cachedName;

  try {
    const stored = window.localStorage.getItem(NAME_KEY);
    if (stored && stored.trim() !== '') {
      cachedName = stored;
      return cachedName;
    }
  } catch {
    // Storage disabled (private window). A session-only name still works.
  }

  cachedName = randomName();
  setUserName(cachedName);
  return cachedName;
}

export function setUserName(name: string): void {
  const trimmed = name.trim().slice(0, 32) || randomName();
  cachedName = trimmed;
  try {
    window.localStorage.setItem(NAME_KEY, trimmed);
  } catch {
    // Non-fatal: the name simply won't survive a reload.
  }
}
