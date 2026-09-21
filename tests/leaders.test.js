import test from 'node:test';
import assert from 'node:assert/strict';
import { statLeaders } from '../src/ui/charts.js';
import { emptyPlayerStats } from '../src/engine/stats.js';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame, step } from '../src/engine/game.js';

const byId = (names) => new Map(Object.entries(names).map(([id, name]) => [id, { id, name }]));
const line = (patch) => { const s = emptyPlayerStats(); for (const [k, v] of Object.entries(patch)) Object.assign(s[k], v); return s; };

test('nobody with a zero appears', () => {
  assert.deepEqual(statLeaders(null, byId({})), []);
  assert.deepEqual(statLeaders(undefined, byId({})), []);
  assert.deepEqual(statLeaders({}, byId({})), []);
  // A player who took the field and did nothing is not a leader.
  assert.deepEqual(statLeaders({ a: emptyPlayerStats() }, byId({ a: 'A. Nobody' })), []);
  // Only the slots with something in them.
  const only = statLeaders({ a: line({ rush: { att: 3, yds: 12 } }) }, byId({ a: 'R. Back' }));
  assert.deepEqual(only.map((l) => l.kind), ['rush']);
});

test('a player the roster cannot name is skipped rather than rendered blank', () => {
  const rows = statLeaders({ ghost: line({ pass: { yds: 300 } }) }, byId({}));
  assert.deepEqual(rows, []);
});

test('the offensive slots rank on yards', () => {
  const players = {
    qb1: line({ pass: { att: 20, cmp: 14, yds: 180, td: 2 } }),
    qb2: line({ pass: { att: 9, cmp: 4, yds: 200, td: 0, int: 1 } }),
    rb1: line({ rush: { att: 11, yds: 40 } }),
    rb2: line({ rush: { att: 4, yds: 55, td: 1 } }),
    wr1: line({ rec: { rec: 6, yds: 70 } }),
  };
  const names = byId({ qb1: 'A. One', qb2: 'B. Two', rb1: 'C. Three', rb2: 'D. Four', wr1: 'E. Five' });
  const got = Object.fromEntries(statLeaders(players, names).map((l) => [l.kind, l]));
  assert.equal(got.pass.name, 'B. Two', 'more yards on fewer completions still leads');
  assert.match(got.pass.line, /4\/9, 200 yds, 0 TD, 1 INT/);
  assert.equal(got.rush.name, 'D. Four');
  assert.match(got.rush.line, /4 car, 55 yds, 1 TD/);
  // A touchdown-less line does not carry an empty TD clause.
  assert.equal(got.rec.name, 'E. Five');
  assert.equal(got.rec.line, '6 rec, 70 yds');
});

test('the defender is ranked on what a spectator remembers, not on tackles', () => {
  const players = {
    lb: line({ def: { tkl: 14 } }),                   // most tackles, nothing else
    cb: line({ def: { tkl: 2, int: 1 } }),            // weight 3
    de: line({ def: { tkl: 3, sck: 1, ff: 1 } }),     // weight 4
  };
  const names = byId({ lb: 'L. Backer', cb: 'C. Corner', de: 'D. End' });
  const got = statLeaders(players, names).find((l) => l.kind === 'def');
  assert.equal(got.name, 'D. End', 'a sack and a forced fumble beats one interception');
  assert.equal(got.line, '1 sck, 1 FF');
  // The tackle machine never leads on tackles alone.
  const onlyTackles = statLeaders({ lb: players.lb }, names);
  assert.deepEqual(onlyTackles, [], 'fourteen tackles is not a highlight');
});

test('a real game produces leaders that grow with it and never exceed four', () => {
  const A = syntheticTeam('alpha', 86, 3, 1);
  const B = syntheticTeam('bravo', 84, 3, 2);
  const g = createGame({ ...A, lineup: buildLineup(A.slots, A.byId) }, { ...B, lineup: buildLineup(B.slots, B.byId) }, { seed: 9600 });
  // Both clubs' players in one map, the way the view's ctx.byId is shaped.
  const lookup = new Map([...A.byId, ...B.byId]);
  assert.ok(lookup.size > 40, `only ${lookup.size} players to name`);
  assert.equal(statLeaders(g.stats[0].players, lookup).length, 0, 'nothing before the kickoff');
  for (let i = 0; i < 60; i++) step(g);
  for (const side of [0, 1]) {
    const rows = statLeaders(g.stats[side].players, lookup);
    assert.ok(rows.length <= 4, `${rows.length} leaders`);
    assert.deepEqual(rows.map((r) => r.kind), rows.map((r) => r.kind).filter((k) => ['pass', 'rush', 'rec', 'def'].includes(k)));
    for (const r of rows) assert.ok(r.name && r.line, `${r.kind} row is blank`);
  }
  simulateGame(g);
  const done = statLeaders(g.stats[0].players, lookup);
  assert.ok(done.length >= 3, `only ${done.length} leaders in a finished game`);
  // Real names off the roster, not ids leaking through.
  for (const r of done) assert.ok(lookup.has(r.id) && r.name === lookup.get(r.id).name, `${r.kind}: ${r.name}`);
});
