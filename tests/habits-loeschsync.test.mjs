/*
 * Nachweis: Was macht die Handy-App mit geloeschten Habits?
 * ---------------------------------------------------------------------------
 * Anlass (10.09.2026): In AI Sync (Desktop) und in der Tablet-Fassung kamen
 * geloeschte Habits nach dem Zusammenfuehren zurueck. Beide bekamen dafuer
 * Grabsteine. Die Frage an diese App: Traegt sie denselben Fehler — und muss
 * sie denselben Fix uebernehmen?
 *
 * Antwort, und genau das haelt dieser Test fest: NEIN, aus zwei Gruenden, die
 * in der Bauweise liegen und deshalb gepruefte Zusicherungen sein sollen:
 *
 *   1. Diese App fuehrt NICHTS zusammen. pullData() ersetzt den lokalen Stand
 *      durch den Serverstand; die vorgemerkten Operationen laufen danach
 *      darauf. Es gibt keinen Vereinigungsschritt, der eine fehlende id als
 *      "auf der Gegenseite neu" lesen koennte.
 *   2. applyHabitOp() legt nur bei 'add-habit' etwas an. Jede andere
 *      Operation sucht die Routine — und tut nichts, wenn sie fehlt
 *      (`if (!h) return;`). Ein nachgereichtes Abhaken kann eine anderswo
 *      geloeschte Routine also nicht wiederbeleben. Genau das war der Fehler
 *      der Tablet-Fassung.
 *
 * Dazu zwei Dinge, die nicht verloren gehen duerfen:
 *   · 'delete-habit' loescht hier NICHT hart, sondern archiviert. Die Routine
 *     und ihr ganzer Verlauf bleiben erhalten; sie verschwindet nur aus den
 *     Listen. Das bleibt so — hart loeschen wuerde Inhalte vernichten.
 *   · Die Grabsteine anderer Geraete (_deleteLog) reisen unveraendert mit:
 *     Diese App schreibt den ganzen Datenstand zurueck, den sie geladen hat.
 *     Wuerde sie das Feld verlieren, waeren Loeschungen aller Geraete weg.
 *
 * Und der Schutz in die andere Richtung: Aus dem blossen FEHLEN einer Routine
 * wird nie eine Loeschabsicht abgeleitet.
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

// ── 1. Ein nachgereichtes Abhaken belebt nichts wieder ────────────────────
// Der Serverstand kennt die Routine nicht mehr (auf dem Rechner geloescht).
// Die vorgemerkte Operation vom Handy trifft ins Leere — und darf nichts tun.
{
  store.state.data = stand([routine('rt_bleibt')]);
  store.applyOp({ type: 'toggle-habit', payload: { id: 'rt_weg', date: '2026-09-10' } });
  eq(store.state.data.dailyBriefing.routines.map(r => r.id), ['rt_bleibt'],
    'ein Abhaken legt die geloeschte Routine wieder an');

  store.applyOp({ type: 'update-habit', payload: { id: 'rt_weg', text: 'Zurueck?' } });
  eq(store.state.data.dailyBriefing.routines.map(r => r.id), ['rt_bleibt'],
    'eine Aenderung legt die geloeschte Routine wieder an');

  store.applyOp({ type: 'toggle-subunit', payload: { id: 'rt_weg', subUnitName: 'Schritt', date: '2026-09-10' } });
  eq(store.state.data.dailyBriefing.routines.map(r => r.id), ['rt_bleibt'],
    'ein Teilschritt legt die geloeschte Routine wieder an');
}

// ── 2. Vorgemerkte Operationen nach dem Serverabgleich ────────────────────
// Nach einem Konflikt (412) zieht die App den Serverstand neu und spielt die
// Warteschlange erneut ein. Auch dieser Weg darf nichts wiederbeleben.
{
  store.state.data = stand([routine('rt_bleibt')]);
  const ops = [
    store.preparePendingOp({ type: 'toggle-habit', payload: { id: 'rt_weg', date: '2026-09-10' } }, '2026-09-10T10:00:00.000Z'),
    store.preparePendingOp({ type: 'toggle-habit', payload: { id: 'rt_bleibt', date: '2026-09-10' } }, '2026-09-10T10:01:00.000Z'),
  ];
  store.replayPendingOperations(ops);
  eq(store.state.data.dailyBriefing.routines.map(r => r.id), ['rt_bleibt'],
    'das erneute Einspielen legt die geloeschte Routine wieder an');
  const bleibt = store.state.data.dailyBriefing.routines[0];
  eq((bleibt.completions || []).map(c => c.date), ['2026-09-10'],
    'das Abhaken der vorhandenen Routine geht beim erneuten Einspielen verloren');
}

// ── 3. 'delete-habit' archiviert — es loescht keine Inhalte ───────────────
{
  store.state.data = stand([routine('rt_1', { completions: [{ date: '2026-09-01', value: 1 }] })]);
  store.applyOp({ type: 'delete-habit', payload: { id: 'rt_1' } });
  const r = store.state.data.dailyBriefing.routines[0];
  ok(r && r.archived === true, 'die Routine wird nicht archiviert');
  eq((r.completions || []).length, 1, 'der Verlauf der Routine geht verloren');
  eq(store.getHabits().map(x => x.id), [], 'die archivierte Routine erscheint weiterhin in der Liste');
  eq(store.state.data.dailyBriefing.routines.length, 1,
    'die Routine wird hart geloescht — hier wird bewusst nur archiviert');
}

// ── 4. Grabsteine anderer Geraete reisen unveraendert mit ─────────────────
// Diese App schreibt den ganzen geladenen Datenstand zurueck. Verloere sie
// _deleteLog, waeren die Loeschungen von Rechner und Tablet wieder offen.
{
  const grabsteine = { routine: { rt_weg: 1789000000000 }, note: { n1: 1789000000000 } };
  store.state.data = stand([routine('rt_bleibt')], { _deleteLog: JSON.parse(JSON.stringify(grabsteine)) });
  store.applyOp({ type: 'toggle-habit', payload: { id: 'rt_bleibt', date: '2026-09-10' } });
  store.applyOp({ type: 'delete-habit', payload: { id: 'rt_bleibt' } });
  eq(store.state.data._deleteLog, grabsteine,
    'die Grabsteine der anderen Geraete werden beim Arbeiten veraendert oder verworfen');
  // Was hochgeschickt wird, ist genau dieser Stand — inklusive Grabsteinen.
  const koerper = JSON.parse(JSON.stringify(store.state.data));
  eq(koerper._deleteLog, grabsteine, 'der hochgeladene Stand traegt die Grabsteine nicht mehr');
}

// ── 5. Aus blossem Fehlen wird keine Loeschabsicht ────────────────────────
// Eine Routine, die diese App (noch) nicht kennt, wird nicht angetastet: Die
// App schreibt den Serverstand zurueck, den sie geladen hat, und entfernt
// nichts, das sie nur nicht anzeigt. Das gilt ausdruecklich auch fuer
// Loeschungen VOR der Grabstein-Einfuehrung — sie sind nirgends vermerkt, und
// nichts leitet daraus eine Absicht ab.
{
  store.state.data = stand([routine('rt_a'), routine('rt_b', { archived: true })]);
  store.applyOp({ type: 'toggle-habit', payload: { id: 'rt_a', date: '2026-09-10' } });
  eq(store.state.data.dailyBriefing.routines.map(r => r.id), ['rt_a', 'rt_b'],
    'eine nicht angezeigte (archivierte) Routine verschwindet aus dem Datenstand');
  eq(store.getHabits().map(r => r.id), ['rt_a'], 'die Liste zeigt die archivierte Routine');
}

// ── 6. Der Bauweise-Nachweis am Quelltext ─────────────────────────────────
// Die beiden Zusicherungen aus dem Kopf dieses Tests sind Eigenschaften des
// Codes, nicht Zufall. Wer sie aufhebt, soll hier scheitern.
{
  const quelle = await import('node:fs').then(fs => fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'));
  ok(/const h = rs\.find\(r => r\.id === payload\.id\);\s*\n\s*if \(!h\) return;/.test(quelle),
    'applyHabitOp legt bei einer unbekannten id wieder etwas an');
  ok(/if \(type === 'delete-habit'\) \{/.test(quelle) && /h\.archived = true;/.test(quelle),
    'delete-habit loescht nicht mehr weich — Inhalte koennten verloren gehen');
  ok(!/mergeData|mergePayloads/.test(quelle),
    'diese App fuehrt neuerdings selbst zusammen — dann braucht sie die Grabstein-Regel der anderen Apps');
  ok(/state\.data = JSON\.parse\(text\);/.test(quelle),
    'der Pull ersetzt den Stand nicht mehr — der Nachweis dieses Tests haengt daran');
}

console.log(`habits loeschsynchronisation (Handy): ok (${checks} Pruefungen)`);
