// ============================================================================
//  Gewohnheiten — täglich/wöchentlich/frei, Serien, Erfüllungsquote
//  Sonderpfad: data.dailyBriefing.routines[]
//
//  BEFUND (Telefon): die Karten liessen sich nicht öffnen. Sie trugen genau
//  zwei Aktionen — den Haken links und den Papierkorb rechts. Der Rumpf der
//  Karte war tot: kein Detail, keine Bearbeitung, kein Verlauf. Wer eine
//  Routine umbenennen oder nur nachsehen wollte, hatte keinen Weg.
//
//  Jetzt öffnet ein Tipp auf den Kartenrumpf ein Detail-Sheet — genau das
//  Muster, das die Aufgabenliste schon benutzt (.task-main + data-action).
// ============================================================================
import { escHTML, todayYmd, openSheet, closeSheet, toast, confirmPreview } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { pageHeader } from './common.js';

function streak(h) {
  const set = new Set((h.completions || []).map(c => c && c.date));
  let s = 0; const d = new Date();
  for (;;) { const y = todayYmd(d); if (set.has(y)) { s++; d.setDate(d.getDate() - 1); } else break; }
  return s;
}
// Die letzten 30 Tage als Liste, heute zuerst. rate30 leitet sich daraus ab,
// damit Streifen und Prozentzahl nie auseinanderlaufen können.
function last30(h) {
  const set = new Set((h.completions || []).map(c => c && c.date));
  const out = []; const d = new Date();
  for (let i = 0; i < 30; i++) { const y = todayYmd(d); out.push({ date: y, done: set.has(y) }); d.setDate(d.getDate() - 1); }
  return out;
}
function rate30(h) {
  const tage = last30(h);
  return Math.round((tage.filter(t => t.done).length / tage.length) * 100);
}
const FREQ = { daily: 'Täglich', weekdays: 'Wochentags', weekly: 'Wöchentlich', weekends: 'Wochenende', custom: 'Frei' };

function byId(id) { return store.getHabits().find(h => h && h.id === id) || null; }

// ── Detail ────────────────────────────────────────────────────────────────
function detailHtml(h) {
  const today = todayYmd();
  const on = store.habitDoneOn(h, today);
  const st = streak(h), rt = rate30(h);
  const tage = last30(h).slice().reverse();   // älteste links, heute rechts
  return `<div class="detail">
    <div class="detail-title">${h.icon ? escHTML(h.icon) + ' ' : ''}${escHTML(h.text || '(ohne Name)')}</div>
    <div class="muted-row">${escHTML(FREQ[h.frequency] || 'Täglich')}</div>

    <button class="btn block ${on ? '' : 'primary'}" data-action="habit-toggle" data-id="${h.id}" data-sheet="1"
            style="margin:12px 0">${on ? '↩︎ Heute rückgängig' : '✓ Heute erledigt'}</button>

    <div class="habit-stats">
      <div class="habit-stat"><div class="habit-stat-num">${st}</div><div class="habit-stat-lbl">Tage Serie</div></div>
      <div class="habit-stat"><div class="habit-stat-num">${rt}%</div><div class="habit-stat-lbl">30 Tage</div></div>
      <div class="habit-stat"><div class="habit-stat-num">${tage.filter(t => t.done).length}</div><div class="habit-stat-lbl">von 30 erledigt</div></div>
    </div>

    <div class="muted-row" style="margin-top:14px">Letzte 30 Tage</div>
    <div class="habit-strip">
      ${tage.map(t => `<div class="habit-strip-cell${t.done ? ' on' : ''}" title="${escHTML(t.date)}: ${t.done ? 'erledigt' : 'offen'}"></div>`).join('')}
    </div>

    <div class="detail-actions" style="margin-top:16px">
      <button class="btn" data-action="habit-edit" data-id="${h.id}">✏️ Bearbeiten</button>
      <button class="btn danger" data-action="habit-delete" data-id="${h.id}" data-sheet="1">🗑 Löschen</button>
    </div>
  </div>`;
}

function editHtml(h) {
  const opts = Object.entries(FREQ)
    .map(([k, v]) => `<option value="${k}"${(h.frequency || 'daily') === k ? ' selected' : ''}>${escHTML(v)}</option>`).join('');
  // Feld-Aufbau wie in planen.js und new.js: label.f + span.f-label + .input.
  const feld = (label, inner) => `<label class="f"><span class="f-label">${label}</span>${inner}</label>`;
  return `<form class="detail">
    ${feld('Name', `<input class="input" name="text" value="${escHTML(h.text || '')}" required autocomplete="off">`)}
    ${feld('Symbol', `<input class="input" name="icon" value="${escHTML(h.icon || '')}" maxlength="2" autocomplete="off" placeholder="✅">`)}
    ${feld('Häufigkeit', `<select class="input" name="frequency">${opts}</select>`)}
    <div class="detail-actions" style="margin-top:16px">
      <button type="button" class="btn" data-action="habit-open" data-id="${h.id}">Zurück</button>
      <button type="submit" class="btn primary" data-action="habit-save" data-id="${h.id}">Speichern</button>
    </div>
  </form>`;
}

function openDetail(id) {
  const h = byId(id);
  if (!h) { closeSheet(); toast('Routine nicht mehr vorhanden', 'error'); return; }
  openSheet({ title: 'Routine', size: 'half', body: detailHtml(h) });
}

registerActions({
  'habit-open': (d) => openDetail(d.id),
  'habit-edit': (d) => {
    const h = byId(d.id); if (!h) return;
    openSheet({ title: 'Routine bearbeiten', size: 'half', body: editHtml(h) });
  },
  'habit-save': async (d, _el, e) => {
    const form = e.target.closest('form'); if (!form) return;
    const v = {}; new FormData(form).forEach((val, k) => { v[k] = typeof val === 'string' ? val.trim() : val; });
    if (!v.text) { toast('Name fehlt', 'error'); return; }
    await store.performOp({ type: 'update-habit', payload: { id: d.id, text: v.text, icon: v.icon || '', frequency: v.frequency || 'daily' } });
    closeSheet(); toast('Gespeichert ✓', 'ok');
  },
  'habit-toggle': async (d) => {
    await store.performOp({ type: 'toggle-habit', payload: { id: d.id, date: todayYmd() } });
    // Aus dem Sheet heraus: den Inhalt neu aufbauen, sonst zeigt er den Stand
    // von vorhin — Knopfbeschriftung, Serie und Streifen waeren falsch.
    if (d.sheet) openDetail(d.id);
  },
  'habit-delete': async (d) => {
    const h = byId(d.id); if (!h) return;
    // Vorher loeschte der Papierkorb ohne Rueckfrage. Auf einem Telefon liegt
    // er einen Daumen neben dem Kartenrumpf.
    const ok = await confirmPreview({
      title: 'Routine löschen?', danger: true, confirmLabel: 'Löschen',
      previewHtml: `<div class="detail-title">${escHTML(h.text || '')}</div>
        <div class="muted-row">Wird als gelöscht markiert (Soft-Delete). Die Serie geht verloren.</div>`,
    });
    if (!ok) return;
    await store.performOp({ type: 'delete-habit', payload: { id: d.id } });
    if (d.sheet) closeSheet();
    toast('Gelöscht', 'ok');
  },
});

export default {
  title: 'Gewohnheiten', icon: '🔁',
  render() {
    const today = todayYmd();
    const habits = store.getHabits();
    const done = habits.filter(h => store.habitDoneOn(h, today)).length;
    return `<div class="pad">
      ${pageHeader('Gewohnheiten', habits.length ? `${done}/${habits.length} heute erledigt` : 'Routinen aufbauen', `<button class="chip" data-action="open-new">＋ Neu</button>`)}
      ${habits.length ? habits.map(h => {
        const on = store.habitDoneOn(h, today);
        const st = streak(h), rt = rate30(h);
        return `<div class="card habit-card ${on ? 'done' : ''}">
          <button class="habit-check ${on ? 'on' : ''}" data-action="habit-toggle" data-id="${h.id}" aria-label="${on ? 'Heute rückgängig' : 'Heute erledigt'}">${on ? '✓' : (h.icon || '○')}</button>
          <div class="habit-main" data-action="habit-open" data-id="${h.id}" role="button" tabindex="0"
               aria-label="Routine öffnen: ${escHTML(h.text || '')}">
            <div class="habit-title">${escHTML(h.text || '(ohne Name)')}</div>
            <div class="habit-meta">
              <span class="meta">${FREQ[h.frequency] || 'Täglich'}</span>
              ${st ? `<span class="meta">🔥 ${st} Tage</span>` : ''}
              <span class="meta">${rt}% · 30T</span>
            </div>
            <div class="habit-bar"><div class="habit-bar-fill" style="width:${rt}%"></div></div>
          </div>
          <button class="icon-btn danger" data-action="habit-delete" data-id="${h.id}" aria-label="Löschen">🗑</button>
        </div>`;
      }).join('')
      : `<div class="empty"><div class="empty-icon">🔁</div><div class="empty-title">Keine Gewohnheiten</div><div class="empty-sub">Baue Routinen mit Serien & Quote auf.</div></div>`}
    </div>`;
  },
};
