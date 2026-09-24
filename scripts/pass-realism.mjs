// Does a quarterback throw like the real ones?
//
//   node scripts/pass-realism.mjs [games per quarterback] [pro leagues]
//
// The twin of run-realism.mjs for the other half of the offence. It asks the
// questions that found the run game's defects, and adds the one that explained
// them: whether a rate moves with the level of play (DESIGN.md, "The back was
// worth nearly three times too much" and "The passing game, against real
// quarterbacks"). Real numbers are nflverse's, regular seasons, written down
// below so this runs offline.
//
//   the passers  every quarterback in the pool with a season from 1999 on and
//                250 or more real attempts in it, each in the same average side
//                (82 against 82), against what he really did that season. The
//                line to watch is the slope of real adjusted net yards a
//                dropback on the engine's: 1 means the engine's differences
//                between quarterbacks come true one for one. It read 0.41 when
//                this was written.
//   the level    equal synthetic sides at 82 and at 90. A rate that moves
//                between them is being measured against a fixed number rather
//                than against the other side, which is how a league of all-time
//                greats on both sides ends up playing unlike a real league.
//   a league     a season of drafted pro leagues, every club run by the AI,
//                against a real season (2022-23 play-by-play), and its starting
//                quarterbacks' spread against real starters' (1999-2024).
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG, hashSeed } from '../src/engine/rng.js';
import { syntheticTeam } from './synthetic.mjs';
import { createGame, simulateGame } from '../src/engine/game.js';
import { buildLineup, overall } from '../src/engine/ratings.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { createLeague, startSeason, registerPlayers, teamForGame } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { leagueIndex } from '../src/engine/rookies.js';
import { careerIndex } from '../src/engine/careers.js';

registerPlayers(PLAYERS_BY_ID);
const GAMES = Number(process.argv[2] || 200);
const LEAGUES = Number(process.argv[3] || 2);

// That regular season, nflverse player_stats:
// [attempts, completions, yards, touchdowns, interceptions, sacks, sack yards].
const REAL_QBS = {
  'aaron-rodgers-2011': [501, 342, 4636, 45, 6, 36, 219],
  'alex-smith-2017': [505, 341, 4042, 26, 5, 35, 207],
  'andrew-luck-2018': [639, 430, 4593, 39, 15, 18, 134],
  'andy-dalton-2015': [386, 255, 3250, 25, 7, 20, 118],
  'baker-mayfield-2023': [566, 364, 4044, 28, 10, 40, 232],
  'ben-roethlisberger-2007': [405, 265, 3158, 32, 11, 47, 347],
  'blaine-gabbert-2012': [278, 162, 1662, 9, 6, 22, 158],
  'blake-bortles-2015': [606, 355, 4428, 35, 18, 51, 320],
  'brad-johnson-2002': [451, 281, 3049, 22, 6, 21, 121],
  'cam-newton-2015': [495, 296, 3837, 35, 10, 33, 284],
  'carson-palmer-2015': [537, 342, 4671, 35, 11, 25, 151],
  'case-keenum-2017': [481, 325, 3547, 22, 7, 22, 136],
  'christian-ponder-2012': [483, 300, 2935, 18, 12, 32, 184],
  'cj-stroud-2023': [499, 319, 4108, 23, 5, 38, 331],
  'dak-prescott-2023': [590, 410, 4516, 36, 9, 39, 255],
  'daunte-culpepper-2004': [548, 379, 4717, 39, 11, 45, 238],
  'david-carr-2004': [467, 286, 3539, 16, 14, 50, 305],
  'derek-carr-2016': [560, 357, 3937, 28, 6, 16, 79],
  'donovan-mcnabb-2004': [469, 300, 3875, 31, 8, 31, 192],
  'drew-brees-2011': [660, 471, 5535, 46, 14, 24, 158],
  'eli-manning-2011': [589, 359, 4933, 29, 16, 28, 199],
  'geno-smith-2022': [572, 399, 4282, 30, 11, 46, 348],
  'jake-delhomme-2005': [435, 262, 3421, 24, 16, 27, 211],
  'jake-plummer-2005': [456, 277, 3366, 18, 7, 23, 140],
  'jalen-hurts-2022': [460, 306, 3701, 22, 6, 38, 231],
  'jamarcus-russell-2008': [367, 198, 2423, 13, 8, 30, 200],
  'jared-goff-2018': [561, 364, 4688, 32, 12, 33, 223],
  'jay-cutler-2008': [616, 384, 4525, 25, 18, 11, 69],
  'jayden-daniels-2024': [480, 331, 3568, 25, 9, 47, 238],
  'joe-burrow-2024': [652, 460, 4918, 43, 9, 48, 278],
  'joey-harrington-2003': [554, 309, 2880, 17, 22, 11, 67],
  'josh-allen-2024': [483, 307, 3731, 28, 6, 14, 63],
  'josh-mccown-2015': [292, 186, 2109, 12, 4, 23, 137],
  'justin-herbert-2021': [672, 443, 5014, 38, 15, 31, 214],
  'kirk-cousins-2022': [643, 424, 4547, 29, 14, 46, 329],
  'kordell-stewart-2001': [442, 266, 3109, 14, 11, 29, 175],
  'kurt-warner-1999': [450, 293, 3956, 38, 11, 26, 176],
  'kyle-orton-2009': [541, 336, 3802, 21, 12, 29, 159],
  'lamar-jackson-2019': [401, 265, 3127, 36, 6, 23, 106],
  'mark-sanchez-2010': [507, 278, 3291, 17, 13, 27, 171],
  'matt-ryan-2016': [534, 373, 4944, 38, 7, 37, 235],
  'matthew-stafford-2021': [601, 404, 4886, 41, 17, 30, 243],
  'mitchell-trubisky-2018': [434, 289, 3223, 24, 12, 24, 143],
  'patrick-mahomes-2018': [580, 383, 5097, 50, 12, 26, 171],
  'peyton-manning-2004': [497, 336, 4557, 49, 10, 13, 101],
  'philip-rivers-2009': [486, 317, 4254, 28, 9, 25, 167],
  'rex-grossman-2006': [480, 262, 3197, 23, 20, 21, 142],
  'rich-gannon-2002': [618, 418, 4689, 26, 10, 36, 214],
  'russell-wilson-2015': [483, 329, 4024, 34, 8, 45, 265],
  'ryan-fitzpatrick-2015': [562, 335, 3905, 31, 15, 19, 94],
  'steve-mcnair-2003': [400, 250, 3246, 24, 7, 20, 112],
  'tom-brady-2007': [578, 398, 4806, 50, 8, 21, 128],
  'tom-brady-2017': [581, 385, 4577, 32, 8, 35, 201],
  'tony-romo-2014': [435, 304, 3705, 34, 9, 29, 215],
  'trent-dilfer-2000': [225, 133, 1493, 12, 11, 23, 135],
  'trent-green-2004': [556, 369, 4589, 27, 17, 32, 227],
  'tua-tagovailoa-2023': [560, 388, 4624, 29, 14, 29, 171],
  'tyrod-taylor-2015': [380, 242, 3035, 20, 6, 36, 212],
  'vince-young-2006': [356, 184, 2199, 12, 13, 26, 130],
  'zach-wilson-2022': [242, 132, 1688, 6, 7, 23, 175],
};
// A real season's passing, nflverse play-by-play 2022-23; and quarterbacks with
// 300 or more dropbacks in a season, 1999-2024: mean and standard deviation.
const REAL = {
  league: { cmp: 64.6, ya: 7.05, int: 2.34, sack: 6.95, anya: 5.89 },
  starters: { anya: [6.02, 1.17], ya: [7.14, 0.74], cmp: [62.27, 4.37], int: [2.61, 0.94], sack: [6.28, 2.10] },
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1)); };
const slope = (x, y) => { const mx = mean(x), my = mean(y); let s = 0, a = 0; for (let i = 0; i < x.length; i++) { s += (x[i] - mx) * (y[i] - my); a += (x[i] - mx) ** 2; } return s / a; };
const f2 = (x) => x.toFixed(2);
/** Rates from a pass line: [att, cmp, yds, td, int, sck, sckYds]. */
function rates([att, cmp, yds, td, int, sck, sckYds]) {
  return { cmp: 100 * cmp / att, ya: yds / att, int: 100 * int / att, sack: 100 * sck / (att + sck), anya: (yds + 20 * td - 45 * int - sckYds) / (att + sck) };
}
const line = () => [0, 0, 0, 0, 0, 0, 0];
const add = (l, s) => { l[0] += s.pass.att; l[1] += s.pass.cmp; l[2] += s.pass.yds; l[3] += s.pass.td; l[4] += s.pass.int; l[5] += s.pass.sck; l[6] += s.pass.sckYds; };
const RATES = [['anya', 'adjusted net yards a dropback'], ['ya', 'yards an attempt'], ['cmp', 'completion %'], ['int', 'interception %'], ['sack', 'sack %']];

// ---- the passers ---------------------------------------------------------------
const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const SIDE = syntheticTeam('side', 82, 2, 1), OPP = syntheticTeam('opp', 82, 2, 2);
const slot = ROSTER_SLOTS.find((s) => s.pos === 'QB' && s.starter).id;
const rows = [];
for (const p of PLAYERS.filter((x) => REAL_QBS[x.id] && REAL_QBS[x.id][0] >= 250)) {
  const t = { ...SIDE, slots: { ...SIDE.slots }, byId: new Map(SIDE.byId) };
  t.byId.set(p.id, p); t.slots[slot] = p.id;
  const l = line();
  for (let i = 0; i < GAMES; i++) {
    const home = i % 2 === 0;
    const g = createGame(home ? tf(t) : tf(OPP), home ? tf(OPP) : tf(t), { seed: 70000 + i, homeAdvantage: false });
    simulateGame(g);
    const s = g.stats[home ? 0 : 1].players[p.id];
    if (s) add(l, s);
  }
  rows.push({ ovr: overall(p), e: rates(l), r: rates(REAL_QBS[p.id]) });
}
console.log(`${rows.length} quarterbacks from 1999 on with 250+ real attempts, each ${GAMES} games in the same average side:`);
console.log(`  ${'rate'.padEnd(30)} engine mean / sd    real mean / sd    slope, real on engine`);
for (const [k, label] of RATES) {
  const e = rows.map((r) => r.e[k]), re = rows.map((r) => r.r[k]);
  console.log(`  ${label.padEnd(30)} ${f2(mean(e)).padStart(6)} / ${f2(sd(e)).padEnd(8)} ${f2(mean(re)).padStart(6)} / ${f2(sd(re)).padEnd(8)} ${f2(slope(e, re)).padStart(6)}`);
}
const byO = [...rows].sort((a, b) => a.ovr - b.ovr), third = Math.ceil(byO.length / 3);
for (const [label, rs] of [['lowest third', byO.slice(0, third)], ['highest third', byO.slice(2 * third)]]) {
  const m = (k, w) => f2(mean(rs.map((r) => r[w][k])));
  console.log(`  ${label}, rated ${Math.min(...rs.map((r) => r.ovr))}-${Math.max(...rs.map((r) => r.ovr))}: adjusted net ${m('anya', 'e')} (${m('anya', 'r')}), interceptions ${m('int', 'e')}% (${m('int', 'r')}), sacks ${m('sack', 'e')}% (${m('sack', 'r')}), completion ${m('cmp', 'e')}% (${m('cmp', 'r')})`);
}
console.log(`  passers, real on engine slope (adjusted net yards a dropback): ${f2(slope(rows.map((r) => r.e.anya), rows.map((r) => r.r.anya)))}`);

// ---- the level -----------------------------------------------------------------
const level = {};
for (const L of [82, 90]) {
  const l = line();
  for (let i = 0; i < 1000; i++) {
    const a = syntheticTeam(`pa${L}-${i}`, L, 2, 100 + i), b = syntheticTeam(`pb${L}-${i}`, L, 2, 7000 + i);
    const g = createGame(tf(a), tf(b), { seed: 91000 + i, homeAdvantage: false });
    simulateGame(g);
    for (const side of [0, 1]) for (const s of Object.values(g.stats[side].players)) add(l, s);
  }
  level[L] = rates(l);
}
console.log(`\nEqual synthetic sides, 1,000 games at each level (a real season in brackets):`);
for (const [k, label] of RATES) console.log(`  ${label.padEnd(30)} at 82 ${f2(level[82][k]).padStart(6)}   at 90 ${f2(level[90][k]).padStart(6)}   (${REAL.league[k]})`);
console.log(`  level, adjusted net yards a dropback at 90 minus 82: ${f2(level[90].anya - level[82].anya)}`);

// ---- a league ------------------------------------------------------------------
const league = line();
const starters = [];
for (let lgN = 0; lgN < LEAGUES; lgN++) {
  const seed = 41 + 97 * lgN;
  const lg = createLeague({ name: 'P', mode: 'pro', numTeams: 32, franchise: 5, seed, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' }, injuries: 'off' });
  lg.settings.jobs = false;
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  const byId = careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
  const n = lg.teams.length;
  const teams = lg.teams.map((_, i) => ({ ...teamForGame(lg, i, byId), isUser: false }));
  const season = teams.map(() => new Map());
  for (let c = 0; c < n; c++) for (let k = 0; k < 17; k += 2) {
    const o = (c + 1 + ((k * 7 + lgN * 3) % (n - 1))) % n;
    const g = createGame(teams[c], teams[o], { seed: hashSeed(`pr:${seed}:${c}:${k}`), injuryLevel: 0 });
    simulateGame(g);
    [c, o].forEach((ti, side) => {
      for (const [id, s] of Object.entries(g.stats[side].players)) {
        if (!s.pass.att && !s.pass.sck) continue;
        add(league, s);
        const l = season[ti].get(id) || line(); add(l, s); season[ti].set(id, l);
      }
    });
  }
  for (const m of season) for (const l of m.values()) if (l[0] + l[5] >= 300) starters.push(rates(l));
}
const lr = rates(league);
console.log(`\n${LEAGUES} drafted pro leagues, a season each, every club run by the AI (real in brackets):`);
for (const [k, label] of RATES) {
  const xs = starters.map((q) => q[k]);
  console.log(`  ${label.padEnd(30)} league ${f2(lr[k]).padStart(6)} (${REAL.league[k]})   starting quarterbacks sd ${f2(sd(xs))} (${REAL.starters[k][1]})`);
}
console.log(`  pro league adjusted net yards a dropback: ${f2(lr.anya)}`);
