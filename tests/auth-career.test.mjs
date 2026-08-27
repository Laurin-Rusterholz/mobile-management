/*
 * Die App traegt die Google-Anmeldung SELBST — und das Career Model haengt
 * daran.
 *
 * ENTSCHEID (Nutzer): "Selbst tragen", nicht nur nach Quantus verlinken.
 *
 * WARUM VERLINKEN NICHT GEREICHT HAETTE: eine Firebase-Sitzung gilt PRO
 * ORIGIN. Die Hauptapp meldet sich nicht einmal selbst an — die Anmeldung
 * passiert dort in drive.html, und index.html verwendet die Sitzung desselben
 * Origins nur mit. Die Mobile-App liegt auf einem anderen Origin und erbt
 * daher gar nichts. Ein Verweis haette eine Anmeldung in einem fremden
 * Kontext erzeugt und hier keine Nutzerkennung hinterlassen.
 *
 * BEFUND, DER DAMIT FAELLT: careerModel/users/<uid> war nicht bildbar, weil
 * die App keine uid hatte. Die Ansicht fehlte deshalb ganz.
 *
 * WAS DIESER WAECHTER MISST
 *  1. Die Anmeldung ist wirklich da: SDK eingebunden, Popup zuerst,
 *     Weiterleitung als Rueckfall, und der Fehler, den nur ein Mensch in der
 *     Firebase-Konsole beheben kann (unauthorized-domain), wird als solcher
 *     benannt statt als "Fehler".
 *  2. Das Career Model liest den richtigen Pfad, live und NUR LESEND.
 *  3. Der Live-Hoerer wird beim Verlassen abgemeldet. Das ist der Fallstrick
 *     aus CLAUDE.md Nr. 4: was beim Betreten registriert wird, muss beim
 *     Verlassen wieder ab — sonst schreibt der Hoerer in eine ganz andere
 *     Ansicht. Die Schale hatte bis dahin nur mount(), kein Gegenstueck.
 *
 * Kein Browser, kein Netz. Firebase ist eine Attrappe, die mitzaehlt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// TOLERANT lesen. Auf einem Stand, der js/auth.js noch gar nicht hat, wuerde
// ein hartes readFileSync den Lauf mit ENOENT beenden — rot aus dem falschen
// Grund, und keine einzige der eigentlichen Pruefungen waere je gelaufen.
const lies = (p) => {
  try { return fs.readFileSync(path.join(root, p), 'utf8'); }
  catch (e) { fehlend.add(p); return ''; }
};
const fehlend = new Set();
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ═══ 1. DIE ANMELDUNG IST EINGEBAUT ════════════════════════════════════
const INDEX = lies('index.html');
ok(/firebase-auth-compat\.js/.test(INDEX), 'das Auth-SDK ist nicht eingebunden — die Anmeldung kann gar nicht laufen');
ok(/firebase-database-compat\.js/.test(INDEX), 'das Database-SDK fehlt — careerModel ist nicht lesbar');

const CFG = lies('js/config.js');
ok(/databaseURL:/.test(CFG), 'die Firebase-Config traegt keine databaseURL — die RTDB ist nicht adressierbar');
ok(/projectId:/.test(CFG), 'die Firebase-Config traegt keine projectId');

const AUTH = ohneKommentare(lies('js/auth.js'));
ok(/signInWithPopup/.test(AUTH), 'es gibt keinen Popup-Weg');
ok(/signInWithRedirect/.test(AUTH), 'es gibt keinen Weiterleitungs-Rueckfall');
ok(AUTH.indexOf('signInWithPopup') < AUTH.indexOf('signInWithRedirect'),
  'die Weiterleitung kommt vor dem Popup — der Rueckfall waere der Regelweg');
ok(/getRedirectResult/.test(AUTH),
  'die Rueckkehr aus einer Weiterleitung wird nicht abgeschlossen — man waere angemeldet, aber die App wuesste es nicht');
ok(/window\.self === window\.top/.test(AUTH),
  'die Weiterleitung wird auch im eingebetteten Rahmen versucht — dort verweigert Google die Darstellung');
ok(/auth\/unauthorized-domain/.test(AUTH),
  'der Fehler unauthorized-domain wird nicht eigens benannt — er ist der wahrscheinlichste erste, und nur ein Mensch kann ihn beheben');
ok(/Authorized domains/.test(AUTH), 'die Meldung sagt nicht, WO das freizugeben ist');
ok(/onAuthStateChanged/.test(AUTH), 'der Anmeldezustand wird nicht beobachtet');

// ═══ 2. DAS MODUL LAEUFT — gegen eine Firebase-Attrappe ════════════════
const zaehler = { popup: 0, redirect: 0, refs: [], off: 0, on: 0, signOut: 0 };
let popupFehler = null;
const hoererFirebase = [];
let angemeldet = null;

globalThis.window = globalThis;
globalThis.console = console;
globalThis.firebase = {
  apps: [],
  initializeApp: (c) => { globalThis.firebase.apps.push(c); return c; },
  app: () => globalThis.firebase.apps[0],
  auth: Object.assign(() => ({
    getRedirectResult: async () => ({ user: null }),
    onAuthStateChanged: (fn) => { hoererFirebase.push(fn); fn(angemeldet); return () => {}; },
    signInWithPopup: async () => { zaehler.popup++; if (popupFehler) throw popupFehler; angemeldet = { uid: 'u-1', email: 'x@y.z' }; hoererFirebase.forEach((f) => f(angemeldet)); },
    signInWithRedirect: async () => { zaehler.redirect++; },
    signOut: async () => { zaehler.signOut++; angemeldet = null; hoererFirebase.forEach((f) => f(null)); },
  }), { GoogleAuthProvider: function () {} }),
  database: () => ({
    ref: (pfad) => {
      zaehler.refs.push(pfad);
      const r = {
        on: (ev, cb, err) => { zaehler.on++; r._cb = cb; r._err = err; return cb; },
        off: () => { zaehler.off++; },
        // Schreibwege bewusst als Falle: wird einer benutzt, faellt der Test.
        set: () => { throw new Error('das Career Model darf hier nicht geschrieben werden'); },
        update: () => { throw new Error('das Career Model darf hier nicht geschrieben werden'); },
      };
      zaehler.letzteRef = r;
      return r;
    },
  }),
};

// Module echt laden, Importe auf Attrappen umbiegen.
const protokoll = { toasts: [], aktionen: {} };
const stubs = {
  './config.js': { FIREBASE_CONFIG: { apiKey: 'k', databaseURL: 'https://db' } },
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    toast: (t, k) => protokoll.toasts.push(k + ':' + t),
  },
  '../actions.js': { registerActions: (o) => Object.assign(protokoll.aktionen, o) },
  './common.js': { pageHeader: (t, s) => `<h1>${t}</h1><p>${s}</p>` },
};
function lade(datei, extra = {}) {
  const alle = Object.assign({}, stubs, extra);
  const quelle = lies(datei);
  if (!quelle) { ok(false, `${datei} gibt es nicht`); return { default: null }; }
  const ohne = quelle.replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
    ok(Object.prototype.hasOwnProperty.call(alle, pfad), `${datei}: unbekannter Import ${pfad}`);
    const namen = /\{([^}]*)\}/.exec(m);
    if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
    return `const ${/\*\s+as\s+(\w+)/.exec(m)[1]} = __stubs['${pfad}'];`;
  });
  const exportiert = [...ohne.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  const body = ohne.replace(/^export (?:async )?function/gm, (m) => m.replace('export ', ''))
    .replace(/^export default/m, 'const __default =');
  const rueck = `return Object.assign({ default: typeof __default !== 'undefined' ? __default : null }, {${exportiert.map((n) => n + ': typeof ' + n + " !== 'undefined' ? " + n + ' : null').join(',')}});`;
  return new Function('__stubs', body + '\n' + rueck)(alle);
}

const roh = lade('js/auth.js');
ok(typeof roh.signInGoogle === 'function', 'js/auth.js exportiert kein signInGoogle');
ok(typeof roh.uid === 'function', 'js/auth.js exportiert kein uid');
// Fehlende Namen als Attrappe fuehren: so misst der Rest des Laufs weiter,
// statt an der ersten TypeError zu enden.
const A = {
  signInGoogle: roh.signInGoogle || (async () => ({ ok: false })),
  signOutGoogle: roh.signOutGoogle || (async () => ({ ok: false })),
  uid: roh.uid || (() => null),
  currentUser: roh.currentUser || (() => null),
  sdkBereit: roh.sdkBereit || (() => false),
  initAuth: roh.initAuth || (() => null),
  rtdb: roh.rtdb || (() => null),
  onAuthChange: roh.onAuthChange || (() => () => {}),
};

// Popup zuerst.
await A.signInGoogle();
ok(zaehler.popup === 1, `Popup ${zaehler.popup}x statt 1x`);
ok(zaehler.redirect === 0, 'es wurde weitergeleitet, obwohl das Popup ging');
ok(A.uid() === 'u-1', `uid ${JSON.stringify(A.uid())} statt u-1 — die Anmeldung schlaegt nicht durch`);

// Blockiertes Popup -> Weiterleitung.
await A.signOutGoogle();
popupFehler = { code: 'auth/popup-blocked' };
await A.signInGoogle();
ok(zaehler.redirect === 1, `Rueckfall auf Weiterleitung ${zaehler.redirect}x statt 1x`);

// Abbruch durch den Nutzer ist KEIN Fehler — sonst poppt eine Meldung auf,
// obwohl er selbst zugemacht hat.
popupFehler = { code: 'auth/popup-closed-by-user' };
{
  const r = await A.signInGoogle();
  ok(r.ok === false && r.abgebrochen === true, 'ein bewusster Abbruch wird als Fehler gemeldet');
}
// Und die Konsolenmeldung ist benannt, nicht generisch.
popupFehler = { code: 'auth/unauthorized-domain' };
{
  // Das Modul protokolliert diesen Fall zu Recht auf die Konsole. Im Test ist
  // das nur Laerm — kurz stummschalten, damit die Suite lesbar bleibt.
  const echt = console.error; console.error = () => {};
  const r = await A.signInGoogle();
  console.error = echt;
  ok(/Authorized domains/.test(r.grund || ''), 'unauthorized-domain liefert keine handlungsfaehige Meldung');
}
popupFehler = null;

// ═══ 3. DIE CAREER-ANSICHT: richtiger Pfad, live, nur lesend ═══════════
let gezeichnet = '';
globalThis.document = { getElementById: () => ({ set innerHTML(v) { gezeichnet = v; }, get innerHTML() { return gezeichnet; } }) };
globalThis.location = { hash: '#/career' };

const Croh = lade('js/views/career.js', { '../auth.js': A }).default;
ok(Croh && typeof Croh.render === 'function', 'die Career-Ansicht hat kein render()');
const C = Object.assign({ render: () => '', mount: () => {} }, Croh || {});
ok(typeof (Croh || {}).unmount === 'function',
  'die Career-Ansicht hat kein unmount() — der Live-Hoerer bliebe nach dem Verlassen haengen');

// Abgemeldet: kein Pfad, kein Hoerer, aber ein Weg hinein.
await A.signOutGoogle();
{
  const h = C.render();
  ok(/data-action="cm-login"/.test(h), 'ohne Anmeldung fehlt der Anmeldeknopf');
  ok(!/careerModel/.test(h), 'die Ansicht nennt Daten, die sie ohne Anmeldung gar nicht hat');
}

// Angemeldet: genau ein Hoerer auf genau dem richtigen Pfad.
zaehler.refs.length = 0; zaehler.on = 0; zaehler.off = 0;
await A.signInGoogle();
C.mount();
ok(zaehler.refs.filter((p) => p === 'careerModel/users/u-1').length >= 1,
  `es wurde auf ${JSON.stringify(zaehler.refs)} gehoert statt auf careerModel/users/u-1`);
ok(zaehler.refs.every((p) => p.startsWith('careerModel/users/')),
  `die Ansicht greift ausserhalb ihres Pfads zu: ${JSON.stringify(zaehler.refs)}`);
ok(zaehler.on >= 1, 'es wurde gar kein Live-Hoerer gesetzt');

// Daten kommen an und werden ausgewertet.
if (zaehler.letzteRef && zaehler.letzteRef._cb) zaehler.letzteRef._cb({ val: () => ({
  areas: { a1: { name: 'Informatik', description: 'Testfeld' } },
  modules: { m1: { areaId: 'a1', title: 'Netzwerke', dayOrder: ['d1', 'd2', 'd3', 'd4'] },
             m2: { areaId: 'unbekannt', title: 'Waise', dayOrder: ['d1'] } },
  progress: { m1: { completedDays: { d1: true, d2: true } } },
}) });
ok(/Informatik/.test(gezeichnet), 'das Berufsfeld wird nicht angezeigt');
ok(/Netzwerke/.test(gezeichnet), 'das Modul wird nicht angezeigt');
ok(/50%/.test(gezeichnet), 'der Fortschritt (2 von 4 Tagen) wird falsch gerechnet');
ok(/2\/4 Tage/.test(gezeichnet), 'die Tageszahl fehlt');
ok(/Waise/.test(gezeichnet),
  'ein Modul ohne bekanntes Berufsfeld verschwindet stumm — dann fehlen Daten, ohne dass es jemand merkt');

// Ein Lesefehler wird gesagt, nicht verschluckt.
if (zaehler.letzteRef && zaehler.letzteRef._err) zaehler.letzteRef._err({ message: 'permission_denied' });
ok(/permission_denied/.test(gezeichnet), 'ein Zugriffsfehler wird verschluckt — die Ansicht bliebe leer ohne Grund');

// ═══ 4. ABMELDEN BEIM VERLASSEN (CLAUDE.md Fallstrick 4) ═══════════════
const offVorher = zaehler.off;
if (typeof C.unmount === 'function') C.unmount();
ok(zaehler.off > offVorher, 'unmount() loest den Live-Hoerer nicht — er rechnet in einer anderen Ansicht weiter');
{
  // Nach dem Verlassen darf ein nachlaufendes Ereignis NICHT mehr zeichnen.
  gezeichnet = 'FREMDE ANSICHT';
  try { if (zaehler.letzteRef && zaehler.letzteRef._cb) zaehler.letzteRef._cb({ val: () => ({ areas: { a9: { name: 'Zu spaet' } } }) }); } catch (e) {}
  ok(gezeichnet === 'FREMDE ANSICHT',
    'ein nachlaufendes Ereignis ueberschreibt den Inhalt einer bereits verlassenen Ansicht');
}

// Und die Schale ruft unmount ueberhaupt auf — sonst waere das alles totes Recht.
{
  const SHELL = ohneKommentare(lies('js/shell.js'));
  ok(/typeof v\.unmount === 'function'/.test(SHELL) || /unmount\s*===\s*'function'/.test(SHELL),
    'die Schale kennt kein unmount() — die Ansicht wird nie abgemeldet');
  const rv = SHELL.slice(SHELL.indexOf('function renderView'));
  ok(rv.indexOf('verlasseAnsicht()') > 0 && rv.indexOf('verlasseAnsicht()') < rv.indexOf('view.render('),
    'die vorige Ansicht wird nicht VOR dem Zeichnen der naechsten abgemeldet');
}

// ═══ 5. NUR LESEND ═════════════════════════════════════════════════════
const CAREER = ohneKommentare(lies('js/views/career.js'));
// Praezise: was mit der DATENBANK-REFERENZ gemacht wird. Ein gruenes
// gruppen.push([]) ist kein Schreibvorgang — die Regel darf nicht an
// gewoehnlichem Arrayspiel haengenbleiben, sonst wird sie irgendwann
// entnervt geloescht.
{
  const aufRef = [...CAREER.matchAll(/\bS\.ref\.(\w+)|\bdb\.ref\([^)]*\)\.(\w+)/g)]
    .map((m) => m[1] || m[2]).filter(Boolean);
  const erlaubt = new Set(['on', 'off']);
  const verboten = aufRef.filter((m) => !erlaubt.has(m));
  ok(verboten.length === 0,
    `die Career-Ansicht ruft ${JSON.stringify(verboten)} auf der Datenbankreferenz auf — ` +
    'geschrieben wird das Career Model in der Hauptapp, sonst gibt es eine zweite Merge-Frage');
  ok(aufRef.includes('on') && aufRef.includes('off'),
    `auf der Referenz laufen ${JSON.stringify(aufRef)} — erwartet mindestens on und off`);
}
ok(/careerModel\/users\/'\s*\+/.test(CAREER) || /careerModel\/users\/\$\{/.test(CAREER),
  'der Pfad wird nicht aus der Nutzerkennung gebildet');

// Und die App bleibt ohne Anmeldung benutzbar: der Kernabgleich haengt nicht daran.
{
  const STORE = ohneKommentare(lies('js/store.js'));
  ok(!/auth\.js|signInGoogle|currentUser/.test(STORE),
    'der Kernabgleich haengt jetzt an der Anmeldung — ohne Login waere die ganze App tot');
}

if (fehlend.size) {
  console.error('Fehlende Dateien: ' + [...fehlend].join(', '));
}
if (luecken.length) {
  console.error(`ANMELDUNG & CAREER MODEL — ${luecken.length} von ${checks} Pruefungen:`);
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`anmeldung & career model: ok (${checks} Pruefungen)`);
