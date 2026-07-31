// ============================================================================
//  Mail — eigenständiges Mail-Programm (Handy & Tablet)
//  ---------------------------------------------------------------------------
//  Ordner (Posteingang, Ungelesen, Markiert, Gesendet, Archiv, Papierkorb),
//  Volltextsuche, Konversation lesen, Antworten/Weiterleiten/Verfassen,
//  Gelesen-Status, Markieren, Archivieren, Papierkorb.
//  Backend: unveränderter Quantus-Proxy /.netlify/functions/gmail-api.
//  Ohne Verbindung wird der lokale Cache (bzw. der gmailIndex aus Quantus)
//  angezeigt — die App bleibt lesbar, Schreibaktionen melden sich sauber ab.
//  Senden und Löschen nur mit sichtbarer Vorschau-Bestätigung.
// ============================================================================
import { escHTML, formatDate, formatTime, openSheet, closeSheet, toast, confirmPreview, emptyState, skeletonList, haptic } from '../util.js';
import * as store from '../store.js';
import { getBaseUrl, LS } from '../config.js';
import { registerActions } from '../actions.js';
import { navigate, current } from '../router.js';
import { pageHeader } from './common.js';
import { isTablet } from '../shell.js';

// ── Ordner ──────────────────────────────────────────────────────────────────
const FOLDERS = [
  { key: 'inbox',   label: 'Posteingang', icon: '📥', q: 'in:inbox' },
  { key: 'unread',  label: 'Ungelesen',   icon: '🔵', q: 'is:unread in:inbox' },
  { key: 'starred', label: 'Markiert',    icon: '⭐', q: 'is:starred' },
  { key: 'sent',    label: 'Gesendet',    icon: '📤', q: 'in:sent' },
  { key: 'archive', label: 'Archiv',      icon: '🗄️', q: '-in:inbox -in:trash -in:sent' },
  { key: 'trash',   label: 'Papierkorb',  icon: '🗑️', q: 'in:trash' },
];

const PAGE_SIZE = 25;

// ── lokaler Zustand des Programms ───────────────────────────────────────────
const ui = {
  folder: 'inbox',
  search: '',
  loading: false,
  error: '',
  list: [],           // Kopfdaten der geladenen Nachrichten
  openId: null,       // aktuell geöffnete Nachricht
  body: null,         // { id, html, text, from, to, subject, date }
  bodyLoading: false,
  profile: null,      // { emailAddress }
};

function cacheKey() { return ui.search ? 'search' : ui.folder; }

function loadCache() {
  try {
    const all = JSON.parse(localStorage.getItem(LS.mailCache) || '{}');
    const hit = all[cacheKey()];
    return Array.isArray(hit) ? hit : null;
  } catch (e) { return null; }
}

function saveCache(list) {
  try {
    const all = JSON.parse(localStorage.getItem(LS.mailCache) || '{}');
    all[cacheKey()] = list.slice(0, 60);
    localStorage.setItem(LS.mailCache, JSON.stringify(all));
  } catch (e) { /* Quota — Cache ist optional */ }
}

// ── Backend ─────────────────────────────────────────────────────────────────
async function rpc(method, path, query, body) {
  const url = getBaseUrl() + '/.netlify/functions/gmail-api';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, query, body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.message || ('HTTP ' + r.status));
  return data;
}

function header(headers, name) {
  const hit = (headers || []).find(h => String(h.name).toLowerCase() === name.toLowerCase());
  return hit ? hit.value : '';
}

function parseAddress(value) {
  const raw = String(value || '');
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  return { name: raw.trim(), email: raw.trim() };
}

function toSummary(msg) {
  const hs = msg.payload && msg.payload.headers;
  const from = parseAddress(header(hs, 'From'));
  const to = parseAddress(header(hs, 'To'));
  const labels = msg.labelIds || [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    fromName: from.name,
    fromEmail: from.email,
    toEmail: to.email,
    subject: header(hs, 'Subject') || '(kein Betreff)',
    date: header(hs, 'Date') || '',
    ts: Number(msg.internalDate || 0) || Date.parse(header(hs, 'Date') || '') || 0,
    snippet: msg.snippet || '',
    unread: labels.includes('UNREAD'),
    starred: labels.includes('STARRED'),
    labelIds: labels,
  };
}

// Der Gmail-Proxy kennt keinen Batch-Endpunkt — die Kopfdaten werden daher
// einzeln, aber parallel geladen. Das bleibt bei 25 Nachrichten schnell.
async function fetchList() {
  const folder = FOLDERS.find(f => f.key === ui.folder) || FOLDERS[0];
  const q = ui.search ? ui.search : folder.q;
  const list = await rpc('GET', '/users/me/messages', { maxResults: PAGE_SIZE, q });
  const ids = (list.messages || []).slice(0, PAGE_SIZE);
  const results = await Promise.all(ids.map(m =>
    rpc('GET', '/users/me/messages/' + encodeURIComponent(m.id), {
      format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'],
    }).then(toSummary).catch(() => null)
  ));
  return results.filter(Boolean).sort((a, b) => b.ts - a.ts);
}

function decodeBody(data) {
  try {
    const base64 = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) { return ''; }
}

// text/plain bevorzugen; nur wenn es keine Textvariante gibt, wird HTML
// entschärft (Tags entfernt) angezeigt — es wird nie fremdes HTML eingebettet.
function extractBody(payload) {
  const out = { text: '', html: '', attachments: [] };
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    if (part.filename && part.body && part.body.attachmentId) {
      out.attachments.push({ name: part.filename, size: part.body.size || 0, mime });
    } else if (mime === 'text/plain' && part.body && part.body.data && !out.text) {
      out.text = decodeBody(part.body.data);
    } else if (mime === 'text/html' && part.body && part.body.data && !out.html) {
      out.html = decodeBody(part.body.data);
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Rendering-Hilfen ────────────────────────────────────────────────────────
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}

function avatarTone(email) {
  const tones = ['violet', 'blue', 'green', 'sand', 'red', 'pink'];
  let sum = 0;
  String(email || '').split('').forEach(c => { sum += c.charCodeAt(0); });
  return tones[sum % tones.length];
}

function when(item) {
  if (!item.ts) return '';
  const d = new Date(item.ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? formatTime(d.toISOString()) : formatDate(d.toISOString());
}

function rowHtml(item) {
  return `<div class="mail-row ${item.unread ? 'unread' : ''} ${ui.openId === item.id ? 'active' : ''}"
      data-action="mail-open" data-id="${item.id}">
    <span class="mail-avatar ${avatarTone(item.fromEmail)}">${escHTML(initials(item.fromName || item.fromEmail))}</span>
    <div class="mail-row-main">
      <div class="mail-row-top">
        <span class="mail-from">${escHTML(item.fromName || item.fromEmail || 'Unbekannt')}</span>
        <span class="mail-when">${escHTML(when(item))}</span>
      </div>
      <div class="mail-subject">${escHTML(item.subject)}</div>
      <div class="mail-snippet">${escHTML(String(item.snippet || '').slice(0, 110))}</div>
    </div>
    <button class="mail-star ${item.starred ? 'on' : ''}" data-action="mail-star" data-id="${item.id}"
      aria-label="Markieren">${item.starred ? '★' : '☆'}</button>
  </div>`;
}

function listHtml() {
  if (ui.loading && !ui.list.length) return skeletonList(6);
  if (ui.error && !ui.list.length) {
    return emptyState('🔌', 'Nicht verbunden',
      'Mail läuft über die Quantus-Verbindung. In Quantus „Mit Google verbinden". (' + ui.error + ')',
      '<button class="btn primary" data-action="mail-refresh">Erneut versuchen</button>');
  }
  if (!ui.list.length) return emptyState('📭', 'Nichts hier', 'Dieser Ordner ist leer.');
  return `<div class="mail-list">${ui.list.map(rowHtml).join('')}</div>`;
}

function folderChips() {
  return `<div class="mail-folders">${FOLDERS.map(f => `
    <button class="chip ${ui.folder === f.key && !ui.search ? 'accent' : ''}" data-action="mail-folder" data-folder="${f.key}">
      ${f.icon} ${escHTML(f.label)}
    </button>`).join('')}</div>`;
}

function detailHtml() {
  if (ui.bodyLoading) return `<div class="mail-detail">${skeletonList(4)}</div>`;
  const item = ui.list.find(m => m.id === ui.openId);
  if (!item) return `<div class="mail-detail empty-pane">${emptyState('✉️', 'Keine Nachricht gewählt', 'Wähle links eine Nachricht aus.')}</div>`;
  const body = ui.body && ui.body.id === item.id ? ui.body : null;
  const text = body ? (body.text || htmlToText(body.html)) : '';
  return `<div class="mail-detail">
    <div class="mail-detail-head">
      <button class="chip" data-action="mail-close">‹ Zurück</button>
      <div class="mail-detail-actions">
        <button class="chip" data-action="mail-reply" data-id="${item.id}">↩︎ Antworten</button>
        <button class="chip" data-action="mail-forward" data-id="${item.id}">↪︎ Weiterleiten</button>
        <button class="chip" data-action="mail-toggle-read" data-id="${item.id}">${item.unread ? 'Als gelesen' : 'Als ungelesen'}</button>
        <button class="chip" data-action="mail-archive" data-id="${item.id}">🗄️ Archiv</button>
        <button class="chip danger" data-action="mail-trash" data-id="${item.id}">🗑️ Papierkorb</button>
      </div>
    </div>
    <div class="mail-detail-subject">${escHTML(item.subject)}</div>
    <div class="mail-detail-meta">
      <span class="mail-avatar ${avatarTone(item.fromEmail)}">${escHTML(initials(item.fromName || item.fromEmail))}</span>
      <div>
        <div class="mail-detail-from">${escHTML(item.fromName || item.fromEmail)}</div>
        <div class="mail-detail-sub">${escHTML(item.fromEmail)} · ${escHTML(item.date ? new Date(item.ts).toLocaleString('de-CH') : '')}</div>
      </div>
    </div>
    ${body && body.attachments.length ? `<div class="mail-attachments">${body.attachments.map(a =>
      `<span class="mail-attachment">📎 ${escHTML(a.name)}</span>`).join('')}</div>` : ''}
    <div class="mail-body">${text ? escHTML(text) : escHTML(item.snippet || '')}</div>
  </div>`;
}

// ── Aktionen ────────────────────────────────────────────────────────────────
function rerender() {
  if (current().route === 'mail') store.notify();
}

async function refresh(showSpinner = true) {
  if (showSpinner) { ui.loading = true; ui.error = ''; rerender(); }
  try {
    ui.list = await fetchList();
    ui.error = '';
    saveCache(ui.list);
  } catch (e) {
    ui.error = e.message || String(e);
    const cached = loadCache();
    if (cached && cached.length) ui.list = cached;
    else if (ui.folder === 'inbox' && !ui.search) ui.list = fromQuantusIndex();
  } finally {
    ui.loading = false;
    rerender();
  }
}

// Fallback ohne Verbindung: der von Quantus mitsynchronisierte Index.
function fromQuantusIndex() {
  const idx = store.state && store.state.data && store.state.data.gmailIndex;
  if (!Array.isArray(idx)) return [];
  return idx.slice(0, 40).map(e => ({
    id: e.id || e.messageId || String(e.date || Math.random()),
    threadId: e.threadId || null,
    fromName: e.fromName || e.fromEmail || '',
    fromEmail: e.fromEmail || '',
    toEmail: '',
    subject: e.subject || '(kein Betreff)',
    date: e.date || '',
    ts: Date.parse(e.date || '') || 0,
    snippet: e.snippet || '',
    unread: !!e.unread,
    starred: false,
    labelIds: [],
    offline: true,
  })).sort((a, b) => b.ts - a.ts);
}

async function openMessage(id) {
  ui.openId = id;
  ui.bodyLoading = true;
  rerender();
  try {
    const full = await rpc('GET', '/users/me/messages/' + encodeURIComponent(id), { format: 'full' });
    const parts = extractBody(full.payload);
    ui.body = { id, text: parts.text, html: parts.html, attachments: parts.attachments };
    // Beim Öffnen als gelesen markieren (wie in jedem Mail-Programm).
    const item = ui.list.find(m => m.id === id);
    if (item && item.unread) {
      item.unread = false;
      rpc('POST', '/users/me/messages/' + encodeURIComponent(id) + '/modify', {}, { removeLabelIds: ['UNREAD'] })
        .catch(() => { item.unread = true; });
    }
  } catch (e) {
    ui.body = { id, text: '', html: '', attachments: [] };
    toast('Nachricht konnte nicht geladen werden: ' + (e.message || e), 'error');
  } finally {
    ui.bodyLoading = false;
    rerender();
  }
}

function quoteOf(item, body) {
  const text = body ? (body.text || htmlToText(body.html)) : (item.snippet || '');
  return '\n\n> ' + String(text).split('\n').slice(0, 40).join('\n> ');
}

function composeSheet({ to = '', subject = '', body = '', title = 'Neue E-Mail' }) {
  openSheet({
    title, size: 'full',
    body: `<form class="form" id="mailForm">
      <label class="f"><span class="f-label">An</span><input id="mlTo" class="input" type="email" value="${escHTML(to)}" placeholder="empfaenger@example.com"></label>
      <label class="f"><span class="f-label">Kopie (optional)</span><input id="mlCc" class="input" type="email" placeholder="cc@example.com"></label>
      <label class="f"><span class="f-label">Betreff</span><input id="mlSubject" class="input" value="${escHTML(subject)}"></label>
      <label class="f"><span class="f-label">Text</span><textarea id="mlBody" class="input" rows="12">${escHTML(body)}</textarea></label>
      <button class="btn primary block" type="button" data-action="mail-send">Senden…</button>
      <div class="muted-row">Vor dem Versand erscheint eine Vorschau zur Bestätigung.</div>
    </form>`,
  });
}

function encodeRaw({ to, cc, subject, text }) {
  const lines = [
    'To: ' + to,
    cc ? 'Cc: ' + cc : null,
    'Subject: =?UTF-8?B?' + btoa(unescape(encodeURIComponent(subject || ''))) + '?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(text || ''))),
  ].filter(l => l != null);
  return btoa(unescape(encodeURIComponent(lines.join('\r\n'))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

registerActions({
  'mail-folder': (d) => { ui.folder = d.folder; ui.search = ''; ui.openId = null; ui.body = null; ui.list = loadCache() || []; refresh(); },
  'mail-refresh': () => refresh(),
  'mail-open': (d) => { haptic(10); openMessage(d.id); },
  'mail-close': () => { ui.openId = null; ui.body = null; rerender(); },

  'mail-star': async (d, el, e) => {
    if (e) e.stopPropagation();
    const item = ui.list.find(m => m.id === d.id);
    if (!item) return;
    const next = !item.starred;
    item.starred = next;
    rerender();
    try {
      await rpc('POST', '/users/me/messages/' + encodeURIComponent(d.id) + '/modify', {},
        next ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] });
    } catch (err) {
      item.starred = !next;
      toast('Markierung fehlgeschlagen: ' + (err.message || err), 'error');
      rerender();
    }
  },

  'mail-toggle-read': async (d) => {
    const item = ui.list.find(m => m.id === d.id);
    if (!item) return;
    const next = !item.unread;
    item.unread = next;
    rerender();
    try {
      await rpc('POST', '/users/me/messages/' + encodeURIComponent(d.id) + '/modify', {},
        next ? { addLabelIds: ['UNREAD'] } : { removeLabelIds: ['UNREAD'] });
    } catch (err) {
      item.unread = !next;
      toast('Status konnte nicht gesetzt werden', 'error');
      rerender();
    }
  },

  'mail-archive': async (d) => {
    try {
      await rpc('POST', '/users/me/messages/' + encodeURIComponent(d.id) + '/modify', {}, { removeLabelIds: ['INBOX'] });
      ui.list = ui.list.filter(m => m.id !== d.id);
      ui.openId = null; ui.body = null;
      saveCache(ui.list);
      toast('Archiviert ✓', 'ok');
      rerender();
    } catch (err) { toast('Archivieren fehlgeschlagen: ' + (err.message || err), 'error'); }
  },

  'mail-trash': async (d) => {
    const item = ui.list.find(m => m.id === d.id);
    if (!item) return;
    const ok = await confirmPreview({
      title: 'In den Papierkorb?', confirmLabel: 'Verschieben', danger: true,
      previewHtml: `<div class="mail-preview">
        <div><b>Von:</b> ${escHTML(item.fromName || item.fromEmail)}</div>
        <div><b>Betreff:</b> ${escHTML(item.subject)}</div>
        <div class="mail-preview-body">${escHTML(String(item.snippet || '').slice(0, 300))}</div>
      </div>`,
    });
    if (!ok) return;
    try {
      await rpc('POST', '/users/me/messages/' + encodeURIComponent(d.id) + '/modify', {},
        { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] });
      ui.list = ui.list.filter(m => m.id !== d.id);
      ui.openId = null; ui.body = null;
      saveCache(ui.list);
      toast('In den Papierkorb verschoben', 'ok');
      rerender();
    } catch (err) { toast('Fehlgeschlagen: ' + (err.message || err), 'error'); }
  },

  'mail-compose': () => composeSheet({}),

  'mail-reply': (d) => {
    const item = ui.list.find(m => m.id === d.id);
    if (!item) return;
    composeSheet({
      title: 'Antworten',
      to: item.fromEmail,
      subject: /^re:/i.test(item.subject) ? item.subject : 'Re: ' + item.subject,
      body: quoteOf(item, ui.body && ui.body.id === item.id ? ui.body : null),
    });
  },

  'mail-forward': (d) => {
    const item = ui.list.find(m => m.id === d.id);
    if (!item) return;
    composeSheet({
      title: 'Weiterleiten',
      subject: /^fwd:/i.test(item.subject) ? item.subject : 'Fwd: ' + item.subject,
      body: '\n\n--- Weitergeleitete Nachricht ---\nVon: ' + (item.fromName || item.fromEmail) +
        '\nBetreff: ' + item.subject + quoteOf(item, ui.body && ui.body.id === item.id ? ui.body : null),
    });
  },

  'mail-send': async () => {
    const to = (document.getElementById('mlTo') || {}).value || '';
    const cc = (document.getElementById('mlCc') || {}).value || '';
    const subject = (document.getElementById('mlSubject') || {}).value || '';
    const text = (document.getElementById('mlBody') || {}).value || '';
    if (!to.trim()) { toast('Empfänger fehlt', 'error'); return; }
    const ok = await confirmPreview({
      title: 'E-Mail senden?', confirmLabel: 'Jetzt senden',
      previewHtml: `<div class="mail-preview">
        <div><b>An:</b> ${escHTML(to)}</div>
        ${cc ? `<div><b>Kopie:</b> ${escHTML(cc)}</div>` : ''}
        <div><b>Betreff:</b> ${escHTML(subject || '(kein Betreff)')}</div>
        <div class="mail-preview-body">${escHTML(text.slice(0, 400)) || '<i>(leer)</i>'}</div>
      </div>`,
    });
    if (!ok) return;
    try {
      await rpc('POST', '/users/me/messages/send', {}, { raw: encodeRaw({ to, cc, subject, text }) });
      closeSheet();
      toast('Gesendet ✓', 'ok');
      if (ui.folder === 'sent') refresh(false);
    } catch (e) {
      toast('Senden fehlgeschlagen: ' + (e.message || e), 'error');
    }
  },
});

// ── View ────────────────────────────────────────────────────────────────────
export default {
  title: 'Mail', icon: '✉️',
  render() {
    const folder = FOLDERS.find(f => f.key === ui.folder) || FOLDERS[0];
    const unread = ui.list.filter(m => m.unread).length;
    const split = isTablet() && ui.openId;
    return `<div class="pad mail-app">
      ${pageHeader('Mail', ui.search ? 'Suche: ' + ui.search : folder.label + (unread ? ' · ' + unread + ' ungelesen' : ''),
        `<button class="chip" data-action="mail-refresh">⟳</button>
         <button class="chip accent" data-action="mail-compose">✎ Neu</button>`)}
      <div class="mail-searchbar">
        <input class="input" id="mailSearch" type="search" placeholder="In allen Mails suchen (z. B. from:rechnung)"
          value="${escHTML(ui.search)}">
      </div>
      ${folderChips()}
      ${ui.error && ui.list.length ? `<div class="muted-row">Offline — gespeicherter Stand. (${escHTML(ui.error)})</div>` : ''}
      <div class="mail-layout ${split ? 'split' : ''}">
        <div class="mail-pane-list ${ui.openId && !isTablet() ? 'hidden-phone' : ''}">${listHtml()}</div>
        ${ui.openId ? `<div class="mail-pane-detail">${detailHtml()}</div>` : (isTablet() ? `<div class="mail-pane-detail">${detailHtml()}</div>` : '')}
      </div>
    </div>`;
  },

  mount(root) {
    // Suchfeld reagiert auf Enter/change statt auf jeden Tastendruck.
    const input = root.querySelector('#mailSearch');
    if (input) {
      input.addEventListener('change', () => {
        const value = input.value.trim();
        if (value === ui.search) return;
        ui.search = value;
        ui.openId = null;
        ui.body = null;
        refresh();
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    }
    // Erste Anzeige aus dem Cache, dann live nachladen.
    if (!ui.list.length) {
      const cached = loadCache();
      if (cached && cached.length) ui.list = cached;
    }
    if (!ui._loadedOnce) { ui._loadedOnce = true; refresh(!ui.list.length); }
  },
};

// Für die Shell: Anzahl ungelesener Nachrichten im Tab-Badge.
export function unreadCount() { return ui.list.filter(m => m.unread).length; }
window.__quantusMailUnread = unreadCount;
