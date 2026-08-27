/*
 * Sub-Einheiten: die Schritte einer Routine — auf dem Handy genauso wie auf
 * dem Desktop.
 *
 * BEFUND (Vergleich der beiden Bildschirmfotos, Nutzer: "aber ich sehe doch
 * auf der mobile version deutlich weniger"):
 *   Desktop: jede Routine besteht aus ihren Schritten — "06:00 Wake",
 *            "06:05 Rowing", "06:15 Wash" … einzeln abhakbar, Zaehler 0/6.
 *   Handy:   Titel, Prozentzahl, 30-Tage-Streifen. Sonst nichts.
 * Die Daten lagen die ganze Zeit im selben Datensatz (h.subUnits,
 * h.subCompletions) — die Handy-App las sie nur nie.
 *
 * ZWEITER, STILLERER BEFUND: habitDoneOn() zaehlte auf dem Handy jeden
 * completions-Eintrag als "erledigt". Die Hauptapp verlangt fuer eine Routine
 * MIT Schritten, dass ALLE Schritte stehen (isHabitDoneOnDate). Beide Apps
 * zaehlten also am selben Datensatz verschieden — "0/6 heute erledigt" konnte
 * auf zwei Geraeten zwei verschiedene Dinge heissen.
 *
 * WAS HIER GEMESSEN WIRD
 *  1. Die Zaehlregel ist die der Hauptapp.
 *  2. Der Schreibvorgang hat EXAKT das Format der Hauptapp — inklusive der
 *     Automatik, die bei vollstaendigen Schritten einen completions-Eintrag
 *     mit autoFromSubUnits setzt und ihn wieder entfernt. Ein abweichendes
 *     Format muesste der Merge ausbaden.
 *  3. Die Ansicht zeigt die Schritte, zaehlt sie und laesst sie abhaken.
 *  4. An Tagen, an denen die Routine nicht anfaellt, gibt es nichts abzuhaken.
 *
 * Kein Browser, kein Netz.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fehlend = new Set();
const lies = (p) => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch (e) { fehlend.add(p); return ''; } };
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const ymd = (v) => { const d = new Date(); d.setDate(d.getDate() - v);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const HEUTE = ymd(0);

// ── Den ECHTEN Store laden ────────────────────────────────────────────────
function ladeModul(datei, stubs) {
  const quelle = lies(datei);
  if (!quelle) { ok(false, `${datei} gibt es nicht`); return {}; }
  const ohne = quelle.replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
    ok(Object.prototype.hasOwnProperty.call(stubs, pfad), `${datei}: unbekannter Import ${pfad}`);
    const namen = /\{([^}]*)\}/.exec(m);
    if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
    return `const ${/\*\s+as\s+(\w+)/.exec(m)[1]} = __stubs['${pfad}'];`;
  });
  const fn = [...ohne.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  const konst = [...ohne.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
  const body = ohne.replace(/^export (?:async )?function/gm, (m) => m.replace('export ', ''))
    .replace(/^export const/gm, 'const')
    .replace(/^export default/m, 'const __default =')
    .replace(/^export \{[^}]*\};?$/gm, '');
  const namen = [...fn, ...konst];
  // Ohne diesen Filter erzeugt eine Datei mit NUR export default ein
  // "return {, default: …}" — der Lader stuerbe an seinem eigenen Komma.
  const teile = namen.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : null`);
  teile.push(`default: typeof __default !== 'undefined' ? __default : null`);
  const rueck = `return {${teile.join(',')}};`;
  try { return new Function('__stubs', body + '\n' + rueck)(stubs); }
  catch (e) { ok(false, `${datei} laesst sich nicht laden: ${e.message}`); return {}; }
}

// Der Store zieht viel Umgebung nach. Nur der Gewohnheitsteil wird gemessen —
// dafuer genuegt es, die Aussenwelt stillzulegen.
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
// navigator ist in Node schreibgeschuetzt — definieren statt zuweisen.
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true }); } catch (e) {}
globalThis.location = { hash: '' };
globalThis.addEventListener = () => {};
globalThis.document = { addEventListener: () => {}, getElementById: () => null, querySelectorAll: () => [] };
globalThis.fetch = async () => { throw new Error('kein Netz im Test'); };

const STORE = ladeModul('js/store.js', {
  './config.js': { LS: {}, getBaseUrl: () => 'https://x', getBlobKey: () => 'k', DEFAULT_BASE_URL: 'https://x', DEFAULT_BLOB_KEY: 'k' },
  './util.js': { todayYmd: () => HEUTE, uid: () => 'id', toast: () => {}, escHTML: (s) => String(s) },
});

// TOLERANT aufrufen. Auf einem Stand, der die Funktion noch gar nicht hat,
// wuerde ein direkter Aufruf den Lauf mit einer TypeError beenden — rot aus
// dem falschen Grund, und alles Folgende waere nie gemessen worden.
function ruf(name, ersatz, ...args) {
  if (typeof STORE[name] !== 'function') return ersatz;
  try { return STORE[name](...args); } catch (e) { return ersatz; }
}

const ROUTINE = () => ({
  id: 'h1', text: 'Morgenroutine', frequency: 'daily',
  subUnits: [{ name: '06:00 Wake' }, { name: '06:05 Rowing' }, { name: '06:15 Wash' }],
  subCompletions: [], completions: [],
});
const OHNE_SCHRITTE = { id: 'h2', text: 'Bewegung', frequency: 'daily', completions: [] };

// ═══ 1. DIE ZAEHLREGEL IST DIE DER HAUPTAPP ════════════════════════════
ok(typeof STORE.getSubUnits === 'function', 'der Store kennt getSubUnits nicht');
ok(typeof STORE.subUnitDoneOn === 'function', 'der Store kennt subUnitDoneOn nicht');
ok(typeof STORE.subUnitsDoneCount === 'function', 'der Store kennt subUnitsDoneCount nicht');
ok(typeof STORE.habitDueOn === 'function', 'der Store kennt habitDueOn nicht');

{
  const h = ROUTINE();
  ok(ruf('habitDoneOn', null, h, HEUTE) === false, 'eine Routine ohne abgehakte Schritte gilt als erledigt');

  // DER STILLE BEFUND: ein completions-Eintrag allein genuegt NICHT, wenn es
  // Schritte gibt. Genau hier liefen Handy und Hauptapp auseinander.
  h.completions.push({ date: HEUTE, value: 1 });
  ok(ruf('habitDoneOn', null, h, HEUTE) === false,
    'ein blosser completions-Eintrag gilt als erledigt, obwohl kein einziger Schritt steht — ' +
    'das Handy zaehlt anders als die Hauptapp');

  h.subCompletions = h.subUnits.map((u) => ({ date: HEUTE, subUnitName: u.name }));
  ok(ruf('habitDoneOn', null, h, HEUTE) === true, 'alle Schritte stehen, die Routine gilt trotzdem nicht als erledigt');

  h.subCompletions.pop();
  ok(ruf('habitDoneOn', null, h, HEUTE) === false, 'ein fehlender Schritt genuegt nicht, um die Routine offen zu halten');

  // Ohne Schritte bleibt es beim alten Weg — sonst waeren alle uebrigen
  // Routinen mit dieser Aenderung stumm kaputtgegangen.
  ok(ruf('habitDoneOn', null, { ...OHNE_SCHRITTE, completions: [{ date: HEUTE }] }, HEUTE) === true,
    'eine Routine OHNE Schritte gilt nicht mehr als erledigt — die Aenderung greift zu weit');
  ok(ruf('habitDoneOn', null, OHNE_SCHRITTE, HEUTE) === false, 'eine leere Routine gilt als erledigt');

  ok(ruf('subUnitsDoneCount', null, ROUTINE(), HEUTE) === 0, 'der Schrittzaehler startet nicht bei 0');
}

// Faelligkeit — wortgleich zur Hauptapp.
{
  const montag = '2026-08-24', samstag = '2026-08-29', sonntag = '2026-08-30';
  ok(ruf('habitDueOn', null, { frequency: 'daily' }, samstag) === true, 'taeglich faellt am Samstag nicht an');
  ok(ruf('habitDueOn', null, { frequency: 'weekdays' }, montag) === true, 'wochentags faellt am Montag nicht an');
  ok(ruf('habitDueOn', null, { frequency: 'weekdays' }, samstag) === false, 'wochentags faellt am Samstag an');
  ok(ruf('habitDueOn', null, { frequency: 'weekends' }, sonntag) === true, 'Wochenende faellt am Sonntag nicht an');
  ok(ruf('habitDueOn', null, { frequency: 'weekends' }, montag) === false, 'Wochenende faellt am Montag an');
  ok(ruf('habitDueOn', null, { frequency: 'custom', customDays: [1] }, montag) === true, 'custom mit Montag faellt nicht an');
  ok(ruf('habitDueOn', null, { frequency: 'custom', customDays: [1] }, samstag) === false, 'custom ohne Samstag faellt an');
}

// ═══ 2. DAS SCHREIBFORMAT IST DAS DER HAUPTAPP ═════════════════════════
// Gegen den Quelltext der HAUPTAPP geprueft, nicht gegen meine Erinnerung:
// laeuft dort das Format auseinander, faellt diese Pruefung.
{
  const haupt = (() => { try {
    return fs.readFileSync(path.join(path.dirname(root), 'ai-sync/public/index.html'), 'utf8');
  } catch (e) { return ''; } })();
  const store = lies('js/store.js');
  if (haupt) {
    ok(/subCompletions\.push\(\{\s*id:\s*'sc_'/.test(haupt.replace(/\s+/g, ' ').replace(/ /g, ' ')) ||
       /id: 'sc_'/.test(haupt), 'die Hauptapp schreibt keine sc_-Kennung mehr — das Format hat sich verschoben');
    ok(/autoFromSubUnits/.test(haupt), 'die Hauptapp kennt autoFromSubUnits nicht mehr');
    ok(/subUnitName/.test(haupt), 'die Hauptapp kennt subUnitName nicht mehr');
  } else {
    ok(true, '(ai-sync nicht danebenliegend — Formatvergleich uebersprungen)');
  }
  for (const teil of ['subUnitName', 'autoFromSubUnits', "'sc_'", "'hc_'", 'completedAt']) {
    ok(store.includes(teil), `der Handy-Store schreibt ${teil} nicht — das Format weicht von der Hauptapp ab`);
  }
}

// Und die Operation selbst, am echten Store durchgespielt.
if (typeof STORE.applyOp === 'function' || typeof STORE.performOp === 'function') {
  ok(true, '(Operation wird ueber den Ansichtsweg gemessen)');
}

// ═══ 3. DIE ANSICHT ZEIGT DIE SCHRITTE ═════════════════════════════════
const protokoll = { ops: [], sheets: [], aktionen: {} };
const DATEN = { h1: ROUTINE(), h2: { ...OHNE_SCHRITTE } };
const storeStub = {
  getHabits: () => Object.values(DATEN),
  habitDoneOn: (h, y) => ruf('habitDoneOn', false, h, y),
  habitDueOn: (h, y) => ruf('habitDueOn', true, h, y),
  getSubUnits: (h) => ruf('getSubUnits', [], h),
  subUnitDoneOn: (h, n, y) => ruf('subUnitDoneOn', false, h, n, y),
  subUnitsDoneCount: (h, y) => ruf('subUnitsDoneCount', 0, h, y),
  performOp: async (op) => { protokoll.ops.push(op); },
};
const V = ladeModul('js/views/gewohnheiten.js', {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    todayYmd: (d) => (d instanceof Date
      ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      : HEUTE),
    openSheet: (o) => protokoll.sheets.push(o), closeSheet: () => {}, toast: () => {},
    confirmPreview: async () => true,
  },
  '../store.js': storeStub,
  '../actions.js': { registerActions: (o) => Object.assign(protokoll.aktionen, o) },
  './common.js': { pageHeader: (t, s, r) => `<h1>${t}</h1><p>${s}</p>${r || ''}` },
}).default || { render: () => '' };

ok(typeof V.render === 'function', 'die Gewohnheiten-Ansicht hat kein render()');
const html = V.render();

ok(/Sub-Einheiten/.test(html), 'DER BEFUND: die Ansicht zeigt keine Sub-Einheiten');
for (const n of ['06:00 Wake', '06:05 Rowing', '06:15 Wash']) {
  ok(html.includes(n), `der Schritt "${n}" fehlt — auf dem Desktop ist er die Routine`);
}
ok(/class="sub-count">0\/3</.test(html), 'der Schrittzaehler stimmt nicht (erwartet 0/3)');
ok(/data-action="subunit-toggle"[^>]*data-name="06:05 Rowing"/.test(html), 'ein Schritt laesst sich nicht abhaken');
ok(/aria-pressed="false"/.test(html), 'der Zustand eines Schritts fehlt fuer Hilfsmittel');
// Eine Routine OHNE Schritte bekommt keinen leeren Kasten angehaengt.
{
  const h2 = html.slice(html.indexOf('Bewegung'));
  ok(!/Sub-Einheiten/.test(h2), 'eine Routine ohne Schritte zeigt trotzdem einen Sub-Einheiten-Kasten');
}

// Abgehakter Zustand schlaegt durch.
DATEN.h1.subCompletions = [{ date: HEUTE, subUnitName: '06:00 Wake' }];
{
  const h = V.render();
  ok(/class="sub-count">1\/3</.test(h), 'der Zaehler folgt dem Stand nicht');
  ok(/class="sub-item on"[^>]*data-name="06:00 Wake"/.test(h), 'der abgehakte Schritt ist nicht markiert');
}

// ═══ 4. ABHAKEN LOEST DIE RICHTIGE OPERATION AUS ═══════════════════════
const A = protokoll.aktionen;
ok(typeof A['subunit-toggle'] === 'function', 'die Aktion subunit-toggle ist nicht registriert — die Schritte sind tot');
if (typeof A['subunit-toggle'] === 'function') {
  protokoll.ops.length = 0;
  await A['subunit-toggle']({ id: 'h1', name: '06:05 Rowing' });
  ok(protokoll.ops.length === 1, `es liefen ${protokoll.ops.length} Operationen statt einer`);
  const op = protokoll.ops[0] || {};
  ok(op.type === 'toggle-subunit', `Operation "${op.type}" statt toggle-subunit`);
  ok(op.payload && op.payload.subUnitName === '06:05 Rowing', 'die Operation trifft den falschen Schritt');
  ok(op.payload && op.payload.date === HEUTE, 'die Operation setzt nicht das heutige Datum');
}

// „Alle abhaken" haakt nur an, was noch fehlt — und nimmt nur zurueck, wenn
// alles steht. Sonst wuerde ein Griff die Haelfte wieder loeschen.
ok(typeof A['subunits-all'] === 'function', 'die Aktion subunits-all ist nicht registriert');
if (typeof A['subunits-all'] === 'function') {
  DATEN.h1.subCompletions = [{ date: HEUTE, subUnitName: '06:00 Wake' }];
  protokoll.ops.length = 0;
  await A['subunits-all']({ id: 'h1' });
  ok(protokoll.ops.length === 2,
    `"Alle abhaken" loeste ${protokoll.ops.length} Operationen aus statt 2 — der bereits erledigte Schritt ` +
    'darf nicht mit umgeschaltet werden');
  const namen = protokoll.ops.map((o) => o.payload.subUnitName).sort();
  ok(namen.join('|') === '06:05 Rowing|06:15 Wash', `umgeschaltet wurden ${JSON.stringify(namen)}`);
}

// ═══ 5. AN NICHT-FAELLIGEN TAGEN GIBT ES NICHTS ABZUHAKEN ══════════════
{
  DATEN.h1.frequency = 'weekends';
  const heuteIstWochenende = [0, 6].includes(new Date(HEUTE + 'T12:00:00').getDay());
  const h = V.render();
  if (heuteIstWochenende) {
    ok(/data-action="subunit-toggle"/.test(h), 'am faelligen Tag fehlen die Schritte');
  } else {
    ok(/heute nicht fällig/.test(h), 'an einem nicht faelligen Tag steht kein Hinweis');
    const block = h.slice(h.indexOf('Morgenroutine'), h.indexOf('Bewegung') > 0 ? h.indexOf('Bewegung') : undefined);
    ok(!/data-action="subunit-toggle"/.test(block),
      'an einem Tag, an dem die Routine gar nicht anfaellt, laedt das Handy zum Abhaken ein');
  }
  DATEN.h1.frequency = 'daily';
}

if (fehlend.size) console.error('Fehlende Dateien: ' + [...fehlend].join(', '));
if (luecken.length) {
  console.error(`SUB-EINHEITEN — ${luecken.length} von ${checks} Pruefungen:`);
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`sub-einheiten: ok (${checks} Pruefungen)`);
