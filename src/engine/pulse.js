// What happened this week, across the league.
//
// The hub had standings, a playoff picture and a transaction log, and no answer
// to the only question a manager actually asks on a Monday: what happened?
// Thirty-one other clubs played and none of it was narrated, so a season was a
// table that changed rather than a thing that happened.
//
// Everything here is read back out of records the season already keeps — the
// schedule's results, the injury ledger, the transaction log — so nothing new
// is stored and an old save produces a pulse for its own past weeks.
//
// One real limit shapes what can be said. Per-game box scores are stored only
// for the human's games and the playoffs; an AI regular-season game keeps its
// team totals and drops the individual lines. Measured, one box score costs
// 14.9 KB, and keeping all 272 of a 32-club season would raise a save's
// permanent floor from about 2.4 MB to about 6.2 MB — past the point where a
// browser will write it at all. Season totals are a different thing and do
// accumulate for every player on every club, so nobody is missing from the
// leaders or the record book. But a pulse is told game by game, so a computer
// club's week here is told through team numbers, and a named-player story only
// appears where the game kept one.
//
// No randomness. The same week always reads the same way, which matters
// because a league code and a season card have to agree about what happened.

import { overall, buildLineup, teamPower } from './ratings.js';
import { SEASON_ENDING } from './injuries.js';

/** How far apart two clubs must be on the power table for a win to be an upset. */
export const UPSET_GAP = 6;
/** Margin at which a win stops being a win and starts being a statement. */
export const BLOWOUT = 24;
/** Weeks out before an injury is news rather than a knock. */
export const INJURY_WEEKS = 3;
/** Consecutive results before a run is worth mentioning. */
export const STREAK = 4;

function powerRank(league, byId) {
  const rank = new Map();
  league.teams
    .map((t, i) => ({ i, power: teamPower(buildLineup(t.slots, byId, league.injuries)) }))
    .sort((a, b) => b.power - a.power)
    .forEach((r, k) => rank.set(r.i, k + 1));
  return rank;
}

/**
 * Every finished game in a week. A week in the schedule is `{ week, games }`,
 * and a bye is a club simply absent from that week's games rather than an entry
 * with a flag, so nothing needs filtering for it.
 */
function gamesIn(league, week) {
  const slate = (league.schedule || [])[week - 1];
  if (!slate || !Array.isArray(slate.games)) return [];
  return slate.games.filter((e) => e && e.result);
}

/** Win/loss run a club carries into this week, counting back from it. */
function streakOf(league, teamIdx, week) {
  let run = 0, kind = null;
  for (let w = week; w >= 1; w--) {
    const entry = gamesIn(league, w).find((e) => e.home === teamIdx || e.away === teamIdx);
    if (!entry) continue;
    const mine = entry.home === teamIdx ? entry.result.score[0] : entry.result.score[1];
    const theirs = entry.home === teamIdx ? entry.result.score[1] : entry.result.score[0];
    if (mine === theirs) break;
    const won = mine > theirs;
    if (kind === null) kind = won;
    else if (kind !== won) break;
    run++;
  }
  return { run, won: kind };
}

const name = (t) => t.name;

/**
 * The week in five or six lines, most interesting first. `limit` caps it; the
 * hub shows fewer than the playoffs deserve.
 */
export function weekPulse(league, byId, week = league.week - 1, { limit = 6 } = {}) {
  const games = gamesIn(league, week);
  if (!games.length) return [];
  const rank = powerRank(league, byId);
  const u = league.teams.findIndex((t) => t.isUser);
  const items = [];

  for (const e of games) {
    const [hs, as] = e.result.score;
    const home = league.teams[e.home], away = league.teams[e.away];
    const winner = hs > as ? e.home : as > hs ? e.away : null;
    const loser = winner == null ? null : (winner === e.home ? e.away : e.home);
    const margin = Math.abs(hs - as);
    const mine = e.home === u || e.away === u;

    if (winner != null) {
      const gap = rank.get(loser) - rank.get(winner);
      // A club the table rates well below its opponent winning anyway.
      if (gap <= -UPSET_GAP) {
        items.push({
          kind: 'upset',
          weight: 60 + Math.abs(gap) + (mine ? 25 : 0),
          text: `${name(league.teams[winner])} beat ${name(league.teams[loser])} ${Math.max(hs, as)}-${Math.min(hs, as)}, ${Math.abs(gap)} places below them on the power table.`,
        });
      }
      if (margin >= BLOWOUT) {
        items.push({
          kind: 'blowout',
          weight: 40 + margin + (mine ? 25 : 0),
          text: `${name(league.teams[winner])} put ${Math.max(hs, as)} on ${name(league.teams[loser])} and won by ${margin}.`,
        });
      }
      if (Math.min(hs, as) === 0) {
        items.push({
          kind: 'shutout',
          weight: 70 + (mine ? 25 : 0),
          text: `${name(league.teams[loser])} did not score. ${name(league.teams[winner])} kept a clean sheet.`,
        });
      }
    }
    if (e.result.overtime) {
      items.push({
        kind: 'overtime',
        weight: 45 + (mine ? 25 : 0),
        text: winner == null
          ? `${name(home)} and ${name(away)} could not be separated in overtime, ${hs}-${as}.`
          : `${name(league.teams[winner])} needed overtime to get past ${name(league.teams[loser])}, ${Math.max(hs, as)}-${Math.min(hs, as)}.`,
      });
    }

    // Injuries are the thing that changes next week rather than last week.
    (e.result.injuries || []).forEach((side, k) => {
      const teamIdx = k === 0 ? e.home : e.away;
      for (const inj of side) {
        const p = byId.get(inj.id);
        if (!p || inj.weeks < INJURY_WEEKS) continue;
        const o = overall(p);
        if (o < 82 && teamIdx !== u) continue;
        // 99 weeks is the season-ending sentinel, not a number to print.
        const out = inj.weeks >= SEASON_ENDING ? 'for the season' : `for ${inj.weeks} week${inj.weeks === 1 ? '' : 's'}`;
        items.push({
          kind: 'injury',
          weight: 50 + (o - 70) + Math.min(inj.weeks, 12) + (teamIdx === u ? 30 : 0),
          text: `${league.teams[teamIdx].abbr} lost ${p.name} (${p.pos}, ${o}) ${out}${inj.kind ? ` — ${inj.kind}` : ''}.`,
        });
      }
    });
  }

  // Runs, counted once per club from this week back.
  const seen = new Set();
  for (const e of games) {
    for (const idx of [e.home, e.away]) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      const { run, won } = streakOf(league, idx, week);
      if (run < STREAK) continue;
      items.push({
        kind: 'streak',
        weight: 35 + run * 3 + (idx === u ? 30 : 0),
        text: won
          ? `${name(league.teams[idx])} have won ${run} in a row.`
          : `${name(league.teams[idx])} have lost ${run} straight.`,
      });
    }
  }

  // Deals, from the log the transaction screen already writes.
  for (const tx of (league.transactions || []).filter((x) => x.season === league.season && x.week === week)) {
    if (tx.type === 'trade') {
      const a = league.teams[tx.team], b = league.teams[tx.other];
      const gets = (ids) => ids.map((id) => (byId.get(id) || {}).name).filter(Boolean).join(' and ');
      items.push({
        kind: 'trade',
        weight: 55 + (tx.team === u || tx.other === u ? 30 : 0),
        text: `${name(a)} sent ${gets(tx.gives)} to ${name(b)} for ${gets(tx.gets)}.`,
      });
    } else if (tx.type === 'waiver') {
      const p = byId.get(tx.add);
      if (!p) continue;
      const o = overall(p);
      if (o < 84 && tx.team !== u) continue;
      items.push({
        kind: 'waiver',
        weight: 20 + (o - 70) + (tx.team === u ? 30 : 0),
        text: `${league.teams[tx.team].abbr} claimed ${p.name} (${p.pos}, ${o}) off waivers.`,
      });
    }
  }

  // Drop repeats — a shutout is usually also a blowout — keeping the better line.
  const byText = new Map();
  for (const it of items.sort((a, b) => b.weight - a.weight)) {
    if (!byText.has(it.text)) byText.set(it.text, it);
  }
  const ranked = [...byText.values()];
  const kinds = new Set();
  const out = [];
  // One of each kind first, so a week of five blowouts still reads as a week.
  for (const it of ranked) {
    if (kinds.has(it.kind)) continue;
    kinds.add(it.kind);
    out.push(it);
    if (out.length >= limit) break;
  }
  for (const it of ranked) {
    if (out.length >= limit) break;
    if (!out.includes(it)) out.push(it);
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** A one-line summary for a week with nothing much in it. */
export function quietWeek(league, week) {
  const games = gamesIn(league, week);
  if (!games.length) return null;
  const pts = games.reduce((s, e) => s + e.result.score[0] + e.result.score[1], 0);
  return `${games.length} game${games.length === 1 ? '' : 's'}, ${pts} points, nothing out of the ordinary.`;
}
