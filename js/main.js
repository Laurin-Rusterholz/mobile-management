// ============================================================================
//  Quantus Mobile — Einstiegspunkt
//  Registriert alle View-Module und startet die App-Shell.
// ============================================================================
import { boot } from './shell.js';
import { registerSW } from './pwa.js';

import home from './views/home.js';
import planen from './views/planen.js';
import fokus from './views/fokus.js';
import polaris from './views/polaris.js';
import mehr from './views/mehr.js';
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

registerSW();

boot({
  home, planen, fokus, polaris, mehr,
  noteflow, gewohnheiten, flashcards, budget, gmail,
  meetings, ideen, inbox, einstellungen, integrationen,
  leseplan,
});
