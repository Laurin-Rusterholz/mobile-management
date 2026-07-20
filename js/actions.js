// ============================================================================
//  Quantus Mobile — zentrale Event-Delegation
//  Views deklarieren Interaktionen per data-action="name" + data-* Attribute.
//  Registrierte Handler bekommen (dataset, element, event).
// ============================================================================
import { haptic } from './util.js';

const handlers = new Map();

export function registerActions(obj) {
  for (const [name, fn] of Object.entries(obj)) handlers.set(name, fn);
}

function run(e, type) {
  const trigger = e.target.closest('[data-action]');
  if (!trigger) return;
  const name = trigger.getAttribute('data-action');
  const fn = handlers.get(name);
  if (!fn) return;
  // Bei submit-Aktionen Default verhindern; bei click nur wenn Button/Link
  if (type === 'submit') e.preventDefault();
  if (type === 'click') {
    if (trigger.tagName === 'A') e.preventDefault();
    haptic(8);
  }
  fn({ ...trigger.dataset }, trigger, e);
}

export function initActions() {
  document.addEventListener('click', (e) => run(e, 'click'));
  document.addEventListener('submit', (e) => run(e, 'submit'));
}
