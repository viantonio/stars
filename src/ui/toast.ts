import { h } from './dom';

export class Toasts {
  private host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });

  constructor(root: HTMLElement) {
    root.append(this.host);
  }

  show(text: string, ms = 2600): void {
    const t = h('div', { class: 'toast glass' }, text);
    this.host.append(t);
    while (this.host.children.length > 3) this.host.firstElementChild?.remove();
    setTimeout(() => {
      t.style.transition = 'opacity .4s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 450);
    }, ms);
  }
}
