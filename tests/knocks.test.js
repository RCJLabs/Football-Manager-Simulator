import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { overall } from '../src/engine/ratings.js';
import { createLeague } from '../src/engine/season.js';
import { recordGameInjuries, SEASON_ENDING } from '../src/engine/injuries.js';
import {
  startCareer, stepCareer, developed, advanceCareers, primeAge,
  KNOCK_PHYSICAL, KNOCK_GENERAL, KNOCK_YEARS, positionPeak, ceilingFor,
} from '../src/engine/careers.js';
import { RNG } from '../src/engine/rng.js';

const league = (seed = 3) => createLeague({ name: 'K', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction' });
const find = (name) => PLAYERS.find((p) => p.name === name);

/** A finished game carrying one injury of the given severity. */
function gameWith(id, weeks) {
  return { teams: [{ injuries: [{ id, weeks, kind: weeks >= SEASON_ENDING ? 'torn ACL' : 'hamstring' }] }, { injuries: [] }] };
}

test('only the worst band leaves a mark', () => {
  const lg = league();
  recordGameInjuries(lg, gameWith('a', 4), [0, 1], 2);
  assert.equal(lg.knocks ? Object.keys(lg.knocks).length : 0, 0, 'a four-week hamstring is just weeks');
  recordGameInjuries(lg, gameWith('b', SEASON_ENDING), [0, 1], 2);
  assert.equal(lg.knocks.b, 1, 'a season-ender is noted');
  recordGameInjuries(lg, gameWith('b', SEASON_ENDING), [0, 1], 3);
  assert.equal(lg.knocks.b, 2, 'and they accumulate');
  assert.ok(lg.injuries.a && lg.injuries.b, 'both are still ordinary injuries too');
});

test('a knock costs rating and a year, and the legs most of all', () => {
  const lg = league();
  const rb = find('Walter Payton');
  const c = { ...startCareer(lg, rb), age: primeAge('RB') };
  const clean = stepCareer(lg, rb, c, 1, 0);
  const hurt = stepCareer(lg, rb, c, 1, 1);
  assert.ok(hurt.after < clean.after, 'he comes back worse');
  assert.equal(clean.career.retireAt - hurt.career.retireAt, KNOCK_YEARS, 'and a year shorter');
  assert.equal(hurt.career.knocks, 1);
  // The legs take it: speed should fall further than ball security.
  const dSpd = (clean.career.d.spd || 0) - (hurt.career.d.spd || 0);
  const dCar = (clean.career.d.car || 0) - (hurt.career.d.car || 0);
  assert.ok(dSpd > dCar, `speed lost ${dSpd.toFixed(2)} against ball security's ${dCar.toFixed(2)}`);
  assert.ok(KNOCK_PHYSICAL > KNOCK_GENERAL, 'which is what the two constants say');
});

test('a back loses more to a knee than a quarterback does', () => {
  // The whole reason the toll leans on physical attributes: a knee ends a
  // running back and dents a quarterback.
  const lg = league();
  const cost = (p) => {
    const c = { ...startCareer(lg, p), age: primeAge(p.pos) };
    return stepCareer(lg, p, c, 1, 0).after - stepCareer(lg, p, c, 1, 1).after;
  };
  assert.ok(cost(find('Walter Payton')) > cost(find('Joe Montana')), 'the back should lose more');
  // And nobody escapes it entirely, which is why there is a general figure at
  // all — a lineman carries no physical attribute and used to shrug this off.
  assert.ok(cost(find('Anthony Muñoz')) >= 1, 'a lineman feels it too');
});

test('the same knee is not charged twice', () => {
  const lg = league();
  const p = find('Barry Sanders');
  lg.teams[0].slots.RB1 = p.id;
  lg.knocks = { [p.id]: 1 };
  const first = advanceCareers(lg, byId, { season: 1 });
  assert.deepEqual(lg.knocks, {}, 'the ledger is settled');
  assert.equal(first.hurt.length, 1);
  assert.equal(first.hurt[0].id, p.id);
  const before = lg.dev[p.id] && lg.dev[p.id].knocks;
  advanceCareers(lg, byId, { season: 2 });
  assert.equal(lg.dev[p.id] ? lg.dev[p.id].knocks : before, before, 'and the count does not climb on its own');
});

test('an older man is hurt worse by the same injury', () => {
  const lg = league();
  const p = find('Emmitt Smith');
  const at = (age) => {
    const c = { ...startCareer(lg, p), age };
    return stepCareer(lg, p, c, 1, 0).after - stepCareer(lg, p, c, 1, 1).after;
  };
  const prime = primeAge('RB');
  assert.ok(at(prime + 6) > at(prime), 'thirty-one is not twenty-five');
});

test('the mark travels with the player so a screen can say why', () => {
  const lg = league();
  const p = find('Jim Brown');
  const c = { ...startCareer(lg, p), age: primeAge('RB') };
  const hurt = stepCareer(lg, p, c, 1, 1).career;
  const view = developed(p, hurt);
  assert.equal(view.knocks, 1);
  assert.ok(overall(view) < overall(p), 'and he reads lower than the man in the pool');
  assert.equal(developed(p, { ...c, d: {} }).knocks, 0, 'an unmarked career says zero, not undefined');
});

// The ceiling is the promise that a generated player cannot outgrow the best
// man who ever played his position. It was being broken two ways at once, and
// neither showed up in a unit test because neither function breaks its own
// contract — `stepCareer` returned exactly what its inputs asked for, and the
// inputs were wrong. This walks careers instead of checking a call.
test('nobody finishes a season above his own ceiling, knocks and all', () => {
  const lg = league(11);
  let steps = 0;
  const over = [];
  for (const p of PLAYERS.slice(0, 120)) {
    let c = startCareer(lg, p);
    for (let s = 0; s < 14; s++) {
      // Knock him on a schedule rather than at random: the bug only appeared
      // in the seasons AFTER an injury, so a career has to carry one forward.
      c = stepCareer(lg, p, c, s, s % 5 === 0 ? 1 : 0).career;
      steps++;
      const cap = c.ceiling ?? 99;
      const now = overall(developed(p, c));
      if (now > cap) over.push(`${p.name} ${now} > ${cap}`);
    }
  }
  assert.ok(steps > 1000, 'the walk is long enough to be worth anything');
  assert.deepEqual(over, [], 'careers that finished above their own ceiling');
});

test('a knock lowers the ceiling by what it cost, not to where it left him', () => {
  const lg = league(12);
  const p = find('Jim Brown');
  // Well before prime: past it `step` returns decline, so nobody grows through
  // anything and the test would pass or fail for the wrong reason.
  const c = { ...startCareer(lg, p), age: primeAge('RB') - 6 };
  // Give him room to grow into, so "frozen where the injury left him" and
  // "dropped by the damage" are distinguishable at all. The figure is set by
  // hand rather than taken from `positionPeak`, because what is under test here
  // is how a knock moves a ceiling, not where the ceiling started.
  const roomy = { ...c, ceiling: overall(developed(p, c)) + 8 };
  const hurt = stepCareer(lg, p, roomy, 1, 1).career;
  const nowWorth = overall(developed(p, hurt));
  assert.ok(hurt.ceiling < roomy.ceiling, 'the ceiling comes down');
  assert.ok(hurt.ceiling > nowWorth, 'but not all the way to what he is worth today');

  // And the room survives: he can still climb afterwards.
  let c2 = hurt;
  for (let s = 2; s < 6; s++) c2 = stepCareer(lg, p, c2, s, 0).career;
  assert.ok(overall(developed(p, c2)) > nowWorth, 'a marked man can still grow through it');
});

test('a generated rookie cannot outgrow the best man at his position', () => {
  const lg = league(13);
  for (const pos of ['P', 'LB', 'S', 'TE', 'RB', 'QB']) {
    const peak = positionPeak(pos);
    const best = Math.max(...PLAYERS.filter((p) => p.pos === pos).map((p) => overall(p)));
    assert.equal(peak, best, `${pos}: the peak is read off the pool, not guessed`);
    // A maximal prospect: top entry, top growth, every roll in his favour.
    for (const entry of [70, 80, 88]) {
      assert.ok(ceilingFor(entry, 1.5, new RNG(entry), pos) <= Math.max(entry, peak),
        `${pos}: a ceiling at entry ${entry} stays inside the position's peak`);
    }
  }
});
