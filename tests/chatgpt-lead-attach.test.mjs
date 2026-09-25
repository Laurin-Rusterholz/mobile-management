/*
 * Dokument an einen ChatGPT-Lead anhaengen (Handy) — Nachtrag 24.09.2026.
 * ---------------------------------------------------------------------------
 * Vorher bewusst NICHT gebaut (siehe Kopfkommentar-Historie in
 * js/views/chatgpt.js): Firebase Storage verlangt fuer JEDEN Zugriff
 * request.auth != null, aber die kompakte ChatGPT-Erfassung loeste nie eine
 * Anmeldung aus — ein Upload waere reproduzierbar mit storage/unauthorized
 * gescheitert. Der App-Besitzer hat entschieden: attachDocumentToLead() darf
 * den bestehenden Google-Login (js/auth.js, schon fuers Career Model da)
 * sichtbar anbieten, statt die Funktion wegzulassen. Kein neues Credential,
 * keine geaenderte Storage-Regel.
 *
 * Dieser Test fuehrt die ECHTE Funktion aus js/views/chatgpt.js gegen einen
 * Store- UND einen Auth/Storage-Stub aus (kein reiner Quelltext-Musterabgleich):
 *   · nicht angemeldet -> signInGoogle wird ausgeloest, danach laeuft der
 *     Upload durch;
 *   · bereits angemeldet -> signInGoogle wird NICHT aufgerufen;
 *   · abgebrochene/fehlgeschlagene Anmeldung -> kein Upload, kein performOp;
 *   · zu grosse Datei -> abgelehnt, bevor ueberhaupt eine Anmeldung versucht wird;
 *   · fehlgeschlagener Upload -> ehrlicher Fehler, keine erfundene Erfolgsmeldung;
 *   · Erfolg -> exaktes Dateiobjekt-Schema wie Desktop/Tablet, echter
 *     attachments/<kind>/<id>/<fileId>_<name>-Pfad, bestehende Anhaenge bleiben
 *     erhalten (kein Ueberschreiben der files-Liste).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

globalThis.document = { addEventListener() {}, getElementById: () => null, createElement: () => ({ set innerHTML(v) { this._html = v; }, firstElementChild: null }) };

// ── Fixture-Entitaeten + ein Store-Stub, der Operationen ECHT anwendet ──────
const ENT = { chatgptLeads: {
  l1: { id: 'l1', title: 'Bestehender Lead', rawInput: 'x', status: 'neu', files: [] },
  l2: { id: 'l2', title: 'Mit Anhang', rawInput: 'x', status: 'neu', files: [{ id: 'f_alt', name: 'alt.pdf', url: 'https://x/alt.pdf' }] },
} };
const KIND = { chatgptLead: 'chatgptLeads' };
const protokoll = { ops: [], toasts: [], notified: 0 };
function applyFakeOp(op) {
  // Review-Fix (25.09.2026): attachDocumentToLead() schreibt den Anhang nicht
  // mehr als vollstaendiges Ersatz-Array (verb "update"), sondern ueber eine
  // eigene Union-Operation — dieselbe Semantik wie applyOp() in store.js
  // (union nach Datei-Id, gegen den TATSAECHLICH aktuellen Stand, nicht gegen
  // einen client-seitig vorberechneten Schnappschuss).
  if (op.type === 'attach-chatgptLead-file') {
    const cur = ENT.chatgptLeads[op.payload.id];
    if (!cur) return;
    const bestehende = Array.isArray(cur.files) ? cur.files : [];
    const neueDatei = op.payload.file;
    if (neueDatei && neueDatei.id && !bestehende.some((f) => f && f.id === neueDatei.id)) {
      cur.files = [...bestehende, neueDatei];
    }
    return;
  }
  const [verb, ...rest] = String(op.type || '').split('-');
  const collName = KIND[rest.join('-')];
  if (!collName) return;
  const coll = ENT[collName];
  const cur = coll[op.payload.id];
  if (verb === 'update' && cur) Object.assign(cur, op.payload);
}

// ── Auth-Stub mit veraenderlichem Anmeldezustand ────────────────────────────
let signedIn = false;
let signInCalls = 0;
let signInResult = { ok: true };
const authStub = {
  initAuth: () => {},
  sdkBereit: () => true,
  currentUser: () => (signedIn ? { uid: 'u1' } : null),
  signInGoogle: async () => { signInCalls++; const r = signInResult; if (r.ok && !r.weitergeleitet) signedIn = true; return r; },
};

// ── Storage-Stub ─────────────────────────────────────────────────────────
const storageState = { uploads: [], shouldFail: false };
globalThis.window = {
  firebase: {
    storage: () => ({
      ref(p) {
        return {
          async put(file) {
            storageState.uploads.push({ path: p, file });
            if (storageState.shouldFail) throw new Error('network-fail');
            return { ref: { getDownloadURL: async () => 'https://storage.test/' + p } };
          },
        };
      },
    }),
  },
};

const stubs = {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s),
    formatDate: (v) => String(v || '').slice(0, 10),
    newId: (k) => k + '_neu',
    nowISO: () => '2026-09-24T12:00:00.000Z',
    todayYmd: () => '2026-09-24',
    toast: (t, k) => protokoll.toasts.push(k + ':' + t),
  },
  '../store.js': {
    state: { data: { chatgptNotesMeta: {} } },
    getCollection: (name) => Object.values(ENT[name] || {}),
    getById: (kind, id) => (ENT[KIND[kind] || kind] || {})[id] || null,
    performOp: async (op) => { protokoll.ops.push(op); applyFakeOp(op); },
    notify: () => { protokoll.notified++; },
  },
  '../actions.js': { registerActions: () => {} },
  './common.js': { pageHeader: () => '', segmented: () => '' },
  '../auth.js': authStub,
};

function ladeModul(datei, stubMap) {
  const quelle = fs.readFileSync(path.join(root, datei), 'utf8');
  const exporte = {};
  const ohneImporte = quelle
    .replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
      ok(Object.prototype.hasOwnProperty.call(stubMap, pfad), `unbekannter Import in ${datei}: ${pfad}`);
      const namen = /\{([^}]*)\}/.exec(m);
      if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
      const stern = /\*\s+as\s+(\w+)/.exec(m);
      return `const ${stern[1]} = __stubs['${pfad}'];`;
    })
    .replace(/^export (async )?function (\w+)/gm, (m, a, name) => `${a || ''}function ${name}`)
    .replace(/^export default/m, '__exporte.default =');
  const namen = [...quelle.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  new Function('__stubs', '__exporte', 'window', ohneImporte + '\n' + namen.map((n) => `__exporte.${n} = ${n};`).join('\n'))(stubMap, exporte, globalThis.window);
  return exporte;
}

const exporte = ladeModul('js/views/chatgpt.js', stubs);
ok(typeof exporte.attachDocumentToLead === 'function', 'attachDocumentToLead ist nicht exportiert');

const datei = (extra = {}) => Object.assign({ name: 'vertrag.pdf', size: 1024, type: 'application/pdf' }, extra);

// ── 1. Unbekannter Lead ─────────────────────────────────────────────────────
{
  const res = await exporte.attachDocumentToLead('gibt-es-nicht', [datei()]);
  ok(res.ok === false, 'ein unbekannter Lead liefert ok:true');
  ok(signInCalls === 0, 'fuer einen unbekannten Lead wird trotzdem eine Anmeldung versucht');
}

// ── 2. Zu grosse Datei wird VOR jeder Anmeldung abgelehnt ───────────────────
{
  const res = await exporte.attachDocumentToLead('l1', [datei({ size: 60 * 1024 * 1024 })]);
  ok(res.ok === false, 'eine 60-MB-Datei wird nicht abgelehnt');
  ok(signInCalls === 0, 'eine zu grosse Datei loest trotzdem eine Anmeldung aus');
  ok(storageState.uploads.length === 0, 'eine zu grosse Datei wird trotzdem hochgeladen');
}

// ── 3. Nicht angemeldet: signInGoogle wird ausgeloest, Upload laeuft danach ─
{
  signedIn = false; signInCalls = 0; signInResult = { ok: true };
  const vor = protokoll.ops.length;
  const res = await exporte.attachDocumentToLead('l1', [datei()]);
  ok(signInCalls === 1, 'ohne bestehende Anmeldung wird signInGoogle nicht genau einmal aufgerufen');
  ok(res.ok === true, 'der Upload nach erfolgreicher Anmeldung schlaegt fehl: ' + (res.grund || ''));
  ok(storageState.uploads.length === 1, 'es wurde nicht genau einmal hochgeladen');
  ok(storageState.uploads[0].path === 'attachments/chatgptLead/l1/f_neu_vertrag.pdf',
    `der Speicherpfad weicht von der Desktop/Tablet-Konvention ab: ${storageState.uploads[0].path}`);
  const ops = protokoll.ops.slice(vor);
  ok(ops.length === 1 && ops[0].type === 'attach-chatgptLead-file', 'der Upload schreibt keine attach-chatgptLead-file-Operation');
  const f = ENT.chatgptLeads.l1.files[0];
  ok(!!f, 'die Datei wurde nicht in lead.files eingetragen');
  ok(f.id === 'f_neu' && f.name === 'vertrag.pdf' && f.originalName === 'vertrag.pdf' && f.size === 1024 && f.type === 'application/pdf', 'das Dateiobjekt weicht vom Desktop/Tablet-Schema ab');
  ok(f.storagePath === 'attachments/chatgptLead/l1/f_neu_vertrag.pdf', 'storagePath fehlt/weicht ab');
  ok(f.url === 'https://storage.test/attachments/chatgptLead/l1/f_neu_vertrag.pdf', 'url fehlt/weicht ab');
  ok(!!f.uploadedAt, 'uploadedAt fehlt');
}

// ── 4. Bereits angemeldet: signInGoogle wird NICHT aufgerufen ───────────────
{
  signedIn = true; signInCalls = 0;
  storageState.uploads = [];
  const res = await exporte.attachDocumentToLead('l1', [datei({ name: 'zweite.pdf' })]);
  ok(res.ok === true, 'der Upload bei bestehender Anmeldung schlaegt fehl');
  ok(signInCalls === 0, 'eine bestehende Anmeldung loest trotzdem signInGoogle aus');
}

// ── 5. Bestehende Anhaenge bleiben erhalten (kein Ueberschreiben) ───────────
{
  signedIn = true;
  const res = await exporte.attachDocumentToLead('l2', [datei({ name: 'neu.pdf' })]);
  ok(res.ok === true, 'der Upload auf einen Lead mit bestehendem Anhang schlaegt fehl');
  const namen = ENT.chatgptLeads.l2.files.map((f) => f.name).sort().join(',');
  ok(namen === 'alt.pdf,neu.pdf', `bestehende Anhaenge gehen beim Hinzufuegen verloren: ${namen}`);
}

// ── 6. Abgebrochene Anmeldung: kein Upload, kein performOp ──────────────────
{
  signedIn = false; signInCalls = 0; signInResult = { ok: false, abgebrochen: true };
  storageState.uploads = [];
  const vor = protokoll.ops.length;
  const res = await exporte.attachDocumentToLead('l1', [datei({ name: 'abbruch.pdf' })]);
  ok(res.ok === false, 'eine abgebrochene Anmeldung fuehrt trotzdem zu ok:true');
  ok(storageState.uploads.length === 0, 'trotz abgebrochener Anmeldung wurde hochgeladen');
  ok(protokoll.ops.length === vor, 'trotz abgebrochener Anmeldung wurde eine Operation geschrieben');
}

// ── 7. Fehlgeschlagene Anmeldung (kein Popup-Abbruch, echter Fehler) ────────
{
  signedIn = false; signInCalls = 0; signInResult = { ok: false, grund: 'Netzwerkfehler' };
  const res = await exporte.attachDocumentToLead('l1', [datei()]);
  ok(res.ok === false && /Netzwerkfehler/.test(res.grund || ''), 'der echte Anmeldefehler wird nicht durchgereicht');
}

// ── 8. Weiterleitung statt Popup: kein stiller "Erfolg" ─────────────────────
{
  signedIn = false; signInCalls = 0; signInResult = { ok: true, weitergeleitet: true };
  const res = await exporte.attachDocumentToLead('l1', [datei()]);
  ok(res.ok === false, 'eine Weiterleitung zur Anmeldung meldet faelschlich ok:true, bevor der Upload wirklich lief');
}

// ── 9. Fehlgeschlagener Upload nach erfolgreicher Anmeldung ─────────────────
{
  signedIn = true; storageState.shouldFail = true;
  const vor = protokoll.ops.length;
  const res = await exporte.attachDocumentToLead('l1', [datei({ name: 'kaputt.pdf' })]);
  ok(res.ok === false && /network-fail/.test(res.grund || ''), 'ein fehlgeschlagener Upload wird nicht ehrlich gemeldet');
  ok(protokoll.ops.length === vor, 'trotz fehlgeschlagenem Upload wurde eine Operation geschrieben — erfundener Erfolg');
  storageState.shouldFail = false;
}

// ── 10. Review-Fix (25.09.2026): zwei Anhaenge an DENSELBEN Lead ueberlappen
//        sich waehrend des asynchronen Logins/Uploads — VORHER las
//        attachDocumentToLead() l.files EINMAL ganz am Anfang und schrieb am
//        Ende ein vollstaendiges Ersatz-Array; der zweite, waehrenddessen
//        gestartete Anhang haette den ersten beim Zurueckschreiben still
//        ueberschrieben (klassischer verlorener Schreibvorgang). Jetzt
//        unioniert die eigene attach-chatgptLead-file-Operation gegen den
//        TATSAECHLICH aktuellen Stand zum Zeitpunkt jedes einzelnen
//        performOp()-Aufrufs — beide Anhaenge muessen erhalten bleiben. ─────
{
  const ENT2 = { chatgptLeads: { l1: { id: 'l1', title: 'x', rawInput: 'x', status: 'neu', files: [] } } };
  function applyFakeOp2(op) {
    if (op.type !== 'attach-chatgptLead-file') return;
    const cur = ENT2.chatgptLeads[op.payload.id];
    if (!cur) return;
    const bestehende = Array.isArray(cur.files) ? cur.files : [];
    const neueDatei = op.payload.file;
    if (neueDatei && neueDatei.id && !bestehende.some((f) => f && f.id === neueDatei.id)) cur.files = [...bestehende, neueDatei];
  }
  let idZaehler = 0;
  let freigeben;
  const wartepunkt = new Promise((resolve) => { freigeben = resolve; });
  let signedIn2 = false;
  const stubs2 = {
    ...stubs,
    '../util.js': { ...stubs['../util.js'], newId: (k) => k + '_wettlauf_' + (++idZaehler) },
    '../store.js': {
      state: { data: { chatgptNotesMeta: {} } },
      getCollection: (name) => Object.values(ENT2[name] || {}),
      getById: (kind, id) => (ENT2[KIND[kind] || kind] || {})[id] || null,
      performOp: async (op) => { applyFakeOp2(op); },
      notify: () => {},
    },
    '../auth.js': {
      initAuth: () => {},
      sdkBereit: () => true,
      currentUser: () => (signedIn2 ? { uid: 'u1' } : null),
      // Beide ueberlappenden Aufrufe haengen HIER gleichzeitig, bis
      // freigeben() unten beide zeitgleich weiterlaufen laesst — simuliert
      // exakt den gemeldeten Fall: der zweite Anhang startet, WAEHREND der
      // erste noch im asynchronen Login/Upload steckt.
      signInGoogle: async () => { await wartepunkt; signedIn2 = true; return { ok: true }; },
    },
  };
  const exporte2 = ladeModul('js/views/chatgpt.js', stubs2);
  const p1 = exporte2.attachDocumentToLead('l1', [datei({ name: 'a.pdf' })]);
  const p2 = exporte2.attachDocumentToLead('l1', [datei({ name: 'b.pdf' })]);
  freigeben();
  const [r1, r2] = await Promise.all([p1, p2]);
  ok(r1.ok === true && r2.ok === true, `beide ueberlappenden Anhaenge muessten gelingen: ${JSON.stringify({ r1, r2 })}`);
  const namen2 = ENT2.chatgptLeads.l1.files.map((f) => f.name).sort().join(',');
  ok(namen2 === 'a.pdf,b.pdf', `ein waehrend des Logins/Uploads gleichzeitig gestarteter zweiter Anhang geht verloren (alter Bug: stale l.files-Snapshot): ${namen2}`);
}

if (luecken.length) { console.error('FEHLER:\n- ' + luecken.join('\n- ')); process.exit(1); }
console.log(`chatgpt-lead-attach (Handy): ok (${checks} Pruefungen)`);
