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
import googlecalendar from './views/googlecalendar.js';
import statistik from './views/statistik.js';
import journal from './views/journal.js';
import flowertech from './views/flowertech.js';
import noteflow from './views/noteflow.js';
import gewohnheiten from './views/gewohnheiten.js';
import flashcards from './views/flashcards.js';
import leseplan from './views/leseplan.js';
import readinghub from './views/readinghub.js';
import briefing from './views/briefing.js';
import pinnboard from './views/pinnboard.js';
import career from './views/career.js';   // careerModel/users/<uid>, eigene Anmeldung
import budget from './views/budget.js';
import gmail from './views/gmail.js';
import meetings from './views/meetings.js';
import ideen from './views/ideen.js';
import inbox from './views/inbox.js';
import einstellungen from './views/einstellungen.js';
import integrationen from './views/integrationen.js';
import chatgpt from './views/chatgpt.js';        // ChatGPT Notes, Leads, ChatGPT-Aufgaben
import { collectionViews } from './views/collection.js';

registerSW();

boot({
  home, uebersicht, planen, fokus, polaris, mehr,
  mail, kalender, googlecalendar, statistik, journal, flowertech,
  noteflow, gewohnheiten, flashcards, budget, gmail,
  meetings, ideen, inbox, einstellungen, integrationen,
  leseplan, readinghub, briefing, pinnboard, career, chatgpt,
  // Smarter und BM-Vorbereitung sind KEINE eigenen Apps: leseplan.js ist
  // ausweislich seines eigenen Kopfes die "Kombination aus Smarter +
  // BM-Vorbereitung". Statt zwei Attrappen zu bauen, fuehren beide Namen auf
  // dieselbe Ansicht — so laufen die Kacheln nicht mehr ins Leere und die App
  // verweist fuer sie auch nicht mehr nach draussen.
  smarter: leseplan,
  bm: leseplan,
  ...collectionViews,   // projekte, ziele, strategien, konzepte, programme, …
});
