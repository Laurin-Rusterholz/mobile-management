/*
 * Die Navigation kann nicht mehr klemmen — und die Routinen stehen unten.
 *
 * BEFUND (Telefon, Bildschirmfoto): die ausgefahrene Seitenleiste war NICHT
 * SCHLIESSBAR. Die Regel dafuer lautete
 *     .layout.phone.sidebar-open .sidebar { position: fixed; inset: 0 auto 0 0;
 *                                           width: 260px; z-index: 60; }
 * — ein Panel ueber der ganzen App, ohne Schirm und ohne Schliessknopf. Der
 * einzige Weg zurueck war derselbe ☰-Knopf in der Kopfzeile, und der sitzt
 * ganz links, also UNTER dem Panel. Wer sie aufmachte, kam nur per Neuladen
 * wieder heraus.
 *
 * Sie war ausserdem eine schlechtere Kopie des Homebildschirms: der IST ein
 * Springboard mit allen Apps, Seiten und Dock.
 *
 * DER FIX IST EIN ENTFERNEN, KEIN NACHRUESTEN. Ein nachgeruesteter Schirm
 * waere eine zweite Stelle, die klemmen kann. Auf dem Handy gibt es die
 * ausfahrbare Leiste gar nicht mehr; es bleiben zwei immer sichtbare,
 * einstufige Wege: der Homebildschirm fuer alle Apps, der 🏠-Knopf in der
 * Kopfzeile fuer zurueck. Auf dem Tablet bleibt die Leiste feste Navigation
 * NEBEN dem Inhalt — dort lag sie nie darueber.
 *
 * ZWEITER BEFUND, gleiche Aufnahme: die Routinen kamen auf dem
 * Homebildschirm nur als Zahl vor ("0/6"). Eine Zahl sagt, DASS etwas offen
 * ist, nicht WAS — und abhaken liess sie sich nicht. Sie gehoeren
 * ausgeschrieben ans untere Ende.
 *
 * Geprueft wird gegen die ausgelieferten Dateien: das CSS wird geparst, die
 * Home-Ansicht laeuft ECHT gegen einen Store-Stub. Kein Browser, kein Netz.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lies = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const CSS = ['css/base.css', 'css/apps.css', 'css/components.css']
  .filter((f) => fs.existsSync(path.join(root, f))).map(lies).join('\n');
const SHELL = lies('js/shell.js');

// ═══ 1. DIE FALLE EXISTIERT NICHT MEHR ═════════════════════════════════
// Kommentare zaehlen nicht: dieser Test darf nicht an seiner eigenen oder an
// fremder Prosa haengenbleiben. Nur wirksame Regeln und wirksamer Code.
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const cssAktiv = ohneKommentare(CSS);
const shellAktiv = ohneKommentare(SHELL);

ok(!/\.sidebar-open/.test(cssAktiv),
  'DER BEFUND: es gibt wieder eine .sidebar-open-Regel — die ausfahrbare Leiste ist zurueck');
ok(!/sidebar-open/.test(shellAktiv),
  'die Schale schaltet wieder eine sidebar-open-Klasse — damit kann ein Zustand entstehen, aus dem man nicht herauskommt');
ok(!/toggle-sidebar/.test(shellAktiv),
  'die Aktion toggle-sidebar ist zurueck — sie war der einzige Weg hinein UND hinaus, und hinaus lag unter dem Panel');

// Die Seitenleiste darf ueberhaupt nur noch als Tablet-Navigation vorkommen,
// nie als Overlay. Ein position:fixed auf .sidebar ist genau die Falle.
{
  const regeln = cssAktiv.split('}').map((r) => r + '}');
  const sidebarRegeln = regeln.filter((r) => /^[^{]*\.sidebar\b[^{]*\{/.test(r.trim()));
  ok(sidebarRegeln.length > 0, 'es gibt gar keine .sidebar-Regel mehr — dann ist auch das Tablet ohne Navigation');
  for (const r of sidebarRegeln) {
    const selektor = r.split('{')[0].trim();
    ok(!/position:\s*fixed/.test(r),
      `die Regel "${selektor}" legt die Seitenleiste wieder fix ueber die App`);
    // Die BLOSSE .sidebar-Regel (ohne .layout.tablet davor) und alles, was
    // ausdruecklich aufs Handy zielt: dort darf sie nicht sichtbar werden.
    if (selektor === '.sidebar' || /\.layout\.phone/.test(selektor)) {
      ok(!/display:\s*flex/.test(r),
        `die Regel "${selektor}" zeigt die Seitenleiste auf dem Handy an`);
    }
  }
  // Und der eine Ort, an dem sie sichtbar sein DARF, ist das Tablet.
  ok(/\.layout\.tablet\s+\.sidebar\s*\{[^}]*display:\s*flex/.test(cssAktiv),
    'die Tablet-Seitenleiste ist mit entfernt worden — dort war sie nie das Problem');
  ok(/^\s*\.sidebar\s*\{[^}]*display:\s*none/m.test(cssAktiv),
    'die Grundregel .sidebar{display:none} fehlt — die Leiste koennte auf dem Handy auftauchen');
}

// ═══ 2. ZWEI WEGE, BEIDE IMMER SICHTBAR ════════════════════════════════
// (a) Nach Hause: ein Knopf in der Kopfzeile, der NICHT verdeckt werden kann,
// weil es nichts mehr gibt, was ihn verdeckt.
ok(/class="appbar-btn appbar-home"[^>]*data-action="go"[^>]*data-route="home"/.test(SHELL),
  'in der Kopfzeile steht kein Home-Knopf — der Weg zurueck fehlt');
ok(/aria-label="Zum Homebildschirm"/.test(SHELL), 'der Home-Knopf sagt Hilfsmitteln nicht, was er tut');
ok(/\.layout\.tablet\s+\.appbar-home\s*\{[^}]*display:\s*none/.test(cssAktiv),
  'der Home-Knopf steht auch auf dem Tablet — dort zeigt die Seitenleiste Home bereits an');

// (b) Alle Apps: der Homebildschirm und der Tab „Mehr". Beide ueber die
// Tab-Leiste erreichbar, die nie verdeckt wird.
{
  const cfg = lies('js/config.js');
  const tabs = (cfg.match(/key:\s*'([a-z]+)'/g) || []).map((m) => m.split("'")[1]);
  ok(tabs.includes('home'), 'die Tab-Leiste kennt keinen Home-Tab');
  ok(tabs.includes('mehr'), 'die Tab-Leiste kennt keinen Mehr-Tab — der Modul-Hub ist nicht erreichbar');
  ok(/data-action="go" data-route="\$\{t\.route\}"/.test(SHELL), 'die Tabs navigieren nicht mehr');
}

// (c) Fingerbreite Treffer in der Kopfzeile.
ok(/\.layout\.phone\s+\.appbar-btn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/.test(cssAktiv),
  'die Kopfzeilenknoepfe sind auf dem Handy schmaler als 44px');

// ═══ 3. DIE ROUTINEN STEHEN UNTEN — UND SIND ANTIPPBAR ═════════════════
const protokoll = { ops: [], searches: 0 };
const HEUTE = (() => { const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const HABITS = [
  { id: 'h1', text: 'Morgenroutine', icon: '📖', completions: [{ date: HEUTE, value: 1 }] },
  { id: 'h2', text: 'Wasser trinken', completions: [] },
  { id: 'h3', text: 'Lesen', completions: [] },
];
const AKTIONEN = {};
const stubs = {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    todayYmd: () => HEUTE,
    fmtDurationMin: (m) => `${m}m`,
    haptic: () => {}, toast: () => {}, confirmPreview: async () => true,
  },
  '../config.js': {
    SPRINGBOARD_PAGES: [{ title: 'Seite', apps: [{ key: 'planen', label: 'Planen', icon: '🗂️', route: 'planen' }] }],
    SPRINGBOARD_DOCK: [{ key: 'planen', label: 'Planen', icon: '🗂️', route: 'planen' }],
    LS: { springboard: 'qm-springboard' },
  },
  '../store.js': {
    getHabits: () => HABITS,
    habitDoneOn: (h, y) => Array.isArray(h.completions) && h.completions.some((c) => c && c.date === y),
    performOp: async (op) => { protokoll.ops.push(op); },
    // Seit die Routinen Sub-Einheiten tragen, fragt die Ansicht den Store auch
    // danach. Eine unvollstaendige Attrappe wuerde den Lauf mit einer
    // TypeError beenden statt zu messen.
    getSubUnits: (h) => (Array.isArray(h.subUnits) ? h.subUnits.filter((u) => u && u.name) : []),
    subUnitDoneOn: (h, n, y) => Array.isArray(h.subCompletions)
      && h.subCompletions.some((c) => c && c.date === y && c.subUnitName === n),
    subUnitsDoneCount: (h, y) => (Array.isArray(h.subUnits) ? h.subUnits : [])
      .filter((u) => u && u.name && Array.isArray(h.subCompletions)
        && h.subCompletions.some((c) => c && c.date === y && c.subUnitName === u.name)).length,
    habitDueOn: () => true,
    getTasks: () => [], getInboxItems: () => [], getDueCards: () => [], getJournalPushes: () => [],
    getMeetings: () => [], getProjects: () => [], notify: () => {}, state: { data: {} },
  },
  './briefing.js': { briefingZahlen: () => ({ termine: [], faellig: [], ueberfaellig: [], erledigt: 1, routinen: HABITS }) },
  '../focus.js': { statsForDay: () => ({ minutes: 0, count: 0 }) },
  '../actions.js': { registerActions: (o) => Object.assign(AKTIONEN, o) },
  '../router.js': { navigate: () => {} },
  '../search.js': { openSearch: () => { protokoll.searches++; } },
};
// Das Anordnungs-Modell wird ECHT geladen (es haengt nur an config.js und an
// localStorage) — so misst dieser Test die Home-Ansicht gegen dieselbe
// Anordnung, die im Browser gilt, und nicht gegen eine Attrappe.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
stubs['../springboard.js'] = await import('../js/springboard.js');

const quelle = lies('js/views/home.js');
const ohneImporte = quelle.replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
  ok(Object.prototype.hasOwnProperty.call(stubs, pfad), `unbekannter Import: ${pfad}`);
  const namen = /\{([^}]*)\}/.exec(m);
  if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
  return `const ${/\*\s+as\s+(\w+)/.exec(m)[1]} = __stubs['${pfad}'];`;
});
globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
const modul = new Function('__stubs', ohneImporte.replace(/^export default/m, 'return') + ';')(stubs);
ok(modul && typeof modul.render === 'function', 'die Home-Ansicht hat kein render()');
const html = modul.render();

ok(/class="sb-routines"/.test(html), 'DER ZWEITE BEFUND: die Routinen stehen nicht auf dem Homebildschirm');
// UNTEN heisst: nach den App-Seiten, nicht zwischen den Widgets.
{
  const seiten = html.indexOf('class="sb-pages"');
  const routinen = html.indexOf('class="sb-routines"');
  const widgets = html.indexOf('class="sb-widgets"');
  ok(seiten > 0 && routinen > seiten,
    'die Routinen stehen VOR den App-Seiten — verlangt war unten');
  ok(routinen > widgets, 'die Routinen stehen zwischen den Widgets statt unten');
}
// Ausgeschrieben, nicht als Zahl.
for (const h of HABITS) {
  ok(html.includes(h.text), `die Routine "${h.text}" wird nicht genannt — es steht wieder nur eine Zahl da`);
}
ok(/class="sb-rt-count">1\/3</.test(html), 'der Zaehler stimmt nicht mit dem Stand ueberein');
// Erledigtes ist als erledigt erkennbar, Offenes nicht faelschlich.
{
  const zeile = (id) => { const a = html.indexOf(`data-action="sb-habit" data-id="${id}"`);
    return html.slice(html.lastIndexOf('<button', a), html.indexOf('</button>', a)); };
  ok(/class="sb-rt on"/.test(zeile('h1')), 'die heute erledigte Routine ist nicht als erledigt markiert');
  ok(/aria-pressed="true"/.test(zeile('h1')), 'der erledigte Zustand fehlt fuer Hilfsmittel');
  ok(!/class="sb-rt on"/.test(zeile('h2')), 'eine offene Routine ist faelschlich als erledigt markiert');
  ok(/aria-pressed="false"/.test(zeile('h2')), 'der offene Zustand fehlt fuer Hilfsmittel');
}
// Antippen hakt ab — ueber DIESELBE Operation wie die Gewohnheiten-Ansicht,
// damit die beiden Wege nie auseinanderlaufen.
ok(typeof AKTIONEN['sb-habit'] === 'function', 'die Aktion sb-habit ist nicht registriert — die Zeilen sind tot');
if (typeof AKTIONEN['sb-habit'] === 'function') {
  await AKTIONEN['sb-habit']({ id: 'h2' });
  ok(protokoll.ops.length === 1, `es liefen ${protokoll.ops.length} Operationen statt einer`);
  const op = protokoll.ops[0] || {};
  ok(op.type === 'toggle-habit', `Operation "${op.type}" statt toggle-habit`);
  ok(op.payload && op.payload.id === 'h2', 'die Operation trifft die falsche Routine');
  ok(op.payload && op.payload.date === HEUTE, 'die Operation setzt nicht das heutige Datum');
}
ok(/data-action="sb-open" data-route="gewohnheiten"/.test(html),
  'es fehlt der Weg von der Kurzliste in die volle Gewohnheiten-Ansicht');
// Fingerbreite Zeilen.
ok(/\.sb-rt\s*\{[^}]*min-height:\s*44px/.test(cssAktiv), 'die Routinenzeilen sind niedriger als 44px');

if (luecken.length) {
  console.error(`NAV OHNE FALLE — ${luecken.length} von ${checks} Pruefungen:`);
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`nav ohne falle + routinen unten: ok (${checks} Pruefungen)`);
