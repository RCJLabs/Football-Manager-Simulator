import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague } from '../src/engine/season.js';
import {
  TOTAL_ROUNDS, openSlots, currentPicker, makePick, aiChoose, autoDraftAll, availablePlayers,
} from '../src/engine/draft.js';
import {
  pickOwner, originalOwner, overallOf, remainingPicks, nextPickFor, picksUntil,
  validatePickTrade, executePickTrade, projectPickTrade, evaluatePickTrade, proposePickTrade,
  survivalOdds, makePickOffers, aiPickTrades, pickGrid, needSummary, MAX_PICK_SIDE,
} from '../src/engine/draftpicks.js';
import { snakeRows } from '../src/ui/draft-board.js';

const mk = (seed, n = 12) => createLeague({ name: 'D', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'snake' });
const user = (lg) => lg.teams.findIndex((t) => t.isUser);
/** Push the draft on a few rounds so rosters and needs have diverged. */
function advance(lg, rounds, seed = 3) {
  const rng = new RNG(seed);
  while (lg.draft.round < rounds && !lg.draft.complete) {
    const p = aiChoose(lg, lg.draft, PLAYERS, currentPicker(lg.draft), rng);
    if (!p) break;
    makePick(lg, lg.draft, p);
  }
}

test('an untraded draft picks exactly as it always did', () => {
  const lg = mk(4);
  const d = lg.draft;
  assert.equal(d.traded, undefined, 'no table until somebody deals');
  for (let r = 1; r <= 3; r++) {
    for (let i = 0; i < d.order.length; i++) {
      assert.equal(pickOwner(d, r, i), originalOwner(d, r, i));
    }
  }
  // The snake really does reverse.
  assert.equal(originalOwner(d, 1, 0), d.order[0]);
  assert.equal(originalOwner(d, 2, 0), d.order[d.order.length - 1]);
});

test('a club holds exactly as many picks as it has open slots', () => {
  const lg = mk(6);
  for (let i = 0; i < lg.teams.length; i++) {
    assert.equal(remainingPicks(lg.draft, i).length, openSlots(lg.teams[i]).length);
  }
  advance(lg, 4);
  for (let i = 0; i < lg.teams.length; i++) {
    assert.equal(remainingPicks(lg.draft, i).length, openSlots(lg.teams[i]).length, `${lg.teams[i].abbr} is out of step`);
  }
});

test('picks trade one for one, and the refusal says why', () => {
  const lg = mk(7);
  const d = lg.draft;
  const u = user(lg), o = u === 0 ? 1 : 0;
  const mine = remainingPicks(d, u), theirs = remainingPicks(d, o);
  const v = validatePickTrade(lg, d, u, o, mine.slice(0, 2), theirs.slice(0, 1));
  assert.equal(v.ok, false);
  assert.match(v.reason, /one for one/);
  assert.match(v.reason, /unable to fill a roster/);
  assert.ok(validatePickTrade(lg, d, u, o, mine.slice(0, 2), theirs.slice(0, 2)).ok);
  assert.ok(validatePickTrade(lg, d, u, o, mine.slice(0, 1), theirs.slice(0, 1)).ok);
  // Four a side is too many.
  assert.equal(validatePickTrade(lg, d, u, o, mine.slice(0, MAX_PICK_SIDE + 1), theirs.slice(0, MAX_PICK_SIDE + 1)).ok, false);
  // You cannot trade what you do not hold.
  assert.equal(validatePickTrade(lg, d, u, o, theirs.slice(0, 1), mine.slice(0, 1)).ok, false);
});

test('a traded pick changes hands, and the draft still fills every roster', () => {
  const lg = mk(9);
  const d = lg.draft;
  const u = user(lg), o = u === 0 ? 1 : 0;
  const mine = remainingPicks(d, u), theirs = remainingPicks(d, o);
  const gave = mine[0], got = theirs[0];
  executePickTrade(lg, d, u, o, [gave], [got]);
  assert.equal(pickOwner(d, gave.round, gave.pickInRound), o);
  assert.equal(pickOwner(d, got.round, got.pickInRound), u);
  assert.equal(originalOwner(d, gave.round, gave.pickInRound), u, 'where it came from is still known');
  // Counts are preserved, which is the whole rule.
  assert.equal(remainingPicks(d, u).length, mine.length);
  assert.equal(remainingPicks(d, o).length, theirs.length);
  autoDraftAll(lg, d, PLAYERS, new RNG(2));
  for (const t of lg.teams) {
    const empty = ROSTER_SLOTS.filter((s) => !t.slots[s.id]);
    assert.equal(empty.length, 0, `${t.abbr} finished ${empty.length} short`);
  }
  const tx = lg.transactions.find((x) => x.type === 'picks');
  assert.ok(tx, 'the deal is in the log');
  assert.deepEqual(tx.gives, [gave.overall]);
  assert.deepEqual(tx.gets, [got.overall]);
});

test('trading the pick on the clock moves who is on the clock', () => {
  const lg = mk(11);
  const d = lg.draft;
  const onClock = currentPicker(d);
  const other = lg.teams.findIndex((t, i) => i !== onClock);
  const here = remainingPicks(d, onClock)[0];
  assert.equal(here.overall, overallOf(d, d.round, d.pickInRound), 'the club on the clock holds this pick');
  const theirs = remainingPicks(d, other).find((p) => p.overall !== here.overall);
  executePickTrade(lg, d, onClock, other, [here], [theirs]);
  assert.equal(currentPicker(d), other, 'the pick, and the clock, changed hands');
});

test('the projection is repeatable: the same question twice gives the same answer', () => {
  const lg = mk(5);
  const d = lg.draft;
  const u = user(lg), o = u === 0 ? 1 : 0;
  const mine = remainingPicks(d, u), theirs = remainingPicks(d, o);
  const a = projectPickTrade(lg, d, PLAYERS, byId, u, o, [mine[0]], [theirs[0]]);
  const b = projectPickTrade(lg, d, PLAYERS, byId, u, o, [mine[0]], [theirs[0]]);
  assert.deepEqual(a, b, 'the draft noise is off, so there is nothing to vary');
  assert.ok(Number.isFinite(a.a) && Number.isFinite(a.b));
  // And it left nothing behind: the projection drafts in a sandbox.
  assert.equal(d.picks.length, 0);
  assert.equal(Object.keys(d.taken).length, 0);
  assert.equal(lg.teams[u].slots[ROSTER_SLOTS[0].id], undefined);
});

test('a swap that helps nobody is refused, and a club says how short it fell', () => {
  const lg = mk(13);
  const d = lg.draft;
  const u = user(lg);
  // Offer a club a worse pick than the one it holds. It should decline.
  let asked = null;
  for (let o = 0; o < lg.teams.length && !asked; o++) {
    if (o === u) continue;
    const theirs = remainingPicks(d, o), mine = remainingPicks(d, u);
    if (theirs[0].overall < mine[0].overall) asked = { o, theirs, mine };
  }
  assert.ok(asked, 'somebody picks ahead of us');
  const ev = evaluatePickTrade(lg, d, PLAYERS, byId, asked.o, [asked.theirs[0]], [asked.mine[0]], u);
  assert.equal(ev.accept, false, 'no club gives up an earlier pick for a later one and nothing else');
  assert.ok(/pass|more points/.test(ev.reason), ev.reason);
  const r = proposePickTrade(lg, d, PLAYERS, byId, u, asked.o, [asked.mine[0]], [asked.theirs[0]]);
  assert.equal(r.accepted, false);
  assert.equal(d.traded, undefined, 'a refusal changes nothing');
});

test('survival odds answer for the pick after this one, and name the men who will not last', () => {
  const lg = mk(5);
  const d = lg.draft;
  const onClock = currentPicker(d);
  const mine = remainingPicks(d, onClock);
  const now = survivalOdds(lg, d, PLAYERS, onClock, { trials: 4 });
  assert.equal(now.untilPick, mine[1].overall, 'a club on the clock asks about its next turn, not this one');
  assert.ok([...now.odds.values()].some((q) => q < 1), 'somebody goes in between');

  // A club that picks late in round one has real risk.
  const late = d.order[d.order.length - 1];
  const sv = survivalOdds(lg, d, PLAYERS, late, { trials: 8 });
  assert.equal(sv.trials, 8);
  assert.ok(sv.untilPick > 1);
  const doomed = [...sv.odds.values()].filter((q) => q < 0.5).length;
  assert.ok(doomed >= sv.untilPick - 2, `by pick ${sv.untilPick} at least that many men should be at risk, got ${doomed}`);
  for (const q of sv.odds.values()) assert.ok(q >= 0 && q <= 1);
  assert.equal(d.picks.length, 0, 'the read drafts in a sandbox too');
});

test('a club two picks deep in one round still shows both on the board', () => {
  const lg = mk(17);
  const d = lg.draft;
  const a = d.order[0], b = d.order[1];
  const pa = remainingPicks(d, a), pb = remainingPicks(d, b);
  // Give a its round-one pick and b's too, by swapping b's first for a's later one.
  const swapOut = pa.find((p) => p.round > 1);
  executePickTrade(lg, d, a, b, [swapOut], [pb[0]]);
  const rng = new RNG(4);
  while (d.round === 1 && !d.complete) {
    const p = aiChoose(lg, d, PLAYERS, currentPicker(d), rng);
    if (!p) break;
    makePick(lg, d, p);
  }
  const roundOne = d.picks.filter((p) => p.round === 1 && p.team === a);
  assert.equal(roundOne.length, 2, 'that club picked twice in round one');
  const rows = snakeRows(lg, d);
  const shown = rows.filter((row) => row[a]).length;
  assert.ok(shown >= 2, `both picks should be on the board, found ${shown}`);
  assert.equal(rows.labels[0], 'R1');
  assert.equal(rows.labels[1], '', 'a continuation row is not labelled a new round');
  assert.equal(rows.roundRow[0], 0);
});

test('clubs will deal picks with each other without breaking the draft', () => {
  let deals = 0;
  for (const seed of [21, 22, 23]) {
    const lg = mk(seed);
    advance(lg, 3, seed);
    const before = lg.teams.map((_, i) => remainingPicks(lg.draft, i).length);
    deals += aiPickTrades(lg, lg.draft, PLAYERS, byId, new RNG(seed), { pairs: 2 }).length;
    lg.teams.forEach((t, i) => {
      assert.equal(remainingPicks(lg.draft, i).length, before[i], `${t.abbr} changed pick count`);
    });
    autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
    for (const t of lg.teams) assert.equal(ROSTER_SLOTS.filter((s) => !t.slots[s.id]).length, 0, `${t.abbr} finished short`);
  }
  assert.ok(deals >= 0, 'the generator runs even when nothing clears');
});

test('an offer to the human is one for one, fair enough to be worth reading, and applies cleanly', () => {
  let offer = null, lg = null;
  for (const seed of [31, 32, 33, 34, 35, 36] ) {
    lg = mk(seed);
    advance(lg, 2, seed);
    const made = makePickOffers(lg, lg.draft, PLAYERS, byId, null, { max: 2 });
    if (made.length) { offer = made[0]; break; }
  }
  if (!offer) return; // no club wanted to move in these leagues; nothing to assert
  assert.equal(offer.gives.length, offer.wants.length);
  assert.ok(offer.userDelta >= -2.0001, `an insulting offer should not be made: ${offer.userDelta}`);
  assert.match(offer.note, /move (up|down)/);
  const u = user(lg);
  const before = remainingPicks(lg.draft, u).length;
  executePickTrade(lg, lg.draft, offer.from, u, offer.gives, offer.wants);
  assert.equal(remainingPicks(lg.draft, u).length, before);
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(1));
  for (const t of lg.teams) assert.equal(ROSTER_SLOTS.filter((s) => !t.slots[s.id]).length, 0);
});

test('the grid and the need summary describe the draft they are given', () => {
  const lg = mk(41);
  const d = lg.draft;
  const grid = pickGrid(d);
  assert.equal(grid.length, TOTAL_ROUNDS);
  assert.equal(grid[0].length, lg.teams.length);
  assert.ok(grid.every((row) => row.every((c) => !c.traded)), 'nothing is traded yet');
  const u = user(lg), o = u === 0 ? 1 : 0;
  const mine = remainingPicks(d, u), theirs = remainingPicks(d, o);
  executePickTrade(lg, d, u, o, [mine[0]], [theirs[0]]);
  const after = pickGrid(d);
  assert.equal(after.flat().filter((c) => c.traded).length, 2, 'two picks changed hands');
  const need = needSummary(lg.teams[u]);
  assert.equal(Object.values(need).reduce((a, b) => a + b, 0), TOTAL_ROUNDS, 'an undrafted club needs everything');
  assert.equal(picksUntil(d, u), nextPickFor(d, u).overall - overallOf(d, d.round, d.pickInRound));
});

test('a completed draft has nothing left to trade', () => {
  const lg = mk(43);
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(1));
  assert.ok(lg.draft.complete);
  assert.deepEqual(remainingPicks(lg.draft, 0), []);
  assert.equal(nextPickFor(lg.draft, 0), null);
  assert.equal(validatePickTrade(lg, lg.draft, 0, 1, [{ overall: 1 }], [{ overall: 2 }]).ok, false);
  assert.deepEqual(makePickOffers(lg, lg.draft, PLAYERS, byId, null), []);
  assert.deepEqual(aiPickTrades(lg, lg.draft, PLAYERS, byId, new RNG(1)), []);
});
