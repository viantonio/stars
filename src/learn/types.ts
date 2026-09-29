import type { App } from '../app';
import type { Settings } from '../core/settings';
import type { LessonContext } from './runtime';

/** Text may be static or computed from the live app (e.g. "the Sun is in Virgo today"). */
export type Dynamic<T> = T | ((app: App) => T);

export interface LessonStep {
  title: string;
  /** 1–3 short paragraphs. Glossary terms are linked automatically. */
  text: Dynamic<string[]>;
  /** Optional Hermetic reflection, shown set apart from the science. */
  reflection?: string;
  /** Layer settings for this step (restored when the lesson ends). */
  settings?: Partial<Settings>;
  /** Observing site for this step (restored when the lesson ends). */
  location?: string;
  /** CSS selector of a UI element to spotlight while this step is shown. */
  spotlight?: string;
  /** Drives the sky: set the time, fly the camera, animate. Runs after settings are applied. */
  action?: (ctx: LessonContext) => void | Promise<void>;
}

export interface Lesson {
  id: string;
  title: string;
  /** One-line summary for the catalogue. */
  blurb: string;
  minutes: number;
  icon: LessonIcon;
  steps: LessonStep[];
}

export type LessonIcon = 'sphere' | 'sun' | 'spin' | 'zodiac' | 'moon' | 'planet' | 'city' | 'star' | 'galaxy' | 'eclipse' | 'clock' | 'dipper';
