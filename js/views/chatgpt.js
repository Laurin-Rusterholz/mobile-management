// ============================================================================
//  ChatGPT — Notes (Schnellerfassung + Liste), Leads (anlegen + Liste),
//  ChatGPT-Aufgaben (einzeiliges Feld am Element)
//  ---------------------------------------------------------------------------
//  Apple-Notes-Prinzip: so einfach wie moeglich. Erfassen muss unterwegs
//  gehen, alles Weitere (Abloesen, Bearbeiten, Bewerten, Abschliessen) macht
//  der Assistent am Rechner. Geschrieben wird in dieselben Sammlungen wie in
//  AI Sync (entities.chatgptNotes / chatgptLeads / chatgptTasks) ueber die
//  normale Operations-Warteschlange — kein Sonderweg.
// ============================================================================
import { escHTML, formatDate, newId, nowISO, todayYmd, toast } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { pageHeader, segmented } from './common.js';

const CATEGORY = { auftrag: 'Auftrag', feedback: 'Feedback', konvention: 'Konvention', entscheid: 'Entscheid' };
const STATUS = { neu: 'Neu', verstanden: 'Verstanden', in_arbeit: 'In Arbeit', wartet: 'Wartet', abgeschlossen: 'Abgeschlossen' };
const newest = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

const ui = { seg: 'notes' };

// ── Daten ───────────────────────────────────────────────────────────────────
export function chatgptNotes() { return store.getCollection('chatgptNotes').slice().sort(newest); }
export function chatgptLeads() { return store.getCollection('chatgptLeads').slice().sort(newest); }
export function chatgptTasksFor(kind, id) {
  return store.getCollection('chatgptTasks')
    .filter((t) => t.anchorKind === kind && String(t.anchorId) === String(id))
    .sort((a, b) => ((a.state === 'erledigt') - (b.state === 'erledigt')) || newest(a, b));
}
function lastReadAt() { return (store.state.data && store.state.data.chatgptNotesMeta && store.state.data.chatgptNotesMeta.lastSessionReadAt) || null; }

// ── Anlegen ─────────────────────────────────────────────────────────────────
// Schnellerfassung: Kategorie Feedback, heutiges Datum, Ableitung leer —
// der Assistent traegt sie am Rechner nach.
export async function addChatgptNote(text) {
  text = String(text || '').trim();
  if (!text) return null;
  const now = nowISO();
  const id = newId('chatgptNote');
  await store.performOp({ type: 'add-chatgptNote', payload: {
    id, createdAt: now, updatedAt: now, category: 'feedback', instructionDate: todayYmd(),
    instruction: text, derived: '', state: 'aktiv', supersededBy: null, supersedes: null, promptSection: null,
    tags: [], comments: [], files: [], externalLinks: [], source: 'mobile',
  } });
  return id;
}
// Lead: Titel + Wortlaut, sonst nichts. Der Rest gehoert dem Assistenten.
export async function addChatgptLead(title, rawInput) {
  title = String(title || '').trim(); rawInput = String(rawInput || '').trim();
  if (!title && !rawInput) return null;
  if (!title) title = rawInput.split('\n')[0].slice(0, 80);
  if (!rawInput) rawInput = title;
  const now = nowISO();
  const id = newId('chatgptLead');
  await store.performOp({ type: 'add-chatgptLead', payload: {
    id, createdAt: now, updatedAt: now, title, rawInput, status: 'neu', readAt: null,
    interpretation: '', openQuestions: '', research: '', plan: '', execution: '', result: '', workflowNote: '',
    blockedReason: null, closedAt: null, closedBy: null, externalLinks: [], comments: [], files: [],
    assessment: { menge: null, werkzeug: null, kontext: null, quantusNaehe: null, recherche: null, zuschnitt: null },
    assignee: null, assignmentReason: '', handoverPacket: null,
    grantedPermissions: { websuche: false, dateienErstellen: { erlaubt: false, formate: [] }, externeTools: [], verboten: [] },
    handoverAt: null, returnedAt: null, source: 'mobile',
  } });
  return id;
}
// ChatGPT-Aufgabe: NUR mit Anker. Ohne aufloesbares Element wird nichts angelegt.
export async function addChatgptTask(kind, id, text, label) {
  text = String(text || '').trim();
  if (!text) return null;
  if (!kind || !id) { toast('Kein Anker — Aufgabe nicht angelegt', 'error'); return null; }
  const item = store.getById(kind, id);
  if (!item) { toast('Element nicht gefunden — Aufgabe nicht angelegt', 'error'); return null; }
  const now = nowISO();
  const tid = newId('chatgptTask');
  await store.performOp({ type: 'add-chatgptTask', payload: {
    id: tid, createdAt: now, updatedAt: now, text, state: 'offen', anchorKind: kind, anchorId: item.id,
    anchorLabel: label || item.title || item.name || item.subject || '', createdBy: 'laurin',
    resolvedAt: null, blockedReason: null, comments: [], source: 'mobile',
  } });
  return tid;
}

// ── Block am Element (Sammlungen, Aufgaben, Projekte) ───────────────────────
// Fuer Laurin ein kleiner Marker; ein einzeiliges Feld, Enter oder ＋ genuegt.
export function chatgptTaskBlock(kind, id, label) {
  if (!kind || !id) return '';
  const list = chatgptTasksFor(kind, id);
  const open = list.filter((t) => t.state !== 'erledigt');
  const rows = list.slice(0, 8).map((t) => `<div class="cg-task-row ${t.state === 'erledigt' ? 'done' : ''}">
      <span class="cg-task-text">${escHTML(t.text || '')}</span>
      <small>${formatDate(t.createdAt)}${t.state === 'wartet' ? ` · wartet: ${escHTML(t.blockedReason || '')}` : ''}${t.state === 'erledigt' ? ' · erledigt' : ''}</small>
    </div>`).join('');
  return `<div class="context-notes cg-task-block" data-cg-block data-kind="${escHTML(kind)}" data-id="${escHTML(id)}">
    <div class="context-notes-head"><span>🤖 ChatGPT-Aufgaben${open.length ? ` <span class="pill cg-marker">🪶 ${open.length}</span>` : ''}</span></div>
    ${rows || '<div class="muted-row">Keine ChatGPT-Aufgaben.</div>'}
    <div class="cg-task-add">
      <input class="input" data-cg-task-input data-kind="${escHTML(kind)}" data-id="${escHTML(id)}" data-label="${escHTML(label || '')}" placeholder="ChatGPT-Aufgabe — Enter genügt" autocomplete="off">
      <button class="chip accent" type="button" data-action="cg-task-add" data-kind="${escHTML(kind)}" data-id="${escHTML(id)}" data-label="${escHTML(label || '')}">＋</button>
    </div>
  </div>`;
}
async function submitTaskInput(input) {
  const value = input.value;
  const tid = await addChatgptTask(input.dataset.kind, input.dataset.id, value, input.dataset.label);
  if (!tid) return;
  input.value = '';
  toast('ChatGPT-Aufgabe angelegt ✓', 'ok');
  const block = input.closest('[data-cg-block]');
  if (block) {
    const wrap = document.createElement('div');
    wrap.innerHTML = chatgptTaskBlock(block.dataset.kind, block.dataset.id, input.dataset.label);
    block.replaceWith(wrap.firstElementChild);
  }
}
// Enter im Feld — einmal fuer alle Bloecke, egal in welchem Sheet sie liegen.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target && e.target.closest ? e.target.closest('[data-cg-task-input]') : null;
    if (!input) return;
    e.preventDefault();
    submitTaskInput(input);
  });
}

// ── Aktionen ────────────────────────────────────────────────────────────────
registerActions({
  'cg-seg': (d) => { ui.seg = d.seg; store.notify(); },
  'cg-note-add': async () => {
    const input = document.getElementById('cgNoteInput');
    const id = await addChatgptNote(input ? input.value : '');
    if (!id) { toast('Bitte Text eingeben', 'error'); return; }
    if (input) input.value = '';
    toast('Notiert ✓ (Feedback, heute)', 'ok');
    store.notify();
  },
  'cg-lead-add': async () => {
    const t = document.getElementById('cgLeadTitle'), r = document.getElementById('cgLeadText');
    const id = await addChatgptLead(t ? t.value : '', r ? r.value : '');
    if (!id) { toast('Titel oder Wortlaut eingeben', 'error'); return; }
    if (t) t.value = ''; if (r) r.value = '';
    toast('Lead erfasst ✓ — liegt ungelesen im Eingang', 'ok');
    store.notify();
  },
  'cg-task-add': (d, el) => {
    const block = el && el.closest ? el.closest('[data-cg-block]') : null;
    const input = block ? block.querySelector('[data-cg-task-input]') : null;
    if (input) submitTaskInput(input);
  },
});

// ── Ansicht ─────────────────────────────────────────────────────────────────
function noteCard(n) {
  const superseded = n.state === 'ueberholt';
  return `<div class="card cg-note ${superseded ? 'done' : ''}">
    <div class="row-meta"><span class="chip mini">${escHTML(CATEGORY[n.category] || n.category || '?')}</span>
      <span class="chip mini">${formatDate(n.instructionDate || n.createdAt)}</span>${superseded ? '<span class="chip mini">überholt</span>' : ''}</div>
    <div class="row-title cg-instruction">${escHTML(n.instruction || '')}</div>
    ${n.derived ? `<div class="row-sub">${escHTML(n.derived)}</div>` : ''}
  </div>`;
}
function leadCard(l) {
  const unread = !l.readAt && l.status !== 'abgeschlossen';
  return `<div class="card cg-lead ${unread ? 'unread' : ''}">
    <div class="row-title">${unread ? '<span class="cg-dot"></span>' : ''}${escHTML(l.title || '(ohne Titel)')}</div>
    <div class="row-sub">${escHTML(String(l.rawInput || '').slice(0, 120))}</div>
    <div class="row-meta"><span class="pill ${l.status === 'abgeschlossen' ? '' : 'accent'}">${escHTML(STATUS[l.status] || l.status || 'Neu')}</span>
      <span class="chip mini">${formatDate(l.createdAt)}</span>${l.assignee ? `<span class="chip mini">${l.assignee === 'cowork' ? 'Cowork' : 'ChatGPT'}</span>` : ''}</div>
  </div>`;
}
function renderNotes() {
  const all = chatgptNotes();
  const last = lastReadAt();
  const fresh = last ? all.filter((n) => String(n.createdAt || '') > last) : all;
  return `<div class="card cg-capture">
      <input class="input" id="cgNoteInput" placeholder="Anweisung notieren — Enter genügt (Feedback, heute)" autocomplete="off">
      <button class="chip accent" data-action="cg-note-add">＋ Notiz</button>
    </div>
    <div class="muted-row">${fresh.length} neu seit ${last ? formatDate(last) : 'je'} · ${all.length} insgesamt. Ableitung, Ablösen und Korrigieren macht der Assistent am Rechner.</div>
    ${all.length ? all.map(noteCard).join('') : `<div class="empty"><div class="empty-icon">🤖</div><div class="empty-title">Noch keine ChatGPT Notes</div><div class="empty-sub">Erfasse eine Anweisung — sie landet als Feedback mit heutigem Datum.</div></div>`}`;
}
function renderLeads() {
  const all = chatgptLeads();
  const open = all.filter((l) => l.status !== 'abgeschlossen');
  const closed = all.filter((l) => l.status === 'abgeschlossen');
  return `<div class="card cg-capture">
      <input class="input" id="cgLeadTitle" placeholder="Titel" autocomplete="off">
      <textarea class="input" id="cgLeadText" rows="3" placeholder="Wortlaut des Auftrags — genau so, wie du ihn meinst"></textarea>
      <button class="btn primary block" data-action="cg-lead-add">📥 Lead anlegen</button>
    </div>
    <div class="muted-row">${open.length} offen · ${closed.length} abgeschlossen. Nur der Assistent bearbeitet Leads — am Rechner.</div>
    ${open.map(leadCard).join('')}
    ${closed.length ? `<details class="cg-closed"><summary class="muted-row">Abgeschlossen (${closed.length})</summary>${closed.map(leadCard).join('')}</details>` : ''}
    ${!all.length ? `<div class="empty"><div class="empty-icon">📥</div><div class="empty-title">Noch keine Leads</div><div class="empty-sub">Titel und Wortlaut genügen.</div></div>` : ''}`;
}

export default {
  title: 'ChatGPT', icon: '🤖',
  render() {
    const last = lastReadAt();
    const fresh = chatgptNotes().filter((n) => !last || String(n.createdAt || '') > last).length;
    const unread = chatgptLeads().filter((l) => !l.readAt && l.status !== 'abgeschlossen').length;
    return `<div class="pad">
      ${pageHeader('ChatGPT', 'Notes erfassen, Leads erfassen')}
      ${segmented([{ key: 'notes', label: '🧠 Notes', count: fresh || null }, { key: 'leads', label: '📥 Leads', count: unread || null }], ui.seg, 'cg-seg')}
      ${ui.seg === 'leads' ? renderLeads() : renderNotes()}
    </div>`;
  },
  mount(root) {
    const note = root.querySelector('#cgNoteInput');
    if (note) note.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); root.querySelector('[data-action="cg-note-add"]').click(); } });
    const title = root.querySelector('#cgLeadTitle');
    if (title) title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); root.querySelector('#cgLeadText').focus(); } });
    const text = root.querySelector('#cgLeadText');
    if (text) text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); root.querySelector('[data-action="cg-lead-add"]').click(); } });
  },
};
