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

/**
 * A true mirror of a roster, player for player, under its own ids.
 *
 * Two synthetic teams drawn at the same mean are not equal — they are two
 * draws — and `teamPower` reads the difference. 'even' here used to mean
 * whatever prior seeds 1 and 2 happened to produce, which held until the
 * rating weights moved and it became 0.61. Distinct ids matter because
 * `overall` caches by id.
 */
function mirror(t, id) {
  const byId = new Map(), slots = {};
  for (const [slot, pid] of Object.entries(t.slots)) {
    const p = t.byId.get(pid);
    if (!p) continue;
    const twin = { ...p, id: `${id}-${p.id}`, r: { ...p.r } };
    byId.set(twin.id, twin); slots[slot] = twin.id;
  }
  return { ...t, id, name: `Team ${id}`, abbr: id.toUpperCase().slice(0, 3), slots, byId };
}

test('the normal CDF and expected points behave', () => {
  assert.ok(Math.abs(Phi(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(Phi(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(Phi(-1.96) - 0.025) < 1e-3);
  assert.ok(expectedPoints(80) > expectedPoints(20), 'closer is better');
  assert.ok(expectedPoints(50, 1, 10) > expectedPoints(50, 3, 10), 'later downs are worse');
  assert.ok(expectedPoints(50, 2, 20) < expectedPoints(50, 2, 5), 'long yardage is worse');
});

test('win probability starts near even, follows the score, and settles at the final', () => {
  // Against a mirror of itself, so 'near even' is a claim about the model
  // rather than about which way two random draws happened to fall.
  const g = createGame(tf(A), tf(mirror(A, 'am')), { seed: 5, homeAdvantage: false });
  const p0 = winProbability(g);
  assert.ok(p0 > 0.45 && p0 < 0.55, `kickoff ${p0}`);
  assert.equal(typeof g.log[0].wp, 'number', 'the opening event carries a probability');
  // A lead helps, more so late.
  const lead = { ...g, score: [10, 0], phase: 'play', possession: 1, ballOn: 25, down: 1, toGo: 10 };
  const early = winProbability({ ...lead, quarter: 1, clock: 800 });
  const late = winProbability({ ...lead, quarter: 4, clock: 120 });
  assert.ok(early > 0.6 && late > early, `early ${early} late ${late}`);
  assert.ok(winProbability({ ...lead, score: [0, 10], quarter: 4, clock: 120 }) < 0.15);
  // Possession and field position count. Asserted as the swing between the two
  // sides having the ball rather than as a pair of absolute thresholds: this
  // matchup has a prior of its own, and the old thresholds only held because
  // the expected-points curve overstated the red zone by a point and a half.
  const ours = winProbability({ ...g, phase: 'play', possession: 0, ballOn: 85, down: 1, toGo: 10 });
  const theirs = winProbability({ ...g, phase: 'play', possession: 1, ballOn: 85, down: 1, toGo: 10 });
  assert.ok(ours > 0.55, `first and ten at their fifteen should favour us: ${ours}`);
  assert.ok(theirs < 0.5, `and the reverse should not: ${theirs}`);
  assert.ok(ours - theirs > 0.2, `who has it in the red zone has to matter: ${(ours - theirs).toFixed(3)}`);
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

test('a logged event carries no more than it has to', () => {
  const g = createGame(tf(A), tf(B), { seed: 21 });
  simulateGame(g);
  // Win probability is stored to three decimals. A chart drawn at pixel
  // resolution and a label printed as a whole percent cannot use more, and a
  // full double is nineteen characters in a save that is mostly play-by-play.
  for (const e of g.log) {
    if (typeof e.wp !== 'number') continue;
    assert.equal(e.wp, Math.round(e.wp * 1000) / 1000, `wp ${e.wp} kept more precision than it needs`);
    assert.ok(e.wp >= 0 && e.wp <= 1);
  }
  // `flag` is written only where it is true; every reader tests it for truth.
  const withFalse = g.log.filter((e) => e.flag === false);
  assert.equal(withFalse.length, 0, `${withFalse.length} events store "flag":false`);
  assert.ok(g.log.some((e) => e.flag === true) || g.log.every((e) => !('flag' in e)), 'a real flag still says so');
  // And the ends of the range are still exact, because the chart draws to them.
  const last = g.log[g.log.length - 1].wp;
  assert.ok(last === 0 || last === 1 || last === 0.5, `the final probability is settled, got ${last}`);
  // Bytes, so a regression here is visible rather than theoretical.
  const bytes = JSON.stringify(g.log).length / g.log.length;
  assert.ok(bytes < 260, `an event should stay under 260 bytes, got ${bytes.toFixed(0)}`);
});
