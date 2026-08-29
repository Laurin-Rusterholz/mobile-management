/*
 * Eine Mail wird als Mail angezeigt — mit Bildern.
 *
 * BEFUND (Nutzer: „die formatierung von mail ist nicht korrekt in der mobile
 * version. die einzelnen mails werden komisch angezeigt und bilder laden
 * nicht"): der Rumpf einer geoeffneten Nachricht ging durch
 *     escHTML(body.text || htmlToText(body.html))
 * und landete in einem <div> mit white-space: pre-wrap. htmlToText() entfernt
 * ALLE Tags. Damit war jede HTML-Mail — also praktisch jede Rechnung, jeder
 * Newsletter, jede Mail mit Signatur — eine Wand aus Text: keine Absaetze,
 * keine Ueberschriften, keine Tabellen, keine Links. „Komisch" war kein
 * Stilproblem, sondern der Verzicht auf Darstellung ueberhaupt.
 *
 * Und die Bilder: <img> war unter den entfernten Tags — es gab also gar keine.
 * Selbst mit HTML waeren die eingebetteten nicht gekommen: sie stehen als
 * src="cid:…" darin, eine Verweisform, die KEIN Browser aufloest. Der Inhalt
 * liegt hinter /messages/<id>/attachments/<id> (der Gmail-Proxy laesst diesen
 * Pfad ausdruecklich zu) und muss geholt und als data:-URL eingesetzt werden.
 *
 * WAS HIER GEMESSEN WIRD — an der ECHTEN Ansicht, mit einer Attrappe des
 * Gmail-Proxys, ohne Browser und ohne Netz:
 *  1. Der Rumpf steht im Original, in einem abgeschotteten Rahmen.
 *  2. Der Rahmen kann kein Skript ausfuehren — auch dann nicht, wenn die Mail
 *     eines mitbringt. Das ist die Bedingung dafuer, dass Punkt 1 zulaessig ist.
 *  3. Eingebettete Bilder werden geholt und eingesetzt; das cid: verschwindet.
 *  4. Anhaenge lassen sich anfassen, eingebettete Bilder stehen nicht doppelt
 *     als Anhang darunter.
 *  5. Es gibt weiterhin einen Weg zum reinen Text.
 *  6. Der Rahmen bekommt eine Hoehe (ohne Skript darin misst er sich nicht
 *     selbst) und der Rumpf traegt kein pre-wrap mehr.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lies = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
// 1x1-PNG, damit ein echter Bild-Datenstrom durch die Aufloesung laeuft.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const MAIL_HTML = '<html><head><style>.x{color:red}</style></head><body>'
  + '<h1>Rechnung 2026-08</h1><p>Guten Tag <b>Laurin</b></p>'
  + '<table><tr><td>Position</td><td>CHF 42.00</td></tr></table>'
  + '<img src="cid:logo@quantus" alt="Logo">'
  + '<img src="https://example.com/tracker.gif" onerror="alert(1)">'
  + '<script>alert("boese")</script>'
  + '<a href="javascript:alert(2)">Klick</a>'
  + '</body></html>';

const VOLL = {
  id: 'm1', threadId: 't1', internalDate: String(Date.now()), labelIds: ['UNREAD'],
  snippet: 'Guten Tag Laurin',
  payload: {
    mimeType: 'multipart/related',
    headers: [
      { name: 'From', value: 'FlowerTech <buchhaltung@flowertech.example>' },
      { name: 'To', value: 'laurin@example.ch' },
      { name: 'Subject', value: 'Rechnung August' },
      { name: 'Date', value: 'Thu, 27 Aug 2026 08:15:00 +0200' },
    ],
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('Guten Tag Laurin\nRechnung 2026-08') } },
      { mimeType: 'text/html', body: { data: b64url(MAIL_HTML) } },
      { mimeType: 'image/png', filename: 'logo.png',
        headers: [{ name: 'Content-ID', value: '<logo@quantus>' }, { name: 'Content-Disposition', value: 'inline; filename="logo.png"' }],
        body: { attachmentId: 'att-logo', size: 120 } },
      { mimeType: 'application/pdf', filename: 'rechnung.pdf',
        headers: [{ name: 'Content-Disposition', value: 'attachment; filename="rechnung.pdf"' }],
        body: { attachmentId: 'att-pdf', size: 204800 } },
    ],
  },
};

// ── Umgebung ───────────────────────────────────────────────────────────────
const SPEICHER = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (SPEICHER.has(k) ? SPEICHER.get(k) : null),
  setItem: (k, v) => SPEICHER.set(k, String(v)), removeItem: (k) => SPEICHER.delete(k),
};
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };

const anfragen = [];
globalThis.fetch = async (url, init) => {
  const p = JSON.parse(init.body);
  anfragen.push(p);
  const antwort = (o) => ({ ok: true, status: 200, json: async () => o });
  if (p.path === '/users/me/messages') return antwort({ messages: [{ id: 'm1' }] });
  if (p.path === '/users/me/messages/m1' && p.query && p.query.format === 'metadata') {
    return antwort({ id: 'm1', threadId: 't1', internalDate: VOLL.internalDate, labelIds: ['UNREAD'],
      snippet: VOLL.snippet, payload: { headers: VOLL.payload.headers } });
  }
  if (p.path === '/users/me/messages/m1') return antwort(VOLL);
  if (p.path === '/users/me/messages/m1/attachments/att-logo') return antwort({ size: 120, data: PNG.replace(/\+/g, '-').replace(/\//g, '_') });
  if (p.path === '/users/me/messages/m1/attachments/att-pdf') return antwort({ size: 204800, data: b64url('%PDF-1.4') });
  return antwort({ ok: true });
};

// ── Die ECHTE Mail-Ansicht laden ───────────────────────────────────────────
const AKTIONEN = {};
const stubs = {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    formatDate: () => '27. Aug', formatTime: () => '08:15',
    openSheet: () => {}, closeSheet: () => {}, toast: () => {}, confirmPreview: async () => true,
    emptyState: (i, t, s2) => `<div class="empty">${t} ${s2 || ''}</div>`,
    skeletonList: () => '<div class="skel"></div>', haptic: () => {},
  },
  '../store.js': { state: { data: {} }, notify: () => {} },
  '../config.js': { getBaseUrl: () => 'https://management-xo2-pro.netlify.app', LS: { mailCache: 'qm-mail-cache' } },
  '../actions.js': { registerActions: (o) => Object.assign(AKTIONEN, o) },
  '../router.js': { navigate: () => {}, current: () => ({ route: 'mail', sub: null, params: {} }) },
  './common.js': { pageHeader: (t, s2, r) => `<h1>${t}</h1><p>${s2}</p>${r || ''}` },
  '../shell.js': { isTablet: () => false },
};
const quelle = lies('js/views/mail.js');
const ohneImporte = quelle.replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
  ok(Object.prototype.hasOwnProperty.call(stubs, pfad), `unbekannter Import: ${pfad}`);
  const namen = /\{([^}]*)\}/.exec(m);
  if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
  return `const ${/\*\s+as\s+(\w+)/.exec(m)[1]} = __stubs['${pfad}'];`;
});
const body = ohneImporte
  .replace(/^export (?:async )?function/gm, (m) => m.replace('export ', ''))
  .replace(/^export default/m, 'const __default =')
  + '\nreturn __default;';
const V = new Function('__stubs', body)(stubs);
ok(V && typeof V.render === 'function', 'die Mail-Ansicht hat kein render()');

// Liste laden, Nachricht oeffnen — beides ueber die echten Aktionen.
// Die Aktionen geben ihre Zusage nicht zurueck (der Klick-Weg braucht sie
// nicht) — hier wird deshalb auf das Ergebnis gewartet, nicht auf den Aufruf.
const ruhe = () => new Promise((r) => setTimeout(r, 30));
AKTIONEN['mail-refresh']();
await ruhe();
AKTIONEN['mail-open']({ id: 'm1' });
await ruhe();
const html = V.render();

// ═══ 1. DER RUMPF STEHT IM ORIGINAL ════════════════════════════════════════
ok(/class="mail-frame"/.test(html), 'DER BEFUND: die Nachricht steht wieder als entschaerfter Text statt als Mail');
ok(/srcdoc="/.test(html), 'der Rahmen bekommt keinen Inhalt');
const srcdoc = (/srcdoc="([\s\S]*?)"><\/iframe>/.exec(html) || [])[1] || '';
ok(srcdoc.length > 0, 'der Rahmen ist leer');
// Die Auszeichnung der Mail ueberlebt (im Attribut maskiert, im Rahmen echt).
for (const teil of ['&lt;h1&gt;', 'Rechnung 2026-08', '&lt;table&gt;', '&lt;b&gt;']) {
  ok(srcdoc.includes(teil), `die Mail verliert "${teil}" — die Formatierung ist wieder weg`);
}

// ═══ 2. DER RAHMEN KANN KEIN SKRIPT AUSFUEHREN ═════════════════════════════
const sandbox = (/sandbox="([^"]*)"/.exec(html) || [])[1] || '';
ok(sandbox.length > 0, 'der Rahmen ist gar nicht abgeschottet (kein sandbox-Attribut)');
ok(!/allow-scripts/.test(sandbox),
  'der Rahmen darf Skripte ausfuehren — dann liefe fremdes JavaScript aus jeder Mail, und zwar mit allow-same-origin');
ok(/script-src &#39;none&#39;|script-src &quot;none&quot;|script-src \x27none\x27/.test(srcdoc) || /script-src/.test(srcdoc),
  'im Rahmen fehlt die CSP als zweite Schranke');
ok(!/<script/i.test(srcdoc.replace(/&lt;/g, '<')) || !/&lt;script/i.test(srcdoc),
  'das <script> aus der Mail steht unveraendert im Rahmen');
ok(!/&lt;script/i.test(srcdoc), 'das <script> aus der Mail wurde nicht entfernt');
ok(!/onerror=/i.test(srcdoc), 'ein onerror-Handler aus der Mail hat ueberlebt');
ok(!/javascript:/i.test(srcdoc), 'ein javascript:-Link aus der Mail hat ueberlebt');
ok(/referrerpolicy="no-referrer"/.test(html), 'der Rahmen verraet beim Bilderladen die Herkunft');
ok(/&lt;base target=&quot;_blank&quot;&gt;/.test(srcdoc) || /base target/.test(srcdoc),
  'Links aus der Mail wuerden den Rahmen ersetzen statt sich zu oeffnen');

// ═══ 3. EINGEBETTETE BILDER SIND DA ════════════════════════════════════════
ok(!/cid:logo@quantus/.test(srcdoc),
  'DER ZWEITE BEFUND: der cid:-Verweis steht noch im Rumpf — kein Browser loest ihn auf, das Bild bleibt leer');
ok(srcdoc.includes('data:image/png;base64,'), 'das eingebettete Bild wurde nicht als data:-URL eingesetzt');
ok(srcdoc.includes(PNG.slice(0, 40)), 'die eingesetzten Bilddaten sind nicht die geladenen');
ok(anfragen.some(a => a.path === '/users/me/messages/m1/attachments/att-logo'),
  'der Anhang mit dem Bild wurde nie geholt');
// Das entfernte Bild bleibt ein entferntes Bild — es wird nicht mitgeholt.
ok(srcdoc.includes('https://example.com/tracker.gif'), 'ein entferntes Bild wurde aus der Mail entfernt');
ok(/img-src[^&]*https:/.test(srcdoc), 'die CSP des Rahmens laesst gar keine Bilder zu');

// ═══ 4. ANHAENGE ═══════════════════════════════════════════════════════════
ok(/data-action="mail-attachment"/.test(html), 'Anhaenge sind weiterhin nur Namen ohne Griff');
ok(/data-att="att-pdf"/.test(html), 'der PDF-Anhang fehlt');
ok(!/data-att="att-logo"/.test(html),
  'das eingebettete Logo steht zusaetzlich als Anhang darunter — es ist bereits im Rumpf zu sehen');
ok(/rechnung\.pdf/.test(html), 'der Name des Anhangs fehlt');
ok(/200 KB|204800/.test(html), 'die Groesse des Anhangs fehlt');
ok(typeof AKTIONEN['mail-attachment'] === 'function', 'die Aktion mail-attachment ist nicht registriert');

// ═══ 5. WEG ZUM REINEN TEXT ════════════════════════════════════════════════
ok(typeof AKTIONEN['mail-plain'] === 'function', 'es gibt keinen Umschalter auf reinen Text');
AKTIONEN['mail-plain']();
const textHtml = V.render();
ok(!/class="mail-frame"/.test(textHtml), 'der Umschalter auf reinen Text wirkt nicht');
ok(/class="mail-plaintext"/.test(textHtml), 'der reine Text bekommt keinen eigenen Kasten');
ok(/Rechnung 2026-08/.test(textHtml), 'im Textmodus fehlt der Inhalt der Mail');
ok(!/&lt;h1&gt;/.test(textHtml), 'im Textmodus stehen die rohen Tags der Mail');
AKTIONEN['mail-plain']();
ok(/class="mail-frame"/.test(V.render()), 'zurueck zum Original geht nicht');

// ═══ 6. HOEHE UND CSS ══════════════════════════════════════════════════════
ok(/fitMailFrames/.test(quelle), 'niemand gibt dem Rahmen eine Hoehe — ohne Skript darin misst er sich nicht selbst');
ok(/scrollHeight/.test(quelle), 'die Hoehe wird nicht am Inhalt gemessen');
ok(/addEventListener\('load'/.test(quelle), 'die Hoehe wird nicht nachgefuehrt, wenn die Bilder eintreffen');
ok(/mount\(root\)[\s\S]*fitMailFrames\(root\)/.test(quelle), 'fitMailFrames wird beim Anzeigen nicht gerufen');
{
  const css = lies('css/apps.css').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/\.mail-frame\s*\{[^}]*width:\s*100%/.test(css), 'der Rahmen fuellt die Breite nicht');
  ok(/\.mail-frame\s*\{[^}]*border/.test(css), 'der Rahmen hat keinen Rand — die Mail franst in die App aus');
  ok(!/\.mail-body\s*\{[^}]*pre-wrap/.test(css),
    'der Rumpf traegt weiterhin white-space: pre-wrap — um den Rahmen entstuenden dadurch Luecken');
  ok(/\.mail-plaintext\s*\{[^}]*pre-wrap/.test(css), 'der reine Text verliert seine Zeilenumbrueche');
}

// Der Proxy-Pfad muss erlaubt sein — sonst kaeme das Bild nie an. Gegen die
// ECHTE Whitelist der Hauptapp geprueft, wenn sie danebenliegt.
{
  const fn = (() => { try { return fs.readFileSync(path.join(path.dirname(root), 'ai-sync/netlify/functions/gmail-api.mjs'), 'utf8'); } catch (e) { return ''; } })();
  if (fn) ok(/attachments/.test(fn), 'der Gmail-Proxy laesst den Anhang-Pfad nicht mehr durch — Bilder koennen nicht geladen werden');
  else ok(true, '(ai-sync nicht danebenliegend — Pfadpruefung uebersprungen)');
}

if (luecken.length) {
  console.error(`MAIL-DARSTELLUNG — ${luecken.length} von ${checks} Pruefungen:`);
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`mail-darstellung: ok (${checks} Pruefungen)`);
