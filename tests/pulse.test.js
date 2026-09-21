import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { advanceWeekWithMoves } from '../src/engine/transactions.js';
import { SEASON_ENDING } from '../src/engine/injuries.js';
import { weekPulse, quietWeek, BLOWOUT, STREAK, INJURY_WEEKS } from '../src/engine/pulse.js';

registerPlayers(PLAYERS_BY_ID);

/** A league played out for `weeks`, so there is something to report on. */
function played(seed, weeks = 8, opts = {}) {
  const lg = createLeague({ name: 'P', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, draftType: 'auction', injuries: 'high', ...opts });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), PLAYERS_BY_ID);
  startSeason(lg, PLAYERS_BY_ID);
  const rng = new RNG(seed + 1);
  for (let w = 0; w < weeks && lg.phase === 'season'; w++) {
    simulateWeekAi(lg, PLAYERS_BY_ID, { includeUser: true });
    advanceWeekWithMoves(lg, PLAYERS_BY_ID, PLAYERS, rng, advanceWeek);
  }
  return lg;
}

test('a played week produces a readable digest', () => {
  const lg = played(44);
  const items = weekPulse(lg, PLAYERS_BY_ID, 3);
  assert.ok(items.length > 0, 'a week of twelve clubs produced nothing to say');
  assert.ok(items.length <= 6, `${items.length} items is too many to read`);
  for (const it of items) {
    assert.ok(typeof it.text === 'string' && it.text.length > 10, `weak line: ${it.text}`);
    assert.match(it.text, /\.$/, `a line should be a sentence: ${it.text}`);
    assert.ok(typeof it.kind === 'string' && it.kind.length);
    assert.ok(Number.isFinite(it.weight));
  }
});

test('it reads the same way every time, because a shared league has to agree', () => {
  const lg = played(44);
  const a = weekPulse(lg, PLAYERS_BY_ID, 3);
  const b = weekPulse(lg, PLAYERS_BY_ID, 3);
  assert.deepEqual(a, b);
});

test('the most interesting thing is first, and a week is not all one kind', () => {
  const lg = played(44, 10);
  for (const wk of [2, 4, 6, 8]) {
    const items = weekPulse(lg, PLAYERS_BY_ID, wk);
    for (let i = 1; i < items.length; i++) {
      assert.ok(items[i - 1].weight >= items[i].weight, `week ${wk} is out of order`);
    }
    // One of each kind comes before a second of any kind, so a week of five
    // blowouts still reads as a week rather than a list of blowouts.
    const kinds = items.map((x) => x.kind);
    const firstRepeat = kinds.findIndex((k, i) => kinds.indexOf(k) !== i);
    if (firstRepeat !== -1) {
      const distinct = new Set(kinds.slice(0, firstRepeat)).size;
      assert.equal(distinct, firstRepeat, `week ${wk} repeated a kind before exhausting the others`);
    }
  }
});

test('a week nobody played reports nothing rather than guessing', () => {
  const lg = played(44, 3);
  assert.deepEqual(weekPulse(lg, PLAYERS_BY_ID, 99), []);
  assert.equal(quietWeek(lg, 99), null);
  assert.deepEqual(weekPulse({ teams: [], schedule: null }, PLAYERS_BY_ID, 1), []);
});

test('a season-ending injury is not reported as ninety-nine weeks', () => {
  // SEASON_ENDING is a sentinel, and printing it is the kind of thing nobody
  // notices until it is on screen.
  // Seeds are searched rather than pinned: whether anybody's season ends inside
  // ten weeks is a draw, and a rating change shifts the stream that decides it.
  // The sentinel check below runs on every seed tried, so widening the search
  // strengthens that half rather than weakening it.
  let sawSeasonEnder = false;
  for (let seed = 44; seed < 60 && !sawSeasonEnder; seed++) {
    const lg = played(seed, 10);
    for (let wk = 1; wk <= 10; wk++) {
      for (const it of weekPulse(lg, PLAYERS_BY_ID, wk, { limit: 40 })) {
        assert.ok(!it.text.includes(`${SEASON_ENDING} week`), `printed the sentinel: ${it.text}`);
        if (it.kind === 'injury' && /for the season/.test(it.text)) sawSeasonEnder = true;
      }
    }
  }
  assert.ok(sawSeasonEnder, 'no seed on the high injury setting ended anybody\'s season in ten weeks');
});

test('what it says about a game matches what the game actually was', () => {
  const lg = played(52, 8);
  const byText = new Map();
  for (let wk = 1; wk <= 6; wk++) {
    for (const it of weekPulse(lg, PLAYERS_BY_ID, wk, { limit: 40 })) byText.set(it.text, { ...it, wk });
  }
  for (const [text, it] of byText) {
    const games = lg.schedule[it.wk - 1].games.filter((e) => e.result);
    if (it.kind === 'blowout') {
      const m = text.match(/won by (\d+)/);
      assert.ok(m, text);
      assert.ok(Number(m[1]) >= BLOWOUT, `${text} is not a blowout by the stated threshold`);
      assert.ok(games.some((e) => Math.abs(e.result.score[0] - e.result.score[1]) === Number(m[1])), `no game that week had that margin: ${text}`);
    }
    if (it.kind === 'shutout') {
      assert.ok(games.some((e) => e.result.score.includes(0)), `claimed a shutout in a week without one: ${text}`);
    }
    if (it.kind === 'overtime') {
      assert.ok(games.some((e) => e.result.overtime), `claimed overtime in a week without any: ${text}`);
    }
    if (it.kind === 'streak') {
      const m = text.match(/(won|lost) (\d+)/);
      assert.ok(m && Number(m[2]) >= STREAK, `${text} is under the stated streak length`);
    }
    if (it.kind === 'injury') {
      const m = text.match(/for (\d+) weeks?/);
      if (m) assert.ok(Number(m[1]) >= INJURY_WEEKS, `${text} is too small to be news`);
    }
  }
});

test('your own club is favoured but does not crowd everyone else out', () => {
  const lg = played(61, 10);
  const me = lg.teams.find((t) => t.isUser);
  let mine = 0, total = 0;
  for (let wk = 1; wk <= 8; wk++) {
    for (const it of weekPulse(lg, PLAYERS_BY_ID, wk)) {
      total++;
      if (it.text.includes(me.name) || it.text.includes(me.abbr)) mine++;
    }
  }
  assert.ok(total > 10, 'not enough to judge');
  assert.ok(mine / total < 0.6, `${mine} of ${total} lines were about your own club`);
});

test('an old save with no transaction log still produces a pulse', () => {
  const lg = played(44, 5);
  delete lg.transactions;
  const items = weekPulse(lg, PLAYERS_BY_ID, 3);
  assert.ok(Array.isArray(items));
  for (const it of items) assert.ok(it.kind !== 'trade' && it.kind !== 'waiver');
});
