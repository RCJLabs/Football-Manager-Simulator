// Simulating ahead: run the calendar forward to a named point without being
// asked about every week. The weekly machinery is unchanged, so the waiver
// wire, AI trades, injuries and strategy drift all still happen; this only
// removes the clicking.
//
// One of these targets makes decisions on the human's behalf, and says so:
// reaching the next season needs keepers chosen and the market run. Those are
// the two biggest decisions in the dynasty loop, so the caller is expected to
// warn before using it, and the result reports what was decided.

import { simulateWeekAi, advanceWeek, startSeason, weekComplete } from './season.js';
import { advanceWeekWithMoves } from './transactions.js';
import { enterOffseason, aiKeepers, confirmKeepers } from './offseason.js';
import { autoCompleteAll } from './auction.js';
import { autoDraftAll } from './draft.js';
import { leaguePool, leagueIndex } from './rookies.js';

export const TARGETS = ['halfway', 'playoffs', 'offseason', 'nextSeason'];

export const TARGET_LABELS = {
  halfway: 'To the halfway point',
  playoffs: 'To the playoffs',
  offseason: 'Through the playoffs',
  nextSeason: 'Into next season',
};

/** The week the halfway point sits at, for a schedule of any length. */
export function halfwayWeek(league) {
  return Math.max(1, Math.floor((league.schedule?.length || 14) / 2));
}

/** Is this target still ahead of where the league stands? */
export function targetAvailable(league, target) {
  if (league.phase === 'draft') return false;
  switch (target) {
    case 'halfway': return league.phase === 'season' && league.week <= halfwayWeek(league);
    case 'playoffs': return league.phase === 'season';
    case 'offseason': return league.phase === 'season' || league.phase === 'playoffs';
    case 'nextSeason': return true;
    default: return false;
  }
}

function reached(league, target) {
  switch (target) {
    case 'halfway': return league.phase !== 'season' || league.week > halfwayWeek(league);
    case 'playoffs': return league.phase === 'playoffs' || league.phase === 'complete';
    case 'offseason': return league.phase === 'complete' || league.phase === 'offseason';
    default: return false;
  }
}

/**
 * Play weeks until the target is reached. Returns what happened, including
 * anything decided on the human's behalf.
 */
export function simulateAhead(league, byId, pool, rng, target, { maxWeeks = 200 } = {}) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown target ${target}`);
  const from = { season: league.season, week: league.week, phase: league.phase };
  const decided = [];
  let weeks = 0;

  const playTo = (stop) => {
    let guard = 0;
    while (!stop() && guard++ < maxWeeks) {
      if (league.phase !== 'season' && league.phase !== 'playoffs') break;
      if (!weekComplete(league)) simulateWeekAi(league, byId, { includeUser: true });
      const moved = advanceWeekWithMoves(league, byId, pool, rng, advanceWeek);
      if (!moved) break;
      weeks++;
    }
  };

  if (target !== 'nextSeason') {
    playTo(() => reached(league, target));
    return { weeks, decided, from, to: { season: league.season, week: league.week, phase: league.phase }, pool, byId };
  }

  // Into the next season: finish this one, then the offseason, then the market.
  playTo(() => league.phase === 'complete' || league.phase === 'offseason');
  if (league.phase === 'complete') {
    enterOffseason(league, pool, byId);
    decided.push('the offseason opened');
  }
  // A rookie class arrives with the offseason, so the market and everything
  // after it work from the fuller pool rather than the one passed in.
  pool = leaguePool(league, pool);
  byId = leagueIndex(league, byId);
  if (league.phase === 'offseason') {
    const u = league.teams.findIndex((t) => t.isUser);
    const keep = aiKeepers(league, u, pool, byId, null);
    confirmKeepers(league, keep, pool, byId);
    decided.push(keep.length ? `${keep.length} keeper${keep.length === 1 ? '' : 's'} chosen on value` : 'no keeper was worth its price, so none was kept');
  }
  if (league.phase === 'draft') {
    if (league.draftType === 'auction') autoCompleteAll(league.auction, league, pool, rng, byId);
    else autoDraftAll(league, league.draft, pool, rng);
    decided.push(league.draftType === 'auction' ? 'the auction run for you' : 'the draft run for you');
    startSeason(league, byId);
  }
  return { weeks, decided, from, to: { season: league.season, week: league.week, phase: league.phase }, pool, byId };
}

/** A sentence for the toast: where it got to and what it decided. */
export function describeRun(result) {
  const { to, weeks, decided } = result;
  const where = to.phase === 'season' ? `season ${to.season}, week ${to.week}`
    : to.phase === 'playoffs' ? `season ${to.season}, the playoffs`
    : to.phase === 'complete' ? `the end of season ${to.season}`
    : to.phase === 'offseason' ? `the season ${to.season} offseason` : to.phase;
  const played = `${weeks} week${weeks === 1 ? '' : 's'} simulated`;
  return decided.length ? `${played} to ${where}, with ${decided.join(', ')}.` : `${played} to ${where}.`;
}
