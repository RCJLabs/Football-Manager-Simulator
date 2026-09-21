import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { takeJob } from '../src/engine/offseason.js';
import { rostersValid } from '../src/engine/transactions.js';
import {
  jobsOn, initJobs, goalFor, judge, reviewSeason, vacancies, standardFor, makeOffers,
  acceptOffer, fillVacancies, coachOf, yourCoach, careerSummary, seatWarmth, retire,
  BASE_PATIENCE, REP_FLOOR, BASE_REP,
} from '../src/engine/jobs.js';

registerPlayers(PLAYERS_BY_ID);

function pro(seed, opts = {}) {
  const lg = createLeague({ name: 'P', mode: 'pro', numTeams: 32, franchise: 12, seed, draftType: 'snake', user: {}, injuries: 'normal', ...opts });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  return lg;
}
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));

test('coaching jobs are a pro-league thing only', () => {
  const small = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 1, draftType: 'auction' });
  assert.equal(small.settings.jobs, true, 'the setting exists everywhere');
  assert.equal(jobsOn(small), false, 'but an eight-club league has no job market');
  assert.equal(jobsOn(pro(2)), true);
});

test('every club starts with a coach, and one of them is you', () => {
  const lg = pro(3);
  assert.equal(Object.keys(lg.jobs.coaches).length, 32);
  const u = userTeamIndex(lg);
  assert.equal(lg.teams[u].coach, 'you');
  assert.equal(yourCoach(lg).rep, BASE_REP);
  for (const [i, t] of lg.teams.entries()) {
    assert.ok(t.coach, `${t.abbr} has no coach`);
    assert.ok(t.patience >= 3 && t.patience <= 6, `patience ${t.patience}`);
    assert.equal(coachOf(lg, i).team, i, 'a coach knows where he works');
  }
  const names = Object.values(lg.jobs.coaches).filter((c) => !c.you).map((c) => c.name);
  assert.equal(new Set(names).size, names.length, 'two coaches share a name');
});

test('the bar is set against the roster, not against the table', () => {
  const lg = pro(4);
  const byId = index(lg);
  const goals = lg.teams.map((_, i) => goalFor(lg, i, byId));
  const keys = goals.map((g) => g.key);
  for (const k of ['deep', 'playoffs', 'winning', 'progress']) {
    assert.ok(keys.includes(k), `nobody was asked to ${k}`);
  }
  // The best roster carries the highest bar, the worst the lowest.
  const best = goals.reduce((a, b) => (a.rank < b.rank ? a : b));
  const worst = goals.reduce((a, b) => (a.rank > b.rank ? a : b));
  assert.equal(best.key, 'deep');
  assert.equal(worst.key, 'progress');
});

test('a season is judged against what was asked, not against a flat standard', () => {
  const champ = { champion: true, madePlayoffs: true, wonARound: true, winPct: 0.8, rec: { w: 14, l: 3, t: 0 } };
  assert.equal(judge({ key: 'progress' }, champ, 2).met, true, 'a title is always enough');
  const mid = { champion: false, madePlayoffs: true, wonARound: false, winPct: 0.55, rec: { w: 9, l: 8, t: 0 } };
  assert.equal(judge({ key: 'playoffs' }, mid).met, true);
  assert.equal(judge({ key: 'deep' }, mid).met, false, 'the same season fails a higher bar');
  const bad = { champion: false, madePlayoffs: false, wonARound: false, winPct: 0.2, rec: { w: 3, l: 14, t: 0 } };
  assert.equal(judge({ key: 'deep' }, bad).margin, -2, 'a good roster missing badly is judged harshly');
  assert.equal(judge({ key: 'progress' }, bad, 1).met, true, 'but progress on one win is progress');
  assert.equal(judge({ key: 'progress' }, bad, 9).met, false, 'and going backwards is not');
});

test('heat accumulates on misses, clears on a title, and ends in the sack', () => {
  const lg = pro(5);
  const byId = index(lg);
  const u = userTeamIndex(lg);
  const you = yourCoach(lg);
  const patience = lg.teams[u].patience;
  // Force a run of bad seasons rather than waiting for one.
  lg.phase = 'complete';
  for (let i = 0; i < 6; i++) {
    lg.teams.forEach((t) => { t.record = { w: 1, l: 16, t: 0, pf: 100, pa: 500 }; });
    lg.history = [{ season: lg.season, champion: (u + 1) % 32, finish: lg.teams.map((_, k) => k) }];
    reviewSeason(lg, byId, new RNG(i));
    if (you.team == null) break;
    lg.season++;
  }
  assert.equal(you.team, null, `never sacked after six ruinous seasons with patience ${patience}`);
  assert.ok(you.sacked >= 1);
  assert.equal(lg.jobs.status, 'seeking');
  assert.equal(lg.teams[u].coach, null, 'the club he left is vacant');
});

test('being sacked leaves the squad behind, which is the actual price', () => {
  const lg = pro(6);
  const byId = index(lg);
  const u = userTeamIndex(lg);
  const oldSquad = ROSTER_SLOTS.map((s) => lg.teams[u].slots[s.id]);
  const you = yourCoach(lg);
  // Exactly what reviewSeason does when an owner has had enough.
  you.team = null;
  you.lastClub = u;
  lg.teams[u].coach = null;
  const offers = makeOffers(lg, byId);
  assert.ok(offers.length >= 1, 'somebody should always take a chance while the reputation holds');
  const pick = offers[0].team;
  assert.notEqual(pick, u, 'the club that sacked you is not on the list');
  acceptOffer(lg, pick);
  assert.equal(userTeamIndex(lg), pick, 'the user flag moved with you');
  assert.equal(lg.teams[u].isUser, false, 'and left the old club');
  const newSquad = ROSTER_SLOTS.map((s) => lg.teams[pick].slots[s.id]);
  assert.notDeepEqual(newSquad, oldSquad, 'you inherited somebody else, not your own work');
  assert.equal(yourCoach(lg).jobs.length, 2);
});

test('a better job carries a higher bar to get it', () => {
  const lg = pro(7);
  const byId = index(lg);
  for (const t of lg.teams) t.coach = null;
  const open = vacancies(lg, byId);
  const top = standardFor(lg, open[0].idx, byId);
  const bottom = standardFor(lg, open[open.length - 1].idx, byId);
  assert.ok(top > bottom + 15, `the best job asked ${top}, the worst ${bottom}`);
});

test('below the reputation floor nobody calls, and that is the end of it', () => {
  const lg = pro(8);
  const byId = index(lg);
  const u = userTeamIndex(lg);
  const you = yourCoach(lg);
  you.team = null;
  you.rep = REP_FLOOR - 1;
  lg.teams[u].coach = null;
  assert.deepEqual(makeOffers(lg, byId), []);
  retire(lg, 'No club will have you.');
  assert.equal(lg.jobs.status, 'retired');
  assert.ok(careerSummary(lg).status === 'retired');
});

test('rival coaches are hired and sacked too, which is what makes vacancies', () => {
  const lg = pro(9);
  const byId = index(lg);
  const before = lg.teams.map((t) => t.coach);
  // Two clubs lose their coach.
  for (const i of [0, 5]) {
    const c = coachOf(lg, i);
    c.team = null;
    lg.jobs.pool.push(c.id);
    lg.teams[i].coach = null;
  }
  const hired = fillVacancies(lg, byId, new RNG(1));
  assert.equal(hired.length, 2);
  for (const i of [0, 5]) {
    assert.ok(lg.teams[i].coach, 'the vacancy was filled');
    assert.notEqual(lg.teams[i].coach, before[i], 'and by somebody new');
    // A coach brings his own way of building a roster with him.
    assert.equal(lg.teams[i].gm, coachOf(lg, i).gm);
  }
});

test('with nothing vacant, a coach the league rates gets a club to make room', () => {
  const lg = pro(15);
  const byId = index(lg);
  const u = userTeamIndex(lg);
  const you = yourCoach(lg);
  you.team = null;
  you.lastClub = u;
  you.rep = 80;
  lg.teams[u].coach = null;
  // Only your old club is open, and it will not have you back.
  const offers = makeOffers(lg, byId);
  assert.equal(offers.length, 1);
  assert.ok(offers[0].displaces, 'the one offer should be a club moving its own man on');
  const victim = offers[0].displaces;
  acceptOffer(lg, offers[0].team);
  assert.equal(userTeamIndex(lg), offers[0].team);
  assert.equal(lg.jobs.coaches[victim].team, null, 'the man you replaced is out of a job');
  assert.match(lg.jobs.log[lg.jobs.log.length - 2].text, /to make room for you/);
});

test('a club will not move a coach it rates as highly as you', () => {
  const lg = pro(16);
  const u = userTeamIndex(lg);
  const you = yourCoach(lg);
  you.team = null;
  you.lastClub = u;
  lg.teams[u].coach = null;
  const other = u === 0 ? 1 : 0;
  coachOf(lg, other).rep = you.rep;
  assert.throws(() => acceptOffer(lg, other), /filled/);
});

test('a job you are offered is held open until you answer', () => {
  const lg = pro(10);
  const byId = index(lg);
  const u = userTeamIndex(lg);
  const you = yourCoach(lg);
  you.team = null;
  lg.teams[u].coach = null;
  // Free up several clubs so the carousel has somewhere to hire.
  for (const i of [1, 2, 3, 4]) {
    const c = coachOf(lg, i);
    c.team = null; lg.jobs.pool.push(c.id); lg.teams[i].coach = null;
  }
  const offers = makeOffers(lg, byId);
  assert.ok(offers.length);
  fillVacancies(lg, byId, new RNG(2), { hold: offers.map((o) => o.team) });
  for (const o of offers) assert.equal(lg.teams[o.team].coach, null, 'an offered job was hired over');
  acceptOffer(lg, offers[0].team);
  assert.equal(userTeamIndex(lg), offers[0].team);
});

test('the seat is readable rather than a hidden number', () => {
  const lg = pro(11);
  const u = userTeamIndex(lg);
  assert.equal(seatWarmth(lg, u).band, 'safe');
  const you = yourCoach(lg);
  you.heat = lg.teams[u].patience - 1;
  assert.equal(seatWarmth(lg, u).band, 'hot');
  assert.match(seatWarmth(lg, u).text, /gone/);
});

test('a decade of coaching runs without corrupting anything', () => {
  const lg = pro(12);
  for (let i = 0; i < 10; i++) {
    if (lg.jobs.status === 'retired') break;
    simulateAhead(lg, index(lg), pool(lg), new RNG(900 + i), 'nextSeason');
  }
  const valid = rostersValid(lg, index(lg));
  assert.ok(valid.ok, valid.reason);
  // Exactly one club is yours, always.
  assert.equal(lg.teams.filter((t) => t.isUser).length, 1);
  // No coach holds two clubs, and the only club that may sit empty is your own:
  // `fillVacancies` skips `isUser` on purpose, so once nobody will hire you the
  // club you used to run stays yours and stays coachless. Asserting every club
  // has a coach quietly assumed the career never ends.
  const held = lg.teams.map((t) => t.coach);
  const empty = lg.teams.map((t, i) => (t.coach ? null : i)).filter((i) => i != null);
  if (lg.jobs.status === 'retired') {
    assert.deepEqual(empty, [userTeamIndex(lg)], 'only your old club is left without a coach');
  } else {
    assert.deepEqual(empty, [], 'a club was left without a coach');
  }
  const taken = held.filter(Boolean);
  assert.equal(new Set(taken).size, taken.length, 'a coach is in two jobs at once');
  const c = careerSummary(lg);
  assert.ok(c.seasons >= 9, `only ${c.seasons} seasons coached`);
  assert.ok(c.w + c.l > 100, 'a decade should be a lot of games');
  assert.ok(lg.jobs.log.length > 5, 'nothing happened in the carousel for ten years');
});

test('taking a job settles the rest of the carousel and opens the keeper round', () => {
  const lg = pro(13);
  simulateAhead(lg, index(lg), pool(lg), new RNG(77), 'offseason');
  const byId = index(lg);
  const you = yourCoach(lg);
  const u = userTeamIndex(lg);
  // Stage a sacking by hand so the path is exercised regardless of results.
  you.team = null;
  lg.teams[u].coach = null;
  const offers = makeOffers(lg, byId);
  lg.offseason = { ...(lg.offseason || {}), step: 'jobs', carousel: { offers } };
  const club = takeJob(lg, offers[0].team, pool(lg), byId);
  assert.ok(club);
  assert.equal(lg.offseason.step, 'keepers', 'the keeper round is now open');
  assert.ok(Object.keys(lg.offseason.keepers).length > 0, 'and the AI clubs have chosen');
  assert.equal(lg.offseason.keepers[userTeamIndex(lg)], undefined, 'except yours, which is yours to pick');
});

test('a league with jobs switched off never sacks anybody', () => {
  const lg = pro(14);
  lg.settings.jobs = false;
  assert.equal(jobsOn(lg), false);
  for (let i = 0; i < 4; i++) simulateAhead(lg, index(lg), pool(lg), new RNG(950 + i), 'nextSeason');
  assert.equal(lg.teams.filter((t) => t.isUser).length, 1);
  assert.equal(userTeamIndex(lg), 12, 'you are still where you started');
});
