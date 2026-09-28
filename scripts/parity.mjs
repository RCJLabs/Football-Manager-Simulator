// How much of the table is the clubs, and how much is the dice?
//
//   node scripts/parity.mjs [section] [leagues]      (npm run parity)
//
//   season    one regular season of each kind of league (the default)
//   check     a club's strength read off one season, against a round robin
//   dynasty   a pro dynasty, season by season
//   wire      what wears a dynasty's spread down during a season (before the
//             kickoff drain, the waiver claims; see DESIGN.md)
//   all       all four
//
// A season's win totals spread out for two reasons: the clubs differ, and
// games are random. A coin flipped G times spreads by sqrt(G)/2 on its own,
// so the share of the spread that is the clubs is what the coin leaves:
//
//   skill share = 1 - (G / 4) / var(win totals)
//
// A club's strength is its mean point differential over a round robin of
// every club against every other, home and away, from the rosters it has:
// one season's own games cannot tell it from luck (the check section shows
// how badly). Strength is in points a game, the unit `teamPower`, the value
// table and the kickoff prior are all denominated in.
//
// The real league, for scale. These are from published analyses of NFL
// results, not measured here: win totals spread by about 3.1 over seventeen
// games (a skill share near 0.55), final margins scatter about 13.9 points
// around the betting line (Stern, 1991), and so the clubs' own spread is
// about 5 points a game.
//
// Every number this prints is cited in DESIGN.md under "How even is the
// league, really".

import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, teamForGame, userTeamIndex, weekComplete, standings, playoffFieldSize } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { chemistryBonuses } from '../src/engine/chemistry.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { teamPower, buildLineup } from '../src/engine/ratings.js';
import { aiAdjustStrategies } from '../src/engine/gm.js';
import { aiManageIr } from '../src/engine/injuries.js';
import { aiManageSquad } from '../src/engine/squad.js';
import { aiTrades, aiFileClaims, processWaivers } from '../src/engine/transactions.js';

registerPlayers(PLAYERS_BY_ID);

const SECTION = process.argv[2] || 'season';
const LEAGUES = Number(process.argv[3] || 0);
const NFL = { winSd17: 3.1, skillShare: 0.55, strengthSd: 5.0, marginSd: 13.9 };

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const variance = (a) => { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };
const sd = (a) => Math.sqrt(variance(a));
const corr = (a, b) => {
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
};
/** How much of `a`'s spread `b` keeps: the regression slope of b on a. */
const slope = (a, b) => corr(a, b) * sd(b) / sd(a);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const poolOf = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));

function build({ mode, numTeams, draftType, seed, injuries = 'normal' }) {
  const lg = createLeague({ name: 'P', user: {}, seed, mode, numTeams, franchise: mode === 'pro' ? 3 : 0, draftType, injuries });
  const rng = new RNG(seed);
  if (draftType === 'auction') autoCompleteAll(lg.auction, lg, PLAYERS, rng, PLAYERS_BY_ID);
  else autoDraftAll(lg, lg.draft, PLAYERS, rng);
  startSeason(lg, PLAYERS_BY_ID);
  return lg;
}

/** The clubs the numbers are about: everyone but the human, whom nobody manages here. */
const aiClubs = (lg) => lg.teams.map((_, i) => i).filter((i) => i !== userTeamIndex(lg));
const powerOf = (lg, byId) => lg.teams.map((t) => teamPower(buildLineup(t.slots, byId, {})));

/**
 * Every club's strength in points a game: its mean point differential over a
 * round robin, home and away `reps` times, from the rosters as they stand
 * (the injured left in, since a round robin is about the roster, not the week).
 */
function strength(lg, byId, reps) {
  const N = lg.teams.length;
  const chem = chemistryBonuses(lg, byId);
  const hurt = lg.injuries;
  lg.injuries = {};
  const sides = lg.teams.map((_, i) => teamForGame(lg, i, byId));
  lg.injuries = hurt;
  const pd = new Array(N).fill(0), gp = new Array(N).fill(0);
  const margins = [];
  let seed = 910000;
  for (let r = 0; r < reps; r++) {
    for (let h = 0; h < N; h++) {
      for (let a = 0; a < N; a++) {
        if (h === a) continue;
        const g = createGame(sides[h], sides[a], { seed: seed++, penalties: true, chem: [chem[h] || 0, chem[a] || 0] });
        simulateGame(g);
        const m = g.score[0] - g.score[1];
        margins.push(m);
        pd[h] += m; pd[a] -= m; gp[h]++; gp[a]++;
      }
    }
  }
  return { pd: pd.map((x, i) => x / gp[i]), gamesEach: gp[0], marginSd: sd(margins) };
}

/**
 * The clubs' true spread from a set of club strengths: the spread of their
 * mean differentials, less what a finite round robin adds by luck
 * (a game's scatter over the games each club played).
 */
function trueSpread(values, gamesEach, marginSd) {
  const noise = (marginSd ** 2) / gamesEach;
  return Math.sqrt(Math.max(0, variance(values) - noise));
}

/** One regular season, read off the results. */
function seasonTable(lg, clubs) {
  const N = lg.teams.length;
  const pd = new Array(N).fill(0), gp = new Array(N).fill(0), w = new Array(N).fill(0);
  const margins = [];
  for (const r of lg.results.filter((r) => r.season === lg.season && r.phase === 'season')) {
    const m = r.score[0] - r.score[1];
    margins.push(m);
    pd[r.home] += m; pd[r.away] -= m; gp[r.home]++; gp[r.away]++;
    w[r.home] += m > 0 ? 1 : m === 0 ? 0.5 : 0; w[r.away] += m < 0 ? 1 : m === 0 ? 0.5 : 0;
  }
  const G = mean(clubs.map((i) => gp[i]));
  const wins = clubs.map((i) => w[i]);
  return { G, wins, pd: clubs.map((i) => pd[i] / gp[i]), winVar: variance(wins), coinVar: G / 4, marginSd: sd(margins), winPct: Object.fromEntries(clubs.map((i) => [i, w[i] / gp[i]])) };
}
const skill = (rows) => Math.max(0, 1 - mean(rows.map((r) => r.coinVar)) / mean(rows.map((r) => r.winVar)));
const rms = (a) => Math.sqrt(mean(a.map((x) => x * x)));

// --- season -----------------------------------------------------------------

const KINDS = [
  { label: 'pro 32, snake', mode: 'pro', numTeams: 32, draftType: 'snake', n: 6, reps: 2 },
  { label: 'pro 32, auction', mode: 'pro', numTeams: 32, draftType: 'auction', n: 4, reps: 2 },
  { label: 'fantasy 8, snake', mode: 'fantasy', numTeams: 8, draftType: 'snake', n: 16, reps: 16 },
  { label: 'fantasy 8, auction', mode: 'fantasy', numTeams: 8, draftType: 'auction', n: 16, reps: 16 },
  { label: 'fantasy 12, snake', mode: 'fantasy', numTeams: 12, draftType: 'snake', n: 10, reps: 8 },
];

function seasonSection() {
  console.log('The first season of each kind of league, played the way the game plays it: the AI\'s whole week, injuries on.');
  console.log('clubs σ: the clubs\' true spread in points a game, from a round robin of the rosters the season opened with.');
  console.log('pts/pw: points a game per point of teamPower. r(σ, wins): how well that strength called the season\'s wins.\n');
  console.log(`${'league'.padEnd(20)} ${'n'.padStart(3)} ${'games'.padStart(5)} ${'win sd'.padStart(6)} ${'coin'.padStart(5)} ${'skill'.padStart(5)} ${'clubs σ'.padStart(7)} ${'game sd'.padStart(7)} ${'pow sd'.padStart(6)} ${'pts/pw'.padStart(6)} ${'r(σ,wins)'.padStart(9)}`);
  for (const kind of KINDS) {
    const rows = [];
    for (let i = 0; i < (LEAGUES || kind.n); i++) {
      const lg = build({ ...kind, seed: 7100 + i * 13 + kind.numTeams });
      const clubs = aiClubs(lg);
      const byId = index(lg);
      const power = powerOf(lg, byId);
      const st = strength(lg, byId, kind.reps);
      simulateAhead(lg, byId, poolOf(lg), new RNG(lg.seed * 7), 'playoffs');
      const t = seasonTable(lg, clubs);
      const s = clubs.map((k) => st.pd[k]);
      rows.push({ ...t, sigma: trueSpread(s, st.gamesEach, st.marginSd), powerSd: sd(clubs.map((k) => power[k])), ptsPerPower: slope(clubs.map((k) => power[k]), s), rWins: corr(s, t.wins) });
    }
    console.log(`${kind.label.padEnd(20)} ${String(rows.length).padStart(3)} ${f(rows[0].G, 0).padStart(5)} ${f(Math.sqrt(mean(rows.map((r) => r.winVar)))).padStart(6)} ${f(Math.sqrt(rows[0].coinVar)).padStart(5)} ${f(skill(rows)).padStart(5)} ${f(rms(rows.map((r) => r.sigma))).padStart(7)} ${f(mean(rows.map((r) => r.marginSd)), 1).padStart(7)} ${f(mean(rows.map((r) => r.powerSd))).padStart(6)} ${f(mean(rows.map((r) => r.ptsPerPower))).padStart(6)} ${f(mean(rows.map((r) => r.rWins))).padStart(9)}`);
  }
  console.log(`${'NFL (published)'.padEnd(20)} ${''.padStart(3)} ${'17'.padStart(5)} ${f(NFL.winSd17).padStart(6)} ${f(Math.sqrt(17 / 4)).padStart(5)} ${f(NFL.skillShare).padStart(5)} ${f(NFL.strengthSd).padStart(7)} ${f(NFL.marginSd, 1).padStart(7)}`);
}

// --- check ------------------------------------------------------------------

function checkSection() {
  console.log('A club\'s strength read off its season (mean point differential), against a round robin of the same rosters.');
  console.log('The season\'s own numbers are what a table shows; the round robin is what the clubs are.\n');
  console.log(`${'league'.padEnd(20)} ${'r(season pd, robin)'.padStart(19)} ${'season pd sd'.padStart(12)} ${'clubs σ'.padStart(8)}`);
  for (const kind of [KINDS[0], KINDS[2]]) {
    const rs = [], pdSd = [], sig = [];
    for (let i = 0; i < (LEAGUES || 4); i++) {
      const lg = build({ ...kind, seed: 8300 + i * 17 + kind.numTeams });
      const clubs = aiClubs(lg);
      const byId = index(lg);
      const st = strength(lg, byId, kind.numTeams > 8 ? 4 : 60);
      simulateAhead(lg, byId, poolOf(lg), new RNG(lg.seed * 7), 'playoffs');
      const t = seasonTable(lg, clubs);
      const s = clubs.map((k) => st.pd[k]);
      rs.push(corr(t.pd, s)); pdSd.push(sd(t.pd)); sig.push(trueSpread(s, st.gamesEach, st.marginSd));
    }
    console.log(`${kind.label.padEnd(20)} ${f(mean(rs)).padStart(19)} ${f(mean(pdSd)).padStart(12)} ${f(rms(sig)).padStart(8)}   (each league: ${rs.map((x) => f(x)).join(' ')})`);
  }
}

// --- dynasty ----------------------------------------------------------------

function dynastySection() {
  const SEASONS = 8;
  console.log(`A pro dynasty (32 clubs, snake, careers on), ${SEASONS} seasons, the human's club left out.`);
  console.log('clubs σ at kickoff and at the end of the regular season, from round robins of the rosters as they stood;');
  console.log('kept: the slope of end strength on kickoff strength (1 keeps the spread, 0 erases it);');
  console.log('r(σ0, pd): how well kickoff strength called the season; year-on-year: a club\'s win share against its last.\n');
  const bySeason = [];
  for (let i = 0; i < (LEAGUES || 3); i++) {
    const seed = 9400 + i * 29;
    const lg = build({ mode: 'pro', numTeams: 32, draftType: 'snake', seed });
    let last = null;
    for (let yr = 0; yr < SEASONS; yr++) {
      const clubs = aiClubs(lg);
      let byId = index(lg);
      const s0 = strength(lg, byId, 2);
      simulateAhead(lg, byId, poolOf(lg), new RNG(seed * 7 + yr), 'playoffs');
      byId = index(lg);
      const s1 = strength(lg, byId, 2);
      const t = seasonTable(lg, clubs);
      const k0 = clubs.map((k) => s0.pd[k]), k1 = clubs.map((k) => s1.pd[k]);
      const row = { ...t, sigma0: trueSpread(k0, s0.gamesEach, s0.marginSd), sigma1: trueSpread(k1, s1.gamesEach, s1.marginSd), kept: slope(k0, k1), rStart: corr(k0, t.pd) };
      if (last) { const ids = clubs.filter((k) => k in last); row.yoy = corr(ids.map((k) => last[k]), ids.map((k) => t.winPct[k])); }
      last = t.winPct;
      (bySeason[yr] ??= []).push(row);
      simulateAhead(lg, index(lg), poolOf(lg), new RNG(seed * 11 + yr), 'nextSeason');
    }
  }
  console.log(`${'season'.padEnd(8)} ${'skill'.padStart(5)} ${'σ kickoff'.padStart(9)} ${'σ end'.padStart(6)} ${'kept'.padStart(5)} ${'r(σ0,pd)'.padStart(8)} ${'year-on-year'.padStart(12)}`);
  bySeason.forEach((rows, yr) => {
    const yoy = rows.filter((r) => r.yoy != null).map((r) => r.yoy);
    console.log(`${String(yr + 1).padEnd(8)} ${f(skill(rows)).padStart(5)} ${f(rms(rows.map((r) => r.sigma0))).padStart(9)} ${f(rms(rows.map((r) => r.sigma1))).padStart(6)} ${f(mean(rows.map((r) => r.kept))).padStart(5)} ${f(mean(rows.map((r) => r.rStart))).padStart(8)} ${(yoy.length ? f(mean(yoy)) : '').padStart(12)}`);
  });
}

// --- wire -------------------------------------------------------------------

/** The AI's week, part by part: `advanceWeekWithMoves` with pieces left out. */
function advanceWith(L, byId, pool, rng, parts) {
  if (L.phase === 'season' && weekComplete(L)) {
    const field = new Set(standings(L).slice(0, playoffFieldSize(L.teams.length)).map((r) => r.idx));
    if (parts.strategy) aiAdjustStrategies(L, { inField: (i) => field.has(i) });
    if (parts.ir) aiManageIr(L, byId);
    if (parts.squad) aiManageSquad(L, byId);
    if (parts.trades) aiTrades(L, byId, rng, { pool });
    if (parts.waivers) { aiFileClaims(L, pool, byId, rng); processWaivers(L, byId); }
  }
  return advanceWeek(L);
}

function wireSection() {
  const ALL = { strategy: 1, ir: 1, squad: 1, trades: 1, waivers: 1 };
  const VARIANTS = [
    { key: 'as shipped', parts: ALL },
    { key: 'no AI moves', parts: {} },
    { key: 'strategy only', parts: { strategy: 1 } },
    { key: 'IR + squad only', parts: { ir: 1, squad: 1 } },
    { key: 'trades only', parts: { trades: 1 } },
    { key: 'waivers only', parts: { waivers: 1 } },
  ];
  console.log('Season 4 of a pro dynasty, played from the same state and seeds with parts of the AI\'s week left out.');
  console.log('kept: the slope of end-of-season strength on kickoff strength; r(power): team power at kickoff against the end.\n');
  const out = {};
  for (let i = 0; i < (LEAGUES || 4); i++) {
    const seed = 401 + i * 33;
    const lg = build({ mode: 'pro', numTeams: 32, draftType: 'snake', seed });
    for (let yr = 0; yr < 3; yr++) simulateAhead(lg, index(lg), poolOf(lg), new RNG(seed * 11 + yr), 'nextSeason');
    const clubs = aiClubs(lg);
    const byId0 = index(lg);
    const s0 = strength(lg, byId0, 2);
    const k0 = clubs.map((k) => s0.pd[k]);
    const p0 = powerOf(lg, byId0);
    const frozen = JSON.stringify(lg);
    for (const v of VARIANTS) {
      const L = JSON.parse(frozen);
      const byId = index(L);
      const pool = poolOf(L);
      const rng = new RNG(seed * 7 + 3);
      while (L.phase === 'season') { simulateWeekAi(L, byId, { includeUser: true }); advanceWith(L, byId, pool, rng, v.parts); }
      const t = seasonTable(L, clubs);
      const s1 = strength(L, byId, 2);
      const k1 = clubs.map((k) => s1.pd[k]);
      const p1 = powerOf(L, byId);
      const moves = (L.transactions || []).filter((x) => x.season === L.season && x.week > 0 && clubs.includes(x.team)).length / clubs.length;
      (out[v.key] ??= []).push({ ...t, kept: slope(k0, k1), rStart: corr(k0, t.pd), rPower: corr(clubs.map((k) => p0[k]), clubs.map((k) => p1[k])), moves, sigma1: trueSpread(k1, s1.gamesEach, s1.marginSd), sigma0: trueSpread(k0, s0.gamesEach, s0.marginSd) });
    }
  }
  console.log(`${'variant'.padEnd(16)} ${'skill'.padStart(5)} ${'σ kickoff'.padStart(9)} ${'σ end'.padStart(6)} ${'kept'.padStart(5)} ${'r(power)'.padStart(8)} ${'r(σ0,pd)'.padStart(8)} ${'moves/club'.padStart(10)}`);
  for (const [key, rows] of Object.entries(out)) {
    console.log(`${key.padEnd(16)} ${f(skill(rows)).padStart(5)} ${f(rms(rows.map((r) => r.sigma0))).padStart(9)} ${f(rms(rows.map((r) => r.sigma1))).padStart(6)} ${f(mean(rows.map((r) => r.kept))).padStart(5)} ${f(mean(rows.map((r) => r.rPower))).padStart(8)} ${f(mean(rows.map((r) => r.rStart))).padStart(8)} ${f(mean(rows.map((r) => r.moves)), 1).padStart(10)}`);
  }
}

const run = { season: seasonSection, check: checkSection, dynasty: dynastySection, wire: wireSection };
for (const [name, fn] of Object.entries(run)) {
  if (SECTION === name || SECTION === 'all') { fn(); console.log(''); }
}
if (!(SECTION in run) && SECTION !== 'all') console.log(`Unknown section "${SECTION}": season, check, dynasty, wire or all.`);
