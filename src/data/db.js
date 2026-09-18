// Player database access. Keeps the engine decoupled from the data file so
// tests and scripts can supply synthetic pools.
import { PLAYERS } from './players.js';
import { POSITION_ORDER } from './positions.js';
import { overall } from '../engine/ratings.js';

export { PLAYERS };
export const PLAYERS_BY_ID = new Map(PLAYERS.map((p) => [p.id, p]));

export function getPlayer(id) {
  return PLAYERS_BY_ID.get(id);
}

export function sortedPool(players = PLAYERS) {
  return players.slice().sort((a, b) => overall(b) - overall(a) || POSITION_ORDER.indexOf(a.pos) - POSITION_ORDER.indexOf(b.pos));
}

export const ERAS = [...new Set(PLAYERS.map((p) => `${Math.floor(p.season / 10) * 10}s`))].sort();
