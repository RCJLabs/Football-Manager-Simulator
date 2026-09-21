import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS } from '../src/data/players.js';
import { overall, rawOverall } from '../src/engine/ratings.js';
import { POSITIONS } from '../src/data/positions.js';
import { auditLegacy, LEGACY, TIERS, TOLERANCE } from '../scripts/legacy-check.mjs';

test('every recorded season in the yardstick is still in the pool', () => {
  const { missing } = auditLegacy();
  assert.deepEqual(missing, [], `the table names players the pool no longer has: ${missing.join(', ')}`);
});

test('no rating drifts below what the record supports, except where the weights forbid it', () => {
  const { found } = auditLegacy();
  const bad = found.filter((f) => f.gap >= TOLERANCE);
  // What is left is not a rating anybody can argue with: for each of these the
  // position's weight vector cannot reach the floor even with the player's best
  // attribute at 99. Thirteen are edge rushers — pass rush is 15% of a
  // linebacker and run defence is 35% of a lineman, so the one thing they were
  // paid for is the one thing the formula barely counts.
  for (const f of bad) {
    assert.ok(f.ceiling < f.floor,
      `${f.p.name} '${f.p.season} is ${f.ovr} against a floor of ${f.floor} and could reach ${f.ceiling}; that is the rating, not the weights`);
  }
  assert.ok(bad.length <= 16, `${bad.length} ratings now miss the record, was 16`);
});

test('a bust stays a bust', () => {
  const { found } = auditLegacy();
  const busts = found.filter((f) => f.tiers.includes('bust'));
  assert.ok(busts.length >= 15, 'the pool still carries its cautionary tales');
  for (const f of busts) {
    assert.ok(f.ovr <= TIERS.bust.ceiling + 2, `${f.p.name} '${f.p.season} is rated ${f.ovr} for a player who did not work out`);
  }
});

test('the yardstick asks for a floor the pool can actually reach', () => {
  // A floor above the best player at the position would be unfalsifiable.
  const best = {};
  for (const p of PLAYERS) best[p.pos] = Math.max(best[p.pos] || 0, overall(p));
  for (const [key, tiers] of Object.entries(LEGACY)) {
    const floor = Math.max(...tiers.map((t) => TIERS[t].floor ?? -Infinity));
    if (!Number.isFinite(floor)) continue;
    const pos = key.split('|')[0];
    for (const p of PLAYERS) { if (`${p.name}|${p.season}` === key) assert.ok(floor <= best[p.pos], `${key}: floor ${floor} exceeds the best ${p.pos} in the pool`); }
  }
});

test('the ceiling diagnostic is computed from the real weights', () => {
  // Guards the claim the second test leans on: `ceiling` is the player's own
  // row with his strongest attribute at 99, scored by the same formula.
  const p = PLAYERS.find((x) => x.name === 'Derrick Thomas' && x.season === 1990);
  assert.ok(p);
  const attrs = POSITIONS.LB.attrs;
  const best = attrs.reduce((a, b) => (p.r[a] >= p.r[b] ? a : b));
  assert.equal(best, 'prs', 'the pool still knows what he was paid for');
  assert.equal(rawOverall('LB', { ...p.r, prs: 99 }), auditLegacy().found.find((f) => f.p.id === p.id).ceiling);
});
