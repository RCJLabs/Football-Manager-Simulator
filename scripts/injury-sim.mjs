// Measures the injury layer: injuries per game at each dial setting, how many
// player-weeks a club loses over a season, how often the starting quarterback
// is missing, and what a missing quarterback costs in win probability. Then the
// same dial in the pro league, where the season is longer and the bench thinner.
// Usage: node scripts/injury-sim.mjs   (PRO_SEASONS=12 for a tighter pro sample)
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { buildLineup } from '../src/engine/ratings.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, teamForGame, userTeamIndex } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { advanceWeekWithMoves } from '../src/engine/transactions.js';
import { INJURY_LEVELS, SEASON_ENDING } from '../src/engine/injuries.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { overall } from '../src/engine/ratings.js';
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

// --- the same dial in the pro league ----------------------------------------
//
// DESIGN.md carried this as speculation for a long time: seventeen games and a
// thinner quarterback pool "make backups much weaker; the same setting will
// bite harder there, and nothing yet re-measures it". Two effects pull in
// different directions and only one of them turns out to be real.
//
// Exposure is real but modest: a pro club plays 17 games to a fantasy club's
// 14. The RATE cannot differ — injury risk is `BASE_PER_PLAY` per snap, so a
// game is a game in either mode, and anything measured per club-week is blind
// to season length by construction. Per club-SEASON is the figure that moves,
// which is why both are printed here.
//
// Replacement quality is the effect that matters: 32 clubs roster 64 of the
// pool's 128 quarterbacks where 8 clubs roster 16, so a pro club's QB2 is
// drawn from much further down. That is measured below over every club rather
// than one, because a single club's QB1/QB2 pair is one draw from a wide
// distribution and the first attempt at this read it as a finding.
const PRO_SEASONS = Number(process.env.PRO_SEASONS || 6);
console.log(`\nPer club-season, so season length counts (${PRO_SEASONS} pro seasons, 10 fantasy):`);
for (const mode of ['fantasy', 'pro']) {
  const seasons = mode === 'pro' ? PRO_SEASONS : 10;
  for (const setting of ['low', 'normal', 'high']) {
    let starterWeeks = 0, qbWeeks = 0, seasonEnders = 0, clubSeasons = 0, clubGames = 0;
    for (let seed = 1; seed <= seasons; seed++) {
      const league = mode === 'pro'
        ? createLeague({ name: 'I', mode: 'pro', numTeams: 32, franchise: 12, seed, draftType: 'snake', user: {}, injuries: setting })
        : createLeague({ name: 'I', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: setting });
      if (mode === 'pro') autoDraftAll(league, league.draft, PLAYERS, new RNG(seed));
      else autoCompleteAll(league.auction, league, PLAYERS, new RNG(seed), byId);
      startSeason(league, byId);
      clubSeasons += league.teams.length;
      const rng = new RNG(seed * 3);
      while (league.phase === 'season') {
        for (let t = 0; t < league.teams.length; t++) {
          const team = league.teams[t];
          for (const [id, inj] of Object.entries(league.injuries)) {
            if (inj.team !== t) continue;
            const slot = Object.entries(team.slots).find(([, pid]) => pid === id);
            if (!slot) continue;
            starterWeeks++;
            if (slot[0] === 'QB1') qbWeeks++;
          }
        }
        simulateWeekAi(league, byId, { includeUser: true });
        for (const g of league.schedule[league.week - 1].games) {
          clubGames += 2;
          for (const side of [0, 1]) for (const x of g.result.injuries[side]) if (x.weeks >= SEASON_ENDING) seasonEnders++;
        }
        advanceWeekWithMoves(league, byId, PLAYERS, rng, advanceWeek);
      }
    }
    const n = clubSeasons;
    console.log(`  ${mode.padEnd(8)} ${setting.padEnd(6)} ${(clubGames / n).toFixed(1)} games a club · ${(starterWeeks / n).toFixed(1)} starter-weeks lost · QB1 misses ${(qbWeeks / n).toFixed(2)} · ${(seasonEnders / n).toFixed(2)} season-enders`);
  }
}

// How much worse the man behind him is, over every club in eight leagues.
console.log('\nQB1 minus QB2 in overall, every club, 8 leagues each:');
for (const mode of ['fantasy', 'pro']) {
  const gaps = [], ones = [], twos = [];
  for (let seed = 1; seed <= 8; seed++) {
    const lg = mode === 'pro'
      ? createLeague({ name: 'I', mode: 'pro', numTeams: 32, franchise: 12, seed, draftType: 'snake', user: {}, injuries: 'normal' })
      : createLeague({ name: 'I', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'normal' });
    if (mode === 'pro') autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
    else autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
    startSeason(lg, byId);
    for (const t of lg.teams) {
      const a = byId.get(t.slots.QB1), b = byId.get(t.slots.QB2);
      if (!a || !b) continue;
      ones.push(overall(a)); twos.push(overall(b)); gaps.push(overall(a) - overall(b));
    }
  }
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const sd = (x) => { const m = mean(x); return Math.sqrt(mean(x.map((v) => (v - m) ** 2))); };
  console.log(`  ${mode.padEnd(8)} n=${gaps.length} · QB1 ${mean(ones).toFixed(1)} · QB2 ${mean(twos).toFixed(1)} · ${mode} backup gap ${mean(gaps).toFixed(1)} (sd ${sd(gaps).toFixed(1)})`);
}
