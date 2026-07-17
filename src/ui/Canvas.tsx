import { useEffect, useRef } from 'react';
import { handlePaste, insertImage, pasteElements } from '../scene/clipboard';
import { attachInteractionHandlers } from '../scene/interaction';
import { makeLayer, setLayers } from '../scene/render';
import { getAppState, useAppState } from '../state/store';
import { viewportToScene } from '../utils/coords';

/**
 * Sizes the backing store in device pixels while the CSS box stays in CSS
 * pixels. Skipping this is what makes canvas apps blurry on HiDPI screens.
 */
function resizeCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const interactiveRef = useRef<HTMLCanvasElement>(null);
  // Dark mode inverts the canvas with a CSS filter rather than recolouring every
  // element: element colours stay exactly as authored, and exports stay light.
  const theme = useAppState((state) => state.theme);
  const activeTool = useAppState((state) => state.activeTool);

  useEffect(() => {
    const container = containerRef.current;
    const staticCanvas = staticRef.current;
    const interactiveCanvas = interactiveRef.current;
    if (!container || !staticCanvas || !interactiveCanvas) return;

    const attach = () =>
      setLayers({ static: makeLayer(staticCanvas), interactive: makeLayer(interactiveCanvas) });

    attach();
    const detachInteraction = attachInteractionHandlers(container);

    const applySize = () => {
      const { width, height } = container.getBoundingClientRect();
      resizeCanvas(staticCanvas, width, height);
      resizeCanvas(interactiveCanvas, width, height);
      // Resizing a canvas clears it, so both layers must be redrawn.
      attach();
    };

    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(container);

    const viewportSize = () => {
      const rect = container.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };

    /** Paste lands at the pointer if we know it, otherwise at the viewport centre. */
    const pastePoint = () => {
      const rect = container.getBoundingClientRect();
      const state = getAppState();
      const client = lastPointer ?? {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      return viewportToScene(client.x, client.y, state, rect);
    };

    let lastPointer: { x: number; y: number } | null = null;
    const trackPointer = (event: PointerEvent) => {
      lastPointer = { x: event.clientX, y: event.clientY };
    };
    container.addEventListener('pointermove', trackPointer);

    const onPaste = (event: ClipboardEvent) => {
      // Never hijack a paste aimed at the text editor overlay.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      event.preventDefault();
      void handlePaste(event, pastePoint(), viewportSize());
    };
    window.addEventListener('paste', onPaste);

    const onDragOver = (event: DragEvent) => event.preventDefault();
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const at = viewportToScene(event.clientX, event.clientY, getAppState(), rect);

      const file = event.dataTransfer?.files?.[0];
      if (!file) return;

      if (file.type.startsWith('image/')) {
        void insertImage(file, at, viewportSize());
        return;
      }
      // A dropped .excalidraw file merges into the current scene at the cursor.
      if (file.name.endsWith('.excalidraw') || file.type === 'application/json') {
        void (async () => {
          try {
            const parsed = JSON.parse(await file.text()) as { elements?: unknown; files?: unknown };
            if (Array.isArray(parsed.elements)) {
              await pasteElements(
                { elements: parsed.elements as never, files: parsed.files as never },
                at,
              );
            }
          } catch (error) {
            console.warn('Could not read dropped file', error);
          }
        })();
      }
    };
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('drop', onDrop);

    // devicePixelRatio changes when the window moves to a monitor with a
    // different density. The query fires once, so it is re-armed each time.
    let dprQuery: MediaQueryList | null = null;
    function onDprChange() {
      applySize();
      watchDpr();
    }
    function watchDpr() {
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', onDprChange);
    }
    watchDpr();

    return () => {
      observer.disconnect();
      dprQuery?.removeEventListener('change', onDprChange);
      container.removeEventListener('pointermove', trackPointer);
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
      detachInteraction();
      setLayers(null);
    };
  }, []);

  return (
    // data-tool drives the CSS cursor; the interaction layer overrides it
    // imperatively while hovering a handle or dragging.
    <div ref={containerRef} className="canvas-stack" data-theme={theme} data-tool={activeTool}>
      <canvas ref={staticRef} className="layer" />
      <canvas ref={interactiveRef} className="layer" />
    </div>
  );
}
