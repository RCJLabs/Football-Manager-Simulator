// Clinch and elimination markers for the standings. Exact clinching needs a
// scenario search over every remaining game, so this takes the conservative
// route instead: a club has clinched something if it still gets it when it
// loses out and every rival wins out (ties going against it), and is
// eliminated if it misses even when it wins out and every rival loses out
// (ties going its way). Both worlds are impossible (rivals also play each
// other), so a marker is never wrong, only occasionally a week late.

import { CONFERENCES } from '../data/pro.js';
import { isPro, playoffFieldSize } from './season.js';

const winsOf = (r) => r.w + r.t * 0.5;

/** Regular-season games a club still has to play, including this week's unplayed one. */
export function gamesLeft(league, idx) {
  let n = 0;
  for (const wk of league.schedule) for (const g of wk.games) if (!g.result && (g.home === idx || g.away === idx)) n++;
  return n;
}

/**
 * Playoff seeds under hypothetical win totals. `favor` is the club whose ties
 * break its way; every other tie breaks against it.
 */
function hypotheticalSeeds(league, wins, favor, against) {
  const teams = league.teams;
  const cmp = (a, b) => {
    const d = wins[b] - wins[a];
    if (Math.abs(d) > 1e-9) return d;
    if (a === favor) return -1;
    if (b === favor) return 1;
    if (a === against) return 1;
    if (b === against) return -1;
    return a - b;
  };
  if (!isPro(league)) {
    const order = teams.map((_, i) => i).sort(cmp);
    return { seeds: order.slice(0, playoffFieldSize(teams.length)), byes: playoffFieldSize(teams.length) === 6 ? order.slice(0, 2) : [], divisionWinners: [] };
  }
  const seeds = [], byes = [], divisionWinners = [];
  CONFERENCES.forEach((_, c) => {
    const winners = [0, 1, 2, 3].map((d) => teams.map((t, i) => (t.conf === c && t.div === d ? i : -1)).filter((i) => i >= 0).sort(cmp)[0]).sort(cmp);
    const others = teams.map((t, i) => (t.conf === c && !winners.includes(i) ? i : -1)).filter((i) => i >= 0).sort(cmp);
    seeds.push(...winners, ...others.slice(0, 3));
    byes.push(winners[0]);
    divisionWinners.push(...winners);
  });
  return { seeds, byes, divisionWinners };
}

/**
 * Markers per club: x clinched a playoff berth, y clinched the division,
 * z clinched a first-round bye (the top seed), e eliminated. Only during the
 * regular season; the playoffs speak for themselves.
 */
export function clinchMarkers(league) {
  const out = {};
  if (league.phase !== 'season' || !league.schedule?.length) return out;
  const teams = league.teams;
  const cur = teams.map((t) => winsOf(t.record));
  const left = teams.map((_, i) => gamesLeft(league, i));
  const played = teams.some((t) => t.record.w + t.record.l + t.record.t > 0);
  if (!played) return out;
  teams.forEach((_, me) => {
    const worst = cur.map((w, i) => (i === me ? w : w + left[i]));
    const best = cur.map((w, i) => (i === me ? w + left[i] : w));
    const w = hypotheticalSeeds(league, worst, null, me);
    const b = hypotheticalSeeds(league, best, me, null);
    const m = {};
    if (w.seeds.includes(me)) m.playoff = true;
    if (w.divisionWinners.includes(me)) m.division = true;
    if (w.byes.includes(me)) m.bye = true;
    if (!b.seeds.includes(me)) m.eliminated = true;
    if (Object.keys(m).length) out[me] = m;
  });
  return out;
}

export function markerLetter(m) {
  if (!m) return '';
  if (m.bye) return 'z';
  if (m.division) return 'y';
  if (m.playoff) return 'x';
  if (m.eliminated) return 'e';
  return '';
}

export const MARKER_LEGEND = { z: 'clinched a first-round bye', y: 'clinched the division', x: 'clinched a playoff berth', e: 'eliminated' };
