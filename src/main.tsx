import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { attachCollabBroadcast, resumeSessionFromUrl } from './collab/sync';
import { invalidateTextMeasureCache } from './element/text';
import { loadFonts } from './fonts/load';
import { initHistory } from './state/history';
import { attachAutoSave, restore } from './state/persist';
import './index.css';

/**
 * An async function rather than top-level await: TLA would force the build
 * target up to es2022 purely for syntax, and this needs nothing from it.
 */
async function main(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing from index.html');

  // Nothing renders until the fonts are usable. Measuring text against a
  // fallback face produces wrong wraps, bounds and hit boxes, then visibly
  // reflows the whole canvas when the real font lands. See fonts/load.ts.
  await loadFonts();
  // Any width measured before this point belongs to the fallback face.
  invalidateTextMeasureCache();

  restore();
  // Seeded after restore so the first undo lands on the state you opened with.
  initHistory();
  attachAutoSave();
  attachCollabBroadcast();
  // Opening a room link drops you straight into the session.
  void resumeSessionFromUrl();

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();
