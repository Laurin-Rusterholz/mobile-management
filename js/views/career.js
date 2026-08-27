// ============================================================================
//  Career Model — Berufsfelder, Module, Tagespensum
//  ---------------------------------------------------------------------------
//  WARUM ES DIESE ANSICHT VORHER NICHT GAB: die Daten liegen unter
//  careerModel/users/<uid> in der Realtime Database. Die Mobile-App hatte
//  keine Nutzerkennung — eine Firebase-Sitzung gilt pro Origin, und dieser
//  Origin ist nicht der der Hauptapp. Ohne uid ist der Pfad nicht bildbar.
//  Seit die App die Anmeldung selbst traegt (js/auth.js), ist er es.
//
//  Sie liest LIVE und NUR LESEND. Geschrieben wird das Career Model in der
//  Hauptapp; eine zweite Schreibstelle waere eine zweite Merge-Frage, und die
//  ist hier nicht beantwortet.
//
//  Der Hoerer wird beim Verlassen abgemeldet (unmount) — sonst rechnete er in
//  einer laengst verlassenen Ansicht weiter.
// ============================================================================
import { escHTML, toast } from '../util.js';
import { registerActions } from '../actions.js';
import { pageHeader } from './common.js';
import * as auth from '../auth.js';

const S = {
  daten: null,        // null = noch nichts geladen
  fehler: null,
  ref: null,
  hoerer: null,
  abAuth: null,
  laeuft: false,
};

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const liste = (o) => Object.keys(obj(o)).map((id) => Object.assign({ id }, obj(obj(o)[id])));

// Fortschritt eines Moduls — dieselbe Rechnung wie im Core der Hauptapp:
// erledigte Tage aus progress[moduleId].completedDays gegen dayOrder.
function fortschritt(daten, modul) {
  const order = Array.isArray(modul.dayOrder) ? modul.dayOrder
    : Object.keys(obj(modul.days));
  const fertig = obj(obj(obj(daten.progress)[modul.id]).completedDays);
  const erledigt = order.filter((id) => Boolean(fertig[id])).length;
  return { erledigt, gesamt: order.length, prozent: order.length ? Math.round(erledigt / order.length * 100) : 0 };
}

function modulKarte(daten, modul) {
  const f = fortschritt(daten, modul);
  const plan = obj(obj(daten.plans)[modul.id]);
  const ziel = plan.targetDate ? String(plan.targetDate).slice(0, 10) : '';
  return `<div class="cm-mod">
    <div class="cm-mod-top">
      <span class="cm-mod-title">${escHTML(String(modul.title || modul.name || 'Modul'))}</span>
      <span class="cm-mod-pct">${f.prozent}%</span>
    </div>
    <div class="cm-bar"><span style="width:${f.prozent}%"></span></div>
    <div class="cm-mod-sub">${f.erledigt}/${f.gesamt} Tage${ziel ? ' · Ziel ' + escHTML(ziel) : ''}${modul.status === 'archived' ? ' · archiviert' : ''}</div>
  </div>`;
}

function inhalt() {
  if (S.fehler) {
    return `<div class="empty"><div class="empty-icon">⚠️</div>
      <div class="empty-title">Career Model nicht lesbar</div>
      <div class="empty-sub">${escHTML(S.fehler)}</div></div>`;
  }
  if (S.daten === null) {
    return `<div class="empty"><div class="empty-icon">⏳</div>
      <div class="empty-title">Wird geladen…</div></div>`;
  }
  const bereiche = liste(S.daten.areas);
  const module = liste(S.daten.modules);
  if (!bereiche.length && !module.length) {
    return `<div class="empty"><div class="empty-icon">🧗</div>
      <div class="empty-title">Noch kein Berufsfeld</div>
      <div class="empty-sub">Module werden in Quantus importiert und erscheinen hier automatisch.</div></div>`;
  }

  // Module ohne (bekanntes) Berufsfeld gehen nicht verloren — sie bekommen
  // eine eigene Gruppe. Sonst waeren sie unsichtbar und niemand wuesste, warum.
  const bekannt = new Set(bereiche.map((b) => b.id));
  const ohne = module.filter((m) => !bekannt.has(m.areaId));
  const gruppen = bereiche.map((b) => ({ b, mods: module.filter((m) => m.areaId === b.id) }));
  if (ohne.length) gruppen.push({ b: { id: '__ohne', name: 'Ohne Berufsfeld', description: '' }, mods: ohne });

  return gruppen.map(({ b, mods }) => `<section class="cm-area">
    <div class="cm-area-head">
      <span class="cm-area-name">${escHTML(String(b.name || b.title || 'Berufsfeld'))}</span>
      <span class="cm-area-count">${mods.length}</span>
    </div>
    ${b.description ? `<div class="cm-area-desc">${escHTML(String(b.description).slice(0, 220))}</div>` : ''}
    ${mods.length ? mods.map((m) => modulKarte(S.daten, m)).join('')
      : '<div class="cm-area-desc">Noch kein Modul in diesem Feld.</div>'}
  </section>`).join('');
}

function angemeldetHtml() {
  const u = auth.currentUser();
  return `<div class="pad">
    ${pageHeader('Career Model', escHTML((u && (u.displayName || u.email)) || 'Angemeldet'))}
    ${inhalt()}
  </div>`;
}

function abgemeldetHtml() {
  const kannGarNicht = !auth.sdkBereit();
  return `<div class="pad">
    ${pageHeader('Career Model', 'Anmeldung nötig')}
    <div class="empty">
      <div class="empty-icon">🔐</div>
      <div class="empty-title">Mit Google anmelden</div>
      <div class="empty-sub">Die Career-Daten liegen unter deiner Nutzerkennung. Ohne Anmeldung
        gibt es keinen Pfad zu ihnen — die App kann sie nicht einmal suchen.</div>
      ${kannGarNicht
        ? '<div class="empty-sub">Firebase-SDK nicht geladen — bitte online neu starten.</div>'
        : '<button class="btn primary" data-action="cm-login" style="margin-top:14px">Mit Google anmelden</button>'}
    </div>
  </div>`;
}

// ── Live-Hoerer an careerModel/users/<uid> ─────────────────────────────────
function loeseHoerer() {
  if (S.ref && S.hoerer) { try { S.ref.off('value', S.hoerer); } catch (e) {} }
  S.ref = null; S.hoerer = null;
}

function hoereZu() {
  loeseHoerer();
  const id = auth.uid();
  if (!id) return;
  const db = auth.rtdb();
  if (!db) { S.fehler = 'Realtime Database nicht verfügbar.'; zeichne(); return; }
  S.fehler = null;
  S.ref = db.ref('careerModel/users/' + id);
  S.hoerer = S.ref.on('value',
    (snap) => { S.daten = obj(snap && snap.val()); S.fehler = null; zeichne(); },
    (err) => { S.fehler = (err && err.message) || 'Zugriff verweigert.'; zeichne(); });
}

// Nur zeichnen, wenn die Ansicht ueberhaupt noch sichtbar ist. Ein Hoerer, der
// blind in #content schreibt, ueberschreibt sonst eine ganz andere Ansicht.
function zeichne() {
  if (!S.laeuft) return;
  const wurzel = document.getElementById('content');
  if (!wurzel) return;
  wurzel.innerHTML = auth.uid() ? angemeldetHtml() : abgemeldetHtml();
}

registerActions({
  'cm-login': async () => {
    const r = await auth.signInGoogle();
    if (r.ok) return;                       // onAuthChange zeichnet neu
    if (r.abgebrochen) return;
    toast(r.grund || 'Anmeldung fehlgeschlagen', 'error');
  },
});

export default {
  title: 'Career Model', icon: '🧗',
  render() {
    return auth.uid() ? angemeldetHtml() : abgemeldetHtml();
  },
  mount() {
    S.laeuft = true;
    auth.initAuth();
    S.abAuth = auth.onAuthChange(() => { S.daten = null; S.fehler = null; hoereZu(); zeichne(); });
    hoereZu();
  },
  unmount() {
    S.laeuft = false;
    loeseHoerer();
    if (S.abAuth) { S.abAuth(); S.abAuth = null; }
    S.daten = null; S.fehler = null;
  },
};
