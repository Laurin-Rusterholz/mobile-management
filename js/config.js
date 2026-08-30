// ============================================================================
//  Quantus Mobile — Konfiguration & Konstanten
//  ---------------------------------------------------------------------------
//  Backend-Vertrag UNVERÄNDERT gegenüber der alten Mobile-App:
//  gleicher Quantus-Blob (Key app-data.json) auf der bestehenden Domain.
//  Nur die Namen/Storage-Keys sind hier zentralisiert.
// ============================================================================

// Quantus (ai-sync) Produktion — Mobile pullt/pusht denselben Blob-Store.
export const DEFAULT_BASE_URL = 'https://management-xo2-pro.netlify.app';
export const DEFAULT_BLOB_KEY = 'app-data.json';

// localStorage-Keys (Prefix qm- für die neue App; alte qc-mobile-* werden migriert)
export const LS = {
  pending:      'qm-pending-changes',
  pendingConflicts: 'qm-pending-conflicts',
  lastData:     'qm-last-data',
  lastEtag:     'qm-last-etag',
  baseUrl:      'qm-base-url',
  blobKey:      'qm-blob-key',
  theme:        'quantus_themeMode',      // dark | light | auto  (kompatibel mit ai-sync)
  focus:        'qm-focus-session',       // laufende Fokus-Sitzung (reload-sicher)
  focusStats:   'qm-focus-sessions',      // Verlauf lokaler Fokus-Sitzungen
  focusPrefs:   'qm-focus-prefs',
  homeCards:    'qm-home-cards',          // Anordnung/Sichtbarkeit der Home-Karten
  seenPushes:   'qm-seen-pushes',
  mailCache:    'qm-mail-cache',          // zuletzt geladene Nachrichten je Ordner
  mailDrafts:   'qm-mail-drafts',         // nicht gesendete Entwürfe (offline-sicher)
  springboard:  'qm-springboard',         // Seiten-/Favoritenanordnung des Homebildschirms
};

// Migration alter qc-mobile-* Keys → neue qm-* Keys (einmalig, verlustfrei)
export function migrateLegacyKeys() {
  const map = {
    'qc-mobile-pending-changes': LS.pending,
    'qc-mobile-last-data':       LS.lastData,
    'qc-mobile-last-etag':       LS.lastEtag,
    'qc-mobile-base-url':        LS.baseUrl,
    'qc-mobile-blob-key':        LS.blobKey,
  };
  for (const [oldK, newK] of Object.entries(map)) {
    try {
      const v = localStorage.getItem(oldK);
      if (v != null && localStorage.getItem(newK) == null) localStorage.setItem(newK, v);
    } catch (e) { /* ignore */ }
  }
}

export function getBaseUrl() { return localStorage.getItem(LS.baseUrl) || DEFAULT_BASE_URL; }
export function getBlobKey() { return localStorage.getItem(LS.blobKey) || DEFAULT_BLOB_KEY; }

// Firebase-Config (nur für Storage-Download-URLs von Anhängen; identisch zur Hauptapp)
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC6xVo-wmXC4JjG7qMQnOExIJU-UDvBluE',
  authDomain: 'jupidu-36804.firebaseapp.com',
  // Die App traegt jetzt eine eigene Google-Anmeldung (js/auth.js). Damit
  // braucht sie auch projectId und databaseURL: das Career Model liegt unter
  // careerModel/users/<uid> in der Realtime Database. Beides sind dieselben
  // oeffentlichen Clientwerte, die die Hauptapp seit je verwendet — kein
  // Geheimnis, der Schutz liegt in den Firebase-Regeln.
  projectId: 'jupidu-36804',
  databaseURL: 'https://jupidu-36804-default-rtdb.europe-west1.firebasedatabase.app',
  storageBucket: 'jupidu-36804.firebasestorage.app',
};

// Bottom-Tab-Bereiche (Smartphone). „Mehr" bündelt die Sekundärmodule.
export const TABS = [
  { key: 'home',    label: 'Home',    icon: '🏠', route: 'home' },
  { key: 'planen',  label: 'Planen',  icon: '🗂️', route: 'planen' },
  { key: 'mail',    label: 'Mail',    icon: '✉️', route: 'mail' },
  { key: 'polaris', label: 'Polaris', icon: '🛰️', route: 'polaris' },
  { key: 'mehr',    label: 'Mehr',    icon: '⋯',  route: 'mehr' },
];

// Sekundärmodule im „Mehr"-Bereich (und in der Tablet-Seitenleiste sichtbar)
export const MORE_MODULES = [
  { key: 'briefing',     label: 'Briefing',      icon: '☀️', route: 'briefing',     desc: 'Der Tag auf einen Blick' },
  { key: 'uebersicht',   label: 'Übersicht',     icon: '📋', route: 'uebersicht',   desc: 'Karten-Dashboard' },
  { key: 'mail',         label: 'Mail',          icon: '✉️', route: 'mail',         desc: 'Posteingang, Suche, Senden' },
  { key: 'projekte',     label: 'Projekte',      icon: '📦', route: 'projekte',     desc: 'Vorhaben & Fortschritt' },
  { key: 'kalender',     label: 'Kalender',      icon: '📅', route: 'kalender',     desc: 'Agenda & Termine' },
  { key: 'flowertech',   label: 'FlowerTech',    icon: '🌸', route: 'flowertech',   desc: 'Projekte, Offerten, Rechnungen' },
  { key: 'noteflow',     label: 'Noteflow',      icon: '📝', route: 'noteflow',     desc: 'Notizen & Verknüpfungen' },
  { key: 'gewohnheiten', label: 'Gewohnheiten',  icon: '🔁', route: 'gewohnheiten', desc: 'Routinen & Serien' },
  { key: 'flashcards',   label: 'Flashcards',    icon: '🎴', route: 'flashcards',   desc: 'Spaced Repetition' },
  { key: 'readinghub',   label: 'Reading Hub',   icon: '📚', route: 'readinghub',   desc: 'Bücher registrieren & Lesenotizen' },
  { key: 'leseplan',     label: 'Leseplan',      icon: '📖', route: 'leseplan',     desc: 'Dokumente aufs Zieldatum verteilt' },
  // Smarter und BM-Vorbereitung fuehren bewusst auf dieselbe Ansicht: der
  // Leseplan IST beides. Zwei Kacheln, weil beide Namen gesucht werden.
  { key: 'smarter',      label: 'Smarter',       icon: '🧠', route: 'smarter',      desc: 'Tageslektion im Leseplan' },
  { key: 'bm',           label: 'BM-Vorbereitung', icon: '🎓', route: 'bm',         desc: 'Prüfungsstoff im Leseplan' },
  { key: 'career',       label: 'Career Model',  icon: '🧗', route: 'career',       desc: 'Berufsfelder, Module, Tagespensum' },
  { key: 'pinnboard',    label: 'Pinnboard',     icon: '📌', route: 'pinnboard',    desc: 'Post-its aus Quantus' },
  { key: 'budget',       label: 'Budget',        icon: '💰', route: 'budget',       desc: 'Konten & Ausgaben' },
  { key: 'meetings',     label: 'Meetings',      icon: '🤝', route: 'meetings',     desc: 'Termine & Aktionspunkte' },
  { key: 'ideen',        label: 'Ideen',         icon: '💡', route: 'ideen',        desc: 'Schnell erfassen' },
  { key: 'ziele',        label: 'Ziele',         icon: '🎯', route: 'ziele',        desc: 'Zielbild & Fortschritt' },
  { key: 'strategien',   label: 'Strategien',    icon: '🧭', route: 'strategien',   desc: 'Stossrichtungen' },
  { key: 'konzepte',     label: 'Konzepte',      icon: '🧩', route: 'konzepte',     desc: 'Konzeptor' },
  { key: 'programme',    label: 'Programme',     icon: '🗃️', route: 'programme',    desc: 'Projektbündel' },
  { key: 'organisationen', label: 'Organisationen', icon: '🏢', route: 'organisationen', desc: 'Firmen & Partner' },
  { key: 'personen',     label: 'Personen',      icon: '👤', route: 'personen',     desc: 'Kontakte' },
  { key: 'entscheidungen', label: 'Entscheidungen', icon: '⚖️', route: 'entscheidungen', desc: 'Beschlüsse & Gründe' },
  { key: 'protokolle',   label: 'Protokolle',    icon: '📄', route: 'protokolle',   desc: 'Sitzungsprotokolle' },
  { key: 'workflows',    label: 'Workflows',     icon: '🔄', route: 'workflows',    desc: 'Abläufe' },
  { key: 'journal',      label: 'Journal',       icon: '📔', route: 'journal',      desc: 'Pushes aus Quantus' },
  { key: 'statistik',    label: 'Statistiken',   icon: '📊', route: 'statistik',    desc: 'Zahlen & Verläufe' },
  { key: 'inbox',        label: 'Inbox',         icon: '📥', route: 'inbox',        desc: 'Nicht zugeordnet' },
  { key: 'gmail',        label: 'Gmail (alt)',   icon: '📧', route: 'gmail',        desc: 'Einfache Listenansicht' },
  { key: 'einstellungen',label: 'Einstellungen', icon: '⚙️', route: 'einstellungen',desc: 'App & Sync' },
  { key: 'integrationen',label: 'Integrationen', icon: '🔌', route: 'integrationen',desc: 'Backends & Dienste' },
];

// ── Generische Entitäts-Module ──────────────────────────────────────────────
// Jede Sammlung bekommt dieselbe Liste/Suche/Formular-Ansicht. Der Schlüssel
// ist der Name der Entität im Quantus-Payload (entities.<name>), damit die
// Operationen exakt dieselben Daten treffen wie Desktop und Tablet.
export const COLLECTIONS = {
  projekte:        { entity: 'projects',      kind: 'project',      label: 'Projekt',       plural: 'Projekte',        icon: '📦' },
  ziele:           { entity: 'goals',         kind: 'goal',         label: 'Ziel',          plural: 'Ziele',           icon: '🎯' },
  strategien:      { entity: 'strategies',    kind: 'strategy',     label: 'Strategie',     plural: 'Strategien',      icon: '🧭' },
  konzepte:        { entity: 'concepts',      kind: 'concept',      label: 'Konzept',       plural: 'Konzepte',        icon: '🧩' },
  programme:       { entity: 'programs',      kind: 'program',      label: 'Programm',      plural: 'Programme',       icon: '🗃️' },
  organisationen:  { entity: 'organizations', kind: 'organization', label: 'Organisation',  plural: 'Organisationen',  icon: '🏢' },
  personen:        { entity: 'persons',       kind: 'person',       label: 'Person',        plural: 'Personen',        icon: '👤' },
  entscheidungen:  { entity: 'decisions',     kind: 'decision',     label: 'Entscheidung',  plural: 'Entscheidungen',  icon: '⚖️' },
  protokolle:      { entity: 'protocols',     kind: 'protocol',     label: 'Protokoll',     plural: 'Protokolle',      icon: '📄' },
  workflows:       { entity: 'workflows',     kind: 'workflow',     label: 'Workflow',      plural: 'Workflows',       icon: '🔄' },
};

// ── Home-Bildschirm (Springboard) ───────────────────────────────────────────
// Seiten mit App-Symbolen wie auf dem iPhone/iPad-Homebildschirm, Dock unten.
export const SPRINGBOARD_PAGES = [
  {
    title: 'Alltag',
    apps: [
      { key: 'uebersicht',   label: 'Übersicht',   icon: '📋', route: 'uebersicht',   tone: 'violet' },
      { key: 'planen',       label: 'Planen',      icon: '🗂️', route: 'planen',       tone: 'blue' },
      { key: 'kalender',     label: 'Kalender',    icon: '📅', route: 'kalender',     tone: 'red' },
      { key: 'fokus',        label: 'Fokus',       icon: '🎯', route: 'fokus',        tone: 'green' },
      { key: 'projekte',     label: 'Projekte',    icon: '📦', route: 'projekte',     tone: 'sand' },
      { key: 'meetings',     label: 'Meetings',    icon: '🤝', route: 'meetings',     tone: 'blue' },
      { key: 'gewohnheiten', label: 'Routinen',    icon: '🔁', route: 'gewohnheiten', tone: 'green' },
      { key: 'inbox',        label: 'Inbox',       icon: '📥', route: 'inbox',        tone: 'sand' },
    ],
  },
  {
    title: 'Wissen & Geld',
    apps: [
      { key: 'noteflow',   label: 'Noteflow',   icon: '📝', route: 'noteflow',   tone: 'violet' },
      { key: 'ideen',      label: 'Ideen',      icon: '💡', route: 'ideen',      tone: 'sand' },
      { key: 'flashcards', label: 'Flashcards', icon: '🎴', route: 'flashcards', tone: 'red' },
      { key: 'readinghub', label: 'Reading Hub', icon: '📚', route: 'readinghub', tone: 'blue' },
      { key: 'leseplan',   label: 'Leseplan',   icon: '📖', route: 'leseplan',   tone: 'blue' },
      { key: 'career',     label: 'Career',     icon: '🧗', route: 'career',     tone: 'coral' },
      { key: 'pinnboard',  label: 'Pinnboard',  icon: '📌', route: 'pinnboard',  tone: 'coral' },
      { key: 'konzepte',   label: 'Konzepte',   icon: '🧩', route: 'konzepte',   tone: 'violet' },
      { key: 'budget',     label: 'Budget',     icon: '💰', route: 'budget',     tone: 'green' },
      { key: 'flowertech', label: 'FlowerTech', icon: '🌸', route: 'flowertech', tone: 'pink' },
      { key: 'statistik',  label: 'Statistik',  icon: '📊', route: 'statistik',  tone: 'blue' },
    ],
  },
  {
    title: 'Steuern & Kontakte',
    apps: [
      { key: 'ziele',           label: 'Ziele',        icon: '🎯', route: 'ziele',           tone: 'green' },
      { key: 'strategien',      label: 'Strategien',   icon: '🧭', route: 'strategien',      tone: 'blue' },
      { key: 'programme',       label: 'Programme',    icon: '🗃️', route: 'programme',       tone: 'sand' },
      { key: 'entscheidungen',  label: 'Entscheide',   icon: '⚖️', route: 'entscheidungen',  tone: 'red' },
      { key: 'organisationen',  label: 'Firmen',       icon: '🏢', route: 'organisationen',  tone: 'blue' },
      { key: 'personen',        label: 'Personen',     icon: '👤', route: 'personen',        tone: 'violet' },
      { key: 'protokolle',      label: 'Protokolle',   icon: '📄', route: 'protokolle',      tone: 'sand' },
      { key: 'workflows',       label: 'Workflows',    icon: '🔄', route: 'workflows',       tone: 'green' },
      { key: 'journal',         label: 'Journal',      icon: '📔', route: 'journal',         tone: 'violet' },
      { key: 'integrationen',   label: 'Dienste',      icon: '🔌', route: 'integrationen',   tone: 'blue' },
      { key: 'einstellungen',   label: 'Einstellungen',icon: '⚙️', route: 'einstellungen',   tone: 'grey' },
      { key: 'mehr',            label: 'Alle Apps',    icon: '⋯',  route: 'mehr',            tone: 'grey' },
    ],
  },
];

// Dock (unterste Reihe, auf allen Seiten sichtbar) — wie auf iOS.
export const SPRINGBOARD_DOCK = [
  { key: 'mail',    label: 'Mail',    icon: '✉️', route: 'mail',    tone: 'blue' },
  { key: 'planen',  label: 'Planen',  icon: '🗂️', route: 'planen',  tone: 'violet' },
  { key: 'polaris', label: 'Polaris', icon: '🛰️', route: 'polaris', tone: 'green' },
  { key: 'fokus',   label: 'Fokus',   icon: '🎯', route: 'fokus',   tone: 'red' },
];

// Inhaltstypen des zentralen „Neu"-Buttons
export const NEW_TYPES = [
  { key: 'shortnote',label: 'Shortnote',      icon: '⚡', route: 'noteflow' },
  { key: 'task',     label: 'Aufgabe',        icon: '✅', route: 'planen' },
  { key: 'project',  label: 'Projekt',        icon: '📦', route: 'planen' },
  { key: 'idea',     label: 'Idee',           icon: '💡', route: 'ideen' },
  { key: 'note',     label: 'Notiz',          icon: '📝', route: 'noteflow' },
  { key: 'expense',  label: 'Ausgabe',        icon: '💸', route: 'budget' },
  { key: 'habit',    label: 'Gewohnheit',     icon: '🔁', route: 'gewohnheiten' },
  { key: 'flashcard',label: 'Flashcard',      icon: '🎴', route: 'flashcards' },
  { key: 'focus',    label: 'Fokus-Sitzung',  icon: '🎯', route: 'fokus' },
];
