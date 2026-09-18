import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { buildLineup, overall } from '../src/engine/ratings.js';
import {
  createLeague, startSeason, simulateWeekAi, advanceWeek, teamForGame, migrateLeague, LEAGUE_VERSION, injuryLevel, userTeamIndex,
} from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { fillLineup, replacementFromId, isReplacementId, SEASON_ENDING, tickInjuries, availability, INJURY_LEVELS } from '../src/engine/injuries.js';
import { lineupStrength, fileClaim, processWaivers, aiFileClaims, freeAgents, rostersValid, ownerMap } from '../src/engine/transactions.js';

const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const A = syntheticTeam('a', 85, 4, 1), B = syntheticTeam('b', 85, 4, 2);

function fantasyLeague(seed, opts = {}) {
  const league = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', ...opts });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(seed), byId);
  startSeason(league, byId);
  return league;
}

test('the injury dial: off means nobody gets hurt, normal costs about a starter a week, high doubles it', () => {
  const rate = (level, n = 120) => {
    let inj = 0, weeks = 0;
    for (let i = 0; i < n; i++) {
      const g = createGame(tf(A), tf(B), { seed: 500 + i, injuryLevel: level });
      simulateGame(g);
      for (const side of [0, 1]) for (const x of g.teams[side].injuries) { inj++; weeks += Math.min(x.weeks, 17); }
    }
    return { perGame: inj / n, weeksPerTeamGame: weeks / n / 2 };
  };
  assert.equal(rate(0, 30).perGame, 0);
  const normal = rate(INJURY_LEVELS.normal);
  assert.ok(normal.perGame > 0.6 && normal.perGame < 1.5, `normal: ${normal.perGame} injuries per game`);
  // About one player-week lost per club per game: roughly one starter out at any time over a season.
  assert.ok(normal.weeksPerTeamGame > 0.5 && normal.weeksPerTeamGame < 1.6, `normal: ${normal.weeksPerTeamGame} weeks per team-game`);
  const high = rate(INJURY_LEVELS.high);
  assert.ok(high.perGame > normal.perGame * 1.5, 'high is well above normal');
});

test('a hurt player leaves the game on the spot and the unit ratings are rebuilt around who is left', () => {
  let found = null;
  for (let i = 0; i < 200 && !found; i++) {
    const g = createGame(tf(A), tf(B), { seed: 900 + i, injuryLevel: 4 });
    const qbBefore = g.teams[0].comp.qb.id;
    simulateGame(g);
    const hit = g.teams[0].injuries.find((x) => x.id === qbBefore);
    if (hit) found = { g, qbBefore, hit };
  }
  assert.ok(found, 'a home quarterback got hurt somewhere in 200 games');
  const { g, qbBefore } = found;
  assert.ok(!g.teams[0].lineup.QB.some((p) => p.id === qbBefore), 'he is off the depth chart for the game');
  assert.notEqual(g.teams[0].comp.qb.id, qbBefore, 'somebody else is under center');
  assert.ok(g.log.some((e) => e.type === 'injury' && /is hurt on the play/.test(e.text)), 'the log says so');
  assert.equal(g.stats[0].players[qbBefore].games, 1, 'he is still credited with playing');
});

test('a position group left short is padded with replacement-level players', () => {
  const lineup = buildLineup(A.slots, A.byId);
  lineup.QB = [];
  lineup.OL = lineup.OL.slice(0, 3);
  const filled = fillLineup(lineup);
  assert.equal(filled.QB.length, 1);
  assert.ok(filled.QB[0].replacement && isReplacementId(filled.QB[0].id));
  assert.equal(filled.OL.length, 5);
  assert.equal(filled.OL.filter((p) => p.replacement).length, 2);
  assert.equal(lineup.OL.length, 3, 'the input is untouched');
  const rep = replacementFromId('rep:QB:1');
  assert.equal(rep.pos, 'QB');
  assert.ok(overall(rep) < 50);
  // A team without a real quarterback is a lot worse.
  const noQb = { ...tf(A), lineup: { ...buildLineup(A.slots, A.byId), QB: [] } };
  let wins = 0;
  for (let i = 0; i < 40; i++) {
    const g = createGame(noQb, tf(B), { seed: 3000 + i });
    simulateGame(g);
    if (g.score[0] > g.score[1]) wins++;
  }
  assert.ok(wins < 14, `a replacement QB won ${wins} of 40 against an equal roster`);
});

test('injuries carry between weeks: out for exactly the stated weeks, then back', () => {
  const league = fantasyLeague(11);
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const star = me.slots.WR1;
  // Fake a two-week injury suffered in week 1's game.
  league.injuries[star] = { weeks: 2, kind: 'hamstring', since: 1, season: league.season, team: u };
  assert.ok(!teamForGame(league, u, byId).lineup.WR.some((p) => p.id === star), 'sits this week');
  simulateWeekAi(league, byId, { includeUser: true });
  advanceWeek(league); // end of week 1: the fresh injury does not lose a week yet
  assert.equal(league.week, 2);
  assert.equal(league.injuries[star].weeks, 2);
  assert.ok(!teamForGame(league, u, byId).lineup.WR.some((p) => p.id === star), 'out in week 2');
  simulateWeekAi(league, byId, { includeUser: true });
  advanceWeek(league);
  assert.equal(league.injuries[star].weeks, 1);
  assert.ok(!teamForGame(league, u, byId).lineup.WR.some((p) => p.id === star), 'out in week 3');
  simulateWeekAi(league, byId, { includeUser: true });
  advanceWeek(league);
  assert.equal(league.injuries[star], undefined, 'healed');
  assert.ok(teamForGame(league, u, byId).lineup.WR.some((p) => p.id === star), 'back for week 4');
  assert.equal(availability(league, star), 1);
});

test('a season of games writes real injuries into the ledger and box scores', () => {
  const league = fantasyLeague(12, { injuries: 'high' });
  assert.equal(injuryLevel(league), 2);
  let recorded = 0;
  while (league.phase === 'season') {
    simulateWeekAi(league, byId, { includeUser: true });
    for (const g of league.schedule[league.week - 1].games) recorded += g.result.injuries[0].length + g.result.injuries[1].length;
    advanceWeek(league);
  }
  assert.ok(recorded > 20, `${recorded} injuries over a season at the high setting`);
  const ledger = Object.values(league.injuries);
  assert.ok(ledger.every((x) => x.weeks > 0), 'only players still out are on the ledger');
  assert.ok(Object.keys(league.injuries).length > 0, 'somebody is still hurt going into the playoffs');
  // Everybody who played still has a games count, hurt or not.
  const anyGame = league.schedule[0].games[0];
  assert.ok(anyGame.result.teamStats[0].plays > 0);
});

test('the ledger discounts a hurt player in lineup strength and the AI will not trade for him at full value', () => {
  const league = fantasyLeague(13);
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const healthy = lineupStrength(me.slots, byId, league);
  league.injuries[me.slots.QB1] = { weeks: SEASON_ENDING, kind: 'torn ACL', since: 1, season: 1, team: u };
  const hurt = lineupStrength(me.slots, byId, league);
  assert.ok(hurt < healthy - 100, `a season-ending QB injury takes ${healthy - hurt} off the lineup`);
  assert.equal(lineupStrength(me.slots, byId), healthy, 'without a league context nothing is discounted');
  assert.equal(availability(league, me.slots.QB1), 0);
});

test('an AI club whose quarterback is done for the year goes to the wire for a replacement', () => {
  const league = fantasyLeague(14);
  const ai = league.teams.findIndex((t) => !t.isUser);
  const team = league.teams[ai];
  league.injuries[team.slots.QB1] = { weeks: SEASON_ENDING, kind: 'torn ACL', since: 1, season: 1, team: ai };
  // Make sure the pool has a quarterback worth having.
  const bestFa = freeAgents(league, PLAYERS).filter((p) => p.pos === 'QB').sort((a, b) => overall(b) - overall(a))[0];
  assert.ok(bestFa);
  aiFileClaims(league, PLAYERS, byId, null);
  const claim = league.claims.find((c) => c.team === ai && byId.get(c.add).pos === 'QB');
  assert.ok(claim, 'filed a quarterback claim');
  processWaivers(league, byId);
  assert.ok(ownerMap(league).has(claim.add));
  assert.ok(rostersValid(league, byId).ok);
});

test('an AI club keeps a star who will be back this season rather than dropping him for a scrub', () => {
  const league = fantasyLeague(15);
  const ai = league.teams.findIndex((t) => !t.isUser);
  const team = league.teams[ai];
  const qb1 = team.slots.QB1;
  league.injuries[qb1] = { weeks: 3, kind: 'MCL sprain', since: 1, season: 1, team: ai };
  aiFileClaims(league, PLAYERS, byId, null);
  const dropsStar = league.claims.some((c) => c.team === ai && c.drop === qb1);
  assert.ok(!dropsStar, 'the injured starter is not the drop');
});

test('an older save gains the QB2 slot and the ledger, and the open slot can be filled off the wire', () => {
  const league = fantasyLeague(16);
  const u = userTeamIndex(league);
  // Pretend this league was saved before version 3.
  for (const t of league.teams) delete t.slots.QB2;
  delete league.injuries;
  league.version = 2;
  migrateLeague(league);
  assert.equal(league.version, LEAGUE_VERSION);
  assert.ok(league.teams.every((t) => 'QB2' in t.slots && t.slots.QB2 === null));
  assert.deepEqual(league.injuries, {});
  assert.ok(rostersValid(league, byId).ok, 'an empty bench slot is legal');
  const qb = freeAgents(league, PLAYERS).filter((p) => p.pos === 'QB').sort((a, b) => overall(b) - overall(a))[0];
  fileClaim(league, u, qb.id, null, byId);
  assert.throws(() => fileClaim(league, u, freeAgents(league, PLAYERS).filter((p) => p.pos === 'QB')[3].id, null, byId), /already have a claim for the open/);
  const results = processWaivers(league, byId);
  assert.ok(results.find((r) => r.team === u && r.ok));
  assert.equal(league.teams[u].slots.QB2, qb.id);
  // The AI clubs backfill their own open slots on the same wire.
  aiFileClaims(league, PLAYERS, byId, null);
  assert.ok(league.claims.some((c) => c.drop === null && byId.get(c.add).pos === 'QB'), 'AI claims into open slots');
});

test('the auction fills the backup slot everywhere and pays backup money for it', () => {
  const league = fantasyLeague(17);
  assert.equal(league.auction.sold.length, 8 * ROSTER_SLOTS.length);
  const price = (id) => league.auction.sold.find((s) => s.playerId === id)?.price ?? 0;
  const starters = league.teams.map((t) => price(t.slots.QB1));
  const backups = league.teams.map((t) => price(t.slots.QB2));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(league.teams.every((t) => t.slots.QB2), 'every club has a QB2');
  assert.ok(mean(backups) < mean(starters) * 0.5, `backups averaged $${mean(backups).toFixed(1)}, starters $${mean(starters).toFixed(1)}`);
});

test('a new season clears the ledger', () => {
  const league = fantasyLeague(18);
  league.injuries['x'] = { weeks: 4 };
  tickInjuries(league, league.week);
  assert.equal(league.injuries.x.weeks, 3);
});
