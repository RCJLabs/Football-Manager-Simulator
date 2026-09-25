// Do the lines play like the real ones?
//
//   node scripts/trench-realism.mjs [games per position] [games per rusher]
//
// The fifth of the realism scripts. The others hold a man's own numbers to his
// real season: a back's carries, a passer's dropbacks, a receiver's targets. No
// box score counts a block, so nothing had checked what the lines do, and they
// were where the engine was furthest from the real game (DESIGN.md, "The
// trenches, held to real absences"). Two tests, from numbers taken out of
// nflverse (regular seasons) and written down below so this runs offline:
//
//   absences  real starters of 2016-24 (6+ games at 60% or more of the snaps)
//             who missed games: their side's numbers in the games they missed
//             against the games they played, a regression within team-seasons
//             on how many starters at each position sat out, adjusted for the
//             opponent. In the engine, one starter at a time eight points worse
//             on every attribute, in the average side, on the same seeds as the
//             unchanged side. Eight is the gap that reproduces a missing
//             quarterback's passing and a missing back's carries; for every
//             other position it is an assumption. What does not lean on it is a
//             position's run effect against its pass effect, where the gap
//             cancels.
//   rushers   every lineman and linebacker in the pool with a real season from
//             1999 on and ten or more games, in the average side, against the
//             sacks he really had. The line to watch is the slope of real on
//             engine: 1 means the engine's differences between rushers come true
//             one for one.
import { PLAYERS } from '../src/data/db.js';
import { syntheticTeam } from './synthetic.mjs';
import { createGame, simulateGame } from '../src/engine/game.js';
import { buildLineup } from '../src/engine/ratings.js';
import { edgeness } from '../src/data/positions.js';

const GAMES = Number(process.argv[2] || 4000);
const RUSHER_GAMES = Number(process.argv[3] || 150);

// One starter missing: estimate and 95% interval (bootstrap over team-seasons).
// Offence: what his side loses. Defence: what the offence against it gains.
// Yards a carry, adjusted net yards a dropback (sacks and scrambles in, 20 a
// touchdown, -45 an interception), sack rate in points, points a game.
const REAL_ABSENCE = {
  QB1: { ypc: [-0.006, -0.125, 0.098], anya: [-0.612, -0.823, -0.302], sack: [-0.24, -0.79, 0.41], pts: [-2.47, -3.24, -1.37] },
  RB1: { ypc: [-0.256, -0.422, -0.093], anya: [-0.179, -0.385, 0.201], sack: [0.50, 0.05, 0.98], pts: [-0.53, -1.41, 0.58] },
  WR1: { ypc: [0.035, -0.043, 0.103], anya: [-0.148, -0.282, 0.019], sack: [0.02, -0.21, 0.27], pts: [-0.52, -0.90, -0.08] },
  TE1: { ypc: [-0.045, -0.172, 0.064], anya: [-0.032, -0.296, 0.190], sack: [-0.26, -0.71, 0.17], pts: [-0.06, -0.86, 0.69] },
  OL1: { ypc: [-0.053, -0.109, 0.015], anya: [-0.195, -0.290, -0.119], sack: [0.30, 0.08, 0.50], pts: [-0.80, -1.21, -0.47] },
  DL1: { ypc: [0.023, -0.035, 0.089], anya: [0.053, -0.111, 0.217], sack: [-0.23, -0.46, 0.06], pts: [0.41, -0.23, 1.05] },
  LB1: { ypc: [0.097, 0.013, 0.199], anya: [0.233, 0.120, 0.375], sack: [-0.44, -0.59, -0.15], pts: [0.86, 0.36, 1.43] },
  CB1: { ypc: [0.013, -0.051, 0.092], anya: [0.259, 0.143, 0.379], sack: [-0.39, -0.58, -0.26], pts: [0.91, 0.59, 1.35] },
  S1: { ypc: [-0.002, -0.081, 0.081], anya: [0.015, -0.153, 0.182], sack: [0.11, -0.13, 0.39], pts: [-0.26, -0.77, 0.32] },
};

// That regular season: [games, sacks].
const REAL_RUSHERS = {
  'aaron-curry-2010': [16, 3.5],
  'aaron-donald-2018': [16, 20.5],
  'aaron-kampman-2006': [16, 15],
  'aaron-smith-2004': [15, 7],
  'adalius-thomas-2006': [16, 11],
  'adam-carriker-2008': [13, 0],
  'aidan-hutchinson-2023': [17, 11.5],
  'akiem-hicks-2018': [16, 7.5],
  'al-wilson-2005': [15, 3],
  'amobi-okoye-2009': [15, 1.5],
  'anthony-barr-2015': [13, 3.5],
  'antonio-pierce-2005': [13, 2.5],
  'arik-armstead-2019': [16, 10],
  'barkevious-mingo-2014': [14, 2],
  'bertrand-berry-2004': [14, 13.5],
  'bjoern-werner-2014': [14, 4],
  'bobby-carpenter-2008': [10, 0],
  'bobby-wagner-2016': [16, 4.5],
  'brandon-graham-2017': [15, 9.5],
  'brett-keisel-2010': [10, 3],
  'brian-burns-2022': [16, 12.5],
  'brian-urlacher-2005': [15, 6],
  'bruce-carter-2013': [15, 2],
  'calais-campbell-2017': [16, 14.5],
  'cameron-heyward-2019': [16, 9],
  'cameron-jordan-2017': [15, 13],
  'cameron-wake-2012': [16, 15],
  'carlos-dunlap-2015': [15, 13.5],
  'chandler-jones-2019': [16, 19],
  'chris-jones-2022': [16, 15.5],
  'christian-wilkins-2023': [17, 9],
  'cj-mosley-2018': [14, 0.5],
  'clay-matthews-2010': [15, 12.5],
  'cliff-avril-2016': [16, 11.5],
  'corey-simon-2001': [15, 7.5],
  'damon-harrison-2016': [16, 2.5],
  'danielle-hunter-2018': [16, 14.5],
  'daryl-washington-2012': [16, 9],
  'deforest-buckner-2020': [15, 9.5],
  'deion-jones-2017': [16, 1],
  'demarcus-ware-2008': [16, 20],
  'demario-davis-2019': [16, 4],
  'derrick-brooks-2002': [16, 1],
  'derrick-harvey-2009': [15, 2],
  'devin-white-2021': [17, 3.5],
  'dexter-lawrence-2022': [16, 7.5],
  'dion-jordan-2014': [10, 1],
  'dmarco-farr-1999': [14, 8],
  'donnie-edwards-2004': [16, 1],
  'donta-hightower-2016': [13, 2.5],
  'dre-greenlaw-2023': [15, 1.5],
  'dwight-freeney-2004': [16, 16],
  'elvis-dumervil-2009': [16, 16.5],
  'eric-kendricks-2019': [15, 0.5],
  'ernie-sims-2007': [16, 0.5],
  'everson-griffen-2017': [15, 13],
  'fletcher-cox-2018': [16, 10.5],
  'foye-oluokun-2022': [17, 2],
  'fred-warner-2023': [16, 2.5],
  'geno-atkins-2012': [15, 12.5],
  'gerald-mccoy-2013': [15, 9.5],
  'grady-jarrett-2019': [16, 7.5],
  'grant-wistrom-2001': [15, 9],
  'haason-reddick-2022': [17, 16],
  'haloti-ngata-2010': [16, 5.5],
  'hugh-douglas-2000': [15, 15],
  'jadeveon-clowney-2018': [15, 9],
  'jamal-williams-2006': [15, 2],
  'james-farrior-2004': [16, 4],
  'james-harrison-2008': [15, 16],
  'jamie-collins-2015': [12, 5.5],
  'jared-allen-2011': [16, 22],
  'jared-verse-2024': [17, 4.5],
  'jarrad-davis-2018': [16, 6],
  'jason-pierre-paul-2011': [16, 16.5],
  'jason-taylor-2006': [16, 13.5],
  'jeffery-simmons-2021': [17, 8.5],
  'jerod-mayo-2010': [16, 2],
  'jerry-hughes-2014': [15, 10],
  'jimmy-kennedy-2005': [13, 3],
  'jj-watt-2014': [16, 20.5],
  'joey-bosa-2017': [16, 12.5],
  'joey-porter-2002': [16, 9],
  'john-abraham-2005': [16, 10.5],
  'john-henderson-2006': [15, 3.5],
  'jonathan-allen-2021': [17, 9],
  'jonathan-vilma-2009': [15, 2],
  'julian-peterson-2006': [16, 10],
  'julius-peppers-2004': [16, 11],
  'jurrell-casey-2017': [15, 6],
  'justin-houston-2014': [16, 22],
  'justin-smith-2011': [16, 7.5],
  'justin-tuck-2008': [16, 13],
  'karlos-dansby-2010': [14, 3],
  'keith-brooking-2002': [16, 0],
  'keith-bulluck-2003': [16, 3],
  'kendrell-bell-2001': [14, 9],
  'kevin-carter-1999': [14, 15],
  'kevin-hardy-1999': [16, 10.5],
  'kevin-williams-2004': [16, 11],
  'khalil-mack-2018': [13, 12.5],
  'kris-jenkins-2003': [16, 5],
  'kyle-vanden-bosch-2005': [16, 12.5],
  'lance-briggs-2005': [16, 2],
  'laroi-glover-2000': [16, 17],
  'larry-foote-2008': [16, 1.5],
  'lavonte-david-2013': [16, 7],
  'leighton-vander-esch-2018': [16, 0],
  'leonard-williams-2020': [16, 11.5],
  'linval-joseph-2016': [16, 4],
  'lofa-tatupu-2007': [16, 1],
  'london-fletcher-2007': [16, 0],
  'luke-kuechly-2014': [16, 3],
  'marcell-dareus-2014': [15, 10],
  'marcus-stroud-2003': [15, 4.5],
  'mario-williams-2008': [16, 12],
  'matt-milano-2022': [15, 1.5],
  'maxx-crosby-2023': [17, 14.5],
  'micah-parsons-2022': [17, 13.5],
  'michael-bennett-2015': [16, 10],
  'michael-strahan-2001': [16, 22.5],
  'mike-daniels-2017': [12, 5],
  'mike-vrabel-2007': [16, 10.5],
  'muhammad-wilkerson-2013': [16, 10.5],
  'myles-garrett-2023': [15, 14],
  'navorro-bowman-2013': [16, 5],
  'ndamukong-suh-2010': [16, 10],
  'nick-bosa-2022': [16, 18.5],
  'osi-umenyiora-2007': [15, 14],
  'pat-williams-2006': [15, 1],
  'patrick-kerney-2007': [16, 14.5],
  'patrick-willis-2011': [12, 2],
  'peter-boulware-2001': [16, 15],
  'quinnen-williams-2022': [16, 12],
  'randall-godfrey-2000': [16, 3],
  'ray-lewis-2000': [16, 3],
  'reuben-foster-2017': [10, 0],
  'rey-maualuga-2011': [13, 0],
  'richard-seymour-2003': [15, 8],
  'robert-ayers-2013': [15, 5.5],
  'robert-mathis-2013': [16, 19.5],
  'robert-porcher-1999': [15, 15],
  'robert-quinn-2013': [16, 19],
  'rod-coleman-2004': [13, 10.5],
  'rolando-mcclain-2011': [15, 5],
  'roquan-smith-2023': [16, 1.5],
  'ryan-sims-2004': [12, 2],
  'sam-adams-2000': [13, 2],
  'sean-lee-2016': [15, 0],
  'shaquil-barrett-2019': [16, 19.5],
  'shaquille-leonard-2018': [15, 7],
  'shaun-ellis-2003': [16, 12.5],
  'shawne-merriman-2006': [12, 16.5],
  'sheldon-richardson-2014': [16, 8],
  'simeon-rice-2002': [16, 15.5],
  'solomon-thomas-2019': [14, 2],
  'takeo-spikes-2004': [16, 4],
  'tamba-hali-2011': [16, 12],
  'ted-johnson-2001': [11, 0],
  'ted-washington-2001': [14, 1.5],
  'tedy-bruschi-2004': [16, 5],
  'telvin-smith-2017': [14, 1],
  'terrell-suggs-2011': [16, 14],
  'thomas-davis-2015': [16, 5.5],
  'tj-watt-2021': [15, 22.5],
  'tony-siragusa-2000': [13, 0],
  'trace-armstrong-2000': [12, 13],
  'tremaine-edmunds-2022': [13, 1],
  'trent-cole-2009': [16, 12.5],
  'trevor-pryce-1999': [15, 13],
  'trey-hendrickson-2023': [17, 17.5],
  'tyson-jackson-2010': [10, 1],
  'vince-wilfork-2007': [16, 2],
  'vita-vea-2021': [14, 4],
  'von-miller-2015': [16, 11],
  'warren-sapp-1999': [15, 12.5],
  'willie-mcginest-2003': [14, 5],
  'yannick-ngakoue-2017': [16, 12],
  'zach-thomas-2002': [16, 0.5],
  'zadarius-smith-2019': [15, 13.5],
  'zaire-franklin-2024': [17, 3.5],
};

const RUNS = new Set(['run_in', 'run_out']);
const PASSES = new Set(['screen', 'pass_short', 'pass_med', 'pass_deep', 'pa_pass']);
const OFFENCE = new Set(['QB1', 'RB1', 'WR1', 'TE1', 'OL1']);
const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const slope = (x, y) => { const mx = mean(x), my = mean(y); let s = 0, a = 0; for (let i = 0; i < x.length; i++) { s += (x[i] - mx) * (y[i] - my); a += (x[i] - mx) ** 2; } return s / a; };
const blank = () => ({ db: 0, sk: 0, nety: 0, td: 0, int: 0, run: 0, ryd: 0 });
const rate = { ypc: (a) => a.ryd / a.run, anya: (a) => (a.nety + 20 * a.td - 45 * a.int) / a.db, sack: (a) => 100 * a.sk / a.db };

// Tally a side's snaps from the log: `mine` is the side whose offence is `o`.
function tally(g, mine, acc) {
  for (const e of g.log) {
    if (e.snapOff == null || !e.call) continue;
    const v = e.snapOff === mine ? acc.o : acc.d, text = e.text || '';
    if (PASSES.has(e.call) && ['pass', 'incomplete', 'int', 'sack', 'fumble', 'run'].includes(e.type)) {
      v.db++; if (e.type === 'sack' || (e.type === 'fumble' && /sacked/.test(text))) v.sk++;
      v.nety += e.yards ?? 0; if (/TOUCHDOWN/.test(text)) v.td++; if (e.type === 'int') v.int++;
    } else if (RUNS.has(e.call) && (e.type === 'run' || e.type === 'fumble')) { v.run++; v.ryd += e.yards ?? 0; }
  }
}

// ---- absences ------------------------------------------------------------------
function side(slot) {
  const acc = { o: blank(), d: blank(), pf: 0, pa: 0 };
  for (let i = 0; i < GAMES; i++) {
    const A = syntheticTeam(`tr-a${i}`, 82, 2, 5100 + i), B = syntheticTeam(`tr-b${i}`, 82, 2, 9100 + i);
    if (slot) {
      const id = A.slots[slot], p = A.byId.get(id);
      A.byId = new Map(A.byId);
      A.byId.set(id, { ...p, r: Object.fromEntries(Object.entries(p.r).map(([k, v]) => [k, Math.max(30, v - 8)])) });
    }
    const home = i % 2 === 0;
    const g = createGame(home ? tf(A) : tf(B), home ? tf(B) : tf(A), { seed: 47000 + i, homeAdvantage: false });
    simulateGame(g);
    const me = home ? 0 : 1;
    acc.pf += g.score[me]; acc.pa += g.score[1 - me];
    tally(g, me, acc);
  }
  return acc;
}
const base = side(null);
const eng = {};
console.log(`One starter eight points worse on everything, ${GAMES} games against the unchanged side's; a real starter missing in brackets, [95% interval]:`);
console.log(`  ${'position'.padEnd(9)}${'yards a carry'.padEnd(34)}${'adjusted net a dropback'.padEnd(34)}${'sacked %'.padEnd(30)}points a game`);
for (const slot of Object.keys(REAL_ABSENCE)) {
  const acc = side(slot), sd = OFFENCE.has(slot) ? 'o' : 'd';
  const d = Object.fromEntries(Object.keys(rate).map((m) => [m, rate[m](acc[sd]) - rate[m](base[sd])]));
  d.pts = (OFFENCE.has(slot) ? acc.pf - base.pf : acc.pa - base.pa) / GAMES;
  eng[slot] = d;
  const cell = (m, dp) => {
    const [b, lo, hi] = REAL_ABSENCE[slot][m], v = d[m];
    const flag = v < lo || v > hi ? '!' : ' ';
    return `${flag}${v >= 0 ? '+' : ''}${v.toFixed(dp)} (${b >= 0 ? '+' : ''}${b.toFixed(dp)} [${lo.toFixed(dp)}, ${hi.toFixed(dp)}])`.padEnd(34);
  };
  console.log(`  ${slot.slice(0, -1).padEnd(9)}${cell('ypc', 3)}${cell('anya', 3)}${cell('sack', 2).slice(0, 30)}${cell('pts', 2)}`);
}
console.log('  ! the engine outside the real interval');
// The comparison that does not lean on the gap: a position's run effect against its sacks.
for (const slot of ['OL1', 'DL1']) {
  const r = REAL_ABSENCE[slot];
  console.log(`  ${slot.slice(0, -1)}, yards a carry per point of sack rate: engine ${(eng[slot].ypc / eng[slot].sack).toFixed(2)}, real ${(r.ypc[0] / r.sack[0]).toFixed(2)}`);
}
console.log(`  a lineman eight worse costs his side ${(-eng.OL1.ypc).toFixed(3)} yards a carry (real ${-REAL_ABSENCE.OL1.ypc[0]})`);
console.log(`  a defensive lineman eight worse gives up ${eng.DL1.ypc.toFixed(3)} yards a carry (real ${REAL_ABSENCE.DL1.ypc[0]})`);

// ---- rushers -------------------------------------------------------------------
const SIDE = syntheticTeam('side', 82, 2, 1), OPP = syntheticTeam('opp', 82, 2, 2);
const rows = [];
for (const p of PLAYERS.filter((x) => REAL_RUSHERS[x.id])) {
  const slot = p.pos === 'DL' ? 'DL1' : 'LB1';
  const t = { ...SIDE, slots: { ...SIDE.slots }, byId: new Map(SIDE.byId) };
  t.byId.set(p.id, p); t.slots[slot] = p.id;
  let sk = 0;
  for (let i = 0; i < RUSHER_GAMES; i++) {
    const home = i % 2 === 0;
    const g = createGame(home ? tf(t) : tf(OPP), home ? tf(OPP) : tf(t), { seed: 83000 + i, homeAdvantage: false });
    simulateGame(g);
    sk += g.stats[home ? 0 : 1].players[p.id]?.def.sck ?? 0;
  }
  const [games, real] = REAL_RUSHERS[p.id];
  rows.push({ name: `${p.name} ${p.season}`, pos: p.pos, edge: edgeness(p.pos, p.r), e: sk / RUSHER_GAMES, r: real / games });
}
console.log(`\n${rows.length} linemen and linebackers from 1999 on with ten or more real games, each ${RUSHER_GAMES} games in the same average side:`);
for (const [label, f] of [['linemen', (r) => r.pos === 'DL'], ['edge rushers', (r) => r.pos === 'LB' && r.edge > 0.5], ['off-ball backers', (r) => r.pos === 'LB' && r.edge <= 0.5]]) {
  const q = rows.filter(f);
  console.log(`  ${label.padEnd(17)} ${String(q.length).padStart(3)}: sacks a season (17 games) engine ${(17 * mean(q.map((r) => r.e))).toFixed(1)}, real ${(17 * mean(q.map((r) => r.r))).toFixed(1)}; real on engine slope ${slope(q.map((r) => r.e), q.map((r) => r.r)).toFixed(2)}`);
}
const dl = rows.filter((r) => r.pos === 'DL');
console.log(`  linemen, real on engine slope: ${slope(dl.map((r) => r.e), dl.map((r) => r.r)).toFixed(2)}`);
const best = rows.reduce((a, b) => (b.e > a.e ? b : a));
console.log(`  most in the engine: ${best.name}, ${(17 * best.e).toFixed(1)} a season (real ${(17 * best.r).toFixed(1)})`);
console.log(`  rushers, real on engine slope: ${slope(rows.map((r) => r.e), rows.map((r) => r.r)).toFixed(2)}`);
