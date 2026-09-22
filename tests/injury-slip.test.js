// "Expected to miss 3 weeks" used to be a certainty wearing a forecast's
// clothes: one draw of rng.int(min, max) and the man was back on exactly that
// week, every time. A week can go wrong now, and the sentence is true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../src/engine/rng.js';
import {
  tickInjuries, rollSeverity, SEASON_ENDING, SETBACK_CHANCE, AHEAD_CHANCE, SETBACK_DOUBLE,
} from '../src/engine/injuries.js';

const leagueWith = (weeks, seed = 7) => ({
  season: 1, rngState: seed,
  injuries: { p1: { weeks, kind: 'hamstring', since: null, season: 1, team: 0 } },
});
// Play one injury out week by week; returns weeks actually missed.
const missed = (start, seed) => {
  const lg = leagueWith(start, seed);
  let n = 0;
  while (lg.injuries.p1 && n < 200) { n++; tickInjuries(lg, 99); }
  return n;
};

test('a man is not always back on the week he was first given', () => {
  const runs = [];
  for (let seed = 1; seed <= 400; seed++) runs.push(missed(3, seed));
  const exact = runs.filter((r) => r === 3).length;
  assert.ok(exact < runs.length, 'every single injury ran exactly to schedule, so nothing slipped');
  assert.ok(exact > runs.length * 0.3,
    `only ${exact} of ${runs.length} ran to schedule — an estimate nobody can rely on is noise, not a forecast`);
  assert.ok(runs.some((r) => r > 3), 'nobody ever suffered a setback');
  assert.ok(runs.some((r) => r < 3), 'nobody ever came back early');
});

test('it changes how well the date is known, not how much time is lost', () => {
  // The injury dial is calibrated — see the table in DESIGN.md. A slip that
  // quietly added weeks would be making injuries worse under another name.
  const rng = new RNG(4242);
  let quoted = 0, actual = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const { weeks } = rollSeverity(rng);
    if (weeks <= 0 || weeks >= SEASON_ENDING) continue;
    quoted += weeks;
    actual += missed(weeks, 1000 + i);
    n++;
  }
  const drift = (actual - quoted) / quoted;
  assert.ok(Math.abs(drift) < 0.05,
    `total time lost drifted ${(100 * drift).toFixed(1)}% over ${n} injuries; the rates are meant to cancel`);
});

test('a season-ending injury is a verdict, not a forecast', () => {
  const lg = leagueWith(SEASON_ENDING);
  tickInjuries(lg, 99);
  assert.equal(lg.injuries.p1.weeks, SEASON_ENDING - 1, 'a torn ACL got a re-forecast');
  for (let i = 0; i < 20; i++) tickInjuries(lg, 99);
  assert.equal(lg.injuries.p1.weeks, SEASON_ENDING - 21, 'it must run straight down');
});

test('a man due back this week can still break down', () => {
  // The setback that actually happens: named in the side, broke down warming up.
  let found = false;
  for (let seed = 1; seed <= 300 && !found; seed++) {
    const lg = leagueWith(1, seed);
    tickInjuries(lg, 99);
    if (lg.injuries.p1) found = true;
  }
  assert.ok(found, 'a man on his last week always returned, so the roll happens before the decrement');
});

test('the week is rolled off the league stream, so a save replays the same', () => {
  const a = leagueWith(4, 55), b = leagueWith(4, 55);
  for (let i = 0; i < 6; i++) { tickInjuries(a, 99); tickInjuries(b, 99); }
  assert.deepEqual(a.injuries, b.injuries);
  assert.equal(a.rngState, b.rngState);
  assert.notEqual(a.rngState, 55, 'the stream must advance, or every week rolls identically');
});

test('the rates are the ones that were fitted', () => {
  assert.ok(AHEAD_CHANCE > SETBACK_CHANCE,
    'a setback costs a week and sometimes two while coming along well saves one, so early must be commoner to cancel it');
  assert.ok(SETBACK_DOUBLE > 0 && SETBACK_DOUBLE < 1);
});
