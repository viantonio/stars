import '../styles/learn.css';
import type { App } from '../app';
import type { PanelView } from '../ui/panels';
import { h, icon } from '../ui/dom';
import { LESSONS } from './lessons';
import { GLOSSARY } from './glossary';
import { LessonPlayer } from './player';
import { progress } from './progress';
import { lessonIcon } from './icons';

export { LessonPlayer } from './player';

/** The Sky School panel: lesson catalogue and glossary. */
export function renderLearn(app: App): PanelView {
  const player = LessonPlayer.for(app);
  let tab: 'lessons' | 'glossary' = 'lessons';
  const body = h('div', { class: 'learn-panel' });
  const tabLessons = h('button', { type: 'button', role: 'tab', onclick: () => setTab('lessons') }, 'Lessons');
  const tabGloss = h('button', { type: 'button', role: 'tab', onclick: () => setTab('glossary') }, 'Glossary');
  const header = h('div', { class: 'panel-tabs', role: 'tablist', 'aria-label': 'Sky School sections' }, tabLessons, tabGloss);
  let search: HTMLInputElement | null = null;

  function setTab(t: typeof tab): void {
    tab = t;
    tabLessons.classList.toggle('active', t === 'lessons');
    tabGloss.classList.toggle('active', t === 'glossary');
    tabLessons.setAttribute('aria-selected', String(t === 'lessons'));
    tabGloss.setAttribute('aria-selected', String(t === 'glossary'));
    if (t === 'lessons') renderLessons();
    else renderGlossary();
  }

  function renderLessons(): void {
    const done = progress.completedCount();
    const pct = Math.round((done / LESSONS.length) * 100);
    const playing = player.lesson;
    body.replaceChildren(
      h(
        'div',
        { class: 'card learn-intro' },
        h('p', {}, 'Short guided tours that move the real sky for you — setting the time, the place and the view — while explaining what you are looking at. Tap any ', h('span', { class: 'gloss-sample' }, 'underlined term'), ' for its meaning.'),
        h(
          'div',
          { class: 'learn-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(LESSONS.length), 'aria-valuenow': String(done), 'aria-label': 'Lessons completed' },
          h('div', { class: 'learn-progress-bar' }, h('div', { style: `width:${pct}%` })),
          h('span', { class: 'tabnum' }, `${done} of ${LESSONS.length} complete`),
        ),
      ),
      playing
        ? h(
            'div',
            { class: 'card learn-now' },
            h('div', { class: 'small muted' }, 'Now playing'),
            h('div', { style: 'font-weight:650;margin:2px 0 8px' }, playing.title),
            h(
              'div',
              { class: 'btn-row' },
              h('button', { class: 'btn primary', type: 'button', onclick: () => app.panels.close() }, 'Back to the lesson'),
              h('button', { class: 'btn', type: 'button', onclick: () => { player.stop(false); renderLessons(); } }, 'Exit lesson'),
            ),
          )
        : '',
      h('div', { class: 'section-title' }, 'Lessons'),
      h(
        'ol',
        { class: 'learn-list' },
        ...LESSONS.map((l, i) => {
          const complete = progress.isComplete(l.id);
          const reached = progress.reached(l.id);
          const resume = !complete && reached > 0;
          return h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                class: `learn-lesson${complete ? ' complete' : ''}`,
                onclick: () => player.start(l, resume ? reached : 0),
                'aria-label': `Lesson ${i + 1}: ${l.title}. ${l.minutes} minutes, ${l.steps.length} steps.${complete ? ' Completed.' : resume ? ` In progress, step ${reached + 1}.` : ''}`,
              },
              h('span', { class: 'learn-lesson-icon' }, lessonIcon(l.icon, 22), h('span', { class: 'learn-num' }, String(i + 1))),
              h(
                'span',
                { class: 'learn-lesson-main' },
                h('span', { class: 'learn-lesson-title' }, l.title),
                h('span', { class: 'learn-lesson-blurb' }, l.blurb),
                h(
                  'span',
                  { class: 'learn-lesson-meta' },
                  `${l.minutes} min · ${l.steps.length} steps`,
                  resume ? h('span', { class: 'pill gold' }, `Resume at step ${reached + 1}`) : '',
                ),
              ),
              h('span', { class: 'learn-lesson-state', 'aria-hidden': 'true' }, complete ? checkIcon() : icon('play', 14)),
            ),
          );
        }),
      ),
      done
        ? h('button', { class: 'learn-reset', type: 'button', onclick: () => { progress.reset(); renderLessons(); } }, 'Reset progress')
        : '',
    );
  }

  function renderGlossary(): void {
    search = h('input', { type: 'search', placeholder: 'Find a term…', 'aria-label': 'Search the glossary', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
    const list = h('dl', { class: 'learn-glossary' });
    const fill = () => {
      const q = search!.value.trim().toLowerCase();
      const items = [...GLOSSARY]
        .sort((a, b) => a.term.localeCompare(b.term))
        .filter((t) => !q || t.term.toLowerCase().includes(q) || t.def.toLowerCase().includes(q) || t.aliases?.some((a) => a.toLowerCase().includes(q)));
      list.replaceChildren(...items.flatMap((t) => [h('dt', {}, t.term), h('dd', {}, t.def)]));
      if (!items.length) list.append(h('p', { class: 'note' }, 'No matching terms.'));
    };
    search.addEventListener('input', fill);
    fill();
    body.replaceChildren(h('div', { class: 'search-box' }, icon('search', 18), search), list);
  }

  const off = player.onChange(() => {
    if (tab === 'lessons') renderLessons();
  });
  setTab('lessons');

  return {
    title: 'Sky School',
    subtitle: 'Learn the sky by exploring it',
    header,
    body,
    dispose: off,
  };
}

function checkIcon(): SVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  return wrap.firstElementChild as SVGElement;
}
