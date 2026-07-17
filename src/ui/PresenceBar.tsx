import { useSyncExternalStore } from 'react';
import { getUserName, peerId } from '../collab/identity';
import {
  colorForPeer,
  getPeers,
  getPresenceRevision,
  initialsOf,
  subscribePresence,
  type Activity,
} from '../collab/presence';
import { getCollabStatus } from '../collab/sync';

const ACTIVITY_TEXT: Record<Activity, string> = {
  idle: 'idle',
  drawing: 'drawing…',
  typing: 'typing…',
  moving: 'moving objects…',
};

/**
 * Who else is here.
 *
 * Reads the presence map through useSyncExternalStore rather than mirroring it
 * into React state: cursors update ~20 times a second and re-rendering this bar
 * at that rate would be pure waste. The store only notifies on join/leave, so
 * cursor motion costs nothing here.
 */
export function PresenceBar() {
  useSyncExternalStore(subscribePresence, getPresenceRevision);

  // Not in a room: nobody to show.
  if (getCollabStatus() !== 'connected') return null;

  const peers = getPeers();
  const total = peers.length + 1;
  const active = peers.filter((peer) => peer.activity !== 'idle');

  return (
    <div className="presence island" aria-label={`${total} people in this room`}>
      <div className="avatars">
        <span
          className="avatar you"
          style={{ background: colorForPeer(peerId) }}
          title={`${getUserName()} (you)`}
        >
          {initialsOf(getUserName())}
          <span className="online-dot" aria-hidden="true" />
        </span>

        {peers.map((peer) => (
          <span
            key={peer.id}
            className="avatar"
            style={{ background: peer.color }}
            title={`${peer.name} — ${ACTIVITY_TEXT[peer.activity]}`}
          >
            {initialsOf(peer.name)}
            <span className="online-dot" aria-hidden="true" />
          </span>
        ))}
      </div>

      <span className="presence-count">
        {total} {total === 1 ? 'person' : 'people'}
      </span>

      {/*
        Only ever announce one activity. A stack of "X is typing" lines is how
        this widget grows to fill the screen in a busy room.
      */}
      {active.length > 0 && (
        <span className="presence-activity" aria-live="polite">
          {active.length === 1
            ? `${active[0].name} is ${ACTIVITY_TEXT[active[0].activity]}`
            : `${active.length} people editing…`}
        </span>
      )}
    </div>
  );
}
