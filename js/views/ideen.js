// ============================================================================
//  Ideen — schnelle Erfassung, Status, Umwandlung
// ============================================================================
import { escHTML, formatDate, openSheet, closeSheet, toast, newId, nowISO } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader } from './common.js';

const STATUS = { idea: 'Neu', neu: 'Neu', reviewed: 'Geprüft', planned: 'Geplant', archived: 'Archiviert' };

registerActions({
  'idea-open': (d) => {
    const i = store.getById('idea', d.id); if (!i) return;
    openSheet({ title: 'Idee', size: 'half', body: `<div class="detail">
      <div class="detail-title">${escHTML(i.title || '')}</div>
      ${i.text ? `<div class="detail-text">${escHTML(i.text)}</div>` : ''}
      <div class="muted-row">Status: ${escHTML(STATUS[i.status] || i.status || 'Neu')}</div>
      <div class="section-title">Umwandeln in</div>
      <div class="detail-actions">
        <button class="btn" data-action="idea-convert" data-id="${i.id}" data-to="task">✅ Aufgabe</button>
        <button class="btn" data-action="idea-convert" data-id="${i.id}" data-to="note">📝 Notiz</button>
        <button class="btn" data-action="idea-convert" data-id="${i.id}" data-to="project">📦 Projekt</button>
        <button class="btn" data-action="idea-convert" data-id="${i.id}" data-to="flashcard">🎴 Flashcard</button>
      </div>
      <div class="detail-actions">
        <button class="btn ghost" data-action="idea-status" data-id="${i.id}" data-s="planned">Als geplant</button>
        <button class="btn ghost" data-action="idea-status" data-id="${i.id}" data-s="archived">Archivieren</button>
      </div>
    </div>` });
  },
  'idea-status': async (d) => { await store.performOp({ type: 'update-idea', payload: { id: d.id, status: d.s } }); closeSheet(); toast('Aktualisiert', 'ok'); navigate('ideen'); },
  'idea-convert': async (d) => {
    const i = store.getById('idea', d.id); if (!i) return;
    const now = nowISO();
    if (d.to === 'task') await store.performOp({ type: 'add-task', payload: { id: newId('task'), title: i.title, description: i.text || '', status: 'todo', priority: 3, tags: [], source: 'mobile', linkedIdeas: [i.id], createdAt: now, updatedAt: now } });
    if (d.to === 'note') await store.performOp({ type: 'add-note', payload: { id: newId('note'), title: i.title, content: i.text || '', tags: [], source: 'mobile', linkedIdeas: [i.id], createdAt: now, updatedAt: now } });
    if (d.to === 'project') await store.performOp({ type: 'add-project', payload: { id: newId('project'), title: i.title, description: i.text || '', status: 'active', priority: 3, source: 'mobile', createdAt: now, updatedAt: now } });
    if (d.to === 'flashcard') {
      const decks = store.getDecks(); let deckId = decks[0] && decks[0].id;
      if (!deckId) { deckId = newId('deck'); await store.performOp({ type: 'add-deck', payload: { id: deckId, name: 'Mobile', createdAt: Date.now() } }); }
      await store.performOp({ type: 'add-flashcard', payload: { id: newId('card'), deckId, front: i.title, back: i.text || '', reversible: true, cardType: 'basic', srs: null, createdAt: Date.now() } });
    }
    await store.performOp({ type: 'update-idea', payload: { id: i.id, status: 'planned' } });
    closeSheet(); toast('Umgewandelt ✓', 'ok');
    navigate(d.to === 'note' ? 'noteflow' : d.to === 'flashcard' ? 'flashcards' : 'planen');
  },
});

export default {
  title: 'Ideen', icon: '💡',
  render() {
    const ideas = store.getIdeas().slice().reverse();
    return `<div class="pad">
      ${pageHeader('Ideen', ideas.length + ' erfasst', `<button class="chip" data-action="open-new" >＋ Idee</button>`)}
      ${ideas.length ? ideas.map(i => `
        <button class="card row-card" data-action="idea-open" data-id="${i.id}">
          <div class="row-main"><div class="row-title">💡 ${escHTML(i.title || '(ohne Titel)')}</div>
          ${i.text ? `<div class="row-sub">${escHTML(i.text.slice(0, 80))}</div>` : ''}</div>
          <span class="pill ${i.status === 'planned' ? 'accent' : ''}">${escHTML(STATUS[i.status] || 'Neu')}</span>
        </button>`).join('')
      : `<div class="empty"><div class="empty-icon">💡</div><div class="empty-title">Noch keine Ideen</div><div class="empty-sub">Tippe ＋ um eine festzuhalten.</div></div>`}
    </div>`;
  },
};
