// ============================================================================
//  Noteflow — Notizen mit Autosave, Verknüpfungen
// ============================================================================
import { escHTML, formatDate, openSheet, closeSheet, toast, newId, nowISO } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader } from './common.js';

let _saveTimer = null;

function openEditor(note) {
  const isNew = !note;
  const n = note || { id: newId('note'), title: '', content: '', tags: [], source: 'mobile', createdAt: nowISO(), updatedAt: nowISO() };
  openSheet({
    title: isNew ? 'Neue Notiz' : 'Notiz', size: 'full',
    body: `<form class="form note-editor">
      <input id="noteTitle" class="input note-title" placeholder="Titel" value="${escHTML(n.title || '')}">
      <textarea id="noteContent" class="input note-body" placeholder="Schreib los… (Autosave)">${escHTML(n.content || '')}</textarea>
      <div class="note-status" id="noteStatus">${isNew ? 'Wird beim Tippen gespeichert' : 'Gespeichert'}</div>
    </form>`,
    onMount: (root) => {
      const title = root.querySelector('#noteTitle');
      const content = root.querySelector('#noteContent');
      const status = root.querySelector('#noteStatus');
      let created = !isNew;
      const save = async () => {
        n.title = title.value.trim(); n.content = content.value; n.updatedAt = nowISO();
        status.textContent = 'Speichere…';
        await store.performOp({ type: created ? 'update-note' : 'add-note', payload: { ...n } });
        created = true; status.textContent = 'Gespeichert ✓';
      };
      const debounced = () => { clearTimeout(_saveTimer); status.textContent = '…'; _saveTimer = setTimeout(save, 700); };
      title.addEventListener('input', debounced);
      content.addEventListener('input', debounced);
    },
    onClose: () => { clearTimeout(_saveTimer); navigate('noteflow'); },
  });
}

registerActions({
  'note-open': (d) => { const n = store.getById('note', d.id); openEditor(n); },
  'note-new': () => openEditor(null),
  'note-to-task': async (d) => {
    const n = store.getById('note', d.id); if (!n) return;
    await store.performOp({ type: 'add-task', payload: { id: newId('task'), title: n.title || 'Aus Notiz', description: (n.content || '').slice(0, 500), status: 'todo', priority: 3, source: 'mobile', linkedNotes: [n.id], createdAt: nowISO(), updatedAt: nowISO() } });
    toast('Aufgabe aus Notiz erstellt', 'ok');
  },
});

export default {
  title: 'Noteflow', icon: '📝',
  render() {
    const notes = store.getNotes().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return `<div class="pad">
      ${pageHeader('Noteflow', notes.length + ' Notizen', `<button class="chip" data-action="note-new">＋ Notiz</button>`)}
      ${notes.length ? notes.map(n => `
        <div class="card row-card">
          <div class="row-main" data-action="note-open" data-id="${n.id}">
            <div class="row-title">${escHTML(n.title || '(ohne Titel)')}</div>
            <div class="row-sub">${escHTML((n.content || '').replace(/\s+/g, ' ').slice(0, 90))}</div>
            <div class="row-meta">${formatDate(n.updatedAt)}</div>
          </div>
          <button class="icon-btn" data-action="note-to-task" data-id="${n.id}" title="Als Aufgabe">✅</button>
        </div>`).join('')
      : `<div class="empty"><div class="empty-icon">📝</div><div class="empty-title">Keine Notizen</div><div class="empty-sub">Autosave, Verknüpfungen, in Aufgaben umwandeln.</div></div>`}
    </div>`;
  },
};
