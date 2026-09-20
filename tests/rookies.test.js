import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS, POSITIONS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { overall } from '../src/engine/ratings.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { autoDraftAll, TOTAL_ROUNDS } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { enterOffseason, aiKeepers, confirmKeepers } from '../src/engine/offseason.js';
import { rostersValid, ownerMap, freeAgents } from '../src/engine/transactions.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { rookieClass, proDraftRounds } from '../src/engine/proleague.js';
import { encodeLeagueCode, decodeLeagueCode, leagueFromSnapshot, poolFingerprint } from '../src/engine/share.js';
import {
  addRookieClass, generateRookies, classSize, classPositions, rollOverall, leaguePool, leagueIndex,
  BASE_YEAR, WASHOUT_SEASONS,
} from '../src/engine/rookies.js';
import { FIRST_NAMES, LAST_NAMES, NAME_COMBINATIONS } from '../src/data/rookie-names.js';

registerPlayers(byId);
const blankLeague = (seed, teams = 8) => ({ seed, season: 1, teams: Array.from({ length: teams }, () => ({ slots: {}, ir: [] })), rookies: [] });

function league(seed, opts = {}) {
  const lg = createLeague({ name: 'R', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'off', ...opts });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  return lg;
}

test('the name lists are large, unique and combine into hundreds of thousands of names', () => {
  assert.equal(new Set(FIRST_NAMES).size, FIRST_NAMES.length);
  assert.equal(new Set(LAST_NAMES).size, LAST_NAMES.length);
  assert.ok(FIRST_NAMES.length >= 400 && LAST_NAMES.length >= 700);
  assert.ok(NAME_COMBINATIONS > 300000, `${NAME_COMBINATIONS} combinations`);
  const real = new Set(PLAYERS.map((p) => p.name));
  const lg = blankLeague(1);
  const cls = generateRookies(lg, new RNG(1), { season: 1 });
  const clash = cls.filter((p) => real.has(p.name));
  assert.ok(clash.length <= 1, `${clash.length} rookies share a name with a real player`);
});

test('a class is position-balanced, fully formed and spread from scrub to star', () => {
  const lg = blankLeague(2);
  const cls = generateRookies(lg, new RNG(2), { season: 1 });
  assert.equal(cls.length, classSize(lg));
  assert.equal(new Set(cls.map((p) => p.id)).size, cls.length, 'ids are unique');
  for (const p of cls) {
    assert.ok(p.generated, 'marked as generated');
    assert.equal(p.season, BASE_YEAR);
    assert.equal(p.team, 'RK');
    assert.ok(p.name.includes(' '));
    const want = [...POSITIONS[p.pos].attrs].sort();
    assert.deepEqual(Object.keys(p.r).sort(), want, `${p.pos} attributes`);
    for (const v of Object.values(p.r)) assert.ok(Number.isInteger(v) && v >= 40 && v <= 99, `rating ${v}`);
    assert.ok(overall(p) >= 40 && overall(p) <= 99);
  }
  // Every position group is represented.
  const byPos = new Set(cls.map((p) => p.pos));
  for (const pos of Object.keys(POSITIONS)) assert.ok(byPos.has(pos), `no ${pos} in the class`);
  assert.equal(classPositions(27).length, 27);
});

test('the talent spread has a real median and a thin top', () => {
  const rng = new RNG(5);
  const all = [];
  for (let i = 0; i < 60; i++) all.push(...generateRookies(blankLeague(100 + i), rng, { season: 1 }));
  const ovr = all.map(overall).sort((a, b) => b - a);
  const share = (f) => ovr.filter(f).length / ovr.length;
  const median = ovr[Math.floor(ovr.length / 2)];
  assert.ok(median >= 58 && median <= 66, `median ${median}`);
  assert.ok(share((o) => o >= 80) > 0.01 && share((o) => o >= 80) < 0.09, `${(100 * share((o) => o >= 80)).toFixed(1)}% at 80+`);
  assert.ok(share((o) => o >= 90) < 0.03, `${(100 * share((o) => o >= 90)).toFixed(1)}% at 90+`);
  assert.ok(share((o) => o < 60) > 0.2, 'plenty of players who should not be starting');
  // Every class brings somebody worth a look.
  assert.ok(ovr[0] >= 90, `best rookie across sixty classes was ${ovr[0]}`);
  const r = new RNG(11);
  for (let i = 0; i < 200; i++) { const v = rollOverall(r); assert.ok(v >= 40 && v <= 99); }
});

test('classes arrive each offseason, unsigned rookies wash out, signed ones stay', () => {
  const lg = blankLeague(3);
  const rng = new RNG(3);
  const first = addRookieClass(lg, rng, { season: 1 });
  assert.equal(lg.rookies.length, first.arrived.length);
  assert.equal(lg.rookieClasses[1], first.arrived.length);
  // Sign one from the first class, then run the years forward.
  const keeper = lg.rookies[0];
  lg.teams[0].slots.QB1 = keeper.id;
  const sizes = [lg.rookies.length];
  for (let season = 2; season <= 6; season++) { lg.season = season; addRookieClass(lg, rng, { season }); sizes.push(lg.rookies.length); }
  assert.ok(lg.rookies.some((p) => p.id === keeper.id), 'a rostered rookie is never washed out');
  // The pool stops growing once the washout catches up.
  const per = classSize(lg);
  assert.ok(lg.rookies.length <= per * (WASHOUT_SEASONS + 1) + 1, `${lg.rookies.length} rookies after six classes`);
  assert.ok(sizes[sizes.length - 1] > sizes[0], 'it does grow at first');
});

test('rookies join the playable pool, can be signed, and never leak between leagues', () => {
  const a = league(4), b = league(5);
  const rng = new RNG(4);
  addRookieClass(a, rng, { season: 2 });
  const poolA = leaguePool(a, PLAYERS), poolB = leaguePool(b, PLAYERS);
  assert.equal(poolA.length, PLAYERS.length + a.rookies.length);
  assert.equal(poolB.length, PLAYERS.length, 'a league without rookies sees the shipped pool');
  const idxA = leagueIndex(a, byId);
  assert.equal(idxA.size, byId.size + a.rookies.length);
  assert.equal(leagueIndex(b, byId), byId, 'no copy is made when there is nothing to add');
  for (const p of a.rookies) assert.equal(poolB.some((x) => x.id === p.id), false, 'league A rookies are invisible to league B');
  // A rookie is a free agent and can be claimed like anyone else.
  const u = userTeamIndex(a);
  const best = a.rookies.filter((p) => p.pos === 'WR').sort((x, y) => overall(y) - overall(x))[0];
  assert.ok(best, 'the class has a receiver');
  assert.ok(freeAgents(a, poolA).some((p) => p.id === best.id));
  a.teams[u].slots.WR4 = best.id;
  assert.equal(ownerMap(a).get(best.id), u);
  assert.ok(rostersValid(a, idxA).ok, rostersValid(a, idxA).reason);
});

test('the shipped pool fingerprint ignores rookies, so league codes still open', async () => {
  const lg = league(6);
  addRookieClass(lg, new RNG(6), { season: 2 });
  assert.equal(poolFingerprint(leaguePool(lg, PLAYERS)), poolFingerprint(PLAYERS), 'rookies do not move the fingerprint');
  // Sign a rookie, then share the league: he travels with the code.
  const u = userTeamIndex(lg);
  const rookie = lg.rookies.filter((p) => p.pos === 'WR').sort((x, y) => overall(y) - overall(x))[0];
  lg.teams[u].slots.WR4 = rookie.id;
  lg.contracts[rookie.id] = { salary: 4, kept: 0, since: 1 };
  const code = await encodeLeagueCode(lg, leaguePool(lg, PLAYERS));
  const copy = leagueFromSnapshot(await decodeLeagueCode(code), PLAYERS, byId);
  assert.equal(copy.rookies.length, lg.rookies.length, 'the class came along');
  assert.equal(copy.teams[u].slots.WR4, rookie.id, 'and he is still on the roster');
  assert.deepEqual(copy.rookies.find((p) => p.id === rookie.id).r, rookie.r, 'with his ratings intact');
  assert.equal(copy.contracts[rookie.id].salary, 4);
  assert.ok(rostersValid(copy, leagueIndex(copy, byId)).ok);
});

test('a dynasty runs through several offseasons with classes arriving and rosters staying valid', () => {
  const lg = league(7, { injuries: 'normal' });
  const pool = () => leaguePool(lg, PLAYERS);
  const index = () => leagueIndex(lg, byId);
  for (let i = 0; i < 4; i++) simulateAhead(lg, index(), pool(), new RNG(20 + i), 'nextSeason');
  assert.equal(lg.season, 5);
  assert.ok(lg.rookies.length > 0, 'classes arrived');
  assert.deepEqual(Object.keys(lg.rookieClasses).map(Number).sort((a, b) => a - b), [2, 3, 4, 5]);
  const idx = index();
  assert.ok(rostersValid(lg, idx).ok, rostersValid(lg, idx).reason);
  // Every owned player, rookie or not, resolves in the league's index.
  for (const id of ownerMap(lg).keys()) assert.ok(idx.get(id), `unknown player ${id} on a roster`);
  void enterOffseason; void aiKeepers; void confirmKeepers; void ROSTER_SLOTS;
});

test('a pro draft is the rookie class and nothing else, and free agency is everyone else', () => {
  // This used to measure the opposite thing, and it was right for the league
  // it was written against: a pro draft ran over the whole all-time pool, so a
  // rookie had to beat Rod Woodson to be picked and only a standout ever was.
  // Measured then, the second-season draft made 102 picks and nine of them
  // were rookies. Now the draft is the class and the market is everybody else.
  const pro = createLeague({ name: 'P', mode: 'pro', franchise: 1, seed: 22, draftType: 'snake', injuries: 'normal' });
  autoDraftAll(pro, pro.draft, PLAYERS, new RNG(22));
  // The founding draft is the all-time pool: that is how a pro league is populated.
  assert.ok(pro.draft.picks.every((p) => !String(p.playerId).startsWith('rk-')), 'season one drafted a rookie');
  assert.equal(pro.draft.eligible, null, 'the founding draft has no eligibility list');
  startSeason(pro, byId);
  simulateAhead(pro, careerIndex(pro, leagueIndex(pro, byId)), applyCareers(pro, leaguePool(pro, PLAYERS)), new RNG(40), 'nextSeason');

  const cls = rookieClass(pro);
  const clsIds = new Set(cls.map((p) => p.id));
  assert.ok(cls.length > 100, `the class is ${cls.length}`);
  // Every pick, without exception, is a member of this year's class.
  assert.ok(pro.draft.picks.length > 0, 'the draft made no picks');
  for (const pick of pro.draft.picks) assert.ok(clsIds.has(pick.playerId), `${pick.playerId} was drafted but is not in the class`);
  assert.equal(pro.draft.rounds, proDraftRounds(pro));
  assert.ok(pro.draft.rounds < TOTAL_ROUNDS, 'a rookie draft is shorter than a roster');

  // And the market is the other half of the split: veterans, never a draftee.
  const pool = applyCareers(pro, leaguePool(pro, PLAYERS));
  const fa = freeAgents(pro, pool);
  assert.equal(fa.filter((p) => clsIds.has(p.id)).length, 0, 'this year\u2019s rookies are on the market as well as in the draft');
  assert.ok(fa.some((p) => !p.generated), 'no veterans on the market at all');
  assert.ok(rostersValid(pro, careerIndex(pro, leagueIndex(pro, byId))).ok);
});

test('a shared pro league keeps the men it has shown the door', async () => {
  // Without this the code hands a friend four hundred all-time players back on
  // the free-agent market and restarts the drain, which is a different league
  // from the one being shared.
  const pro = createLeague({ name: 'P', mode: 'pro', franchise: 1, seed: 22, draftType: 'snake', injuries: 'normal' });
  autoDraftAll(pro, pro.draft, PLAYERS, new RNG(22));
  startSeason(pro, byId);
  for (let i = 0; i < 3; i++) {
    simulateAhead(pro, careerIndex(pro, leagueIndex(pro, byId)), applyCareers(pro, leaguePool(pro, PLAYERS)), new RNG(40 + i), 'nextSeason');
  }
  assert.ok((pro.departed || []).length > 50, `only ${(pro.departed || []).length} have left`);
  assert.ok(Object.keys(pro.drain || {}).length > 0, 'nobody is on the clock to leave');

  const code = await encodeLeagueCode(pro, leaguePool(pro, PLAYERS));
  const copy = leagueFromSnapshot(await decodeLeagueCode(code), PLAYERS, byId);
  assert.deepEqual(new Set(copy.departed), new Set(pro.departed), 'the departed did not travel');
  assert.deepEqual(copy.drain, pro.drain, 'the drain schedule did not travel');
  // And the restored league agrees about who can be signed.
  const mine = freeAgents(pro, applyCareers(pro, leaguePool(pro, PLAYERS))).map((p) => p.id).sort();
  const theirs = freeAgents(copy, applyCareers(copy, leaguePool(copy, PLAYERS))).map((p) => p.id).sort();
  assert.deepEqual(theirs, mine, 'the two leagues disagree about who is a free agent');
  assert.ok(rostersValid(copy, careerIndex(copy, leagueIndex(copy, byId))).ok);
});

test('the undrafted all-timers leave, and the draft becomes the best talent in the league', () => {
  // The point of the split. While four hundred all-time players sit unsigned,
  // a draft pick is worth less than a phone call, so they have to go. Measured
  // over this run the all-time share of the market falls 496, 445, 356, 279,
  // 150, 109, 75 — and from about there the class outrates what is left.
  const pro = createLeague({ name: 'P', mode: 'pro', franchise: 1, seed: 22, draftType: 'snake', injuries: 'normal' });
  autoDraftAll(pro, pro.draft, PLAYERS, new RNG(22));
  startSeason(pro, byId);
  const ovr = (list) => list.map((p) => overall(p)).sort((a, b) => b - a);
  let first = null, last = null;
  for (let i = 0; i < 7; i++) {
    simulateAhead(pro, careerIndex(pro, leagueIndex(pro, byId)), applyCareers(pro, leaguePool(pro, PLAYERS)), new RNG(40 + i), 'nextSeason');
    const idx = careerIndex(pro, leagueIndex(pro, byId));
    const pool = applyCareers(pro, leaguePool(pro, PLAYERS));
    // Nobody ever starts a season a man short. This is the invariant the drain
    // is most likely to break, so it is checked every year rather than at the end.
    const v = rostersValid(pro, idx);
    assert.ok(v.ok, `season ${pro.season}: ${v.reason}`);
    const fa = freeAgents(pro, pool);
    const allTime = fa.filter((p) => !p.generated).length;
    if (first == null) first = allTime;
    last = { allTime, best: ovr(fa)[0], classBest: ovr(rookieClass(pro).map((p) => idx.get(p.id) || p))[0] };
  }
  assert.ok(last.allTime < first * 0.3, `all-time free agents went ${first} to ${last.allTime}`);
  assert.ok(last.classBest > last.best,
    `the best free agent is ${last.best} and the best rookie ${last.classBest}: the draft is not the way to get better`);
  // Nobody signs a man who has retired.
  const retired = new Set(pro.retired || []);
  const onRosters = [...ownerMap(pro).keys()].filter((id) => retired.has(id));
  assert.equal(onRosters.length, 0, `${onRosters.length} retired players are on rosters`);
});
