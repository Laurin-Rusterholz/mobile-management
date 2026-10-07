import * as store from './store.js';
import {getBaseUrl} from './config.js';
import {currentUser,initAuth,onAuthChange} from './auth.js';
import {registerActions} from './actions.js';
import {escHTML,openSheet} from './util.js';
import {taskCard} from './views/common.js';
import {leadFilesBlock} from './views/chatgpt.js';
import {createDeviceBriefingController} from '../quantus-briefing-device-controller.mjs';
const controller=createDeviceBriefingController({getUser:()=>{initAuth();return currentUser()},getData:()=>store.state.data||{},origin:new URL(getBaseUrl()).origin});
let stopAuth;
const routes={projects:'projekte',organizations:'organisationen',persons:'personen'};
function entity(col,item){
  let attrs=col==='tasks'?'data-action="open-task"':col==='notes'?'data-action="note-open"':col==='meetings'?'data-action="meeting-open"':routes[col]?`data-action="coll-open" data-coll="${routes[col]}"`:`data-action="qb-open-lead"`;
  return `<button type="button" ${attrs} data-id="${escHTML(item.id)}">${escHTML(item.title||item.name||'Original öffnen')}</button>`;
}
registerActions({'qb-open-lead':d=>{const l=store.getById('chatgptLead',d.id);if(!l)return;openSheet({title:l.title||'Lead',size:'full',body:`<div class="qb-dashboard"><p>${escHTML(l.rawInput||'')}</p><p>${escHTML(l.interpretation||'')}</p><p>${escHTML(l.lastAction||'')}</p><p>Nächster Schritt: ${escHTML(l.nextAction||'Noch nicht festgelegt')}</p>${leadFilesBlock(l)}</div>`})}});
window.renderQuantusMobileBriefing=function(date){
  const data=store.state.data||{},e=data.entities||{},end=new Date(date+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+7);const until=end.toISOString().slice(0,10);
  const events=store.getMeetings().filter(m=>m.date>=date&&m.date<=until).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const blocks=data.dailyBriefing?.timeBlocks?.[date]||[];
  return window.QuantusBriefingDevice.render({data,date,pending:store.state.pending.length,adapters:{entity,task:taskCard,files:leadFilesBlock,
    calendar:`<p class="qb-muted">Geladene Quantus-Termine · heute und sieben Folgetage. Google Kalender separat öffnen.</p>${events.map(m=>`<div class="qb-row">${escHTML(m.date)} ${escHTML(m.startTime||m.time||'')} ${entity('meetings',m)}</div>`).join('')}${blocks.map(b=>`<p class="qb-muted">${escHTML(b.startTime||'')}–${escHTML(b.endTime||'')} · ${escHTML(b.title||'Block')} (Zeitblock)</p>`).join('')}<a href="#/googlecalendar">Google Kalender</a>`,
    progress:'<a href="#/smarter">Smarter</a> <a href="#/flashcards">RecallLab</a>'}});
};
window.mountQuantusMobileBriefing=root=>{stopAuth?.();initAuth();stopAuth=onAuthChange(()=>controller.mount(root.querySelector('.qb-dashboard')));return controller.mount(root.querySelector('.qb-dashboard'))};
window.unmountQuantusMobileBriefing=()=>{stopAuth?.();stopAuth=null;controller.unmount()};
