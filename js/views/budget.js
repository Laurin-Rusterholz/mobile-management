// ============================================================================
//  Budget — Ausgaben in Sekunden erfassen, Übersicht auf einen Blick
//  ---------------------------------------------------------------------------
//  BEFUND: Eine Ausgabe zu erfassen ging nur über das allgemeine „＋ Neu"-Blatt
//  mit einem Formular aus fünf Feldern und einer Bildschirmtastatur. Wer an der
//  Kasse steht, tippt das nicht. Deshalb gibt es hier einen eigenen Weg: ein
//  grosses Betragsfeld mit eigenem Ziffernblock, Kategorien als Kacheln, Datum
//  vorbelegt — Sichern ist ein Tipp.
//
//  Geschrieben wird über dieselbe Operation wie bisher (add-transaction) und in
//  demselben Format wie Desktop und Tablet: negativer Betrag = Ausgabe.
// ============================================================================
import { escHTML, fmtMoney, formatDate, todayYmd, toast, openSheet, closeSheet, confirmPreview, haptic } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader, segmented } from './common.js';

const monthOf = (t) => String(t.date || t.createdAt || '').slice(0, 7);
const zahl = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Der angezeigte Monat. Ohne Blättern zeigte die Übersicht nur „diesen Monat",
// und der letzte war unerreichbar.
let monat = null;
function derMonat() { return monat || todayYmd().slice(0, 7); }
function monatVerschieben(n) {
  const [j, m] = derMonat().split('-').map(Number);
  const d = new Date(j, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monatText(ym) {
  const [j, m] = ym.split('-').map(Number);
  return new Date(j, m - 1, 1).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
}

// ── Erfassung ──────────────────────────────────────────────────────────────
const KATEGORIEN = ['Essen', 'Transport', 'Wohnen', 'Einkauf', 'Gesundheit',
  'Freizeit', 'Bildung', 'Abo', 'Sonstiges'];

const E = { betrag: '', kategorie: 'Essen', typ: 'expense', notiz: '', datum: null, konto: '' };
function eZuruecksetzen() {
  E.betrag = ''; E.kategorie = 'Essen'; E.typ = 'expense'; E.notiz = ''; E.datum = null; E.konto = '';
}
function betragZahl() { return Math.abs(zahl(E.betrag.replace(',', '.'))); }
function betragAnzeige() { return E.betrag === '' ? '0.00' : E.betrag; }

function tasteDruecken(taste) {
  if (taste === 'del') { E.betrag = E.betrag.slice(0, -1); return; }
  if (taste === '.') { if (E.betrag.includes('.')) return; E.betrag = (E.betrag || '0') + '.'; return; }
  // Nach dem Punkt höchstens zwei Stellen — sonst entsteht ein Betrag, den
  // niemand gemeint hat, und das Feld läuft aus dem Bild.
  const [, nach] = E.betrag.split('.');
  if (nach != null && nach.length >= 2) return;
  if (E.betrag.replace('.', '').length >= 9) return;
  E.betrag = (E.betrag === '0' ? '' : E.betrag) + taste;
}

function erfassungHtml() {
  const konten = store.getAccounts();
  const tasten = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  return `<div class="bu-quick">
    <div class="bu-typ">
      <button class="bu-typ-btn ${E.typ === 'expense' ? 'on ausgabe' : ''}" data-action="bu-typ" data-typ="expense">− Ausgabe</button>
      <button class="bu-typ-btn ${E.typ === 'income' ? 'on einnahme' : ''}" data-action="bu-typ" data-typ="income">＋ Einnahme</button>
    </div>

    <div class="bu-betrag ${E.typ === 'income' ? 'einnahme' : 'ausgabe'}">
      <span class="bu-waehrung">CHF</span>
      <span class="bu-betrag-zahl">${escHTML(betragAnzeige())}</span>
    </div>

    <div class="bu-kats">${KATEGORIEN.map((k) => `
      <button class="bu-kat ${E.kategorie === k ? 'on' : ''}" data-action="bu-kat" data-kat="${escHTML(k)}">${escHTML(k)}</button>`).join('')}
    </div>

    <input class="input bu-notiz" id="buNotiz" placeholder="Notiz (optional)" value="${escHTML(E.notiz)}" autocomplete="off">

    <div class="bu-zeile">
      <input class="input" id="buDatum" type="date" value="${escHTML(E.datum || todayYmd())}">
      ${konten.length ? `<select class="input" id="buKonto">
        <option value="">Ohne Konto</option>
        ${konten.map((k) => `<option value="${escHTML(k.id)}" ${E.konto === k.id ? 'selected' : ''}>${escHTML(k.name || k.title || 'Konto')}</option>`).join('')}
      </select>` : ''}
    </div>

    <div class="bu-pad">${tasten.map((t) => `
      <button class="bu-taste ${t === 'del' ? 'del' : ''}" data-action="bu-taste" data-taste="${t}">${t === 'del' ? '⌫' : t}</button>`).join('')}
    </div>

    <button class="btn primary block bu-sichern" data-action="bu-sichern">Sichern</button>
  </div>`;
}

function erfassungOeffnen() {
  openSheet({ title: 'Ausgabe erfassen', size: 'full', body: erfassungHtml() });
}
// Nur den Inhalt neu bauen. Ein erneutes openSheet würde die Eingaben in Notiz,
// Datum und Konto verwerfen — genau die Felder, die man zuletzt angefasst hat.
function erfassungAktualisieren() {
  const wurzel = document.querySelector('.bu-quick');
  if (!wurzel) { erfassungOeffnen(); return; }
  eingabenLesen();
  wurzel.outerHTML = erfassungHtml();
}
function eingabenLesen() {
  const n = document.getElementById('buNotiz');
  const d = document.getElementById('buDatum');
  const k = document.getElementById('buKonto');
  if (n) E.notiz = n.value;
  if (d) E.datum = d.value;
  if (k) E.konto = k.value;
}

// ── Übersicht ──────────────────────────────────────────────────────────────
function kategorieSummen(txns) {
  const m = {};
  txns.filter((t) => zahl(t.amount) < 0).forEach((t) => {
    const k = t.category || 'Sonstiges';
    m[k] = (m[k] || 0) + Math.abs(zahl(t.amount));
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function uebersicht() {
  const ym = derMonat();
  const alle = store.getTransactions();
  const mTx = alle.filter((t) => monthOf(t) === ym);
  const einnahmen = mTx.filter((t) => zahl(t.amount) > 0).reduce((s, t) => s + zahl(t.amount), 0);
  const ausgaben = mTx.filter((t) => zahl(t.amount) < 0).reduce((s, t) => s + Math.abs(zahl(t.amount)), 0);
  const kats = kategorieSummen(mTx);
  const max = kats.length ? kats[0][1] : 1;
  const konten = store.getAccounts();
  const bestand = konten.reduce((s, k) => s + zahl(k.balance), 0);
  const tage = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
  const istAktuell = ym === todayYmd().slice(0, 7);
  const bisher = istAktuell ? Number(todayYmd().slice(8, 10)) : tage;

  return `
    <div class="bu-nav">
      <button class="chip" data-action="bu-monat" data-n="-1">‹</button>
      <span class="bu-monat">${escHTML(monatText(ym))}</span>
      <button class="chip" data-action="bu-monat" data-n="1">›</button>
      ${istAktuell ? '' : '<button class="chip" data-action="bu-monat" data-n="0">Heute</button>'}
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat-num ok">${fmtMoney(einnahmen)}</div><div class="stat-lbl">Einnahmen</div></div>
      <div class="stat"><div class="stat-num danger">${fmtMoney(ausgaben)}</div><div class="stat-lbl">Ausgaben</div></div>
      <div class="stat"><div class="stat-num">${fmtMoney(einnahmen - ausgaben)}</div><div class="stat-lbl">Saldo</div></div>
    </div>

    <div class="bu-schnitt">⌀ ${fmtMoney(bisher ? ausgaben / bisher : 0)} pro Tag${istAktuell ? ` · ${mTx.length} Buchungen` : ''}</div>

    ${konten.length ? `<div class="section-title">Konten · ${fmtMoney(bestand)}</div>
      ${konten.map((k) => `<div class="card row-card">
        <div class="row-main"><div class="row-title">${escHTML(k.name || k.title || 'Konto')}</div>
          <div class="row-sub">${escHTML(k.type || '')}</div></div>
        <span class="amount ${zahl(k.balance) < 0 ? 'danger' : ''}">${fmtMoney(zahl(k.balance))}</span>
      </div>`).join('')}` : ''}

    <div class="section-title">Kategorien</div>
    ${kats.length ? kats.map(([k, v]) => `<div class="bar-row">
      <span class="bar-label">${escHTML(k)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round(v / max * 100)}%"></span></span>
      <span class="bar-val">${fmtMoney(v)}</span></div>`).join('')
    : '<div class="muted-row">Keine Ausgaben in diesem Monat.</div>'}`;
}

function buchungen() {
  const ym = derMonat();
  const txns = store.getTransactions()
    .filter((t) => monthOf(t) === ym)
    .slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!txns.length) {
    return `<div class="empty"><div class="empty-icon">💰</div>
      <div class="empty-title">Keine Buchungen</div>
      <div class="empty-sub">Tippe unten auf „Ausgabe erfassen".</div></div>`;
  }
  return txns.map((t) => {
    const neg = zahl(t.amount) < 0;
    return `<div class="card row-card">
      <div class="row-main" data-action="bu-loeschen" data-id="${escHTML(String(t.id))}" role="button" tabindex="0"
           aria-label="Buchung öffnen: ${escHTML(t.description || t.category || 'Buchung')}">
        <div class="row-title">${escHTML(t.description || t.category || 'Buchung')}</div>
        <div class="row-sub">${escHTML(t.category || '')} · ${escHTML(formatDate(t.date))}</div>
      </div>
      <span class="amount ${neg ? 'danger' : 'ok'}">${neg ? '' : '+'}${fmtMoney(t.amount)}</span>
    </div>`;
  }).join('');
}

// ── Aktionen ───────────────────────────────────────────────────────────────
registerActions({
  'budget-seg': (d) => navigate('budget', { sub: d.seg }),
  'bu-monat': (d) => { monat = Number(d.n) === 0 ? null : monatVerschieben(Number(d.n)); navigate('budget'); },
  'bu-neu': () => { eZuruecksetzen(); erfassungOeffnen(); },
  'bu-typ': (d) => { E.typ = d.typ; erfassungAktualisieren(); },
  'bu-kat': (d) => { E.kategorie = d.kat; erfassungAktualisieren(); },
  'bu-taste': (d) => { haptic(8); tasteDruecken(d.taste); erfassungAktualisieren(); },
  'bu-sichern': async () => {
    eingabenLesen();
    const betrag = betragZahl();
    if (!betrag) { toast('Bitte einen Betrag eingeben', 'error'); return; }
    const jetzt = new Date().toISOString();
    await store.performOp({
      type: 'add-transaction',
      payload: {
        id: 'txn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        // Vorzeichen im Betrag — dasselbe Format wie Desktop und Tablet.
        amount: E.typ === 'income' ? betrag : -betrag,
        type: E.typ,
        category: E.kategorie,
        description: E.notiz || '',
        date: E.datum || todayYmd(),
        accountId: E.konto || null,
        tags: [], source: 'mobile', createdAt: jetzt, updatedAt: jetzt,
      },
    });
    closeSheet();
    toast(fmtMoney(E.typ === 'income' ? betrag : -betrag) + ' erfasst', 'ok');
    eZuruecksetzen();
    navigate('budget');
  },
  'bu-loeschen': async (d) => {
    const t = store.getTransactions().find((x) => x && x.id === d.id);
    if (!t) return;
    const ja = await confirmPreview({
      title: 'Buchung löschen?',
      previewHtml: `<div class="detail-title">${escHTML(t.description || t.category || 'Buchung')}</div>
        <div class="muted-row">${escHTML(t.category || '')} · ${escHTML(formatDate(t.date))} · ${fmtMoney(t.amount)}</div>`,
      confirmLabel: 'Löschen',
    });
    if (!ja) return;
    await store.performOp({ type: 'delete-transaction', payload: { id: d.id } });
    toast('Buchung gelöscht', 'ok');
    navigate('budget');
  },
  'budget-export': () => {
    const txns = store.getTransactions();
    const rows = [['date', 'amount', 'type', 'category', 'description'],
      ...txns.map((t) => [t.date || '', t.amount, t.type || '', t.category || '',
        String(t.description || '').replace(/[\n,;]/g, ' ')])];
    const blob = new Blob([rows.map((r) => r.join(';')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'quantus-budget.csv'; a.click();
    toast('CSV exportiert', 'ok');
  },
  'budget-import': () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.csv,text/csv';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      const lines = (await file.text()).split(/\r?\n/).filter(Boolean);
      lines.shift();
      let n = 0;
      for (const line of lines) {
        const [date, amount, typ, kategorie, beschreibung] = line.split(';');
        if (amount == null || Number.isNaN(Number(amount))) continue;
        const jetzt = new Date().toISOString();
        await store.performOp({ type: 'add-transaction', payload: {
          id: 'txn_' + Date.now().toString(36) + '_' + n,
          amount: Number(amount), type: typ || (Number(amount) < 0 ? 'expense' : 'income'),
          category: kategorie || 'Import', description: beschreibung || '',
          date: date || todayYmd(), source: 'mobile', createdAt: jetzt, updatedAt: jetzt } });
        n++;
      }
      toast(n + ' Buchungen importiert', 'ok');
      navigate('budget');
    };
    inp.click();
  },
});

export default {
  title: 'Budget', icon: '💰',
  render(ctx) {
    const view = ctx.sub || 'overview';
    const seg = segmented([{ key: 'overview', label: 'Übersicht' }, { key: 'txns', label: 'Buchungen' }], view, 'budget-seg');
    return `<div class="pad">
      ${pageHeader('Budget', monatText(derMonat()),
        `<button class="chip" data-action="budget-export">⇩ CSV</button><button class="chip" data-action="budget-import">⇧ CSV</button>`)}
      ${seg}
      ${view === 'txns' ? buchungen() : uebersicht()}
      <button class="btn primary block bu-neu-btn" data-action="bu-neu">＋ Ausgabe erfassen</button>
    </div>`;
  },
};
