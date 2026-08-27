/*
 * Das Daily Briefing ist auf dem Handy vollstaendig — und liest DIESELBEN
 * Felder wie das Tablet.
 *
 * BEFUND (Nutzer: "tablet und mobile: das daily briefing soll vollumfaenglich
 * darin enthalten sein"): die Handy-Ansicht zeigte fuenf von siebzehn
 * Abschnitten — Termine, faellige und ueberfaellige Aufgaben, Routinen,
 * Leitsaetze. Tagesziele, Wochenziele, Massnahmen, Nachrichten, Gedanken,
 * Leseliste, Tagesplanung, pendente Aufgaben, generelle Ziele, Notizen,
 * Projekte, Programme, Reflexionsfragen und die vergangenen Tage fehlten
 * ganz, obwohl alle im selben Datensatz liegen.
 *
 * DER WICHTIGSTE TEIL DIESES WAECHTERS ist Abschnitt 4: Handy und Tablet
 * lesen dieselben Felder. Zwei Nachbauten, die auseinanderlaufen, sind
 * schlimmer als einer — dann zeigt jedes Geraet einen anderen Tag.
 *
 * Kein Browser, kein Netz.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lies = (p, basis = root) => { try { return fs.readFileSync(path.join(basis, p), 'utf8'); } catch (e) { return ''; } };
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const HEUTE = (() => { const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

// ── Den echten Store laden ────────────────────────────────────────────────
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
    .replace(/^export const/gm, 'const').replace(/^export default/m, 'const __default =')
    .replace(/^export \{[^}]*\};?$/gm, '');
  const teile = [...fn, ...konst].map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : null`);
  teile.push(`default: typeof __default !== 'undefined' ? __default : null`);
  try { return new Function('__stubs', body + `\nreturn {${teile.join(',')}};`)(stubs); }
  catch (e) { ok(false, `${datei} laesst sich nicht laden: ${e.message}`); return {}; }
}

globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true }); } catch (e) {}
globalThis.location = { hash: '#/briefing' };
globalThis.addEventListener = () => {};
globalThis.document = { addEventListener: () => {}, getElementById: () => null, querySelectorAll: () => [] };
globalThis.fetch = async () => { throw new Error('kein Netz im Test'); };

const STORE = ladeModul('js/store.js', {
  './config.js': { LS: {}, getBaseUrl: () => 'https://x', getBlobKey: () => 'k', DEFAULT_BASE_URL: 'https://x', DEFAULT_BLOB_KEY: 'k' },
  './util.js': { todayYmd: () => HEUTE, uid: () => 'id', toast: () => {}, escHTML: (s) => String(s) },
});
const ruf = (name, ersatz, ...args) => {
  if (typeof STORE[name] !== 'function') return ersatz;
  try { return STORE[name](...args); } catch (e) { return ersatz; }
};

// ═══ 1. DAS MODELL SAMMELT ALLE ABSCHNITTE ═════════════════════════════
ok(typeof STORE.briefingFuerTag === 'function',
  'DER BEFUND: der Store hat kein briefingFuerTag — die Abschnitte haetten keine gemeinsame Quelle');

const SCHLUESSEL = ['tagesziele', 'wochenziele', 'routinen', 'beliefs', 'massnahmen', 'nachrichten',
  'gedanken', 'leseliste', 'zeitbloecke', 'meetings', 'faellig', 'ueberfaellig', 'pendent',
  'ziele', 'notizen', 'projekte', 'programme', 'reflexionsfragen', 'vergangeneTage'];

if (STORE.state) {
  // Ein Datensatz, in dem JEDER Abschnitt etwas zu zeigen haette. Bleibt einer
  // leer, fehlt der Zweig — genau das war der Befund.
  const gestern = (() => { const d = new Date(); d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  STORE.state.data = {
    entities: {
      tasks: {
        t1: { id: 't1', title: 'Heute fällig', status: 'open', dueDate: HEUTE },
        t2: { id: 't2', title: 'Längst fällig', status: 'open', dueDate: gestern },
        t3: { id: 't3', title: 'Ohne Datum', status: 'open' },
        t4: { id: 't4', title: 'Mit Massnahme', status: 'open', measures: [{ id: 'm1', text: 'Sofort anrufen', status: 'active' }] },
      },
      meetings: { mt1: { id: 'mt1', title: 'Standup', date: HEUTE, startTime: '09:00' } },
      goals: { g1: { id: 'g1', title: 'Sichtbares Ziel' }, g2: { id: 'g2', title: 'Verstecktes Ziel' } },
      projects: { p1: { id: 'p1', title: 'Briefing-Projekt',
        reflectionQuestions: [{ id: 'q1', text: 'Was lief gut?', answers: [{ date: HEUTE, text: 'viel' }] }] } },
      programs: { pr1: { id: 'pr1', title: 'Briefing-Programm' } },
      scheduledMessages: { s1: { id: 's1', title: 'Post', content: 'Hallo', isDelivered: true, deliveredAt: HEUTE + 'T08:30:00' } },
    },
    dailyGoals: { [HEUTE]: [{ id: 'dg1', title: 'Tagesziel', completed: false }] },
    weeklyGoals: [{ id: 'wg1', title: 'Wochenziel', current: 2, target: 5 }],
    readingList: [{ id: 'r1', title: 'Ein Buch' }],
    journal: { topics: [{ id: 'tp1', text: 'Ein Gedanke', createdAt: HEUTE }] },
    dailyBriefing: {
      routines: [{ id: 'h1', text: 'Morgenroutine', frequency: 'daily', completions: [], subCompletions: [] }],
      beliefs: [{ id: 'b1', text: 'Ruhig bleiben' }],
      hiddenGoals: ['g2'],
      selectedProjects: ['p1'],
      selectedPrograms: ['pr1'],
      timeBlocks: { [HEUTE]: [{ id: 'tb1', startTime: '08:00', endTime: '09:00', title: 'Fokusblock' }] },
      dailyLog: { [HEUTE]: { notes: 'Notiz von heute' }, [gestern]: { notes: 'gestern' } },
    },
  };

  const b = ruf('briefingFuerTag', {}, HEUTE);
  SCHLUESSEL.forEach((k) => ok(Object.prototype.hasOwnProperty.call(b, k), `dem Modell fehlt der Abschnitt ${k}`));

  const nichtLeer = (k, wert) => ok(wert, `der Abschnitt ${k} bleibt leer, obwohl Daten dafuer da sind`);
  nichtLeer('tagesziele', (b.tagesziele || []).length === 1);
  nichtLeer('wochenziele', (b.wochenziele || []).length === 1);
  nichtLeer('routinen', (b.routinen || []).length === 1);
  nichtLeer('beliefs', (b.beliefs || []).length === 1);
  nichtLeer('massnahmen', (b.massnahmen || []).length === 1);
  nichtLeer('nachrichten', (b.nachrichten || []).length === 1);
  nichtLeer('gedanken', (b.gedanken || []).length === 1);
  nichtLeer('leseliste', (b.leseliste || []).length === 1);
  nichtLeer('zeitbloecke', (b.zeitbloecke || []).length === 1);
  nichtLeer('meetings', (b.meetings || []).length === 1);
  nichtLeer('faellig', (b.faellig || []).length === 1);
  nichtLeer('ueberfaellig', (b.ueberfaellig || []).length === 1);
  nichtLeer('pendent', (b.pendent || []).length >= 1);
  nichtLeer('projekte', (b.projekte || []).length === 1);
  nichtLeer('programme', (b.programme || []).length === 1);
  nichtLeer('reflexionsfragen', (b.reflexionsfragen || []).length === 1);
  nichtLeer('vergangeneTage', (b.vergangeneTage || []).length === 1);
  ok(b.notizen === 'Notiz von heute', `die Tagesnotiz kommt nicht an: ${JSON.stringify(b.notizen)}`);

  // Die Filter greifen wirklich — sonst zeigte der Abschnitt einfach alles.
  ok((b.ziele || []).length === 1 && b.ziele[0].id === 'g1',
    'hiddenGoals wird nicht beachtet — versteckte Ziele stehen wieder im Briefing');
  ok((b.projekte || [])[0] && b.projekte[0].id === 'p1', 'selectedProjects wird nicht beachtet');
  ok((b.faellig || []).every(t => String(t.dueDate).slice(0, 10) === HEUTE), 'faellig enthaelt fremde Tage');
  ok((b.pendent || []).every(t => !t.dueDate), 'pendent enthaelt Aufgaben MIT Datum');
  ok((b.reflexionsfragen || [])[0] && b.reflexionsfragen[0].heuteBeantwortet === true,
    'eine heute beantwortete Reflexionsfrage wird nicht als beantwortet erkannt');
  ok((b.vergangeneTage || []).every(t => t < HEUTE), 'unter "Vergangene Tage" steht der heutige oder ein spaeterer');

  // Ein anderer Tag liefert einen anderen Stand — sonst waere die
  // Tagesnavigation Zierde.
  const bg = ruf('briefingFuerTag', {}, gestern);
  ok(bg.notizen === 'gestern', 'das Modell liefert fuer einen anderen Tag denselben Stand');
  ok((bg.zeitbloecke || []).length === 0, 'die Zeitblöcke von heute erscheinen auch an anderen Tagen');
}

// ═══ 2. DIE ANSICHT ZEIGT SIE ══════════════════════════════════════════
const TITEL = ['Tagesziele', 'Wochenziele', 'Tagesplanung', 'Meetings', 'Fällig',
  'Pendente Aufgaben', 'Aktive Massnahmen', 'Routinen', 'Glaubenssätze', 'Nachrichten',
  'Gedanken & Fragen', 'Tägliche Notizen', 'Leseliste', 'Generelle Ziele', 'Projekte',
  'Programme', 'Reflexionsfragen', 'Vergangene Tage'];
const ANSICHT = lies('js/views/briefing.js');
TITEL.forEach((t) => ok(ANSICHT.includes(t), `DER BEFUND: der Abschnitt "${t}" fehlt in der Handy-Ansicht`));
ok(/data-action="bf-day"/.test(ANSICHT), 'es gibt keine Tagesnavigation');
for (const a of ['bf-add-goal', 'bf-toggle-goal', 'bf-add-thought', 'bf-save-note']) {
  ok(ANSICHT.includes(a), `die Aktion ${a} fehlt — der Abschnitt waere nur Anzeige`);
}

// ═══ 3. DIE SCHREIBENDEN TEILE LANDEN, WO DIE HAUPTAPP LIEST ═══════════
const S = lies('js/store.js');
ok(/'briefing-note'/.test(S), 'die Operation briefing-note fehlt');
ok(/'toggle-daygoal'/.test(S), 'die Operation toggle-daygoal fehlt');
ok(/'add-thought'/.test(S), 'die Operation add-thought fehlt');
ok(/dailyLog\[tag\]\.notes/.test(S), 'die Notiz landet nicht in dailyBriefing.dailyLog[<tag>].notes');
ok(/state\.data\.dailyGoals\[tag\]/.test(S), 'das Tagesziel landet nicht in dailyGoals[<tag>]');
ok(/state\.data\.journal\.topics/.test(S), 'der Gedanke landet nicht in journal.topics');

// ═══ 4. HANDY UND TABLET LESEN DIESELBEN FELDER ════════════════════════
// Zwei Nachbauten, die auseinanderlaufen, sind schlimmer als einer: dann
// zeigt jedes Geraet einen anderen Tag, und niemand weiss, welcher stimmt.
{
  const tabletWurzel = path.join(path.dirname(root), 'quantus-tablet-version');
  const tablet = lies('public/app.js', tabletWurzel);
  if (!tablet) {
    ok(true, '(quantus-tablet-version nicht danebenliegend — Abgleich uebersprungen)');
  } else {
    const modellTablet = (() => {
      const a = tablet.indexOf('function briefingModell(');
      if (a < 0) return '';
      const e = tablet.indexOf('\n  function ', a + 10);
      return tablet.slice(a, e > a ? e : undefined);
    })();
    ok(modellTablet.length > 0, 'das Tablet hat kein briefingModell');
    const modellHandy = (() => {
      const a = S.indexOf('export function briefingFuerTag(');
      if (a < 0) return '';
      const e = S.indexOf('\nexport ', a + 10);
      return S.slice(a, e > a ? e : undefined);
    })();
    ok(modellHandy.length > 0, 'das Handy hat kein briefingFuerTag');

    // Dieselben Abschnittsschluessel …
    // Kurzschreibweise zaehlt mit: `reflexionsfragen,` ist derselbe Schluessel
    // wie `reflexionsfragen: reflexionsfragen`. Eine Regel, die daran
    // scheitert, misst die Schreibweise statt der Sache.
    const schluesselVon = (txt) => SCHLUESSEL.filter((k) => new RegExp('\\b' + k + '\\s*[:,]').test(txt));
    const aH = schluesselVon(modellHandy), aT = schluesselVon(modellTablet);
    SCHLUESSEL.forEach((k) => {
      const h = aH.includes(k), t = aT.includes(k);
      ok(h === t, `der Abschnitt ${k} gibt es nur ${h ? 'auf dem Handy' : 'auf dem Tablet'} — die beiden laufen auseinander`);
    });

    // … und dieselben Quellfelder.
    ['dailyGoals', 'weeklyGoals', 'beliefs', 'measures', 'scheduledMessages',
     'readingList', 'timeBlocks', 'dailyLog', 'hiddenGoals', 'selectedProjects',
     'selectedPrograms', 'reflectionQuestions'].forEach((f) => {
      const h = modellHandy.includes(f), t = modellTablet.includes(f);
      ok(h === t, `${f} wird nur ${h ? 'auf dem Handy' : 'auf dem Tablet'} gelesen`);
    });
  }
}

if (luecken.length) {
  console.error(`BRIEFING VOLLSTAENDIG (Handy) — ${luecken.length} von ${checks} Pruefungen:`);
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`briefing vollstaendig (Handy): ok (${checks} Pruefungen)`);
