// Awards, records and a hall of fame, all derived from the season stat lines
// every club keeps and the history the final writes.
//
// The MVP problem: raw fantasy points crown a quarterback every year, since
// the scoring and the simulation both lean on the position. So every player
// is scored against his own position first (how far above the league's
// starters at that position he was, in standard deviations) and only then
// weighted by positional leverage, softened with a power below one half.
// Quarterbacks still win most years, as they do in real football; a back or
// a receiver with a truly outlying season can beat one.

import { ROSTER_SLOTS } from '../data/positions.js';
import { fantasyPoints } from './stats.js';
import { TRUE_LEVERAGE } from './auction.js';
import { powerRankings, standings } from './season.js';

const OFFENSE = ['QB', 'RB', 'WR', 'TE'];
const DEFENSE = ['DL', 'LB', 'CB', 'S'];
const ALL_LEAGUE_COUNTS = { QB: 1, RB: 1, WR: 3, TE: 1, DL: 4, LB: 3, CB: 2, S: 2, K: 1, P: 1 };
/**
 * How much a position's importance counts, against how far a season stood above
 * the rest of that position. This used to raise the leverage table to a power,
 * and the power was 0.35 — flat enough that the RUNNING BACK won the award more
 * often than the quarterback, in a game whose own leverage table prices a
 * quarterback at 1.7 times a back. A back's fantasy line is more variable than
 * a quarterback's, so his z-score runs further from the mean, and compressing a
 * 1.7x advantage to 1.2x let that variance decide the award.
 *
 * Swept over 29 seasons, three seeds, `npm run playthrough`:
 *
 *   exponent   QB    RB    others
 *   0.35       17%   48%   DL 4, WR 3, TE 3
 *   0.7        66%   34%   —
 *   1.0        79%   21%   —
 *   1.3        86%   14%   —
 *
 * Real MVP voting since 2000 runs about 79% quarterbacks and 12% backs, so 1.0
 * is the fit — and 1.0 means there is no exponent at all. The award is a
 * player's season weighted by what his position is worth, with no free
 * parameter in between, which is what it should have been described as from the
 * start. Backs still take one in five, a little more often than they really do;
 * pushing past 1.0 to correct that buys realism nobody asked for at the cost of
 * a league where only quarterbacks ever win.
 */
const MVP_WEIGHT = TRUE_LEVERAGE;

/** Every player with a stat line this season: { id, p, team (idx), s, pts, games }. */
export function seasonLines(league, byId) {
  const out = [];
  league.teams.forEach((t, ti) => {
    for (const [id, s] of Object.entries(t.seasonStats?.players || {})) {
      const p = byId.get(id);
      if (!p) continue;
      out.push({ id, p, team: ti, s, pts: playerScore(p, s), games: s.games || 0 });
    }
  });
  return out;
}

/** Position-aware season score: fantasy points, with punters rated on placement and distance. */
export function playerScore(p, s) {
  if (p.pos === 'P') return s.p.n ? Math.round((s.p.yds / s.p.n) * 0.5 + s.p.in20 * 1.5) : 0;
  if (p.pos === 'OL') return 0;
  return fantasyPoints(s);
}

/** Z-score of each line against the starters at its position (players with at least half the games). */
function positionZ(lines, gamesInSeason) {
  const byPos = {};
  for (const l of lines) if (l.games >= gamesInSeason / 2) (byPos[l.p.pos] ??= []).push(l.pts);
  const stats = {};
  for (const [pos, arr] of Object.entries(byPos)) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, arr.length - 1)) || 1;
    stats[pos] = { mean, sd, n: arr.length };
  }
  return (l) => (stats[l.p.pos] && l.games >= gamesInSeason / 2 ? (l.pts - stats[l.p.pos].mean) / stats[l.p.pos].sd : -99);
}

function fmtLine(p, s) {
  switch (p.pos) {
    case 'QB': return `${s.pass.yds} yds, ${s.pass.td} TD, ${s.pass.int} INT${s.rush.td ? `, ${s.rush.td} rush TD` : ''}`;
    case 'RB': return `${s.rush.yds} rush yds, ${s.rush.td + s.rec.td} TD, ${s.rec.rec} rec`;
    case 'WR': case 'TE': return `${s.rec.rec} rec, ${s.rec.yds} yds, ${s.rec.td} TD`;
    case 'K': return `${s.k.fgm}/${s.k.fga} FG, ${s.k.xpm} XP`;
    case 'P': return s.p.n ? `${(s.p.yds / s.p.n).toFixed(1)} avg, ${s.p.in20} inside the 20` : 'no punts';
    default: return `${s.def.tkl} tkl, ${s.def.sck} sck, ${s.def.int} INT${s.def.ff ? `, ${s.def.ff} FF` : ''}${s.def.td ? `, ${s.def.td} TD` : ''}`;
  }
}

/**
 * The season's honours from the lines as they stand: MVP, offensive and
 * defensive player, kicker, coach, an all-league team and the leaders.
 * Works mid-season too, which is what the awards race screen shows.
 */
export function seasonAwards(league, byId) {
  const lines = seasonLines(league, byId);
  const gamesInSeason = league.schedule?.length ? Math.max(1, ...league.teams.map((t) => t.record.w + t.record.l + t.record.t)) : 1;
  const z = positionZ(lines, gamesInSeason);
  const entry = (l) => (l ? { id: l.id, team: l.team, pts: l.pts, games: l.games, line: fmtLine(l.p, l.s), z: Math.round(z(l) * 100) / 100 } : null);
  const best = (filter, key = (l) => z(l)) => lines.filter(filter).sort((a, b) => key(b) - key(a))[0];
  const mvpKey = (l) => z(l) * (MVP_WEIGHT[l.p.pos] ?? 1);
  const mvpRace = lines.filter((l) => z(l) > -99 && l.p.pos !== 'OL').sort((a, b) => mvpKey(b) - mvpKey(a)).slice(0, 5).map((l) => ({ ...entry(l), score: Math.round(mvpKey(l) * 100) / 100 }));
  const allLeague = {};
  for (const [pos, n] of Object.entries(ALL_LEAGUE_COUNTS)) {
    allLeague[pos] = lines.filter((l) => l.p.pos === pos && l.games >= gamesInSeason / 2).sort((a, b) => b.pts - a.pts).slice(0, n).map(entry);
  }
  const top = (get, n = 3) => lines.filter((l) => get(l.s) > 0).sort((a, b) => get(b.s) - get(a.s)).slice(0, n).map((l) => ({ id: l.id, team: l.team, value: get(l.s) }));
  const leaders = {
    passYds: top((s) => s.pass.yds), passTd: top((s) => s.pass.td), rushYds: top((s) => s.rush.yds), rushTd: top((s) => s.rush.td),
    recYds: top((s) => s.rec.yds), recTd: top((s) => s.rec.td), receptions: top((s) => s.rec.rec), sacks: top((s) => s.def.sck),
    interceptions: top((s) => s.def.int), tackles: top((s) => s.def.tkl), fieldGoals: top((s) => s.k.fgm),
  };
  // Coach of the year: the club that beat its roster's expectation by most, by finishing place against power rank.
  let coach = null;
  if (league.teams.some((t) => t.record.w + t.record.l + t.record.t > 0)) {
    const power = powerRankings(league, byId).map((r) => r.idx);
    const table = standings(league).map((r) => r.idx);
    let bestGain = -Infinity;
    table.forEach((idx, finish) => {
      const gain = power.indexOf(idx) - finish + (league.teams[idx].record.w - league.teams[idx].record.l) * 0.01;
      if (gain > bestGain) { bestGain = gain; coach = idx; }
    });
  }
  return {
    mvp: mvpRace[0] || null,
    mvpRace,
    offensive: entry(best((l) => OFFENSE.includes(l.p.pos))),
    defensive: entry(best((l) => DEFENSE.includes(l.p.pos))),
    kicker: entry(best((l) => l.p.pos === 'K', (l) => l.pts)),
    coach,
    allLeague,
    leaders,
    games: gamesInSeason,
  };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const SEASON_RECORDS = {
  passYds: ['Passing yards, season', (s) => s.pass.yds], passTd: ['Passing touchdowns, season', (s) => s.pass.td],
  rushYds: ['Rushing yards, season', (s) => s.rush.yds], rushTd: ['Rushing touchdowns, season', (s) => s.rush.td],
  recYds: ['Receiving yards, season', (s) => s.rec.yds], receptions: ['Receptions, season', (s) => s.rec.rec], recTd: ['Receiving touchdowns, season', (s) => s.rec.td],
  sacks: ['Sacks, season', (s) => s.def.sck], interceptions: ['Interceptions, season', (s) => s.def.int], tackles: ['Tackles, season', (s) => s.def.tkl],
  fieldGoals: ['Field goals, season', (s) => s.k.fgm], fantasy: ['Fantasy points, season', (s) => fantasyPoints(s)],
};
const GAME_RECORDS = {
  gPassYds: ['Passing yards, game', (s) => s.pass.yds], gPassTd: ['Passing touchdowns, game', (s) => s.pass.td],
  gRushYds: ['Rushing yards, game', (s) => s.rush.yds], gRecYds: ['Receiving yards, game', (s) => s.rec.yds],
  gReceptions: ['Receptions, game', (s) => s.rec.rec], gSacks: ['Sacks, game', (s) => s.def.sck], gFantasy: ['Fantasy points, game', (s) => fantasyPoints(s)],
};
export const RECORD_LABELS = Object.fromEntries([...Object.entries(SEASON_RECORDS), ...Object.entries(GAME_RECORDS)].map(([k, [label]]) => [k, label]));
export const TEAM_RECORD_LABELS = { teamPoints: 'Points in a game', teamMargin: 'Margin of victory', teamPointsSeason: 'Points in a season', teamWins: 'Wins in a season' };

function consider(records, key, value, holder) {
  if (!(value > 0)) return;
  const cur = records[key];
  if (!cur || value > cur.value) records[key] = { value, ...holder };
}

/**
 * Fold a finished season into the league's record book. Single-game player
 * records come only from games that kept player lines (yours and the
 * playoffs); season and team records cover everyone.
 */
export function updateRecords(league, byId) {
  league.records ??= { players: {}, teams: {} };
  const R = league.records.players, T = league.records.teams;
  league.teams.forEach((t, ti) => {
    for (const [id, s] of Object.entries(t.seasonStats?.players || {})) {
      if (!byId.get(id)) continue;
      for (const [key, [, get]] of Object.entries(SEASON_RECORDS)) consider(R, key, get(s), { id, team: ti, season: league.season });
    }
    consider(T, 'teamPointsSeason', t.record.pf, { team: ti, season: league.season });
    consider(T, 'teamWins', t.record.w, { team: ti, season: league.season });
  });
  const games = [...league.schedule.flatMap((w) => w.games), ...(league.playoffs?.rounds || []).flatMap((r) => r.games)].filter((g) => g.result);
  for (const g of games) {
    const [hs, as] = g.result.score;
    consider(T, 'teamPoints', hs, { team: g.home, season: league.season, vs: g.away });
    consider(T, 'teamPoints', as, { team: g.away, season: league.season, vs: g.home });
    consider(T, 'teamMargin', hs - as, { team: g.home, season: league.season, vs: g.away });
    consider(T, 'teamMargin', as - hs, { team: g.away, season: league.season, vs: g.home });
    if (!g.result.players) continue;
    [g.home, g.away].forEach((ti, side) => {
      for (const [id, s] of Object.entries(g.result.players[side] || {})) {
        if (!byId.get(id)) continue;
        for (const [key, [, get]] of Object.entries(GAME_RECORDS)) consider(R, key, get(s), { id, team: ti, season: league.season, vs: side === 0 ? g.away : g.home });
      }
    });
  }
  return league.records;
}

// ---------------------------------------------------------------------------
// Careers and the hall of fame
// ---------------------------------------------------------------------------

export const HOF_MIN_SEASONS = 3;
export const HOF_THRESHOLD = 12;

/** Add a finished season to every player's career line, and hand out the honours. */
export function updateCareers(league, awards, byId) {
  league.careers ??= {};
  const C = league.careers;
  const bump = (id, key, n = 1) => { const c = (C[id] ??= blankCareer()); c[key] = (c[key] || 0) + n; };
  league.teams.forEach((t, ti) => {
    for (const [id, s] of Object.entries(t.seasonStats?.players || {})) {
      const p = byId.get(id);
      if (!p || !(s.games > 0)) continue;
      const c = (C[id] ??= blankCareer());
      c.seasons++;
      c.games += s.games;
      c.pts += playerScore(p, s);
      c.passYds += s.pass.yds; c.passTd += s.pass.td; c.rushYds += s.rush.yds; c.rushTd += s.rush.td; c.recYds += s.rec.yds; c.recTd += s.rec.td;
      c.sacks += s.def.sck; c.interceptions += s.def.int; c.tackles += s.def.tkl; c.fieldGoals += s.k.fgm;
      if (!c.teams.includes(ti)) c.teams.push(ti);
      c.last = league.season;
    }
  });
  if (awards.mvp) bump(awards.mvp.id, 'mvp');
  if (awards.offensive) bump(awards.offensive.id, 'opoy');
  if (awards.defensive) bump(awards.defensive.id, 'dpoy');
  for (const list of Object.values(awards.allLeague || {})) for (const e of list) if (e) bump(e.id, 'allLeague');
  for (const list of Object.values(awards.leaders || {})) if (list[0]) bump(list[0].id, 'leader');
  if (league.champion != null) {
    const champ = league.teams[league.champion];
    for (const s of ROSTER_SLOTS) if (champ.slots[s.id]) bump(champ.slots[s.id], 'titles');
  }
  return C;
}

export function blankCareer() {
  return { seasons: 0, games: 0, pts: 0, passYds: 0, passTd: 0, rushYds: 0, rushTd: 0, recYds: 0, recTd: 0, sacks: 0, interceptions: 0, tackles: 0, fieldGoals: 0, mvp: 0, opoy: 0, dpoy: 0, allLeague: 0, leader: 0, titles: 0, teams: [], last: 0 };
}

/**
 * The career table, with its zeroes left out, and put back.
 *
 * Twenty-one fields a man, of which most are zero for anybody: a quarterback
 * records no sacks, tackles or field goals, and a lineman records none of the
 * offensive lines either. Written out in full that is 306 bytes a player and
 * 258 KB for the 864 of a pro league, second only to the schedule in a save.
 * Dropping the zeroes takes it to 94 KB.
 *
 * This is deliberately a *storage* format and not the shape anything reads.
 * Stripping the zeroes in memory would mean every reader of `c.sacks` had to
 * cope with it being absent, and the failure when one did not would be a
 * silent NaN in a record book. So the pair runs at the localStorage boundary
 * in slots.js and nothing else ever sees a packed table.
 */
export function packCareers(careers) {
  if (!careers) return careers;
  const out = {};
  for (const [id, c] of Object.entries(careers)) {
    const row = {};
    for (const [k, v] of Object.entries(c)) {
      if (v === 0) continue;
      if (Array.isArray(v) && !v.length) continue;
      row[k] = v;
    }
    out[id] = row;
  }
  return out;
}

export function unpackCareers(careers) {
  if (!careers) return careers;
  const out = {};
  for (const [id, c] of Object.entries(careers)) out[id] = { ...blankCareer(), ...c };
  return out;
}

/** A résumé score: longevity, honours and rings. Documented in DESIGN.md. */
export function hallScore(c) {
  return c.seasons + 4 * c.mvp + 2 * (c.opoy + c.dpoy) + 1.5 * c.allLeague + 0.5 * c.leader + 2 * c.titles + c.pts / 300;
}

/** Inducted players, best résumé first, and the players nearest the door. */
export function hallOfFame(league) {
  const rows = Object.entries(league.careers || {}).map(([id, c]) => ({ id, c, score: Math.round(hallScore(c) * 10) / 10 }));
  const inducted = rows.filter((r) => r.c.seasons >= HOF_MIN_SEASONS && r.score >= HOF_THRESHOLD).sort((a, b) => b.score - a.score);
  const onTrack = rows.filter((r) => !(r.c.seasons >= HOF_MIN_SEASONS && r.score >= HOF_THRESHOLD)).sort((a, b) => b.score - a.score).slice(0, 10);
  return { inducted, onTrack };
}

/** Called by the final: honours, records and careers for the season just ended. */
export function closeSeasonBooks(league, byId) {
  const awards = seasonAwards(league, byId);
  const compact = {
    mvp: awards.mvp, offensive: awards.offensive, defensive: awards.defensive, kicker: awards.kicker, coach: awards.coach,
    allLeague: awards.allLeague, leaders: Object.fromEntries(Object.entries(awards.leaders).map(([k, v]) => [k, v[0] || null])),
  };
  const h = league.history?.find((x) => x.season === league.season);
  if (h) h.awards = compact;
  updateRecords(league, byId);
  updateCareers(league, awards, byId);
  return compact;
}
