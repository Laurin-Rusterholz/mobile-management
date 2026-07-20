// ============================================================================
//  Home — konfigurierbare Karten (Daily Briefing, Aufgaben, Projekte, …)
// ============================================================================
import { escHTML, todayYmd, ymdOf, fmtDurationMin, openSheet } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { LS } from '../config.js';
import * as focus from '../focus.js';

// verfügbare Karten
const CARDS = [
  { key: 'briefing',  label: 'Daily Briefing' },
  { key: 'today',     label: 'Heute fällig' },
  { key: 'overdue',   label: 'Überfällig' },
  { key: 'projects',  label: 'Laufende Projekte' },
  { key: 'meetings',  label: 'Nächste Meetings' },
  { key: 'habits',    label: 'Heutige Gewohnheiten' },
  { key: 'flashcards',label: 'Fällige Flashcards' },
  { key: 'focus',     label: 'Fokuszeit' },
  { key: 'budget',    label: 'Budgetstatus' },
  { key: 'ideas',     label: 'Ideen' },
  { key: 'notes',     label: 'Zuletzt bearbeitet' },
];

function cfg() {
  try { return { order: CARDS.map(c => c.key), hidden: [], ...JSON.parse(localStorage.getItem(LS.homeCards) || '{}') }; }
  catch (e) { return { order: CARDS.map(c => c.key), hidden: [] }; }
}
function saveCfg(c) { try { localStorage.setItem(LS.homeCards, JSON.stringify(c)); } catch (e) {} }

function card(title, icon, bodyHtml, route) {
  return `<section class="hcard">
    <div class="hcard-head" ${route ? `data-action="go" data-route="${route}"` : ''}>
      <span class="hcard-icon">${icon}</span><span class="hcard-title">${escHTML(title)}</span>
      ${route ? '<span class="hcard-more">›</span>' : ''}
    </div>
    <div class="hcard-body">${bodyHtml}</div>
  </section>`;
}

function renderCard(key) {
  const today = todayYmd();
  if (key === 'briefing') {
    const b = store.getDailyBriefing();
    const greeting = new Date().getHours() < 11 ? 'Guten Morgen' : new Date().getHours() < 18 ? 'Hallo' : 'Guten Abend';
    const openTasks = store.getTasks().filter(t => t.status !== 'done').length;
    const habits = store.getHabits();
    const doneHabits = habits.filter(h => store.habitDoneOn(h, today)).length;
    return card('Daily Briefing', '📋', `
      <div class="briefing">
        <div class="briefing-hi">${greeting}. Heute ist ${new Date().toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' })}.</div>
        <ul class="briefing-list">
          <li>${openTasks} offene Aufgabe${openTasks === 1 ? '' : 'n'}</li>
          ${habits.length ? `<li>${doneHabits}/${habits.length} Gewohnheiten erledigt</li>` : ''}
          ${store.getDueCards().length ? `<li>${store.getDueCards().length} Flashcards fällig</li>` : ''}
        </ul>
        <div class="briefing-note">Fakten aus deinen Daten · Einschätzungen liefert Polaris.</div>
      </div>`, 'planen');
  }
  if (key === 'today') {
    const items = store.getTasks().filter(t => t.status !== 'done' && ymdOf(t.dueDate) === today);
    return card('Heute fällig', '☀️', list(items, 'task', 'planen', 'Nichts für heute geplant.'), 'planen');
  }
  if (key === 'overdue') {
    const items = store.getTasks().filter(t => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString()));
    if (!items.length) return '';
    return card('Überfällig', '⚠️', list(items, 'task', 'planen', ''), 'planen');
  }
  if (key === 'projects') {
    const items = store.getProjects().filter(p => (p.status || 'active') === 'active').slice(0, 5);
    return card('Laufende Projekte', '📦', list(items, 'project', 'planen', 'Keine aktiven Projekte.'), 'planen');
  }
  if (key === 'meetings') {
    const items = store.getMeetings().filter(m => !m.date || new Date(m.date) >= new Date(new Date().toDateString())).slice(0, 4);
    return card('Nächste Meetings', '🤝', list(items, 'meeting', 'meetings', 'Keine anstehenden Meetings.'), 'meetings');
  }
  if (key === 'habits') {
    const habits = store.getHabits();
    if (!habits.length) return card('Gewohnheiten', '🔁', '<div class="muted-row">Noch keine Gewohnheiten.</div>', 'gewohnheiten');
    return card('Heutige Gewohnheiten', '🔁', `<div class="habit-dots">${habits.slice(0, 8).map(h => {
      const done = store.habitDoneOn(h, today);
      return `<button class="habit-dot ${done ? 'on' : ''}" data-action="home-toggle-habit" data-id="${h.id}" title="${escHTML(h.text || '')}">${h.icon || '✅'}</button>`;
    }).join('')}</div>`, 'gewohnheiten');
  }
  if (key === 'flashcards') {
    const due = store.getDueCards().length;
    return card('Fällige Flashcards', '🎴', `<div class="big-stat"><span class="big-num">${due}</span><span class="big-lbl">Karten fällig</span></div>`, 'flashcards');
  }
  if (key === 'focus') {
    const d = focus.statsForDay(today), w = focus.statsForWeek();
    return card('Fokuszeit', '🎯', `<div class="stat-row">
      <div class="stat"><div class="stat-num">${fmtDurationMin(d.minutes)}</div><div class="stat-lbl">heute</div></div>
      <div class="stat"><div class="stat-num">${fmtDurationMin(w.minutes)}</div><div class="stat-lbl">7 Tage</div></div>
      <div class="stat"><div class="stat-num">${d.count}</div><div class="stat-lbl">Sessions</div></div>
    </div>`, 'fokus');
  }
  if (key === 'budget') {
    const month = today.slice(0, 7);
    const txns = store.getTransactions().filter(t => (t.date || '').slice(0, 7) === month);
    const spent = txns.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    return card('Budgetstatus', '💰', `<div class="big-stat"><span class="big-num">${spent.toLocaleString('de-CH', { style: 'currency', currency: 'CHF' })}</span><span class="big-lbl">Ausgaben diesen Monat</span></div>`, 'budget');
  }
  if (key === 'ideas') {
    const items = store.getIdeas().slice(-5).reverse();
    return card('Ideen', '💡', list(items, 'idea', 'ideen', 'Noch keine Ideen.'), 'ideen');
  }
  if (key === 'notes') {
    const items = store.getNotes().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 4);
    return card('Zuletzt bearbeitet', '📝', list(items, 'note', 'noteflow', 'Noch keine Notizen.'), 'noteflow');
  }
  return '';
}

function list(items, kind, route, emptyMsg) {
  if (!items.length) return emptyMsg ? `<div class="muted-row">${escHTML(emptyMsg)}</div>` : '<div class="muted-row">—</div>';
  return items.slice(0, 6).map(x => {
    const label = x.title || x.text || x.content || '(ohne Titel)';
    return `<button class="mini-row" data-action="go" data-route="${route}">
      <span class="mini-dot"></span><span class="mini-label">${escHTML(String(label).slice(0, 60))}</span>
    </button>`;
  }).join('');
}

// stabile Reihenfolge inkl. später ergänzter Karten
function orderedKeys(c) {
  const known = new Set(c.order);
  return [...c.order.filter(k => CARDS.some(x => x.key === k)), ...CARDS.map(x => x.key).filter(k => !known.has(k))];
}

registerActions({
  'home-toggle-habit': async (d) => {
    await store.performOp({ type: 'toggle-habit', payload: { id: d.id, date: todayYmd() } });
  },
  'home-configure': () => openConfig(),
  'home-card-toggle': (d) => {
    const cur = cfg();
    cur.hidden = cur.hidden.includes(d.key) ? cur.hidden.filter(k => k !== d.key) : [...new Set([...cur.hidden, d.key])];
    saveCfg(cur); rerenderConfig();
  },
  'home-card-move': (d) => {
    const cur = cfg(); const keys = orderedKeys(cur);
    const i = keys.indexOf(d.key); const j = d.dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    cur.order = keys; saveCfg(cur); rerenderConfig();
  },
});

function configBody() {
  const c = cfg();
  const keys = orderedKeys(c);
  return `<div class="cfg-list">${keys.map((k, idx) => {
    const card = CARDS.find(x => x.key === k); if (!card) return '';
    const visible = !c.hidden.includes(k);
    return `<div class="cfg-row">
      <div class="cfg-move">
        <button class="icon-btn" data-action="home-card-move" data-key="${k}" data-dir="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-action="home-card-move" data-key="${k}" data-dir="down" ${idx === keys.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <span class="cfg-name">${escHTML(card.label)}</span>
      <button class="chip ${visible ? 'accent' : ''}" data-action="home-card-toggle" data-key="${k}">${visible ? 'Sichtbar' : 'Aus'}</button>
    </div>`;
  }).join('')}</div>
  <div class="muted-row" style="margin-top:8px">↑/↓ ordnet, Chip blendet ein/aus. Änderungen sind sofort aktiv.</div>`;
}

function rerenderConfig() {
  const body = document.getElementById('sheetBody');
  if (body) body.innerHTML = configBody();
}

function openConfig() {
  openSheet({ title: 'Home anpassen', size: 'half', body: configBody(), onClose: () => navigate('home') });
}

export default {
  title: 'Home', icon: '🏠',
  render() {
    const c = cfg();
    const cards = orderedKeys(c).filter(k => !c.hidden.includes(k)).map(renderCard).filter(Boolean).join('');
    return `<div class="pad">
      <div class="home-top">
        <div class="home-greet">Quantus</div>
        <button class="chip" data-action="home-configure">⚙︎ Karten</button>
      </div>
      ${cards || '<div class="muted-row">Alle Karten ausgeblendet.</div>'}
    </div>`;
  },
};
