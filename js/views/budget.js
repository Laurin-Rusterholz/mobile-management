// ============================================================================
//  Budget — Konten, Ein-/Ausgaben, Kategorien, Monatsübersicht, CSV Im-/Export
// ============================================================================
import { escHTML, fmtMoney, formatDate, todayYmd, toast, openSheet, closeSheet } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { navigate } from '../router.js';
import { pageHeader, segmented } from './common.js';

const monthOf = t => (t.date || t.createdAt || '').slice(0, 7);
function curMonth() { return todayYmd().slice(0, 7); }

function catTotals(txns) {
  const m = {};
  txns.filter(t => Number(t.amount) < 0).forEach(t => { const k = t.category || 'Sonstiges'; m[k] = (m[k] || 0) + Math.abs(Number(t.amount)); });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function overview() {
  const month = curMonth();
  const txns = store.getTransactions();
  const mTx = txns.filter(t => monthOf(t) === month);
  const income = mTx.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const expense = mTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const cats = catTotals(mTx);
  const max = cats.length ? cats[0][1] : 1;
  return `
    <div class="stat-row">
      <div class="stat"><div class="stat-num ok">${fmtMoney(income)}</div><div class="stat-lbl">Einnahmen</div></div>
      <div class="stat"><div class="stat-num danger">${fmtMoney(expense)}</div><div class="stat-lbl">Ausgaben</div></div>
      <div class="stat"><div class="stat-num">${fmtMoney(income - expense)}</div><div class="stat-lbl">Saldo</div></div>
    </div>
    <div class="section-title">Kategorien · ${escHTML(month)}</div>
    ${cats.length ? cats.map(([k, v]) => `<div class="bar-row">
      <span class="bar-label">${escHTML(k)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round(v / max * 100)}%"></span></span>
      <span class="bar-val">${fmtMoney(v)}</span></div>`).join('')
    : '<div class="muted-row">Noch keine Buchungen diesen Monat.</div>'}`;
}

function txnList() {
  const txns = store.getTransactions().slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 100);
  if (!txns.length) return `<div class="empty"><div class="empty-icon">💰</div><div class="empty-title">Keine Buchungen</div><div class="empty-sub">Tippe ＋ und wähle „Ausgabe".</div></div>`;
  return txns.map(t => {
    const neg = Number(t.amount) < 0;
    return `<div class="card row-card">
      <div class="row-main"><div class="row-title">${escHTML(t.description || t.category || 'Buchung')}</div>
        <div class="row-sub">${escHTML(t.category || '')} · ${formatDate(t.date)}</div></div>
      <span class="amount ${neg ? 'danger' : 'ok'}">${neg ? '' : '+'}${fmtMoney(t.amount)}</span>
    </div>`;
  }).join('');
}

registerActions({
  'budget-seg': (d) => navigate('budget', { sub: d.seg }),
  'budget-export': () => {
    const txns = store.getTransactions();
    const rows = [['date', 'amount', 'type', 'category', 'description'], ...txns.map(t => [t.date || '', t.amount, t.type || '', t.category || '', (t.description || '').replace(/[\n,;]/g, ' ')])];
    const csv = rows.map(r => r.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'quantus-budget.csv'; a.click();
    toast('CSV exportiert', 'ok');
  },
  'budget-import': () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,text/csv';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(Boolean); const head = lines.shift();
      let n = 0;
      for (const line of lines) {
        const [date, amount, type, category, description] = line.split(';');
        if (amount == null || isNaN(Number(amount))) continue;
        await store.performOp({ type: 'add-transaction', payload: { id: 'txn_' + Date.now().toString(36) + n, amount: Number(amount), type: type || (Number(amount) < 0 ? 'expense' : 'income'), category: category || 'Import', description: description || '', date: date || todayYmd(), source: 'mobile', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
        n++;
      }
      toast(n + ' Buchungen importiert', 'ok'); navigate('budget');
    };
    inp.click();
  },
});

export default {
  title: 'Budget', icon: '💰',
  render(ctx) {
    const view = ctx.sub || 'overview';
    const seg = segmented([{ key: 'overview', label: 'Übersicht' }, { key: 'txns', label: 'Buchungen' }], view, 'budget-seg');
    const body = view === 'txns' ? txnList() : overview();
    return `<div class="pad">
      ${pageHeader('Budget', 'Monatsübersicht', `<button class="chip" data-action="budget-export">⇩ CSV</button><button class="chip" data-action="budget-import">⇧ CSV</button>`)}
      ${seg}
      ${body}
      <button class="btn primary block" data-action="open-new" style="margin-top:14px">＋ Ausgabe erfassen</button>
    </div>`;
  },
};
