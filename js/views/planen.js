// ============================================================================
//  Planen — Aufgaben + Projekte
//  Ansichten: Inbox · Heute · Geplant · Überfällig · Erledigt · Liste · Kanban
//  Tablet: Zweispaltenansicht (Liste links, Detail rechts).
// ============================================================================
import { escHTML, formatDate, todayYmd, ymdOf, openSheet, closeSheet, toast, confirmPreview } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate, current } from '../router.js';
import { isTablet } from '../shell.js';
import { pageHeader, segmented, taskCard } from './common.js';
import * as focus from '../focus.js';

const VIEWS = [
  { key: 'inbox', label: 'Inbox' }, { key: 'heute', label: 'Heute' }, { key: 'geplant', label: 'Geplant' },
  { key: 'ueberfaellig', label: 'Überfällig' }, { key: 'erledigt', label: 'Erledigt' },
  { key: 'liste', label: 'Liste' }, { key: 'kanban', label: 'Kanban' },
];
const today = () => todayYmd();
const isOverdue = t => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date(new Date().toDateString());

function filterTasks(view) {
  const all = store.getTasks();
  if (view === 'inbox') return all.filter(t => t.status !== 'done' && !t.projectId && (!t.linkedProjects || !t.linkedProjects.length));
  if (view === 'heute') return all.filter(t => t.status !== 'done' && ymdOf(t.dueDate) === today());
  if (view === 'geplant') return all.filter(t => t.status !== 'done' && t.dueDate && ymdOf(t.dueDate) > today());
  if (view === 'ueberfaellig') return all.filter(isOverdue);
  if (view === 'erledigt') return all.filter(t => t.status === 'done').slice(-100).reverse();
  return all.filter(t => t.status !== 'done');   // liste / kanban
}

function taskList(view) {
  const tasks = filterTasks(view);
  if (!tasks.length) return `<div class="empty"><div class="empty-icon">🎉</div><div class="empty-title">Nichts hier</div><div class="empty-sub">Diese Ansicht ist leer.</div></div>`;
  if (view === 'kanban') return kanban(tasks);
  return tasks.map(taskCard).join('');
}

function kanban(tasks) {
  const cols = [
    { key: 'todo', label: 'To-Do', f: t => t.status === 'todo' || (!t.status || t.status === '') },
    { key: 'progress', label: 'Läuft', f: t => t.status === 'in_progress' || t.status === 'doing' },
    { key: 'done', label: 'Erledigt', f: t => t.status === 'done' },
  ];
  const done = store.getTasks();
  return `<div class="kanban">${cols.map(c => {
    const items = (c.key === 'done' ? done : tasks).filter(c.f).slice(0, 40);
    return `<div class="kanban-col"><div class="kanban-col-head">${c.label} <span class="seg-count">${items.length}</span></div>
      ${items.map(t => `<div class="kanban-card" data-action="open-task" data-id="${t.id}">${escHTML(t.title || '')}</div>`).join('') || '<div class="muted-row">—</div>'}
    </div>`;
  }).join('')}</div>`;
}

function projectStrip() {
  const ps = store.getProjects().filter(p => (p.status || 'active') === 'active').slice(0, 12);
  if (!ps.length) return '';
  return `<div class="chip-strip">${ps.map(p => `<button class="chip" data-action="open-project" data-id="${p.id}">📦 ${escHTML(p.title || 'Projekt')}</button>`).join('')}</div>`;
}

function detailPane(id) {
  const t = id && store.getById('task', id);
  if (!t) return `<div class="detail-empty"><div class="empty-icon">👈</div><div class="empty-sub">Aufgabe wählen</div></div>`;
  return taskDetailHtml(t);
}

function taskDetailHtml(t) {
  const done = t.status === 'done';
  return `<div class="detail">
    <div class="detail-head">
      <div class="detail-title">${escHTML(t.title || '')}</div>
      <div class="detail-badges">${t.dueDate ? `<span class="chip">📅 ${formatDate(t.dueDate)}</span>` : ''}<span class="chip">P${Number(t.priority || 3)}</span></div>
    </div>
    ${t.description ? `<div class="detail-text">${escHTML(t.description)}</div>` : ''}
    <div class="detail-actions">
      <button class="btn ${done ? 'ghost' : 'primary'}" data-action="toggle-task" data-id="${t.id}">${done ? '↩︎ Wieder öffnen' : '✓ Erledigt'}</button>
      <button class="btn" data-action="edit-task" data-id="${t.id}">✎ Bearbeiten</button>
      <button class="btn" data-action="focus-from-task" data-id="${t.id}">🎯 Fokus starten</button>
      <button class="btn danger ghost" data-action="delete-task" data-id="${t.id}">🗑 Löschen</button>
    </div>
  </div>`;
}

function taskEditForm(t) {
  const projects = store.getProjects();
  const f = (label, inner) => `<label class="f"><span class="f-label">${label}</span>${inner}</label>`;
  return `<form data-action="save-task" data-id="${t.id}" class="form">
    ${f('Titel', `<input name="title" class="input" required value="${escHTML(t.title || '')}">`)}
    ${f('Beschreibung', `<textarea name="description" class="input" rows="3">${escHTML(t.description || '')}</textarea>`)}
    <div class="f-row">
      ${f('Fällig', `<input name="dueDate" type="date" class="input" value="${escHTML((t.dueDate || '').slice(0, 10))}">`)}
      ${f('Priorität', `<select name="priority" class="input">${[['1', 'Hoch'], ['2', 'Mittel'], ['3', 'Normal'], ['4', 'Niedrig']].map(([v, l]) => `<option value="${v}" ${String(t.priority || 3) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
    </div>
    ${f('Status', `<select name="status" class="input">${[['todo', 'To-Do'], ['in_progress', 'Läuft'], ['done', 'Erledigt']].map(([v, l]) => `<option value="${v}" ${(t.status || 'todo') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
    ${f('Projekt', `<select name="projectId" class="input"><option value="">— keins —</option>${projects.map(p => `<option value="${p.id}" ${t.projectId === p.id ? 'selected' : ''}>${escHTML(p.title || 'Projekt')}</option>`).join('')}</select>`)}
    <button class="btn primary block" type="submit">Speichern</button>
  </form>`;
}

registerActions({
  'toggle-task': async (d) => {
    const t = store.getById('task', d.id); if (!t) return;
    const status = t.status === 'done' ? 'todo' : 'done';
    await store.performOp({ type: 'update-task', payload: { id: d.id, status, completedAt: status === 'done' ? new Date().toISOString() : null } });
    if (status === 'done') { import('../util.js').then(m => m.haptic(20)); }
  },
  'open-task': (d) => {
    if (isTablet()) navigate('planen', { sub: current().sub || 'inbox', params: { id: d.id } });
    else {
      const t = store.getById('task', d.id); if (!t) return;
      openSheet({ title: 'Aufgabe', size: 'half', body: taskDetailHtml(t) });
    }
  },
  'open-project': (d) => {
    const p = store.getById('project', d.id); if (!p) return;
    openSheet({ title: 'Projekt', size: 'half', body: `<div class="detail">
      <div class="detail-title">${escHTML(p.title || '')}</div>
      ${p.description ? `<div class="detail-text">${escHTML(p.description)}</div>` : ''}
      <div class="muted-row">Status: ${escHTML(p.status || 'active')}</div>
      <div class="detail-text">Aufgaben in diesem Projekt: ${store.getTasks().filter(t => t.projectId === p.id).length}</div>
    </div>` });
  },
  'delete-task': async (d) => {
    const t = store.getById('task', d.id); if (!t) return;
    const ok = await confirmPreview({ title: 'Aufgabe löschen?', danger: true, confirmLabel: 'Löschen',
      previewHtml: `<div class="detail-title">${escHTML(t.title || '')}</div><div class="muted-row">Wird als gelöscht markiert (Soft-Delete).</div>` });
    if (!ok) return;
    await store.performOp({ type: 'delete-task', payload: { id: d.id } });
    closeSheet(); toast('Gelöscht', 'ok'); navigate('planen', { sub: current().sub || 'inbox' });
  },
  'focus-from-task': (d) => {
    const t = store.getById('task', d.id); if (!t) return;
    closeSheet();
    focus.start({ taskId: t.id, taskTitle: t.title, projectId: t.projectId || '', durationMin: 25, sessionName: 'Deep Work' });
    navigate('fokus');
  },
  'edit-task': (d) => {
    const t = store.getById('task', d.id); if (!t) return;
    openSheet({ title: 'Aufgabe bearbeiten', size: 'half', body: taskEditForm(t) });
  },
  'save-task': async (d, elTrigger, e) => {
    const form = e.target.closest('form');
    const fd = new FormData(form); const v = {};
    fd.forEach((val, k) => { v[k] = typeof val === 'string' ? val.trim() : val; });
    await store.performOp({ type: 'update-task', payload: { id: d.id, title: v.title, description: v.description || '', dueDate: v.dueDate || '', priority: Number(v.priority || 3), status: v.status || 'todo', projectId: v.projectId || '' } });
    closeSheet(); toast('Gespeichert ✓', 'ok'); navigate('planen', { sub: current().sub || 'inbox' });
  },
  'seg': (d) => navigate('planen', { sub: d.seg }),
});

export default {
  title: 'Planen', icon: '🗂️',
  render(ctx) {
    const view = ctx.sub || 'inbox';
    const counts = {};
    VIEWS.forEach(v => { counts[v.key] = ['liste', 'kanban'].includes(v.key) ? null : filterTasks(v.key).length; });
    const seg = segmented(VIEWS.map(v => ({ ...v, count: counts[v.key] })), view);
    const listHtml = taskList(view);
    if (isTablet()) {
      return `<div class="pad">
        ${pageHeader('Planen', 'Aufgaben & Projekte')}
        ${seg}${projectStrip()}
        <div class="split">
          <div class="split-list">${listHtml}</div>
          <div class="split-detail">${detailPane(ctx.params.id)}</div>
        </div>
      </div>`;
    }
    return `<div class="pad">
      ${pageHeader('Planen', 'Aufgaben & Projekte')}
      ${seg}${projectStrip()}
      <div class="list">${listHtml}</div>
    </div>`;
  },
};
