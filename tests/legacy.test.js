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
  // What is left has to be a disagreement, not a rating nobody got round to
  // fixing. This used to assert that no violation could reach its floor at all,
  // and it passed for a bad reason: the diagnostic it leaned on perfected the
  // attribute the player was already HIGHEST at, which is the one with the least
  // room. Ronde Barber sat here for months looking unreachable and was four
  // points of `cov` away — the skill he is actually known for.
  //
  // So the bar is the price. A violation a small, defensible nudge would fix is
  // a rating to fix; one that needs six points or more of an attribute the
  // player was not known for is the weight vector refusing an archetype, which
  // is a finding and not a chore. Csonka needs `spd` +22, Riggins +11 and
  // Blanda `tha` +6 — a fullback made into a sprinter, twice, and a quarterback
  // whose case was longevity made accurate.
  for (const f of bad) {
    assert.ok(!f.route || f.route.cost >= 6,
      `${f.p.name} '${f.p.season} is ${f.ovr} against a floor of ${f.floor}, and ${f.route?.attr} ${f.route?.from} → ${f.route?.to} would fix it; that is a rating to correct, not a disagreement to record`);
  }
  assert.ok(bad.length <= 3, `${bad.length} ratings now miss the record, was 3`);
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

test('the route out of a violation is real and is the cheapest one', () => {
  // Guards the claim the test above leans on. For every violation the check
  // reports a route, that route must actually clear the floor, and nothing
  // cheaper may exist — otherwise the price it prints is not a price.
  const { found } = auditLegacy();
  const bad = found.filter((f) => f.gap >= TOLERANCE && f.under);
  assert.ok(bad.length, 'nothing to check');
  for (const f of bad) {
    assert.ok(f.route, `${f.p.name} has no route reported`);
    const { attr, from, to, cost } = f.route;
    assert.equal(from, f.p.r[attr], 'the route starts from what he is actually rated');
    assert.equal(cost, to - from, 'the cost is the distance travelled');
    assert.ok(rawOverall(f.p.pos, { ...f.p.r, [attr]: to }) >= f.floor,
      `${f.p.name}: ${attr} → ${to} does not actually reach ${f.floor}`);
    assert.ok(to === from + 1 || rawOverall(f.p.pos, { ...f.p.r, [attr]: to - 1 }) < f.floor,
      `${f.p.name}: ${attr} → ${to - 1} would have done, so the route is not the cheapest`);
    for (const a of POSITIONS[f.p.pos].attrs) {
      if (a === attr) continue;
      const cheaper = rawOverall(f.p.pos, { ...f.p.r, [a]: Math.min(99, f.p.r[a] + cost - 1) });
      assert.ok(cheaper < f.floor, `${f.p.name}: ${a} would reach the floor for less than ${attr}`);
    }
  }
});
