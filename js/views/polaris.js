// ============================================================================
//  Polaris — KI-Assistent (Chat)
//  Suchen/Zusammenfassen ohne Bestätigung. Interne Änderungen mit Vorschau/Undo;
//  Massenänderungen, Löschen, Mail-Senden, Kalender-/Finanzänderungen IMMER mit
//  Bestätigung. Backend: n8n quantus-agent Webhook (dieselbe Instanz wie Quantus).
//
//  WARUM DIE ANSICHT EINEN EIGENEN ZUSTAND FUEHRT
//  Die Shell rendert bei JEDER Datenaenderung die ganze Ansicht neu
//  (store.subscribe -> renderView). Waehrend Polaris auf eine Antwort wartet,
//  faellt garantiert ein solcher Neuaufbau an: der 60-Sekunden-Abgleich, der
//  Push der eigenen Nachricht, ein 412-Konflikt. Alles, was nur im DOM stand,
//  war danach weg — die Blase „Polaris denkt…" und der halb getippte Text.
//  Deshalb leben beide hier im Modul und werden beim Aufbau wiederhergestellt.
// ============================================================================
import { escHTML, toast, newId, nowISO } from '../util.js';
import * as store from '../store.js';
import { registerActions } from '../actions.js';

const AGENT_URL = 'https://n8n.srv1757990.hstgr.cloud/webhook/quantus-agent';
const SESSION_KEY = 'qm-polaris-session';

let wartetAufAntwort = false;   // ueberlebt den Neuaufbau der Ansicht
let entwurf = '';               // getippter, noch nicht gesendeter Text

function sessionId() {
  let s = localStorage.getItem(SESSION_KEY);
  if (!s) { s = 'sess_' + newId('x').split('_')[1]; localStorage.setItem(SESSION_KEY, s); }
  return s;
}
function currentChat() {
  const chats = store.getChats();
  return chats[0] || null;
}

async function send(text) {
  if (!text.trim() || wartetAufAntwort) return;
  entwurf = '';
  // Die Blase VOR dem ersten await setzen: performOp benachrichtigt synchron,
  // der dadurch ausgeloeste Neuaufbau zeigt Nachricht und Blase sofort — auch
  // wenn der Push danach sekundenlang am Netz haengt.
  wartetAufAntwort = true;
  let chat = currentChat();
  if (!chat) { chat = { id: newId('chat'), title: text.slice(0, 40), messages: [], createdAt: nowISO(), updatedAt: nowISO() }; await store.performOp({ type: 'add-chat', payload: chat }); chat = currentChat(); }
  await store.performOp({ type: 'add-chat-message', payload: { chatId: chat.id, message: { role: 'user', content: text, timestamp: nowISO() } } });
  renderMessages();
  try {
    const r = await fetch(AGENT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId(), message: text, context: { activeView: 'polaris' } }),
    });
    const data = await r.json().catch(() => ({}));
    const reply = data.reply || data.output || data.text || 'Keine Antwort erhalten.';
    wartetAufAntwort = false;
    await store.performOp({ type: 'add-chat-message', payload: { chatId: chat.id, message: { role: 'assistant', content: reply, timestamp: nowISO() } } });
    renderMessages();
  } catch (e) {
    wartetAufAntwort = false;
    await store.performOp({ type: 'add-chat-message', payload: { chatId: chat.id, message: { role: 'assistant', content: '⚠️ Polaris nicht erreichbar (n8n). Deine Nachricht wurde gespeichert.', timestamp: nowISO() } } });
    renderMessages();
  }
}

// ── Antworten lesbar machen ─────────────────────────────────────────────────
// Polaris antwortet in Markdown — genau wie am Rechner. Bisher lief die
// Antwort durch escHTML und stand dann Zeichen fuer Zeichen da: „**Fällig
// morgen**", „- Punkt", „### Ueberschrift". Auf einem 390 px breiten Schirm
// ist eine Aufzaehlung ohne Zeilenaufbau nicht mehr lesbar.
// Es wird ZUERST escaped, dann formatiert: es kann also kein Markup aus der
// Antwort in die Seite gelangen, nur die hier erzeugten Elemente.
function inlineFormat(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
export function formatMessage(text) {
  const zeilen = escHTML(String(text == null ? '' : text)).split(/\r?\n/);
  const raus = [];
  let liste = null;      // 'ul' | 'ol' | null
  let absatz = [];
  const absatzAbschliessen = () => { if (absatz.length) { raus.push('<p>' + inlineFormat(absatz.join('<br>')) + '</p>'); absatz = []; } };
  const listeAbschliessen = () => { if (liste) { raus.push('</' + liste + '>'); liste = null; } };
  for (const roh of zeilen) {
    const zeile = roh.trim();
    if (!zeile) { absatzAbschliessen(); listeAbschliessen(); continue; }
    let m;
    if ((m = /^#{1,6}\s+(.*)$/.exec(zeile))) {
      absatzAbschliessen(); listeAbschliessen();
      raus.push('<h4>' + inlineFormat(m[1]) + '</h4>'); continue;
    }
    if ((m = /^[-*•]\s+(.*)$/.exec(zeile))) {
      absatzAbschliessen();
      if (liste !== 'ul') { listeAbschliessen(); raus.push('<ul>'); liste = 'ul'; }
      raus.push('<li>' + inlineFormat(m[1]) + '</li>'); continue;
    }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(zeile))) {
      absatzAbschliessen();
      if (liste !== 'ol') { listeAbschliessen(); raus.push('<ol>'); liste = 'ol'; }
      raus.push('<li>' + inlineFormat(m[1]) + '</li>'); continue;
    }
    listeAbschliessen();
    absatz.push(zeile);
  }
  absatzAbschliessen(); listeAbschliessen();
  return raus.join('');
}

// ── Die Tastatur ────────────────────────────────────────────────────────────
// iOS Safari verkleinert bei geoeffneter Tastatur NICHT das Layout-Fenster:
// 100dvh bleibt, was es war. Passt die Seite nicht in den Rest, verschiebt
// Safari stattdessen das ganze Bild nach oben, bis das Feld ueber der Tastatur
// steht — auf dem iPhone 13 gemessen 274 px. Die Kopfzeile faellt komplett
// heraus, die Nachrichten sind oben abgeschnitten.
// Nur das visuelle Fenster weiss davon. Also fragen wir es: die Ueberdeckung
// geht als --kb ans Layout, die Tab-Leiste tritt beim Tippen ab — dann passt
// alles in den sichtbaren Streifen und Safari muss nichts mehr verschieben.
// Eine Zubehoerleiste allein ist keine Tastatur, deshalb die Schwelle.
const TASTATUR_SCHWELLE = 80;
let tastaturAb = null;

function tastaturBeobachten() {
  // Ein Neuaufbau darf nicht zwei Beobachter hinterlassen. Die Wache steht
  // hier und nicht beim Aufrufer: wer anmeldet, meldet auch ab.
  if (tastaturAb) tastaturAb();
  const vv = window.visualViewport;
  const layout = document.getElementById('layout');
  if (!vv || !layout) return;
  const messen = () => {
    // NUR innerHeight - vv.height, NICHT minus vv.offsetTop. Der Versatz ist
    // Safaris Notbehelf, nicht die Tastatur: hat Safari schon verschoben,
    // zoege ihn die Formel wieder ab, der Wert fiele unter die Schwelle, die
    // Ansicht ginge auf, Safari verschoebe erneut — ein Flackern zwischen
    // beiden Zustaenden. Die Tastaturhoehe steht allein in vv.height.
    const ueberdeckung = Math.max(0, Math.round(window.innerHeight - vv.height));
    const offen = ueberdeckung > TASTATUR_SCHWELLE;
    layout.style.setProperty('--kb', ueberdeckung + 'px');
    layout.classList.toggle('keyboard-open', offen);
    // Hat Safari schon verschoben, holen wir das zurueck: ab jetzt passt es.
    if (offen && window.scrollY) window.scrollTo(0, 0);
    const host = document.getElementById('chatMessages');
    if (host) host.scrollTop = host.scrollHeight;
  };
  vv.addEventListener('resize', messen);
  vv.addEventListener('scroll', messen);
  messen();
  // Was beim Betreten angemeldet wird, muss beim Verlassen wieder ab — sonst
  // rechnet der Beobachter in einer laengst verlassenen Ansicht weiter und
  // laesst die Tab-Leiste dort verschwinden.
  tastaturAb = () => {
    vv.removeEventListener('resize', messen);
    vv.removeEventListener('scroll', messen);
    layout.style.removeProperty('--kb');
    layout.classList.remove('keyboard-open');
    tastaturAb = null;
  };
}

function renderMessages() {
  const host = document.getElementById('chatMessages'); if (!host) return;
  const chat = currentChat();
  const msgs = chat ? (chat.messages || []) : [];
  const blasen = msgs.map(m => `<div class="chat-msg ${m.role === 'user' ? 'user' : 'assistant'}">${formatMessage(m.content)}</div>`).join('');
  const wartend = wartetAufAntwort ? '<div class="chat-msg assistant pending">Polaris denkt…</div>' : '';
  host.innerHTML = (blasen + wartend)
    || `<div class="chat-intro">🛰️ Frag Polaris nach deinen Aufgaben, Projekten oder Notizen. Änderungen bestätigst du per Vorschau.</div>`;
  host.scrollTop = host.scrollHeight;
}

function senden() {
  const inp = document.getElementById('chatInput'); if (!inp) return;
  const t = inp.value; inp.value = ''; entwurf = '';
  send(t);
}

registerActions({
  'polaris-send': senden,
  'polaris-new': async () => { await store.performOp({ type: 'add-chat', payload: { id: newId('chat'), title: 'Neuer Chat', messages: [], createdAt: nowISO(), updatedAt: nowISO() } }); renderMessages(); toast('Neuer Chat', 'ok'); },
});

export default {
  title: 'Polaris', icon: '🛰️',
  render() {
    // Die App-Kopfzeile sagt schon „Polaris" — hier steht stattdessen, in
    // welchem Chat man ist. Die zweite grosse Ueberschrift hat 35 px
    // gekostet und nichts gesagt.
    const chat = currentChat();
    const titel = chat && chat.title ? chat.title : 'Neuer Chat';
    return `<div class="chat-view">
      <div class="chat-head">
        <div class="chat-head-title">${escHTML(titel)}</div>
        <button class="chip mini" data-action="polaris-new">＋ Neu</button>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input-bar">
        <div class="chat-input-pill">
          <input id="chatInput" class="chat-field" placeholder="Frag Polaris…" autocomplete="off"
                 enterkeyhint="send" autocapitalize="sentences">
          <button class="chat-send" data-action="polaris-send" aria-label="Senden">➤</button>
        </div>
      </div>
    </div>`;
  },
  mount(root) {
    renderMessages();
    tastaturBeobachten();
    const inp = root.querySelector('#chatInput');
    if (!inp) return;
    inp.value = entwurf;                                  // Neuaufbau ueberlebt
    inp.addEventListener('input', () => { entwurf = inp.value; });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); senden(); } });
  },
  unmount() {
    if (tastaturAb) tastaturAb();
  },
};
