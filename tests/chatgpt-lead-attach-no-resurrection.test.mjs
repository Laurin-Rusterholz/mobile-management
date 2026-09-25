/*
 * Review-Punkt (25.09.2026): kann der neue Optyp 'attach-chatgptLead-file'
 * (eingefuehrt zur Behebung des l.files-Wettlaufs, siehe
 * chatgpt-lead-attach.test.mjs) einen anderswo geloeschten Anhang
 * wiederauferstehen lassen, wenn ein gequeuter Anhang-Versuch spaeter
 * gegen einen frisch gepullten Stand abgespielt wird?
 * ---------------------------------------------------------------------------
 * Ergebnis der Untersuchung: strukturell NEIN — und zwar aus zwei
 * voneinander unabhaengigen Gruenden, die dieser Test beide belegt:
 *
 *   1. Der Optyp traegt in seinem Payload NUR das EINE neue Dateiobjekt,
 *      nie eine vollstaendige Kopie von files[] (das war genau der alte
 *      Fehler). applyOp() UNIONIERT ausschliesslich per Id hinzu — er
 *      ENTFERNT nie etwas und schreibt files[] nie komplett neu. Ein
 *      bereits woanders geloeschter, ANDERER Anhang (per replayIntent()
 *      unveraendert durchgereichtem Payload) kann also gar nicht wieder
 *      auftauchen, selbst wenn der Ersteller den Pull, der die Loeschung
 *      brachte, erst NACH dem Queuen seines eigenen Anhangs sieht.
 *
 *   2. Die Datei-Id selbst wird beim Hochladen frisch erzeugt (newId('f'),
 *      js/util.js) — kein anderes Geraet kann eine ID kennen (und damit
 *      loeschen), die der Server noch nie gesehen hat. Der gequeute
 *      Optyp verlaesst die lokale pending-Warteschlange erst nach einem
 *      ERFOLGREICHEN push (state.pending = [] in pushData()) — bis dahin
 *      kann niemand sonst diese ID referenzieren.
 *
 * Der Test treibt die ECHTEN Funktionen aus js/store.js (applyOp,
 * preparePendingOp, shouldSkipPendingOp, replayPendingOperations) — kein
 * Duplikat der Logik.
 */
import assert from 'node:assert/strict';
import { applyOp, replayPendingOperations, preparePendingOp, state } from '../js/store.js';

let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

// ── 1. Ein bereits ANDERSWO geloeschter Anhang darf durch das Replay eines
//      unabhaengig gequeuten Anhangs fuer eine ANDERE Datei nicht
//      wiederauferstehen ─────────────────────────────────────────────────
{
  // Ausgangslage VOR dem Queuen: Lead hat Anhang A.
  state.data = { entities: { chatgptLeads: {
    l1: { id: 'l1', title: 'x', rawInput: 'x', status: 'neu', files: [{ id: 'fA', name: 'a.pdf' }], updatedAt: '2026-09-25T09:00:00.000Z' },
  } } };
  // Anhang B wird OFFLINE angehaengt und gequeut — dieselbe Operation, die
  // attachDocumentToLead() (js/views/chatgpt.js) heute erzeugt.
  const op = preparePendingOp({ type: 'attach-chatgptLead-file', payload: { id: 'l1', file: { id: 'fB', name: 'b.pdf' } } });
  applyOp(op); // sofortige lokale Anwendung, wie performOp() es tut
  state.pending = [op];
  ok(state.data.entities.chatgptLeads.l1.files.map((f) => f.id).sort().join(',') === 'fA,fB',
    'die sofortige lokale Anwendung haette beide Anhaenge zeigen muessen');

  // Bevor der Push durchkam: ein PULL bringt den Stand eines ANDEREN
  // Geraets, das Anhang A inzwischen geloescht hat (Desktop, splice+updatedAt).
  state.data = { entities: { chatgptLeads: {
    l1: { id: 'l1', title: 'x', rawInput: 'x', status: 'neu', files: [], updatedAt: '2026-09-25T09:05:00.000Z' },
  } } };

  // Replay des noch ausstehenden Anhang-B-Versuchs gegen den frischen Stand.
  const { applied, skipped } = replayPendingOperations(state.pending);
  ok(skipped.length === 0, `der Anhang-Versuch haette nicht uebersprungen werden sollen: ${JSON.stringify(skipped)}`);
  ok(applied.length === 1, 'der Anhang-Versuch wurde nicht erneut angewendet');

  const dateien = state.data.entities.chatgptLeads.l1.files.map((f) => f.id).sort();
  ok(dateien.join(',') === 'fB', `Anhang A (anderswo geloescht) ist wiederaufgetaucht, ODER Anhang B fehlt: ${JSON.stringify(dateien)}`);
  ok(!dateien.includes('fA'), 'ein anderswo geloeschter Anhang wurde durch das Replay eines unabhaengigen Anhang-Versuchs wiederhergestellt');
}

// ── 2. Ein REPLAY desselben Anhang-Versuchs mehrfach hintereinander bleibt
//      idempotent — kein Duplikat, kein Zuruecksetzen auf einen alten Stand ─
{
  state.data = { entities: { chatgptLeads: {
    l2: { id: 'l2', title: 'x', rawInput: 'x', status: 'neu', files: [], updatedAt: '2026-09-25T09:00:00.000Z' },
  } } };
  const op = preparePendingOp({ type: 'attach-chatgptLead-file', payload: { id: 'l2', file: { id: 'fC', name: 'c.pdf' } } });
  applyOp(op);
  replayPendingOperations([op]);
  replayPendingOperations([op]);
  const dateien2 = state.data.entities.chatgptLeads.l2.files;
  ok(dateien2.length === 1 && dateien2[0].id === 'fC', `mehrfaches Replay derselben Operation darf keine Duplikate erzeugen: ${JSON.stringify(dateien2)}`);
}

if (luecken.length) { console.error('FEHLER:\n- ' + luecken.join('\n- ')); process.exit(1); }
console.log(`chatgpt-lead-attach-no-resurrection (Handy): ok (${checks} Pruefungen)`);
