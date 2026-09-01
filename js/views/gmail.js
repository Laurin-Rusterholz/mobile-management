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

// ── Abwesenheitsantwort (VacationSettings) ──────────────────────────────────
// Gmail verwaltet den automatischen Abwesenheits-Responder serverseitig ueber
// /users/me/settings/vacation (GET/PUT, Scope gmail.settings.basic — bereits
// Teil der bestehenden Quantus-Google-Verbindung). Reiner Live-Zustand, nicht
// Teil des synchronisierten Quantus-Datensatzes. Ein PUT geschieht nur nach
// confirmPreview() — nie ohne sichtbare Bestaetigung.
let vacation = null;
let rerenderFn = null;
function rerender() { if (typeof rerenderFn === 'function') rerenderFn(); }

function vacYmdToMs(ymd) {
  if (!ymd) return null;
  const p = String(ymd).split('-');
  if (p.length !== 3) return null;
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d.getTime();
}
function vacMsToYmd(ms) {
  if (ms == null) return '';
  const n = Number(ms);
  if (!isFinite(n)) return '';
  const d = new Date(n);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function vacFmtDe(ymd) {
  const p = String(ymd || '').split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : (ymd || '(offen)');
}

function vacationSheetBody(v) {
  const startYmd = vacMsToYmd(v.startTime);
  const endYmd = v.endTime != null ? vacMsToYmd(Number(v.endTime) - 1) : '';
  return `<form class="form" id="gmailVacationForm">
    <label class="f" style="flex-direction:row;align-items:center;gap:10px">
      <input type="checkbox" id="gvActive" ${v.enableAutoReply ? 'checked' : ''}>
      <span class="f-label" style="margin:0">Automatische Abwesenheitsantwort aktiv</span></label>
    <label class="f"><span class="f-label">Erster Tag</span><input id="gvStart" class="input" type="date" value="${escHTML(startYmd)}"></label>
    <label class="f"><span class="f-label">Letzter Tag (inklusive)</span><input id="gvEnd" class="input" type="date" value="${escHTML(endYmd)}"></label>
    <label class="f"><span class="f-label">Betreff</span><input id="gvSubject" class="input" value="${escHTML(v.responseSubject || '')}"></label>
    <label class="f"><span class="f-label">Antworttext</span><textarea id="gvBody" class="input" rows="8">${escHTML(v.responseBodyPlainText || v.responseBodyHtml || '')}</textarea></label>
    <label class="f" style="flex-direction:row;align-items:center;gap:10px">
      <input type="checkbox" id="gvContacts" ${v.restrictToContacts ? 'checked' : ''}>
      <span class="f-label" style="margin:0">Nur an meine Kontakte antworten</span></label>
    <label class="f" style="flex-direction:row;align-items:center;gap:10px">
      <input type="checkbox" id="gvDomain" ${v.restrictToDomain ? 'checked' : ''}>
      <span class="f-label" style="margin:0">Nur innerhalb meiner Organisation/Domain antworten</span></label>
    <div class="muted-row">Leere Datumsfelder bedeuten unbefristet.</div>
    <button class="btn primary block" type="submit">Speichern…</button>
  </form>`;
}

async function openVacationSheet() {
  try {
    vacation = await gmailRpc('GET', '/users/me/settings/vacation');
  } catch (e) {
    toast('Abwesenheit: ' + e.message, 'error');
    vacation = vacation || {};
  }
  openSheet({
    title: '🌴 Abwesenheit',
    size: 'full',
    body: vacationSheetBody(vacation || {}),
    onMount(root) {
      const form = root.querySelector('#gmailVacationForm');
      if (!form) return;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const active = !!form.querySelector('#gvActive').checked;
        const startYmd = String(form.querySelector('#gvStart').value || '').trim();
        const endYmd = String(form.querySelector('#gvEnd').value || '').trim();
        const subject = String(form.querySelector('#gvSubject').value || '').trim();
        const bodyText = String(form.querySelector('#gvBody').value || '').trim();
        const contacts = !!form.querySelector('#gvContacts').checked;
        const domain = !!form.querySelector('#gvDomain').checked;
        if (active && !bodyText) { toast('Antworttext fehlt', 'error'); return; }
        if (startYmd && endYmd && startYmd > endYmd) { toast('Der erste Tag muss vor oder gleich dem letzten Tag liegen', 'error'); return; }
        const range = (startYmd || endYmd) ? `${vacFmtDe(startYmd)} – ${vacFmtDe(endYmd)}` : 'Unbefristet';
        const ok = await confirmPreview({
          title: active ? 'Automatische Abwesenheitsantwort wirklich aktivieren?' : 'Abwesenheitsantwort deaktivieren?',
          confirmLabel: active ? '🌴 Jetzt aktivieren' : 'Deaktivieren',
          danger: !active && !!(vacation && vacation.enableAutoReply),
          previewHtml: `<div class="mail-preview">
            <div><b>Status:</b> ${active ? 'Aktiv' : 'Inaktiv'}</div>
            <div><b>Zeitraum:</b> ${escHTML(range)}</div>
            <div><b>Betreff:</b> ${escHTML(subject || '(kein Betreff)')}</div>
            <div class="mail-preview-body">${escHTML(bodyText.slice(0, 400)) || '<i>(leer)</i>'}</div>
            <div><b>Nur Kontakte:</b> ${contacts ? 'Ja' : 'Nein'} · <b>Nur Organisation/Domain:</b> ${domain ? 'Ja' : 'Nein'}</div>
          </div>`,
        });
        if (!ok) return;
        const payload = {
          enableAutoReply: active,
          responseSubject: subject,
          responseBodyPlainText: bodyText,
          restrictToContacts: contacts,
          restrictToDomain: domain,
        };
        if (startYmd) { const s = vacYmdToMs(startYmd); if (s != null) payload.startTime = String(s); }
        if (endYmd) { const en = vacYmdToMs(endYmd); if (en != null) payload.endTime = String(en + 86400000); }
        try {
          const result = await gmailRpc('PUT', '/users/me/settings/vacation', {}, payload);
          vacation = result || payload;
          closeSheet();
          toast(active ? 'Abwesenheitsantwort aktiv ✓' : 'Abwesenheitsantwort deaktiviert', 'ok');
          rerender();
        } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, 'error'); }
      });
    },
  });
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
  'gmail-vacation': () => { openVacationSheet(); },
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
    const vacationOn = !!(vacation && vacation.enableAutoReply);
    const sub = 'Posteingang' + (vacationOn ? ' · 🌴 Abwesenheit aktiv' : '');
    return `<div class="pad">
      ${pageHeader('Gmail', sub, `<button class="chip" data-action="gmail-refresh">⟳ Laden</button>` +
        `<button class="chip${vacationOn ? ' accent' : ''}" data-action="gmail-vacation">🌴 Abwesenheit</button>` +
        `<button class="chip accent" data-action="gmail-compose">✎ Neu</button>`)}
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
  mount(root) {
    rerenderFn = () => { root.innerHTML = this.render(); };
  },
  unmount() { rerenderFn = null; },
};
