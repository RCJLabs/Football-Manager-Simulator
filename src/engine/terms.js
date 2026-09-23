// What a contract's length costs, for re-signings and free agency alike.
//
// Split out of offseason.js because free agency needs these numbers and
// offseason.js imports free agency. Importing them back across that edge would
// put a cycle between two modules over a `const`, and a `const` read before its
// module has finished evaluating throws — it does not resolve by luck the way a
// hoisted function declaration sometimes does. So the half that needs nothing
// but a contract length and an age sits here, where both can import it.

import { VET_YEARS, capOn } from './cap.js';
import { primeOf } from './careers.js';

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
 *   2 years   1.12   a man on the way down, bought a year at a time
 *   3 years   1.04   the old default, so a league that ignores this is unchanged
 *   4 years   0.98
 *   5 years   0.92   cheap, and expensive to be wrong about
 *
 * These replaced 1.22 / 0.96 / 0.90, which were set by feel and failed when
 * measured. `scripts/term-value.mjs` follows real signings for five seasons —
 * actual ratings, knocks and retirements, with the option to cut — and at
 * those prices five years had the best average return in every age band and
 * two years the worst. Two things caused it: the long-end discount outran how
 * fast a man declines inside five seasons, and a man who retired took his
 * contract with him, so the years a long deal was supposed to cost were
 * mostly never paid. Retirement now leaves the guaranteed half of what is
 * left behind, as a cut does (see `enterOffseason`), and the curve is
 * flatter. Scored on 951 signings at the asking price, the best length now
 * follows age, which is the decision this was meant to be:
 *
 *   years from peak     market best      re-signing best
 *   up to +2            5 years (73-83%)  5 years (about half), 4 next
 *   +3 to +4            3 years (47%)     2, 3 and 4 within half a dollar
 *   +5 and over         2 or 3, level     2 years (67%)
 *
 * Bought well over the asking price, two years is best at every age: every
 * year of an overpaid deal loses money, so the fewest years lose least.
 *
 * The three-year figure IS `RESIGN_PREMIUM`, not a number that happens to match
 * it, so the default path prices exactly as it did before.
 *
 * The short end stops at two on purpose. One year is the franchise tag, which
 * costs 1.6 and is limited to one man a club, and a freely available one-year
 * deal at anything less would make the tag a strictly worse version of itself —
 * which is the defect this file has now had twice.
 */
export const TERM_PRICE = { 2: 1.12, 3: RESIGN_PREMIUM, 4: 0.98, 5: 0.92 };

/**
 * A salary at a multiple of market, rounded up to the dollar.
 *
 * Every price in the game is rounded up, and a bare `Math.ceil` over a float
 * product charges a dollar that is not there: 25 × 1.12 is 28 and evaluates to
 * 28.000000000000004, so the ceiling made it 29. The old curve happened to hit
 * no such case at any market value the game produces; this one hits five. So
 * every length-priced salary goes through here, and a test checks every market
 * value against integer arithmetic. The slack cannot swallow a real fraction:
 * these factors are hundredths, or hundredths over 1.04, so a product is
 * either whole or at least a hundredth past it.
 */
export function priceOf(market, factor) {
  return Math.ceil(market * factor - 1e-9);
}

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
 * premium. Normalised so three years is exactly 1: a man asks about 8% more a
 * year to sign for two, and about 12% less to sign for five.
 */
export const FA_TERM = Object.fromEntries(TERMS.map((t) => [t, TERM_PRICE[t] / TERM_PRICE[VET_YEARS]]));

/**
 * How long an AI club offers a man, re-signing him or buying him on the market.
 *
 * Read off the measurement under `TERM_PRICE`, not intuition — the first
 * version was intuition, and bought old men the dearest length there was:
 * five years for anybody up to two years past his position's peak, three from
 * three to four past, two from five past. The middle band is the close one —
 * in the market three years is clearly best, re-signing it is within half a
 * dollar of four — and three costs the least across both. Four years is never
 * the AI's answer; it is on the menu for a human who judges a man better than
 * his age says.
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
  const past = player.age - primeOf(player);
  if (past >= 5) return 2;
  if (past >= 3) return 3;
  return 5;
}

