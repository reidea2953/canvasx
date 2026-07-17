import type { ExcaliElement } from '../element/types';

type Listener = () => void;

class SceneStore {
  private elements: ExcaliElement[] = [];
  private listeners = new Set<Listener>();
  private revision = 0;

  /** Includes tombstones — callers filter. */
  getAll(): readonly ExcaliElement[] {
    return this.elements;
  }

  getNonDeleted(): ExcaliElement[] {
    return this.elements.filter((element) => !element.isDeleted);
  }

  getById(id: string): ExcaliElement | undefined {
    return this.elements.find((element) => element.id === id);
  }

  get count(): number {
    return this.elements.length;
  }

  /** Z-order is array order, so append puts the element on top. */
  /** Z-order is array order, so append puts the element on top. */
  add(element: ExcaliElement): void {
    this.elements.push(element);
    this.emit();
  }

  replaceAll(elements: ExcaliElement[]): void {
    this.elements = elements;
    this.emit();
  }

  /** Arrow property: useSyncExternalStore needs a stable identity. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Bumped on every emit, so React chrome can react to in-place mutations. */
  getRevision = (): number => this.revision;

  onChange(listener: Listener): () => void {
    return this.subscribe(listener);
  }

  /** Call after mutating elements in place — Scene cannot observe that itself. */
  emit(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}

export const scene = new SceneStore();
