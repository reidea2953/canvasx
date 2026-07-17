import { useEffect, useMemo, useRef, useState } from 'react';
import { insertPluginElement, viewportInsertContext } from '../plugins/insert';
import { CATEGORY_LABEL, CATEGORY_ORDER, searchPlugins } from '../plugins/registry';
import type { ElementPlugin, PluginCategory } from '../plugins/types';
import { PlusIcon } from './Icons';

/**
 * The Insert menu.
 *
 * It has no knowledge of any element type. Everything it shows comes from the
 * registry, so adding a plugin adds a menu entry — this file never changes.
 */
export function InsertMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  /** The plugin whose InsertDialog is up, if any. */
  const [configuring, setConfiguring] = useState<ElementPlugin<never> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchPlugins(query), [query, open]);

  // Group for display, but keep the flat list for keyboard navigation — the two
  // must agree on order or arrow keys jump around.
  const grouped = useMemo(() => {
    const byCategory = new Map<PluginCategory, ElementPlugin<never>[]>();
    for (const plugin of results) {
      const list = byCategory.get(plugin.category) ?? [];
      list.push(plugin);
      byCategory.set(plugin.category, list);
    }
    return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
      category,
      plugins: byCategory.get(category)!,
    }));
  }, [results]);

  const ordered = useMemo(() => grouped.flatMap((group) => group.plugins), [grouped]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setConfiguring(null);
      return;
    }
    inputRef.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  /**
   * A plugin that needs configuring shows its dialog first; everything else
   * inserts immediately. The menu does not know which is which — it asks.
   */
  const insert = (plugin: ElementPlugin<never>) => {
    if (plugin.InsertDialog) {
      setConfiguring(plugin);
      return;
    }
    insertPluginElement(plugin.id, viewportInsertContext());
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // The canvas must not read these as tool shortcuts.
    event.stopPropagation();

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        return;
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => Math.min(index + 1, ordered.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
        return;
      case 'Enter': {
        event.preventDefault();
        const plugin = ordered[active];
        if (plugin) insert(plugin);
        return;
      }
      default:
        return;
    }
  };

  return (
    <div className="insert-menu" ref={rootRef}>
      <button
        className={open ? 'tool active' : 'tool'}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Insert an element"
        data-tooltip="Insert"
      >
        <PlusIcon />
      </button>

      {open && configuring?.InsertDialog && (
        <div className="insert-panel island">
          <configuring.InsertDialog
            onConfirm={(seed) => {
              insertPluginElement(configuring.id, viewportInsertContext(), seed);
              setConfiguring(null);
              setOpen(false);
            }}
            onCancel={() => setConfiguring(null)}
          />
        </div>
      )}

      {open && !configuring && (
        <div className="insert-panel island" role="menu">
          <input
            ref={inputRef}
            className="insert-search"
            type="text"
            value={query}
            placeholder="Search elements…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search elements to insert"
          />

          <div className="insert-list">
            {ordered.length === 0 && <p className="insert-empty">Nothing matches “{query}”.</p>}

            {grouped.map((group) => (
              <div key={group.category} className="insert-group">
                <span className="insert-category">{CATEGORY_LABEL[group.category]}</span>

                {group.plugins.map((plugin) => {
                  const index = ordered.indexOf(plugin);
                  return (
                    <button
                      key={plugin.id}
                      role="menuitem"
                      className={index === active ? 'insert-item active' : 'insert-item'}
                      onClick={() => insert(plugin)}
                      onPointerEnter={() => setActive(index)}
                    >
                      <span className="insert-icon">{plugin.icon}</span>
                      <span className="insert-text">
                        <span className="insert-label">{plugin.label}</span>
                        {plugin.description && (
                          <span className="insert-description">{plugin.description}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
