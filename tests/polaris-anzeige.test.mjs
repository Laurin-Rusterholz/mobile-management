/*
 * Polaris wird auf dem Handy falsch angezeigt.
 *
 * VIER BEFUNDE (Chromium, iPhone-13-Ansicht 390x664, nachgemessen):
 *
 * 1. DER SENDEKNOPF WAR NICHT ERREICHBAR. Der schwebende „Neu"-Knopf (FAB)
 *    sass bei x 314..372 / y 530..588, der Sendeknopf ➤ bei x 330..378 /
 *    y 549..592 — der ＋ lag komplett darauf. Wer auf „Senden" tippte,
 *    oeffnete das Neu-Menue. Der Chat hat sein „＋ Neu" in der Kopfzeile;
 *    auf dieser Route braucht es den schwebenden Knopf gar nicht.
 *
 * 2. DIE SEITE SCROLLTE 84 px WEG. .chat-view rechnete seine Hoehe selbst
 *    (100dvh minus Leisten = 548 px), .content legte darunter aber weiter
 *    sein Polster von 146 px (Tab-Leiste + Platz fuer den FAB). Zusammen
 *    694 px in einem 610 px hohen Feld: die ganze Seite bekam einen
 *    Scrollweg, die Eingabezeile wanderte beim Wischen aus dem Bild.
 *
 * 3. DER SICHERE RAND ZAEHLTE DOPPELT. Die Hoehe zog --safe-bottom ab, die
 *    Eingabezeile polsterte ihn noch einmal — auf einem Geraet mit
 *    Aussparung ein leerer Streifen von 34 px in der Zeile.
 *
 * 4. ANTWORTEN STANDEN ALS ROHTEXT DA. Polaris antwortet in Markdown. Die
 *    Ansicht schickte den Text durch escHTML und sonst nichts: „**Faellig
 *    morgen**", „- Punkt", „### Ueberschrift" Zeichen fuer Zeichen. Dazu
 *    fehlte .chat-msg ein Umbruch fuer lange Woerter — eine URL ohne
 *    Leerzeichen schob die Blase aus dem Bild.
 *
 * Dazu zwei Dinge, die der Neuaufbau der Ansicht verschluckte: die Shell
 * rendert bei JEDER Datenaenderung neu (store.subscribe -> renderView), und
 * waehrend Polaris auf eine Antwort wartet, faellt so ein Neuaufbau
 * garantiert an (60-Sekunden-Abgleich, eigener Push, 412-Konflikt). Danach
 * war die Blase „Polaris denkt…" weg und das Eingabefeld leer.
 *
 * Geprueft wird gegen die ausgelieferten Dateien: das CSS wird geparst und
 * ausgerechnet, formatMessage laeuft als ECHTE Funktion aus polaris.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const base = fs.readFileSync(path.join(root, 'css/base.css'), 'utf8');
const comp = fs.readFileSync(path.join(root, 'css/components.css'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'js/shell.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'js/views/polaris.js'), 'utf8');

// ── Kleiner CSS-Zugriff (wie in layout-spacing.test.mjs) ───────────────
function regel(css, selektor) {
  const rein = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp('(?:^|[,}])\\s*' + selektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  const m = re.exec(rein);
  return m ? m[1] : null;
}
function eig(css, selektor, name) {
  const r = regel(css, selektor);
  if (r == null) return null;
  const m = new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)', 'i').exec(r);
  return m ? m[1].trim() : null;
}
function px(ausdruck, tokens) {
  if (ausdruck == null) return NaN;
  let t = String(ausdruck).trim();
  for (const [k, v] of Object.entries(tokens)) t = t.split(`var(${k})`).join(String(v));
  t = t.replace(/calc\(/g, '(').replace(/px/g, '');
  if (!/^[-+*/(). \d]+$/.test(t)) return NaN;
  try { return Function('"use strict";return (' + t + ')')(); } catch (e) { return NaN; }
}
const TOKENS = {
  '--appbar-h': px(eig(base, ':root', '--appbar-h'), {}),
  '--tabbar-h': px(eig(base, ':root', '--tabbar-h'), {}),
  '--safe-top': 0,
  '--safe-bottom': 34,          // Geraet MIT Aussparung: nur so faellt Befund 3 auf
  '--fab-h': px(eig(base, ':root', '--fab-h'), {}),
};
TOKENS['--fab-clear'] = px(eig(base, ':root', '--fab-clear'), TOKENS);

// ── 1. Kein schwebender Knopf ueber dem Sendeknopf ────────────────────
{
  ok(/\.layout\[data-route="polaris"\]\s*\.fab\s*\{[^}]*display:\s*none/.test(comp),
    'DER BEFUND: der schwebende „Neu"-Knopf steht auf der Polaris-Route weiter da — er liegt auf dem Sendeknopf');
  // Die Route muss im DOM ueberhaupt ablesbar sein, sonst greift die Regel nie.
  ok(/layout\.dataset\.route\s*=\s*ctx\.route/.test(shell),
    'die Shell schreibt die laufende Route nicht als data-route — die CSS-Regel greift ins Leere');
  ok(shell.includes("classList.toggle('route-home'"),
    'die Startseiten-Regel wurde beim Umbau verloren');
}

// ── 2. Eine Hoehe, an einer Stelle: kein Scrollweg fuer die Seite ─────
{
  const cv = regel(comp, '.chat-view');
  ok(cv != null, '.chat-view hat keine Regel mehr');
  ok(!/100dvh/.test(cv || ''),
    'DER BEFUND: .chat-view rechnet seine Hoehe wieder selbst aus — sie steht dann neben dem Polster von .content');
  ok((eig(comp, '.chat-view', 'flex') || '').startsWith('1'), '.chat-view fuellt die Flaeche nicht aus (flex)');
  ok(px(eig(comp, '.chat-view', 'min-height'), {}) === 0,
    '.chat-view ohne min-height:0 — ein Flex-Kind schrumpft nicht unter seinen Inhalt, der Chat waechst wieder hinaus');

  const pane = '.layout[data-route="polaris"] .content';
  ok(regel(comp, pane) != null, 'DER BEFUND: .content bleibt auf der Polaris-Route ein Dokument statt eine Flaeche');
  ok(eig(comp, pane, 'overflow') === 'hidden', `${pane} hat keinen overflow:hidden — die Seite bekommt wieder einen Scrollweg`);
  ok(px(eig(comp, pane, 'min-height'), {}) === 0, `${pane} ohne min-height:0 — das Feld waechst ueber den Bildschirm hinaus`);
  ok(eig(comp, pane, 'display') === 'flex', `${pane} ist keine Flex-Spalte — .chat-view kann sich nicht ausfuellen`);

  const polsterAllgemein = px(eig(base, '.content', 'padding-bottom'), TOKENS);
  const polsterChat = px(eig(comp, pane, 'padding-bottom'), TOKENS);
  const leiste = TOKENS['--tabbar-h'] + TOKENS['--safe-bottom'];
  ok(polsterChat === leiste,
    `die Eingabezeile endet ${polsterChat} px ueber dem Rand, die Tab-Leiste ist ${leiste} px hoch — sie liegt darunter oder schwebt darueber`);
  ok(polsterChat < polsterAllgemein,
    `DER BEFUND: auf der Polaris-Route wird wie mit FAB gepolstert (${polsterChat} px) — der ist dort ausgeblendet`);
  ok(px(eig(comp, '.layout.tablet[data-route="polaris"] .content', 'padding-bottom'), TOKENS) === 0,
    'auf dem Tablet (keine Tab-Leiste) polstert der Chat trotzdem — dort bleibt ein Streifen unter der Eingabezeile');
}

// ── 3. Der sichere Rand zaehlt genau einmal ───────────────────────────
{
  const zeile = eig(comp, '.chat-input-bar', 'padding') || '';
  ok(!/safe-bottom/.test(zeile),
    `DER BEFUND: .chat-input-bar polstert --safe-bottom noch einmal (${zeile}) — auf dem Handy steckt er schon im Polster von .content`);
  ok(/safe-bottom/.test(eig(comp, '.layout.tablet .chat-input-bar', 'padding-bottom') || ''),
    'auf dem Tablet gibt es kein .content-Polster — dort MUSS die Eingabezeile den sicheren Rand selbst halten');
}

// ── 4. Antworten sind lesbar, nicht roh ───────────────────────────────
{
  ok(!/white-space:\s*pre-wrap/.test(regel(comp, '.chat-msg') || ''),
    '.chat-msg steht auf pre-wrap — zwischen den erzeugten Bloecken klaffen dann die Zeilenumbrueche des Markdowns');
  ok(/overflow-wrap:\s*anywhere/.test(regel(comp, '.chat-msg') || ''),
    'DER BEFUND: .chat-msg bricht lange Woerter nicht — eine URL ohne Leerzeichen schiebt die Blase aus dem Bild');
  for (const sel of ['.chat-msg p', '.chat-msg ul, .chat-msg ol', '.chat-msg code']) {
    ok(regel(comp, sel) != null, `${sel} hat keine Regel — die Vorgabewerte des Browsers sprengen die Blase auf 390 px`);
  }
  const einzug = px(eig(comp, '.chat-msg ul, .chat-msg ol', 'padding-left'), {});
  ok(einzug > 0 && einzug <= 24, `Listen ruecken ${einzug} px ein — die Vorgabe von 40 px ist auf 390 px zu viel`);

  // Und jetzt echt: die ausgelieferte Funktion ausfuehren.
  const a = view.indexOf('function inlineFormat');
  const marke = view.indexOf("return raus.join('');");
  const e = marke > 0 ? view.indexOf('\n}', marke) : -1;
  const vorhanden = a > 0 && e > a;
  ok(vorhanden, 'DER BEFUND: es gibt keine Formatierung — die Antwort geht roh durch escHTML in die Blase');
  const escHTML = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const formatMessage = vorhanden
    ? new Function('escHTML', view.slice(a, e + 2).replace('export function formatMessage', 'function formatMessage') + '\nreturn formatMessage;')(escHTML)
    : () => '(formatMessage fehlt)';

  ok(formatMessage('**Faellig morgen**') === '<p><strong>Faellig morgen</strong></p>',
    'DER BEFUND: **fett** steht weiter mit Sternchen da: ' + formatMessage('**Faellig morgen**'));
  ok(formatMessage('- eins\n- zwei') === '<ul><li>eins</li><li>zwei</li></ul>',
    'eine Aufzaehlung wird nicht zur Liste: ' + formatMessage('- eins\n- zwei'));
  ok(formatMessage('1. eins\n2. zwei') === '<ol><li>eins</li><li>zwei</li></ol>',
    'eine nummerierte Liste wird nicht zur Liste: ' + formatMessage('1. eins\n2. zwei'));
  ok(formatMessage('### Heute') === '<h4>Heute</h4>', 'eine Ueberschrift bleibt roh: ' + formatMessage('### Heute'));
  ok(formatMessage('Rechnung `RE-14`') === '<p>Rechnung <code>RE-14</code></p>',
    'Code bleibt roh: ' + formatMessage('Rechnung `RE-14`'));
  ok(formatMessage('a\nb') === '<p>a<br>b</p>', 'ein einzelner Zeilenumbruch geht verloren: ' + formatMessage('a\nb'));
  ok(formatMessage('eins\n\nzwei') === '<p>eins</p><p>zwei</p>', 'Absaetze werden nicht getrennt: ' + formatMessage('eins\n\nzwei'));
  ok(formatMessage('') === '', 'eine leere Nachricht erzeugt Markup');
  ok(formatMessage(null) === '', 'null erzeugt Markup');

  // Sicherheit: erst escapen, dann formatieren — aus der Antwort darf kein
  // Markup in die Seite gelangen. Die Antwort kommt von einem Dienst, aber
  // ihr Inhalt stammt aus Daten, die irgendwo hergekommen sind.
  for (const boese of [
    '<img src=x onerror=alert(1)>',
    '**<script>alert(1)</script>**',
    '- <b onclick="x">klick</b>',
    '[a](javascript:alert(1))',
  ]) {
    const r = formatMessage(boese);
    // Kein einziges Zeichen aus der Antwort darf als Markup ankommen: die
    // Ausgabe enthaelt nur die hier erzeugten Elemente, alles andere ist
    // escaped. Deshalb wird gegen eine Liste geprueft, nicht gegen Muster.
    const erzeugt = new Set(['p', 'br', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'a']);
    const fremd = [...r.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()).filter((t) => !erzeugt.has(t));
    ok(fremd.length === 0, `Markup aus der Antwort landet in der Seite: ${boese} -> ${r}`);
    ok(!/<[a-z][^>]*\son\w+\s*=/i.test(r), `ein Ereignis-Attribut sitzt an einem Element: ${boese} -> ${r}`);
    ok(!/(href|src)\s*=\s*"?javascript:/i.test(r), `ein javascript:-Ziel ueberlebt: ${boese} -> ${r}`);
  }
  const link = formatMessage('Siehe https://example.com/a?b=1&c=2');
  ok(/<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener">/.test(link),
    'eine URL wird nicht anklickbar: ' + link);
}

// ── 5. Was nur im DOM stand, ueberlebt den Neuaufbau ──────────────────
{
  ok(/let\s+wartetAufAntwort\s*=\s*false/.test(view),
    'DER BEFUND: der Wartezustand haengt wieder nur am DOM — der naechste Neuaufbau loescht „Polaris denkt…"');
  const rm = view.slice(view.indexOf('function renderMessages'), view.indexOf('function senden'));
  ok(/wartetAufAntwort\s*\?/.test(rm),
    'renderMessages zeichnet die Warte-Blase nicht — sie entsteht dann wieder neben dem Aufbau und verschwindet mit ihm');
  ok(!/function appendPending/.test(view), 'appendPending haengt die Blase weiter am DOM vorbei an');

  // Kommentare raus: sonst zaehlt das Wort „await" aus dem Kommentar mit.
  const senden = view.slice(view.indexOf('async function send('), view.indexOf('// ── Antworten lesbar machen'))
    .replace(/^\s*\/\/.*$/gm, '');
  const setzen = senden.indexOf('wartetAufAntwort = true');
  ok(setzen > 0 && setzen < senden.indexOf('await'),
    'der Wartezustand wird erst NACH dem ersten await gesetzt — bis der Push durch ist, zeigt die Ansicht nichts an');
  ok(/wartetAufAntwort = false/.test(senden.slice(senden.indexOf('try {'))),
    'der Wartezustand wird nach der Antwort nicht zurueckgesetzt — „Polaris denkt…" bliebe fuer immer stehen');
  ok((senden.match(/wartetAufAntwort = false/g) || []).length >= 2,
    'im Fehlerfall bleibt der Wartezustand stehen — nach einem Netzfehler nimmt Polaris nie wieder eine Frage an');

  const mount = view.slice(view.indexOf('mount(root)'));
  ok(/inp\.value\s*=\s*entwurf/.test(mount),
    'DER BEFUND: der halb getippte Text wird beim Neuaufbau nicht wiederhergestellt — der 60-Sekunden-Abgleich loescht ihn');
  ok(/addEventListener\('input'/.test(mount), 'der Entwurf wird beim Tippen nicht gemerkt');
}

// ── Der Rest der Ansicht bleibt unberuehrt ────────────────────────────
for (const anker of [
  'https://n8n.srv1757990.hstgr.cloud/webhook/quantus-agent',   // dasselbe Backend
  "SESSION_KEY = 'qm-polaris-session'",                          // dieselbe Sitzung
  "type: 'add-chat-message'", "type: 'add-chat'",                // dieselben Operationen
  "data-action=\"polaris-new\"", "data-action=\"polaris-send\"",
]) {
  ok(view.includes(anker), `ein fremder Bereich wurde beruehrt: "${anker}" fehlt`);
}
ok(!/!important/.test(comp.slice(comp.indexOf('/* ── Chat (Polaris) ── */'), comp.indexOf('/* ── Suche ── */'))),
  'der Chat-Abschnitt arbeitet mit !important');

if (luecken.length) {
  console.error('POLARIS ANZEIGE — ' + luecken.length + ' von ' + checks + ' Pruefungen:');
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`polaris anzeige: ok (${checks} Pruefungen)`);
