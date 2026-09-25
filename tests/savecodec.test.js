// How a save is written down (savecodec.js), what the worker does with it
// (save-worker.js), and the order the store writes it in when packing happens
// beside the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, isPacked, PACKED } from '../src/savecodec.js';

console.warn = () => {};

test('packing gives back exactly what it was given', () => {
  const cases = [
    '',
    '{',
    '{"a":1}',
    JSON.stringify({ name: 'Zoë Ångström', note: 'naïve café — “quoted”', emoji: '🏈🏆' }),
    // Lengths either side of a whole number of fifteen-bit characters.
    ...[1, 2, 14, 15, 16, 29, 30, 31, 119, 120, 121].map((n) => 'x'.repeat(n)),
    // Incompressible, so the deflated bytes are nearly as many as the input's.
    Array.from({ length: 5000 }, (_, i) => String.fromCharCode(33 + ((i * 7919) % 90))).join(''),
    // Longer than one chunk of the packer.
    JSON.stringify(Array.from({ length: 40000 }, (_, i) => ({ i, t: i % 3 ? 'run' : 'pass', y: (i * 37) % 23 }))),
  ];
  for (const json of cases) {
    for (const level of [1, 6]) {
      const packed = encode(json, level);
      assert.ok(isPacked(packed));
      assert.equal(decode(packed), json, `lost something at level ${level}, length ${json.length}`);
    }
  }
});

test('a packed save is characters a browser will store as they are', () => {
  // Every code unit past the marker lies in 0x20..0x801F: no control
  // characters, and never half of a surrogate pair, which a browser is free to
  // replace. A lone surrogate is where a naive sixteen-bit packing breaks.
  const json = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ i, v: Math.sin(i) })));
  const packed = encode(json);
  const body = packed.slice(PACKED.length);
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    assert.ok(c >= 0x20 && c <= 0x801f, `code unit ${c.toString(16)} at ${i}`);
  }
  // And a round trip through UTF-16 as a browser would store it.
  assert.equal(decode(Buffer.from(packed, 'utf16le').toString('utf16le')), json);
});

test('a save written before packing reads as it always did', () => {
  const plain = JSON.stringify({ league: { name: 'Old' }, game: null });
  assert.equal(isPacked(plain), false);
  assert.equal(decode(plain), plain);
  assert.equal(isPacked(null), false);
});

test('the worker packs what it is sent and says which save it was', async () => {
  const sent = [];
  globalThis.self = { postMessage: (m) => sent.push(m) };
  try {
    await import(`../src/save-worker.js?t=${Math.random()}`);
    const json = JSON.stringify({ league: { name: 'W', week: 3 }, game: null });
    self.onmessage({ data: { gen: 7, json } });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].gen, 7);
    assert.equal(decode(sent[0].packed), json);
    // A failure comes back as an answer, so the store is not left waiting.
    self.onmessage({ data: { gen: 8, json: { toString() { throw new Error('nope'); } } } });
    assert.equal(sent[1].gen, 8);
    assert.match(sent[1].error, /nope/);
  } finally {
    delete globalThis.self;
  }
});

// ---------------------------------------------------------------------------
// The store, with a worker that answers when the test says so
// ---------------------------------------------------------------------------

function fakeStorage() {
  const map = new Map();
  return {
    full: false,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      // A full origin refuses what would grow it: a league. The preferences
      // and the registry are rewritten at much the same size every save, and a
      // browser lets those through.
      if (this.full && k.startsWith('gridiron-eras:slot:')) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
  };
}

/**
 * A store in a page with a worker. Nothing is packed until `answer()`, so a
 * test can put anything it likes between a save leaving and landing.
 */
async function pageStore({ brokenWorker = false } = {}) {
  const storage = fakeStorage();
  const listeners = {};
  const workers = [];
  class FakeWorker {
    constructor(url, opts) {
      this.url = String(url);
      this.opts = opts;
      this.jobs = [];
      workers.push(this);
    }
    postMessage(m) { this.jobs.push(m); }
    /** Pack the oldest job and hand it back, as the real one does. */
    answer() {
      const { gen, json } = this.jobs.shift();
      this.onmessage({ data: { gen, packed: encode(json, 6) } });
    }
    /** Hand back the oldest job's answer as a failure. */
    fail(error = 'boom') {
      const { gen } = this.jobs.shift();
      this.onmessage({ data: { gen, error } });
    }
  }
  globalThis.localStorage = storage;
  globalThis.window = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  globalThis.document = { visibilityState: 'visible' };
  globalThis.Worker = FakeWorker;
  const store = await import(`../src/store.js?t=${Math.random()}`);
  store.load();
  const worker = () => {
    assert.equal(workers.length, 1, 'one worker, made on the first routine save');
    return workers[0];
  };
  const slot = () => {
    const active = JSON.parse(storage.getItem('gridiron-eras:slots:v1')).active;
    const raw = storage.getItem(`gridiron-eras:slot:${active}`);
    return raw == null ? null : JSON.parse(decode(raw));
  };
  // Written on the spot at the end, which also clears the debounce: a timer
  // left behind would make its worker from the next test's globals.
  const cleanup = () => {
    store.saveNow();
    delete globalThis.window; delete globalThis.document; delete globalThis.Worker;
  };
  if (brokenWorker) FakeWorker.prototype.postMessage = function post() { queueMicrotask(() => this.onerror(new Event('error'))); };
  return { storage, store, worker, slot, listeners, cleanup };
}

const league = (name = 'L') => ({ name, phase: 'season', season: 1, week: 1, teams: [{ isUser: true, name: 'Me', slots: {} }] });

/** A league on disk, written on the spot, to have something to change. */
function begin(store, name) {
  store.update((s) => { s.league = league(name); }, { silent: true });
  store.saveNow();
  return store.listSlots().active;
}

test('a routine save is packed in the worker and written when it lands', async () => {
  const { store, worker, slot, cleanup } = await pageStore();
  try {
    begin(store);
    store.update((s) => { s.league.week = 2; });
    store.saveNow({ background: true });
    const w = worker();
    assert.match(w.url, /save-worker\.js$/);
    assert.equal(w.opts.type, 'module');
    assert.equal(slot().league.week, 1, 'written before the worker answered');
    w.answer();
    assert.equal(slot().league.week, 2);
    assert.equal(store.saveError(), null);
  } finally { cleanup(); }
});

test('the worker holds one save at a time; a change made meanwhile goes when it lands', async () => {
  const { store, worker, slot, cleanup } = await pageStore();
  try {
    begin(store);
    store.update((s) => { s.league.week = 2; });
    store.saveNow({ background: true });
    const w = worker();
    for (let week = 3; week <= 6; week++) {
      store.update((s) => { s.league.week = week; });
      store.saveNow({ background: true });
    }
    assert.equal(w.jobs.length, 1, 'changes made while packing were posted too');
    w.answer();
    assert.equal(slot().league.week, 2, 'the save that was packing still lands');
    assert.equal(w.jobs.length, 1, 'and the waiting one goes at once');
    assert.equal(JSON.parse(w.jobs[0].json).league.week, 6, 'from the state as it is now');
    w.answer();
    assert.equal(slot().league.week, 6);
    assert.equal(w.jobs.length, 0);
  } finally { cleanup(); }
});

test('a save on the spot supersedes the one the worker holds', async () => {
  const { store, worker, slot, cleanup } = await pageStore();
  try {
    begin(store);
    store.update((s) => { s.league.week = 2; });
    store.saveNow({ background: true });
    store.update((s) => { s.league.week = 3; });
    store.saveNow();
    assert.equal(slot().league.week, 3);
    // And the worker has been given another since, so the stale answer comes
    // back while a save is being packed — it is still not that one.
    store.update((s) => { s.league.week = 4; });
    store.saveNow({ background: true });
    const w = worker();
    assert.equal(w.jobs.length, 2);
    w.answer();
    assert.equal(slot().league.week, 3, 'an older save landed over a newer one');
    assert.equal(store.saveError(), null, 'a stale answer was treated as a failure');
    w.answer();
    assert.equal(slot().league.week, 4, 'the save it was holding did not land');
    assert.equal(store.saveError(), null);
  } finally { cleanup(); }
});

test('a page going away writes what the worker has not finished', async () => {
  const { store, worker, slot, listeners, cleanup } = await pageStore();
  try {
    begin(store);
    store.update((s) => { s.league.week = 2; });
    store.saveNow({ background: true });
    // Nothing changed since, so only the save in the worker is unwritten.
    document.visibilityState = 'hidden';
    listeners.visibilitychange();
    assert.equal(slot().league.week, 2, 'hidden with a save still packing, and it was lost');
    worker().answer();
    assert.equal(slot().league.week, 2);
  } finally { cleanup(); }
});

test('deleting the open league drops the save the worker is packing for it', async () => {
  const { storage, store, worker, cleanup } = await pageStore();
  try {
    const keep = begin(store, 'Keep');
    store.openNewSlot('Doomed');
    store.update((s) => { s.league = league('Doomed'); });
    const doomed = store.listSlots().active;
    store.update((s) => { s.league.week = 9; });
    store.saveNow({ background: true });
    store.removeSlot(doomed);
    worker().answer();
    assert.equal(store.saveError(), null);
    assert.equal(JSON.parse(decode(storage.getItem(`gridiron-eras:slot:${doomed}`))).league, null, 'the deleted league came back');
    assert.equal(store.listSlots().slots.filter((s) => !s.empty).length, 1);
    store.switchSlot(keep);
    assert.equal(store.getState().league.name, 'Keep');
  } finally { cleanup(); }
});

test('switching slots finishes the open one\'s save first, on the spot', async () => {
  const { storage, store, worker, cleanup } = await pageStore();
  try {
    const a = begin(store, 'A');
    store.openNewSlot('B');
    store.update((s) => { s.league = league('B'); });
    store.update((s) => { s.league.week = 5; });
    store.saveNow({ background: true });
    const b = store.listSlots().active;
    store.switchSlot(a);
    const readB = () => JSON.parse(decode(storage.getItem(`gridiron-eras:slot:${b}`))).league;
    assert.equal(readB().week, 5);
    worker().answer();
    assert.equal(store.saveError(), null);
    // The stale answer is for B, and it must not land on A.
    assert.equal(store.getState().league.name, 'A');
    assert.equal(JSON.parse(decode(storage.getItem(`gridiron-eras:slot:${a}`))).league.name, 'A');
    assert.equal(readB().week, 5);
  } finally { cleanup(); }
});

test('a packed save the browser refuses is reported, and tried again on the next change only', async () => {
  const { storage, store, worker, slot, cleanup } = await pageStore();
  try {
    let calls = 0;
    store.subscribe(() => { calls++; });
    begin(store);
    store.update((s) => { s.league.week = 2; }, { silent: true });
    store.saveNow({ background: true });
    storage.full = true;
    worker().answer();
    assert.equal(store.saveError()?.quota, true);
    assert.equal(calls, 1, 'the failure has to reach the screen');
    assert.equal(worker().jobs.length, 0, 'a full origin set the worker packing the same league again');
    assert.equal(slot().league.week, 1, 'the last good save is intact');
    storage.full = false;
    store.update((s) => { s.league.week = 3; }, { silent: true });
    store.saveNow({ background: true });
    worker().answer();
    assert.equal(store.saveError(), null);
    assert.equal(calls, 2, 'and so does recovering');
    assert.equal(slot().league.week, 3);
  } finally { cleanup(); }
});

test('a packing failure is reported like a refused write', async () => {
  const { store, worker, slot, listeners, cleanup } = await pageStore();
  try {
    begin(store);
    store.update((s) => { s.league.week = 2; });
    store.saveNow({ background: true });
    worker().fail('out of memory');
    assert.match(store.saveError()?.message || '', /out of memory/);
    assert.equal(store.saveError().quota, false);
    // Still unsaved, so leaving the page writes it.
    document.visibilityState = 'hidden';
    listeners.visibilitychange();
    assert.equal(slot().league.week, 2);
    assert.equal(store.saveError(), null);
  } finally { cleanup(); }
});

test('a browser that cannot start the worker saves on the spot instead', async () => {
  const { store, slot, cleanup } = await pageStore({ brokenWorker: true });
  try {
    begin(store);
    store.update((s) => { s.league.week = 2; });
    store.saveNow({ background: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(slot().league.week, 2, 'the save the worker was holding was lost');
    store.update((s) => { s.league.week = 3; });
    store.saveNow({ background: true });
    assert.equal(slot().league.week, 3, 'and later saves did not fall back');
  } finally { cleanup(); }
});
