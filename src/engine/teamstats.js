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
  { key: 'ppg', side: 'off', label: 'Points per game', better: 'high', fmt: 1, value: (r) => per(r.off.points, r.games) },
  { key: 'ypg', side: 'off', label: 'Yards per game', better: 'high', fmt: 1, value: (r) => per(r.off.totalYds, r.games) },
  { key: 'ypp', side: 'off', label: 'Yards per play', better: 'high', fmt: 2, value: (r) => per(r.off.totalYds, r.off.plays) },
  { key: 'rush', side: 'off', label: 'Rushing yards per game', better: 'high', fmt: 1, value: (r) => per(r.off.rushYds, r.games) },
  { key: 'ypc', side: 'off', label: 'Yards per carry', better: 'high', fmt: 2, value: (r) => per(r.off.rushYds, r.off.rushAtt) },
  { key: 'pass', side: 'off', label: 'Passing yards per game', better: 'high', fmt: 1, value: (r) => per(r.off.passYds, r.games) },
  { key: 'cmp', side: 'off', label: 'Completion %', better: 'high', fmt: 1, pct: true, value: (r) => pct(r.off.passCmp, r.off.passAtt) },
  { key: 'third', side: 'off', label: 'Third-down conversion %', better: 'high', fmt: 1, pct: true, value: (r) => pct(r.off.thirdConv, r.off.thirdAtt) },
  { key: 'fourth', side: 'off', label: 'Fourth-down conversion %', better: 'high', fmt: 1, pct: true, value: (r) => pct(r.off.fourthConv, r.off.fourthAtt) },
  { key: 'rz', side: 'off', label: 'Red-zone touchdown %', better: 'high', fmt: 1, pct: true, value: (r) => pct(r.off.redZoneTd, r.off.redZoneAtt) },
  { key: 'give', side: 'off', label: 'Turnovers per game', better: 'low', fmt: 2, value: (r) => per(r.off.turnovers, r.games) },
  { key: 'sacked', side: 'off', label: 'Sacks allowed per game', better: 'low', fmt: 2, value: (r) => per(r.off.sacksAllowed, r.games) },
  { key: 'top', side: 'off', label: 'Time of possession', better: 'high', clock: true, value: (r) => per(r.off.top, r.games) },
  { key: 'pen', side: 'off', label: 'Penalty yards per game', better: 'low', fmt: 1, value: (r) => per(r.off.penYds, r.games) },
  // Defence — the same measurements, taken from what opponents did.
  { key: 'dppg', side: 'def', label: 'Points allowed per game', better: 'low', fmt: 1, value: (r) => per(r.def.points, r.games) },
  { key: 'dypg', side: 'def', label: 'Yards allowed per game', better: 'low', fmt: 1, value: (r) => per(r.def.totalYds, r.games) },
  { key: 'dypp', side: 'def', label: 'Yards per play allowed', better: 'low', fmt: 2, value: (r) => per(r.def.totalYds, r.def.plays) },
  { key: 'drush', side: 'def', label: 'Rushing yards allowed per game', better: 'low', fmt: 1, value: (r) => per(r.def.rushYds, r.games) },
  { key: 'dypc', side: 'def', label: 'Yards per carry allowed', better: 'low', fmt: 2, value: (r) => per(r.def.rushYds, r.def.rushAtt) },
  { key: 'dpass', side: 'def', label: 'Passing yards allowed per game', better: 'low', fmt: 1, value: (r) => per(r.def.passYds, r.games) },
  { key: 'dthird', side: 'def', label: 'Third-down % allowed', better: 'low', fmt: 1, pct: true, value: (r) => pct(r.def.thirdConv, r.def.thirdAtt) },
  { key: 'drz', side: 'def', label: 'Red-zone touchdown % allowed', better: 'low', fmt: 1, pct: true, value: (r) => pct(r.def.redZoneTd, r.def.redZoneAtt) },
  { key: 'take', side: 'def', label: 'Takeaways per game', better: 'high', fmt: 2, value: (r) => per(r.def.turnovers, r.games) },
  { key: 'sacks', side: 'def', label: 'Sacks per game', better: 'high', fmt: 2, value: (r) => per(r.def.sacksAllowed, r.games) },
  // Both sides at once.
  { key: 'diff', side: 'both', label: 'Point differential per game', better: 'high', fmt: 1, signed: true, value: (r) => per(r.off.points - r.def.points, r.games) },
  { key: 'tod', side: 'both', label: 'Turnover differential', better: 'high', fmt: 0, signed: true, value: (r) => (r.games ? r.def.turnovers - r.off.turnovers : null) },
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
