// What a finished season leaves behind.
//
// Everything the Team stats tab shows is derived from the schedule, and the
// schedule is replaced every season — so a season's team statistics were gone
// the moment the next one began, and so was every result between two clubs.
// `league.history` kept the champion and the finishing order, and nothing a
// club actually did on the field. This keeps two things, written once, when a
// season is crowned:
//
//   seasons  each club's regular-season totals, both sides of the ball, plus
//            its record — the same rows `seasonTeamStats` builds, so a past
//            season renders through exactly the code the current one does.
//   series   every pair of clubs' record against each other, regular season
//            and playoffs. Bounded by the number of pairs, not of seasons.
//
// Totals rather than the finished figures, because a figure cannot be
// re-derived: a yards-per-carry stored today is useless to a category added
// tomorrow, and a rate averaged over rates is wrong. Stored as arrays against
// a field list kept with each season, so a field added to the team line later
// reads as absent in the seasons that never had it, rather than shifting every
// column after it.
//
// A league started before this existed has nothing for its earlier seasons —
// their schedules are long gone — so both halves say which season they begin
// from, and the screens quote it.

import { seasonTeamStats } from './teamstats.js';
import { emptyTeamStats } from './stats.js';

const FIELDS = Object.keys(emptyTeamStats());

function archiveOf(league) {
  return (league.archive ??= { seasons: [], series: {}, through: null, since: null });
}

/** Every game with a result this season, playoffs included. */
function gamesOf(league) {
  const out = [];
  for (const wk of league.schedule || []) for (const g of wk?.games || []) if (g.result) out.push(g);
  for (const r of league.playoffs?.rounds || []) for (const g of r.games || []) if (g.result) out.push(g);
  return out;
}

const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Add one game to a series tally held as [low-index wins, high-index wins, ties]. */
function tally(rec, g) {
  const [hs, as] = g.result.score;
  const homeLow = g.home < g.away;
  if (hs === as) rec[2]++;
  else if ((hs > as) === homeLow) rec[0]++;
  else rec[1]++;
}

/**
 * File the season that has just been crowned. Called from `crown`, once.
 *
 * Safe to call twice for the same season — the second call does nothing —
 * because a season counted twice in a head-to-head is a wrong answer nobody
 * could ever spot from the screen.
 */
export function archiveSeason(league, userIdx = null) {
  const ar = archiveOf(league);
  if (ar.through != null && ar.through >= league.season) return false;
  const rows = seasonTeamStats(league);
  ar.seasons.push({
    season: league.season,
    user: Number.isInteger(userIdx) && userIdx >= 0 ? userIdx : null,
    fields: FIELDS,
    clubs: rows.map((r) => {
      const rec = league.teams[r.idx]?.record || {};
      return [rec.w ?? 0, rec.l ?? 0, rec.t ?? 0, r.games, ...FIELDS.map((f) => r.off[f]), ...FIELDS.map((f) => r.def[f])];
    }),
  });
  for (const g of gamesOf(league)) {
    if (g.home === g.away || !league.teams[g.home] || !league.teams[g.away]) continue;
    tally((ar.series[pairKey(g.home, g.away)] ??= [0, 0, 0]), g);
  }
  ar.since ??= league.season;
  ar.through = league.season;
  return true;
}

/** The seasons on file, newest first: `{ season, user }` for a picker. */
export function archivedSeasons(league) {
  return (league.archive?.seasons || []).map((s) => ({ season: s.season, user: s.user })).reverse();
}

/**
 * A filed season as the rows `seasonTeamStats` returns, each with its record
 * added — or null for a season that was never filed.
 */
export function pastRows(league, season) {
  const s = (league.archive?.seasons || []).find((x) => x.season === season);
  if (!s) return null;
  const n = s.fields.length;
  const unpack = (vals) => {
    // A field this season never recorded is NaN, not zero. Zero would read as
    // a real figure — a per-game category divides by games, which every
    // season has — while NaN survives every sum and ratio a category takes,
    // and `rankTeams` and `fmtCategory` already treat anything non-finite as
    // no figure at all.
    const out = Object.fromEntries(FIELDS.map((f) => [f, NaN]));
    s.fields.forEach((f, i) => { if (f in out) out[f] = vals[i]; });
    return out;
  };
  return s.clubs.map((c, idx) => ({
    idx, team: league.teams[idx], games: c[3],
    record: { w: c[0], l: c[1], t: c[2] },
    off: unpack(c.slice(4, 4 + n)), def: unpack(c.slice(4 + n, 4 + 2 * n)),
  }));
}

/**
 * Club `a`'s record against club `b`, every meeting on file.
 *
 * The filed seasons, plus whatever of the current one has been played if it
 * has not been filed yet — between the final and the new season's first week
 * the schedule still holds the season just filed, and adding it again would
 * count every game twice. `since` is the first season the record covers.
 */
export function series(league, a, b) {
  const ar = league.archive;
  const rec = [...(ar?.series?.[pairKey(a, b)] || [0, 0, 0])];
  const live = ar?.through == null || league.season > ar.through;
  if (live) {
    for (const g of gamesOf(league)) {
      if (pairKey(g.home, g.away) === pairKey(a, b) && g.home !== g.away) tally(rec, g);
    }
  }
  const aLow = a < b;
  return {
    w: aLow ? rec[0] : rec[1], l: aLow ? rec[1] : rec[0], t: rec[2],
    games: rec[0] + rec[1] + rec[2],
    since: ar?.since ?? league.season,
  };
}

/** "you lead 7–5", "level at 3–3–1", in words for a matchup card. */
export function seriesLine(s, { who = 'you' } = {}) {
  if (!s.games) return 'first meeting';
  const score = `${s.w}–${s.l}${s.t ? `–${s.t}` : ''}`;
  if (s.w === s.l) return `level at ${score}`;
  return `${who} ${s.w > s.l ? (who === 'you' ? 'lead' : 'leads') : (who === 'you' ? 'trail' : 'trails')} ${score}`;
}
