import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { GM_PERSONALITIES } from '../src/data/teams.js';
import { composites, buildLineup } from '../src/engine/ratings.js';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import {
  runEdge, recommendedPassRate, strategyRead, RATE_MIN, RATE_MAX, EVEN_ENOUGH, CROSSOVER, RAMP, crossoverFor,
} from '../src/engine/strategy.js';

registerPlayers(PLAYERS_BY_ID);

const compFor = (posMeans) => {
  const t = syntheticTeam('t', 82, 2, 11, { posMeans });
  return composites(buildLineup(t.slots, t.byId));
};

test("the recommendation runs from all-out throwing to all-out running through each league's crossover", () => {
  // Fitted by what following it earns against real leagues' AI clubs and
  // checked on seeds it was not fitted to (`npm run passrate -- read`): every
  // kind of league wants one end or the other, and is level between. If the
  // engine or the AI's game plans are retuned these move, and this is the test
  // that says the read needs measuring again.
  assert.deepEqual(CROSSOVER, { fantasy: -5.25, pro: -3.5 });
  assert.equal(RAMP, 0.15);
  for (const e0 of Object.values(CROSSOVER)) {
    assert.ok(Math.abs(recommendedPassRate(e0, e0) - 0.525) < 1e-9, 'level at the crossover');
    assert.equal(recommendedPassRate(e0 - 1.2, e0), RATE_MAX, 'a squad a little more pass-built than the crossover throws');
    assert.equal(recommendedPassRate(e0 + 1.2, e0), RATE_MIN, 'a squad a little more run-built than it runs');
  }
  assert.equal(crossoverFor({ mode: 'pro' }), CROSSOVER.pro);
  assert.equal(crossoverFor({ mode: 'fantasy' }), CROSSOVER.fantasy);
  assert.equal(crossoverFor({}), CROSSOVER.fantasy, 'a league with no mode on it is a fantasy league');
});

test('it never recommends a setting the slider cannot reach', () => {
  for (let edge = -60; edge <= 60; edge += 1.5) {
    const r = recommendedPassRate(edge);
    assert.ok(r >= RATE_MIN && r <= RATE_MAX, `run edge ${edge} gave ${r}`);
  }
});

test('more pass rate is recommended the more the roster leans that way', () => {
  for (let edge = -30; edge < 30; edge += 2) {
    assert.ok(recommendedPassRate(edge) >= recommendedPassRate(edge + 2) - 1e-9,
      `the curve turned back on itself at ${edge}`);
  }
});

test('a roster built to run reads as one, and so does a roster built to throw', () => {
  const run = runEdge(compFor({ RB: 93, OL: 93, TE: 90, QB: 72, WR: 72 }));
  const pass = runEdge(compFor({ QB: 93, WR: 93, TE: 90, RB: 72, OL: 76 }));
  const even = runEdge(compFor({}));
  assert.ok(run > EVEN_ENOUGH, `a run-built squad read ${run.toFixed(1)}`);
  assert.ok(pass < -EVEN_ENOUGH, `a pass-built squad read ${pass.toFixed(1)}`);
  assert.ok(Math.abs(even) < EVEN_ENOUGH * 2, `an even squad read ${even.toFixed(1)}`);
  assert.ok(recommendedPassRate(run) < recommendedPassRate(pass), 'the two should want opposite ends');
});

test('a squad at the crossover is told the dial is close to a free choice, not given a number to chase', () => {
  // Even means level against the clubs it plays, not even on paper: in a
  // fantasy league that is a squad whose passing game is somewhat the better.
  const league = { teams: [{ isUser: true, slots: {}, strategy: { passRate: 0.55 } }], injuries: {} };
  const t = syntheticTeam('even', 82, 2, 5, { posMeans: { QB: 92, WR: 90 } });
  league.teams[0].slots = t.slots;
  const read = strategyRead(league, 0, t.byId);
  assert.ok(read.even, `an even squad read ${read.edge.toFixed(1)}`);
  assert.equal(read.act, false, 'nothing to act on when the squad is balanced');
  assert.match(read.strength, /barely/);
});

test('a tilted squad already on the right setting is not nagged to change it', () => {
  const t = syntheticTeam('run', 82, 2, 5, { posMeans: { RB: 93, OL: 93, TE: 90, QB: 72, WR: 72 } });
  const edge = runEdge(composites(buildLineup(t.slots, t.byId)));
  const league = { teams: [{ isUser: true, slots: t.slots, strategy: { passRate: recommendedPassRate(edge) } }], injuries: {} };
  const read = strategyRead(league, 0, t.byId);
  assert.ok(!read.even, 'this squad is tilted');
  assert.equal(read.act, false, 'the dial is already there');
});

test('the read follows who is actually on the field, not who is on the roster', () => {
  // A hurt quarterback is the case that matters: his replacement changes what
  // the squad can do this week, and the read has to notice.
  const t = syntheticTeam('pass', 82, 2, 5, { posMeans: { QB: 95, WR: 93, RB: 74, OL: 78 } });
  const qbId = t.slots.QB1;
  const healthy = { teams: [{ isUser: true, slots: t.slots, strategy: { passRate: 0.55 } }], injuries: {} };
  const hurt = { teams: [{ isUser: true, slots: t.slots, strategy: { passRate: 0.55 } }], injuries: { [qbId]: { weeks: 4, kind: 'shoulder' } } };
  const a = strategyRead(healthy, 0, t.byId), b = strategyRead(hurt, 0, t.byId);
  assert.ok(b.edge > a.edge, `losing the passer should push the read toward the run (${a.edge.toFixed(1)} -> ${b.edge.toFixed(1)})`);
});

test('it works on a real drafted league and only ever suggests a legal setting', () => {
  const lg = createLeague({ name: 'S', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 31, draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(31));
  startSeason(lg, PLAYERS_BY_ID);
  for (let i = 0; i < lg.teams.length; i++) {
    const read = strategyRead(lg, i, PLAYERS_BY_ID);
    assert.ok(read, `no read for team ${i}`);
    assert.ok(read.rate >= RATE_MIN && read.rate <= RATE_MAX);
    assert.ok(Number.isFinite(read.edge));
    assert.ok(read.why.length > 20);
    assert.ok(['run', 'pass', 'balanced'].includes(read.lean));
  }
  const mine = strategyRead(lg, userTeamIndex(lg), PLAYERS_BY_ID);
  assert.equal(mine.current, lg.teams[userTeamIndex(lg)].strategy.passRate);
});

test('a club with no squad at all does not throw', () => {
  const lg = { teams: [{ isUser: true, slots: {}, strategy: {} }], injuries: {} };
  const read = strategyRead(lg, 0, new Map());
  assert.ok(read && Number.isFinite(read.edge) && read.rate >= RATE_MIN);
  assert.equal(read.current, 0.55, 'a club with no strategy set reads as the default');
  assert.equal(strategyRead(lg, 9, new Map()), null, 'a club that does not exist has no read');
});

test('a squad whose passer is its best player is usually told to run, and told why', () => {
  // Measured: against real AI clubs most fantasy squads earn more at 0.35 than
  // at 0.55, pass-built or not. The read this replaced told nearly all of them
  // to throw, and lost to 0.55 for it.
  const lg = createLeague({ name: 'R', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 41, draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(41));
  startSeason(lg, PLAYERS_BY_ID);
  const reads = lg.teams.map((_, i) => strategyRead(lg, i, PLAYERS_BY_ID));
  assert.ok(reads.filter((r) => r.rate < 0.5).length >= lg.teams.length / 2, `told to run: ${reads.map((r) => r.rate.toFixed(2)).join(' ')}`);
  const passBuiltToldToRun = reads.find((r) => r.lean === 'pass' && r.rate < 0.5 && !r.even);
  assert.ok(passBuiltToldToRun, 'some pass-built squad is told to run');
  // It reads backwards, so it says so, and says it is measured rather than
  // offering a reason nobody established.
  assert.match(passBuiltToldToRun.why, /^Your quarterback and receivers are the better half.*Even so, squads built like yours win more by leaning on the run, measured/);
  assert.doesNotMatch(passBuiltToldToRun.why, /shell/);
});

test('in a pro league the most pass-built squads are told to throw', () => {
  const lg = createLeague({ name: 'Q', mode: 'pro', numTeams: 32, franchise: 5, seed: 3301, draftType: 'snake', user: {} });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(3301));
  startSeason(lg, PLAYERS_BY_ID);
  const reads = lg.teams.map((_, i) => strategyRead(lg, i, PLAYERS_BY_ID)).sort((a, b) => a.edge - b.edge);
  const top = reads.slice(0, 6);
  assert.ok(top.every((r) => r.rate >= 0.65), `the six most pass-built: ${top.map((r) => `${r.edge.toFixed(1)}→${r.rate.toFixed(2)}`).join(' ')}`);
  assert.ok(top.every((r) => /throw/.test(r.why)));
  const bottom = reads.slice(-6);
  assert.ok(bottom.every((r) => r.rate <= 0.4), `the six most run-built: ${bottom.map((r) => `${r.edge.toFixed(1)}→${r.rate.toFixed(2)}`).join(' ')}`);
  // A pro league reads on the pro crossover, not the fantasy one.
  for (const r of reads) assert.ok(Math.abs(r.rate - recommendedPassRate(r.edge, CROSSOVER.pro)) < 1e-9, `edge ${r.edge.toFixed(2)} read ${r.rate}`);
  assert.ok(reads.some((r) => Math.abs(recommendedPassRate(r.edge, CROSSOVER.fantasy) - r.rate) > 0.05), 'and it makes a difference somewhere in the league');
});

test('what the team page claims for moving the dial is what was measured', () => {
  // +0.42 to +0.68 a game out of sample, against a flat 0.55. The read this
  // replaced claimed a point and was worth -0.27 to +0.28.
  const lg = createLeague({ name: 'C', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 41, draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(41));
  startSeason(lg, PLAYERS_BY_ID);
  const reads = lg.teams.map((_, i) => strategyRead(lg, i, PLAYERS_BY_ID));
  const tilted = reads.find((r) => !r.even);
  assert.ok(tilted);
  assert.match(tilted.strength, /half a point/);
  assert.doesNotMatch(tilted.strength, /about a point/);
});

test('the user starts on a dial that matches the squad they drafted', () => {
  // Every AI club is handed its personality's strategy by assignGms, matched to
  // the roster that personality also drafts. The human's dial sat at a flat
  // 0.55 whatever they built, which is the one asymmetry here that measured as
  // real: +0.98 ± 0.22 points a game.
  const lg = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 77, draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(77));
  startSeason(lg, PLAYERS_BY_ID);
  const u = userTeamIndex(lg);
  const read = strategyRead(lg, u, PLAYERS_BY_ID);
  assert.equal(lg.teams[u].strategy.passRate, read.rate, 'the opening dial should be the read');
  assert.equal(read.act, false, 'and so there is nothing to act on straight away');
  assert.equal(lg.teams[u].strategyFitted, true);
});

test('it is an opening position, not a hand on the tiller', () => {
  const lg = createLeague({ name: 'G', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 78, draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(78));
  startSeason(lg, PLAYERS_BY_ID);
  const u = userTeamIndex(lg);
  // The player disagrees and turns it to the other end from the read.
  const chosen = lg.teams[u].strategy.passRate > 0.5 ? 0.35 : 0.7;
  lg.teams[u].strategy.passRate = chosen;
  startSeason(lg, PLAYERS_BY_ID);
  assert.equal(lg.teams[u].strategy.passRate, chosen, 'a later season must not overwrite what the player chose');
});

test('the flat default only ever reached the human, which is why this existed', () => {
  // GMs are handed out when the league is created, so every AI club carries its
  // personality's pass rate from the first moment. DEFAULT_STRATEGY's 0.55 only
  // ever applied to the one club whose roster nobody had chosen for it.
  const lg = createLeague({ name: 'H', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 79, draftType: 'snake' });
  const u = userTeamIndex(lg);
  assert.equal(lg.teams[u].strategy.passRate, 0.55, 'the human starts on the flat default');
  for (const [i, t] of lg.teams.entries()) {
    if (i === u) continue;
    assert.ok(t.gm, `${t.abbr} should have a GM from the start`);
    const want = GM_PERSONALITIES.find((g) => g.id === t.gm).strategy.passRate;
    assert.equal(t.strategy.passRate, want, `${t.abbr} should already be on its personality's rate`);
  }
  // After the draft the human is on a rate chosen for the roster they built.
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(79));
  startSeason(lg, PLAYERS_BY_ID);
  assert.notEqual(lg.teams[u].strategy.passRate, 0.55, 'and no longer on a rate that ignores it');
});
