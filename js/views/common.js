// Shared render helpers for views
import { escHTML, formatDate } from '../util.js';

export function pageHeader(title, sub, rightHtml = '') {
  return `<div class="page-head">
    <div><div class="page-title">${escHTML(title)}</div>${sub ? `<div class="page-sub">${escHTML(sub)}</div>` : ''}</div>
    ${rightHtml ? `<div class="page-head-right">${rightHtml}</div>` : ''}
  </div>`;
}

export function segmented(items, active, action = 'seg') {
  return `<div class="segmented">${items.map(i =>
    `<button class="seg ${i.key === active ? 'active' : ''}" data-action="${action}" data-seg="${i.key}">${escHTML(i.label)}${i.count != null ? ` <span class="seg-count">${i.count}</span>` : ''}</button>`).join('')}</div>`;
}

export function taskCard(t) {
  const done = t.status === 'done';
  const overdue = t.dueDate && !done && new Date(t.dueDate) < new Date(new Date().toDateString());
  const prio = Number(t.priority || 3);
  return `<div class="card task-card ${done ? 'done' : ''} ${overdue ? 'overdue' : ''}">
    <button class="check ${done ? 'on' : ''}" data-action="toggle-task" data-id="${t.id}" aria-label="Erledigt"></button>
    <div class="task-main" data-action="open-task" data-id="${t.id}">
      <div class="task-title">${escHTML(t.title || '(ohne Titel)')}</div>
      <div class="task-meta">
        ${t.dueDate ? `<span class="meta ${overdue ? 'danger' : ''}">📅 ${formatDate(t.dueDate)}</span>` : ''}
        <span class="prio p${prio}">P${prio}</span>
        ${t.source === 'mobile' ? '<span class="meta">📱</span>' : ''}
      </div>
    </div>
  </div>`;
}
