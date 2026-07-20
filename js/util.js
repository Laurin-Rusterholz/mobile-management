// ============================================================================
//  Quantus Mobile — Utilities (DOM, Datum, IDs, Haptik, Toast, Sheet, Confirm)
// ============================================================================

// ── DOM ──
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function escAttr(s) { return escHTML(s); }

// ── IDs (gleiche Konvention wie Quantus/alte Mobile-App: kind_<ts36><rand>) ──
export function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
export function newId(kind) { return kind + '_' + generateId(); }
export function nowISO() { return new Date().toISOString(); }

// ── Datum ──
export function todayYmd(d) {
  const x = d || new Date();
  const pad = n => String(n).padStart(2, '0');
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}
export function ymdOf(iso) { try { return todayYmd(new Date(iso)); } catch (e) { return null; } }

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const yesterday = new Date(today.getTime() - 86400000);
  const dDay = new Date(d); dDay.setHours(0, 0, 0, 0);
  if (dDay.getTime() === today.getTime()) return 'Heute';
  if (dDay.getTime() === tomorrow.getTime()) return 'Morgen';
  if (dDay.getTime() === yesterday.getTime()) return 'Gestern';
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: 'short' });
}
export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}
export function fmtMoney(n, cur = 'CHF') {
  const v = Number(n || 0);
  return v.toLocaleString('de-CH', { style: 'currency', currency: cur || 'CHF' });
}
export function fmtDurationMin(min) {
  min = Math.round(min || 0);
  if (min < 60) return min + ' Min';
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} Min` : `${h} h`;
}
export function fmtMs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// ── Haptik (mobile Mikro-Interaktion, übernommen) ──
export function haptic(pattern = 12) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
}

// ── Toast ──
let _toastTimer = null;
export function toast(msg, kind = 'ok', ms = 2600) {
  let host = $('#toastHost');
  if (!host) {
    host = el('<div id="toastHost" class="toast-host"></div>');
    document.body.appendChild(host);
  }
  const t = el(`<div class="toast ${kind}">${escHTML(msg)}</div>`);
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(_toastTimer);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 240);
  }, ms);
}

// ── Bottom-Sheet (mobiles Formular-/Detail-Overlay) ──
// openSheet({ title, body(htmlString), size:'half'|'full', onMount(root), onClose })
let _sheetState = null;
export function openSheet(opts) {
  closeSheet();
  const size = opts.size || 'half';
  const overlay = el(`
    <div class="sheet-overlay open" id="sheetOverlay">
      <div class="sheet ${size === 'full' ? 'full' : ''}" id="sheet" role="dialog" aria-modal="true">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <div class="sheet-title">${escHTML(opts.title || '')}</div>
          <div class="sheet-actions">
            <button class="sheet-btn" data-sheet="toggle" aria-label="Größe">⤢</button>
            <button class="sheet-btn" data-sheet="close" aria-label="Schließen">✕</button>
          </div>
        </div>
        <div class="sheet-body" id="sheetBody">${opts.body || ''}</div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');
  _sheetState = { overlay, onClose: opts.onClose };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  overlay.querySelector('[data-sheet="close"]').addEventListener('click', closeSheet);
  overlay.querySelector('[data-sheet="toggle"]').addEventListener('click', () => {
    overlay.querySelector('#sheet').classList.toggle('full');
  });
  const root = overlay.querySelector('#sheetBody');
  if (typeof opts.onMount === 'function') opts.onMount(root);
  // erstes Eingabefeld fokussieren
  const first = root.querySelector('input,textarea,select');
  if (first) setTimeout(() => first.focus(), 120);
  return root;
}
export function closeSheet() {
  if (!_sheetState) return;
  const { overlay, onClose } = _sheetState;
  _sheetState = null;
  document.body.classList.remove('no-scroll');
  overlay.classList.remove('open');
  setTimeout(() => overlay.remove(), 220);
  if (typeof onClose === 'function') onClose();
}

// ── Bestätigung mit Vorschau (für Senden/Löschen/Massen-/Finanzänderungen) ──
// confirmPreview({ title, previewHtml, confirmLabel, danger }) -> Promise<bool>
export function confirmPreview(opts) {
  return new Promise((resolve) => {
    const overlay = el(`
      <div class="modal-overlay open" id="confirmOverlay">
        <div class="modal" role="alertdialog" aria-modal="true">
          <div class="modal-title">${escHTML(opts.title || 'Bestätigen')}</div>
          <div class="modal-preview">${opts.previewHtml || ''}</div>
          <div class="modal-actions">
            <button class="btn ghost" data-c="cancel">Abbrechen</button>
            <button class="btn ${opts.danger ? 'danger' : 'primary'}" data-c="ok">${escHTML(opts.confirmLabel || 'Bestätigen')}</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    overlay.querySelector('[data-c="cancel"]').addEventListener('click', () => done(false));
    overlay.querySelector('[data-c="ok"]').addEventListener('click', () => { haptic(18); done(true); });
  });
}

// ── einfache Text-/Empty-/Loading-Bausteine ──
export function emptyState(icon, title, sub, actionHtml = '') {
  return `<div class="empty">
    <div class="empty-icon">${icon}</div>
    <div class="empty-title">${escHTML(title)}</div>
    ${sub ? `<div class="empty-sub">${escHTML(sub)}</div>` : ''}
    ${actionHtml}
  </div>`;
}
export function skeletonList(n = 4) {
  return `<div class="skel-list">${Array.from({ length: n }, () => '<div class="skel-row"></div>').join('')}</div>`;
}
