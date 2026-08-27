/*
 * Morning Briefing, Pinnboard und die Wege zu Smarter/BM.
 *
 * DREI BEFUNDE:
 *
 * 1. store.getDailyBriefing() gab es laengst — und wurde von KEINER einzigen
 *    Ansicht benutzt. Auf dem Startbildschirm kam der Tag gar nicht vor.
 *
 * 2. Pinnboard, BM-Vorbereitung, Smarter und Career Model liessen sich nicht
 *    oeffnen, weil es sie in der Mobile-App nicht gab: kein View, keine Route,
 *    keine Kachel. Die Post-it-Daten lagen dabei laengst im synchronisierten
 *    Bestand unter entity.stickyBoard.notes[].
 *
 * 3. leseplan.js ist ausweislich seines eigenen Kopfes die "Kombination aus
 *    Smarter + BM-Vorbereitung". Statt zwei Attrappen zu bauen, fuehren beide
 *    Namen jetzt auf dieselbe Ansicht — sie laufen nicht mehr ins Leere.
 *
 * Geprueft wird gegen die ECHTEN Ansichten: sie werden geladen, ihre Importe
 * auf Attrappen umgebogen, render() laeuft unveraendert.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const ymd = (v) => { const d = new Date(); d.setDate(d.getDate() - v);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const HEUTE = ymd(0);

const protokoll = { ops: [], nav: [], sheets: [], toasts: [] };
const AKTIONEN = {};

const DATEN = {
  tasks: [
    { id: 't1', title: 'Heute faellig', status: 'todo', dueDate: HEUTE },
    { id: 't2', title: 'Laengst vorbei', status: 'todo', dueDate: ymd(3) },
    { id: 't3', title: 'Schon erledigt', status: 'done', dueDate: HEUTE },
  ],
  meetings: [{ id: 'm1', title: 'Sitzung VB', date: HEUTE, startTime: '09:30', location: 'Bern' }],
  habits: [
    { id: 'h1', text: 'Morgenroutine', frequency: 'daily', completions: [{ date: HEUTE }] },
    { id: 'h2', text: 'Wasser', frequency: 'daily', completions: [] },
  ],
  briefing: { beliefs: [{ id: 'b1', text: 'Erst denken, dann tippen.' }], routines: [] },
  projects: [{ id: 'p1', title: 'Quantus', updatedAt: '2026-08-27T10:00:00.000Z',
    stickyBoard: { notes: [{ id: 'n1', text: 'Erste Notiz', color: 'sand' }, { id: 'n2', text: 'Zweite' }], connections: [] } }],
  notes: [{ id: 'no1', title: 'Ohne Board' }],
};

let ROUTE = { route: 'briefing', sub: null, params: {} };

const stubs = {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    todayYmd: (d) => { const x = d instanceof Date ? d : new Date();
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); },
    toast: (t, k) => protokoll.toasts.push(k + ':' + t),
    openSheet: (o) => { protokoll.sheets.push(o); return {}; },
    closeSheet: () => {}, confirmPreview: async () => true,
    newId: () => 'neu', nowISO: () => new Date().toISOString(),
    fmtDurationMin: (m) => m + ' min', haptic: () => {},
  },
  '../store.js': {
    getTasks: () => DATEN.tasks,
    getMeetings: () => DATEN.meetings,
    getHabits: () => DATEN.habits,
    getCollection: (n) => DATEN[n] || [],
    getById: (kind, id) => (DATEN[kind + 's'] || []).find((x) => x.id === id) || null,
    getDailyBriefing: () => DATEN.briefing,
    habitDoneOn: (h, y) => Array.isArray(h.completions) && h.completions.some((c) => c && c.date === y),
    performOp: async (op) => { protokoll.ops.push(op); },
    getDueCards: () => [], getInboxItems: () => [], getDecks: () => [], getCards: () => [],
  },
  '../actions.js': { registerActions: (o) => Object.assign(AKTIONEN, o) },
  '../router.js': { navigate: (r, o) => protokoll.nav.push({ route: r, ...(o || {}) }), current: () => ROUTE },
  '../focus.js': { statsForDay: () => ({ minutes: 50, count: 2 }) },
  './common.js': { pageHeader: (t, s, r) => `<h1>${t}</h1><p>${s || ''}</p>${r || ''}` },
  './briefing.js': null,   // wird unten mit dem echten Modul gefuellt
  '../config.js': {}, '../shell.js': { isTablet: () => false },
};

function lade(datei) {
  // Auf einem Stand OHNE die neue Ansicht gibt es die Datei nicht. Das ist der
  // Befund und muss als solcher gemeldet werden — nicht als Absturz, der den
  // ganzen Lauf beendet und alles Weitere ungemessen laesst.
  const pfad = path.join(root, 'js/views/', datei);
  if (!fs.existsSync(pfad)) {
    ok(false, `die Ansicht ${datei} gibt es nicht — sie laesst sich nicht oeffnen`);
    return { render: null, __exports: {} };
  }
  const quelle = fs.readFileSync(pfad, 'utf8');
  const ohne = quelle.replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
    ok(Object.prototype.hasOwnProperty.call(stubs, pfad), `${datei}: unbekannter Import ${pfad}`);
    const namen = /\{([^}]*)\}/.exec(m);
    if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
    return `const ${/\*\s+as\s+(\w+)/.exec(m)[1]} = __stubs['${pfad}'];`;
  });
  // "export default {…};" laesst sich nicht direkt in einen Aufruf umbiegen —
  // das Literal endet auf "};" und ein angehaengtes ", {…});" waere unbalanciert.
  // Deshalb erst in eine Konstante, dann sauber zurueckgeben.
  const body = ohne.replace(/^export function /gm, 'function ')
    .replace(/^export default/m, 'const __default =') +
    '\nreturn Object.assign(__default, { __exports: {' +
    '  briefingZahlen: typeof briefingZahlen === "function" ? briefingZahlen : undefined,' +
    '  boards: typeof boards === "function" ? boards : undefined } });';
  return new Function('__stubs', body)(stubs);
}

// ═══ 1. BRIEFING ═══════════════════════════════════════════════════════
const briefing = lade('briefing.js');
stubs['./briefing.js'] = { briefingZahlen: briefing.__exports.briefingZahlen };

ok(typeof briefing.render === 'function', 'die Briefing-Ansicht hat kein render()');
ok(typeof briefing.__exports.briefingZahlen === 'function',
  'briefingZahlen wird nicht exportiert — Home und Ansicht koennten auseinanderlaufen');
if (briefing.__exports.briefingZahlen) {
  const z = briefing.__exports.briefingZahlen();
  ok(z.termine.length === 1, `${z.termine.length} Termine statt 1`);
  ok(z.faellig.length === 1, `${z.faellig.length} faellige Aufgaben statt 1 (erledigte duerfen nicht zaehlen)`);
  ok(z.ueberfaellig.length === 1, `${z.ueberfaellig.length} ueberfaellige statt 1`);
  ok(z.erledigt === 1 && z.routinen.length === 2, `Routinen ${z.erledigt}/${z.routinen.length} statt 1/2`);
  ok(z.beliefs.length === 1, 'die Leitsaetze aus dailyBriefing.beliefs fehlen');

  const h = briefing.render ? briefing.render() : '';
  ok(/Sitzung VB/.test(h), 'der Termin steht nicht im Briefing');
  ok(/09:30/.test(h), 'die Uhrzeit fehlt');
  ok(/Heute faellig/.test(h), 'die faellige Aufgabe fehlt');
  ok(/Laengst vorbei/.test(h), 'die ueberfaellige Aufgabe fehlt');
  ok(!/Schon erledigt/.test(h), 'eine erledigte Aufgabe steht im Briefing');
  ok(/Erst denken, dann tippen/.test(h), 'die Leitsaetze fehlen');
  ok(/Morgenroutine/.test(h) && /Wasser/.test(h), 'die Routinen fehlen');
  ok(/data-action="bf-toggle-habit"/.test(h), 'die Routinen lassen sich im Briefing nicht abhaken');
  ok(/bf-kpi/.test(h), 'die Kennzahlen fehlen');
}
{
  protokoll.ops.length = 0;
  ok(typeof AKTIONEN['bf-toggle-habit'] === 'function', 'bf-toggle-habit ist nicht registriert');
  if (AKTIONEN['bf-toggle-habit']) {
    await AKTIONEN['bf-toggle-habit']({ id: 'h1' });
    ok(protokoll.ops.length === 1 && protokoll.ops[0].type === 'toggle-habit',
      'das Abhaken im Briefing benutzt nicht die bestehende Op');
    ok(protokoll.ops[0].payload.date === HEUTE, 'das Abhaken trifft nicht den heutigen Tag');
  }
}

// ═══ 2. HOME: der Block steht VOR den Kacheln ══════════════════════════
{
  const quelle = fs.readFileSync(path.join(root, 'js/views/home.js'), 'utf8');
  ok(/import \{ briefingZahlen \} from '\.\/briefing\.js';/.test(quelle),
    'home.js rechnet die Zahlen selbst — sie koennten von der Briefing-Ansicht abweichen');
  ok(/function briefingBlock\(\)/.test(quelle), 'auf dem Startbildschirm gibt es keinen Briefing-Block');
  const i = quelle.indexOf('${briefingBlock()}');
  const j = quelle.indexOf('${widgets()}');
  const k = quelle.indexOf('sb-pages');
  ok(i > 0, 'der Briefing-Block wird nicht gerendert');
  ok(i < j, 'der Briefing-Block steht hinter den Widgets statt davor');
  ok(i < k, 'der Briefing-Block steht hinter den Kacheln — er waere nicht das Erste, was man sieht');
  ok(/data-route="briefing"/.test(quelle), 'der Block fuehrt nicht in die Briefing-Ansicht');
}

// ═══ 3. PINNBOARD ══════════════════════════════════════════════════════
const pinn = lade('pinnboard.js');
ok(typeof pinn.render === 'function', 'die Pinnboard-Ansicht hat kein render()');
if (pinn.__exports.boards && pinn.render) {
  const b = pinn.__exports.boards();
  ok(b.length === 1, `${b.length} Boards statt 1 — nur Entitaeten MIT Post-its zaehlen`);
  ok(b[0] && b[0].notes.length === 2, 'die Post-its des Boards wurden nicht gefunden');
  ok(b[0] && b[0].titel === 'Quantus', `das Board heisst "${b[0] && b[0].titel}"`);

  ROUTE = { route: 'pinnboard', sub: null, params: {} };
  const liste = pinn.render();
  ok(/Quantus/.test(liste), 'das Board fehlt in der Liste');
  ok(/data-action="pb-open"/.test(liste), 'das Board laesst sich nicht oeffnen');
  ok(!/Ohne Board/.test(liste), 'eine Entitaet ohne Post-its steht in der Liste');

  ROUTE = { route: 'pinnboard', sub: 'projects', params: { id: 'p1' } };
  const detail = pinn.render();
  ok(/Erste Notiz/.test(detail) && /Zweite/.test(detail), 'die Post-its werden nicht angezeigt');
  ok(/data-action="pb-note"/.test(detail), 'die Post-its lassen sich nicht antippen');
  ok(/data-action="pb-back"/.test(detail), 'aus dem Board fuehrt kein Weg zurueck');

  ROUTE = { route: 'pinnboard', sub: 'projects', params: { id: 'gibtsnicht' } };
  ok(/gibt es nicht mehr/.test(pinn.render()), 'ein unbekanntes Board zeigt keine ehrliche Meldung');
}
if (AKTIONEN['pb-note'] && AKTIONEN['pb-save']) {
  ROUTE = { route: 'pinnboard', sub: 'projects', params: { id: 'p1' } };
  protokoll.sheets.length = 0; protokoll.ops.length = 0;
  await AKTIONEN['pb-note']({ note: 'n1' });
  ok(protokoll.sheets.length === 1, 'das Antippen einer Notiz oeffnet kein Sheet');
  ok(/Erste Notiz/.test((protokoll.sheets[0] || {}).body || ''), 'der Text ist nicht vorbelegt');

  globalThis.FormData = class { constructor(f) { this.f = f; } forEach(cb) { this.f.d.forEach(([k, v]) => cb(v, k)); } };
  await AKTIONEN['pb-save']({ note: 'n1' }, null, { target: { closest: () => ({ d: [['text', 'Geaendert']] }) } });
  ok(protokoll.ops.length === 1, `es liefen ${protokoll.ops.length} Ops statt einer`);
  const op = protokoll.ops[0] || {};
  ok(op.type === 'update-project', `die Op ist "${op.type}" statt update-project`);
  ok(op.payload && Array.isArray(op.payload.stickyBoard.notes) && op.payload.stickyBoard.notes.length === 2,
    'beim Speichern gingen Post-its verloren');
  ok(op.payload.stickyBoard.notes[0].text === 'Geaendert', 'der neue Text kam nicht an');
  ok(op.payload.stickyBoard.notes[1].text === 'Zweite', 'die andere Notiz wurde ueberschrieben');
  ok(Array.isArray(op.payload.stickyBoard.connections), 'die Verbindungen des Boards gingen verloren');
}

// ═══ 4. Smarter und BM laufen nicht mehr ins Leere ═════════════════════
{
  const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  ok(/smarter: leseplan/.test(main), 'die Route smarter ist nicht registriert — die Kachel liefe ins Leere');
  ok(/bm: leseplan/.test(main), 'die Route bm ist nicht registriert');
  ok(/briefing,/.test(main) && /pinnboard,/.test(main), 'Briefing oder Pinnboard sind nicht registriert');

  const cfg = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
  for (const [name, route] of [['Briefing', 'briefing'], ['Smarter', 'smarter'],
    ['BM-Vorbereitung', 'bm'], ['Pinnboard', 'pinnboard']]) {
    ok(new RegExp(`route: '${route}'`).test(cfg), `fuer ${name} gibt es keine Kachel`);
  }
  // Keine Kachel darf nach draussen zeigen. Geprueft werden NUR die
  // Kachel-Listen — DEFAULT_BASE_URL weiter oben ist die Sync-Adresse des
  // Backends und hat mit Navigation nichts zu tun.
  const listen = cfg.slice(cfg.indexOf('MORE_MODULES'));
  ok(!/management-xo2-pro|https?:\/\//.test(listen),
    'eine Kachel verweist auf eine fremde Adresse statt in die Mobile-App');
  ok(!/route: 'https?/.test(cfg), 'eine Route ist eine URL');
}

// ═══ 5. Der Service Worker liefert die neuen Dateien aus ═══════════════
{
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  for (const f of ['./js/views/briefing.js', './js/views/pinnboard.js']) {
    ok(sw.includes(f), `${f} steht nicht in der App-Shell — die Telefone bekaemen einen 404`);
  }
  const v = /const VERSION = '([^']+)'/.exec(sw);
  ok(v && v[1] !== 'quantus-mobile-v6-habits-spacing', `der Cache heisst weiterhin "${v && v[1]}"`);
}

if (luecken.length) {
  console.error('BRIEFING & PINNBOARD — ' + luecken.length + ' von ' + checks + ' Pruefungen:');
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`briefing & pinnboard: ok (${checks} Pruefungen)`);
