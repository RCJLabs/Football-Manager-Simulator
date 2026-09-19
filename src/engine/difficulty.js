// How good the opposition is.
//
// There was no difficulty setting at all: every league ran with the same fixed
// spread of general managers, so a manager who had learned where value hides
// beat the room every year and there was no dial to turn.
//
// What a level changes, and what it deliberately does not.
//
// It moves how well the computer clubs **compete with you for players**: how
// much of a bid follows real win impact rather than reputation, how accurately
// a club reads a prospect nobody has seen play, how hard a club is to fleece in
// a trade, and how much rope an owner gives you. Those are the four places the
// game is actually contested.
//
// It never touches the simulation. No level gives a computer club a rating
// bonus, a luck adjustment or a thumb on the scale in a game. That kind of
// difficulty is a lie — it makes the score stop meaning what it says, breaks
// the calibration every other constant was tuned against, and teaches you
// nothing transferable. On Brutal the other clubs are not luckier than you.
// They are better at buying players than you are.

import { SAVVY } from '../data/teams.js';

export const DEFAULT_DIFFICULTY = 'standard';

/**
 * `savvy` scales how much of a GM's valuation comes from real value rather than
 * hype, which is also how well he scouts. `bid` is how far above its own
 * valuation a club will go. `greed` scales what a club demands to agree a
 * trade. `patience` shifts how many seasons an owner gives you.
 *
 * `bid` exists because savvy alone is not difficulty, which the strategy
 * simulation caught: a room that values players accurately but bids exactly
 * what it thinks they are worth loses every contested lot to somebody bidding
 * fifteen per cent over, so raising savvy on its own made the game *easier*
 * for a value shopper (9.1 wins at what was meant to be the hard setting,
 * against 8.5 at standard). Accuracy decides who the computer clubs chase.
 * Aggression decides whether you can outbid them for it.
 */
export const DIFFICULTY = {
  relaxed: {
    id: 'relaxed',
    label: 'Relaxed',
    savvy: 0.5,
    bid: 0.85,
    greed: 0.7,
    patience: 2,
    blurb: 'The room chases names. Bargains are everywhere and owners are forgiving.',
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    savvy: 1,
    bid: 1,
    greed: 1,
    patience: 0,
    blurb: 'The general managers as written: a few shrewd, most swayed by reputation.',
  },
  sharp: {
    id: 'sharp',
    label: 'Sharp',
    savvy: 1.4,
    bid: 1.15,
    greed: 1.3,
    patience: -1,
    blurb: 'Most of the room knows what a player is worth. You have to be quicker.',
  },
  brutal: {
    id: 'brutal',
    label: 'Brutal',
    savvy: 1.8,
    bid: 1.3,
    greed: 1.6,
    patience: -2,
    blurb: 'Nearly everyone bids on value and scouts well. The edges are thin and the owner is not patient.',
  },
};

export const LEVELS = Object.keys(DIFFICULTY);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function difficultyOf(league) {
  return DIFFICULTY[(league && league.settings && league.settings.difficulty) || DEFAULT_DIFFICULTY] || DIFFICULTY[DEFAULT_DIFFICULTY];
}

/**
 * A club's savvy at this difficulty: how much of its bidding follows real value,
 * and how well it reads a prospect.
 *
 * Capped at 0.95 rather than 1 on purpose. A room where every club values every
 * player perfectly has no bargains in it at all, and an auction with no
 * bargains hands all eight clubs the same quality of roster — which is the
 * parity problem the whole mispricing exists to avoid. Brutal should be hard,
 * not pointless.
 */
export function savvyFor(league, team) {
  const base = typeof team?.savvy === 'number' ? team.savvy : (SAVVY[team?.gm] ?? 0.3);
  return clamp(base * difficultyOf(league).savvy, 0, 0.95);
}

/** How far above its own valuation a club will bid. */
export function bidBoldness(league) {
  return difficultyOf(league).bid ?? 1;
}

/** What a club wants out of a trade before it will agree. */
export function greedFor(league, base) {
  return base * difficultyOf(league).greed;
}

/** Seasons of rope an owner gives, before the club's own temperament. */
export function patienceShift(league) {
  return difficultyOf(league).patience;
}
