import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { encodeLeagueCode, decodeLeagueCode, leagueFromSnapshot, poolFingerprint, snapshot } from '../src/engine/share.js';
import { loadRegistry, createSlot, activateSlot, deleteSlot, writeSlot, readSlot, renameSlot, summarize, firstEmptySlot, slotIsEmpty, MAX_SLOTS, LEGACY_KEY, REGISTRY_KEY } from '../src/slots.js';

const fakeStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), size: () => m.size }; };

test('a league code round-trips rosters, contracts and settings and refuses a different pool', async () => {
  const league = createLeague({ name: 'Shared', user: { name: 'Me', abbr: 'ME', color: '#123456' }, numTeams: 8, seed: 77, draftType: 'auction', injuries: 'high', keepers: 9 });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(77), byId);
  startSeason(league, byId);
  simulateWeekAi(league, byId, { includeUser: true });
  advanceWeek(league);
  const code = await encodeLeagueCode(league, PLAYERS);
  assert.ok(/^GE[01]\./.test(code));
  assert.ok(code.length < 6000, `code is ${code.length} characters`);
  const snap = await decodeLeagueCode(code);
  assert.equal(snap.pool, poolFingerprint(PLAYERS));
  const copy = leagueFromSnapshot(snap, PLAYERS, byId);
  assert.equal(copy.name, 'Shared');
  assert.equal(copy.teams.length, 8);
  assert.equal(copy.phase, 'season');
  assert.equal(copy.week, 1, 'opens at the start of the season');
  assert.equal(copy.season, league.season);
  assert.equal(copy.settings.injuries, 'high');
  assert.equal(copy.settings.keepers, 9);
  copy.teams.forEach((t, i) => {
    assert.equal(t.name, league.teams[i].name);
    assert.equal(t.isUser, league.teams[i].isUser);
    assert.equal(t.gm, league.teams[i].gm);
    for (const s of ROSTER_SLOTS) assert.equal(t.slots[s.id], league.teams[i].slots[s.id], `${t.abbr} ${s.id}`);
    assert.equal(t.record.w + t.record.l, 0, 'records reset');
  });
  for (const [id, c] of Object.entries(league.contracts)) assert.deepEqual(copy.contracts[id], c);
  assert.ok(copy.shared);
  // Whitespace pasted around a code is fine; garbage is not; a different pool is refused.
  await decodeLeagueCode(`  ${code}\n`);
  await assert.rejects(decodeLeagueCode('hello'), /not a league code/);
  const other = { ...snap, pool: 'nope' };
  assert.throws(() => leagueFromSnapshot(other, PLAYERS, byId), /different player pool/);
  const bad = snapshot(league, PLAYERS);
  bad.v = 99;
  await assert.rejects(decodeLeagueCode(`GE0.${Buffer.from(JSON.stringify(bad)).toString('base64url')}`), /version 99/);
});

const aLeague = (name, over = {}) => ({ name, season: 1, phase: 'season', mode: 'fantasy', week: 3, schedule: new Array(14), teams: [{ isUser: true, name: 'Club', record: { w: 2, l: 1, t: 0 } }], ...over });

test('save slots: three of them, padded on first use, a legacy save becoming the first', () => {
  const st = fakeStorage();
  st.setItem(LEGACY_KEY, JSON.stringify({ league: { name: 'Old', season: 2, phase: 'season', mode: 'fantasy', week: 3, schedule: new Array(14), teams: [{ isUser: true, name: 'Me', record: { w: 2, l: 0, t: 0 } }] }, game: null, prefs: { autoplayMs: 500 } }));
  const reg = loadRegistry(st);
  assert.equal(reg.slots.length, MAX_SLOTS, 'always three');
  assert.equal(reg.active, reg.slots[0].id);
  assert.equal(reg.slots[0].name, 'Old');
  assert.equal(reg.slots[0].summary.record, '2-0');
  assert.equal(st.getItem(LEGACY_KEY), null, 'legacy key retired');
  assert.ok(readSlot(st, reg.active).league.name === 'Old');
  // The other two are empty and know it.
  assert.equal(slotIsEmpty(st, reg.slots[1]), true);
  assert.equal(slotIsEmpty(st, reg.slots[0]), false);
  assert.equal(firstEmptySlot(st, reg).id, reg.slots[1].id);
  // An empty browser still gets three.
  assert.equal(loadRegistry(fakeStorage()).slots.length, MAX_SLOTS);
});

test('save slots: a new league takes the first empty one, and the fourth is refused', () => {
  const st = fakeStorage();
  const reg = loadRegistry(st);
  const ids = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const id = createSlot(st, reg, `League ${i + 1}`);
    assert.ok(id, `slot ${i + 1} should be available`);
    assert.equal(id, reg.slots[i].id, 'slots fill in order');
    ids.push(id);
    writeSlot(st, reg, id, { league: aLeague(`League ${i + 1}`), game: null });
  }
  assert.equal(firstEmptySlot(st, reg), null, 'all three are taken');
  assert.equal(createSlot(st, reg, 'One too many'), null, 'a fourth is refused rather than overwriting');
  assert.equal(reg.slots.length, MAX_SLOTS);
  // Unless it is forced, which is what stops a league in memory being lost.
  const forced = createSlot(st, reg, 'Rescued', { force: true });
  assert.ok(forced);
  assert.equal(reg.slots.length, MAX_SLOTS + 1);
});

test('save slots: deleting empties the slot in place and opens nothing else', () => {
  const st = fakeStorage();
  const reg = loadRegistry(st);
  const a = createSlot(st, reg, 'Alpha');
  writeSlot(st, reg, a, { league: aLeague('Alpha'), game: null });
  const b = createSlot(st, reg, 'Beta');
  writeSlot(st, reg, b, { league: aLeague('Beta', { mode: 'pro' }), game: null });
  assert.equal(reg.active, b);
  assert.equal(reg.slots[1].summary.mode, 'pro');

  // Switching back and renaming still work.
  assert.equal(activateSlot(st, reg, a).league.name, 'Alpha');
  renameSlot(st, reg, a, 'Renamed');
  assert.equal(loadRegistry(st).slots[0].name, 'Renamed');

  // Delete the open one. Nothing is opened in its place — the whole point.
  const next = deleteSlot(st, reg, a);
  assert.equal(next, null, 'deleting the open slot leaves nothing open');
  assert.equal(loadRegistry(st).active, null);
  assert.equal(reg.slots.length, MAX_SLOTS, 'the slot itself stays, it is just empty');
  assert.equal(reg.slots[0].id, a, 'and keeps its place in the order');
  assert.equal(slotIsEmpty(st, reg.slots[0]), true);
  assert.equal(readSlot(st, a).league, null, 'the league is gone from storage');
  assert.equal(reg.slots[0].name, '');
  // The other save is untouched and can still be opened.
  assert.equal(readSlot(st, b).league.name, 'Beta');
  assert.equal(activateSlot(st, reg, b).league.name, 'Beta');
  // Deleting one that is not open leaves the open one alone.
  const stillOpen = deleteSlot(st, reg, reg.slots[2].id);
  assert.equal(stillOpen, b);
  assert.throws(() => activateSlot(st, reg, 'nope'), /No such/);
  assert.equal(summarize(null).phase, 'empty');
  void REGISTRY_KEY;
});
