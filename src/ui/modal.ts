import type { App } from '../app';
import { h, icon } from './dom';

function modal(content: HTMLElement[], onClose?: () => void): () => void {
  const close = () => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  const box = h('div', { class: 'modal glass', role: 'dialog', 'aria-modal': 'true' }, ...content);
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => e.target === backdrop && close() }, box);
  document.body.append(backdrop);
  window.addEventListener('keydown', onKey);
  return close;
}

export function showWelcome(app: App): void {
  const site = app.getSite();
  const close = modal(
    [
      h('div', { class: 'brand-mark', style: 'width:44px;height:44px;margin-bottom:14px' }),
      h('h2', {}, 'Welcome to your observatory'),
      h('p', { class: 'muted', style: 'margin:0;line-height:1.55' }, `This is the real sky above ${site.name}, right now — every star, planet, comet and satellite computed for your exact location and moment.`),
      h(
        'div',
        { class: 'tips' },
        h('div', { class: 'tip' }, icon('target', 18), h('div', {}, h('b', {}, 'Drag'), ' to look around, ', h('b', {}, 'scroll or pinch'), ' to zoom, and ', h('b', {}, 'tap'), ' anything to learn about it.')),
        h('div', { class: 'tip' }, icon('moon', 18), h('div', {}, h('b', {}, 'Tonight'), ' shows what’s up, when it gets dark, the Moon and the best targets.')),
        h('div', { class: 'tip' }, icon('calendar', 18), h('div', {}, h('b', {}, 'Sky events'), ' lists eclipses, meteor showers, conjunctions and more — tap one to travel there.')),
        h('div', { class: 'tip' }, icon('phone', 18), h('div', {}, 'On your phone, ', h('b', {}, 'Point at the sky'), ' and the view follows your hand to identify what you’re looking at.')),
        h('div', { class: 'tip' }, icon('pin', 18), h('div', {}, 'Switch between ', h('b', {}, 'Mariposa'), ' and ', h('b', {}, 'Sacramento'), ' from the clock card to see how light pollution changes the sky.')),
      ),
      h(
        'div',
        { class: 'btn-row', style: 'justify-content:flex-end' },
        h('button', { class: 'btn', onclick: () => (close(), showHelp(app)) }, 'Keyboard shortcuts'),
        h('button', { class: 'btn primary', onclick: () => close() }, 'Start exploring'),
      ),
    ],
    () => app.settings.set({ onboarded: true }),
  );
}

export function showHelp(app: App): void {
  void app;
  const rows: [string, string][] = [
    ['Drag / arrows / WASD', 'Look around'],
    ['Scroll / pinch / + −', 'Zoom (toward the pointer)'],
    ['Click / tap', 'Identify an object'],
    ['/ or Ctrl K', 'Search'],
    ['Space', 'Pause / play time'],
    ['[  ]', 'Slower / faster (reverse too)'],
    ['N', 'Back to now'],
    ['T / Y', 'Tonight / Sky events'],
    ['C  V  B  L', 'Figures, names, boundaries, star names'],
    ['M  H  G', 'Milky Way, atmosphere, landscape'],
    ['Z  E  K', 'Alt-az grid, equatorial grid, ecliptic'],
    ['P', 'Perfect sky (no light pollution)'],
    ['Q', 'Stargaze — only the stars'],
    ['R', 'Red light (for use outdoors)'],
    [', .', 'Step time back / forward'],
    ['X', 'Motion trails'],
    ['J', 'Sky School'],
    ['U', 'Hide the interface'],
    ['F', 'Full screen'],
    ['Esc', 'Close / deselect'],
  ];
  const close = modal([
    h('h2', {}, 'Controls & shortcuts'),
    h('div', { class: 'shortcut-grid', style: 'margin:16px 0 20px' }, ...rows.flatMap(([k, v]) => [h('kbd', {}, k), h('span', {}, v)])),
    h('div', { class: 'btn-row', style: 'justify-content:flex-end' }, h('button', { class: 'btn primary', onclick: () => close() }, 'Got it')),
  ]);
}
