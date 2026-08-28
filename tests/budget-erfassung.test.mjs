/*
 * Budget auf dem Handy: eine Ausgabe in Sekunden, und eine Übersicht, die
 * mehr zeigt als „diesen Monat".
 *
 * BEFUND (Auftrag): "auf dem handy einfach neue ausgaben erfassen". Bisher
 * ging das nur über das allgemeine ＋-Blatt: ein Formular aus Betrag, Typ,
 * Kategorie, Beschreibung und Datum, alles über die Bildschirmtastatur. Wer
 * an der Kasse steht, tippt das nicht.
 *
 * ZWEITER PUNKT: die Übersicht kannte nur den laufenden Monat. Der letzte war
 * unerreichbar, Kontostände kamen gar nicht vor, und eine Buchung liess sich
 * nicht wieder löschen.
 *
 * WICHTIG AM FORMAT: der Betrag trägt sein Vorzeichen — negativ heisst
 * Ausgabe. Genau so lesen Desktop und Tablet. Schriebe das Handy stattdessen
 * einen positiven Betrag mit type:"expense", zählte jede Ausgabe auf den
 * anderen Geräten als Einnahme.
 *
 * Kein Browser, kein Netz. Die Ansicht läuft ECHT gegen einen Store-Stub.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lies = (p) => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch (e) { return ''; } };
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const HEUTE = (() => { const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const MONAT = HEUTE.slice(0, 7);

const protokoll = { ops: [], sheets: [], toasts: [], geschlossen: 0, nav: [], confirms: [] };
let confirmAntwort = true;
const AKTIONEN = {};
const KONTEN = [{ id: 'a1', name: 'Privatkonto', balance: 1200.5, type: 'giro' }];
let TX = [
  { id: 't1', amount: -12.5, type: 'expense', category: 'Essen', description: 'Kaffee', date: HEUTE },
  { id: 't2', amount: 3000, type: 'income', category: 'Lohn', description: '', date: HEUTE },
  { id: 't3', amount: -80, type: 'expense', category: 'Transport', description: 'GA', date: HEUTE },
];

const stubs = {
  '../util.js': {
    escHTML: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    fmtMoney: (n) => 'CHF ' + Number(n || 0).toFixed(2),
    formatDate: (d) => String(d || ''),
    todayYmd: () => HEUTE,
    toast: (t, k) => protokoll.toasts.push(k + ':' + t),
    openSheet: (o) => protokoll.sheets.push(o),
    closeSheet: () => { protokoll.geschlossen++; },
    confirmPreview: async (o) => { protokoll.confirms.push(o); return confirmAntwort; },
    haptic: () => {},
  },
  '../store.js': {
    getTransactions: () => TX,
    getAccounts: () => KONTEN,
    performOp: async (op) => { protokoll.ops.push(op); },
  },
  '../actions.js': { registerActions: (o) => Object.assign(AKTIONEN, o) },
  '../router.js': { navigate: (r, o) => protokoll.nav.push({ route: r, ...(o || {}) }) },
  './common.js': {
    pageHeader: (t, s, r) => `<h1>${t}</h1><p>${s || ''}</p>${r || ''}`,
    segmented: (items, aktiv) => `<div class="segmented">${items.map((i) => i.key === aktiv ? '[' + i.label + ']' : i.label).join('')}</div>`,
  },
};

// Ein DOM-Stub, der nur so viel kann, wie die Ansicht braucht: Felder lesen
// und den Erfassungsblock ersetzen.
const felder = { buNotiz: { value: '' }, buDatum: { value: HEUTE }, buKonto: { value: '' } };
let quickHtml = '';
globalThis.document = {
  getElementById: (id) => felder[id] || null,
  querySelector: (sel) => (sel === '.bu-quick' && quickHtml !== null)
    ? { set outerHTML(v) { quickHtml = v; } } : null,
  createElement: () => ({ click() {}, set onchange(_) {} }),
};
globalThis.Blob = class { constructor() {} };
globalThis.URL = { createObjectURL: () => 'blob:' };

const quelle = lies('js/views/budget.js');
ok(quelle.length > 0, 'js/views/budget.js gibt es nicht');
const ohne = quelle.replace(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm, (m, pfad) => {
  ok(Object.prototype.hasOwnProperty.call(stubs, pfad), `unbekannter Import: ${pfad}`);
  const namen = /\{([^}]*)\}/.exec(m);
  if (namen) return `const {${namen[1]}} = __stubs['${pfad}'];`;
  return `const ${/\*\s+as\s+(\w+)/.exec(m)[1]} = __stubs['${pfad}'];`;
});
const V = new Function('__stubs', ohne.replace(/^export default/m, 'return') + ';')(stubs);
ok(V && typeof V.render === 'function', 'die Budget-Ansicht hat kein render()');

const ruf = async (name, ...args) => {
  if (typeof AKTIONEN[name] !== 'function') { ok(false, `die Aktion ${name} ist nicht registriert`); return; }
  return AKTIONEN[name](...args);
};

// ═══ 1. DIE ÜBERSICHT ══════════════════════════════════════════════════
const html = V.render({});
ok(/CHF 3000\.00/.test(html), 'die Einnahmen des Monats stimmen nicht');
ok(/CHF 92\.50/.test(html), 'die Ausgaben des Monats stimmen nicht (erwartet 12.50 + 80)');
ok(/CHF 2907\.50/.test(html), 'der Saldo stimmt nicht');
ok(/Privatkonto/.test(html), 'die Konten kommen in der Übersicht nicht vor');
ok(/CHF 1200\.50/.test(html), 'der Kontostand wird nicht angezeigt');
ok(/Transport/.test(html) && /Essen/.test(html), 'die Kategorien fehlen');
// Die grösste Kategorie steht oben und bekommt den vollen Balken.
{
  const iT = html.indexOf('Transport'), iE = html.indexOf('Essen');
  ok(iT > 0 && iE > 0 && iT < iE, 'die Kategorien sind nicht nach Betrag sortiert');
  ok(/width:100%/.test(html), 'die grösste Kategorie bekommt keinen vollen Balken');
}
ok(/data-action="bu-monat"/.test(html), 'DER BEFUND: die Übersicht lässt sich nicht auf einen anderen Monat blättern');
ok(/data-action="bu-neu"/.test(html), 'es fehlt der Weg in die Schnellerfassung');

// Ein anderer Monat zeigt einen anderen Stand — sonst wäre das Blättern Zierde.
await ruf('bu-monat', { n: '-1' });
{
  const h = V.render({});
  ok(/CHF 0\.00/.test(h), 'der Vormonat zeigt trotzdem die Zahlen des laufenden Monats');
  ok(/Keine Ausgaben in diesem Monat/.test(h), 'der leere Monat sagt nichts');
}
await ruf('bu-monat', { n: '0' });
ok(/CHF 2907\.50/.test(V.render({})), '„Heute" führt nicht in den laufenden Monat zurück');

// ═══ 2. DIE SCHNELLERFASSUNG ═══════════════════════════════════════════
await ruf('bu-neu');
ok(protokoll.sheets.length === 1, `es wurden ${protokoll.sheets.length} Blätter geöffnet statt einem`);
const blatt = (protokoll.sheets[0] || {}).body || '';
ok(/data-action="bu-taste"/.test(blatt), 'DER BEFUND: es gibt keinen eigenen Ziffernblock');
ok((blatt.match(/data-action="bu-taste"/g) || []).length === 12,
  'der Ziffernblock hat nicht zwölf Tasten (0–9, Punkt, Löschen)');
ok(/data-action="bu-kat"/.test(blatt), 'die Kategorien sind nicht als Kacheln antippbar');
ok(/data-action="bu-typ"/.test(blatt), 'Ausgabe und Einnahme lassen sich nicht umschalten');
ok(/Privatkonto/.test(blatt), 'das Konto lässt sich bei der Erfassung nicht wählen');
ok(/type="date"/.test(blatt), 'das Datum lässt sich nicht ändern');

// Tippen ergibt den erwarteten Betrag.
const tippe = async (folge) => { for (const t of folge) await ruf('bu-taste', { taste: t }); };
await tippe(['1', '2', '.', '5', '0']);
ok(/12\.50/.test(quickHtml), `nach 1,2,.,5,0 steht ${JSON.stringify((quickHtml.match(/bu-betrag-zahl">([^<]*)/) || [])[1])} im Feld`);
// Ein zweiter Punkt und eine dritte Nachkommastelle werden abgewiesen —
// sonst entsteht ein Betrag, den niemand gemeint hat.
await tippe(['.', '9']);
ok(/12\.50/.test(quickHtml), 'ein zweiter Punkt oder eine dritte Nachkommastelle wird angenommen');
await ruf('bu-taste', { taste: 'del' });
ok(/12\.5</.test(quickHtml), 'die Löschtaste entfernt nicht genau eine Stelle');

// ═══ 3. GESICHERT WIRD IM FORMAT DER ANDEREN GERÄTE ════════════════════
felder.buNotiz.value = 'Mittagessen';
felder.buKonto.value = 'a1';
protokoll.ops.length = 0;
await ruf('bu-kat', { kat: 'Essen' });
await ruf('bu-sichern');
ok(protokoll.ops.length === 1, `es liefen ${protokoll.ops.length} Operationen statt einer`);
{
  const op = protokoll.ops[0] || {};
  const p = op.payload || {};
  ok(op.type === 'add-transaction', `Operation "${op.type}" statt add-transaction`);
  ok(p.amount === -12.5,
    `DER FORMATFEHLER: amount ist ${p.amount} statt -12.5 — ohne Vorzeichen zählen Desktop und ` +
    'Tablet jede Ausgabe als Einnahme');
  ok(p.type === 'expense', `type "${p.type}" statt expense`);
  ok(p.category === 'Essen', 'die Kategorie wird nicht übernommen');
  ok(p.description === 'Mittagessen', 'die Notiz wird nicht übernommen');
  ok(p.date === HEUTE, 'das Datum wird nicht gesetzt');
  ok(p.accountId === 'a1', 'das gewählte Konto wird nicht mitgeschrieben');
  ok(typeof p.id === 'string' && p.id.startsWith('txn_'), 'die Kennung folgt nicht dem Muster txn_');
  ok(p.createdAt && p.updatedAt, 'die Zeitstempel fehlen');
}
ok(protokoll.geschlossen >= 1, 'das Blatt schliesst sich nach dem Sichern nicht');

// Einnahme: dasselbe, nur positiv.
await ruf('bu-neu');
await ruf('bu-typ', { typ: 'income' });
await tippe(['5', '0']);
protokoll.ops.length = 0;
await ruf('bu-sichern');
ok((protokoll.ops[0] || {}).payload?.amount === 50, 'eine Einnahme wird nicht positiv gespeichert');
ok((protokoll.ops[0] || {}).payload?.type === 'income', 'eine Einnahme trägt nicht type:income');

// Ohne Betrag wird NICHT gespeichert — sonst stehen Nullbuchungen in der Liste.
await ruf('bu-neu');
protokoll.ops.length = 0;
protokoll.toasts.length = 0;
await ruf('bu-sichern');
ok(protokoll.ops.length === 0, 'ohne Betrag wird trotzdem eine Buchung angelegt');
ok(protokoll.toasts.some((t) => /Betrag/.test(t)), 'ohne Betrag sagt die App nicht, was fehlt');

// ═══ 4. LÖSCHEN — mit Rückfrage ════════════════════════════════════════
const liste = V.render({ sub: 'txns' });
ok(/data-action="bu-loeschen"/.test(liste), 'eine Buchung lässt sich nicht löschen');
protokoll.ops.length = 0;
confirmAntwort = false;
await ruf('bu-loeschen', { id: 't1' });
ok(protokoll.confirms.length === 1, 'es wird ohne Rückfrage gelöscht');
ok(protokoll.ops.length === 0, 'trotz Abbruch wurde gelöscht');
confirmAntwort = true;
await ruf('bu-loeschen', { id: 't1' });
ok(protokoll.ops.length === 1 && protokoll.ops[0].type === 'delete-transaction',
  'nach Bestätigung wird nicht gelöscht');
ok((protokoll.ops[0] || {}).payload?.id === 't1', 'gelöscht wird die falsche Buchung');

if (luecken.length) {
  console.error(`BUDGET ERFASSUNG (Handy) — ${luecken.length} von ${checks} Pruefungen:`);
  luecken.forEach((l) => console.error('   - ' + l));
  process.exit(1);
}
console.log(`budget erfassung (Handy): ok (${checks} Pruefungen)`);
