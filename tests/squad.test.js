import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { freeAgents, ownerMap, rostersValid } from '../src/engine/transactions.js';
import { capHit, MIN_SALARY, PRO_CAP } from '../src/engine/cap.js';
import { encodeLeagueCode, decodeLeagueCode, leagueFromSnapshot } from '../src/engine/share.js';
import {
  squadList, squadCapacity, squadOn, squadEligible, squadBlocker, canStash,
  stash, promote, releaseFromSquad, agedOutOfSquad, SQUAD_SLOTS, SQUAD_SEASONS,
} from '../src/engine/squad.js';

registerPlayers(byId);
const view = (lg) => ({ pool: applyCareers(lg, leaguePool(lg, PLAYERS)), byId: careerIndex(lg, leagueIndex(lg, byId)) });
function pro(seed, years = 0) {
  const lg = createLeague({ name: 'P', mode: 'pro', franchise: 1, seed, draftType: 'snake', injuries: 'off' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  for (let i = 0; i < years; i++) { const v = view(lg); simulateAhead(lg, v.byId, v.pool, new RNG(70 + i), 'nextSeason'); }
  return lg;
}

test('only a young generated player can be sent down, and only in a pro league', () => {
  const lg = pro(41, 1);
  assert.ok(squadOn(lg));
  const rookie = lg.rookies.find((p) => p.draftClass === Math.max(...lg.rookies.map((r) => r.draftClass)));
  assert.ok(squadEligible(lg, rookie), 'this season’s class should be eligible');
  // An all-time great is not developing, so he cannot be hidden down there.
  const great = PLAYERS.find((p) => !p.generated);
  assert.equal(squadEligible(lg, great), false);
  // And neither can somebody whose class is long past.
  assert.equal(squadEligible(lg, { ...rookie, draftClass: rookie.draftClass - SQUAD_SEASONS - 1 }), false);
  const fantasy = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 3, draftType: 'snake' });
  assert.equal(squadOn(fantasy), false);
  assert.equal(squadEligible(fantasy, rookie), false);
});

test('sending a man down frees his slot, keeps him yours, and drops him to the minimum', () => {
  const lg = pro(42, 1);
  // The league's own index: a generated player is not in the shipped one.
  const ix = view(lg).byId;
  const idx = lg.teams.findIndex((t, i) => ROSTER_SLOTS.some((s) => {
    const id = t.slots[s.id];
    return id && canStash(lg, i, id, ix);
  }));
  assert.ok(idx >= 0, 'no club had anybody eligible to send down');
  const team = lg.teams[idx];
  const slot = ROSTER_SLOTS.find((s) => team.slots[s.id] && canStash(lg, idx, team.slots[s.id], ix));
  const id = team.slots[slot.id];
  // He is on a real contract, and that is the point of the minimum while down.
  lg.contracts[id] = { salary: 18, years: 3, kept: 0, since: lg.season };
  const before = capHit(lg, idx);
  stash(lg, idx, id, ix);
  assert.equal(team.slots[slot.id], null, 'his slot did not open');
  assert.ok(squadList(team).includes(id));
  assert.equal(ownerMap(lg).get(id), idx, 'he stopped being anybody’s player');
  assert.equal(capHit(lg, idx), before - 18 + MIN_SALARY, 'he should cost the minimum while he is down');
  // And he is not on the market for anyone else.
  const { pool } = view(lg);
  assert.equal(freeAgents(lg, pool).some((p) => p.id === id), false);
  // His deal is untouched, so he costs what it says again the day he comes up.
  assert.equal(lg.contracts[id].salary, 18);
  promote(lg, idx, id, null, ix);
  assert.equal(team.slots[slot.id], id, 'he did not go back into an open slot');
  assert.equal(capHit(lg, idx), before);
});

test('the squad has a size, and it is enforced', () => {
  const lg = pro(43, 2);
  const ix = view(lg).byId;
  const idx = 0, team = lg.teams[idx];
  assert.equal(squadCapacity(lg), SQUAD_SLOTS);
  const eligible = ROSTER_SLOTS.map((s) => team.slots[s.id]).filter((id) => id && canStash(lg, idx, id, ix));
  const room = squadCapacity(lg) - squadList(team).length;
  for (const id of eligible.slice(0, room)) stash(lg, idx, id, ix);
  if (eligible.length > room) {
    assert.match(squadBlocker(lg, idx, eligible[room], ix) || '', /places on the practice squad/);
    assert.throws(() => stash(lg, idx, eligible[room], ix), /places on the practice squad/);
  }
  assert.ok(squadList(team).length <= squadCapacity(lg));
});

test('a man who outgrows the squad comes up or goes, and never just sits there', () => {
  // The seed is searched, not pinned. Whether a club happens to hold anybody
  // young enough to send down depends on who the draft gave it, so a fixed seed
  // is a coin flip that happened to land -- 44 stopped producing one the moment
  // linebacker ratings changed, and the test failed on an empty roster rather
  // than on anything to do with outgrowing the squad.
  let lg = null, ix = null, idx = 0, team = null, slot = null;
  for (let seed = 44; seed < 120 && !slot; seed++) {
    lg = pro(seed, 1);
    ix = view(lg).byId;
    team = lg.teams[idx];
    slot = ROSTER_SLOTS.find((s) => team.slots[s.id] && canStash(lg, idx, team.slots[s.id], ix));
  }
  assert.ok(slot, 'no seed in the search range had anybody eligible to send down');
  const id = team.slots[slot.id];
  stash(lg, idx, id, ix);
  assert.ok(squadList(team).includes(id));
  // Wind the clock past his eligibility and settle the squad.
  lg.season += SQUAD_SEASONS + 1;
  agedOutOfSquad(lg, ix);
  assert.equal(squadList(team).includes(id), false, 'he was left on the squad after ageing out');
  // He either took the open slot he vacated or left the club; either is fine,
  // what is not fine is sitting there for ever.
  const onRoster = ROSTER_SLOTS.some((s) => team.slots[s.id] === id);
  assert.ok(onRoster || !ownerMap(lg).has(id));
});

test('a practice squad travels in a share code and the league keeps its shape', async () => {
  const lg = pro(45, 3);
  const held = lg.teams.reduce((n, t) => n + squadList(t).length, 0);
  assert.ok(held > 0, 'no club had used its squad, so there is nothing to test');
  const { pool, byId: idx } = view(lg);
  const code = await encodeLeagueCode(lg, leaguePool(lg, PLAYERS));
  const copy = leagueFromSnapshot(await decodeLeagueCode(code), PLAYERS, byId);
  assert.deepEqual(copy.teams.map((t) => squadList(t)), lg.teams.map((t) => squadList(t)), 'the squads did not travel');
  // And the recipient agrees about who is available, which is what would break
  // if a squad man arrived unowned.
  const mine = freeAgents(lg, pool).map((p) => p.id).sort();
  const theirs = freeAgents(copy, applyCareers(copy, leaguePool(copy, PLAYERS))).map((p) => p.id).sort();
  assert.deepEqual(theirs, mine);
  assert.ok(rostersValid(copy, careerIndex(copy, leagueIndex(copy, byId))).ok);
  void idx;
});

test('a squad man ages and develops, because that is what he is down there for', () => {
  const lg = pro(46, 2);
  const onSquad = lg.teams.flatMap((t) => squadList(t));
  assert.ok(onSquad.length > 0, 'nobody is on a squad to check');
  // `league.dev` is the career ledger, and only players a club holds are in it.
  for (const id of onSquad) assert.ok(lg.dev?.[id], `${id} is on a squad but has no career running`);
});
