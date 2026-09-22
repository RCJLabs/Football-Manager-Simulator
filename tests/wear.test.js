// How a man ages, which until now was not a fact about him at all.
//
// `step`'s growth branch is scaled per player twice over, by `growth` and by
// `pace`. Its decline branch was `-(drop + accel * past)` for everybody: the
// same slope for every man at every position. Measured before `wear` existed, a
// season past prime cost -0.58 at the prime and -2.14 ten years on, with a
// standard deviation of 0.7 that was per-attribute noise and nothing else, and
// no career in 2,400 ever lost six points in a season.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, registerPlayers } from '../src/engine/season.js';
import { generateRookies } from '../src/engine/rookies.js';
import { startCareer, stepCareer, developed, primeAge, ceilingFor, RETIRE_OVERALL } from '../src/engine/careers.js';
import { overall } from '../src/engine/ratings.js';
import { RNG, hashSeed } from '../src/engine/rng.js';

registerPlayers(PLAYERS_BY_ID);
const league = (seed = 5) => createLeague({
  name: 'W', mode: 'pro', numTeams: 32, seed, draftType: 'snake',
  user: { name: 'Me', abbr: 'ME', color: '#fff' },
});
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Walk a man to his prime, then report what the next `n` seasons cost him. */
function declineOver(lg, p, c, n) {
  const prime = primeAge(p.pos);
  let guard = 0;
  while (c.age < prime && guard++ < 25) c = stepCareer(lg, p, c, guard, 0).career;
  const at0 = overall(developed(p, c));
  let played = 0;
  for (let y = 0; y < n; y++) {
    if (c.age >= c.retireAt || overall(developed(p, c)) < RETIRE_OVERALL) break;
    c = stepCareer(lg, p, c, 100 + y, 0).career;
    played++;
  }
  return played === n ? overall(developed(p, c)) - at0 : null;
}

test('wear decides how he falls away and leaves the climb alone', () => {
  const lg = league(5);
  const top = PLAYERS.slice().sort((a, b) => overall(b) - overall(a)).slice(0, 300);
  const rows = [];
  for (const p of top) {
    const c = startCareer(lg, p);
    const d = declineOver(lg, p, c, 5);
    if (d !== null) rows.push({ wear: c.wear ?? 1, d });
  }
  assert.ok(rows.length >= 120, `only ${rows.length} careers reached five seasons past prime`);
  const kind = rows.filter((r) => r.wear < 0.85);
  const hard = rows.filter((r) => r.wear > 1.15);
  assert.ok(kind.length >= 25 && hard.length >= 25, 'the draw produces both kinds');
  // The whole point: a man who ages well loses materially less.
  assert.ok(mean(kind.map((r) => r.d)) > mean(hard.map((r) => r.d)) + 2,
    `ages well ${mean(kind.map((r) => r.d)).toFixed(2)} vs falls off ${mean(hard.map((r) => r.d)).toFixed(2)} over five seasons — wear must move decline`);

  // And it must not touch the way up, or it is `growth` again under a new name.
  const lgr = league(6);
  const rookies = generateRookies(lgr, new RNG(6)) || [];
  const climbs = [];
  for (const p of rookies) {
    let c = startCareer(lgr, p);
    const at0 = overall(developed(p, c));
    for (let y = 0; y < 3; y++) c = stepCareer(lgr, p, c, y, 0).career;
    climbs.push({ wear: c.wear ?? 1, gain: overall(developed(p, c)) - at0 });
  }
  const kindUp = climbs.filter((r) => r.wear < 0.85).map((r) => r.gain);
  const hardUp = climbs.filter((r) => r.wear > 1.15).map((r) => r.gain);
  assert.ok(kindUp.length >= 3 && hardUp.length >= 3, 'both kinds among the rookies');
  assert.ok(Math.abs(mean(kindUp) - mean(hardUp)) < 2.5,
    `young gains ${mean(kindUp).toFixed(2)} vs ${mean(hardUp).toFixed(2)} — wear must not scale the climb`);
});

test('a career stored before wear existed ages exactly as it did', () => {
  const lg = league(7);
  const p = PLAYERS.slice().sort((a, b) => overall(b) - overall(a))[3];
  const base = startCareer(lg, p);
  // Walk him past his prime so the decline branch is the one being exercised.
  let c = base;
  const prime = primeAge(p.pos);
  let guard = 0;
  while (c.age <= prime + 1 && guard++ < 25) c = stepCareer(lg, p, c, guard, 0).career;
  const withWear = { ...c, wear: 1 };
  const legacy = { ...c };
  delete legacy.wear;
  assert.equal(stepCareer(lg, p, legacy, 1, 0).after, stepCareer(lg, p, withWear, 1, 0).after,
    'a career with no wear field must step like wear 1');
});

test('how a man has aged is a read on how he will age', () => {
  // This is the only thing a club is ever told: `wear` itself is never shown.
  // The read has to survive being compared at ONE age, because otherwise it is
  // just restating the age badge — an older man declines faster whatever he is.
  const lg = league(9);
  const top = PLAYERS.slice().sort((a, b) => overall(b) - overall(a)).slice(0, 400);
  const byAge = {};
  for (const p of top) {
    let c = startCareer(lg, p);
    const prime = primeAge(p.pos);
    let guard = 0;
    while (c.age < prime && guard++ < 25) c = stepCareer(lg, p, c, guard, 0).career;
    const start = overall(developed(p, c));
    let ok = true;
    for (let y = 0; y < 4; y++) {
      if (c.age >= c.retireAt || overall(developed(p, c)) < RETIRE_OVERALL) { ok = false; break; }
      c = stepCareer(lg, p, c, 200 + y, 0).career;
    }
    if (!ok) continue;
    const mid = overall(developed(p, c));
    let played = 0;
    for (let y = 0; y < 3; y++) {
      if (c.age >= c.retireAt || overall(developed(p, c)) < RETIRE_OVERALL) break;
      c = stepCareer(lg, p, c, 300 + y, 0).career;
      played++;
    }
    if (played < 3) continue;
    (byAge[c.age] ??= []).push({ shown: mid - start, next: overall(developed(p, c)) - mid });
  }
  const gaps = [];
  for (const list of Object.values(byAge)) {
    if (list.length < 40) continue;
    const srt = list.slice().sort((a, b) => a.shown - b.shown);
    const third = Math.floor(list.length / 3);
    gaps.push(mean(srt.slice(-third).map((r) => r.next)) - mean(srt.slice(0, third).map((r) => r.next)));
  }
  assert.ok(gaps.length >= 2, `only ${gaps.length} ages had enough men to compare within`);
  // Worth about four points over a three-year keeper window. Measured at 2.57
  // before wear existed, from injury luck and accumulated noise alone.
  assert.ok(mean(gaps) > 0.8,
    `men who had held up gain only ${mean(gaps).toFixed(2)} a season on men who had slid — the read says nothing`);
});

test('the arc traits do not disturb the ceiling draw', () => {
  // `ceilingFor` draws from the career RNG, so anything drawn from that stream
  // before it re-rolls every prospect's ceiling. `pace` did exactly that and
  // moved the share of a class peaking at 80+ from 18.8% to 19.8%, which reads
  // like a tuning change and was a shifted seed. The arc traits now come off
  // their own stream, so adding another one costs nothing.
  const lg = league(11);
  const rookies = (generateRookies(lg, new RNG(11)) || []).slice(0, 40);
  assert.ok(rookies.length >= 20, 'need a class to check');

  // The invariant is the draw ORDER, so it has to be stated as the draw order.
  // A first version of this test asserted that startCareer is deterministic and
  // that the traits are in range — both true whichever stream they come off, so
  // moving pace and wear back onto the career stream passed it cleanly.
  const reference = (p) => {
    const rng = new RNG(hashSeed(`career:${lg.seed >>> 0}:${p.id}`));
    const prime = primeAge(p.pos);
    p.generated ? rng.int(-1, 1) : rng.int(-2, 2);        // age
    let growth = rng.normal(1, 0.3);                       // growth
    if (rng.chance(0.09)) growth += 0.7;
    else if (rng.chance(0.1)) growth -= 0.45;
    const g = Math.round(Math.max(0.15, Math.min(2.2, growth)) * 100) / 100;
    rng.int(-2, 3);                                        // retireAt jitter
    return ceilingFor(overall(p), g, rng, p.pos);          // and then the ceiling
  };
  for (const p of rookies) {
    assert.equal(startCareer(lg, p).ceiling, reference(p),
      `${p.name}'s ceiling moved — something else is drawing from the career stream before ceilingFor`);
  }

  for (const p of rookies) {
    const c = startCareer(lg, p);
    assert.ok(c.wear > 0 && c.wear <= 2, `wear out of range: ${c.wear}`);
    assert.ok(c.pace > 0 && c.pace <= 1.8, `pace out of range: ${c.pace}`);
    assert.ok(c.ceiling >= c.entry, 'a ceiling below the entry rating');
  }
  // The traits must actually vary, or the separate stream is hiding a constant.
  assert.ok(new Set(rookies.map((p) => startCareer(lg, p).wear)).size >= 10,
    'wear does not vary across a class');
});

test('a screen can say how long it took, not just how far he fell', () => {
  // `from` was already taken — `advanceCareers` writes it as the league season
  // a career began, and it spreads over whatever `startCareer` returned. Naming
  // the entry age `from` made every veteran read "down 7 in 35 seasons".
  const lg = league(13);
  const p = PLAYERS.slice().sort((a, b) => overall(b) - overall(a))[10];
  let c = startCareer(lg, p);
  assert.equal(c.startAge, c.age, 'a fresh career has played no seasons');
  assert.equal(developed(p, c).seasons, 0, 'a fresh career reads zero seasons');
  for (let y = 0; y < 4; y++) c = stepCareer(lg, p, c, y, 0).career;
  assert.equal(developed(p, c).seasons, 4, `four seasons stepped, screen says ${developed(p, c).seasons}`);
  // An old save has no startAge and must simply not get the rate.
  const legacy = { ...c };
  delete legacy.startAge;
  assert.equal(developed(p, legacy).seasons, null, 'a career without startAge must not invent a rate');
});
