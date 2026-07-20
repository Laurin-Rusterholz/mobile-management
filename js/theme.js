// ============================================================================
//  Quantus Mobile — Theming (Schiefer/Leinen, übernommen aus ai-sync)
//  dark | light | auto  — persistiert unter quantus_themeMode
//  (FOUC-frei: index.html setzt die Klasse bereits vor dem Paint.)
// ============================================================================
import { LS } from './config.js';

const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

export function getThemeMode() { return localStorage.getItem(LS.theme) || 'dark'; }

export function applyTheme() {
  const mode = getThemeMode();
  const light = mode === 'light' || (mode === 'auto' && media && media.matches);
  const root = document.documentElement;
  root.classList.toggle('theme-light', light);
  root.classList.toggle('theme-dark', !light);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#cdc6b6' : '#171c20');
}

export function setThemeMode(mode) {
  localStorage.setItem(LS.theme, mode);
  applyTheme();
}

export function cycleTheme() {
  const order = ['dark', 'light', 'auto'];
  const next = order[(order.indexOf(getThemeMode()) + 1) % order.length];
  setThemeMode(next);
  return next;
}

// Auf System-Änderung reagieren, wenn im Auto-Modus
if (media && media.addEventListener) {
  media.addEventListener('change', () => { if (getThemeMode() === 'auto') applyTheme(); });
}
