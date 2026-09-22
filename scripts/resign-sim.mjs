// What the re-sign premium does to a pro league.
//
// Before it, an expiring contract cost plain market and a club that could
// afford a player kept him: no rival offer to beat, no chance of paying the
// asking price and losing him anyway. The cap was the only thing that ever took
// a player away. `RESIGN_PREMIUM` prices the exclusive window, so declining a
// man and taking your chances in free agency became a real alternative.
//
// This measures whether that alternative is ever taken and what it costs. Three
// numbers matter and they pull against each other:
//
//   declined        share of expiring men their own club let reach the market.
//                   At zero the premium is decoration; at one the keeper round
//                   has stopped existing.
//   lost            share of THOSE the old club did not get back. At zero the
//                   gamble is free and everyone should take it; near one it is
//                   no gamble, it is a release.
//   continuity      share of a club's 27 slots held by a man who was there last
//                   season. This is the one that decides whether a dynasty can
//                   exist at all, and it is the reason the other two cannot
//                   simply be tuned for drama.
//
// Usage: node scripts/resign-sim.mjs [seasons] [leagues]
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { enterOffseason } from '../src/engine/offseason.js';
import { marketSalary } from '../src/engine/cap.js';
import { primeAge } from '../src/engine/careers.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { overall } from '../src/engine/ratings.js';
import { RESIGN_PREMIUM, TAG_PREMIUM, tagCost, tagged } from '../src/engine/offseason.js';

registerPlayers(PLAYERS_BY_ID);
const SEASONS = Number(process.argv[2] || 8);
const LEAGUES = Number(process.argv[3] || 3);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const roster = (t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean);
const mean = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0);

console.log(`RESIGN_PREMIUM = ${RESIGN_PREMIUM}, TAG_PREMIUM = ${TAG_PREMIUM} · ${LEAGUES} leagues x ${SEASONS} seasons, 32 clubs`);

const declinedShare = [], lostShare = [], continuity = [], lostOvr = [], keptOvr = [];
// Bucketed by quality, because the decision only ever bites for a good player:
// [declined, lostToRival, wentUnsigned] per band.
const BANDS = [[90, 'star 90+'], [85, 'good 85-89'], [0, 'rest <85']];
const band = (o) => BANDS.find(([lo]) => o >= lo)[1];
const tally = {};
const tagAges = [], tagOvr = [], tagOverpay = [], tagPast = [], tagMarket = [], tagRate = [], tagPaid = [];
let tagsUsed = 0, clubOffseasons = 0;
for (const [, name] of BANDS) tally[name] = { declined: 0, rival: 0, unsigned: 0, kept: 0 };
let expiringTotal = 0, declinedTotal = 0, lostTotal = 0, unsignedTotal = 0;

for (let L = 0; L < LEAGUES; L++) {
  const seed = 4000 + L * 37;
  const lg = createLeague({ name: 'R', mode: 'pro', numTeams: 32, franchise: 12, seed, draftType: 'snake', user: {}, injuries: 'normal' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);

  for (let yr = 1; yr <= SEASONS; yr++) {
    // Stop at the offseason, NOT at the next season. `startOffseason` has run
    // by then, so contracts carry `expiring` and `offseason.keepers` holds what
    // each club chose — which is the decision being measured. Running straight
    // through to the next season hides it, and the first version of this script
    // did exactly that: it inferred "declined" from the player not being on the
    // club afterwards, which made "declined but not got back" 100% by
    // construction rather than by measurement.
    simulateAhead(lg, index(lg), pool(lg), new RNG(seed * 7 + yr), 'offseason');
    // That target stops at `complete` — the season is over, the offseason has
    // not opened. `simulateAhead` opens it itself on the way to `nextSeason`,
    // with the pool it was handed and before rebuilding it; same order here so
    // the two paths cannot diverge.
    if (lg.phase === 'complete') enterOffseason(lg, pool(lg), index(lg));
    if (lg.phase !== 'offseason' || !lg.offseason) break;

    const byIdBefore = index(lg);
    const before = lg.teams.map((t) => roster(t));
    const wasOn = new Map();
    before.forEach((ids, i) => ids.forEach((id) => wasOn.set(id, i)));

    // Who is actually up, and who his club chose to let reach the market.
    const upNow = [];
    before.forEach((ids, i) => {
      const keeping = new Set(lg.offseason.keepers?.[i] || []);
      for (const id of ids) {
        if (!lg.contracts[id]?.expiring) continue;
        upNow.push({ id, team: i, declined: !keeping.has(id) });
      }
    });

    // Who got tagged, and what the club paid over simply re-signing him.
    const tags = { ...tagged(lg) };
    clubOffseasons += lg.teams.length;
    for (const id of Object.keys(tags)) {
      const p = byIdBefore.get(id);
      if (!p) continue;
      tagsUsed++;
      const plain = Math.ceil(marketSalary(p) * RESIGN_PREMIUM);
      tagOverpay.push(tagCost(lg, p) - plain);
      tagMarket.push(marketSalary(p));
      tagRate.push(lg.offseason?.rates?.[p.pos] ?? 0);
      tagPaid.push(tagCost(lg, p));
      if (p.age != null) { tagAges.push(p.age); tagPast.push(p.age - primeAge(p.pos)); }
      tagOvr.push(overall(p));
    }

    simulateAhead(lg, index(lg), pool(lg), new RNG(seed * 13 + yr), 'nextSeason');

    const after = lg.teams.map((t) => roster(t));
    const nowOn = new Map();
    after.forEach((ids, i) => ids.forEach((id) => nowOn.set(id, i)));
    const retired = new Set(lg.retired || []);

    let declined = 0, lost = 0, unsigned = 0, live = 0;
    for (const { id, team, declined: d } of upNow) {
      // A man who retired was never on the market, so he belongs in no rate.
      if (retired.has(id)) continue;
      live++;
      const p = byIdBefore.get(id);
      const b = p ? band(overall(p)) : null;
      if (!d) { if (p) { keptOvr.push(overall(p)); tally[b].kept++; } continue; }
      declined++;
      if (b) tally[b].declined++;
      const to = nowOn.get(id);
      if (to === team) continue;
      lost++;
      if (to === undefined) { unsigned++; if (b) tally[b].unsigned++; } else if (b) tally[b].rival++;
      if (p) lostOvr.push(overall(p));
    }
    expiringTotal += live; declinedTotal += declined; lostTotal += lost; unsignedTotal += unsigned;
    if (live) declinedShare.push(declined / live);
    if (declined) lostShare.push(lost / declined);

    const held = after.map((ids, i) => ids.filter((id) => wasOn.get(id) === i).length / ROSTER_SLOTS.length);
    continuity.push(mean(held));
  }
}

console.log(`\nexpiring deals that reached a decision: ${expiringTotal}`);
console.log(`  declined to the market: ${(100 * declinedTotal / Math.max(1, expiringTotal)).toFixed(1)}% (${declinedTotal})`);
console.log(`  of those, NOT got back:  ${(100 * lostTotal / Math.max(1, declinedTotal)).toFixed(1)}% (${lostTotal}, of which ${unsignedTotal} went unsigned)`);
console.log(`  so a club keeps ${(100 * (expiringTotal - lostTotal) / Math.max(1, expiringTotal)).toFixed(1)}% of the men whose deals came up`);
console.log(`  roster continuity season to season: ${(100 * mean(continuity)).toFixed(1)}% of 27 slots`);
console.log(`  a man re-signed averages ${mean(keptOvr).toFixed(1)} overall; one lost ${mean(lostOvr).toFixed(1)}`);

console.log('\nBy quality — does declining a good player actually cost you him?');
console.log('  band          re-signed  declined   to a rival   unsigned');
for (const [, name] of BANDS) {
  const t = tally[name];
  const pc = (n) => `${(100 * n / Math.max(1, t.declined)).toFixed(0)}%`;
  console.log(`  ${name.padEnd(12)} ${String(t.kept).padStart(8)}  ${String(t.declined).padStart(8)}   ${pc(t.rival).padStart(9)}   ${pc(t.unsigned).padStart(8)}`);
}

console.log('\nThe franchise tag');
if (!tagsUsed) console.log('  never used — check careers are on and men are reaching their thirties');
else console.log(`  used ${tagsUsed} times in ${clubOffseasons} club-offseasons (${(100 * tagsUsed / clubOffseasons).toFixed(0)}% of clubs, cap is one each)
  the tagged man averages ${mean(tagOvr).toFixed(1)} overall, age ${mean(tagAges).toFixed(1)}, ${mean(tagPast).toFixed(1)} years past his position's peak
  and costs $${mean(tagOverpay).toFixed(1)} more than simply re-signing him would
  market $${mean(tagMarket).toFixed(1)} · position rate $${mean(tagRate).toFixed(1)} · tag paid $${mean(tagPaid).toFixed(1)} (the rate binds ${(100 * tagRate.filter((r, i) => r > Math.ceil(tagMarket[i] * TAG_PREMIUM)).length / Math.max(1, tagRate.length)).toFixed(0)}% of the time)`);
