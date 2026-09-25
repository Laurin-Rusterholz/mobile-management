/*
 * Zwei Geraete delegieren dieselbe Aufgabe unabhaengig an ChatGPT — zwei
 * Leads statt einem, trotz task.delegatedLeadId. Review-Punkt (25.09.2026,
 * zusaetzlich zu ai-sync PR269, spiegelt dort/Tablet denselben Fix 1:1):
 * ---------------------------------------------------------------------------
 * delegateTaskToChatgpt() legte einen neuen Lead bisher ueber
 * addChatgptLead() OHNE forcedId an — also mit newId('chatgptLead'), einer
 * Zufalls-ID (Zeitstempel+Zufall, js/util.js). Delegieren zwei Geraete
 * dieselbe, noch nicht delegierte Aufgabe unabhaengig voneinander, bevor
 * eines vom anderen erfahren hat, erzeugt jedes Geraet einen eigenen Lead mit
 * einer ANDEREN Zufalls-ID und schreibt seine eigene auf
 * task.delegatedLeadId — der VERLIERENDE Lead bleibt als Karteileiche
 * zurueck, die keine Aufgabe mehr referenziert.
 *
 * Fix: dieselbe deterministische-ID-Formel wie ai-sync/Tablet:
 * "chatgptLead_from_task_" + taskId statt Zufall. Zwei Geraete berechnen
 * unabhaengig dieselbe ID — da Entitaeten in diesem Store als Dictionary
 * NACH ID gefuehrt werden (js/store.js, KIND_MAP-Zweig in applyOp), kann es
 * unter derselben ID strukturell nie zwei separate Eintraege geben; ein
 * bereits vorhandener Lead unter dieser ID wird ausserdem wiederverwendet
 * statt neu angelegt (kein Ueberschreiben echter Bearbeitung).
 *
 * Der Test fuehrt die ECHTE js/views/chatgpt.js zweimal unabhaengig gegen
 * zwei eigene Stores aus ("zwei Geraete"), genau wie
 * chatgpt-delegation-intake.test.mjs es fuer ein einzelnes Geraet tut.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

globalThis.document = { addEventListener() {}, getElementById: () => null, createElement: () => ({ set innerHTML(v) { this._html = v; }, firstElementChild: null }) };

const KIND = { task: 'tasks', chatgptLead: 'chatgptLeads', chatgptNote: 'chatgptNotes', chatgptTask: 'chatgptTasks' };

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
  return exporte;
}

// Ein unabhaengiges "Geraet": eigene Fixture-Entitaeten, eigener Store-Stub,
// aber die ECHTE js/views/chatgpt.js-Quelle.
function geraet(taskId, taskTitle) {
  const ENT = { tasks: { [taskId]: { id: taskId, title: taskTitle, assignee: 'user' } }, chatgptLeads: {}, chatgptNotes: {}, chatgptTasks: {} };
  function applyFakeOp(op) {
    const [verb, ...rest] = String(op.type || '').split('-');
    const collName = KIND[rest.join('-')];
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
      escHTML: (s) => String(s == null ? '' : s), formatDate: (v) => String(v || '').slice(0, 10),
      newId: (k) => k + '_zufall_' + Math.random().toString(36).slice(2, 8),
      nowISO: () => '2026-09-25T10:00:00.000Z', todayYmd: () => '2026-09-25',
      toast: () => {},
    },
    '../store.js': {
      state: { data: { chatgptNotesMeta: {} } },
      getCollection: (name) => Object.values(ENT[name] || {}),
      getById: (kind, id) => (ENT[KIND[kind] || kind] || {})[id] || null,
      performOp: async (op) => { applyFakeOp(op); },
      notify: () => {},
    },
    '../actions.js': { registerActions: () => {} },
    './common.js': { pageHeader: () => '', segmented: () => '' },
    '../auth.js': { initAuth: () => {}, sdkBereit: () => true, currentUser: () => ({ uid: 'u_test' }), signInGoogle: async () => ({ ok: true }) },
  };
  return { CG: ladeModul('js/views/chatgpt.js', stubs), ENT };
}

// ── 1. Zwei unabhaengige Geraete delegieren dieselbe, noch nicht delegierte
//      Aufgabe — beides "unwissend" vom jeweils anderen ─────────────────────
(async () => {
  const taskId = 'tk_geteilt_1';
  const titel = 'Vertrag mit Firma X pruefen';
  const leadId = 'chatgptLead_from_task_' + taskId; // exakt die Formel aus dem Fix

  const geraetA = geraet(taskId, titel);
  const geraetB = geraet(taskId, titel);

  const ergebnisA = await geraetA.CG.delegateTaskToChatgpt(taskId);
  const ergebnisB = await geraetB.CG.delegateTaskToChatgpt(taskId);
  ok(ergebnisA && ergebnisA.delegated === true && ergebnisB && ergebnisB.delegated === true, 'die Delegation auf einem der beiden Geraete schlug fehl');
  ok(ergebnisA.leadId === leadId && ergebnisB.leadId === leadId,
    `zwei unabhaengige Geraete berechnen fuer dieselbe delegierte Aufgabe verschiedene Lead-IDs — genau die gemeldete Karteileiche: ${JSON.stringify({ a: ergebnisA.leadId, b: ergebnisB.leadId, erwartet: leadId })}`);
  ok(geraetA.ENT.tasks[taskId].delegatedLeadId === leadId && geraetB.ENT.tasks[taskId].delegatedLeadId === leadId,
    'die Aufgabe zeigt nicht auf die deterministische Lead-Id');

  // Da Entitaeten als Dictionary nach ID gefuehrt werden (KIND_MAP-Zweig in
  // applyOp, js/store.js), existiert unter dieser ID pro Geraet strukturell
  // nur EIN Lead — kein zweiter, verwaister Eintrag.
  ok(Object.keys(geraetA.ENT.chatgptLeads).length === 1 && Object.keys(geraetB.ENT.chatgptLeads).length === 1,
    'pro Geraet wurde nicht genau ein Lead angelegt');

  // ── 2. Wuerden beide "add"-Operationen (dieselbe id) auf EINEN gemeinsamen
  //      Bestand angewendet (Zusammenfuehrung nach Sync), bliebe es bei genau
  //      einem Eintrag — kein zweiter Lead entsteht durch die Zusammenfuehrung.
  const gemeinsam = {};
  if (geraetA.ENT.chatgptLeads[leadId]) gemeinsam[leadId] = { ...geraetA.ENT.chatgptLeads[leadId] };
  if (geraetB.ENT.chatgptLeads[leadId]) Object.assign(gemeinsam[leadId] || (gemeinsam[leadId] = {}), geraetB.ENT.chatgptLeads[leadId]);
  ok(Object.keys(gemeinsam).length === 1, 'nach dem Zusammenfuehren existiert mehr als ein Lead fuer dieselbe delegierte Aufgabe');
})().then(() => {
  // ── 3. Der echte Quelltext: deterministische Formel, kein unbedingtes
  //      Neuanlegen, forcedId wird tatsaechlich durchgereicht ────────────────
  const source = fs.readFileSync(path.join(root, 'js/views/chatgpt.js'), 'utf8');
  const start = source.indexOf('export async function delegateTaskToChatgpt(taskId) {');
  ok(start > 0, 'delegateTaskToChatgpt() wurde nicht gefunden');
  const ende = source.indexOf('\n// ── Rueckfrage beantworten', start);
  ok(ende > start, 'Ende von delegateTaskToChatgpt() nicht bestimmbar (naechster Abschnitt verschoben)');
  const src = source.slice(start, ende);
  ok(/const deterministicId = 'chatgptLead_from_task_' \+ taskId;/.test(src),
    'delegateTaskToChatgpt berechnet die Lead-ID nicht mehr deterministisch aus der taskId');
  ok(/store\.getById\('chatgptLead', deterministicId\)/.test(src),
    'delegateTaskToChatgpt prueft nicht, ob unter der deterministischen ID bereits ein Lead existiert — riskiert das Ueberschreiben echter Bearbeitung');
  ok(/addChatgptLead\([^;]*, deterministicId\)/.test(src),
    'addChatgptLead wird nicht mit der deterministischen ID als forcedId aufgerufen — die Zufalls-ID-Luecke besteht fort');

  console.log(`chatgpt-task-delegation-lead-race (Handy): ok (${checks} Pruefungen)`);
  if (luecken.length) { console.error('FEHLER:\n- ' + luecken.join('\n- ')); process.exit(1); }
}).catch((err) => { console.error(err); process.exit(1); });
