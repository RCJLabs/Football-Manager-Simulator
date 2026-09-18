import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { encodeLeagueCode, decodeLeagueCode, leagueFromSnapshot, poolFingerprint, snapshot } from '../src/engine/share.js';
import { loadRegistry, createSlot, activateSlot, deleteSlot, writeSlot, readSlot, renameSlot, summarize, LEGACY_KEY, REGISTRY_KEY } from '../src/slots.js';

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

test('save slots: a legacy save becomes slot one, slots switch, rename and delete cleanly', () => {
  const st = fakeStorage();
  st.setItem(LEGACY_KEY, JSON.stringify({ league: { name: 'Old', season: 2, phase: 'season', mode: 'fantasy', week: 3, schedule: new Array(14), teams: [{ isUser: true, name: 'Me', record: { w: 2, l: 0, t: 0 } }] }, game: null, prefs: { autoplayMs: 500 } }));
  const reg = loadRegistry(st);
  assert.equal(reg.slots.length, 1);
  assert.equal(reg.active, reg.slots[0].id);
  assert.equal(reg.slots[0].name, 'Old');
  assert.equal(reg.slots[0].summary.record, '2-0');
  assert.equal(st.getItem(LEGACY_KEY), null, 'legacy key retired');
  assert.ok(readSlot(st, reg.active).league.name === 'Old');
  const id2 = createSlot(st, reg, 'Second');
  assert.equal(reg.active, id2);
  assert.equal(reg.slots.length, 2);
  writeSlot(st, reg, id2, { league: { name: 'Second', season: 1, phase: 'draft', mode: 'pro', week: 1, schedule: [], teams: [{ isUser: true, name: 'Club', record: { w: 0, l: 0, t: 0 } }] }, game: null });
  assert.equal(reg.slots[1].summary.mode, 'pro');
  const back = activateSlot(st, reg, reg.slots[0].id);
  assert.equal(back.league.name, 'Old');
  renameSlot(st, reg, reg.slots[0].id, 'Renamed');
  assert.equal(loadRegistry(st).slots[0].name, 'Renamed');
  const next = deleteSlot(st, reg, reg.slots[0].id);
  assert.equal(next, id2);
  assert.equal(reg.slots.length, 1);
  assert.equal(loadRegistry(st).active, id2);
  assert.throws(() => activateSlot(st, reg, 'nope'), /No such/);
  assert.equal(summarize(null).phase, 'empty');
  const fresh = loadRegistry(fakeStorage());
  assert.deepEqual(fresh, { active: null, slots: [] });
  void REGISTRY_KEY;
});
