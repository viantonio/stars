import type { App } from '../app';
import type { PanelView } from './panels';
import { h } from './dom';

/** Placeholder until the chart, sky notes and Tree of Life views land. */
export function renderAsAbove(app: App): PanelView {
  void app;
  return {
    title: 'As Above',
    subtitle: 'Tradition, read from the real sky',
    body: h('p', { class: 'note' }, 'The chart, sky notes, journal and Tree of Life are being prepared.'),
  };
}
