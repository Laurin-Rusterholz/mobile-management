// ============================================================================
//  Reading Hub — mobile Bibliothek und schnelle Lesenotizen
//  Bücher liegen geräteübergreifend in entities.books; der Desktop hält seinen
//  alten Reading-Hub-Shadow über die dortige Bridge kompatibel.
// ============================================================================
import { escHTML, formatDate, openSheet, closeSheet, toast, newId, nowISO } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader } from './common.js';
import { BOOK_STATUS_LABELS, bookStatus } from '../notes.js';
import { openNoteComposer } from '../note-ui.js';

function bookById(id) { return store.getBooks().find((book) => book.id === id) || null; }
function safeExternalUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function openRegister() {
  openSheet({
    title: 'Buch registrieren', size: 'half',
    body: `<form class="form" data-book-register>
      <label class="f"><span class="f-label">Titel</span>
        <input class="input" name="title" required autocomplete="off" placeholder="Buchtitel"></label>
      <div class="note-inbox-hint">Nur der Titel ist nötig. Autor, ISBN, Datei, Cover, Fortschritt und Zieltermin kannst du später ergänzen.</div>
      <button class="btn primary block big" type="submit">Nur Titel registrieren</button>
    </form>`,
    onMount(root) {
      root.querySelector('[data-book-register]').addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = String(new FormData(event.currentTarget).get('title') || '').trim();
        if (!title) { toast('Titel fehlt', 'warn'); return; }
        const now = nowISO(); const id = newId('book');
        await store.performOp({ type: 'add-book', payload: {
          id, title, author: '', isbn: '', coverUrl: '', fileUrl: '', totalPages: null,
          status: 'registered', progress: 0, targetDate: null, annotations: [],
          createdAt: now, updatedAt: now, source: 'mobile',
        } });
        closeSheet(); toast('Buch registriert ✓', 'ok'); navigate('readinghub', { params: { id } });
      });
    },
  });
}

function metadataForm(book) {
  return `<form class="form" data-book-meta data-id="${escHTML(book.id)}">
    <label class="f"><span class="f-label">Titel</span><input class="input" name="title" required value="${escHTML(book.title || '')}"></label>
    <label class="f"><span class="f-label">Autor</span><input class="input" name="author" value="${escHTML(book.author || '')}"></label>
    <div class="f-row">
      <label class="f"><span class="f-label">ISBN</span><input class="input" name="isbn" inputmode="numeric" value="${escHTML(book.isbn || '')}"></label>
      <label class="f"><span class="f-label">Seiten</span><input class="input" name="totalPages" type="number" min="1" value="${book.totalPages || book.pageCount || ''}"></label>
    </div>
    <div class="f-row">
      <label class="f"><span class="f-label">Status</span><select class="input" name="status">${Object.entries(BOOK_STATUS_LABELS).map(([key, label]) => `<option value="${key}" ${bookStatus(book.status) === key ? 'selected' : ''}>${escHTML(label)}</option>`).join('')}</select></label>
      <label class="f"><span class="f-label">Zieltermin</span><input class="input" name="targetDate" type="date" value="${escHTML(String(book.targetDate || '').slice(0, 10))}"></label>
    </div>
    <label class="f"><span class="f-label">Fortschritt (%)</span><input class="input" name="progress" type="number" min="0" max="100" value="${Number(book.progress || 0)}"></label>
    <label class="f"><span class="f-label">Cover-URL (optional)</span><input class="input" name="coverUrl" type="url" value="${escHTML(book.coverUrl || '')}"></label>
    <label class="f"><span class="f-label">Datei/PDF-Link (optional)</span><input class="input" name="fileUrl" type="url" value="${escHTML(book.fileUrl || '')}"></label>
    <button class="btn primary block" type="submit">Metadaten speichern</button>
  </form>`;
}

function detail(book) {
  const notes = store.getNotesBySource('readinghub', book.id)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const annotations = Array.isArray(book.annotations) ? book.annotations.length
    : (book.annotations && typeof book.annotations === 'object' ? Object.keys(book.annotations).length : 0);
  const coverUrl = safeExternalUrl(book.coverUrl);
  const fileUrl = safeExternalUrl(book.fileUrl);
  return `<div class="reading-detail">
    <button class="chip" data-action="book-back">← Bibliothek</button>
    <div class="reading-head">
      ${coverUrl ? `<img src="${escHTML(coverUrl)}" alt="" class="reading-cover" loading="lazy">` : `<div class="reading-cover placeholder">📖</div>`}
      <div><h2>${escHTML(book.title || 'Buch')}</h2><div class="muted-row">${escHTML(book.author || 'Autor noch offen')}</div>
        <span class="pill accent">${escHTML(BOOK_STATUS_LABELS[bookStatus(book.status)])}</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn primary" data-action="book-reading-note" data-id="${escHTML(book.id)}">＋ Lesenotiz</button>
      ${fileUrl ? `<a class="btn" href="${escHTML(fileUrl)}" target="_blank" rel="noopener">PDF/Datei öffnen</a>` : ''}
    </div>
    <div class="reading-preserved">${annotations} Annotationen · ${notes.length} Lesenotizen · RecallLab-Verknüpfungen bleiben erhalten</div>
    <div class="section-title">Angaben ergänzen</div>${metadataForm(book)}
    <div class="section-title">Lesenotizen</div>
    ${notes.length ? notes.map((note) => `<button class="card row-card" data-action="book-note-open" data-id="${escHTML(note.id)}">
      <div class="row-main"><div class="row-title">${escHTML(note.title || 'Lesenotiz')}</div>
      <div class="row-sub">${escHTML(String(note.content || '').slice(0, 100))}</div>
      <div class="row-meta">${escHTML(note.readingKind || 'note')} · ${formatDate(note.updatedAt)}</div></div><span>›</span>
    </button>`).join('') : `<div class="muted-row">Nach dem Lesen hältst du hier kurz fest, was bleiben soll.</div>`}
  </div>`;
}

registerActions({
  'book-register': () => openRegister(),
  'book-open': (data) => navigate('readinghub', { params: { id: data.id } }),
  'book-back': () => navigate('readinghub'),
  'book-note-open': (data) => navigate('noteflow', { params: { id: data.id } }),
  'book-reading-note': (data) => {
    const book = bookById(data.id); if (!book) return;
    openNoteComposer({
      heading: 'Lesenotiz', noteClass: 'reading', tags: [book.title], lockedTags: [book.title],
      source: { app: 'readinghub', entityType: 'book', entityId: book.id, label: book.title, route: '#/readinghub/' + encodeURIComponent(book.id) },
      placeholder: 'Zitat, Zusammenfassung oder Erkenntnis…',
    });
  },
});

export default {
  title: 'Reading Hub', icon: '📚',
  render(ctx) {
    const id = ctx && ctx.params && ctx.params.id;
    const selected = id && bookById(id);
    if (selected) return `<div class="pad">${detail(selected)}</div>`;
    const books = store.getBooks();
    return `<div class="pad">
      ${pageHeader('Reading Hub', `${books.length} registrierte Bücher`, `<button class="chip accent" data-action="book-register">＋ Nur Titel</button>`)}
      <div class="muted-row">Bibliothek und optionaler Reader: Registriere ein Buch zunächst nur mit seinem Titel und ergänze den Rest später.</div>
      ${books.length ? books.map((book) => `<button class="card row-card" data-action="book-open" data-id="${escHTML(book.id)}">
        <span class="reading-mini-cover">${safeExternalUrl(book.coverUrl) ? `<img src="${escHTML(safeExternalUrl(book.coverUrl))}" alt="" loading="lazy">` : '📖'}</span>
        <span class="row-main"><span class="row-title">${escHTML(book.title || 'Buch')}</span>
          <span class="row-sub">${escHTML(book.author || BOOK_STATUS_LABELS[bookStatus(book.status)])}</span>
          <span class="row-meta">${Number(book.progress || 0)}% · ${store.getNotesBySource('readinghub', book.id).length} Lesenotizen</span>
        </span><span>›</span>
      </button>`).join('') : `<div class="empty"><div class="empty-icon">📚</div><div class="empty-title">Noch kein Buch registriert</div><div class="empty-sub">Ein Titel genügt für den Anfang.</div><button class="btn primary" data-action="book-register">Buch registrieren</button></div>`}
    </div>`;
  },
  mount(root) {
    const form = root.querySelector('[data-book-meta]');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(form); const value = {};
      fd.forEach((v, key) => { value[key] = typeof v === 'string' ? v.trim() : v; });
      if (!value.title) { toast('Titel fehlt', 'warn'); return; }
      await store.performOp({ type: 'update-book', payload: {
        id: form.dataset.id, title: value.title, author: value.author || '', isbn: value.isbn || '',
        totalPages: value.totalPages ? Number(value.totalPages) : null, status: bookStatus(value.status),
        targetDate: value.targetDate || null, progress: Math.max(0, Math.min(100, Number(value.progress || 0))),
        coverUrl: value.coverUrl || '', fileUrl: value.fileUrl || '',
      } });
      toast('Buch aktualisiert ✓', 'ok');
    });
  },
};
