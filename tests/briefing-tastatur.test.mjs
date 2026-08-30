/*
 * Tastatur ausserhalb von Polaris: Tab-Leiste und FAB blieben stehen.
 *
 * BEFUND (Playwright, iPhone-13-Ansicht 390x664, Route Briefing): das Feld
 * "Taegliche Notizen" fokussiert, dann die Tastatur nachgestellt — NICHT
 * durch eine Fensteraenderung (die veraendert innerHeight und
 * visualViewport.height gemeinsam und tritt nie auseinander), sondern so,
 * wie iOS Safari es tatsaechlich tut: innerHeight bleibt 664, nur
 * visualViewport.height faellt auf 390. Vorher: die Tab-Leiste (position:
 * fixed, bottom:0) blieb bei y 602..664 stehen exakt ueber dem unteren
 * Drittel des gerade fokussierten Textfelds, der schwebende FAB mitten
 * darauf. Kein Modul kannte dieses Feld ueberhaupt — Polaris hat einen
 * eigenen Beobachter, jede andere Route (Briefing mit drei Eingabefeldern:
 * Tagesziel, Gedanke, Tagesnotiz) keinen.
 *
 * Die Ansicht selbst scrollt normal (kein 100dvh-Layout wie Polaris) — der
 * Browser schiebt ein fokussiertes Feld dort von selbst ueber die Tastatur.
 * Es genuegt daher, die beiden schwebenden position:fixed-Elemente app-weit
 * auszublenden, sobald das visuelle Fenster kleiner ist als der Rest —
 * tastaturBeobachtenGlobal() in shell.js, unabhaengig von Polaris' eigenem
 * Mechanismus (andere Klasse, eigener Listener, keine Abmeldung noetig: er
 * lebt so lange wie die App).
 *
 * Geprueft wird gegen die ausgelieferten Dateien: das CSS wird geparst,
 * tastaturBeobachtenGlobal laeuft als ECHTE Funktion aus shell.js gegen eine
 * Attrappe des visuellen Fensters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const base = fs.readFileSync(path.join(root, 'css/base.css'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'js/shell.js'), 'utf8');

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

// ── 1. Die CSS-Antwort ───────────────────────────────────────────────────
{
  ok(eig(base, '.layout.kb-hide-chrome .tabbar', 'display') === 'none',
    'DER BEFUND: die Tab-Leiste bleibt beim Tippen ausserhalb von Polaris stehen und legt sich ueber das fokussierte Feld');
  ok(eig(base, '.layout.kb-hide-chrome .fab', 'display') === 'none',
    'der FAB bleibt beim Tippen stehen und schwebt ueber der Tastatur bzw. dem Feld');
}

// ── 2. Echt: der Beobachter aus shell.js gegen eine Attrappe ─────────────
{
  const a = shell.indexOf('function tastaturBeobachtenGlobal');
  const e = shell.indexOf('\n}', a);
  ok(a > 0 && e > a, 'DER BEFUND: es gibt app-weit keinen Beobachter fuer das visuelle Fenster — nur Polaris erfaehrt von der Tastatur');
  const schwelle = Number((/KB_SCHWELLE_GLOBAL = (\d+)/.exec(shell) || [])[1]);
  ok(schwelle > 44 && schwelle < 150, `die Schwelle ist ${schwelle} — eine Zubehoerleiste (44 px) darf nicht als Tastatur gelten, eine Tastatur (250+) schon`);

  if (a > 0 && e > a) {
    const bau = () => {
      const hoerer = [];
      const klassen = new Set();
      const layout = { classList: { toggle: (k, an) => { if (an) klassen.add(k); else klassen.delete(k); } } };
      const vv = { height: 664,
        addEventListener: (t, f) => hoerer.push([t, f]),
        feuern: () => hoerer.forEach(([, f]) => f()) };
      const fenster = { innerHeight: 664, visualViewport: vv };
      const dollar = (sel) => (sel === '#layout' ? layout : null);
      const quelle = shell.slice(a, e + 2);
      const fn = new Function('window', '$', 'KB_SCHWELLE_GLOBAL', quelle + '\nreturn tastaturBeobachtenGlobal;')(fenster, dollar, schwelle);
      return { fn, vv, klassen, hoerer };
    };

    // a) Tastatur zu: sofort beim Anmelden gemessen, keine Klasse
    let u = bau(); u.fn();
    ok(!u.klassen.has('kb-hide-chrome'), 'Tastatur zu, und die Shell blendet Tab-Leiste/FAB schon aus');

    // b) Tastatur auf (iOS-Fall: innerHeight bleibt, nur vv.height faellt)
    u.vv.height = 390; u.vv.feuern();
    ok(u.klassen.has('kb-hide-chrome'), 'Tastatur auf (274 px Ueberdeckung), und die Shell merkt es nicht — Tab-Leiste/FAB bleiben stehen');

    // c) Tastatur zu wieder: die Klasse muss zurueckgehen
    u.vv.height = 664; u.vv.feuern();
    ok(!u.klassen.has('kb-hide-chrome'), 'nach dem Schliessen der Tastatur bleiben Tab-Leiste/FAB ausgeblendet');

    // d) Nur eine Zubehoerleiste ist keine Tastatur
    u = bau(); u.fn(); u.vv.height = 620; u.vv.feuern();
    ok(!u.klassen.has('kb-hide-chrome'), 'eine 44 px hohe Zubehoerleiste gilt als Tastatur — Tab-Leiste/FAB verschwinden grundlos');

    // e) Zweimal aufrufen (z. B. durch einen HMR-Neustart) haengt nicht zwei Hoerer an
    u = bau(); u.fn(); u.fn();
    ok(u.hoerer.length <= 2, `nach zwei Aufrufen haengen ${u.hoerer.length} Hoerer am visuellen Fenster`);
  }
}

// ── 3. Wird die Shell auch tatsaechlich gestartet? ───────────────────────
{
  const bootStart = shell.indexOf('export async function boot');
  const bootEnde = shell.indexOf('\n}', shell.indexOf('router.handleRoute();', bootStart));
  const bootRumpf = shell.slice(bootStart, bootEnde > 0 ? bootEnde : undefined);
  ok(/tastaturBeobachtenGlobal\(\);/.test(bootRumpf),
    'DER BEFUND: der Beobachter ist definiert, wird beim Start aber nie aufgerufen — er laeuft nie');
}

// ── Der Rest der Shell bleibt unberuehrt ──────────────────────────────
for (const anker of [
  '.tabbar {', '.fab {', '.appbar {', 'function onResize', 'function buildSkeleton',
]) {
  ok(base.includes(anker) || shell.includes(anker), `ein fremder Bereich wurde beruehrt: "${anker}" fehlt`);
}

if (luecken.length) {
  console.error('BRIEFING TASTATUR — ' + luecken.length + ' von ' + checks + ' Pruefungen:');
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`briefing tastatur (app-weite Tab-Leiste/FAB): ok (${checks} Pruefungen)`);
