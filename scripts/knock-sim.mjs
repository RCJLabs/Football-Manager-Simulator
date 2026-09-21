// What a season-ending injury costs a career, over a long save.
//
//   node scripts/knock-sim.mjs [seasons] [runs]
//
// The toll is only worth having if it is rare enough to be an event and heavy
// enough to be a decision. Too rare and nothing changes; too heavy and every
// club is fielding replacements by season five. This runs a pro league for a
// decade and reports both ends.
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex, startCareer, stepCareer } from '../src/engine/careers.js';
import { overall } from '../src/engine/ratings.js';

registerPlayers(PLAYERS_BY_ID);
const SEASONS = Number(process.argv[2] || 10);
const RUNS = Number(process.argv[3] || 4);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));

function run(tollOn) {
const agg = { knocked: new Set(), retiredAges: [], seasons: 0, powerBySeason: {} };
for (let r = 0; r < RUNS; r++) {
  const lg = createLeague({ name: 'K', mode: 'pro', numTeams: 32, franchise: 12, seed: 300 + r, draftType: 'snake', user: {}, injuries: 'normal' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(300 + r));
  startSeason(lg, PLAYERS_BY_ID);
  for (let yr = 0; yr < SEASONS; yr++) {
    if (lg.jobs?.status === 'retired') break;
    // The control arm wipes the ledger before the offseason reads it, so the
    // same injuries happen and none of them costs a career. Anything the two
    // arms differ by is this feature and not ageing.
    if (!tollOn) lg.knocks = {};
    simulateAhead(lg, index(lg), pool(lg), new RNG(7000 + yr * 31 + r), 'nextSeason');
    if (!tollOn) lg.knocks = {};
    agg.seasons++;
    // Careers carry their own count once the offseason has settled.
    for (const [id, c] of Object.entries(lg.dev || {})) if (c.knocks) agg.knocked.add(`${r}:${id}`);
    const byId = index(lg);
    const powers = lg.teams.map((t) => {
      const men = Object.values(t.slots).map((id) => byId.get(id)).filter(Boolean);
      return men.length ? men.reduce((s, p) => s + overall(p), 0) / men.length : 0;
    });
    (agg.powerBySeason[yr] ??= []).push(powers.reduce((a, b) => a + b, 0) / powers.length);
  }
  for (const id of lg.retired || []) {
    const c = (lg.dev || {})[id];
    if (c) agg.retiredAges.push(c.age);
  }
}
return agg;
}
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// How OFTEN it happens: a full league run, which is the only way to find out.
const freq = run(true);

// What it COSTS: measured directly rather than against a control arm, because
// `simulateAhead` runs the season and the offseason inside one call and there
// is no seam between them to clear a ledger in. Stepping the same career twice,
// once with the knock and once without, isolates the toll exactly.
const lg = createLeague({ name: 'C', mode: 'pro', numTeams: 32, franchise: 12, seed: 77, draftType: 'snake', user: {}, injuries: 'normal' });
autoDraftAll(lg, lg.draft, PLAYERS, new RNG(77));
startSeason(lg, PLAYERS_BY_ID);
const byId = index(lg);
const byPos = {};
for (const t of lg.teams) {
  for (const id of Object.values(t.slots)) {
    const p = byId.get(id);
    if (!p) continue;
    const src = p.base || p;
    const c = startCareer(lg, src);
    const clean = stepCareer(lg, src, c, 1, 0);
    const hurt = stepCareer(lg, src, c, 1, 1);
    (byPos[src.pos] ??= []).push({ cost: clean.after - hurt.after, years: (clean.career.retireAt ?? 0) - (hurt.career.retireAt ?? 0) });
  }
}

console.log(`${RUNS} pro leagues, ${SEASONS} seasons each\n`);
console.log(`HOW OFTEN a career is marked`);
console.log(`  ${freq.knocked.size} careers over ${freq.seasons} league-seasons`);
console.log(`  ${(freq.knocked.size / freq.seasons).toFixed(1)} a season across 32 clubs — ${(freq.knocked.size / freq.seasons / 32).toFixed(2)} a club, about one every ${(32 * freq.seasons / freq.knocked.size).toFixed(0)} club-seasons`);
console.log(`  ${(100 * freq.knocked.size / freq.seasons / 864).toFixed(2)}% of the 864 men under contract in any season, so the league-wide drag is arithmetically nil`);
console.log(`\nWHAT IT COSTS, per position (one knock, at prime age)`);
console.log('  pos   overall lost   years lost');
for (const pos of Object.keys(byPos).sort((a, b) => mean(byPos[b].map((x) => x.cost)) - mean(byPos[a].map((x) => x.cost)))) {
  const r = byPos[pos];
  console.log(`  ${pos.padEnd(4)}  ${mean(r.map((x) => x.cost)).toFixed(2).padStart(10)}   ${mean(r.map((x) => x.years)).toFixed(1).padStart(9)}`);
}
console.log('\nmean roster rating by season (the ordinary ageing drift, for context)');
for (const [yr, vals] of Object.entries(freq.powerBySeason)) console.log(`  season ${String(Number(yr) + 1).padStart(2)}   ${mean(vals).toFixed(1)}`);
