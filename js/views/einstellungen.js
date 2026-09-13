// ============================================================================
//  Einstellungen — Theme, Sync-Konfiguration, Diagnose, Backup, PWA-Install
// ============================================================================
import { escHTML, toast, todayYmd } from '../util.js';
import { LS, DEFAULT_BASE_URL, DEFAULT_BLOB_KEY, getBaseUrl, getBlobKey, getAuthToken, setAuthToken } from '../config.js';
import * as store from '../store.js';
import { getThemeMode, setThemeMode } from '../theme.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader } from './common.js';
import { getInstallPrompt } from '../pwa.js';
import * as auth from '../auth.js';

// Konfliktablage (Review P2-3): unterlegene Sync-Fassungen sichtbar machen,
// als Notizkopie zurückholen oder bewusst verwerfen.
function conflictSection() {
  const conflicts = store.pendingConflicts();
  if (!conflicts.length) return '';
  const label = (record) => {
    if (record && record.kind === 'remote-superseded') return 'Serverfassung unterlegen (lokal war neuer)';
    if (record && record.kind === 'local-superseded') return 'Lokale Fassung unterlegen (Server war neuer)';
    return 'Übersprungene Offline-Änderung';
  };
  const title = (record) => {
    const snap = (record && (record.snapshot || record.payload)) || {};
    return String(snap.title || snap.content || (record && record.opType) || 'Änderung').replace(/\s+/g, ' ').slice(0, 48);
  };
  const rows = conflicts.map((record, index) => ({ record, index })).slice(-20).map(({ record, index }) => `
    <div class="diag-row"><span>${escHTML(title(record))}<br><small>${escHTML(label(record))}</small></span>
      <b><button class="chip" data-action="conflict-restore" data-i="${index}">Als Kopie zurückholen</button></b></div>`).join('');
  return `<div class="section-title">Konfliktablage (${conflicts.length})</div>
    <div class="card"><div class="diag">${rows}
      <div class="diag-row"><span>Alle Einträge verwerfen</span><b><button class="chip" data-action="conflicts-clear">Leeren</button></b></div>
    </div></div>`;
}

registerActions({
  'conflict-restore': async (data) => {
    const note = await store.restoreConflictAsNote(Number(data.i));
    if (note) { toast('Unterlegene Fassung als Notizkopie in der Inbox', 'ok'); navigate('einstellungen'); }
    else toast('Eintrag nicht gefunden', 'warn');
  },
  'conflicts-clear': () => {
    if (!confirm('Konfliktablage wirklich leeren? Die unterlegenen Fassungen gehen verloren.')) return;
    store.clearConflicts();
    toast('Konfliktablage geleert', 'ok');
    navigate('einstellungen');
  },
  // Die App traegt die Google-Anmeldung selbst — eine Firebase-Sitzung gilt
  // pro Origin, und dieser Origin ist nicht der der Hauptapp. Ein blosser
  // Verweis nach Quantus haette hier nie eine Nutzerkennung ergeben.
  'auth-login': async () => {
    const r = await auth.signInGoogle();
    if (r.ok) { navigate('einstellungen'); return; }
    if (r.abgebrochen) return;
    toast(r.grund || 'Anmeldung fehlgeschlagen', 'error');
  },
  'auth-logout': async () => {
    const r = await auth.signOutGoogle();
    if (!r.ok) { toast(r.grund || 'Abmelden fehlgeschlagen', 'error'); return; }
    toast('Abgemeldet', 'ok'); navigate('einstellungen');
  },
  'set-theme': (d) => { setThemeMode(d.mode); navigate('einstellungen'); },
  'sync-now': () => store.manualSync(),
  'edit-baseurl': () => {
    const v = prompt('Server-URL (Quantus-Domain):', getBaseUrl()); if (v == null) return;
    const c = v.trim().replace(/\/+$/, '');
    if (!c) localStorage.removeItem(LS.baseUrl);
    else if (!/^https?:\/\//.test(c)) { toast('URL muss mit https:// beginnen', 'error'); return; }
    else localStorage.setItem(LS.baseUrl, c);
    store.state.initialPullDone = false; store.state.initialPullStatus = 'pending'; store.pullData(false); navigate('einstellungen');
  },
  'edit-blobkey': () => {
    const v = prompt('Blob-Key:', getBlobKey()); if (v == null) return;
    const c = v.trim();
    if (!c || c === DEFAULT_BLOB_KEY) localStorage.removeItem(LS.blobKey); else localStorage.setItem(LS.blobKey, c);
    store.state.initialPullDone = false; store.state.initialPullStatus = 'pending'; store.pullData(false); navigate('einstellungen');
  },
  /* Der Zugangsschlüssel bleibt im Gerät. Er steht in keiner Adresse, in
     keinem Quelltext und wird auch nicht mitsynchronisiert — eingetragen wird
     er von Hand, so wie in Quantus am Rechner. */
  'edit-authtoken': () => {
    const v = prompt('Zugangsschlüssel (derselbe wie in Quantus am Rechner). Leer lassen = entfernen:', getAuthToken());
    if (v == null) return;
    setAuthToken(v);
    toast(String(v).trim() ? 'Zugangsschlüssel gespeichert' : 'Zugangsschlüssel entfernt', 'ok');
    navigate('einstellungen');
  },
  'reset-sync': () => {
    if (!confirm('Server-URL & Blob-Key zurücksetzen?')) return;
    localStorage.removeItem(LS.baseUrl); localStorage.removeItem(LS.blobKey);
    store.state.initialPullDone = false; store.state.initialPullStatus = 'pending'; store.pullData(false); navigate('einstellungen');
  },
  'export-data': () => {
    const backup = { data: store.state.data, etag: store.state.etag, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'quantus-backup-' + todayYmd() + '.json'; a.click();
    toast('Backup exportiert', 'ok');
  },
  'pwa-install': async () => {
    const p = getInstallPrompt();
    if (!p) { toast('Installation über das Browser-Menü („Zum Homescreen")', 'warn'); return; }
    p.prompt(); const res = await p.userChoice; toast(res.outcome === 'accepted' ? 'Installiert ✓' : 'Abgebrochen', 'ok');
  },
});

// Konto — Zustand ehrlich benennen, auch wenn er unerfreulich ist. Ein
// stummes "nicht angemeldet" waere hier besonders irrefuehrend: die App
// funktioniert ohne Anmeldung vollstaendig weiter, nur das Career Model nicht.
function kontoBlock() {
  if (!auth.sdkBereit()) {
    return `<div class="card"><div class="diag">
      <div class="diag-row"><span>Google-Anmeldung</span><b>SDK nicht geladen</b></div>
    </div></div>`;
  }
  const u = auth.currentUser();
  if (!u) {
    return `<div class="card">
      <div class="set-note">Nur fürs Career Model nötig — es liegt unter deiner Nutzerkennung.
        Aufgaben, Notizen und alles Übrige laufen ohne Anmeldung weiter.</div>
      <button class="btn primary block" data-action="auth-login">Mit Google anmelden</button>
    </div>`;
  }
  return `<div class="card">
    <div class="diag">
      <div class="diag-row"><span>Angemeldet als</span><b>${escHTML(u.displayName || u.email || u.uid)}</b></div>
      ${u.email && u.displayName ? `<div class="diag-row"><span>E-Mail</span><b>${escHTML(u.email)}</b></div>` : ''}
    </div>
    <button class="btn block" data-action="auth-logout" style="margin-top:10px">Abmelden</button>
  </div>`;
}

function row(label, value, action) {
  return `<button class="set-row" ${action ? `data-action="${action}"` : ''}>
    <span class="set-label">${escHTML(label)}</span><span class="set-value">${escHTML(value)}</span></button>`;
}

export default {
  title: 'Einstellungen', icon: '⚙️',
  render() {
    const mode = getThemeMode();
    const counts = {
      Aufgaben: store.getTasks().length, Notizen: store.getNotes().length,
      Ideen: store.getIdeaNotes().filter((note) => ((note.ideaMeta && note.ideaMeta.status) || note.status || 'idea') !== 'archived').length,
      Projekte: store.getProjects().length, Buchungen: store.getTransactions().length, Karten: store.getCards().length,
    };
    const meta = (store.state.data && store.state.data.meta) || {};
    return `<div class="pad">
      ${pageHeader('Einstellungen', 'App & Sync')}

      <div class="section-title">Konto</div>
      ${kontoBlock()}

      <div class="section-title">Darstellung</div>
      <div class="segmented">
        ${['dark', 'light', 'auto'].map(m => `<button class="seg ${mode === m ? 'active' : ''}" data-action="set-theme" data-mode="${m}">${m === 'dark' ? '🌙 Dunkel' : m === 'light' ? '☀️ Hell' : '🌓 Auto'}</button>`).join('')}
      </div>

      <div class="section-title">Installation</div>
      ${row('Als App installieren (PWA)', 'Installieren', 'pwa-install')}

      <div class="section-title">Sync</div>
      ${row('Status', store.pullStatus() === 'ok' ? 'Verbunden' : store.pullStatus(), 'sync-now')}
      ${row('Ausstehende Änderungen', String(store.pendingCount()), 'sync-now')}
      ${row('Server-URL', getBaseUrl().replace(/^https?:\/\//, ''), 'edit-baseurl')}
      ${row('Blob-Key', getBlobKey(), 'edit-blobkey')}
      ${row('Zugangsschlüssel (Ausgang)', getAuthToken() ? 'hinterlegt' : 'fehlt — Ausgang gesperrt', 'edit-authtoken')}
      ${row('Auf Standard zurücksetzen', DEFAULT_BASE_URL.replace(/^https?:\/\//, ''), 'reset-sync')}

      ${conflictSection()}

      <div class="section-title">Diagnose</div>
      <div class="card"><div class="diag">
        ${Object.entries(counts).map(([k, v]) => `<div class="diag-row"><span>${k}</span><b>${v}</b></div>`).join('')}
        <div class="diag-row"><span>Zuletzt gespeichert von</span><b>${escHTML(meta.lastSavedBy || '—')}</b></div>
        <div class="diag-row"><span>ETag</span><b>${escHTML((store.state.etag || '—').slice(0, 16))}</b></div>
      </div></div>

      <div class="section-title">Backup</div>
      ${row('Datensatz exportieren (JSON)', 'Export', 'export-data')}
    </div>`;
  },
  // Nach der Rueckkehr aus einer Anmelde-Weiterleitung feuert
  // onAuthStateChanged ERST NACH dem ersten Zeichnen. Ohne diesen Hoerer
  // stuende dort weiterhin "Mit Google anmelden", obwohl man angemeldet ist.
  mount() {
    this._ab = auth.onAuthChange(() => {
      if (location.hash.indexOf('einstellungen') < 0) return;
      navigate('einstellungen');
    });
  },
  unmount() { if (this._ab) { this._ab(); this._ab = null; } },
};
