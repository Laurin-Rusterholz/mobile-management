// ============================================================================
//  Quantus Notes — gemeinsamer fachlicher Vertrag der Mobile-App
//
//  Dieses Modul ist absichtlich DOM-frei. Jede Ansicht erzeugt Notizen über
//  dieselbe Factory; Migration, Klassifizierung und Schlagwortlogik lassen
//  sich deshalb ohne Browser testen und bleiben mit Desktop/Tablet identisch.
// ============================================================================

export const NOTE_CLASSES = Object.freeze({
  reading: 'Lesenotiz',
  learning: 'Lernnotiz',
  idea: 'Idee',
  general: 'Generelle Notiz',
  short: 'Kurze Notiz',
  research: 'Recherchenotiz',
});

// Ideen-Status wandert als note.ideaStatus im Desktop-Vokabular über die
// Geräte (Review P2-4). Mobile führt ihn lokal in ideaMeta.status weiter;
// beide Felder werden hier ineinander übersetzt. Unbekannte Werte bleiben
// unangetastet, damit kein Gerät Informationen verliert.
const IDEA_STATUS_TO_SHARED = { idea: 'open', neu: 'open', 'new': 'open', planned: 'processed', archived: 'archived' };
const IDEA_STATUS_FROM_SHARED = { open: 'idea', 'new': 'idea', neu: 'idea', processed: 'planned', archived: 'archived' };
export function ideaStatusToShared(status) {
  const value = String(status || '').trim();
  return IDEA_STATUS_TO_SHARED[value] || value || 'open';
}
export function ideaStatusFromShared(status) {
  const value = String(status || '').trim();
  return IDEA_STATUS_FROM_SHARED[value] || value || 'idea';
}


export const NOTE_CLASS_KEYS = Object.freeze(Object.keys(NOTE_CLASSES));

export const READING_KINDS = Object.freeze({
  note: 'Eigene Notiz', quote: 'Zitat', summary: 'Zusammenfassung', insight: 'Erkenntnis',
});

export const LEARNING_KINDS = Object.freeze({
  merksatz: 'Merksatz', erklaerung: 'Erklärung', fehler: 'Fehleranalyse',
  frage: 'Frage', zusammenfassung: 'Zusammenfassung',
});

export const RESEARCH_KINDS = Object.freeze({
  note: 'Arbeitsnotiz', source: 'Quelle', finding: 'Befund', argument: 'Argument',
  quote: 'Zitat', article: 'Artikel',
});

const APP_ALIASES = Object.freeze({
  'reading-hub': 'readinghub', reading: 'readinghub', books: 'readinghub', book: 'readinghub',
  newsroom: 'articles', article: 'articles', newsroomhub: 'articles',
  bm: 'bmpruefung', 'bm-vorbereitung': 'bmpruefung', bmvorbereitung: 'bmpruefung',
  recalllab: 'recalllab', flashcards: 'recalllab',
  note: 'noteflow', notes: 'noteflow', mobile: 'noteflow', desktop: 'noteflow',
  idea: 'ideas', ideen: 'ideas', shortnote: 'shortnote', quickcapture: 'shortnote',
});

function text(value) { return value == null ? '' : String(value).trim(); }
function lower(value) { return text(value).toLocaleLowerCase('de-CH'); }
function validClass(value) { return NOTE_CLASS_KEYS.includes(value); }

export function normalizeApp(value, fallback = 'noteflow') {
  const raw = lower(value).replace(/\s+/g, '-');
  return APP_ALIASES[raw] || raw || fallback;
}

/**
 * Normalisiert Tags und bewahrt dabei die Schreibweise aus dem synchronisierten
 * Bestand. "politik" wird also zu "Politik", wenn "Politik" schon existiert.
 */
export function normalizeTags(values, knownTags = []) {
  const input = Array.isArray(values)
    ? values
    : (values == null ? [] : String(values).split(','));
  const known = new Map();
  (Array.isArray(knownTags) ? knownTags : []).forEach((tag) => {
    const clean = text(tag);
    if (clean && !known.has(lower(clean))) known.set(lower(clean), clean);
  });
  const result = [];
  const seen = new Set();
  input.forEach((tag) => {
    const clean = text(tag);
    const key = lower(clean);
    if (!clean || seen.has(key)) return;
    seen.add(key);
    result.push(known.get(key) || clean);
  });
  return result;
}

export function collectTags(notes) {
  const all = [];
  (Array.isArray(notes) ? notes : []).forEach((note) => {
    (Array.isArray(note && note.tags) ? note.tags : []).forEach((tag) => all.push(tag));
  });
  return normalizeTags(all).sort((a, b) => a.localeCompare(b, 'de-CH'));
}

export function tagSuggestions(allTags, query = '', selected = [], limit = 12) {
  const q = lower(query);
  const picked = new Set(normalizeTags(selected).map(lower));
  return normalizeTags(allTags)
    .filter((tag) => !picked.has(lower(tag)) && (!q || lower(tag).includes(q)))
    .sort((a, b) => {
      const ax = lower(a).startsWith(q) ? 0 : 1;
      const bx = lower(b).startsWith(q) ? 0 : 1;
      return ax - bx || a.localeCompare(b, 'de-CH');
    })
    .slice(0, Math.max(1, Number(limit) || 12));
}

export function inferNoteClass(note = {}) {
  if (validClass(note.noteClass)) return note.noteClass;
  if (note.bookId || note.readingHubBookId) return 'reading';
  if (note.ideaId || note.linkedIdeaId || (note.linkedIdeas || []).length) return 'idea';
  if (note.cardId || note.deckId || note.flashcardId || note.lessonId || note.courseId
    || note.smarterId || note.bmId || note.examId || note.learningId) return 'learning';
  if (note.articleId || note.newsroomArticleId || note.newsroomId || note.researchId
    || note.thesisId || note.pdfId || note.browserItemId) return 'research';
  const source = typeof note.source === 'string'
    ? normalizeApp(note.source)
    : normalizeApp(note.source && note.source.app);
  const haystack = [source, note.kind, note.type, note.sourceType, note.entityType]
    .map(lower).join(' ');
  if (/reading|book|buch|lese/.test(haystack)) return 'reading';
  if (/newsroom|article|research|recherche|browser|pdf|thesis|knowledge/.test(haystack)) return 'research';
  if (/idea|idee/.test(haystack) || note.ideaId || note.linkedIdeaId || (note.linkedIdeas || []).length) return 'idea';
  if (/bmpruefung|smarter|recall|flashcard|learning|lern/.test(haystack)) return 'learning';
  if (/shortnote|quickcapture|kurz/.test(haystack) || note.isShortNote === true) return 'short';
  return 'general';
}

function legacyContext(input, noteClass) {
  if (noteClass === 'reading') {
    const entityId = input.readingHubBookId || input.bookId || input.sourceId || null;
    return { app: 'readinghub', entityType: entityId ? 'book' : null, entityId, label: input.bookTitle || input.sourceLabel || input.title || 'Reading Hub', route: entityId ? '#/readinghub/' + encodeURIComponent(entityId) : '#/readinghub' };
  }
  if (noteClass === 'idea') {
    const entityId = input.ideaId || input.linkedIdeaId || input.sourceId || null;
    return { app: 'ideas', entityType: entityId ? 'idea' : null, entityId, label: input.category || input.sourceLabel || input.title || 'Ideas', route: entityId ? '#/ideas/' + encodeURIComponent(entityId) : '#/ideas' };
  }
  if (noteClass === 'learning') {
    const recallId = input.cardId || input.flashcardId || input.deckId || null;
    const bmId = input.bmId || input.examId || null;
    const entityId = recallId || bmId || input.smarterId || input.lessonId || input.courseId || input.learningId || input.sourceId || null;
    const app = recallId ? 'recalllab' : bmId ? 'bmpruefung' : 'smarter';
    const entityType = input.cardId || input.flashcardId ? 'flashcard' : input.deckId ? 'deck' : bmId ? 'exam' : entityId ? 'learning-item' : null;
    return { app, entityType, entityId, label: input.sourceLabel || input.title || app, route: recallId ? '#/flashcards' : '#/leseplan' };
  }
  if (noteClass === 'research') {
    const entityId = input.articleId || input.newsroomArticleId || input.newsroomId || input.researchId
      || input.thesisId || input.pdfId || input.browserItemId || input.sourceId || null;
    const entityType = input.articleId || input.newsroomArticleId ? 'article'
      : input.thesisId ? 'thesis' : input.pdfId ? 'pdf' : input.browserItemId ? 'browser-item' : entityId ? 'research' : null;
    return { app: 'articles', entityType, entityId, label: input.topic || input.sourceLabel || input.title || 'Recherche', route: null };
  }
  if (noteClass === 'short') return { app: 'shortnote', entityType: 'capture', entityId: input.sourceId || null, label: 'Shortnote', route: '#/noteflow' };
  return { app: 'noteflow', entityType: input.sourceType || null, entityId: input.sourceId || null, label: input.sourceLabel || input.title || 'Noteflow', route: '#/noteflow' };
}

export function normalizeSource(source, fallback = {}) {
  const raw = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const legacy = typeof source === 'string' ? source : '';
  const app = normalizeApp(raw.app || legacy || fallback.app || 'noteflow');
  return {
    ...raw,
    app,
    entityType: text(raw.entityType || fallback.entityType) || null,
    entityId: text(raw.entityId || fallback.entityId) || null,
    label: text(raw.label || fallback.label) || app,
    route: text(raw.route || fallback.route) || null,
  };
}

export function migrateNote(note, now = new Date().toISOString()) {
  const input = note && typeof note === 'object' ? note : {};
  const noteClass = inferNoteClass(input);
  const context = legacyContext(input, noteClass);
  const source = normalizeSource(input.source, { ...context, route: input.sourceRoute || context.route });
  const rawApp = typeof input.source === 'string' ? normalizeApp(input.source, '')
    : normalizeApp(input.source && input.source.app, '');
  // Alte Clients schrieben lediglich "mobile"/"desktop". Ein konkreter
  // Legacy-Link (bookId, cardId, articleId …) ist die stärkere Information.
  if (context.app !== 'noteflow' && (!rawApp || rawApp === 'noteflow')) source.app = context.app;
  const result = {
    ...input,
    title: input.title == null ? '' : String(input.title),
    content: input.content == null ? String(input.text || '') : String(input.content),
    noteClass,
    tags: normalizeTags(input.tags),
    notebookId: input.notebookId || null,
    source,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || input.createdAt || now,
  };
  if (result.noteClass === 'idea') {
    // note.ideaStatus ist das geraeteuebergreifende Feld (Desktop-Vokabular);
    // bei Divergenz gewinnt es, sonst wird es aus ideaMeta.status gespiegelt.
    const meta = result.ideaMeta && typeof result.ideaMeta === 'object' ? result.ideaMeta : {};
    if (result.ideaStatus && ideaStatusToShared(meta.status) !== String(result.ideaStatus)) {
      result.ideaMeta = { ...meta, status: ideaStatusFromShared(result.ideaStatus) };
    } else if (meta.status && !result.ideaStatus) {
      result.ideaStatus = ideaStatusToShared(meta.status);
    }
  }
  return result;
}

function stableIdeaNoteId(ideaId) {
  return 'idea-note-' + String(ideaId || '');
}

function freeEntityId(map, preferred) {
  let id = preferred; let suffix = 2;
  while (Object.prototype.hasOwnProperty.call(map, id)) id = `${preferred}_${suffix++}`;
  return id;
}

function findIdeaNote(notes, idea, ideaId) {
  // Explizite Desktop-/Tablet-/Mobile-Referenzen sind autoritativ.
  for (const directId of [idea.centralNoteId, idea.noteId].map(text).filter(Boolean)) {
    if (notes[directId] && typeof notes[directId] === 'object') return { id: directId, note: notes[directId] };
  }
  const rawId = String(ideaId || '');
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
  for (const candidate of [...new Set([`idea-note-${rawId}`, `note_idea_${safeId}`, `idea-note-${safeId}`])]) {
    const note = notes[candidate]; if (!note || typeof note !== 'object') continue;
    const source = normalizeSource(note.source);
    const dedupe = text(note.dedupeKey);
    const dedupeIdentifiesIdea = /^ideas?:/.test(dedupe);
    const dedupeMatches = dedupe === `ideas:${ideaId}` || dedupe === `idea:${ideaId}`;
    const sourceIdentifiesIdea = source.app === 'ideas' && !!source.entityId;
    const sourceMatches = sourceIdentifiesIdea && String(source.entityId) === String(ideaId);
    const conflict = (dedupeIdentifiesIdea && !dedupeMatches) || (sourceIdentifiesIdea && !sourceMatches);
    if (!conflict && (dedupeMatches || sourceMatches || (note.noteClass === 'idea' && !dedupeIdentifiesIdea && !sourceIdentifiesIdea))) {
      return { id: candidate, note };
    }
  }
  for (const [noteId, note] of Object.entries(notes).sort(([a], [b]) => a.localeCompare(b))) {
    if (!note || typeof note !== 'object') continue;
    const source = normalizeSource(note.source);
    if (text(note.dedupeKey) === `ideas:${ideaId}` || text(note.dedupeKey) === `idea:${ideaId}`
      || (source.app === 'ideas' && String(source.entityId || '') === String(ideaId))) return { id: noteId, note };
  }
  return null;
}

function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function entityMap(value, prefix) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const output = {};
  const input = Array.isArray(value) ? value : [];
  Object.keys(input).forEach((key) => {
    const entry = input[key];
    const item = entry && typeof entry === 'object' ? { ...entry } : { value: entry };
    const rawKey = String(key);
    const keyPart = /^(0|[1-9]\d*)$/.test(rawKey)
      ? rawKey
      : (rawKey.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'key');
    const base = text(item.id) || `legacy_${prefix}_${keyPart}`;
    const id = freeEntityId(output, base);
    Object.defineProperty(output, id, {
      value: { ...item, id }, enumerable: true, writable: true, configurable: true,
    });
  });
  return output;
}

function isDeletedEntity(value) {
  return !!(value && (value.deleted || value.archived || value.status === 'deleted' || value.deletedAt));
}

/**
 * Idempotente In-place-Migration des synchronisierten Snapshots.
 * Fremde Felder bleiben erhalten, vorhandene Notizbuch-Zuordnungen ebenfalls.
 * Es wird ausdrücklich KEIN Standardnotizbuch erzeugt.
 */
export function migrateNotesData(data, now = new Date().toISOString()) {
  if (!data || typeof data !== 'object') return { changed: false, count: 0 };
  let count = 0;
  if (!data.entities || typeof data.entities !== 'object') { data.entities = {}; count++; }
  const entities = data.entities;
  for (const [name, prefix] of [['notes', 'note'], ['notebooks', 'notebook'], ['books', 'book'], ['ideas', 'idea']]) {
    const normalized = entityMap(entities[name], prefix);
    if (normalized !== entities[name]) { entities[name] = normalized; count++; }
  }

  Object.entries(entities.notes).forEach(([id, old]) => {
    if (!old || typeof old !== 'object') return;
    const next = migrateNote({ ...old, id: old.id || id }, now);
    if (!sameJson(old, next)) { entities.notes[id] = next; count++; }
  });

  // Bestehende Ideas werden einmalig in die zentrale Notes-Sammlung gehoben.
  // Die alte Entität bleibt als rückwärtskompatibler Verweis bestehen; Text
  // und Kategorie werden danach ausschließlich an der Notiz bearbeitet.
  const ideas = entities.ideas && typeof entities.ideas === 'object' ? entities.ideas : {};
  Object.entries(ideas).forEach(([ideaKey, idea]) => {
    if (!idea || isDeletedEntity(idea)) return;
    const ideaId = idea.id || ideaKey;
    const dedupeKey = `ideas:${ideaId}`;
    const linked = findIdeaNote(entities.notes, idea, ideaId);
    const noteId = linked ? linked.id : freeEntityId(entities.notes, stableIdeaNoteId(ideaId));
    const category = text(idea.category) || normalizeTags(idea.tags)[0] || 'Unkategorisiert';
    if (!linked) {
      entities.notes[noteId] = migrateNote({
        ...idea,
        id: noteId,
        title: idea.title || String(idea.text || idea.content || '').slice(0, 72),
        content: idea.text || idea.content || idea.title || '',
        noteClass: 'idea',
        category,
        tags: normalizeTags([category, ...(Array.isArray(idea.tags) ? idea.tags : [])]),
        notebookId: null,
        dedupeKey,
        ideaStatus: ideaStatusToShared(idea.status || 'idea'),
        ideaMeta: {
          status: idea.status || 'idea', rating: idea.rating, score: idea.score,
          convertedTo: idea.convertedTo,
        },
        source: { app: 'ideas', entityType: 'idea', entityId: ideaId, label: category, route: '#/ideas/' + encodeURIComponent(ideaId) },
      }, now);
      count++;
    } else {
      // Inhalt/Titel bleiben die zentrale Wahrheit der gefundenen Notiz. Nur
      // die geräteübergreifenden Identitätsfelder werden vereinheitlicht.
      const old = linked.note;
      const source = normalizeSource(old.source, {
        app: 'ideas', entityType: 'idea', entityId: ideaId, label: category, route: '#/ideas/' + encodeURIComponent(ideaId),
      });
      const next = migrateNote({
        ...old,
        id: noteId,
        noteClass: 'idea',
        tags: normalizeTags((old.tags && old.tags.length) ? old.tags : [category]),
        dedupeKey,
        source: {
          ...source, app: 'ideas', entityType: source.entityType || 'idea', entityId: String(ideaId),
          label: text(old.source && old.source.label) || category,
          route: source.route || '#/ideas/' + encodeURIComponent(ideaId),
        },
      }, now);
      if (!sameJson(old, next)) { entities.notes[noteId] = next; count++; }
    }
    if (idea.noteId !== noteId) { idea.noteId = noteId; count++; }
    if (idea.centralNoteId !== noteId) { idea.centralNoteId = noteId; count++; }
  });

  // Legacy-Shadow des Reading Hubs verlustfrei in die kanonische Map heben.
  const legacyBooks = data._readingHubBooks && Array.isArray(data._readingHubBooks.books)
    ? data._readingHubBooks.books : [];
  legacyBooks.forEach((book, index) => {
    if (!book || !text(book.title)) return;
    const id = book.id || `book_legacy_${index}`;
    if (!entities.books[id]) { entities.books[id] = { ...book, id }; count++; }
  });
  Object.entries(entities.books).forEach(([key, old]) => {
    if (!old || typeof old !== 'object') return;
    const next = {
      ...old,
      id: old.id || key,
      status: bookStatus(old.status),
      // Desktop und Tablet verwenden totalPages. pageCount bleibt als
      // unbekanntes Legacy-Feld erhalten, wird aber einmalig überführt.
      totalPages: old.totalPages == null ? (old.pageCount == null ? null : Number(old.pageCount)) : Number(old.totalPages),
    };
    if (!sameJson(old, next)) { entities.books[key] = next; count++; }
  });

  return { changed: count > 0, count };
}

export function createCanonicalNote(input, { id, now = new Date().toISOString(), knownTags = [] } = {}) {
  const noteClass = validClass(input && input.noteClass) ? input.noteClass : 'general';
  const source = normalizeSource(input && input.source, { app: 'noteflow', label: 'Noteflow', route: '#/noteflow' });
  if (noteClass === 'general' && source.app !== 'noteflow') {
    throw new Error('Generelle Notizen können nur direkt in Noteflow erstellt werden.');
  }
  const content = String((input && input.content) || '').trim();
  const tags = normalizeTags(input && input.tags, knownTags);
  if (!content) throw new Error('Inhalt fehlt.');
  if (noteClass === 'idea' && !tags.length) throw new Error('Für eine Idee ist eine Kategorie erforderlich.');
  if (noteClass === 'short' && !tags.length) throw new Error('Für eine kurze Notiz ist ein Schlagwort erforderlich.');
  if (['reading', 'learning', 'research'].includes(noteClass) && source.app !== 'noteflow' && !tags.length) {
    throw new Error('Für diese Notiz ist ein Kontext-Schlagwort erforderlich.');
  }
  const note = {
    ...(input || {}),
    id: (input && input.id) || id,
    title: text(input && input.title) || content.replace(/\s+/g, ' ').slice(0, 72),
    content,
    noteClass,
    tags,
    notebookId: (input && input.notebookId) || null,
    source,
    createdAt: (input && input.createdAt) || now,
    updatedAt: now,
  };
  if (!note.id) throw new Error('Stabile Notiz-ID fehlt.');
  return note;
}

export function noteSourceMatches(note, app, entityId) {
  const source = note && typeof note.source === 'object' ? note.source : null;
  return !!source && normalizeApp(source.app) === normalizeApp(app)
    && String(source.entityId || '') === String(entityId || '');
}

export function bookStatus(value) {
  const v = lower(value);
  if (['reading', 'lese-ich', 'lese ich', 'aktiv'].includes(v)) return 'reading';
  if (['paused', 'pausiert', 'pause'].includes(v)) return 'paused';
  if (['completed', 'read', 'gelesen', 'fertig', 'done'].includes(v)) return 'completed';
  if (['abandoned', 'abgebrochen', 'dropped'].includes(v)) return 'abandoned';
  return 'registered';
}

export const BOOK_STATUS_LABELS = Object.freeze({
  registered: 'Registriert/ungelesen', reading: 'Lese ich', paused: 'Pausiert',
  completed: 'Gelesen', abandoned: 'Abgebrochen',
});
