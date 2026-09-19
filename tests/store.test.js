import { test } from 'node:test';
import assert from 'node:assert/strict';

// store.js warns on every refused write, which is the point of it — but these
// tests refuse writes deliberately, so the warnings are noise here.
console.warn = () => {};

/**
 * A browser's localStorage, and a browser's localStorage when it is full.
 *
 * `full` makes every write throw the way a real origin at its limit does, and
 * it throws *before* changing anything, because that is what a browser does:
 * a rejected setItem leaves the previous value in place, so a save that fails
 * loses the new state rather than corrupting the old one.
 */
function fakeStorage() {
  const map = new Map();
  return {
    full: false,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (this.full) {
        const e = new Error('The quota has been exceeded.');
        e.name = 'QuotaExceededError';
        throw e;
      }
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
    get size() { return map.size; },
  };
}

/** store.js binds localStorage at import, so install one first and import after. */
async function freshStore() {
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  const mod = await import(`../src/store.js?t=${Math.random()}`);
  mod.load();
  return { storage, store: mod };
}

const league = () => ({ name: 'Test', phase: 'season', season: 1, week: 1, teams: [{ isUser: true, name: 'Me' }] });

test('a normal save reports no error', async () => {
  const { store } = await freshStore();
  store.update((s) => { s.league = league(); });
  store.saveNow();
  assert.equal(store.saveError(), null);
});

test('a full browser is reported rather than swallowed', async () => {
  // The bug this guards: the failure went to console.warn and nowhere else, so
  // the game carried on accepting moves it was no longer writing down and the
  // player found out at the next reload, with the session already gone.
  const { storage, store } = await freshStore();
  store.update((s) => { s.league = league(); });
  store.saveNow();
  storage.full = true;
  store.update((s) => { s.league.week = 2; });
  store.saveNow();
  const err = store.saveError();
  assert.ok(err, 'a refused write must be visible to the app');
  assert.equal(err.quota, true, 'it must be identifiable as being out of room, since that is actionable');
  assert.ok(Number.isFinite(err.at));
});

test('the other browsers\' ways of saying the same thing all count', async () => {
  for (const shape of [
    { name: 'NS_ERROR_DOM_QUOTA_REACHED' },
    { name: 'Error', code: 22 },
    { name: 'Error', code: 1014 },
  ]) {
    const { storage, store } = await freshStore();
    store.update((s) => { s.league = league(); });
    store.saveNow();
    storage.setItem = () => { const e = new Error('nope'); Object.assign(e, shape); throw e; };
    store.update((s) => { s.league.week = 2; });
    store.saveNow();
    assert.equal(store.saveError()?.quota, true, `${shape.name}/${shape.code} should read as out of room`);
  }
});

test('a failure that is not about room is still reported, just not as room', async () => {
  const { storage, store } = await freshStore();
  store.update((s) => { s.league = league(); });
  store.saveNow();
  storage.setItem = () => { throw new Error('security policy'); };
  store.update((s) => { s.league.week = 2; });
  store.saveNow();
  const err = store.saveError();
  assert.ok(err);
  assert.equal(err.quota, false);
  assert.match(err.message, /security policy/);
});

test('room freeing up clears the warning without a reload', async () => {
  const { storage, store } = await freshStore();
  store.update((s) => { s.league = league(); });
  store.saveNow();
  storage.full = true;
  store.update((s) => { s.league.week = 2; });
  store.saveNow();
  assert.ok(store.saveError());
  storage.full = false;
  store.update((s) => { s.league.week = 3; });
  store.saveNow();
  assert.equal(store.saveError(), null, 'a save that starts working again must take the banner down');
});

test('the screens are told when the answer changes, and only then', async () => {
  // saveNow runs behind a 250ms debounce on every move. Notifying on each one
  // would re-render the view under the player's hands for no reason.
  const { storage, store } = await freshStore();
  store.update((s) => { s.league = league(); });
  store.saveNow();
  let calls = 0;
  store.subscribe(() => { calls++; });

  storage.full = true;
  store.saveNow();
  assert.equal(calls, 1, 'the first failure has to reach the screen');
  store.saveNow();
  store.saveNow();
  assert.equal(calls, 1, 'a failure that is already on screen must not re-render');

  storage.full = false;
  store.saveNow();
  assert.equal(calls, 2, 'recovering has to reach the screen too');
  store.saveNow();
  assert.equal(calls, 2, 'and then stop');
});

test('a refused write leaves the last good save intact', async () => {
  // The consolation prize: progress since the failure is lost, but the league
  // as of the last successful save is still on disk to load. Browsers reject a
  // too-large setItem without replacing the old value, and writeSlot writes the
  // slot before the registry, so a refused slot write stops before the registry
  // can be moved on to describe a league that was never stored.
  const { storage, store } = await freshStore();
  store.update((s) => { s.league = league(); });
  store.saveNow();
  const registryBefore = storage.getItem('gridiron-eras:slots:v1');
  const slotKey = JSON.parse(registryBefore).active;
  const slotBefore = storage.getItem(`gridiron-eras:slot:${slotKey}`);
  assert.ok(slotBefore.includes('"week":1'), 'the first save should have landed');

  storage.full = true;
  store.update((s) => { s.league.week = 99; });
  store.saveNow();

  assert.equal(storage.getItem('gridiron-eras:slots:v1'), registryBefore, 'the registry must not have moved on');
  assert.equal(storage.getItem(`gridiron-eras:slot:${slotKey}`), slotBefore, 'the stored league must be untouched');
});
