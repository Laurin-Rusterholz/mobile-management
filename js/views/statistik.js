// ============================================================================
//  Statistiken — Zahlen und Verläufe aus den synchronisierten Daten
//  Aufgaben, Fokuszeit, Gewohnheiten, Budget, Sammlungen. Reine Auswertung,
//  keine Schreibzugriffe.
// ============================================================================
import { escHTML, todayYmd, fmtDurationMin, fmtMoney } from '../util.js';
import * as store from '../store.js';
import * as focus from '../focus.js';
import { COLLECTIONS } from '../config.js';
import { pageHeader } from './common.js';
import { registerActions } from '../actions.js';

registerActions({
  'stats-note': async () => {
    const label = `Statistik ${todayYmd().slice(0, 7)}`;
    const { openNoteComposer } = await import('../note-ui.js');
    openNoteComposer({
      heading: 'Erkenntnis aus Statistiken', noteClass: 'learning', tags: [label], lockedTags: [label],
      source: { app: 'statistics', entityType: 'month', entityId: todayYmd().slice(0, 7), label, route: '#/statistik' },
      placeholder: 'Welche Entwicklung fällt dir auf? (Keine Finanzdetails werden automatisch kopiert.)',
    });
  },
});

function last7() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(todayYmd(d));
  }
  return out;
}

function bars(values, labels) {
  const max = Math.max(1, ...values);
  return `<div class="stat-bars">${values.map((v, i) => `
    <div class="stat-bar">
      <div class="stat-bar-fill" style="height:${Math.round((v / max) * 100)}%"></div>
      <span class="stat-bar-label">${escHTML(labels[i])}</span>
      <span class="stat-bar-value">${v}</span>
    </div>`).join('')}</div>`;
}

export default {
  title: 'Statistiken', icon: '📊',
  render() {
    const tasks = store.getTasks();
    const open = tasks.filter(t => t.status !== 'done');
    const done = tasks.filter(t => t.status === 'done');
    const days = last7();
    const dayLabels = days.map(d => new Date(d + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'short' }));
    const donePerDay = days.map(d => done.filter(t => String(t.completedAt || t.updatedAt || '').slice(0, 10) === d).length);
    const focusPerDay = days.map(d => Math.round(focus.statsForDay(d).minutes));
    const habits = store.getHabits();
    const habitRate = habits.length
      ? Math.round(days.reduce((sum, d) => sum + habits.filter(h => store.habitDoneOn(h, d)).length, 0) / (habits.length * 7) * 100)
      : 0;
    const month = todayYmd().slice(0, 7);
    const txns = store.getTransactions().filter(t => String(t.date || '').slice(0, 7) === month);
    const spent = txns.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const income = txns.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);

    return `<div class="pad">
      ${pageHeader('Statistiken', 'Die letzten sieben Tage', '<button class="chip" data-action="stats-note">🧠 Erkenntnis</button>')}

      <section class="hcard"><div class="hcard-head"><span class="hcard-icon">✅</span><span class="hcard-title">Aufgaben</span></div>
        <div class="hcard-body">
          <div class="stat-row">
            <div class="stat"><div class="stat-num">${open.length}</div><div class="stat-lbl">offen</div></div>
            <div class="stat"><div class="stat-num">${done.length}</div><div class="stat-lbl">erledigt</div></div>
            <div class="stat"><div class="stat-num">${donePerDay.reduce((a, b) => a + b, 0)}</div><div class="stat-lbl">diese Woche</div></div>
          </div>
          ${bars(donePerDay, dayLabels)}
        </div></section>

      <section class="hcard"><div class="hcard-head"><span class="hcard-icon">🎯</span><span class="hcard-title">Fokuszeit</span></div>
        <div class="hcard-body">
          <div class="stat-row">
            <div class="stat"><div class="stat-num">${fmtDurationMin(focus.statsForDay(todayYmd()).minutes)}</div><div class="stat-lbl">heute</div></div>
            <div class="stat"><div class="stat-num">${fmtDurationMin(focus.statsForWeek().minutes)}</div><div class="stat-lbl">7 Tage</div></div>
          </div>
          ${bars(focusPerDay, dayLabels)}
        </div></section>

      <section class="hcard"><div class="hcard-head"><span class="hcard-icon">🔁</span><span class="hcard-title">Gewohnheiten</span></div>
        <div class="hcard-body"><div class="big-stat"><span class="big-num">${habitRate}%</span>
          <span class="big-lbl">Erfüllungsquote (7 Tage, ${habits.length} Routinen)</span></div></div></section>

      <section class="hcard"><div class="hcard-head"><span class="hcard-icon">💰</span><span class="hcard-title">Budget diesen Monat</span></div>
        <div class="hcard-body"><div class="stat-row">
          <div class="stat"><div class="stat-num">${fmtMoney(income)}</div><div class="stat-lbl">Einnahmen</div></div>
          <div class="stat"><div class="stat-num">${fmtMoney(spent)}</div><div class="stat-lbl">Ausgaben</div></div>
          <div class="stat"><div class="stat-num">${fmtMoney(income - spent)}</div><div class="stat-lbl">Saldo</div></div>
        </div></div></section>

      <section class="hcard"><div class="hcard-head"><span class="hcard-icon">🗂️</span><span class="hcard-title">Bestände</span></div>
        <div class="hcard-body">${Object.entries(COLLECTIONS).map(([key, cfg]) => `
          <button class="mini-row" data-action="go" data-route="${key}">
            <span class="mini-dot"></span>
            <span class="mini-label">${cfg.icon} ${escHTML(cfg.plural)}</span>
            <span class="mini-value">${store.getCollection(cfg.entity).length}</span>
          </button>`).join('')}
          <button class="mini-row" data-action="go" data-route="noteflow">
            <span class="mini-dot"></span><span class="mini-label">📝 Notizen</span>
            <span class="mini-value">${store.getNotes().length}</span></button>
          <button class="mini-row" data-action="go" data-route="ideen">
            <span class="mini-dot"></span><span class="mini-label">💡 Ideen</span>
            <span class="mini-value">${store.getIdeaNotes().filter((note) => ((note.ideaMeta && note.ideaMeta.status) || note.status || 'idea') !== 'archived').length}</span></button>
        </div></section>
    </div>`;
  },
};
