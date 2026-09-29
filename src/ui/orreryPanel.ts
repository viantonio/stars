import { h, icon } from './dom';

export interface OrreryPanelBody {
  id: string;
  name: string;
  color: string;
}

export interface OrreryPanelOptions {
  bodies: OrreryPanelBody[];
  onFocus(id: string): void;
  onPreset(preset: 'inner' | 'outer'): void;
  onToggle(kind: 'comets' | 'asteroids', on: boolean): void;
  onClose(): void;
}

/** Glass overlay for the Solar System view: date, focus shortcuts, presets and layer toggles. */
export class OrreryPanel {
  readonly el: HTMLDivElement;
  private dateEl: HTMLDivElement;
  private readoutEl: HTMLDivElement;
  private bodyButtons = new Map<string, HTMLButtonElement>();
  private presetButtons = new Map<string, HTMLButtonElement>();
  private toggles = new Map<string, HTMLButtonElement>();
  private lastDate = '';
  private lastReadout = '';

  constructor(parent: HTMLElement, opts: OrreryPanelOptions) {
    this.dateEl = h('div', { class: 'op-date tabnum' });
    this.readoutEl = h('div', { class: 'op-readout tabnum' });

    const bodies = opts.bodies.map((b) => {
      const btn = h(
        'button',
        { class: 'op-body', 'aria-label': `Focus ${b.name}`, onclick: () => opts.onFocus(b.id) },
        h('i', { style: `--c:${b.color}` }),
        b.name,
      );
      this.bodyButtons.set(b.id, btn);
      return btn;
    });

    const preset = (id: 'inner' | 'outer', label: string) => {
      const btn = h('button', { class: 'op-btn', onclick: () => opts.onPreset(id) }, label);
      this.presetButtons.set(id, btn);
      return btn;
    };

    const toggle = (id: 'comets' | 'asteroids', label: string) => {
      const btn = h('button', { class: 'op-toggle on', role: 'switch', 'aria-checked': 'true' }, h('span', { class: 'op-sw' }), label);
      btn.addEventListener('click', () => {
        const on = !btn.classList.contains('on');
        this.setToggle(id, on);
        opts.onToggle(id, on);
      });
      this.toggles.set(id, btn);
      return btn;
    };

    this.el = h(
      'div',
      { class: 'orrery-panel glass', role: 'region', 'aria-label': 'Solar System view' },
      h(
        'div',
        { class: 'op-head' },
        h('div', {}, h('div', { class: 'op-title' }, 'Solar System'), this.dateEl),
        h('button', { class: 'op-close', 'aria-label': 'Back to the sky', title: 'Back to the sky (Esc)', onclick: () => opts.onClose() }, icon('close', 16)),
      ),
      h(
        'div',
        { class: 'op-scroll' },
        h('div', { class: 'op-presets' }, preset('inner', 'Inner system'), preset('outer', 'Outer system')),
        h('div', { class: 'op-bodies' }, bodies),
        h('div', { class: 'op-toggles' }, toggle('comets', 'Comets'), toggle('asteroids', 'Asteroids')),
      ),
      this.readoutEl,
      h('div', { class: 'op-note' }, 'Distances compressed (∝ √r) · planet sizes exaggerated'),
    );
    parent.append(this.el);
  }

  setDate(text: string): void {
    if (text === this.lastDate) return;
    this.lastDate = text;
    this.dateEl.textContent = text;
  }

  setReadout(text: string): void {
    if (text === this.lastReadout) return;
    this.lastReadout = text;
    this.readoutEl.textContent = text;
  }

  setActive(focusId: string | null, preset: 'inner' | 'outer' | null): void {
    for (const [id, b] of this.bodyButtons) b.classList.toggle('active', !preset && id === focusId);
    for (const [id, b] of this.presetButtons) b.classList.toggle('active', id === preset);
  }

  setToggle(id: 'comets' | 'asteroids', on: boolean): void {
    const b = this.toggles.get(id);
    if (!b) return;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
  }

  dispose(): void {
    this.el.remove();
  }
}
