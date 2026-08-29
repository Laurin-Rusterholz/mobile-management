// ============================================================================
//  Ideas — Ansicht auf zentrale noteClass=idea-Notizen (Single Source of Truth)
// ============================================================================
import { escHTML, formatDate, closeSheet, toast, newId, nowISO, openSheet } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader } from './common.js';
import { openIdeaComposer } from '../note-ui.js';

const statusOf = (note) => (note.ideaMeta && note.ideaMeta.status) || note.status || 'idea';
const STATUS = { idea: 'Neu', neu: 'Neu', reviewed: 'Geprüft', planned: 'Geplant', archived: 'Archiviert' };

registerActions({
  'idea-new': () => openIdeaComposer(),
  'idea-open': (data) => {
    const note = store.getById('note', data.id); if (!note || note.noteClass !== 'idea') return;
    openSheet({ title: 'Idee', size: 'half', body: `<div class="detail">
      <div class="detail-title">${escHTML(note.title || '')}</div>
      <div class="note-tags">${(note.tags || []).map((tag) => `<span>#${escHTML(tag)}</span>`).join('')}</div>
      <div class="detail-text">${escHTML(note.content || '')}</div>
      <div class="muted-row">Status: ${escHTML(STATUS[statusOf(note)] || statusOf(note))}</div>
      <div class="detail-actions">
        <button class="btn primary" data-action="idea-edit" data-id="${escHTML(note.id)}">✎ Bearbeiten</button>
        <button class="btn" data-action="idea-convert" data-id="${escHTML(note.id)}" data-to="task">✅ Aufgabe</button>
        <button class="btn" data-action="idea-convert" data-id="${escHTML(note.id)}" data-to="project">📦 Projekt</button>
        <button class="btn" data-action="idea-convert" data-id="${escHTML(note.id)}" data-to="flashcard">🎴 Flashcard</button>
      </div>
      <div class="detail-actions">
        <button class="btn ghost" data-action="idea-status" data-id="${escHTML(note.id)}" data-s="planned">Als geplant</button>
        <button class="btn ghost" data-action="idea-status" data-id="${escHTML(note.id)}" data-s="archived">Archivieren</button>
      </div>
    </div>` });
  },
  'idea-edit': (data) => {
    const note = store.getById('note', data.id); if (!note) return;
    openIdeaComposer(note);
  },
  'idea-status': async (data) => {
    const note = store.getById('note', data.id); if (!note) return;
    await store.performOp({ type: 'update-note', payload: {
      id: note.id, ideaMeta: { ...(note.ideaMeta || {}), status: data.s },
    } });
    closeSheet(); toast('Aktualisiert', 'ok'); navigate('ideen');
  },
  'idea-convert': async (data) => {
    const note = store.getById('note', data.id); if (!note) return;
    const now = nowISO();
    if (data.to === 'task') await store.performOp({ type: 'add-task', payload: {
      id: newId('task'), title: note.title, description: note.content || '', status: 'todo', priority: 3,
      tags: note.tags || [], source: 'mobile', linkedNotes: [note.id], createdAt: now, updatedAt: now,
    } });
    if (data.to === 'project') await store.performOp({ type: 'add-project', payload: {
      id: newId('project'), title: note.title, description: note.content || '', status: 'active', priority: 3,
      tags: note.tags || [], source: 'mobile', linkedNotes: [note.id], createdAt: now, updatedAt: now,
    } });
    if (data.to === 'flashcard') {
      const decks = store.getDecks(); let deckId = decks[0] && decks[0].id;
      if (!deckId) { deckId = newId('deck'); await store.performOp({ type: 'add-deck', payload: { id: deckId, name: 'Mobile', createdAt: Date.now() } }); }
      await store.performOp({ type: 'add-flashcard', payload: {
        id: newId('card'), deckId, front: note.title, back: note.content || '', reversible: true,
        cardType: 'basic', tags: note.tags || [], srs: null, sourceNoteId: note.id, createdAt: Date.now(),
      } });
    }
    await store.performOp({ type: 'update-note', payload: {
      id: note.id, ideaMeta: { ...(note.ideaMeta || {}), status: 'planned', convertedTo: data.to },
    } });
    closeSheet(); toast('Umgewandelt ✓', 'ok');
    navigate(data.to === 'flashcard' ? 'flashcards' : 'planen');
  },
});

export default {
  title: 'Ideen', icon: '💡',
  render() {
    const ideas = store.getIdeaNotes().filter((note) => statusOf(note) !== 'archived')
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    return `<div class="pad">
      ${pageHeader('Ideen', ideas.length + ' erfasst', `<button class="chip accent" data-action="idea-new">＋ Idee</button>`)}
      <div class="muted-row">Jede Idee ist zugleich eine zentrale Notiz in Noteflow. Kategorie und Inhalt sind Pflicht.</div>
      ${ideas.length ? ideas.map((note) => `<button class="card row-card" data-action="idea-open" data-id="${escHTML(note.id)}">
        <div class="row-main"><div class="row-title">💡 ${escHTML(note.title || '(ohne Titel)')}</div>
          <div class="row-sub">${escHTML(String(note.content || '').slice(0, 90))}</div>
          <div class="row-meta">${escHTML((note.tags || [])[0] || 'Ohne Kategorie')} · ${formatDate(note.updatedAt || note.createdAt)}</div>
        </div><span class="pill ${statusOf(note) === 'planned' ? 'accent' : ''}">${escHTML(STATUS[statusOf(note)] || 'Neu')}</span>
      </button>`).join('')
        : `<div class="empty"><div class="empty-icon">💡</div><div class="empty-title">Noch keine Ideen</div><div class="empty-sub">Erfasse Kategorie und Idee – ohne neues Notizbuch.</div></div>`}
    </div>`;
  },
};
