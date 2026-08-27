/*
 * Die Routinen-Karte laesst sich oeffnen.
 *
 * BEFUND (Telefon, Bildschirmfoto): die Karten in der Gewohnheiten-Liste
 * liessen sich nicht oeffnen. Sie trugen genau zwei Aktionen — den Haken links
 * (habit-toggle) und den Papierkorb rechts (habit-delete). Der Rumpf der Karte,
 * also Titel, Frequenz, Serie und Balken, war TOT: kein data-action, kein
 * Detail, keine Bearbeitung, kein Verlauf. Wer eine Routine umbenennen oder
 * auch nur nachsehen wollte, hatte keinen Weg.
 *
 * Zweiter Befund an derselben Karte: der Papierkorb loeschte OHNE Rueckfrage —
 * und er liegt einen Daumen neben dem Kartenrumpf. Die App hat mit
 * confirmPreview laengst einen Bestaetigungsweg, den die Aufgabenliste auch
 * benutzt.
 *
 * Geprueft wird gegen die ECHTE Ansicht: render() laeuft gegen einen
 * Store-Stub, die registrierten Aktionen werden abgefangen und aufgerufen.
 * Kein Browser, kein Netz.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

// ── Die echte Ansicht laden, mit Attrappen fuer ihre vier Importe ─────────
const protokoll = { ops: [], sheets: [], toasts: [], closed: 0, confirms: [] };
let confirmAntwort = true;

// Die Testdaten haengen an der ECHTEN Uhr, nicht an einem festen Datum:
// streak() und last30() rechnen von new Date() rueckwaerts. Ein hart
// verdrahtetes '2026-08-27' waere am naechsten Tag stumm falsch.
const ymd = (versatzTage) => {
  const d = new Date(); d.setDate(d.getDate() - versatzTage);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const HEUTE = ymd(0);
const HABITS = [
  { id: 'h1', text: 'Morgenroutine', icon: '📖', frequency: 'daily',
    completions: [{ date: HEUTE, value: 1 }, { date: ymd(1), value: 1 }] },
  { id: 'h2', text: 'Wasser trinken', frequency: 'weekdays', completions: [] },
];

const stubs = {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    // ECHT rechnen, nicht immer HEUTE zurueckgeben: streak() zaehlt in einer
    // for(;;)-Schleife rueckwaerts und bricht erst ab, wenn ein Tag NICHT
    // erledigt ist. Eine Attrappe, die jeden Tag als heute ausgibt, laesst die
    // Schleife ewig laufen — der Test haengt statt zu messen.
    todayYmd: (d) => {
      const x = d instanceof Date ? d : new Date();
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    },
    openSheet: (o) => { protokoll.sheets.push(o); return {}; },
    closeSheet: () => { protokoll.closed++; },
    toast: (t, k) => protokoll.toasts.push(k + ':' + t),
    confirmPreview: async (o) => { protokoll.confirms.push(o); return confirmAntwort; },
  },
  '../store.js': {
    getHabits: () => HABITS,
    habitDoneOn: (h, y) => Array.isArray(h.completions) && h.completions.some((c) => c && c.date === y),
    performOp: async (op) => { protokoll.ops.push(op); },
  },
  '../actions.js': { registerActions: (o) => Object.assign(AKTIONEN, o) },
  './common.js': { pageHeader: (t, s, r) => `<h1>${t}</h1><p>${s}</p>${r}` },
};
const AKTIONEN = {};
// TOLERANT aufrufen. Auf einem Stand ohne die neuen Aktionen wuerde ein
// direkter Aufruf mit einer TypeError den ganzen Lauf beenden — rot aus dem
// falschen Grund, und alles Folgende waere nie gemessen worden.
async function ruf(name, ...args) {
  if (typeof AKTIONEN[name] !== 'function') { ok(false, `die Aktion ${name} ist nicht registriert`); return; }
  return AKTIONEN[name](...args);
}

// Die Datei wird als Text geladen, ihre Importe werden auf die Attrappen
// umgebogen und der Rest laeuft ECHT. So misst der Test die ausgelieferte
// Ansicht, nicht eine Nachbildung.
const quelle = fs.readFileSync(path.join(root, 'js/views/gewohnheiten.js'), 'utf8');
const ohneImporte = quelle.replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
  ok(Object.prototype.hasOwnProperty.call(stubs, pfad), `unbekannter Import: ${pfad}`);
  const namen = /\{([^}]*)\}/.exec(m);
  if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
  const stern = /\*\s+as\s+(\w+)/.exec(m);
  return `const ${stern[1]} = __stubs['${pfad}'];`;
});
const modul = new Function('__stubs', ohneImporte.replace(/^export default/m, 'return') + ';')(stubs);

ok(modul && typeof modul.render === 'function', 'die Ansicht hat kein render()');
const html = modul.render();

// ═══ 1. DER KARTENRUMPF IST KEIN TOTES FELD MEHR ═══════════════════════
ok(/class="habit-main"[^>]*data-action="habit-open"/.test(html),
  'DER BEFUND: der Kartenrumpf traegt keine Aktion — die Routine laesst sich nicht oeffnen');
ok(/data-action="habit-open" data-id="h1"/.test(html), 'die Karte gibt ihre Id nicht mit');
ok(/class="habit-main"[^>]*role="button"/.test(html), 'der Rumpf ist fuer Hilfsmittel kein Bedienelement');
ok(/class="habit-main"[^>]*tabindex="0"/.test(html), 'der Rumpf ist per Tastatur nicht erreichbar');
ok(/aria-label="Routine öffnen: Morgenroutine"/.test(html), 'der Rumpf sagt nicht, was er oeffnet');

// Haken und Papierkorb bleiben eigene Knoepfe — sie duerfen den Rumpf nicht
// mit oeffnen, sonst geht bei jedem Abhaken ein Sheet auf.
ok(/class="habit-check[^"]*"[^>]*data-action="habit-toggle"/.test(html), 'der Haken hat seine Aktion verloren');
ok(/class="icon-btn danger"[^>]*data-action="habit-delete"/.test(html), 'der Papierkorb hat seine Aktion verloren');
{
  const rumpf = html.slice(html.indexOf('class="habit-main"'), html.indexOf('</div>', html.indexOf('habit-bar-fill')));
  ok(!rumpf.includes('data-action="habit-toggle"'), 'der Haken liegt IM Rumpf — ein Tipp wuerde beides ausloesen');
  ok(!rumpf.includes('data-action="habit-delete"'), 'der Papierkorb liegt IM Rumpf');
}
ok(/aria-label="(Heute rückgängig|Heute erledigt)"/.test(html), 'der Haken sagt nicht, was er tut');

// ═══ 2. DIE AKTIONEN SIND REGISTRIERT ══════════════════════════════════
for (const a of ['habit-open', 'habit-edit', 'habit-save', 'habit-toggle', 'habit-delete']) {
  ok(typeof AKTIONEN[a] === 'function', `die Aktion ${a} ist nicht registriert`);
}

// ═══ 3. OEFFNEN: das Sheet zeigt den echten Stand ══════════════════════
{
  protokoll.sheets.length = 0;
  await ruf('habit-open', { id: 'h1' });
  ok(protokoll.sheets.length === 1, `es wurden ${protokoll.sheets.length} Sheets geoeffnet statt einem`);
  // Ohne Detail-Sheet gibt es keinen Inhalt. Ein leerer String misst dann
  // ehrlich "fehlt", statt den Lauf mit einer TypeError zu beenden.
  const b = (protokoll.sheets[0] || {}).body || '';
  ok(/Morgenroutine/.test(b), 'das Detail nennt die Routine nicht');
  ok(/Täglich/.test(b), 'das Detail nennt die Haeufigkeit nicht');
  ok(/habit-strip-cell/.test(b), 'das Detail zeigt keinen 30-Tage-Streifen');
  ok((b.match(/habit-strip-cell/g) || []).length === 30, 'der Streifen hat nicht 30 Zellen');
  ok((b.match(/habit-strip-cell on/g) || []).length === 2,
    'die erledigten Tage im Streifen stimmen nicht mit den completions ueberein');
  ok(/>2<\/div><div class="habit-stat-lbl">Tage Serie/.test(b.replace(/\s+/g, '')) ||
     /2<\/div>\s*<div class="habit-stat-lbl">Tage Serie/.test(b),
    'die Serie zeigt nicht 2 Tage (heute und gestern erledigt)');
  ok(/Heute rückgängig/.test(b), 'bei einer heute erledigten Routine steht nicht "rückgängig"');
  ok(/data-action="habit-edit" data-id="h1"/.test(b), 'aus dem Detail fuehrt kein Weg zum Bearbeiten');
  ok(/data-action="habit-delete"[^>]*data-sheet="1"/.test(b), 'das Loeschen im Sheet ist nicht als Sheet-Aufruf markiert');
  ok(protokoll.ops.length === 0, 'das blosse Oeffnen loeste eine Datenaenderung aus');
}
// Eine offene Routine bietet "Heute erledigt" an.
{
  protokoll.sheets.length = 0;
  await ruf('habit-open', { id: 'h2' });
  ok(/Heute erledigt/.test((protokoll.sheets[0] || {}).body || ''), 'bei einer offenen Routine fehlt "Heute erledigt"');
}
// Eine verschwundene Routine: sauber aufgeben statt ein leeres Sheet zeigen.
{
  protokoll.sheets.length = 0; protokoll.closed = 0; protokoll.toasts.length = 0;
  await ruf('habit-open', { id: 'gibtsnicht' });
  ok(protokoll.sheets.length === 0, 'fuer eine unbekannte Routine wurde ein Sheet geoeffnet');
  ok(protokoll.toasts.some((t) => /error/.test(t)), 'der Fehlschlag wurde nicht gemeldet');
}

// ═══ 4. BEARBEITEN UND SPEICHERN ═══════════════════════════════════════
{
  protokoll.sheets.length = 0;
  await ruf('habit-edit', { id: 'h1' });
  const b = (protokoll.sheets[0] || {}).body || '';
  ok(/<form/.test(b), 'das Bearbeiten-Sheet ist kein Formular');
  ok(/name="text"[^>]*value="Morgenroutine"/.test(b), 'der Name ist nicht vorbelegt');
  ok(/name="frequency"/.test(b) && /value="daily" selected/.test(b), 'die Haeufigkeit ist nicht vorgewaehlt');
  ok(/class="input"/.test(b), 'die Felder folgen nicht der Feld-Konvention der App');
  ok(/data-action="habit-open" data-id="h1"/.test(b), 'aus dem Formular fuehrt kein Weg zurueck');
}
{
  protokoll.ops.length = 0; protokoll.closed = 0; protokoll.toasts.length = 0;
  // Ein Formular-Ereignis wie es die Delegation liefert.
  const felder = [['text', ' Morgenroutine neu '], ['icon', '🌅'], ['frequency', 'weekdays']];
  const form = { forEachDaten: felder };
  const ereignis = { target: { closest: () => form } };
  globalThis.FormData = class { constructor(f) { this.f = f; } forEach(cb) { this.f.forEachDaten.forEach(([k, v]) => cb(v, k)); } };
  await ruf('habit-save', { id: 'h1' }, null, ereignis);
  ok(protokoll.ops.length === 1, `es liefen ${protokoll.ops.length} Ops statt einer`);
  const op = protokoll.ops[0] || {};
  ok(op.type === 'update-habit', `die Op ist "${op.type}" statt update-habit`);
  ok(op.payload && op.payload.id === 'h1', 'die Op trifft eine andere Routine');
  ok(op.payload && op.payload.text === 'Morgenroutine neu',
    `der Name wurde als "${op.payload && op.payload.text}" gespeichert — Leerzeichen nicht abgeschnitten`);
  ok(op.payload && op.payload.frequency === 'weekdays', 'die Haeufigkeit wurde nicht uebernommen');
  ok(protokoll.closed === 1, 'das Sheet wurde nach dem Speichern nicht geschlossen');
  ok(protokoll.toasts.some((t) => /ok:/.test(t)), 'der Erfolg wurde nicht gemeldet');
}
// Leerer Name speichert NICHT.
{
  protokoll.ops.length = 0; protokoll.closed = 0;
  const ereignis = { target: { closest: () => ({ forEachDaten: [['text', '   '], ['frequency', 'daily']] }) } };
  await ruf('habit-save', { id: 'h1' }, null, ereignis);
  ok(protokoll.ops.length === 0, 'ein leerer Name wurde gespeichert');
  ok(protokoll.closed === 0, 'das Sheet schloss sich trotz Fehler');
}

// ═══ 5. LOESCHEN FRAGT NACH ════════════════════════════════════════════
{
  protokoll.ops.length = 0; protokoll.confirms.length = 0; confirmAntwort = false;
  await ruf('habit-delete', { id: 'h1' });
  ok(protokoll.confirms.length === 1,
    'DER BEFUND: der Papierkorb loescht ohne Rueckfrage — er liegt einen Daumen neben dem Kartenrumpf');
  ok((protokoll.confirms[0] || {}).danger === true, 'die Rueckfrage ist nicht als gefaehrlich gekennzeichnet');
  ok(/Morgenroutine/.test((protokoll.confirms[0] || {}).previewHtml || ''), 'die Rueckfrage nennt die Routine nicht');
  ok(protokoll.ops.length === 0, 'trotz Abbruch wurde geloescht');
}
{
  protokoll.ops.length = 0; protokoll.closed = 0; confirmAntwort = true;
  await ruf('habit-delete', { id: 'h1', sheet: '1' });
  ok(protokoll.ops.length === 1 && protokoll.ops[0].type === 'delete-habit', 'nach Ja wurde nicht geloescht');
  ok(protokoll.closed === 1, 'das Sheet blieb nach dem Loeschen offen');
}

// ═══ 6. ABHAKEN AUS DEM SHEET FRISCHT DAS SHEET AUF ════════════════════
{
  protokoll.ops.length = 0; protokoll.sheets.length = 0;
  await ruf('habit-toggle', { id: 'h1' });          // von der Karte
  ok(protokoll.ops.length === 1 && protokoll.ops[0].type === 'toggle-habit', 'das Abhaken lief nicht');
  ok(protokoll.sheets.length === 0, 'das Abhaken von der Karte oeffnete ein Sheet');

  protokoll.ops.length = 0; protokoll.sheets.length = 0;
  await ruf('habit-toggle', { id: 'h1', sheet: '1' }); // aus dem Sheet
  ok(protokoll.sheets.length === 1,
    'nach dem Abhaken im Sheet wurde der Inhalt nicht neu aufgebaut — Knopf, Serie und Streifen zeigten den alten Stand');
}

// ═══ 7. Der Service-Worker liefert die neue Datei aus ═══════════════════
{
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const v = /const VERSION = '([^']+)'/.exec(sw);
  ok(v && v[1] !== 'quantus-mobile-v4',
    `der Cache heisst weiterhin "${v && v[1]}" — die Telefone bekaemen die alte gewohnheiten.js`);
  ok(sw.includes('./js/views/gewohnheiten.js'), 'gewohnheiten.js steht nicht in der App-Shell');
}

// ═══ 8. Die neuen CSS-Klassen sind da ══════════════════════════════════
{
  const css = fs.readFileSync(path.join(root, 'css/components.css'), 'utf8');
  for (const k of ['.habit-strip', '.habit-strip-cell', '.habit-stats', '.habit-stat-num']) {
    ok(css.includes(k), `die Regel ${k} fehlt — das Detail bliebe unformatiert`);
  }
  ok(/\.habit-main \{[^}]*cursor: pointer/.test(css), '.habit-main zeigt nicht, dass es anklickbar ist');
  ok(/\.habit-main:focus-visible/.test(css), 'der Rumpf hat keinen sichtbaren Fokusring');
  ok(!/!important/.test(css.slice(css.indexOf('.habit-main'), css.indexOf('.habit-title'))),
    'die neuen Regeln arbeiten mit !important');
}

if (luecken.length) {
  console.error('HABITS OPEN — ' + luecken.length + ' von ' + checks + ' Pruefungen:');
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`habits open: ok (${checks} Pruefungen)`);
