import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as rawById } from '../src/data/db.js';
import { POSITIONS, ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { careerIndex, applyCareers, startCareer, stepCareer, developed, primeAge, primeOf, positionPeak } from '../src/engine/careers.js';
import { leagueIndex, leaguePool } from '../src/engine/rookies.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { rawOverall, overall } from '../src/engine/ratings.js';
import { marketSalary, capHit } from '../src/engine/cap.js';
import { snapshot, leagueFromSnapshot } from '../src/engine/share.js';
import {
  CONVERSIONS, GROUP, canMove, estimateFor, guessError, fillFor, movedBase, settlingCost,
  UNTRAINED, SETTLING, MAX_GUESS,
} from '../src/engine/translate.js';
import { movesOn, movesOpen, firstSeason, asAt, movePremium, moveBlocker, candidatesFor, convertPlayer } from '../src/engine/convert.js';

registerPlayers(rawById);

/** A pro league in its first season, with the user's `slotId` emptied so there is somewhere to move to. */
function league(seed, { open = 'CB2', settings = {} } = {}) {
  const lg = createLeague({ name: 'P', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  Object.assign(lg.settings, settings);
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, rawById);
  const u = userTeamIndex(lg);
  const gone = open ? lg.teams[u].slots[open] : null;
  if (open) lg.teams[u].slots[open] = null;
  return { lg, u, gone, index: () => careerIndex(lg, leagueIndex(lg, rawById)) };
}

test('the moves on offer stay inside a group rated against the same peers, and guess one light skill at most', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(CONVERSIONS).map(([k, v]) => [k, [...v].sort()])),
    { S: ['CB'], TE: ['WR'], LB: ['DL'], CB: ['S'] },
  );
  for (const [from, tos] of Object.entries(CONVERSIONS)) for (const to of tos) assert.equal(GROUP[from], GROUP[to]);
  // A linebacker's speed and coverage are a linebacker's, rated against
  // linebackers: across into the secondary they would pass the guess bound
  // and still be wrong, which is what the group rule is for.
  for (const to of ['CB', 'S']) {
    assert.ok(guessError('LB', to) <= MAX_GUESS, `LB -> ${to} is turned away by the guess, so this proves nothing about groups`);
    assert.equal(canMove('LB', to), false, `LB -> ${to} is on offer`);
  }
  for (const [from, tos] of Object.entries(CONVERSIONS)) {
    for (const to of tos) {
      const miss = POSITIONS[to].attrs.filter((a) => !POSITIONS[from].attrs.includes(a));
      assert.ok(miss.length <= 1, `${from} -> ${to} guesses ${miss.length} skills`);
      assert.ok(guessError(from, to) <= MAX_GUESS, `${from} -> ${to} could be off by ${guessError(from, to)}`);
    }
  }
  // One skill missing, but too heavy or too poorly predicted to guess. Receiver
  // to tight end is inside a group, so the guess alone turns it away; the
  // safety's two fail both rules.
  for (const [from, to, attr] of [['WR', 'TE', 'blk'], ['S', 'LB', 'prs'], ['S', 'DL', 'prs']]) {
    assert.equal(canMove(from, to), false, `${from} -> ${to} is on offer`);
    assert.equal(estimateFor(from, to)?.attr, attr);
    assert.ok(guessError(from, to) > MAX_GUESS, `${from} -> ${to} was excluded for no reason`);
  }
  assert.equal(canMove('DL', 'LB'), false, 'a lineman needs two skills nobody has rated');
  assert.equal(estimateFor('S', 'CB'), null, 'a move with nothing to guess has a fit');
});

test('the guessed skill is what the new position\'s own men with his other skills are rated, less what he never trained', () => {
  const fit = estimateFor('CB', 'S');
  // Checked on the safeties it was fitted to: a real fit misses by a point or
  // two, where guessing the mean would miss by the whole spread.
  assert.ok(fit.rse < fit.spread / 4, `the fit misses by ${fit.rse} against a spread of ${fit.spread}`);
  const s = PLAYERS.find((p) => p.pos === 'S' && !p.generated);
  const guess = fillFor(s.r, 'CB', 'S').rsd;
  assert.equal(guess, Math.max(40, Math.min(99, Math.round(fit.predict(s.r) - UNTRAINED))));
  assert.ok(Math.abs(guess + UNTRAINED - s.r.rsd) <= 3 * fit.rse, `${s.name}: guessed ${guess + UNTRAINED} against ${s.r.rsd}`);
});

test('a moved man keeps every skill he had, gains the guessed one, and learns the job over two seasons', () => {
  const cb = PLAYERS.find((p) => p.pos === 'CB' && !p.generated);
  const move = { to: 'S', season: 5, fill: fillFor(cb.r, 'CB', 'S') };
  const m = movedBase(cb, move);
  assert.equal(m.pos, 'S');
  assert.deepEqual(Object.keys(m.r).sort(), [...POSITIONS.S.attrs].sort());
  for (const a of POSITIONS.CB.attrs) assert.equal(m.r[a], cb.r[a], `${a} changed in the move`);
  assert.equal(m.r.rsd, move.fill.rsd);
  assert.equal(m.ovr, rawOverall('S', m.r));
  assert.equal(m.orig, cb, 'the pool\'s own record was not kept');
  assert.deepEqual([4, 5, 6, 7].map((s) => settlingCost(move, s)), [0, SETTLING[0], SETTLING[1], 0]);
});

test('a club moves its own man into an open slot, pays the premium, and his old slot opens', () => {
  const { lg, u, index } = league(81);
  const byId = index();
  const t = lg.teams[u];
  const sId = t.slots.S1;
  const s = byId.get(sId);
  assert.equal(movesOn(lg), true);
  assert.equal(movesOpen(lg), true);
  const premium = movePremium(lg, s, 'CB');
  const want = Math.max(0, marketSalary(asAt(lg, s, 'CB').view) - marketSalary(s));
  assert.equal(premium, want);
  assert.ok(candidatesFor(lg, u, 'CB2', byId).some((c) => c.id === sId), 'the safety is not offered for the open corner slot');
  const salary = lg.contracts[sId].salary;
  const res = convertPlayer(lg, u, sId, 'CB2', byId);
  assert.equal(res.ok, true, res.reason);
  assert.equal(t.slots.CB2, sId);
  assert.equal(t.slots.S1, null, 'his old slot is still held');
  assert.equal(lg.contracts[sId].salary, salary + premium);
  assert.deepEqual(lg.moves[sId].to, 'CB');
  assert.equal(lg.transactions.at(-1).type, 'position');
  const after = index().get(sId);
  assert.equal(after.pos, 'CB');
  assert.equal(after.settling, SETTLING[0], 'he did not pay for learning the job in his first season');
  assert.equal(overall(after.base), overall(asAt(lg, s, 'CB').view), 'the base a career develops from carries the settling cost');
  // Going home: no settling, no refund, and the move is gone. The market
  // pays less for him at safety, so the difference is negative — and the
  // premium, which the dialog shows, must not be.
  const atCorner = index().get(sId);
  assert.ok(marketSalary(asAt(lg, atCorner, 'S').view) < marketSalary(atCorner.base), 'the test needs a move down the market');
  assert.equal(movePremium(lg, atCorner, 'S'), 0, 'a move down is priced as a refund');
  const res2 = convertPlayer(lg, u, sId, 'S1', index());
  assert.equal(res2.ok && res2.home, true);
  assert.equal(lg.moves[sId], undefined);
  assert.equal(index().get(sId).pos, 'S');
  assert.equal(index().get(sId).settling, undefined);
  assert.equal(lg.contracts[sId].salary, salary + premium, 'a move down refunded the premium');
});

test('what stops a move', () => {
  const { lg, u, index } = league(82);
  const byId = index();
  const t = lg.teams[u];
  const other = (u + 1) % lg.teams.length;
  const blocked = (id, slot) => moveBlocker(lg, u, id, slot, byId) || '';
  assert.match(blocked(lg.teams[other].slots.S1, 'CB2'), /not on your club/);
  assert.match(blocked(t.slots.CB1, 'CB2'), /already plays CB/);
  assert.match(blocked(t.slots.DL1, 'CB2'), /do not translate/);
  assert.match(blocked(t.slots.S1, 'S2'), /not open/);
  const hurt = t.slots.S2;
  t.slots.S2 = null;
  t.ir = [hurt];
  assert.match(blocked(hurt, 'CB2'), /injured reserve/);
  t.ir = [];
  t.slots.S2 = hurt;
  // The cap binds in season: a move whose premium does not fit is refused.
  const s = byId.get(t.slots.S1);
  const premium = movePremium(lg, s, 'CB');
  assert.ok(premium > 0, 'the test needs a safety worth more at corner');
  lg.cap = capHit(lg, u) + premium - 1;
  assert.match(blocked(s.id, 'CB2'), /under the cap/);
  delete lg.cap;
  assert.equal(blocked(s.id, 'CB2'), '');
  // Not during the draft, which has already counted everybody's open slots.
  lg.phase = 'draft';
  assert.match(blocked(s.id, 'CB2'), /draft/);
  lg.phase = 'season';
  // A league from before this existed has no setting: absent is off.
  delete lg.settings.positions;
  assert.match(blocked(s.id, 'CB2'), /switched off/);
});

test('a rookie still behind the scouting fog cannot be moved, since his rating there would read through it', () => {
  const { lg, u } = league(83);
  const s = PLAYERS.find((p) => p.pos === 'S' && !p.generated);
  const rookie = { ...s, id: 'gen-test-s', name: 'Test Rookie', generated: true, draftClass: 2000, season: 2000 };
  lg.rookies = [...(lg.rookies || []), rookie];
  lg.teams[u].squad = [rookie.id];
  const byId = careerIndex(lg, leagueIndex(lg, rawById));
  assert.match(moveBlocker(lg, u, rookie.id, 'CB2', byId) || '', /Nobody knows yet/);
  // Once the fog lifts he can.
  lg.dev = { ...(lg.dev || {}), [rookie.id]: { ...startCareer(lg, rookie), from: lg.season } };
  assert.equal(moveBlocker(lg, u, rookie.id, 'CB2', careerIndex(lg, leagueIndex(lg, rawById))), null);
});

test('a move made once the season is over is first played next season', () => {
  const { lg, u, index } = league(84);
  lg.phase = 'complete';
  assert.equal(firstSeason(lg), lg.season + 1);
  const id = lg.teams[u].slots.S1;
  assert.equal(convertPlayer(lg, u, id, 'CB2', index()).ok, true);
  assert.equal(lg.moves[id].season, lg.season + 1);
  assert.equal(index().get(id).settling, undefined, 'the season already over was charged for it');
  lg.season++;
  assert.equal(index().get(id).settling, SETTLING[0]);
});

test('a moved man ages on his own position\'s clock, and his career develops from the unsettled record', () => {
  const { lg, u, index } = league(85);
  const id = lg.teams[u].slots.S1;
  const root = rawById.get(id);
  assert.equal(convertPlayer(lg, u, id, 'CB2', index()).ok, true);
  const view = index().get(id);
  assert.equal(primeOf(view), primeAge('S'));
  assert.notEqual(primeAge('S'), primeAge('CB'), 'the test needs two different primes');
  const moved = startCareer(lg, view.base);
  const home = startCareer(lg, root);
  assert.deepEqual([moved.age, moved.startAge, moved.growth, moved.pace, moved.wear, moved.retireAt], [home.age, home.startAge, home.growth, home.pace, home.wear, home.retireAt]);
  // A season stepped from the view's base develops the corner and ignores the
  // settling cost: stepping from the settled view instead would lose it.
  const c = { ...moved, from: lg.season };
  const step = stepCareer(lg, view.base, c, lg.season, 0, null);
  assert.equal(step.before, overall(developed(view.base, c)));
  assert.notEqual(step.before, overall(view), 'the settled view and its base read the same, so this proves nothing');
});

test('a season at the new position is stepped on his own position\'s clock', () => {
  // At twenty-eight a safety is at his prime and his skills are still coming;
  // a corner of twenty-eight is two years past his and they are going. A
  // safety moved to corner is the first of those. Both steps draw the same
  // noise — the stream is keyed by league, man and season — so the difference
  // is the clock and nothing else, and it can only go one way.
  const { lg, u, index } = league(90);
  const id = lg.teams[u].slots.S1;
  assert.equal(convertPlayer(lg, u, id, 'CB2', index()).ok, true);
  const moved = index().get(id).base;
  const native = { ...moved, orig: undefined, moved: undefined };
  assert.equal(native.pos, 'CB');
  const c = { ...startCareer(lg, rawById.get(id)), age: primeAge('S') - 1, ceiling: 99, from: lg.season };
  const sum = (d) => Object.values(d).reduce((t, v) => t + v, 0);
  const body = stepCareer(lg, moved, c, lg.season, 0, null).career.d;
  const asCorner = stepCareer(lg, native, c, lg.season, 0, null).career.d;
  assert.ok(sum(body) > sum(asCorner), `a moved safety aged like a corner: ${sum(body)} against ${sum(asCorner)}`);
});

test('simulating ahead reads a moved man at the season it is stocking, not the one just finished', () => {
  const { lg, u, index } = league(91);
  lg.phase = 'complete';
  const id = lg.teams[u].slots.S1;
  assert.equal(convertPlayer(lg, u, id, 'CB2', index()).ok, true);
  const first = lg.moves[id].season;
  const run = simulateAhead(lg, index(), applyCareers(lg, leaguePool(lg, PLAYERS)), new RNG(91), 'nextSeason');
  assert.equal(lg.season, first, 'the run did not reach the season the move is first played in');
  assert.equal(run.byId.get(id).settling, SETTLING[0], 'the market, draft and depth charts read him before he had to learn the job');
});

test('the guessed skill is read from who he is now, once, and his career adds to it exactly once', () => {
  const { lg, u, index } = league(86, { open: 'S2' });
  const id = lg.teams[u].slots.CB1;
  const root = rawById.get(id);
  lg.dev = { [id]: { ...startCareer(lg, root), from: lg.season, d: { cov: 6, spd: 3, rsd: 2 } } };
  const home = developed(root, lg.dev[id]);
  const estimate = fillFor(home.r, 'CB', 'S').rsd;
  assert.equal(convertPlayer(lg, u, id, 'S2', index()).ok, true);
  assert.equal(lg.moves[id].fill.rsd, estimate - 2, 'the career delta was not taken out of the stored base');
  const settled = developed(index().get(id).base, lg.dev[id]);
  assert.equal(settled.r.rsd, estimate, 'the guessed skill is not what was read at the move');
  assert.equal(settled.r.cov, home.r.cov, 'a shared skill changed in the move');
});

test('the career ceiling moves with his rating, so the room he had is the room he keeps', () => {
  const { lg, u, index } = league(87);
  // Whichever of his safeties the move would change the most: a man rated the
  // same at both positions would prove nothing here.
  const id = candidatesFor(lg, u, 'CB2', index()).sort((x, y) => Math.abs(y.settled - y.now) - Math.abs(x.settled - x.now))[0].id;
  const root = rawById.get(id);
  const c = { ...startCareer(lg, root), from: lg.season };
  lg.dev = { [id]: c };
  const before = overall(developed(root, c));
  const after = overall(asAt(lg, index().get(id), 'CB').view);
  assert.notEqual(after, before, 'the move did not change his rating, so this proves nothing');
  const dev = lg.dev;
  assert.equal(convertPlayer(lg, u, id, 'CB2', index()).ok, true);
  assert.notEqual(lg.dev, dev, 'league.dev was mutated in place, so a cached pool would not notice');
  assert.equal(lg.dev[id].ceiling, Math.min(Math.max(after, positionPeak('CB')), c.ceiling + after - before));
  assert.equal(lg.dev[id].entry, c.entry + after - before);
});

test('a shared league keeps who moved where', () => {
  const { lg, u, index } = league(88);
  const id = lg.teams[u].slots.S1;
  assert.equal(convertPlayer(lg, u, id, 'CB2', index()).ok, true);
  const snap = JSON.parse(JSON.stringify(snapshot(lg, PLAYERS)));
  const back = leagueFromSnapshot(snap, PLAYERS, rawById);
  assert.deepEqual(back.moves[id], lg.moves[id]);
  const bu = back.teams.findIndex((t) => t.isUser);
  assert.equal(back.teams[bu].slots.CB2, id, 'he came back out of his corner slot');
  assert.equal(careerIndex(back, leagueIndex(back, rawById)).get(id).pos, 'CB');
});

test('a fantasy league has no position changes, since nothing there pays the premium', () => {
  const lg = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 89, mode: 'fantasy', draftType: 'snake' });
  assert.equal(movesOn(lg), false);
  assert.ok(ROSTER_SLOTS.length > 0);
});
