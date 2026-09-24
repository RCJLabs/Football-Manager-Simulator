// Does the cap still bind in season twenty-five?
//
//   node scripts/cap-drift.mjs [seasons] [leagues] [first seed]
//
// The cap was calibrated at founding: a drafted roster priced entirely at
// market costs 104% to 114% of it, so every club is part bargain and part
// rookie deal. That was measured on the founding pool, eight seasons deep. A
// dynasty runs longer than that, and the talent in it turns over — the
// all-time greats age and retire, generated rookies arrive in their place, and
// men nobody signed stay frozen at their prime until somebody does. If the
// league's talent drifts, what it costs drifts with it, and a fixed cap could
// loosen into decoration or tighten into a wall. This is the measurement that
// decided the cap should not grow (DESIGN.md, "Twenty-five seasons in").
//
// 32-club pro leagues played into each next season with every club run by the
// AI, read at every kickoff:
//
//   hit          what clubs are paying, dead money included: the mean over the
//                leagues, and the lowest and highest league mean
//   pressed      clubs within 5% of the cap
//   at market    what the rosters would cost if every man were paid what
//                `marketSalary` says, against the cap
//   starters     mean overall of every starter in the league
//   generated    share of rostered men who came from a rookie class
//   cut          men shed to get under the cap at this kickoff
//   FA paid      what this offseason's free agents signed for, over asking
//   rookie deals what men still on their rookie deals cost, over market
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { overall } from '../src/engine/ratings.js';
import { capHit, marketSalary, PRO_CAP, MIN_SALARY, ROOKIE_YEARS } from '../src/engine/cap.js';

registerPlayers(PLAYERS_BY_ID);
const SEASONS = Number(process.argv[2] || 25);
const LEAGUES = Number(process.argv[3] || 4);
const SEED0 = Number(process.argv[4] || 5150);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
const N = ROSTER_SLOTS.length;

function read(lg) {
  const byId = index(lg);
  const cap = lg.cap ?? PRO_CAP;
  const hits = lg.teams.map((_, i) => capHit(lg, i));
  let atMarket = 0, starters = [], men = 0, generated = 0;
  const fa = [0, 0], rookie = [0, 0];
  for (const t of lg.teams) {
    for (const s of ROSTER_SLOTS) {
      const p = byId.get(t.slots[s.id]);
      if (!p) { atMarket += MIN_SALARY; continue; }
      const c = lg.contracts?.[p.id] || {};
      const salary = c.salary ?? MIN_SALARY, market = marketSalary(p, s);
      atMarket += market;
      men++;
      if (p.generated) generated++;
      if (s.starter) starters.push(overall(p));
      // Signed off the market this offseason: no pick behind him, never kept.
      if (c.since === lg.season && (c.round ?? N) === N && (c.kept ?? 0) === 0 && salary > MIN_SALARY) { fa[0] += salary; fa[1] += market; }
      // Drafted, and not yet through the four years a rookie deal runs.
      if ((c.round ?? N) < N && lg.season - (c.since ?? 0) < ROOKIE_YEARS && !c.expiring) { rookie[0] += salary; rookie[1] += market; }
    }
  }
  return {
    cap,
    hit: mean(hits),
    pressed: hits.filter((h) => h >= 0.95 * cap).length,
    market: 100 * atMarket / lg.teams.length / cap,
    starter: mean(starters),
    generated: 100 * generated / men,
    cuts: (lg.transactions || []).filter((x) => x.type === 'cut' && x.season === lg.season && x.week === 0).length,
    fa: fa[1] ? fa[0] / fa[1] : NaN,
    rookie: rookie[1] ? rookie[0] / rookie[1] : NaN,
  };
}

const bySeason = Array.from({ length: SEASONS }, () => []);
for (let L = 0; L < LEAGUES; L++) {
  const seed = SEED0 + 1010 * L;
  const lg = createLeague({ name: 'Drift', mode: 'pro', numTeams: 32, franchise: 12, seed, draftType: 'snake', user: {}, injuries: 'normal' });
  // The user's club is run by the same AI as the rest; a sacked coach would end
  // the run, so the jobs market is off.
  lg.settings.jobs = false;
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  bySeason[0].push(read(lg));
  for (let yr = 1; yr < SEASONS; yr++) {
    simulateAhead(lg, index(lg), pool(lg), new RNG(seed * 7 + yr), 'nextSeason');
    bySeason[yr].push(read(lg));
  }
}

const f = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');
console.log(`${LEAGUES} pro leagues of 32 clubs from seed ${SEED0}, every club run by the AI, read at each of ${SEASONS} kickoffs; means over the leagues`);
console.log('  season   cap   hit (league range)   pressed   at market   starters   generated   cut   FA paid   rookie deals');
bySeason.forEach((rows, i) => {
  const hits = rows.map((r) => r.hit);
  const m = (k) => mean(rows.map((r) => r[k]).filter(Number.isFinite));
  console.log(`  ${String(i + 1).padStart(6)}   ${String(rows[0].cap).padStart(3)}   ${f(m('hit')).padStart(3)} (${f(Math.min(...hits))}–${f(Math.max(...hits))})`.padEnd(40)
    + `${f(m('pressed'), 1).padStart(7)}   ${(f(m('market')) + '%').padStart(9)}   ${f(m('starter'), 1).padStart(8)}   ${(f(m('generated')) + '%').padStart(9)}   ${f(m('cuts'), 1).padStart(3)}   ${(f(m('fa'), 2) + '×').padStart(7)}   ${(f(m('rookie'), 2) + '×').padStart(12)}`);
});
