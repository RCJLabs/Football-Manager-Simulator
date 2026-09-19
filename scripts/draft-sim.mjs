// What trading draft picks actually does, and why the projection is built the
// way it is.
//
// Every number this prints is cited in DESIGN.md under "Trading picks". Run it
// after touching rankForTeam, projectPickTrade or aiGreed — the case for the
// deterministic projection rests on a noise measurement, and the case for the
// one-for-one rule rests on a roster invariant. Both are checkable.
//
//   node scripts/draft-sim.mjs           all four sections
//   node scripts/draft-sim.mjs noise     just one

import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, registerPlayers } from '../src/engine/season.js';
import { overall, TRUE_LEVERAGE } from '../src/engine/ratings.js';
import { currentPicker, makePick, aiChoose, autoDraftAll, runAiPicks, openSlots } from '../src/engine/draft.js';
import {
  remainingPicks, projectPickTrade, evaluatePickTrade, survivalOdds, aiPickTrades, makePickOffers,
} from '../src/engine/draftpicks.js';
import { lineupStrength } from '../src/engine/transactions.js';

registerPlayers(byId);
const only = process.argv[2] || '';
const want = (n) => !only || only === n;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const mk = (seed, n = 12) => createLeague({ name: 'D', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'snake' });
const user = (lg) => lg.teams.findIndex((t) => t.isUser);
function advance(lg, rounds, seed = 3) {
  const rng = new RNG(seed);
  while (lg.draft.round < rounds && !lg.draft.complete) {
    const p = aiChoose(lg, lg.draft, PLAYERS, currentPicker(lg.draft), rng);
    if (!p) break;
    makePick(lg, lg.draft, p);
  }
}

// ---------------------------------------------------------------------------
// 1. Why a pick has no value chart, and why the projection is deterministic.
// ---------------------------------------------------------------------------
if (want('noise')) {
  console.log('\n== Why there is no pick-value chart ==');
  console.log('Mean rating of the man taken at each pick, over 20 drafts. A chart would');
  console.log('need this to fall. It falls, then rises again, because the last rounds are');
  console.log('where kickers and punters go: high ratings, a leverage of 0.79.\n');
  const byPick = new Map();
  for (let s = 1; s <= 20; s++) {
    const lg = mk(s);
    autoDraftAll(lg, lg.draft, PLAYERS, new RNG(s));
    for (const pk of lg.draft.picks) {
      const p = byId.get(pk.playerId);
      if (!p) continue;
      (byPick.get(pk.overall) || byPick.set(pk.overall, []).get(pk.overall)).push(overall(p));
    }
  }
  const line = [1, 12, 36, 72, 120, 180, 240, 288, 312, 324]
    .filter((k) => byPick.has(k))
    .map((k) => `#${k}:${mean(byPick.get(k)).toFixed(1)}`).join('  ');
  console.log('  ' + line);

  console.log('\n== Why the projection has the noise switched off ==');
  console.log('The same swap valued ten times, sampling the draft noise, then deterministically.\n');
  const lg = mk(5);
  const d = lg.draft;
  const u = user(lg), o = u === 0 ? 1 : 0;
  const mine = remainingPicks(d, u), theirs = remainingPicks(d, o);
  const t0 = performance.now();
  const runs = [];
  for (let k = 0; k < 10; k++) runs.push(projectPickTrade(lg, d, PLAYERS, byId, u, o, [mine[0], mine[3]], [theirs[0], theirs[3]]).a);
  console.log(`  deterministic: ${mean(runs).toFixed(1)}, sd ${sd(runs).toFixed(1)}, ${((performance.now() - t0) / 10).toFixed(0)} ms a call`);
  console.log('  (sampled, measured while this was built: at 4 runs sd 64.9 against a mean of');
  console.log('   -64.5, and 16 runs cost 1.4 s to reach sd 43.3. An error bar its own size.)');
}

// ---------------------------------------------------------------------------
// 2. The invariant the one-for-one rule protects.
// ---------------------------------------------------------------------------
if (want('invariant')) {
  console.log('\n== Picks equal open slots, always ==');
  let worst = 0;
  for (const seed of [11, 12, 13]) {
    const lg = mk(seed);
    for (const r of [1, 5, 12]) {
      advance(lg, r, seed);
      for (let i = 0; i < lg.teams.length; i++) {
        worst = Math.max(worst, Math.abs(remainingPicks(lg.draft, i).length - openSlots(lg.teams[i]).length));
      }
    }
  }
  console.log(`  worst gap between a club's remaining picks and its open slots: ${worst}`);
  console.log('  That is why picks go one for one: three for one leaves one club a pick short');
  console.log('  of a full roster and the other holding a pick it can never use.');
}

// ---------------------------------------------------------------------------
// 3. Are pick swaps zero-sum, and can anyone trade up?
// ---------------------------------------------------------------------------
if (want('swaps')) {
  console.log('\n== What a swap is worth ==\n');
  let n = 0, zero = 0, both = 0, sumAbs = 0;
  for (let s = 1; s <= 4; s++) {
    for (const round of [1, 4]) {
      const lg = mk(s);
      advance(lg, round, s);
      const d = lg.draft, u = user(lg);
      const mine = remainingPicks(d, u);
      for (let o = 0; o < lg.teams.length; o++) {
        if (o === u) continue;
        const theirs = remainingPicks(d, o);
        for (const [i, j] of [[0, 0], [0, 1], [1, 0]]) {
          if (!mine[i] || !theirs[j] || mine[i].overall === theirs[j].overall) continue;
          const pr = projectPickTrade(lg, d, PLAYERS, byId, u, o, [mine[i]], [theirs[j]]);
          n++; sumAbs += Math.abs(pr.a + pr.b);
          if (Math.abs(pr.a + pr.b) < 0.05) zero++;
          if (pr.a > 0 && pr.b > 0) both++;
        }
      }
    }
  }
  console.log(`  ${n} one-for-one swaps`);
  console.log(`  exactly zero-sum: ${zero} (${(zero / n * 100).toFixed(0)}%) — mean value created or destroyed ${(sumAbs / n).toFixed(1)}`);
  console.log(`  good for both sides: ${both} (${(both / n * 100).toFixed(1)}%)`);

  console.log('\n  Moving up, one for one against two for two:');
  let one = 0, oneOk = 0, two = 0, twoOk = 0;
  for (let s = 1; s <= 5; s++) {
    const lg = mk(s);
    const d = lg.draft, u = user(lg);
    const mine = remainingPicks(d, u);
    for (let o = 0; o < lg.teams.length; o++) {
      if (o === u) continue;
      const theirs = remainingPicks(d, o);
      if (theirs[0].overall > mine[0].overall) continue;
      one++;
      if (evaluatePickTrade(lg, d, PLAYERS, byId, o, [theirs[0]], [mine[0]], u).accept) oneOk++;
      const late = theirs[6];
      if (!late) continue;
      two++;
      if (evaluatePickTrade(lg, d, PLAYERS, byId, o, [theirs[0], late], [mine[0], mine[1]], u).accept) twoOk++;
    }
  }
  console.log(`    one for one:   ${oneOk} of ${one} accepted (${(oneOk / one * 100).toFixed(0)}%)`);
  console.log(`    two for two:   ${twoOk} of ${two} accepted (${(twoOk / two * 100).toFixed(0)}%)`);
  console.log('    Two for two is how you move up: a near pick plus a later one, for their');
  console.log('    early pick plus one much later.');
}

// ---------------------------------------------------------------------------
// 4. Survival odds, and a whole draft with dealing switched on.
// ---------------------------------------------------------------------------
if (want('season')) {
  console.log('\n== Will he last? ==\n');
  const lg = mk(5);
  advance(lg, 2, 5);
  const u = user(lg);
  const t0 = performance.now();
  const sv = survivalOdds(lg, lg.draft, PLAYERS, u, { trials: 8 });
  const ms = performance.now() - t0;
  const at = [...sv.odds.entries()].map(([id, q]) => ({ p: byId.get(id), q })).filter((x) => x.p)
    .sort((a, b) => overall(b.p) - overall(a.p)).slice(0, 8);
  console.log(`  to the user's next pick, #${sv.untilPick}, over ${sv.trials} runs (${ms.toFixed(0)} ms):`);
  for (const x of at) console.log(`    ${String(Math.round(x.q * 100)).padStart(3)}%  ${x.p.name.padEnd(20)} ${x.p.pos} ${overall(x.p)}`);

  console.log('\n== A whole draft with dealing on ==\n');
  let deals = 0, offers = 0, short = 0, drafts = 0;
  for (const seed of [61, 62, 63]) {
    const l = mk(seed);
    drafts++;
    const rng = new RNG(seed);
    while (!l.draft.complete) {
      if (l.draft.pickInRound === 0 && l.draft.round <= 6) {
        deals += aiPickTrades(l, l.draft, PLAYERS, byId, rng, { pairs: 1 }).length;
        offers += makePickOffers(l, l.draft, PLAYERS, byId, rng, { max: 1 }).length;
      }
      const p = aiChoose(l, l.draft, PLAYERS, currentPicker(l.draft), rng);
      if (!p) break;
      makePick(l, l.draft, p);
    }
    for (const t of l.teams) if (ROSTER_SLOTS.filter((s) => !t.slots[s.id]).length) short++;
  }
  console.log(`  ${drafts} drafts: ${deals} club-to-club pick deals, ${offers} offers to the human`);
  console.log(short ? `  ${short} clubs finished short` : '  every club finished with a full roster');
}

console.log('');
