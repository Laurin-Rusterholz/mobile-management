// ============================================================================
//  Fokus — Timer (frei / 25 / 50 / individuell) + Statistiken
// ============================================================================
import { escHTML, fmtMs, fmtDurationMin, todayYmd } from '../util.js';
import * as focus from '../focus.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader } from './common.js';

const MODES = [{ min: 0, label: 'Frei' }, { min: 25, label: '25 Min' }, { min: 50, label: '50 Min' }];

function runningView() {
  const a = focus.getActive();
  const rem = focus.remainingMs(a);
  const display = rem == null ? '+' + fmtMs(focus.elapsedMs(a)) : fmtMs(Math.max(0, rem));
  return `<div class="focus-live">
    <div class="focus-ring">
      <div class="focus-time" id="focusTime">${display}</div>
      <div class="focus-sub">${escHTML(a.sessionName || 'Deep Work')}</div>
      ${a.taskTitle ? `<div class="focus-task">📌 ${escHTML(a.taskTitle)}</div>` : ''}
    </div>
    <div class="focus-hint">Bleib in der App — beim Verlassen/Sperren wird die Sitzung als <b>unterbrochen</b> gespeichert.</div>
    <div class="focus-controls">
      <button class="btn danger block" data-action="focus-stop">■ Stoppen & erfassen</button>
    </div>
  </div>`;
}

function setupView() {
  const prefs = focus.getPrefs();
  const tasks = store.getTasks().filter(t => t.status !== 'done').slice(0, 50);
  const d = focus.statsForDay(), w = focus.statsForWeek();
  const byTask = focus.statsByTask().slice(0, 5);
  return `<div class="pad">
    ${pageHeader('Fokus', 'Tiefe Arbeit, sauber erfasst')}
    <div class="focus-modes" id="focusModes">
      ${MODES.map(m => `<button class="mode ${m.min === (prefs.durationMin || 0) ? 'active' : ''}" data-action="focus-mode" data-min="${m.min}">${m.label}</button>`).join('')}
      <button class="mode ${![0, 25, 50].includes(prefs.durationMin) ? 'active' : ''}" data-action="focus-custom">Individuell</button>
    </div>
    <label class="f"><span class="f-label">Sitzungsname</span><input id="focusName" class="input" value="${escHTML(prefs.sessionName || 'Deep Work')}" placeholder="Deep Work"></label>
    <label class="f"><span class="f-label">Aufgabe (optional)</span>
      <select id="focusTask" class="input"><option value="">— keine —</option>${tasks.map(t => `<option value="${t.id}" ${t.id === prefs.taskId ? 'selected' : ''}>${escHTML(t.title || '')}</option>`).join('')}</select>
    </label>
    <button class="btn primary block big" data-action="focus-start">🎯 Fokus starten${prefs.durationMin ? ` · ${prefs.durationMin} Min` : ' · frei'}</button>

    <div class="stat-row" style="margin-top:18px">
      <div class="stat"><div class="stat-num">${fmtDurationMin(d.minutes)}</div><div class="stat-lbl">heute</div></div>
      <div class="stat"><div class="stat-num">${fmtDurationMin(w.minutes)}</div><div class="stat-lbl">7 Tage</div></div>
      <div class="stat"><div class="stat-num">${d.count}</div><div class="stat-lbl">Sessions heute</div></div>
    </div>
    ${byTask.length ? `<div class="section-title">Nach Aufgabe</div>${byTask.map(x => `<div class="bar-row"><span class="bar-label">${escHTML(x.label)}</span><span class="bar-val">${fmtDurationMin(x.minutes)}</span></div>`).join('')}` : ''}
  </div>`;
}

registerActions({
  'focus-mode': (d) => { const p = focus.getPrefs(); p.durationMin = Number(d.min); focus.savePrefs(p); navigate('fokus'); },
  'focus-custom': () => {
    const p = focus.getPrefs();
    const v = prompt('Dauer in Minuten (0 = frei):', String(p.durationMin || 25));
    if (v == null) return;
    p.durationMin = Math.max(0, parseInt(v, 10) || 0); focus.savePrefs(p); navigate('fokus');
  },
  'focus-start': () => {
    const name = (document.getElementById('focusName') || {}).value || 'Deep Work';
    const taskId = (document.getElementById('focusTask') || {}).value || '';
    const task = taskId ? store.getById('task', taskId) : null;
    const p = focus.getPrefs(); p.sessionName = name; p.taskId = taskId; focus.savePrefs(p);
    focus.start({ durationMin: p.durationMin || 0, sessionName: name, taskId, taskTitle: task ? task.title : '', projectId: task ? (task.projectId || '') : '' });
    navigate('fokus');
  },
  'focus-stop': async () => { await focus.finish('stopped'); navigate('fokus'); },
});

export default {
  title: 'Fokus', icon: '🎯',
  render() { return focus.isRunning() ? `<div class="pad">${runningView()}</div>` : setupView(); },
  mount(root) {
    if (focus.isRunning()) {
      const t = root.querySelector('#focusTime');
      focus.onFocusChange(() => {
        const a = focus.getActive(); if (!a || !t) return;
        const rem = focus.remainingMs(a);
        t.textContent = rem == null ? '+' + fmtMs(focus.elapsedMs(a)) : fmtMs(Math.max(0, rem));
      });
    }
  },
};
