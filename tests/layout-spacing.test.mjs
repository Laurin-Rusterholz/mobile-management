/*
 * Abstaende in der Mobile-Shell.
 *
 * DREI BEFUNDE (Telefon, Bildschirmfoto der Konzepte-Liste):
 *
 * 1. LOCH OBEN. Zwischen App-Leiste und Ueberschrift stand eine leere Flaeche
 *    mit dem Refresh-Pfeil darin. Ursache: im touchend des Pull-to-Refresh
 *    stand das Zuruecksetzen HINTER dem await. Warf store.pullData (Netz weg,
 *    Serverfehler), wurde die Zeile nie erreicht — der Anzeiger blieb bis zu
 *    60 px hoch offen stehen. Ein zweiter Zug half nicht: touchstart verweigert
 *    waehrend state.syncing. Das Loch blieb bis zum Neuladen.
 *
 * 2. LETZTE KARTE UNTER DEM FAB. .content rechnete sein unteres Polster nur
 *    mit der Tab-Leiste. Der FAB schwebt aber DARUEBER (58 px hoch, 14 px
 *    Abstand) und lag damit auf der letzten Karte — im Bildschirmfoto verdeckt
 *    er ihren Oeffnen-Pfeil.
 *
 * 3. .chip-row OHNE REGEL. Die Sortier-Knoepfe standen mit dem zufaelligen
 *    Leerzeichen-Abstand des Markups da, und zur Liste darunter fehlte jeder
 *    Abstand. Die Klasse wird in zwei Ansichten benutzt und war nirgends
 *    definiert.
 *
 * Geprueft wird gegen die ausgelieferten Dateien: das CSS wird geparst und
 * ausgerechnet, der touchend-Rumpf laeuft als ECHTE Funktion gegen Attrappen —
 * einmal mit einem Fehler im Pull.
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

// ── Kleiner CSS-Zugriff: eine Regel, eine Eigenschaft ──────────────────
function regel(css, selektor) {
  // Kommentare zuerst entfernen: sonst steht vor einer Eigenschaft ein "*/"
  // statt eines Semikolons, und die Eigenschaftssuche unten findet sie nicht.
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
// calc(...) mit den bekannten Tokens ausrechnen — Zahlen statt Zeichenketten
// vergleichen, sonst prueft der Test Schreibweise statt Wirkung.
function px(ausdruck, tokens) {
  if (ausdruck == null) return NaN;
  let t = String(ausdruck).trim();
  for (const [k, v] of Object.entries(tokens)) t = t.split(`var(${k})`).join(String(v));
  t = t.replace(/calc\(/g, '(').replace(/px/g, '');
  if (!/^[-+*/(). \d]+$/.test(t)) return NaN;
  try { return Function('"use strict";return (' + t + ')')(); } catch (e) { return NaN; }
}
const TOKENS = {
  '--tabbar-h': px(eig(base, ':root', '--tabbar-h'), {}),
  '--safe-bottom': 0,          // Geraet ohne Aussparung: der ungünstigste Fall
  '--fab-h': px(eig(base, ':root', '--fab-h'), {}),
};
TOKENS['--fab-clear'] = px(eig(base, ':root', '--fab-clear'), TOKENS);

ok(TOKENS['--tabbar-h'] === 62, `--tabbar-h ist ${TOKENS['--tabbar-h']} statt 62`);
ok(TOKENS['--fab-h'] === 58, `--fab-h fehlt oder ist ${TOKENS['--fab-h']} statt 58 (Hoehe des FAB)`);
ok(Number.isFinite(TOKENS['--fab-clear']), '--fab-clear ist nicht ausrechenbar');

// ── 2. Unten: der Inhalt muss an Tab-Leiste UND FAB vorbei ────────────
{
  const fabUnten = px(eig(base, '.fab', 'bottom'), TOKENS);
  const fabHoehe = px(eig(base, '.fab', 'height'), TOKENS);
  ok(Number.isFinite(fabUnten) && Number.isFinite(fabHoehe), 'die Lage des FAB ist nicht ausrechenbar');
  const fabOberkante = fabUnten + fabHoehe;   // wie weit er vom unteren Rand hochragt

  const polster = px(eig(base, '.content', 'padding-bottom'), TOKENS);
  ok(Number.isFinite(polster), 'das untere Polster von .content ist nicht ausrechenbar');
  ok(polster >= fabOberkante,
    `DER BEFUND: .content endet ${polster} px ueber dem Rand, der FAB ragt aber bis ${fabOberkante} px — ` +
    'die letzte Karte liegt unter ihm');
  ok(polster >= fabOberkante + 8,
    `zwischen letzter Karte und FAB bleiben nur ${polster - fabOberkante} px Luft`);
  ok(polster < fabOberkante + 60,
    `${polster - fabOberkante} px Luft unter der letzten Karte — das ist eine Leerflaeche, kein Abstand`);

  // Ohne FAB kein FAB-Platz.
  const home = px(eig(base, '.layout.route-home .content', 'padding-bottom'), TOKENS);
  ok(Number.isFinite(home), 'auf der Startseite (ohne FAB) gibt es keine eigene Regel');
  ok(home < polster, `die Startseite polstert ${home} px wie eine Seite mit FAB — dort ist keiner`);
  ok(home >= TOKENS['--tabbar-h'], `die Startseite endet ${home} px ueber dem Rand — unter der Tab-Leiste`);
  ok(base.includes('.layout.route-home .fab { display: none; }') ||
     fs.readFileSync(path.join(root, 'css/apps.css'), 'utf8').includes('.layout.route-home .fab { display: none; }'),
    'die Annahme stimmt nicht mehr: auf der Startseite ist der FAB sichtbar');

  const tablet = px(eig(base, '.layout.tablet .content', 'padding-bottom'), TOKENS);
  ok(Number.isFinite(tablet) && tablet < polster,
    `auf dem Tablet (weder FAB noch Tab-Leiste) wird ${tablet} px gepolstert`);
}

// ── 3. .chip-row hat eine Regel und denselben Rhythmus wie .segmented ──
{
  const r = regel(comp, '.chip-row');
  ok(r != null, 'DER BEFUND: .chip-row hat keine Regel — die Knoepfe stehen im Leerzeichen-Abstand des Markups');
  if (r != null) {
    ok(eig(comp, '.chip-row', 'display') === 'flex', '.chip-row ist keine Reihe');
    ok(px(eig(comp, '.chip-row', 'gap'), {}) >= 6, `.chip-row hat ${eig(comp, '.chip-row', 'gap')} Abstand zwischen den Knoepfen`);
    ok(eig(comp, '.chip-row', 'flex-wrap') === 'wrap', '.chip-row bricht nicht um — auf 390 px laufen die Knoepfe hinaus');
    const mb = px(eig(comp, '.chip-row', 'margin-bottom'), {});
    const seg = px(eig(comp, '.segmented', 'margin-bottom'), {});
    ok(mb > 0, '.chip-row haelt keinen Abstand zur Liste darunter');
    ok(mb === seg, `.chip-row endet mit ${mb} px, .segmented mit ${seg} px — der Rhythmus stimmt nicht`);
  }
  // Die Klasse wird wirklich benutzt; ohne Nutzung waere die Regel toter Ballast.
  const nutzer = ['js/views/collection.js', 'js/views/flowertech.js']
    .filter((f) => fs.readFileSync(path.join(root, f), 'utf8').includes('class="chip-row"'));
  ok(nutzer.length >= 2, `.chip-row wird nur in ${nutzer.length} Ansicht(en) benutzt`);
}

// ── 1. Der Refresh-Anzeiger raeumt sich IMMER auf ─────────────────────
{
  const a = shell.indexOf("content.addEventListener('touchend'");
  ok(a > 0, 'der touchend-Handler des Pull-to-Refresh wurde nicht gefunden');
  const rumpf = shell.slice(a, shell.indexOf('\n  });', a) + 6);
  ok(/finally\s*\{/.test(rumpf),
    'DER BEFUND: das Zuruecksetzen steht nicht im finally — ein Fehler im Pull laesst den Anzeiger offen stehen');

  // Und jetzt echt: den Rumpf ausfuehren, einmal mit einem Wurf im Pull.
  for (const [lage, wirft] of [['erfolgreich', false], ['mit Fehler', true]]) {
    const ptr = { hoehe: '60px', klassen: new Set(['ready']),
      style: { set height(v) { ptr.hoehe = v; }, get height() { return ptr.hoehe; } },
      classList: { add: (k) => ptr.klassen.add(k), remove: (k) => ptr.klassen.delete(k),
        toggle: (k, an) => { if (an) ptr.klassen.add(k); else ptr.klassen.delete(k); } } };
    let dist = 120, pulling = true;
    const fn = new Function('ptr', 'dist', 'pulling', 'THRESHOLD', 'haptic', 'store', 'setPulling',
      'return (async () => {' + rumpf
        .replace("content.addEventListener('touchend', async () => {", '')
        .replace(/\n  \}\);\s*$/, '')
        .replace('pulling = false;', 'setPulling(false);') + '})();');
    let gefangen = null;
    try {
      await fn(ptr, dist, pulling, 70, () => {}, {
        pullData: async () => { if (wirft) throw new Error('Netz weg'); },
      }, () => {});
    } catch (e) { gefangen = e; }

    ok(ptr.hoehe === '0px',
      `${lage}: der Anzeiger bleibt ${ptr.hoehe} hoch stehen — genau das Loch zwischen Leiste und Inhalt`);
    ok(!ptr.klassen.has('spinning'), `${lage}: der Anzeiger dreht sich weiter`);
    ok(!ptr.klassen.has('ready'), `${lage}: der Anzeiger bleibt im Zustand "ready"`);
    if (wirft) ok(gefangen instanceof Error, 'der Fehler wurde verschluckt statt weitergereicht');
  }
}

// ── Der Rest der Shell bleibt unberuehrt ──────────────────────────────
for (const anker of [
  '.tabbar {', '.fab {', '.appbar {',
  "content.addEventListener('touchstart'", "content.addEventListener('touchmove'",
]) {
  ok(base.includes(anker) || shell.includes(anker), `ein fremder Bereich wurde beruehrt: "${anker}" fehlt`);
}
ok(!/!important/.test(regel(base, '.content') || ''), '.content arbeitet mit !important');

if (luecken.length) {
  console.error('LAYOUT SPACING — ' + luecken.length + ' von ' + checks + ' Pruefungen:');
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`layout spacing: ok (${checks} Pruefungen)`);
