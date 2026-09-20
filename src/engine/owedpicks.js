// Who owns next year's picks. Bookkeeping only — no valuation lives here.
//
// Split out of futurepicks.js for a reason worth stating: transactions.js
// needs to move a pick when a trade goes through, and futurepicks.js needs
// `lineupStrength` from transactions.js to guess where a club will finish. One
// module holding both would put a cycle between them, and while an ES cycle
// over hoisted function declarations does resolve, it resolves by luck — turn
// `lineupStrength` into a `const` one day and the app stops loading. So the
// half that needs nothing sits here, where anybody can import it.

import { ROSTER_SLOTS } from '../data/positions.js';

/** How far ahead a pick may be traded. */
export const FUTURE_YEARS = 1;

/**
 * How deep into next year's draft a pick is worth owning.
 *
 * Three at first, and measured down to two. A keeper draft runs about nine
 * rounds and its value collapses inside the first, so at thirty-two clubs a
 * round-1 pick is worth 14.7 lineup points to the club holding it, a round-2
 * pick 0.1, and a round-3 pick 0.0. Over 10,527 deals that needed something to
 * close them, a first closed 32 and a second closed 3; a third closed none at
 * all. Two keeps the throw-in that occasionally matters and stops the rooms
 * listing a row per club that is worth nothing.
 */
export const FUTURE_ROUNDS = 2;

/**
/**
 * Whether next year's picks may be traded yet.
 *
 * Not in a league's first draft, and the reason is the measurement above: the
 * estimate runs off the roster a club is about to field, and during the
 * opening draft nobody has one. Every club is a blank sheet with the same
 * twenty-seven empty slots, so every future pick would price identically and
 * the whole market would be a coin toss. One season played is the entry fee.
 */
export function futurePicksOpen(league) {
  return !!league && (league.history?.length || 0) > 0 && (league.teams?.length || 0) > 1;
}

/** The season a future pick belongs to. */
export function futureSeason(league) {
  return (league?.season ?? 1) + FUTURE_YEARS;
}

/** The owed-picks table, created on demand. Empty in every league where nobody has traded. */
function table(league) {
  league.owedPicks ??= [];
  return league.owedPicks;
}

/** Who owns the pick club `from` would naturally make in this round. */
export function futureOwner(league, season, round, from) {
  const row = (league.owedPicks || []).find((p) => p.season === season && p.round === round && p.from === from);
  return row ? row.to : from;
}

/**
 * Hand ownership over, collapsing the row when a pick finds its way home.
 *
 * Chains matter here: a pick can be traded on, and on again, and the club it
 * started with never sees it. Rewriting `to` in place rather than appending
 * means a pick that comes back to its original club leaves no trace, which is
 * what `futureOwner` falling through to `from` already assumes.
 */
function setFutureOwner(league, season, round, from, to) {
  const rows = table(league);
  const i = rows.findIndex((p) => p.season === season && p.round === round && p.from === from);
  if (to === from) { if (i >= 0) rows.splice(i, 1); return; }
  if (i >= 0) rows[i].to = to;
  else rows.push({ season, round, from, to });
}

/**
 * Every future pick a club holds: its own, minus what it has sent, plus what
 * it has been sent. Sorted by round and then by whose pick it is, so a club's
 * own comes before one it acquired.
 */
export function futureHand(league, teamIdx, { season = null } = {}) {
  if (!futurePicksOpen(league)) return [];
  const s = season ?? futureSeason(league);
  const out = [];
  for (let round = 1; round <= FUTURE_ROUNDS; round++) {
    for (let from = 0; from < league.teams.length; from++) {
      if (futureOwner(league, s, round, from) !== teamIdx) continue;
      out.push({ future: true, season: s, round, from, to: teamIdx, key: `f${s}:${round}:${from}` });
    }
  }
  return out.sort((a, b) => a.round - b.round || (a.from === teamIdx ? -1 : b.from === teamIdx ? 1 : a.from - b.from));
}

/**
 * How fast a season's record takes over from the roster as the better guess.
 *
 * At the moment a league drafts, nobody has played a game and the roster is
 * all there is. In-season it is different, and the difference is large. Over
 * 6,912 club-weeks the roster ranks clubs against their eventual finish at
 * r = 0.59 all season, while the record starts at nothing and climbs past the
 * roster around week five, reaching 0.96 by the last week. A blend beats
 * either at every single week of the season.
 *
 * `played / (played + RECORD_WEIGHT)` is the rule fitted to that, and at 4 it
 * averages r = 0.799 across the season against a per-week optimum that is
 * barely above it. So a pick traded at the deadline — week 12 of a pro
 * season, ten games in — is priced at about r = 0.86 where the same pick in
 * the offseason is priced at 0.59.
 */
/** Where a slot lands in a snake's round. */
export function snakeOverall(round, slot, teams) {
  const within = round % 2 === 1 ? slot : teams + 1 - slot;
  return (round - 1) * teams + within;
}

/**
 * What a future pick is worth, in the same lineup points every other trade
 * here is judged in: the curve at the guessed slot, docked for the odds the
 * pick is never made and for it being a year away.
 */
/** Structural checks on a future-pick side. Returns { ok, reason }. */
export function validateFuturePicks(league, teamIdx, picks) {
  if (!picks?.length) return { ok: true };
  if (!futurePicksOpen(league)) {
    return { ok: false, reason: 'Next year’s picks cannot be traded until a season has been played' };
  }
  const s = futureSeason(league);
  const seen = new Set();
  for (const p of picks) {
    if (p.season !== s) return { ok: false, reason: `Only ${s} picks are on the table` };
    if (p.round < 1 || p.round > FUTURE_ROUNDS) return { ok: false, reason: `Only the first ${FUTURE_ROUNDS} rounds of ${s} can be traded` };
    if (futureOwner(league, p.season, p.round, p.from) !== teamIdx) {
      return { ok: false, reason: `That ${s} pick is not ${league.teams[teamIdx].abbr}’s to trade` };
    }
    if (seen.has(p.key)) return { ok: false, reason: 'A pick is listed twice' };
    seen.add(p.key);
  }
  return { ok: true };
}

/** Move future picks across. Assumes both sides have already been validated. */
export function applyFutureTrade(league, aIdx, bIdx, aGives, bGives) {
  for (const p of aGives || []) setFutureOwner(league, p.season, p.round, p.from, bIdx);
  for (const p of bGives || []) setFutureOwner(league, p.season, p.round, p.from, aIdx);
}

/**
 * Fold what is owed into a freshly built draft.
 *
 * Called once, from `createDraft`, because that is the first moment the order
 * exists and so the first moment a round and a club can be turned into an
 * overall pick number. Rows for the season being drafted are consumed;
 * anything further out is left alone.
 */
export function applyOwedPicks(league, draft) {
  const rows = league?.owedPicks;
  if (!rows?.length || !draft) return draft;
  const n = draft.order.length;
  const season = league.season;
  draft.traded ??= {};
  for (const row of rows) {
    if (row.season !== season) continue;
    const j = draft.order.indexOf(row.from);
    if (j < 0) continue;
    const i = row.round % 2 === 1 ? j : n - 1 - j;
    const overall = (row.round - 1) * n + i + 1;
    if (row.round > ROSTER_SLOTS.length) continue;
    draft.traded[overall] = row.to;
  }
  league.owedPicks = rows.filter((r) => r.season !== season);
  return draft;
}

/**
 * "S3 R1 · via BUF" — what a drafter calls a future pick.
 *
 * A season here is a count, not a year: leagues start at season 1. Printing it
 * bare read as "3 R1" on the screen, which is a pick number and a round to
 * anybody who drafts, so it carries the S.
 */
export function futureLabel(league, pick) {
  const own = pick.from === pick.to;
  return `S${pick.season} R${pick.round}${own ? '' : ` · via ${league.teams[pick.from]?.abbr ?? '?'}`}`;
}
