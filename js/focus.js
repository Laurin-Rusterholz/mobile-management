// ============================================================================
//  Quantus Mobile — Fokus-Timer
//  ---------------------------------------------------------------------------
//  Anforderungen (Konzept):
//   • Läuft nur bei sichtbar geöffneter App.
//   • Bei Verlassen / Sperren / Hintergrund → gestoppt und als UNTERBROCHEN
//     gespeichert.
//   • Reload verfälscht die Zeit NICHT (Startzeitpunkt persistiert; die
//     verstrichene Zeit wird immer aus Timestamps berechnet, nie hochgezählt).
//   • Modi: frei (offen), 25, 50, individuell.
//   • Statistiken pro Tag/Woche/Projekt/Aufgabe.
//  ---------------------------------------------------------------------------
//  Eine abgeschlossene/gestoppte Sitzung ≥ 60 s wird als TimeEntry in den
//  Quantus-Blob geschrieben (add-time-entry), damit sie in Quantus erscheint.
// ============================================================================
import { LS } from './config.js';
import { newId, nowISO, todayYmd, haptic, toast, fmtMs } from './util.js';
import { performOp } from './store.js';

let _tick = null;
let _wakeLock = null;
let _onChange = null;   // UI-Callback (Sekundentakt)

export function onFocusChange(fn) { _onChange = fn; }

// ── Persistenter Zustand der laufenden Sitzung ──
function loadActive() {
  try { const r = localStorage.getItem(LS.focus); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function saveActive(a) {
  try { a ? localStorage.setItem(LS.focus, JSON.stringify(a)) : localStorage.removeItem(LS.focus); } catch (e) {}
}
export function getActive() { return loadActive(); }
export function isRunning() { return !!loadActive(); }

// verstrichene Zeit ausschließlich aus Timestamps (reload-sicher)
export function elapsedMs(a = loadActive()) {
  if (!a) return 0;
  return Math.max(0, Date.now() - a.startedAt);
}
export function remainingMs(a = loadActive()) {
  if (!a || !a.durationMs) return null; // freier Modus
  return a.durationMs - elapsedMs(a);
}

// ── Prefs ──
export function getPrefs() {
  try { return { durationMin: 25, taskId: '', sessionName: '', ...JSON.parse(localStorage.getItem(LS.focusPrefs) || '{}') }; }
  catch (e) { return { durationMin: 25, taskId: '', sessionName: '' }; }
}
export function savePrefs(p) { try { localStorage.setItem(LS.focusPrefs, JSON.stringify(p)); } catch (e) {} }

// ── Verlauf ──
export function getSessions() {
  try { return JSON.parse(localStorage.getItem(LS.focusStats) || '[]'); } catch (e) { return []; }
}
function saveSessions(arr) { try { localStorage.setItem(LS.focusStats, JSON.stringify(arr.slice(-300))); } catch (e) {} }

// ── Start ──
// opts: { durationMin: number|0 (0=frei), taskId, taskTitle, sessionName }
export function start(opts = {}) {
  if (loadActive()) return loadActive();
  const durationMin = Number(opts.durationMin || 0);
  const a = {
    id: newId('focus'),
    startedAt: Date.now(),
    durationMs: durationMin > 0 ? durationMin * 60000 : 0,   // 0 = freier Modus
    taskId: opts.taskId || '',
    taskTitle: opts.taskTitle || '',
    projectId: opts.projectId || '',
    sessionName: opts.sessionName || 'Deep Work',
  };
  saveActive(a);
  requestWakeLock();
  startTicker();
  haptic(16);
  if (_onChange) _onChange();
  return a;
}

// ── Beenden ──
// reason: 'completed' | 'stopped' | 'interrupted'
export async function finish(reason = 'stopped') {
  const a = loadActive();
  stopTicker();
  releaseWakeLock();
  if (!a) return null;
  const actualMs = elapsedMs(a);
  saveActive(null);

  const session = {
    id: a.id,
    startedAt: new Date(a.startedAt).toISOString(),
    endedAt: nowISO(),
    dateYmd: todayYmd(new Date(a.startedAt)),
    plannedMs: a.durationMs,
    actualMs,
    taskId: a.taskId,
    taskTitle: a.taskTitle,
    projectId: a.projectId,
    sessionName: a.sessionName,
    reason,            // completed | stopped | interrupted
    interrupted: reason === 'interrupted',
  };
  const arr = getSessions(); arr.push(session); saveSessions(arr);

  // ≥ 60 s → als TimeEntry in Quantus erfassen
  if (actualMs >= 60000) {
    const label = a.sessionName && a.sessionName !== 'Deep Work' ? 'Deep Work · ' + a.sessionName : 'Deep Work';
    await performOp({
      type: 'add-time-entry',
      payload: {
        id: newId('te'),
        taskId: a.taskId || null,
        projectId: a.projectId || null,
        startTs: session.startedAt,
        endTs: session.endedAt,
        durationSec: Math.round(actualMs / 1000),
        note: label + (reason === 'interrupted' ? ' (unterbrochen)' : ''),
        category: 'Fokus',
        source: 'mobile',
        createdAt: nowISO(),
        updatedAt: nowISO(),
      },
    });
  }

  if (reason === 'completed') { haptic([120, 60, 120, 60, 240]); toast('Session abgeschlossen ⚡ — in Quantus erfasst', 'ok'); }
  else if (reason === 'interrupted') { toast('Fokus unterbrochen (App verlassen) — als unterbrochen gespeichert', 'warn'); }
  else if (actualMs >= 60000) toast('Session gestoppt — in Quantus erfasst', 'ok');
  else toast('Session gestoppt', 'ok');

  if (_onChange) _onChange();
  return session;
}

// ── Ticker (nur Anzeige; Zeit kommt immer aus Timestamps) ──
function startTicker() {
  stopTicker();
  _tick = setInterval(() => {
    const a = loadActive();
    if (!a) { stopTicker(); return; }
    if (a.durationMs && remainingMs(a) <= 0) { finish('completed'); return; }
    if (_onChange) _onChange();
  }, 500);
}
function stopTicker() { if (_tick) { clearInterval(_tick); _tick = null; } }

// ── Wake Lock (Bildschirm an während Fokus) ──
async function requestWakeLock() {
  try {
    if (_wakeLock) return;
    if (navigator.wakeLock && navigator.wakeLock.request) {
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    }
  } catch (e) { /* ignore */ }
}
function releaseWakeLock() { try { if (_wakeLock) { _wakeLock.release(); _wakeLock = null; } } catch (e) {} }

// ── Hintergrund/Sperre/Verlassen → als UNTERBROCHEN stoppen ──
function onHidden() { if (document.hidden && loadActive()) finish('interrupted'); }
document.addEventListener('visibilitychange', onHidden);
window.addEventListener('pagehide', () => { if (loadActive()) finish('interrupted'); });
// blur (Fenster verliert Fokus, z.B. App-Wechsel am Desktop/Tablet)
window.addEventListener('blur', () => { setTimeout(() => { if (document.hidden && loadActive()) finish('interrupted'); }, 0); });

// Beim App-Start: eine noch „laufende" Sitzung aus vorheriger Sichtbarkeit
// wurde durch Verlassen unterbrochen → sauber als unterbrochen abschließen.
export function reconcileOnBoot() {
  const a = loadActive();
  if (a) { finish('interrupted'); }
}

// ── Statistiken ──
export function statsForDay(ymd = todayYmd()) {
  const s = getSessions().filter(x => x.dateYmd === ymd);
  return { count: s.length, minutes: Math.round(s.reduce((t, x) => t + (x.actualMs || 0), 0) / 60000) };
}
export function statsForWeek() {
  const since = Date.now() - 7 * 86400000;
  const s = getSessions().filter(x => new Date(x.startedAt).getTime() >= since);
  return { count: s.length, minutes: Math.round(s.reduce((t, x) => t + (x.actualMs || 0), 0) / 60000) };
}
export function statsByTask() {
  const map = {};
  getSessions().forEach(s => {
    const k = s.taskTitle || (s.taskId ? s.taskId : '— ohne Aufgabe');
    map[k] = (map[k] || 0) + (s.actualMs || 0);
  });
  return Object.entries(map).map(([k, ms]) => ({ label: k, minutes: Math.round(ms / 60000) }))
    .sort((a, b) => b.minutes - a.minutes);
}
export { fmtMs };
