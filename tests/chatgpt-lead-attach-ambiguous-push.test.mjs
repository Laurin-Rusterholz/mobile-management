/*
 * Review vor Merge (PR14, Laurin Rusterholz): der bestehende No-Resurrection-
 * Nachweis (chatgpt-lead-attach-no-resurrection.test.mjs) deckt nur einen
 * unabhaengig gequeuten Anhang und ein identisches Replay OHNE zwischen-
 * zeitliche Loeschung ab — nicht den eigentlich offenen Fall: "Ein Push kann
 * serverseitig erfolgreich sein, waehrend seine Antwort/Bestaetigung
 * verloren geht; dann bleibt der Attach-Intent pending, ein anderes Geraet
 * sieht und loescht die Datei, danach replayt das erste Geraet sie."
 * ---------------------------------------------------------------------------
 * Fix (pushData()/applyPendingChanges(), js/store.js): ein Netzwerkfehler
 * beim Push loest jetzt SOFORT einen Nach-Pull aus (statt bis zum naechsten,
 * ganz unabhaengigen Sync-Ereignis zu warten). applyPendingChanges() prueft
 * VOR jedem Replay, ob die Datei eines gequeuten attach-chatgptLead-file-
 * Versuchs im FRISCH gepullten Bestand schon vorhanden ist — falls ja, wird
 * der Versuch als erledigt ausgesondert, statt ihn (nach einer zwischen-
 * zeitlichen Loeschung womoeglich wiederauferstehend) erneut abzuspielen.
 *
 * Das schliesst die Luecke NICHT vollstaendig: wird die Datei GENAU IN DEM
 * Zeitfenster zwischen dem ambiguen Schreiben und diesem Nach-Pull von einem
 * anderen Geraet geloescht, sieht auch dieser Pull sie nicht mehr — der
 * verbleibende Test unten (2) dokumentiert das ehrlich, statt es zu
 * verstecken. Ein vollstaendiger Ausschluss braucht einen echten Anhangs-
 * Grabstein, den es auf keinem der drei Clients gibt (Folgearbeit).
 *
 * Beide Tests treiben die ECHTEN Funktionen aus js/store.js
 * (applyPendingChanges/pullData/applyOp/replayPendingOperations) gegen einen
 * lokalen HTTP-Server und einen In-Memory-localStorage-Stub.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

// ── In-Memory-localStorage (Node kennt keine echte, deterministische Fassung) ─
function speicher() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// ── Minimaler DOM-Stub: store.js ruft bei jedem Push/Pull-Fehlschlag toast()
// auf (js/util.js), das echte DOM-Elemente anlegt — ohne Stub stuerzt ein
// zwischen den Testfaellen ausgeloester Hintergrund-Push (siehe unten) den
// gesamten Node-Prozess ab (unbehandelte Ausnahme in einem setTimeout-
// Callback), statt nur den erwarteten Fehler zu protokollieren.
function domStub() {
  const elStub = () => ({ classList: { add() {}, remove() {} }, remove() {}, appendChild() {}, content: null });
  const t = elStub(); t.content = { firstElementChild: elStub() };
  return {
    querySelector: () => null,
    createElement: () => t,
    body: { appendChild() {} },
  };
}
globalThis.document = domStub();
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

function startHttp(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
function sendJson(res, status, obj, etag) {
  const body = JSON.stringify(obj);
  const headers = { 'content-type': 'application/json' };
  if (etag) headers.etag = etag;
  res.writeHead(status, headers);
  res.end(body);
}
// pullData() kann in seinem finally-Block einen eigenen Folge-Push per
// setTimeout(fn, 0) anstossen (Notiz-Migration bzw. ein weiterhin gequeuter
// Versuch). Das ist ECHTES, hier bewusst mitgetestetes Verhalten — der
// Server bleibt deshalb bis nach diesem Tick offen, statt sofort zu
// schliessen (sonst nur Rauschen: "connection refused" fuer einen
// Hintergrund-Aufruf, den kein Testfall prueft).
const naechsterTick = () => new Promise((r) => setTimeout(r, 20));

const LEAD_ID = 'l1';
const FILE_ID = 'f_b';
const fileObj = { id: FILE_ID, name: 'b.pdf', originalName: 'b.pdf', size: 100, type: 'application/pdf', storagePath: 'x', url: 'https://x/b', uploadedAt: '2026-09-25T10:00:00.000Z' };

function bestand(mitDatei) {
  return {
    // notes/notebooks/books/ideas leer, aber VORHANDEN: sonst haelt
    // migrateNotesData() den Pull faelschlich fuer migrationsbeduerftig und
    // pushData() startet nach dem Pull einen eigenen, hier ungewollten
    // Schreibvorgang (nowISO()/toast() sind in diesem Node-Test nicht das,
    // was hier geprueft werden soll).
    entities: {
      chatgptLeads: { [LEAD_ID]: { id: LEAD_ID, title: 'x', rawInput: 'x', status: 'neu', files: mitDatei ? [fileObj] : [], updatedAt: '2026-09-25T10:00:00.000Z' } },
      notes: {}, notebooks: {}, books: {}, ideas: {},
    },
    meta: {},
  };
}

// Ein frisches, isoliertes store.js-Modul je Test — verschiedene globalThis-
// Zustaende (localStorage/fetch) duerfen sich nicht zwischen den beiden
// Testfaellen vermischen.
async function ladeStore() {
  globalThis.window = globalThis.window || {};
  return import('../js/store.js?t=' + Math.random());
}
const { LS } = await import('../js/config.js');

// ── 1. Die Mitigation greift: der Nach-Pull sieht die Datei noch (der
//      ambige Push landete tatsaechlich), der Versuch wird ausgesondert —
//      eine SPAETERE Loeschung (nach der Aussonderung) kann ihn dann nicht
//      mehr wiederaufleben lassen ──────────────────────────────────────────
{
  globalThis.localStorage = speicher();
  const store = await ladeStore();

  // Simuliert: attach-chatgptLead-file wurde bereits lokal angewendet UND
  // steht noch in der Pending-Queue (so, als waere der Push gerade
  // ambig fehlgeschlagen — die Antwort ging verloren, der Schreibvorgang kam
  // aber tatsaechlich an, s. u.).
  const op = store.preparePendingOp({ type: 'attach-chatgptLead-file', payload: { id: LEAD_ID, file: fileObj } });
  globalThis.localStorage.setItem('qm-pending-changes', JSON.stringify([op]));

  // Erster Pull: der Server hat die Datei (der ambige Push landete). Die
  // Mitigation muss den Versuch jetzt aus der Warteschlange nehmen.
  const serverMitDatei = await startHttp((req, res) => sendJson(res, 200, bestand(true), 'etag-1'));
  globalThis.localStorage.setItem(LS.baseUrl, serverMitDatei.base);
  store.state.data = null; store.state.pending = []; store.state.initialPullDone = false; store.state.etag = null;
  await store.pullData(true);
  await naechsterTick();
  await serverMitDatei.close();

  ok(store.pendingCount() === 0, `ein bereits angekommener Anhang-Versuch wird nicht aus der Warteschlange entfernt: ${store.pendingCount()} verbleiben`);
  ok(store.getById('chatgptLead', LEAD_ID).files.some((f) => f.id === FILE_ID), 'die Datei fehlt nach dem Pull im lokalen Bestand');

  // Ein anderes Geraet loescht die Datei jetzt (NACH der Aussonderung) —
  // ein weiterer Pull darf sie NICHT wiederherstellen, denn die Warteschlange
  // ist bereits leer.
  const serverOhneDatei = await startHttp((req, res) => sendJson(res, 200, bestand(false), 'etag-2'));
  globalThis.localStorage.setItem(LS.baseUrl, serverOhneDatei.base);
  await store.pullData(true);
  await naechsterTick();
  await serverOhneDatei.close();
  ok(!store.getById('chatgptLead', LEAD_ID).files.some((f) => f.id === FILE_ID),
    'eine spaetere, echte Loeschung wird durch einen bereits ausgesonderten Anhang-Versuch wieder rueckgaengig gemacht');
}

// ── 2. Verbleibende, dokumentierte Luecke: die Datei wird GENAU IM
//      Zeitfenster zwischen dem ambigen Schreiben und dem allerersten
//      Nach-Pull von einem anderen Geraet geloescht — dieser Pull sieht sie
//      deshalb nicht mehr, der Versuch bleibt offen und wird beim Replay
//      wiederhergestellt. Ohne einen echten Anhangs-Grabstein (den keiner
//      der drei Clients hat) ist das aus dem Attach-Versuch selbst heraus
//      nicht unterscheidbar von "kam nie an" — dieser Test dokumentiert die
//      Grenze ehrlich, statt sie zu verstecken (Review-Vorgabe: "noch nicht
//      als vollstaendigen Nachweis abschliessen") ───────────────────────────
{
  globalThis.localStorage = speicher();
  const store = await ladeStore();

  const op = store.preparePendingOp({ type: 'attach-chatgptLead-file', payload: { id: LEAD_ID, file: fileObj } });
  globalThis.localStorage.setItem('qm-pending-changes', JSON.stringify([op]));

  // Der ambige Push landete TATSAECHLICH (Server hat die Datei), aber ein
  // anderes Geraet hat sie bereits geloescht, BEVOR dieses Geraet ueberhaupt
  // zum ersten Mal nachpruefen konnte — der erste sichtbare Zustand ist
  // deshalb schon "Datei fehlt".
  const server = await startHttp((req, res) => sendJson(res, 200, bestand(false), 'etag-1'));
  globalThis.localStorage.setItem(LS.baseUrl, server.base);
  store.state.data = null; store.state.pending = []; store.state.initialPullDone = false; store.state.etag = null;
  await store.pullData(true);
  await naechsterTick();
  await server.close();

  // Bekannte, dokumentierte Grenze: der Versuch wird repliziert und
  // resurrectiert die geloeschte Datei — ohne echten Grabstein nicht
  // unterscheidbar von einem Versuch, der nie ankam.
  ok(store.getById('chatgptLead', LEAD_ID).files.some((f) => f.id === FILE_ID),
    'FEHLERANNAHME NICHT MEHR GUELTIG: bitte diesen Test aktualisieren, falls ein echter Anhangs-Grabstein diese Luecke inzwischen schliesst');
}

if (luecken.length) { console.error('FEHLER:\n- ' + luecken.join('\n- ')); process.exit(1); }
console.log(`chatgpt-lead-attach-ambiguous-push (Handy): ok (${checks} Pruefungen)`);
