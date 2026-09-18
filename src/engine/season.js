// League creation, scheduling, standings, playoffs, and season-stat rollups.
import { AI_TEAMS } from '../data/teams.js';
import { DEFAULT_STRATEGY } from './playcall.js';
import { RNG, hashSeed } from './rng.js';
import { createDraft, assignGms } from './draft.js';
import { emptyTeamStats, emptyPlayerStats, addPlayerStats, addTeamStats } from './stats.js';
import { buildLineup, teamPower } from './ratings.js';
import { createGame, simulateGame } from './game.js';

export const LEAGUE_VERSION = 1;

export function createLeague({ name, user, numTeams = 8, seed } = {}) {
  seed = seed ?? Math.floor(Math.random() * 4294967295);
  const rng = new RNG(seed);
  const aiPool = rng.shuffle(AI_TEAMS).slice(0, numTeams - 1);
  const teams = [
    { id: 'user', name: user.name || 'My Team', abbr: (user.abbr || 'ME').toUpperCase().slice(0, 4), color: user.color || '#e63946', isUser: true, gm: null },
    ...aiPool.map((t, i) => ({ id: `ai${i + 1}`, name: t.name, abbr: t.abbr, color: t.color, isUser: false, gm: null })),
  ].map((t) => ({
    ...t,
    slots: {},
    strategy: { ...DEFAULT_STRATEGY },
    record: { w: 0, l: 0, t: 0, pf: 0, pa: 0 },
    seasonStats: { team: emptyTeamStats(), players: {} },
  }));
  const league = {
    version: LEAGUE_VERSION,
    id: `lg-${seed.toString(36)}-${Date.now().toString(36)}`,
    name: name || 'All-Time League',
    seed,
    created: Date.now(),
    season: 1,
    teams,
    draft: null,
    phase: 'draft',
    schedule: [],
    week: 1,
    playoffs: null,
    champion: null,
    results: [],
    settings: { coachMode: false, coachDefense: false },
  };
  assignGms(league, rng);
  league.draft = createDraft(league, rng);
  league.rngState = rng.state;
  return league;
}

export function userTeamIndex(league) {
  return league.teams.findIndex((t) => t.isUser);
}

/** Double round-robin via the circle method. Returns [{ week, games: [{ home, away }] }]. */
export function buildSchedule(numTeams, rng) {
  const ids = [...Array(numTeams).keys()];
  const rounds = [];
  const n = ids.length;
  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      games.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
    }
    rounds.push(games);
    // rotate all but first
    arr.splice(1, 0, arr.pop());
  }
  const first = rng ? rng.shuffle(rounds) : rounds;
  const second = first.map((games) => games.map((g) => ({ home: g.away, away: g.home })));
  return [...first, ...second].map((games, i) => ({ week: i + 1, games: games.map((g) => ({ ...g, result: null })) }));
}

/** Called when the draft completes. */
export function startSeason(league) {
  const rng = new RNG(league.rngState);
  league.schedule = buildSchedule(league.teams.length, rng);
  league.week = 1;
  league.phase = 'season';
  league.rngState = rng.state;
  return league;
}

export function gameSeed(league, week, home, away) {
  return hashSeed(`${league.seed}:s${league.season}:w${week}:${home}v${away}`);
}

export function teamForGame(league, idx, byId) {
  const t = league.teams[idx];
  return { id: t.id, name: t.name, abbr: t.abbr, color: t.color, isUser: t.isUser, strategy: t.strategy, lineup: buildLineup(t.slots, byId) };
}

export function currentWeek(league) {
  if (league.phase === 'season') return league.schedule[league.week - 1] || null;
  if (league.phase === 'playoffs') return league.playoffs.rounds[league.playoffs.round - 1] || null;
  return null;
}

export function userGameThisWeek(league) {
  const wk = currentWeek(league);
  if (!wk) return null;
  const u = userTeamIndex(league);
  return wk.games.find((g) => g.home === u || g.away === u) || null;
}

/** Record a finished game object into the league. */
export function recordResult(league, week, gameEntry, g, { keepLog = false } = {}) {
  const [hs, as] = g.score;
  const home = league.teams[gameEntry.home], away = league.teams[gameEntry.away];
  const result = {
    score: [hs, as], seed: g.seed, overtime: g.quarter >= 5,
    teamStats: [g.stats[0].team, g.stats[1].team],
    players: [compactPlayers(g.stats[0].players), compactPlayers(g.stats[1].players)],
    log: keepLog ? g.log : null,
    drives: keepLog ? g.drives : null,
  };
  gameEntry.result = result;
  if (league.phase === 'season') {
    home.record.pf += hs; home.record.pa += as; away.record.pf += as; away.record.pa += hs;
    if (hs > as) { home.record.w++; away.record.l++; } else if (as > hs) { away.record.w++; home.record.l++; } else { home.record.t++; away.record.t++; }
    for (const [side, team] of [[0, home], [1, away]]) {
      addTeamStats(team.seasonStats.team, g.stats[side].team);
      for (const [pid, s] of Object.entries(g.stats[side].players)) {
        addPlayerStats((team.seasonStats.players[pid] ??= emptyPlayerStats()), s);
      }
    }
  }
  league.results.push({ season: league.season, week, phase: league.phase, home: gameEntry.home, away: gameEntry.away, score: [hs, as] });
  return result;
}

function compactPlayers(players) {
  // Drop empty stat lines to keep saves small.
  const out = {};
  for (const [id, s] of Object.entries(players)) {
    const used = Object.entries(s).some(([k, v]) => k !== 'games' && Object.values(v).some((x) => x > 0));
    if (used) out[id] = s;
  }
  return out;
}

/** Simulate every unplayed game in the current week except (optionally) the user's. */
export function simulateWeekAi(league, byId, { includeUser = false } = {}) {
  const wk = currentWeek(league);
  if (!wk) return;
  const u = userTeamIndex(league);
  for (const entry of wk.games) {
    if (entry.result) continue;
    if (entry.bye) continue;
    const isUserGame = entry.home === u || entry.away === u;
    if (isUserGame && !includeUser) continue;
    const g = createGame(teamForGame(league, entry.home, byId), teamForGame(league, entry.away, byId), {
      seed: gameSeed(league, weekNumber(league), entry.home, entry.away),
      playoff: league.phase === 'playoffs',
    });
    simulateGame(g);
    recordResult(league, weekNumber(league), entry, g, { keepLog: isUserGame });
  }
}

export function weekNumber(league) {
  return league.phase === 'playoffs' ? 100 + league.playoffs.round : league.week;
}

export function weekComplete(league) {
  const wk = currentWeek(league);
  return !!wk && wk.games.every((g) => g.result || g.bye);
}

/** Advance to the next week / playoff round once every game is in. */
export function advanceWeek(league) {
  if (!weekComplete(league)) return false;
  if (league.phase === 'season') {
    if (league.week >= league.schedule.length) {
      startPlayoffs(league);
    } else {
      league.week++;
    }
    return true;
  }
  if (league.phase === 'playoffs') {
    const po = league.playoffs;
    const round = po.rounds[po.round - 1];
    const winners = round.games.filter((g) => !g.bye).map((g) => (g.result.score[0] >= g.result.score[1] ? g.home : g.away));
    if (winners.length === 1) {
      league.champion = winners[0];
      league.phase = 'complete';
      (league.history ??= []).push({ season: league.season, champion: winners[0], record: { ...league.teams[winners[0]].record } });
      return true;
    }
    // Next round: pair by seed order.
    const seeded = winners.slice().sort((a, b) => po.seeds.indexOf(a) - po.seeds.indexOf(b));
    const games = [];
    for (let i = 0; i < seeded.length / 2; i++) games.push({ home: seeded[i], away: seeded[seeded.length - 1 - i], result: null });
    po.rounds.push({ week: po.round + 1, name: games.length === 1 ? 'Championship' : 'Semifinals', games });
    po.round++;
    return true;
  }
  return false;
}

export function standings(league) {
  const rows = league.teams.map((t, i) => {
    const gp = t.record.w + t.record.l + t.record.t;
    return { idx: i, team: t, ...t.record, gp, pct: gp ? (t.record.w + t.record.t * 0.5) / gp : 0, diff: t.record.pf - t.record.pa };
  });
  rows.sort((a, b) => b.pct - a.pct || b.diff - a.diff || b.pf - a.pf || a.idx - b.idx);
  return rows;
}

export function startPlayoffs(league) {
  const rows = standings(league);
  const n = league.teams.length >= 6 ? 4 : 2;
  const seeds = rows.slice(0, n).map((r) => r.idx);
  const games = [];
  for (let i = 0; i < n / 2; i++) games.push({ home: seeds[i], away: seeds[n - 1 - i], result: null });
  league.playoffs = { seeds, round: 1, rounds: [{ week: 1, name: n === 4 ? 'Semifinals' : 'Championship', games }] };
  league.phase = 'playoffs';
}

export function powerRankings(league, byId) {
  return league.teams.map((t, i) => ({ idx: i, team: t, power: teamPower(buildLineup(t.slots, byId)) })).sort((a, b) => b.power - a.power);
}

/** Keep rosters, wipe records, and start another season. */
export function newSeasonSameRosters(league) {
  for (const t of league.teams) {
    t.record = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    t.seasonStats = { team: emptyTeamStats(), players: {} };
  }
  league.season++;
  league.playoffs = null;
  league.champion = null;
  league.results = [];
  startSeason(league);
  return league;
}
