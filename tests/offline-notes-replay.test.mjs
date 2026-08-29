import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

const store = await import('../js/store.js');
let checks = 0;
function ok(value, message) { checks++; assert.ok(value, message); }
function eq(actual, expected, message) { checks++; assert.deepEqual(actual, expected, message); }

const source = { app: 'noteflow', entityType: null, entityId: null, label: 'Noteflow', route: '#/noteflow' };
const note = (id, content, updatedAt, extra = {}) => ({
  id, title: content, content, noteClass: 'general', tags: [], notebookId: null,
  source, createdAt: '2026-08-29T08:00:00.000Z', updatedAt, ...extra,
});
const snapshot = (notes, ideas = {}) => ({ entities: {
  notes: Object.fromEntries(notes.map((item) => [item.id, item])), ideas,
  tasks: {}, notebooks: {}, books: {}, projects: {}, meetings: {}, timeEntries: {},
} });

// Ein echter Offline-Verlauf A→B→C: jede Operation erhält die Version, die
// beim Bearbeiten tatsächlich sichtbar war.
const serverA = note('n1', 'A', '2026-08-29T09:00:00.000Z');
store.state.data = snapshot([structuredClone(serverA)]);
const opAB = store.preparePendingOp({ type: 'update-note', payload: { id: 'n1', content: 'B', title: 'B' } }, '2026-08-29T10:00:00.000Z');
eq(opAB._queue.baseUpdatedAt, serverA.updatedAt, 'erste Operation speichert ihre Basisversion nicht');
store.applyOp(opAB);
const opBC = store.preparePendingOp({ type: 'update-note', payload: { id: 'n1', content: 'C', title: 'C' } }, '2026-08-29T10:05:00.000Z');
eq(opBC._queue.baseUpdatedAt, '2026-08-29T10:00:00.000Z', 'zweite Operation basiert nicht auf dem ersten lokalen Stand');

store.state.data = snapshot([structuredClone(serverA)]);
const sequential = store.replayPendingOperations([opAB, opBC]);
eq(sequential.applied.length, 2, 'legitime A→B→C-Queue wird nicht vollständig abgespielt');
eq(sequential.skipped.length, 0, 'legitime Folgeoperation wird fälschlich als Serverkonflikt verworfen');
eq(store.state.data.entities.notes.n1.content, 'C', 'letzte lokale Folgeoperation gewinnt nicht');
eq(store.state.data.entities.notes.n1.updatedAt, '2026-08-29T10:05:00.000Z', 'Replay stempelt die Änderung mit der späteren Wiederverbindungszeit');
ok(!('_queue' in store.state.data.entities.notes.n1), 'Queue-Metadaten gelangen in die synchronisierte Entität');

// Server D ist nach beiden lokalen Basen entstanden: keine der veralteten
// Update-Operationen darf ihn überschreiben.
const serverD = note('n1', 'D vom Server', '2026-08-29T11:00:00.000Z');
store.state.data = snapshot([structuredClone(serverD)]);
const staleUpdates = store.replayPendingOperations([opAB, opBC]);
eq(staleUpdates.applied.length, 0, 'veraltete Updates werden trotz neuerem Serverstand angewendet');
eq(staleUpdates.skipped.length, 2, 'nicht alle veralteten Updates werden erkannt');
eq(store.state.data.entities.notes.n1.content, 'D vom Server', 'Offline-Update überschreibt den neueren Serverstand');

// Kaskadenkonflikt: D liegt zeitlich nach Basis A, aber vor dem lokalen B.
// Nachdem A→B verworfen wurde, darf B→C D nicht doch noch überschreiben.
const serverBetween = note('n1', 'D zwischen A und B', '2026-08-29T09:30:00.000Z');
store.state.data = snapshot([structuredClone(serverBetween)]);
const cascade = store.replayPendingOperations([opAB, opBC]);
eq(cascade.applied.length, 0, 'Folgeoperation einer verworfenen Basis wird trotzdem angewendet');
eq(cascade.skipped.length, 2, 'Kaskadenkonflikt verwirft nicht die gesamte abhängige Queue');
eq(store.state.data.entities.notes.n1.content, 'D zwischen A und B', 'B→C überschreibt D nach verworfenem A→B');

// Auch ein offline erzeugtes add mit inzwischen serverseitig belegter ID darf
// eine neuere Entität nicht ersetzen.
store.state.data = snapshot([]);
const staleAdd = store.preparePendingOp({ type: 'add-note', payload: note('n2', 'Offline add', '2026-08-29T10:00:00.000Z') }, '2026-08-29T10:00:00.000Z');
ok(staleAdd._queue.baseExists === false, 'neues add wird mit einer erfundenen Basis markiert');
store.state.data = snapshot([note('n2', 'Server add', '2026-08-29T11:00:00.000Z')]);
const addResult = store.replayPendingOperations([staleAdd]);
eq(addResult.skipped.length, 1, 'veraltetes add mit belegter ID wird nicht verworfen');
eq(store.state.data.entities.notes.n2.content, 'Server add', 'veraltetes add überschreibt die neuere Serverentität');

// Eine Singleton-Spiegelung wird auch über dedupeKey erkannt, wenn das andere
// Gerät eine abweichende ID verwendet hat.
store.state.data = snapshot([]);
const mirrorAdd = store.preparePendingOp({ type: 'add-note', payload: note('local-id', 'Offline mirror', '2026-08-29T10:00:00.000Z', { dedupeKey: 'ideas:i1', noteClass: 'idea', tags: ['Medien'] }) }, '2026-08-29T10:00:00.000Z');
store.state.data = snapshot([note('remote-id', 'Server mirror', '2026-08-29T11:00:00.000Z', { dedupeKey: 'ideas:i1', noteClass: 'idea', tags: ['Medien'] })]);
const mirrorResult = store.replayPendingOperations([mirrorAdd]);
eq(mirrorResult.skipped.length, 1, 'deduplizierte Singleton-Notiz erkennt den neueren Serverstand nicht');
ok(!store.state.data.entities.notes['local-id'] && store.state.data.entities.notes['remote-id'].content === 'Server mirror', 'Singleton-Replay erzeugt ein Duplikat');

// Kanonische Ideen erscheinen in der Inbox genau einmal und geplante Ideen
// verschwinden dort; die Legacy-Entität ist nur noch ein Migrationsverweis.
const idea = note('note_idea_i1', 'Neue Idee', '2026-08-29T10:00:00.000Z', {
  noteClass: 'idea', tags: ['Medien'], ideaMeta: { status: 'idea' },
  source: { app: 'ideas', entityType: 'idea', entityId: 'i1', label: 'Medien', route: '#/ideen' },
});
store.state.data = snapshot([idea, note('general', 'Allgemein', '2026-08-29T10:00:00.000Z')], {
  i1: { id: 'i1', title: 'Legacy', noteId: idea.id, status: 'idea' },
});
let inbox = store.getInboxItems();
eq(inbox.filter((item) => item.item.id === idea.id).map((item) => item.kind), ['idea'], 'kanonische Idee ist in der Inbox doppelt oder als generelle Notiz klassifiziert');
store.state.data.entities.notes[idea.id].ideaMeta.status = 'planned';
inbox = store.getInboxItems();
ok(!inbox.some((item) => item.item.id === idea.id), 'geplante kanonische Idee bleibt in der Inbox');

console.log(`Offline-Notiz-Replay: ok (${checks} Prüfungen)`);
