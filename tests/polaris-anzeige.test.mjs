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
 * 5. DIE TASTATUR WARF DIE HALBE ANSICHT HERAUS. iOS Safari verkleinert bei
 *    offener Tastatur NICHT das Layout-Fenster: 100dvh bleibt, was es war.
 *    Passt die Seite nicht in den Rest, verschiebt Safari das ganze Bild nach
 *    oben, bis das Feld ueber der Tastatur steht — nachgestellt und gemessen:
 *    274 px Versatz, Kopfzeile 0 px sichtbar, die Nachrichten oben
 *    abgeschnitten. Auf dem Geraet haengte sich zusaetzlich die Tab-Leiste an
 *    die Tastatur und nahm weitere 62 px. Nachher: Versatz 0, Kopfzeile
 *    vollstaendig da, Tab-Leiste beim Tippen weg.
 *
 * 6. .main HATTE NUR EIN min-height. Damit ist die Hoehe des Flex-Behaelters
 *    unbestimmt, und ein Kind mit flex:1 wird von seinem INHALT bemessen
 *    statt vom freien Platz. Bei einem langen Verlauf wuchs .content wieder
 *    auf 761 statt 610 px — der Scrollweg aus Befund 2 war zurueck, nur
 *    diesmal erst ab einer gewissen Menge Text.
 *
 * 7. DIE ANTWORT SASS IN EINER BLASE. Auf 390 px war das ein Rahmen um fast
 *    den ganzen Bildschirm: er trennte nichts, kostete Platz und schnuerte
 *    den Text auf 82 % ein. Dazu wiederholte eine zweite grosse Ueberschrift
 *    "Polaris" das, was die App-Kopfzeile schon sagt — 35 px fuer nichts.
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
  // Reihenfolge: die Route entscheidet ueber CSS, das die Groessen der Ansicht
  // bestimmt. Steht sie erst nach dem Rendern da, misst mount() in einem
  // Layout, das es gleich nicht mehr gibt.
  const rv = shell.slice(shell.indexOf('function renderView'), shell.indexOf('// ── Badges'));
  ok(rv.indexOf('layout.dataset.route = ctx.route') < rv.indexOf('content.innerHTML = view.render(ctx)'),
    'DER BEFUND: die Route wird erst NACH dem Rendern gesetzt — der Chat findet beim Aufbau seine Hoehe nicht und oeffnet beim Wechsel aus einer anderen Ansicht bei der aeltesten Nachricht');
  ok(rv.indexOf('layout.dataset.route = ctx.route') < rv.indexOf('view.mount(content, ctx)'),
    'die Route steht beim mount() noch nicht am Layout');
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

// ── 6. Die Flaeche hat eine bestimmte Hoehe ──────────────────────────
{
  const m = '.layout[data-route="polaris"] .main';
  ok(regel(comp, m) != null,
    'DER BEFUND: .main hat nur ein min-height — die Hoehe ist unbestimmt, .content wird dann von seinem Inhalt bemessen und waechst bei langem Verlauf ueber den Bildschirm');
  ok((eig(comp, m, 'height') || '').includes('100dvh'), `${m} hat keine feste Hoehe`);
  ok(px(eig(comp, m, 'min-height'), {}) === 0, `${m} behaelt sein min-height:100dvh — beides zusammen ist widerspruechlich`);
}

// ── 7. Die Tastatur ──────────────────────────────────────────────────
{
  const auf = '.layout[data-route="polaris"].keyboard-open';
  ok(/var\(--kb/.test(eig(comp, auf + ' .content', 'padding-bottom') || ''),
    'DER BEFUND: bei offener Tastatur polstert der Chat weiter fuer die Tab-Leiste statt fuer die Tastatur — Safari verschiebt dann die ganze Seite nach oben');
  ok(eig(comp, auf + ' .tabbar', 'display') === 'none',
    'die Tab-Leiste bleibt beim Tippen stehen — sie haengt sich auf dem Geraet an die Tastatur und nimmt dem Text 62 px');

  // Und jetzt echt: den Beobachter aus polaris.js gegen eine Attrappe laufen
  // lassen — einmal in dem Zustand, in dem Safari schon verschoben HAT.
  const a = view.indexOf('function tastaturBeobachten');
  const e = view.indexOf('\n}', a);
  ok(a > 0 && e > a, 'DER BEFUND: es gibt keinen Beobachter fuer das visuelle Fenster — die Ansicht erfaehrt von der Tastatur nichts');
  const schwelle = Number((/TASTATUR_SCHWELLE = (\d+)/.exec(view) || [])[1]);
  ok(schwelle > 44 && schwelle < 150, `die Schwelle ist ${schwelle} — eine Zubehoerleiste (44 px) darf nicht als Tastatur gelten, eine Tastatur (250+) schon`);

  if (a > 0 && e > a) {
    const bau = () => {
      const hoerer = [];
      const stil = {};
      const klassen = new Set();
      const layout = {
        style: { setProperty: (k, v) => { stil[k] = v; }, removeProperty: (k) => { delete stil[k]; } },
        classList: { toggle: (k, an) => { if (an) klassen.add(k); else klassen.delete(k); }, remove: (k) => klassen.delete(k) },
      };
      const liste = { scrollHeight: 900, scrollTop: 0 };
      const vv = { height: 664, offsetTop: 0,
        addEventListener: (t, f) => hoerer.push([t, f]),
        removeEventListener: (t, f) => { const i = hoerer.findIndex(([tt, ff]) => tt === t && ff === f); if (i >= 0) hoerer.splice(i, 1); },
        feuern: () => hoerer.forEach(([, f]) => f()) };
      const gescrollt = [];
      const fenster = { innerHeight: 664, scrollY: 0, visualViewport: vv, scrollTo: (x, y) => gescrollt.push([x, y]) };
      const dok = { getElementById: (id) => (id === 'layout' ? layout : id === 'chatMessages' ? liste : null) };
      const quelle = view.slice(a, e + 2);
      const modul = new Function('window', 'document', 'TASTATUR_SCHWELLE',
        'let tastaturAb = null;' + quelle + '; return { start: tastaturBeobachten, get ab() { return tastaturAb; } };'
      )(fenster, dok, schwelle);
      return { modul, vv, stil, klassen, hoerer, liste, gescrollt, fenster };
    };

    // a) Tastatur zu
    let u = bau(); u.modul.start();
    ok(u.stil['--kb'] === '0px', `Tastatur zu: --kb ist ${u.stil['--kb']} statt 0px`);
    ok(!u.klassen.has('keyboard-open'), 'Tastatur zu, und die Ansicht haelt sie fuer offen');

    // b) Tastatur auf
    u.vv.height = 328; u.vv.feuern();
    ok(u.stil['--kb'] === '336px', `Tastatur auf: --kb ist ${u.stil['--kb']} statt 336px`);
    ok(u.klassen.has('keyboard-open'), 'Tastatur auf, und die Ansicht merkt es nicht');
    ok(u.liste.scrollTop === u.liste.scrollHeight, 'die Nachrichten scrollen nicht ans Ende — die letzte Antwort bleibt hinter der Tastatur');

    // c) DER FLACKER-FALL: Safari hat schon verschoben. Zoege die Rechnung
    //    offsetTop ab, fiele der Wert unter die Schwelle, die Ansicht ginge
    //    auf, Safari verschoebe erneut — hin und her.
    u.vv.offsetTop = 274; u.fenster.scrollY = 0; u.vv.feuern();
    ok(u.stil['--kb'] === '336px',
      `DER BEFUND: mit bereits verschobener Seite rechnet der Beobachter --kb auf ${u.stil['--kb']} herunter — das flackert zwischen offen und zu`);
    ok(u.klassen.has('keyboard-open'), 'mit verschobener Seite haelt die Ansicht die Tastatur fuer zu — sie geht auf, Safari verschiebt erneut');
    ok(!/vv\.offsetTop/.test(view.slice(a, e)) || !/- *vv\.offsetTop/.test(view.slice(a, e)),
      'die Rechnung zieht vv.offsetTop ab — genau das erzeugt das Flackern');

    // d) Safaris Versatz wird zurueckgeholt
    u.fenster.scrollY = 274; u.vv.feuern();
    ok(u.gescrollt.some(([, y]) => y === 0), 'ein Versatz von Safari wird nicht zurueckgeholt — die Kopfzeile bleibt aus dem Bild');

    // e) Nur eine Zubehoerleiste ist keine Tastatur
    u = bau(); u.modul.start(); u.vv.height = 620; u.vv.feuern();
    ok(!u.klassen.has('keyboard-open'), 'eine 44 px hohe Zubehoerleiste gilt als Tastatur — die Tab-Leiste verschwindet grundlos');

    // f) Beim Verlassen meldet sich alles wieder ab
    u = bau(); u.modul.start();
    u.vv.height = 328; u.vv.feuern();
    ok(typeof u.modul.ab === 'function', 'der Beobachter hinterlaesst keinen Weg, sich abzumelden');
    u.modul.ab();
    ok(u.hoerer.length === 0, `nach dem Verlassen haengen noch ${u.hoerer.length} Hoerer am visuellen Fenster`);
    ok(!u.klassen.has('keyboard-open'), 'die Klasse keyboard-open bleibt stehen — in einer anderen Ansicht fehlt dann die Tab-Leiste');
    ok(u.stil['--kb'] === undefined, '--kb bleibt am Layout stehen');

    // g) Zweimal betreten hinterlaesst nicht zwei Beobachter
    u = bau(); u.modul.start(); u.modul.start();
    ok(u.hoerer.length <= 2, `nach zwei Aufbauten haengen ${u.hoerer.length} Hoerer am visuellen Fenster`);
  }
  // Die Ansicht muss sich beim Verlassen ueberhaupt abmelden koennen.
  ok(/^\s*unmount\(\)/m.test(view), 'die Ansicht hat kein unmount — die Shell kann den Beobachter nicht abmelden');
  const beob = view.slice(view.indexOf('function tastaturBeobachten'), view.indexOf('function renderMessages'));
  ok(/if \(tastaturAb\) tastaturAb\(\);/.test(beob),
    'der Beobachter meldet einen alten nicht ab, bevor er sich anmeldet — zwei Aufbauten hinterlassen zwei Beobachter');
}

// ── 8. Uebersichtlich: die Antwort ist Text, kein Kasten ─────────────
{
  const ass = regel(comp, '.chat-msg.assistant') || '';
  ok(!/border:/.test(ass) && !/background:/.test(ass),
    'DER BEFUND: die Antwort sitzt in einer Blase — auf 390 px ist das ein Rahmen um fast den ganzen Bildschirm, der nichts trennt');
  ok((eig(comp, '.chat-msg.assistant', 'max-width') || '') === '100%',
    'die Antwort bleibt auf 82 % eingeschnuert, obwohl sie keine Blase mehr ist');
  // Die eigene Frage bleibt eine Blase — sonst faellt der Unterschied weg.
  const usr = regel(comp, '.chat-msg.user') || '';
  ok(/background:/.test(usr) && /border-radius:/.test(usr), 'auch die eigene Frage hat keine Blase mehr — dann sieht man nicht, wer was gesagt hat');
  ok(px(eig(comp, '.chat-msg', 'font-size'), {}) >= 15, `der Text ist ${eig(comp, '.chat-msg', 'font-size')} — auf dem Handy zu klein zum Lesen`);

  // Eingabe: EIN Feld, nicht Kasten neben Knopf.
  ok(regel(comp, '.chat-input-pill') != null, 'die Eingabe hat keine Huelle — Feld und Knopf stehen wieder als zwei Kaesten nebeneinander');
  ok(/focus-within/.test(comp), 'der Fokusring liegt nicht auf der Huelle — er umrandet dann nur das Feld, nicht die Eingabe');
  ok(px(eig(comp, '.chat-send', 'width'), {}) >= 38 && eig(comp, '.chat-send', 'border-radius') === '50%',
    'der Sendeknopf ist kein runder Knopf mit Fingerbreite');
  ok(px(eig(comp, '.chat-field', 'font-size'), {}) >= 16,
    'das Eingabefeld ist unter 16 px — iOS zoomt dann beim Antippen in die Seite hinein');

  // Die zweite grosse Ueberschrift ist weg; der Chattitel steht dort.
  ok(!/class="page-title">🛰️ Polaris/.test(view),
    'DER BEFUND: die Ansicht wiederholt gross "Polaris", was die App-Kopfzeile schon sagt — 35 px fuer nichts');
  ok(/class="chat-head-title"/.test(view) && regel(comp, '.chat-head-title') != null,
    'an der Stelle steht jetzt nichts — der Titel des laufenden Chats gehoert dorthin');
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
