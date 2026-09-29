import type { LessonIcon } from './types';

/** Small line icons for the lesson catalogue (24×24, stroke = currentColor). */
const PATHS: Record<LessonIcon, string> = {
  sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.2"/><path d="M12 3v18"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/><circle cx="19.5" cy="4.5" r=".6" fill="currentColor"/>',
  spin: '<circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="m17.5 3.5-.6 3.6 3.6.6"/><path d="M15.5 12a3.5 3.5 0 1 1-1-2.47"/>',
  zodiac: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M5.6 18.4l2.5-2.5M15.9 8.1l2.5-2.5"/>',
  moon: '<path d="M18.5 15A7.5 7.5 0 0 1 9 5.5a7.5 7.5 0 1 0 9.5 9.5Z"/><circle cx="18" cy="5" r="1" fill="currentColor"/>',
  planet: '<circle cx="12" cy="12" r="5"/><path d="M4.2 15.6c-1.6 1.8-2 3.2-1.3 3.9 1.3 1.3 6.6-1.6 11.7-6.7s8-10.4 6.7-11.7c-.7-.7-2.1-.3-3.9 1.3"/>',
  city: '<path d="M3 21h18M5 21V11h4v10M9 21V6h5v15M14 21v-8h5v8"/><path d="M11 9h1M11 12h1M11 15h1M7 14h0M16.5 16h0"/><circle cx="19" cy="4" r=".7" fill="currentColor"/><circle cx="4" cy="5" r=".5" fill="currentColor"/>',
  star: '<path d="M12 2.8 14 9l6.3.3-5 3.9 1.8 6.1L12 15.8l-5.1 3.5 1.8-6.1-5-3.9L10 9l2-6.2Z"/>',
  galaxy: '<path d="M12 12c3-3 8-2 8.5 1.5.4 3-3 5.5-7 5.5-5 0-9-3.5-8.5-8S10 3 14 4"/><path d="M12 12c-3 3-8 2-8.5-1.5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  eclipse: '<circle cx="10" cy="12" r="7"/><path d="M13.5 5.9a7 7 0 1 1 0 12.2A7 7 0 0 0 13.5 5.9Z" fill="currentColor" fill-opacity=".35"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/><path d="M3 4.5 5.5 2M21 4.5 18.5 2"/>',
  dipper: '<circle cx="3.5" cy="9" r="1" fill="currentColor"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor"/><circle cx="11" cy="11.5" r="1" fill="currentColor"/><circle cx="14" cy="13.5" r="1" fill="currentColor"/><circle cx="14.5" cy="18" r="1" fill="currentColor"/><circle cx="19.5" cy="18.5" r="1" fill="currentColor"/><circle cx="20.5" cy="14" r="1" fill="currentColor"/><path d="M3.5 9l4 1.5 3.5 1 3 2 .5 4.5 5 .5 1-4.5-6.5-.5" stroke-width="1.1" opacity=".7"/><circle cx="21" cy="3.5" r="1.1" fill="currentColor"/><path d="M20.5 12.5 21 5" stroke-dasharray="1.5 1.5" stroke-width="1"/>',
};

export function lessonIcon(name: LessonIcon, size = 22): SVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return wrap.firstElementChild as SVGElement;
}
