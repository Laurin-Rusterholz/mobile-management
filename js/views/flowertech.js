// ============================================================================
//  FlowerTech — mobiler Arbeitsbereich
//  ---------------------------------------------------------------------------
//  Dieselben Daten wie in Quantus (data.flowertech + Projekte mit
//  projectType "flowertech"): Projekte mit Aufgaben, Offerten, Rechnungen
//  inklusive Positionen, Status und Total, Finanzen und Anfragen.
//  Der QR-Einzahlungsschein wird in Quantus hochgeladen und hier nur angezeigt.
// ============================================================================
import { escHTML, newId, nowISO, todayYmd, fmtMoney, formatDate, openSheet, closeSheet, toast, confirmPreview, emptyState } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';
import { pageHeader, segmented } from './common.js';

const ui = { tab: 'dashboard', projectId: null, docId: null, docKind: 'offer' };

const OFFER_STATUS = { draft: 'Entwurf', sent: 'Versendet', accepted: 'Angenommen', declined: 'Abgelehnt', expired: 'Abgelaufen' };
const INVOICE_STATUS = { draft: 'Entwurf', sent: 'Versendet', paid: 'Bezahlt', overdue: 'Überfällig', cancelled: 'Storniert' };
const STAGES = { lead: 'Lead', discovery: 'Abklärung', proposal: 'Offerte', build: 'Umsetzung', won: 'Gewonnen', lost: 'Verloren' };

const num = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);

function totals(doc) {
  const items = Array.isArray(doc && doc.items) ? doc.items : [];
  const subtotal = items.reduce((sum, i) => sum + num(i.qty) * num(i.price), 0);
  const discount = subtotal * (num(doc && doc.discountPercent) / 100);
  const net = subtotal - discount;
  const vat = net * (num(doc && doc.vatRate) / 100);
  return { subtotal, discount, net, vat, rounded: Math.round((net + vat) * 20) / 20 };
}

function ft() { return store.getFlowerTech(); }
function projects() { return store.getFlowerTechProjects(); }
function docs(kind) { return kind === 'invoice' ? ft().invoices : ft().offers; }
function docById(kind, id) { return docs(kind).find(d => d.id === id) || null; }

function tasksOf(projectId) {
  return store.getTasks().filter(t => t.projectId === projectId);
}

function nextNumber(kind) {
  const year = new Date().getFullYear();
  const used = docs(kind).map(d => {
    const m = /-(\d{4})-(\d+)$/.exec(String(d.number || ''));
    return m && Number(m[1]) === year ? Number(m[2]) : 0;
  });
  const highest = used.length ? Math.max(...used) : 0;
  const counter = num(ft().counters[kind + '_' + year]);
  const next = Math.max(highest, counter) + 1;
  return {
    number: (kind === 'invoice' ? 'RE-' : 'OF-') + year + '-' + String(next).padStart(4, '0'),
    counterKey: kind + '_' + year,
    counterValue: next,
  };
}

function addDays(ymd, days) {
  const d = new Date((ymd || todayYmd()) + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Listenbausteine ─────────────────────────────────────────────────────────
function docRow(kind, doc) {
  const labels = kind === 'invoice' ? INVOICE_STATUS : OFFER_STATUS;
  const overdue = kind === 'invoice' && doc.status === 'sent' && doc.dueDate && doc.dueDate < todayYmd();
  const client = [(doc.client || {}).company, (doc.client || {}).name].filter(Boolean).join(' · ') || 'Ohne Kunde';
  return `<div class="card row-card" data-action="ft-open-doc" data-kind="${kind}" data-id="${doc.id}">
    <div class="row-main">
      <div class="row-title">${escHTML(doc.number || '—')} · ${escHTML(doc.title || 'Ohne Titel')}</div>
      <div class="row-sub">${escHTML(client)} · ${formatDate(doc.issueDate)}</div>
      <div class="row-meta">
        <span class="chip mini ${overdue ? 'danger' : ''}">${escHTML(overdue ? 'Überfällig' : (labels[doc.status] || doc.status || ''))}</span>
        <span class="chip mini">${fmtMoney(totals(doc).rounded)}</span>
      </div>
    </div>
  </div>`;
}

function projectRow(p) {
  const list = tasksOf(p.id);
  const open = list.filter(t => t.status !== 'done').length;
  const invoiced = docs('invoice').filter(d => d.projectId === p.id).reduce((s, d) => s + totals(d).rounded, 0);
  return `<div class="card row-card" data-action="ft-open-project" data-id="${p.id}">
    <div class="row-main">
      <div class="row-title">${escHTML(p.title || 'Projekt')}</div>
      <div class="row-sub">${escHTML(STAGES[p.pipelineStage || 'lead'] || 'Lead')} · ${open}/${list.length} offen</div>
      <div class="row-meta"><span class="chip mini">${fmtMoney(invoiced)} fakturiert</span></div>
    </div>
    <button class="chip">›</button>
  </div>`;
}

// ── Dokument-Editor (Bottom-Sheet) ──────────────────────────────────────────
function itemRowsHtml(doc) {
  return (doc.items || []).map((item, idx) => `
    <div class="ftm-item" data-idx="${idx}">
      <input class="input" data-fti="description" value="${escHTML(item.description || '')}" placeholder="Leistung">
      <div class="ftm-item-row">
        <input class="input" data-fti="qty" type="number" step="0.25" value="${escHTML(String(num(item.qty)))}" placeholder="Menge">
        <input class="input" data-fti="unit" value="${escHTML(item.unit || '')}" placeholder="Einheit">
        <input class="input" data-fti="price" type="number" step="0.05" value="${escHTML(String(num(item.price)))}" placeholder="Ansatz">
        <button class="chip danger" type="button" data-action="ft-item-remove" data-idx="${idx}">×</button>
      </div>
    </div>`).join('');
}

function docFormHtml(kind, doc) {
  const isInvoice = kind === 'invoice';
  const labels = isInvoice ? INVOICE_STATUS : OFFER_STATUS;
  const t = totals(doc);
  const client = doc.client || {};
  return `<form class="form" id="ftDocForm">
    <div class="muted-row">${escHTML(doc.number || '')} · ${isInvoice ? 'Rechnung' : 'Offerte'}</div>
    <label class="f"><span class="f-label">Titel</span><input id="ftTitle" class="input" value="${escHTML(doc.title || '')}"></label>
    <div class="f-row">
      <label class="f"><span class="f-label">Firma</span><input id="ftCompany" class="input" value="${escHTML(client.company || '')}"></label>
      <label class="f"><span class="f-label">Name</span><input id="ftName" class="input" value="${escHTML(client.name || '')}"></label>
    </div>
    <label class="f"><span class="f-label">E-Mail</span><input id="ftEmail" class="input" type="email" value="${escHTML(client.email || '')}"></label>
    <div class="f-row">
      <label class="f"><span class="f-label">Projekt</span>
        <select id="ftProject" class="input"><option value="">Ohne Projekt</option>
          ${projects().map(p => `<option value="${p.id}" ${doc.projectId === p.id ? 'selected' : ''}>${escHTML(p.title || 'Projekt')}</option>`).join('')}
        </select></label>
      <label class="f"><span class="f-label">Status</span>
        <select id="ftStatus" class="input">
          ${Object.entries(labels).map(([k, l]) => `<option value="${k}" ${doc.status === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
    </div>
    <div class="f-row">
      <label class="f"><span class="f-label">Datum</span><input id="ftIssue" class="input" type="date" value="${escHTML(doc.issueDate || '')}"></label>
      <label class="f"><span class="f-label">${isInvoice ? 'Fällig am' : 'Gültig bis'}</span>
        <input id="ftDue" class="input" type="date" value="${escHTML((isInvoice ? doc.dueDate : doc.validUntil) || '')}"></label>
    </div>

    <div class="f-label" style="margin-top:10px">Positionen</div>
    <div id="ftItems">${itemRowsHtml(doc)}</div>
    <button class="btn block" type="button" data-action="ft-item-add">＋ Position</button>

    <div class="f-row">
      <label class="f"><span class="f-label">MwSt %</span><input id="ftVat" class="input" type="number" step="0.1" value="${escHTML(String(num(doc.vatRate, 8.1)))}"></label>
      <label class="f"><span class="f-label">Rabatt %</span><input id="ftDiscount" class="input" type="number" step="1" value="${escHTML(String(num(doc.discountPercent)))}"></label>
    </div>

    <div class="ftm-totals" id="ftTotals">
      <div><span>Zwischentotal</span><strong>${fmtMoney(t.subtotal)}</strong></div>
      <div><span>MwSt</span><strong>${fmtMoney(t.vat)}</strong></div>
      <div class="sum"><span>Total</span><strong>${fmtMoney(t.rounded)}</strong></div>
    </div>

    ${isInvoice ? `<div class="ftm-qr">${doc.qr && doc.qr.url
      ? `<img src="${escHTML(doc.qr.url)}" alt="QR-Einzahlungsschein"><span class="muted-row">QR-Code hinterlegt</span>`
      : '<span class="muted-row">Kein QR-Code hinterlegt — der Einzahlungsschein wird in Quantus am Desktop hochgeladen.</span>'}</div>` : ''}

    <label class="f"><span class="f-label">Einleitung</span><textarea id="ftIntro" class="input" rows="2">${escHTML(doc.intro || '')}</textarea></label>
    <label class="f"><span class="f-label">Schlusstext</span><textarea id="ftOutro" class="input" rows="2">${escHTML(doc.outro || '')}</textarea></label>

    <button class="btn primary block" type="button" data-action="ft-doc-save" data-kind="${kind}" data-id="${doc.id}">Speichern</button>
    ${kind === 'offer' ? `<button class="btn block" type="button" data-action="ft-to-invoice" data-id="${doc.id}">In Rechnung umwandeln</button>` : ''}
    <button class="btn danger block" type="button" data-action="ft-doc-delete" data-kind="${kind}" data-id="${doc.id}">Löschen</button>
  </form>`;
}

// Zwischenspeicher des offenen Dokuments (damit Positionen ohne Sync-Runde
// bearbeitet werden können; gespeichert wird erst beim Tippen auf „Speichern").
let draft = null;

function readForm() {
  if (!draft) return null;
  const get = (id) => (document.getElementById(id) || {}).value || '';
  draft.title = get('ftTitle');
  draft.client = { ...(draft.client || {}), company: get('ftCompany'), name: get('ftName'), email: get('ftEmail') };
  draft.projectId = get('ftProject') || null;
  draft.status = get('ftStatus') || draft.status;
  draft.issueDate = get('ftIssue') || draft.issueDate;
  if (draft.kind === 'invoice') draft.dueDate = get('ftDue') || draft.dueDate;
  else draft.validUntil = get('ftDue') || draft.validUntil;
  draft.vatRate = num(get('ftVat'), 8.1);
  draft.discountPercent = num(get('ftDiscount'));
  draft.intro = get('ftIntro');
  draft.outro = get('ftOutro');
  document.querySelectorAll('#ftItems .ftm-item').forEach((row, idx) => {
    const item = draft.items[idx];
    if (!item) return;
    row.querySelectorAll('[data-fti]').forEach(input => {
      const field = input.dataset.fti;
      item[field] = (field === 'qty' || field === 'price') ? num(input.value) : input.value;
    });
  });
  return draft;
}

function openDocSheet(kind, doc) {
  draft = JSON.parse(JSON.stringify(doc));
  draft.kind = kind;
  openSheet({
    title: (kind === 'invoice' ? 'Rechnung ' : 'Offerte ') + (doc.number || ''),
    size: 'full',
    body: docFormHtml(kind, draft),
    onClose: () => { draft = null; },
  });
}

function blankDoc(kind, projectId) {
  const company = ft().company || {};
  const project = projectId ? projects().find(p => p.id === projectId) : null;
  const numbering = nextNumber(kind);
  const base = {
    id: newId(kind === 'invoice' ? 'ftinv' : 'ftoff'),
    kind,
    number: numbering.number,
    _counterKey: numbering.counterKey,
    _counterValue: numbering.counterValue,
    status: 'draft',
    projectId: projectId || null,
    client: (project && project.client) || { company: '', name: '', email: '' },
    title: project ? project.title : (kind === 'invoice' ? 'Rechnung' : 'Offerte'),
    intro: kind === 'invoice'
      ? 'Wir erlauben uns, folgende Leistungen in Rechnung zu stellen:'
      : 'Gerne unterbreiten wir Ihnen folgende Offerte:',
    outro: kind === 'invoice' ? 'Zahlbar innert 30 Tagen.' : 'Wir freuen uns auf die Zusammenarbeit.',
    items: [{ id: newId('pos'), description: '', qty: 1, unit: 'Pauschal', price: 0 }],
    vatRate: num(company.vatRate, 8.1),
    discountPercent: 0,
    currency: 'CHF',
    issueDate: todayYmd(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    source: 'mobile',
  };
  if (kind === 'invoice') { base.dueDate = addDays(todayYmd(), num(company.paymentDays, 30)); base.qr = null; base.paidAt = null; }
  else base.validUntil = addDays(todayYmd(), 30);
  return base;
}

// ── Aktionen ────────────────────────────────────────────────────────────────
registerActions({
  'ft-tab': (d) => { ui.tab = d.seg; ui.projectId = null; store.notify(); },
  'ft-open-project': (d) => { ui.projectId = d.id; ui.tab = 'projekte'; store.notify(); },
  'ft-close-project': () => { ui.projectId = null; store.notify(); },
  'ft-open-doc': (d) => {
    const doc = docById(d.kind, d.id);
    if (doc) openDocSheet(d.kind, doc);
  },
  'ft-new-doc': (d) => openDocSheet(d.kind, blankDoc(d.kind, d.project || null)),

  'ft-item-add': () => {
    readForm();
    draft.items.push({ id: newId('pos'), description: '', qty: 1, unit: 'Std.', price: 0 });
    const host = document.getElementById('ftItems');
    if (host) host.innerHTML = itemRowsHtml(draft);
  },
  'ft-item-remove': (d) => {
    readForm();
    draft.items.splice(Number(d.idx), 1);
    const host = document.getElementById('ftItems');
    if (host) host.innerHTML = itemRowsHtml(draft);
  },

  'ft-doc-save': async (d) => {
    const doc = readForm();
    if (!doc) return;
    doc.updatedAt = nowISO();
    const counterKey = doc._counterKey;
    const counterValue = doc._counterValue;
    delete doc._counterKey;
    delete doc._counterValue;
    await store.performOp({ type: 'ft-doc-save', payload: { kind: d.kind, doc, counterKey, counterValue } });
    // Bezahlte Rechnung automatisch in den Finanzen verbuchen (wie in Quantus).
    if (d.kind === 'invoice' && doc.status === 'paid' && !ft().finances.some(f => f.invoiceId === doc.id)) {
      await store.performOp({
        type: 'ft-finance-add',
        payload: {
          id: newId('ftfin'), invoiceId: doc.id, type: 'income',
          title: 'Rechnung ' + (doc.number || ''), amount: totals(doc).rounded,
          date: todayYmd(), createdAt: nowISO(),
        },
      });
    }
    closeSheet();
    toast('Gespeichert ✓', 'ok');
  },

  'ft-doc-delete': async (d) => {
    const doc = docById(d.kind, d.id) || draft;
    const ok = await confirmPreview({
      title: 'Dokument löschen?', confirmLabel: 'Löschen', danger: true,
      previewHtml: `<div class="mail-preview"><div><b>${escHTML((doc && doc.number) || '')}</b> ${escHTML((doc && doc.title) || '')}</div>
        <div class="mail-preview-body">${escHTML(fmtMoney(totals(doc || {}).rounded))}</div></div>`,
    });
    if (!ok) return;
    await store.performOp({ type: 'ft-doc-delete', payload: { kind: d.kind, id: d.id } });
    closeSheet();
    toast('Gelöscht', 'ok');
  },

  'ft-to-invoice': async (d) => {
    const offer = readForm() || docById('offer', d.id);
    if (!offer) return;
    const numbering = nextNumber('invoice');
    const invoice = JSON.parse(JSON.stringify(offer));
    invoice.id = newId('ftinv');
    invoice.kind = 'invoice';
    invoice.number = numbering.number;
    invoice.status = 'draft';
    invoice.issueDate = todayYmd();
    invoice.dueDate = addDays(todayYmd(), num((ft().company || {}).paymentDays, 30));
    invoice.validUntil = null;
    invoice.qr = null;
    invoice.paidAt = null;
    invoice.fromOfferId = offer.id;
    invoice.intro = 'Wir erlauben uns, folgende Leistungen in Rechnung zu stellen:';
    invoice.outro = 'Zahlbar innert 30 Tagen.';
    invoice.createdAt = nowISO();
    invoice.updatedAt = nowISO();
    delete invoice._counterKey;
    delete invoice._counterValue;
    await store.performOp({
      type: 'ft-doc-save',
      payload: { kind: 'invoice', doc: invoice, counterKey: numbering.counterKey, counterValue: numbering.counterValue },
    });
    const updatedOffer = { ...offer, invoiceId: invoice.id, status: offer.status === 'draft' ? 'accepted' : offer.status, updatedAt: nowISO() };
    delete updatedOffer._counterKey;
    delete updatedOffer._counterValue;
    await store.performOp({ type: 'ft-doc-save', payload: { kind: 'offer', doc: updatedOffer } });
    closeSheet();
    ui.tab = 'rechnungen';
    toast('Rechnung ' + invoice.number + ' erstellt', 'ok');
  },

  'ft-toggle-task': async (d) => {
    const task = store.getTasks().find(t => t.id === d.id);
    if (!task) return;
    await store.performOp({
      type: 'update-task',
      payload: { id: d.id, status: task.status === 'done' ? 'todo' : 'done' },
    });
  },

  'ft-new-task': async (d) => {
    const input = document.getElementById('ftNewTask');
    const title = ((input || {}).value || '').trim();
    if (!title) { toast('Titel fehlt', 'error'); return; }
    await store.performOp({
      type: 'add-task',
      payload: {
        id: newId('task'), title, projectId: d.project || null, status: 'todo', priority: 3,
        category: 'flowertech', tags: ['flowertech'], source: 'mobile',
        createdAt: nowISO(), updatedAt: nowISO(),
      },
    });
  },

  'ft-new-project': async () => {
    const title = ((document.getElementById('ftNewProject') || {}).value || '').trim();
    if (!title) { toast('Projektname fehlt', 'error'); return; }
    await store.performOp({
      type: 'add-project',
      payload: {
        id: newId('project'), title, status: 'active', projectType: 'flowertech',
        pipelineStage: 'lead', tags: ['flowertech'], source: 'mobile',
        createdAt: nowISO(), updatedAt: nowISO(),
      },
    });
    toast('Projekt erstellt ✓', 'ok');
  },

  'ft-set-stage': async (d) => {
    await store.performOp({ type: 'update-project', payload: { id: d.id, pipelineStage: d.stage } });
  },
  'ft-project-note': async (d) => {
    const project = projects().find((item) => item.id === d.id); if (!project) return;
    const label = project.title || 'FlowerTech-Projekt';
    const { openNoteComposer } = await import('../note-ui.js');
    openNoteComposer({
      heading: 'FlowerTech-Projektnotiz', noteClass: 'research', tags: [label], lockedTags: [label],
      source: { app: 'flowertech', entityType: 'project', entityId: project.id, label, route: '#/flowertech' },
      placeholder: 'Nur bewusst freigegebene Projektinformationen – keine Zugangsdaten oder Finanzdetails.',
    });
  },
});

// ── Ansichten ───────────────────────────────────────────────────────────────
function dashboardHtml() {
  const data = ft();
  const openInvoices = data.invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled');
  const openSum = openInvoices.reduce((s, i) => s + totals(i).rounded, 0);
  const income = data.finances.filter(f => f.type === 'income').reduce((s, f) => s + num(f.amount), 0);
  const expense = data.finances.filter(f => f.type === 'expense').reduce((s, f) => s + num(f.amount), 0);
  const newInquiries = Object.values(data.inquiries).filter(i => !i.status || i.status === 'new').length;
  return `
    <div class="ftm-kpis">
      <div class="ftm-kpi"><span>Projekte</span><strong>${projects().filter(p => p.status !== 'done' && p.status !== 'archived').length}</strong></div>
      <div class="ftm-kpi"><span>Offene Rechnungen</span><strong>${fmtMoney(openSum)}</strong></div>
      <div class="ftm-kpi"><span>Netto</span><strong>${fmtMoney(income - expense)}</strong></div>
      <div class="ftm-kpi"><span>Neue Anfragen</span><strong>${newInquiries}</strong></div>
    </div>
    <div class="chip-row">
      <button class="chip accent" data-action="ft-new-doc" data-kind="offer">＋ Offerte</button>
      <button class="chip accent" data-action="ft-new-doc" data-kind="invoice">＋ Rechnung</button>
    </div>
    <section class="hcard"><div class="hcard-head"><span class="hcard-icon">📦</span><span class="hcard-title">Projekte</span></div>
      <div class="hcard-body">${projects().slice(0, 5).map(projectRow).join('') || '<div class="muted-row">Noch keine Projekte.</div>'}</div></section>
    <section class="hcard"><div class="hcard-head"><span class="hcard-icon">🧾</span><span class="hcard-title">Letzte Rechnungen</span></div>
      <div class="hcard-body">${data.invoices.slice(0, 4).map(d => docRow('invoice', d)).join('') || '<div class="muted-row">Noch keine Rechnungen.</div>'}</div></section>`;
}

function projectDetailHtml(project) {
  const list = tasksOf(project.id);
  const offers = docs('offer').filter(d => d.projectId === project.id);
  const invoices = docs('invoice').filter(d => d.projectId === project.id);
  const notes = store.getNotesBySource('flowertech', project.id);
  return `
    <div class="chip-row">
      <button class="chip" data-action="ft-close-project">‹ Alle Projekte</button>
      ${Object.entries(STAGES).map(([k, l]) =>
        `<button class="chip ${((project.pipelineStage || 'lead') === k) ? 'accent' : ''}" data-action="ft-set-stage" data-id="${project.id}" data-stage="${k}">${l}</button>`).join('')}
    </div>
    <div class="page-title">${escHTML(project.title || 'Projekt')}</div>
    ${project.description ? `<div class="muted-row">${escHTML(project.description)}</div>` : ''}
    <button class="btn block" data-action="ft-project-note" data-id="${escHTML(project.id)}">📝 Projektnotiz (${notes.length})</button>
    <div class="muted-row">Nur explizit gespeicherte Inhalte werden zentral übernommen; Kunden-, Rechnungs- und Zugangsdaten nie automatisch.</div>

    <section class="hcard"><div class="hcard-head"><span class="hcard-icon">✅</span><span class="hcard-title">Aufgaben</span></div>
      <div class="hcard-body">
        <div class="quick-add">
          <input class="input" id="ftNewTask" placeholder="Neue Aufgabe">
          <button class="chip accent" data-action="ft-new-task" data-project="${project.id}">＋</button>
        </div>
        ${list.length ? list.map(t => `<div class="card row-card ${t.status === 'done' ? 'done' : ''}">
          <button class="check ${t.status === 'done' ? 'on' : ''}" data-action="ft-toggle-task" data-id="${t.id}" aria-label="Erledigt"></button>
          <div class="row-main"><div class="row-title">${escHTML(t.title || 'Aufgabe')}</div></div>
        </div>`).join('') : '<div class="muted-row">Noch keine Aufgaben.</div>'}
      </div></section>

    <section class="hcard"><div class="hcard-head"><span class="hcard-icon">📄</span><span class="hcard-title">Offerten</span>
      <button class="chip accent" data-action="ft-new-doc" data-kind="offer" data-project="${project.id}">＋</button></div>
      <div class="hcard-body">${offers.map(d => docRow('offer', d)).join('') || '<div class="muted-row">Noch keine Offerten.</div>'}</div></section>

    <section class="hcard"><div class="hcard-head"><span class="hcard-icon">🧾</span><span class="hcard-title">Rechnungen</span>
      <button class="chip accent" data-action="ft-new-doc" data-kind="invoice" data-project="${project.id}">＋</button></div>
      <div class="hcard-body">${invoices.map(d => docRow('invoice', d)).join('') || '<div class="muted-row">Noch keine Rechnungen.</div>'}</div></section>`;
}

export default {
  title: 'FlowerTech', icon: '🌸',
  render() {
    const tabs = [
      { key: 'dashboard', label: 'Start' },
      { key: 'projekte', label: 'Projekte' },
      { key: 'offerten', label: 'Offerten' },
      { key: 'rechnungen', label: 'Rechnungen' },
      { key: 'finanzen', label: 'Finanzen' },
      { key: 'anfragen', label: 'Anfragen' },
    ];
    const data = ft();
    let body = '';

    if (ui.tab === 'dashboard') {
      body = dashboardHtml();
    } else if (ui.tab === 'projekte') {
      const project = ui.projectId ? projects().find(p => p.id === ui.projectId) : null;
      body = project ? projectDetailHtml(project) : `
        <div class="quick-add">
          <input class="input" id="ftNewProject" placeholder="Neues FlowerTech-Projekt">
          <button class="chip accent" data-action="ft-new-project">＋</button>
        </div>
        ${projects().length ? projects().map(projectRow).join('')
          : emptyState('📦', 'Noch keine Projekte', 'Lege dein erstes FlowerTech-Projekt an.')}`;
    } else if (ui.tab === 'offerten' || ui.tab === 'rechnungen') {
      const kind = ui.tab === 'rechnungen' ? 'invoice' : 'offer';
      const list = docs(kind).slice().sort((a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || '')));
      body = `<div class="chip-row"><button class="chip accent" data-action="ft-new-doc" data-kind="${kind}">＋ Neu</button></div>
        ${list.length ? list.map(d => docRow(kind, d)).join('')
          : emptyState('📄', 'Noch keine Dokumente', 'Erstelle die erste ' + (kind === 'invoice' ? 'Rechnung' : 'Offerte') + '.')}`;
    } else if (ui.tab === 'finanzen') {
      const income = data.finances.filter(f => f.type === 'income').reduce((s, f) => s + num(f.amount), 0);
      const expense = data.finances.filter(f => f.type === 'expense').reduce((s, f) => s + num(f.amount), 0);
      body = `<div class="ftm-kpis">
          <div class="ftm-kpi"><span>Einnahmen</span><strong>${fmtMoney(income)}</strong></div>
          <div class="ftm-kpi"><span>Ausgaben</span><strong>${fmtMoney(expense)}</strong></div>
          <div class="ftm-kpi"><span>Netto</span><strong>${fmtMoney(income - expense)}</strong></div>
        </div>
        ${data.finances.length ? data.finances.map(f => `<div class="card row-card">
          <div class="row-main"><div class="row-title">${escHTML(f.title || '')}</div>
          <div class="row-sub">${escHTML(f.date || '')}</div></div>
          <span class="chip ${f.type === 'income' ? 'accent' : 'danger'}">${f.type === 'income' ? '+' : '−'} ${fmtMoney(f.amount)}</span>
        </div>`).join('') : '<div class="muted-row">Noch keine Buchungen.</div>'}`;
    } else {
      const list = Object.entries(data.inquiries).map(([id, v]) => ({ id, ...(v || {}) }))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      body = list.length ? list.map(i => `<div class="card row-card">
          <div class="row-main"><div class="row-title">${escHTML(i.name || i.email || 'Anfrage')}</div>
          <div class="row-sub">${escHTML(i.company || '')}${i.email ? ' · ' + escHTML(i.email) : ''}</div>
          <div class="row-meta">${escHTML(String(i.message || '').slice(0, 120))}</div></div>
        </div>`).join('')
        : emptyState('📨', 'Keine Anfragen', 'Website-Anfragen aus FlowerTech erscheinen hier.');
    }

    return `<div class="pad">
      ${pageHeader('FlowerTech', (ft().company || {}).tagline || 'Web-Apps & KI · Schweizer KMU')}
      ${segmented(tabs, ui.tab, 'ft-tab')}
      ${body}
    </div>`;
  },
};
