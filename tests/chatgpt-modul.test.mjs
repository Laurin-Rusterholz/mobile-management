/*
 * ChatGPT auf dem Handy — erfassen ja, bearbeiten nein, Aufgaben nur mit Anker.
 *
 * Der Auftrag (Portierung aus ai-sync, "so einfach wie moeglich, Apple-Notes-
 * Prinzip") verlangt fuer das Handy genau das:
 *   · Notes: nur die Schnellerfassung (einzeiliges Feld, Kategorie feedback,
 *     heutiges Datum) und die Liste.
 *   · Leads: anlegen ja (Titel + Text), bearbeiten nein. Leads fallen
 *     unterwegs ein — erfassen muss ueberall gehen.
 *   · ChatGPT-Aufgaben: anlegen am Element (einzeiliges Feld), keine
 *     Sammelliste. Ohne Anker darf nichts entstehen — der Rechner koennte den
 *     Auftrag nirgends zeigen.
 *
 * Was hier schiefgehen kann: eine Erfassung, die in eine andere Sammlung
 * schreibt als AI Sync (der Rechner saehe sie nie), ein Lead mit falschem
 * Startzustand (readAt gesetzt, Berechtigungen "erteilt"), eine Aufgabe ohne
 * Anker, und Verdrahtung, die fehlt (Ansicht nicht registriert, Kachel nicht
 * da, Service Worker kennt die Datei nicht). Die Ansicht laeuft ECHT gegen
 * einen Store-Stub; kein Browser, kein Netz.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const HEUTE = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const protokoll = { ops: [], toasts: [], notified: 0 };
const felder = {};
globalThis.document = {
  addEventListener() {},
  getElementById: (id) => felder[id] || null,
  createElement: () => ({ set innerHTML(v) { this._html = v; }, firstElementChild: null }),
};

const ENT = {
  chatgptNotes: {
    alt: { id: 'alt', createdAt: '2026-08-20T10:00:00.000Z', category: 'auftrag', instruction: 'Alte Anweisung', derived: 'Alt', state: 'ueberholt' },
    neu: { id: 'neu', createdAt: '2026-09-01T09:00:00.000Z', category: 'feedback', instruction: 'Neue Anweisung', derived: '', state: 'aktiv' },
  },
  chatgptLeads: {
    l1: { id: 'l1', createdAt: '2026-09-01T08:00:00.000Z', title: 'Firma X erfassen', rawInput: 'Bitte anlegen.', status: 'neu', readAt: null, assignee: 'cowork' },
  },
  chatgptTasks: {
    t1: { id: 't1', createdAt: '2026-09-01T08:00:00.000Z', text: 'Adresse nachtragen', state: 'offen', anchorKind: 'organization', anchorId: 'o1' },
  },
  organizations: { o1: { id: 'o1', name: 'Firma X AG' } },
  tasks: { a1: { id: 'a1', title: 'Offerte prüfen' } },
};
const KIND = { organization: 'organizations', task: 'tasks', chatgptNote: 'chatgptNotes', chatgptLead: 'chatgptLeads', chatgptTask: 'chatgptTasks' };
const AKTIONEN = {};
const stubs = {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    formatDate: (v) => String(v || '').slice(0, 10),
    newId: (k) => k + '_neu',
    nowISO: () => '2026-09-01T12:00:00.000Z',
    todayYmd: () => HEUTE,
    toast: (t, k) => protokoll.toasts.push(k + ':' + t),
  },
  '../store.js': {
    state: { data: { chatgptNotesMeta: { lastSessionReadAt: '2026-08-28T18:00:00.000Z' } } },
    getCollection: (name) => Object.values(ENT[name] || {}),
    getById: (kind, id) => (ENT[KIND[kind] || kind] || {})[id] || null,
    performOp: async (op) => { protokoll.ops.push(op); },
    notify: () => { protokoll.notified++; },
  },
  '../actions.js': { registerActions: (o) => Object.assign(AKTIONEN, o) },
  './common.js': {
    pageHeader: (t, s) => `<h1>${t}</h1><p>${s}</p>`,
    segmented: (items, active, action) => items.map((i) => `<button data-action="${action}" data-seg="${i.key}" class="${i.key === active ? 'active' : ''}">${i.label}${i.count != null ? ' ' + i.count : ''}</button>`).join(''),
  },
};
const quelle = fs.readFileSync(path.join(root, 'js/views/chatgpt.js'), 'utf8');
const exporte = {};
const ohneImporte = quelle
  .replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
    ok(Object.prototype.hasOwnProperty.call(stubs, pfad), `unbekannter Import: ${pfad}`);
    const namen = /\{([^}]*)\}/.exec(m);
    if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
    const stern = /\*\s+as\s+(\w+)/.exec(m);
    return `const ${stern[1]} = __stubs['${pfad}'];`;
  })
  .replace(/^export (async )?function (\w+)/gm, (m, a, name) => `${a || ''}function ${name}`)
  .replace(/^export default/m, '__exporte.default =');
// Die benannten Exporte nach dem Lauf einsammeln.
const namen = [...quelle.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
new Function('__stubs', '__exporte', ohneImporte + '\n' + namen.map((n) => `__exporte.${n} = ${n};`).join('\n'))(stubs, exporte);
const modul = exporte.default;
ok(modul && typeof modul.render === 'function', 'die Ansicht hat kein render()');

// ═══ 1. NOTES: SCHNELLERFASSUNG + LISTE ════════════════════════════════════
{
  const html = modul.render();
  ok(/id="cgNoteInput"/.test(html) && /data-action="cg-note-add"/.test(html), 'die Schnellerfassung fehlt');
  ok(/Neue Anweisung/.test(html) && /Alte Anweisung/.test(html), 'die Liste zeigt nicht alle Eintraege');
  ok(/1 neu seit 2026-08-28/.test(html), 'der Zaehler "neu seit" stimmt nicht');
  ok(/🧠 Notes 1/.test(html), 'der Reiter Notes traegt nicht den Zaehler der neuen Eintraege');
  ok(!/data-action="cg-note-(supersede|correct|edit|delete)"|cgn-supersede/.test(html), 'das Handy bietet Abloesen an — nicht vorgesehen');
  const n = protokoll.ops.length;
  const leer = await exporte.addChatgptNote('   ');
  ok(leer === null && protokoll.ops.length === n, 'eine leere Notiz wurde angelegt');
  const id = await exporte.addChatgptNote('Immer zuerst im Mail Hub nachsehen');
  ok(id && protokoll.ops.length === n + 1, 'die Schnellerfassung schreibt keine Operation');
  const op = protokoll.ops[protokoll.ops.length - 1];
  ok(op.type === 'add-chatgptNote', `die Notiz geht nicht nach chatgptNotes: ${op.type}`);
  ok(op.payload.category === 'feedback' && op.payload.instructionDate === HEUTE && op.payload.state === 'aktiv' && op.payload.derived === '',
    `die Schnellerfassung setzt Kategorie/Datum/Status falsch: ${JSON.stringify(op.payload)}`);
  ok(op.payload.instruction === 'Immer zuerst im Mail Hub nachsehen', 'der Wortlaut kommt nicht unveraendert an');
  felder.cgNoteInput = { value: 'Per Knopf erfasst' };
  await AKTIONEN['cg-note-add']({});
  ok(protokoll.ops[protokoll.ops.length - 1].payload.instruction === 'Per Knopf erfasst' && felder.cgNoteInput.value === '', 'der Knopf ＋ Notiz erfasst nicht oder leert das Feld nicht');
}

// ═══ 2. LEADS: ANLEGEN JA, BEARBEITEN NEIN ═════════════════════════════════
{
  AKTIONEN['cg-seg']({ seg: 'leads' });
  const html = modul.render();
  ok(/id="cgLeadTitle"/.test(html) && /id="cgLeadText"/.test(html) && /data-action="cg-lead-add"/.test(html), 'das Lead-Formular (Titel + Text) fehlt');
  ok(/Firma X erfassen/.test(html) && /cg-dot/.test(html), 'der ungelesene Lead fehlt oder ist nicht als ungelesen markiert');
  ok(/📥 Leads 1/.test(html), 'der Reiter Leads traegt nicht den Zaehler ungelesener Leads');
  ok(!/data-field=|cgl-close|abschliessen|Interpretation/i.test(html), 'das Handy bietet Bearbeiten oder Abschliessen eines Leads an');
  const n = protokoll.ops.length;
  ok((await exporte.addChatgptLead('', '')) === null && protokoll.ops.length === n, 'ein leerer Lead wurde angelegt');
  const id = await exporte.addChatgptLead('', 'Nur der Wortlaut\nzweite Zeile');
  ok(id && protokoll.ops.length === n + 1, 'der Lead wurde nicht angelegt');
  const op = protokoll.ops[protokoll.ops.length - 1];
  ok(op.type === 'add-chatgptLead', `der Lead geht nicht nach chatgptLeads: ${op.type}`);
  ok(op.payload.title === 'Nur der Wortlaut', 'ohne Titel wird nicht die erste Zeile als Titel genommen');
  ok(op.payload.status === 'neu' && op.payload.readAt === null && op.payload.assignee === null, `der Lead startet nicht als neu/ungelesen/unzugewiesen: ${JSON.stringify(op.payload)}`);
  const p = op.payload.grantedPermissions;
  ok(p && p.websuche === false && p.dateienErstellen.erlaubt === false && p.dateienErstellen.formate.length === 0 && p.externeTools.length === 0 && p.verboten.length === 0,
    'bei einem neuen Lead stehen nicht alle Berechtigungen auf "nicht erteilt"');
  ok(op.payload.assessment && Object.values(op.payload.assessment).every((v) => v === null) && Object.keys(op.payload.assessment).length === 6,
    'das Bewertungsraster startet nicht leer mit sechs Kriterien');
  ok(['interpretation', 'research', 'plan', 'execution', 'result'].every((f) => op.payload[f] === ''), 'die Schritte starten nicht leer');
}

// ═══ 3. CHATGPT-AUFGABEN: NUR MIT ANKER, MARKER AM ELEMENT ═════════════════
{
  const block = exporte.chatgptTaskBlock('organization', 'o1', 'Firma X AG');
  ok(/🪶 1/.test(block), 'der Marker am Element fehlt oder zaehlt falsch');
  ok(/Adresse nachtragen/.test(block), 'die bestehende Aufgabe fehlt im Block');
  ok(/data-cg-task-input[^>]*data-kind="organization"[^>]*data-id="o1"/.test(block) && /data-action="cg-task-add"/.test(block), 'das einzeilige Feld am Element fehlt');
  ok(exporte.chatgptTaskBlock(null, null, '') === '', 'ohne Anker wird ein Block gezeichnet');
  const n = protokoll.ops.length;
  ok((await exporte.addChatgptTask(null, null, 'Kunden erfassen')) === null && protokoll.ops.length === n, 'eine Aufgabe ohne Anker wurde angelegt');
  ok((await exporte.addChatgptTask('organization', 'gibt-es-nicht', 'Kunden erfassen')) === null && protokoll.ops.length === n, 'eine Aufgabe mit unaufloesbarem Anker wurde angelegt');
  ok((await exporte.addChatgptTask('organization', 'o1', '  ')) === null && protokoll.ops.length === n, 'eine leere Aufgabe wurde angelegt');
  const id = await exporte.addChatgptTask('organization', 'o1', 'Kunden erfassen');
  ok(id && protokoll.ops.length === n + 1, 'eine gueltige Aufgabe wurde nicht angelegt');
  const op = protokoll.ops[protokoll.ops.length - 1];
  ok(op.type === 'add-chatgptTask' && op.payload.anchorKind === 'organization' && op.payload.anchorId === 'o1' && op.payload.state === 'offen' && op.payload.anchorLabel === 'Firma X AG',
    `die Aufgabe traegt Anker/Status nicht korrekt: ${JSON.stringify(op.payload)}`);
  ok(!/task-card|toggle-task/.test(block), 'ChatGPT-Aufgaben werden wie Laurins Aufgaben gezeichnet');
}

// ═══ 4. VERDRAHTUNG ════════════════════════════════════════════════════════
{
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const store = read('js/store.js');
  const kindMap = store.slice(store.indexOf('const KIND_MAP'), store.indexOf('};', store.indexOf('const KIND_MAP')));
  ok(/chatgptNote: 'chatgptNotes'/.test(kindMap) && /chatgptLead: 'chatgptLeads'/.test(kindMap) && /chatgptTask: 'chatgptTasks'/.test(kindMap),
    'KIND_MAP kennt die drei Sammlungen nicht — add-chatgptNote/-Lead/-Task liefen ins Leere');
  ok(/import chatgpt from '\.\/views\/chatgpt\.js'/.test(read('js/main.js')) && /\bchatgpt,/.test(read('js/main.js')), 'main.js registriert die Ansicht nicht');
  const config = read('js/config.js');
  ok(/key: 'chatgpt',\s*label: 'ChatGPT'/.test(config), 'MORE_MODULES kennt ChatGPT nicht');
  ok(/route: 'chatgpt',\s*tone:/.test(config), 'der Homebildschirm hat keine ChatGPT-Kachel');
  ok(/chatgptTaskBlock\(cfg\.kind, v\.id, titleOf\(v\)\)/.test(read('js/views/collection.js')), 'die Sammlungen (Organisationen, Personen, …) haben kein Feld fuer ChatGPT-Aufgaben');
  ok(/chatgptTaskBlock\('task', t\.id, t\.title\)/.test(read('js/views/planen.js')) && /chatgptTaskBlock\('project', p\.id, p\.title\)/.test(read('js/views/planen.js')),
    'Aufgabe und Projekt haben kein Feld fuer ChatGPT-Aufgaben');
  ok(/'\.\/js\/views\/chatgpt\.js'/.test(read('sw.js')), 'der Service Worker kennt die Ansicht nicht');
  ok(/chatgptNote/.test(read('js/search.js')), 'die Suche findet ChatGPT Notes nicht');
}

if (luecken.length) {
  console.error(`CHATGPT (Handy) — ${luecken.length} von ${checks} Pruefungen:\n   - ${luecken.join('\n   - ')}`);
  process.exit(1);
}
console.log(`chatgpt (Handy): ok (${checks} Pruefungen)`);
