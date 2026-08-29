// ============================================================================
//  Quantus Mobile — App-Shell
//  Responsives Layout: Smartphone = Bottom-Tab-Bar, Tablet = Seitenleiste +
//  (in Listen-Modulen) Zweispalten Liste/Detail. Zentraler „Neu"-Button,
//  globale Suche, Benachrichtigungen. Bootstrap & Router-Anbindung.
// ============================================================================
import { TABS, MORE_MODULES, NEW_TYPES, migrateLegacyKeys } from './config.js';
import { $, escHTML, haptic, openSheet, closeSheet, toast } from './util.js';
import * as store from './store.js';
import * as router from './router.js';
import { registerActions, initActions } from './actions.js';
import { applyTheme } from './theme.js';
import * as focus from './focus.js';
import { openNewType } from './new.js';
import { initAuth } from './auth.js';
import { openSearch } from './search.js';

const TABLET_BREAKPOINT = 820;
export const isTablet = () => window.innerWidth >= TABLET_BREAKPOINT;

/*
 * WARUM ES AUF DEM HANDY KEINE AUSFAHRBARE SEITENLEISTE MEHR GIBT
 *
 * BEFUND (Screenshot, iPhone): die geoeffnete Leiste war NICHT SCHLIESSBAR.
 * Sie lag als position:fixed-Panel mit 260px Breite ueber der App — ohne
 * Schirm, ohne Schliessknopf. Der einzige Weg zurueck war derselbe
 * ☰-Knopf in der Kopfzeile, und der sitzt bei x 0..54px, also UNTER dem
 * Panel. Man kam nur per Neuladen wieder heraus.
 *
 * Sie war ausserdem ueberfluessig: der Homebildschirm IST ein Springboard mit
 * allen Apps, Seiten und Dock. Die Leiste war eine zweite, schlechtere Kopie
 * davon — mit einer Falle darin.
 *
 * Statt Schirm und Schliessknopf nachzuruesten, ist der Weg auf dem Handy
 * ganz entfallen. Zwei Wege bleiben, beide immer sichtbar und beide
 * einstufig:
 *   alle Apps  -> Homebildschirm (Springboard) bzw. der Tab „Mehr"
 *   nach Hause -> der 🏠-Knopf links in der Kopfzeile
 * Was es nicht gibt, kann auch nicht klemmen.
 *
 * Auf dem Tablet bleibt die Leiste, was sie dort immer war: fest stehende
 * Navigation neben dem Inhalt, nie darueber. Der 🏠-Knopf ist dort
 * ausgeblendet — die Leiste zeigt Home ohnehin an.
 */

// welche Route gehört zu welchem Bottom-Tab (fürs Highlighting)
function activeTabFor(route) {
  if (TABS.some(t => t.route === route)) return route;
  if (MORE_MODULES.some(m => m.route === route)) return 'mehr';
  return 'home';
}

// ── Grundgerüst (einmalig) ──
export function buildSkeleton() {
  const app = $('#app');
  app.innerHTML = `
    <div class="layout ${isTablet() ? 'tablet' : 'phone'}" id="layout">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="main">
        <header class="appbar" id="appbar">
          <button class="appbar-btn appbar-home" data-action="go" data-route="home" aria-label="Zum Homebildschirm">🏠</button>
          <div class="appbar-title" id="appbarTitle">Quantus</div>
          <div class="appbar-right">
            <button class="appbar-btn" data-action="open-search" aria-label="Suche">🔍</button>
            <button class="appbar-btn" data-action="open-notifications" aria-label="Benachrichtigungen">
              🔔<span class="dot" id="notifDot" hidden></span>
            </button>
            <div class="sync-chip ok" id="syncChip" title="Sync-Status"><span class="sync-led"></span><span id="syncText">…</span></div>
          </div>
        </header>
        <div class="ptr" id="ptr"><span class="ptr-spin">↻</span></div>
        <main class="content" id="content" tabindex="-1"></main>
      </div>
      <button class="fab" id="fab" data-action="open-new" aria-label="Neu erstellen">＋</button>
      <nav class="tabbar" id="tabbar"></nav>
    </div>`;
  renderTabbar();
  renderSidebar();
}

function renderTabbar() {
  const bar = $('#tabbar');
  bar.innerHTML = TABS.map(t => `
    <button class="tab" data-action="go" data-route="${t.route}" data-tabkey="${t.key}">
      <span class="tab-icon">${t.icon}</span><span class="tab-label">${escHTML(t.label)}</span>
      ${t.key === 'planen' ? '<span class="tab-badge" id="tabBadgePlanen" hidden></span>' : ''}
      ${t.key === 'fokus' ? '<span class="tab-badge live" id="tabBadgeFokus" hidden>●</span>' : ''}
      ${t.key === 'mail' ? '<span class="tab-badge" id="tabBadgeMail" hidden></span>' : ''}
    </button>`).join('');
}

function renderSidebar() {
  const sb = $('#sidebar');
  const section = (title, items) => `
    <div class="side-section-title">${title}</div>
    ${items.map(m => `
      <button class="side-item" data-action="go" data-route="${m.route}">
        <span class="side-item-icon">${m.icon}</span>
        <span class="side-item-label">${escHTML(m.label)}</span>
      </button>`).join('')}`;
  sb.innerHTML = `
    <div class="side-brand"><span class="side-brand-orb">◐</span> Quantus</div>
    <button class="side-new" data-action="open-new">＋ Neu erstellen</button>
    ${section('Bereiche', TABS.filter(t => t.key !== 'mehr'))}
    ${section('Module', MORE_MODULES)}
    <div class="side-foot">
      <button class="side-item" data-action="cycle-theme"><span class="side-item-icon">🌓</span><span class="side-item-label">Theme wechseln</span></button>
    </div>`;
}

// ── Aktive Navigation markieren ──
function highlightNav(route) {
  const tab = activeTabFor(route);
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tabkey === tab));
  document.querySelectorAll('.side-item').forEach(b => b.classList.toggle('active', b.dataset.route === route));
}

// ── Router-Renderer ──
// Was eine Ansicht beim Betreten anmeldet, muss beim VERLASSEN wieder ab.
// Ohne diesen Schritt liefe zum Beispiel der Live-Hoerer des Career Models in
// einer laengst verlassenen Ansicht weiter und schriebe in ein Element, das es
// nicht mehr gibt. mount() gibt es seit je — ein Gegenstueck fehlte.
let laufendeAnsicht = null;
function verlasseAnsicht() {
  const v = laufendeAnsicht;
  laufendeAnsicht = null;
  if (v && typeof v.unmount === 'function') {
    try { v.unmount(); } catch (e) { console.warn('unmount:', e); }
  }
}

function renderView(ctx) {
  const view = router.getView(ctx.route);
  const content = $('#content');
  const titleEl = $('#appbarTitle');
  verlasseAnsicht();
  if (!view) { content.innerHTML = '<div class="pad">Unbekannte Ansicht.</div>'; return; }
  titleEl.textContent = view.title || 'Quantus';
  // Die Route VOR dem Rendern ans Layout schreiben. Sie entscheidet ueber
  // CSS, das die Groessen der Ansicht bestimmt (Polaris ist eine Flaeche, kein
  // Dokument). Stand sie erst danach, mass mount() in einem Layout, das es
  // gleich nicht mehr gab: der Chat fand seine Hoehe noch nicht, das Scrollen
  // ans Ende landete bei 0 — beim Wechsel aus einer anderen Ansicht stand man
  // bei der AELTESTEN Nachricht.
  const layout = document.getElementById('layout');
  if (layout) {
    layout.dataset.route = ctx.route;
    // Der Homebildschirm hat ein eigenes Dock — der „Neu"-Knopf rueckt darueber.
    layout.classList.toggle('route-home', ctx.route === 'home');
  }
  try {
    content.innerHTML = view.render(ctx);
    laufendeAnsicht = view;
    if (typeof view.mount === 'function') view.mount(content, ctx);
  } catch (e) {
    console.error('View render error', e);
    content.innerHTML = `<div class="pad"><div class="empty"><div class="empty-icon">⚠️</div>
      <div class="empty-title">Fehler beim Anzeigen</div>
      <div class="empty-sub">${escHTML(e.message || String(e))}</div></div></div>`;
  }
  highlightNav(ctx.route);
  content.scrollTop = 0;
  updateBadges();
}

// ── Badges (offene Aufgaben, laufender Fokus, Benachrichtigungen) ──
export function updateBadges() {
  const open = store.getTasks().filter(t => t.status !== 'done').length;
  const bp = $('#tabBadgePlanen');
  if (bp) { if (open > 0) { bp.textContent = open > 99 ? '99' : open; bp.hidden = false; } else bp.hidden = true; }
  const bf = $('#tabBadgeFokus');
  if (bf) bf.hidden = !focus.isRunning();
  // Ungelesene Mails am Mail-Tab (nur wenn das Mail-Programm schon geladen hat)
  const bm = $('#tabBadgeMail');
  if (bm) {
    const n = typeof window.__quantusMailUnread === 'function' ? window.__quantusMailUnread() : 0;
    if (n > 0) { bm.textContent = n > 99 ? '99' : n; bm.hidden = false; } else bm.hidden = true;
  }
  // Benachrichtigungs-Punkt: neue Journal-Pushes
  const dot = $('#notifDot');
  if (dot) dot.hidden = unseenPushes().length === 0;
}

function unseenPushes() {
  const seen = new Set(JSON.parse(localStorage.getItem('qm-seen-pushes') || '[]'));
  return store.getJournalPushes().filter(p => p && !seen.has(p.id));
}

// ── Sync-Status-Chip ──
store.onSyncStatus((stateName, text) => {
  const chip = $('#syncChip'); if (!chip) return;
  chip.className = 'sync-chip ' + stateName;
  const t = $('#syncText'); if (t) t.textContent = text;
});

// ── globale Aktionen ──
registerActions({
  'go': (d) => router.navigate(d.route, { params: d.sub ? { } : {}, sub: d.sub || null }),
  'go-sub': (d) => router.navigate(d.route, { sub: d.sub || null, params: d.params ? JSON.parse(d.params) : {} }),
  'open-new': () => openNewMenu(),
  'open-search': () => openSearch(),
  'cycle-theme': () => { import('./theme.js').then(m => { const mode = m.cycleTheme(); toast('Theme: ' + mode, 'ok'); }); },
  'open-notifications': () => openNotifications(),
  'new-type': (d) => { closeSheet(); openNewType(d.type); },
  'back': (d) => router.navigate(d.route || 'home', { sub: d.sub || null }),
});

// ── „Neu"-Menü (zentraler Button) ──
function openNewMenu() {
  haptic(14);
  openSheet({
    title: 'Neu erstellen',
    size: 'half',
    body: `<div class="new-grid">
      ${NEW_TYPES.map(t => `
        <button class="new-tile" data-action="new-type" data-type="${t.key}">
          <span class="new-tile-icon">${t.icon}</span>
          <span class="new-tile-label">${escHTML(t.label)}</span>
        </button>`).join('')}
    </div>
    <div class="new-quick">
      <div class="new-quick-title">Schnellaktionen</div>
      <button class="qa" data-action="new-type" data-type="focus">🎯 Fokus jetzt starten</button>
      <button class="qa" data-action="go" data-route="planen" data-sub="heute">📅 Heute planen</button>
      <button class="qa" data-action="go" data-route="inbox">📥 Inbox leeren</button>
    </div>`,
  });
}

// ── Benachrichtigungen ──
function openNotifications() {
  const pushes = store.getJournalPushes().slice().reverse();
  const seen = new Set(JSON.parse(localStorage.getItem('qm-seen-pushes') || '[]'));
  localStorage.setItem('qm-seen-pushes', JSON.stringify(store.getJournalPushes().map(p => p && p.id).filter(Boolean)));
  updateBadges();
  openSheet({
    title: 'Benachrichtigungen',
    size: 'half',
    body: pushes.length ? pushes.map(p => `
      <div class="notif ${seen.has(p.id) ? '' : 'unseen'}">
        <div class="notif-title">${escHTML(p.title || 'Journal-Eintrag')}</div>
        <div class="notif-body">${escHTML((p.content || '').slice(0, 240))}</div>
        <div class="notif-meta">${escHTML(p.sentAt ? new Date(p.sentAt).toLocaleString('de-CH') : '')}</div>
      </div>`).join('')
      : `<div class="empty"><div class="empty-icon">🔔</div><div class="empty-title">Keine Benachrichtigungen</div>
         <div class="empty-sub">Journal-Pushes aus Quantus erscheinen hier.</div></div>`,
  });
}

// ── Pull-to-Refresh (mobile Mikro-Interaktion, übernommen) ──
function attachPullToRefresh() {
  const content = $('#content'); const ptr = $('#ptr');
  if (!content || !ptr) return;
  let startY = 0, pulling = false, dist = 0;
  const THRESHOLD = 70;
  content.addEventListener('touchstart', (e) => {
    if (content.scrollTop <= 0 && !store.state.syncing) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });
  content.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    if (dist > 0) { ptr.style.height = Math.min(dist * 0.5, 60) + 'px'; ptr.classList.toggle('ready', dist > THRESHOLD); }
  }, { passive: true });
  content.addEventListener('touchend', async () => {
    if (!pulling) return; pulling = false;
    // Das Zuruecksetzen gehoert ins finally. Vorher stand es HINTER dem await:
    // warf store.pullData (Netz weg, Serverfehler), wurde die Zeile nie
    // erreicht — der Anzeiger blieb bis zu 60 px hoch offen stehen, mit einem
    // Loch zwischen App-Leiste und Inhalt, das sich nicht mehr schliessen
    // liess. Ein zweiter Zug half nicht: touchstart verweigert waehrend
    // state.syncing.
    try {
      if (dist > THRESHOLD) { ptr.classList.add('spinning'); haptic(16); await store.pullData(false); }
    } finally {
      ptr.classList.remove('spinning');
      ptr.style.height = '0px'; ptr.classList.remove('ready'); dist = 0;
    }
  });
}

// ── Responsives Umschalten ──
function onResize() {
  const layout = $('#layout'); if (!layout) return;
  layout.classList.toggle('tablet', isTablet());
  layout.classList.toggle('phone', !isTablet());
}
window.addEventListener('resize', onResize);

// ── Auto-Sync (übernommen): alle 60 s + bei Sichtbarkeit ──
setInterval(() => { if (!document.hidden) store.pullData(true); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) store.pullData(true); });

// bei Datenänderung neu rendern (aktuelle Route)
store.subscribe(() => renderView(router.current()));

// ── Bootstrap ──
export async function boot(viewModules) {
  migrateLegacyKeys();
  applyTheme();
  // Anmeldung frueh hochfahren: eine bestehende Sitzung (oder die Rueckkehr aus
  // einer Weiterleitung) soll gelten, bevor die erste Ansicht rendert.
  try { initAuth(); } catch (e) { console.warn('initAuth:', e); }
  buildSkeleton();
  attachPullToRefresh();
  initActions();
  focus.reconcileOnBoot();      // hängengebliebene Sitzung als „unterbrochen" abschließen
  // Views registrieren
  for (const [key, mod] of Object.entries(viewModules)) router.register(key, mod);
  router.onRender(renderView);
  // erste Route
  if (!location.hash) location.hash = '#/home';
  router.handleRoute();
  // Daten laden
  await store.pullData(false);
  // Fokus-Ticker aktualisiert Badges/Live-Anzeige
  focus.onFocusChange(() => { updateBadges(); if (router.current().route === 'fokus') renderView(router.current()); });
}
