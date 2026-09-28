// What the home side's edge is worth, in points and in wins.
//
//   node scripts/home-edge.mjs [pairs]
//
// The engine gives the home side 1.1 composite points on blocking, rush,
// coverage and tackling (`HOME_EDGE` in game.js). What that is worth moves
// whenever those composites' weight in the game does, and the win-probability
// prior (`HOME_EDGE_POINTS` in winprob.js) has to follow it: it was fitted at
// 2.2 and stayed there after the line's weight fell to 0.25 and the edge was
// worth about half that, until the kickoff chance was found predicting league
// games worse than a coin. The audit re-runs this.
//
// Each pair plays the same two rosters from the same seed with the edge on
// and off, so the difference is the edge and not the matchup.

import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';

const PAIRS = Number(process.argv[2] || 12000);
const side = (T) => ({ ...T, lineup: buildLineup(T.slots, T.byId) });
const diff = [];
const won = { on: 0, off: 0 };
for (let j = 0; j < PAIRS; j++) {
  const A = side(syntheticTeam(`a${j}`, 80 + (j % 11), 4, 50000 + j * 2));
  const B = side(syntheticTeam(`b${j}`, 80 + ((j * 7) % 11), 4, 50001 + j * 2));
  const margin = {};
  for (const [key, homeAdvantage] of [['on', true], ['off', false]]) {
    const g = createGame(A, B, { seed: 90000 + j, homeAdvantage, penalties: true });
    simulateGame(g);
    margin[key] = g.score[0] - g.score[1];
    won[key] += g.score[0] > g.score[1] ? 1 : g.score[0] === g.score[1] ? 0.5 : 0;
  }
  diff.push(margin.on - margin.off);
}
const mean = diff.reduce((s, x) => s + x, 0) / PAIRS;
const sd = Math.sqrt(diff.reduce((s, x) => s + (x - mean) ** 2, 0) / (PAIRS - 1));
console.log(`home edge: ${mean.toFixed(2)} ± ${(sd / Math.sqrt(PAIRS)).toFixed(2)} points a game over ${PAIRS} pairs`);
console.log(`the home side wins ${(100 * won.on / PAIRS).toFixed(1)}% with it and ${(100 * won.off / PAIRS).toFixed(1)}% without`);
