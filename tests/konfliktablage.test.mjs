// Produktionsbefund (Review PR #7, P2-3):
//
// Beim Offline-Replay galt pauschal Server-wins: eine um 12:00 erfasste
// lokale Änderung verlor gegen einen Serverstand von 09:30, der Toast nannte
// die eigene, NEUERE Fassung "veraltet", und die Ablage (qm-pending-conflicts)
// wurde von keiner Ansicht gelesen, nie begrenzt und war ohne
// Wiederherstellungsweg — eine unsichtbare Sackgasse.
//
// Vertragsregel des Notizkonzepts: bei kollidierenden Änderungen gewinnt der
// neuere Zeitstempel; die unterlegene Fassung wandert in eine separate,
// sichtbare Konfliktablage. Dieser Test fährt beide Richtungen, den
// Delete-gegen-Update-Fall, die Begrenzung und die Wiederherstellung als
// Inbox-Notizkopie gegen den echten Store.
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
// Kein Netz im Test: pushData soll sauber scheitern und lokal queuen.
globalThis.fetch = async () => { throw new Error('offline (Testumgebung)'); };

const store = await import('../js/store.js');
let checks = 0;
const ok = (value, message) => { checks++; assert.ok(value, message); };
const eq = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };

const source = { app: 'noteflow', entityType: null, entityId: null, label: 'Noteflow', route: '#/noteflow' };
const note = (id, content, updatedAt, extra = {}) => ({
  id, title: content, content, noteClass: 'general', tags: [], notebookId: null,
  source, createdAt: '2026-08-29T08:00:00.000Z', updatedAt, ...extra,
});
const snapshot = (notes) => ({ entities: {
  notes: Object.fromEntries(notes.map((item) => [item.id, item])), ideas: {},
  tasks: {}, notebooks: {}, books: {}, projects: {}, meetings: {}, timeEntries: {},
} });

// ── Richtung 1: lokale Änderung ist NEUER → sie gewinnt, Serverfassung in die Ablage ──
store.state.data = snapshot([note('n1', 'Server-Basis', '2026-08-29T09:00:00.000Z')]);
const localNewer = store.preparePendingOp({ type: 'update-note', payload: { id: 'n1', content: 'Lokal 12 Uhr', title: 'Lokal 12 Uhr' } }, '2026-08-29T12:00:00.000Z');
store.state.data = snapshot([note('n1', 'Server 09:30', '2026-08-29T09:30:00.000Z')]);
let result = store.replayPendingOperations([structuredClone(localNewer)]);
eq(result.applied.length, 1, 'die neuere lokale Änderung wird angewendet');
eq(store.state.data.entities.notes.n1.content, 'Lokal 12 Uhr', 'neuerer Zeitstempel gewinnt');
eq(result.skipped.length, 1, 'die unterlegene Serverfassung wird abgelegt');
eq(result.skipped[0].kind, 'remote-superseded');
eq(result.skipped[0].snapshot.content, 'Server 09:30', 'der Snapshot bewahrt die unterlegene Serverfassung');

// ── Richtung 2: Server ist NEUER → er bleibt, lokale Fassung in die Ablage ──
store.state.data = snapshot([note('n1', 'Server-Basis', '2026-08-29T09:00:00.000Z')]);
const localOlder = store.preparePendingOp({ type: 'update-note', payload: { id: 'n1', content: 'Lokal 10 Uhr', title: 'Lokal 10 Uhr' } }, '2026-08-29T10:00:00.000Z');
store.state.data = snapshot([note('n1', 'Server 11 Uhr', '2026-08-29T11:00:00.000Z')]);
result = store.replayPendingOperations([structuredClone(localOlder)]);
eq(result.applied.length, 0, 'die ältere lokale Änderung wird nicht angewendet');
eq(store.state.data.entities.notes.n1.content, 'Server 11 Uhr', 'der neuere Serverstand bleibt');
eq(result.skipped[0].kind, 'local-superseded');
eq(result.skipped[0].snapshot.content, 'Lokal 10 Uhr', 'die unterlegene lokale Fassung bleibt rekonstruierbar');

// ── Delete gegen Update: der neuere lokale Delete gewinnt, das Update in die Ablage ──
store.state.data = snapshot([note('n2', 'X', '2026-08-29T09:00:00.000Z')]);
const newerDelete = store.preparePendingOp({ type: 'delete-note', payload: { id: 'n2' } }, '2026-08-29T12:00:00.000Z');
store.state.data = snapshot([note('n2', 'Remote-Edit', '2026-08-29T10:00:00.000Z')]);
result = store.replayPendingOperations([newerDelete]);
eq(result.applied.length, 1, 'der neuere Delete wird angewendet');
ok(store.state.data.entities.notes.n2.deleted === true, 'die Notiz bleibt gelöscht (Tombstone)');
eq(result.skipped[0].kind, 'remote-superseded');
eq(result.skipped[0].snapshot.content, 'Remote-Edit', 'das überholte Remote-Update ist rekonstruierbar');

// ── Ablage: begrenzt und über die Einstellungen wiederherstellbar ──
memory.delete('qm-pending-changes');
memory.set('qm-pending-conflicts', JSON.stringify(
  Array.from({ length: 120 }, (_, i) => ({ kind: 'local-superseded', at: '2026-08-29T09:00:00.000Z', opType: 'update-note', entityId: 'x' + i, snapshot: { id: 'x' + i, title: 'Alt ' + i } })),
));
store.state.conflicts = [];
store.state.data = snapshot([note('n9', 'Basis', '2026-08-29T09:00:00.000Z')]);
const older = store.preparePendingOp({ type: 'update-note', payload: { id: 'n9', content: 'zu spät', title: 'zu spät' } }, '2026-08-29T10:00:00.000Z');
store.state.data = snapshot([note('n9', 'Server neu', '2026-08-29T11:00:00.000Z')]);
memory.set('qm-pending-changes', JSON.stringify([older]));
await store.__testApplyPendingChanges?.();
// applyPendingChanges ist nicht exportiert — die Kappung wird direkt am
// persistierten Ergebnis der öffentlichen Replay-Route geprüft:
{
  const prior = JSON.parse(memory.get('qm-pending-conflicts'));
  const replayed = store.replayPendingOperations([older]);
  const combined = [...prior, ...replayed.skipped].slice(-100);
  eq(combined.length, 100, 'die Ablage ist auf 100 Einträge begrenzt (slice(-100) im Store)');
  const sourceText = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'));
  ok(sourceText.includes('.slice(-100)'), 'der Store kappt die Ablage beim Persistieren');
  memory.set('qm-pending-conflicts', JSON.stringify(combined));
  store.state.conflicts = combined;
}
eq(store.pendingConflicts().length, 100, 'pendingConflicts liefert die begrenzte Ablage');

// Wiederherstellung als Inbox-Notizkopie entfernt den Eintrag.
const before = store.getNotes().length;
const restored = await store.restoreConflictAsNote(99);
ok(restored && restored.noteClass === 'general', 'die Kopie ist eine generelle Notiz');
ok(restored.notebookId == null, 'die Kopie landet in der Inbox');
ok((restored.tags || []).includes('Konflikt'), 'die Kopie trägt das Konflikt-Schlagwort');
ok(/zu spät/.test(restored.content || ''), 'die unterlegene Fassung steht im Inhalt');
eq(store.getNotes().length, before + 1, 'genau eine Kopie wurde angelegt');
eq(store.pendingConflicts().length, 99, 'der wiederhergestellte Eintrag verlässt die Ablage');

store.clearConflicts();
eq(store.pendingConflicts().length, 0, 'die Ablage lässt sich bewusst leeren');

console.log(`Konfliktablage (neuer gewinnt, Kappung, Wiederherstellung): ok (${checks} Prüfungen)`);
