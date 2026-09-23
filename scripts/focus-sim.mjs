// What a development focus does, measured exactly rather than estimated.
//
// Just before each offseason, every rostered man's season is stepped twice —
// with the league's focus plan and without it — off the same random stream,
// which `stepCareer` guarantees. The difference is what focus did to him and
// nothing else. From that:
//
//   net        the whole league's development with focus minus without, in raw
//              overall points. `FOCUS_COST` exists to hold this at zero: focus
//              is meant to move development between men, not to add any, since
//              ratings are what every salary and the whole cap are priced from.
//   value      the same in leverage-weighted points on starters — what a club
//              actually gains from concentrating it.
//   picks      the staff's choices against the best three and three at random,
//              each scored by what focus would truly have done for that man.
//
// Usage: node scripts/focus-sim.mjs [seasons] [leagues] [first seed]
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { enterOffseason } from '../src/engine/offseason.js';
import { stepCareer, startCareer, primeAge, applyCareers, careerIndex } from '../src/engine/careers.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { teamContractIds } from '../src/engine/cap.js';
import { TRUE_LEVERAGE } from '../src/engine/auction.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { focusPlan, focusOf, FOCUS_CLIMB, FOCUS_EASE, FOCUS_COST, FOCUS_SLOTS } from '../src/engine/focus.js';

registerPlayers(PLAYERS_BY_ID);
const SEASONS = Number(process.argv[2] || 5);
const LEAGUES = Number(process.argv[3] || 2);
const SEED0 = Number(process.argv[4] || 4000);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const mean = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);
const FULL = { climb: 1 + FOCUS_CLIMB, decline: 1 - FOCUS_EASE };

let focusedGain = 0, teammateCost = 0, starterValue = 0, clubSeasons = 0;
const byBand = { 'climbing (3+ before peak)': [], 'near peak (-2..+1)': [], 'declining (+2..+4)': [], 'well past (+5 on)': [] };
const band = (t) => (t <= -3 ? 'climbing (3+ before peak)' : t <= 1 ? 'near peak (-2..+1)' : t <= 4 ? 'declining (+2..+4)' : 'well past (+5 on)');
let staffScore = 0, oracleScore = 0, randomScore = 0;

for (let L = 0; L < LEAGUES; L++) {
  const seed = SEED0 + L * 37;
  const lg = createLeague({ name: 'F', mode: 'pro', numTeams: 32, franchise: 12, seed, draftType: 'snake', user: {}, injuries: 'normal' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  const pick = new RNG(seed * 31);
  for (let yr = 1; yr <= SEASONS; yr++) {
    simulateAhead(lg, index(lg), pool(lg), new RNG(seed * 7 + yr), 'offseason');
    if (lg.phase !== 'complete') break;
    const byId = index(lg);
    const plan = focusPlan(lg, byId);
    lg.teams.forEach((team, ti) => {
      const starters = new Set(ROSTER_SLOTS.filter((s) => s.starter).map((s) => team.slots[s.id]).filter(Boolean));
      const worth = new Map();   // what full focus would do for each man, leverage-weighted
      for (const id of teamContractIds(lg, ti)) {
        const p = byId.get(id);
        if (!p) continue;
        const src = p.base || p;
        // A man signed this season has no career yet; `advanceCareers` starts
        // one exactly like this and steps it in the same offseason. Skipping
        // him would count his teammates' bill for his focus and not the focus.
        const c = lg.dev?.[id] ?? { ...startCareer(lg, src), from: lg.season };
        const knocks = lg.knocks?.[id] || 0;
        const without = stepCareer(lg, src, c, lg.season, knocks, null).after;
        const withPlan = stepCareer(lg, src, c, lg.season, knocks, plan.get(id) || null).after;
        const d = withPlan - without;
        const lev = (TRUE_LEVERAGE[p.pos] ?? 1) * (starters.has(id) ? 1 : 0);
        if (plan.get(id)?.focused) { focusedGain += d; byBand[band(c.age + 1 - primeAge(p.pos))].push(d); } else teammateCost += d;
        starterValue += d * lev;
        const full = stepCareer(lg, src, c, lg.season, knocks, FULL).after - without;
        worth.set(id, full * (TRUE_LEVERAGE[p.pos] ?? 1) * (starters.has(id) ? 1 : 0.5));
      }
      clubSeasons++;
      const score = (ids) => ids.reduce((s, id) => s + (worth.get(id) ?? 0), 0);
      const all = [...worth.keys()];
      staffScore += score(focusOf(lg, ti, byId));
      oracleScore += score([...all].sort((a, b) => worth.get(b) - worth.get(a)).slice(0, FOCUS_SLOTS));
      const shuffled = [...all];
      for (let i = shuffled.length - 1; i > 0; i--) { const j = pick.int(0, i); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      randomScore += score(shuffled.slice(0, FOCUS_SLOTS));
    });
    enterOffseason(lg, pool(lg), byId);
    simulateAhead(lg, index(lg), pool(lg), new RNG(seed * 13 + yr), 'nextSeason');
  }
}

console.log(`FOCUS_CLIMB ${FOCUS_CLIMB} · FOCUS_EASE ${FOCUS_EASE} · FOCUS_COST ${FOCUS_COST} · ${LEAGUES} leagues × ${SEASONS} offseasons, ${clubSeasons} club-offseasons`);
console.log(`\nLeague development, focus against none (raw overall points)`);
console.log(`  focused men gained     ${focusedGain.toFixed(1)}  (${(focusedGain / clubSeasons).toFixed(2)} a club a season)`);
console.log(`  their teammates paid   ${teammateCost.toFixed(1)}  (${(teammateCost / clubSeasons).toFixed(2)} a club a season)`);
console.log(`  net                    ${(focusedGain + teammateCost).toFixed(1)}  — zero means focus moves development and adds none`);
console.log(`  on starters, leverage-weighted: ${(starterValue / clubSeasons).toFixed(2)} a club a season`);
console.log(`\nWhat focus did for a focused man, by where he was (overall points this season)`);
for (const [name, xs] of Object.entries(byBand)) if (xs.length) console.log(`  ${name.padEnd(26)} n=${String(xs.length).padStart(4)}  mean ${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(2)}`);
console.log(`\nPicks, scored by what full focus would truly have done (leverage-weighted)`);
console.log(`  best three ${(oracleScore / clubSeasons).toFixed(2)} · staff ${(staffScore / clubSeasons).toFixed(2)} (${(100 * staffScore / oracleScore).toFixed(0)}% of best) · random ${(randomScore / clubSeasons).toFixed(2)} (${(100 * randomScore / oracleScore).toFixed(0)}%)`);
