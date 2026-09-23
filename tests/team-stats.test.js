// Team statistics, both sides of the ball. The offence has been recorded all
// along; nothing ever recorded what a defence allowed, so "the best red-zone
// defence" could not be answered. It is derived from stored results rather
// than stored, which makes it retroactive for saves already mid-season.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, registerPlayers } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { emptyTeamStats } from '../src/engine/stats.js';
import { seasonTeamStats, rankTeams, TEAM_CATEGORIES, CATEGORY_BY_KEY, fmtCategory } from '../src/engine/teamstats.js';

registerPlayers(byId);
const played = (weeks = 6, seed = 21) => {
  const lg = createLeague({ name: 'S', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  for (let w = 0; w < weeks && lg.phase === 'season'; w++) { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg); }
  return lg;
};

test('every yard gained is a yard allowed: the league balances', () => {
  const rows = seasonTeamStats(played());
  for (const k of Object.keys(emptyTeamStats())) {
    const off = rows.reduce((s, r) => s + r.off[k], 0);
    const def = rows.reduce((s, r) => s + r.def[k], 0);
    assert.equal(off, def, `${k}: the league gained ${off} and allowed ${def}`);
  }
});

test('the offence it derives is the offence the season already kept', () => {
  // seasonStats.team has accumulated a club's offence since long before this;
  // deriving it again from the schedule must land on the same totals, or one
  // of them is counting games the other is not.
  const lg = played();
  for (const r of seasonTeamStats(lg)) {
    for (const [k, v] of Object.entries(r.team.seasonStats.team)) {
      assert.equal(r.off[k], v, `${r.team.abbr} ${k}: derived ${r.off[k]}, kept ${v}`);
    }
  }
});

test('a defence is what its opponents did against it', () => {
  const lg = played(3);
  const rows = seasonTeamStats(lg);
  const g = lg.schedule[0].games[0];
  const home = rows[g.home], away = rows[g.away];
  // After one week the home side's defence can only contain what the away
  // side's offence did in that game, plus later weeks; check the first game
  // contributes exactly by rebuilding week one alone.
  const one = seasonTeamStats({ ...lg, schedule: [lg.schedule[0]] });
  assert.equal(one[g.home].def.rushYds, g.result.teamStats[1].rushYds);
  assert.equal(one[g.away].def.rushYds, g.result.teamStats[0].rushYds);
  assert.equal(one[g.home].def.points, g.result.score[1]);
  void home; void away;
});

test('rankings read the right way round for offence and defence', () => {
  const rows = seasonTeamStats(played());
  const off = rankTeams(rows, CATEGORY_BY_KEY.ypg);
  const def = rankTeams(rows, CATEGORY_BY_KEY.dypg);
  assert.ok(off[0].v >= off[off.length - 1].v, 'the best offence has the fewest yards');
  assert.ok(def[0].v <= def[def.length - 1].v, 'the best defence has allowed the most yards');
  assert.equal(off[0].rank, 1);
});

test('a rate with no attempts yet is unknown, not 0% and not first', () => {
  // Week one: a club that never faced a third down must not rank as the
  // league's stingiest third-down defence at 0%.
  const lg = played(0);
  const rows = seasonTeamStats(lg);
  for (const cat of TEAM_CATEGORIES) {
    for (const r of rankTeams(rows, cat)) {
      assert.equal(r.rank, null, `${cat.key} ranked a club with no games`);
      assert.equal(fmtCategory(cat, r.v), '—');
    }
  }
});

test('ties share a rank and the next one skips', () => {
  const cat = { value: (r) => r.x, better: 'high' };
  const out = rankTeams([{ idx: 0, x: 5 }, { idx: 1, x: 7 }, { idx: 2, x: 5 }, { idx: 3, x: 3 }], cat);
  assert.deepEqual(out.map((r) => r.rank), [1, 2, 2, 4]);
});

test('formatting is what a reader expects', () => {
  assert.equal(fmtCategory(CATEGORY_BY_KEY.third, 41.26), '41.3%');
  assert.equal(fmtCategory(CATEGORY_BY_KEY.top, 1845), '30:45');
  assert.equal(fmtCategory(CATEGORY_BY_KEY.diff, 6.2), '+6.2');
  assert.equal(fmtCategory(CATEGORY_BY_KEY.diff, -3), '-3.0');
});
