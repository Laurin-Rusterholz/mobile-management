// ============================================================================
//  Home — Springboard im Stil des Apple-Homebildschirms, im Quantus-Design
//  ---------------------------------------------------------------------------
//  Aufbau wie auf iPhone/iPad: Statuszeile mit Datum, Widget-Reihe, seitlich
//  blätterbare Seiten mit App-Symbolen (Squircles), Seitenpunkte und ein Dock,
//  das auf allen Seiten sichtbar bleibt. Suche öffnet die globale Suche.
//
//  ANORDNEN (neu): langer Druck auf ein Symbol — oder der ✥-Knopf oben rechts —
//  schaltet den Anordnen-Modus. Darin lassen sich Symbole ziehen und legen:
//  innerhalb einer Seite, zwischen den Seiten (an den Rand ziehen blättert),
//  ins Dock und wieder heraus. Das ✕ am Symbol nimmt eine App vom
//  Homebildschirm; unten liegen alle Apps, die gerade nicht darauf liegen —
//  auch solche, die in der Vorgabe nie eine Kachel hatten. Seitentitel sind
//  Eingabefelder, eine leere Seite fällt beim Beenden weg.
//
//  Die Regeln der Anordnung stehen in ../springboard.js und sind dort ohne DOM
//  pruefbar; hier steht nur die Geste.
// ============================================================================
import { escHTML, todayYmd, fmtDurationMin, haptic, toast, confirmPreview } from '../util.js';
import * as sb from '../springboard.js';
import * as store from '../store.js';
import { briefingZahlen } from './briefing.js';
import * as focus from '../focus.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { openSearch } from '../search.js';

// ── Zustand der Ansicht ────────────────────────────────────────────────────
let layout = sb.loadLayout();
let editing = false;

function saveLayout() { sb.saveLayout(layout); }

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

// Ein Symbol. Kein <button>: im Anordnen-Modus sitzt ein eigener ✕-Knopf darin,
// und ein Knopf im Knopf ist kein gueltiges HTML. role/tabindex halten die
// Tastaturbedienung aufrecht (siehe keydown in mount()).
function iconHtml(app, inDock = false) {
  const badge = badgeFor(app.key);
  return `<div class="sb-app ${inDock ? 'in-dock' : ''}" data-action="sb-open" role="button" tabindex="0"
      data-route="${escHTML(app.route)}" data-key="${escHTML(app.key)}" title="${escHTML(app.label)}">
    <span class="sb-icon tone-${escHTML(app.tone || 'violet')}">
      <span class="sb-glyph">${app.icon}</span>
      ${badge > 0 ? `<span class="sb-badge">${badge > 99 ? '99+' : badge}</span>` : ''}
    </span>
    <span class="sb-label">${escHTML(app.label)}</span>
    <button class="sb-x" data-action="sb-remove" data-key="${escHTML(app.key)}"
      aria-label="${escHTML(app.label)} vom Homebildschirm nehmen" tabindex="-1">✕</button>
  </div>`;
}

// ── Morning Briefing, ganz oben ────────────────────────────────────────────
// BEFUND: store.getDailyBriefing() gab es laengst, wurde aber nirgends
// angezeigt. Auf dem Startbildschirm kam der Tag nicht vor. Der Block steht
// deshalb VOR den Kacheln und den Widgets — er ist das Erste, was man sieht.
// Er rechnet nichts selbst, sondern nimmt dieselben Zahlen wie die
// Briefing-Ansicht (briefingZahlen), damit beide nie auseinanderlaufen.
function briefingBlock() {
  const z = briefingZahlen();
  const naechster = z.termine
    .slice()
    .sort((a, b) => String(a.startTime || a.time || '').localeCompare(String(b.startTime || b.time || '')))[0];
  const zeilen = [];
  if (naechster) {
    zeilen.push(`<span class="bfb-line"><b>${escHTML(String(naechster.startTime || naechster.time || ''))}</b> ${escHTML(String(naechster.title || naechster.name || 'Termin').slice(0, 40))}</span>`);
  }
  if (z.ueberfaellig.length) {
    zeilen.push(`<span class="bfb-line warn">${z.ueberfaellig.length} überfällig</span>`);
  }
  if (!zeilen.length) zeilen.push('<span class="bfb-line">Nichts Dringendes — freier Lauf.</span>');

  return `<button class="bfb" data-action="sb-open" data-route="briefing">
    <span class="bfb-head">☀️ Dein Tag</span>
    <span class="bfb-nums">
      <span><b>${z.termine.length}</b> Termine</span>
      <span><b>${z.faellig.length}</b> fällig</span>
      <span><b>${z.erledigt}/${z.routinen.length}</b> Routinen</span>
    </span>
    <span class="bfb-lines">${zeilen.join('')}</span>
    <span class="bfb-more">Briefing öffnen ›</span>
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

// ── Routinen, ganz unten ───────────────────────────────────────────────────
// Sie standen bisher nur als Zahl im Widget ("0/6"). Eine Zahl sagt, dass
// etwas offen ist, aber nicht WAS — und abhaken liess sie sich gar nicht.
// Hier stehen sie ausgeschrieben und direkt antippbar, unter den Apps: der
// Platz, an dem man am Ende des Tages hinsieht.
function routinenBlock() {
  const heute = todayYmd();
  const habits = store.getHabits();
  if (!habits.length) return '';
  const erledigt = habits.filter(h => store.habitDoneOn(h, heute)).length;

  const zeile = (h) => {
    const on = store.habitDoneOn(h, heute);
    // Routinen mit Schritten tragen ihren Stand mit: "2/6" sagt mehr als ein
    // leeres Kaestchen. Ein Tipp fuehrt dann in die Routine, statt sie mit
    // einem Griff als erledigt zu erklaeren — die Schritte sind der Punkt.
    const subs = store.getSubUnits(h);
    const fertig = subs.length ? store.subUnitsDoneCount(h, heute) : 0;
    const aktion = subs.length ? 'sb-open' : 'sb-habit';
    // data-route nur dort, wo es auch gelesen wird — ein Attribut, das die
    // Aktion gar nicht benutzt, ist bloss eine Fussangel fuer den Naechsten.
    return `<button class="sb-rt ${on ? 'on' : ''}" data-action="${aktion}" data-id="${escHTML(String(h.id))}"${
      subs.length ? ' data-route="gewohnheiten"' : ''} aria-pressed="${on ? 'true' : 'false'}">
      <span class="sb-rt-box">${on ? '✓' : (h.icon || '○')}</span>
      <span class="sb-rt-label">${escHTML(String(h.text || '(ohne Name)'))}</span>
      ${subs.length ? `<span class="sb-rt-steps">${fertig}/${subs.length}</span>` : ''}
    </button>`;
  };

  return `<section class="sb-routines">
    <div class="sb-rt-head">
      <span class="sb-rt-title">🔁 Routinen heute</span>
      <span class="sb-rt-count">${erledigt}/${habits.length}</span>
    </div>
    <div class="sb-rt-list">${habits.map(zeile).join('')}</div>
    <button class="sb-rt-all" data-action="sb-open" data-route="gewohnheiten">Alle Routinen ›</button>
  </section>`;
}

// ── Leiste des Anordnen-Modus (immer gerendert, per CSS nur darin sichtbar) ─
function editBar() {
  const frei = sb.availableApps(layout);
  return `<div class="sb-editbar" id="sbEditbar">
    <div class="sb-editbar-top">
      <span class="sb-editbar-hint">Symbole ziehen · ✕ nimmt weg · Rand = Seite wechseln</span>
      <button class="sb-editbar-done" data-action="sb-done">Fertig</button>
    </div>
    <div class="sb-tray" id="sbTray">
      ${frei.length
        ? frei.map(a => `<button class="sb-chip" data-action="sb-add" data-key="${escHTML(a.key)}">
            <span class="sb-chip-icon tone-${escHTML(a.tone)}">${a.icon}</span>${escHTML(a.label)}</button>`).join('')
        : '<span class="sb-tray-empty">Alle Apps liegen auf dem Homebildschirm.</span>'}
    </div>
    <div class="sb-editbar-bottom">
      <button class="sb-editbar-btn" data-action="sb-add-page">＋ Seite</button>
      <button class="sb-editbar-btn" data-action="sb-reset">↺ Zurücksetzen</button>
    </div>
  </div>`;
}

// ── Anordnen: Zustand betreten/verlassen ───────────────────────────────────
function springboardEl() { return document.querySelector('.springboard'); }

function enterEdit() {
  if (editing) return;
  editing = true;
  // KEIN Neuaufbau: die Leiste, die ✕-Knoepfe und die Titelfelder sind bereits
  // gerendert und haengen nur an der Klasse. Wer mitten in einer Geste neu
  // aufbaut, zieht dem Finger das Element unter der Hand weg.
  const el = springboardEl();
  if (el) el.classList.add('editing');
  haptic(24);
  toast('Anordnen: Symbole ziehen, ✕ nimmt sie weg', 'ok');
}

function exitEdit() {
  if (!editing) return;
  editing = false;
  commitFromDom();
  layout = sb.dropEmptyPages(layout);
  saveLayout();
  refresh();
  toast('Anordnung gespeichert ✓', 'ok');
}

// Nach dem Ziehen ist der DOM die Wahrheit — von dort zurueck ins Modell.
function commitFromDom() {
  const root = springboardEl();
  if (!root) return;
  const pages = Array.from(root.querySelectorAll('.sb-page')).map((sec, i) => {
    const input = sec.querySelector('.sb-page-input');
    const titel = input ? input.value : (sec.querySelector('.sb-page-title') || {}).textContent;
    return {
      title: String(titel || 'Seite ' + (i + 1)).trim() || ('Seite ' + (i + 1)),
      keys: Array.from(sec.querySelectorAll('.sb-grid > .sb-app')).map(a => a.dataset.key),
    };
  });
  const dockEl = root.querySelector('#sbDock');
  const dock = dockEl ? Array.from(dockEl.querySelectorAll(':scope > .sb-app')).map(a => a.dataset.key) : layout.dock;
  layout = sb.layoutFromLists(pages, dock, sichtbareSeite());
  saveLayout();
}

// Die Ansicht baut sich selbst neu — die Schale darf das waehrend des
// Anordnens nicht tun (siehe busy() unten), sonst verschwaende ein
// Hintergrund-Abgleich mitten in der Geste den halben Bildschirm.
function refresh() {
  const content = document.getElementById('content');
  if (!content) return;
  content.innerHTML = view.render();
  view.mount(content);
}

function sichtbareSeite() {
  const host = document.getElementById('sbPages');
  if (!host || !host.clientWidth) return layout.page || 0;
  return Math.round(host.scrollLeft / host.clientWidth);
}

// ── Ziehen und Legen ───────────────────────────────────────────────────────
let pressTimer = null;
let lastLongPress = 0;
let drag = null;          // { el, ghost, dx, dy, key }
let kandidat = null;      // { el, x, y, pointerId }
let randTimer = null;
let randRichtung = 0;

function ghostAn(el, x, y) {
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add('sb-ghost');
  ghost.style.width = r.width + 'px';
  document.body.appendChild(ghost);
  drag = { el, ghost, dx: x - r.left, dy: y - r.top, key: el.dataset.key };
  el.classList.add('dragging');
  ghostBewegen(x, y);
}

function ghostBewegen(x, y) {
  if (!drag) return;
  drag.ghost.style.left = (x - drag.dx) + 'px';
  drag.ghost.style.top = (y - drag.dy) + 'px';
}

// Wohin faellt das Symbol? Dock, wenn der Finger darueber steht; sonst das
// Gitter der sichtbaren Seite.
function zielBehaelter(x, y) {
  const dock = document.getElementById('sbDock');
  if (dock) {
    const r = dock.getBoundingClientRect();
    if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 10 && y <= r.bottom + 10) return { el: dock, dock: true };
  }
  const grids = Array.from(document.querySelectorAll('.sb-grid'));
  for (const g of grids) {
    const r = g.getBoundingClientRect();
    if (r.width && x >= r.left - 20 && x <= r.right + 20 && y >= r.top - 60 && y <= r.bottom + 90) return { el: g, dock: false };
  }
  const seite = document.querySelectorAll('.sb-page')[sichtbareSeite()];
  const g = seite && seite.querySelector('.sb-grid');
  return g ? { el: g, dock: false } : null;
}

// Vor welchem Geschwister landet es? Leserichtung: erst Zeile, dann Spalte.
function einfuegeVor(container, x, y, ausser) {
  const kinder = Array.from(container.children).filter(k => k !== ausser && k.classList.contains('sb-app'));
  for (const k of kinder) {
    const r = k.getBoundingClientRect();
    if (y < r.top) return k;                                   // ganze Zeile darueber
    if (y <= r.bottom && x < r.left + r.width / 2) return k;    // gleiche Zeile, linke Haelfte
  }
  return null;
}

function randBlaettern(x) {
  const host = document.getElementById('sbPages');
  if (!host) return;
  const nah = x < 46 ? -1 : (x > window.innerWidth - 46 ? 1 : 0);
  if (nah === randRichtung) return;
  randRichtung = nah;
  clearTimeout(randTimer);
  if (!nah) return;
  randTimer = setTimeout(() => {
    const ziel = Math.max(0, Math.min(host.scrollWidth - host.clientWidth, host.scrollLeft + nah * host.clientWidth));
    host.scrollTo({ left: ziel, behavior: 'smooth' });
    haptic(10);
    randRichtung = 0;   // ein Blättern je Randbesuch, sonst rauscht es durch
  }, 550);
}

function zug(x, y) {
  if (!drag) return;
  ghostBewegen(x, y);
  randBlaettern(x);
  const ziel = zielBehaelter(x, y);
  if (!ziel) return;
  const wechsel = ziel.el !== drag.el.parentElement;
  if (ziel.dock && wechsel) {
    const belegt = ziel.el.querySelectorAll(':scope > .sb-app').length;
    if (belegt >= sb.DOCK_MAX) return;    // vier Plaetze sind vier Plaetze
  }
  const vor = einfuegeVor(ziel.el, x, y, drag.el);
  if (vor === drag.el.nextElementSibling && !wechsel) return;
  if (vor) ziel.el.insertBefore(drag.el, vor);
  else ziel.el.appendChild(drag.el);
  drag.el.classList.toggle('in-dock', !!ziel.dock);
}

function zugEnde() {
  clearTimeout(randTimer); randRichtung = 0;
  if (!drag) return;
  drag.ghost.remove();
  drag.el.classList.remove('dragging');
  drag = null;
  lastLongPress = Date.now();   // der folgende Klick darf nicht navigieren
  haptic(14);
  commitFromDom();
}

// ── Aktionen ────────────────────────────────────────────────────────────────
registerActions({
  // Nach einem langen Druck oder einem Zug darf der folgende Klick nicht
  // navigieren — und im Anordnen-Modus oeffnet ein Tipp gar nichts.
  'sb-open': (d) => { if (editing || Date.now() - lastLongPress < 700) return; navigate(d.route); },
  'sb-search': () => openSearch(),
  'sb-arrange': () => { if (editing) exitEdit(); else enterEdit(); },
  'sb-done': () => exitEdit(),

  'sb-remove': (d, el, e) => {
    if (e) e.stopPropagation();
    if (!editing) return;
    commitFromDom();
    layout = sb.removeApp(layout, d.key);
    saveLayout();
    haptic(18);
    refresh();
  },

  'sb-add': (d) => {
    commitFromDom();
    const seite = sichtbareSeite();
    layout = sb.placeApp(layout, d.key, { kind: 'page', page: seite });
    saveLayout();
    haptic(14);
    refresh();
  },

  'sb-add-page': () => {
    commitFromDom();
    layout = sb.addPage(layout);
    saveLayout();
    refresh();
    const host = document.getElementById('sbPages');
    if (host) requestAnimationFrame(() => host.scrollTo({ left: host.scrollWidth, behavior: 'smooth' }));
  },

  'sb-reset': async () => {
    const ok = await confirmPreview({
      title: 'Anordnung zurücksetzen?',
      confirmLabel: 'Zurücksetzen',
      previewHtml: '<div class="mail-preview">Seiten, Reihenfolge und Dock kehren in den Auslieferungszustand zurück. Deine Daten sind davon nicht betroffen.</div>',
    });
    if (!ok) return;
    layout = sb.resetLayout();
    refresh();
    toast('Anordnung zurückgesetzt', 'ok');
  },

  // Abhaken ohne Umweg ueber die Gewohnheiten-Ansicht. Dieselbe Operation
  // (toggle-habit), damit beide Wege nie auseinanderlaufen.
  'sb-habit': async (d) => {
    haptic(12);
    await store.performOp({ type: 'toggle-habit', payload: { id: d.id, date: todayYmd() } });
  },
  'sb-page': (d) => {
    const host = document.getElementById('sbPages');
    if (!host) return;
    host.scrollTo({ left: host.clientWidth * Number(d.page || 0), behavior: 'smooth' });
  },
});

const view = {
  title: 'Quantus', icon: '🏠',

  // Solange angeordnet wird, darf die Schale nicht von aussen neu rendern
  // (Abgleich alle 60 s) — sonst verschwindet das Symbol unter dem Finger.
  busy() { return editing || !!drag; },

  render() {
    const now = new Date();
    const greeting = now.getHours() < 11 ? 'Guten Morgen' : now.getHours() < 18 ? 'Hallo' : 'Guten Abend';
    const dock = layout.dock.map(k => sb.appInfo(k)).filter(Boolean);

    return `<div class="springboard ${editing ? 'editing' : ''}">
      <div class="sb-top">
        <div>
          <div class="sb-date">${now.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <div class="sb-greet">${greeting}, Laurin.</div>
        </div>
        <div class="sb-actions">
          <button class="sb-search" data-action="sb-search" aria-label="Suchen">🔍</button>
          <button class="sb-search ${editing ? 'on' : ''}" data-action="sb-arrange"
            aria-pressed="${editing ? 'true' : 'false'}" aria-label="Apps anordnen">✥</button>
          <button class="sb-search" data-action="open-new" aria-label="Neu erstellen">＋</button>
        </div>
      </div>

      ${briefingBlock()}

      <button class="shortnote-home" data-action="open-shortnote">
        <span class="shortnote-home-icon">⚡</span>
        <span><b>Shortnote</b><small>Notiz festhalten oder Mitteilung planen</small></span>
        <span class="shortnote-home-plus">＋</span>
      </button>

      ${widgets()}

      <div class="sb-pages" id="sbPages">
        ${layout.pages.map((page, i) => `
          <section class="sb-page" data-page="${i}">
            <div class="sb-page-title">${escHTML(page.title)}</div>
            <input class="sb-page-input" value="${escHTML(page.title)}" data-page="${i}"
              aria-label="Titel der Seite ${i + 1}" maxlength="40">
            <div class="sb-grid" data-page="${i}">${page.keys.map(k => {
              const app = sb.appInfo(k);
              return app ? iconHtml(app, false) : '';
            }).join('')}</div>
          </section>`).join('')}
      </div>

      ${routinenBlock()}

      <div class="sb-dots" id="sbDots">
        ${layout.pages.map((p, i) => `<button class="sb-dot ${i === 0 ? 'on' : ''}" data-action="sb-page" data-page="${i}" aria-label="Seite ${i + 1}"></button>`).join('')}
      </div>

      ${editBar()}

      <div class="sb-dock" id="sbDock">${dock.map(a => iconHtml(a, true)).join('')}</div>
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
        layout.page = idx;
        saveLayout();   // dieselbe Schreibstelle wie alles andere, inkl. Pruefung
      };
      pages.addEventListener('scroll', () => { clearTimeout(pages._t); pages._t = setTimeout(sync, 80); }, { passive: true });
      const saved = layout.page || 0;
      if (saved > 0) requestAnimationFrame(() => { pages.scrollLeft = pages.clientWidth * saved; sync(); });
    }

    // Seitentitel: im Anordnen-Modus ein Eingabefeld.
    root.querySelectorAll('.sb-page-input').forEach(inp => {
      inp.addEventListener('change', () => {
        commitFromDom();
        const titel = root.querySelectorAll('.sb-page-title')[Number(inp.dataset.page)];
        if (titel) titel.textContent = inp.value;
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    });

    // Langer Druck schaltet den Anordnen-Modus; im Modus zieht jeder Griff.
    root.querySelectorAll('.sb-app').forEach(el => {
      el.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest('.sb-x')) return;         // das ✕ ist kein Griff
        kandidat = { el, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
        if (!editing) {
          clearTimeout(pressTimer);
          pressTimer = setTimeout(() => { lastLongPress = Date.now(); enterEdit(); }, 550);
        }
      });

      el.addEventListener('pointermove', (e) => {
        if (!kandidat || kandidat.el !== el) return;
        const weit = Math.abs(e.clientX - kandidat.x) + Math.abs(e.clientY - kandidat.y) > 8;
        if (weit) clearTimeout(pressTimer);            // Wischen ist kein langer Druck
        if (!editing || drag || !weit) return;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ohne Capture geht es auch */ }
        ghostAn(el, e.clientX, e.clientY);
      });

      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (!editing) navigate(el.dataset.route);
      });
    });

    // Bewegen und Loslassen haengen am Dokument: der Finger verlaesst das
    // Symbol, und ohne Capture (Maus, aeltere Browser) waere der Zug sonst tot.
    if (!root._sbDrag) {
      root._sbDrag = true;
      const move = (e) => { if (drag) { e.preventDefault(); zug(e.clientX, e.clientY); } };
      const up = () => { clearTimeout(pressTimer); kandidat = null; zugEnde(); };
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    }
  },

  // Beim Verlassen der Ansicht ist der Anordnen-Modus vorbei — sonst blockierte
  // busy() das Neurendern in einer Ansicht, die es gar nicht mehr gibt.
  unmount() {
    clearTimeout(pressTimer);
    if (drag) { drag.ghost.remove(); drag.el.classList.remove('dragging'); drag = null; }
    if (editing) { commitFromDom(); layout = sb.dropEmptyPages(layout); saveLayout(); editing = false; }
    layout = sb.loadLayout();
  },
};

export default view;
