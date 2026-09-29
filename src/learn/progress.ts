/** Lesson completion, persisted per browser. */
const KEY = 'stars-observatory.learn.v1';

interface Saved {
  completed: string[];
  /** Furthest step reached per lesson (0-based). */
  reached: Record<string, number>;
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Saved>;
    return { completed: Array.isArray(s.completed) ? s.completed : [], reached: s.reached && typeof s.reached === 'object' ? s.reached : {} };
  } catch {
    return { completed: [], reached: {} };
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export const progress = {
  isComplete(id: string): boolean {
    return load().completed.includes(id);
  },
  completedCount(): number {
    return load().completed.length;
  },
  complete(id: string): void {
    const s = load();
    if (!s.completed.includes(id)) s.completed.push(id);
    delete s.reached[id];
    save(s);
  },
  reached(id: string): number {
    return load().reached[id] ?? 0;
  },
  setReached(id: string, step: number): void {
    const s = load();
    if (s.completed.includes(id) || (s.reached[id] ?? 0) >= step) return;
    s.reached[id] = step;
    save(s);
  },
  reset(): void {
    save({ completed: [], reached: {} });
  },
};
