// ============================================================================
//  Quantus Mobile — „Neu erstellen" Formulare
//  Erzeugt jeden Konzept-Inhaltstyp und schreibt ihn über performOp in den
//  bestehenden Quantus-Blob (bzw. Sonderpfade für Gewohnheit/Flashcard/Fokus).
// ============================================================================
import { openSheet, closeSheet, newId, nowISO, todayYmd, toast, escHTML } from './util.js';
import { performOp } from './store.js';
import { getProjects, getDecks } from './store.js';
import { registerActions } from './actions.js';
import { navigate } from './router.js';
import * as focus from './focus.js';

function field(label, inner) { return `<label class="f"><span class="f-label">${label}</span>${inner}</label>`; }

const FORMS = {
  task: () => ({
    title: 'Neue Aufgabe', icon: '✅',
    body: `<form data-action="submit-new" data-type="task" class="form">
      ${field('Titel', `<input name="title" class="input" required autocomplete="off" placeholder="Was ist zu tun?">`)}
      ${field('Beschreibung', `<textarea name="description" class="input" rows="2" placeholder="Optional"></textarea>`)}
      <div class="f-row">
        ${field('Fällig', `<input name="dueDate" type="date" class="input">`)}
        ${field('Priorität', `<select name="priority" class="input"><option value="3">Normal</option><option value="1">Hoch</option><option value="2">Mittel</option><option value="4">Niedrig</option></select>`)}
      </div>
      ${field('Projekt', `<select name="projectId" class="input"><option value="">— keins —</option>${getProjects().map(p => `<option value="${p.id}">${escHTML(p.title || 'Projekt')}</option>`).join('')}</select>`)}
      <button class="btn primary block" type="submit">Aufgabe erstellen</button>
    </form>`,
  }),
  project: () => ({
    title: 'Neues Projekt', icon: '📦',
    body: `<form data-action="submit-new" data-type="project" class="form">
      ${field('Titel', `<input name="title" class="input" required placeholder="Projektname">`)}
      ${field('Beschreibung', `<textarea name="description" class="input" rows="2"></textarea>`)}
      ${field('Status', `<select name="status" class="input"><option value="active">Aktiv</option><option value="planned">Geplant</option><option value="onhold">Pausiert</option></select>`)}
      <button class="btn primary block" type="submit">Projekt erstellen</button>
    </form>`,
  }),
  idea: () => ({
    title: 'Neue Idee', icon: '💡',
    body: `<form data-action="submit-new" data-type="idea" class="form">
      ${field('Titel', `<input name="title" class="input" required placeholder="Der Funke…">`)}
      ${field('Text', `<textarea name="text" class="input" rows="3" placeholder="Ausführen…"></textarea>`)}
      <button class="btn primary block" type="submit">Idee festhalten</button>
    </form>`,
  }),
  note: () => ({
    title: 'Neue Notiz', icon: '📝',
    body: `<form data-action="submit-new" data-type="note" class="form">
      ${field('Titel', `<input name="title" class="input" placeholder="Titel (optional)">`)}
      ${field('Inhalt', `<textarea name="content" class="input" rows="5" required placeholder="Schreib los…"></textarea>`)}
      <button class="btn primary block" type="submit">Notiz speichern</button>
    </form>`,
  }),
  expense: () => ({
    title: 'Neue Ausgabe', icon: '💸',
    body: `<form data-action="submit-new" data-type="expense" class="form">
      ${field('Betrag', `<input name="amount" type="number" step="0.05" class="input" required placeholder="0.00" inputmode="decimal">`)}
      ${field('Beschreibung', `<input name="description" class="input" placeholder="Wofür?">`)}
      <div class="f-row">
        ${field('Kategorie', `<input name="category" class="input" placeholder="z.B. Essen" value="Sonstiges">`)}
        ${field('Datum', `<input name="date" type="date" class="input" value="${todayYmd()}">`)}
      </div>
      ${field('Typ', `<select name="type" class="input"><option value="expense">Ausgabe</option><option value="income">Einnahme</option></select>`)}
      <button class="btn primary block" type="submit">Buchung speichern</button>
    </form>`,
  }),
  habit: () => ({
    title: 'Neue Gewohnheit', icon: '🔁',
    body: `<form data-action="submit-new" data-type="habit" class="form">
      ${field('Name', `<input name="text" class="input" required placeholder="z.B. 10 Min lesen">`)}
      <div class="f-row">
        ${field('Icon', `<input name="icon" class="input" value="✅" maxlength="2">`)}
        ${field('Rhythmus', `<select name="frequency" class="input"><option value="daily">Täglich</option><option value="weekdays">Wochentags</option><option value="weekly">Wöchentlich</option><option value="custom">Frei</option></select>`)}
      </div>
      ${field('Zielwert (messbar, optional)', `<input name="target" type="number" min="1" class="input" value="1">`)}
      <button class="btn primary block" type="submit">Gewohnheit anlegen</button>
    </form>`,
  }),
  flashcard: () => ({
    title: 'Neue Flashcard', icon: '🎴',
    body: `<form data-action="submit-new" data-type="flashcard" class="form">
      ${field('Deck', `<select name="deckId" class="input">${getDecks().length ? getDecks().map(d => `<option value="${d.id}">${escHTML(d.name || 'Deck')}</option>`).join('') : '<option value="">Standard-Deck (wird erstellt)</option>'}</select>`)}
      ${field('Vorderseite (Frage)', `<textarea name="front" class="input" rows="2" required></textarea>`)}
      ${field('Rückseite (Antwort)', `<textarea name="back" class="input" rows="2" required></textarea>`)}
      <button class="btn primary block" type="submit">Karte hinzufügen</button>
    </form>`,
  }),
};

export function openNewType(type) {
  if (type === 'focus') { closeSheet(); navigate('fokus'); toast('Fokus-Setup geöffnet', 'ok'); return; }
  const build = FORMS[type];
  if (!build) { toast('Typ „' + type + '" (bald)', 'warn'); return; }
  const f = build();
  openSheet({ title: f.title, size: 'half', body: f.body });
}

// ── Submit-Handler ──
function formData(elForm) {
  const fd = new FormData(elForm);
  const o = {};
  fd.forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
  return o;
}

registerActions({
  'submit-new': async (d, elTrigger, e) => {
    const form = e.target.closest('form');
    const v = formData(form);
    const type = d.type;
    const now = nowISO();
    let op = null, routeTo = null;

    if (type === 'task') {
      op = { type: 'add-task', payload: { id: newId('task'), title: v.title, description: v.description || '', status: 'todo', priority: Number(v.priority || 3), dueDate: v.dueDate || '', projectId: v.projectId || '', tags: [], source: 'mobile', createdAt: now, updatedAt: now } };
      routeTo = 'planen';
    } else if (type === 'project') {
      op = { type: 'add-project', payload: { id: newId('project'), title: v.title, description: v.description || '', status: v.status || 'active', priority: 3, tags: [], source: 'mobile', createdAt: now, updatedAt: now } };
      routeTo = 'planen';
    } else if (type === 'idea') {
      op = { type: 'add-idea', payload: { id: newId('idea'), title: v.title, text: v.text || '', status: 'idea', tags: [], source: 'mobile', createdAt: now, updatedAt: now } };
      routeTo = 'ideen';
    } else if (type === 'note') {
      op = { type: 'add-note', payload: { id: newId('note'), title: v.title || '', content: v.content || '', notebookId: null, tags: [], source: 'mobile', createdAt: now, updatedAt: now } };
      routeTo = 'noteflow';
    } else if (type === 'expense') {
      const amt = Math.abs(Number(v.amount || 0));
      op = { type: 'add-transaction', payload: { id: newId('txn'), amount: v.type === 'income' ? amt : -amt, type: v.type || 'expense', category: v.category || 'Sonstiges', description: v.description || '', date: v.date || todayYmd(), tags: [], source: 'mobile', createdAt: now, updatedAt: now } };
      routeTo = 'budget';
    } else if (type === 'habit') {
      op = { type: 'add-habit', payload: { id: 'rt_' + newId('h').split('_')[1], text: v.text, icon: v.icon || '✅', color: '#a78bfa', frequency: v.frequency || 'daily', target: Number(v.target || 1), unit: '', archived: false, completions: [], source: 'mobile', createdAt: now } };
      routeTo = 'gewohnheiten';
    } else if (type === 'flashcard') {
      // Ggf. Standard-Deck anlegen
      let deckId = v.deckId;
      if (!deckId) {
        deckId = newId('deck');
        await performOp({ type: 'add-deck', payload: { id: deckId, name: 'Mobile', description: 'Auf dem Handy erstellt', createdAt: Date.now() } });
      }
      op = { type: 'add-flashcard', payload: { id: newId('card'), deckId, front: v.front, back: v.back, reversible: true, cardType: 'basic', tags: [], srs: null, createdAt: Date.now() } };
      routeTo = 'flashcards';
    }

    if (op) {
      await performOp(op);
      closeSheet();
      toast('Erstellt ✓', 'ok');
      if (routeTo) navigate(routeTo);
    }
  },
});

export { focus };
