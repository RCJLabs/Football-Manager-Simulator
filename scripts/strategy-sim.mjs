// Does how you bid change how much you win? Runs the same leagues with the
// human team following different auction strategies and reports the results.
// If these all finish level, the auction has no skill in it.
// Usage: node scripts/strategy-sim.mjs [leagues]
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, standings } from '../src/engine/season.js';
import { RNG } from '../src/engine/draft.js';
import { autoCompleteAll, priceGuide, maxAffordable, canRoster, slotsLeft, openSlotsByPos, currentNominator, aiNominate, settle, nominatable, nominate } from '../src/engine/auction.js';
import { overall } from '../src/engine/ratings.js';

const L = Number(process.argv[2] || 16);

// Each strategy returns the human team's maximum bid for the player on the block.
const STRATEGIES = {
  'market follower': (ctx) => ctx.asking,
  'value shopper': (ctx) => Math.round(ctx.worth * 1.15),
  'stars and scrubs': (ctx) => (overall(ctx.player) >= 93 ? Math.round(ctx.asking * 2.4) : 1),
  'spread it evenly': (ctx) => Math.min(ctx.asking, Math.round(ctx.budget / Math.max(1, ctx.left) * 1.25)),
  'trenches first': (ctx) => (['OL', 'DL'].includes(ctx.player.pos) ? Math.round(ctx.worth * 1.7) : Math.round(ctx.asking * 0.65)),
  'skill players': (ctx) => (['QB', 'RB', 'WR', 'TE'].includes(ctx.player.pos) ? Math.round(ctx.asking * 1.5) : Math.round(ctx.worth * 0.6)),
};

function runLeague(seed, strategy) {
  const league = createLeague({ name: 'x', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction' });
  const rng = new RNG(league.rngState);
  const a = league.auction;
  const u = league.teams.findIndex((t) => t.isUser);
  let guard = 0;
  while (!a.complete && guard++ < 2000) {
    if (!a.current) {
      if (currentNominator(a, league) == null) break;
      if (currentNominator(a, league) === u) {
        // Nominate the best player the strategy would want at a needed position.
        const guide = priceGuide(a, league, PLAYERS);
        const cands = nominatable(a, league, PLAYERS, u);
        if (!cands.length) break;
        const best = cands.map((p) => ({ p, s: strategy({ player: p, asking: guide.prices.get(p.id), worth: guide.worth.get(p.id), budget: a.budgets[u], left: slotsLeft(league.teams[u]) }) }))
          .sort((x, y) => y.s - x.s)[0];
        nominate(a, league, PLAYERS, best.p.id, PLAYERS_BY_ID);
      } else {
        aiNominate(a, league, PLAYERS, rng, PLAYERS_BY_ID);
      }
    }
    const player = PLAYERS_BY_ID.get(a.current.playerId);
    const team = league.teams[u];
    let bid = 0;
    if (canRoster(team, player.pos)) {
      const guide = priceGuide(a, league, PLAYERS);
      bid = strategy({ player, asking: guide.prices.get(player.id), worth: guide.worth.get(player.id), budget: a.budgets[u], left: slotsLeft(team) });
      bid = Math.max(0, Math.min(Math.round(bid), maxAffordable(a, u, league)));
    }
    settle(a, league, PLAYERS, rng, PLAYERS_BY_ID, bid);
  }
  autoCompleteAll(a, league, PLAYERS, rng, PLAYERS_BY_ID);
  league.rngState = rng.state;
  startSeason(league);
  let g = 0;
  while (league.phase !== 'complete' && g++ < 60) { simulateWeekAi(league, PLAYERS_BY_ID, { includeUser: true }); advanceWeek(league); }
  const me = league.teams[u];
  const rank = standings(league).findIndex((r) => r.idx === u) + 1;
  return { w: me.record.w, l: me.record.l, diff: me.record.pf - me.record.pa, rank, champ: league.champion === u ? 1 : 0 };
}

console.log(`Human team following each strategy, ${L} leagues of 14 games each\n`);
const out = [];
for (const [name, fn] of Object.entries(STRATEGIES)) {
  const res = [];
  for (let i = 0; i < L; i++) res.push(runLeague(6000 + i, fn));
  const avg = (k) => res.reduce((s, r) => s + r[k], 0) / res.length;
  out.push({ name, w: avg('w'), diff: avg('diff'), rank: avg('rank'), titles: res.reduce((s, r) => s + r.champ, 0) });
}
out.sort((a, b) => b.w - a.w);
console.log('strategy'.padEnd(18), 'wins', ' pt diff', ' finish', ' titles');
for (const r of out) console.log(r.name.padEnd(18), r.w.toFixed(1).padStart(4), String(Math.round(r.diff)).padStart(7), r.rank.toFixed(1).padStart(7), String(r.titles).padStart(6), `of ${L}`);
