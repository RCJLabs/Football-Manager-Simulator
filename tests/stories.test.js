// Storylines for the human's next game (stories.js), and the stakes the odds
// reading splits out for it (odds.js). Each line is built here on a real
// league with the one fact it needs put in place, so a test fails on the
// wording a player would read, not on an intermediate number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex, userGameThisWeek } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { playoffOdds, refreshOdds, oddsKey, oddsPoints } from '../src/engine/odds.js';
import { storylines, STAKE_MIN_RUNS } from '../src/engine/stories.js';
import { overall } from '../src/engine/ratings.js';

registerPlayers(PLAYERS_BY_ID);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));

function league(mode, seed) {
  const lg = createLeague({ name: 'S', user: {}, seed, mode, numTeams: mode === 'pro' ? 32 : 8, franchise: mode === 'pro' ? 3 : 0, draftType: mode === 'pro' ? 'snake' : 'auction' });
  if (mode === 'pro') autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  else autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), PLAYERS_BY_ID);
  startSeason(lg, PLAYERS_BY_ID);
  simulateAhead(lg, index(lg), pool(lg), new RNG(seed + 1), 'halfway');
  return lg;
}
const PRO = league('pro', 31);
const FANTASY = league('fantasy', 32);
const copy = (lg) => JSON.parse(JSON.stringify(lg));

/** The league with only the human's season so far replaced by `list` of [opponent, us, them, week]. */
function withResults(lg, list) {
  const u = userTeamIndex(lg);
  lg.results = lg.results.filter((r) => r.home !== u && r.away !== u);
  for (const [opp, us, them, week] of list) lg.results.push({ season: lg.season, week, phase: 'season', home: u, away: opp, score: [us, them] });
  return lg;
}
function setting(lg) {
  const u = userTeamIndex(lg);
  const g = userGameThisWeek(lg);
  return { u, opp: g.home === u ? g.away : g.home, byId: index(lg) };
}
const texts = (lg, byId) => storylines(lg, byId, { limit: 9 }).map((x) => x.text);

test('the stakes split the same runs the reading already plays: they add back to the chance exactly', () => {
  const byId = index(PRO);
  const u = userTeamIndex(PRO);
  const o = playoffOdds(PRO, byId, { runs: 600 });
  assert.equal(o.stake.team, u);
  assert.equal(o.stake.runs.reduce((a, b) => a + b, 0), 600);
  assert.equal(o.stake.playoff.reduce((a, b) => a + b, 0), Math.round(o.playoff[u] * 600));
  // Played, the game is no longer at stake.
  const lg = copy(PRO);
  userGameThisWeek(lg).result = { score: [20, 10] };
  assert.equal(playoffOdds(lg, index(lg), { runs: 50 }).stake, undefined);
});

test('the stakes are said once both halves are big enough to say anything', () => {
  const lg = copy(PRO);
  const { u, byId } = setting(lg);
  const point = refreshOdds(lg, byId);
  const st = point.stake;
  const said = storylines(lg, byId, { limit: 9 }).find((x) => x.kind === 'stakes');
  const ifWon = st.playoff[0] / st.runs[0], ifLost = st.playoff[1] / st.runs[1];
  if (st.runs[0] >= STAKE_MIN_RUNS && st.runs[1] >= STAKE_MIN_RUNS && ifWon - ifLost >= 0.05) {
    assert.ok(said, 'a real swing went unsaid');
    assert.match(said.text, /^Playoff chance with a win: (\d+%|<1%|>99%)\. With a loss: (\d+%|<1%|>99%)\.$/);
  } else assert.equal(said, undefined);
  // Too few runs on one side: silent, rather than a percentage from a handful.
  const thin = oddsPoints(lg).find((p) => p.key === oddsKey(lg));
  thin.stake = { team: u, runs: [STAKE_MIN_RUNS - 1, 1000 - STAKE_MIN_RUNS + 1, 0], playoff: [90, 100, 0] };
  assert.equal(storylines(lg, byId, { limit: 9 }).find((x) => x.kind === 'stakes'), undefined);
  thin.stake = { team: u, runs: [500, 500, 0], playoff: [400, 150, 0] };
  assert.equal(storylines(lg, byId, { limit: 9 })[0].text, 'Playoff chance with a win: 80%. With a loss: 30%.', 'a big swing leads');
});

test('a rematch names the last meeting and, after more than one, who leads the season series', () => {
  const lg = copy(PRO);
  const { opp, byId } = setting(lg);
  withResults(lg, [[opp, 17, 24, 3]]);
  assert.ok(texts(lg, byId).includes('They beat you 24–17 in week 3.'));
  withResults(lg, [[opp, 30, 10, 2], [opp, 17, 24, 6]]);
  assert.ok(texts(lg, byId).includes('They beat you 24–17 in week 6; the season series is level at 1–1.'));
  withResults(lg, [[opp, 30, 10, 2], [opp, 27, 24, 6]]);
  assert.ok(texts(lg, byId).includes('You beat them 27–24 in week 6; you lead the season series 2–0.'));
});

test('a run of three or more is said, and a tie ends one', () => {
  const lg = copy(PRO);
  const { opp, byId } = setting(lg);
  const other = (opp + 1) % 32 === userTeamIndex(lg) ? (opp + 2) % 32 : (opp + 1) % 32;
  withResults(lg, [[other, 10, 20, 1], [other, 31, 3, 2], [other, 24, 17, 3], [other, 20, 13, 4], [other, 28, 27, 5]]);
  assert.ok(texts(lg, byId).includes('You have won 4 straight.'));
  withResults(lg, [[other, 31, 3, 2], [other, 24, 17, 3], [other, 20, 20, 4], [other, 10, 13, 5], [other, 7, 27, 6]]);
  assert.ok(!texts(lg, byId).some((t) => /^You have/.test(t)), 'two losses after a tie is not a run');
});

test('a round number or the record book within one game, in whole units and the right number', () => {
  const lg = copy(PRO);
  const { u, byId } = setting(lg);
  const me = lg.teams[u];
  // The first quarterback on the depth chart who is fit and has played; the
  // hurt sit out, and a man who sits out is not in reach of anything.
  const qbId = ['QB1', 'QB2'].map((k) => me.slots[k]).find((id) => id && !lg.injuries?.[id] && me.seasonStats.players[id]?.games > 0);
  const qb = byId.get(qbId);
  const line = me.seasonStats.players[qbId];
  line.pass.yds = 3850;
  line.pass.td = 12;
  assert.ok(texts(lg, byId).includes(`${qb.name} needs 150 passing yards for 4,000 this season.`));
  line.pass.yds = 3999;
  assert.ok(texts(lg, byId).includes(`${qb.name} needs 1 passing yard for 4,000 this season.`));
  // With a record on the books it is the record, which takes one more than the
  // gap. The book is written when a season ends, so its records are from
  // seasons before this one.
  const holder = PLAYERS.find((p) => p.pos === 'QB' && p.id !== qbId);
  const was = lg.season;
  lg.season += 1;
  for (const r of lg.results) r.season = lg.season;
  lg.records = { players: { passYds: { value: 4000, id: holder.id, team: 0, season: was } }, teams: {} };
  line.pass.yds = 3850;
  assert.ok(texts(lg, byId).includes(`${qb.name} needs 151 passing yards to break the league's season record of 4,000 (${holder.name}, season ${was}).`));
  lg.records.players.passYds.id = qbId;
  assert.ok(texts(lg, byId).includes(`${qb.name} needs 151 passing yards to break his own season record of 4,000 (season ${was}).`));
  line.pass.yds = 4100;
  assert.ok(texts(lg, byId).includes(`${qb.name} is past his own season record for passing yards, 4,000 (season ${was}), with 4,100 and counting.`));
  // Out of reach is silent.
  line.pass.yds = 2000;
  lg.records = null;
  assert.ok(!texts(lg, byId).some((t) => t.startsWith(qb.name)));
});

test('a trade between the two is said from either side; a pro club\'s former star on the other side is too, a fantasy one is not', () => {
  const lg = copy(PRO);
  const { u, opp, byId } = setting(lg);
  const them = lg.teams[opp], me = lg.teams[u];
  // A man of theirs, said to have come from us in week 3.
  const theirMan = Object.values(them.slots).find((id) => id && !lg.injuries?.[id]);
  lg.transactions.push({ type: 'trade', season: lg.season, week: 3, team: u, other: opp, gives: [theirMan], gets: [] });
  assert.ok(texts(lg, byId).includes(`You traded ${byId.get(theirMan).name} to them in week 3; he lines up against you.`));
  // And the other way round.
  lg.transactions.pop();
  const ourMan = Object.values(me.slots).find((id) => id && !lg.injuries?.[id]);
  lg.transactions.push({ type: 'trade', season: lg.season, week: 5, team: opp, other: u, gives: [ourMan], gets: [] });
  assert.ok(texts(lg, byId).includes(`${byId.get(ourMan).name} faces the club that traded him to you in week 5.`));
  lg.transactions.pop();
  // No trade: a man rated 85 or more who played for us this season, in a pro league.
  const star = Object.values(them.slots).filter((id) => id && !lg.injuries?.[id]).sort((a, b) => overall(byId.get(b)) - overall(byId.get(a)))[0];
  me.seasonStats.players[star] = { ...them.seasonStats.players[star], games: 3 };
  const said = texts(lg, byId).includes(`${byId.get(star).name}, who played for you, lines up for them.`);
  assert.equal(said, overall(byId.get(star)) >= 85);
  // In a fantasy league, where rosters are re-drafted every year, no.
  const f = copy(FANTASY);
  const fs = setting(f);
  const fStar = Object.values(f.teams[fs.opp].slots).find((id) => id && !f.injuries?.[id]);
  f.careers = { [fStar]: { teams: [fs.u] } };
  assert.ok(!storylines(f, fs.byId, { limit: 9 }).some((x) => x.kind === 'former'));
});

test('most notable first, as many as asked, the same every time, and nothing in the league moved', () => {
  const lg = copy(PRO);
  const { opp, byId } = setting(lg);
  refreshOdds(lg, byId);
  withResults(lg, [[opp, 17, 24, 3]]);
  const before = JSON.stringify(lg);
  const all = storylines(lg, byId, { limit: 9 });
  assert.equal(JSON.stringify(lg), before);
  assert.deepEqual(storylines(lg, byId, { limit: 9 }), all);
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].weight >= all[i].weight);
  assert.deepEqual(storylines(lg, byId), all.slice(0, 3));
  assert.deepEqual(storylines(lg, byId, { limit: 1 }), all.slice(0, 1));
});

test('no story once the game is played, on a bye, or outside the season', () => {
  const lg = copy(PRO);
  const { byId } = setting(lg);
  userGameThisWeek(lg).result = { score: [20, 10] };
  assert.deepEqual(storylines(lg, byId), []);
  const off = copy(PRO);
  off.phase = 'offseason';
  assert.deepEqual(storylines(off, byId), []);
  assert.deepEqual(storylines(null, byId), []);
});
