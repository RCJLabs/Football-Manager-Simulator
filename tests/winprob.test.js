import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { createGame, simulateGame, step } from '../src/engine/game.js';
import { buildLineup } from '../src/engine/ratings.js';
import { winProbability, Phi, expectedPoints, priorMargin } from '../src/engine/winprob.js';
import { wpChart, driveChart, gameStory, wpLabel } from '../src/ui/charts.js';
import { PLAYERS_BY_ID } from '../src/data/db.js';

const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const A = syntheticTeam('a', 85, 2, 1), B = syntheticTeam('b', 85, 2, 2);

test('the normal CDF and expected points behave', () => {
  assert.ok(Math.abs(Phi(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(Phi(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(Phi(-1.96) - 0.025) < 1e-3);
  assert.ok(expectedPoints(80) > expectedPoints(20), 'closer is better');
  assert.ok(expectedPoints(50, 1, 10) > expectedPoints(50, 3, 10), 'later downs are worse');
  assert.ok(expectedPoints(50, 2, 20) < expectedPoints(50, 2, 5), 'long yardage is worse');
});

test('win probability starts near even, follows the score, and settles at the final', () => {
  const g = createGame(tf(A), tf(B), { seed: 5, homeAdvantage: false });
  const p0 = winProbability(g);
  assert.ok(p0 > 0.4 && p0 < 0.6, `kickoff ${p0}`);
  assert.equal(typeof g.log[0].wp, 'number', 'the opening event carries a probability');
  // A lead helps, more so late.
  const lead = { ...g, score: [10, 0], phase: 'play', possession: 1, ballOn: 25, down: 1, toGo: 10 };
  const early = winProbability({ ...lead, quarter: 1, clock: 800 });
  const late = winProbability({ ...lead, quarter: 4, clock: 120 });
  assert.ok(early > 0.6 && late > early, `early ${early} late ${late}`);
  assert.ok(winProbability({ ...lead, score: [0, 10], quarter: 4, clock: 120 }) < 0.15);
  // Possession and field position count.
  const ours = winProbability({ ...g, phase: 'play', possession: 0, ballOn: 85, down: 1, toGo: 10 });
  const theirs = winProbability({ ...g, phase: 'play', possession: 1, ballOn: 85, down: 1, toGo: 10 });
  assert.ok(ours > 0.55 && theirs < 0.45, `red zone ours ${ours} theirs ${theirs}`);
  simulateGame(g);
  const last = g.log[g.log.length - 1].wp;
  assert.equal(last, g.score[0] > g.score[1] ? 1 : g.score[0] < g.score[1] ? 0 : 0.5);
  assert.ok(g.log.filter((e) => typeof e.wp === 'number').length > 100, 'every step leaves a probability on its event');
});

test('the stronger roster and the home side start as favourites', () => {
  const strong = syntheticTeam('s', 89, 1, 3), weak = syntheticTeam('w', 81, 1, 4);
  const g = createGame(tf(strong), tf(weak), { seed: 1, homeAdvantage: false });
  assert.ok(priorMargin(tf(strong), tf(weak), true) > 8, 'a big power gap is worth points');
  assert.ok(winProbability(g) > 0.7, `favourite at ${winProbability(g)}`);
  const h = createGame(tf(A), { ...tf(A), id: 'b' }, { seed: 1 });
  assert.ok(winProbability(h) > 0.5 && winProbability(h) < 0.6, `home edge ${winProbability(h)}`);
});

test('the model is calibrated: predicted buckets match how often the home side actually won', () => {
  const buckets = Array.from({ length: 5 }, () => ({ n: 0, p: 0, w: 0 }));
  for (let i = 0; i < 160; i++) {
    const g = createGame(tf(A), tf(B), { seed: 6000 + i, homeAdvantage: i % 2 === 0 });
    const samples = [];
    while (!g.final) {
      step(g);
      if (g.phase === 'play' && g.log.length % 7 === 0) samples.push(g.lastEvent.wp);
    }
    const win = g.score[0] > g.score[1] ? 1 : g.score[0] < g.score[1] ? 0 : 0.5;
    for (const p of samples) { const b = Math.min(4, Math.floor(p * 5)); buckets[b].n++; buckets[b].p += p; buckets[b].w += win; }
  }
  for (const b of buckets) {
    if (b.n < 40) continue;
    const predicted = b.p / b.n, actual = b.w / b.n;
    assert.ok(Math.abs(predicted - actual) < 0.14, `predicted ${predicted.toFixed(2)} actual ${actual.toFixed(2)} over ${b.n}`);
  }
});

test('charts and the story render from a finished game', () => {
  const g = createGame(tf(A), tf(B), { seed: 9 });
  simulateGame(g);
  const svg = wpChart(g.log, g.teams);
  assert.ok(svg.startsWith('<svg') && svg.includes('<path'), 'win probability chart');
  const dc = driveChart(g.drives, g.teams);
  assert.ok(dc.startsWith('<svg') && dc.includes('<rect'), 'drive chart');
  assert.ok(/[A-Z]+ \d+%/.test(wpLabel(g.log[g.log.length - 2].wp, g.teams)));
  const story = gameStory({ teams: g.teams, score: g.score, final: true, overtime: g.quarter >= 5, log: g.log, players: [g.stats[0].players, g.stats[1].players], injuries: g.teams.map((t) => t.injuries) }, PLAYERS_BY_ID);
  assert.ok(story.length >= 2 && /\d+-\d+/.test(story[0]), story.join(' | '));
  assert.ok(story.some((s) => /Turning point/.test(s)), 'names the swings');
  assert.equal(wpChart([], g.teams), '');
  assert.equal(driveChart([], g.teams), '');
});
