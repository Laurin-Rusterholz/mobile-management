// ============================================================================
//  Quantus Mobile — Globale Suche (über alle Inhaltstypen mit Filtern)
// ============================================================================
import { openSheet, escHTML } from './util.js';
import { registerActions } from './actions.js';
import { navigate } from './router.js';
import * as store from './store.js';

const TYPES = [
  { key: 'task',    label: 'Aufgaben',   icon: '✅', get: () => store.getTasks(),   text: t => `${t.title} ${t.description || ''}`, route: 'planen' },
  { key: 'project', label: 'Projekte',   icon: '📦', get: () => store.getProjects(),text: p => `${p.title} ${p.description || ''}`, route: 'planen' },
  { key: 'note',    label: 'Notizen',    icon: '📝', get: () => store.getNotes().filter(n => n.noteClass !== 'idea'), text: n => `${n.title || ''} ${n.content || ''} ${(n.tags || []).join(' ')}`, route: 'noteflow' },
  { key: 'idea',    label: 'Ideen',      icon: '💡', get: () => store.getIdeaNotes(), text: i => `${i.title || ''} ${i.content || ''} ${(i.tags || []).join(' ')}`, route: 'ideen' },
  { key: 'meeting', label: 'Meetings',   icon: '🤝', get: () => store.getMeetings(),text: m => `${m.title || ''} ${m.location || ''}`, route: 'meetings' },
  { key: 'habit',   label: 'Gewohnheiten',icon: '🔁',get: () => store.getHabits(),  text: h => `${h.text || ''}`, route: 'gewohnheiten' },
  { key: 'card',    label: 'Flashcards', icon: '🎴', get: () => store.getCards(),   text: c => `${c.front || ''} ${c.back || ''}`, route: 'flashcards' },
];

let _filter = 'all';

export function openSearch() {
  _filter = 'all';
  openSheet({
    title: 'Suche',
    size: 'full',
    body: `
      <div class="search-box">
        <input id="searchInput" class="input" type="search" placeholder="Alles durchsuchen…" autocomplete="off">
      </div>
      <div class="search-filters" id="searchFilters">
        <button class="chip active" data-action="search-filter" data-f="all">Alle</button>
        ${TYPES.map(t => `<button class="chip" data-action="search-filter" data-f="${t.key}">${t.icon} ${t.label}</button>`).join('')}
      </div>
      <div id="searchResults" class="search-results"><div class="empty"><div class="empty-icon">🔍</div><div class="empty-sub">Tippe, um zu suchen.</div></div></div>`,
    onMount: (root) => {
      const input = root.querySelector('#searchInput');
      input.addEventListener('input', () => runSearch(root, input.value));
      setTimeout(() => input.focus(), 150);
    },
  });
}

function runSearch(root, q) {
  const results = root.querySelector('#searchResults');
  const query = (q || '').trim().toLowerCase();
  if (!query) { results.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-sub">Tippe, um zu suchen.</div></div>`; return; }
  const types = _filter === 'all' ? TYPES : TYPES.filter(t => t.key === _filter);
  let html = '', count = 0;
  types.forEach(t => {
    const hits = t.get().filter(x => t.text(x).toLowerCase().includes(query)).slice(0, 20);
    if (!hits.length) return;
    count += hits.length;
    html += `<div class="search-group-title">${t.icon} ${t.label}</div>`;
    hits.forEach(x => {
      const label = x.title || x.text || x.front || x.content || '(ohne Titel)';
      html += `<button class="search-hit" data-action="search-open" data-route="${t.route}" data-kind="${t.key}" data-id="${escHTML(x.id || '')}">${escHTML(String(label).slice(0, 80))}</button>`;
    });
  });
  results.innerHTML = count ? html : `<div class="empty"><div class="empty-icon">🤷</div><div class="empty-sub">Nichts gefunden für „${escHTML(q)}".</div></div>`;
}

registerActions({
  'search-filter': (d, elBtn) => {
    _filter = d.f;
    const root = elBtn.closest('.sheet-body');
    root.querySelectorAll('#searchFilters .chip').forEach(c => c.classList.toggle('active', c.dataset.f === d.f));
    runSearch(root, root.querySelector('#searchInput').value);
  },
  'search-open': (d) => {
    import('./util.js').then(m => m.closeSheet());
    // Zentrale Notizen (inkl. Ideen) direkt öffnen; andere Typen führen wie
    // bisher in ihre App-Liste.
    if ((d.kind === 'note' || d.kind === 'idea') && d.id) navigate('noteflow', { params: { id: d.id } });
    else navigate(d.route);
  },
});
