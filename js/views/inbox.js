// ============================================================================
//  Inbox — nicht zugeordnete Inhalte (Aufgaben ohne Projekt, offene Ideen,
//  Notizen ohne Notizbuch) mit Schnellzuordnung.
// ============================================================================
import { escHTML } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader } from './common.js';

const KIND = { task: { icon: '✅', route: 'planen' }, idea: { icon: '💡', route: 'ideen' }, note: { icon: '📝', route: 'noteflow' } };

registerActions({
  'inbox-open': (d) => navigate(KIND[d.kind] ? KIND[d.kind].route : 'home'),
  'inbox-idea-plan': async (d) => {
    const note = store.getById('note', d.id); if (!note || note.noteClass !== 'idea') return;
    await store.performOp({ type: 'update-note', payload: {
      id: note.id, ideaMeta: { ...(note.ideaMeta || {}), status: 'planned' },
    } });
  },
});

export default {
  title: 'Inbox', icon: '📥',
  render() {
    const items = store.getInboxItems();
    return `<div class="pad">
      ${pageHeader('Inbox', items.length + ' nicht zugeordnet')}
      ${items.length ? items.map(({ kind, item }) => {
        const label = item.title || item.text || item.content || '(ohne Titel)';
        return `<div class="card row-card">
          <div class="row-main" data-action="inbox-open" data-kind="${kind}"><div class="row-title">${KIND[kind].icon} ${escHTML(String(label).slice(0, 70))}</div>
          <div class="row-sub">${kind === 'task' ? 'Aufgabe ohne Projekt' : kind === 'idea' ? 'Offene Idee' : 'Notiz ohne Notizbuch'}</div></div>
          ${kind === 'idea' ? `<button class="chip accent" data-action="inbox-idea-plan" data-id="${item.id}">Geplant</button>` : `<button class="chip" data-action="inbox-open" data-kind="${kind}">Öffnen</button>`}
        </div>`;
      }).join('')
      : `<div class="empty"><div class="empty-icon">🎯</div><div class="empty-title">Inbox leer</div><div class="empty-sub">Alles zugeordnet. Saubere Sache.</div></div>`}
    </div>`;
  },
};
