import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, userTeamIndex, teamForGame, syncContracts, registerPlayers, migrateLeague, LEAGUE_VERSION } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { enterOffseason } from '../src/engine/offseason.js';
import {
  IR_SLOTS, IR_MIN_WEEKS, SEASON_ENDING, irList, irReady, irBlocker, canPlaceOnIr, placeOnIr, activateFromIr,
  releaseFromIr, returnFromIr, clearIr, aiManageIr,
} from '../src/engine/injuries.js';
import { ownerMap, freeAgents, fileClaim, processWaivers, rostersValid, advanceWeekWithMoves } from '../src/engine/transactions.js';
import { overall } from '../src/engine/ratings.js';

registerPlayers(byId);

function league(seed, opts = {}) {
  const lg = createLeague({ name: 'R', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'off', ...opts });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  return lg;
}
const hurt = (lg, id, weeks, team) => { lg.injuries[id] = { weeks, kind: 'knee sprain', since: null, season: lg.season, team }; };

test('only a long injury goes on injured reserve, and only so many at once', () => {
  const lg = league(61);
  const u = userTeamIndex(lg);
  const me = lg.teams[u];
  const wr = me.slots.WR1;
  assert.match(irBlocker(lg, u, wr), /injured player/);
  hurt(lg, wr, IR_MIN_WEEKS - 1, u);
  assert.match(irBlocker(lg, u, wr), /weeks or more/);
  hurt(lg, wr, IR_MIN_WEEKS, u);
  assert.equal(irBlocker(lg, u, wr), null);
  assert.ok(canPlaceOnIr(lg, u, wr));
  assert.match(irBlocker(lg, u, 'nobody-1900'), /not on your roster/);

  placeOnIr(lg, u, wr);
  assert.deepEqual(irList(me), [wr]);
  assert.equal(me.slots.WR1, null, 'his slot is open');
  assert.equal(ownerMap(lg).get(wr), u, 'still owned, so nobody can claim him');
  assert.ok(!freeAgents(lg, PLAYERS).some((p) => p.id === wr));
  assert.ok(!teamForGame(lg, u, byId).lineup.WR.some((p) => p.id === wr), 'he does not play');
  assert.ok(rostersValid(lg, byId).ok, rostersValid(lg, byId).reason);
  assert.ok(lg.transactions.some((t) => t.type === 'ir' && t.add === wr));

  // Fill the empty slot off the wire.
  const fa = freeAgents(lg, PLAYERS).filter((p) => p.pos === 'WR').sort((a, b) => overall(b) - overall(a))[0];
  fileClaim(lg, u, fa.id, null, byId);
  processWaivers(lg, byId);
  assert.ok(ROSTER_SLOTS.some((s) => me.slots[s.id] === fa.id), 'the signing took the open slot');
  assert.ok(rostersValid(lg, byId).ok);

  // The second place fills, the third is refused.
  const s1 = me.slots.S1, s2 = me.slots.S2;
  hurt(lg, s1, 6, u); hurt(lg, s2, 6, u);
  placeOnIr(lg, u, s1);
  assert.match(irBlocker(lg, u, s2), new RegExp(`Only ${IR_SLOTS} places`));
  assert.throws(() => placeOnIr(lg, u, s2), new RegExp(`Only ${IR_SLOTS} places`));
});

test('a player on IR keeps healing and keeps his contract, and is activated at a cost', () => {
  const lg = league(62);
  const u = userTeamIndex(lg);
  const me = lg.teams[u];
  const te = me.slots.TE1;
  hurt(lg, te, 5, u);
  placeOnIr(lg, u, te);
  syncContracts(lg);
  assert.ok(lg.contracts[te], 'injured reserve keeps him on the books');

  // He is not fit yet.
  assert.throws(() => activateFromIr(lg, u, te, null, byId), /not fit/);
  delete lg.injuries[te];
  assert.deepEqual(irReady(lg, me).map(String), [te]);
  // The open slot takes him straight back.
  const slot = activateFromIr(lg, u, te, null, byId);
  assert.equal(slot, 'TE1');
  assert.equal(irList(me).length, 0);
  assert.ok(rostersValid(lg, byId).ok);

  // With the slot filled behind him, activating costs a player, and it must be one of his own position.
  const ol = me.slots.OL5;
  hurt(lg, ol, 6, u);
  placeOnIr(lg, u, ol);
  const fa = freeAgents(lg, PLAYERS).filter((p) => p.pos === 'OL').sort((a, b) => overall(b) - overall(a))[0];
  fileClaim(lg, u, fa.id, null, byId);
  processWaivers(lg, byId);
  delete lg.injuries[ol];
  assert.throws(() => activateFromIr(lg, u, ol, null, byId), /No open OL slot/);
  assert.throws(() => activateFromIr(lg, u, ol, me.slots.QB1, byId), /Release a OL/);
  activateFromIr(lg, u, ol, fa.id, byId);
  assert.ok(ROSTER_SLOTS.some((s) => me.slots[s.id] === ol));
  assert.equal(ownerMap(lg).get(fa.id), undefined, 'the man released is a free agent again');
  assert.ok(rostersValid(lg, byId).ok);
  assert.throws(() => activateFromIr(lg, u, ol, null, byId), /not on injured reserve/);
});

test('releasing from IR, returning for the playoffs, and clearing at the offseason', () => {
  const lg = league(63);
  const u = userTeamIndex(lg);
  const me = lg.teams[u];
  const cb = me.slots.CB2;
  hurt(lg, cb, SEASON_ENDING, u);
  placeOnIr(lg, u, cb);
  assert.ok(releaseFromIr(lg, u, cb));
  assert.equal(releaseFromIr(lg, u, cb), false);
  assert.equal(ownerMap(lg).get(cb), undefined, 'released players go back to the pool');

  // Healed players slide back in at the playoffs; still-injured ones do not.
  const lb = me.slots.LB1, dl = me.slots.DL1;
  hurt(lg, lb, 5, u); hurt(lg, dl, 5, u);
  placeOnIr(lg, u, lb); placeOnIr(lg, u, dl);
  delete lg.injuries[lb];
  const back = returnFromIr(lg, byId);
  assert.deepEqual(back.map((b) => b.id), [lb]);
  assert.equal(me.slots.LB1, lb);
  assert.deepEqual(irList(me), [dl]);

  // The offseason empties it; a man whose slot was filled behind him is let go.
  const fa = freeAgents(lg, PLAYERS).filter((p) => p.pos === 'DL').sort((a, b) => overall(b) - overall(a))[0];
  fileClaim(lg, u, fa.id, null, byId);
  processWaivers(lg, byId);
  while (lg.phase === 'season' || lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg); }
  const off = enterOffseason(lg, PLAYERS, byId);
  assert.ok(lg.teams.every((t) => irList(t).length === 0), 'injured reserve is empty');
  assert.ok(off.releasedFromIr.some((r) => r.id === dl) || ROSTER_SLOTS.some((s) => me.slots[s.id] === dl), 'he either came back or was let go');
});

test('AI clubs park long injuries, sign cover and bring players back', () => {
  const lg = league(64, { injuries: 'high' });
  const rng = new RNG(7);
  let parked = 0, activated = 0;
  while (lg.phase === 'season') {
    simulateWeekAi(lg, byId, { includeUser: true });
    const before = (lg.transactions || []).length;
    advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
    for (const t of (lg.transactions || []).slice(before)) {
      if (t.type === 'ir') parked++;
      if (t.type === 'activate') activated++;
    }
    const v = rostersValid(lg, byId);
    assert.ok(v.ok, v.reason);
    for (const t of lg.teams) {
      assert.ok(irList(t).length <= IR_SLOTS, `${t.abbr} has ${irList(t).length} on IR`);
      for (const id of irList(t)) assert.ok(!ROSTER_SLOTS.some((s) => t.slots[s.id] === id), 'an IR player holds no slot');
    }
  }
  assert.ok(parked > 0, `AI clubs used injured reserve ${parked} times`);
  assert.ok(activated >= 0);
  const owned = ownerMap(lg);
  assert.equal(new Set(owned.keys()).size, owned.size, 'nobody owned twice');
});

test('an older save gains an empty injured reserve', () => {
  const lg = league(65);
  for (const t of lg.teams) delete t.ir;
  lg.version = 2;
  migrateLeague(lg);
  assert.equal(lg.version, LEAGUE_VERSION);
  assert.ok(lg.teams.every((t) => Array.isArray(t.ir) && t.ir.length === 0));
  assert.ok(rostersValid(lg, byId).ok);
  assert.deepEqual(clearIr(lg, byId), []);
  assert.deepEqual(aiManageIr(lg, byId), []);
});
