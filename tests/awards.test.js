import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { seasonAwards, updateRecords, hallOfFame, hallScore, closeSeasonBooks, HOF_THRESHOLD, MVP_QB_OVER_RB } from '../src/engine/awards.js';
import { enterOffseason, aiKeepers, confirmKeepers } from '../src/engine/offseason.js';
import { fantasyPoints } from '../src/engine/stats.js';

registerPlayers(byId);

function playSeason(league) {
  while (league.phase === 'season' || league.phase === 'playoffs') { simulateWeekAi(league, byId, { includeUser: true }); advanceWeek(league); }
}
function auctionLeague(seed) {
  const league = createLeague({ name: 'A', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'off' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(seed), byId);
  startSeason(league, byId);
  return league;
}

test('the final hands out honours, and the MVP is scored against his position', () => {
  const league = auctionLeague(31);
  playSeason(league);
  const h = league.history[0];
  assert.ok(h.awards, 'honours recorded with the season');
  const { mvp, offensive, defensive, kicker, coach, allLeague, leaders } = h.awards;
  assert.ok(mvp && byId.get(mvp.id), 'an MVP');
  assert.ok(mvp.games >= 7, `the MVP played ${mvp.games} games`);
  assert.ok(['QB', 'RB', 'WR', 'TE'].includes(byId.get(offensive.id).pos));
  assert.ok(['DL', 'LB', 'CB', 'S'].includes(byId.get(defensive.id).pos));
  assert.equal(byId.get(kicker.id).pos, 'K');
  assert.ok(coach >= 0 && coach < 8);
  for (const [pos, n] of Object.entries({ QB: 1, RB: 1, WR: 3, TE: 1, DL: 4, LB: 3, CB: 2, S: 2, K: 1, P: 1 })) {
    assert.equal(allLeague[pos].length, n, `${pos} all-league`);
    for (const e of allLeague[pos]) assert.equal(byId.get(e.id).pos, pos);
  }
  // Leaders are the real maxima.
  const best = (get) => { let top = null; for (const t of league.teams) for (const [id, s] of Object.entries(t.seasonStats.players)) if (byId.get(id) && (!top || get(s) > top.v)) top = { id, v: get(s) }; return top; };
  assert.equal(leaders.passYds.value, best((s) => s.pass.yds).v);
  assert.equal(leaders.sacks.value, best((s) => s.def.sck).v);
  // The race view works mid-season too and ranks by the position-corrected score.
  const race = seasonAwards(league, byId).mvpRace;
  assert.ok(race.length === 5 && race[0].score >= race[1].score);
});

test('the MVP weighs a back the way voters do, not the way the position table does', () => {
  // Read straight, the position table gave backs 37 MVPs in 40 seasons when it
  // had them at 0.97 of a quarterback and none when it had them at 0.34
  // (awards.js). The race is scored on the award's own ratio instead, read back
  // here from the race's own scores, so pointing the award at the table fails.
  const league = auctionLeague(31);
  playSeason(league);
  const race = seasonAwards(league, byId).mvpRace;
  const qb = race.find((r) => byId.get(r.id).pos === 'QB');
  const rb = race.find((r) => byId.get(r.id).pos === 'RB');
  assert.ok(qb && rb, 'a quarterback and a back in the race');
  const perZ = (r) => r.score / r.z;
  assert.ok(Math.abs(perZ(qb) / perZ(rb) - MVP_QB_OVER_RB) < 0.03, `a quarterback's z counts ${(perZ(qb) / perZ(rb)).toFixed(2)} times a back's`);
  for (let i = 1; i < race.length; i++) assert.ok(race[i - 1].score >= race[i].score, 'ranked by the weighted score');
});

test('the record book keeps season, single-game and team marks', () => {
  const league = auctionLeague(32);
  playSeason(league);
  const R = league.records.players, T = league.records.teams;
  assert.ok(R.passYds && R.rushYds && R.recYds && R.sacks && R.fantasy, 'season marks');
  const maxPass = Math.max(...league.teams.flatMap((t) => Object.entries(t.seasonStats.players).filter(([id]) => byId.get(id)).map(([, s]) => s.pass.yds)));
  assert.equal(R.passYds.value, maxPass);
  assert.equal(R.fantasy.value, Math.max(...league.teams.flatMap((t) => Object.entries(t.seasonStats.players).filter(([id]) => byId.get(id)).map(([, s]) => fantasyPoints(s)))));
  assert.ok(R.gPassYds && R.gPassYds.vs != null, 'a single-game mark from a game with player lines');
  assert.ok(T.teamPoints.value >= T.teamMargin.value, 'a margin cannot exceed the points');
  assert.ok(T.teamWins.value >= 7 && T.teamWins.value <= 14);
  // A second season only replaces marks that were beaten.
  const before = { ...R.passYds };
  enterOffseason(league, PLAYERS, byId);
  confirmKeepers(league, aiKeepers(league, userTeamIndex(league), PLAYERS, byId, null), PLAYERS, byId);
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(2), byId);
  startSeason(league, byId);
  playSeason(league);
  assert.ok(league.records.players.passYds.value >= before.value);
  if (league.records.players.passYds.value === before.value) assert.equal(league.records.players.passYds.season, before.season);
  assert.equal(league.history.length, 2);
  assert.ok(league.history[1].awards.mvp);
});

test('careers accumulate across seasons and the hall of fame opens on the résumé score', () => {
  const league = auctionLeague(33);
  for (let season = 1; season <= 3; season++) {
    playSeason(league);
    if (season < 3) {
      enterOffseason(league, PLAYERS, byId);
      confirmKeepers(league, aiKeepers(league, userTeamIndex(league), PLAYERS, byId, null), PLAYERS, byId);
      autoCompleteAll(league.auction, league, PLAYERS, new RNG(season), byId);
      startSeason(league, byId);
    }
  }
  const careers = league.careers;
  const threeSeasons = Object.values(careers).filter((c) => c.seasons === 3);
  assert.ok(threeSeasons.length > 20, `${threeSeasons.length} players lasted three seasons`);
  const champs = Object.values(careers).filter((c) => c.titles > 0);
  assert.ok(champs.length >= 27, 'every member of a champion holds a title');
  const mvps = Object.values(careers).reduce((s, c) => s + c.mvp, 0);
  assert.equal(mvps, 3, 'one MVP a season');
  const { inducted, onTrack } = hallOfFame(league);
  assert.ok(onTrack.length > 0);
  for (const r of inducted) assert.ok(r.c.seasons >= 3 && r.score >= HOF_THRESHOLD);
  assert.ok(hallScore({ seasons: 3, mvp: 2, opoy: 1, dpoy: 0, allLeague: 3, leader: 2, titles: 1, pts: 900 }) >= HOF_THRESHOLD, 'a dominant three-year run gets in');
  assert.ok(hallScore({ seasons: 3, mvp: 0, opoy: 0, dpoy: 0, allLeague: 0, leader: 0, titles: 0, pts: 300 }) < HOF_THRESHOLD, 'three quiet seasons do not');
});

test('closing the books returns the season honours', () => {
  const league = auctionLeague(34);
  playSeason(league);
  const seasons = Object.values(league.careers).map((c) => c.seasons);
  assert.ok(seasons.every((n) => n === 1));
  const a = closeSeasonBooks(league, byId);
  assert.ok(a.mvp);
  void updateRecords;
});
