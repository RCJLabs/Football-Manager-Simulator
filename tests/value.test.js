import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionValue, TRUE_LEVERAGE, GLAMOUR } from '../src/engine/auction.js';
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

test('the board is ranked by value and the verdicts follow the ratio', () => {
  const rows = positionValue();
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].ratio >= rows[i].ratio, 'the board should read best value first');
  }
  for (const r of rows) {
    if (r.ratio >= 1.35) assert.equal(r.verdict, 'underpaid');
    else if (r.ratio >= 0.95) assert.equal(r.verdict, 'about right');
    else if (r.ratio >= 0.7) assert.equal(r.verdict, 'overpaid');
    else assert.equal(r.verdict, 'badly overpaid');
  }
});

test('the mispricing the whole auction rests on is actually there', () => {
  const rows = positionValue();
  const by = Object.fromEntries(rows.map((r) => [r.pos, r]));
  // Specialists are the clearest case and the one a new manager gets wrong.
  assert.ok(by.K.ratio < 0.5 && by.P.ratio < 0.5, 'kickers and punters should be plainly bad value');
  assert.ok(by.K.wins < 0.02 && by.P.wins < 0.02, 'and worth almost nothing');
  // There is a real spread to exploit, or the panel is teaching nothing.
  assert.ok(rows[0].ratio / rows[rows.length - 1].ratio > 3,
    `best value ${rows[0].ratio.toFixed(2)} vs worst ${rows[rows.length - 1].ratio.toFixed(2)} is too flat to be a strategy`);
  assert.ok(rows.some((r) => r.verdict === 'underpaid'), 'nothing is a bargain');
  assert.ok(rows.some((r) => r.verdict.includes('overpaid')), 'nothing is a trap');
});
