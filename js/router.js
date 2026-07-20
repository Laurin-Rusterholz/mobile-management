// ============================================================================
//  Quantus Mobile — Hash-Router
//  Routen: #/<view>[/<sub>][?k=v]  (buildless, keine History-API nötig)
// ============================================================================

const routes = new Map();      // key -> view module
let _current = { route: 'home', sub: null, params: {} };
let _renderer = null;

export function register(key, mod) { routes.set(key, mod); }
export function onRender(fn) { _renderer = fn; }
export function current() { return _current; }

export function parseHash() {
  let h = (location.hash || '').replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = {};
  if (query) query.split('&').forEach(kv => {
    const [k, v] = kv.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return { route: parts[0] || 'home', sub: parts[1] || null, params };
}

export function navigate(route, opts = {}) {
  let hash = '#/' + route;
  if (opts.sub) hash += '/' + opts.sub;
  if (opts.params && Object.keys(opts.params).length) {
    hash += '?' + Object.entries(opts.params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }
  if (location.hash === hash) { handleRoute(); }   // gleiche Route → neu rendern
  else location.hash = hash;
}

export function getView(key) { return routes.get(key); }

export function handleRoute() {
  _current = parseHash();
  if (!routes.has(_current.route)) _current.route = 'home';
  if (_renderer) _renderer(_current);
}

window.addEventListener('hashchange', handleRoute);
