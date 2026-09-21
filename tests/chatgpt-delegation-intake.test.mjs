/*
 * Tagesbriefing-Gesamtkonzept-v2 (Master-PDF, 28 Seiten): der App-Besitzer hat
 * die fruehere Capture-only-Beschraenkung fuer Delegation und Intake auf
 * Tablet/Mobile ausdruecklich AUFGEHOBEN (siehe Kopfkommentar
 * js/views/chatgpt.js). Dieser Test prueft die beiden neu erlaubten,
 * schreibenden Aktionen ECHT — er ruft die exportierten Funktionen gegen
 * einen Store-Stub auf, der Operationen wie applyOp() tatsaechlich auf die
 * Fixture-Entitaeten anwendet (kein reines Aufzeichnen von Op-Zahlen), damit
 * sich am Datensatz selbst nachweisen laesst:
 *   · Delegieren/Zurueckholen/erneut Delegieren erzeugt fuer denselben Task
 *     NIEMALS einen zweiten chatgptLead — derselbe Lead wird reaktiviert
 *     (Spiegel von ai-sync/public/index.html, case "task-delegate-chatgpt").
 *   · Die Intake-Kurzform schreibt ueber denselben Weg wie die bestehende
 *     Leads-Erfassung (addChatgptLead) — keine zweite Erzeugungslogik, kein
 *     direkter fetch.
 * Was hier schiefgehen kann: ein Delegieren, das den Lead dupliziert statt
 * ihn wiederzuverwenden; ein Zurueckholen, das den Lead loescht statt ihn
 * hinfaellig zu schliessen; eine gemergte Operation statt je einer fuer
 * Task und Lead; eine Intake-Aktion, die eine eigene, abweichende
 * Lead-Struktur erzeugt.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const protokoll = { ops: [], toasts: [], notified: 0 };
const felder = {};
globalThis.document = {
  addEventListener() {},
  getElementById: (id) => felder[id] || null,
  createElement: () => ({ set innerHTML(v) { this._html = v; }, firstElementChild: null }),
};

// ── Fixture-Entitaeten + ein Store-Stub, der Operationen ECHT anwendet ──────
// (anders als tests/chatgpt-modul.test.mjs, das performOp nur aufzeichnet:
// hier muss sich "nur ein Lead pro Task" am Datensatz nachweisen lassen.)
const ENT = {
  tasks: {
    t1: { id: 't1', title: 'Angebot einholen', assignee: 'user' },
    t2: { id: 't2', title: 'Cowork-Aufgabe', assignee: 'cowork' },
  },
  chatgptLeads: {},
  chatgptNotes: {},
  chatgptTasks: {},
};
const KIND = { task: 'tasks', chatgptLead: 'chatgptLeads', chatgptNote: 'chatgptNotes', chatgptTask: 'chatgptTasks' };
function applyFakeOp(op) {
  const [verb, ...rest] = String(op.type || '').split('-');
  const kind = rest.join('-');
  const collName = KIND[kind];
  if (!collName) return;
  if (!ENT[collName]) ENT[collName] = {};
  const coll = ENT[collName];
  if (verb === 'add') coll[op.payload.id] = { ...op.payload };
  else if (verb === 'update') {
    const cur = coll[op.payload.id];
    if (cur) Object.assign(cur, op.payload);
    else coll[op.payload.id] = { ...op.payload };
  }
}
const stubs = {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    formatDate: (v) => String(v || '').slice(0, 10),
    newId: (k) => k + '_' + (Object.keys(ENT.chatgptLeads).length + Object.keys(ENT.chatgptNotes).length + Object.keys(ENT.chatgptTasks).length + 1),
    nowISO: () => '2026-09-21T12:00:00.000Z',
    todayYmd: () => '2026-09-21',
    toast: (t, k) => protokoll.toasts.push(k + ':' + t),
  },
  '../store.js': {
    state: { data: { chatgptNotesMeta: {} } },
    getCollection: (name) => Object.values(ENT[name] || {}),
    getById: (kind, id) => (ENT[KIND[kind] || kind] || {})[id] || null,
    performOp: async (op) => { protokoll.ops.push(op); applyFakeOp(op); },
    notify: () => { protokoll.notified++; },
  },
  '../actions.js': { registerActions: (o) => Object.assign(AKTIONEN, o) },
  './common.js': {
    pageHeader: (t, s) => `<h1>${t}</h1><p>${s}</p>`,
    segmented: (items, active, action) => items.map((i) => `<button data-action="${action}" data-seg="${i.key}" class="${i.key === active ? 'active' : ''}">${i.label}${i.count != null ? ' ' + i.count : ''}</button>`).join(''),
  },
};
const AKTIONEN = {};

function ladeModul(datei, stubMap) {
  const quelle = fs.readFileSync(path.join(root, datei), 'utf8');
  const exporte = {};
  const ohneImporte = quelle
    .replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
      ok(Object.prototype.hasOwnProperty.call(stubMap, pfad), `unbekannter Import in ${datei}: ${pfad}`);
      const namen = /\{([^}]*)\}/.exec(m);
      if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
      const stern = /\*\s+as\s+(\w+)/.exec(m);
      return `const ${stern[1]} = __stubs['${pfad}'];`;
    })
    .replace(/^export (async )?function (\w+)/gm, (m, a, name) => `${a || ''}function ${name}`)
    .replace(/^export default/m, '__exporte.default =');
  const namen = [...quelle.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  new Function('__stubs', '__exporte', ohneImporte + '\n' + namen.map((n) => `__exporte.${n} = ${n};`).join('\n'))(stubMap, exporte);
  return { exporte, quelle };
}

const { exporte, quelle } = ladeModul('js/views/chatgpt.js', stubs);
const { exporte: commonExporte } = ladeModul('js/views/common.js', { '../util.js': stubs['../util.js'] });

// ═══ 1. DELEGIEREN: EIN NEUER LEAD, ZWEI OPERATIONEN ═══════════════════════
{
  ok(typeof exporte.delegateTaskToChatgpt === 'function', 'delegateTaskToChatgpt ist nicht exportiert');
  ok((await exporte.delegateTaskToChatgpt('gibt-es-nicht')) === null, 'ein unbekannter Task liefert kein null zurueck');

  const n = protokoll.ops.length;
  const result = await exporte.delegateTaskToChatgpt('t1');
  ok(result && result.delegated === true, 'die erste Delegation meldet delegated:true nicht');
  ok(ENT.tasks.t1.assignee === 'chatgpt', 'der Task traegt nach der Delegation nicht assignee "chatgpt"');
  ok(!!ENT.tasks.t1.delegatedLeadId, 'der Task traegt keine delegatedLeadId');
  const leadId = ENT.tasks.t1.delegatedLeadId;
  ok(leadId === result.leadId, 'delegateTaskToChatgpt liefert eine andere leadId als die am Task gespeicherte');
  const lead = ENT.chatgptLeads[leadId];
  ok(!!lead, 'es wurde kein chatgptLead-Datensatz angelegt');
  ok(lead.title === 'Angebot einholen', 'der Lead-Titel kommt nicht vom Task');
  ok(lead.rawInput === 'Delegierte Aufgabe: Angebot einholen', 'der Lead-Wortlaut markiert die Herkunft nicht');
  ok(lead.status === 'neu', 'ein frisch delegierter Lead startet nicht als "neu"');
  ok(lead.operationalState === 'doing', 'ein frisch delegierter Lead traegt operationalState nicht als "doing"');
  ok(Object.keys(ENT.chatgptLeads).length === 1, 'es existiert nach der ersten Delegation mehr als ein Lead');

  const ops = protokoll.ops.slice(n);
  ok(ops.length === 3, `die erste Delegation schreibt nicht genau drei Operationen (Lead anlegen, Lead-Status, Task): ${ops.length}`);
  ok(ops[0].type === 'add-chatgptLead', 'die Lead-Erzeugung ist nicht die erste Operation');
  ok(ops[1].type === 'update-chatgptLead' && ops[1].payload.operationalState === 'doing', 'die Lead-Statusaenderung (operationalState:doing) fehlt als eigene Operation');
  ok(ops[2].type === 'update-task' && ops[2].payload.id === 't1' && ops[2].payload.assignee === 'chatgpt', 'die Task-Mutation (assignee) fehlt als eigene, letzte Operation');
  // Jede Operation traegt ausschliesslich Felder ihrer eigenen Entitaet — keine
  // gemergte Task+Lead-Payload in einem einzigen performOp-Aufruf.
  ok(!('title' in ops[2].payload) && !('rawInput' in ops[2].payload) && !('operationalState' in ops[2].payload), 'die Task-Operation traegt Lead-Felder — Task und Lead wurden gemergt statt getrennt geschrieben');
  ok(!('delegatedLeadId' in ops[0].payload) && !('delegatedLeadId' in ops[1].payload), 'eine Lead-Operation traegt das Task-Feld "delegatedLeadId" — gemergte Payload');
}

// ═══ 2. ZURÜCKHOLEN: LEAD BLEIBT BESTEHEN, WIRD ABER HINFAELLIG ════════════
{
  const leadId = ENT.tasks.t1.delegatedLeadId;
  const n = protokoll.ops.length;
  const result = await exporte.delegateTaskToChatgpt('t1');
  ok(result && result.delegated === false, 'das Zurueckholen meldet delegated:false nicht');
  ok(ENT.tasks.t1.assignee === 'user', 'der Task steht nach dem Zurueckholen nicht wieder auf assignee "user"');
  ok(ENT.tasks.t1.delegatedLeadId === leadId, 'delegatedLeadId geht beim Zurueckholen verloren (naechstes Delegieren wuerde dupliziert)');
  const lead = ENT.chatgptLeads[leadId];
  ok(lead.status === 'abgeschlossen', 'der zurueckgeholte Lead wird nicht als abgeschlossen markiert');
  ok(lead.operationalState === 'cancelled', 'der zurueckgeholte Lead traegt operationalState nicht als "cancelled"');
  ok(lead.obsoleteReason === 'Aufgabe wieder zurückgeholt', 'obsoleteReason fehlt oder ist falsch');
  ok(!!lead.closedAt && lead.closedBy === 'laurin', 'closedAt/closedBy fehlen beim Zurueckholen');
  ok(Object.keys(ENT.chatgptLeads).length === 1, 'das Zurueckholen loescht den Lead (oder legt einen zweiten an) statt ihn hinfaellig zu schliessen');

  const ops = protokoll.ops.slice(n);
  ok(ops.length === 2, `das Zurueckholen schreibt nicht genau zwei Operationen (Task + Lead): ${ops.length}`);
  ok(ops[0].type === 'update-task' && ops[1].type === 'update-chatgptLead', 'die Reihenfolge/Typen der beiden Operationen stimmen nicht');
}

// ═══ 3. ERNEUT DELEGIEREN: DERSELBE LEAD WIRD REAKTIVIERT, KEIN DUPLIKAT ═══
{
  const leadId = ENT.tasks.t1.delegatedLeadId;
  const n = protokoll.ops.length;
  const result = await exporte.delegateTaskToChatgpt('t1');
  ok(result && result.delegated === true && result.leadId === leadId, 'das erneute Delegieren erzeugt einen neuen Lead statt den bestehenden zu reaktivieren');
  ok(ENT.tasks.t1.assignee === 'chatgpt', 'der Task ist nach dem erneuten Delegieren nicht wieder ChatGPT zugewiesen');
  const lead = ENT.chatgptLeads[leadId];
  ok(lead.status === 'neu', 'der reaktivierte Lead steht nicht wieder auf "neu"');
  ok(lead.operationalState === 'doing', 'der reaktivierte Lead steht nicht wieder auf "doing"');
  ok(lead.closedAt === null && lead.closedBy === null && lead.obsoleteReason === null, 'die Abschluss-Felder werden bei der Reaktivierung nicht zurueckgesetzt');
  ok(Object.keys(ENT.chatgptLeads).length === 1, 'nach Delegieren → Zurueckholen → erneut Delegieren existiert mehr als EIN Lead fuer denselben Task');

  const ops = protokoll.ops.slice(n);
  ok(ops.length === 2, `das erneute Delegieren schreibt nicht genau zwei Operationen (Task + Lead): ${ops.length}`);
}

// ═══ 4. DELEGATION UEBERSCHREIBT AUCH EINE COWORK-ZUWEISUNG ════════════════
{
  ok(ENT.tasks.t2.assignee === 'cowork', 'Testaufbau: t2 sollte mit assignee "cowork" starten');
  const result = await exporte.delegateTaskToChatgpt('t2');
  ok(result && result.delegated === true, 'ein Cowork-Task laesst sich nicht an ChatGPT delegieren');
  ok(ENT.tasks.t2.assignee === 'chatgpt', 'die Cowork-Zuweisung wird beim Delegieren nicht ueberschrieben');
  ok(Object.keys(ENT.chatgptLeads).length === 2, 'fuer t2 wurde kein eigener, zweiter Lead angelegt');
}

// ═══ 5. WIRING: DIE ACTION 'task-delegate-chatgpt' RUFT DIESELBE FUNKTION ══
{
  ok(typeof AKTIONEN['task-delegate-chatgpt'] === 'function', 'die Action "task-delegate-chatgpt" ist nicht registriert');
  ENT.tasks.t3 = { id: 't3', title: 'Dritte Aufgabe', assignee: 'user' };
  const n = protokoll.ops.length;
  await AKTIONEN['task-delegate-chatgpt']({ id: 't3' });
  ok(ENT.tasks.t3.assignee === 'chatgpt', 'die Action delegiert den Task nicht wirklich');
  ok(protokoll.ops.length > n, 'die Action schreibt keine Operation');
  ok(protokoll.toasts[protokoll.toasts.length - 1] === 'ok:An ChatGPT delegiert ✓', 'die Action meldet die Delegation nicht per Toast');
  await AKTIONEN['task-delegate-chatgpt']({ id: 'gibt-es-nicht' });
  ok(protokoll.toasts[protokoll.toasts.length - 1] === 'error:Aufgabe nicht gefunden', 'ein unbekannter Task wird nicht als Fehler gemeldet');
}

// ═══ 6. INTAKE: KOMPAKTE ANFRAGE-EINREICHUNG ÜBER DENSELBEN WEG ════════════
{
  ok(typeof AKTIONEN['cg-intake-add'] === 'function', 'die Action "cg-intake-add" ist nicht registriert');
  const n = protokoll.ops.length;
  felder.cgIntakeInput = { value: '   ' };
  await AKTIONEN['cg-intake-add']();
  ok(protokoll.ops.length === n && protokoll.toasts[protokoll.toasts.length - 1] === 'error:Bitte Text eingeben', 'eine leere Anfrage wurde eingereicht/nicht als Fehler gemeldet');

  felder.cgIntakeInput = { value: 'Bitte Angebot X pruefen\nDetails siehe Anhang' };
  await AKTIONEN['cg-intake-add']();
  ok(protokoll.ops.length === n + 1, 'die Anfrage-Einreichung schreibt keine (oder mehr als eine) Operation');
  const op = protokoll.ops[protokoll.ops.length - 1];
  ok(op.type === 'add-chatgptLead', `die Intake-Anfrage landet nicht in chatgptLeads: ${op.type}`);
  ok(op.payload.title === 'Bitte Angebot X pruefen', 'ohne eigenen Titel wird nicht die erste Zeile als Titel genommen');
  ok(op.payload.rawInput === 'Bitte Angebot X pruefen\nDetails siehe Anhang', 'der volle Wortlaut kommt nicht unveraendert an');
  ok(op.payload.status === 'neu' && op.payload.readAt === null && op.payload.assignee === null, 'die Intake-Anfrage startet nicht wie ein regulaerer Lead (neu/ungelesen/unzugewiesen)');
  ok(felder.cgIntakeInput.value === '', 'das Eingabefeld wird nach dem Einreichen nicht geleert');
  ok(protokoll.toasts[protokoll.toasts.length - 1] === 'ok:Anfrage eingereicht ✓ — liegt als Lead im Eingang', 'die erfolgreiche Einreichung wird nicht bestaetigt');

  // Reuse-Nachweis: dieselbe Funktion wie die bestehende Leads-Erfassung.
  const direkt = await exporte.addChatgptLead('', 'Nur ueber addChatgptLead direkt aufgerufen');
  ok(!!direkt, 'addChatgptLead (von der Intake-Aktion wiederverwendet) legt keinen Lead an');
}

// ═══ 7. RENDER: DER KOMPAKTE DELEGATIONS-KNOPF AN DER TASKCARD ═════════════
{
  ok(typeof commonExporte.taskCard === 'function', 'taskCard ist in common.js nicht exportiert');
  const offen = commonExporte.taskCard({ id: 'x1', title: 'Offene Aufgabe', assignee: 'user' });
  ok(/data-action="task-delegate-chatgpt" data-id="x1"/.test(offen), 'der Delegations-Knopf fehlt an der Taskcard');
  ok(/An ChatGPT delegieren/.test(offen) && !/Zurückholen/.test(offen), 'eine nicht delegierte Aufgabe zeigt nicht "An ChatGPT delegieren"');
  const delegiert = commonExporte.taskCard({ id: 'x2', title: 'Delegierte Aufgabe', assignee: 'chatgpt' });
  ok(/Zurückholen/.test(delegiert), 'eine delegierte Aufgabe bietet kein "Zurückholen" an');
  ok(/🤖✓/.test(delegiert), 'eine delegierte Aufgabe zeigt kein anderes Symbol als eine offene');
}

// ═══ 8. STRUKTUR (sekundäres Sicherheitsnetz, nicht der einzige Test) ══════
{
  ok(!/\bfetch\(/.test(quelle), 'chatgpt.js greift fuer Delegation/Intake direkt per fetch zu, statt store.performOp zu benutzen');
  ok(/task-delegate-chatgpt/.test(quelle), 'die Delegations-Action fehlt im Quelltext');
}

if (luecken.length) {
  console.error(`CHATGPT DELEGATION/INTAKE (Handy) — ${luecken.length} von ${checks} Pruefungen:\n   - ${luecken.join('\n   - ')}`);
  process.exit(1);
}
console.log(`chatgpt-delegation-intake (Handy): ok (${checks} Pruefungen)`);
