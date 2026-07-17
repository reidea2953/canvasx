import { useEffect, useRef } from 'react';
import { onFrameStats } from '../scene/render';
import { clearScene, loadSyntheticScene } from '../dev/synthetic';

/**
 * Frame stats arrive every frame. They are written straight to the DOM rather
 * than through React state — a 60Hz setState would itself become the bottleneck
 * we are trying to measure.
 */
export function DevPanel() {
  const readoutRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    onFrameStats((stats) => {
      const node = readoutRef.current;
      if (!node) return;
      node.textContent =
        `fps      ${String(stats.fps).padStart(5)}\n` +
        `static   ${stats.staticMs.toFixed(2).padStart(5)} ms\n` +
        `interact ${stats.interactiveMs.toFixed(2).padStart(5)} ms\n` +
        `visible  ${String(stats.visible).padStart(5)} / ${stats.total}`;
    });
    return () => onFrameStats(null);
  }, []);

  return (
    <div className="dev-panel">
      <pre ref={readoutRef}>fps — idle (no frames scheduled)</pre>
      <div className="dev-buttons">
        <button onClick={() => loadSyntheticScene(1_000)}>1k</button>
        <button onClick={() => loadSyntheticScene(10_000)}>10k</button>
        <button onClick={() => loadSyntheticScene(50_000)}>50k</button>
        <button onClick={clearScene}>clear</button>
      </div>
      <p className="dev-hint">
        fps counts frames in the last second and only ticks while something is
        being drawn — idle at 0 is correct.
      </p>
    </div>
  );
}
