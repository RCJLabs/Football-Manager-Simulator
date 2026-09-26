// A trade has a price in money as well as in lineup.
//
// The AI weighed a deal on the lineup it would field and never on what the men
// cost, so a man was worth the same to it on the minimum as on $20 a year.
// Measured on the release before this, nearly every well-paid man on the
// human's roster could be handed to some AI club for a cheaper one, and the
// club said yes. Next season's pay now counts, at what a dollar buys in free
// agency (`CAP_WORTH`), wherever the AI weighs a trade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { overall } from '../src/engine/ratings.js';
import {
  tradeMoney, evaluateTrade, aiTrades, executeTrade, makeAiOffers, lineupStrength, aiGreed, CAP_WORTH, OFFER_FAIR_MARGIN,
} from '../src/engine/transactions.js';
import { MIN_SALARY } from '../src/engine/cap.js';

registerPlayers(byId);

function pro(seed) {
  const lg = createLeague({ name: 'P', user: { name: 'Me', abbr: 'ME', color: '#fff' }, seed, mode: 'pro', franchise: 1, draftType: 'snake', injuries: 'off' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  return lg;
}
const deal = (lg, id, salary, years) => { lg.contracts[id] = { ...lg.contracts[id], salary, years, expiring: false }; };

test('next season\'s pay is what a deal moves: the men, a signing, and a release less what it leaves owed', () => {
  const lg = pro(91);
  const u = userTeamIndex(lg);
  const me = lg.teams[u];
  const [x, y, z, r] = [me.slots.WR1, me.slots.WR2, me.slots.WR3, me.slots.WR4];
  deal(lg, x, 10, 3);
  deal(lg, y, 4, 2);
  deal(lg, z, 20, 1);
  deal(lg, r, 8, 3);
  const nobody = PLAYERS.find((p) => !Object.values(me.slots).includes(p.id) && !lg.contracts[p.id]).id;
  // Given away, a man on $10 next season saves it; taken on, $4 costs it.
  assert.equal(tradeMoney(lg, u, [x], [y]), 10 - 4);
  // A deal that ends with this season commits nothing: a rental.
  assert.equal(tradeMoney(lg, u, [x], [z]), 10);
  // A man with no deal yet is signed on the minimum when the season ends.
  assert.equal(tradeMoney(lg, u, [], [nobody]), -MIN_SALARY);
  // Squaring a roster: a free agent signed costs the minimum, and a spare man
  // let go saves his $8 less the $4 a year he is still owed.
  assert.equal(tradeMoney(lg, u, [x], [y], { signs: [nobody], releases: [r] }), 10 - 4 - MIN_SALARY + (8 - 4));
  // A league without a cap has no money to move.
  const fantasy = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 91, draftType: 'auction' });
  autoCompleteAll(fantasy.auction, fantasy, PLAYERS, new RNG(91), byId);
  startSeason(fantasy, byId);
  const f = fantasy.teams[userTeamIndex(fantasy)];
  assert.equal(tradeMoney(fantasy, userTeamIndex(fantasy), [f.slots.WR1], [f.slots.WR2]), 0);
});

test('a club will not take a dearer man for a cheaper one unless the lineup pays for the difference', () => {
  const lg = pro(92);
  const u = userTeamIndex(lg);
  const x = lg.teams[u].slots.WR1;
  // A club whose own receiver is plainly worse, so the lineup alone says yes.
  const a = lg.teams.findIndex((t, i) => i !== u && overall(byId.get(t.slots.WR1)) + 4 <= overall(byId.get(x)));
  assert.ok(a >= 0, 'no club with a receiver four points worse');
  const A = lg.teams[a];
  const y = A.slots.WR1;
  const gain = lineupStrength({ ...A.slots, WR1: x }, byId, lg) - lineupStrength(A.slots, byId, lg);
  assert.ok(gain >= aiGreed(A, lg), `the lineup alone should carry it: ${gain}`);
  // The human's man dear and long, the club's cheap: $18 a year more.
  deal(lg, x, 20, 3);
  deal(lg, y, 2, 3);
  const ev = evaluateTrade(lg, a, [y], [x], byId, null);
  assert.equal(ev.accept, false, 'the club took on $18 a year for a few points of lineup');
  assert.match(ev.reason, /\$18 more in pay next season/);
  // The same man on a deal that ends with the season costs it nothing next
  // year, and then the lineup is all there is to it.
  deal(lg, x, 20, 1);
  assert.equal(evaluateTrade(lg, a, [y], [x], byId, null).accept, true, 'a rental was refused');
});

test('a club that sheds pay counts what it saves', () => {
  const lg = pro(93);
  const u = userTeamIndex(lg);
  const x = lg.teams[u].slots.WR1;
  // A club whose receiver is a shade better than the human's: on the lineup
  // alone, giving him up for the human's is a loss.
  const a = lg.teams.findIndex((t, i) => i !== u && overall(byId.get(t.slots.WR1)) > overall(byId.get(x)) && overall(byId.get(t.slots.WR1)) <= overall(byId.get(x)) + 2);
  assert.ok(a >= 0, 'no club with a receiver a shade better');
  const A = lg.teams[a];
  const y = A.slots.WR1;
  assert.ok(lineupStrength({ ...A.slots, WR1: x }, byId, lg) < lineupStrength(A.slots, byId, lg));
  // Its man on $20 for two more years, the human's on the minimum.
  deal(lg, y, 20, 3);
  deal(lg, x, MIN_SALARY, 3);
  const ev = evaluateTrade(lg, a, [y], [x], byId, null);
  assert.equal(ev.money, 20 - MIN_SALARY);
  assert.equal(ev.accept, true, `shedding $19 a year was not worth a point or two of lineup: ${ev.reason}`);
});

test('every trade AI clubs make between themselves is one each would take by the rule it answers the human with', () => {
  const lg = pro(94);
  const before = structuredClone(lg);
  const done = aiTrades(lg, byId, new RNG(3), { pairs: 60, pool: PLAYERS });
  assert.ok(done.length > 0, 'no AI trades to check');
  // Replayed on the league as it stood, one at a time, as they were made.
  for (const t of done) {
    for (const [idx, gives, gets] of [[t.team, t.gives, t.gets], [t.other, t.gets, t.gives]]) {
      const ev = evaluateTrade(before, idx, gives, gets, byId, PLAYERS);
      assert.ok(ev.accept, `${before.teams[idx].abbr} made a deal it would refuse from the human: ${ev.reason}`);
    }
    executeTrade(before, t.team, t.other, t.gives, t.gets, byId, PLAYERS);
  }
});

test('an offer to the human is one the club would take, and does not load the human with pay', () => {
  let checked = 0;
  for (const seed of [95, 96, 97]) {
    const lg = pro(seed);
    for (const o of makeAiOffers(lg, byId, null, { max: 3, pool: PLAYERS })) {
      if (o.givesNext.length || o.wantsNext.length) continue;
      checked++;
      assert.equal(typeof o.userMoney, 'number');
      assert.ok(evaluateTrade(lg, o.from, o.gives, o.wants, byId, PLAYERS).accept, 'the club offered a deal it would refuse');
      // Fair by the same measure the club uses on itself: lineup and pay.
      assert.ok(o.userDelta + o.userMoney * CAP_WORTH >= -OFFER_FAIR_MARGIN - 0.05, `an offer costing the human ${o.userDelta} of lineup and $${-o.userMoney} of pay`);
    }
  }
  assert.ok(checked > 0, 'no offers to check');
});
