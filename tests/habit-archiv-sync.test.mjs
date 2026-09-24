/*
 * Archivierung eines Habits (delete-habit) trug im Handy-Store kein eigenes
 * updatedAt und keine archivedByUser-Kennzeichnung.
 * ---------------------------------------------------------------------------
 * Anlass: Am selben Tag (24.09.2026) wurde auf Desktop (ai-sync,
 * archiveHabit()/unarchiveHabit()) genau dieser Fehler live gefunden und
 * behoben — siehe ai-sync/tests/habit-archiv-nobraine.test.mjs. Routinen
 * (dailyBriefing.routines[]) sind ein gemeinsamer Datensatz aller drei Apps.
 * Diese Datei prueft, ob die Handy-App denselben Fehler in ihre eigene
 * Schreiboperation traegt — applyHabitOp() hier, nicht archiveHabit() dort.
 *
 * Befund VOR dem Fix: applyHabitOp() setzte bei 'delete-habit' ausschliesslich
 * `h.archived = true` — kein updatedAt, kein archivedByUser. Die Handy-App
 * fuehrt selbst nichts serverweit zusammen (pullData() ersetzt den Stand,
 * siehe tests/habits-loeschsync.test.mjs), ihre eigene Replay-Logik
 * (shouldSkipPendingOp/replayPendingOperations) bleibt davon unberuehrt, weil
 * 'habit' nicht in KIND_MAP steht und Habit-Operationen dort ohnehin nie als
 * Konflikt erkannt, sondern unbedingt erneut angewandt werden.
 *
 * Der Schaden entsteht auf der ANDEREN Seite des gemeinsamen Datensatzes:
 * Desktops eigener 3-Wege-Merge (mergeData() -> mergeRoutinesById()) waehlt
 * den Merge-Gewinner ueber updatedAt||createdAt. Archiviert das Handy eine
 * Routine ohne den Zeitstempel zu bumpen, tragen beide Seiten (die frische
 * Archivierung vom Handy und eine veraltete, noch aktive Kopie auf
 * Desktop/Tablet) denselben unveraenderten createdAt — der Merge kann die
 * Archivierung dann stillschweigend rueckgaengig machen, und die
 * No-Braine-Bruecke wuerde eine noch aktive externe Definition ohne
 * archivedByUser bei jedem Sync wieder aktivieren.
 *
 * Was hier gemessen wird, an den ECHTEN Funktionen aus js/store.js:
 *  1. applyOp('delete-habit') setzt archived, archivedByUser UND bumpt
 *     updatedAt — Feld-fuer-Feld-Paritaet mit Desktop.
 *  2. Der Zeitstempel eines Replays (nach einem 412-Konflikt) ist die
 *     tatsaechliche Warteschlangenzeit, nicht "jetzt" beim Neustart.
 *  3. update-habit/toggle-habit/toggle-subunit bumpen updatedAt ebenso —
 *     sonst koennte derselbe Merge-Vorrang ein abgehaktes "heute erledigt"
 *     verschlucken, nicht nur eine Archivierung.
 *  4. Der Verlauf (completions/subCompletions) bleibt beim Archivieren
 *     unangetastet — dies ist ausdruecklich ein Soft-Delete, kein Loeschen.
 *
 * Kein Browser, kein Netz.
 */
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

const store = await import('../js/store.js');
let checks = 0;
const ok = (value, message) => { checks++; assert.ok(value, message); };
const eq = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };

const routine = (id, extra = {}) => ({
  id, text: 'Routine ' + id, icon: '✅', frequency: 'daily', target: 1,
  archived: false, createdAt: '2026-01-05T08:00:00.000Z', completions: [], ...extra,
});
const stand = (routines, extra = {}) => ({
  entities: { tasks: {}, notes: {}, ideas: {}, notebooks: {}, books: {}, projects: {}, meetings: {}, timeEntries: {} },
  dailyBriefing: { routines },
  ...extra,
});

// ── 1. delete-habit setzt archivedByUser und bumpt updatedAt ──────────────
{
  store.state.data = stand([routine('rt_1', { completions: [{ date: '2026-09-20', value: 1 }] })]);
  const vor = Date.now();
  store.applyOp({ type: 'delete-habit', payload: { id: 'rt_1' } });
  const h = store.state.data.dailyBriefing.routines[0];
  eq(h.archived, true, 'delete-habit setzt archived nicht');
  eq(h.archivedByUser, true,
    'delete-habit setzt kein archivedByUser — Desktops No-Braine-Bruecke kann die Archivierung nicht von einer ' +
    'blossen Definitions-Deaktivierung unterscheiden (siehe ai-sync reconcileHabits())');
  ok(h.updatedAt && Date.parse(h.updatedAt) >= vor,
    'delete-habit bumpt updatedAt nicht — Desktops mergeRoutinesById() kann die Archivierung dann nicht als ' +
    'die neuere Aenderung gegenueber einer stehengebliebenen aktiven Kopie erkennen');
  eq(h.completions.length, 1, 'delete-habit ist ein Soft-Delete — der Verlauf darf nicht verloren gehen');
}

// ── 2. Der Zeitstempel eines Replays ist die Warteschlangenzeit ──────────
// Nach einem 412-Konflikt zieht die App den Serverstand neu und spielt die
// Warteschlange erneut ein (applyPendingChanges -> replayPendingOperations).
// Der geschriebene Zeitstempel muss die Zeit sein, zu der die Archivierung
// TATSAECHLICH ausgeloest wurde — sonst wuerde jeder Neustart/Replay die
// Archivierung faelschlich auf "jetzt" vordatieren und liesse sie im Merge
// juenger aussehen, als sie war.
{
  store.state.data = stand([routine('rt_2')]);
  const op = store.preparePendingOp({ type: 'delete-habit', payload: { id: 'rt_2' } }, '2026-09-20T10:00:00.000Z');
  const replay = store.replayPendingOperations([op]);
  eq(replay.applied.length, 1, 'die vorgemerkte Archivierung wird beim Replay nicht angewandt');
  const h = store.state.data.dailyBriefing.routines[0];
  eq(h.archived, true, 'die Archivierung ueberlebt das Replay nicht');
  eq(h.archivedByUser, true, 'archivedByUser ueberlebt das Replay nicht');
  eq(h.updatedAt, '2026-09-20T10:00:00.000Z',
    'das Replay stempelt die Archivierung nicht mit der tatsaechlichen Warteschlangenzeit');
}

// ── 3. update-habit, toggle-habit und toggle-subunit bumpen updatedAt ─────
// Derselbe Merge-Vorrang traefe nicht nur die Archivierung: ein am Handy
// abgehaktes "heute erledigt" ohne updatedAt-Bump koennte im Desktop-Merge
// ebenso gegen eine unveraenderte Kopie verlieren.
{
  store.state.data = stand([routine('rt_3')]);
  const vor = Date.now();
  store.applyOp({ type: 'update-habit', payload: { id: 'rt_3', text: 'Neuer Name' } });
  let h = store.state.data.dailyBriefing.routines[0];
  eq(h.text, 'Neuer Name', 'update-habit uebernimmt die Aenderung nicht');
  ok(h.updatedAt && Date.parse(h.updatedAt) >= vor, 'update-habit bumpt updatedAt nicht');

  store.state.data = stand([routine('rt_4')]);
  store.applyOp({ type: 'toggle-habit', payload: { id: 'rt_4', date: '2026-09-20' } });
  h = store.state.data.dailyBriefing.routines[0];
  ok(h.updatedAt && Date.parse(h.updatedAt) >= vor, 'toggle-habit bumpt updatedAt nicht');

  store.state.data = stand([routine('rt_5', { subUnits: [{ name: 'Schritt A' }], subCompletions: [] })]);
  store.applyOp({ type: 'toggle-subunit', payload: { id: 'rt_5', subUnitName: 'Schritt A', date: '2026-09-20' } });
  h = store.state.data.dailyBriefing.routines[0];
  ok(h.updatedAt && Date.parse(h.updatedAt) >= vor, 'toggle-subunit bumpt updatedAt nicht');
}

// ── 4. Am echten Quelltext: die drei Felder stehen zusammen in delete-habit ─
{
  const quelle = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'));
  const abschnitt = quelle.slice(quelle.indexOf("if (type === 'delete-habit')"), quelle.indexOf("if (type === 'toggle-habit')"));
  ok(/h\.archived = true;/.test(abschnitt), 'delete-habit setzt archived nicht (Quelltext)');
  ok(/h\.archivedByUser = true;/.test(abschnitt), 'delete-habit setzt archivedByUser nicht (Quelltext)');
  ok(/h\.updatedAt = mutationTime;/.test(abschnitt), 'delete-habit bumpt updatedAt nicht mit der echten Mutationszeit (Quelltext)');
}

console.log(`habit-archiv-sync (Handy): ok (${checks} Pruefungen)`);
