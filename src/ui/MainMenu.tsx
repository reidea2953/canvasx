import { useEffect, useRef, useState } from 'react';
import { pasteElements } from '../scene/clipboard';
import {
  DEFAULT_EXPORT,
  downloadBlob,
  exportSceneFile,
  exportToPng,
  exportToSvg,
  extractSceneFromPng,
} from '../scene/export';
import { invalidateInteractive, invalidateStatic } from '../scene/render';
import { scene } from '../scene/Scene';
import { record } from '../state/history';
import { setAppState, useAppState } from '../state/store';

const CANVAS_COLORS = ['#ffffff', '#f8f9fa', '#f5faff', '#fffce8', '#fdf8f6'];

/** Read a scene out of either a .excalidraw file or a PNG this app exported. */
async function readSceneFile(file: File): Promise<string | null> {
  if (file.type === 'image/png') return extractSceneFromPng(file);
  return file.text();
}

export function MainMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewBackgroundColor = useAppState((state) => state.viewBackgroundColor);
  const theme = useAppState((state) => state.theme);
  const statsOpen = useAppState((state) => state.statsOpen);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    try {
      await task();
    } catch (error) {
      console.error(`${label} failed`, error);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const exportPng = () =>
    run('Exporting PNG', async () => {
      const blob = await exportToPng(scene.getNonDeleted(), DEFAULT_EXPORT);
      if (blob) downloadBlob(blob, 'scene.png');
    });

  const exportSvg = () =>
    run('Exporting SVG', async () => {
      const svg = await exportToSvg(scene.getNonDeleted(), DEFAULT_EXPORT);
      if (svg) downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'scene.svg');
    });

  const openFile = () => fileInputRef.current?.click();

  const onFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file twice still fires a change event.
    event.target.value = '';
    if (!file) return;

    await run('Opening', async () => {
      const text = await readSceneFile(file);
      if (!text) {
        console.warn('No scene data found in that file');
        return;
      }
      const parsed = JSON.parse(text) as { elements?: unknown; files?: unknown };
      if (!Array.isArray(parsed.elements)) return;

      scene.replaceAll([]);
      await pasteElements(
        { elements: parsed.elements as never, files: parsed.files as never },
        { x: 0, y: 0 },
      );
      setAppState({ scrollX: 0, scrollY: 0, zoom: 1 });
      invalidateStatic();
    });
  };

  const resetCanvas = () =>
    run('Resetting', async () => {
      if (!window.confirm('Clear the canvas? This can be undone with Ctrl+Z.')) return;
      scene.replaceAll([]);
      setAppState({ selectedElementIds: {} });
      invalidateStatic();
      invalidateInteractive();
      record();
    });

  return (
    <div className="main-menu" ref={menuRef}>
      <button
        className="tool island-button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Main menu"
        title="Menu"
      >
        <span aria-hidden="true">☰</span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".excalidraw,application/json,image/png"
        onChange={onFileChosen}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />

      {open && (
        <div className="menu-panel island" role="menu">
          <button role="menuitem" onClick={openFile} disabled={busy !== null}>
            Open… <span className="menu-hint">.excalidraw or PNG</span>
          </button>
          <button role="menuitem" onClick={() => run('Saving', exportSceneFile)} disabled={busy !== null}>
            Save to file <span className="menu-hint">Ctrl+S</span>
          </button>
          <hr />
          <button role="menuitem" onClick={exportPng} disabled={busy !== null}>
            Export PNG <span className="menu-hint">Ctrl+Shift+E</span>
          </button>
          <button role="menuitem" onClick={exportSvg} disabled={busy !== null}>
            Export SVG
          </button>
          <hr />

          <button
            role="menuitem"
            onClick={() => {
              setAppState({ theme: theme === 'dark' ? 'light' : 'dark' });
              invalidateStatic();
              setOpen(false);
            }}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setAppState({ statsOpen: !statsOpen });
              setOpen(false);
            }}
          >
            {statsOpen ? 'Hide stats' : 'Show stats'} <span className="menu-hint">Alt+/</span>
          </button>
          <hr />

          <div className="menu-section">
            <span className="menu-label">Canvas background</span>
            <div className="swatches">
              {CANVAS_COLORS.map((color) => (
                <button
                  key={color}
                  className={color === viewBackgroundColor ? 'swatch active' : 'swatch'}
                  style={{ background: color, borderColor: color }}
                  onClick={() => {
                    setAppState({ viewBackgroundColor: color });
                    invalidateStatic();
                  }}
                  aria-label={`Canvas background ${color}`}
                  aria-pressed={color === viewBackgroundColor}
                />
              ))}
            </div>
          </div>
          <hr />
          <button role="menuitem" onClick={resetCanvas} disabled={busy !== null}>
            Reset canvas
          </button>

          {busy && <p className="menu-busy">{busy}…</p>}
        </div>
      )}
    </div>
  );
}
