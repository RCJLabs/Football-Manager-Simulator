// Measures the injury layer: injuries per game at each dial setting, how many
// player-weeks a club loses over a season, how often the starting quarterback
// is missing, and what a missing quarterback costs in win probability.
// Usage: node scripts/injury-sim.mjs
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { buildLineup } from '../src/engine/ratings.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, teamForGame, userTeamIndex } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { advanceWeekWithMoves } from '../src/engine/transactions.js';
import { INJURY_LEVELS, SEASON_ENDING } from '../src/engine/injuries.js';
import { syntheticTeam } from './synthetic.mjs';

const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const A = syntheticTeam('a', 85, 4, 1), B = syntheticTeam('b', 85, 4, 2);

console.log('Per game (both teams), synthetic equal rosters, 300 games each:');
for (const [name, level] of Object.entries(INJURY_LEVELS)) {
  let inj = 0, weeks = 0, multi = 0;
  const n = 300;
  for (let i = 0; i < n; i++) {
    const g = createGame(tf(A), tf(B), { seed: 10000 + i, injuryLevel: level });
    simulateGame(g);
    for (const side of [0, 1]) for (const x of g.teams[side].injuries) { inj++; if (x.weeks > 0) multi++; weeks += Math.min(x.weeks, 17); }
  }
  console.log(`  ${name.padEnd(6)} ${(inj / n).toFixed(2)} injuries, ${(multi / n).toFixed(2)} cost at least a week, ${(weeks / n / 2).toFixed(2)} player-weeks lost per club`);
}

// A season in the 8-team auction league: who is missing, and how often the QB is one of them.
console.log('\n8-team auction league, 10 seasons at each setting (AI clubs work the wire):');
for (const setting of ['low', 'normal', 'high']) {
  let starterWeeks = 0, qbWeeks = 0, teamWeeks = 0, seasonEnders = 0, claims = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const league = createLeague({ name: 'I', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: setting });
    autoCompleteAll(league.auction, league, PLAYERS, new RNG(seed), byId);
    startSeason(league, byId);
    const rng = new RNG(seed * 3);
    while (league.phase === 'season') {
      // Count who sits this week before the games are played.
      for (let t = 0; t < league.teams.length; t++) {
        const team = league.teams[t];
        teamWeeks++;
        for (const [id, inj] of Object.entries(league.injuries)) {
          if (inj.team !== t) continue;
          const slot = Object.entries(team.slots).find(([, pid]) => pid === id);
          if (!slot) continue;
          starterWeeks++;
          if (slot[0] === 'QB1') qbWeeks++;
        }
      }
      simulateWeekAi(league, byId, { includeUser: true });
      for (const g of league.schedule[league.week - 1].games) for (const side of [0, 1]) for (const x of g.result.injuries[side]) if (x.weeks >= SEASON_ENDING) seasonEnders++;
      advanceWeekWithMoves(league, byId, PLAYERS, rng, advanceWeek);
    }
    claims += league.transactions.filter((t) => t.type === 'waiver').length;
  }
  console.log(`  ${setting.padEnd(6)} ${(starterWeeks / teamWeeks).toFixed(2)} rostered players out per club-week, QB1 out ${(100 * qbWeeks / teamWeeks).toFixed(1)}% of club-weeks, ${(seasonEnders / 10).toFixed(1)} season-ending injuries per season, ${(claims / 10).toFixed(1)} AI waiver claims per season`);
}

// What a missing quarterback costs: the same auction roster with QB1 healthy vs. QB2 starting vs. a replacement.
console.log('\nCost of a missing QB1 (one 8-team auction league, user club vs. every opponent, 40 games each, no in-game injuries):');
{
  const league = createLeague({ name: 'I', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 77, draftType: 'auction' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(77), byId);
  startSeason(league, byId);
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const winRate = (mutate) => {
    let w = 0, n = 0;
    for (let o = 0; o < league.teams.length; o++) {
      if (o === u) continue;
      for (let i = 0; i < 40; i++) {
        const mine = teamForGame(league, u, byId);
        mutate(mine.lineup);
        const g = createGame(mine, teamForGame(league, o, byId), { seed: 5000 + o * 100 + i, homeAdvantage: false });
        simulateGame(g);
        n++; if (g.score[0] > g.score[1]) w++; else if (g.score[0] === g.score[1]) w += 0.5;
      }
    }
    return (100 * w / n).toFixed(1);
  };
  const qb1 = byId.get(me.slots.QB1), qb2 = byId.get(me.slots.QB2);
  console.log(`  QB1 ${qb1.name} healthy: ${winRate(() => {})}% · QB2 ${qb2 ? qb2.name : 'none'} starts: ${winRate((l) => { l.QB = l.QB.slice(1); })}% · replacement-level fill-in: ${winRate((l) => { l.QB = []; })}%`);
}
