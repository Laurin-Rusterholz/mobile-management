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
import { getBaseUrl, LS, authHeaders } from '../config.js';
import { registerActions } from '../actions.js';
import { navigate, current } from '../router.js';
import { pageHeader } from './common.js';
import { isTablet } from '../shell.js';

// ── Ordner ──────────────────────────────────────────────────────────────────
const FOLDERS = [
  { key: 'inbox',   label: 'Posteingang', icon: '📥', q: 'in:inbox' },
  { key: 'unread',  label: 'Ungelesen',   icon: '🔵', q: 'is:unread in:inbox' },
  { key: 'starred', label: 'Markiert',    icon: '⭐', q: 'is:starred' },
  { key: 'outbox',  label: 'Ausgang (geplant)', icon: '🕒', warteschlange: true },
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
  plain: false,       // Nur-Text statt Original-Darstellung (pro Sitzung)
  ausgang: [],        // geplante ausgehende Mails aus der Server-Warteschlange
  sendeSchluessel: null,  // stabiler Schlüssel des laufenden Sendeversuchs
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

/* ── Geplanter Versand (13.09.2026) ──────────────────────────────────────────
   Ausgehende Mails gehen standardmaessig erst in DREI STUNDEN raus. Geplant,
   gehalten und gesendet wird serverseitig (/.netlify/functions/mail-queue) —
   nicht mit einem Timer im Telefon, das jederzeit zugeklappt wird. Die
   Gmail-API kennt keine Versandplanung (Discovery v1, Revision 20260907), und
   Gmails Ansicht „Geplant" wird hier nicht vorgetaeuscht: was hier steht, ist
   Quantus' eigener Ausgang. */
const VERSANDZONE = 'Europe/Zurich';

async function queueRpc(aktion, daten) {
  const url = getBaseUrl() + '/.netlify/functions/mail-queue';
  const r = await fetch(url, {
    method: 'POST',
    /* Der Ausgang ist fail-closed: ohne Zugangsschlüssel gibt der Server
       nichts heraus und plant nichts ein. Dieses Gerät schickt denselben
       Schlüssel mit, den Quantus am Rechner führt — aus dem Gerätespeicher,
       nie aus dem Quelltext und nie in der Adresse. */
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify(Object.assign({ aktion }, daten || {})),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.grund || data.error || ('HTTP ' + r.status));
  return data;
}

/* Ein stabiler Schlüssel je Sendeversuch: Geht die Antwort verloren und
   jemand tippt noch einmal auf Senden, landet der zweite Versuch auf
   derselben Stelle im Ausgang — statt als zweiter Eintrag und damit später
   als zweite Mail. */
function anfrageSchluessel() {
  try { if (window.crypto && crypto.randomUUID) return 'a' + crypto.randomUUID().replace(/-/g, ''); } catch (e) { /* ältere Browser */ }
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

function zuercherZeit(ms) {
  const t = Number(ms);
  if (!isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('de-CH', { timeZone: VERSANDZONE, day: '2-digit', month: '2-digit',
      year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
  } catch (e) { return new Date(t).toLocaleString('de-CH'); }
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

// Beide Fassungen einsammeln: die HTML-Fassung IST bei den meisten Mails die
// Nachricht (Newsletter, Rechnungen, Signaturen), text/plain nur ihr Abfall.
// Anhaenge kommen mit ihrer attachmentId und ihrer Content-ID heraus — ohne
// die Kennung liesse sich weder ein Anhang laden noch ein eingebettetes Bild
// aufloesen (siehe resolveInlineImages).
function partHeader(part, name) {
  const hs = (part && part.headers) || [];
  const hit = hs.find(h => String(h.name).toLowerCase() === name.toLowerCase());
  return hit ? String(hit.value || '') : '';
}

function extractBody(payload) {
  const out = { text: '', html: '', attachments: [] };
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    const body = part.body || {};
    const cid = partHeader(part, 'Content-ID').replace(/^<|>$/g, '');
    const disposition = partHeader(part, 'Content-Disposition').toLowerCase();
    if (body.attachmentId) {
      out.attachments.push({
        name: part.filename || (cid ? 'Bild' : 'Anhang'),
        size: body.size || 0,
        mime,
        attachmentId: body.attachmentId,
        cid,
        inline: !!cid || disposition.startsWith('inline'),
      });
    } else if (mime === 'text/plain' && body.data && !out.text && !part.filename) {
      out.text = decodeBody(body.data);
    } else if (mime === 'text/html' && body.data && !out.html) {
      out.html = decodeBody(body.data);
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
}

// Eingebettete Bilder tragen im HTML kein http-Ziel, sondern src="cid:…" —
// eine Verweisform, die ein Browser NICHT aufloesen kann. Genau daran lag es,
// dass Bilder nicht luden: sie waren gar nie geladen worden. Der Gmail-Proxy
// kennt /messages/<id>/attachments/<id>; von dort kommt der Inhalt als
// base64url und wird als data:-URL an die Stelle des cid-Verweises gesetzt.
async function resolveInlineImages(msgId, html, attachments) {
  if (!html || !/cid:/i.test(html)) return html;
  const inline = (attachments || []).filter(a => a.cid && a.attachmentId && a.size < 6 * 1024 * 1024);
  let out = html;
  for (const a of inline.slice(0, 25)) {
    const cid = a.cid.trim();
    if (!cid) continue;
    const muster = new RegExp('cid:' + cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (!muster.test(out)) continue;
    muster.lastIndex = 0;
    try {
      const res = await rpc('GET', '/users/me/messages/' + encodeURIComponent(msgId) +
        '/attachments/' + encodeURIComponent(a.attachmentId));
      const b64 = String((res && res.data) || '').replace(/-/g, '+').replace(/_/g, '/');
      if (!b64) continue;
      out = out.replace(muster, 'data:' + (a.mime || 'image/png') + ';base64,' + b64);
      a.resolved = true;
    } catch (e) { /* ein Bild weniger ist kein Grund, die Mail nicht zu zeigen */ }
  }
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

// ── Die Mail als Mail anzeigen ──────────────────────────────────────────────
// BEFUND: der Rumpf wurde als escHTML(htmlToText(html)) ausgegeben. Damit war
// jede HTML-Mail eine Wand aus Text: keine Absaetze, keine Ueberschriften,
// keine Tabellen, keine Links — und kein einziges Bild, denn <img> war unter
// den entfernten Tags. „Komisch angezeigt" war also kein Stilproblem, sondern
// der Verzicht auf die Darstellung ueberhaupt.
//
// Fremdes HTML kommt trotzdem nicht in unser Dokument: es laeuft in einem
// abgeschotteten <iframe> mit srcdoc, OHNE allow-scripts (Mail-JavaScript kann
// also nicht laufen) und mit einer eigenen CSP als zweiter Schranke.
// allow-same-origin wird allein dafuer gewaehrt, dass WIR von aussen die Hoehe
// messen koennen — ohne allow-scripts kommt die Mail damit an nichts heran.
function sanitizeMailHtml(html) {
  return String(html || '')
    .replace(/<\?xml[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(script|iframe|object|embed|form|base|meta|link)\b[^>]*>/gi, '')
    .replace(/<\/(script|iframe|object|embed|form)>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, 'blocked:');
}

// Mails bringen ihre eigenen Farben mit und rechnen mit hellem Grund. Ein
// dunkler Rahmen ergaebe dunkle Schrift auf dunklem Grund — der Rumpf steht
// deshalb bewusst hell, wie in jedem Mail-Programm.
const FRAME_CSS = 'html,body{margin:0;padding:14px;background:#ffffff;color:#16181d;' +
  'font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.55;' +
  'overflow-wrap:anywhere;word-break:break-word}' +
  'img{max-width:100%!important;height:auto}table{max-width:100%}' +
  'a{color:#2c6499}blockquote{margin:0 0 0 12px;padding-left:10px;border-left:3px solid #d5d8de;color:#4d5560}' +
  'pre{white-space:pre-wrap}';

function frameDoc(inner) {
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
    'img-src http: https: data:; style-src \'unsafe-inline\'; font-src http: https: data:; ' +
    'script-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">' +
    '<base target="_blank">' +
    '<style>' + FRAME_CSS + '</style></head><body>' + inner + '</body></html>';
}

function bodyFrameHtml(html, text) {
  const inner = html && html.trim()
    ? sanitizeMailHtml(html)
    : '<pre style="white-space:pre-wrap;font-family:inherit;margin:0">' +
      escHTML(text || '(Kein Textinhalt)') + '</pre>';
  return '<iframe class="mail-frame" data-role="mail-frame" title="Nachricht" ' +
    'sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" ' +
    'referrerpolicy="no-referrer" srcdoc="' + escHTML(frameDoc(inner)) + '"></iframe>';
}

// Der Rahmen bringt seine Hoehe nicht selbst mit (kein Skript darin) — sie
// wird von aussen gemessen, auch noch einmal, nachdem die Bilder geladen sind.
export function fitMailFrames(root) {
  (root || document).querySelectorAll('.mail-frame').forEach((frame) => {
    const fit = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc || !doc.body) return;
        const h = Math.max(doc.body.scrollHeight || 0, doc.documentElement.scrollHeight || 0);
        frame.style.height = Math.min(Math.max(h + 20, 160), 20000) + 'px';
      } catch (e) { frame.style.height = '70vh'; }
    };
    const nachladen = () => {
      fit();
      try {
        const doc = frame.contentDocument;
        if (doc) doc.querySelectorAll('img').forEach(img => {
          if (!img.complete) img.addEventListener('load', fit, { once: true });
          img.addEventListener('error', fit, { once: true });
        });
      } catch (e) { /* egal */ }
      setTimeout(fit, 400);
      setTimeout(fit, 1500);
    };
    frame.addEventListener('load', nachladen);
    nachladen();     // srcdoc kann bereits fertig sein, bevor der Hoerer haengt
  });
}

function fmtBytes(n) {
  const v = Number(n || 0);
  if (!v) return '';
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return Math.round(v / 1024) + ' KB';
  return (v / (1024 * 1024)).toFixed(1) + ' MB';
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

function ausgangRowHtml(e) {
  const laeuft = e.status === 'sendet';
  /* Ungeklärt: der Versand war angestossen, der Ausgang ist offen. Es wird
     nichts wiederholt und nichts behauptet — es wird gefragt. */
  if (e.status === 'unklar') {
    return `<div class="mail-row">
      <span class="mail-avatar red">❓</span>
      <div class="mail-row-main">
        <div class="mail-row-top">
          <span class="mail-from">An: ${escHTML(e.to || '(Empfänger?)')}</span>
          <span class="mail-when">❓ Ungeklärt</span>
        </div>
        <div class="mail-subject">${escHTML(e.subject || '(kein Betreff)')}</div>
        <div class="mail-snippet">${escHTML(e.letzterFehler || 'Der Versand wurde angestossen, der Ausgang ist ungeklärt.')} Bitte in Gmail unter „Gesendet" nachsehen.</div>
        <div class="mail-row-actions">
          <button class="chip accent" data-action="mail-outbox-sent" data-id="${escHTML(e.id)}">✅ Ist gesendet</button>
          <button class="chip" data-action="mail-outbox-unsent" data-id="${escHTML(e.id)}">↩️ Nicht gesendet</button>
        </div>
      </div>
    </div>`;
  }
  const kopf = laeuft ? '📤 Wird gerade gesendet'
    : e.status === 'fehlgeschlagen' ? '⚠️ Nicht gesendet — ' + escHTML(e.letzterFehler || 'Grund unbekannt')
    : '🕒 Geht ' + escHTML(zuercherZeit(e.sendAt)) + ' raus (' + VERSANDZONE + ')';
  return `<div class="mail-row">
    <span class="mail-avatar sand">🕒</span>
    <div class="mail-row-main">
      <div class="mail-row-top">
        <span class="mail-from">An: ${escHTML(e.to || '(Empfänger?)')}${e.hatAnhaenge ? ' 📎' : ''}</span>
        <span class="mail-when">${kopf}</span>
      </div>
      <div class="mail-subject">${escHTML(e.subject || '(kein Betreff)')}</div>
      <div class="mail-snippet">${escHTML(String(e.vorschau || e.koerper || '').slice(0, 110))}</div>
      ${laeuft ? '<div class="muted-row">Gmail übernimmt gerade — jetzt geht nichts mehr.</div>' : `<div class="mail-row-actions">
        <button class="chip" data-action="mail-outbox-now" data-id="${escHTML(e.id)}">📨 Jetzt senden</button>
        <button class="chip" data-action="mail-outbox-cancel" data-id="${escHTML(e.id)}">🛑 Abbrechen</button>
      </div>`}
    </div>
  </div>`;
}

function ausgangHtml() {
  if (ui.loading && !ui.ausgang.length) return skeletonList(3);
  if (ui.error && !ui.ausgang.length) {
    /* Der Ausgang ist bewusst fail-closed: Ohne hinterlegten Zugangsschlüssel
       gibt der Server nichts heraus und plant nichts ein — dort liegen ganze
       Mails samt Anhängen. Das wird gesagt, nicht als „offline" verkleidet. */
    const gesperrt = /GESPERRT|KEIN_ZUGANG|Zugangsschl/i.test(ui.error);
    return emptyState(gesperrt ? '🔒' : '🔌',
      gesperrt ? 'Ausgang gesperrt' : 'Ausgang nicht erreichbar',
      gesperrt
        ? 'Der Server gibt den Ausgang nur mit Zugangsschlüssel heraus. Auf diesem Gerät ist keiner hinterlegt — geplante Mails siehst du in Quantus am Rechner. (' + ui.error + ')'
        : 'Der geplante Versand liegt auf dem Server. (' + ui.error + ')',
      '<button class="btn primary" data-action="mail-refresh">Erneut versuchen</button>');
  }
  if (!ui.ausgang.length) {
    return emptyState('🕒', 'Nichts geplant',
      'Neue Mails gehen standardmässig erst in drei Stunden raus. Bis dahin stehen sie hier — abbrechbar und sofort sendbar. Verschickt werden sie vom Server, auch wenn dieses Gerät aus ist.');
  }
  return `<div class="mail-list">${ui.ausgang.map(ausgangRowHtml).join('')}</div>`;
}

function listHtml() {
  if (ui.folder === 'outbox' && !ui.search) return ausgangHtml();
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
        <button class="chip" data-action="mail-note" data-id="${item.id}">📝 Als Notiz</button>
        <button class="chip" data-action="mail-plain">${ui.plain ? '🖼 Original' : '🅰 Nur Text'}</button>
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
    ${anhaengeHtml(item.id, body)}
    <div class="mail-body">${bodyHtml(item, body, text)}</div>
  </div>`;
}

// Anhaenge waren bisher blosse Namen ohne Griff. Eingebettete Bilder stehen
// nicht darunter: die sind im Rumpf zu sehen, wo sie hingehoeren.
function anhaengeHtml(msgId, body) {
  if (!body || !body.attachments || !body.attachments.length) return '';
  const echte = body.attachments.filter(a => !(a.inline && a.resolved));
  if (!echte.length) return '';
  return `<div class="mail-attachments">${echte.map(a => `
    <button class="mail-attachment" data-action="mail-attachment" data-id="${escHTML(msgId)}"
      data-att="${escHTML(a.attachmentId || '')}" data-name="${escHTML(a.name)}" data-mime="${escHTML(a.mime || '')}">
      📎 ${escHTML(a.name)}${a.size ? ` <span class="mail-attachment-size">${fmtBytes(a.size)}</span>` : ''}
    </button>`).join('')}</div>`;
}

// Die Nachricht selbst: im Original (abgeschotteter Rahmen) oder — auf Wunsch
// und wenn es gar kein HTML gibt — als reiner Text.
function bodyHtml(item, body, text) {
  if (!body) return `<div class="mail-plaintext">${escHTML(item.snippet || '')}</div>`;
  if (ui.plain || !body.html) {
    return `<div class="mail-plaintext">${escHTML(text || item.snippet || '(Kein Textinhalt)')}</div>`;
  }
  return bodyFrameHtml(body.html, text);
}

// ── Aktionen ────────────────────────────────────────────────────────────────
function rerender() {
  if (current().route === 'mail') store.notify();
}

async function refresh(showSpinner = true) {
  if (showSpinner) { ui.loading = true; ui.error = ''; rerender(); }
  // Der Ausgang liegt nicht bei Gmail, sondern in der Warteschlange.
  if (ui.folder === 'outbox' && !ui.search) {
    try {
      const antwort = await queueRpc('liste', {});
      ui.ausgang = (antwort.eintraege || []).filter(e => e &&
        (e.status === 'geplant' || e.status === 'sendet' || e.status === 'fehlgeschlagen' || e.status === 'unklar'));
      ui.error = '';
    } catch (e) { ui.error = e.message || String(e); }
    finally { ui.loading = false; rerender(); }
    return;
  }
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
    // Erst anzeigen, dann die eingebetteten Bilder nachziehen: die Mail steht
    // sofort da, auch wenn ein Anhang lange braucht oder nie kommt.
    if (parts.html && /cid:/i.test(parts.html)) {
      rerender();
      const mitBildern = await resolveInlineImages(id, parts.html, parts.attachments);
      if (ui.body && ui.body.id === id) ui.body.html = mitBildern;
    }
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
      <button class="btn primary block" type="button" data-action="mail-send">Senden (in 3 h)…</button>
      <div class="muted-row">Vor dem Einplanen erscheint eine Vorschau. Die Mail geht erst in rund drei Stunden raus und steht bis dahin im Ausgang — abbrechbar oder sofort sendbar.</div>
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
  'mail-plain': () => { ui.plain = !ui.plain; rerender(); },
  'mail-note': async (d) => {
    const item = ui.list.find(m => m.id === d.id); if (!item) return;
    const body = ui.body && ui.body.id === item.id ? ui.body : null;
    const content = body ? (body.text || htmlToText(body.html)) : (item.snippet || '');
    const ok = await confirmPreview({
      title: 'E-Mail als Notiz übernehmen?', confirmLabel: 'Notiz vorbereiten',
      previewHtml: `<div class="mail-preview"><div><b>${escHTML(item.subject || '(kein Betreff)')}</b></div>
        <div>Von: ${escHTML(item.fromName || item.fromEmail || '')}</div>
        <div class="mail-preview-body">${escHTML(String(content).slice(0, 500))}</div></div>`,
    });
    if (!ok) return;
    const { openNoteComposer } = await import('../note-ui.js');
    const label = item.subject || 'E-Mail';
    openNoteComposer({
      heading: 'E-Mail als Recherchenotiz', noteClass: 'research', title: label, content,
      tags: [label], lockedTags: [label], dedupeKey: `mail:${item.id}`,
      source: { app: 'mail', entityType: 'email', entityId: item.id, label, route: '#/mail' },
    });
  },

  'mail-attachment': async (d) => {
    if (!d.att) { toast('Dieser Anhang hat keine Kennung', 'error'); return; }
    toast('Anhang wird geladen…', 'ok', 1400);
    try {
      const res = await rpc('GET', '/users/me/messages/' + encodeURIComponent(d.id) +
        '/attachments/' + encodeURIComponent(d.att));
      const b64 = String((res && res.data) || '').replace(/-/g, '+').replace(/_/g, '/');
      if (!b64) throw new Error('leer');
      const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: d.mime || 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url; a.download = d.name || 'anhang'; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { toast('Anhang konnte nicht geladen werden: ' + (e.message || e), 'error'); }
  },

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

  /* Senden heisst planen: drei Stunden Vorlauf, bis dahin im Ausgang
     sichtbar und abbrechbar. Kein Gerätetimer — der Server schickt sie los. */
  'mail-send': async () => {
    const to = (document.getElementById('mlTo') || {}).value || '';
    const cc = (document.getElementById('mlCc') || {}).value || '';
    const subject = (document.getElementById('mlSubject') || {}).value || '';
    const text = (document.getElementById('mlBody') || {}).value || '';
    if (!to.trim()) { toast('Empfänger fehlt', 'error'); return; }
    const ok = await confirmPreview({
      title: 'In 3 Stunden senden?', confirmLabel: 'Einplanen',
      previewHtml: `<div class="mail-preview">
        <div><b>An:</b> ${escHTML(to)}</div>
        ${cc ? `<div><b>Kopie:</b> ${escHTML(cc)}</div>` : ''}
        <div><b>Betreff:</b> ${escHTML(subject || '(kein Betreff)')}</div>
        <div class="mail-preview-body">${escHTML(text.slice(0, 400)) || '<i>(leer)</i>'}</div>
        <div class="muted-row">Geht in rund drei Stunden raus. Bis dahin steht sie im Ausgang: abbrechen oder sofort senden.</div>
      </div>`,
    });
    if (!ok) return;
    try {
      if (!ui.sendeSchluessel) ui.sendeSchluessel = anfrageSchluessel();
      const antwort = await queueRpc('plane', {
        raw: encodeRaw({ to, cc, subject, text }),
        to, cc, subject, koerper: text, vorschau: String(text).slice(0, 300),
        hatAnhaenge: false, quelle: 'mobile', anfrageSchluessel: ui.sendeSchluessel,
      });
      ui.sendeSchluessel = null;
      closeSheet();
      toast('🕒 Geplant: ' + zuercherZeit((antwort.eintrag || {}).sendAt), 'ok');
      if (ui.folder === 'outbox') refresh(false);
    } catch (e) {
      toast('Nicht geplant: ' + (e.message || e), 'error');
    }
  },

  'mail-outbox-now': async (d) => {
    try { await queueRpc('sofort', { id: d.id }); toast('Wird gesendet ✓', 'ok'); }
    catch (e) { toast('Nicht möglich: ' + (e.message || e), 'error'); }
    refresh(false);
  },

  /* Die beiden Klärungen eines ungeklärten Versands — ausdrücklich, nachdem
     ein Mensch in Gmail nachgesehen hat. Automatisch geschieht hier nichts. */
  'mail-outbox-sent': async (d) => {
    const ok = await confirmPreview({
      title: 'In Gmail wirklich gesendet?', confirmLabel: 'Ja, ist gesendet',
      previewHtml: '<div class="mail-preview">Die Mail wird als gesendet vermerkt. Es wird nichts verschickt.</div>',
    });
    if (!ok) return;
    try { await queueRpc('geklaert-gesendet', { id: d.id }); toast('Geklärt ✓', 'ok'); }
    catch (e) { toast('Nicht geklärt: ' + (e.message || e), 'error'); }
    refresh(false);
  },

  'mail-outbox-unsent': async (d) => {
    const ok = await confirmPreview({
      title: 'In Gmail NICHT gesendet?', confirmLabel: 'Erneut einplanen',
      previewHtml: '<div class="mail-preview">Die Mail wird neu eingeplant und geht beim nächsten Serverlauf raus.</div>',
    });
    if (!ok) return;
    try { await queueRpc('geklaert-nicht-gesendet', { id: d.id }); toast('Neu eingeplant ✓', 'ok'); }
    catch (e) { toast('Nicht geklärt: ' + (e.message || e), 'error'); }
    refresh(false);
  },

  'mail-outbox-cancel': async (d) => {
    const ok = await confirmPreview({
      title: 'Geplante Mail abbrechen?', confirmLabel: 'Abbrechen',
      previewHtml: '<div class="mail-preview">Diese Mail geht dann nicht raus. Der Entwurf ist damit weg.</div>',
    });
    if (!ok) return;
    try { await queueRpc('abbrechen', { id: d.id }); toast('Abgebrochen ✓', 'ok'); }
    catch (e) { toast('Nicht abgebrochen: ' + (e.message || e), 'error'); }
    refresh(false);
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
    // Ein srcdoc-Rahmen ist 0 Pixel hoch, solange ihm niemand eine Hoehe gibt.
    fitMailFrames(root);
  },
};

// Für die Shell: Anzahl ungelesener Nachrichten im Tab-Badge.
export function unreadCount() { return ui.list.filter(m => m.unread).length; }
window.__quantusMailUnread = unreadCount;
