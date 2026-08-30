// ============================================================================
//  Quantus Mobile — Store & Sync-Engine
//  ---------------------------------------------------------------------------
//  Portiert 1:1 die bewährte Sync-Engine der alten Mobile-App:
//   • Netlify-Blobs Pull/Push gegen denselben Quantus-Blob (app-data.json)
//   • ETag / If-Match Optimistic-Concurrency
//   • Offline-Queue (_pendingChanges) mit Replay
//   • Write-Protection: kein Push vor erstem erfolgreichen Pull
//  Erweitert um alle Konzept-Entitäten sowie die Sonderpfade
//   • Gewohnheiten  → data.dailyBriefing.routines[]
//   • Flashcards    → data.recallLabData { decks, cards, ... }
//  ---------------------------------------------------------------------------
//  Kein Datenverlust: unbekannte Felder/Entitäten bleiben unangetastet; es
//  werden nur gezielte Mutationen über applyOp() ausgeführt.
// ============================================================================
import { LS, getBaseUrl, getBlobKey } from './config.js';
import { nowISO, toast, todayYmd, newId } from './util.js';
import {
  migrateNotesData, migrateNote, createCanonicalNote, collectTags,
  noteSourceMatches, bookStatus,
  ideaStatusFromShared,
} from './notes.js';

export const state = {
  data: null,
  etag: null,
  pending: [],
  conflicts: [],
  syncing: false,
  initialPullDone: false,          // Schutz: nie pushen, bevor Server-Daten gesehen wurden
  initialPullStatus: 'pending',    // pending | ok | empty | failed
  noteMigrationPending: false,
  replayPending: false,
};

// Beobachter, die bei Datenänderung neu rendern sollen (Router setzt einen).
const _subscribers = new Set();
export function subscribe(fn) { _subscribers.add(fn); return () => _subscribers.delete(fn); }
export function notify() { _subscribers.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

// Sync-Status-Anzeige (Header-Chip); Shell registriert den Handler.
let _statusHandler = null;
export function onSyncStatus(fn) { _statusHandler = fn; }
export function setSyncStatus(stateName, text) { if (_statusHandler) _statusHandler(stateName, text); }

function emptySkeleton() {
  return { entities: {
    tasks: {}, notes: {}, ideas: {}, notebooks: {}, books: {}, projects: {}, meetings: {},
    timeEntries: {}, scheduledMessages: {},
  } };
}

// ─────────────────────────────────────────────────────────────
//  PULL
// ─────────────────────────────────────────────────────────────
export async function pullData(silent = false) {
  if (state.syncing) return;
  state.syncing = true;
  if (!silent) setSyncStatus('syncing', 'Lade…');
  try {
    const url = getBaseUrl() + '/.netlify/functions/blob-get?key=' + encodeURIComponent(getBlobKey()) + '&_ts=' + Date.now();
    const r = await fetch(url, { method: 'GET', cache: 'no-store' });

    if (r.status === 404) {
      state.data = emptySkeleton();
      state.etag = null;
      state.initialPullDone = true;
      state.initialPullStatus = 'empty';
      setSyncStatus('warn', 'Leer');
      notify();
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);

    const text = await r.text();
    state.data = JSON.parse(text);
    const migration = migrateNotesData(state.data);
    state.noteMigrationPending = migration.changed;
    state.etag = r.headers.get('ETag') || r.headers.get('etag');
    try {
      localStorage.setItem(LS.lastData, JSON.stringify(state.data));
      if (state.etag) localStorage.setItem(LS.lastEtag, state.etag);
    } catch (e) { /* Quota — ignorieren, Cache ist optional */ }

    state.initialPullDone = true;
    state.initialPullStatus = 'ok';

    await applyPendingChanges();
    setSyncStatus('ok', 'Synced');
    notify();
  } catch (e) {
    console.error('Pull failed:', e);
    setSyncStatus('error', 'Offline');
    const cached = localStorage.getItem(LS.lastData);
    if (cached) {
      try {
        state.data = JSON.parse(cached);
        migrateNotesData(state.data);
        state.etag = localStorage.getItem(LS.lastEtag);
        // Cache laden, aber initialPullDone bleibt false → Schreibschutz aktiv
        state.initialPullStatus = 'failed';
        notify();
        if (!silent) toast('Offline — letzte gespeicherte Version. Schreibschutz aktiv.', 'warn');
      } catch (_) {
        state.data = emptySkeleton();
        state.initialPullStatus = 'failed';
        notify();
      }
    } else {
      state.data = emptySkeleton();
      state.initialPullStatus = 'failed';
      notify();
      if (!silent) toast('Verbindung fehlgeschlagen', 'error');
    }
  } finally {
    state.syncing = false;
    // Alte Notizen/Bücher werden nach einem erfolgreichen Pull genau einmal
    // zurückgeschrieben. Ein ETag-Konflikt zieht erneut und migriert wieder;
    // die Migration ist idempotent und erzeugt deshalb keine Duplikate.
    if ((state.noteMigrationPending || state.replayPending) && state.initialPullDone) {
      state.noteMigrationPending = false;
      state.replayPending = false;
      setTimeout(() => { pushData(); }, 0);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  PUSH
// ─────────────────────────────────────────────────────────────
export async function pushData() {
  if (!state.data || state.syncing) return false;
  if (!state.initialPullDone) {
    console.warn('[push] blocked — initial pull not done. Queueing.');
    savePending();
    setSyncStatus('warn', 'Pull fehlt');
    return false;
  }
  state.syncing = true;
  setSyncStatus('syncing', 'Speichern…');
  try {
    state.data.updatedAt = nowISO();
    // meta.lastSavedBy ist der EINZIGE Fremdgeraete-Marker, den der Desktop
    // auswertet (ai-sync public/index.html: pullAndMergeBeforeSave und
    // rtdbJsonPut vergleichen meta.lastSavedBy mit der eigenen Geraete-Id).
    // Ohne eigenen Wert blieb hier die Id des Desktops stehen: er las seine
    // eigene Kennung zurueck, hielt den Stand fuer selbst geschrieben,
    // uebersprang den Merge und ueberschrieb Aenderungen vom Handy.
    if (!state.data.meta || typeof state.data.meta !== 'object') state.data.meta = {};
    state.data.meta.updatedAt = state.data.updatedAt;
    state.data.meta.lastSavedBy = 'mobile-app';

    const url = getBaseUrl() + '/.netlify/functions/blob-put?key=' + encodeURIComponent(getBlobKey());
    const headers = { 'Content-Type': 'application/json' };
    if (state.etag) headers['If-Match'] = state.etag;

    const body = JSON.stringify(state.data);
    const r = await fetch(url, { method: 'PUT', headers, body });

    if (r.status === 412) {
      // Die gerade lokal angewendeten Operationen müssen den Konflikt-Pull
      // überleben. Ohne vorheriges Persistieren würde der frische Snapshot
      // state.data ersetzen, bevor applyPendingChanges sie erneut einspielt.
      savePending();
      toast('Konflikt — synchronisiere…', 'warn');
      state.syncing = false;
      await pullData(true);
      return false;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);

    const newEtag = r.headers.get('ETag') || r.headers.get('etag');
    if (newEtag) { state.etag = newEtag; try { localStorage.setItem(LS.lastEtag, newEtag); } catch (e) {} }
    try { localStorage.setItem(LS.lastData, body); } catch (e) {}
    state.pending = [];
    localStorage.removeItem(LS.pending);
    setSyncStatus('ok', 'Synced');
    return true;
  } catch (e) {
    console.error('Push failed:', e);
    setSyncStatus('error', 'Offline');
    savePending();
    toast('Offline gespeichert', 'warn');
    return false;
  } finally { state.syncing = false; }
}

function savePending() {
  if (state.pending.length > 0) {
    try { localStorage.setItem(LS.pending, JSON.stringify(state.pending)); } catch (e) {}
  }
}

function stableSerialize(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',') + '}';
}

function entityFingerprint(entity) {
  const input = stableSerialize(entity); let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fieldFingerprint(value) {
  return entityFingerprint({ value });
}

function entityVersion(entity) {
  return entity && (entity.updatedAt || entity.modifiedAt || entity.createdAt) || null;
}

function validTime(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function operationParts(op) {
  const [verb, ...rest] = String(op && op.type || '').split('-');
  return { verb, kind: rest.join('-') };
}

function pendingTarget(op, data = state.data) {
  const { kind } = operationParts(op);
  const collectionName = KIND_MAP[kind];
  const payload = op && op.payload;
  const collection = data && data.entities && collectionName && data.entities[collectionName];
  if (!payload || !collection || typeof collection !== 'object') return null;
  if (payload.id && collection[payload.id]) return collection[payload.id];
  if (kind === 'note' && payload.dedupeKey) {
    return Object.values(collection).find((note) => note && note.dedupeKey === payload.dedupeKey) || null;
  }
  return null;
}

/**
 * Persistiert den Zeitpunkt und die tatsächlich gelesene Basisversion jeder
 * lokalen Operation. Diese Metadaten bleiben ausschließlich in der lokalen
 * Offline-Queue und gelangen nie in eine Entität oder in den Server-Snapshot.
 */
export function preparePendingOp(op, queuedAt = nowISO()) {
  if (!op || typeof op !== 'object' || op._queue) return op;
  const target = pendingTarget(op);
  const { verb } = operationParts(op);
  const payload = op.payload && typeof op.payload === 'object' ? { ...op.payload } : op.payload;
  const ignored = new Set(['id', 'createdAt', 'updatedAt', 'modifiedAt']);
  const intentFields = verb === 'update' && target && payload && typeof payload === 'object'
    ? Object.keys(payload).filter((key) => !ignored.has(key)
      && fieldFingerprint(payload[key]) !== fieldFingerprint(target[key]))
    : [];
  const baseFields = Object.fromEntries(intentFields.map((key) => [key, fieldFingerprint(target[key])]));
  return {
    ...op,
    payload,
    _queue: {
      version: 2,
      queuedAt,
      baseExists: !!target,
      baseUpdatedAt: entityVersion(target),
      baseFingerprint: target ? entityFingerprint(target) : null,
      intentFields,
      baseFields,
    },
  };
}

/** Server-wins nur dann, wenn der gezogene Stand nachweislich neuer ist. */
export function shouldSkipPendingOp(op, remoteEntity) {
  const { verb } = operationParts(op);
  if (!['add', 'update', 'delete'].includes(verb)) return false;
  const queue = op && op._queue;
  if (!remoteEntity) return !!(queue && queue.baseExists && (verb === 'update' || verb === 'delete'));
  const remoteVersion = entityVersion(remoteEntity);
  const remoteTime = validTime(remoteVersion);

  if (queue && Number(queue.version) >= 1) {
    const baseTime = validTime(queue.baseUpdatedAt);
    if (!queue.baseExists) {
      // Die ID/Dedupe-Entität entstand während der Offline-Phase auf einem
      // anderen Gerät. Allein ihre Existenz beweist eine Änderung gegenüber
      // der gelesenen Basis; bei einer Kollision bleibt deshalb der Server.
      return true;
    }
    if (Number(queue.version) >= 2 && verb === 'update' && Array.isArray(queue.intentFields)) {
      return queue.intentFields.some((key) => fieldFingerprint(remoteEntity[key]) !== queue.baseFields[key]);
    }
    // Der Fingerprint ist die eigentliche Basisversion. Er macht auch einen
    // Konflikt in einer Kette sichtbar: Wird A→B verworfen, darf B→C nicht
    // allein über dem fremden D landen – D entspricht dem gespeicherten B-
    // Fingerprint nicht, selbst wenn sein Zeitstempel vor B liegt.
    if (queue.baseFingerprint) return entityFingerprint(remoteEntity) !== queue.baseFingerprint;
    if (remoteTime != null && baseTime != null) {
      if (remoteTime > baseTime) return true;
      if (remoteTime < baseTime) return false; // Basis enthält frühere lokale Queue-Operationen.
    }
    return remoteVersion !== queue.baseUpdatedAt;
  }

  // Rückwärtskompatibilität für alte, noch unversionierte Queues: nur dann
  // anwenden, wenn ihr Payload nachweislich neuer als der Serverstand ist.
  const payloadTime = validTime(op && op.payload && (op.payload.updatedAt || op.payload.createdAt));
  return remoteTime != null && payloadTime != null ? remoteTime > payloadTime : true;
}

function replayIntent(op, remoteEntity) {
  const queue = op && op._queue;
  const { verb } = operationParts(op);
  if (verb !== 'update' || !queue || Number(queue.version) < 2 || !Array.isArray(queue.intentFields)) return op;
  const payload = { id: op.payload && op.payload.id };
  queue.intentFields.forEach((key) => { payload[key] = op.payload[key]; });
  if (op.payload && op.payload.dedupeKey && !Object.prototype.hasOwnProperty.call(payload, 'dedupeKey')) {
    payload.dedupeKey = op.payload.dedupeKey;
  }
  const remoteTime = validTime(entityVersion(remoteEntity));
  const queuedTime = validTime(queue.queuedAt);
  const effectiveTime = remoteTime != null && (queuedTime == null || remoteTime > queuedTime)
    ? entityVersion(remoteEntity)
    : queue.queuedAt;
  return { ...op, payload, _queue: { ...queue, queuedAt: effectiveTime } };
}

// Ein Konflikt-Eintrag hält die UNTERLEGENE Fassung fest — als Datensatz,
// nicht als Operation, damit die Einstellungen sie anzeigen und als Kopie
// wiederherstellen können (Review P2-3: die Ablage war eine unsichtbare
// Sackgasse und wuchs unbegrenzt).
function conflictRecord(kind, op, baseline) {
  const payload = op && op.payload && typeof op.payload === 'object' ? op.payload : {};
  return {
    kind, // 'local-superseded' (Server war neuer) | 'remote-superseded' (lokal war neuer)
    at: nowISO(),
    opType: (op && op.type) || '',
    entityId: payload.id || null,
    queuedAt: (op && op._queue && op._queue.queuedAt) || null,
    snapshot: kind === 'local-superseded' ? payload : (baseline || null),
  };
}

export function replayPendingOperations(ops) {
  const list = Array.isArray(ops) ? ops.filter(Boolean) : [];
  const applied = []; const conflicts = [];
  list.forEach((op) => {
    // Unmittelbar vor jeder Operation prüfen: Nach A→B muss die Basis der
    // nächsten lokalen Operation B→C gegen B laufen. Ist der Server bereits
    // auf D, bleibt D stehen und beide veralteten Schritte werden verworfen.
    const current = pendingTarget(op);
    const baseline = current ? JSON.parse(JSON.stringify(current)) : null;
    if (shouldSkipPendingOp(op, baseline)) {
      // Vertragsregel (Review P2-3): kollidieren zwei Fassungen, gewinnt der
      // NEUERE Zeitstempel — nicht pauschal der Server. Die unterlegene
      // Fassung wandert in jedem Fall in die Konfliktablage.
      const queue = (op && op._queue) || {};
      const opTime = validTime(queue.queuedAt)
        ?? validTime(op && op.payload && (op.payload.updatedAt || op.payload.createdAt));
      const remoteTime = validTime(entityVersion(baseline));
      const localNewer = !!baseline && queue.baseExists !== false
        && opTime != null && remoteTime != null && opTime > remoteTime;
      if (localNewer) {
        conflicts.push(conflictRecord('remote-superseded', op, baseline));
        const next = replayIntent(op, baseline);
        applyOp(next);
        applied.push(next);
      } else {
        conflicts.push(conflictRecord('local-superseded', op, baseline));
      }
    } else {
      const next = replayIntent(op, baseline);
      applyOp(next);
      applied.push(next);
    }
  });
  return { applied, skipped: conflicts };
}

async function applyPendingChanges() {
  const stored = localStorage.getItem(LS.pending);
  if (!stored) return;
  try {
    const ops = JSON.parse(stored);
    if (!ops || !ops.length) return;
    // Der Server-Snapshot ist wieder die Basis. Die gespeicherte Queue wird
    // genau einmal darüber gelegt und erst NACH Ende des Pulls gepusht (während
    // state.syncing würde pushData den Schreibversuch korrekt blockieren).
    const replay = replayPendingOperations(ops);
    state.pending = replay.applied.slice();
    const priorConflicts = (() => {
      try { return JSON.parse(localStorage.getItem(LS.pendingConflicts) || '[]'); } catch (_) { return []; }
    })();
    // Begrenzt auf die letzten 100 Einträge — die Ablage ist ein Sichtfenster
    // mit Wiederherstellung, kein unbegrenztes Archiv.
    state.conflicts = [...(Array.isArray(priorConflicts) ? priorConflicts : []), ...replay.skipped].slice(-100);
    if (state.conflicts.length) localStorage.setItem(LS.pendingConflicts, JSON.stringify(state.conflicts));
    if (state.pending.length) {
      savePending();
      state.replayPending = true;
    } else localStorage.removeItem(LS.pending);
    if (replay.skipped.length) {
      console.warn('[pending] conflicts stored', replay.skipped.map((record) => `${record.kind}:${record.opType}`));
      toast(`${replay.skipped.length} Sync-Konflikt(e) — unterlegene Fassung liegt in den Einstellungen`, 'warn');
    }
  } catch (e) { console.error('Pending replay failed:', e); }
}

// Öffentlicher Mutations-Einstieg: lokal anwenden, rendern, dann pushen.
export async function performOp(op) {
  if (!state.data) return;
  const pendingOp = preparePendingOp(op);
  applyOp(pendingOp);
  state.pending.push(pendingOp);
  notify();
  const ok = await pushData();
  if (!ok) savePending();
}

export async function manualSync() { await pullData(); }
export function pendingCount() { return state.pending.length; }
export function pendingConflicts() {
  if (state.conflicts.length) return state.conflicts.slice();
  try {
    const stored = JSON.parse(localStorage.getItem(LS.pendingConflicts) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch (_) { return []; }
}
export function pullStatus() { return state.initialPullStatus; }

// Konfliktablage: unterlegene Fassung als neue Inbox-Notiz zurückholen bzw.
// die Ablage bewusst leeren (Review P2-3 — vorher unsichtbare Sackgasse).
export async function restoreConflictAsNote(index) {
  const conflicts = pendingConflicts();
  const record = conflicts[index];
  if (!record) return null;
  const snap = (record.snapshot && typeof record.snapshot === 'object' ? record.snapshot : null)
    || (record.payload && typeof record.payload === 'object' ? record.payload : null) || {};
  const title = 'Konfliktkopie: ' + String(snap.title || snap.content || record.opType || 'Änderung').replace(/\s+/g, ' ').slice(0, 60);
  const skip = new Set(['id', '_queue', 'createdAt', 'updatedAt']);
  const lines = Object.entries(snap)
    .filter(([key, value]) => !skip.has(key) && value != null && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  const note = await saveCanonicalNote({
    noteClass: 'general',
    title,
    content: lines.join('\n') || JSON.stringify(record, null, 2),
    tags: ['Konflikt'],
    notebookId: null,
    source: { app: 'noteflow', entityType: 'note', entityId: null, label: 'Konfliktablage', route: '#/noteflow' },
  });
  const rest = conflicts.filter((_, i) => i !== index);
  state.conflicts = rest;
  if (rest.length) localStorage.setItem(LS.pendingConflicts, JSON.stringify(rest));
  else localStorage.removeItem(LS.pendingConflicts);
  return note;
}
export function clearConflicts() {
  state.conflicts = [];
  localStorage.removeItem(LS.pendingConflicts);
  notify();
}

// ─────────────────────────────────────────────────────────────
//  applyOp — mutiert state.data verlustfrei
// ─────────────────────────────────────────────────────────────
// Entitäts-Ops folgen dem Muster '<verb>-<kind>' mit verb add|update|delete.
const KIND_MAP = {
  task: 'tasks', note: 'notes', idea: 'ideas', notebook: 'notebooks',
  book: 'books', message: 'scheduledMessages',
  project: 'projects', meeting: 'meetings', transaction: 'transactions',
  account: 'accounts', goal: 'goals', decision: 'decisions',
  // Funktionsparität mit Desktop und Tablet: alle weiteren Sammlungen
  strategy: 'strategies', concept: 'concepts', program: 'programs',
  organization: 'organizations', person: 'persons', protocol: 'protocols',
  workflow: 'workflows', article: 'articles', thesis: 'theses',
  event: 'calendarEvents', measure: 'measures', update: 'updates',
};

function ents() {
  if (!state.data.entities) state.data.entities = {};
  return state.data.entities;
}
function ensureColl(name) {
  const E = ents();
  if (!E[name]) E[name] = {};
  return E[name];
}

export function applyOp(op) {
  if (!state.data) return;
  const t = op.type || '';
  const [verb, ...rest] = t.split('-');
  const kind = rest.join('-');
  const mutationTime = op._queue && validTime(op._queue.queuedAt) != null ? op._queue.queuedAt : nowISO();

  // ── Standard-Entitäten (Dictionary nach ID, Soft-Delete) ──
  if (KIND_MAP[kind]) {
    const coll = ensureColl(KIND_MAP[kind]);
    if (verb === 'add') {
      if (kind === 'note') {
        // Auch alte oder noch nicht aktualisierte Views können keine rohe,
        // unklassifizierte Notiz mehr in den gemeinsamen Bestand schreiben.
        const next = migrateNote(op.payload);
        const duplicate = next.dedupeKey && Object.values(coll).find(n => n && !isDeleted(n) && n.dedupeKey === next.dedupeKey);
        if (duplicate) Object.assign(duplicate, next, { id: duplicate.id, createdAt: duplicate.createdAt || next.createdAt, updatedAt: mutationTime });
        else coll[next.id] = next;
      } else if (kind === 'book') coll[op.payload.id] = { ...op.payload, status: bookStatus(op.payload.status) };
      else coll[op.payload.id] = op.payload;
    }
    else if (verb === 'update') {
      const cur = coll[op.payload.id];
      if (kind === 'note') {
        const next = migrateNote(cur ? { ...cur, ...op.payload } : op.payload);
        coll[next.id] = { ...(cur || {}), ...next, updatedAt: mutationTime };
      } else if (kind === 'book') {
        coll[op.payload.id] = { ...(cur || {}), ...op.payload, status: bookStatus(op.payload.status || (cur && cur.status)), updatedAt: mutationTime };
      } else if (cur) Object.assign(cur, op.payload, { updatedAt: mutationTime });
      else coll[op.payload.id] = op.payload;
    } else if (verb === 'delete') {
      // Soft-Delete (Quantus nutzt Tombstones/Flags) statt hartem Entfernen
      const cur = coll[op.payload.id];
      if (cur) {
        cur.deleted = true;
        cur.status = 'deleted';
        cur.deletedAt = mutationTime;
        cur.updatedAt = mutationTime;
      }
    }
    return;
  }

  // ── Zeit-/Fokus-Sitzung ──
  if (t === 'add-time-entry') { ensureColl('timeEntries')[op.payload.id] = op.payload; return; }

  // ── Gewohnheiten (Sonderpfad: dailyBriefing.routines[]) ──
  if (t === 'add-habit' || t === 'update-habit' || t === 'delete-habit' || t === 'toggle-habit'
      || t === 'toggle-subunit') {
    applyHabitOp(t, op.payload);
    return;
  }

  // ── Daily Briefing: die schreibenden Teile ──
  // Notiz und Tagesziel gehoeren zum Tag, nicht zu einer Entitaet. Beide
  // schreiben in dieselben Felder wie die Hauptapp — dailyBriefing.dailyLog
  // bzw. dailyGoals[<datum>].
  if (t === 'briefing-note') {
    if (!state.data.dailyBriefing) state.data.dailyBriefing = {};
    const db2 = state.data.dailyBriefing;
    if (!db2.dailyLog || typeof db2.dailyLog !== 'object') db2.dailyLog = {};
    const tag = op.payload.date || todayYmd();
    if (!db2.dailyLog[tag] || typeof db2.dailyLog[tag] !== 'object') db2.dailyLog[tag] = { routineChecks: {}, notes: '' };
    db2.dailyLog[tag].notes = String(op.payload.text || '');
    return;
  }
  if (t === 'add-daygoal' || t === 'toggle-daygoal' || t === 'delete-daygoal') {
    if (!state.data.dailyGoals || typeof state.data.dailyGoals !== 'object') state.data.dailyGoals = {};
    const tag = op.payload.date || todayYmd();
    if (!Array.isArray(state.data.dailyGoals[tag])) state.data.dailyGoals[tag] = [];
    const liste = state.data.dailyGoals[tag];
    if (t === 'add-daygoal') {
      liste.push({ id: op.payload.id, title: String(op.payload.title || ''), completed: false, createdAt: new Date().toISOString() });
      return;
    }
    const g = liste.find(x => x && x.id === op.payload.id);
    if (!g) return;
    if (t === 'toggle-daygoal') { g.completed = !g.completed; return; }
    const i = liste.indexOf(g);
    if (i >= 0) liste.splice(i, 1);
    return;
  }
  if (t === 'add-thought' || t === 'delete-thought') {
    if (!state.data.journal || typeof state.data.journal !== 'object') state.data.journal = {};
    if (!Array.isArray(state.data.journal.topics)) state.data.journal.topics = [];
    const ts = state.data.journal.topics;
    if (t === 'add-thought') { ts.push({ id: op.payload.id, text: String(op.payload.text || ''), createdAt: new Date().toISOString() }); return; }
    const i = ts.findIndex(x => x && x.id === op.payload.id);
    if (i >= 0) ts.splice(i, 1);
    return;
  }

  // ── Flashcards (Sonderpfad: recallLabData.decks/cards) ──
  if (t === 'add-flashcard' || t === 'update-flashcard' || t === 'review-flashcard' || t === 'add-deck') {
    applyFlashcardOp(t, op.payload);
    return;
  }

  // ── FlowerTech (Offerten, Rechnungen, Finanzen, Notizen) ──
  if (t.startsWith('ft-')) { applyFlowerTechOp(t, op.payload); return; }

  // ── Polaris-Chatverlauf (aiChats[]) ──
  if (t === 'add-chat') { if (!state.data.aiChats) state.data.aiChats = []; state.data.aiChats.unshift(op.payload); return; }
  if (t === 'add-chat-message') {
    const chat = (state.data.aiChats || []).find(c => c.id === op.payload.chatId);
    if (chat) { chat.messages = chat.messages || []; chat.messages.push(op.payload.message); chat.updatedAt = nowISO(); }
    return;
  }

  console.warn('applyOp: unbekannter op-type', t);
}

// ── FlowerTech-Sonderpfad (data.flowertech.*) ────────────────────────────────
// Dieselbe Struktur wie in Quantus: Offerten/Rechnungen sind Arrays von
// Dokumenten mit Positionen. Es werden ausschliesslich gezielte Mutationen
// ausgeführt, damit unbekannte Felder erhalten bleiben.
function flowertech() {
  if (!state.data.flowertech || typeof state.data.flowertech !== 'object') state.data.flowertech = {};
  const ft = state.data.flowertech;
  ['offers', 'invoices', 'finances', 'notes', 'links'].forEach(k => {
    if (!Array.isArray(ft[k])) ft[k] = [];
  });
  if (!ft.counters || typeof ft.counters !== 'object') ft.counters = {};
  if (!ft.company || typeof ft.company !== 'object') ft.company = {};
  return ft;
}

function applyFlowerTechOp(type, payload) {
  const ft = flowertech();
  const listName = payload && payload.kind === 'invoice' ? 'invoices' : 'offers';
  if (type === 'ft-doc-save') {
    const list = ft[listName];
    const idx = list.findIndex(d => d && d.id === payload.doc.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...payload.doc, updatedAt: nowISO() };
    else list.unshift(payload.doc);
    if (payload.counterKey) ft.counters[payload.counterKey] = payload.counterValue;
    return;
  }
  if (type === 'ft-doc-delete') {
    ft[listName] = ft[listName].filter(d => d && d.id !== payload.id);
    return;
  }
  if (type === 'ft-finance-add') { ft.finances.unshift(payload); return; }
  if (type === 'ft-note-add') { ft.notes.unshift(payload); return; }
  console.warn('applyOp: unbekannte FlowerTech-Operation', type);
}

function routines() {
  if (!state.data.dailyBriefing) state.data.dailyBriefing = {};
  if (!Array.isArray(state.data.dailyBriefing.routines)) state.data.dailyBriefing.routines = [];
  return state.data.dailyBriefing.routines;
}
function applyHabitOp(type, payload) {
  const rs = routines();
  if (type === 'add-habit') { rs.push(payload); return; }
  const h = rs.find(r => r.id === payload.id);
  if (!h) return;
  if (type === 'update-habit') { Object.assign(h, payload); return; }
  if (type === 'delete-habit') { h.archived = true; return; }
  if (type === 'toggle-habit') {
    h.completions = Array.isArray(h.completions) ? h.completions : [];
    const day = payload.date || todayYmd();
    const idx = h.completions.findIndex(c => c && c.date === day);
    if (idx >= 0) h.completions.splice(idx, 1);
    else h.completions.push({ date: day, value: payload.value != null ? payload.value : 1 });
    return;
  }
  if (type === 'toggle-subunit') {
    // Exakt das Schreibformat der Hauptapp — inklusive der Automatik am Ende.
    // Wuerde hier etwas anderes entstehen, liefen die beiden Apps auf dem
    // gleichen Datensatz auseinander, und der Merge muesste es ausbaden.
    const day = payload.date || todayYmd();
    const name = payload.subUnitName;
    if (!name) return;
    if (!Array.isArray(h.subCompletions)) h.subCompletions = [];
    if (!Array.isArray(h.completions)) h.completions = [];
    const i = h.subCompletions.findIndex(c => c && c.date === day && c.subUnitName === name);
    if (i >= 0) h.subCompletions.splice(i, 1);
    else h.subCompletions.push({
      id: 'sc_' + Math.random().toString(36).slice(2, 8),
      date: day, subUnitName: name, completedAt: new Date().toISOString(),
    });
    // Sind heute ALLE Schritte abgehakt, bekommt der Tag einen
    // completions-Eintrag (fuer Serie und Quote) — faellt einer wieder weg,
    // verschwindet er. Die Kennzeichnung autoFromSubUnits trennt ihn von
    // einem von Hand gesetzten Eintrag.
    const subs = Array.isArray(h.subUnits) ? h.subUnits.filter(u => u && u.name) : [];
    const alle = subs.length > 0 && subs.every(u => h.subCompletions.some(c => c.date === day && c.subUnitName === u.name));
    const hatAuto = h.completions.some(c => c.date === day && c.autoFromSubUnits);
    if (alle && !hatAuto) {
      h.completions.push({ id: 'hc_' + Math.random().toString(36).slice(2, 8), date: day, value: h.target || 1, autoFromSubUnits: true });
    } else if (!alle && hatAuto) {
      h.completions = h.completions.filter(c => !(c.date === day && c.autoFromSubUnits));
    }
  }
}

function recallLab() {
  if (!state.data.recallLabData || typeof state.data.recallLabData !== 'object') {
    state.data.recallLabData = { decks: [], cards: [], reviewLogs: [], user: {}, settings: {} };
  }
  const rl = state.data.recallLabData;
  if (!Array.isArray(rl.decks)) rl.decks = [];
  if (!Array.isArray(rl.cards)) rl.cards = [];
  return rl;
}
function applyFlashcardOp(type, payload) {
  const rl = recallLab();
  if (type === 'add-deck') { rl.decks.push(payload); return; }
  if (type === 'add-flashcard') { rl.cards.push(payload); return; }
  const card = rl.cards.find(c => c.id === payload.id);
  if (!card) return;
  if (type === 'update-flashcard') { Object.assign(card, payload); return; }
  if (type === 'review-flashcard') { card.srs = payload.srs; }
}

// ─────────────────────────────────────────────────────────────
//  Accessors (read-only, defensiv gegen fehlende Strukturen)
// ─────────────────────────────────────────────────────────────
function coll(name) {
  const c = state.data && state.data.entities && state.data.entities[name];
  return c && typeof c === 'object' ? Object.values(c) : [];
}
export const isDeleted = x => !!(x && (x.deleted || x.archived || x.status === 'deleted' || x.deletedAt));
const alive = x => x && !isDeleted(x);

export const getTasks       = () => coll('tasks').filter(alive);
export const getProjects    = () => coll('projects').filter(alive);
export const getNotes       = () => coll('notes').filter(alive);
// Nur für gezielte Legacy-Bridges (Migration/Pinnboard-Fallback). Neue
// Oberflächen lesen Ideen ausschließlich über getIdeaNotes().
export const getLegacyIdeas = () => coll('ideas').filter(alive);
export const getMeetings    = () => coll('meetings').filter(alive);
export const getTransactions= () => coll('transactions').filter(alive);
export const getAccounts    = () => coll('accounts').filter(alive);
export const getGoals       = () => coll('goals').filter(alive);
export const getTimeEntries = () => coll('timeEntries').filter(Boolean);
export const getNotebooks   = () => coll('notebooks').filter(alive).sort((a, b) => (a.order || 0) - (b.order || 0));
export const getBooks       = () => coll('books').filter(alive)
  .map(book => ({ ...book, status: bookStatus(book.status) }))
  .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

export const getAllTags = () => collectTags(getNotes());
export const getNotesBySource = (app, entityId) => getNotes().filter(note => noteSourceMatches(note, app, entityId));
export const getIdeaNotes = () => getNotes().filter(note => note.noteClass === 'idea');

// Einziger öffentlicher Schreibweg für neue zentrale Notizen. Die Factory
// validiert Klasse, Tags, Source und Inbox-Regel; dedupeKey gilt nur, wenn ein
// aufrufender Flow ausdrücklich eine Singleton-Spiegelung bezeichnet.
export async function saveCanonicalNote(input) {
  const existing = input && input.dedupeKey
    ? getNotes().find(note => note.dedupeKey === input.dedupeKey)
    : (input && input.id ? getNotes().find(note => note.id === input.id) : null);
  const payload = createCanonicalNote({ ...(existing || {}), ...(input || {}) }, {
    id: (existing && existing.id) || (input && input.id) || newId('note'),
    knownTags: getAllTags(),
  });
  await performOp({ type: existing ? 'update-note' : 'add-note', payload });
  return payload;
}

// Generischer Zugriff auf beliebige Sammlungen (entities.<name>) — Grundlage
// der gemeinsamen Modul-Ansicht für Projekte, Ziele, Strategien, Konzepte …
export const getCollection = (name) => coll(name).filter(alive);

// FlowerTech-Bereich (gleiche Struktur wie in Quantus/ai-sync)
export function getFlowerTech() {
  const ft = (state.data && state.data.flowertech) || {};
  return {
    offers: Array.isArray(ft.offers) ? ft.offers : [],
    invoices: Array.isArray(ft.invoices) ? ft.invoices : [],
    finances: Array.isArray(ft.finances) ? ft.finances : [],
    notes: Array.isArray(ft.notes) ? ft.notes : [],
    links: Array.isArray(ft.links) ? ft.links : [],
    inquiries: (ft.inquiries && typeof ft.inquiries === 'object') ? ft.inquiries : {},
    videos: (ft.videos && typeof ft.videos === 'object') ? ft.videos : {},
    company: (ft.company && typeof ft.company === 'object') ? ft.company : {},
    counters: (ft.counters && typeof ft.counters === 'object') ? ft.counters : {},
  };
}
export const getFlowerTechProjects = () => getProjects().filter(p => p.projectType === 'flowertech');

export function getById(kind, id) {
  const name = KIND_MAP[kind] || kind;
  const c = state.data && state.data.entities && state.data.entities[name];
  return c ? c[id] : null;
}

// Gewohnheiten
export function getHabits() {
  const rs = (state.data && state.data.dailyBriefing && state.data.dailyBriefing.routines) || [];
  return Array.isArray(rs) ? rs.filter(r => r && !r.archived) : [];
}
/*
 * SUB-EINHEITEN — die Schritte einer Routine.
 *
 * BEFUND: Die Handy-App zeigte von einer Routine nur Titel, Quote und einen
 * 30-Tage-Streifen. Die eigentliche Substanz — "06:00 Wake", "06:05 Rowing",
 * "06:15 Wash" … mit eigenem Zaehler 0/6 — kam gar nicht vor, obwohl sie im
 * selben Datensatz steht. Auf dem Desktop ist genau das die Routine.
 *
 * Vertrag (unveraendert von der Hauptapp uebernommen):
 *   h.subUnits       [{ name, icon }]
 *   h.subCompletions [{ id, date, subUnitName, completedAt }]
 *
 * Und die WICHTIGE Regel, die hier bisher fehlte: eine Routine MIT
 * Sub-Einheiten gilt erst als erledigt, wenn ALLE Schritte abgehakt sind —
 * nicht schon bei irgendeinem completions-Eintrag. Beide Apps zaehlten sonst
 * verschieden, und zwar am selben Datensatz.
 */
export function getSubUnits(h) {
  return Array.isArray(h && h.subUnits) ? h.subUnits.filter(u => u && u.name) : [];
}
export function subUnitDoneOn(h, name, ymd) {
  return Array.isArray(h && h.subCompletions)
    && h.subCompletions.some(c => c && c.date === ymd && c.subUnitName === name);
}
export function subUnitsDoneCount(h, ymd) {
  return getSubUnits(h).filter(u => subUnitDoneOn(h, u.name, ymd)).length;
}

// Faellt die Routine an diesem Tag ueberhaupt an? Wortgleich zur Hauptapp
// (isHabitDueOnDate) — sonst zeigt das Handy Schritte zum Abhaken an Tagen,
// an denen die Routine gar nicht laeuft.
export function habitDueOn(h, ymd) {
  const dow = new Date(String(ymd) + 'T12:00:00').getDay();   // 0 = So
  const f = h && h.frequency;
  if (f === 'weekdays') return dow >= 1 && dow <= 5;
  if (f === 'weekends') return dow === 0 || dow === 6;
  if (f === 'custom') return (Array.isArray(h.customDays) ? h.customDays : []).includes(dow);
  return true;    // daily, weekly und alles Unbekannte
}

export function habitDoneOn(h, ymd) {
  const subs = getSubUnits(h);
  if (subs.length) return subs.every(u => subUnitDoneOn(h, u.name, ymd));
  return Array.isArray(h.completions) && h.completions.some(c => c && c.date === ymd);
}

// Flashcards
export function getDecks() { const rl = state.data && state.data.recallLabData; return (rl && Array.isArray(rl.decks)) ? rl.decks : []; }
export function getCards() { const rl = state.data && state.data.recallLabData; return (rl && Array.isArray(rl.cards)) ? rl.cards : []; }
export function getDueCards(now = Date.now()) {
  return getCards().filter(c => {
    if (!c) return false;
    const due = c.srs ? c.srs.nextReview : c.nextReview;   // neue Karten (srs=null) sind fällig
    return due == null || due <= now;
  });
}

// Journal-Pushes (read-only Inbox aus Quantus) + Polaris-Chats
export function getJournalPushes() { return Array.isArray(state.data && state.data.mobilePushes) ? state.data.mobilePushes : []; }
export function getChats() { return Array.isArray(state.data && state.data.aiChats) ? state.data.aiChats : []; }

// Daily Briefing Rohdaten (falls von Quantus mitgeliefert)
export function getDailyBriefing() { return (state.data && state.data.dailyBriefing) || {}; }

/*
 * DAS VOLLSTAENDIGE DAILY BRIEFING.
 *
 * BEFUND: Die Handy-Ansicht zeigte fuenf von siebzehn Abschnitten — Termine,
 * faellige und ueberfaellige Aufgaben, Routinen, Leitsaetze. Tagesziele,
 * Wochenziele, Massnahmen, Nachrichten, Gedanken, Leseliste, Tagesplanung,
 * generelle Ziele, Notizen, Projekte, Programme, Reflexionsfragen und die
 * vergangenen Tage fehlten ganz, obwohl alle im selben Datensatz liegen.
 *
 * Diese Funktion sammelt sie an EINER Stelle. Beide Apps (Handy und Tablet)
 * lesen dieselben Felder — laufen sie auseinander, faellt der Waechter.
 * Sie rechnet nichts Neues aus und speichert nichts.
 */
export function briefingFuerTag(ymd) {
  const d = state.data || {};
  const db = getDailyBriefing();
  const arr = (v) => (Array.isArray(v) ? v : []);
  const objWerte = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.values(v) : [];
  const tagVon = (v) => String(v || '').slice(0, 10);

  const offen = getTasks().filter((t) => t.status !== 'done');
  const wocheStart = (() => {
    const x = new Date(ymd + 'T12:00:00');
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));      // Montag
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  })();

  // Massnahmen liegen VERTEILT an den Entitaeten, nicht in einer eigenen
  // Sammlung — wortgleich zu getAllActiveMeasures() der Hauptapp.
  const massnahmen = [];
  [['task', 'tasks'], ['project', 'projects'], ['concept', 'concepts'], ['strategy', 'strategies']]
    .forEach(([kind, coll]) => {
      getCollection(coll).forEach((e) => arr(e.measures).forEach((m) => {
        if (!m) return;
        massnahmen.push({
          id: m.id, text: m.text, effectiveDate: m.effectiveDate, status: m.status || 'active',
          parentKind: kind, parentId: e.id, parentTitle: e.title || e.name || e.id, parentIcon: e.icon || '',
        });
      }));
    });

  const reflexionsfragen = [];
  getProjects().forEach((p) => arr(p.reflectionQuestions).forEach((q) => {
    if (!q) return;
    const letzte = arr(q.answers).slice(-1)[0];
    reflexionsfragen.push({
      id: q.id, text: q.text || q.question || '', type: q.type || 'text',
      projekt: p.title || p.name || p.id,
      heuteBeantwortet: !!(letzte && letzte.date === ymd),
      letzteAntwort: letzte ? (letzte.value != null ? letzte.value : letzte.text) : null,
    });
  }));

  const log = (db.dailyLog && db.dailyLog[ymd]) || {};
  const vergangene = [...new Set([
    ...Object.keys((db.dailyLog) || {}),
    ...Object.keys((db.timeBlocks) || {}),
    ...Object.keys((d.dailyGoals) || {}),
  ])].filter((k) => k < ymd).sort().reverse().slice(0, 14);

  return {
    datum: ymd,
    modus: db.mode || 'planning',

    tagesziele:    arr((d.dailyGoals || {})[ymd]),
    wochenziele:   arr(d.weeklyGoals).filter((g) => !g.weekStart || g.weekStart === wocheStart),
    routinen:      getHabits(),
    beliefs:       arr(db.beliefs),
    massnahmen:    massnahmen.filter((m) => m.status === 'active'),
    nachrichten:   objWerte(d.entities && d.entities.scheduledMessages)
                     .filter((m) => m && m.isDelivered && tagVon(m.deliveredAt) === ymd),
    gedanken:      arr(d.journal && d.journal.topics).slice().reverse(),
    leseliste:     arr(d.readingList),
    zeitbloecke:   arr((db.timeBlocks || {})[ymd])
                     .slice().sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || ''))),
    meetings:      getMeetings().filter((m) => tagVon(m.date) === ymd),
    faellig:       offen.filter((t) => tagVon(t.dueDate) === ymd),
    ueberfaellig:  offen.filter((t) => t.dueDate && tagVon(t.dueDate) < ymd),
    pendent:       offen.filter((t) => !t.dueDate),
    ziele:         getGoals().filter((g) => !arr(db.hiddenGoals).includes(g.id)),
    notizen:       String(log.notes || ''),
    projekte:      getProjects().filter((p) => arr(db.selectedProjects).includes(p.id)),
    programme:     getCollection('programs').filter((p) => arr(db.selectedPrograms).includes(p.id)),
    reflexionsfragen,
    vergangeneTage: vergangene,
  };
}

// „Nicht zugeordnet" (Inbox): Aufgaben/Notizen/Ideen ohne Projekt-/Notebook-Bezug
export function getInboxItems() {
  const out = [];
  getTasks().forEach(t => { if (!t.projectId && (!t.linkedProjects || !t.linkedProjects.length)) out.push({ kind: 'task', item: t }); });
  // Ideen werden aus derselben kanonischen Notes-Sammlung genau einmal als
  // Idee einsortiert. Geplante/archivierte Ideen gehören nicht mehr zur Inbox.
  getNotes().forEach(n => {
    if (n.notebookId) return;
    if (n.noteClass === 'idea') {
      const status = n.ideaMeta && n.ideaMeta.status || (n.ideaStatus && ideaStatusFromShared(n.ideaStatus)) || n.status || 'idea';
      if (status === 'idea' || status === 'neu') out.push({ kind: 'idea', item: n });
    } else out.push({ kind: 'note', item: n });
  });
  return out;
}
