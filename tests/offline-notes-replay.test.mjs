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

// Nur die tatsächlich lokal geänderten Felder konkurrieren. Eine komplette
// Formular-Payload darf eine unabhängige Serveränderung nicht zurücksetzen.
const baseWithFavorite = note('merge', 'A', '2026-08-29T09:00:00.000Z', { favorite: false });
store.state.data = snapshot([structuredClone(baseWithFavorite)]);
const contentOnly = store.preparePendingOp({
  type: 'update-note',
  payload: { ...structuredClone(baseWithFavorite), title: 'B', content: 'B' },
}, '2026-08-29T10:00:00.000Z');
eq(contentOnly._queue.intentFields.sort(), ['content', 'title'], 'Queue speichert nicht nur die tatsächliche Feldabsicht');
store.state.data = snapshot([{ ...structuredClone(baseWithFavorite), favorite: true, updatedAt: '2026-08-29T11:00:00.000Z' }]);
const nonOverlap = store.replayPendingOperations([contentOnly]);
eq(nonOverlap.applied.length, 1, 'nicht überlappende Offline-Änderung wird verworfen');
eq([store.state.data.entities.notes.merge.content, store.state.data.entities.notes.merge.favorite], ['B', true], 'Remote- und Offline-Felder werden nicht verlustfrei gemergt');
eq(store.state.data.entities.notes.merge.updatedAt, '2026-08-29T11:00:00.000Z', 'neuere unabhängige Serverversion wird beim Merge zurückdatiert');

// Server D ist nach beiden lokalen Basen entstanden: keine der veralteten
// Update-Operationen darf ihn überschreiben.
const serverD = note('n1', 'D vom Server', '2026-08-29T11:00:00.000Z');
store.state.data = snapshot([structuredClone(serverD)]);
const staleUpdates = store.replayPendingOperations([opAB, opBC]);
eq(staleUpdates.applied.length, 0, 'veraltete Updates werden trotz neuerem Serverstand angewendet');
eq(staleUpdates.skipped.length, 2, 'nicht alle veralteten Updates werden erkannt');
eq(store.state.data.entities.notes.n1.content, 'D vom Server', 'Offline-Update überschreibt den neueren Serverstand');
ok(staleUpdates.skipped.every((record) => record.kind === 'local-superseded'), 'echte Feldkonflikte werden nicht als unterlegene lokale Fassung abgelegt');

// Kaskadenfall: D liegt zeitlich nach Basis A, aber VOR der lokalen
// Bearbeitung B. Vertragsregel des Notizkonzepts (Review P2-3): bei einer
// Feldkollision gewinnt der NEUERE Zeitstempel — die lokalen Bearbeitungen
// von 10:00/10:05 schlagen also das ältere D von 09:30, und D wandert als
// unterlegene Fassung vollständig in die Konfliktablage. (Vorher galt hier
// pauschal Server-wins; die Ablage war zudem unsichtbar.)
const serverBetween = note('n1', 'D zwischen A und B', '2026-08-29T09:30:00.000Z');
store.state.data = snapshot([structuredClone(serverBetween)]);
const cascade = store.replayPendingOperations([opAB, opBC]);
eq(cascade.applied.length, 2, 'neuere lokale Bearbeitungen gewinnen nicht gegen das ältere D');
eq(cascade.skipped.length, 1, 'die unterlegene Serverfassung D landet nicht genau einmal in der Ablage');
eq(cascade.skipped[0].kind, 'remote-superseded', 'D wird nicht als unterlegene Serverfassung markiert');
eq(cascade.skipped[0].snapshot && cascade.skipped[0].snapshot.content, 'D zwischen A und B', 'der D-Inhalt fehlt im Konflikt-Snapshot');
eq(store.state.data.entities.notes.n1.content, 'C', 'die jüngste lokale Bearbeitung setzt sich nicht durch');

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

// Beide Gerätefamilien verwenden historisch unterschiedliche Tombstones.
// Mobile liest alle Marker und schreibt beim Löschen die interoperable Form.
store.state.data = snapshot([
  note('tablet-status', 'weg', '2026-08-29T10:00:00.000Z', { status: 'deleted' }),
  note('tablet-time', 'weg', '2026-08-29T10:00:00.000Z', { deletedAt: '2026-08-29T10:00:00.000Z' }),
  note('mobile-flag', 'weg', '2026-08-29T10:00:00.000Z', { deleted: true }),
]);
eq(store.getNotes(), [], 'fremde Tombstone-Formen erscheinen als aktive Notizen');
store.state.data = snapshot([note('delete-me', 'weg', '2026-08-29T10:00:00.000Z')]);
store.applyOp({ type: 'delete-note', payload: { id: 'delete-me' }, _queue: { queuedAt: '2026-08-29T12:00:00.000Z' } });
const deleted = store.state.data.entities.notes['delete-me'];
ok(deleted.deleted && deleted.status === 'deleted' && deleted.deletedAt === '2026-08-29T12:00:00.000Z', 'Mobile-Delete schreibt keinen interoperablen Tombstone');
eq(store.getNotes(), [], 'mobil gelöschte Notiz bleibt in Accessors sichtbar');

const sourceText = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'));
ok(sourceText.includes('LS.pendingConflicts') && sourceText.includes("conflictRecord('local-superseded'") && sourceText.includes("conflictRecord('remote-superseded'"), 'unterlegene Fassungen (beide Richtungen) werden nicht separat abgelegt');

console.log(`Offline-Notiz-Replay: ok (${checks} Prüfungen)`);
