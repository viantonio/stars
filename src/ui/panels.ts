import type { App } from '../app';
import { h, icon } from './dom';
import { renderTonight } from './tonight';
import { renderEvents } from './events';
import { renderSearch } from './search';
import { renderLayers, renderSettings, renderLocation } from './settingsPanels';

export type PanelId = 'search' | 'tonight' | 'events' | 'layers' | 'location' | 'settings';

export interface PanelView {
  title: string;
  subtitle?: string;
  body: HTMLElement;
  header?: HTMLElement;
  /** Called ~5×/s while open. */
  update?(): void;
  focus?(): void;
  dispose?(): void;
}

const RENDERERS: Record<PanelId, (app: App) => PanelView> = {
  search: renderSearch,
  tonight: renderTonight,
  events: renderEvents,
  layers: renderLayers,
  location: renderLocation,
  settings: renderSettings,
};

/** A single slide-in panel that hosts one view at a time. */
export class PanelHost {
  current: PanelId | null = null;
  private el = h('aside', { class: 'panel glass', 'aria-hidden': 'true' });
  private view: PanelView | null = null;

  constructor(private app: App) {
    app.root.append(this.el);
    app.onFrame(() => this.view?.update?.());
  }

  toggle(id: PanelId): void {
    if (this.current === id) this.close();
    else this.open(id);
  }

  open(id: PanelId): void {
    this.view?.dispose?.();
    this.current = id;
    const v = (this.view = RENDERERS[id](this.app));
    const head = h(
      'div',
      { class: 'panel-head' },
      h('div', { style: 'flex:1;min-width:0' }, h('h2', {}, v.title), v.subtitle ? h('div', { class: 'sub' }, v.subtitle) : ''),
      h('button', { class: 'icon-btn', 'aria-label': 'Close panel', onclick: () => this.close() }, icon('close', 18)),
    );
    const body = h('div', { class: 'panel-body' }, v.body);
    this.el.replaceChildren(head, ...(v.header ? [v.header] : []), body);
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    // On small screens the info card and a panel would overlap.
    if (window.innerWidth < 760) this.app.info.close(false);
    requestAnimationFrame(() => v.focus?.());
  }

  close(): void {
    this.view?.dispose?.();
    this.view = null;
    this.current = null;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
  }
}
