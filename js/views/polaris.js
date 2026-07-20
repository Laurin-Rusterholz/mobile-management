// ============================================================================
//  Polaris — KI-Assistent (Chat)
//  Suchen/Zusammenfassen ohne Bestätigung. Interne Änderungen mit Vorschau/Undo;
//  Massenänderungen, Löschen, Mail-Senden, Kalender-/Finanzänderungen IMMER mit
//  Bestätigung. Backend: n8n quantus-agent Webhook (dieselbe Instanz wie Quantus).
// ============================================================================
import { escHTML, toast, newId, nowISO } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { pageHeader } from './common.js';

const AGENT_URL = 'https://n8n.srv1757990.hstgr.cloud/webhook/quantus-agent';
const SESSION_KEY = 'qm-polaris-session';

function sessionId() {
  let s = localStorage.getItem(SESSION_KEY);
  if (!s) { s = 'sess_' + newId('x').split('_')[1]; localStorage.setItem(SESSION_KEY, s); }
  return s;
}
function currentChat() {
  const chats = store.getChats();
  return chats[0] || null;
}

async function send(text) {
  if (!text.trim()) return;
  // Chat sicherstellen
  let chat = currentChat();
  if (!chat) { chat = { id: newId('chat'), title: text.slice(0, 40), messages: [], createdAt: nowISO(), updatedAt: nowISO() }; await store.performOp({ type: 'add-chat', payload: chat }); chat = currentChat(); }
  await store.performOp({ type: 'add-chat-message', payload: { chatId: chat.id, message: { role: 'user', content: text, timestamp: nowISO() } } });
  renderMessages();
  const bubble = appendPending();
  try {
    const r = await fetch(AGENT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId(), message: text, context: { activeView: 'polaris' } }),
    });
    const data = await r.json().catch(() => ({}));
    const reply = data.reply || data.output || data.text || 'Keine Antwort erhalten.';
    if (bubble) bubble.remove();
    await store.performOp({ type: 'add-chat-message', payload: { chatId: chat.id, message: { role: 'assistant', content: reply, timestamp: nowISO() } } });
    renderMessages();
  } catch (e) {
    if (bubble) bubble.remove();
    await store.performOp({ type: 'add-chat-message', payload: { chatId: chat.id, message: { role: 'assistant', content: '⚠️ Polaris nicht erreichbar (n8n). Deine Nachricht wurde gespeichert.', timestamp: nowISO() } } });
    renderMessages();
  }
}

function appendPending() {
  const host = document.getElementById('chatMessages'); if (!host) return null;
  const b = document.createElement('div'); b.className = 'chat-msg assistant pending'; b.textContent = 'Polaris denkt…';
  host.appendChild(b); host.scrollTop = host.scrollHeight; return b;
}
function renderMessages() {
  const host = document.getElementById('chatMessages'); if (!host) return;
  const chat = currentChat();
  const msgs = chat ? (chat.messages || []) : [];
  host.innerHTML = msgs.map(m => `<div class="chat-msg ${m.role}">${escHTML(m.content || '')}</div>`).join('')
    || `<div class="chat-intro">🛰️ Frag Polaris nach deinen Aufgaben, Projekten oder Notizen. Änderungen bestätigst du per Vorschau.</div>`;
  host.scrollTop = host.scrollHeight;
}

registerActions({
  'polaris-send': () => { const inp = document.getElementById('chatInput'); if (!inp) return; const t = inp.value; inp.value = ''; send(t); },
  'polaris-new': async () => { await store.performOp({ type: 'add-chat', payload: { id: newId('chat'), title: 'Neuer Chat', messages: [], createdAt: nowISO(), updatedAt: nowISO() } }); renderMessages(); toast('Neuer Chat', 'ok'); },
});

export default {
  title: 'Polaris', icon: '🛰️',
  render() {
    return `<div class="chat-view">
      <div class="chat-head">
        <div class="page-title">🛰️ Polaris</div>
        <button class="chip" data-action="polaris-new">＋ Neu</button>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input-bar">
        <input id="chatInput" class="input" placeholder="Frag Polaris…" autocomplete="off">
        <button class="btn primary" data-action="polaris-send">➤</button>
      </div>
    </div>`;
  },
  mount(root) {
    renderMessages();
    const inp = root.querySelector('#chatInput');
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const t = inp.value; inp.value = ''; send(t); } });
  },
};
