/*
 * Ausgehende Mails gehen erst in drei Stunden raus — auch vom Telefon.
 *
 * AUFTRAG (13.09.2026): Was in Quantus verschickt wird, soll standardmaessig
 * drei Stunden liegen bleiben, sichtbar und abbrechbar. Diese App hatte zwei
 * Stellen, die unmittelbar verschickten:
 *     js/views/mail.js   → POST /users/me/messages/send
 *     js/views/gmail.js  → POST /users/me/messages/send
 * Ein Timer im Telefon kann das nicht leisten: das Geraet wird zugeklappt,
 * der Tab entladen, das Funkloch dauert. Geplant und gesendet wird deshalb
 * serverseitig (/.netlify/functions/mail-queue) — hier wird nur geplant,
 * angezeigt, abgebrochen oder ausdruecklich sofort gesendet.
 *
 * WAS HIER GEMESSEN WIRD (am ausgelieferten Quelltext, ohne Netz):
 *  1. Keine der beiden Ansichten schickt noch selbst eine Mail los.
 *  2. Beide planen ueber dieselbe Warteschlange.
 *  3. Beide zeigen den Ausgang und koennen abbrechen bzw. sofort senden.
 *  4. Die Zeit wird in Europe/Zurich angezeigt, nicht in Geraetezeit.
 *  5. Gmails eigene „Geplant"-Ansicht wird nicht vorgetaeuscht.
 * GEGENPROBE: dieselben Pruefungen gegen den Stand vor der Aenderung.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASIS = process.env.MAIL_BASIS_COMMIT || '685fe8e';
const lies = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let checks = 0;
const luecken = [];
const ok = (b, t) => { checks++; if (!b) luecken.push(t); };

const PRUEFUNGEN = {
  'mail.js sendet nicht mehr selbst': (q) => !q.mail.includes("'/users/me/messages/send'"),
  'gmail.js sendet nicht mehr selbst': (q) => !q.gmail.includes("'/users/me/messages/send'"),
  'mail.js plant ueber die Warteschlange': (q) =>
    q.mail.includes("/.netlify/functions/mail-queue") && q.mail.includes("queueRpc('plane'"),
  'gmail.js plant ueber die Warteschlange': (q) =>
    q.gmail.includes("/.netlify/functions/mail-queue") && q.gmail.includes("queueRpc('plane'"),
  'mail.js hat einen Ausgang': (q) =>
    q.mail.includes("key: 'outbox'") && q.mail.includes('ausgangHtml'),
  'gmail.js hat einen Ausgang': (q) => q.gmail.includes('openOutboxSheet'),
  'abbrechen und sofort senden sind moeglich': (q) =>
    q.mail.includes("queueRpc('abbrechen'") && q.mail.includes("queueRpc('sofort'") &&
    q.gmail.includes("queueRpc('abbrechen'") && q.gmail.includes("queueRpc('sofort'"),
  'die Zeit steht in Europe/Zurich': (q) =>
    q.mail.includes("timeZone: VERSANDZONE") && q.gmail.includes("timeZone: VERSANDZONE") &&
    q.mail.includes("'Europe/Zurich'"),
  'der Knopf sagt, dass er plant': (q) =>
    q.mail.includes('Senden (in 3 h)') && q.gmail.includes('Senden (in 3 h)'),
  'Gmails Geplant-Ansicht wird nicht vorgetaeuscht': (q) =>
    !q.mail.includes('SCHEDULED') && !q.gmail.includes('SCHEDULED'),
  'kein Geraetetimer plant den Versand': (q) =>
    !/setInterval\([^)]*send/i.test(q.mail) && !/setInterval\([^)]*send/i.test(q.gmail),
  /* Ein Versand, dessen Ausgang ungeklaert ist, wird NIE automatisch
     wiederholt — er wird gezeigt und nur von einem Menschen geklaert. */
  'ein ungeklaerter Versand wird gezeigt': (q) =>
    q.mail.includes("'unklar'") && q.gmail.includes("'unklar'") &&
    q.mail.includes('Ungeklärt') && q.gmail.includes('Ungeklärt'),
  'geklaert wird nur ausdruecklich': (q) =>
    q.mail.includes("queueRpc('geklaert-gesendet'") && q.mail.includes("queueRpc('geklaert-nicht-gesendet'") &&
    q.gmail.includes("queueRpc('geklaert-gesendet'") && q.gmail.includes("queueRpc('geklaert-nicht-gesendet'"),
};

const jetzt = { mail: lies('js/views/mail.js'), gmail: lies('js/views/gmail.js') };
for (const [name, fn] of Object.entries(PRUEFUNGEN)) {
  let r = false; try { r = !!fn(jetzt); } catch (e) { r = false; }
  ok(r, name);
}

// Gegenprobe gegen den Stand vor der Aenderung.
let alt = null;
try {
  alt = {
    mail: execFileSync('git', ['show', BASIS + ':js/views/mail.js'], { cwd: root }).toString('utf8'),
    gmail: execFileSync('git', ['show', BASIS + ':js/views/gmail.js'], { cwd: root }).toString('utf8'),
  };
} catch (e) { console.log('  (Gegenprobe uebersprungen — ' + BASIS + ' nicht lesbar)'); }
if (alt) {
  const durch = Object.entries(PRUEFUNGEN).filter(([, fn]) => { try { return !fn(alt); } catch (e) { return true; } });
  console.log(`  Gegenprobe ${BASIS}: ${durch.length} von ${Object.keys(PRUEFUNGEN).length} Pruefungen fallen dort durch`);
  durch.forEach(([n]) => console.log('    ✗ ' + n));
  const namen = durch.map(([n]) => n);
  ok(namen.includes('mail.js sendet nicht mehr selbst'), 'Gegenprobe: alt sendet mail.js sofort');
  ok(namen.includes('gmail.js sendet nicht mehr selbst'), 'Gegenprobe: alt sendet gmail.js sofort');
  ok(namen.includes('mail.js hat einen Ausgang'), 'Gegenprobe: alt hat keinen Ausgang');
}

if (luecken.length) {
  console.error('mail versandplanung (mobil): FEHLER');
  luecken.forEach((l) => console.error('  ✗ ' + l));
  process.exit(1);
}
console.log(`mail versandplanung (mobil): ok (${checks} Pruefungen)`);
