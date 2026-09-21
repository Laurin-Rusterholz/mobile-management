// Produktionsbefund (Tagesbriefing-Gesamtkonzept-v2, "compact parity"):
//
// AI Sync hat entities.chatgptLeads um neue Felder erweitert (operationalState,
// pendingQuestion, Cowork-Handover-Felder wie handoverAt/expectedReturnAt/
// returnedAt/returnChecked, nextAction/waitingOn/followUpAt, …) — reine
// Datenfelder, ohne Schema-Migration. Bevor das Handy irgendetwas an diesen
// Feldern schreibt, musste geprüft werden, ob preparePendingOp/
// replayPendingOperations (Fingerprint-basierte Konfliktaufloesung, siehe
// js/store.js) eine feste Feldliste voraussetzen — dann waeren neue/unbekannte
// Felder beim Zusammenfuehren stillschweigend verschwunden oder haetten einen
// echten Konflikt als "keine Aenderung" durchgehen lassen.
//
// Befund: intentFields/baseFields laufen generisch ueber Object.keys(payload)
// — es gibt keine feste Allowlist. Dieser Test belegt das empirisch anhand
// echter Lead-Felder: ein Feld, das NICHT Teil der lokalen Operation ist,
// bleibt bei einem konfliktfreien Replay unangetastet erhalten (auch ein Feld,
// das dieser Code ueberhaupt nicht kennt); ein Feld, das lokal UND entfernt
// gleichzeitig geaendert wurde, loest tatsaechlich einen Konflikt aus und die
// unterlegene Fassung landet in der Konfliktablage statt verloren zu gehen.
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

const store = await import('../js/store.js');
let checks = 0;
const ok = (value, message) => { checks++; assert.ok(value, message); };
const eq = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };

const snap = (leads) => ({ entities: { chatgptLeads: Object.fromEntries(leads.map((l) => [l.id, l])) } });

// Ein Lead, wie er nach einem Pull aus AI Sync aussehen könnte — inklusive
// eines Feldes (futureFieldXYZ), das im Handy-Code an KEINER Stelle vorkommt.
const leadBasis = () => ({
  id: 'lead1', createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  title: 'Ursprünglicher Titel', rawInput: '...', status: 'in_arbeit', readAt: '2026-09-01T09:00:00.000Z',
  assignee: 'cowork', operationalState: 'waiting_external',
  responsibleParty: 'chatgpt', nextAction: 'Angebot einholen', nextActionAt: '2026-09-12T08:00:00.000Z',
  waitingOn: 'Lieferant', waitingSince: '2026-09-08T08:00:00.000Z',
  followUpAt: '2026-09-15T08:00:00.000Z', followUpDeferrals: 1, questionForBriefingAt: null,
  pendingQuestion: {
    text: 'Variante A oder B?', options: ['A', 'B'], recommendation: 'A',
    askedAt: '2026-09-09T08:00:00.000Z', answeredAt: null, answer: null,
  },
  handoverAt: null, expectedReturnAt: null, returnedAt: null, returnChecked: false,
  futureFieldXYZ: { irgendwas: 'unbekannt', zahl: 42 },
});

// ── 1. Konfliktfrei: unbekannte/unberührte Felder überleben unverändert ─────
store.state.data = snap([leadBasis()]);
const antwortOp = store.preparePendingOp({ type: 'update-chatgptLead', payload: {
  id: 'lead1',
  pendingQuestion: { ...leadBasis().pendingQuestion, answer: 'A bitte', answeredAt: '2026-09-16T09:00:00.000Z' },
  operationalState: 'doing',
} }, '2026-09-16T09:00:00.000Z');
eq(antwortOp._queue.intentFields, ['pendingQuestion', 'operationalState'],
  'preparePendingOp erfasst nicht genau die tatsächlich geänderten Felder (keine feste Feldliste, sondern die des Payloads)');

// Waehrenddessen aendert der Rechner am selben Lead andere Felder — inklusive
// eines Feldes, das komplett neu/unbekannt ist.
const remoteMitAnderenAenderungen = {
  ...leadBasis(),
  updatedAt: '2026-09-16T08:30:00.000Z',
  title: 'Titel vom Rechner geändert',
  waitingOn: 'Anderer Lieferant',
  followUpDeferrals: 2,
  addedByDesktop: 'ganz neues Feld',
};
store.state.data = snap([remoteMitAnderenAenderungen]);
const ergebnis1 = store.replayPendingOperations([structuredClone(antwortOp)]);
eq(ergebnis1.applied.length, 1, 'die Antwort wird bei unrelated Server-Änderungen fälschlich als Konflikt verworfen');
eq(ergebnis1.skipped.length, 0, 'unrelated Server-Änderungen an anderen Feldern lösen fälschlich einen Konflikt aus');

const nachher1 = store.state.data.entities.chatgptLeads.lead1;
eq(nachher1.pendingQuestion.answer, 'A bitte', 'die Antwort wird nicht auf demselben Lead gespeichert');
ok(!!nachher1.pendingQuestion.answeredAt, 'answeredAt wird beim Replay nicht gesetzt');
eq(nachher1.operationalState, 'doing', 'operationalState wechselt beim Replay nicht auf "doing"');
// Die unrelated Server-Felder — inklusive eines Feldes, das dieser Code nicht
// kennt — müssen unverändert erhalten bleiben:
eq(nachher1.title, 'Titel vom Rechner geändert', 'ein vom Server geändertes, lokal nicht berührtes Feld wird überschrieben');
eq(nachher1.waitingOn, 'Anderer Lieferant', 'waitingOn (vom Server geändert, lokal nicht berührt) geht verloren');
eq(nachher1.followUpDeferrals, 2, 'followUpDeferrals (vom Server geändert, lokal nicht berührt) geht verloren');
eq(nachher1.addedByDesktop, 'ganz neues Feld', 'ein dem Handy-Code gänzlich unbekanntes neues Feld geht beim Merge verloren');
eq(nachher1.futureFieldXYZ, { irgendwas: 'unbekannt', zahl: 42 }, 'ein unbekanntes Feld, das nie geändert wurde, übersteht den Roundtrip nicht unverändert');

// ── 2. Echter Konflikt: dasselbe neue Feld wird lokal UND entfernt geändert ─
store.state.data = snap([leadBasis()]);
const zweiterOp = store.preparePendingOp({ type: 'update-chatgptLead', payload: {
  id: 'lead1', operationalState: 'doing', returnChecked: true,
} }, '2026-09-16T09:00:00.000Z');

// Der Rechner hat operationalState NACH unserer Basis, aber vor unserem
// Replay, auf einen anderen Wert gesetzt — mit einem neueren Zeitstempel.
const remoteKonflikt = { ...leadBasis(), operationalState: 'review', updatedAt: '2026-09-16T10:00:00.000Z' };
store.state.data = snap([remoteKonflikt]);
const ergebnis2 = store.replayPendingOperations([zweiterOp]);
eq(ergebnis2.applied.length, 0, 'ein echter Feld-Konflikt auf operationalState wird nicht erkannt (die neuere Serverfassung müsste gewinnen)');
eq(ergebnis2.skipped.length, 1, 'die unterlegene lokale Änderung landet nicht in der Konfliktablage');
eq(ergebnis2.skipped[0].kind, 'local-superseded');
eq(store.state.data.entities.chatgptLeads.lead1.operationalState, 'review',
  'der neuere Serverstand (operationalState) wird von der älteren lokalen Änderung überschrieben statt zu gewinnen');
// Nichts wird stillschweigend verworfen — die unterlegene lokale Fassung
// bleibt rekonstruierbar in der Ablage:
eq(ergebnis2.skipped[0].snapshot.operationalState, 'doing', 'die unterlegene lokale Fassung ist in der Konfliktablage nicht mehr rekonstruierbar');

// ── 3. Die neuere Seite gewinnt auch, wenn sie die lokale ist ──────────────
store.state.data = snap([leadBasis()]);
const dritterOp = store.preparePendingOp({ type: 'update-chatgptLead', payload: {
  id: 'lead1', operationalState: 'doing',
} }, '2026-09-16T11:00:00.000Z');
const remoteAelter = { ...leadBasis(), operationalState: 'review', updatedAt: '2026-09-16T10:00:00.000Z' };
store.state.data = snap([remoteAelter]);
const ergebnis3 = store.replayPendingOperations([dritterOp]);
eq(ergebnis3.applied.length, 1, 'die neuere lokale Änderung auf einem neuen Feld gewinnt nicht gegen eine ältere Serverfassung');
eq(ergebnis3.skipped[0].kind, 'remote-superseded');
eq(store.state.data.entities.chatgptLeads.lead1.operationalState, 'doing', 'die neuere lokale operationalState-Änderung setzt sich nicht durch');
// Auch hier bleiben unrelated Felder (inkl. des unbekannten) erhalten:
eq(store.state.data.entities.chatgptLeads.lead1.futureFieldXYZ, { irgendwas: 'unbekannt', zahl: 42 },
  'ein unbekanntes Feld geht auch beim Gewinnen der lokalen Änderung verloren');

console.log(`ChatGPT-Lead — neue Felder überleben Prepare→Replay generisch (kein festes Schema): ok (${checks} Prüfungen)`);
