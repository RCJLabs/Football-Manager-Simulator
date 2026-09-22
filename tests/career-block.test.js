// `league.careers` has been filled in since awards shipped — seasons, games,
// yards, touchdowns, sacks, honours, titles, the clubs a man played for — and
// the only thing that ever read it was Hall of Fame membership. Twelve seasons
// into a dynasty you could not look at your own quarterback and see what he had
// done. Nothing new is stored for this; it was all already there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankCareer, hallScore, packCareers, unpackCareers, HOF_THRESHOLD, HOF_MIN_SEASONS } from '../src/engine/awards.js';

const qb = () => ({ ...blankCareer(), seasons: 12, games: 174, passYds: 58211, passTd: 402, rushYds: 1100, mvp: 2, allLeague: 5, leader: 3, titles: 1, teams: [0, 3], last: 12 });

test('a long career clears the hall, a short one does not', () => {
  assert.ok(hallScore(qb()) >= HOF_THRESHOLD, 'a two-time MVP with a title is not in the hall');
  const rookie = { ...blankCareer(), seasons: 1, games: 17, passYds: 3000, passTd: 18 };
  assert.ok(!(rookie.seasons >= HOF_MIN_SEASONS && hallScore(rookie) >= HOF_THRESHOLD),
    'one good year put a man in the hall');
});

test('the career table survives the trip to storage and back', () => {
  // The modal reads the unpacked shape. Packing drops zeroes to save a save,
  // so a field the block reads must come back rather than being undefined.
  const careers = { p1: qb(), p2: { ...blankCareer(), seasons: 4, games: 60, sacks: 31, tackles: 180 } };
  const back = unpackCareers(packCareers(careers));
  assert.deepEqual(back.p1, careers.p1);
  assert.deepEqual(back.p2, careers.p2);
  for (const k of Object.keys(blankCareer())) {
    assert.notEqual(back.p2[k], undefined, `${k} came back undefined, which is a NaN in a record book`);
  }
});

test('a man who never played has nothing to show', () => {
  // The block is skipped entirely on seasons === 0, so an undrafted all-timer
  // does not get an empty card with his name on it.
  const c = blankCareer();
  assert.equal(c.seasons, 0);
  assert.equal(c.games, 0);
});
