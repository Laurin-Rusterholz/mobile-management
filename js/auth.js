// ============================================================================
//  Anmeldung — die App traegt sie SELBST
//  ---------------------------------------------------------------------------
//  ENTSCHEID: Ein Einstellungs-Tab, der nur nach Quantus verlinkt, haette hier
//  nichts geloest. Eine Firebase-Sitzung gilt PRO ORIGIN. Die Hauptapp meldet
//  sich nicht einmal selbst an — die Google-Anmeldung passiert dort in
//  drive.html, und index.html verwendet die Sitzung desselben Origins nur mit.
//  Die Mobile-App liegt auf einem ANDEREN Origin und erbt daher gar nichts.
//  Wer hier eine Nutzerkennung braucht, muss sich hier anmelden.
//
//  WOFUER: Das Career Model liegt unter careerModel/users/<uid>. Ohne uid ist
//  dieser Pfad nicht bildbar — das war der Grund, warum die Ansicht bisher
//  fehlte. Der Kernabgleich (app-data.json) laeuft unveraendert ueber die
//  bestehende REST-Fassade und haengt NICHT an dieser Anmeldung.
//
//  Popup zuerst, Weiterleitung als Rueckfall — dieselbe Reihenfolge wie in
//  drive.html, damit sich beide Wege gleich verhalten.
// ============================================================================
import { FIREBASE_CONFIG } from './config.js';

let app = null;
let auth = null;
let db = null;
let nutzer = null;
let aufgeloest = false;          // onAuthStateChanged hat mindestens einmal gefeuert
const hoerer = new Set();

function melden() { hoerer.forEach((fn) => { try { fn(nutzer); } catch (e) { console.warn('Auth-Hoerer:', e); } }); }

// Das SDK liegt als compat-Skript in index.html. Fehlt es (Offline-Start,
// blockierter CDN), sagt das die App ehrlich, statt still nichts zu tun.
export function sdkBereit() {
  return !!(window.firebase && window.firebase.auth);
}

export function initAuth() {
  if (auth || !sdkBereit()) return auth;
  try {
    app = window.firebase.apps && window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(FIREBASE_CONFIG);
    auth = window.firebase.auth();
    // Rueckkehr aus einer Weiterleitung abschliessen. Ohne das bliebe die App
    // nach dem Rueckfallweg angemeldet-aber-ahnungslos.
    try { auth.getRedirectResult().catch(() => {}); } catch (e) {}
    auth.onAuthStateChanged((u) => { nutzer = u || null; aufgeloest = true; melden(); });
  } catch (e) {
    console.warn('Firebase Auth nicht verfuegbar:', e && e.message);
    auth = null;
  }
  return auth;
}

export function currentUser() { return nutzer; }
export function uid() { return (nutzer && nutzer.uid) || null; }
export function authAufgeloest() { return aufgeloest; }

// Anmeldezustand beobachten. Gibt eine Abmeldefunktion zurueck — Ansichten
// MUESSEN sie beim Verlassen aufrufen, sonst rechnet ein Hoerer in einer
// laengst verlassenen Ansicht weiter.
export function onAuthChange(fn) {
  hoerer.add(fn);
  if (aufgeloest) { try { fn(nutzer); } catch (e) {} }
  return () => hoerer.delete(fn);
}

// Realtime Database — nur fuer Daten, die an der Nutzerkennung haengen
// (heute: Career Model). Der Kernabgleich benutzt sie NICHT.
export function rtdb() {
  if (db) return db;
  if (!initAuth() || !window.firebase.database) return null;
  try { db = window.firebase.database(); } catch (e) { db = null; }
  return db;
}

export function fehlerText(e) {
  const code = (e && e.code) || '';
  if (code === 'auth/unauthorized-domain') {
    // Der wahrscheinlichste erste Fehler nach dem Ausrollen — und einer, den
    // nur ein Mensch in der Firebase-Konsole beheben kann. Deshalb sagt die
    // Meldung genau das, statt "Fehler".
    return 'Diese Adresse ist in Firebase noch nicht freigegeben (Authentication → Settings → Authorized domains).';
  }
  if (code === 'auth/popup-blocked') return 'Das Anmeldefenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.';
  if (code === 'auth/popup-closed-by-user') return 'Anmeldung abgebrochen.';
  if (code === 'auth/network-request-failed') return 'Netzwerkfehler — Verbindung oder Inhaltsblocker prüfen.';
  if (code === 'auth/operation-not-supported-in-this-environment') return 'Anmeldung in dieser Umgebung nicht möglich.';
  return 'Anmeldung fehlgeschlagen' + (code ? ' (' + code + ')' : '') + '.';
}

export async function signInGoogle() {
  if (!initAuth()) return { ok: false, grund: 'Firebase Auth ist nicht geladen.' };
  const provider = new window.firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
    return { ok: true };
  } catch (e) {
    if (e && e.code === 'auth/popup-blocked' && window.self === window.top) {
      // Weiterleitung nur auf oberster Ebene: in einem eingebetteten Rahmen
      // verweigert Google die Darstellung.
      try { await auth.signInWithRedirect(provider); return { ok: true, weitergeleitet: true }; }
      catch (e2) { return { ok: false, grund: fehlerText(e2), code: e2 && e2.code }; }
    }
    if (e && e.code === 'auth/popup-closed-by-user') return { ok: false, abgebrochen: true };
    console.error('Google-Anmeldung fehlgeschlagen:', e);
    return { ok: false, grund: fehlerText(e), code: e && e.code };
  }
}

export async function signOutGoogle() {
  if (!auth) return { ok: false, grund: 'Nicht angemeldet.' };
  try { await auth.signOut(); return { ok: true }; }
  catch (e) { return { ok: false, grund: fehlerText(e) }; }
}
