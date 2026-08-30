// ============================================================================
//  Google Kalender — echte Google-Termine direkt in Quantus Mobile
//  ---------------------------------------------------------------------------
//  Backend: derselbe Quantus-Proxy wie am Desktop, unverändert.
//    /.netlify/functions/gcal-auth  (Verbindungsstatus, Login, Logout)
//    /.netlify/functions/gcal-api   (authentifizierter Calendar-v3-Proxy)
//  EIN Google-Konto, EIN serverseitig gespeicherter Token — verbindet man sich
//  bereits am Desktop (oder hier), gilt das für alle Quantus-Geräte gleich.
//  Das Handy hält nie einen eigenen Client-Secret oder Access-Token.
//
//  Die OAuth-Weiterleitung landet danach auf dem Ursprung von AI Sync, nicht
//  hier (Google kennt nur eine registrierte Redirect-URI). Deshalb öffnet
//  "Verbinden" ein neues Fenster/Tab; beim Zurückkehren in dieses Tab wird der
//  Status automatisch neu geladen (kein Server-seitiger Umbau nötig).
// ============================================================================
import { escHTML, formatTime, openSheet, closeSheet, toast, confirmPreview, emptyState, haptic } from '../util.js';
import { getBaseUrl, LS } from '../config.js';
import { registerActions } from '../actions.js';
import { pageHeader } from './common.js';

const RANGE_DAYS = 14;

const ui = {
  status: null,        // { connected, email, ... } | null solange nicht geladen
  statusLoading: true,
  calendars: [],
  selected: new Set(),
  events: [],
  loading: false,
  error: '',
  editing: null,        // { calId, id, resource } beim Bearbeiten/Erstellen
};
let rerenderFn = null;
function rerender() { if (typeof rerenderFn === 'function') rerenderFn(); }

// ── Auswahl der sichtbaren Kalender lokal merken (pro Gerät, wie am Desktop) ──
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS.gcalPrefs) || '{}') || {}; }
  catch (e) { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(LS.gcalPrefs, JSON.stringify({ selected: [...ui.selected] })); }
  catch (e) { /* Speicher voll — Auswahl ist nur eine Bequemlichkeit */ }
}

// ── Backend ──────────────────────────────────────────────────────────────────
async function gcAuth(action, extra) {
  const url = getBaseUrl() + '/.netlify/functions/gcal-auth?action=' + encodeURIComponent(action) + (extra || '');
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
  return d;
}
async function gcApi(method, path, query, body) {
  const url = getBaseUrl() + '/.netlify/functions/gcal-api';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, query: query || null, body: body || null }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error((d && (d.error || d.message)) || ('HTTP ' + r.status)); e.status = r.status; e.data = d; throw e; }
  return d;
}

// ── Event-Helfer ───────────────────────────────────────────────────────────
function isAllDay(ev) { return !!(ev.start && ev.start.date && !ev.start.dateTime); }
function evStartIso(ev) { const s = ev.start || {}; return s.dateTime || (s.date ? s.date + 'T00:00:00' : null); }
function evDay(ev) { const s = ev.start || {}; return (s.date || (s.dateTime || '').slice(0, 10)); }
function calById(id) { return ui.calendars.find(c => c.id === id) || null; }
function calWritable(id) { const c = calById(id); return !!(c && (c.accessRole === 'owner' || c.accessRole === 'writer')); }

// ── Laden ────────────────────────────────────────────────────────────────────
async function loadStatus() {
  ui.statusLoading = true; rerender();
  try { ui.status = await gcAuth('status'); }
  catch (e) { ui.status = { connected: false, error: e.status === 401 ? 'Zugriff nicht autorisiert.' : (e.message || null) }; }
  ui.statusLoading = false; rerender();
  if (ui.status && ui.status.connected) loadAll();
}

function restoreSelection() {
  const prefs = loadPrefs();
  let ids = Array.isArray(prefs.selected)
    ? prefs.selected.filter(id => ui.calendars.some(c => c.id === id))
    : [];
  if (!ids.length) {
    ids = ui.calendars.filter(c => c.selected || c.primary).map(c => c.id);
    if (!ids.length && ui.calendars.length) ids = [ui.calendars[0].id];
  }
  ui.selected = new Set(ids);
  savePrefs();
}

async function loadEvents() {
  const min = new Date(); min.setHours(0, 0, 0, 0);
  const max = new Date(min.getTime() + RANGE_DAYS * 86400000);
  const sel = [...ui.selected];
  const all = [];
  await Promise.all(sel.map(async (calId) => {
    try {
      const res = await gcApi('GET', '/calendars/' + encodeURIComponent(calId) + '/events', {
        timeMin: min.toISOString(), timeMax: max.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
      });
      const cal = calById(calId) || {};
      (res.items || []).forEach(ev => {
        if (ev.status === 'cancelled') return;
        ev._calId = calId; ev._calSummary = cal.summaryOverride || cal.summary || calId; ev._calColor = cal.backgroundColor || '#0a84ff';
        all.push(ev);
      });
    } catch (e) { console.warn('[gcal] Termine laden fehlgeschlagen für', calId, e.message); }
  }));
  all.sort((a, b) => (evStartIso(a) || '').localeCompare(evStartIso(b) || ''));
  ui.events = all;
}

async function loadAll() {
  ui.loading = true; ui.error = ''; rerender();
  try {
    const list = await gcApi('GET', '/users/me/calendarList');
    ui.calendars = list.items || [];
    restoreSelection();
    await loadEvents();
  } catch (e) {
    if (e.status === 401 || (e.data && e.data.error === 'NOT_CONNECTED')) ui.status = { connected: false };
    else ui.error = e.message || 'Fehler beim Laden';
  }
  ui.loading = false; rerender();
}

// ── Verbinden/Trennen ────────────────────────────────────────────────────────
let focusBound = false;
function armFocusRecheck() {
  if (focusBound) return;
  focusBound = true;
  const onFocus = () => { loadStatus(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onFocus(); });
}
function connect() {
  armFocusRecheck();
  const url = getBaseUrl() + '/.netlify/functions/gcal-auth?action=login&return=googlecalendar';
  const win = window.open(url, '_blank');
  if (!win) { toast('Pop-up blockiert — bitte in den Browsereinstellungen erlauben', 'error'); return; }
  toast('Google-Anmeldung geöffnet — danach hierher zurückwechseln', 'ok', 4000);
}
async function disconnect() {
  const ok = await confirmPreview({
    title: 'Google trennen?',
    previewHtml: `<p>Die Verbindung zu <strong>${escHTML((ui.status && ui.status.email) || 'Google')}</strong> wird für alle Quantus-Geräte getrennt (Kalender und Mail teilen sich dieselbe Anmeldung).</p>`,
    confirmLabel: 'Trennen', danger: true,
  });
  if (!ok) return;
  try { await gcAuth('logout'); toast('Google getrennt', 'ok'); ui.status = { connected: false }; ui.events = []; ui.calendars = []; rerender(); }
  catch (e) { toast('Trennen fehlgeschlagen: ' + (e.message || e), 'error'); }
}

// ── Erstellen / Bearbeiten ───────────────────────────────────────────────────
function localDateTimeValue(date) {
  const d = date || new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function writableCalendarOptions(selectedId) {
  const writable = ui.calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer');
  return writable.map(c => `<option value="${escHTML(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${escHTML(c.summaryOverride || c.summary || c.id)}${c.primary ? ' (primär)' : ''}</option>`).join('');
}

function openEventSheet(existingEv) {
  const isEdit = !!existingEv;
  const allDay = existingEv ? isAllDay(existingEv) : false;
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const later = new Date(now.getTime() + 3600000);
  const startIso = existingEv ? evStartIso(existingEv) : now.toISOString();
  const endIso = existingEv ? ((existingEv.end && (existingEv.end.dateTime || existingEv.end.date)) || startIso) : later.toISOString();
  const defaultCal = existingEv ? existingEv._calId : ([...ui.selected].find(id => calWritable(id)) || (ui.calendars.find(c => c.primary) || {}).id || '');

  openSheet({
    title: isEdit ? 'Termin bearbeiten' : 'Neuer Termin',
    size: 'half',
    body: `<form class="form" data-gcal-form>
      <label class="f"><span class="f-label">Titel *</span>
        <input class="input" name="summary" required value="${escHTML((existingEv && existingEv.summary) || '')}" placeholder="Worum geht es?"></label>
      <label class="f"><span class="f-label">Kalender</span>
        <select class="input" name="calId" ${isEdit ? 'disabled' : ''}>${writableCalendarOptions(defaultCal)}</select></label>
      <label class="f" style="flex-direction:row;align-items:center;gap:10px">
        <input type="checkbox" name="allDay" ${allDay ? 'checked' : ''}> <span class="f-label" style="margin:0">Ganztägig</span></label>
      <div data-gcal-time-fields>
        <label class="f"><span class="f-label">Beginn *</span>
          <input class="input" name="start" type="${allDay ? 'date' : 'datetime-local'}" required
            value="${allDay ? String(startIso).slice(0, 10) : localDateTimeValue(new Date(startIso))}"></label>
        <label class="f"><span class="f-label">Ende *</span>
          <input class="input" name="end" type="${allDay ? 'date' : 'datetime-local'}" required
            value="${allDay ? String(endIso).slice(0, 10) : localDateTimeValue(new Date(endIso))}"></label>
      </div>
      <label class="f"><span class="f-label">Ort</span>
        <input class="input" name="location" value="${escHTML((existingEv && existingEv.location) || '')}"></label>
      <label class="f"><span class="f-label">Beschreibung</span>
        <textarea class="input" name="description" rows="3">${escHTML((existingEv && existingEv.description) || '')}</textarea></label>
      <div class="sheet-foot">
        ${isEdit ? '<button class="btn danger" type="button" data-gcal-delete>Löschen</button>' : ''}
        <button class="btn" type="button" data-sheet-cancel>Abbrechen</button>
        <button class="btn primary" type="submit">Speichern</button>
      </div>
    </form>`,
    onMount(root) {
      const form = root.querySelector('[data-gcal-form]');
      const allDayInput = form.elements.allDay;
      const timeFields = root.querySelector('[data-gcal-time-fields]');
      allDayInput.addEventListener('change', () => {
        const on = allDayInput.checked;
        timeFields.querySelectorAll('input').forEach(inp => { inp.type = on ? 'date' : 'datetime-local'; });
      });
      root.querySelector('[data-sheet-cancel]').addEventListener('click', closeSheet);
      const delBtn = root.querySelector('[data-gcal-delete]');
      if (delBtn) delBtn.addEventListener('click', async () => {
        const ok = await confirmPreview({ title: 'Termin löschen?', previewHtml: `<p>«${escHTML(existingEv.summary || 'Ohne Titel')}» wird bei Google Kalender gelöscht.</p>`, confirmLabel: 'Löschen', danger: true });
        if (!ok) return;
        try {
          await gcApi('DELETE', '/calendars/' + encodeURIComponent(existingEv._calId) + '/events/' + encodeURIComponent(existingEv.id), { sendUpdates: 'all' });
          closeSheet(); toast('Termin gelöscht', 'ok'); loadEvents().then(rerender);
        } catch (e) { toast('Löschen fehlgeschlagen: ' + (e.message || e), 'error'); }
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fd = new FormData(form);
        const summary = String(fd.get('summary') || '').trim();
        if (!summary) { toast('Titel fehlt', 'error'); return; }
        const calId = isEdit ? existingEv._calId : String(fd.get('calId') || '');
        if (!calId) { toast('Kein beschreibbarer Kalender verfügbar', 'error'); return; }
        const allDayOn = !!fd.get('allDay');
        const startRaw = String(fd.get('start') || '');
        const endRaw = String(fd.get('end') || '');
        if (!startRaw || !endRaw) { toast('Beginn und Ende sind erforderlich', 'error'); return; }
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        let start, end;
        if (allDayOn) {
          start = { date: startRaw };
          const endDate = new Date(endRaw + 'T00:00:00');
          if (endDate.getTime() <= new Date(startRaw + 'T00:00:00').getTime()) endDate.setDate(endDate.getDate() + 1);
          end = { date: endDate.toISOString().slice(0, 10) };
        } else {
          const startDate = new Date(startRaw), endDate = new Date(endRaw);
          if (isNaN(startDate) || isNaN(endDate)) { toast('Ungültige Zeitangabe', 'error'); return; }
          if (endDate.getTime() <= startDate.getTime()) { toast('Das Ende muss nach dem Beginn liegen', 'error'); return; }
          start = { dateTime: startDate.toISOString(), timeZone: tz };
          end = { dateTime: endDate.toISOString(), timeZone: tz };
        }
        const resource = { summary, start, end, location: String(fd.get('location') || '').trim() || undefined, description: String(fd.get('description') || '').trim() || undefined };
        try {
          if (isEdit) await gcApi('PATCH', '/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(existingEv.id), { sendUpdates: 'none' }, resource);
          else await gcApi('POST', '/calendars/' + encodeURIComponent(calId) + '/events', { sendUpdates: 'none' }, resource);
          closeSheet(); toast(isEdit ? 'Termin aktualisiert' : 'Termin erstellt', 'ok'); haptic(16);
          await loadEvents(); rerender();
        } catch (e) { toast('Speichern fehlgeschlagen: ' + (e.message || e), 'error'); }
      });
    },
  });
}

// ── Als Notiz speichern ──────────────────────────────────────────────────────
async function saveEventAsNote(ev) {
  const { openNoteComposer } = await import('../note-ui.js');
  const label = ev.summary || 'Termin';
  openNoteComposer({
    heading: 'Notiz zum Termin', noteClass: 'research', tags: [label], lockedTags: [label],
    source: { app: 'googlecalendar', entityType: 'event', entityId: ev._calId + '::' + ev.id, label, route: ev.htmlLink || null },
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────
function connectionCard() {
  if (ui.statusLoading) return `<div class="card"><div class="muted-row">Verbindungsstatus wird geladen…</div></div>`;
  if (!ui.status || !ui.status.connected) {
    return `<div class="card gcal-connect-card">
      <div class="row-title">📆 Nicht mit Google verbunden</div>
      <div class="row-sub">Verbinde dich einmal, um deine echten Google-Termine hier zu sehen und zu bearbeiten. Gilt für alle Quantus-Geräte gleichzeitig.</div>
      ${ui.status && ui.status.error ? `<div class="row-sub" style="color:var(--danger,#e5484d)">${escHTML(ui.status.error)}</div>` : ''}
      <button class="btn primary block" style="margin-top:10px" data-action="gcal-connect">Mit Google verbinden</button>
    </div>`;
  }
  return `<div class="card gcal-status-card">
    <div class="row-main"><div class="row-title">✅ Verbunden als ${escHTML(ui.status.email || 'Google-Konto')}</div></div>
    <button class="chip" data-action="gcal-disconnect">Trennen</button>
  </div>`;
}

function calendarPicker() {
  if (!ui.calendars.length) return '';
  return `<div class="card">
    <div class="row-title" style="margin-bottom:8px">Sichtbare Kalender</div>
    <div class="gcal-cal-list">
      ${ui.calendars.map(c => `<button type="button" class="chip ${ui.selected.has(c.id) ? 'accent' : ''}" data-action="gcal-toggle-cal" data-id="${escHTML(c.id)}">
        <span class="gcal-dot" style="background:${escHTML(c.backgroundColor || '#0a84ff')}"></span>
        ${escHTML(c.summaryOverride || c.summary || c.id)}${c.primary ? ' ★' : ''}
      </button>`).join('')}
    </div>
  </div>`;
}

function agendaHtml() {
  if (ui.loading) return `<div class="muted-row">Termine werden geladen…</div>`;
  if (ui.error) return emptyState('⚠️', 'Fehler beim Laden', ui.error);
  if (!ui.events.length) return emptyState('📆', 'Keine Termine', `Keine Google-Termine in den nächsten ${RANGE_DAYS} Tagen.`);
  const byDay = {};
  ui.events.forEach(ev => { const d = evDay(ev); (byDay[d] = byDay[d] || []).push(ev); });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = today.toISOString().slice(0, 10);
  return Object.keys(byDay).sort().map(day => `
    <section class="cal-day">
      <div class="cal-day-head">${day === todayKey ? 'Heute · ' : ''}${new Date(day + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: 'long' })}</div>
      ${byDay[day].map(ev => `<div class="card row-card" data-action="gcal-open" data-cal="${escHTML(ev._calId)}" data-id="${escHTML(ev.id)}">
        <div class="row-main" style="border-left:3px solid ${escHTML(ev._calColor)};padding-left:8px">
          <div class="row-title">${escHTML(ev.summary || '(ohne Titel)')}</div>
          <div class="row-sub">${isAllDay(ev) ? 'Ganztägig' : (formatTime(evStartIso(ev)) || '')}${ev.location ? ' · ' + escHTML(ev.location) : ''} · ${escHTML(ev._calSummary)}</div>
        </div>
        <button class="icon-btn" data-action="gcal-note" data-cal="${escHTML(ev._calId)}" data-id="${escHTML(ev.id)}" aria-label="Als Notiz speichern">📝</button>
      </div>`).join('')}
    </section>`).join('');
}

registerActions({
  'gcal-connect': () => connect(),
  'gcal-disconnect': () => disconnect(),
  'gcal-toggle-cal': (d) => {
    if (ui.selected.has(d.id)) ui.selected.delete(d.id); else ui.selected.add(d.id);
    savePrefs(); loadEvents().then(rerender);
  },
  'gcal-new': () => {
    if (!ui.calendars.some(c => c.accessRole === 'owner' || c.accessRole === 'writer')) { toast('Kein beschreibbarer Kalender verfügbar', 'error'); return; }
    openEventSheet(null);
  },
  'gcal-open': (d) => {
    const ev = ui.events.find(e => e.id === d.id && e._calId === d.cal);
    if (ev) openEventSheet(ev);
  },
  'gcal-note': (d) => {
    const ev = ui.events.find(e => e.id === d.id && e._calId === d.cal);
    if (ev) saveEventAsNote(ev);
  },
});

export default {
  title: 'Google Kalender', icon: '📆',
  render() {
    return `<div class="pad">
      ${pageHeader('Google Kalender', ui.status && ui.status.connected ? `${ui.events.length} Termine · nächste ${RANGE_DAYS} Tage` : 'Nicht verbunden', ui.status && ui.status.connected ? '<button class="chip accent" data-action="gcal-new">＋ Termin</button>' : '')}
      ${connectionCard()}
      ${ui.status && ui.status.connected ? calendarPicker() + agendaHtml() : ''}
    </div>`;
  },
  mount(root, ctx) {
    rerenderFn = () => {
      // Nur dieses Modul neu zeichnen, kein globales store.notify() nötig —
      // Google-Termine leben nicht im synchronisierten Quantus-Datensatz.
      root.innerHTML = this.render();
    };
    if (!ui.status) loadStatus();
    else if (ui.status.connected && !ui.calendars.length && !ui.loading) loadAll();
  },
  unmount() { rerenderFn = null; },
};
