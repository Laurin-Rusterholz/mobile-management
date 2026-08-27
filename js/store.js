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
import { nowISO, toast, todayYmd } from './util.js';

export const state = {
  data: null,
  etag: null,
  pending: [],
  syncing: false,
  initialPullDone: false,          // Schutz: nie pushen, bevor Server-Daten gesehen wurden
  initialPullStatus: 'pending',    // pending | ok | empty | failed
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
  return { entities: { tasks: {}, notes: {}, ideas: {}, notebooks: {}, projects: {}, meetings: {}, timeEntries: {} } };
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
    state.etag = r.headers.get('ETag') || r.headers.get('etag');
    try {
      localStorage.setItem(LS.lastData, text);
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
  } finally { state.syncing = false; }
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

async function applyPendingChanges() {
  const stored = localStorage.getItem(LS.pending);
  if (!stored) return;
  try {
    const ops = JSON.parse(stored);
    if (!ops || !ops.length) return;
    ops.forEach(op => applyOp(op));
    const ok = await pushData();
    if (ok) toast(ops.length + ' Änderung(en) synchronisiert', 'ok');
  } catch (e) { console.error('Pending replay failed:', e); }
}

// Öffentlicher Mutations-Einstieg: lokal anwenden, rendern, dann pushen.
export async function performOp(op) {
  if (!state.data) return;
  applyOp(op);
  state.pending.push(op);
  notify();
  const ok = await pushData();
  if (!ok) savePending();
}

export async function manualSync() { await pullData(); }
export function pendingCount() { return state.pending.length; }
export function pullStatus() { return state.initialPullStatus; }

// ─────────────────────────────────────────────────────────────
//  applyOp — mutiert state.data verlustfrei
// ─────────────────────────────────────────────────────────────
// Entitäts-Ops folgen dem Muster '<verb>-<kind>' mit verb add|update|delete.
const KIND_MAP = {
  task: 'tasks', note: 'notes', idea: 'ideas', notebook: 'notebooks',
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

  // ── Standard-Entitäten (Dictionary nach ID, Soft-Delete) ──
  if (KIND_MAP[kind]) {
    const coll = ensureColl(KIND_MAP[kind]);
    if (verb === 'add') coll[op.payload.id] = op.payload;
    else if (verb === 'update') {
      const cur = coll[op.payload.id];
      if (cur) Object.assign(cur, op.payload, { updatedAt: nowISO() });
      else coll[op.payload.id] = op.payload;
    } else if (verb === 'delete') {
      // Soft-Delete (Quantus nutzt Tombstones/Flags) statt hartem Entfernen
      const cur = coll[op.payload.id];
      if (cur) { cur.deleted = true; cur.updatedAt = nowISO(); }
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
const alive = x => x && !x.deleted && !x.archived;

export const getTasks       = () => coll('tasks').filter(alive);
export const getProjects    = () => coll('projects').filter(alive);
export const getNotes       = () => coll('notes').filter(alive);
export const getIdeas       = () => coll('ideas').filter(alive);
export const getMeetings    = () => coll('meetings').filter(alive);
export const getTransactions= () => coll('transactions').filter(alive);
export const getAccounts    = () => coll('accounts').filter(alive);
export const getGoals       = () => coll('goals').filter(alive);
export const getTimeEntries = () => coll('timeEntries').filter(Boolean);
export const getNotebooks   = () => coll('notebooks').filter(alive).sort((a, b) => (a.order || 0) - (b.order || 0));

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

// „Nicht zugeordnet" (Inbox): Aufgaben/Notizen/Ideen ohne Projekt-/Notebook-Bezug
export function getInboxItems() {
  const out = [];
  getTasks().forEach(t => { if (!t.projectId && (!t.linkedProjects || !t.linkedProjects.length)) out.push({ kind: 'task', item: t }); });
  getIdeas().forEach(i => { if ((i.status || 'idea') === 'idea' || i.status === 'neu') out.push({ kind: 'idea', item: i }); });
  getNotes().forEach(n => { if (!n.notebookId) out.push({ kind: 'note', item: n }); });
  return out;
}
