import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as rawById } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, userTeamIndex, standings } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { enterOffseason, confirmKeepers, aiKeepers, takeJob, closeFreeAgency, setTerm, termFor } from '../src/engine/offseason.js';
import { capSpace, marketSalary, SLOT_RESERVE } from '../src/engine/cap.js';
import { careerIndex, applyCareers } from '../src/engine/careers.js';
import { leagueIndex, leaguePool } from '../src/engine/rookies.js';
import { FA_TERM, TERMS, aiTerm, termsOpen, termsFor } from '../src/engine/terms.js';
import {
  askingBoard, biddingRoom, openCount, submitOffer, freeAgencyReport, committed, aiBid,
  offerSalary, offerYears, offerValue, askAt, FA_YEARS, MAX_PREMIUM,
} from '../src/engine/freeagency.js';
import { lostLine } from '../src/ui/views/offseason.js';

registerPlayers(rawById);

/**
 * A capped league at its free-agent market. `aged` builds the index the app
 * uses, with careers applied, so players the league has had under contract
 * carry an age; without it nobody does and every AI club offers three years.
 */
function toMarket(seed, { aged = false, before = null } = {}) {
  const lg = createLeague({ name: 'FT', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, rawById);
  while (lg.phase === 'season' || lg.phase === 'playoffs') { simulateWeekAi(lg, rawById, { includeUser: true }); advanceWeek(lg, rawById); }
  const index = () => (aged ? careerIndex(lg, leagueIndex(lg, rawById)) : rawById);
  const pool = () => (aged ? applyCareers(lg, leaguePool(lg, PLAYERS)) : PLAYERS);
  const off = enterOffseason(lg, pool(), index());
  if (off.step === 'jobs') takeJob(lg, off.carousel.offers[0].team, pool(), index());
  before?.(lg);
  const byId = index();
  confirmKeepers(lg, aiKeepers(lg, userTeamIndex(lg), pool(), byId, new RNG(seed + 1)), pool(), byId);
  return { lg, byId, pool: pool() };
}

/** Somebody dear enough that a length moves his price, at a slot the user has open. */
function target(lg, byId, { min = 20 } = {}) {
  const u = userTeamIndex(lg);
  return askingBoard(lg, PLAYERS, { limit: 400 }).find((r) => r.ask >= min && r.ask + 10 <= biddingRoom(lg, u)
    && byId.get(r.id) && ROSTER_SLOTS.some((s) => s.pos === r.pos && !lg.teams[u].slots[s.id]));
}

/**
 * The first market from `seed` on that has such a man. The test below pinned
 * seed 22, which held until the rating weights were re-measured and that
 * league's market came out without one: whether a market has a dear man at an
 * open slot is a fact about the drafts, the same reason `contest` searches.
 */
function marketWithTarget(seed = 22) {
  for (let s = seed; s < seed + 20; s++) {
    const m = toMarket(s);
    const row = target(m.lg, m.byId);
    if (row) return { ...m, row };
  }
  return null;
}

test('three years is the market price, and every length is priced off it', () => {
  for (let m = 1; m <= 50; m++) {
    assert.equal(askAt(m, 3), m, `three years at a $${m} market should be $${m}`);
    const asks = TERMS.map((t) => askAt(m, t));
    for (let i = 1; i < asks.length; i++) assert.ok(asks[i] <= asks[i - 1], `at $${m} a longer deal asks more a year: ${asks}`);
    // Rounded up, never down: nobody signs below the curve.
    for (const t of TERMS) assert.ok(askAt(m, t) >= m * FA_TERM[t] - 1e-9, `$${m} for ${t}y is under the curve`);
  }
  // Where the money is big enough for the ceiling not to swallow it, every
  // step down the menu is a real discount.
  assert.deepEqual(TERMS.map((t) => askAt(40, t)), [44, 40, 38, 36]);
  // A cheap man gets nothing for length and pays a whole dollar for two years.
  assert.deepEqual(TERMS.map((t) => askAt(1, t)), [2, 1, 1, 1]);
});

test('an offer saved as a bare number is a three-year deal, and still counts and settles as one', () => {
  assert.equal(offerSalary(20), 20);
  assert.equal(offerYears(20), FA_YEARS);
  assert.equal(offerYears({ salary: 5, years: 7 }), FA_YEARS, 'a length off the menu reads as the default');
  assert.equal(offerSalary(undefined), 0);

  const { lg, byId } = toMarket(21);
  const u = userTeamIndex(lg);
  const row = target(lg, byId, { min: 10 });
  assert.ok(row, 'no affordable free agent at an open position');
  // Written the way a save from before lengths holds it, with nobody else in.
  for (const offers of Object.values(lg.freeAgency.offers)) delete offers[row.id];
  const before = committed(lg, u);
  lg.freeAgency.offers[u] ??= {};
  lg.freeAgency.offers[u][row.id] = row.ask;
  assert.equal(committed(lg, u), before + row.ask, 'a bare-number offer was not counted against the budget');
  closeFreeAgency(lg, PLAYERS, byId);
  assert.ok(lg.teams[u].slots && ROSTER_SLOTS.some((s) => lg.teams[u].slots[s.id] === row.id), 'the old-shape offer did not sign him');
  assert.deepEqual([lg.contracts[row.id].salary, lg.contracts[row.id].years], [row.ask, FA_YEARS]);
});

test('an offer carries a length, the asking price follows it, and the tag keeps one year', () => {
  const found = marketWithTarget(22);
  assert.ok(found, 'no dear free agent at an open position in twenty markets');
  const { lg, byId, row } = found;
  const u = userTeamIndex(lg);
  const five = askAt(row.ask, 5);
  assert.ok(five < row.ask, 'the test needs a man dear enough for five years to be cheaper');
  const low = submitOffer(lg, u, row.id, five - 1, byId, 5);
  assert.equal(low.ok, false);
  assert.match(low.reason, new RegExp(`asking \\$${five} a year for 5 years`));
  assert.equal(submitOffer(lg, u, row.id, five, byId, 5).ok, true, 'five years at the five-year price was refused');
  assert.deepEqual(lg.freeAgency.offers[u][row.id], { salary: five, years: 5 });
  // Moving to two years re-prices him: the five-year money is not enough.
  assert.equal(submitOffer(lg, u, row.id, five, byId, 2).ok, false);
  assert.deepEqual(lg.freeAgency.offers[u][row.id], { salary: five, years: 5 }, 'a refused change lost the standing offer');
  assert.equal(submitOffer(lg, u, row.id, askAt(row.ask, 2), byId, 2).ok, true);
  assert.equal(offerYears(lg.freeAgency.offers[u][row.id]), 2);
  // A raise the budget will not stand is refused, and the offer already in
  // stays in: being told no should not quietly pull you out of the bidding.
  const standing = { ...lg.freeAgency.offers[u][row.id] };
  const tooMuch = submitOffer(lg, u, row.id, biddingRoom(lg, u) + offerSalary(standing) + 1, byId, 5);
  assert.equal(tooMuch.ok, false);
  assert.match(tooMuch.reason, /to bid/);
  assert.deepEqual(lg.freeAgency.offers[u][row.id], standing, 'a refused raise withdrew the offer it was raising');
  // One year is the franchise tag's, and nothing past five is on the menu.
  for (const years of [1, 6]) {
    const r = submitOffer(lg, u, row.id, 99, byId, years);
    assert.equal(r.ok, false, `a ${years}-year offer was taken`);
    assert.match(r.reason, new RegExp(`No ${years}-year deals`));
  }
});

/**
 * The same contested man, bid for by the user and by the richest AI club
 * with room at his position, and nobody else. Returns what the market did.
 *
 * Seeds are searched rather than pinned: whether a league reaches its market
 * with a dear man, a user with room for him and a rival with a hole at his
 * position is a fact about the pool, and a pinned seed stops holding the day
 * anything upstream is reweighted.
 */
function contest(userOffer, clubOffer) {
  for (let seed = 23; seed < 60; seed++) {
    const r = contestAt(seed, userOffer, clubOffer);
    if (r) return r;
  }
  assert.fail('no league in 37 seeds reached its market with a contest to stage');
}

function contestAt(seed, userOffer, clubOffer) {
  const { lg, byId } = toMarket(seed);
  const u = userTeamIndex(lg);
  const row = target(lg, byId);
  if (!row) return null;
  const k = lg.teams.map((t, i) => i)
    .filter((i) => i !== u && ROSTER_SLOTS.some((s) => s.pos === row.pos && !lg.teams[i].slots[s.id]))
    .sort((a, b) => capSpace(lg, b) - capSpace(lg, a))[0];
  if (k == null) return null;
  const offers = { user: userOffer(row.ask), club: clubOffer(row.ask) };
  if (capSpace(lg, k) - offers.club.salary < (openCount(lg.teams[k]) - 1) * SLOT_RESERVE) return null;
  // Nothing else in the way: the club's other bids could spend the money first.
  for (const o of Object.values(lg.freeAgency.offers)) delete o[row.id];
  lg.freeAgency.offers[k] = { [row.id]: offers.club };
  lg.freeAgency.offers[u] = { [row.id]: offers.user };
  assert.ok(capSpace(lg, u) - offers.user.salary >= (openCount(lg.teams[u]) - 1) * SLOT_RESERVE, 'the user cannot afford the test\'s offer');
  const worse = standings(lg).map((r) => r.idx).reverse();
  closeFreeAgency(lg, PLAYERS, byId);
  const owner = lg.teams.findIndex((t) => ROSTER_SLOTS.some((s) => t.slots[s.id] === row.id));
  return { lg, u, k, row, owner, offers, worseFirst: worse.indexOf(u) < worse.indexOf(k) ? u : k };
}

test('offers at the asking price tie whatever their length, and the tie goes to the worse record', () => {
  const r = contest((m) => ({ salary: m, years: 3 }), (m) => ({ salary: askAt(m, 5), years: 5 }));
  assert.equal(offerValue(r.row.ask, r.offers.user), 1);
  assert.equal(offerValue(r.row.ask, r.offers.club), 1);
  assert.equal(r.owner, r.worseFirst, 'a tie did not go to the worse record');
  const signing = r.lg.freeAgency.results.find((s) => s.id === r.row.id);
  assert.equal(signing.underbid.length, 1);
  assert.equal(signing.underbid[0].tie, true, 'the loser of a tie was not told it was one');
  assert.ok(signing.salary >= signing.ask, 'signed under his asking price for the length he signed');
});

test('a smaller salary for longer wins when it is further over his price for that length', () => {
  // Two years against five, so neither length is the three-year default a
  // dropped field would fall back to.
  const r = contest(
    (m) => ({ salary: askAt(m, 2) + 1, years: 2 }),
    (m) => ({ salary: askAt(m, 5) + Math.ceil(askAt(m, 5) * 0.1), years: 5 }));
  assert.ok(r.offers.club.salary < r.offers.user.salary, 'the test needs the club to offer less a year');
  assert.ok(offerValue(r.row.ask, r.offers.club) > offerValue(r.row.ask, r.offers.user));
  assert.equal(r.owner, r.k, 'the bigger salary won although it was the smaller offer for its length');
  assert.deepEqual([r.lg.contracts[r.row.id].salary, r.lg.contracts[r.row.id].years], [r.offers.club.salary, 5], 'the contract is not the offer that won');
  const lost = freeAgencyReport(r.lg, r.u).lost.find((l) => l.id === r.row.id);
  assert.deepEqual(lost && [lost.bid, lost.years, lost.at, lost.atYears, lost.tie], [r.offers.user.salary, 2, r.offers.club.salary, 5, false]);
  assert.match(lostLine(lost), /further over what he asks for that length/);
});

test('AI clubs buy by age where players age, and three years where they do not', () => {
  const { lg, byId, pool } = toMarket(24, { aged: true });
  let aged = 0, long = 0, short = 0;
  for (const [t, offers] of Object.entries(lg.freeAgency.offers)) {
    if (Number(t) === userTeamIndex(lg)) continue;
    for (const [id, o] of Object.entries(offers)) {
      const p = byId.get(id);
      const want = p?.age == null ? FA_YEARS : aiTerm(lg, p);
      assert.equal(offerYears(o), want, `${p?.name} (${p?.age}) offered ${offerYears(o)} years`);
      if (p?.age != null) aged++;
      if (offerYears(o) > FA_YEARS) long++;
      if (offerYears(o) < FA_YEARS) short++;
    }
  }
  assert.ok(aged > 0 && long + short > 0, `nothing to check: ${aged} aged bids, ${long} long, ${short} short`);

  // The premium goes on the price for the length offered, not on the
  // three-year price: bid again without the noise and no offer may sit further
  // over its own asking price than the most any club will pay.
  const u0 = userTeamIndex(lg);
  for (const [t, offers] of Object.entries(lg.freeAgency.offers)) if (Number(t) !== u0) lg.freeAgency.offers[t] = {};
  // The aged pool with the aged index, as the app passes them: a raw pool
  // prices a man off ratings he no longer has.
  aiBid(lg, pool, byId, null);
  let priced = 0;
  for (const [t, offers] of Object.entries(lg.freeAgency.offers)) {
    if (Number(t) === u0) continue;
    for (const [id, o] of Object.entries(offers)) {
      const market = marketSalary(byId.get(id));
      const ask = askAt(market, offerYears(o));
      assert.ok(offerValue(market, o) <= 1 + MAX_PREMIUM + 0.5 / ask, `${id}: ${offerSalary(o)} for ${offerYears(o)}y is ${offerValue(market, o).toFixed(2)}x his asking price`);
      if (offerYears(o) !== FA_YEARS) priced++;
    }
  }
  assert.ok(priced > 0, 'no bid at a length other than three, so the price basis went unchecked');

  // And what signs is what was offered: the length, and a salary at or over
  // the price for that length even where it is under his three-year market.
  closeFreeAgency(lg, pool, byId);
  let lengths = 0;
  for (const s of lg.freeAgency.results) {
    assert.equal(lg.contracts[s.id].years, s.years, `${s.id} signed for ${s.years} but his contract runs ${lg.contracts[s.id].years}`);
    assert.equal(s.ask, askAt(s.market, s.years), `${s.id}'s recorded ask is not his price for ${s.years} years`);
    assert.ok(s.salary >= s.ask, `${s.id} signed at ${s.salary} under his ${s.years}-year ask of ${s.ask}`);
    if (s.years !== FA_YEARS) lengths++;
  }
  assert.ok(lengths > 0, 'nobody signed for anything but three years');

  // The same league with careers switched off after the ages exist: the gate,
  // not a missing age, is what holds everybody to three.
  const off = toMarket(24, { aged: true, before: (l) => { l.settings.careers = false; } });
  assert.equal(termsOpen(off.lg), false);
  let heldToThree = 0;
  for (const [t, offers] of Object.entries(off.lg.freeAgency.offers)) {
    for (const [id, o] of Object.entries(offers)) {
      assert.equal(offerYears(o), FA_YEARS);
      const p = off.byId.get(id);
      if (Number(t) !== userTeamIndex(off.lg) && p?.age != null && aiTerm(off.lg, p) !== FA_YEARS) heldToThree++;
    }
  }
  // Not merely "every surviving bid is three years": a club that asked for
  // five and was refused would pass that and simply never bid for the man.
  assert.ok(heldToThree > 0, 'no AI club bid three years on a man its age rule would have bought for another length');
  const u = userTeamIndex(off.lg);
  const row = target(off.lg, off.byId, { min: 5 });
  assert.ok(row);
  const r = submitOffer(off.lg, u, row.id, 99, off.byId, 5);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Every deal here runs 3 years/);
});

test('without careers the keeper round has one length too, whatever was stored before', () => {
  const lg = createLeague({ name: 'K', mode: 'pro', numTeams: 32, franchise: 3, seed: 5, draftType: 'snake', user: {} });
  lg.offseason = { terms: {} };
  assert.deepEqual(termsFor(lg), TERMS);
  setTerm(lg, 'x', 5);
  assert.equal(termFor(lg, 'x'), 5);
  lg.settings.careers = false;
  assert.deepEqual(termsFor(lg), [FA_YEARS]);
  assert.equal(termFor(lg, 'x'), FA_YEARS, 'a length stored before careers went off still priced a keeper');
  setTerm(lg, 'y', 5);
  lg.settings.careers = true;
  assert.equal(termFor(lg, 'y'), FA_YEARS, 'a length was taken while there was no choice to make');
  const fantasy = createLeague({ name: 'F', numTeams: 8, seed: 5, draftType: 'auction', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
  assert.equal(termsOpen(fantasy), false, 'a league with no cap has no contracts to lengthen');
});

test('the market report says which lengths were on the table, and reads results saved before them', () => {
  const lg = { freeAgency: { results: [
    { team: 1, id: 'a', salary: 20, ask: 20, underbid: [{ team: 0, salary: 20 }] },
    { team: 1, id: 'b', salary: 20, ask: 20, underbid: [{ team: 0, salary: 18 }] },
    { team: 2, id: 'c', salary: 26, years: 5, ask: 26, underbid: [{ team: 0, salary: 30, years: 3, tie: true }] },
    { team: 2, id: 'd', salary: 29, years: 5, ask: 26, underbid: [{ team: 0, salary: 31, years: 3, tie: false }] },
    { team: 3, id: 'e', salary: 20, years: 3, ask: 20, underbid: [{ team: 0, salary: 23, years: 2, tie: false }] },
  ] } };
  const lost = Object.fromEntries(freeAgencyReport(lg, 0).lost.map((l) => [l.id, l]));
  assert.deepEqual([lost.a.years, lost.a.atYears, lost.a.tie], [FA_YEARS, FA_YEARS, true], 'an old equal-money result is a tie');
  assert.equal(lost.b.tie, false);
  assert.match(lostLine(lost.a), /you both bid \$20 — ties go to the worse record/);
  assert.match(lostLine(lost.b), /^your \$18, he took \$20$/);
  assert.match(lostLine(lost.c), /\$30 × 3y.*\$26 × 5y.*same distance over his asking price/);
  assert.match(lostLine(lost.d), /\$31 × 3y, he took \$29 × 5y, which was further over/);
  assert.deepEqual([lost.e.years, lost.e.atYears], [2, 3], 'the loser\'s own length was dropped');
  assert.match(lostLine(lost.e), /your \$23 × 2y, he took \$20 × 3y/);
});
