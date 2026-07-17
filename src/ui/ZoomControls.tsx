import { useAppState } from '../state/store';
import { resetZoom, zoomAtViewportCenter } from '../scene/viewport';

const step = (zoom: number, direction: 1 | -1) => zoom * (direction === 1 ? 1.1 : 1 / 1.1);

export function ZoomControls() {
  // Narrow selector: panning changes scrollX/scrollY, which this never reads,
  // so a pan does not re-render the chrome.
  const zoom = useAppState((state) => state.zoom);

  const container = () => document.querySelector<HTMLElement>('.canvas-stack');

  return (
    <div className="zoom-controls">
      <button
        onClick={() => {
          const element = container();
          if (element) zoomAtViewportCenter(step(zoom, -1), element);
        }}
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        onClick={() => {
          const element = container();
          if (element) resetZoom(element);
        }}
        aria-label="Reset zoom to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={() => {
          const element = container();
          if (element) zoomAtViewportCenter(step(zoom, 1), element);
        }}
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
