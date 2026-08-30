/*
 * Die Apps lassen sich anordnen.
 *
 * BEFUND (Nutzer: „in der quantus mobile-management moechte ich die apps
 * anordnen koennen"): der Homebildschirm SAH aus wie ein iPhone-Springboard —
 * Seiten, Symbole, Punkte, Dock — war aber fest verdrahtet. Welche App wo lag,
 * stand in config.js (SPRINGBOARD_PAGES); die Ansicht las die Konstante direkt.
 * Der einzige Griff, den es gab, war ein langer Druck, der eine App ins Dock
 * legte — nirgends angeschrieben, nicht umkehrbar ausser durch denselben Griff,
 * und ohne jede Moeglichkeit, die Reihenfolge zu aendern, eine App vom
 * Bildschirm zu nehmen oder eine der ~20 Apps HINZUZUFUEGEN, die in der Vorgabe
 * gar keine Kachel hatten (Briefing, Gmail, Smarter, BM, Mail …).
 *
 * WAS HIER GEMESSEN WIRD
 *  1. Das Modell (js/springboard.js) — echte Funktionen, keine Attrappen:
 *     Vorgabe, Normalisieren (auch des ALTEN Standes { dock, hidden, page }),
 *     Legen, Wegnehmen, Dock-Grenze, leere Seiten, Speichern/Laden.
 *  2. Die Anordnung bleibt LOKAL: sie darf nicht in den Quantus-Datenbestand
 *     geraten. Ein Bereich ohne eigenen Zweig in mergeData() ist dort laut
 *     CLAUDE.md die groesste Fehlerquelle — eine Geraete-Einstellung hat darin
 *     nichts verloren.
 *  3. Die Ansicht rendert aus dem Modell (nicht mehr aus der Konstante), traegt
 *     die Bedienelemente des Anordnen-Modus und meldet sich waehrenddessen bei
 *     der Schale als „busy" ab — sonst baut ein Abgleich im Hintergrund den
 *     Bildschirm mitten in der Geste neu.
 *  4. Das CSS: die Bedienelemente sind ausserhalb des Modus unsichtbar, das
 *     gezogene Symbol haengt ueber allem, und der Browser rollt nicht, waehrend
 *     gezogen wird (touch-action).
 *
 * Kein Browser, kein Netz.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lies = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

// ── Umgebung: nur so viel, wie die Module beim Laden anfassen ──────────────
const SPEICHER = new Map();
globalThis.localStorage = {
  getItem: (k) => (SPEICHER.has(k) ? SPEICHER.get(k) : null),
  setItem: (k, v) => SPEICHER.set(k, String(v)),
  removeItem: (k) => SPEICHER.delete(k),
};
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };

const SB = await import('../js/springboard.js');
const CONFIG = await import('../js/config.js');

// ═══ 1. DAS MODELL ═════════════════════════════════════════════════════════
ok(typeof SB.defaultLayout === 'function', 'es gibt keine Vorgabe-Anordnung');
ok(typeof SB.placeApp === 'function', 'Apps lassen sich nicht legen (placeApp fehlt)');
ok(typeof SB.removeApp === 'function', 'Apps lassen sich nicht wegnehmen (removeApp fehlt)');

const vorgabe = SB.defaultLayout();
ok(vorgabe.pages.length === CONFIG.SPRINGBOARD_PAGES.length,
  'die Vorgabe hat nicht so viele Seiten wie SPRINGBOARD_PAGES');
ok(vorgabe.pages[0].keys[0] === CONFIG.SPRINGBOARD_PAGES[0].apps[0].key,
  'die Vorgabe beginnt nicht mit derselben App wie bisher — der Auslieferungszustand hat sich verschoben');
ok(vorgabe.dock.length === CONFIG.SPRINGBOARD_DOCK.length, 'das Vorgabe-Dock stimmt nicht');

// Der Katalog kennt MEHR als die Vorgabeseiten: genau das war der Punkt.
ok(SB.APP_CATALOG.has('briefing') && SB.APP_CATALOG.has('gmail') && SB.APP_CATALOG.has('smarter'),
  'der Katalog kennt nur die Apps der Vorgabeseiten — hinzufuegen liesse sich damit nichts');
ok(!SB.APP_CATALOG.has('home'), 'der Homebildschirm steht als App auf sich selbst im Katalog');
ok([...SB.APP_CATALOG.values()].every(a => a.key && a.label && a.icon && a.route && a.tone),
  'eine Katalog-App hat keinen Farbton/Route/Label — sie liesse sich nicht zeichnen');

// Normalisieren: Unbekanntes, Doppeltes, ein zu volles Dock, kaputte Eingaben.
{
  const n = SB.normalizeLayout({
    pages: [{ title: 'A', keys: ['kalender', 'gibtsnicht', 'kalender', 'planen', 'ideen'] }, { title: 'B', keys: ['kalender'] }],
    dock: ['mail', 'mail', 'planen', 'polaris', 'fokus', 'ideen', 'budget'],
    page: 99,
  });
  ok(!n.pages[0].keys.includes('gibtsnicht'), 'ein unbekannter Schluessel ueberlebt das Normalisieren');
  ok(n.pages[0].keys.filter(k => k === 'kalender').length === 1, 'eine App liegt doppelt auf derselben Seite');
  ok(!n.pages[1].keys.includes('kalender'), 'dieselbe App liegt auf zwei Seiten gleichzeitig');
  const alle = [...n.pages.flatMap(p => p.keys), ...n.dock];
  ok(new Set(alle).size === alle.length, 'eine App liegt mehrfach auf dem Homebildschirm');
  ok(n.dock.includes('planen') && !n.pages.some(p => p.keys.includes('planen')),
    'bei einer Doppelung verliert das Dock gegen die Seite — die bewusstere Ablage sind die vier Dock-Plaetze');
  ok(n.dock.length <= SB.DOCK_MAX, `das Dock nimmt ${n.dock.length} Symbole statt hoechstens ${SB.DOCK_MAX}`);
  ok(n.page === n.pages.length - 1, 'eine Seitenzahl ausserhalb des Bereichs wird nicht eingefangen');
  ok(SB.normalizeLayout(null).pages.length > 0, 'aus „nichts" entsteht keine gueltige Anordnung');
  // BEFUND aus dem Browserlauf: ein frischer Homebildschirm stand OHNE DOCK da.
  // Nichts gespeichert hiess „dock: []" statt „dock: Vorgabe".
  ok(SB.normalizeLayout(null).dock.length === SB.DOCK_MAX,
    'ohne gespeicherten Stand bleibt das Dock leer — ein frisch installiertes Handy haette gar kein Dock');
  ok(SB.normalizeLayout({ pages: [{ title: 'A', keys: ['kalender'] }] }).dock.length === SB.DOCK_MAX,
    'ein Stand ohne dock-Feld verliert das Dock');
  // Ausdruecklich leer bleibt leer: wer alle vier Symbole aus dem Dock zieht,
  // findet sie beim naechsten Laden nicht wieder darin.
  ok(SB.normalizeLayout({ pages: [{ title: 'A', keys: ['kalender'] }], dock: [] }).dock.length === 0,
    'ein absichtlich leergezogenes Dock fuellt sich beim Laden wieder mit der Vorgabe');
  ok(SB.normalizeLayout({ pages: [] }).pages.length === 1, 'eine Anordnung ohne jede Seite bleibt ohne Seite');
}

// Der ALTE Stand kannte nur { dock, hidden, page } — er darf nicht verloren
// gehen und schon gar nicht zu einem leeren Homebildschirm fuehren.
{
  const alt = SB.normalizeLayout({ dock: ['fokus', 'mail'], hidden: [], page: 1 });
  ok(alt.pages.length === CONFIG.SPRINGBOARD_PAGES.length,
    'der alte gespeicherte Stand ergibt keinen vollstaendigen Homebildschirm mehr');
  ok(alt.dock[0] === 'fokus' && alt.dock.includes('mail'), 'das selbst gelegte Dock des alten Standes geht verloren');
}

// Legen: innerhalb einer Seite, auf eine andere Seite, ins Dock.
{
  let l = SB.defaultLayout();
  const erste = l.pages[0].keys.slice();
  l = SB.placeApp(l, erste[3], { kind: 'page', page: 0, index: 0 });
  ok(l.pages[0].keys[0] === erste[3], 'eine App laesst sich nicht an den Anfang ihrer Seite ziehen');
  ok(l.pages[0].keys.length === erste.length, 'beim Umsortieren geht eine App verloren oder kommt eine dazu');

  l = SB.placeApp(l, erste[3], { kind: 'page', page: 1, index: 0 });
  ok(l.pages[1].keys[0] === erste[3], 'eine App laesst sich nicht auf eine andere Seite ziehen');
  ok(!l.pages[0].keys.includes(erste[3]), 'die App liegt nach dem Wechsel auf BEIDEN Seiten');

  l = SB.placeApp(l, 'briefing', { kind: 'page', page: 0, index: 1 });
  ok(l.pages[0].keys[1] === 'briefing', 'eine App aus der Ablage laesst sich nicht auf eine Seite legen');
}

// Das Dock hat vier Plaetze — und die Geste wird abgelehnt, nicht still eine
// andere App verdraengt.
{
  let l = SB.defaultLayout();
  ok(l.dock.length === SB.DOCK_MAX, 'das Vorgabe-Dock ist nicht voll — der folgende Test misst nichts');
  const vorher = l.dock.slice();
  l = SB.placeApp(l, 'briefing', { kind: 'dock', index: 0 });
  ok(l.dock.join() === vorher.join(), 'ein fuenftes Symbol kommt ins Dock (oder verdraengt still ein anderes)');
  ok(!l.dock.includes('briefing'), 'das volle Dock nimmt trotzdem an');

  // Umsortieren INNERHALB des vollen Docks muss dagegen gehen.
  const letzte = vorher[vorher.length - 1];
  l = SB.placeApp(l, letzte, { kind: 'dock', index: 0 });
  ok(l.dock[0] === letzte, 'im vollen Dock laesst sich nichts mehr umsortieren');
  ok(l.dock.length === SB.DOCK_MAX, 'beim Umsortieren im Dock geht ein Platz verloren');
}

// Wegnehmen heisst: vom Homebildschirm, nicht aus der App.
{
  let l = SB.defaultLayout();
  const key = l.pages[0].keys[0];
  l = SB.removeApp(l, key);
  ok(!SB.placedKeys(l).includes(key), 'die weggenommene App liegt weiterhin auf dem Homebildschirm');
  ok(SB.availableApps(l).some(a => a.key === key), 'die weggenommene App steht nicht in der Ablage zum Zuruecklegen');
  ok(CONFIG.MORE_MODULES.some(m => m.key === key) || SB.APP_CATALOG.has(key),
    'die App ist ganz verschwunden statt nur vom Homebildschirm genommen');
}

// Ablage = alles, was der Katalog kennt und was gerade nicht liegt.
{
  const frei = SB.availableApps(SB.defaultLayout()).map(a => a.key);
  ok(frei.includes('briefing'), 'Briefing steht nicht zum Hinzufuegen bereit, obwohl es keine Kachel hat');
  ok(!frei.includes('planen'), 'eine App, die bereits liegt, wird zum Hinzufuegen angeboten');
}

// Seiten: hinzufuegen, umbenennen, leere fallen beim Beenden weg (so wird man
// eine Seite wieder los), die erste bleibt immer.
{
  let l = SB.addPage(SB.defaultLayout(), 'Neu');
  ok(l.pages.length === SB.defaultLayout().pages.length + 1, 'es laesst sich keine Seite hinzufuegen');
  l = SB.renamePage(l, l.pages.length - 1, 'Werkstatt');
  ok(l.pages[l.pages.length - 1].title === 'Werkstatt', 'eine Seite laesst sich nicht umbenennen');
  const nachher = SB.dropEmptyPages(l);
  ok(nachher.pages.length === SB.defaultLayout().pages.length, 'die leere Seite bleibt nach dem Beenden stehen');
  ok(SB.dropEmptyPages({ pages: [{ title: 'x', keys: [] }], dock: [] }).pages.length === 1,
    'ein Homebildschirm ohne jede Seite ist moeglich');
}

// Speichern und Laden — echt, durch den localStorage-Stub.
{
  SPEICHER.clear();
  const l = SB.placeApp(SB.defaultLayout(), 'briefing', { kind: 'page', page: 0, index: 0 });
  SB.saveLayout(l);
  ok(SPEICHER.has(CONFIG.LS.springboard), 'die Anordnung wird nicht gespeichert');
  ok(SB.loadLayout().pages[0].keys[0] === 'briefing', 'die gespeicherte Anordnung kommt nicht zurueck');
  SB.resetLayout();
  ok(!SPEICHER.has(CONFIG.LS.springboard), 'Zuruecksetzen loescht den gespeicherten Stand nicht');
  ok(SB.loadLayout().pages[0].keys[0] === SB.defaultLayout().pages[0].keys[0],
    'nach dem Zuruecksetzen gilt nicht wieder die Vorgabe');
  // Muell im Speicher darf den Homebildschirm nicht sprengen.
  SPEICHER.set(CONFIG.LS.springboard, '{kein json');
  ok(SB.loadLayout().pages.length > 0, 'ein kaputter gespeicherter Stand macht den Homebildschirm leer');
  SPEICHER.clear();
}

// ═══ 2. DIE ANORDNUNG BLEIBT LOKAL ═════════════════════════════════════════
{
  const quelle = lies('js/springboard.js');
  ok(!/from '\.\/store\.js'/.test(quelle),
    'das Anordnungs-Modell haengt am Store — damit geriete eine Geraete-Einstellung in den Abgleich');
  ok(!/performOp|scheduleSave|pushData/.test(quelle),
    'die Anordnung wird in den Quantus-Datenbestand geschrieben; mergeData() hat fuer sie keinen Zweig');
  ok(/localStorage/.test(quelle), 'die Anordnung wird nirgends dauerhaft gespeichert');
}

// ═══ 3. DIE ANSICHT ════════════════════════════════════════════════════════
const AKTIONEN = {};
const protokoll = { toasts: [] };
const stubs = {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    todayYmd: () => '2026-08-28',
    fmtDurationMin: (m) => `${m}m`,
    haptic: () => {}, toast: (m) => protokoll.toasts.push(m), confirmPreview: async () => true,
  },
  '../config.js': CONFIG,
  '../springboard.js': SB,
  '../store.js': {
    getHabits: () => [], habitDoneOn: () => false, getSubUnits: () => [], subUnitsDoneCount: () => 0,
    getTasks: () => [], getInboxItems: () => [], getDueCards: () => [], getJournalPushes: () => [],
    getMeetings: () => [], getProjects: () => [], notify: () => {}, performOp: async () => {}, state: { data: {} },
  },
  './briefing.js': { briefingZahlen: () => ({ termine: [], faellig: [], ueberfaellig: [], erledigt: 0, routinen: [] }) },
  './ideen.js': { ideenZahlen: () => ({ offen: [] }) },
  '../focus.js': { statsForDay: () => ({ minutes: 0, count: 0 }) },
  '../actions.js': { registerActions: (o) => Object.assign(AKTIONEN, o) },
  '../router.js': { navigate: () => {} },
  '../search.js': { openSearch: () => {} },
};
const quelleHome = lies('js/views/home.js');
const ohneImporte = quelleHome.replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
  ok(Object.prototype.hasOwnProperty.call(stubs, pfad), `unbekannter Import: ${pfad}`);
  const namen = /\{([^}]*)\}/.exec(m);
  if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
  return `const ${/\*\s+as\s+(\w+)/.exec(m)[1]} = __stubs['${pfad}'];`;
});
const HOME = new Function('__stubs', ohneImporte.replace(/^export default view;$/m, 'return view;'))(stubs);
ok(HOME && typeof HOME.render === 'function', 'die Home-Ansicht hat kein render()');

// Sie rendert aus dem MODELL, nicht mehr aus der Konstante.
ok(!/SPRINGBOARD_PAGES/.test(quelleHome),
  'die Ansicht liest weiterhin SPRINGBOARD_PAGES direkt — eine gespeicherte Anordnung waere wirkungslos');

const html = HOME.render();
ok(/data-action="sb-arrange"/.test(html), 'es gibt keinen sichtbaren Weg in den Anordnen-Modus');
ok(/class="sb-editbar"/.test(html), 'die Leiste des Anordnen-Modus fehlt');
ok(/data-action="sb-done"/.test(html), 'der Anordnen-Modus laesst sich nicht beenden — dieselbe Falle wie die alte Seitenleiste');
ok(/data-action="sb-remove"/.test(html), 'kein Griff, um eine App vom Homebildschirm zu nehmen');
ok(/data-action="sb-add"/.test(html), 'die Ablage bietet keine App zum Hinzufuegen an');
ok(/data-action="sb-add-page"/.test(html), 'es laesst sich keine Seite hinzufuegen');
ok(/data-action="sb-reset"/.test(html), 'die Anordnung laesst sich nicht zuruecksetzen');
ok(/class="sb-page-input"/.test(html), 'die Seitentitel lassen sich nicht aendern');
// Die Ablage enthaelt wirklich die Apps ohne Kachel.
ok(/data-action="sb-add" data-key="briefing"/.test(html), 'Briefing steht nicht in der Ablage');
// Symbole tragen ihren Schluessel — daran haengt das Ziehen und das Zurueckschreiben.
ok(/class="sb-app[^"]*" data-action="sb-open"[\s\S]{0,120}data-key="/.test(html), 'die Symbole tragen keinen Schluessel');
// Ein Knopf im Knopf waere ungueltiges HTML — das ✕ sitzt IM Symbol.
ok(!/<button class="sb-app/.test(html), 'das Symbol ist wieder ein <button> und enthaelt trotzdem den ✕-Knopf');
ok(/role="button"[^>]*tabindex="0"/.test(html), 'das Symbol ist ohne Maus/Finger nicht mehr bedienbar');

// Der Modus laesst sich schalten, und die Ansicht meldet sich dabei ab.
ok(typeof HOME.busy === 'function', 'die Ansicht kann sich nicht gegen das Neurendern sperren (busy fehlt)');
ok(HOME.busy() === false, 'die Ansicht meldet sich als beschaeftigt, obwohl gar nichts laeuft');
AKTIONEN['sb-arrange']();
ok(HOME.busy() === true, 'waehrend des Anordnens rendert die Schale weiter — das Symbol verschwindet unter dem Finger');
ok(/class="springboard editing"/.test(HOME.render()), 'der Anordnen-Modus schlaegt nicht auf die Darstellung durch');

// Wegnehmen und Zuruecklegen — echt, ueber die registrierten Aktionen.
{
  const key = SB.loadLayout().pages[0].keys[0];
  AKTIONEN['sb-remove']({ key });
  ok(!SB.placedKeys(SB.loadLayout()).includes(key), 'das Wegnehmen wird nicht gespeichert');
  ok(HOME.render().includes(`data-action="sb-add" data-key="${key}"`), 'die weggenommene App fehlt in der Ablage');
  AKTIONEN['sb-add']({ key });
  ok(SB.placedKeys(SB.loadLayout()).includes(key), 'das Zuruecklegen wird nicht gespeichert');
}
AKTIONEN['sb-done']();
ok(HOME.busy() === false, 'der Anordnen-Modus laesst sich nicht beenden');

// Ein Tipp im Anordnen-Modus darf nicht navigieren.
{
  let gefahren = null;
  stubs['../router.js'].navigate = (r) => { gefahren = r; };
  AKTIONEN['sb-arrange']();
  AKTIONEN['sb-open']({ route: 'kalender' });
  ok(gefahren === null, 'ein Tipp im Anordnen-Modus oeffnet die App, statt sie zu greifen');
  AKTIONEN['sb-done']();
}

// Die Schale respektiert busy().
{
  const shell = lies('js/shell.js');
  ok(/busy\(\)/.test(shell) && /store\.subscribe\(\(\) => \{[\s\S]*busy/.test(shell),
    'die Schale rendert bei jeder Datenaenderung neu, auch waehrend einer laufenden Geste');
}

// ═══ 4. DAS CSS ════════════════════════════════════════════════════════════
{
  const css = lies('css/apps.css');
  const aktiv = css.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/\.sb-x[^{]*\{[^}]*display:\s*none/.test(aktiv), 'die ✕-Knoepfe sind auch ausserhalb des Anordnen-Modus sichtbar');
  ok(/\.springboard\.editing\s+\.sb-x\s*\{[^}]*display:\s*grid/.test(aktiv), 'im Anordnen-Modus erscheint kein ✕');
  ok(/\.sb-ghost\s*\{[^}]*position:\s*fixed/.test(aktiv), 'das gezogene Symbol haengt nicht am Finger');
  ok(/\.springboard\.editing\s+\.sb-app\s*\{[^}]*touch-action:\s*none/.test(aktiv),
    'ohne touch-action rollt der Browser die Seite, statt das Symbol zu ziehen');
  ok(/\.springboard\.editing\s+\.sb-grid\s*\{[^}]*min-height/.test(aktiv),
    'eine leergezogene Seite ist 0 Pixel hoch und nimmt nichts mehr an');
  ok(/\.springboard\.editing\s+\.sb-editbar\s*\{[^}]*display:\s*flex/.test(aktiv), 'die Leiste des Modus bleibt unsichtbar');
  // BEFUND nebenbei: config.js vergibt tone-coral (Career, Pinnboard), das CSS
  // kannte den Ton nicht — die beiden Symbole standen ohne Farbe da.
  ok(/\.tone-coral\s*\{/.test(aktiv), 'tone-coral fehlt im CSS, obwohl config.js ihn vergibt');
  const toene = new Set([...css.matchAll(/\.tone-([a-z]+)\s*\{/g)].map(m => m[1]));
  const vergeben = new Set([...SB.APP_CATALOG.values()].map(a => a.tone));
  vergeben.forEach(t => ok(toene.has(t), `der Farbton "${t}" wird vergeben, aber im CSS gibt es ihn nicht`));
}

// ═══ 5. DER SERVICE WORKER LIEFERT DAS NEUE MODUL AUS ══════════════════════
// Ein Modul, das nicht in der App-Shell steht, ist auf einem Telefon mit
// bestehendem Cache ein 404 — und weil home.js es importiert, waere damit der
// ganze Homebildschirm weg. Deshalb hier nicht nur die neue Datei, sondern die
// Regel: JEDES ausgelieferte Modul steht in der Shell.
{
  const sw = lies('sw.js');
  ok(sw.includes('./js/springboard.js'), 'js/springboard.js steht nicht in der App-Shell — die Telefone bekaemen einen 404');
  const dateien = [
    ...fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => './js/' + f),
    ...fs.readdirSync(path.join(root, 'js/views')).filter(f => f.endsWith('.js')).map(f => './js/views/' + f),
  ];
  dateien.forEach(f => ok(sw.includes(f), `${f} fehlt in der App-Shell des Service Workers`));
  const v = /const VERSION = '([^']+)'/.exec(sw);
  ok(v && v[1] !== 'quantus-mobile-v13-polaris-anzeige',
    `der Cache heisst weiterhin "${v && v[1]}" — die Telefone behielten den alten Homebildschirm`);
}

if (luecken.length) {
  console.error(`APPS ANORDNEN — ${luecken.length} von ${checks} Pruefungen:`);
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`apps anordnen: ok (${checks} Pruefungen)`);
