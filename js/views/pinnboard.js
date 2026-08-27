// ============================================================================
//  Pinnboard — die Sticky Boards aus dem Quantus-Datenstand, tabletnativ
//
//  BEFUND: In der Mobile-App gab es kein Pinnboard. Die Daten liegen laengst
//  im synchronisierten Bestand: jede Entitaet kann ein
//  stickyBoard = { notes[], connections[], drawings[], view } tragen.
//  Sichtbar war davon auf dem Geraet nichts.
//
//  Diese Ansicht liest ausschliesslich diesen vorhandenen Pfad. Sie legt keine
//  neue Struktur an und schreibt nur ueber die bestehende update-Op, wenn eine
//  Notiz bearbeitet wird.
//
//  Tablet: Board links, Notizen als Flaeche. Telefon: Boardliste, dann Notizen
//  als Liste — auf 390 px ist eine frei bewegliche Flaeche unbedienbar.
// ============================================================================
import { escHTML, toast, openSheet, closeSheet, confirmPreview, newId, nowISO } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate, current } from '../router.js';
import { pageHeader } from './common.js';

// Dieselben Sammlungen, die auch der Rest der App kennt.
const SAMMLUNGEN = [
  ['projects', 'Projekt'], ['tasks', 'Aufgabe'], ['notes', 'Notiz'],
  ['meetings', 'Meeting'], ['ideas', 'Idee'], ['concepts', 'Konzept'],
  ['goals', 'Ziel'], ['strategies', 'Strategie'], ['programs', 'Programm'],
];

function titelVon(e) { return e.title || e.text || e.name || '(ohne Titel)'; }

// Alle Entitaeten mit mindestens einer Post-it-Notiz — das IST die Boardliste.
export function boards() {
  const out = [];
  for (const [coll, label] of SAMMLUNGEN) {
    for (const e of store.getCollection(coll)) {
      const notes = (e && e.stickyBoard && Array.isArray(e.stickyBoard.notes)) ? e.stickyBoard.notes : [];
      if (notes.length) out.push({ coll, label, id: e.id, titel: titelVon(e), notes, updatedAt: e.updatedAt || '' });
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
function board(coll, id) { return boards().find(b => b.coll === coll && b.id === id) || null; }

function notizHtml(n) {
  const farbe = String(n.color || 'sand').replace(/[^a-z]/g, '') || 'sand';
  return `<button class="pb-note tone-${escHTML(farbe)}" data-action="pb-note" data-note="${escHTML(n.id || '')}">
    <span class="pb-note-text">${escHTML(n.text || '')}</span>
  </button>`;
}

registerActions({
  'pb-open': (d) => navigate('pinnboard', { sub: d.coll, params: { id: d.id } }),
  'pb-back': () => navigate('pinnboard'),
  'pb-note': (d) => {
    const c = current();
    const b = board(c.sub, c.params.id);
    const n = b && b.notes.find(x => x && x.id === d.note);
    if (!n) { toast('Notiz nicht mehr vorhanden', 'error'); return; }
    openSheet({
      title: 'Post-it', size: 'half',
      body: `<form class="detail">
        <label class="f"><span class="f-label">Text</span>
          <textarea class="input" name="text" rows="5">${escHTML(n.text || '')}</textarea></label>
        <div class="detail-actions" style="margin-top:16px">
          <button type="button" class="btn" data-action="pb-cancel">Abbrechen</button>
          <button type="submit" class="btn primary" data-action="pb-save" data-note="${escHTML(n.id)}">Speichern</button>
        </div>
      </form>`,
    });
  },
  'pb-cancel': () => closeSheet(),
  'pb-save': async (d, _el, e) => {
    const form = e.target.closest('form'); if (!form) return;
    const v = {}; new FormData(form).forEach((val, k) => { v[k] = typeof val === 'string' ? val : val; });
    const c = current();
    const b = board(c.sub, c.params.id);
    if (!b) { toast('Board nicht mehr vorhanden', 'error'); return; }
    // Der GANZE stickyBoard-Zweig wird zurueckgeschrieben — genau so, wie ihn
    // die Desktop-App fuehrt. Nur der Text der einen Notiz aendert sich.
    const entity = store.getById(b.coll.replace(/s$/, ''), b.id) || null;
    const quelle = entity && entity.stickyBoard ? entity.stickyBoard : { notes: b.notes };
    const notes = (quelle.notes || []).map(n => (n && n.id === d.note)
      ? { ...n, text: String(v.text || ''), updatedAt: nowISO() } : n);
    await store.performOp({ type: 'update-' + b.coll.replace(/s$/, ''),
      payload: { id: b.id, stickyBoard: { ...quelle, notes } } });
    closeSheet(); toast('Gespeichert ✓', 'ok');
  },
});

export default {
  title: 'Pinnboard', icon: '📌',
  render() {
    const c = current();
    const alle = boards();

    // Ein einzelnes Board.
    if (c.sub && c.params.id) {
      const b = board(c.sub, c.params.id);
      if (!b) return `<div class="pad">${pageHeader('Pinnboard', 'Board nicht gefunden',
        `<button class="chip" data-action="pb-back">← Alle Boards</button>`)}
        <div class="empty"><div class="empty-icon">📌</div><div class="empty-title">Dieses Board gibt es nicht mehr</div></div></div>`;
      return `<div class="pad">
        ${pageHeader(b.titel, `${b.label} · ${b.notes.length} Post-it${b.notes.length === 1 ? '' : 's'}`,
          `<button class="chip" data-action="pb-back">← Alle Boards</button>`)}
        <div class="pb-grid">${b.notes.map(notizHtml).join('')}</div>
      </div>`;
    }

    // Die Boardliste.
    const summe = alle.reduce((s, b) => s + b.notes.length, 0);
    return `<div class="pad">
      ${pageHeader('Pinnboard', alle.length ? `${alle.length} Board${alle.length === 1 ? '' : 's'} · ${summe} Post-its` : 'Post-its aus Quantus')}
      ${alle.length ? alle.map(b => `<button class="card row-card" data-action="pb-open" data-coll="${escHTML(b.coll)}" data-id="${escHTML(b.id)}">
        <span class="pb-badge">${b.notes.length}</span>
        <span class="task-main"><span class="bf-title">${escHTML(b.titel)}</span>
        <span class="meta">${escHTML(b.label)}</span></span>
        <span class="meta">›</span>
      </button>`).join('')
      : `<div class="empty"><div class="empty-icon">📌</div><div class="empty-title">Noch keine Post-its</div>
         <div class="empty-sub">Sticky Boards entstehen an Projekten, Notizen und Meetings — sie erscheinen hier automatisch.</div></div>`}
    </div>`;
  },
};
