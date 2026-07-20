// ============================================================================
//  Flashcards — Decks, Lernmodus, Spaced Repetition, heute fällige Karten
//  Sonderpfad: data.recallLabData { decks, cards }
//  KI-Vorschläge müssen vor dem Speichern bestätigt werden (confirmPreview).
// ============================================================================
import { escHTML, toast } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader } from './common.js';

// SM-2-artige Planung (kompatibel zum RecallLab-srs-Schema)
function schedule(card, grade) {
  const s = card.srs || { ease: 2.5, intervalDays: 0, repetitions: 0, phase: 'new', step: 0, lapses: 0 };
  let { ease, intervalDays, repetitions, lapses } = s;
  ease = ease || 2.5;
  if (grade < 3) { repetitions = 0; intervalDays = 1; lapses = (lapses || 0) + 1; }
  else {
    repetitions = (repetitions || 0) + 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round((intervalDays || 1) * ease);
    ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  }
  return { ease, intervalDays, repetitions, lapses: lapses || 0, phase: grade < 3 ? 'relearning' : 'review', step: s.step || 0, nextReview: Date.now() + intervalDays * 86400000 };
}

let _learn = null; // { queue:[ids], idx, revealed }

registerActions({
  'fc-learn': (d) => {
    const deckId = d.deck || '';
    const due = store.getDueCards().filter(c => !deckId || c.deckId === deckId).map(c => c.id);
    if (!due.length) { toast('Keine fälligen Karten', 'ok'); return; }
    _learn = { queue: due, idx: 0, revealed: false };
    navigate('flashcards', { sub: 'learn' });
  },
  'fc-reveal': () => { if (_learn) { _learn.revealed = true; navigate('flashcards', { sub: 'learn' }); } },
  'fc-grade': async (d) => {
    if (!_learn) return;
    const id = _learn.queue[_learn.idx];
    const card = store.getCards().find(c => c.id === id);
    if (card) await store.performOp({ type: 'review-flashcard', payload: { id, srs: schedule(card, Number(d.g)) } });
    _learn.idx++; _learn.revealed = false;
    if (_learn.idx >= _learn.queue.length) { _learn = null; toast('Runde fertig 🎉', 'ok'); navigate('flashcards'); }
    else navigate('flashcards', { sub: 'learn' });
  },
  'fc-exit': () => { _learn = null; navigate('flashcards'); },
});

function learnView() {
  if (!_learn) return `<div class="pad"><div class="empty"><div class="empty-icon">🎴</div><div class="empty-sub">Keine Lernsitzung aktiv.</div></div></div>`;
  const id = _learn.queue[_learn.idx];
  const card = store.getCards().find(c => c.id === id);
  if (!card) return `<div class="pad">Karte fehlt.</div>`;
  return `<div class="pad">
    <div class="learn-top"><button class="chip" data-action="fc-exit">✕ Beenden</button><span class="muted-row">${_learn.idx + 1} / ${_learn.queue.length}</span></div>
    <div class="flashcard">
      <div class="fc-face">${escHTML(card.front || '')}</div>
      ${_learn.revealed ? `<div class="fc-divider"></div><div class="fc-face back">${escHTML(card.back || '')}</div>` : ''}
    </div>
    ${_learn.revealed
      ? `<div class="grade-row">
          <button class="btn danger" data-action="fc-grade" data-g="1">Nochmal</button>
          <button class="btn" data-action="fc-grade" data-g="3">Schwer</button>
          <button class="btn" data-action="fc-grade" data-g="4">Gut</button>
          <button class="btn primary" data-action="fc-grade" data-g="5">Einfach</button>
        </div>`
      : `<button class="btn primary block big" data-action="fc-reveal">Antwort zeigen</button>`}
  </div>`;
}

export default {
  title: 'Flashcards', icon: '🎴',
  render(ctx) {
    if (ctx.sub === 'learn') return learnView();
    const decks = store.getDecks();
    const due = store.getDueCards();
    return `<div class="pad">
      ${pageHeader('Flashcards', `${store.getCards().length} Karten · ${due.length} fällig`, `<button class="chip" data-action="open-new">＋ Karte</button>`)}
      <button class="btn primary block big" data-action="fc-learn" data-deck="">🎯 ${due.length} fällige Karten lernen</button>
      <div class="section-title">Decks</div>
      ${decks.length ? decks.map(dk => {
        const cards = store.getCards().filter(c => c.deckId === dk.id);
        const dueN = due.filter(c => c.deckId === dk.id).length;
        return `<div class="card row-card">
          <div class="row-main"><div class="row-title">🗂 ${escHTML(dk.name || 'Deck')}</div>
          <div class="row-sub">${cards.length} Karten · ${dueN} fällig</div></div>
          ${dueN ? `<button class="chip accent" data-action="fc-learn" data-deck="${dk.id}">Lernen</button>` : ''}
        </div>`;
      }).join('')
      : `<div class="empty"><div class="empty-icon">🗂</div><div class="empty-sub">Noch keine Decks — erstelle eine Karte.</div></div>`}
    </div>`;
  },
};
