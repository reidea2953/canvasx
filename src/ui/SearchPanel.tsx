import { useEffect, useMemo, useRef, useState } from 'react';
import { selectElements } from '../scene/actions';
import { clearHighlights, flashElements } from '../scene/highlight';
import { scene } from '../scene/Scene';
import { cancelViewportAnimation, zoomToElement } from '../scene/viewportAnimation';
import { searchScene, type SearchKind, type SearchMatch } from '../search';
import { setAppState, useAppState } from '../state/store';
import { SearchIcon } from './Icons';

const KIND_LABEL: Record<SearchKind, string> = {
  text: 'Text',
  label: 'Label',
  image: 'Image',
  link: 'Link',
  shape: 'Shape',
};

/** Wrap the matched run so the eye lands on it without scanning the row. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (query === '' || index === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

const viewportSize = () => {
  const container = document.querySelector<HTMLElement>('.canvas-stack');
  const rect = container?.getBoundingClientRect();
  return { width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight };
};

export function SearchPanel() {
  const open = useAppState((state) => state.searchOpen);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /**
   * The scene revision is a dependency so results stay live as the canvas
   * changes, but the extraction behind searchScene is cached per element
   * version — so this is a linear scan over pre-computed strings, not a rebuild.
   */
  const revision = useSceneRevision();
  const results = useMemo<SearchMatch[]>(
    () => (open ? searchScene(query) : []),
    [query, open, revision],
  );

  // A new query invalidates whatever was focused.
  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    if (!open) {
      clearHighlights();
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  // Flash every match, with the current one focused.
  useEffect(() => {
    if (!open || results.length === 0) {
      clearHighlights();
      return;
    }
    const focused = results[Math.min(index, results.length - 1)];
    flashElements(
      results.map((match) => match.element.id),
      focused?.element.id ?? null,
    );
  }, [open, results, index]);

  const goTo = (position: number) => {
    if (results.length === 0) return;
    // Wrap both ways, so next/previous cycle rather than dead-end.
    const next = ((position % results.length) + results.length) % results.length;
    setIndex(next);

    const match = results[next];
    if (!match || match.element.isDeleted) return;

    zoomToElement(match.element, viewportSize());
    selectElements([match.element]);

    // Keep the focused row on screen without stealing focus from the input.
    listRef.current?.querySelectorAll('li')[next]?.scrollIntoView({ block: 'nearest' });
  };

  const close = () => {
    cancelViewportAnimation();
    clearHighlights();
    setAppState({ searchOpen: false });
  };

  if (!open) return null;

  return (
    <div className="search island" role="dialog" aria-label="Search canvas">
      <div className="search-field">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search text, labels, images…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // The canvas must not read these as tool shortcuts.
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              goTo(event.shiftKey ? index - 1 : index + 1);
            }
          }}
          aria-label="Search the canvas"
        />

        <span className="search-count" aria-live="polite">
          {query === '' ? '' : results.length === 0 ? 'No results' : `${index + 1}/${results.length}`}
        </span>

        <button
          className="search-step"
          onClick={() => goTo(index - 1)}
          disabled={results.length === 0}
          aria-label="Previous result"
          data-tooltip="Previous  Shift+Enter"
        >
          ↑
        </button>
        <button
          className="search-step"
          onClick={() => goTo(index + 1)}
          disabled={results.length === 0}
          aria-label="Next result"
          data-tooltip="Next  Enter"
        >
          ↓
        </button>
        <button className="search-step" onClick={close} aria-label="Close search" data-tooltip="Close  Esc">
          ✕
        </button>
      </div>

      {results.length > 0 && (
        <ul className="search-results" ref={listRef}>
          {results.map((match, position) => (
            <li key={match.element.id}>
              <button
                className={position === index ? 'search-result active' : 'search-result'}
                onClick={() => goTo(position)}
              >
                <span className="result-kind">{KIND_LABEL[match.kind]}</span>
                <span className="result-snippet">
                  <Highlighted text={match.snippet} query={query} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Elements mutate in place, so React needs the scene's revision to notice. */
function useSceneRevision(): number {
  const [revision, setRevision] = useState(scene.getRevision);
  useEffect(() => scene.subscribe(() => setRevision(scene.getRevision())), []);
  return revision;
}
