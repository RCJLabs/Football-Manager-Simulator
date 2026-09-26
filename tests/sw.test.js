// The service worker, run in a sandbox with a network and a cache the test
// controls. What launches with no network is the copy of the app's page kept
// in the cache, and every page opened inside the scope used to replace it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCOPE = 'https://example.test/app/';
const SOURCE = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const OFFLINE = new Error('offline');

const page = (body, status = 200, type = 'text/html; charset=utf-8') => new Response(body, { status, headers: { 'content-type': type } });

/**
 * sw.js with `net(path)` for a network — a Response, or OFFLINE to fail the
 * way a phone with no signal does — and a cache the test can read back.
 */
function worker(net) {
  const stores = new Map();
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, `${SCOPE}sw.js`).href;
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const caches = {
    open: async (name) => {
      const m = store(name);
      return { put: async (r, res) => { m.set(key(r), res); }, match: async (r) => m.get(key(r))?.clone(), addAll: async () => {} };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    // A fresh copy each time, as a browser's cache gives.
    match: async (r) => {
      for (const m of stores.values()) if (m.has(key(r))) return m.get(key(r)).clone();
      return undefined;
    },
  };
  const handlers = {};
  const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const w = { net };
  const fetch = async (req) => {
    const u = new URL(req.url);
    const answer = w.net(u.pathname + u.search);
    if (answer === OFFLINE) throw new TypeError('Failed to fetch');
    return answer;
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch, location: new URL(`${SCOPE}sw.js`), URL, Response, Headers });

  const request = (path, mode, accept) => {
    let answer;
    const waits = [];
    handlers.fetch({
      request: { url: new URL(path, SCOPE).href, method: 'GET', mode, headers: new Headers({ accept }) },
      respondWith: (p) => { answer = p; },
      waitUntil: (p) => { waits.push(p); },
    });
    return (async () => {
      const res = await answer;
      await Promise.all(waits);
      // A write the worker did not wait on still lands before the test looks.
      await new Promise((r) => setTimeout(r, 0));
      return res;
    })();
  };
  /** Open a page, as the address bar or the installed app's launcher does. */
  w.open = (path) => request(path, 'navigate', 'text/html');
  /** Load a file the page asks for. */
  w.load = (path) => request(path, 'no-cors', '*/*');
  /** The page that would launch with no network. */
  w.kept = async () => {
    const r = await caches.match('./index.html');
    return r ? r.text() : null;
  };
  return w;
}

test('the app\'s own page is fetched fresh, and the last good one launches offline', async () => {
  const w = worker((path) => page(`the game from ${path}`));
  for (const path of ['', 'index.html', '?source=twa']) {
    const res = await w.open(path);
    const body = await res.text();
    assert.equal(body, `the game from ${new URL(path, SCOPE).pathname}${new URL(path, SCOPE).search}`);
    assert.equal(await w.kept(), body, `opening ${path || 'the scope'} did not keep the page it fetched`);
  }
  w.net = () => OFFLINE;
  assert.equal(await (await w.open('')).text(), 'the game from /app/?source=twa');
});

test('a page that is not the app never becomes the one that launches offline', async () => {
  const w = worker((path) => ({
    '/app/': page('the game'),
    '/app/no-such-page': page('404 Not Found', 404),
    '/app/DESIGN.md': page('# Design notes', 200, 'text/markdown; charset=utf-8'),
    '/app/src/store.js': page('export function load() {}', 200, 'text/javascript'),
  })[path]);
  await w.open('');
  assert.equal(await w.kept(), 'the game');
  for (const [path, status, body] of [['no-such-page', 404, '404 Not Found'], ['DESIGN.md', 200, '# Design notes'], ['src/store.js', 200, 'export function load() {}']]) {
    const res = await w.open(path);
    // Online, the page is what the server said, as before.
    assert.equal(res.status, status);
    assert.equal(await res.text(), body);
    assert.equal(await w.kept(), 'the game', `opening ${path} replaced the page that launches offline`);
  }
  w.net = () => OFFLINE;
  assert.equal(await (await w.open('')).text(), 'the game');
  // And any page opened with no network is the app, as it always was.
  assert.equal(await (await w.open('no-such-page')).text(), 'the game');
});

test('an answer for the app that is not the whole page is passed on and not kept', async () => {
  let next = page('the game');
  const w = worker(() => next);
  await w.open('');
  const redirected = page('somewhere else');
  Object.defineProperty(redirected, 'redirected', { value: true });
  const opaque = { type: 'opaqueredirect', ok: false, status: 0, redirected: false, headers: new Headers(), clone() { return this; } };
  for (const [label, res] of [['a server error', page('503 Service Unavailable', 503)], ['a page that is not HTML', page('the game?', 200, 'text/plain')], ['a redirected answer', redirected], ['a redirect', opaque]]) {
    next = res;
    assert.equal(await w.open(''), res, `${label} was not passed on`);
    assert.equal(await w.kept(), 'the game', `${label} became the page that launches offline`);
  }
});

test('files are served from the cache first, and kept only when they arrive whole', async () => {
  let next = page('export const a = 1;', 200, 'text/javascript');
  const w = worker(() => next);
  assert.equal(await (await w.load('src/a.js')).text(), 'export const a = 1;');
  next = page('changed', 200, 'text/javascript');
  assert.equal(await (await w.load('src/a.js')).text(), 'export const a = 1;', 'a cached file was fetched again');
  next = page('missing', 404, 'text/plain');
  assert.equal((await w.load('src/b.js')).status, 404);
  next = page('export const b = 2;', 200, 'text/javascript');
  assert.equal(await (await w.load('src/b.js')).text(), 'export const b = 2;', 'a 404 was kept');
});
