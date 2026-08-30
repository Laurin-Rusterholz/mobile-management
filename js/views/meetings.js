// ============================================================================
//  Meetings — Liste, Detail, Aktionspunkte als Aufgaben, Notiz in Noteflow
// ============================================================================
import { escHTML, formatDate, formatTime, openSheet, closeSheet, toast, newId, nowISO } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader } from './common.js';
import { openNoteComposer } from '../note-ui.js';

registerActions({
  'meeting-open': (d) => {
    const m = store.getById('meeting', d.id); if (!m) return;
    const items = Array.isArray(m.agendaItems) ? m.agendaItems : [];
    const notes = store.getNotesBySource('meetings', m.id);
    openSheet({ title: 'Meeting', size: 'full', body: `<div class="detail">
      <div class="detail-title">${escHTML(m.title || '(ohne Titel)')}</div>
      <div class="detail-badges">
        ${m.date ? `<span class="chip">📅 ${formatDate(m.date)}${m.startTime ? ' · ' + escHTML(m.startTime) : ''}</span>` : ''}
        ${m.location ? `<span class="chip">📍 ${escHTML(m.location)}</span>` : ''}
      </div>
      ${m.description ? `<div class="detail-text">${escHTML(m.description)}</div>` : ''}
      ${items.length ? `<div class="section-title">Agenda</div>${items.map(a => `<div class="mini-row"><span class="mini-dot"></span>${escHTML(typeof a === 'string' ? a : (a.text || a.title || ''))}</div>`).join('')}` : ''}
      <div class="detail-actions">
        <button class="btn" data-action="meeting-note" data-id="${m.id}">📝 Notiz hinzufügen</button>
        <button class="btn" data-action="meeting-task" data-id="${m.id}">✅ Aktionspunkt</button>
      </div>
      <div class="context-notes"><div class="section-title">Notizen (${notes.length})</div>
        ${notes.length ? notes.map(n => `<button class="context-note-row" data-action="meeting-note-open" data-id="${escHTML(n.id)}"><span>${escHTML(n.title || 'Meetingnotiz')}</span><b>›</b></button>`).join('') : '<div class="muted-row">Noch keine zentralen Notizen.</div>'}
      </div>
    </div>` });
  },
  'meeting-note': (d) => {
    const m = store.getById('meeting', d.id); if (!m) return;
    const label = m.title || 'Meeting';
    openNoteComposer({
      heading: 'Meetingnotiz', noteClass: 'research', tags: [label], lockedTags: [label],
      source: { app: 'meetings', entityType: 'meeting', entityId: m.id, label, route: `#/meetings?id=${encodeURIComponent(m.id)}` },
    });
  },
  'meeting-note-open': (d) => { closeSheet(); navigate('noteflow', { params: { id: d.id } }); },
  'meeting-task': async (d) => {
    const m = store.getById('meeting', d.id); if (!m) return;
    const title = prompt('Aktionspunkt / Aufgabe:'); if (!title) return;
    await store.performOp({ type: 'add-task', payload: { id: newId('task'), title, status: 'todo', priority: 3, source: 'mobile', linkedMeetings: [m.id], createdAt: nowISO(), updatedAt: nowISO() } });
    toast('Aufgabe erstellt', 'ok');
  },
});

export default {
  title: 'Meetings', icon: '🤝',
  render() {
    const meetings = store.getMeetings().slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const upcoming = meetings.filter(m => !m.date || new Date(m.date) >= new Date(new Date().toDateString()));
    const past = meetings.filter(m => m.date && new Date(m.date) < new Date(new Date().toDateString()));
    const row = m => `<button class="card row-card" data-action="meeting-open" data-id="${m.id}">
      <div class="row-main"><div class="row-title">🤝 ${escHTML(m.title || '(ohne Titel)')}</div>
      <div class="row-sub">${m.date ? formatDate(m.date) : 'ohne Datum'}${m.startTime ? ' · ' + escHTML(m.startTime) : ''}${m.location ? ' · ' + escHTML(m.location) : ''}</div></div>
      <span class="chip">›</span></button>`;
    return `<div class="pad">
      ${pageHeader('Meetings', meetings.length + ' Termine')}
      <div class="muted-row" style="margin-bottom:8px">Google-Calendar-Sync läuft über Quantus; hier siehst du die synchronisierten Meetings.</div>
      ${upcoming.length ? `<div class="section-title">Anstehend</div>${upcoming.map(row).join('')}` : ''}
      ${past.length ? `<div class="section-title">Vergangen</div>${past.slice(-20).reverse().map(row).join('')}` : ''}
      ${!meetings.length ? `<div class="empty"><div class="empty-icon">🤝</div><div class="empty-title">Keine Meetings</div><div class="empty-sub">Meetings aus Quantus erscheinen hier.</div></div>` : ''}
    </div>`;
  },
};
