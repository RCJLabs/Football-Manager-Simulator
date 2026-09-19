import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionValue, TRUE_LEVERAGE, GLAMOUR, MATTERS_AT } from '../src/engine/auction.js';
import { POSITIONS, ROSTER_SLOTS } from '../src/data/positions.js';

test('every position the game has is on the board', () => {
  const rows = positionValue();
  assert.equal(rows.length, Object.keys(POSITIONS).length);
  for (const pos of Object.keys(POSITIONS)) {
    assert.ok(rows.some((r) => r.pos === pos), `${pos} missing from the value board`);
  }
});

test('the board is derived from the engine tables, not written down beside them', () => {
  const rows = positionValue();
  const levSum = Object.values(TRUE_LEVERAGE).reduce((a, b) => a + b, 0);
  const glamSum = Object.values(GLAMOUR).reduce((a, b) => a + b, 0);
  for (const r of rows) {
    assert.equal(r.leverage, TRUE_LEVERAGE[r.pos]);
    assert.ok(Math.abs(r.wins - TRUE_LEVERAGE[r.pos] / levSum) < 1e-9);
    assert.ok(Math.abs(r.price - GLAMOUR[r.pos] / glamSum) < 1e-9);
    assert.ok(Math.abs(r.ratio - r.wins / r.price) < 1e-9);
  }
  // Shares are shares: each set sums to one.
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.wins, 0) - 1) < 1e-9);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.price, 0) - 1) < 1e-9);
});

test('starter counts match the roster template, because the per-player unit needs them', () => {
  const rows = positionValue();
  const starters = {};
  for (const s of ROSTER_SLOTS) if (s.starter) starters[s.pos] = (starters[s.pos] || 0) + 1;
  for (const r of rows) {
    assert.equal(r.starters, starters[r.pos] || 0, `${r.pos} starters`);
    assert.ok(Math.abs(r.group - r.leverage * r.starters) < 1e-9);
  }
  // The thing the panel warns about: five cheap linemen outweigh one tight end.
  const ol = rows.find((r) => r.pos === 'OL');
  const te = rows.find((r) => r.pos === 'TE');
  assert.ok(ol.leverage < te.leverage, 'a lineman is worth less than a tight end');
  assert.ok(ol.group > te.group, 'but the line as a group is worth more');
});

test('the board is ranked by value, with what cannot matter sorted to the bottom', () => {
  const rows = positionValue();
  const real = rows.filter((r) => r.verdict !== 'barely matters');
  const trivial = rows.filter((r) => r.verdict === 'barely matters');
  for (let i = 1; i < real.length; i++) {
    assert.ok(real[i - 1].ratio >= real[i].ratio, 'the board should read best value first');
  }
  assert.deepEqual(rows.slice(real.length), trivial, 'the trivial positions belong at the end');
  for (const r of rows) {
    if (r.stake < MATTERS_AT) assert.equal(r.verdict, 'barely matters');
    else if (r.ratio >= 1.35) assert.equal(r.verdict, 'underpaid');
    else if (r.ratio >= 0.95) assert.equal(r.verdict, 'about right');
    else if (r.ratio >= 0.7) assert.equal(r.verdict, 'overpaid');
    else assert.equal(r.verdict, 'badly overpaid');
  }
});

test('a good ratio on a position nobody can win with is not called a bargain', () => {
  const rows = positionValue();
  const by = Object.fromEntries(rows.map((r) => [r.pos, r]));
  // The punter came out of the re-measurement at better value-for-money than
  // the quarterback, which is true and useless: he is 3% of a club's win
  // impact. Whatever the ratio says, the board must not call that a bargain.
  for (const pos of ['K', 'P']) {
    assert.ok(by[pos].stake < MATTERS_AT, `${pos} stake ${by[pos].stake}`);
    assert.equal(by[pos].verdict, 'barely matters');
  }
  // Linemen are cheap per man and there are five of them, so they are not
  // trivial and must not be swept up by the same rule.
  for (const pos of ['OL', 'DL']) {
    assert.ok(by[pos].stake >= MATTERS_AT, `${pos} should matter as a group`);
    assert.notEqual(by[pos].verdict, 'barely matters');
  }
});

test('the mispricing the whole auction rests on is actually there', () => {
  const rows = positionValue();
  const by = Object.fromEntries(rows.map((r) => [r.pos, r]));
  // Specialists are the clearest case and the one a new manager gets wrong —
  // but the measure that matters for them is the stake, not the ratio. The
  // re-measurement left the punter at better value-for-money than the
  // quarterback while still being a twentieth of his win impact, and an
  // earlier version of this test asserted his ratio instead, which is the
  // mistake the board itself now avoids.
  assert.ok(by.K.stake < 0.03 && by.P.stake < 0.05, 'kickers and punters cannot decide a season');
  assert.ok(by.QB.stake > by.K.stake * 10 && by.QB.stake > by.P.stake * 5, 'and a quarterback plainly can');
  // There is a real spread to exploit among the positions that matter, or the
  // panel is teaching nothing.
  const real = rows.filter((r) => r.verdict !== 'barely matters');
  assert.ok(real[0].ratio / real[real.length - 1].ratio > 3,
    `best value ${real[0].ratio.toFixed(2)} vs worst ${real[real.length - 1].ratio.toFixed(2)} is too flat to be a strategy`);
  assert.ok(rows.some((r) => r.verdict === 'underpaid'), 'nothing is a bargain');
  assert.ok(rows.some((r) => r.verdict.includes('overpaid')), 'nothing is a trap');
});
