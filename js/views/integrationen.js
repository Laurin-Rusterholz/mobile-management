// ============================================================================
//  Integrationen — Status der Backends & Dienste (read-only Übersicht)
// ============================================================================
import { escHTML } from '../util.js';
import { getBaseUrl, getBlobKey } from '../config.js';
import * as store from '../store.js';
import { pageHeader } from './common.js';

function statusChip(ok, label) { return `<span class="istatus ${ok ? 'ok' : 'warn'}">${label}</span>`; }

export default {
  title: 'Integrationen', icon: '🔌',
  render() {
    const connected = store.pullStatus() === 'ok';
    const hasGmail = Array.isArray(store.state.data && store.state.data.gmailIndex) && store.state.data.gmailIndex.length > 0;
    const hasRl = !!(store.state.data && store.state.data.recallLabData);
    const items = [
      { icon: '🗄️', name: 'Quantus-Blob', desc: getBaseUrl().replace(/^https?:\/\//, '') + ' · ' + getBlobKey(), ok: connected, note: connected ? 'Synchronisiert' : 'Nicht erreichbar' },
      { icon: '🔥', name: 'Firebase Storage', desc: 'jupidu-36804 · Datei-Downloads', ok: !!window.firebase, note: window.firebase ? 'SDK geladen' : 'SDK fehlt' },
      { icon: '📧', name: 'Gmail (via Quantus)', desc: 'Proxy /gmail-api', ok: hasGmail, note: hasGmail ? 'Cache vorhanden' : 'In Quantus verbinden' },
      { icon: '📆', name: 'Google Calendar (via Quantus)', desc: 'Proxy /gcal-api', ok: store.getMeetings().length > 0, note: store.getMeetings().length ? 'Meetings vorhanden' : 'Keine Daten' },
      { icon: '🛰️', name: 'Polaris / n8n', desc: 'quantus-agent Webhook', ok: true, note: 'Bei Bedarf verbunden' },
      { icon: '🎴', name: 'RecallLab (Flashcards)', desc: 'recallLabData im Blob', ok: hasRl, note: hasRl ? store.getCards().length + ' Karten' : 'Noch keine Karten' },
    ];
    return `<div class="pad">
      ${pageHeader('Integrationen', 'Bestehende Backend-Verbindungen')}
      <div class="muted-row" style="margin-bottom:10px">Diese App nutzt die bestehenden Quantus-Verbindungen unverändert weiter.</div>
      ${items.map(i => `<div class="card row-card">
        <div class="row-main"><div class="row-title">${i.icon} ${escHTML(i.name)}</div><div class="row-sub">${escHTML(i.desc)}</div></div>
        ${statusChip(i.ok, i.note)}
      </div>`).join('')}
    </div>`;
  },
};
