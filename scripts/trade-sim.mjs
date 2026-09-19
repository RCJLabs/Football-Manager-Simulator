// What uneven trades actually do to a league.
//
// Every number this prints is cited in DESIGN.md under "Uneven trades". Run it
// after touching backfillPlan, LEVERAGE_PREMIUM, aiGreed or TRUE_LEVERAGE:
// the feature rests on free agency being deep and leverage being expensive,
// and both of those are measurements, not assumptions.
//
//   node scripts/trade-sim.mjs            all four sections
//   node scripts/trade-sim.mjs depth      just one

import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { overall, TRUE_LEVERAGE } from '../src/engine/ratings.js';
import {
  freeAgents, lineupStrength, proposeTrade, advanceWeekWithMoves, rostersValid, liveOffers,
} from '../src/engine/transactions.js';
import { openBlock, teamNeeds, bestAvailable, partingCost } from '../src/engine/tradeblock.js';

registerPlayers(byId);
const only = process.argv[2] || '';
const want = (name) => !only || only === name;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function league(seed, n = 12) {
  const lg = createLeague({ name: 'S', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'auction' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  return lg;
}
const at = (team, pos) => ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => team.slots[s.id]).filter(Boolean);

// ---------------------------------------------------------------------------
// 1. How deep is free agency, and does the wire drain it?
// ---------------------------------------------------------------------------
if (want('depth')) {
  console.log('\n== Free-agent depth ==');
  console.log('The gap is the median starter minus the best free agent, so a small');
  console.log('number means the hole an uneven trade leaves is cheap to plug.\n');
  const lg = league(7);
  const rng = new RNG(99);
  const snap = (label) => {
    const fa = freeAgents(lg, PLAYERS);
    const faBy = {}, rost = {};
    for (const p of fa) (faBy[p.pos] ??= []).push(overall(p));
    for (const t of lg.teams) for (const s of ROSTER_SLOTS) { const p = byId.get(t.slots[s.id]); if (p) (rost[p.pos] ??= []).push(overall(p)); }
    const row = Object.keys(TRUE_LEVERAGE).map((pos) => {
      const f = (faBy[pos] || []).sort((a, b) => b - a), r = (rost[pos] || []).sort((a, b) => b - a);
      if (!f.length || !r.length) return `${pos}:-`;
      return `${pos}:${r[Math.floor(r.length / 2)] - f[0]}`;
    }).join(' ');
    console.log(`  ${label.padEnd(8)} ${String(fa.length).padStart(4)} free agents   ${row}`);
  };
  snap('week 1');
  for (let w = 0; w < 9 && lg.phase === 'season'; w++) {
    simulateWeekAi(lg, byId, { includeUser: true });
    advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
    if ([3, 6, 9].includes(lg.week)) snap(`week ${lg.week}`);
  }
  console.log('\n  What a hole costs in lineup points is that gap times leverage:');
  const fresh = league(7);
  const best = bestAvailable(fresh, PLAYERS);
  const t = fresh.teams[1];
  console.log('  ' + Object.keys(TRUE_LEVERAGE).map((pos) => {
    const id = at(t, pos)[0];
    return id ? `${pos} ${partingCost(t, id, byId, best, fresh)}` : '';
  }).filter(Boolean).join('  '));
}

// ---------------------------------------------------------------------------
// 2. The lowball probe: can a user strip-mine the league?
// ---------------------------------------------------------------------------
if (want('lowball')) {
  console.log('\n== Lowball probe ==');
  console.log('The user ships whatever it can replace most cheaply for the best thing');
  console.log('on any block. A high acceptance rate here would be an exploit.\n');
  let tried = 0, accepted = 0, gained = 0, leagues = 0;
  for (let s = 11; s <= 26; s++) {
    const lg = league(s); leagues++;
    const u = userTeamIndex(lg), me = lg.teams[u];
    const best = bestAvailable(lg, PLAYERS);
    const mine = ROSTER_SLOTS.map((x) => me.slots[x.id]).filter(Boolean)
      .map((id) => ({ id, pos: byId.get(id).pos, cost: partingCost(me, id, byId, best, lg) }))
      .sort((a, b) => a.cost - b.cost);
    const before = lineupStrength(me.slots, byId, lg);
    for (const target of openBlock(lg, byId, PLAYERS).slice(0, 25)) {
      for (const give of mine.slice(0, 4)) {
        if (byId.get(give.id).pos === target.pos) continue;
        tried++;
        if (proposeTrade(lg, u, target.team, [give.id], [target.id], byId, PLAYERS).accepted) {
          accepted++;
          gained += lineupStrength(lg.teams[u].slots, byId, lg) - before;
          break;
        }
      }
    }
  }
  console.log(`  ${tried} proposals, ${accepted} accepted (${(accepted / tried * 100).toFixed(1)}%)`);
  console.log(`  total lineup strength gained across ${leagues} leagues: ${gained.toFixed(0)} (${(gained / leagues).toFixed(1)} each)`);
  console.log('  A greed threshold is 4 to 8 points, so per-league gain under that is the pass mark.');
}

// ---------------------------------------------------------------------------
// 3. The honest use: can a user fill its biggest need?
// ---------------------------------------------------------------------------
if (want('need')) {
  console.log('\n== Filling a real need ==');
  console.log('The user goes after its single thinnest position and pays what it takes.\n');
  let filled = 0, leagues = 0, evenFilled = 0;
  const nets = [], sizes = [];
  for (let s = 41; s <= 80; s++) {
    const lg = league(s); leagues++;
    const u = userTeamIndex(lg), me = lg.teams[u];
    const need = teamNeeds(lg, byId)[u][0];
    if (!need) continue;
    const block = openBlock(lg, byId, PLAYERS).filter((b) => b.pos === need.pos);
    if (!block.length) continue;
    const before = lineupStrength(me.slots, byId, lg);
    const best = bestAvailable(lg, PLAYERS);
    const mine = ROSTER_SLOTS.map((x) => me.slots[x.id]).filter(Boolean)
      .map((id) => ({ id, pos: byId.get(id).pos, cost: partingCost(me, id, byId, best, lg) }))
      .sort((a, b) => a.cost - b.cost);
    let done = null;
    outer:
    for (const target of block.slice(0, 6)) {
      for (const g1 of mine) {
        if (g1.pos === need.pos) continue;
        for (const g2 of [null, ...mine.filter((m) => m.id !== g1.id && m.pos !== need.pos).slice(0, 8)]) {
          const gives = g2 ? [g1.id, g2.id] : [g1.id];
          const r = proposeTrade(lg, u, target.team, gives, [target.id], byId, PLAYERS);
          if (r.accepted) { done = { gives, uneven: !!(r.fills?.a.signs.length || r.fills?.a.releases.length) }; break outer; }
        }
      }
    }
    if (!done) continue;
    filled++;
    if (!done.uneven) evenFilled++;
    nets.push(lineupStrength(lg.teams[u].slots, byId, lg) - before);
    sizes.push(done.gives.length);
  }
  console.log(`  filled ${filled} of ${leagues} leagues (${(filled / leagues * 100).toFixed(0)}%)`);
  console.log(`  of those, ${evenFilled} position-matched and ${filled - evenFilled} uneven`);
  console.log(`  mean players given ${mean(sizes).toFixed(2)}; mean lineup change ${mean(nets).toFixed(1)} (${Math.min(...nets).toFixed(1)} to ${Math.max(...nets).toFixed(1)})`);
  console.log('  The spread is why the screen quotes your own change before you propose.');
}

// ---------------------------------------------------------------------------
// 4. What a whole season looks like, and whether anything breaks.
// ---------------------------------------------------------------------------
if (want('season')) {
  console.log('\n== A season of it ==\n');
  let even = 0, uneven = 0, offers = 0, unevenOffers = 0, seasons = 0, broke = 0;
  for (let s = 201; s <= 212; s++) {
    const lg = league(s);
    const rng = new RNG(s * 7);
    while (lg.phase === 'season') {
      simulateWeekAi(lg, byId, { includeUser: true });
      advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
      for (const o of liveOffers(lg)) { offers++; if (o.uneven) unevenOffers++; }
      const v = rostersValid(lg, byId);
      if (!v.ok) { console.log(`  BROKEN: ${v.reason}`); broke++; break; }
    }
    seasons++;
    for (const t of lg.transactions) if (t.type === 'trade') (t.signs ? uneven++ : even++);
  }
  const deals = even + uneven;
  console.log(`  ${seasons} seasons, 12 clubs`);
  console.log(`  AI trades: ${(deals / seasons).toFixed(1)} a season, ${deals ? (uneven / deals * 100).toFixed(0) : 0}% of them uneven`);
  console.log(`  offers to the human: ${(offers / seasons).toFixed(1)} a season, ${offers ? (unevenOffers / offers * 100).toFixed(0) : 0}% uneven`);
  console.log(broke ? `  ${broke} seasons left a roster invalid` : '  every roster stayed legal all season');
}

console.log('');
