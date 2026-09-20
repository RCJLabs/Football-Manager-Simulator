import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import {
  createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek,
  thinLog, thinCompletedLogs,
} from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { enterOffseason, takeJob } from '../src/engine/offseason.js';
import { blankCareer, packCareers, unpackCareers } from '../src/engine/awards.js';
import { loadRegistry, createSlot, writeSlot, readSlot, slotKey } from '../src/slots.js';

registerPlayers(byId);

const kb = (o) => JSON.stringify(o).length / 1024;

/**
 * A pro league played through a season. `simulateWeekAi` with `includeUser`
 * keeps the log for the user's own games, which is the policy the screen uses
 * and the thing this is about.
 */
function playedSeason(seed) {
  const lg = createLeague({ name: 'S', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  return lg;
}

test('a finished season keeps the story and drops the routine plays', () => {
  const lg = playedSeason(2);
  const logged = lg.schedule.flatMap((w) => w.games).filter((g) => g.result?.log);
  assert.ok(logged.length >= 10, `only ${logged.length} games carried a log`);
  const before = kb(lg.schedule);
  const sample = logged[0].result.log;
  const scoringBefore = sample.filter((e) => e.scoring).length;
  const wpBefore = sample.filter((e) => typeof e.wp === 'number').length;

  const cut = thinCompletedLogs(lg);
  assert.equal(cut, logged.length, 'not every logged game was thinned');
  const after = kb(lg.schedule);
  assert.ok(after < before * 0.75, `schedule went ${before.toFixed(0)}KB to ${after.toFixed(0)}KB, not much of a saving`);

  const now = logged[0].result.log;
  assert.equal(logged[0].result.thinned, true);
  // What a box score still needs: every scoring play, and a win-probability
  // point for every play, because the chart spaces points by index and would
  // redraw the game if the quiet stretches went.
  assert.equal(now.filter((e) => e.scoring).length, scoringBefore, 'a scoring play was dropped');
  assert.equal(now.filter((e) => typeof e.wp === 'number').length, wpBefore, 'the win-probability line lost points');
  // And the plays that are left to print all have something to print.
  for (const e of now) assert.ok(e.text || typeof e.wp === 'number', 'an entry with nothing in it survived');
});

test('thinning twice changes nothing more', () => {
  const lg = playedSeason(3);
  thinCompletedLogs(lg);
  const once = kb(lg.schedule);
  assert.equal(thinCompletedLogs(lg), 0, 'a thinned season was thinned again');
  assert.equal(kb(lg.schedule), once);
});

test('the offseason thins the season it just finished', () => {
  const lg = playedSeason(4);
  const before = kb(lg);
  const off = enterOffseason(lg, PLAYERS, byId);
  if (off.step === 'jobs') takeJob(lg, off.carousel.offers[0].team, PLAYERS, byId);
  assert.ok(kb(lg) < before, `the save did not come down: ${before.toFixed(0)}KB to ${kb(lg).toFixed(0)}KB`);
  for (const g of lg.schedule.flatMap((w) => w.games)) {
    if (g.result?.log) assert.equal(g.result.thinned, true, 'a log survived the offseason unthinned');
  }
});

test('nothing is thinned while the season is being played', () => {
  const lg = playedSeason(5);
  // Still 'complete' rather than in the offseason: the logs are untouched.
  const logged = lg.schedule.flatMap((w) => w.games).filter((g) => g.result?.log);
  assert.ok(logged.length > 0);
  for (const g of logged) assert.notEqual(g.result.thinned, true);
});

test('thinLog leaves a log with no win probability alone but for the routine', () => {
  const log = [
    { i: 0, type: 'drive', text: 'Drive starts' },
    { i: 1, type: 'run', text: 'run for 3', situation: '1st', wp: 0.5 },
    { i: 2, type: 'pass', text: 'pass for 9', situation: '2nd', wp: 0.52 },
    { i: 3, type: 'td', scoring: true, text: 'touchdown', situation: '3rd', wp: 0.71 },
    { i: 4, type: 'run', text: 'no wp here' },
  ];
  const out = thinLog(log);
  assert.deepEqual(out.map((e) => e.type ?? null), ['drive', null, null, 'td']);
  assert.equal(out[3].text, 'touchdown');
  // A routine play with no win probability has nothing left to keep, so it goes.
  assert.equal(out.length, 4);
  assert.deepEqual(Object.keys(out[1]).sort(), ['q', 'wp']);
});

test('a save drops its career zeroes on the way out and gets them back', () => {
  const careers = {
    qb: { ...blankCareer(), seasons: 3, games: 45, passYds: 12000, passTd: 90, teams: [2, 5], last: 3 },
    lb: { ...blankCareer(), seasons: 1, games: 16, tackles: 110, sacks: 6, last: 3 },
  };
  const packed = packCareers(careers);
  assert.equal('sacks' in packed.qb, false, 'a zero survived the pack');
  assert.equal('teams' in packed.lb, false, 'an empty list survived the pack');
  assert.ok(JSON.stringify(packed).length < JSON.stringify(careers).length * 0.6);
  assert.deepEqual(unpackCareers(packed), careers, 'the round trip lost something');
  // The thing this is guarding: a reader doing arithmetic on a field nobody
  // set gets a number, not NaN.
  assert.equal(unpackCareers(packed).qb.sacks + 1, 1);
});

test('a slot round trip keeps the league whole', () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const lg = playedSeason(6);
  lg.careers = { a: { ...blankCareer(), seasons: 2, games: 30, recYds: 800, last: 2 } };
  const reg = loadRegistry(storage);
  const id = createSlot(storage, reg, 'Round trip', { force: true });
  writeSlot(storage, reg, id, { league: lg, game: null });
  // What went to storage is packed; what comes back is not.
  assert.equal(JSON.parse(storage.getItem(slotKey(id))).league.careers.a.sacks, undefined);
  const back = readSlot(storage, id);
  assert.equal(back.league.careers.a.sacks, 0);
  assert.equal(back.league.careers.a.recYds, 800);
  assert.equal(back.league.teams.length, lg.teams.length);
  // And the league still in memory was never packed behind the caller's back.
  assert.equal(lg.careers.a.sacks, 0);
});
