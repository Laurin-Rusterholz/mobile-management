// ============================================================================
//  Gewohnheiten — täglich/wöchentlich/frei, Serien, Erfüllungsquote
//  Sonderpfad: data.dailyBriefing.routines[]
// ============================================================================
import { escHTML, todayYmd } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { pageHeader } from './common.js';

function streak(h) {
  const set = new Set((h.completions || []).map(c => c && c.date));
  let s = 0; const d = new Date();
  for (;;) { const y = todayYmd(d); if (set.has(y)) { s++; d.setDate(d.getDate() - 1); } else break; }
  return s;
}
function rate30(h) {
  const set = new Set((h.completions || []).map(c => c && c.date));
  let hit = 0; const d = new Date();
  for (let i = 0; i < 30; i++) { if (set.has(todayYmd(d))) hit++; d.setDate(d.getDate() - 1); }
  return Math.round((hit / 30) * 100);
}
const FREQ = { daily: 'Täglich', weekdays: 'Wochentags', weekly: 'Wöchentlich', weekends: 'Wochenende', custom: 'Frei' };

registerActions({
  'habit-toggle': async (d) => { await store.performOp({ type: 'toggle-habit', payload: { id: d.id, date: todayYmd() } }); },
  'habit-delete': async (d) => { await store.performOp({ type: 'delete-habit', payload: { id: d.id } }); },
});

export default {
  title: 'Gewohnheiten', icon: '🔁',
  render() {
    const today = todayYmd();
    const habits = store.getHabits();
    const done = habits.filter(h => store.habitDoneOn(h, today)).length;
    return `<div class="pad">
      ${pageHeader('Gewohnheiten', habits.length ? `${done}/${habits.length} heute erledigt` : 'Routinen aufbauen', `<button class="chip" data-action="open-new">＋ Neu</button>`)}
      ${habits.length ? habits.map(h => {
        const on = store.habitDoneOn(h, today);
        const st = streak(h), rt = rate30(h);
        return `<div class="card habit-card ${on ? 'done' : ''}">
          <button class="habit-check ${on ? 'on' : ''}" data-action="habit-toggle" data-id="${h.id}">${on ? '✓' : (h.icon || '○')}</button>
          <div class="habit-main">
            <div class="habit-title">${escHTML(h.text || '(ohne Name)')}</div>
            <div class="habit-meta">
              <span class="meta">${FREQ[h.frequency] || 'Täglich'}</span>
              ${st ? `<span class="meta">🔥 ${st} Tage</span>` : ''}
              <span class="meta">${rt}% · 30T</span>
            </div>
            <div class="habit-bar"><div class="habit-bar-fill" style="width:${rt}%"></div></div>
          </div>
          <button class="icon-btn danger" data-action="habit-delete" data-id="${h.id}" aria-label="Löschen">🗑</button>
        </div>`;
      }).join('')
      : `<div class="empty"><div class="empty-icon">🔁</div><div class="empty-title">Keine Gewohnheiten</div><div class="empty-sub">Baue Routinen mit Serien & Quote auf.</div></div>`}
    </div>`;
  },
};
