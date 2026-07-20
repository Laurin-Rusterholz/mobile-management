// ============================================================================
//  Mehr — Modul-Hub (Noteflow, Gewohnheiten, Flashcards, Budget, Gmail,
//  Meetings, Ideen, Inbox, Einstellungen, Integrationen)
// ============================================================================
import { escHTML } from '../util.js';
import { MORE_MODULES } from '../config.js';
import * as store from '../store.js';
import { pageHeader } from './common.js';

function badge(key) {
  if (key === 'flashcards') { const n = store.getDueCards().length; return n ? `<span class="tile-badge">${n}</span>` : ''; }
  if (key === 'inbox') { const n = store.getInboxItems().length; return n ? `<span class="tile-badge">${n}</span>` : ''; }
  if (key === 'gewohnheiten') { const n = store.getHabits().length; return n ? `<span class="tile-badge soft">${n}</span>` : ''; }
  return '';
}

export default {
  title: 'Mehr', icon: '⋯',
  render() {
    return `<div class="pad">
      ${pageHeader('Mehr', 'Alle Module')}
      <div class="tile-grid">
        ${MORE_MODULES.map(m => `
          <button class="tile" data-action="go" data-route="${m.route}">
            <span class="tile-icon">${m.icon}</span>
            <span class="tile-label">${escHTML(m.label)}</span>
            <span class="tile-desc">${escHTML(m.desc || '')}</span>
            ${badge(m.key)}
          </button>`).join('')}
      </div>
    </div>`;
  },
};
