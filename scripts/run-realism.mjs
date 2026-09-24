// Does a back run like the real ones?
//
//   node scripts/run-realism.mjs [games per back] [pro leagues]
//
// The realism audit plays synthetic sides rated 82, which is where every
// constant in the engine was fitted, and it never looked at the spread between
// backs. Both blind spots hid the same defect (DESIGN.md, "The back was worth
// four times too much"): a back's rating moved his carries five times as far
// as it does in the real game, and leagues of all-time greats, which is what
// people play, ran at 5.95 yards a carry.
//
// So this checks the run game against the real one twice, from numbers taken
// out of nflverse (regular seasons; play-by-play 2022-23, season totals
// 1999-2024) and written down below, so it runs offline:
//
//   the backs   every back in the pool whose season is 1999 or later, each
//               played in the same average side (82 against 82), against what
//               he really ran for that season. The line to watch is the slope
//               of a regression of the real yards a carry on the engine's: 1
//               means the engine's differences between backs come true one for
//               one, 0.2 is what it read before the fix.
//   a league    a season of drafted pro leagues, every club run by the AI:
//               the league's yards a carry, how often a run is stopped, goes
//               ten yards or twenty, and how far apart the starting backs end
//               up — against a real season's.
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

// Carries and rushing yards in that regular season, nflverse player_stats.
const REAL_BACKS = {
  'aaron-jones-2019': [236, 1084],
  'adrian-peterson-2012': [348, 2097],
  'ahman-green-2003': [355, 1883],
  'alfred-morris-2012': [335, 1613],
  'alvin-kamara-2018': [194, 883],
  'anthony-thomas-2001': [278, 1183],
  'arian-foster-2010': [326, 1614],
  'benjarvus-green-ellis-2010': [229, 1008],
  'bijan-robinson-2024': [304, 1456],
  'breece-hall-2023': [223, 994],
  'cadillac-williams-2005': [290, 1178],
  'carlos-hyde-2016': [217, 988],
  'cedric-benson-2009': [301, 1251],
  'chester-taylor-2006': [304, 1214],
  'chris-ivory-2015': [247, 1070],
  'chris-johnson-2009': [358, 2006],
  'christian-mccaffrey-2023': [272, 1459],
  'clinton-portis-2003': [290, 1591],
  'curtis-martin-2004': [371, 1697],
  'danny-woodhead-2013': [106, 429],
  'darren-sproles-2011': [88, 604],
  'david-montgomery-2023': [219, 1015],
  'demarco-murray-2014': [392, 1845],
  'derrick-henry-2020': [378, 2027],
  'devonta-freeman-2015': [265, 1056],
  'doug-martin-2015': [288, 1402],
  'eddie-george-2000': [398, 1455],
  'edgerrin-james-2000': [383, 1690],
  'ezekiel-elliott-2016': [322, 1631],
  'frank-gore-2006': [313, 1695],
  'fred-taylor-2000': [286, 1363],
  'isaiah-crowell-2016': [198, 952],
  'jahmyr-gibbs-2024': [250, 1412],
  'jamaal-charles-2013': [259, 1287],
  'jamal-lewis-2003': [388, 2063],
  'james-conner-2021': [202, 752],
  'jeremy-hill-2014': [222, 1124],
  'joe-mixon-2021': [292, 1205],
  'jonathan-taylor-2021': [332, 1811],
  'josh-jacobs-2022': [340, 1653],
  'julius-jones-2006': [267, 1084],
  'kenneth-walker-iii-2023': [219, 905],
  'knowshon-moreno-2013': [241, 1038],
  'ladainian-tomlinson-2006': [349, 1815],
  'larry-johnson-2005': [336, 1750],
  'latavius-murray-2015': [266, 1066],
  'legarrette-blount-2016': [299, 1161],
  'leonard-fournette-2021': [180, 812],
  'lesean-mccoy-2013': [314, 1607],
  'leveon-bell-2014': [290, 1361],
  'marion-barber-2007': [203, 973],
  'mark-ingram-2017': [230, 1124],
  'marshall-faulk-1999': [228, 1267],
  'marshawn-lynch-2014': [280, 1306],
  'matt-forte-2013': [289, 1339],
  'maurice-jones-drew-2011': [343, 1606],
  'melvin-gordon-2018': [175, 885],
  'michael-bush-2011': [256, 977],
  'michael-turner-2008': [377, 1699],
  'mike-alstott-1999': [239, 956],
  'nick-chubb-2022': [302, 1525],
  'peyton-hillis-2010': [270, 1177],
  'priest-holmes-2002': [313, 1615],
  'rashaad-penny-2021': [119, 749],
  'rashard-mendenhall-2010': [324, 1273],
  'reggie-bush-2011': [216, 1086],
  'reuben-droughns-2005': [309, 1232],
  'rhamondre-stevenson-2022': [210, 1040],
  'ricky-williams-2002': [383, 1853],
  'ron-dayne-2000': [226, 758],
  'rudi-johnson-2004': [362, 1457],
  'ryan-grant-2009': [282, 1253],
  'ryan-mathews-2013': [285, 1255],
  'saquon-barkley-2024': [345, 2005],
  'shaun-alexander-2005': [370, 1880],
  'stephen-davis-1999': [282, 1366],
  'steven-jackson-2006': [346, 1528],
  'thomas-jones-2009': [332, 1402],
  'tiki-barber-2005': [357, 1860],
  'tj-duckett-2004': [104, 509],
  'todd-gurley-2017': [279, 1305],
  'trent-richardson-2012': [267, 950],
  'warrick-dunn-2004': [265, 1106],
  'willis-mcgahee-2007': [294, 1207],
  'zac-stacy-2013': [250, 973],
};
// The real game's run shape, nflverse play-by-play 2022-23, designed runs
// without kneels; and backs with 150 or more carries in a season, 1999-2024.
const REAL = { ypc: 4.49, stopped: 17.3, ten: 11.6, twenty: 2.52, backsSd: 0.58, backsP90: 5.05, backsMax: 6.38 };

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1)); };
const corr = (x, y) => { const mx = mean(x), my = mean(y); let s = 0, a = 0, b = 0; for (let i = 0; i < x.length; i++) { s += (x[i] - mx) * (y[i] - my); a += (x[i] - mx) ** 2; b += (y[i] - my) ** 2; } return s / Math.sqrt(a * b); };
const slope = (x, y) => { const mx = mean(x), my = mean(y); let s = 0, a = 0; for (let i = 0; i < x.length; i++) { s += (x[i] - mx) * (y[i] - my); a += (x[i] - mx) ** 2; } return s / a; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };

// ---- the backs ---------------------------------------------------------------
const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const SIDE = syntheticTeam('side', 82, 2, 1), OPP = syntheticTeam('opp', 82, 2, 2);
const slot = ROSTER_SLOTS.find((s) => s.pos === 'RB' && s.starter).id;
const rows = [];
for (const p of PLAYERS.filter((x) => REAL_BACKS[x.id])) {
  const t = { ...SIDE, slots: { ...SIDE.slots }, byId: new Map(SIDE.byId) };
  t.byId.set(p.id, p); t.slots[slot] = p.id;
  let att = 0, yds = 0;
  for (let i = 0; i < GAMES; i++) {
    const home = i % 2 === 0;
    const g = createGame(home ? tf(t) : tf(OPP), home ? tf(OPP) : tf(t), { seed: 70000 + i, homeAdvantage: false });
    simulateGame(g);
    const s = g.stats[home ? 0 : 1].players[p.id];
    if (s) { att += s.rush.att; yds += s.rush.yds; }
  }
  const [car, ry] = REAL_BACKS[p.id];
  rows.push({ name: p.name, season: p.season, ovr: overall(p), ypc: yds / att, car, real: ry / car });
}
const q = rows.filter((r) => r.car >= 150);
const e = q.map((r) => r.ypc), re = q.map((r) => r.real);
console.log(`${q.length} backs from 1999 on with 150+ real carries, each ${GAMES} games in the same average side:`);
console.log(`  yards a carry, engine   mean ${mean(e).toFixed(2)}, sd ${sd(e).toFixed(2)}, ${Math.min(...e).toFixed(2)} to ${Math.max(...e).toFixed(2)}`);
console.log(`  yards a carry, real     mean ${mean(re).toFixed(2)}, sd ${sd(re).toFixed(2)}, ${Math.min(...re).toFixed(2)} to ${Math.max(...re).toFixed(2)}`);
console.log(`  per overall point: engine ${slope(q.map((r) => r.ovr), e).toFixed(3)}, real ${slope(q.map((r) => r.ovr), re).toFixed(3)}; correlation ${corr(e, re).toFixed(2)}`);
console.log(`  backs, real on engine slope: ${slope(e, re).toFixed(2)}`);

// ---- a league ----------------------------------------------------------------
let att = 0, yds = 0, runs = 0, stopped = 0, ten = 0, twenty = 0;
const starters = [];
for (let l = 0; l < LEAGUES; l++) {
  const seed = 41 + 97 * l;
  const lg = createLeague({ name: 'R', mode: 'pro', numTeams: 32, franchise: 5, seed, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' }, injuries: 'off' });
  lg.settings.jobs = false;
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  const byId = careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
  const n = lg.teams.length;
  const teams = lg.teams.map((_, i) => ({ ...teamForGame(lg, i, byId), isUser: false }));
  const season = teams.map(() => new Map());
  for (let c = 0; c < n; c++) for (let k = 0; k < 17; k += 2) {
    const o = (c + 1 + ((k * 7 + l * 3) % (n - 1))) % n;
    const g = createGame(teams[c], teams[o], { seed: hashSeed(`rr:${seed}:${c}:${k}`), injuryLevel: 0 });
    simulateGame(g);
    [c, o].forEach((ti, side) => {
      att += g.stats[side].team.rushAtt; yds += g.stats[side].team.rushYds;
      for (const [id, s] of Object.entries(g.stats[side].players)) {
        const a = season[ti].get(id) || { att: 0, yds: 0 };
        a.att += s.rush.att; a.yds += s.rush.yds; season[ti].set(id, a);
      }
    });
    for (const ev of g.log) {
      if (ev.type !== 'run' || !Number.isFinite(ev.yards)) continue;
      runs++; if (ev.yards <= 0) stopped++; if (ev.yards >= 10) ten++; if (ev.yards >= 20) twenty++;
    }
  }
  for (const m of season) for (const [id, a] of m) if (byId.get(id)?.pos === 'RB' && a.att >= 150) starters.push(a.yds / a.att);
}
const share = (x) => (100 * x / runs);
console.log(`\n${LEAGUES} drafted pro leagues, a season each, every club run by the AI (real in brackets):`);
console.log(`  runs stopped at or behind ${share(stopped).toFixed(1)}% (${REAL.stopped}), ten or more ${share(ten).toFixed(1)}% (${REAL.ten}), twenty or more ${share(twenty).toFixed(2)}% (${REAL.twenty})`);
console.log(`  starting backs (${starters.length}): sd ${sd(starters).toFixed(2)} (${REAL.backsSd}), p90 ${pct(starters, 0.9).toFixed(2)} (${REAL.backsP90}), best ${Math.max(...starters).toFixed(2)} (${REAL.backsMax} in 26 seasons)`);
console.log(`  pro league yards a carry: ${(yds / att).toFixed(2)} (${REAL.ypc})`);
