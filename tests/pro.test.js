import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { PRO_TEAMS, CONFERENCES } from '../src/data/pro.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, buildProSchedule, startSeason, simulateWeekAi, advanceWeek, proStandings, standings, isPro, sortDepthCharts } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup, overall } from '../src/engine/ratings.js';

const mkPro = (seed, opts = {}) => createLeague({ name: 'P', mode: 'pro', franchise: 5, seed, draftType: 'snake', ...opts });

test('a pro league has 32 franchises in eight divisions and the chosen one is the user', () => {
  const league = mkPro(1);
  assert.ok(isPro(league));
  assert.equal(league.teams.length, 32);
  const u = league.teams.findIndex((t) => t.isUser);
  assert.equal(u, 5);
  assert.equal(league.teams[u].name, PRO_TEAMS[5].name);
  const counts = {};
  for (const t of league.teams) counts[`${t.conf}-${t.div}`] = (counts[`${t.conf}-${t.div}`] || 0) + 1;
  assert.equal(Object.keys(counts).length, 8);
  assert.ok(Object.values(counts).every((c) => c === 4));
  const renamed = mkPro(1, { user: { name: 'My Club', abbr: 'MYC' } });
  assert.equal(renamed.teams[5].name, 'My Club');
  assert.equal(renamed.teams[5].abbr, 'MYC');
  assert.equal(renamed.teams[5].color, PRO_TEAMS[5].color, 'colour falls back to the franchise');
});

test('the pro schedule is a real 17-game slate', () => {
  for (const season of [1, 2, 3]) {
    const league = mkPro(10 + season);
    const sched = buildProSchedule(league.teams, new RNG(season), season);
    assert.equal(sched.length, 17, 'seventeen weeks');
    const games = {}, home = {}, opp = {};
    for (const wk of sched) {
      assert.equal(wk.games.length, 16, 'sixteen games every week');
      const seen = new Set();
      for (const g of wk.games) {
        assert.ok(!seen.has(g.home) && !seen.has(g.away), 'nobody plays twice in a week');
        seen.add(g.home); seen.add(g.away);
        games[g.home] = (games[g.home] || 0) + 1; games[g.away] = (games[g.away] || 0) + 1;
        home[g.home] = (home[g.home] || 0) + 1;
        (opp[g.home] ??= []).push(g.away); (opp[g.away] ??= []).push(g.home);
      }
      assert.equal(seen.size, 32, 'everyone plays every week');
    }
    for (let i = 0; i < 32; i++) {
      assert.equal(games[i], 17, `team ${i} plays 17`);
      assert.ok(home[i] === 8 || home[i] === 9, `team ${i} hosts ${home[i]}`);
      const t = league.teams[i];
      const rivals = league.teams.map((x, j) => (j !== i && x.conf === t.conf && x.div === t.div ? j : -1)).filter((j) => j >= 0);
      for (const r of rivals) assert.equal(opp[i].filter((o) => o === r).length, 2, 'each division rival twice');
      const nonDiv = opp[i].filter((o) => !rivals.includes(o));
      assert.equal(new Set(nonDiv).size, nonDiv.length, 'no other opponent repeats');
      assert.equal(nonDiv.length, 11);
      const sameConf = nonDiv.filter((o) => league.teams[o].conf === t.conf).length;
      assert.equal(sameConf, 6, 'six more conference games');
      assert.equal(nonDiv.length - sameConf, 5, 'five cross-conference games');
    }
  }
});

test('pro standings seed four division winners then three wild cards per conference', () => {
  const league = mkPro(21);
  autoDraftAll(league, league.draft, PLAYERS, new RNG(21));
  startSeason(league);
  let guard = 0;
  while (league.phase === 'season' && guard++ < 20) {
    simulateWeekAi(league, PLAYERS_BY_ID, { includeUser: true });
    if (league.week >= league.schedule.length) break;
    advanceWeek(league);
  }
  const table = proStandings(league);
  assert.equal(table.length, 2);
  for (const conf of table) {
    assert.equal(conf.divisions.length, 4);
    assert.equal(conf.seeds.length, 7);
    const winners = conf.divisions.map((d) => d.rows[0].idx);
    assert.deepEqual(new Set(conf.seeds.slice(0, 4)), new Set(winners), 'top four seeds are the division winners');
    for (const idx of conf.seeds) assert.equal(league.teams[idx].conf, CONFERENCES.indexOf(conf.name));
    for (let i = 4; i < 7; i++) assert.ok(!winners.includes(conf.seeds[i]), 'wild cards did not win a division');
    // Seeds 1..4 are ordered by record, as are 5..7.
    const pct = (i) => { const r = league.teams[i].record; return (r.w + r.t / 2) / (r.w + r.l + r.t); };
    for (let i = 1; i < 4; i++) assert.ok(pct(conf.seeds[i - 1]) >= pct(conf.seeds[i]) - 1e-9);
    for (let i = 5; i < 7; i++) assert.ok(pct(conf.seeds[i - 1]) >= pct(conf.seeds[i]) - 1e-9);
    for (const d of conf.divisions) for (const row of d.rows) {
      assert.equal(row.divRec.w + row.divRec.l + row.divRec.t, 6, 'six division games played');
      assert.equal(row.confRec.w + row.confRec.l + row.confRec.t, 12, 'twelve conference games played');
    }
  }
  const flat = standings(league);
  assert.equal(flat.length, 32);
});

test('the pro postseason runs wild card, divisional, conference finals, then a neutral final', () => {
  const league = mkPro(31);
  autoDraftAll(league, league.draft, PLAYERS, new RNG(31));
  startSeason(league);
  let guard = 0;
  while (league.phase !== 'complete' && guard++ < 40) {
    simulateWeekAi(league, PLAYERS_BY_ID, { includeUser: true });
    advanceWeek(league);
  }
  assert.equal(league.phase, 'complete');
  const po = league.playoffs;
  assert.equal(po.pools.length, 2);
  assert.deepEqual(po.rounds.map((r) => r.name), ['Wild Card', 'Divisional', 'Conference Championships', 'Championship']);
  assert.deepEqual(po.rounds.map((r) => r.games.length), [6, 4, 2, 1]);
  assert.equal(po.rounds[0].byes.length, 2, 'the top seed in each conference rests');
  for (const b of po.rounds[0].byes) assert.equal(po.pools[b.pool].seeds[0], b.team);
  assert.ok(po.rounds[3].games[0].neutral, 'the final is at a neutral site');
  const finalists = [po.rounds[3].games[0].home, po.rounds[3].games[0].away];
  assert.notEqual(league.teams[finalists[0]].conf, league.teams[finalists[1]].conf, 'one champion from each conference');
  assert.ok(finalists.includes(league.champion));
  for (const t of league.teams) assert.equal(t.record.w + t.record.l + t.record.t, 17);
  // Playoff box scores keep player lines; regular-season AI games do not.
  assert.ok(po.rounds[0].games[0].result.players, 'playoff player stats kept');
  const u = league.teams.findIndex((t) => t.isUser);
  const aiGame = league.schedule[0].games.find((g) => g.home !== u && g.away !== u);
  assert.equal(aiGame.result.players, null, 'AI regular-season player lines dropped');
  const userGame = league.schedule[0].games.find((g) => g.home === u || g.away === u);
  assert.ok(userGame.result.players && userGame.result.log, 'user game keeps everything');
});

test('a 12-team fantasy league gives the top two seeds a bye', () => {
  const league = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed: 41, draftType: 'auction' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(41), PLAYERS_BY_ID);
  startSeason(league);
  let guard = 0;
  while (league.phase !== 'complete' && guard++ < 40) { simulateWeekAi(league, PLAYERS_BY_ID, { includeUser: true }); advanceWeek(league); }
  const po = league.playoffs;
  assert.equal(po.pools[0].seeds.length, 6);
  assert.deepEqual(po.rounds.map((r) => r.games.length), [2, 2, 1]);
  assert.equal(po.rounds[0].byes.length, 2);
  assert.deepEqual(po.rounds.map((r) => r.name), ['Wild Card', 'Semifinals', 'Championship']);
  assert.ok(league.champion != null);
});

test('home-field advantage is real but modest', () => {
  const A = syntheticTeam('a', 85, 1, 1), B = syntheticTeam('a', 85, 1, 1);
  const la = buildLineup(A.slots, A.byId), lb = buildLineup(B.slots, B.byId);
  let home = 0; const n = 600;
  for (let i = 0; i < n; i++) {
    const g = createGame({ ...A, lineup: la }, { ...B, id: 'b', lineup: lb }, { seed: 900 + i });
    simulateGame(g);
    if (g.score[0] > g.score[1]) home++; else if (g.score[0] === g.score[1]) home += 0.5;
  }
  const rate = home / n;
  assert.ok(rate > 0.51 && rate < 0.62, `home win rate ${(rate * 100).toFixed(1)}%`);
  const g = createGame({ ...A, lineup: la }, { ...B, id: 'b', lineup: lb }, { seed: 1, homeAdvantage: false });
  assert.ok(g.neutral);
});

test('a pro league can also be built by auction and still fills 832 slots', () => {
  const league = createLeague({ name: 'P', mode: 'pro', franchise: 0, seed: 51, draftType: 'auction' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(51), PLAYERS_BY_ID);
  assert.ok(league.auction.complete);
  assert.equal(league.auction.sold.length, 32 * ROSTER_SLOTS.length);
  for (const t of league.teams) for (const s of ROSTER_SLOTS) assert.ok(t.slots[s.id], `${t.abbr} ${s.id}`);
});

test('season start puts the best player at the top of every position group', () => {
  const league = createLeague({ name: 'P', mode: 'pro', franchise: 3, seed: 61, draftType: 'auction' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(61), PLAYERS_BY_ID);
  startSeason(league, PLAYERS_BY_ID);
  const groups = {};
  for (const slot of ROSTER_SLOTS) (groups[slot.pos] ??= []).push(slot.id);
  for (const t of league.teams) {
    for (const ids of Object.values(groups)) {
      const o = ids.map((id) => overall(PLAYERS_BY_ID.get(t.slots[id])));
      for (let i = 1; i < o.length; i++) assert.ok(o[i - 1] >= o[i], `${t.abbr} ${ids[i - 1]} (${o[i - 1]}) ahead of ${ids[i]} (${o[i]})`);
    }
  }
  const u = league.teams.findIndex((t) => t.isUser);
  assert.ok(league.teams[u].depthSorted, 'user chart sorted once');
  // A user who reorders keeps that order across a second season.
  const t = league.teams[u];
  [t.slots.RB1, t.slots.RB2] = [t.slots.RB2, t.slots.RB1];
  const keep = t.slots.RB1;
  sortDepthCharts(league, PLAYERS_BY_ID);
  assert.equal(t.slots.RB1, keep);
});
