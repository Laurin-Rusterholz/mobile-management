import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOTE_CLASSES, NOTE_CLASS_KEYS, normalizeTags, tagSuggestions, inferNoteClass,
  migrateNotesData, createCanonicalNote, bookStatus, normalizeSource,
} from '../js/notes.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let checks = 0;
function ok(value, message) { checks++; assert.ok(value, message); }
function eq(actual, expected, message) { checks++; assert.deepEqual(actual, expected, message); }

// Sechs verbindliche Klassen und exakt die deutschen Oberflächenlabels.
eq(NOTE_CLASS_KEYS, ['reading', 'learning', 'idea', 'general', 'short', 'research']);
eq(Object.values(NOTE_CLASSES), ['Lesenotiz', 'Lernnotiz', 'Idee', 'Generelle Notiz', 'Kurze Notiz', 'Recherchenotiz']);

// Tags: trimmen, leere entfernen, case-insensitive deduplizieren und die
// Schreibweise aus dem Gesamtbestand bewahren.
eq(normalizeTags([' politik ', 'POLITIK', '', 'KI'], ['Politik', 'AI']), ['Politik', 'KI']);
eq(tagSuggestions(['Politik', 'Buchtitel', 'Innenpolitik', 'KI'], 'pol', []), ['Politik', 'Innenpolitik']);
eq(tagSuggestions(['Politik', 'politik', 'KI'], 'p', ['POLITIK']), []);

const baseSource = { app: 'noteflow', entityType: null, entityId: null, label: 'Noteflow', route: '#/noteflow' };
for (const noteClass of NOTE_CLASS_KEYS) {
  const tags = ['idea', 'short'].includes(noteClass) ? ['Kategorie'] : [];
  const note = createCanonicalNote({ noteClass, content: 'Testinhalt', tags, source: baseSource }, { id: 'n_' + noteClass, now: '2026-08-29T10:00:00.000Z' });
  ok(note.noteClass === noteClass, `${noteClass} wird nicht geschrieben`);
  ok(note.notebookId === null, `${noteClass} landet nicht in der Inbox`);
}
assert.throws(() => createCanonicalNote({ noteClass: 'general', content: 'x', source: { app: 'projects' } }, { id: 'bad' }), /nur direkt in Noteflow/); checks++;
assert.throws(() => createCanonicalNote({ noteClass: 'idea', content: 'x', source: { app: 'ideas' } }, { id: 'bad2' }), /Kategorie/); checks++;
assert.throws(() => createCanonicalNote({ noteClass: 'short', content: 'x', source: { app: 'shortnote' } }, { id: 'bad3' }), /Schlagwort/); checks++;

// Alte Quellen werden nachvollziehbar klassifiziert.
eq(inferNoteClass({ source: 'readinghub' }), 'reading');
eq(inferNoteClass({ source: 'newsroom' }), 'research');
eq(inferNoteClass({ source: 'ideas' }), 'idea');
eq(inferNoteClass({ source: 'bm-vorbereitung' }), 'learning');
eq(inferNoteClass({ source: 'shortnote' }), 'short');
eq(inferNoteClass({ source: 'mobile' }), 'general');
eq(normalizeSource('desktop').app, 'noteflow', 'Legacy-Desktop-Notizen bleiben als generelle Notizen bearbeitbar');
eq(normalizeSource('newsroom').app, 'articles', 'Legacy-Newsroom-Quelle verwendet nicht den geräteübergreifenden articles-App-Key');

const data = {
  entities: {
    notes: {
      a: { id: 'a', title: 'Alt', content: 'Text', source: 'readinghub', notebookId: 'keep-me', tags: ['Buch'] },
    },
    ideas: {
      i1: { id: 'i1', title: 'Newsletter', text: 'Wöchentliche Analyse', category: 'Journalismus', rating: 5 },
    },
    notebooks: { 'keep-me': { id: 'keep-me', title: 'Bestand' } },
  },
  _readingHubBooks: { books: [{ id: 'b1', title: 'The Status Game', status: 'unread', pageCount: 312, annotations: [{ id: 'x' }] }] },
};
const first = migrateNotesData(data, '2026-08-29T10:00:00.000Z');
ok(first.changed, 'Erstmigration meldet keine Änderung');
ok(data.entities.notes.a.noteClass === 'reading', 'alte Lesenotiz wird nicht klassifiziert');
ok(data.entities.notes.a.notebookId === 'keep-me', 'bestehendes Notizbuch geht verloren');
ok(data.entities.notes.a.source.app === 'readinghub', 'String-Quelle wird nicht kompatibel normalisiert');
ok(data.entities.notes['idea-note-i1'].noteClass === 'idea', 'Legacy-Idee wird nicht zentral');
eq(data.entities.notes['idea-note-i1'].tags, ['Journalismus']);
ok(data.entities.ideas.i1.noteId === 'idea-note-i1', 'Legacy-Idee erhält keinen stabilen noteId-Rückverweis');
ok(data.entities.ideas.i1.centralNoteId === 'idea-note-i1', 'Legacy-Idee erhält keinen Desktop-kompatiblen centralNoteId-Rückverweis');
ok(data.entities.books.b1.title === 'The Status Game', 'Reading-Hub-Shadow wird nicht in entities.books gehoben');
ok(data.entities.books.b1.status === 'registered', 'Legacy-Buchstatus wird nicht kanonisch normalisiert');
ok(data.entities.books.b1.totalPages === 312, 'Legacy-Seitenzahl wird nicht in den geräteübergreifenden totalPages-Vertrag überführt');
ok(Array.isArray(data.entities.books.b1.annotations), 'Buchannotation geht bei Migration verloren');
const snapshot = JSON.stringify(data);
const second = migrateNotesData(data, '2026-08-30T10:00:00.000Z');
ok(!second.changed && second.count === 0, 'Migration ist beim zweiten Lauf nicht idempotent');
ok(JSON.stringify(data) === snapshot, 'zweiter Lauf verändert den Bestand');

// Cross-Repo-Ideenbridge: Desktop-ID, bestehende Mobile-ID und eine zufällig
// belegte Konventions-ID dürfen weder umbenannt noch dupliziert werden.
const desktopIdea = { entities: { notes: {
  'idea-note-i2': { id: 'idea-note-i2', noteClass: 'idea', title: 'Desktop', content: 'KEEP', tags: ['Medien'], notebookId: null,
    dedupeKey: 'ideas:i2', source: { app: 'ideas', entityType: 'idea', entityId: 'i2', label: 'Medien', route: '#/ideas' },
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' },
}, ideas: { i2: { id: 'i2', centralNoteId: 'idea-note-i2', title: 'Legacy Desktop', text: 'NICHT ÜBERSCHREIBEN' } } } };
migrateNotesData(desktopIdea, '2026-08-29T10:00:00.000Z');
eq(Object.keys(desktopIdea.entities.notes), ['idea-note-i2'], 'Desktop-Idee wird als zweite Notiz dupliziert');
eq(desktopIdea.entities.notes['idea-note-i2'].content, 'KEEP', 'Legacy-Text überschreibt die zentrale Desktop-Notiz');
eq([desktopIdea.entities.ideas.i2.noteId, desktopIdea.entities.ideas.i2.centralNoteId], ['idea-note-i2', 'idea-note-i2']);

const mobileIdea = { entities: { notes: {
  note_idea_i3: { id: 'note_idea_i3', noteClass: 'idea', title: 'Mobile', content: 'Bestehend', tags: ['Produkt'], notebookId: null,
    dedupeKey: 'ideas:i3', source: { app: 'ideas', entityType: 'idea', entityId: 'i3', label: 'Produkt', route: '#/ideen' },
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' },
}, ideas: { i3: { id: 'i3', title: 'Mobile Legacy', text: 'Alt' } } } };
migrateNotesData(mobileIdea, '2026-08-29T10:00:00.000Z');
eq(Object.keys(mobileIdea.entities.notes), ['note_idea_i3'], 'bestehende note_idea-ID wird umbenannt oder dupliziert');
eq([mobileIdea.entities.ideas.i3.noteId, mobileIdea.entities.ideas.i3.centralNoteId], ['note_idea_i3', 'note_idea_i3']);

const occupiedIdea = { entities: { notes: {
  'idea-note-i4': { id: 'idea-note-i4', noteClass: 'general', title: 'Fremd', content: 'Nicht überschreiben', tags: [], notebookId: null,
    source: { app: 'noteflow', label: 'Noteflow' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' },
}, ideas: { i4: { id: 'i4', title: 'Echte Idee', text: 'Ideeninhalt', category: 'Produkt' } } } };
migrateNotesData(occupiedIdea, '2026-08-29T10:00:00.000Z');
eq(occupiedIdea.entities.notes['idea-note-i4'].content, 'Nicht überschreiben', 'belegte Konventions-ID überschreibt eine fremde Notiz');
ok(occupiedIdea.entities.notes['idea-note-i4_2'].content === 'Ideeninhalt', 'Kollision erhält keine freie deterministische Ideen-ID');
eq([occupiedIdea.entities.ideas.i4.noteId, occupiedIdea.entities.ideas.i4.centralNoteId], ['idea-note-i4_2', 'idea-note-i4_2']);

const arrayLegacy = { entities: {
  notes: [
    { id: 'dup', title: 'First', content: 'First', source: 'mobile', updatedAt: '2026-08-01T00:00:00.000Z' },
    { id: 'dup', title: 'Second', content: 'Second', source: 'mobile', bookId: 'book-1', bookTitle: 'Buch Eins', updatedAt: '2026-08-02T00:00:00.000Z' },
    { id: 'research', content: 'Fund', source: 'mobile', articleId: 'article-1', topic: 'Medien' },
    { id: 'newsroom', content: 'Artikel', source: 'newsroom' },
    { id: 'learn', content: 'Karte', source: 'mobile', cardId: 'card-1' },
    { id: 'bm', content: 'Prüfung', source: 'bm-vorbereitung' },
    { id: 'smarter', content: 'Lektion', source: 'mobile', smarterId: 'lesson-1' },
    { id: 'idea-link', content: 'Idee', source: 'mobile', ideaId: 'legacy-idea' },
    { id: 'quick', content: 'Kurz', source: 'mobile', isShortNote: true },
  ],
  books: [{ id: 'book-1', title: 'First Book' }, { id: 'book-1', title: 'Second Book' }],
  ideas: [{ id: 'array-idea', text: 'Array-Idee', category: 'Produkt' }],
  notebooks: [{ id: 'nb', title: 'First Notebook' }, { id: 'nb', title: 'Second Notebook' }],
} };
arrayLegacy.entities.notes.push({ id: '__proto__', content: 'Reserved note', source: 'mobile' });
arrayLegacy.entities.notebooks.push({ id: '__proto__', title: 'Reserved notebook' });
arrayLegacy.entities.books.push({ id: '__proto__', title: 'Reserved book' });
arrayLegacy.entities.ideas.push({ id: '__proto__', text: 'Reserved idea', category: 'System' });
arrayLegacy.entities.notes[14] = { content: 'Sparse note', source: 'mobile' };
arrayLegacy.entities.notes['custom tag'] = { content: 'String-key note', source: 'mobile' };
migrateNotesData(arrayLegacy, '2026-08-29T10:00:00.000Z');
eq(Object.keys(arrayLegacy.entities.notes).filter((id) => id.startsWith('dup')), ['dup', 'dup_2'], 'doppelte Notiz-IDs gehen bei Array→Map verloren');
eq([arrayLegacy.entities.notes.dup.content, arrayLegacy.entities.notes.dup_2.content], ['First', 'Second']);
eq(Object.keys(arrayLegacy.entities.books).filter((id) => id.startsWith('book-1')), ['book-1', 'book-1_2'], 'doppelte Buch-IDs gehen bei Array→Map verloren');
eq([arrayLegacy.entities.books['book-1'].title, arrayLegacy.entities.books['book-1_2'].title], ['First Book', 'Second Book']);
eq(Object.keys(arrayLegacy.entities.notebooks).filter((id) => id.startsWith('nb')), ['nb', 'nb_2'], 'doppelte Notizbuch-IDs gehen bei Array→Map verloren');
ok(!Array.isArray(arrayLegacy.entities.ideas) && arrayLegacy.entities.ideas['array-idea'], 'Ideas-Array wird nicht verlustfrei normalisiert');
for (const name of ['notes', 'notebooks', 'books', 'ideas']) {
  ok(Object.prototype.hasOwnProperty.call(arrayLegacy.entities[name], '__proto__'), `${name}: reservierte ID geht verloren`);
}
ok(Object.getPrototypeOf(arrayLegacy.entities.notes) === Object.prototype, 'reservierte ID polluiert den Map-Prototyp');
ok(arrayLegacy.entities.notes.legacy_note_14.content === 'Sparse note', 'sparse Array-Position geht verloren');
ok(arrayLegacy.entities.notes.legacy_note_custom_tag.content === 'String-key note', 'enumerable String-Property geht verloren');
ok(arrayLegacy.entities.notes.dup_2.noteClass === 'reading' && arrayLegacy.entities.notes.dup_2.source.app === 'readinghub'
  && arrayLegacy.entities.notes.dup_2.source.entityId === 'book-1', 'bookId wird nicht als Reading-Hub-Kontext migriert');
ok(arrayLegacy.entities.notes.research.noteClass === 'research' && arrayLegacy.entities.notes.research.source.app === 'articles', 'articleId wird nicht als articles-Recherche migriert');
ok(arrayLegacy.entities.notes.newsroom.noteClass === 'research' && arrayLegacy.entities.notes.newsroom.source.app === 'articles', 'Newsroom wird nicht als articles-Recherche migriert');
ok(arrayLegacy.entities.notes.learn.noteClass === 'learning' && arrayLegacy.entities.notes.learn.source.app === 'recalllab', 'cardId wird nicht als Recall-Lernnotiz migriert');
ok(arrayLegacy.entities.notes.bm.noteClass === 'learning' && arrayLegacy.entities.notes.bm.source.app === 'bmpruefung', 'BM-Quelle wird nicht als Lernnotiz migriert');
ok(arrayLegacy.entities.notes.smarter.noteClass === 'learning' && arrayLegacy.entities.notes.smarter.source.app === 'smarter', 'Smarter-Link wird nicht als Lernnotiz migriert');
ok(arrayLegacy.entities.notes['idea-link'].noteClass === 'idea' && arrayLegacy.entities.notes['idea-link'].source.app === 'ideas', 'ideaId wird nicht als Ideas-Notiz migriert');
ok(arrayLegacy.entities.notes.quick.noteClass === 'short' && arrayLegacy.entities.notes.quick.source.app === 'shortnote', 'isShortNote wird nicht als Shortnote migriert');
const arraySnapshot = JSON.stringify(arrayLegacy);
const arrayAgain = migrateNotesData(arrayLegacy, '2026-08-30T10:00:00.000Z');
ok(!arrayAgain.changed && JSON.stringify(arrayLegacy) === arraySnapshot, 'lossless Array-Migration ist nicht idempotent');

const deletedIdeaPayload = { entities: { notes: {}, notebooks: {}, books: {}, ideas: {
  mobile: { id: 'mobile', text: 'weg', deleted: true },
  tablet: { id: 'tablet', text: 'weg', status: 'deleted', deletedAt: '2026-08-29T10:00:00.000Z' },
  archived: { id: 'archived', text: 'weg', archived: true },
} } };
migrateNotesData(deletedIdeaPayload, '2026-08-29T11:00:00.000Z');
eq(Object.keys(deletedIdeaPayload.entities.notes), [], 'gelöschte Idea-Shadows werden als zentrale Notizen wiederbelebt');

eq(['new', 'unread', 'registriert'].map(bookStatus), ['registered', 'registered', 'registered']);
eq(['reading', 'pausiert', 'read', 'done', 'abgebrochen'].map(bookStatus), ['reading', 'paused', 'completed', 'completed', 'abandoned']);

// Integrationswächter für die mobile Oberfläche.
const ui = source('js/note-ui.js');
ok(/data-mode="note"/.test(ui) && /data-mode="message"/.test(ui), 'Shortnote trennt Notiz und Mitteilung nicht');
ok(/type: 'add-message'/.test(ui) && /deliverAt: deliver\.toISOString\(\)/.test(ui), 'Mitteilung wird nicht im geplanten Nachrichtensystem gespeichert');
ok(/noteClass: 'short'/.test(ui) && /Schlagwortkategorie/.test(ui), 'Shortnote-Notiz fehlt oder verlangt keine Kategorie');
ok(/new Date\(raw\)/.test(ui) && /Date\.now\(\)/.test(ui), 'Zustellzeitpunkt wird nicht validiert');

const reading = source('js/views/readinghub.js');
const registerBlock = reading.slice(reading.indexOf('data-book-register'), reading.indexOf('onMount(root)', reading.indexOf('data-book-register')));
ok((registerBlock.match(/<input/g) || []).length === 1 && /name="title" required/.test(registerBlock), 'Titel-only-Registrierung verlangt weitere Felder');
ok(/noteClass: 'reading'/.test(reading) && /lockedTags: \[book\.title\]/.test(reading), 'Lesenotiz erhält Buchtitel/Quelle nicht');
ok(/type: 'update-book'/.test(reading), 'Buchmetadaten lassen sich später nicht ergänzen');
ok(/name="totalPages"/.test(reading) && !/name="pageCount"/.test(reading), 'Reading Hub verwendet nicht die gemeinsame totalPages-Seitenzahl');

const ideas = source('js/views/ideen.js');
ok(/getIdeaNotes\(\)/.test(ideas), 'Ideas liest nicht aus der kanonischen Notes-Sammlung');
ok(!/type: 'add-idea'/.test(ideas), 'Ideas erzeugt weiterhin eine zweite bearbeitbare Entität');

for (const file of ['js/search.js', 'js/views/uebersicht.js', 'js/views/statistik.js', 'js/views/einstellungen.js']) {
  const consumer = source(file);
  ok(consumer.includes('getIdeaNotes()') && !consumer.includes('getIdeas()'), `${file} liest Ideas nicht ausschließlich aus zentralen Notizen`);
}
const search = source('js/search.js');
ok(/getNotes\(\)\.filter\(n => n\.noteClass !== 'idea'\)/.test(search), 'globale Suche zeigt dieselbe Idee in Notes und Ideas doppelt');
const inbox = source('js/views/inbox.js');
ok(/type: 'update-note'/.test(inbox) && /ideaMeta/.test(inbox) && !/type: 'update-idea'/.test(inbox), 'Inbox aktualisiert weiterhin die Legacy-Idee');
const pinnboard = source('js/views/pinnboard.js');
ok(/logicalBoardKey/.test(pinnboard) && /seen\.has\(logicalKey\)/.test(pinnboard), 'Pinnboard dedupliziert migrierte Ideas-Boards nicht');

const noteflow = source('js/views/noteflow.js');
for (const needle of ['Inbox', 'Favoriten', 'Zuletzt bearbeitet', 'Alle Klassen', 'Notizbuch', 'Schlagwort', 'Quelle/App']) {
  ok(noteflow.includes(needle), `Noteflow-Filter fehlt: ${needle}`);
}
ok(/escHTML\(String\(note\.content/.test(noteflow), 'Notizinhalt wird nicht XSS-sicher dargestellt');

const integrations = [
  ['js/views/collection.js', 'coll-note'], ['js/views/planen.js', 'entity-note'],
  ['js/views/meetings.js', 'meeting-note'], ['js/views/leseplan.js', 'lp-learning-note'],
  ['js/views/flashcards.js', 'fc-note'], ['js/views/pinnboard.js', 'pb-export'],
  ['js/views/briefing.js', 'bf-export-note'], ['js/views/journal.js', 'journal-note'],
  ['js/views/mail.js', 'mail-note'], ['js/views/kalender.js', 'cal-note'],
  ['js/views/career.js', 'cm-note'], ['js/views/gewohnheiten.js', 'habit-note'],
  ['js/views/fokus.js', 'focus-note'], ['js/views/polaris.js', 'polaris-note'],
  ['js/views/flowertech.js', 'ft-project-note'],
];
for (const [file, action] of integrations) ok(source(file).includes(action), `${file} hat keine kontextuelle Notizaktion`);

const sw = source('sw.js');
for (const file of ['./js/notes.js', './js/note-ui.js', './js/views/readinghub.js']) ok(sw.includes(file), `${file} fehlt im Offline-App-Shell`);

const storeSource = source('js/store.js');
const conflictBlock = storeSource.slice(storeSource.indexOf("if (r.status === 412)"), storeSource.indexOf("if (!r.ok)", storeSource.indexOf("if (r.status === 412)")));
ok(conflictBlock.includes('savePending()') && conflictBlock.indexOf('savePending()') < conflictBlock.indexOf('pullData(true)'), 'Lokale Notizänderungen gehen bei einem ETag-Konflikt verloren');
ok(!/export const getIdeas\s*=/.test(storeSource), 'Legacy-getIdeas bleibt als versehentlicher UI-Schreib-/Leseweg exportiert');

console.log(`Notizkonzept: ok (${checks} Prüfungen)`);
