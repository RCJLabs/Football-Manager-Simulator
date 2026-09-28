// The league ticker: every game of a simulated week played back on one clock.
// What it plays back is recorded with each result — when each score came and
// how long an overtime game ran — and has to add up to the result it belongs
// to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, currentWeek, userTeamIndex, scoringTimeline, gameLength } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { tickerGames, clockLabel, scoreAt, feedOf, tickerCard, UPSET_GAP, UPSET_MIN_GAMES } from '../src/ui/ticker.js';

registerPlayers(byId);

// Evenly matched sides, so that overtime turns up often enough to be tested.
function played(seed, playoff) {
  const A = syntheticTeam(`a${seed}`, 82, 4, seed * 2 + 1);
  const B = syntheticTeam(`b${seed}`, 82, 4, seed * 2 + 2);
  const g = createGame({ ...A, lineup: buildLineup(A.slots, A.byId) }, { ...B, lineup: buildLineup(B.slots, B.byId) }, { seed, playoff });
  simulateGame(g);
  return g;
}
const GAMES = [
  ...Array.from({ length: 160 }, (_, k) => played(9300 + k, false)),
  ...Array.from({ length: 80 }, (_, k) => played(9600 + k, true)),
];

test('a game\'s scores, in the order they came, add up to its final', () => {
  let overtime = 0;
  for (const g of GAMES) {
    const sc = scoringTimeline(g);
    const end = gameLength(g);
    assert.equal(sc.length % 3, 0);
    const sum = [0, 0];
    let safeties = 0;
    for (let k = 0; k < sc.length; k += 3) {
      const [t, side, pts] = [sc[k], sc[k + 1], sc[k + 2]];
      assert.ok(k === 0 || t >= sc[k - 3], 'a score before the one ahead of it');
      assert.ok(Number.isInteger(t) && t > 0 && t <= end, `a score at ${t} of ${end}`);
      // A try is folded into its touchdown; a lone two is a safety.
      assert.ok([2, 3, 6, 7, 8].includes(pts), `${pts} points in one score`);
      if (pts === 2) safeties++;
      sum[side] += pts;
    }
    assert.deepEqual(sum, g.score);
    assert.equal(safeties, g.log.filter((e) => /Safety\./.test(e.text || '')).length, 'a two that was not a safety');
    assert.equal(end > 3600, g.quarter >= 5);
    if (g.quarter >= 5) overtime++;
  }
  assert.ok(overtime > 0, 'no overtime in the sample');
});

test('the clock reads a boundary as the end of the period that is ending', () => {
  assert.equal(clockLabel(0), 'Kickoff');
  assert.equal(clockLabel(1), '1st 14:59');
  assert.equal(clockLabel(900), '1st 0:00');
  assert.equal(clockLabel(901), '2nd 14:59');
  assert.equal(clockLabel(3600), '4th 0:00');
  // Ten minutes of overtime in the season, fifteen a period in the playoffs.
  assert.equal(clockLabel(3601), 'OT 9:59');
  assert.equal(clockLabel(4200), 'OT 0:00');
  assert.equal(clockLabel(3601, true), 'OT 14:59');
  assert.equal(clockLabel(4201, true), 'OT 4:59');
  assert.equal(clockLabel(4500, true), 'OT 0:00');
  assert.equal(clockLabel(4501, true), '2OT 14:59');
});

test('the score at a moment counts what had come by then', () => {
  const g = { sc: [120, 0, 7, 900, 1, 3, 900, 0, 3, 3500, 1, 7] };
  assert.deepEqual(scoreAt(g, 0), [0, 0]);
  assert.deepEqual(scoreAt(g, 120), [7, 0]);
  assert.deepEqual(scoreAt(g, 899), [7, 0]);
  assert.deepEqual(scoreAt(g, 900), [10, 3]);
  assert.deepEqual(scoreAt(g, 3600), [10, 10]);
});

test('the feed calls what a score did to the game, and not the first score of it', () => {
  const home = { abbr: 'HOM' }, away = { abbr: 'AWY' };
  const a = { home, away, sc: [100, 0, 7, 200, 1, 7, 300, 1, 3, 400, 0, 3, 500, 0, 7] };
  const b = { home, away, sc: [100, 0, 3, 250, 1, 7, 260, 0, 2] };
  const feed = feedOf([a, b]);
  assert.deepEqual(feed.map((f) => [f.t, f.gi, f.what]), [
    [100, 0, ''], [100, 1, ''],
    [200, 0, 'ties it'], [250, 1, 'takes the lead'], [260, 1, ''],
    [300, 0, 'goes ahead'], [400, 0, 'ties it'], [500, 0, 'goes ahead'],
  ]);
  assert.deepEqual(feed.map((f) => f.kind), ['TD', 'FG', 'TD', 'TD', 'safety', 'FG', 'FG', 'TD']);
  assert.deepEqual(feed.at(-1).after, [17, 10]);
  assert.equal(feed.at(-1).when, '1st 6:40');
});

test('a final is an upset by the records going into the week, not by any odds', () => {
  // Records as they stand after the week, which has been played.
  const rec = (w, l, t = 0) => ({ record: { w, l, t } });
  const teams = [
    rec(6, 3), rec(3, 6), // 2-6 beat 6-2
    rec(4, 5), rec(6, 3), // 3-5 beat 6-2: a gap of .375
    rec(4, 4), rec(5, 3), // 3-4 beat 5-2: .286, not one
    rec(4, 3, 1), rec(3, 4, 1), // a tie is nobody's upset
    rec(1, 3), rec(3, 1), // 0-3 beat 3-0: too early to say
    rec(1, 5), rec(5, 1), rec(0, 0), rec(0, 0),
  ];
  const r = (score) => ({ score, sc: [] });
  const games = [
    { home: 0, away: 1, result: r([10, 20]) },
    { home: 2, away: 3, result: r([20, 10]) },
    { home: 4, away: 5, result: r([20, 10]) },
    { home: 6, away: 7, result: r([17, 17]) },
    { home: 9, away: 8, result: r([3, 7]) },
    { home: 10, away: 11, result: { score: [7, 0] } }, // played before the ticker
    { home: 12, away: 13, bye: true, result: r([0, 0]) },
    { home: 13, away: 12 }, // not played yet
  ];
  const out = tickerGames({ phase: 'season', teams }, games, 3);
  assert.deepEqual(out.map((g) => g.i), [0, 1, 2, 3, 4]);
  assert.deepEqual(out.map((g) => g.upset), [{ winner: '2–6', loser: '6–2' }, { winner: '3–5', loser: '6–2' }, null, null, null]);
  assert.deepEqual(out.map((g) => g.mine), [false, true, false, false, false]);
  assert.ok(UPSET_GAP === 0.35 && UPSET_MIN_GAMES === 4);
  // In the playoffs a record is the regular season's, which the game is not in.
  const po = tickerGames({ phase: 'playoffs', teams: [rec(8, 9), rec(15, 2), rec(9, 8), rec(14, 3)] }, [{ home: 1, away: 0, result: r([10, 13]) }, { home: 3, away: 2, result: r([10, 13]) }], -1);
  assert.deepEqual(po.map((g) => g.upset), [{ winner: '8–9', loser: '15–2' }, null]);
  const card = tickerCard('Week 1, as it happened', out);
  assert.equal((card.match(/class="tk-game/g) || []).length, 5);
  assert.equal(tickerCard('x', []), '');
});

test('a simulated week keeps what the ticker needs, and it adds up', () => {
  const lg = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 71, draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(71));
  startSeason(lg, byId);
  let seen = 0;
  for (let w = 0; w < 3; w++) {
    simulateWeekAi(lg, byId, { includeUser: true });
    const wk = currentWeek(lg);
    const games = tickerGames(lg, wk.games, userTeamIndex(lg));
    assert.equal(games.length, wk.games.filter((g) => !g.bye).length, 'a played game the ticker cannot show');
    for (const g of games) {
      seen++;
      assert.deepEqual(scoreAt(g, g.end), g.score);
      const r = wk.games[g.i].result;
      assert.equal(r.end != null, r.overtime, 'an overtime length on a game that ended in regulation');
      assert.equal(g.upset, null, 'an upset called before either side has four games');
    }
    assert.equal(games.filter((g) => g.mine).length, 1);
    advanceWeek(lg, byId);
  }
  assert.ok(seen >= 12);
});
