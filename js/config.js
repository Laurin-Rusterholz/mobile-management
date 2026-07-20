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
  storageBucket: 'jupidu-36804.firebasestorage.app',
};

// Bottom-Tab-Bereiche (Smartphone). „Mehr" bündelt die Sekundärmodule.
export const TABS = [
  { key: 'home',    label: 'Home',    icon: '🏠', route: 'home' },
  { key: 'planen',  label: 'Planen',  icon: '🗂️', route: 'planen' },
  { key: 'fokus',   label: 'Fokus',   icon: '🎯', route: 'fokus' },
  { key: 'polaris', label: 'Polaris', icon: '🛰️', route: 'polaris' },
  { key: 'mehr',    label: 'Mehr',    icon: '⋯',  route: 'mehr' },
];

// Sekundärmodule im „Mehr"-Bereich (und in der Tablet-Seitenleiste sichtbar)
export const MORE_MODULES = [
  { key: 'noteflow',     label: 'Noteflow',      icon: '📝', route: 'noteflow',     desc: 'Notizen & Verknüpfungen' },
  { key: 'gewohnheiten', label: 'Gewohnheiten',  icon: '🔁', route: 'gewohnheiten', desc: 'Routinen & Serien' },
  { key: 'flashcards',   label: 'Flashcards',    icon: '🎴', route: 'flashcards',   desc: 'Spaced Repetition' },
  { key: 'leseplan',     label: 'Leseplan',      icon: '📖', route: 'leseplan',     desc: 'Dokumente aufs Zieldatum verteilt' },
  { key: 'budget',       label: 'Budget',        icon: '💰', route: 'budget',       desc: 'Konten & Ausgaben' },
  { key: 'gmail',        label: 'Gmail',         icon: '📧', route: 'gmail',        desc: 'Posteingang' },
  { key: 'meetings',     label: 'Meetings',      icon: '🤝', route: 'meetings',     desc: 'Termine & Aktionspunkte' },
  { key: 'ideen',        label: 'Ideen',         icon: '💡', route: 'ideen',        desc: 'Schnell erfassen' },
  { key: 'inbox',        label: 'Inbox',         icon: '📥', route: 'inbox',        desc: 'Nicht zugeordnet' },
  { key: 'einstellungen',label: 'Einstellungen', icon: '⚙️', route: 'einstellungen',desc: 'App & Sync' },
  { key: 'integrationen',label: 'Integrationen', icon: '🔌', route: 'integrationen',desc: 'Backends & Dienste' },
];

// Inhaltstypen des zentralen „Neu"-Buttons
export const NEW_TYPES = [
  { key: 'task',     label: 'Aufgabe',        icon: '✅', route: 'planen' },
  { key: 'project',  label: 'Projekt',        icon: '📦', route: 'planen' },
  { key: 'idea',     label: 'Idee',           icon: '💡', route: 'ideen' },
  { key: 'note',     label: 'Notiz',          icon: '📝', route: 'noteflow' },
  { key: 'expense',  label: 'Ausgabe',        icon: '💸', route: 'budget' },
  { key: 'habit',    label: 'Gewohnheit',     icon: '🔁', route: 'gewohnheiten' },
  { key: 'flashcard',label: 'Flashcard',      icon: '🎴', route: 'flashcards' },
  { key: 'focus',    label: 'Fokus-Sitzung',  icon: '🎯', route: 'fokus' },
];
