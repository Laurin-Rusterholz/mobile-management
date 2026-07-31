// ============================================================================
//  Home — Springboard im Stil des Apple-Homebildschirms, im Quantus-Design
//  ---------------------------------------------------------------------------
//  Aufbau wie auf iPhone/iPad: Statuszeile mit Datum, Widget-Reihe, seitlich
//  blätterbare Seiten mit App-Symbolen (Squircles), Seitenpunkte und ein Dock,
//  das auf allen Seiten sichtbar bleibt. Suche öffnet die globale Suche.
//  Symbole lassen sich per langem Druck ins Dock legen bzw. daraus entfernen.
// ============================================================================
import { escHTML, todayYmd, fmtDurationMin, haptic, toast } from '../util.js';
import { SPRINGBOARD_PAGES, SPRINGBOARD_DOCK, LS } from '../config.js';
import * as store from '../store.js';
import * as focus from '../focus.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { openSearch } from '../search.js';

// ── persistente Anpassung (eigenes Dock, ausgeblendete Symbole) ─────────────
function prefs() {
  try {
    return { dock: null, hidden: [], page: 0, ...JSON.parse(localStorage.getItem(LS.springboard) || '{}') };
  } catch (e) { return { dock: null, hidden: [], page: 0 }; }
}
function savePrefs(p) { try { localStorage.setItem(LS.springboard, JSON.stringify(p)); } catch (e) {} }

const ALL_APPS = (() => {
  const map = new Map();
  SPRINGBOARD_PAGES.forEach(page => page.apps.forEach(app => map.set(app.key, app)));
  SPRINGBOARD_DOCK.forEach(app => map.set(app.key, app));
  return map;
})();

function dockApps() {
  const p = prefs();
  const keys = Array.isArray(p.dock) && p.dock.length ? p.dock : SPRINGBOARD_DOCK.map(a => a.key);
  return keys.map(k => ALL_APPS.get(k)).filter(Boolean).slice(0, 4);
}

// ── Badges auf den Symbolen (wie ungelesene Mails auf iOS) ──────────────────
function badgeFor(key) {
  if (key === 'planen') return store.getTasks().filter(t => t.status !== 'done').length;
  if (key === 'inbox') return store.getInboxItems().length;
  if (key === 'flashcards') return store.getDueCards().length;
  if (key === 'journal') return store.getJournalPushes().length;
  if (key === 'meetings') {
    const today = new Date(new Date().toDateString());
    return store.getMeetings().filter(m => m.date && new Date(m.date) >= today).length;
  }
  if (key === 'projekte') return store.getProjects().filter(p => (p.status || 'active') === 'active').length;
  if (key === 'flowertech') {
    const ft = (store.state.data && store.state.data.flowertech) || {};
    const invoices = Array.isArray(ft.invoices) ? ft.invoices : [];
    return invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled').length;
  }
  return 0;
}

function iconHtml(app, inDock = false, pinned = false) {
  const badge = badgeFor(app.key);
  return `<button class="sb-app ${inDock ? 'in-dock' : ''} ${pinned ? 'pinned' : ''}" data-action="sb-open"
      data-route="${app.route}" data-key="${app.key}" title="${escHTML(app.label)}">
    <span class="sb-icon tone-${app.tone || 'violet'}">
      <span class="sb-glyph">${app.icon}</span>
      ${badge > 0 ? `<span class="sb-badge">${badge > 99 ? '99+' : badge}</span>` : ''}
    </span>
    <span class="sb-label">${escHTML(app.label)}</span>
  </button>`;
}

// ── Widgets (obere Reihe, wie iOS-Widgets) ─────────────────────────────────
function widgets() {
  const today = todayYmd();
  const tasks = store.getTasks().filter(t => t.status !== 'done');
  const dueToday = tasks.filter(t => (t.dueDate || '').slice(0, 10) === today).length;
  const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString())).length;
  const habits = store.getHabits();
  const doneHabits = habits.filter(h => store.habitDoneOn(h, today)).length;
  const day = focus.statsForDay(today);
  const next = store.getMeetings()
    .filter(m => m.date && new Date(m.date) >= new Date(new Date().toDateString()))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];

  return `<div class="sb-widgets">
    <button class="sb-widget wide" data-action="sb-open" data-route="uebersicht">
      <div class="sb-widget-head">📋 Heute</div>
      <div class="sb-widget-big">${dueToday}</div>
      <div class="sb-widget-sub">${dueToday === 1 ? 'Aufgabe fällig' : 'Aufgaben fällig'}${overdue ? ` · ${overdue} überfällig` : ''}</div>
    </button>
    <button class="sb-widget" data-action="sb-open" data-route="fokus">
      <div class="sb-widget-head">🎯 Fokus</div>
      <div class="sb-widget-big">${fmtDurationMin(day.minutes)}</div>
      <div class="sb-widget-sub">${day.count} Sitzung${day.count === 1 ? '' : 'en'}</div>
    </button>
    <button class="sb-widget" data-action="sb-open" data-route="gewohnheiten">
      <div class="sb-widget-head">🔁 Routinen</div>
      <div class="sb-widget-big">${doneHabits}/${habits.length}</div>
      <div class="sb-widget-sub">heute erledigt</div>
    </button>
    <button class="sb-widget wide" data-action="sb-open" data-route="kalender">
      <div class="sb-widget-head">📅 Als Nächstes</div>
      <div class="sb-widget-line">${next ? escHTML(String(next.title || next.name || 'Termin').slice(0, 42)) : 'Nichts geplant'}</div>
      <div class="sb-widget-sub">${next && next.date ? new Date(next.date).toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: 'short' }) : 'Freier Kalender'}</div>
    </button>
  </div>`;
}

// ── Aktionen ────────────────────────────────────────────────────────────────
let pressTimer = null;
let lastLongPress = 0;

// Symbol ins Dock legen bzw. daraus entfernen (langer Druck, wie auf iOS).
function toggleDock(key) {
  const p = prefs();
  const list = Array.isArray(p.dock) && p.dock.length ? p.dock.slice() : SPRINGBOARD_DOCK.map(a => a.key);
  const idx = list.indexOf(key);
  if (idx >= 0) list.splice(idx, 1);
  else { if (list.length >= 4) list.pop(); list.unshift(key); }
  p.dock = list;
  savePrefs(p);
  haptic(22);
  toast(idx >= 0 ? 'Aus dem Dock entfernt' : 'Ins Dock gelegt', 'ok');
  store.notify();
}

registerActions({
  // Nach einem langen Druck darf der folgende Klick nicht navigieren.
  'sb-open': (d) => { if (Date.now() - lastLongPress < 700) return; navigate(d.route); },
  'sb-search': () => openSearch(),
  'sb-page': (d) => {
    const host = document.getElementById('sbPages');
    if (!host) return;
    host.scrollTo({ left: host.clientWidth * Number(d.page || 0), behavior: 'smooth' });
  },
});

export default {
  title: 'Quantus', icon: '🏠',
  render() {
    const now = new Date();
    const greeting = now.getHours() < 11 ? 'Guten Morgen' : now.getHours() < 18 ? 'Hallo' : 'Guten Abend';
    const dock = dockApps();
    const dockKeys = new Set(dock.map(a => a.key));

    return `<div class="springboard">
      <div class="sb-top">
        <div>
          <div class="sb-date">${now.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <div class="sb-greet">${greeting}, Laurin.</div>
        </div>
        <div class="sb-actions">
          <button class="sb-search" data-action="sb-search" aria-label="Suchen">🔍</button>
          <button class="sb-search" data-action="open-new" aria-label="Neu erstellen">＋</button>
        </div>
      </div>

      ${widgets()}

      <div class="sb-pages" id="sbPages">
        ${SPRINGBOARD_PAGES.map(page => `
          <section class="sb-page">
            <div class="sb-page-title">${escHTML(page.title)}</div>
            <div class="sb-grid">${page.apps.map(a => iconHtml(a, false, dockKeys.has(a.key))).join('')}</div>
          </section>`).join('')}
      </div>

      <div class="sb-dots" id="sbDots">
        ${SPRINGBOARD_PAGES.map((p, i) => `<button class="sb-dot ${i === 0 ? 'on' : ''}" data-action="sb-page" data-page="${i}" aria-label="Seite ${i + 1}"></button>`).join('')}
      </div>

      <div class="sb-dock">${dock.map(a => iconHtml(a, true)).join('')}</div>
    </div>`;
  },

  mount(root) {
    // Seitenpunkte folgen dem horizontalen Blättern.
    const pages = root.querySelector('#sbPages');
    const dots = root.querySelectorAll('.sb-dot');
    if (pages && dots.length) {
      const sync = () => {
        const idx = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
        dots.forEach((d, i) => d.classList.toggle('on', i === idx));
        const p = prefs(); p.page = idx; savePrefs(p);
      };
      pages.addEventListener('scroll', () => { clearTimeout(pages._t); pages._t = setTimeout(sync, 80); }, { passive: true });
      const saved = prefs().page || 0;
      if (saved > 0) requestAnimationFrame(() => { pages.scrollLeft = pages.clientWidth * saved; sync(); });
    }

    // Langer Druck auf ein Symbol: ins Dock legen bzw. daraus entfernen.
    root.querySelectorAll('.sb-app').forEach(btn => {
      const start = () => {
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          btn.classList.add('jiggle');
          lastLongPress = Date.now();
          setTimeout(() => btn.classList.remove('jiggle'), 500);
          toggleDock(btn.dataset.key);
        }, 550);
      };
      const cancel = () => clearTimeout(pressTimer);
      btn.addEventListener('touchstart', start, { passive: true });
      btn.addEventListener('touchend', cancel);
      btn.addEventListener('touchmove', cancel, { passive: true });
      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', cancel);
      btn.addEventListener('mouseleave', cancel);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  },
};
