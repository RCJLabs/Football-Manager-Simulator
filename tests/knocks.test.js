import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { overall } from '../src/engine/ratings.js';
import { createLeague } from '../src/engine/season.js';
import { recordGameInjuries, SEASON_ENDING } from '../src/engine/injuries.js';
import {
  startCareer, stepCareer, developed, advanceCareers, primeAge,
  KNOCK_PHYSICAL, KNOCK_GENERAL, KNOCK_YEARS,
} from '../src/engine/careers.js';

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
