// The kickoff drain: from a pro league's second season, whoever nobody has
// signed by kickoff leaves the league, down to a floor of each position's
// worst men, who stay as cover for injuries. Just before it, the clubs take
// the leftovers who beat one of their starters by five, on the minimum — the
// computer clubs by rule, the human's club the men marked on the market's last
// screen — and nobody makes way for them who was drafted this year.
//
// Before it, a man passed over by the market sat on the waiver wire for the
// season being played, and the worst clubs claimed the leftovers on the
// minimum; a club's kickoff edge kept about a third of itself to the end of
// the regular season (DESIGN.md, "How even is the league, really").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead, simulateSteps } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { overall } from '../src/engine/ratings.js';
import { teamContractIds, letGo, MIN_SALARY } from '../src/engine/cap.js';
import { drainAtKickoff, drainFloor, signablePool, rookieClass, classYear } from '../src/engine/proleague.js';
import { kickoffUpgrades, kickoffChoices, markKickoffWant, upgradePlan, UPGRADE_MARGIN } from '../src/engine/freeagency.js';
import { canStash } from '../src/engine/squad.js';
import { encodeLeagueCode, decodeLeagueCode, leagueFromSnapshot } from '../src/engine/share.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';

registerPlayers(PLAYERS_BY_ID);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const held = (lg) => new Set(lg.teams.flatMap((_, i) => teamContractIds(lg, i)));
/** Everyone who could be signed right now and is not on a club. */
const unsigned = (lg) => { const h = held(lg); return signablePool(lg, pool(lg)).filter((p) => !h.has(p.id) && !p.retired); };

function founded(seed) {
  const lg = createLeague({ name: 'K', user: {}, seed, mode: 'pro', numTeams: 32, franchise: 3, draftType: 'snake', injuries: 'normal' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  return lg;
}

/** A founded league stepped to its second offseason's market: drafted, not yet kicked off. */
function atMarket(seed) {
  const lg = founded(seed);
  const run = simulateSteps(lg, index(lg), pool(lg), new RNG(seed * 7), 'nextSeason');
  let step = run.next();
  while (!step.done && step.value.stage !== 'market') step = run.next();
  return { lg, run };
}

/** Play a founded league into its second season, stopping either side of the kickoff. */
function secondKickoff(seed) {
  const { lg, run } = atMarket(seed);
  // The draft is done and the season not yet started: the market has had its go.
  const before = unsigned(lg);
  const departedBefore = new Set(lg.departed || []);
  const t0 = (lg.transactions || []).length;
  const { value: result } = run.next();
  return { lg, before, left: (lg.departed || []).filter((id) => !departedBefore.has(id)), kicked: lg.transactions.slice(t0), result };
}

/** Everyone else first and the human last, or the other way round. */
function humanAt(lg, where) {
  const u = lg.teams.findIndex((t) => t.isUser);
  const rest = lg.teams.map((_, i) => i).filter((i) => i !== u);
  lg.waiverOrder = where === 'first' ? [u, ...rest] : [...rest, u];
  return u;
}

const SECOND = secondKickoff(9400);

test('the opening season keeps its leftovers: they are the market that makes it an all-time league', () => {
  const lg = founded(9400);
  const byPos = {};
  for (const p of unsigned(lg)) byPos[p.pos] = (byPos[p.pos] || 0) + 1;
  assert.equal((lg.departed || []).length, 0);
  for (const pos of Object.keys(byPos)) assert.ok(byPos[pos] > drainFloor(lg, pos), `${pos}: only ${byPos[pos]} left after the founding draft`);
});

test('from the second season, nobody above the floor is left unsigned at kickoff, and the ones who stay are the worst', () => {
  const { lg, before, left } = SECOND;
  assert.equal(lg.phase, 'season');
  assert.equal(lg.season, 2);
  assert.ok(left.length > 100, `only ${left.length} left at kickoff`);
  const after = unsigned(lg);
  const gone = new Set(left);
  const byPos = {};
  for (const p of after) (byPos[p.pos] ??= []).push(overall(p));
  for (const [pos, ratings] of Object.entries(byPos)) {
    assert.ok(ratings.length <= drainFloor(lg, pos), `${ratings.length} ${pos} unsigned against a floor of ${drainFloor(lg, pos)}`);
    // Best first: every man the drain took at a position was at least as good
    // as every man it kept there.
    const took = before.filter((p) => p.pos === pos && gone.has(p.id)).map((p) => overall(p));
    if (took.length) assert.ok(Math.min(...took) >= Math.max(...ratings), `${pos}: kept a ${Math.max(...ratings)} and let a ${Math.min(...took)} go`);
  }
  // Every position is still covered.
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P']) assert.ok((byPos[pos] || []).length >= 3, `${pos} has no cover left`);
});

test('nobody a club holds leaves at kickoff, and this year\'s undrafted rookies wait for next year\'s market', () => {
  const { lg, left } = SECOND;
  const h = held(lg);
  for (const id of left) assert.ok(!h.has(id), `${id} left while on a club`);
  const rookies = new Set(rookieClass(lg).map((p) => p.id));
  assert.ok(rookies.size > 0);
  for (const id of left) assert.ok(!rookies.has(id), 'a rookie drained before he had a market');
});

test('a second drain at the same kickoff takes nobody', () => {
  const { lg } = SECOND;
  const again = drainAtKickoff(lg, held(lg), signablePool(lg, pool(lg)));
  assert.deepEqual(again, []);
});

test('the drain runs whichever way a season starts, and every club is full after it', () => {
  const lg = founded(9431);
  simulateAhead(lg, index(lg), pool(lg), new RNG(1), 'nextSeason');
  assert.equal(lg.season, 2);
  const byPos = {};
  for (const p of unsigned(lg)) byPos[p.pos] = (byPos[p.pos] || 0) + 1;
  for (const [pos, n] of Object.entries(byPos)) assert.ok(n <= drainFloor(lg, pos), `${n} ${pos} unsigned after a simulated offseason`);
  for (const t of lg.teams) for (const [slot, id] of Object.entries(t.slots)) assert.ok(id, `${t.abbr} kicked off without a ${slot}`);
});

test('before the drain, an AI club takes a leftover five better than a starter, on the minimum, and the human is left alone', () => {
  const lg = founded(9433);
  const run = simulateSteps(lg, index(lg), pool(lg), new RNG(9433 * 7), 'nextSeason');
  let step = run.next();
  while (!step.done && step.value.stage !== 'market') step = run.next();
  const byId = index(lg);
  const u = lg.teams.findIndex((t) => t.isUser);
  const before = lg.teams.map((t) => ({ ...t.slots }));
  const signed = kickoffUpgrades(lg, pool(lg), byId);
  assert.ok(signed.length > 0, 'nobody taken at kickoff');
  assert.deepEqual(lg.teams[u].slots, before[u], 'the human\'s roster was touched');
  const seen = new Set();
  lg.teams.forEach((t, ti) => {
    for (const [slot, id] of Object.entries(t.slots)) {
      if (!id) continue;
      assert.ok(!seen.has(id), `${id} on two rosters`);
      seen.add(id);
      const was = before[ti][slot];
      if (was === id) continue;
      const got = signed.find((x) => x.team === ti && x.add === id);
      if (!got) continue;
      // He beats the starter whose slot he took by the margin. A slot changes
      // hands at most once: the leftovers go best first, so the next one can
      // never beat the man just signed by five.
      assert.ok(overall(byId.get(id)) >= overall(byId.get(was)) + UPGRADE_MARGIN, `${id} took ${was}'s slot by less than the margin`);
      // And signs on the minimum for a year, as the fill signs anybody.
      assert.equal(lg.contracts[id].salary, MIN_SALARY);
      assert.equal(lg.contracts[id].years, 1);
    }
  });
  for (const x of signed) {
    const p = byId.get(x.add), gone = byId.get(x.drop);
    assert.ok(p && gone && p.pos === gone.pos, 'a man signed for another position');
  }
});

test('this year\'s draft class never makes way for a leftover, and still starts', () => {
  const { lg, kicked } = SECOND;
  const byId = index(lg);
  const fresh = (id) => { const p = byId.get(id); return !!p?.generated && p.draftClass === classYear(lg.season); };
  const moved = kicked.filter((t) => (t.type === 'fill' && t.drop) || t.type === 'release' || t.type === 'stash');
  assert.ok(kicked.some((t) => t.type === 'fill' && t.drop), 'nobody was taken at kickoff');
  for (const t of moved) assert.ok(!fresh(t.drop), `${t.drop}, drafted this year, made way at kickoff (${t.type})`);
  const ai = lg.teams.filter((t) => !t.isUser);
  const rookieStarters = ai.reduce((n, t) => n + ROSTER_SLOTS.filter((s) => s.starter && fresh(t.slots[s.id])).length, 0);
  assert.ok(rookieStarters >= ai.length, `only ${rookieStarters} of this year's rookies start for ${ai.length} clubs`);
});

test('the human\'s door: the leftovers on offer, each with his place, and a mark taken on the computer clubs\' terms', () => {
  const { lg } = atMarket(9435);
  const byId = index(lg);
  const u = humanAt(lg, 'first');
  const choices = kickoffChoices(lg, pool(lg), byId, u);
  assert.ok(choices.length > 0, 'no leftover beats a starter of the human club');
  for (const c of choices) {
    assert.deepEqual(c.plan, upgradePlan(lg, u, c.player, byId));
    assert.ok(overall(c.player) >= overall(byId.get(c.plan.starter)) + UPGRADE_MARGIN, `${c.player.name} is offered over a man he does not beat by the margin`);
    assert.equal(c.squad, canStash(lg, u, c.plan.release, byId));
    if (c.squad) assert.equal(c.dead, null, 'a man sent down was charged as if released');
  }
  const pick = choices[0];
  markKickoffWant(lg, pick.player.id);
  markKickoffWant(lg, pick.player.id, false);
  assert.equal(lg.kickoffWants, undefined, 'unmarking left a mark behind');
  markKickoffWant(lg, pick.player.id);
  const before = { ...lg.teams[u].slots };
  const signed = kickoffUpgrades(lg, pool(lg), byId);
  assert.equal(lg.kickoffWants, undefined, 'the mark outlived the kickoff');
  assert.deepEqual(signed.filter((x) => x.team === u).map((x) => x.add), [pick.player.id], 'the human club got other than what was marked');
  assert.equal(lg.teams[u].slots[pick.plan.slot], pick.player.id);
  assert.equal(lg.contracts[pick.player.id].salary, MIN_SALARY);
  assert.equal(lg.contracts[pick.player.id].years, 1);
  const named = new Set([pick.plan.slot, pick.plan.demote].filter(Boolean));
  for (const [slot, id] of Object.entries(before)) if (!named.has(slot)) assert.equal(lg.teams[u].slots[slot], id, `${slot} moved`);
});

test('a man marked by the human but taken by a club ahead in the order is passed over', () => {
  const { lg } = atMarket(9435);
  const byId = index(lg);
  const u = humanAt(lg, 'last');
  // Who the computer clubs take, all of them ahead of the human.
  const trial = JSON.parse(JSON.stringify(lg));
  const aiTook = new Set(kickoffUpgrades(trial, pool(trial), index(trial)).filter((x) => x.team !== u).map((x) => x.add));
  const wanted = kickoffChoices(lg, pool(lg), byId, u).find((c) => aiTook.has(c.player.id));
  assert.ok(wanted, 'no man the human could take is one a computer club takes first');
  markKickoffWant(lg, wanted.player.id);
  const signed = kickoffUpgrades(lg, pool(lg), byId);
  assert.ok(!signed.some((x) => x.team === u), 'the human club took a man signed ahead of it');
  assert.ok(signed.some((x) => x.team !== u && x.add === wanted.player.id));
  assert.equal(lg.kickoffWants, undefined);
});

test('with nothing marked the human club is left alone, and simulating through takes leftovers on the computer\'s rule and says so', () => {
  const { lg } = atMarket(9435);
  const byId = index(lg);
  const u = humanAt(lg, 'first');
  const before = { ...lg.teams[u].slots };
  const trial = JSON.parse(JSON.stringify(lg));
  kickoffUpgrades(lg, pool(lg), byId);
  assert.deepEqual(lg.teams[u].slots, before, 'the human club was touched with nothing marked');
  const staffed = kickoffUpgrades(trial, pool(trial), index(trial), { staff: true }).filter((x) => x.team === u);
  assert.ok(staffed.length > 0, 'the staff took nobody for the human club');
  const tByPos = index(trial);
  for (const x of staffed) assert.equal(tByPos.get(x.add).pos, tByPos.get(x.drop).pos);
  // And the simulator reports it.
  const { lg: sim, kicked, result } = SECOND;
  const mine = kicked.filter((t) => t.team === sim.teams.findIndex((tm) => tm.isUser) && t.type === 'fill' && t.drop).length;
  if (mine) assert.ok(result.decided.includes(`${mine} of the market's leftovers signed for you at kickoff`), result.decided.join('; '));
  else assert.ok(!result.decided.some((d) => d.includes('leftovers')));
});

test('a league opened from a code keeps the rosters and the wire it was coded with', async () => {
  const { lg } = secondKickoff(9437);
  const byId = index(lg);
  // A starting quarterback let go after kickoff and a journeyman signed in his
  // place: a man on the wire good enough that a kickoff would take him.
  const ti = lg.teams.findIndex((t) => !t.isUser);
  const slot = ROSTER_SLOTS.find((s) => s.pos === 'QB' && s.starter).id;
  const star = lg.teams[ti].slots[slot];
  const journeyman = unsigned(lg).filter((p) => p.pos === 'QB').sort((a, b) => overall(a) - overall(b))[0];
  assert.ok(journeyman, 'no quarterback on the wire');
  letGo(lg, ti, star);
  lg.teams[ti].slots[slot] = journeyman.id;
  lg.contracts[journeyman.id] = { salary: MIN_SALARY, years: 1, round: ROSTER_SLOTS.length, kept: 0, since: lg.season };
  assert.ok(lg.teams.some((_, i) => upgradePlan(lg, i, byId.get(star), byId)), 'the released man beats nobody, so the check checks nothing');
  const code = await encodeLeagueCode(lg, leaguePool(lg, PLAYERS));
  const copy = leagueFromSnapshot(await decodeLeagueCode(code), PLAYERS, PLAYERS_BY_ID);
  const held = (L) => L.teams.map((t) => Object.values(t.slots).filter(Boolean).sort());
  assert.deepEqual(held(copy), held(lg), 'opening the code changed the rosters');
  assert.ok(!(copy.departed || []).includes(star), 'opening the code retired a man on the wire');
});
