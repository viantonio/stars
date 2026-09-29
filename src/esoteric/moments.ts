/**
 * Saved moments (a birth, an anniversary, a turning point) and the personal
 * sky journal. Everything is stored only in this browser's localStorage.
 */
import { fromLocal } from '../core/zones';

export interface Place {
  name: string;
  region: string;
  lat: number;
  lon: number;
  elevation: number;
  timeZone: string;
}

export interface Moment {
  id: string;
  name: string;
  kind: 'birth' | 'moment';
  /** Local wall-clock date "YYYY-MM-DD" and time "HH:MM" at the place. */
  localDate: string;
  localTime: string;
  /** False when the time of day is unknown (noon is used; houses and rising sign are then unreliable). */
  timeKnown: boolean;
  place: Place;
  /** The UTC instant, derived from the local time and the place's time zone. */
  utc: string;
  /** The moment the "personal" readings refer to. */
  primary: boolean;
  note: string;
}

export interface JournalEntry {
  id: string;
  /** When the entry was written. */
  written: string;
  /** The sky moment it is about (usually an event date). */
  skyDate: string;
  eventId?: string;
  eventTitle?: string;
  text: string;
}

const MOMENTS_KEY = 'stars-observatory.moments.v1';
const JOURNAL_KEY = 'stars-observatory.journal.v1';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function load<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

type Listener = () => void;

class Store<T extends { id: string }> {
  protected items: T[];
  private listeners = new Set<Listener>();

  constructor(private key: string) {
    this.items = load<T>(key);
  }

  all(): readonly T[] {
    return this.items;
  }

  get(id: string): T | undefined {
    return this.items.find((x) => x.id === id);
  }

  protected commit(): void {
    save(this.key, this.items);
    for (const l of this.listeners) l();
  }

  remove(id: string): void {
    this.items = this.items.filter((x) => x.id !== id);
    this.commit();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  replaceAll(items: T[]): void {
    this.items = items;
    this.commit();
  }
}

export class MomentStore extends Store<Moment> {
  constructor() {
    super(MOMENTS_KEY);
  }

  add(m: Omit<Moment, 'id' | 'utc'>): Moment | null {
    const utc = momentInstant(m.localDate, m.timeKnown ? m.localTime : '12:00', m.place.timeZone);
    if (!utc) return null;
    const full: Moment = { ...m, id: uid(), utc: utc.toISOString() };
    if (full.primary) this.items = this.items.map((x) => ({ ...x, primary: false }));
    this.items = [...this.items, full].sort((a, b) => a.utc.localeCompare(b.utc));
    this.commit();
    return full;
  }

  update(id: string, patch: Partial<Omit<Moment, 'id' | 'utc'>>): void {
    this.items = this.items.map((x) => {
      if (x.id !== id) return patch.primary ? { ...x, primary: false } : x;
      const next = { ...x, ...patch };
      const utc = momentInstant(next.localDate, next.timeKnown ? next.localTime : '12:00', next.place.timeZone);
      return utc ? { ...next, utc: utc.toISOString() } : next;
    });
    this.commit();
  }

  primary(): Moment | null {
    return this.items.find((x) => x.primary) ?? this.items.find((x) => x.kind === 'birth') ?? null;
  }
}

export class JournalStore extends Store<JournalEntry> {
  constructor() {
    super(JOURNAL_KEY);
  }

  add(e: Omit<JournalEntry, 'id' | 'written'>): JournalEntry {
    const full: JournalEntry = { ...e, id: uid(), written: new Date().toISOString() };
    this.items = [...this.items, full].sort((a, b) => b.skyDate.localeCompare(a.skyDate));
    this.commit();
    return full;
  }

  update(id: string, text: string): void {
    this.items = this.items.map((x) => (x.id === id ? { ...x, text } : x));
    this.commit();
  }

  forEvent(eventId: string): JournalEntry[] {
    return this.items.filter((x) => x.eventId === eventId);
  }

  toMarkdown(tz: string): string {
    const fmt = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso));
    const lines = ['# Sky journal', ''];
    for (const e of [...this.items].sort((a, b) => a.skyDate.localeCompare(b.skyDate))) {
      lines.push(`## ${fmt(e.skyDate)}${e.eventTitle ? ` — ${e.eventTitle}` : ''}`, '', e.text, '', `_Written ${fmt(e.written)}_`, '');
    }
    return lines.join('\n');
  }
}

export function momentInstant(localDate: string, localTime: string, timeZone: string): Date | null {
  try {
    return fromLocal(localDate, localTime, timeZone);
  } catch {
    return null;
  }
}

/** Place search with coordinates, elevation and IANA time zone (Open-Meteo geocoding, free, no key). */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Place search failed (${r.status})`);
  const j = (await r.json()) as {
    results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number; elevation?: number; timezone?: string }[];
  };
  return (j.results ?? [])
    .filter((x) => x.timezone)
    .map((x) => ({
      name: x.name,
      region: [x.admin1, x.country].filter(Boolean).join(', '),
      lat: x.latitude,
      lon: x.longitude,
      elevation: Math.max(0, x.elevation ?? 0),
      timeZone: x.timezone!,
    }));
}

/** Download text as a file. */
export function downloadText(filename: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
