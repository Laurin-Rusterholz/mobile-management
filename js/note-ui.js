// ============================================================================
//  Wiederverwendbare mobile Notiz-Erfassung
//  Kontext-Apps öffnen dieselbe kompakte Oberfläche, statt eigene Rohobjekte
//  oder neue Notizbücher anzulegen.
// ============================================================================
import { escHTML, openSheet, closeSheet, toast, newId, nowISO } from './util.js';
import * as store from './store.js';
import { navigate } from './router.js';
import {
  NOTE_CLASSES, NOTE_CLASS_KEYS, READING_KINDS, LEARNING_KINDS, RESEARCH_KINDS,
  normalizeTags, tagSuggestions,
} from './notes.js';

function options(values, selected) {
  return Object.entries(values).map(([value, label]) =>
    `<option value="${escHTML(value)}" ${value === selected ? 'selected' : ''}>${escHTML(label)}</option>`).join('');
}

function notebookOptions(selected) {
  return `<option value="">Inbox (kein Notizbuch)</option>` + store.getNotebooks().map((book) =>
    `<option value="${escHTML(book.id)}" ${book.id === selected ? 'selected' : ''}>${escHTML(book.title || book.name || 'Notizbuch')}</option>`).join('');
}

export function bindTagAutocomplete(root, config = {}) {
  const input = root.querySelector('[data-tag-input]');
  const chips = root.querySelector('[data-tag-chips]');
  const list = root.querySelector('[data-tag-suggestions]');
  if (!input || !chips || !list) return { tags: () => [] };

  const known = normalizeTags([...(store.getAllTags ? store.getAllTags() : []), ...(config.known || [])]);
  const locked = new Set(normalizeTags(config.locked || [], known).map((tag) => tag.toLocaleLowerCase('de-CH')));
  let tags = normalizeTags(config.initial || [], known);
  let active = -1;

  const changed = () => { if (typeof config.onChange === 'function') config.onChange(tags.slice()); };
  const renderChips = () => {
    chips.innerHTML = tags.map((tag) => {
      const fixed = locked.has(tag.toLocaleLowerCase('de-CH'));
      return `<span class="tag-chip">${escHTML(tag)}${fixed ? '' : `<button type="button" data-remove-tag="${escHTML(tag)}" aria-label="${escHTML(tag)} entfernen">×</button>`}</span>`;
    }).join('');
  };
  const suggestions = () => tagSuggestions(known, input.value, tags);
  const renderList = () => {
    const found = suggestions();
    active = found.length ? Math.max(0, Math.min(active < 0 ? 0 : active, found.length - 1)) : -1;
    list.innerHTML = found.map((tag, index) =>
      `<button type="button" role="option" aria-selected="${index === active}" class="tag-suggestion ${index === active ? 'active' : ''}" data-pick-tag="${escHTML(tag)}">${escHTML(tag)}</button>`).join('');
    list.hidden = !found.length;
    input.setAttribute('aria-expanded', found.length ? 'true' : 'false');
  };
  const add = (value) => {
    const next = normalizeTags([...tags, value], known);
    if (next.length === tags.length) return;
    tags = next; input.value = ''; active = -1; renderChips(); renderList(); changed();
  };
  const remove = (value) => {
    const key = String(value).toLocaleLowerCase('de-CH');
    if (locked.has(key)) return;
    tags = tags.filter((tag) => tag.toLocaleLowerCase('de-CH') !== key);
    renderChips(); renderList(); changed();
  };

  input.addEventListener('input', () => { active = -1; renderList(); });
  input.addEventListener('focus', renderList);
  input.addEventListener('keydown', (event) => {
    const found = suggestions();
    if (event.key === 'ArrowDown' && found.length) { event.preventDefault(); active = (active + 1) % found.length; renderList(); }
    else if (event.key === 'ArrowUp' && found.length) { event.preventDefault(); active = (active - 1 + found.length) % found.length; renderList(); }
    else if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      const picked = found[active] || input.value.replace(/,$/, '').trim();
      if (picked) add(picked);
    } else if (event.key === 'Backspace' && !input.value && tags.length) remove(tags[tags.length - 1]);
    else if (event.key === 'Escape') { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  });
  root.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-pick-tag]');
    const del = event.target.closest('[data-remove-tag]');
    if (pick) { add(pick.dataset.pickTag); input.focus(); }
    if (del) { remove(del.dataset.removeTag); input.focus(); }
  });
  root.addEventListener('focusout', () => setTimeout(() => {
    if (!root.contains(document.activeElement)) { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  }, 0));

  renderChips();
  return {
    tags: () => normalizeTags([...tags, input.value.trim()], known),
    add,
  };
}

function subtypeSelect(noteClass, current = '') {
  const values = noteClass === 'reading' ? READING_KINDS
    : noteClass === 'learning' ? LEARNING_KINDS
      : noteClass === 'research' ? RESEARCH_KINDS : null;
  if (!values) return '';
  const label = noteClass === 'reading' ? 'Art der Lesenotiz' : noteClass === 'learning' ? 'Art der Lernnotiz' : 'Art der Recherche';
  return `<label class="f note-subtype"><span class="f-label">${label}</span>
    <select class="input" name="subtype">${options(values, current || Object.keys(values)[0])}</select></label>`;
}

function sourceLabel(source) {
  return source && source.label ? source.label : 'Noteflow';
}

function showSaved(note, onSaved) {
  openSheet({
    title: 'Notiz gespeichert', size: 'half',
    body: `<div class="note-success">
      <div class="empty-icon">✓</div>
      <div class="empty-title">In Noteflow und der Inbox gespeichert</div>
      <div class="empty-sub">${escHTML(NOTE_CLASSES[note.noteClass])} · ${escHTML(note.tags.join(', '))}</div>
      <button class="btn primary block" type="button" data-open-note>In Noteflow öffnen</button>
      <button class="btn ghost block" type="button" data-stay>Schliessen</button>
    </div>`,
    onMount(root) {
      root.querySelector('[data-open-note]').addEventListener('click', () => {
        closeSheet(); navigate('noteflow', { params: { id: note.id } });
      });
      root.querySelector('[data-stay]').addEventListener('click', () => {
        closeSheet(); if (typeof onSaved === 'function') onSaved(note);
      });
    },
  });
}

export function openNoteComposer(config = {}) {
  const existing = config.note || null;
  const source = config.source || (existing && existing.source) || {
    app: 'noteflow', entityType: null, entityId: null, label: 'Noteflow', route: '#/noteflow',
  };
  const initialClass = config.noteClass || (existing && existing.noteClass) || 'research';
  const allowed = (config.allowClassSelection
    ? NOTE_CLASS_KEYS.filter((key) => source.app === 'noteflow' || key !== 'general')
    : [initialClass]);
  const initialTags = normalizeTags([
    ...(Array.isArray(existing && existing.tags) ? existing.tags : []),
    ...(Array.isArray(config.tags) ? config.tags : []),
  ], store.getAllTags ? store.getAllTags() : []);
  const lockedTags = normalizeTags(config.lockedTags || [], store.getAllTags ? store.getAllTags() : []);

  openSheet({
    title: config.heading || (existing ? 'Notiz bearbeiten' : NOTE_CLASSES[initialClass]),
    size: config.compact ? 'half' : 'full',
    body: `<form class="form note-composer" data-note-form>
      ${config.allowClassSelection ? `<label class="f"><span class="f-label">Notizklasse</span>
        <select class="input" name="noteClass">${allowed.map((key) => `<option value="${key}" ${key === initialClass ? 'selected' : ''}>${NOTE_CLASSES[key]}</option>`).join('')}</select></label>`
        : `<div class="note-context"><span class="pill accent">${escHTML(NOTE_CLASSES[initialClass])}</span><span>${escHTML(sourceLabel(source))}</span></div>
          <input type="hidden" name="noteClass" value="${escHTML(initialClass)}">`}
      <label class="f"><span class="f-label">Titel (optional)</span>
        <input class="input" name="title" value="${escHTML((existing && existing.title) || config.title || '')}" placeholder="Worum geht es?"></label>
      <label class="f"><span class="f-label">Inhalt</span>
        <textarea class="input" name="content" rows="7" required placeholder="${escHTML(config.placeholder || 'Notiz schreiben…')}">${escHTML((existing && existing.content) || config.content || '')}</textarea></label>
      <div data-subtype-host>${subtypeSelect(initialClass,
        (existing && (existing.readingKind || existing.learningKind || existing.researchKind)) || config.subtype)}</div>
      <label class="f"><span class="f-label">Schlagwörter${config.tagsRequired === false ? ' (optional)' : ''}</span>
        <div class="tag-editor">
          <div class="tag-chips" data-tag-chips></div>
          <input class="input tag-input" data-tag-input role="combobox" aria-autocomplete="list" aria-expanded="false"
            autocomplete="off" placeholder="Tippen oder neues Schlagwort mit Enter…">
          <div class="tag-suggestions" data-tag-suggestions role="listbox" hidden></div>
        </div></label>
      <label class="f"><span class="f-label">Notizbuch (optional)</span>
        <select class="input" name="notebookId">${notebookOptions((existing && existing.notebookId) || config.notebookId || '')}</select></label>
      <div class="note-inbox-hint">Ohne Auswahl wird die Notiz in der Inbox gespeichert. Es wird kein Notizbuch automatisch erstellt.</div>
      <button class="btn primary block big" type="submit">Notiz speichern</button>
    </form>`,
    onMount(root) {
      const form = root.querySelector('[data-note-form]');
      const tagEditor = bindTagAutocomplete(root, { initial: initialTags, locked: lockedTags });
      const classSelect = form.elements.noteClass;
      const subtypeHost = root.querySelector('[data-subtype-host]');
      if (config.allowClassSelection) classSelect.addEventListener('change', () => {
        subtypeHost.innerHTML = subtypeSelect(classSelect.value, '');
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fd = new FormData(form);
        const noteClass = String(fd.get('noteClass') || initialClass);
        const tags = tagEditor.tags();
        if (config.tagsRequired !== false && !tags.length && noteClass !== 'general') {
          toast('Mindestens ein Schlagwort ist erforderlich', 'warn'); return;
        }
        try {
          const subtype = String(fd.get('subtype') || '');
          const note = await store.saveCanonicalNote({
            ...(existing || {}),
            noteClass,
            title: String(fd.get('title') || ''),
            content: String(fd.get('content') || ''),
            tags,
            notebookId: String(fd.get('notebookId') || '') || null,
            source,
            ...(noteClass === 'reading' && subtype ? { readingKind: subtype } : {}),
            ...(noteClass === 'learning' && subtype ? { learningKind: subtype } : {}),
            ...(noteClass === 'research' && subtype ? { researchKind: subtype } : {}),
            ...(config.dedupeKey ? { dedupeKey: config.dedupeKey } : {}),
          });
          showSaved(note, config.onSaved);
        } catch (error) { toast(error.message || 'Notiz konnte nicht gespeichert werden', 'error'); }
      });
    },
  });
}

export function openIdeaComposer(existing = null) {
  const currentTags = normalizeTags((existing && existing.tags) || [], store.getAllTags ? store.getAllTags() : []);
  openSheet({
    title: existing ? 'Idee bearbeiten' : 'Neue Idee', size: 'half',
    body: `<form class="form" data-idea-form>
      <label class="f"><span class="f-label">Kategorie</span>
        <div class="tag-editor">
          <div class="tag-chips" data-tag-chips></div>
          <input class="input tag-input" data-tag-input role="combobox" aria-autocomplete="list" aria-expanded="false"
            autocomplete="off" placeholder="z. B. Journalismus">
          <div class="tag-suggestions" data-tag-suggestions role="listbox" hidden></div>
        </div></label>
      <label class="f"><span class="f-label">Idee</span>
        <textarea class="input" name="content" rows="5" required placeholder="Was ist deine Idee?">${escHTML((existing && existing.content) || '')}</textarea></label>
      <label class="f"><span class="f-label">Titel (optional)</span>
        <input class="input" name="title" value="${escHTML((existing && existing.title) || '')}" placeholder="Wird sonst aus der Idee gebildet"></label>
      <div class="note-inbox-hint">Die Kategorie wird als Schlagwort gespeichert. Die Idee erscheint als eine einzige zentrale Notiz in Ideas, Noteflow und der Inbox.</div>
      <button class="btn primary block big" type="submit">Idee festhalten</button>
    </form>`,
    onMount(root) {
      const tags = bindTagAutocomplete(root, { initial: currentTags });
      root.querySelector('[data-idea-form]').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fd = new FormData(form);
        const selected = tags.tags();
        if (!selected.length) { toast('Kategorie fehlt', 'warn'); return; }
        const id = (existing && existing.id) || newId('idea');
        try {
          const note = await store.saveCanonicalNote({
            ...(existing || {}), id,
            noteClass: 'idea', title: String(fd.get('title') || ''), content: String(fd.get('content') || ''),
            category: selected[0], tags: selected, notebookId: null,
            dedupeKey: (existing && existing.dedupeKey) || `ideas:${id}`,
            source: { app: 'ideas', entityType: 'idea', entityId: (existing && existing.source && existing.source.entityId) || id, label: selected[0], route: '#/ideen' },
          });
          showSaved(note);
        } catch (error) { toast(error.message || 'Idee konnte nicht gespeichert werden', 'error'); }
      });
    },
  });
}

function localDatetimeValue(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function openShortnote() {
  openSheet({
    title: 'Shortnote', size: 'half',
    body: `<form class="form shortnote" data-shortnote-form>
      <div class="shortnote-choice" role="radiogroup" aria-label="Art der Schnellerfassung">
        <button type="button" class="shortnote-mode active" data-mode="note" role="radio" aria-checked="true">📝<span>Notiz</span></button>
        <button type="button" class="shortnote-mode" data-mode="message" role="radio" aria-checked="false">🔔<span>Mitteilung</span></button>
      </div>
      <input type="hidden" name="mode" value="note">
      <label class="f"><span class="f-label" data-text-label>Kurze Notiz</span>
        <textarea class="input" name="content" rows="4" required placeholder="Schnell festhalten…"></textarea></label>
      <div data-note-fields>
        <label class="f"><span class="f-label">Schlagwortkategorie</span>
          <div class="tag-editor">
            <div class="tag-chips" data-tag-chips></div>
            <input class="input tag-input" data-tag-input role="combobox" aria-autocomplete="list" aria-expanded="false"
              autocomplete="off" placeholder="Kategorie eingeben…">
            <div class="tag-suggestions" data-tag-suggestions role="listbox" hidden></div>
          </div></label>
        <div class="note-inbox-hint">Die Notiz landet in Noteflow, in der Inbox und unter dem Schlagwort.</div>
      </div>
      <label class="f" data-message-fields hidden><span class="f-label">Zustellzeitpunkt</span>
        <input class="input" name="deliverAt" type="datetime-local" min="${localDatetimeValue(new Date())}"
          value="${localDatetimeValue(new Date(Date.now() + 3600000))}"></label>
      <button class="btn primary block big" type="submit" data-save-label>Notiz speichern</button>
    </form>`,
    onMount(root) {
      const form = root.querySelector('[data-shortnote-form]');
      const tagEditor = bindTagAutocomplete(root);
      const setMode = (mode) => {
        form.elements.mode.value = mode;
        root.querySelector('[data-note-fields]').hidden = mode !== 'note';
        root.querySelector('[data-message-fields]').hidden = mode !== 'message';
        root.querySelector('[data-text-label]').textContent = mode === 'note' ? 'Kurze Notiz' : 'Mitteilung';
        root.querySelector('[data-save-label]').textContent = mode === 'note' ? 'Notiz speichern' : 'Mitteilung planen';
        root.querySelectorAll('[data-mode]').forEach((button) => {
          const on = button.dataset.mode === mode;
          button.classList.toggle('active', on); button.setAttribute('aria-checked', String(on));
        });
      };
      root.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fd = new FormData(form);
        const mode = String(fd.get('mode') || 'note');
        const content = String(fd.get('content') || '').trim();
        if (!content) { toast('Text fehlt', 'warn'); return; }
        if (mode === 'message') {
          const raw = String(fd.get('deliverAt') || '');
          const deliver = new Date(raw);
          if (!raw || Number.isNaN(deliver.getTime())) { toast('Zustellzeitpunkt fehlt', 'warn'); return; }
          if (deliver.getTime() <= Date.now()) { toast('Der Zustellzeitpunkt muss in der Zukunft liegen', 'warn'); return; }
          const now = nowISO();
          await store.performOp({ type: 'add-message', payload: {
            id: newId('msg'), title: 'Mitteilung', content, scheduledAt: now,
            deliverAt: deliver.toISOString(), isDelivered: false, deliveredAt: null,
            isRead: false, source: 'mobile-shortnote', createdAt: now, updatedAt: now,
          } });
          closeSheet(); toast('Mitteilung geplant ✓', 'ok'); return;
        }
        const tags = tagEditor.tags();
        if (!tags.length) { toast('Schlagwortkategorie fehlt', 'warn'); return; }
        try {
          const note = await store.saveCanonicalNote({
            noteClass: 'short', content, tags, notebookId: null,
            source: { app: 'shortnote', entityType: 'capture', entityId: null, label: 'Shortnote', route: '#/noteflow' },
          });
          showSaved(note);
        } catch (error) { toast(error.message || 'Notiz konnte nicht gespeichert werden', 'error'); }
      });
    },
  });
}
