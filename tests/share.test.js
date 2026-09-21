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

test('a league code round-trips rosters, contracts and settings, and outlives the pool', async () => {
  const league = createLeague({ name: 'Shared', user: { name: 'Me', abbr: 'ME', color: '#123456' }, numTeams: 8, seed: 77, draftType: 'auction', injuries: 'high', keepers: 9 });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(77), byId);
  startSeason(league, byId);
  simulateWeekAi(league, byId, { includeUser: true });
  advanceWeek(league);
  const code = await encodeLeagueCode(league, PLAYERS);
  assert.ok(/^GE[01]\./.test(code));
  // Naming the players rather than pointing at pool positions roughly doubles
  // a code: this one went from about 3,300 characters to 6,200, and a 32-club
  // pro league from 16,600 to 33,600. That is the price of a code that outlives
  // the pool, and it is guarded here so it cannot creep further unnoticed.
  assert.ok(code.length < 7500, `code is ${code.length} characters`);
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
  // Whitespace pasted around a code is fine; garbage is not.
  await decodeLeagueCode(`  ${code}\n`);
  await assert.rejects(decodeLeagueCode('hello'), /not a league code/);
  // A version-3 code names its players, so a pool that has moved on does not
  // stop it opening. This is the whole point of the version: the fingerprint is
  // carried for information and no longer used to refuse.
  const moved = { ...snap, pool: 'a-completely-different-pool' };
  const still = leagueFromSnapshot(moved, PLAYERS, byId);
  for (const s of ROSTER_SLOTS) assert.equal(still.teams[0].slots[s.id], league.teams[0].slots[s.id], `${s.id} survived the pool moving`);
  assert.equal(still.migrationNote, undefined, 'and nothing to apologise for');
  // A version-2 code points at positions rather than players, so it is still
  // only meaningful against the pool it was made from.
  assert.throws(() => leagueFromSnapshot({ ...snap, v: 2, pool: 'nope' }, PLAYERS, byId), /older player pool/);
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

test('a code opens against a pool that has grown and been reordered', async () => {
  // The scenario this version exists for. `add-players.mjs` re-sorts every
  // position by overall when it merges, so adding one name shuffles the
  // indices of everyone below him — which is why pointing at positions could
  // only ever be defended by refusing the code outright.
  const league = createLeague({ name: 'Durable', user: { name: 'Me', abbr: 'ME', color: '#0f0' }, numTeams: 8, seed: 91, draftType: 'auction' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(91), byId);
  startSeason(league, byId);
  const snap = await decodeLeagueCode(await encodeLeagueCode(league, PLAYERS));

  // A later pool: two new men at the front, and the rest reversed.
  const newcomer = (id) => ({ ...PLAYERS[0], id, name: id });
  const future = [newcomer('a-new-signing-2030'), newcomer('another-one-2030'), ...PLAYERS].reverse();
  const futureById = new Map(future.map((p) => [p.id, p]));
  assert.notEqual(poolFingerprint(future), poolFingerprint(PLAYERS), 'the pool really did move');

  const copy = leagueFromSnapshot(snap, future, futureById);
  assert.equal(copy.migrationNote, undefined, 'nobody went missing');
  copy.teams.forEach((t, i) => {
    for (const s of ROSTER_SLOTS) assert.equal(t.slots[s.id], league.teams[i].slots[s.id], `${t.abbr} ${s.id} came back as somebody else`);
  });
  for (const [id, c] of Object.entries(league.contracts)) assert.deepEqual(copy.contracts[id], c, `${id}'s contract`);
});

test('a player the recipient has not got is reported, not silently swapped', async () => {
  const league = createLeague({ name: 'Partial', user: { name: 'Me', abbr: 'ME', color: '#0f0' }, numTeams: 8, seed: 92, draftType: 'auction' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(92), byId);
  startSeason(league, byId);
  const snap = await decodeLeagueCode(await encodeLeagueCode(league, PLAYERS));
  // Somebody the code names is not in this pool at all.
  const missing = league.teams[0].slots.QB1;
  const thinner = PLAYERS.filter((p) => p.id !== missing);
  const thinnerById = new Map(thinner.map((p) => [p.id, p]));
  const copy = leagueFromSnapshot(snap, thinner, thinnerById);
  assert.match(copy.migrationNote || '', /not in your player pool/, 'the recipient is told');
  assert.match(copy.migrationNote || '', /^1 player/, 'and how many');
  // The hole is filled off the market rather than left open, so the league is
  // playable; the note is what makes that honest rather than silent.
  assert.ok(copy.teams[0].slots.QB1, 'the slot is not left empty');
  assert.notEqual(copy.teams[0].slots.QB1, missing);
});

test('version 2 codes still open, and only against the pool they were made from', async () => {
  const league = createLeague({ name: 'Old', user: { name: 'Me', abbr: 'ME', color: '#0f0' }, numTeams: 8, seed: 93, draftType: 'auction' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(93), byId);
  startSeason(league, byId);
  // What a version-2 code was: pool indices, no table.
  const v3 = snapshot(league, PLAYERS);
  const base = PLAYERS.filter((p) => !p.generated);
  const poolIndex = new Map(base.map((p, i) => [p.id, i]));
  const toPool = (ref) => (ref >= 0 ? poolIndex.get(v3.ids[ref]) ?? -1 : ref);
  const v2 = JSON.parse(JSON.stringify(v3));
  v2.v = 2; delete v2.ids;
  v2.teams.forEach((t) => { t.s = t.s.map(toPool); t.ir = t.ir.map(toPool); t.sq = t.sq.map(toPool); });
  const rekey = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, val]) => [toPool(Number(k)), val])) : o);
  v2.contracts = rekey(v2.contracts); v2.dev = rekey(v2.dev);
  v2.retired = (v2.retired || []).map((k) => toPool(Number(k)));

  const opened = leagueFromSnapshot(v2, PLAYERS, byId);
  for (const s of ROSTER_SLOTS) assert.equal(opened.teams[0].slots[s.id], league.teams[0].slots[s.id], `v2 ${s.id}`);
  assert.throws(() => leagueFromSnapshot({ ...v2, pool: 'moved on' }, PLAYERS, byId), /older player pool/);
});
