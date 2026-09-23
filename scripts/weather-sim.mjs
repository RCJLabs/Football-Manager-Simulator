// What weather does, and whether it leaves the engine where it was calibrated.
//
//   mean    The same question a game at a time: games between real lineups,
//           each under the conditions its home, week and seed would draw and
//           again with no weather from the same seed. Much tighter than a
//           season, which diverges in injuries and trades as well as weather.
//   season  Pro leagues played a season with weather on and off, paired by
//           seed. Weather is meant to be a spread around the engine, not a
//           tax on it, so league-wide a season should average what it did.
//   games   The spread itself: games between real league lineups played twice
//           from the same seed, once in each kind of weather and once indoors,
//           so the difference is the sky and nothing else.
//   arms    The arm and leg that start in a founding pro league, which the
//           league means are taken at (weather.js, STARTER_ARM and STARTER_LEG).
//   lean    Whether an offence should run more in bad weather: the same games
//           again with the home side's pass rate moved, by condition. If the
//           best move is no different outdoors in a gale than indoors, the AI
//           has no reason to lean and does not.
//
// Usage: node scripts/weather-sim.mjs mean   [games] [first seed]
//        node scripts/weather-sim.mjs season [leagues] [first seed]
//        node scripts/weather-sim.mjs games  [games per condition]
//        node scripts/weather-sim.mjs arms   [drafts]
//        node scripts/weather-sim.mjs lean   [games per cell]
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, teamForGame } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { MEANS, conditionsFor, STARTER_ARM, STARTER_LEG } from '../src/engine/weather.js';

registerPlayers(PLAYERS_BY_ID);
const [MODE = 'season', ...rest] = process.argv.slice(2);
const arg = (i, d) => (rest[i] != null ? Number(rest[i]) : d);
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const se = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length / xs.length); };
const pm = (xs, d = 2) => `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(d)} ± ${se(xs).toFixed(d)}`;

/** League-wide rates from one pro season's books. */
function seasonRates(lg) {
  const t = { points: 0, att: 0, cmp: 0, pyds: 0, ratt: 0, ryds: 0, to: 0, games: 0, fga: 0, fgm: 0, punts: 0, pyd: 0 };
  for (const team of lg.teams) {
    const s = team.seasonStats.team;
    t.points += s.points; t.att += s.passAtt; t.cmp += s.passCmp; t.pyds += s.passYds; t.ratt += s.rushAtt; t.ryds += s.rushYds; t.to += s.turnovers;
    t.games += team.record.w + team.record.l + team.record.t;
    for (const p of Object.values(team.seasonStats.players)) {
      t.fga += p.k?.fga || 0; t.fgm += p.k?.fgm || 0; t.punts += p.p?.n || 0; t.pyd += p.p?.yds || 0;
    }
  }
  return {
    'points a team-game': t.points / t.games, 'completion %': 100 * t.cmp / t.att, 'yards a pass': t.pyds / t.att,
    'yards a carry': t.ryds / t.ratt, 'turnovers a team-game': t.to / t.games, 'field-goal %': 100 * t.fgm / t.fga,
    'yards a punt': t.pyd / t.punts,
  };
}

/** Thirty-two real lineups from a founding pro draft, to play games between. */
function lineups(seed) {
  const lg = createLeague({ name: 'W', mode: 'pro', numTeams: 32, franchise: 0, seed, draftType: 'snake', user: {}, injuries: 'off' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  return lg.teams.map((_, i) => teamForGame(lg, i, PLAYERS_BY_ID));
}

const CONDITIONS = {
  indoors: { roof: true },
  'mild, still': { temp: 65, wind: 5, precip: null },
  'windy (20 mph)': { temp: 55, wind: 20, precip: null },
  'gale (28 mph)': { temp: 50, wind: 28, precip: null },
  rain: { temp: 55, wind: 10, precip: 'rain' },
  'frozen (18°F)': { temp: 18, wind: 10, precip: null },
  'snow, windy': { temp: 26, wind: 18, precip: 'snow' },
  altitude: { temp: 60, wind: 9, precip: null, altitude: true },
};

// The i-th game: every club at home in turn, against an opponent that rotates
// each round of 32 and is moved on one when the rotation would land on itself.
const homeIdx = (i) => i % 32;
const awayIdx = (i) => (i + 16 + Math.floor(i / 32)) % 32 === i % 32 ? (i + 17) % 32 : (i + 16 + Math.floor(i / 32)) % 32;

function play(teams, i, seed, weather, homeLean = 0) {
  const home = teams[homeIdx(i)], away = teams[awayIdx(i)];
  const h = homeLean ? { ...home, strategy: { ...home.strategy, passRate: Math.max(0.2, Math.min(0.85, home.strategy.passRate + homeLean)) } } : home;
  const g = createGame(h, away, { seed, weather, injuryLevel: 0 });
  simulateGame(g);
  const s = g.stats.map((x) => x.team);
  let fga = 0, fgm = 0, punts = 0, pyd = 0, fum = 0;
  for (const side of g.stats) for (const p of Object.values(side.players)) {
    fga += p.k?.fga || 0; fgm += p.k?.fgm || 0; punts += p.p?.n || 0; pyd += p.p?.yds || 0; fum += p.rush?.fum || 0;
  }
  return { points: g.score[0] + g.score[1], margin: g.score[0] - g.score[1], att: s[0].passAtt + s[1].passAtt, cmp: s[0].passCmp + s[1].passCmp,
    pyds: s[0].passYds + s[1].passYds, to: s[0].turnovers + s[1].turnovers, fga, fgm, punts, pyd, fum };
}

if (MODE === 'mean') {
  const N = arg(0, 4000), SEED0 = arg(1, 1);
  const teams = lineups(4403 + SEED0);
  const on = [], off = [], sky = { indoors: 0, 'wind 15+ mph': 0, rain: 0, snow: 0, 'below 32°F': 0 };
  for (let i = 0; i < N; i++) {
    const week = 1 + ((i * 7) % 18);
    const lg = { mode: 'pro', seed: SEED0 * 7919 + Math.floor(i / 32), season: 1, settings: { weather: true } };
    const w = conditionsFor(lg, { home: homeIdx(i), away: awayIdx(i) }, week);
    if (w.roof) sky.indoors++; else { if (w.wind >= 15) sky['wind 15+ mph']++; if (w.precip) sky[w.precip]++; if (w.temp < 32) sky['below 32°F']++; }
    on.push(play(teams, i, 70000 + SEED0 * 100003 + i, w));
    off.push(play(teams, i, 70000 + SEED0 * 100003 + i, null));
  }
  const rate = (rows, f, g) => rows.reduce((s, r) => s + f(r), 0) / rows.reduce((s, r) => s + g(r), 0);
  // A rate is compared as totals over totals; its standard error is the
  // delta method's — each game's residual from its arm's rate, differenced
  // across the pair, over the mean denominator.
  const line = (label, f, g, scale = 1) => {
    const a = rate(on, f, g), b = rate(off, f, g);
    const gbar = mean(off.map(g));
    const e = on.map((r, k) => ((f(r) - a * g(r)) - (f(off[k]) - b * g(off[k]))) / gbar);
    const d = scale * (a - b);
    return `  ${label.padEnd(24)} ${(scale * b).toFixed(3).padStart(8)} → ${(scale * a).toFixed(3).padStart(8)}   ${d >= 0 ? '+' : ''}${d.toFixed(3)} ± ${(scale * se(e)).toFixed(3)}`;
  };
  console.log(`${N} games from seed ${SEED0}, each under the conditions its home and week draw against the same game with none:`);
  console.log(`  conditions: ${Object.entries(sky).map(([k, v]) => `${k} ${(100 * v / N).toFixed(0)}%`).join(' · ')}`);
  console.log(`  ${''.padEnd(24)} ${'none'.padStart(8)}   ${'weather'.padStart(8)}   difference`);
  console.log(line('points a team-game', (r) => r.points, () => 2));
  console.log(line('completion %', (r) => r.cmp, (r) => r.att, 100));
  console.log(line('yards a pass', (r) => r.pyds, (r) => r.att));
  console.log(line('turnovers a team-game', (r) => r.to, () => 2));
  console.log(line('fumbles a team-game', (r) => r.fum, () => 2));
  console.log(line('field goals tried a game', (r) => r.fga, () => 1));
  console.log(line('field-goal %', (r) => r.fgm, (r) => r.fga, 100));
  console.log(line('yards a punt', (r) => r.pyd, (r) => r.punts));
} else if (MODE === 'season') {
  const LEAGUES = arg(0, 6), SEED0 = arg(1, 7700);
  const diffs = {};
  for (let L = 0; L < LEAGUES; L++) {
    const seed = SEED0 + L * 37;
    const rates = {};
    for (const on of [false, true]) {
      const lg = createLeague({ name: 'W', mode: 'pro', numTeams: 32, franchise: 7, seed, draftType: 'snake', user: {}, injuries: 'normal' });
      lg.settings.weather = on;
      lg.settings.jobs = false;
      autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
      startSeason(lg, PLAYERS_BY_ID);
      simulateAhead(lg, PLAYERS_BY_ID, PLAYERS, new RNG(seed * 3), 'playoffs');
      rates[on] = seasonRates(lg);
    }
    for (const k of Object.keys(rates.true)) (diffs[k] ??= []).push(rates.true[k] - rates.false[k]);
  }
  console.log(`${LEAGUES} pro regular seasons from seed ${SEED0}, weather on minus off (paired by seed); league means taken out: completion ${MEANS.comp.pass_med.toFixed(4)} at a medium throw, field goals ${MEANS.fg.toFixed(2)} yd, punts ${MEANS.punt.toFixed(2)} yd, fumbles ×${MEANS.fumble.toFixed(3)}`);
  for (const [k, xs] of Object.entries(diffs)) console.log(`  ${k.padEnd(24)} ${pm(xs)}`);
} else if (MODE === 'games') {
  const N = arg(0, 1500);
  const teams = lineups(4401);
  const base = Array.from({ length: N }, (_, i) => play(teams, i, 50000 + i, { roof: true }));
  const agg = (rows) => ({ points: mean(rows.map((r) => r.points)), comp: 100 * rows.reduce((s, r) => s + r.cmp, 0) / rows.reduce((s, r) => s + r.att, 0),
    fg: 100 * rows.reduce((s, r) => s + r.fgm, 0) / Math.max(1, rows.reduce((s, r) => s + r.fga, 0)), punt: rows.reduce((s, r) => s + r.pyd, 0) / Math.max(1, rows.reduce((s, r) => s + r.punts, 0)),
    fum: mean(rows.map((r) => r.fum)) });
  console.log(`${N} games a condition between real lineups, each played from the same seed as its indoor twin`);
  console.log(`  ${'condition'.padEnd(16)} points a game (paired)   completion %   field-goal %   yards a punt   fumbles a game`);
  for (const [name, w] of Object.entries(CONDITIONS)) {
    const rows = name === 'indoors' ? base : Array.from({ length: N }, (_, i) => play(teams, i, 50000 + i, w));
    const a = agg(rows);
    const dp = rows.map((r, i) => r.points - base[i].points);
    console.log(`  ${name.padEnd(16)} ${a.points.toFixed(1).padStart(5)} (${pm(dp, 1)})`.padEnd(42) + `${a.comp.toFixed(1).padStart(6)}        ${a.fg.toFixed(1).padStart(6)}         ${a.punt.toFixed(1).padStart(5)}        ${a.fum.toFixed(2)}`);
  }
} else if (MODE === 'arms') {
  const DRAFTS = arg(0, 8);
  const thp = [], kpw = [];
  for (let d = 0; d < DRAFTS; d++) {
    const seed = 4404 + d;
    const lg = createLeague({ name: 'W', mode: 'pro', numTeams: 32, franchise: 0, seed, draftType: 'snake', user: {}, injuries: 'off' });
    autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
    for (const t of lg.teams) {
      const q = PLAYERS_BY_ID.get(t.slots.QB1), k = PLAYERS_BY_ID.get(t.slots.K1);
      if (q) thp.push(q.r.thp);
      if (k) kpw.push(k.r.kpw);
    }
  }
  const sd = (xs) => Math.sqrt(mean(xs.map((v) => (v - mean(xs)) ** 2)));
  const pool = (pos, a) => mean(PLAYERS.filter((p) => p.pos === pos && !p.generated).map((p) => p.r[a]));
  console.log(`${DRAFTS} founding pro drafts: the starting quarterback's arm ${mean(thp).toFixed(1)} (sd ${sd(thp).toFixed(1)}), the kicker's leg ${mean(kpw).toFixed(1)} (sd ${sd(kpw).toFixed(1)}); the pool's ${pool('QB', 'thp').toFixed(1)} and ${pool('K', 'kpw').toFixed(1)}; the means are taken at ${STARTER_ARM} and ${STARTER_LEG}`);
} else if (MODE === 'lean') {
  const N = arg(0, 1200);
  const teams = lineups(4402);
  const LEANS = [-0.15, -0.1, -0.05, 0.05];
  console.log(`${N} games a cell: the home side's pass rate moved, against the same game from the same seed unmoved; its scoring margin`);
  for (const name of ['indoors', 'windy (20 mph)', 'gale (28 mph)', 'rain', 'snow, windy']) {
    const w = CONDITIONS[name];
    const base = Array.from({ length: N }, (_, i) => play(teams, i, 60000 + i, w));
    const cells = LEANS.map((d) => {
      const rows = Array.from({ length: N }, (_, i) => play(teams, i, 60000 + i, w, d));
      return `${d > 0 ? '+' : ''}${d}: ${pm(rows.map((r, i) => r.margin - base[i].margin), 2)}`;
    });
    console.log(`  ${name.padEnd(16)} ${cells.join(' · ')}`);
  }
} else {
  console.error(`unknown mode ${MODE}: mean, season, games, arms or lean`);
  process.exit(1);
}
