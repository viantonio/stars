import type { App } from '../app';
import type { PanelId } from './panels';
import { h, icon, type ICONS } from './dom';
import { showHelp } from './modal';

export class Toolbar {
  private buttons = new Map<string, HTMLButtonElement>();

  constructor(app: App) {
    const panel = (id: PanelId, ic: keyof typeof ICONS, label: string, key: string) =>
      this.button(id, ic, label, key, () => app.panels.toggle(id));
    const bar = h(
      'div',
      { class: 'toolbar glass', role: 'toolbar', 'aria-label': 'Main tools' },
      panel('search', 'search', 'Search', '/'),
      panel('tonight', 'moon', 'Tonight', 'T'),
      panel('events', 'calendar', 'Sky events', 'Y'),
      panel('learn', 'book', 'Sky School', 'J'),
      this.button('orrery', 'orbit', 'Solar System', 'O', () => app.toggleOrrery()),
      panel('moments', 'moments', 'Moments', ''),
      panel('asabove', 'hexagram', 'As Above', ''),
      panel('layers', 'layers', 'Sky layers', ''),
      panel('location', 'pin', 'Location', ''),
      panel('settings', 'settings', 'Settings', ''),
      h('div', { class: 'tool-sep' }),
      this.button('pointing', 'phone', 'Point at the sky', '', () => void app.pointing.toggle()),
      this.button('night', 'eye', 'Stargaze — only the stars', 'Q', () => app.setStargaze(!app.settings.get().stargaze)),
      this.button('fullscreen', 'expand', 'Full screen', 'F', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      }, 'desktop'),
      this.button('help', 'help', 'Help & shortcuts', '?', () => showHelp(app), 'desktop'),
    );
    app.root.append(bar);
    const sync = () => {
      this.buttons.get('night')?.classList.toggle('active', app.settings.get().stargaze);
      for (const id of ['search', 'tonight', 'events', 'layers', 'location', 'settings', 'moments', 'asabove', 'learn'])
        this.buttons.get(id)?.classList.toggle('active', app.panels?.current === id);
      this.buttons.get('pointing')?.classList.toggle('active', app.pointing?.active ?? false);
      this.buttons.get('orrery')?.classList.toggle('active', app.orreryVisible);
    };
    app.settings.onChange(sync);
    app.onFrame(sync);
  }

  private button(id: string, ic: keyof typeof ICONS, label: string, key: string, onClick: () => void, extra = ''): HTMLButtonElement {
    const b = h(
      'button',
      { class: `tool ${extra}`, 'aria-label': label, onclick: onClick },
      icon(ic, 20),
      h('span', { class: 'kbd-hint' }, label, key ? h('kbd', {}, key) : ''),
    );
    this.buttons.set(id, b);
    return b;
  }
}
