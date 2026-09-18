// Minimal hash router: '#/draft', '#/team/2', '#/box/3/1'.
const routes = [];
let current = null;

export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ re, keys, handler, pattern });
}

export function navigate(hash, { replace = false } = {}) {
  if (!hash.startsWith('#')) hash = '#' + hash;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) dispatch();
}

export function currentPath() {
  return location.hash.replace(/^#/, '') || '/';
}

export function dispatch() {
  const path = currentPath();
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      current = { pattern: r.pattern, params, path };
      r.handler(params);
      return current;
    }
  }
  current = null;
  const fallback = routes.find((r) => r.pattern === '/');
  if (fallback) { history.replaceState(null, '', '#/'); fallback.handler({}); }
  return null;
}

export function currentRoute() {
  return current;
}

export function startRouter() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
