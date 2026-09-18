// Draft full leagues from the real player pool and simulate seasons to check
// parity and realism with actual rosters. Usage: node scripts/league-sim.mjs [leagues] [teams]
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, standings, powerRankings } from '../src/engine/season.js';
import { autoDraftAll, RNG } from '../src/engine/draft.js';
import { overall } from '../src/engine/ratings.js';

const L = Number(process.argv[2] || 5);
const N = Number(process.argv[3] || 8);
const agg = { pts: 0, games: 0, blowouts: 0, ties: 0, ot: 0, maxPts: 0, hi: [], powerSpread: [], winsByPowerRank: {} };
const posTaken = {};
for (let i = 0; i < L; i++) {
  const league = createLeague({ name: 'sim', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: N, seed: 500 + i });
  const rng = new RNG(league.rngState);
  autoDraftAll(league, league.draft, PLAYERS, rng);
  league.rngState = rng.state;
  if (i === 0) {
    // Show first two rounds and the user's roster.
    console.log('First 16 picks:', league.draft.picks.slice(0, 16).map((p) => { const pl = PLAYERS_BY_ID.get(p.playerId); return `${pl.pos} ${pl.name} ${pl.season} (${overall(pl)})`; }).join(' | '));
    const me = league.teams[0];
    console.log('Team 0 roster:', Object.entries(me.slots).map(([s, id]) => { const pl = PLAYERS_BY_ID.get(id); return `${s}:${pl.name.split(' ').pop()}${overall(pl)}`; }).join(' '));
    const last = league.draft.picks.slice(-8).map((p) => { const pl = PLAYERS_BY_ID.get(p.playerId); return `${pl.pos} ${pl.name} (${overall(pl)})`; });
    console.log('Last 8 picks:', last.join(' | '));
  }
  for (const p of league.draft.picks.slice(0, N * 3)) posTaken[PLAYERS_BY_ID.get(p.playerId).pos] = (posTaken[PLAYERS_BY_ID.get(p.playerId).pos] || 0) + 1;
  startSeason(league);
  const power = powerRankings(league, PLAYERS_BY_ID);
  agg.powerSpread.push(power[0].power - power[power.length - 1].power);
  let guard = 0;
  while (league.phase !== 'complete' && guard++ < 60) { simulateWeekAi(league, PLAYERS_BY_ID, { includeUser: true }); advanceWeek(league); }
  for (const r of league.results.filter((r) => r.phase === 'season')) {
    agg.games++;
    agg.pts += r.score[0] + r.score[1];
    agg.maxPts = Math.max(agg.maxPts, r.score[0], r.score[1]);
    if (Math.abs(r.score[0] - r.score[1]) >= 21) agg.blowouts++;
    if (r.score[0] === r.score[1]) agg.ties++;
  }
  const rows = standings(league);
  const rankOf = (idx) => power.findIndex((p) => p.idx === idx) + 1;
  for (const r of rows) (agg.winsByPowerRank[rankOf(r.idx)] ??= []).push(r.w);
  console.log(`League ${i}: champ ${league.teams[league.champion].name} (power #${rankOf(league.champion)}) · records ${rows.map((r) => `${r.team.abbr} ${r.w}-${r.l}${r.t ? '-' + r.t : ''} [${power.find((p) => p.idx === r.idx).power}]`).join(', ')}`);
}
console.log(`\n${agg.games} regular-season games: ${(agg.pts / agg.games / 2).toFixed(1)} pts/team, ${(agg.blowouts / agg.games * 100).toFixed(1)}% decided by 21+, ${agg.ties} ties, max ${agg.maxPts}`);
console.log('avg power spread (best - worst):', (agg.powerSpread.reduce((a, b) => a + b, 0) / agg.powerSpread.length).toFixed(1));
console.log('avg wins by power rank:', Object.entries(agg.winsByPowerRank).map(([k, v]) => `#${k}: ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}`).join('  '));
console.log('positions taken in first 3 rounds:', posTaken);
