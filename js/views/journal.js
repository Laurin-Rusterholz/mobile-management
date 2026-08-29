// ============================================================================
//  Journal — Einträge, die Quantus aufs Handy schickt (mobilePushes)
//  Lesen, als gelesen markieren, in die Zwischenablage kopieren.
// ============================================================================
import { escHTML, openSheet, closeSheet, toast, emptyState } from '../util.js';
import * as store from '../store.js';
import { LS } from '../config.js';
import { registerActions } from '../actions.js';
import { pageHeader } from './common.js';
import { navigate } from '../router.js';

function seenSet() {
  try { return new Set(JSON.parse(localStorage.getItem(LS.seenPushes) || '[]')); }
  catch (e) { return new Set(); }
}

registerActions({
  'journal-open': (d) => {
    const push = store.getJournalPushes().find(p => p && p.id === d.id);
    if (!push) return;
    const seen = seenSet();
    seen.add(push.id);
    try { localStorage.setItem(LS.seenPushes, JSON.stringify([...seen])); } catch (e) {}
    openSheet({
      title: push.title || 'Journal-Eintrag',
      size: 'full',
      body: `<div class="journal-detail">
        <div class="muted-row">${escHTML(push.sentAt ? new Date(push.sentAt).toLocaleString('de-CH') : '')}</div>
        <div class="journal-body">${escHTML(push.content || '')}</div>
        <button class="btn primary block" type="button" data-action="journal-note" data-id="${escHTML(push.id)}">Erkenntnis in Noteflow speichern</button>
        <button class="btn block" type="button" data-action="journal-copy" data-id="${escHTML(push.id)}">Text kopieren</button>
      </div>`,
      onClose: () => store.notify(),
    });
  },
  'journal-copy': (d) => {
    const push = store.getJournalPushes().find(p => p && p.id === d.id);
    if (!push) return;
    try { navigator.clipboard.writeText(push.content || ''); toast('Kopiert ✓', 'ok'); }
    catch (e) { toast('Bitte manuell markieren', 'warn'); }
  },
  'journal-note': async (d) => {
    const push = store.getJournalPushes().find(p => p && p.id === d.id); if (!push) return;
    const label = push.title || 'Journal';
    const note = await store.saveCanonicalNote({
      noteClass: 'learning', title: label, content: push.content || '', tags: [label], notebookId: null,
      dedupeKey: `journal:${push.id}`,
      source: { app: 'journal', entityType: 'entry', entityId: push.id, label, route: '#/journal' },
    });
    closeSheet(); toast('In Noteflow gespeichert ✓', 'ok'); navigate('noteflow', { params: { id: note.id } });
  },
  'journal-read-all': () => {
    const ids = store.getJournalPushes().map(p => p && p.id).filter(Boolean);
    try { localStorage.setItem(LS.seenPushes, JSON.stringify(ids)); } catch (e) {}
    toast('Alle als gelesen markiert', 'ok');
    store.notify();
  },
});

export default {
  title: 'Journal', icon: '📔',
  render() {
    const pushes = store.getJournalPushes().slice().reverse();
    const seen = seenSet();
    const unread = pushes.filter(p => p && !seen.has(p.id)).length;
    return `<div class="pad">
      ${pageHeader('Journal', pushes.length + ' Einträge' + (unread ? ' · ' + unread + ' neu' : ''),
        unread ? '<button class="chip" data-action="journal-read-all">Alle gelesen</button>' : '')}
      ${pushes.length ? pushes.map(p => `
        <div class="card row-card ${seen.has(p.id) ? '' : 'unread'}" data-action="journal-open" data-id="${escHTML(p.id)}">
          <div class="row-main">
            <div class="row-title">${escHTML(p.title || 'Journal-Eintrag')}</div>
            <div class="row-sub">${escHTML(String(p.content || '').slice(0, 110))}</div>
            <div class="row-meta">${escHTML(p.sentAt ? new Date(p.sentAt).toLocaleString('de-CH') : '')}</div>
          </div>
        </div>`).join('')
        : emptyState('📔', 'Noch keine Einträge', 'Journal-Pushes aus Quantus erscheinen hier.')}
    </div>`;
  },
};
