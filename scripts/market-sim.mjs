// What the two markets look like once the screen prints the decision.
//
// Every number here is cited in DESIGN.md under "What a free agent is worth"
// and "What a keeper is worth". Run it after touching lineupStrength,
// TRUE_LEVERAGE, aiFileClaims or the keeper raise.
//
//   node scripts/market-sim.mjs          both sections
//   node scripts/market-sim.mjs wire     just one

import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { overall } from '../src/engine/ratings.js';
import { aiFileClaims, advanceWeekWithMoves, freeAgents } from '../src/engine/transactions.js';
import { enterOffseason } from '../src/engine/offseason.js';
import { faBoard, keeperBoard } from '../src/engine/market.js';

registerPlayers(byId);
const only = process.argv[2] || '';
const want = (n) => !only || only === n;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const mk = (seed, n = 12) => {
  const lg = createLeague({ name: 'M', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'auction', injuries: 'normal' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  return lg;
};
const user = (lg) => lg.teams.findIndex((t) => t.isUser);

// ---------------------------------------------------------------------------
if (want('wire')) {
  console.log('\n== The waiver wire ==');
  console.log('Does ranking by lineup gain say anything rating order does not?\n');
  const lg0 = mk(3);
  const u0 = user(lg0);
  const b0 = faBoard(lg0, PLAYERS, byId, u0, { limit: 2000 });
  const byRating = freeAgents(lg0, PLAYERS).slice().sort((a, b) => overall(b) - overall(a));
  const topRated = byRating.slice(0, 5).map((p) => {
    const r = b0.players.find((x) => x.id === p.id);
    return `${p.name} (${p.pos} ${overall(p)}, worth ${r ? r.gain : '?'})`;
  });
  console.log('  best five by rating:  ' + topRated.join('; '));
  console.log('  best three by gain:   ' + b0.players.slice(0, 3).map((r) => `${byId.get(r.id).name} (${r.pos} ${r.ovr}, worth ${r.gain})`).join('; '));

  console.log('\n  Over a full season, on the default page of sixty:');
  let weeks = 0, withGain = 0, withRival = 0, rows = 0, contested = 0, ms = 0;
  let filed = 0, matched = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const lg = mk(seed);
    const u = user(lg);
    const rng = new RNG(seed * 3);
    while (lg.phase === 'season') {
      simulateWeekAi(lg, byId, { includeUser: true });
      const t0 = performance.now();
      const b = faBoard(lg, PLAYERS, byId, u, { limit: 60 });
      ms += performance.now() - t0;
      weeks++;
      rows += b.players.length;
      if (b.players.some((r) => r.gain > 0)) withGain++;
      const c = b.players.filter((r) => r.rivals > 0);
      if (c.length) withRival++;
      contested += c.length;
      // How well the rival count predicts the claims those clubs really file.
      const wide = faBoard(lg, PLAYERS, byId, u, { limit: 3000, rivalsFor: 3000 });
      const flagged = new Set(wide.players.filter((r) => r.rivals > 0).map((r) => r.id));
      const before = (lg.claims || []).length;
      aiFileClaims(lg, PLAYERS, byId, null);
      const theirs = (lg.claims || []).slice(before).filter((x) => x.team !== u);
      filed += theirs.length;
      for (const x of theirs) if (flagged.has(x.add)) matched++;
      advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
    }
  }
  console.log(`    ${weeks} weeks; somebody worth claiming in ${withGain} (${(withGain / weeks * 100).toFixed(0)}%)`);
  console.log(`    somebody contested in ${withRival} (${(withRival / weeks * 100).toFixed(0)}%); ${contested} of ${rows} rows carry the badge (${(contested / rows * 100).toFixed(1)}%)`);
  console.log(`    of ${filed} claims AI clubs actually filed, ${matched} were on men it had flagged (${(matched / filed * 100).toFixed(0)}%)`);
  console.log(`    board build: ${(ms / weeks).toFixed(1)} ms`);
}

// ---------------------------------------------------------------------------
if (want('keepers')) {
  console.log('\n== Keepers ==');
  console.log('Keeper price against what the room would pay to buy the man back.\n');
  const surpluses = [], worthKeeping = [], limits = [];
  let boards = 0, ms = 0;
  for (const seed of [21, 22, 23, 24]) {
    const lg = mk(seed);
    const rng = new RNG(seed);
    while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek); }
    while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
    enterOffseason(lg, PLAYERS, byId);
    const u = user(lg);
    const t0 = performance.now();
    const b = keeperBoard(lg, PLAYERS, byId, u);
    ms += performance.now() - t0; boards++;
    limits.push(b.limit);
    for (const r of b.rows) if (r.surplus != null) surpluses.push(r.surplus);
    worthKeeping.push(b.rows.filter((r) => r.eligible && (r.surplus ?? 0) > 0).length);
    if (boards === 1) {
      console.log('  one club\'s board, best value first:');
      console.log('    keep$  mkt$  saving  ovr  pos  player');
      for (const r of b.rows.slice(0, 6)) console.log(`    ${String(r.cost).padStart(5)}  ${String(r.market).padStart(4)}  ${String(r.surplus).padStart(6)}  ${String(r.ovr).padStart(3)}  ${r.pos.padEnd(3)}  ${byId.get(r.id).name}`);
      console.log('    ...');
      for (const r of b.rows.slice(-2)) console.log(`    ${String(r.cost).padStart(5)}  ${String(r.market).padStart(4)}  ${String(r.surplus).padStart(6)}  ${String(r.ovr).padStart(3)}  ${r.pos.padEnd(3)}  ${byId.get(r.id).name}`);
    }
  }
  const good = surpluses.filter((s) => s > 0).length;
  console.log(`\n  ${boards} clubs, ${surpluses.length} men priced`);
  console.log(`  mean saving ${mean(surpluses).toFixed(1)}; ${good} of ${surpluses.length} (${(good / surpluses.length * 100).toFixed(0)}%) cost less than the market would`);
  console.log(`  men actually worth keeping: ${mean(worthKeeping).toFixed(1)} against a limit of ${limits[0]}`);
  console.log('  That gap is the point: the raise is set so that keeping everybody is wrong.');
  console.log(`  board build: ${(ms / boards).toFixed(1)} ms · ${ROSTER_SLOTS.length} slots`);
}

console.log('');
