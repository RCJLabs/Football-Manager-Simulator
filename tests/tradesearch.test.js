// The AI's trade search asks the same questions hundreds of times a week, and
// `tradeSearch` answers them once. It has to answer exactly as asking afresh
// does, for every deal a club weighs, and it is only good until a roster
// changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { overall } from '../src/engine/ratings.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { tradeSearch, validateTrade, slotsAfterTrade, backfillPlan, executeTrade, ownerMap } from '../src/engine/transactions.js';
import { signablePool } from '../src/engine/proleague.js';
import { simulateAhead } from '../src/engine/autosim.js';

registerPlayers(PLAYERS_BY_ID);

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'];

function proLeague(seed) {
  const lg = createLeague({ name: 'T', mode: 'pro', franchise: 3, seed, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID, PLAYERS);
  return lg;
}

/** The candidates a club weighs, as `makeAiOffers` builds them: surplus at P for need at Q, both shapes. */
function candidates(league, a, b, byId) {
  const group = (team, pos) => ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => ({ slot: s, id: team.slots[s.id], p: byId.get(team.slots[s.id]) })).filter((x) => x.p);
  const bestBench = (team, pos) => group(team, pos).filter((x) => !x.slot.starter).sort((x, y) => overall(y.p) - overall(x.p))[0] || null;
  const worstStarter = (team, pos) => group(team, pos).filter((x) => x.slot.starter).sort((x, y) => overall(x.p) - overall(y.p))[0] || null;
  const A = league.teams[a], B = league.teams[b];
  const out = [];
  for (const P of POSITIONS) for (const Q of POSITIONS) {
    if (P === Q) continue;
    const aP = bestBench(A, P) || worstStarter(A, P), aQ = worstStarter(A, Q);
    const bP = worstStarter(B, P), bQ = bestBench(B, Q) || worstStarter(B, Q);
    if (!aP || !aQ || !bP || !bQ) continue;
    out.push([[aP.id, aQ.id], [bP.id, bQ.id]], [[aP.id], [bQ.id]]);
  }
  return out;
}

test('a search answers every deal a club weighs exactly as asking afresh does', () => {
  // A second season, so the pool holds a rookie class and men the drain has
  // shown out, which the search has to leave out as the plain path does.
  const lg = proLeague(31);
  simulateAhead(lg, careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID)), applyCareers(lg, leaguePool(lg, PLAYERS)), new RNG(5), 'nextSeason');
  assert.equal(lg.season, 2);
  // And at each position the best man available retired and the next shown
  // out by the drain, so leaving both out is something the search has to get
  // right rather than assume: nobody has gone either way by a league's first
  // offseason, and the men the pro pool already leaves out — the undrafted
  // half of this year's class — are too poor for any deal to reach.
  const owned = ownerMap(lg);
  const market = signablePool(lg, applyCareers(lg, leaguePool(lg, PLAYERS)));
  const top = POSITIONS.map((pos) => market.filter((p) => p.pos === pos && !owned.has(p.id)).sort((x, y) => overall(y) - overall(x)).slice(0, 2).map((p) => p.id));
  lg.retired = (lg.retired || []).concat(top.map((t) => t[0]));
  lg.departed = (lg.departed || []).concat(top.map((t) => t[1]));
  const byId = careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
  const pool = applyCareers(lg, leaguePool(lg, PLAYERS));
  assert.equal(pool.filter((p) => p.retired).length, POSITIONS.length);
  const u = lg.teams.findIndex((t) => t.isUser);
  // One search across every club and candidate, as a week's offers use it.
  const search = tradeSearch(lg, pool);
  let asked = 0, uneven = 0, squared = 0;
  for (let a = 0; a < lg.teams.length; a++) {
    if (a === u) continue;
    for (const [gives, wants] of candidates(lg, a, u, byId)) {
      asked++;
      const fresh = validateTrade(lg, a, u, gives, wants, byId, pool);
      const held = validateTrade(lg, a, u, gives, wants, byId, pool, { search });
      assert.deepEqual(held, fresh, `${gives} for ${wants}`);
      if (!fresh.uneven) continue;
      uneven++;
      for (const [idx, out, back] of [[a, gives, wants], [u, wants, gives]]) {
        const f = slotsAfterTrade(lg, idx, out, back, pool, byId);
        assert.deepEqual(slotsAfterTrade(lg, idx, out, back, pool, byId, search), f);
        // Asked again, the remembered answer is still the right one.
        assert.deepEqual(slotsAfterTrade(lg, idx, out, back, pool, byId, search), f);
        if (f) squared++;
      }
    }
  }
  // Enough of the cached path to mean something.
  assert.ok(asked > 3000, `${asked} candidates`);
  assert.ok(uneven > 500, `${uneven} uneven deals passed`);
  assert.ok(squared > 500, `${squared} rosters squared`);
});

test('a search is only good until a roster changes', () => {
  const lg = proLeague(32);
  const byId = careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
  const pool = applyCareers(lg, leaguePool(lg, PLAYERS));
  const u = lg.teams.findIndex((t) => t.isUser);
  const a = u === 0 ? 1 : 0, b = u === 2 ? 3 : 2;
  const stale = tradeSearch(lg, pool);
  // An uneven deal that signs a free agent to square one side.
  const deal = candidates(lg, a, b, byId).find(([gives, gets]) => gives.length === 1 && validateTrade(lg, a, b, gives, gets, byId, pool).ok
    && backfillPlan(lg, a, gives, gets, pool, byId).signs.length);
  assert.ok(deal, 'no uneven deal that signs somebody');
  const signed = backfillPlan(lg, a, deal[0], deal[1], pool, byId).signs[0];
  const pos = byId.get(signed).pos;
  assert.ok(stale.available(pos).some((p) => p.id === signed));
  executeTrade(lg, a, b, deal[0], deal[1], byId, pool);
  // The man the deal signed is on a roster now. The old search still offers
  // him, which is why a search that executes a deal starts a new one.
  assert.ok(stale.available(pos).some((p) => p.id === signed), 'the old search noticed on its own');
  assert.ok(!tradeSearch(lg, pool).available(pos).some((p) => p.id === signed), 'a fresh search still offers a signed man');
});
