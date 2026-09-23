// A league's team statistics, offence and defence, for the regular season.
//
// The offensive half has been recorded all along: every game writes third- and
// fourth-down attempts and conversions, red-zone trips and touchdowns, rushing
// and passing, turnovers, sacks taken, time of possession and more, and they
// accumulate into `seasonStats.team`. What never existed was the other side of
// the ball. Nothing recorded what a defence ALLOWED, so "the best red-zone
// defence" or "the best run defence" could not be answered from anything the
// game kept.
//
// It does not need storing, because every played game already keeps both
// sides' team lines in `result.teamStats`. A club's defence is simply what its
// opponents did against it, so both halves are derived here from the schedule
// on demand. That also makes it retroactive: a save already halfway through a
// season shows a defence for every game it has played, not just the ones after
// this was written.
//
// Regular season only, the way `seasonStats.team` has always counted and the
// way the real league quotes its team rankings.

import { emptyTeamStats, addTeamStats } from './stats.js';

/** Offence and defence totals for every club, from the games played so far. */
export function seasonTeamStats(league) {
  const rows = (league?.teams || []).map((t, idx) => ({ idx, team: t, games: 0, off: emptyTeamStats(), def: emptyTeamStats() }));
  for (const wk of league?.schedule || []) {
    for (const g of wk?.games || []) {
      const ts = g.result?.teamStats;
      if (!ts || !rows[g.home] || !rows[g.away]) continue;
      // Each side's offence is the other side's defence. Two additions per game
      // and the league is symmetric by construction: every yard gained is a
      // yard allowed, which is what the conservation test pins.
      addTeamStats(rows[g.home].off, ts[0]); addTeamStats(rows[g.away].def, ts[0]);
      addTeamStats(rows[g.away].off, ts[1]); addTeamStats(rows[g.home].def, ts[1]);
      rows[g.home].games++; rows[g.away].games++;
    }
  }
  return rows;
}

const per = (n, d) => (d > 0 ? n / d : null);
const pct = (n, d) => (d > 0 ? (100 * n) / d : null);

/**
 * Every category the screen can rank by.
 *
 * `better` is which direction wins — a defence wants few yards, an offence
 * many — so a ranking never has to be read backwards. A value of null means
 * the rate has no denominator yet (no third downs faced in week one), and those
 * clubs sort to the bottom rather than posing as the league's best at 0%.
 */
export const TEAM_CATEGORIES = [
  // Offence
  { key: 'ppg', unit: 'o:score', side: 'off', label: 'Points per game', better: 'high', fmt: 1, value: (r) => per(r.off.points, r.games) },
  { key: 'ypg', unit: 'o:yards', side: 'off', label: 'Yards per game', better: 'high', fmt: 1, value: (r) => per(r.off.totalYds, r.games) },
  { key: 'ypp', unit: 'o:yards', side: 'off', label: 'Yards per play', better: 'high', fmt: 2, value: (r) => per(r.off.totalYds, r.off.plays) },
  { key: 'rush', unit: 'o:run', side: 'off', label: 'Rushing yards per game', better: 'high', fmt: 1, value: (r) => per(r.off.rushYds, r.games) },
  { key: 'ypc', unit: 'o:run', side: 'off', label: 'Yards per carry', better: 'high', fmt: 2, value: (r) => per(r.off.rushYds, r.off.rushAtt) },
  { key: 'pass', unit: 'o:pass', side: 'off', label: 'Passing yards per game', better: 'high', fmt: 1, value: (r) => per(r.off.passYds, r.games) },
  { key: 'cmp', unit: 'o:pass', side: 'off', label: 'Completion %', better: 'high', fmt: 1, pct: true, value: (r) => pct(r.off.passCmp, r.off.passAtt) },
  { key: 'third', unit: 'o:third', side: 'off', label: 'Third-down conversion %', better: 'high', fmt: 1, pct: true, value: (r) => pct(r.off.thirdConv, r.off.thirdAtt) },
  { key: 'fourth', unit: 'o:fourth', side: 'off', label: 'Fourth-down conversion %', better: 'high', fmt: 1, pct: true, value: (r) => pct(r.off.fourthConv, r.off.fourthAtt) },
  { key: 'rz', unit: 'o:rz', side: 'off', label: 'Red-zone touchdown %', better: 'high', fmt: 1, pct: true, value: (r) => pct(r.off.redZoneTd, r.off.redZoneAtt) },
  { key: 'give', unit: 'o:ball', side: 'off', label: 'Turnovers per game', better: 'low', fmt: 2, value: (r) => per(r.off.turnovers, r.games) },
  { key: 'sacked', unit: 'o:protect', side: 'off', label: 'Sacks allowed per game', better: 'low', fmt: 2, value: (r) => per(r.off.sacksAllowed, r.games) },
  { key: 'top', unit: 'o:clock', side: 'off', label: 'Time of possession', better: 'high', clock: true, value: (r) => per(r.off.top, r.games) },
  { key: 'pen', unit: 'o:discipline', side: 'off', label: 'Penalty yards per game', better: 'low', fmt: 1, value: (r) => per(r.off.penYds, r.games) },
  // Defence — the same measurements, taken from what opponents did.
  { key: 'dppg', unit: 'd:score', side: 'def', label: 'Points allowed per game', better: 'low', fmt: 1, value: (r) => per(r.def.points, r.games) },
  { key: 'dypg', unit: 'd:yards', side: 'def', label: 'Yards allowed per game', better: 'low', fmt: 1, value: (r) => per(r.def.totalYds, r.games) },
  { key: 'dypp', unit: 'd:yards', side: 'def', label: 'Yards per play allowed', better: 'low', fmt: 2, value: (r) => per(r.def.totalYds, r.def.plays) },
  { key: 'drush', unit: 'd:run', side: 'def', label: 'Rushing yards allowed per game', better: 'low', fmt: 1, value: (r) => per(r.def.rushYds, r.games) },
  { key: 'dypc', unit: 'd:run', side: 'def', label: 'Yards per carry allowed', better: 'low', fmt: 2, value: (r) => per(r.def.rushYds, r.def.rushAtt) },
  { key: 'dpass', unit: 'd:pass', side: 'def', label: 'Passing yards allowed per game', better: 'low', fmt: 1, value: (r) => per(r.def.passYds, r.games) },
  { key: 'dthird', unit: 'd:third', side: 'def', label: 'Third-down % allowed', better: 'low', fmt: 1, pct: true, value: (r) => pct(r.def.thirdConv, r.def.thirdAtt) },
  { key: 'drz', unit: 'd:rz', side: 'def', label: 'Red-zone touchdown % allowed', better: 'low', fmt: 1, pct: true, value: (r) => pct(r.def.redZoneTd, r.def.redZoneAtt) },
  { key: 'take', unit: 'd:ball', side: 'def', label: 'Takeaways per game', better: 'high', fmt: 2, value: (r) => per(r.def.turnovers, r.games) },
  { key: 'sacks', unit: 'd:rush', side: 'def', label: 'Sacks per game', better: 'high', fmt: 2, value: (r) => per(r.def.sacksAllowed, r.games) },
  // Both sides at once.
  { key: 'diff', unit: 'b:score', side: 'both', label: 'Point differential per game', better: 'high', fmt: 1, signed: true, value: (r) => per(r.off.points - r.def.points, r.games) },
  { key: 'tod', unit: 'b:ball', side: 'both', label: 'Turnover differential', better: 'high', fmt: 0, signed: true, value: (r) => (r.games ? r.def.turnovers - r.off.turnovers : null) },
];

export const CATEGORY_BY_KEY = Object.fromEntries(TEAM_CATEGORIES.map((c) => [c.key, c]));

/**
 * Clubs in order for one category, best first, with competition ranks — tied
 * clubs share a rank and the next one skips, the way standings are read.
 */
export function rankTeams(rows, cat) {
  const withV = rows.map((r) => ({ ...r, v: cat.value(r) }));
  const known = withV.filter((r) => r.v != null && Number.isFinite(r.v));
  const unknown = withV.filter((r) => !(r.v != null && Number.isFinite(r.v)));
  known.sort((a, b) => (cat.better === 'low' ? a.v - b.v : b.v - a.v) || a.idx - b.idx);
  let rank = 0, prev = null;
  known.forEach((r, i) => {
    const same = prev != null && Math.abs(r.v - prev) < 1e-9;
    if (!same) rank = i + 1;
    r.rank = rank;
    prev = r.v;
  });
  for (const r of unknown) r.rank = null;
  return [...known, ...unknown];
}

/** The display string for a value in a category. */
export function fmtCategory(cat, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (cat.clock) {
    const s = Math.round(v);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const n = v.toFixed(cat.fmt ?? 1);
  const out = cat.signed && v > 0 ? `+${n}` : n;
  return cat.pct ? `${out}%` : out;
}

/**
 * Pairs that meet when one side attacks the other: an offensive measure and the
 * defensive measure of the same thing. Your run game against their run
 * defence is a matchup; your run game against their pass defence is not.
 */
export const MATCHUPS = [
  { off: 'rush', def: 'drush', name: 'the run' },
  { off: 'pass', def: 'dpass', name: 'the pass' },
  { off: 'third', def: 'dthird', name: 'third down' },
  { off: 'rz', def: 'drz', name: 'the red zone' },
];

/**
 * What the next opponent has actually done, as a coach would want it read.
 *
 * The matchup card already said how the two rosters compare on paper — power,
 * unit composites, the other GM's habits. Nothing said how a club had played,
 * which is often a different answer: a defence rated well on paper can be
 * giving up 140 yards a game on the ground. So this reads their ranks in every
 * unit category and pulls out the extremes, and then does the more useful thing
 * — sets your offence's rank against their defence's in the same category, and
 * theirs against yours, and names the widest gap each way.
 *
 * Returns null until the opponent has played `minGames`: a rank after one game
 * is a coin, and a scouting line built on it would be confident and wrong.
 */
export function scoutingReport(league, meIdx, oppIdx, { minGames = 2 } = {}) {
  const rows = seasonTeamStats(league);
  const opp = rows[oppIdx];
  if (!opp || opp.games < minGames) return null;
  const ranked = new Map(TEAM_CATEGORIES.map((c) => [c.key, rankTeams(rows, c)]));
  const rankOf = (key, idx) => ranked.get(key).find((r) => r.idx === idx);
  const teams = rows.filter((r) => r.games > 0).length;

  const units = TEAM_CATEGORIES.filter((c) => c.side !== 'both')
    .map((c) => ({ cat: c, ...rankOf(c.key, oppIdx) }))
    .filter((x) => x.rank != null);
  // One line per unit. Yards per carry and rushing yards a game both measure
  // the same run defence, and naming both spends half the report restating
  // itself — the first version did exactly that on a club strong against the run.
  const distinct = (list) => {
    const seen = new Set();
    return list.filter((x) => (seen.has(x.cat.unit) ? false : (seen.add(x.cat.unit), true))).slice(0, 2);
  };
  const strengths = distinct(units.slice().sort((a, b) => a.rank - b.rank));
  const weaknesses = distinct(units.slice().sort((a, b) => b.rank - a.rank));

  // A gap only counts once it is a real one: a quarter of the league apart.
  // Fourth against eighth is noise with a sign on it.
  const floor = Math.max(2, Math.round(teams / 4));
  const gaps = (attacker, defender) => MATCHUPS.map((m) => {
    const o = rankOf(m.off, attacker), d = rankOf(m.def, defender);
    if (!o || !d || o.rank == null || d.rank == null) return null;
    // Positive when the attacker ranks well and the defender ranks badly.
    return { ...m, offRank: o.rank, defRank: d.rank, gap: d.rank - o.rank, offV: o.v, defV: d.v };
  }).filter((x) => x && x.gap >= floor).sort((a, b) => b.gap - a.gap)[0] || null;

  return {
    teams, games: opp.games,
    strengths, weaknesses,
    edge: rows[meIdx]?.games ? gaps(meIdx, oppIdx) : null,
    danger: rows[meIdx]?.games ? gaps(oppIdx, meIdx) : null,
  };
}

/** "1st", "22nd", "3rd". */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
