// What a contract's length costs, for re-signings and free agency alike.
//
// Split out of offseason.js because free agency needs these numbers and
// offseason.js imports free agency. Importing them back across that edge would
// put a cycle between two modules over a `const`, and a `const` read before its
// module has finished evaluating throws — it does not resolve by luck the way a
// hoisted function declaration sometimes does. So the half that needs nothing
// but a contract length and an age sits here, where both can import it.

import { VET_YEARS, capOn } from './cap.js';
import { primeAge } from './careers.js';

/**
 * What certainty costs: the premium on re-signing a man whose deal is up,
 * before the market has seen him.
 *
 * The keeper round used to hold no decision at all, and the reason is worth
 * stating exactly, because two likelier-sounding accounts of it are both wrong.
 * It was NOT that a club could never lose a player — men declined here go into
 * free agency and are bid for. It was NOT that clubs kept everyone they could
 * afford — the AI's surplus test already let 64% of expiring men go. It was
 * that re-signing and declining cost the SAME (`marketSalary` either way) while
 * only declining carried risk, so declining was strictly dominated. A choice
 * where one option is worse in every respect is not a choice.
 *
 * Pricing the exclusive window fixes that: re-sign him here at this premium, or
 * decline and try to win him back at plain market with four rounds of sealed
 * bids in the way. Measured over 32 clubs and four seasons:
 *
 *   premium   declined   continuity   stars declined / re-signed   star to a rival
 *   1.00        64.0%      84.1%            80 / 85                     49%
 *   1.04        73.1%      80.8%           104 / 73                     49%
 *   1.08        79.4%      81.1%           104 / 68                     48%
 *
 * It is a switch rather than a dial. Everything happens between 1.00 and 1.04;
 * 1.08 buys no further change in how stars are treated and only sheds more of
 * the players whose fate nobody notices. So the value is the smallest one that
 * un-dominates the choice.
 *
 * Where the gamble is real: declining a 90+ player means a 48-49% chance a
 * rival takes him and only ~11% that nobody wants him. Below 85 it inverts —
 * 87% go unsigned, 7% to a rival — which is attrition rather than a market, and
 * is what it should be. There are 864 roster places for a pool well past 1,500.
 *
 * It MUST sit below `BIRD_IN_HAND`. The AI values keeping a man at market times
 * 1.15 and weighs that against this cost, so a premium at or above 1.15 makes
 * every surplus negative and empties every roster into the market.
 *
 * `Math.ceil` floors the premium at a dollar, so a cheap man pays proportionally
 * more than a dear one. Left alone deliberately: the decision is only ever real
 * for players the market wants, and those are the ones the percentage reaches.
 */
export const RESIGN_PREMIUM = 1.04;

/**
 * What a re-signing costs by the length of the deal.
 *
 * Every veteran contract in this game was three years — `VET_YEARS`, flat, for
 * everybody, with the franchise tag the single exception. So the cap was a
 * budgeting exercise: you knew what a man cost and you knew you had him for
 * three years, and there was nothing to decide about either.
 *
 * There is no signing-bonus proration here, so length cannot move the early
 * cap hit the way it does in the real league. What it can move is the annual
 * price, in the direction security is worth something to a player and
 * flexibility is worth something to a club: a short deal costs more a year, a
 * long one less.
 *
 *   2 years   1.22   a man on the way down, bought a year at a time
 *   3 years   1.04   the old default, so a league that ignores this is unchanged
 *   4 years   0.96
 *   5 years   0.90   cheap, and meant to be expensive to be wrong about
 *
 * "Meant to be" because it is not, measured. `scripts/term-value.mjs` follows
 * real signings for five seasons — actual ratings, knocks, retirements, and
 * the option to cut — and at these prices five years has the best average
 * return in every age band, while two years has the worst. The discount
 * outruns how fast a man declines inside five seasons, and a man who retires
 * takes his contract with him, so the years a long deal was supposed to cost
 * mostly never get paid. That is an open question about these numbers, not a
 * settled one; see DESIGN.md, "What a contract's length is worth".
 *
 * The three-year figure IS `RESIGN_PREMIUM`, not a number that happens to match
 * it, so the default path prices exactly as it did before.
 *
 * The short end stops at two on purpose. One year is the franchise tag, which
 * costs 1.6 and is limited to one man a club, and a freely available one-year
 * deal at anything less would make the tag a strictly worse version of itself —
 * which is the defect this file has now had twice.
 */
export const TERM_PRICE = { 2: 1.22, 3: RESIGN_PREMIUM, 4: 0.96, 5: 0.90 };

/** The lengths a club may offer its own expiring men. */
export const TERMS = Object.keys(TERM_PRICE).map(Number).sort((a, b) => a - b);

/**
 * Whether a club gets to choose a length at all: only when players age.
 *
 * This file used to say a league with careers off made the choice inert,
 * because the AI offers three years to a man with no age. It did not make the
 * HUMAN's choice inert. With nobody ageing, nobody declines, so the one cost a
 * long deal carries — still paying a man after he has stopped being worth it —
 * never arrives, and five years at 0.90 is simply cheaper than three at 1.04.
 * The human could take that discount on every contract and the league could
 * not, which is the asymmetry `aiTerm` below exists to prevent. So without
 * careers there is one length, three years, for everybody: the rule such a
 * league was started under.
 */
export function termsOpen(league) {
  return capOn(league) && !!league.settings?.careers;
}

/** The lengths on offer in this league. */
export function termsFor(league) {
  return termsOpen(league) ? TERMS : [VET_YEARS];
}

/**
 * The same curve seen from the free-agent market, where the asking price is
 * plain `marketSalary` for the default three years rather than a re-signing's
 * premium. Normalised so three years is exactly 1: a man asks about 17% more a
 * year to sign for two, and about 13% less to sign for five.
 */
export const FA_TERM = Object.fromEntries(TERMS.map((t) => [t, TERM_PRICE[t] / TERM_PRICE[VET_YEARS]]));

/**
 * How long an AI club offers a man, re-signing him or buying him on the market.
 *
 * The same signal the tag uses, read the other way: a man past the peak for his
 * position is bought a year or two at a time, and one still climbing is worth
 * locking up while he is cheap. In between is the three-year default, which is
 * what every contract in this game used to be.
 *
 * The intuition, not the measurement: at the asking price the measured best
 * length is five years at every age (see `TERM_PRICE`), so for an old man this
 * rule chooses the dearest option. It stays as it is until the prices are
 * settled, because re-deriving it from prices that are themselves wrong would
 * only have to be done twice.
 *
 * Without this the human would hold a lever the league does not, which is the
 * asymmetry the injury work refused for the same reason — difficulty here lives
 * in explicit levers, not in options only one side gets.
 *
 * With no age to read — a man the league has never had under contract, or any
 * index built without careers — it offers three, the old default.
 */
export function aiTerm(league, player) {
  if (!player || player.age == null) return VET_YEARS;
  const past = player.age - primeAge(player.pos);
  if (past >= 3) return 2;
  if (past >= 1) return 3;
  if (past <= -3) return 5;
  return 4;
}

