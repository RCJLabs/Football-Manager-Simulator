// League creation, scheduling, standings, playoffs, and season-stat rollups.
//
// Two league modes share everything below the schedule:
//   fantasy  8/10/12 teams, one table, a small seeded bracket
//   pro      32 teams in two conferences of four divisions, a 17-game slate
//            built the way the real league builds one, division standings with
//            tiebreakers, seven playoff seeds per conference with a bye for
//            the top seed, and a neutral-site final.
import { AI_TEAMS } from '../data/teams.js';
import { PRO_TEAMS, CONFERENCES, DIVISIONS } from '../data/pro.js';
import { DEFAULT_STRATEGY } from './playcall.js';
import { RNG, hashSeed } from './rng.js';
import { createDraft, assignGms } from './draft.js';
import { createAuction } from './auction.js';
import { emptyTeamStats, emptyPlayerStats, addPlayerStats, addTeamStats } from './stats.js';
import { buildLineup, teamPower, overall } from './ratings.js';
import { ROSTER_SLOTS } from '../data/positions.js';
import { createGame, simulateGame } from './game.js';
import { INJURY_LEVELS, DEFAULT_INJURY_LEVEL, recordGameInjuries, tickInjuries } from './injuries.js';

export const LEAGUE_VERSION = 3;
export const FANTASY_SIZES = [8, 10, 12];
export const PRO_SIZE = 32;

function blankTeam(t) {
  return {
    ...t,
    slots: {},
    strategy: { ...DEFAULT_STRATEGY },
    record: { w: 0, l: 0, t: 0, pf: 0, pa: 0 },
    seasonStats: { team: emptyTeamStats(), players: {} },
  };
}

/**
 * mode 'fantasy': the user names a club and faces numTeams-1 AI clubs.
 * mode 'pro': 32 franchises; `franchise` is the index the user takes over, and
 * any user name/abbr/color given overrides that franchise's identity.
 */
export function createLeague({ name, user = {}, numTeams = 8, seed, draftType = 'auction', budget, mode = 'fantasy', franchise = 0, injuries = DEFAULT_INJURY_LEVEL } = {}) {
  seed = seed ?? Math.floor(Math.random() * 4294967295);
  const rng = new RNG(seed);
  let teams;
  if (mode === 'pro') {
    const f = Math.max(0, Math.min(PRO_TEAMS.length - 1, Number(franchise) || 0));
    teams = PRO_TEAMS.map((t, i) => blankTeam({
      id: i === f ? 'user' : `pro${i}`,
      name: i === f && user.name ? user.name : t.name,
      abbr: i === f && user.abbr ? user.abbr.toUpperCase().slice(0, 4) : t.abbr,
      color: i === f && user.color ? user.color : t.color,
      conf: t.conf, div: t.div, isUser: i === f, gm: null,
    }));
    numTeams = PRO_SIZE;
  } else {
    numTeams = Math.max(4, Math.min(16, numTeams));
    const aiPool = rng.shuffle(AI_TEAMS).slice(0, numTeams - 1);
    teams = [
      { id: 'user', name: user.name || 'My Team', abbr: (user.abbr || 'ME').toUpperCase().slice(0, 4), color: user.color || '#e63946', isUser: true, gm: null },
      ...aiPool.map((t, i) => ({ id: `ai${i + 1}`, name: t.name, abbr: t.abbr, color: t.color, isUser: false, gm: null })),
    ].map(blankTeam);
  }
  const league = {
    version: LEAGUE_VERSION,
    id: `lg-${seed.toString(36)}-${Date.now().toString(36)}`,
    name: name || (mode === 'pro' ? 'Pro League' : 'All-Time League'),
    mode,
    seed,
    created: Date.now(),
    season: 1,
    teams,
    draftType,
    draft: null,
    auction: null,
    phase: 'draft',
    schedule: [],
    week: 1,
    playoffs: null,
    champion: null,
    results: [],
    history: [],
    injuries: {},
    settings: { coachMode: false, coachDefense: false, injuries: INJURY_LEVELS[injuries] != null ? injuries : DEFAULT_INJURY_LEVEL },
  };
  assignGms(league, rng);
  if (draftType === 'auction') league.auction = createAuction(league, rng, budget ? { budget } : {});
  else league.draft = createDraft(league, rng);
  league.rngState = rng.state;
  return league;
}

/**
 * Bring a saved league up to the current shape. Version 3 added the QB2 bench
 * slot and the injury ledger; an older roster gets an empty slot, which the
 * waiver wire can fill.
 */
export function migrateLeague(league) {
  if (!league || (league.version || 1) >= LEAGUE_VERSION) return league;
  for (const t of league.teams) for (const s of ROSTER_SLOTS) if (!(s.id in t.slots)) t.slots[s.id] = null;
  league.injuries ??= {};
  league.settings ??= {};
  league.settings.injuries ??= DEFAULT_INJURY_LEVEL;
  league.version = LEAGUE_VERSION;
  return league;
}

export function userTeamIndex(league) {
  return league.teams.findIndex((t) => t.isUser);
}

/** The injury dial as a rate multiplier for createGame. */
export function injuryLevel(league) {
  return INJURY_LEVELS[league.settings?.injuries] ?? INJURY_LEVELS[DEFAULT_INJURY_LEVEL];
}

/** createGame options for a schedule entry: seed, playoff flag, home edge, injury dial. */
export function gameOptions(league, entry) {
  return {
    seed: gameSeed(league, weekNumber(league), entry.home, entry.away),
    playoff: league.phase === 'playoffs',
    homeAdvantage: !entry.neutral,
    injuryLevel: injuryLevel(league),
  };
}

export function isPro(league) {
  return league.mode === 'pro';
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/** One round-robin cycle via the circle method: n-1 rounds, each a perfect matching. */
function roundRobinRounds(ids) {
  const n = ids.length;
  const arr = ids.slice();
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      games.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
    }
    rounds.push(games);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

/**
 * Fantasy schedule. Leagues of 8 or fewer play everyone twice; larger ones play
 * a single round plus enough of a second cycle to reach 13 games, so a season
 * stays 13-14 weeks whatever the size.
 */
export function buildSchedule(numTeams, rng) {
  const ids = [...Array(numTeams).keys()];
  const first = roundRobinRounds(ids);
  const flipped = first.map((games) => games.map((g) => ({ home: g.away, away: g.home })));
  let rounds;
  if (2 * (numTeams - 1) <= 16) rounds = [...first, ...flipped];
  else rounds = [...first, ...flipped.slice(0, Math.max(0, 13 - (numTeams - 1)))];
  const ordered = rng ? rng.shuffle(rounds) : rounds;
  return ordered.map((games, i) => ({ week: i + 1, games: games.map((g) => ({ ...g, result: null })) }));
}

/**
 * Perfect matchings of two 4-team groups against each other. Round r pairs
 * a[i] with b[(i+r)%4]; hosting follows (i+j)%4 < 2, a 4x4 pattern with two
 * home games in every row and every column, so both sides split hosting
 * evenly. A two-game block uses rounds 0 and 2 for the same reason.
 */
function crossRounds(a, b, count = 4) {
  const rs = count === 2 ? [0, 2] : [...Array(count).keys()];
  return rs.map((r) => {
    const games = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + r) % 4;
      const x = a[i], y = b[j];
      games.push((i + j) % 4 < 2 ? { home: x, away: y } : { home: y, away: x });
    }
    return games;
  });
}

/**
 * The 17-game pro slate, built from the same blocks the real league uses:
 *   6  division games (home and away against three rivals)
 *   4  against one other division in the conference (rotates by season)
 *   4  against one division in the other conference (rotates by season)
 *   2  against a second same-conference division
 *   1  against a second other-conference division
 * Every block is a set of perfect matchings over all 32 teams, so each week has
 * exactly 16 games and nobody sits. Blocks are shuffled into 17 weeks.
 */
export function buildProSchedule(teams, rng, season = 1) {
  const div = (c, d) => teams.map((t, i) => (t.conf === c && t.div === d ? i : -1)).filter((i) => i >= 0);
  const D = [0, 1].map((c) => [0, 1, 2, 3].map((d) => div(c, d)));
  const rounds = [];
  const push = (list) => list.forEach((games) => rounds.push(games));

  // Division blocks: a double round-robin inside every division, all at once.
  const divRounds = [];
  for (let c = 0; c < 2; c++) for (let d = 0; d < 4; d++) {
    const rr = roundRobinRounds(D[c][d]);
    const both = [...rr, ...rr.map((g) => g.map((x) => ({ home: x.away, away: x.home })))];
    both.forEach((games, r) => { (divRounds[r] ??= []).push(...games); });
  }
  push(divRounds);

  // Rotations: which divisions meet this season.
  const s = (season - 1) % 3;
  const intraPairs = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  const intra = intraPairs[s];
  const intra2 = intraPairs[(s + 1) % 3];
  const interShift = (season - 1) % 4;

  // Four games against one same-conference division.
  const intraRounds = [];
  for (let c = 0; c < 2; c++) for (const [a, b] of intra) {
    crossRounds(D[c][a], D[c][b]).forEach((games, r) => { (intraRounds[r] ??= []).push(...games); });
  }
  push(intraRounds);

  // Four games against one other-conference division.
  const interRounds = [];
  for (let d = 0; d < 4; d++) {
    crossRounds(D[0][d], D[1][(d + interShift) % 4]).forEach((games, r) => { (interRounds[r] ??= []).push(...games); });
  }
  push(interRounds);

  // Two games against a second same-conference division.
  const intra2Rounds = [];
  for (let c = 0; c < 2; c++) for (const [a, b] of intra2) {
    crossRounds(D[c][a], D[c][b], 2).forEach((games, r) => { (intra2Rounds[r] ??= []).push(...games); });
  }
  push(intra2Rounds);

  // The seventeenth game: one more cross-conference opponent.
  const extra = [];
  for (let d = 0; d < 4; d++) {
    crossRounds(D[0][d], D[1][(d + interShift + 2) % 4], 1).forEach((games) => extra.push(...games));
  }
  rounds.push(extra);

  const ordered = rng ? rng.shuffle(rounds) : rounds;
  return ordered.map((games, i) => ({ week: i + 1, games: games.map((g) => ({ ...g, result: null })) }));
}

/**
 * Order every position group by overall so the best players start. Slots fill
 * in the order they were bought, so an auction can leave a 92 back at RB2
 * behind a 75 bought earlier. AI clubs are re-sorted every season; the user's
 * club only the first time, since they can arrange their own depth chart.
 */
export function sortDepthCharts(league, byId) {
  for (const t of league.teams) {
    if (t.isUser && t.depthSorted) continue;
    const groups = {};
    for (const slot of ROSTER_SLOTS) (groups[slot.pos] ??= []).push(slot.id);
    for (const ids of Object.values(groups)) {
      const players = ids.map((id) => t.slots[id]).filter(Boolean);
      players.sort((x, y) => overall(byId.get(y)) - overall(byId.get(x)));
      ids.forEach((id, i) => { t.slots[id] = players[i]; });
    }
    if (t.isUser) t.depthSorted = true;
  }
}

/** Called when the draft or auction completes, and at the start of each later season. */
export function startSeason(league, byId) {
  if (byId) sortDepthCharts(league, byId);
  const rng = new RNG(league.rngState);
  league.schedule = isPro(league) ? buildProSchedule(league.teams, rng, league.season) : buildSchedule(league.teams.length, rng);
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
  return { id: t.id, name: t.name, abbr: t.abbr, color: t.color, isUser: t.isUser, strategy: t.strategy, lineup: buildLineup(t.slots, byId, league.injuries) };
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

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Record a finished game. Per-game player lines are kept only when asked
 * (the user's games and the playoffs); season totals accumulate regardless.
 * A 32-team season is 272 games, and keeping every box score would outgrow
 * localStorage.
 */
export function recordResult(league, week, gameEntry, g, { keepLog = false, keepPlayers = keepLog } = {}) {
  const [hs, as] = g.score;
  const home = league.teams[gameEntry.home], away = league.teams[gameEntry.away];
  const result = {
    score: [hs, as], seed: g.seed, overtime: g.quarter >= 5,
    teamStats: [g.stats[0].team, g.stats[1].team],
    players: keepPlayers ? [compactPlayers(g.stats[0].players), compactPlayers(g.stats[1].players)] : null,
    log: keepLog ? g.log : null,
    drives: keepLog ? g.drives : null,
    injuries: g.teams.map((t) => (t.injuries || []).map((x) => ({ id: x.id, kind: x.kind, weeks: x.weeks }))),
  };
  gameEntry.result = result;
  recordGameInjuries(league, g, [gameEntry.home, gameEntry.away], week);
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
  const playoff = league.phase === 'playoffs';
  for (const entry of wk.games) {
    if (entry.result || entry.bye) continue;
    const isUserGame = entry.home === u || entry.away === u;
    if (isUserGame && !includeUser) continue;
    const g = createGame(teamForGame(league, entry.home, byId), teamForGame(league, entry.away, byId), gameOptions(league, entry));
    simulateGame(g);
    recordResult(league, weekNumber(league), entry, g, { keepLog: isUserGame, keepPlayers: isUserGame || playoff });
  }
}

export function weekNumber(league) {
  return league.phase === 'playoffs' ? 100 + league.playoffs.round : league.week;
}

export function weekComplete(league) {
  const wk = currentWeek(league);
  return !!wk && wk.games.every((g) => g.result || g.bye);
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/** Win percentage with ties as half a win. */
function pctOf(r) {
  const gp = r.w + r.l + r.t;
  return gp ? (r.w + r.t * 0.5) / gp : 0;
}

/** Record of team `a` restricted to games against a filter on the opponent. */
function recordVs(league, a, keep) {
  const r = { w: 0, l: 0, t: 0 };
  for (const g of league.results) {
    if (g.phase !== 'season' || g.season !== league.season) continue;
    if (g.home !== a && g.away !== a) continue;
    const opp = g.home === a ? g.away : g.home;
    if (!keep(opp)) continue;
    const mine = g.home === a ? g.score[0] : g.score[1];
    const theirs = g.home === a ? g.score[1] : g.score[0];
    if (mine > theirs) r.w++; else if (mine < theirs) r.l++; else r.t++;
  }
  return r;
}

/**
 * Tiebreak order: win%, head-to-head, division record (same division only),
 * conference record, point differential, points for. The last two keep a
 * fantasy league deterministic as well.
 */
function makeComparator(league) {
  const teams = league.teams;
  const sameDiv = (a, b) => teams[a].conf === teams[b].conf && teams[a].div === teams[b].div;
  return (a, b) => {
    const ra = teams[a].record, rb = teams[b].record;
    const d0 = pctOf(rb) - pctOf(ra);
    if (Math.abs(d0) > 1e-9) return d0;
    const h2h = recordVs(league, a, (o) => o === b);
    const d1 = pctOf({ w: h2h.l, l: h2h.w, t: h2h.t }) - pctOf(h2h);
    if (h2h.w + h2h.l + h2h.t > 0 && Math.abs(d1) > 1e-9) return d1;
    if (isPro(league)) {
      if (sameDiv(a, b)) {
        const d2 = pctOf(recordVs(league, b, (o) => sameDiv(b, o))) - pctOf(recordVs(league, a, (o) => sameDiv(a, o)));
        if (Math.abs(d2) > 1e-9) return d2;
      }
      const d3 = pctOf(recordVs(league, b, (o) => teams[o].conf === teams[b].conf)) - pctOf(recordVs(league, a, (o) => teams[o].conf === teams[a].conf));
      if (Math.abs(d3) > 1e-9) return d3;
    }
    const diff = (rb.pf - rb.pa) - (ra.pf - ra.pa);
    if (diff) return diff;
    if (rb.pf !== ra.pf) return rb.pf - ra.pf;
    return a - b;
  };
}

/** Flat table, best first. Works for both modes. */
export function standings(league) {
  const cmp = makeComparator(league);
  const order = league.teams.map((_, i) => i).sort(cmp);
  return order.map((idx) => {
    const t = league.teams[idx];
    const gp = t.record.w + t.record.l + t.record.t;
    return { idx, team: t, ...t.record, gp, pct: pctOf(t.record), diff: t.record.pf - t.record.pa };
  });
}

/**
 * Pro standings: conferences → divisions → rows, plus the seven playoff seeds
 * per conference (four division winners by record, then three wild cards).
 */
export function proStandings(league) {
  const cmp = makeComparator(league);
  const teams = league.teams;
  const rowFor = (idx) => {
    const t = teams[idx];
    const divRec = recordVs(league, idx, (o) => teams[o].conf === t.conf && teams[o].div === t.div);
    const confRec = recordVs(league, idx, (o) => teams[o].conf === t.conf);
    return { idx, team: t, ...t.record, gp: t.record.w + t.record.l + t.record.t, pct: pctOf(t.record), diff: t.record.pf - t.record.pa, divRec, confRec };
  };
  return CONFERENCES.map((confName, c) => {
    const divisions = DIVISIONS.map((divName, d) => {
      const members = teams.map((t, i) => (t.conf === c && t.div === d ? i : -1)).filter((i) => i >= 0).sort(cmp);
      return { name: divName, rows: members.map(rowFor) };
    });
    const winners = divisions.map((dv) => dv.rows[0].idx).sort(cmp);
    const others = teams.map((t, i) => (t.conf === c && !winners.includes(i) ? i : -1)).filter((i) => i >= 0).sort(cmp);
    const seeds = [...winners, ...others.slice(0, 3)];
    return { name: confName, divisions, seeds, inHunt: others.slice(3, 6) };
  });
}

// ---------------------------------------------------------------------------
// Playoffs: pools of seeds, byes when the field is not a power of two,
// reseeding every round, and a cross-pool final when there are two pools.
// ---------------------------------------------------------------------------

export function playoffFieldSize(numTeams) {
  if (numTeams < 6) return 2;
  if (numTeams < 12) return 4;
  if (numTeams < 14) return 6;
  return 8;
}

function pairRound(alive) {
  const c = alive.length;
  let size = 1;
  while (size < c) size *= 2;
  const byes = size - c;
  const playing = alive.slice(byes);
  const games = [];
  for (let i = 0; i < playing.length / 2; i++) games.push({ home: playing[i], away: playing[playing.length - 1 - i] });
  return { games, byes: alive.slice(0, byes) };
}

function roundLabel(league, aliveCount, isFinal) {
  if (isFinal) return 'Championship';
  if (isPro(league)) {
    if (aliveCount > 4) return 'Wild Card';
    if (aliveCount === 4) return 'Divisional';
    return 'Conference Championships';
  }
  if (aliveCount > 4) return 'Wild Card';
  if (aliveCount === 4) return 'Semifinals';
  return 'Championship';
}

export function startPlayoffs(league) {
  let pools;
  if (isPro(league)) {
    pools = proStandings(league).map((conf) => ({ name: conf.name, seeds: conf.seeds.slice(), alive: conf.seeds.slice() }));
  } else {
    const seeds = standings(league).slice(0, playoffFieldSize(league.teams.length)).map((r) => r.idx);
    pools = [{ name: 'Playoffs', seeds, alive: seeds.slice() }];
  }
  league.playoffs = { pools, round: 1, rounds: [], final: false };
  league.phase = 'playoffs';
  pushRound(league);
}

function pushRound(league) {
  const po = league.playoffs;
  const games = [];
  let byes = [];
  const aliveCount = Math.max(...po.pools.map((p) => p.alive.length));
  po.pools.forEach((pool, pi) => {
    const r = pairRound(pool.alive);
    r.games.forEach((g) => games.push({ ...g, pool: pi, result: null }));
    byes = byes.concat(r.byes.map((idx) => ({ team: idx, pool: pi })));
  });
  po.rounds.push({ week: po.rounds.length + 1, name: roundLabel(league, aliveCount, false), games, byes });
}

function pushFinal(league) {
  const po = league.playoffs;
  const champs = po.pools.map((p) => p.alive[0]);
  // Neutral site: the better regular-season record is listed first, but no home edge.
  const cmp = makeComparator(league);
  const [a, b] = champs.slice().sort(cmp);
  po.rounds.push({ week: po.rounds.length + 1, name: roundLabel(league, 2, true), games: [{ home: a, away: b, pool: -1, neutral: true, result: null }], byes: [] });
  po.final = true;
}

/** Advance to the next week / playoff round once every game is in. */
export function advanceWeek(league) {
  if (!weekComplete(league)) return false;
  tickInjuries(league, weekNumber(league));
  if (league.phase === 'season') {
    if (league.week >= league.schedule.length) startPlayoffs(league);
    else league.week++;
    return true;
  }
  if (league.phase !== 'playoffs') return false;
  const po = league.playoffs;
  const round = po.rounds[po.round - 1];
  const winnerOf = (g) => (g.result.score[0] >= g.result.score[1] ? g.home : g.away);
  if (po.final) {
    crown(league, winnerOf(round.games[0]));
    return true;
  }
  po.pools.forEach((pool, pi) => {
    const survivors = new Set(round.byes.filter((b) => b.pool === pi).map((b) => b.team));
    for (const g of round.games) if (g.pool === pi) survivors.add(winnerOf(g));
    pool.alive = pool.seeds.filter((idx) => survivors.has(idx));
  });
  po.round++;
  if (po.pools.every((p) => p.alive.length === 1)) {
    if (po.pools.length === 1) { crown(league, po.pools[0].alive[0]); po.round--; return true; }
    pushFinal(league);
    return true;
  }
  pushRound(league);
  return true;
}

function crown(league, idx) {
  league.champion = idx;
  league.phase = 'complete';
  (league.history ??= []).push({ season: league.season, champion: idx, record: { ...league.teams[idx].record } });
}

export function powerRankings(league, byId) {
  return league.teams.map((t, i) => ({ idx: i, team: t, power: teamPower(buildLineup(t.slots, byId, league.injuries)) })).sort((a, b) => b.power - a.power);
}

/** Keep rosters, wipe records, and start another season. */
export function newSeasonSameRosters(league, byId) {
  for (const t of league.teams) {
    t.record = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    t.seasonStats = { team: emptyTeamStats(), players: {} };
  }
  league.season++;
  league.playoffs = null;
  league.champion = null;
  league.results = [];
  league.injuries = {};
  startSeason(league, byId);
  return league;
}
