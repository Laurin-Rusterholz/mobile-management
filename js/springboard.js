// ============================================================================
//  Springboard — das Anordnungs-Modell des Homebildschirms
//  ---------------------------------------------------------------------------
//  BEFUND: die Seiten des Homebildschirms standen fest in config.js. Welche App
//  wo lag, war eine Entscheidung des Quelltextes — wer sie aendern wollte,
//  musste die Datei aendern und neu ausliefern. Der einzige Griff, den es gab
//  (langer Druck = ins Dock legen), war ausserdem nirgends angeschrieben.
//
//  Hier liegt jetzt das Modell: WELCHE App auf WELCHER Seite an WELCHER Stelle
//  liegt, was im Dock liegt und was gar nicht auf dem Homebildschirm liegt.
//  Es ist bewusst reine Rechnung ohne DOM — die Ansicht (views/home.js) macht
//  das Ziehen und Legen, die Regeln stehen hier und sind einzeln pruefbar.
//
//  Gespeichert wird lokal (LS.springboard). Die Anordnung ist eine Eigenschaft
//  des GERAETS, nicht des Datenbestands: sie geht bewusst nicht in den
//  Quantus-Blob, damit sie den Abgleich nicht beruehrt (siehe mergeData in der
//  Hauptapp — ein neuer Bereich ohne eigenen Zweig ist dort eine Fussangel).
// ============================================================================
import { SPRINGBOARD_PAGES, SPRINGBOARD_DOCK, MORE_MODULES, TABS, LS } from './config.js';

export const DOCK_MAX = 4;

const TONES = ['violet', 'blue', 'green', 'sand', 'red', 'pink', 'coral'];

// Apps ohne eigenen Farbton bekommen einen festen, aus dem Schluessel
// abgeleiteten — gleicher Schluessel, gleiche Farbe, ueber Neustarts hinweg.
function toneFor(key) {
  let sum = 0;
  String(key).split('').forEach((c) => { sum += c.charCodeAt(0); });
  return TONES[sum % TONES.length];
}

// ── Katalog: alles, was auf dem Homebildschirm liegen KANN ──────────────────
// Quellen: die Vorgabeseiten, das Vorgabe-Dock, die Tab-Bereiche und alle
// Module aus „Mehr". Der erste Fund gewinnt (die Vorgabeseiten tragen die
// gepflegten Farben). 'home' ist ausgenommen — der Homebildschirm ist keine
// App auf sich selbst.
export const APP_CATALOG = (() => {
  const map = new Map();
  const add = (a) => {
    if (!a || !a.key || a.key === 'home' || map.has(a.key)) return;
    map.set(a.key, { key: a.key, label: a.label, icon: a.icon, route: a.route || a.key, tone: a.tone || toneFor(a.key) });
  };
  SPRINGBOARD_PAGES.forEach((p) => (p.apps || []).forEach(add));
  SPRINGBOARD_DOCK.forEach(add);
  TABS.forEach(add);
  MORE_MODULES.forEach(add);
  return map;
})();

export function appInfo(key) { return APP_CATALOG.get(key) || null; }
export function knownKey(key) { return APP_CATALOG.has(key); }

// ── Vorgabe ─────────────────────────────────────────────────────────────────
function rohVorgabe() {
  return {
    pages: SPRINGBOARD_PAGES.map((p) => ({ title: p.title, keys: p.apps.map((a) => a.key) })),
    dock: SPRINGBOARD_DOCK.map((a) => a.key).slice(0, DOCK_MAX),
    page: 0,
  };
}
export function defaultLayout() { return normalizeLayout(rohVorgabe()); }

// ── Normalisieren ───────────────────────────────────────────────────────────
// Nimmt ALLES entgegen, was je unter dem Schluessel lag — auch den alten Stand
// { dock, hidden, page } ohne Seiten — und gibt eine gueltige Anordnung zurueck:
//   · nur bekannte App-Schluessel
//   · jede App hoechstens EINMAL auf dem ganzen Homebildschirm
//   · Dock hoechstens DOCK_MAX
//   · mindestens eine Seite
// Das Dock kommt ZUERST: es ist die bewusstere Ablage (vier Plaetze, immer
// sichtbar). Lag eine App bisher gleichzeitig im Dock und auf einer Seite —
// die Vorgabe tat das —, gilt das Dock, und die Seite verliert die Doppelung.
// Was nirgends liegt, ist damit „nicht auf dem Homebildschirm" und steht in der
// Ablage (availableApps) zum Zuruecklegen bereit.
export function normalizeLayout(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const vorgabe = rohVorgabe();
  const gesehen = new Set();

  const saubereListe = (list) => (Array.isArray(list) ? list : [])
    .map((k) => String(k))
    .filter((k) => knownKey(k) && !gesehen.has(k) && gesehen.add(k));

  // FEHLT ein Feld, gilt die Vorgabe; ist es ausdruecklich als (auch leere)
  // Liste da, gilt genau diese. Ohne diese Unterscheidung stand ein frischer
  // Homebildschirm ohne Dock da (nichts gespeichert → kein Dock), und eine
  // leergezogene Seite waere beim naechsten Laden wieder voll gewesen.
  const dock = saubereListe(Array.isArray(src.dock) ? src.dock : vorgabe.dock).slice(0, DOCK_MAX);
  const rohSeiten = Array.isArray(src.pages) ? src.pages : vorgabe.pages;
  let pages = rohSeiten.map((p, i) => ({
    title: String((p && p.title) != null ? p.title : ('Seite ' + (i + 1))).slice(0, 40),
    keys: saubereListe(p && (p.keys || p.apps)),
  }));
  if (!pages.length) pages = [{ title: 'Apps', keys: [] }];

  const page = Number.isFinite(Number(src.page)) ? Math.max(0, Math.min(pages.length - 1, Number(src.page))) : 0;
  return { pages, dock, page };
}

// ── Speichern / Laden ───────────────────────────────────────────────────────
export function loadLayout() {
  try {
    const roh = localStorage.getItem(LS.springboard);
    return roh ? normalizeLayout(JSON.parse(roh)) : defaultLayout();
  } catch (e) { return defaultLayout(); }
}
export function saveLayout(layout) {
  try { localStorage.setItem(LS.springboard, JSON.stringify(normalizeLayout(layout))); } catch (e) { /* Quota */ }
  return layout;
}
export function resetLayout() {
  try { localStorage.removeItem(LS.springboard); } catch (e) { /* ignore */ }
  return defaultLayout();
}

// ── Abfragen ────────────────────────────────────────────────────────────────
export function placedKeys(layout) {
  const l = normalizeLayout(layout);
  return [...l.pages.flatMap((p) => p.keys), ...l.dock];
}

// Alles, was der Katalog kennt und was gerade NICHT auf dem Homebildschirm
// liegt. Genau diese Liste steht im Anordnen-Modus als Ablage bereit — auch
// Module, die in der Vorgabe nie eine Kachel hatten (Briefing, Gmail, Smarter …).
export function availableApps(layout) {
  const drauf = new Set(placedKeys(layout));
  return [...APP_CATALOG.values()].filter((a) => !drauf.has(a.key));
}

export function locate(layout, key) {
  const l = normalizeLayout(layout);
  const d = l.dock.indexOf(key);
  if (d >= 0) return { kind: 'dock', index: d };
  for (let i = 0; i < l.pages.length; i++) {
    const j = l.pages[i].keys.indexOf(key);
    if (j >= 0) return { kind: 'page', page: i, index: j };
  }
  return null;
}

// ── Veraendern (immer eine NEUE Anordnung zurueck, nie in place) ────────────
function ohne(layout, key) {
  return {
    ...layout,
    pages: layout.pages.map((p) => ({ ...p, keys: p.keys.filter((k) => k !== key) })),
    dock: layout.dock.filter((k) => k !== key),
  };
}

// Legt eine App an eine Stelle: { kind:'page', page, index } oder
// { kind:'dock', index }. Ist das Dock voll und die App liegt noch nicht darin,
// bleibt die Anordnung unveraendert — vier Plaetze sind vier Plaetze, und eine
// stillschweigend verdraengte App waere schlimmer als eine abgelehnte Geste.
export function placeApp(layout, key, target) {
  const l = normalizeLayout(layout);
  if (!knownKey(key) || !target) return l;

  if (target.kind === 'dock') {
    const drin = l.dock.includes(key);
    if (!drin && l.dock.length >= DOCK_MAX) return l;
    const rest = ohne(l, key);
    const dock = rest.dock.slice();
    const i = Math.max(0, Math.min(dock.length, Number(target.index != null ? target.index : dock.length)));
    dock.splice(i, 0, key);
    return normalizeLayout({ ...rest, dock });
  }

  const pi = Math.max(0, Math.min(l.pages.length - 1, Number(target.page || 0)));
  const rest = ohne(l, key);
  const pages = rest.pages.map((p, i) => {
    if (i !== pi) return p;
    const keys = p.keys.slice();
    const j = Math.max(0, Math.min(keys.length, Number(target.index != null ? target.index : keys.length)));
    keys.splice(j, 0, key);
    return { ...p, keys };
  });
  return normalizeLayout({ ...rest, pages });
}

// Vom Homebildschirm nehmen. Die App verschwindet NICHT aus der App — sie
// bleibt ueber „Mehr", die Suche und die Ablage erreichbar.
export function removeApp(layout, key) { return normalizeLayout(ohne(normalizeLayout(layout), key)); }

export function addPage(layout, title) {
  const l = normalizeLayout(layout);
  return { ...l, pages: [...l.pages, { title: String(title || 'Weitere').slice(0, 40), keys: [] }] };
}

export function renamePage(layout, index, title) {
  const l = normalizeLayout(layout);
  return { ...l, pages: l.pages.map((p, i) => (i === index ? { ...p, title: String(title || '').slice(0, 40) } : p)) };
}

// Leere Seiten fallen weg, sobald das Anordnen beendet wird — so wird man eine
// Seite wieder los: alle Symbole herunterziehen. Die erste Seite bleibt immer.
export function dropEmptyPages(layout) {
  const l = normalizeLayout(layout);
  const pages = l.pages.filter((p, i) => p.keys.length > 0 || i === 0);
  return normalizeLayout({ ...l, pages: pages.length ? pages : [{ title: 'Apps', keys: [] }] });
}

// Aus dem DOM zurueck ins Modell: die Ansicht schiebt beim Ziehen echte
// Elemente umher, danach ist der DOM die Wahrheit. Erwartet Listen von
// Schluesseln je Seite (mit Titel) und fuer das Dock.
export function layoutFromLists(pages, dock, page) {
  return normalizeLayout({ pages, dock, page });
}
