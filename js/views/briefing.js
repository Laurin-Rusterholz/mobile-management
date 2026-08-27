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
import { escHTML, todayYmd, toast, fmtDurationMin } from '../util.js';
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
  const zeit = String(m.startTime || m.time || '').slice(0, 5);
  return `<div class="bf-row" data-action="bf-open-meeting" data-id="${escHTML(m.id || '')}">
    <span class="bf-time">${escHTML(zeit || '–')}</span>
    <span class="bf-main"><span class="bf-title">${escHTML(m.title || m.name || 'Termin')}</span></span>
  </div>`;
}
function aufgabeZeile(t) {
  const spaet = istUeberfaellig(t);
  return `<div class="bf-row" data-action="bf-open-task" data-id="${escHTML(t.id || '')}">
    <span class="bf-dot ${spaet ? 'late' : ''}"></span>
    <span class="bf-main"><span class="bf-title">${escHTML(t.title || '(ohne Titel)')}</span>
      ${t.dueDate ? `<span class="bf-sub">${escHTML(String(t.dueDate).slice(0, 10))}</span>` : ''}</span>
  </div>`;
}
function routineZeile(h, tag) {
  const on = store.habitDoneOn(h, tag);
  const subs = store.getSubUnits(h);
  const fertig = subs.length ? store.subUnitsDoneCount(h, tag) : 0;
  // Mit Schritten fuehrt der Tipp in die Routine; ein Griff, der sie pauschal
  // als erledigt erklaert, waere hier falsch — die Schritte sind der Punkt.
  const aktion = subs.length ? 'bf-open-habits' : 'bf-toggle-habit';
  return `<button class="bf-habit ${on ? 'on' : ''}" data-action="${aktion}" data-id="${escHTML(h.id)}">
    <span class="bf-check">${on ? '✓' : (h.icon || '○')}</span>
    <span class="bf-main"><span class="bf-title">${escHTML(h.text || '(ohne Name)')}</span>
      <span class="bf-sub">${escHTML(FREQ[h.frequency] || 'Täglich')}${subs.length ? ` · ${fertig}/${subs.length}` : ''}</span></span>
  </button>`;
}
function leer(text) { return `<div class="bf-empty">${escHTML(text)}</div>`; }
function abschnitt(titel, inhalt, zusatz) {
  return `<section class="bf-sec">
    <div class="bf-head">${titel}${zusatz ? ` <span class="bf-count">${zusatz}</span>` : ''}</div>
    ${inhalt}
  </section>`;
}
function textZeile(text, unten) {
  return `<div class="bf-row"><span class="bf-main"><span class="bf-title">${escHTML(text)}</span>
    ${unten ? `<span class="bf-sub">${escHTML(unten)}</span>` : ''}</span></div>`;
}

// ── Der gewaehlte Tag ──────────────────────────────────────────────────────
// Das Briefing der Hauptapp blaettert durch die Tage. Ohne das waere "heute"
// die einzige erreichbare Ansicht — und die Abschnitte "Vergangene Tage" und
// "Tagesplanung" haetten kein Ziel, auf das sie zeigen koennten.
let gewaehlterTag = null;
function tagJetzt() { return gewaehlterTag || todayYmd(); }
function verschiebe(tag, tage) {
  const d = new Date(tag + 'T12:00:00');
  d.setDate(d.getDate() + tage);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── Aktionen ───────────────────────────────────────────────────────────────
registerActions({
  'bf-day': (d) => { gewaehlterTag = d.tag === 'heute' ? todayYmd() : verschiebe(tagJetzt(), Number(d.tage || 0)); navigate('briefing'); },
  'bf-goto-day': (d) => { gewaehlterTag = d.tag; navigate('briefing'); },
  'bf-toggle-habit': async (d) => {
    await store.performOp({ type: 'toggle-habit', payload: { id: d.id, date: tagJetzt() } });
  },
  'bf-open-habits': () => navigate('gewohnheiten'),
  'bf-open-task': (d) => navigate('planen', { sub: 'inbox', params: { id: d.id } }),
  'bf-open-meeting': () => navigate('meetings'),
  'bf-open': () => navigate('briefing'),
  'bf-toggle-goal': async (d) => {
    await store.performOp({ type: 'toggle-daygoal', payload: { id: d.id, date: tagJetzt() } });
  },
  'bf-add-goal': async () => {
    const el = document.getElementById('bfGoalInput');
    const v = el && el.value.trim();
    if (!v) return;
    await store.performOp({ type: 'add-daygoal', payload: { id: 'dg_' + Date.now().toString(36), title: v, date: tagJetzt() } });
    navigate('briefing');
  },
  'bf-add-thought': async () => {
    const el = document.getElementById('bfThoughtInput');
    const v = el && el.value.trim();
    if (!v) return;
    await store.performOp({ type: 'add-thought', payload: { id: 'tp_' + Date.now().toString(36), text: v } });
    navigate('briefing');
  },
  'bf-save-note': async () => {
    const el = document.getElementById('bfNoteInput');
    if (!el) return;
    await store.performOp({ type: 'briefing-note', payload: { text: el.value, date: tagJetzt() } });
    toast('Notiz gesichert', 'ok');
  },
  'bf-open-route': (d) => navigate(d.route),
});

export default {
  title: 'Briefing', icon: '☀️',
  render() {
    const tag = tagJetzt();
    const heute = todayYmd();
    const b = store.briefingFuerTag(tag);
    const f = focus.statsForDay(tag);
    const datumText = new Date(tag + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' });
    const zielFertig = b.tagesziele.filter(g => g && g.completed).length;
    const routinenFertig = b.routinen.filter(h => store.habitDoneOn(h, tag)).length;

    return `<div class="pad">
      ${pageHeader(tag === heute ? gruss() + ', Laurin.' : 'Briefing', datumText)}

      <div class="bf-nav">
        <button class="chip" data-action="bf-day" data-tage="-1">‹ Vortag</button>
        ${tag === heute ? '<span class="chip on">Heute</span>'
          : '<button class="chip" data-action="bf-day" data-tag="heute">Heute</button>'}
        <button class="chip" data-action="bf-day" data-tage="1">Folgetag ›</button>
      </div>

      <div class="bf-kpis">
        <div class="bf-kpi"><strong>${b.meetings.length}</strong><span>Termine</span></div>
        <div class="bf-kpi"><strong>${b.faellig.length}</strong><span>fällig</span></div>
        <div class="bf-kpi ${b.ueberfaellig.length ? 'warn' : ''}"><strong>${b.ueberfaellig.length}</strong><span>überfällig</span></div>
        <div class="bf-kpi"><strong>${routinenFertig}/${b.routinen.length}</strong><span>Routinen</span></div>
      </div>

      <div class="bf-cols">
        <div class="bf-col">

        ${abschnitt('🎯 Tagesziele', `
          ${b.tagesziele.length ? b.tagesziele.map(g => `
            <button class="bf-habit ${g.completed ? 'on' : ''}" data-action="bf-toggle-goal" data-id="${escHTML(String(g.id))}">
              <span class="bf-check">${g.completed ? '✓' : '○'}</span>
              <span class="bf-main"><span class="bf-title">${escHTML(String(g.title || ''))}</span></span>
            </button>`).join('') : leer('Noch kein Tagesziel.')}
          <div class="bf-add">
            <input class="input" id="bfGoalInput" placeholder="Ziel für diesen Tag…" autocomplete="off">
            <button class="btn primary" data-action="bf-add-goal">＋</button>
          </div>`, `${zielFertig}/${b.tagesziele.length}`)}

        ${abschnitt('🏅 Wochenziele', b.wochenziele.length
          ? b.wochenziele.map(g => textZeile(String(g.title || g.type || 'Ziel'),
              (g.current != null && g.target != null) ? `${g.current}/${g.target}` : '')).join('')
          : leer('Keine Wochenziele.'), String(b.wochenziele.length || ''))}

        ${abschnitt('📅 Tagesplanung', b.zeitbloecke.length
          ? b.zeitbloecke.map(tb => `<div class="bf-row">
              <span class="bf-time">${escHTML(String(tb.startTime || '').slice(0, 5))}</span>
              <span class="bf-main"><span class="bf-title">${escHTML(String(tb.title || 'Block'))}</span>
                <span class="bf-sub">bis ${escHTML(String(tb.endTime || '').slice(0, 5))}</span></span>
            </div>`).join('')
          : leer('Keine Zeitblöcke für diesen Tag.'), String(b.zeitbloecke.length || ''))}

        ${abschnitt('🤝 Meetings', b.meetings.length
          ? b.meetings.map(terminZeile).join('') : leer('Keine Termine.'), String(b.meetings.length || ''))}

        ${abschnitt('✓ Fällig', b.faellig.length
          ? b.faellig.map(aufgabeZeile).join('') : leer('Nichts fällig.'), String(b.faellig.length || ''))}

        ${b.ueberfaellig.length ? abschnitt('⚠ Überfällig',
          b.ueberfaellig.map(aufgabeZeile).join(''), String(b.ueberfaellig.length)) : ''}

        ${abschnitt('📌 Pendente Aufgaben', b.pendent.length
          ? b.pendent.slice(0, 12).map(aufgabeZeile).join('')
            + (b.pendent.length > 12 ? `<button class="bf-more" data-action="bf-open-route" data-route="planen">Alle ${b.pendent.length} ansehen ›</button>` : '')
          : leer('Nichts Offenes ohne Datum.'), String(b.pendent.length || ''))}

        ${abschnitt('🚨 Aktive Massnahmen', b.massnahmen.length
          ? b.massnahmen.map(m => textZeile(String(m.text || ''),
              `${m.parentIcon || ''} ${m.parentTitle || ''}`.trim())).join('')
          : leer('Keine aktiven Massnahmen.'), String(b.massnahmen.length || ''))}

        </div>
        <div class="bf-col">

        ${abschnitt('🔁 Routinen', b.routinen.length
          ? b.routinen.map(h => routineZeile(h, tag)).join('') : leer('Keine Routinen.'),
          `${routinenFertig}/${b.routinen.length}`)}

        ${abschnitt('💎 Glaubenssätze', b.beliefs.length
          ? b.beliefs.map(x => `<div class="bf-belief">${escHTML(x && x.text ? x.text : String(x || ''))}</div>`).join('')
          : leer('Keine Glaubenssätze.'), String(b.beliefs.length || ''))}

        ${abschnitt('📬 Nachrichten', b.nachrichten.length
          ? b.nachrichten.map(m => `<div class="bf-msg">
              <div class="bf-msg-top"><span class="bf-title">${escHTML(String(m.title || 'Nachricht'))}</span>
                <span class="bf-sub">${escHTML(String(m.deliveredAt || '').slice(11, 16))}</span></div>
              <div class="bf-msg-body">${escHTML(String(m.content || ''))}</div>
            </div>`).join('')
          : leer('Keine Nachrichten für diesen Tag.'), String(b.nachrichten.length || ''))}

        ${abschnitt('💭 Gedanken & Fragen', `
          ${b.gedanken.length ? b.gedanken.slice(0, 5).map(t => `<div class="bf-row">
              <span class="bf-main"><span class="bf-title">${escHTML(String(t.text || ''))}</span>
              <span class="bf-sub">${escHTML(String(t.createdAt || '').slice(0, 10))}</span></span></div>`).join('')
            : leer('Noch nichts notiert.')}
          <div class="bf-add">
            <input class="input" id="bfThoughtInput" placeholder="Gedanke, Frage, Beobachtung…" autocomplete="off">
            <button class="btn primary" data-action="bf-add-thought">💭</button>
          </div>`, String(b.gedanken.length || ''))}

        ${abschnitt('📝 Tägliche Notizen', `
          <textarea class="input bf-note" id="bfNoteInput" rows="4"
            placeholder="Was war heute?">${escHTML(b.notizen)}</textarea>
          <button class="btn block" data-action="bf-save-note" style="margin-top:8px">Notiz sichern</button>`)}

        ${abschnitt('📚 Leseliste', b.leseliste.length
          ? b.leseliste.slice(0, 8).map(r => textZeile(String(r.title || r.name || 'Eintrag'),
              r.completedAt ? 'gelesen' : (r.author || ''))).join('')
          : leer('Leseliste leer.'), String(b.leseliste.length || ''))}

        ${abschnitt('🏆 Generelle Ziele', b.ziele.length
          ? b.ziele.slice(0, 8).map(g => textZeile(String(g.title || g.name || 'Ziel'), g.status || '')).join('')
          : leer('Keine Ziele.'), String(b.ziele.length || ''))}

        ${abschnitt('📦 Projekte', b.projekte.length
          ? b.projekte.map(p => textZeile(String(p.title || p.name || 'Projekt'), p.status || '')).join('')
          : leer('Keine Projekte fürs Briefing gewählt.'), String(b.projekte.length || ''))}

        ${abschnitt('🧩 Programme', b.programme.length
          ? b.programme.map(p => textZeile(String(p.title || p.name || 'Programm'), p.status || '')).join('')
          : leer('Keine Programme fürs Briefing gewählt.'), String(b.programme.length || ''))}

        ${abschnitt('🛋️ Reflexionsfragen', b.reflexionsfragen.length
          ? b.reflexionsfragen.slice(0, 10).map(q => `<div class="bf-row ${q.heuteBeantwortet ? 'done' : ''}">
              <span class="bf-main"><span class="bf-title">${escHTML(String(q.text))}</span>
                <span class="bf-sub">${escHTML(String(q.projekt))}${q.heuteBeantwortet ? ' · heute beantwortet' : ''}</span></span>
            </div>`).join('')
          : leer('Keine Reflexionsfragen hinterlegt.'), String(b.reflexionsfragen.length || ''))}

        ${abschnitt('🎯 Fokus', textZeile(`${f.count} Sitzung${f.count === 1 ? '' : 'en'}`, fmtDurationMin(f.minutes)))}

        ${abschnitt('🗓️ Vergangene Tage', b.vergangeneTage.length
          ? `<div class="bf-days">${b.vergangeneTage.map(t => `<button class="chip" data-action="bf-goto-day" data-tag="${t}">${escHTML(t.slice(8) + '.' + t.slice(5, 7) + '.')}</button>`).join('')}</div>`
          : leer('Noch keine Historie.'), String(b.vergangeneTage.length || ''))}

        </div>
      </div>
    </div>`;
  },
};
