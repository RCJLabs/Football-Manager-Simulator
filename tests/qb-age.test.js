// The quarterback was the one position ageing could not touch.
//
// He is 75% mental by weight — `tha` 0.40 and `awr` 0.35 — and the mental curve
// does not turn until six seasons past the prime. So a quarterback signed at
// his best got better for seven years and was only worse than you signed him at
// thirty-seven, by which age he is retiring anyway. There was never a season in
// which a club had to decide anything about him.
//
// `tha` is a hand, not a head. It sits with the other execution skills now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, registerPlayers } from '../src/engine/season.js';
import { startCareer, stepCareer, developed, primeAge, PRIME_AGE, MENTAL, SKILL, RETIRE_OVERALL } from '../src/engine/careers.js';
import { overall } from '../src/engine/ratings.js';

registerPlayers(PLAYERS_BY_ID);
const league = (seed = 3) => createLeague({
  name: 'Q', mode: 'pro', numTeams: 32, seed, draftType: 'snake',
  user: { name: 'Me', abbr: 'ME', color: '#fff' },
});
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const bestAt = (pos, n) => PLAYERS.filter((p) => p.pos === pos)
  .sort((a, b) => overall(b) - overall(a)).slice(0, n);

/** Walk a man from his prime and report his whole arc. */
function arc(lg, p) {
  let c = startCareer(lg, p);
  let guard = 0;
  while (c.age < primeAge(p.pos) && guard++ < 25) c = stepCareer(lg, p, c, guard, 0).career;
  const track = [];
  for (let y = 0; y <= 20; y++) {
    const o = overall(developed(p, c));
    track.push({ age: c.age, o });
    if (c.age >= c.retireAt || o < RETIRE_OVERALL) break;
    c = stepCareer(lg, p, c, 700 + y, 0).career;
  }
  const best = Math.max(...track.map((t) => t.o));
  return { track, best, peakAge: track.find((t) => t.o === best).age, last: track[track.length - 1].o };
}

test('a quarterback ages, which he did not', () => {
  const lg = league(3);
  const rows = bestAt('QB', 40).map((p) => arc(lg, p));
  assert.ok(rows.length >= 30, `only ${rows.length} quarterbacks`);
  // He has to fall away from his own peak by something a club would notice.
  // Measured at 4.7 before this and 7.9 after, against 8.9 to 17.4 elsewhere.
  const fall = mean(rows.map((r) => r.best - r.last));
  assert.ok(fall > 6, `a quarterback falls ${fall.toFixed(1)} from his peak across a career — ageing does not reach him`);
  // And nearly all of them, not a lucky few.
  const declined = rows.filter((r) => r.best - r.last >= 3).length / rows.length;
  assert.ok(declined > 0.85, `only ${(100 * declined).toFixed(0)}% of quarterbacks ever decline by three`);
});

test('but he still ages better than anybody else', () => {
  // The fix must not turn him into a running back. The whole point of a
  // quarterback is that he lasts, and 75% of his rating is still head and hands
  // rather than legs.
  const lg = league(4);
  const qb = mean(bestAt('QB', 40).map((p) => { const a = arc(lg, p); return a.best - a.last; }));
  for (const pos of ['RB', 'WR', 'DL', 'CB', 'S', 'LB', 'TE']) {
    const other = mean(bestAt(pos, 40).map((p) => { const a = arc(lg, p); return a.best - a.last; }));
    assert.ok(qb < other, `quarterbacks fall ${qb.toFixed(1)} and ${pos} ${other.toFixed(1)} — the quarterback must age best`);
  }
});

test('he peaks about when he is meant to', () => {
  // PRIME_AGE says where a position peaks. Every other position lands within
  // half a year of its own number; the quarterback was 2.2 years past his,
  // because 40% of him was still climbing six seasons out.
  const lg = league(5);
  const peak = mean(bestAt('QB', 40).map((p) => arc(lg, p).peakAge));
  assert.ok(peak <= PRIME_AGE.QB + 1.5,
    `quarterbacks peak at ${peak.toFixed(1)} against a stated prime of ${PRIME_AGE.QB}`);
});

test('throwing accuracy is filed with the other things a player does', () => {
  // The line: reading the game is mental, executing is a skill. If `tha` ever
  // goes back in with `awr`, the three tests above are what fails — this one
  // says why, so the next person does not re-tune the curve to compensate.
  assert.ok(SKILL.includes('tha'), 'throwing accuracy belongs with catching, blocking and coverage');
  assert.ok(!MENTAL.includes('tha'), 'throwing accuracy is not what a quarterback knows, it is what he does');
  assert.ok(MENTAL.includes('awr'), 'awareness is still the head');
});
