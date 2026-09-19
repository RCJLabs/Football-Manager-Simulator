import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll, stepAiPick, runAiPicks, currentPicker, TOTAL_ROUNDS } from '../src/engine/draft.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { snakeRows, auctionRows, lastName } from '../src/ui/draft-board.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';

registerPlayers(PLAYERS_BY_ID);

const snakeLeague = (seed, draftIt = true) => {
  const lg = createLeague({ name: 'B', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'snake' });
  if (draftIt) autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  return lg;
};

test('one pick at a time reaches exactly the same draft as the whole burst', () => {
  // The screen paces the room by moving the loop out of runAiPicks. If that
  // changed a single selection the board would be showing a different draft
  // from the one the league ends up with.
  const a = snakeLeague(11);
  const b = createLeague({ name: 'B', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 11, draftType: 'snake' });
  const rng = new RNG(11);
  let guard = 0;
  while (!b.draft.complete && guard++ < 5000) {
    if (b.teams[currentPicker(b.draft)].isUser) {
      // Stand in for the human with the same valuation autoDraftAll uses.
      runAiPicks(b, b.draft, PLAYERS, rng, { stopAtUser: false });
      break;
    }
    if (!stepAiPick(b, b.draft, PLAYERS, rng)) break;
  }
  assert.equal(b.draft.picks.length, a.draft.picks.length);
  for (let i = 0; i < a.draft.picks.length; i++) {
    assert.equal(b.draft.picks[i].playerId, a.draft.picks[i].playerId, `pick ${i + 1} differs`);
  }
});

test('stepAiPick refuses to pick for the human and reports when it did nothing', () => {
  const lg = snakeLeague(12, false);
  const rng = new RNG(12);
  let steps = 0;
  while (steps < 40 && !lg.teams[currentPicker(lg.draft)].isUser) {
    assert.ok(stepAiPick(lg, lg.draft, PLAYERS, rng), 'should have picked');
    steps++;
  }
  assert.equal(stepAiPick(lg, lg.draft, PLAYERS, rng), null, 'the human is on the clock; it must decline');
  assert.equal(lg.draft.picks.length, steps, 'and must not have picked anyway');
});

test('the board lays a snake draft out as rounds by clubs', () => {
  const lg = snakeLeague(13);
  const rows = snakeRows(lg, lg.draft);
  assert.equal(rows.length, TOTAL_ROUNDS, 'one row per round');
  for (const [r, row] of rows.entries()) {
    assert.equal(row.length, lg.teams.length, `round ${r + 1} needs a column per club`);
    for (const [ti, entry] of row.entries()) {
      assert.ok(entry, `round ${r + 1} is missing ${lg.teams[ti].abbr}`);
      assert.equal(entry.team, ti, 'a pick must sit in its own club column');
      assert.equal(entry.round, r + 1, 'and in its own round');
    }
  }
});

test('a half-finished draft leaves the rest of the board empty rather than short', () => {
  const lg = snakeLeague(14, false);
  const rng = new RNG(14);
  runAiPicks(lg, lg.draft, PLAYERS, rng);
  const rows = snakeRows(lg, lg.draft);
  assert.ok(rows.length >= 1);
  const filled = rows.flat().filter(Boolean).length;
  assert.equal(filled, lg.draft.picks.length, 'every pick made, and nothing invented');
  assert.ok(rows.flat().some((x) => x === null), 'the clubs still to pick show as gaps');
});

test('the board stacks an auction by what each club bought, with the price', () => {
  const lg = createLeague({ name: 'A', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 15, draftType: 'auction' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(15), PLAYERS_BY_ID);
  const rows = auctionRows(lg, lg.auction);
  const filled = rows.flat().filter(Boolean);
  assert.equal(filled.length, lg.auction.sold.length, 'every sale on the board once');
  for (const sale of filled) assert.ok(sale.price >= 1, 'a lot always has a price to show');
  // A club's column is its own purchases, in the order it won them.
  for (let ti = 0; ti < lg.teams.length; ti++) {
    const col = rows.map((r) => r[ti]).filter(Boolean);
    const own = lg.auction.sold.filter((s) => s.team === ti);
    assert.deepEqual(col.map((s) => s.playerId), own.map((s) => s.playerId), `${lg.teams[ti].abbr}'s column`);
  }
  assert.equal(rows.length, Math.max(...lg.teams.map((_, i) => lg.auction.sold.filter((s) => s.team === i).length)));
});

test('an auction nobody has bid in yet is an empty board, not a crash', () => {
  const lg = createLeague({ name: 'A', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 16, draftType: 'auction' });
  assert.deepEqual(auctionRows(lg, lg.auction), []);
  assert.deepEqual(auctionRows(lg, { sold: null }), []);
});

test('board cells carry a surname, keeping suffixes with the man they belong to', () => {
  // Cells are 5.6rem wide. A full name wraps to three lines and the board stops
  // being readable at a glance, which is the only thing a board is for.
  assert.equal(lastName('Jerry Rice'), 'Rice');
  assert.equal(lastName('Odell Beckham Jr.'), 'Beckham Jr.');
  assert.equal(lastName('Robert Griffin III'), 'Griffin III');
  assert.equal(lastName('Pele'), 'Pele');
  assert.equal(lastName('  Walter   Payton '), 'Payton');
});

test('every real drafted player still fits a cell after shortening', () => {
  const lg = snakeLeague(17);
  for (const pk of lg.draft.picks) {
    const p = PLAYERS_BY_ID.get(pk.playerId);
    const short = lastName(p.name);
    assert.ok(short.length > 0 && short.length <= 24, `${p.name} -> "${short}"`);
  }
});
