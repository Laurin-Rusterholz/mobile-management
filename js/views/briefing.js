// ============================================================================
//  Morning Briefing — der Tagesstart, prominent statt versteckt
//
//  BEFUND: store.getDailyBriefing() gab es laengst, wurde aber von KEINER
//  einzigen Ansicht benutzt. Auf dem Startbildschirm kam der Tag gar nicht vor
//  — man sah Kacheln, aber nicht, was heute ansteht.
//
//  Diese Ansicht liest ausschliesslich vorhandene Daten: Termine des Tages,
//  faellige und ueberfaellige Aufgaben, die Routinen aus
//  dailyBriefing.routines[] (abhakbar, ueber dieselbe Op wie die
//  Gewohnheiten-Ansicht) und die Glaubenssaetze aus dailyBriefing.beliefs[].
//  Nichts wird erfunden, nichts neu gespeichert.
//
//  Tablet: zwei Spalten (links Termine/Aufgaben, rechts Routinen/Saetze).
//  Telefon: eine Spalte in derselben Reihenfolge.
// ============================================================================
import { escHTML, todayYmd, toast } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import * as focus from '../focus.js';
import { pageHeader } from './common.js';

const FREQ = { daily: 'Täglich', weekdays: 'Wochentags', weekly: 'Wöchentlich', weekends: 'Wochenende', custom: 'Frei' };

function gruss(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
}
function tagText(d = new Date()) {
  return d.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' });
}
function istHeute(iso) { return String(iso || '').slice(0, 10) === todayYmd(); }
function istUeberfaellig(t) {
  const d = String(t.dueDate || '').slice(0, 10);
  return !!d && d < todayYmd();
}

// Eine Zahl, die den Tag zusammenfasst — dieselben Quellen wie die Abschnitte
// darunter, damit Kopf und Inhalt nie auseinanderlaufen.
export function briefingZahlen() {
  const heute = todayYmd();
  const offen = store.getTasks().filter(t => t.status !== 'done');
  const termine = store.getMeetings().filter(m => istHeute(m.date));
  const routinen = store.getHabits();
  const erledigt = routinen.filter(h => store.habitDoneOn(h, heute)).length;
  return {
    heute,
    termine,
    faellig: offen.filter(t => istHeute(t.dueDate)),
    ueberfaellig: offen.filter(istUeberfaellig),
    routinen,
    erledigt,
    beliefs: Array.isArray(store.getDailyBriefing().beliefs) ? store.getDailyBriefing().beliefs : [],
  };
}

function terminZeile(m) {
  const zeit = m.startTime || m.time || '';
  return `<div class="bf-row" data-action="bf-open-meeting" data-id="${escHTML(m.id || '')}">
    <span class="bf-time">${escHTML(zeit || '–')}</span>
    <span class="bf-main"><span class="bf-title">${escHTML(m.title || m.name || 'Termin')}</span>
    ${m.location ? `<span class="meta">${escHTML(m.location)}</span>` : ''}</span>
  </div>`;
}
function aufgabeZeile(t, spaet) {
  return `<div class="bf-row" data-action="bf-open-task" data-id="${escHTML(t.id || '')}">
    <span class="bf-dot ${spaet ? 'late' : ''}"></span>
    <span class="bf-main"><span class="bf-title">${escHTML(t.title || '(ohne Titel)')}</span>
    ${t.dueDate ? `<span class="meta">${escHTML(String(t.dueDate).slice(0, 10))}</span>` : ''}</span>
  </div>`;
}
function routineZeile(h, heute) {
  const on = store.habitDoneOn(h, heute);
  return `<button class="bf-habit ${on ? 'on' : ''}" data-action="bf-toggle-habit" data-id="${escHTML(h.id)}">
    <span class="bf-check">${on ? '✓' : (h.icon || '○')}</span>
    <span class="bf-main"><span class="bf-title">${escHTML(h.text || '(ohne Name)')}</span>
    <span class="meta">${escHTML(FREQ[h.frequency] || 'Täglich')}</span></span>
  </button>`;
}
function leer(text) { return `<div class="bf-empty">${escHTML(text)}</div>`; }

registerActions({
  'bf-toggle-habit': async (d) => {
    await store.performOp({ type: 'toggle-habit', payload: { id: d.id, date: todayYmd() } });
  },
  'bf-open-task': (d) => navigate('planen', { sub: 'inbox', params: { id: d.id } }),
  'bf-open-meeting': () => navigate('meetings'),
  'bf-open': () => navigate('briefing'),
});

export default {
  title: 'Briefing', icon: '☀️',
  render() {
    const z = briefingZahlen();
    const tag = focus.statsForDay(z.heute);
    return `<div class="pad">
      ${pageHeader(gruss() + ', Laurin.', tagText())}

      <div class="bf-kpis">
        <div class="bf-kpi"><strong>${z.termine.length}</strong><span>Termine</span></div>
        <div class="bf-kpi"><strong>${z.faellig.length}</strong><span>fällig</span></div>
        <div class="bf-kpi ${z.ueberfaellig.length ? 'warn' : ''}"><strong>${z.ueberfaellig.length}</strong><span>überfällig</span></div>
        <div class="bf-kpi"><strong>${z.erledigt}/${z.routinen.length}</strong><span>Routinen</span></div>
      </div>

      <div class="bf-cols">
        <section class="bf-col">
          <div class="bf-head">📅 Heute</div>
          ${z.termine.length ? z.termine.map(terminZeile).join('') : leer('Keine Termine heute.')}

          <div class="bf-head">✓ Fällig</div>
          ${z.faellig.length ? z.faellig.map(t => aufgabeZeile(t, false)).join('') : leer('Nichts fällig heute.')}

          ${z.ueberfaellig.length ? `<div class="bf-head warn">⚠ Überfällig</div>
            ${z.ueberfaellig.map(t => aufgabeZeile(t, true)).join('')}` : ''}
        </section>

        <section class="bf-col">
          <div class="bf-head">🔁 Routinen</div>
          ${z.routinen.length ? z.routinen.map(h => routineZeile(h, z.heute)).join('') : leer('Keine Routinen angelegt.')}

          ${z.beliefs.length ? `<div class="bf-head">💎 Leitsätze</div>
            ${z.beliefs.map(b => `<div class="bf-belief">${escHTML(b && b.text ? b.text : String(b || ''))}</div>`).join('')}` : ''}

          <div class="bf-head">🎯 Fokus heute</div>
          <div class="bf-row"><span class="bf-main"><span class="bf-title">${tag.count} Sitzung${tag.count === 1 ? '' : 'en'}</span>
            <span class="meta">${Math.round(tag.minutes)} Minuten</span></span></div>
        </section>
      </div>
    </div>`;
  },
};
