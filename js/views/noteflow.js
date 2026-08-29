// ============================================================================
//  Noteflow — zentrale Wahrheit für alle Quantus-Notizen
// ============================================================================
import { escHTML, formatDate, toast, newId, nowISO } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate, getView, current as currentRoute } from '../router.js';
import { pageHeader, segmented } from './common.js';
import { NOTE_CLASSES } from '../notes.js';
import { openNoteComposer } from '../note-ui.js';

const filters = { scope: 'all', noteClass: 'all', notebook: 'all', tag: 'all', source: 'all', search: '' };
let openedDeepLink = null;

const sourceOf = (note) => note && note.source && typeof note.source === 'object'
  ? note.source : { app: String((note && note.source) || 'noteflow'), label: 'Noteflow' };
const titleOf = (note) => note.title || String(note.content || '').replace(/\s+/g, ' ').slice(0, 72) || '(ohne Titel)';
const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'de-CH'));

function filteredNotes() {
  let notes = store.getNotes().slice();
  if (filters.scope === 'inbox') notes = notes.filter((note) => !note.notebookId);
  if (filters.scope === 'favorites') notes = notes.filter((note) => note.favorite || note.isFavorite);
  if (filters.noteClass !== 'all') notes = notes.filter((note) => note.noteClass === filters.noteClass);
  if (filters.notebook !== 'all') notes = notes.filter((note) => (note.notebookId || 'inbox') === filters.notebook);
  if (filters.tag !== 'all') notes = notes.filter((note) => (note.tags || []).some((tag) => tag.toLocaleLowerCase('de-CH') === filters.tag.toLocaleLowerCase('de-CH')));
  if (filters.source !== 'all') notes = notes.filter((note) => sourceOf(note).app === filters.source);
  if (filters.search) {
    const q = filters.search.toLocaleLowerCase('de-CH');
    notes = notes.filter((note) => [note.title, note.content, ...(note.tags || []), sourceOf(note).label]
      .join(' ').toLocaleLowerCase('de-CH').includes(q));
  }
  notes.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  return filters.scope === 'recent' ? notes.slice(0, 30) : notes;
}

function sourceRoute(source) {
  const route = String(source && source.route || '');
  if (!route.startsWith('#/')) return null;
  const raw = route.slice(2);
  const path = raw.split('?')[0].split('/').filter(Boolean);
  const routeKey = path[0] === 'ideas' ? 'ideen' : path[0];
  if (!routeKey || !getView(routeKey)) return null;
  const params = {};
  const query = raw.split('?')[1];
  if (query) new URLSearchParams(query).forEach((value, key) => { params[key] = value; });
  if (source.entityId && !params.id) params.id = source.entityId;
  return { route: routeKey, sub: path[1] || null, params };
}

function card(note) {
  const source = sourceOf(note);
  const route = sourceRoute(source);
  const notebook = note.notebookId && store.getNotebooks().find((item) => item.id === note.notebookId);
  return `<article class="card note-card">
    <button class="note-card-main" data-action="note-open" data-id="${escHTML(note.id)}">
      <span class="note-card-top"><span class="pill accent">${escHTML(NOTE_CLASSES[note.noteClass] || 'Generelle Notiz')}</span>
        <span class="row-meta">${formatDate(note.updatedAt || note.createdAt)}</span></span>
      <span class="row-title">${escHTML(titleOf(note))}</span>
      <span class="row-sub">${escHTML(String(note.content || '').replace(/\s+/g, ' ').slice(0, 130))}</span>
      <span class="note-tags">${(note.tags || []).map((tag) => `<span>#${escHTML(tag)}</span>`).join('')}</span>
      <span class="row-meta">${notebook ? `📓 ${escHTML(notebook.title || notebook.name)}` : '📥 Inbox'} · ${escHTML(source.label || source.app || 'Noteflow')}</span>
    </button>
    <div class="note-card-actions">
      <button class="icon-btn ${note.favorite || note.isFavorite ? 'active' : ''}" data-action="note-favorite" data-id="${escHTML(note.id)}" aria-label="Favorit">${note.favorite || note.isFavorite ? '★' : '☆'}</button>
      ${route ? `<button class="icon-btn" data-action="note-source" data-id="${escHTML(note.id)}" aria-label="Quelle öffnen">↗</button>` : `<span class="note-source-missing" title="Quelle auf diesem Gerät nicht verfügbar">◌</span>`}
      <button class="icon-btn" data-action="note-to-task" data-id="${escHTML(note.id)}" title="Als Aufgabe">✅</button>
    </div>
  </article>`;
}

registerActions({
  'note-open': (data) => {
    const note = store.getById('note', data.id); if (!note) return;
    openNoteComposer({ note, noteClass: note.noteClass, source: sourceOf(note), allowClassSelection: sourceOf(note).app === 'noteflow', tagsRequired: note.noteClass !== 'general' });
  },
  'note-new': () => openNoteComposer({
    heading: 'Neue Notiz', noteClass: 'general', allowClassSelection: true, tagsRequired: false,
    source: { app: 'noteflow', entityType: null, entityId: null, label: 'Noteflow', route: '#/noteflow' },
  }),
  'note-filter-scope': (data) => { filters.scope = data.seg; store.notify(); },
  'note-favorite': async (data) => {
    const note = store.getById('note', data.id); if (!note) return;
    await store.performOp({ type: 'update-note', payload: { id: note.id, favorite: !(note.favorite || note.isFavorite) } });
  },
  'note-source': (data) => {
    const note = store.getById('note', data.id); const target = note && sourceRoute(sourceOf(note));
    if (!target) { toast('Quelle auf diesem Gerät nicht verfügbar', 'warn'); return; }
    navigate(target.route, { sub: target.sub, params: target.params });
  },
  'note-to-task': async (data) => {
    const note = store.getById('note', data.id); if (!note) return;
    await store.performOp({ type: 'add-task', payload: {
      id: newId('task'), title: note.title || 'Aus Notiz', description: String(note.content || '').slice(0, 500),
      status: 'todo', priority: 3, source: 'mobile', linkedNotes: [note.id], createdAt: nowISO(), updatedAt: nowISO(),
    } });
    toast('Aufgabe aus Notiz erstellt', 'ok');
  },
});

export default {
  title: 'Noteflow', icon: '📝',
  render() {
    const all = store.getNotes();
    const notes = filteredNotes();
    const tags = unique(all.flatMap((note) => note.tags || []));
    const sources = unique(all.map((note) => sourceOf(note).app));
    return `<div class="pad">
      ${pageHeader('Noteflow', `${notes.length} von ${all.length} Notizen`, `<button class="chip accent" data-action="note-new">＋ Notiz</button>`)}
      <input class="input note-search" id="noteSearch" type="search" value="${escHTML(filters.search)}" placeholder="Titel, Inhalt, Schlagwort oder Quelle…">
      ${segmented([
        { key: 'all', label: 'Alle', count: all.length },
        { key: 'inbox', label: 'Inbox', count: all.filter((note) => !note.notebookId).length },
        { key: 'favorites', label: 'Favoriten', count: all.filter((note) => note.favorite || note.isFavorite).length },
        { key: 'recent', label: 'Zuletzt bearbeitet' },
      ], filters.scope, 'note-filter-scope')}
      <div class="note-filter-grid">
        <label><span>Klasse</span><select class="input" data-note-filter="noteClass">
          <option value="all">Alle Klassen</option>${Object.entries(NOTE_CLASSES).map(([key, label]) => `<option value="${key}" ${filters.noteClass === key ? 'selected' : ''}>${escHTML(label)}</option>`).join('')}
        </select></label>
        <label><span>Notizbuch</span><select class="input" data-note-filter="notebook">
          <option value="all">Alle Ziele</option><option value="inbox" ${filters.notebook === 'inbox' ? 'selected' : ''}>Inbox</option>
          ${store.getNotebooks().map((book) => `<option value="${escHTML(book.id)}" ${filters.notebook === book.id ? 'selected' : ''}>${escHTML(book.title || book.name || 'Notizbuch')}</option>`).join('')}
        </select></label>
        <label><span>Schlagwort</span><select class="input" data-note-filter="tag">
          <option value="all">Alle Schlagwörter</option>${tags.map((tag) => `<option value="${escHTML(tag)}" ${filters.tag === tag ? 'selected' : ''}>${escHTML(tag)}</option>`).join('')}
        </select></label>
        <label><span>Quelle/App</span><select class="input" data-note-filter="source">
          <option value="all">Alle Quellen</option>${sources.map((source) => `<option value="${escHTML(source)}" ${filters.source === source ? 'selected' : ''}>${escHTML(source)}</option>`).join('')}
        </select></label>
      </div>
      <div class="note-list">${notes.length ? notes.map(card).join('')
        : `<div class="empty"><div class="empty-icon">📝</div><div class="empty-title">Keine passenden Notizen</div><div class="empty-sub">Passe die Filter an oder erstelle eine neue Notiz.</div></div>`}</div>
    </div>`;
  },
  mount(root, ctx) {
    const search = root.querySelector('#noteSearch');
    if (search) search.addEventListener('input', () => { filters.search = search.value.trim(); clearTimeout(search._timer); search._timer = setTimeout(() => store.notify(), 180); });
    root.querySelectorAll('[data-note-filter]').forEach((select) => select.addEventListener('change', () => {
      filters[select.dataset.noteFilter] = select.value; store.notify();
    }));
    const id = ctx && ctx.params && ctx.params.id;
    if (id && id !== openedDeepLink) {
      openedDeepLink = id;
      const note = store.getById('note', id);
      if (note) openNoteComposer({ note, noteClass: note.noteClass, source: sourceOf(note), allowClassSelection: sourceOf(note).app === 'noteflow', tagsRequired: note.noteClass !== 'general' });
      else toast('Notiz nicht gefunden', 'warn');
    }
    if (!id) openedDeepLink = null;
  },
  // Der Router ruft unmount auch bei einem reinen Store-Re-Render derselben
  // Ansicht auf. Nur ein echter Routenwechsel darf den konsumierten Deep Link
  // freigeben; danach lässt sich dieselbe Notiz erneut aus ihrer Quelle öffnen.
  unmount() { if (currentRoute().route !== 'noteflow') openedDeepLink = null; },
};
