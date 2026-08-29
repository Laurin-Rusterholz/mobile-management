// ============================================================================
//  Kalender — Agenda aus Terminen, Meetings und fälligen Aufgaben
//  Monatsraster (Tablet) bzw. Tagesliste (Handy), beides aus denselben Daten.
// ============================================================================
import { escHTML, todayYmd, formatTime } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader, segmented } from './common.js';

const ui = { mode: 'agenda', month: todayYmd().slice(0, 7) };

function ymd(value) { return String(value || '').slice(0, 10); }

function entries() {
  const out = [];
  store.getCollection('calendarEvents').forEach(e => {
    const day = ymd(e.date || e.start || e.startAt);
    if (day) out.push({ id: e.id, day, time: e.start || e.time || '', title: e.title || e.name || 'Termin', kind: 'event', place: e.location || e.place || '' });
  });
  store.getMeetings().forEach(m => {
    const day = ymd(m.date || m.start);
    if (day) out.push({ id: m.id, day, time: m.time || m.start || '', title: m.title || m.name || 'Meeting', kind: 'meeting', place: m.location || '' });
  });
  store.getTasks().filter(t => t.status !== 'done' && t.dueDate).forEach(t => {
    out.push({ id: t.id, day: ymd(t.dueDate), time: '', title: t.title || 'Aufgabe', kind: 'task', place: '' });
  });
  return out.sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
}

const ICON = { event: '📅', meeting: '🤝', task: '✅' };
const ROUTE = { event: 'kalender', meeting: 'meetings', task: 'planen' };

function agendaHtml() {
  const today = todayYmd();
  const list = entries().filter(e => e.day >= today).slice(0, 80);
  if (!list.length) return '<div class="muted-row">Keine anstehenden Termine.</div>';
  const byDay = {};
  list.forEach(e => { (byDay[e.day] = byDay[e.day] || []).push(e); });
  return Object.keys(byDay).sort().map(day => `
    <section class="cal-day">
      <div class="cal-day-head">${day === today ? 'Heute · ' : ''}${new Date(day + 'T12:00:00')
        .toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: 'long' })}</div>
      ${byDay[day].map(e => `<div class="card row-card" data-action="cal-open" data-kind="${e.kind}" data-id="${escHTML(e.id || '')}">
        <div class="row-main"><div class="row-title">${ICON[e.kind]} ${escHTML(e.title)}</div>
        <div class="row-sub">${escHTML(e.time ? formatTime(e.time) || e.time : 'ganztags')}${e.place ? ' · ' + escHTML(e.place) : ''}</div></div>
        <button class="icon-btn" data-action="cal-note" data-kind="${e.kind}" data-id="${escHTML(e.id || '')}" data-title="${escHTML(e.title)}" aria-label="Notiz">📝</button>
      </div>`).join('')}
    </section>`).join('');
}

function monthHtml() {
  const [y, m] = ui.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;      // Montag als Wochenstart
  const map = {};
  entries().forEach(e => { (map[e.day] = map[e.day] || []).push(e); });
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const items = map[key] || [];
    cells.push(`<div class="cal-cell ${key === todayYmd() ? 'today' : ''}">
      <span class="cal-num">${d}</span>
      ${items.slice(0, 3).map(e => `<span class="cal-pill ${e.kind}">${escHTML(String(e.title).slice(0, 16))}</span>`).join('')}
      ${items.length > 3 ? `<span class="cal-more">+${items.length - 3}</span>` : ''}
    </div>`);
  }
  return `<div class="cal-monthbar">
      <button class="chip" data-action="cal-month" data-dir="-1">‹</button>
      <span>${first.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })}</span>
      <button class="chip" data-action="cal-month" data-dir="1">›</button>
    </div>
    <div class="cal-weekdays">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>`;
}

registerActions({
  'cal-mode': (d) => { ui.mode = d.seg; store.notify(); },
  'cal-open': (d) => navigate(ROUTE[d.kind] || 'kalender', { params: d.id ? { id: d.id } : {} }),
  'cal-note': async (d) => {
    const label = d.title || 'Kalendereintrag';
    const { openNoteComposer } = await import('../note-ui.js');
    openNoteComposer({
      heading: 'Notiz zum Kalendereintrag', noteClass: 'research', tags: [label], lockedTags: [label],
      source: { app: d.kind === 'meeting' ? 'meetings' : d.kind === 'task' ? 'tasks' : 'calendar', entityType: d.kind, entityId: d.id || null, label, route: `#/${ROUTE[d.kind] || 'kalender'}${d.id ? `?id=${encodeURIComponent(d.id)}` : ''}` },
    });
  },
  'cal-month': (d) => {
    const [y, m] = ui.month.split('-').map(Number);
    const next = new Date(y, m - 1 + Number(d.dir), 1);
    ui.month = next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0');
    store.notify();
  },
});

export default {
  title: 'Kalender', icon: '📅',
  render() {
    const upcoming = entries().filter(e => e.day >= todayYmd()).length;
    return `<div class="pad">
      ${pageHeader('Kalender', upcoming + ' anstehende Einträge')}
      ${segmented([{ key: 'agenda', label: 'Agenda' }, { key: 'month', label: 'Monat' }], ui.mode, 'cal-mode')}
      ${ui.mode === 'month' ? monthHtml() : agendaHtml()}
    </div>`;
  },
};
