// ============================================================================
//  Quantus Mobile — Einstiegspunkt
//  Registriert alle View-Module und startet die App-Shell.
//  Der Funktionsumfang entspricht der Tablet- und Desktop-Version: alle
//  Sammlungen, Mail, Kalender, FlowerTech, Statistiken und Journal.
// ============================================================================
import { boot } from './shell.js';
import { registerSW } from './pwa.js';

import home from './views/home.js';               // Springboard (Apple-Homebildschirm)
import uebersicht from './views/uebersicht.js';   // Karten-Dashboard
import planen from './views/planen.js';
import fokus from './views/fokus.js';
import polaris from './views/polaris.js';
import mehr from './views/mehr.js';
import mail from './views/mail.js';
import kalender from './views/kalender.js';
import statistik from './views/statistik.js';
import journal from './views/journal.js';
import flowertech from './views/flowertech.js';
import noteflow from './views/noteflow.js';
import gewohnheiten from './views/gewohnheiten.js';
import flashcards from './views/flashcards.js';
import leseplan from './views/leseplan.js';
import budget from './views/budget.js';
import gmail from './views/gmail.js';
import meetings from './views/meetings.js';
import ideen from './views/ideen.js';
import inbox from './views/inbox.js';
import einstellungen from './views/einstellungen.js';
import integrationen from './views/integrationen.js';
import { collectionViews } from './views/collection.js';

registerSW();

boot({
  home, uebersicht, planen, fokus, polaris, mehr,
  mail, kalender, statistik, journal, flowertech,
  noteflow, gewohnheiten, flashcards, budget, gmail,
  meetings, ideen, inbox, einstellungen, integrationen,
  leseplan,
  ...collectionViews,   // projekte, ziele, strategien, konzepte, programme, …
});
