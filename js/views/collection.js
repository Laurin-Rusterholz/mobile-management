// ============================================================================
//  Generische Modul-Ansicht — eine Oberfläche für alle Quantus-Sammlungen
//  ---------------------------------------------------------------------------
//  Projekte, Ziele, Strategien, Konzepte, Programme, Organisationen, Personen,
//  Entscheidungen, Protokolle und Workflows nutzen dieselbe Liste mit Suche,
//  Statusfilter, Schnellerfassung, Detailformular und Löschen.
//  Damit hat die Handy-Version denselben Funktionsumfang wie Tablet/Desktop —
//  ohne für jedes Modul eigenen Code zu duplizieren.
// ============================================================================
import { escHTML, formatDate, newId, nowISO, openSheet, closeSheet, toast, confirmPreview, emptyState } from '../util.js';
import * as store from '../store.js';
import { COLLECTIONS } from '../config.js';
import { registerActions } from '../actions.js';
import { pageHeader, segmented } from './common.js';

// Ansichtszustand je Modul (Suche/Filter bleiben beim Wechsel erhalten)
const uiState = {};
function ui(key) {
  if (!uiState[key]) uiState[key] = { search: '', filter: 'all', sort: 'new' };
  return uiState[key];
}

const STATUS = [
  { key: 'all', label: 'Alle' },
  { key: 'open', label: 'Offen' },
  { key: 'in_progress', label: 'In Arbeit' },
  { key: 'done', label: 'Erledigt' },
];

const isDone = (item) => ['done', 'completed', 'erledigt', 'closed', 'archived'].includes(String(item.status || '').toLowerCase());
const titleOf = (item) => item.title || item.name || item.subject || '(ohne Titel)';
const textOf = (item) => item.description || item.content || item.summary || item.text || '';

function itemsOf(key) {
  const cfg = COLLECTIONS[key];
  const s = ui(key);
  let list = store.getCollection(cfg.entity);
  if (s.filter === 'open') list = list.filter(i => !isDone(i) && i.status !== 'in_progress');
  else if (s.filter === 'in_progress') list = list.filter(i => i.status === 'in_progress');
  else if (s.filter === 'done') list = list.filter(isDone);
  if (s.search) {
    const q = s.search.toLowerCase();
    list = list.filter(i => (titleOf(i) + ' ' + textOf(i)).toLowerCase().includes(q));
  }
  if (s.sort === 'alpha') list = list.slice().sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'de'));
  else if (s.sort === 'due') list = list.slice().sort((a, b) => String(a.dueDate || a.date || '9999').localeCompare(String(b.dueDate || b.date || '9999')));
  else list = list.slice().sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  return list;
}

function counts(key) {
  const cfg = COLLECTIONS[key];
  const all = store.getCollection(cfg.entity);
  return {
    all: all.length,
    open: all.filter(i => !isDone(i) && i.status !== 'in_progress').length,
    in_progress: all.filter(i => i.status === 'in_progress').length,
    done: all.filter(isDone).length,
  };
}

function itemCard(key, item) {
  const cfg = COLLECTIONS[key];
  const due = item.dueDate || item.date;
  return `<div class="card row-card ${isDone(item) ? 'done' : ''}">
    <div class="row-main" data-action="coll-open" data-coll="${key}" data-id="${item.id}">
      <div class="row-title">${escHTML(titleOf(item))}</div>
      <div class="row-sub">${escHTML(String(textOf(item)).slice(0, 90) || cfg.label)}</div>
      <div class="row-meta">
        ${item.status ? `<span class="chip mini">${escHTML(item.status)}</span>` : ''}
        ${due ? `<span class="chip mini">📅 ${formatDate(due)}</span>` : ''}
      </div>
    </div>
    <button class="chip" data-action="coll-open" data-coll="${key}" data-id="${item.id}">›</button>
  </div>`;
}

// ── Formular (Neu / Bearbeiten) ─────────────────────────────────────────────
function formHtml(key, item) {
  const cfg = COLLECTIONS[key];
  const v = item || {};
  return `<form class="form" id="collForm">
    <label class="f"><span class="f-label">Titel</span>
      <input id="cfTitle" class="input" value="${escHTML(titleOf(v) === '(ohne Titel)' ? '' : titleOf(v))}" placeholder="${escHTML(cfg.label)}"></label>
    <label class="f"><span class="f-label">Beschreibung</span>
      <textarea id="cfText" class="input" rows="5">${escHTML(textOf(v))}</textarea></label>
    <div class="f-row">
      <label class="f"><span class="f-label">Status</span>
        <select id="cfStatus" class="input">
          ${['open', 'in_progress', 'done', 'archived'].map(s =>
            `<option value="${s}" ${String(v.status || 'open') === s ? 'selected' : ''}>${
              { open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', archived: 'Archiviert' }[s]}</option>`).join('')}
        </select></label>
      <label class="f"><span class="f-label">Termin</span>
        <input id="cfDue" class="input" type="date" value="${escHTML(String(v.dueDate || v.date || '').slice(0, 10))}"></label>
    </div>
    <button class="btn primary block" type="button" data-action="coll-save" data-coll="${key}" data-id="${v.id || ''}">Speichern</button>
    ${v.id ? `<button class="btn danger block" type="button" data-action="coll-delete" data-coll="${key}" data-id="${v.id}">Löschen</button>` : ''}
  </form>`;
}

function openForm(key, id) {
  const cfg = COLLECTIONS[key];
  const item = id ? store.getCollection(cfg.entity).find(i => i.id === id) : null;
  openSheet({
    title: item ? titleOf(item) : 'Neu: ' + cfg.label,
    size: 'full',
    body: formHtml(key, item),
  });
}

registerActions({
  'coll-open': (d) => openForm(d.coll, d.id),
  'coll-new': (d) => openForm(d.coll, null),
  'coll-filter': (d) => { ui(d.coll).filter = d.seg; store.notify(); },
  'coll-sort': (d) => { ui(d.coll).sort = d.sort; store.notify(); },

  'coll-save': async (d) => {
    const cfg = COLLECTIONS[d.coll];
    const title = (document.getElementById('cfTitle') || {}).value || '';
    const text = (document.getElementById('cfText') || {}).value || '';
    const status = (document.getElementById('cfStatus') || {}).value || 'open';
    const due = (document.getElementById('cfDue') || {}).value || '';
    if (!title.trim()) { toast('Titel fehlt', 'error'); return; }
    const base = {
      title: title.trim(),
      description: text.trim(),
      status,
      dueDate: due || null,
      updatedAt: nowISO(),
    };
    if (d.id) {
      await store.performOp({ type: 'update-' + cfg.kind, payload: { id: d.id, ...base } });
    } else {
      await store.performOp({
        type: 'add-' + cfg.kind,
        payload: { id: newId(cfg.kind), createdAt: nowISO(), source: 'mobile', ...base },
      });
    }
    closeSheet();
    toast(cfg.label + ' gespeichert ✓', 'ok');
  },

  'coll-delete': async (d) => {
    const cfg = COLLECTIONS[d.coll];
    const item = store.getCollection(cfg.entity).find(i => i.id === d.id);
    const ok = await confirmPreview({
      title: cfg.label + ' löschen?', confirmLabel: 'Löschen', danger: true,
      previewHtml: `<div class="mail-preview"><div><b>${escHTML(titleOf(item || {}))}</b></div>
        <div class="mail-preview-body">${escHTML(String(textOf(item || {})).slice(0, 200))}</div></div>`,
    });
    if (!ok) return;
    await store.performOp({ type: 'delete-' + cfg.kind, payload: { id: d.id } });
    closeSheet();
    toast(cfg.label + ' gelöscht', 'ok');
  },
});

function listHtml(key, list) {
  const cfg = COLLECTIONS[key];
  if (list.length) return list.map(i => itemCard(key, i)).join('');
  return emptyState(cfg.icon, 'Noch keine ' + cfg.plural,
    'Lege den ersten Eintrag an — er erscheint sofort auch auf Tablet und Desktop.',
    `<button class="btn primary" data-action="coll-new" data-coll="${key}">＋ ${escHTML(cfg.label)}</button>`);
}

// ── View-Fabrik: erzeugt für jeden Sammlungsschlüssel ein Router-Modul ──────
export function makeCollectionView(key) {
  const cfg = COLLECTIONS[key];
  return {
    title: cfg.plural, icon: cfg.icon,
    render() {
      const s = ui(key);
      const c = counts(key);
      const list = itemsOf(key);
      return `<div class="pad">
        ${pageHeader(cfg.plural, c.all + ' Einträge',
          `<button class="chip accent" data-action="coll-new" data-coll="${key}">＋ Neu</button>`)}
        <div class="coll-search">
          <input class="input" id="collSearch" type="search" placeholder="${escHTML(cfg.plural)} durchsuchen"
            value="${escHTML(s.search)}">
        </div>
        ${segmented(STATUS.map(x => ({ ...x, count: c[x.key] })), s.filter, 'coll-filter')
          .replace(/data-action="coll-filter"/g, `data-action="coll-filter" data-coll="${key}"`)}
        <div class="chip-row">
          ${[['new', 'Neueste'], ['alpha', 'A–Z'], ['due', 'Termin']].map(([k, l]) =>
            `<button class="chip ${s.sort === k ? 'accent' : ''}" data-action="coll-sort" data-coll="${key}" data-sort="${k}">${l}</button>`).join('')}
        </div>
        <div id="collList">${listHtml(key, list)}</div>
      </div>`;
    },
    mount(root) {
      const input = root.querySelector('#collSearch');
      if (!input) return;
      // Nur die Liste neu zeichnen — das Suchfeld behält den Fokus.
      input.addEventListener('input', () => {
        ui(key).search = input.value.trim();
        const host = root.querySelector('#collList');
        if (host) host.innerHTML = listHtml(key, itemsOf(key));
      });
    },
  };
}

// Alle Sammlungen als fertige Router-Module.
export const collectionViews = Object.fromEntries(
  Object.keys(COLLECTIONS).map(key => [key, makeCollectionView(key)])
);
