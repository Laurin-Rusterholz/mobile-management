// ============================================================================
//  Quantus Mobile — PWA (Service-Worker-Registrierung + Install-Prompt)
// ============================================================================
let _deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredPrompt = e;
});
export function getInstallPrompt() { return _deferredPrompt; }

export function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err));
    });
  }
}
