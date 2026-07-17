import { useEffect, useRef, useState } from 'react';
import {
  getCollabStatus,
  getRoomLink,
  onCollabStatus,
  startSession,
  stopSession,
  type CollabStatus,
} from '../collab/sync';

const LABEL: Record<CollabStatus, string> = {
  offline: 'Share',
  connecting: 'Connecting…',
  connected: 'Live',
  error: 'Offline',
};

export function ShareButton() {
  const [status, setStatus] = useState<CollabStatus>(getCollabStatus());
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => onCollabStatus(setStatus), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const link = getRoomLink();

  const start = async () => {
    await startSession();
    setOpen(true);
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard denied; the field below is selectable as a fallback.
    }
  };

  return (
    <div className="share" ref={panelRef}>
      <button
        className={status === 'connected' ? 'share-button live' : 'share-button'}
        onClick={() => (status === 'offline' || status === 'error' ? void start() : setOpen((v) => !v))}
        aria-expanded={open}
        title={status === 'connected' ? 'Live session' : 'Start a live session'}
      >
        {status === 'connected' && <span className="live-dot" aria-hidden="true" />}
        {LABEL[status]}
      </button>

      {open && status !== 'offline' && (
        <div className="share-panel island">
          <p className="share-title">Live session</p>
          <p className="share-note">
            Anyone with this link can edit. The key after the <code>#</code> never
            reaches the server, so the relay cannot read the drawing.
          </p>

          <input
            className="share-link"
            readOnly
            value={link ?? ''}
            onFocus={(event) => event.target.select()}
            aria-label="Room link"
          />

          <div className="share-actions">
            <button onClick={copy} disabled={!link}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button
              className="danger"
              onClick={() => {
                stopSession();
                setOpen(false);
              }}
            >
              Stop session
            </button>
          </div>

          {status === 'connecting' && (
            <p className="share-note">
              Waiting for the relay. Start it with <code>npm run server</code>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
