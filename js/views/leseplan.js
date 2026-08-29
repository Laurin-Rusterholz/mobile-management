// ============================================================================
//  Leseplan — dokumentbasiertes, ueber ein Zieldatum verteiltes taegliches Lesen
//  (Kombination aus Smarter + BM-Vorbereitung). Mehrere Dokumente laufen PARALLEL,
//  je mit eigenem Zieldatum, eigener Aufteilung, eigenem Fortschritt.
//
//  Tablet: Zweispaltenansicht (links Dokumentliste mit Fortschritt/Zieldatum,
//  rechts aktuelle Leseeinheit). Phone: Liste -> Sheet mit Leseeinheit.
//
//  Datenquelle: Firebase RTDB (offene $andere-Regel) unter leseplan/ — direkter
//  REST-Zugriff, kein Login, kein app-data-Blob. Additiv: beruehrt store.js und
//  den bestehenden Blob-Sync NICHT. Aufteilungs-/Tempo-Logik ist DOM-frei und
//  identisch zum ai-synch-Kern und zum n8n-Code-Node.
// ============================================================================
import { escHTML, toast, openSheet, closeSheet, confirmPreview, todayYmd } from '../util.js';
import { registerActions } from '../actions.js';
import { navigate, current } from '../router.js';
import { isTablet } from '../shell.js';
import { pageHeader } from './common.js';
import * as store from '../store.js';
import { openNoteComposer } from '../note-ui.js';

const RTDB = 'https://jupidu-36804-default-rtdb.europe-west1.firebasedatabase.app';
const LP_BASE = RTDB + '/leseplan';
const DEFAULT_CONFIG = { wordsPerMinute: 200, minMinutesPerUnit: 10, timezone: 'Europe/Zurich', aufbereitenWebhookUrl: '' };

const state = { loaded: false, loading: false, error: null, config: null, docs: {}, aufbereitung: {}, selectedId: null };

// ── Shared Core (DOM-frei, identisch zum Kern & n8n) ──
function lpStripTags(html) {
  return String(html == null ? '' : html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
function lpWordCount(html) { const t = lpStripTags(html); return t ? t.split(/\s+/).filter(Boolean).length : 0; }
function lpExtractTitle(html) {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  if (t && lpStripTags(t[1])) return lpStripTags(t[1]);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(String(html || ''));
  if (h1 && lpStripTags(h1[1])) return lpStripTags(h1[1]);
  return '';
}
function lpSplit(html, opts) {
  const maxW = (opts && opts.maxChunkWords) || 600;
  let src = String(html || '');
  const bodyM = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(src);
  if (bodyM) src = bodyM[1];
  src = src.replace(/<head[\s\S]*?<\/head>/gi, '').replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const re = /<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/gi; const heads = []; let m;
  while ((m = re.exec(src)) !== null) heads.push({ start: m.index, text: lpStripTags(m[0]) });
  const sections = [];
  if (!heads.length) { sections.push({ title: '', start: 0, end: src.length }); }
  else {
    if (heads[0].start > 0) sections.push({ title: '', start: 0, end: heads[0].start });
    for (let i = 0; i < heads.length; i++) sections.push({ title: heads[i].text, start: heads[i].start, end: (i + 1 < heads.length) ? heads[i + 1].start : src.length });
  }
  const chunks = [];
  sections.forEach(function (sec) {
    const secHtml = src.slice(sec.start, sec.end);
    if (!secHtml.trim()) return;
    const w = lpWordCount(secHtml);
    if (w <= maxW) { chunks.push({ title: sec.title, html: secHtml, wordCount: w }); return; }
    const bounds = []; const br = /<\/(p|li|ul|ol|blockquote|table|tr|h[1-3]|div|section)>/gi; let bm, last = 0;
    while ((bm = br.exec(secHtml)) !== null) { bounds.push([last, br.lastIndex]); last = br.lastIndex; }
    bounds.push([last, secHtml.length]);
    let curS = bounds[0][0], curW = 0, cont = 0;
    for (let i = 0; i < bounds.length; i++) {
      const bs = bounds[i][0], be = bounds[i][1]; const bw = lpWordCount(secHtml.slice(bs, be));
      if (curW > 0 && curW + bw > maxW) { chunks.push({ title: sec.title + (cont > 0 ? ' (Fortsetzung ' + cont + ')' : ''), html: secHtml.slice(curS, bs), wordCount: curW }); cont++; curS = bs; curW = 0; }
      curW += bw;
      if (i === bounds.length - 1) chunks.push({ title: sec.title + (cont > 0 ? ' (Fortsetzung ' + cont + ')' : ''), html: secHtml.slice(curS, be), wordCount: curW });
    }
  });
  return chunks.filter(function (c) { return c.html.trim(); });
}
function lpDaysBetween(a, b) { return Math.round((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / -86400000); }
function lpAddDays(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function lpBuildPlan(chunks, startYmd, zielYmd, cfg) {
  const wpm = (cfg && cfg.wordsPerMinute) || 200;
  const minMin = (cfg && cfg.minMinutesPerUnit) || 10;
  const totalWords = chunks.reduce(function (s, c) { return s + c.wordCount; }, 0);
  const totalMinutes = totalWords / wpm;
  const diff = lpDaysBetween(startYmd, zielYmd);
  if (diff < 0) return { error: 'past' };
  const daysAvailable = diff + 1;
  let rhythmus = 'taeglich';
  if (daysAvailable > 1 && (totalMinutes / daysAvailable) < minMin) rhythmus = 'zweitaeglich';
  const baseSlots = (rhythmus === 'zweitaeglich') ? Math.ceil(daysAvailable / 2) : daysAvailable;
  const maxSlots = Math.max(1, Math.min(baseSlots, chunks.length));
  const span = daysAvailable - 1;
  const slotDates = [];
  for (let i = 0; i < maxSlots; i++) { const off = (maxSlots === 1) ? 0 : Math.round(i * span / (maxSlots - 1)); slotDates.push(lpAddDays(startYmd, off)); }
  const plan = []; let ci = 0, used = 0;
  for (let s = 0; s < maxSlots && ci < chunks.length; s++) {
    const isLast = (s === maxSlots - 1); const slotIdx = []; let slotWords = 0;
    slotIdx.push(ci); slotWords += chunks[ci].wordCount; used += chunks[ci].wordCount; ci++;
    if (isLast) { while (ci < chunks.length) { slotIdx.push(ci); slotWords += chunks[ci].wordCount; used += chunks[ci].wordCount; ci++; } }
    else {
      const boundaryW = ((s + 1) / maxSlots) * totalWords;
      while (ci < chunks.length && (chunks.length - ci) > (maxSlots - s - 1) && (used + chunks[ci].wordCount / 2) <= boundaryW) {
        slotIdx.push(ci); slotWords += chunks[ci].wordCount; used += chunks[ci].wordCount; ci++;
      }
    }
    plan.push({ index: plan.length, datum: slotDates[s], sektionIds: slotIdx.map(function (i) { return 's' + i; }), words: slotWords, estMinutes: Math.max(1, Math.round(slotWords / wpm)), done: false, doneAt: null });
  }
  return { rhythmus: rhythmus, plan: plan, totalWords: totalWords, geschaetzteLesezeit: Math.max(1, Math.round(totalMinutes)), daysAvailable: daysAvailable };
}
function lpBuildDoc(id, rawTitle, html, startYmd, zielYmd, cfg) {
  const chunks = lpSplit(html, { maxChunkWords: (cfg && cfg.maxChunkWords) || 600 });
  if (!chunks.length) return { error: 'empty' };
  const docTitle = (rawTitle && rawTitle.trim()) || lpExtractTitle(html) || 'Dokument';
  const planRes = lpBuildPlan(chunks, startYmd, zielYmd, cfg);
  if (planRes.error) return { error: planRes.error };
  const wpm = (cfg && cfg.wordsPerMinute) || 200;
  const sektionen = {};
  chunks.forEach(function (c, i) {
    sektionen['s' + i] = { order: i, title: (c.title && c.title.trim()) || (i === 0 ? docTitle : 'Abschnitt ' + (i + 1)), html: c.html, wordCount: c.wordCount, estMinutes: Math.max(1, Math.round(c.wordCount / wpm)) };
  });
  const now = new Date().toISOString();
  return { doc: { id: id, title: docTitle, createdAt: now, updatedAt: now, startDatum: startYmd, zieldatum: zielYmd, rhythmus: planRes.rhythmus, status: 'aktiv', totalWords: planRes.totalWords, geschaetzteLesezeit: planRes.geschaetzteLesezeit, einheitenGesamt: planRes.plan.length, einheitenErledigt: 0, sektionen: sektionen, plan: planRes.plan } };
}

const LESEPLAN_PROMPT = [
  'Bereite den folgenden Text als HTML-Lerndokument fuer die App „Leseplan“ auf.',
  '',
  'FORMATREGELN (exakt einhalten):',
  '1. Gib NUR reines HTML aus — kein Markdown, keine Code-Fences, kein <html>/<head>/<body>.',
  '2. Beginne mit genau EINER Hauptueberschrift <h1>Titel des Dokuments</h1>. Dieser Titel wird als Dokumenttitel uebernommen.',
  '3. Gliedere den Inhalt in inhaltlich sinnvolle Abschnitte. Jeder Abschnitt beginnt mit <h2>Abschnittstitel</h2> (Unter-Abschnitte mit <h3>). Diese Ueberschriften sind die Abschnittsgrenzen, an denen die App den Stoff in Lerneinheiten schneidet — setze also etwa alle 300–800 Woerter eine <h2>- oder <h3>-Ueberschrift.',
  '4. Fliesstext in <p>…</p>. Erlaubte Tags: h1, h2, h3, p, ul, ol, li, strong, em, blockquote, table, thead, tbody, tr, th, td, code. KEINE <img>, <script>, <style>, <iframe> und KEINE inline style-Attribute.',
  '5. Aendere den Inhalt nicht: nichts kuerzen, nichts hinzuerfinden, nichts zusammenfassen — den vorhandenen Text nur sauber in die obige HTML-Struktur bringen.',
  '6. Schweizer Rechtschreibung: echte Umlaute (ä, ö, ü, Ä, Ö, Ü), statt ß immer ss. Keine ASCII-Umschreibungen wie ae/oe/ue.',
  '',
  'Hier ist der Text:',
  '[HIER DEINEN TEXT EINFUEGEN]'
].join('\n');

// ── RTDB REST (offener leseplan/-Pfad, kein Credential) ──
async function lpGet(path) {
  const r = await fetch(LP_BASE + path + '.json?_ts=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function lpWrite(method, path, obj) {
  const r = await fetch(LP_BASE + path + '.json', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json().catch(() => ({}));
}

async function load(force) {
  if (state.loading) return;
  state.loading = true; state.error = null;
  try {
    const [cfg, docs, ab] = await Promise.all([lpGet('/config'), lpGet('/docs'), lpGet('/aufbereitung')]);
    state.config = cfg || Object.assign({}, DEFAULT_CONFIG);
    state.docs = docs || {};
    state.aufbereitung = ab || {};
    if (!state.selectedId || !state.docs[state.selectedId]) { const l = docsList(); state.selectedId = l.length ? l[0]._id : null; }
    // config idempotent seeden, falls leer
    if (!cfg) { try { await lpWrite('PUT', '/config', DEFAULT_CONFIG); state.config = Object.assign({}, DEFAULT_CONFIG); } catch (e) {} }
  } catch (e) {
    state.error = (e && e.message) || String(e);
  }
  state.loading = false; state.loaded = true;
  rerender();
}
function rerender() {
  const route = current().route;
  if (['leseplan', 'smarter', 'bm'].includes(route)) navigate(route, { sub: current().sub || null, params: current().params || {} });
}

function lessonContext() {
  const route = current().route;
  if (route === 'bm') return { route, app: 'bmpruefung', title: 'BM-Vorbereitung' };
  if (route === 'smarter') return { route, app: 'smarter', title: 'Smarter' };
  return { route: 'leseplan', app: 'leseplan', title: 'Leseplan' };
}

function docsList() {
  const d = state.docs || {};
  return Object.keys(d).map(id => Object.assign({ _id: id }, d[id] || {}))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
function currentSlot(doc) {
  const plan = Array.isArray(doc && doc.plan) ? doc.plan : (doc && doc.plan ? Object.values(doc.plan) : []);
  return plan.find(p => p && !p.done) || (plan.length ? plan[plan.length - 1] : null);
}
function planArr(doc) { return Array.isArray(doc && doc.plan) ? doc.plan : (doc && doc.plan ? Object.values(doc.plan) : []); }

// simple Sanitizer: erlaubte Struktur behalten, gefaehrliche Teile entfernen
function sanitize(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/ on[a-z]+="[^"]*"/gi, '')
    .replace(/ on[a-z]+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

// ── Rendering ──
function docRow(d) {
  const total = Number(d.einheitenGesamt) || planArr(d).length;
  const done = Number(d.einheitenErledigt) || planArr(d).filter(p => p.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const rhythm = d.rhythmus === 'zweitaeglich' ? 'alle 2 Tage' : 'täglich';
  return `<button class="card lp-row ${state.selectedId === d._id ? 'active' : ''}" data-action="lp-select" data-id="${d._id}">
    <div class="lp-row-main">
      <div class="lp-row-title">${escHTML(d.title || 'Dokument')}</div>
      <div class="lp-row-meta">
        <span class="pill ${d.status === 'fertig' ? 'accent' : ''}">${escHTML(rhythm)}</span>
        <span class="meta">🎯 ${escHTML(d.zieldatum || '?')}</span>
        <span class="meta">${done}/${total} Einheiten</span>
      </div>
      <div class="lp-bar"><i style="width:${pct}%"></i></div>
    </div>
  </button>`;
}

function readerHtml(doc, slot) {
  const sek = doc.sektionen || {};
  return (Array.isArray(slot.sektionIds) ? slot.sektionIds : []).map(id => sanitize((sek[id] && sek[id].html) || '')).join('\n');
}

function aiBlock(docId, slot) {
  const ab = ((state.aufbereitung || {})[docId] || {})[slot.index];
  if (!ab || (!ab.zusammenfassung && !(ab.kernpunkte && ab.kernpunkte.length))) return '';
  return `<div class="lp-ai"><div class="lp-ai-h">🤖 KI-Aufbereitung</div>
    ${ab.zusammenfassung ? `<div class="lp-ai-sum">${escHTML(ab.zusammenfassung)}</div>` : ''}
    ${Array.isArray(ab.kernpunkte) && ab.kernpunkte.length ? `<ul>${ab.kernpunkte.map(k => `<li>${escHTML(k)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function detailHtml(d) {
  if (!d) return `<div class="detail-empty"><div class="empty-icon">👈</div><div class="empty-sub">Dokument wählen</div></div>`;
  const plan = planArr(d);
  const total = plan.length, done = plan.filter(p => p.done).length;
  const cur = currentSlot(d);
  const context = lessonContext();
  const related = store.getNotesBySource(context.app, d._id);
  const today = todayYmd();
  let h = `<div class="detail">
    <div class="lp-detail-head">
      <div class="detail-title">${escHTML(d.title || 'Dokument')}</div>
      <button class="icon-btn danger" data-action="lp-delete" data-id="${d._id}" aria-label="Löschen">🗑</button>
    </div>
    <div class="lp-stats">
      <div class="stat"><div class="stat-num">${done}/${total}</div><div class="stat-lbl">Einheiten</div></div>
      <div class="stat"><div class="stat-num">${Number(d.geschaetzteLesezeit) || 0}</div><div class="stat-lbl">Min gesamt</div></div>
      <div class="stat"><div class="stat-num">${d.rhythmus === 'zweitaeglich' ? '2-tägig' : 'täglich'}</div><div class="stat-lbl">Rhythmus</div></div>
      <div class="stat"><div class="stat-num" style="font-size:15px">${escHTML(d.zieldatum || '?')}</div><div class="stat-lbl">Zieldatum</div></div>
    </div>
    <button class="btn block" data-action="lp-learning-note" data-id="${d._id}">🧠 Lernnotiz (${related.length})</button>`;
  if (!cur) return h + `<div class="muted-row">Kein Plan vorhanden.</div></div>`;
  const due = cur.datum <= today;
  h += `<div class="lp-unit-head">${d.status === 'fertig' ? '✅ Alle Einheiten gelesen' : `Aktuelle Leseeinheit — ${escHTML(cur.datum)} ${due ? '(fällig)' : '(geplant)'}`} <span class="meta">≈ ${Number(cur.estMinutes) || 0} Min</span></div>`;
  h += aiBlock(d._id, cur);
  h += `<div class="lp-reader">${readerHtml(d, cur)}</div>`;
  h += `<div class="lp-unit-actions">`;
  if (!cur.done) h += `<button class="btn primary block" data-action="lp-done" data-id="${d._id}" data-idx="${cur.index}">✓ Als gelesen markieren</button>`;
  else h += `<button class="btn ghost block" data-action="lp-undone" data-id="${d._id}" data-idx="${cur.index}">↺ Wieder offen</button>`;
  h += `</div>`;
  // Plan
  h += `<div class="section-title">Leseplan</div><div class="lp-plan">`;
  h += plan.map(p => `<div class="lp-plan-row ${p.done ? 'done' : ''} ${cur && p.index === cur.index ? 'current' : ''}">
    <span class="lp-plan-date">${escHTML(p.datum)}</span>
    <span style="flex:1">Einheit ${p.index + 1} · ${(Array.isArray(p.sektionIds) ? p.sektionIds.length : 0)} Abschnitt(e)</span>
    <span class="meta">≈ ${Number(p.estMinutes) || 0} Min</span>
    <span>${p.done ? '✓' : (p.datum <= today ? '○' : '·')}</span>
  </div>`).join('');
  h += `</div></div>`;
  return h;
}

// ── Sheets ──
function openReaderSheet(d) {
  const cur = currentSlot(d);
  if (!cur) { toast('Kein Plan', 'warn'); return; }
  openSheet({ title: d.title || 'Leseeinheit', size: 'full', body: aiBlock(d._id, cur) + `<div class="lp-reader">${readerHtml(d, cur)}</div>
    <div class="lp-unit-actions" style="margin-top:14px">${cur.done
      ? `<button class="btn ghost block" data-action="lp-undone" data-id="${d._id}" data-idx="${cur.index}">↺ Wieder offen</button>`
      : `<button class="btn primary block" data-action="lp-done" data-id="${d._id}" data-idx="${cur.index}">✓ Als gelesen markieren</button>`}
      <button class="btn block" data-action="lp-learning-note" data-id="${d._id}">🧠 Lernnotiz</button></div>` });
}

function openNewSheet() {
  const today = todayYmd();
  const ziel = lpAddDays(today, 14);
  openSheet({
    title: 'Neues Dokument', size: 'full',
    body: `<form class="form" onsubmit="return false">
      <label class="f"><span class="f-label">Titel (optional — sonst aus &lt;h1&gt;/&lt;title&gt;)</span><input name="title" class="input" placeholder="z. B. Wirtschaftsgeschichte Kap. 3"></label>
      <label class="f"><span class="f-label">Zieldatum</span><input name="zieldatum" type="date" class="input" min="${today}" value="${ziel}" required></label>
      <label class="f"><span class="f-label">HTML-Inhalt</span><textarea name="html" class="input" rows="10" placeholder="<h1>Titel</h1>&#10;<h2>Abschnitt 1</h2>&#10;<p>…</p>" required></textarea></label>
      <div class="lp-hint">Der Inhalt wird automatisch in Lerneinheiten geschnitten und gleichmässig bis zum Zieldatum verteilt. Ist die Tagesportion unter ${(state.config && state.config.minMinutesPerUnit) || 10} Min, wird auf 2-Tages-Rhythmus umgestellt. Format siehe „Aufbereitungs-Prompt“.</div>
      <button class="btn primary block" type="button" data-action="lp-create">📖 Leseplan erstellen</button>
      <button class="btn ghost block" type="button" data-action="lp-prompt">📋 Aufbereitungs-Prompt anzeigen</button>
    </form>`
  });
}

function openPromptSheet() {
  openSheet({
    title: 'Aufbereitungs-Prompt', size: 'full',
    body: `<div class="muted-row">Gib diesen Prompt Claude oder ChatGPT zusammen mit einer beliebigen Datei/Text — das Ergebnis passt exakt zum erwarteten Eingabeformat.</div>
      <pre class="lp-pre" id="lpPrompt">${escHTML(LESEPLAN_PROMPT)}</pre>
      <button class="btn primary block" data-action="lp-copy-prompt">📋 Prompt kopieren</button>`
  });
}

// ── Actions ──
async function createDoc(form) {
  const fd = new FormData(form); const v = {};
  fd.forEach((val, k) => { v[k] = typeof val === 'string' ? val : val; });
  const html = String(v.html || ''); const ziel = String(v.zieldatum || '').trim(); const today = todayYmd();
  if (!html.trim()) { toast('Bitte HTML-Inhalt einfügen', 'warn'); return; }
  if (html.length > 2000000) { toast('Dokument zu gross (max. 2 MB)', 'error'); return; }
  if (!ziel) { toast('Bitte Zieldatum wählen', 'warn'); return; }
  if (ziel < today) { toast('Zieldatum liegt in der Vergangenheit', 'error'); return; }
  const cfg = state.config || DEFAULT_CONFIG;
  const id = 'doc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const res = lpBuildDoc(id, String(v.title || ''), html, today, ziel, cfg);
  if (res.error === 'empty') { toast('Kein lesbarer Text im HTML', 'error'); return; }
  if (res.error === 'past') { toast('Zieldatum zu knapp / in der Vergangenheit', 'error'); return; }
  if (!res.doc) { toast('Dokument konnte nicht erstellt werden', 'error'); return; }
  try {
    await lpWrite('PUT', '/docs/' + id, res.doc);
    state.docs[id] = res.doc; state.selectedId = id;
    closeSheet();
    toast(`${res.doc.einheitenGesamt} Einheiten · ${res.doc.rhythmus === 'zweitaeglich' ? '2-Tages-Rhythmus' : 'täglich'}`, 'ok');
    rerender();
  } catch (e) { toast('Speichern fehlgeschlagen: ' + ((e && e.message) || e), 'error'); }
}

async function setDone(id, idx, done) {
  const doc = state.docs[id]; if (!doc) return;
  const plan = planArr(doc); const slot = plan[idx]; if (!slot) return;
  slot.done = !!done; slot.doneAt = done ? new Date().toISOString() : null;
  const doneCount = plan.filter(p => p.done).length;
  doc.plan = plan; doc.einheitenErledigt = doneCount;
  doc.status = (doneCount >= plan.length) ? 'fertig' : 'aktiv';
  doc.updatedAt = new Date().toISOString();
  try {
    await lpWrite('PATCH', '/docs/' + id, { plan: plan, einheitenErledigt: doneCount, status: doc.status, updatedAt: doc.updatedAt });
    closeSheet();
    rerender();
  } catch (e) { toast('Fortschritt nicht gespeichert', 'error'); }
}

async function deleteDoc(id) {
  const doc = state.docs[id];
  const ok = await confirmPreview({ title: 'Dokument löschen?', danger: true, confirmLabel: 'Löschen', previewHtml: `<div class="detail-title">${escHTML((doc && doc.title) || id)}</div><div class="muted-row">Der Fortschritt geht verloren.</div>` });
  if (!ok) return;
  try {
    await lpWrite('DELETE', '/docs/' + id, {});
    try { await lpWrite('DELETE', '/aufbereitung/' + id, {}); } catch (e) {}
    delete state.docs[id]; if (state.aufbereitung) delete state.aufbereitung[id];
    if (state.selectedId === id) { const l = docsList(); state.selectedId = l.length ? l[0]._id : null; }
    toast('Gelöscht', 'ok'); rerender();
  } catch (e) { toast('Löschen fehlgeschlagen', 'error'); }
}

function copyPrompt() {
  const done = () => toast('Prompt kopiert', 'ok');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(LESEPLAN_PROMPT).then(done, fallback);
    else fallback();
  } catch (e) { fallback(); }
  function fallback() {
    try { const ta = document.createElement('textarea'); ta.value = LESEPLAN_PROMPT; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done(); }
    catch (e2) { toast('Kopieren nicht möglich', 'warn'); }
  }
}

registerActions({
  'lp-select': (d) => {
    state.selectedId = d.id;
    if (isTablet()) navigate(current().route, { params: { id: d.id } });
    else { const doc = state.docs[d.id]; if (doc) openReaderSheet(Object.assign({ _id: d.id }, doc)); }
  },
  'lp-learning-note': (d) => {
    const doc = state.docs[d.id]; if (!doc) return;
    const context = lessonContext();
    const label = doc.title || context.title;
    openNoteComposer({
      heading: `Lernnotiz · ${context.title}`, noteClass: 'learning', tags: [label], lockedTags: [label],
      source: { app: context.app, entityType: 'document', entityId: d.id, label, route: `#/${context.route}?id=${encodeURIComponent(d.id)}` },
      placeholder: 'Merksatz, Erklärung, Fehler, Frage oder Zusammenfassung…',
    });
  },
  'lp-new': () => openNewSheet(),
  'lp-prompt': () => openPromptSheet(),
  'lp-create': (d, el, e) => { if (e && e.preventDefault) e.preventDefault(); createDoc(el.closest('form')); },
  'lp-done': (d) => setDone(d.id, Number(d.idx), true),
  'lp-undone': (d) => setDone(d.id, Number(d.idx), false),
  'lp-delete': (d) => deleteDoc(d.id),
  'lp-copy-prompt': () => copyPrompt(),
  'lp-refresh': () => { state.loaded = false; load(true); },
});

export default {
  title: 'Leseplan', icon: '📖',
  render(ctx) {
    if (!state.loaded && !state.loading) { load(false); }
    if (ctx.params && ctx.params.id && state.docs[ctx.params.id]) state.selectedId = ctx.params.id;

    const context = lessonContext();
    const headRight = `<button class="chip" data-action="lp-prompt">📋 Prompt</button><button class="chip accent" data-action="lp-new">＋ Neu</button>`;

    if (state.loading && !state.loaded) {
      return `<div class="pad">${pageHeader(context.title, 'Dokumente aufs Zieldatum verteilt', headRight)}<div class="skel-list">${'<div class="skel-row"></div>'.repeat(4)}</div></div>`;
    }
    if (state.error && !docsList().length) {
      return `<div class="pad">${pageHeader(context.title, 'Dokumente aufs Zieldatum verteilt', headRight)}
        <div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Cloud nicht erreichbar</div><div class="empty-sub">${escHTML(state.error)}</div>
        <button class="btn block" style="max-width:220px;margin:14px auto 0" data-action="lp-refresh">↻ Erneut versuchen</button></div></div>`;
    }

    const list = docsList();
    if (!list.length) {
      return `<div class="pad">${pageHeader(context.title, 'Dokumente aufs Zieldatum verteilt', headRight)}
        <div class="empty"><div class="empty-icon">📖</div><div class="empty-title">Noch keine Dokumente</div>
        <div class="empty-sub">Lege ein HTML-Dokument mit Zieldatum an — es wird automatisch in Lerneinheiten geschnitten und gleichmässig verteilt.</div>
        <button class="btn primary block" style="max-width:260px;margin:16px auto 0" data-action="lp-new">＋ Neues Dokument</button></div></div>`;
    }

    const listHtml = list.map(docRow).join('');
    if (isTablet()) {
      const sel = state.selectedId && state.docs[state.selectedId] ? Object.assign({ _id: state.selectedId }, state.docs[state.selectedId]) : null;
      return `<div class="pad">${pageHeader(context.title, 'Dokumente aufs Zieldatum verteilt', headRight)}
        <div class="split">
          <div class="split-list lp-doclist">${listHtml}</div>
          <div class="split-detail">${detailHtml(sel)}</div>
        </div></div>`;
    }
    return `<div class="pad">${pageHeader(context.title, 'Dokumente aufs Zieldatum verteilt', headRight)}
      <div class="lp-doclist">${listHtml}</div></div>`;
  },
  mount(root, ctx) {
    // Reader-iframe nicht noetig — Inhalt wird themed inline gerendert (sanitisiert).
  },
};
