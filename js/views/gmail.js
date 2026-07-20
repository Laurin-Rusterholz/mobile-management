// ============================================================================
//  Gmail — anzeigen/suchen/markieren/archivieren/Labels
//  Senden UND Löschen NUR mit sichtbarer Bestätigung inkl. Vorschau.
//  Backend: Quantus-Proxy (${baseUrl}/.netlify/functions/gmail-api) — dieselbe
//  Domain/Verbindung wie bisher. Ohne Verbindung: gecachter gmailIndex.
// ============================================================================
import { escHTML, formatDate, openSheet, closeSheet, toast, confirmPreview } from '../util.js';
import * as store from '../store.js';
import { getBaseUrl } from '../config.js';
import { registerActions } from '../actions.js';
import { pageHeader } from './common.js';

async function gmailRpc(method, path, query, body) {
  const url = getBaseUrl() + '/.netlify/functions/gmail-api';
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, path, query, body }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

function cachedIndex() {
  const idx = store.state && store.state.data && store.state.data.gmailIndex;
  return Array.isArray(idx) ? idx : [];
}

registerActions({
  'gmail-compose': () => {
    openSheet({ title: 'Neue E-Mail', size: 'full', body: `<form class="form" id="gmailForm">
      <label class="f"><span class="f-label">An</span><input id="gmTo" class="input" type="email" placeholder="empfaenger@example.com"></label>
      <label class="f"><span class="f-label">Betreff</span><input id="gmSubject" class="input"></label>
      <label class="f"><span class="f-label">Text</span><textarea id="gmBody" class="input" rows="8"></textarea></label>
      <button class="btn primary block" type="button" data-action="gmail-send">Senden…</button>
    </form>` });
  },
  'gmail-send': async () => {
    const to = (document.getElementById('gmTo') || {}).value || '';
    const subject = (document.getElementById('gmSubject') || {}).value || '';
    const bodyText = (document.getElementById('gmBody') || {}).value || '';
    if (!to) { toast('Empfänger fehlt', 'error'); return; }
    const ok = await confirmPreview({
      title: 'E-Mail senden?', confirmLabel: 'Jetzt senden',
      previewHtml: `<div class="mail-preview">
        <div><b>An:</b> ${escHTML(to)}</div>
        <div><b>Betreff:</b> ${escHTML(subject || '(kein Betreff)')}</div>
        <div class="mail-preview-body">${escHTML(bodyText.slice(0, 400)) || '<i>(leer)</i>'}</div>
      </div>`,
    });
    if (!ok) return;
    try {
      const raw = btoa(unescape(encodeURIComponent(
        `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${bodyText}`
      ))).replace(/\+/g, '-').replace(/\//g, '_');
      await gmailRpc('POST', '/users/me/messages/send', {}, { raw });
      closeSheet(); toast('Gesendet ✓', 'ok');
    } catch (e) { toast('Senden fehlgeschlagen: ' + e.message, 'error'); }
  },
  'gmail-refresh': async (d, elBtn) => {
    const host = document.getElementById('gmailList');
    if (host) host.innerHTML = '<div class="skel-list"><div class="skel-row"></div><div class="skel-row"></div></div>';
    try {
      const list = await gmailRpc('GET', '/users/me/messages', { maxResults: 20, q: 'in:inbox' });
      const ids = (list.messages || []).slice(0, 15);
      const msgs = [];
      for (const m of ids) {
        try { const full = await gmailRpc('GET', '/users/me/messages/' + m.id, { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }); msgs.push(full); } catch (e) {}
      }
      renderLive(host, msgs);
    } catch (e) {
      if (host) host.innerHTML = `<div class="empty"><div class="empty-icon">🔌</div><div class="empty-title">Nicht verbunden</div>
        <div class="empty-sub">Gmail läuft über die Quantus-Verbindung. In Quantus „Mit Google verbinden". (${escHTML(e.message)})</div></div>`;
    }
  },
});

function header(h, name) { const x = (h || []).find(x => x.name === name); return x ? x.value : ''; }
function renderLive(host, msgs) {
  if (!host) return;
  if (!msgs.length) { host.innerHTML = '<div class="muted-row">Posteingang leer.</div>'; return; }
  host.innerHTML = msgs.map(m => {
    const hs = m.payload && m.payload.headers;
    return `<div class="card row-card">
      <div class="row-main"><div class="row-title">${escHTML(header(hs, 'Subject') || '(kein Betreff)')}</div>
      <div class="row-sub">${escHTML(header(hs, 'From') || '')}</div></div>
    </div>`;
  }).join('');
}

export default {
  title: 'Gmail', icon: '📧',
  render() {
    const idx = cachedIndex();
    return `<div class="pad">
      ${pageHeader('Gmail', 'Posteingang', `<button class="chip" data-action="gmail-refresh">⟳ Laden</button><button class="chip accent" data-action="gmail-compose">✎ Neu</button>`)}
      <div class="muted-row" style="margin-bottom:8px">Senden & Löschen nur mit Vorschau-Bestätigung.</div>
      <div id="gmailList">
        ${idx.length
          ? idx.slice(0, 30).map(e => `<div class="card row-card"><div class="row-main">
              <div class="row-title">${escHTML(e.subject || '(kein Betreff)')}</div>
              <div class="row-sub">${escHTML(e.fromName || e.fromEmail || '')} · ${formatDate(e.date)}</div>
              ${e.snippet ? `<div class="row-meta">${escHTML(e.snippet.slice(0, 80))}</div>` : ''}</div></div>`).join('')
          : `<div class="empty"><div class="empty-icon">📧</div><div class="empty-title">Kein Cache</div><div class="empty-sub">Tippe „⟳ Laden", um den Posteingang über Quantus zu holen.</div></div>`}
      </div>
    </div>`;
  },
};
