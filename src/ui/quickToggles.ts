import type { App } from '../app';
import type { Settings } from '../core/settings';
import { h, icon, type ICONS } from './dom';

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const ITEMS: [BoolKey, keyof typeof ICONS, string, string][] = [
  ['constellationLines', 'constellation', 'Constellation figures', 'C'],
  ['constellationNames', 'labels', 'Names & labels', 'V'],
  ['atmosphere', 'atmosphere', 'Atmosphere — off shows the stars by day', 'H'],
  ['showSun', 'sun', 'The Sun', ''],
  ['ground', 'mountain', 'Landscape', 'G'],
  ['milkyWay', 'galaxy', 'Milky Way', 'M'],
];

/** One-tap switches for the layers people reach for most, on the right edge. */
export class QuickToggles {
  private buttons: { key: BoolKey; b: HTMLButtonElement }[] = [];

  constructor(private app: App) {
    const bar = h('div', { class: 'quick-toggles glass', role: 'toolbar', 'aria-label': 'Quick layer switches' });
    for (const [key, ic, label, kbd] of ITEMS) {
      const b = h(
        'button',
        { class: 'qt', 'aria-label': label, onclick: () => this.toggle(key) },
        icon(ic, 19),
        h('span', { class: 'kbd-hint' }, label, kbd ? h('kbd', {}, kbd) : ''),
      );
      this.buttons.push({ key, b });
      bar.append(b);
    }
    app.root.append(bar);
    app.settings.onChange(() => this.sync());
    this.sync();
  }

  private toggle(key: BoolKey): void {
    const s = this.app.settings;
    s.toggle(key);
    // Names cover the star and planet labels too.
    if (key === 'constellationNames') s.set({ starNames: s.get().constellationNames, planetLabels: s.get().constellationNames });
  }

  private sync(): void {
    const s = this.app.settings.get();
    for (const { key, b } of this.buttons) {
      b.classList.toggle('on', !!s[key]);
      b.setAttribute('aria-pressed', String(!!s[key]));
    }
  }
}
