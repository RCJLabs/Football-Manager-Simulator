// Things that must hold in any league, found broken by the invariant sweep
// (DESIGN.md, "What the invariant sweep found"): a man the drain has shown out
// never reaches a roster by any route, and the offseason prices its keepers
// on who a player is now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { backfillPlan, ownerMap } from '../src/engine/transactions.js';
import { bestAvailable } from '../src/engine/tradeblock.js';
import { enterOffseason, positionRates } from '../src/engine/offseason.js';
import { departedSet } from '../src/engine/proleague.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { careerIndex, applyCareers } from '../src/engine/careers.js';
import { overall } from '../src/engine/ratings.js';

registerPlayers(PLAYERS_BY_ID);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));

let built = null;
function proLeague() {
  if (!built) {
    const lg = createLeague({ name: 'I', mode: 'pro', franchise: 3, seed: 9, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
    autoDraftAll(lg, lg.draft, PLAYERS, new RNG(9));
    startSeason(lg, PLAYERS_BY_ID, PLAYERS);
    built = JSON.stringify(lg);
  }
  return JSON.parse(built);
}
// The best unsigned men at a position, shown out by the drain, in a league
// past its founding season (where the two pools apply).
function drained(lg, pos, n) {
  const owned = ownerMap(lg);
  const free = PLAYERS.filter((p) => p.pos === pos && !owned.has(p.id)).sort((a, b) => overall(b) - overall(a)).slice(0, n);
  lg.season = 2;
  lg.departed = free.map((p) => p.id);
  return free;
}

test('a trade backfill signs only a man the league could sign', () => {
  const lg = proLeague();
  const gone = drained(lg, 'WR', 5);
  // A club that gives a receiver for a tight end is a receiver short, and the
  // backfill signs one. The best on the market have left the league.
  const A = lg.teams[0];
  // The best tight end on another club, so he makes this one's roster.
  const te = lg.teams.slice(1).flatMap((t) => [t.slots.TE1, t.slots.TE2]).filter(Boolean)
    .sort((a, b) => overall(PLAYERS_BY_ID.get(b)) - overall(PLAYERS_BY_ID.get(a)))[0];
  const plan = backfillPlan(lg, 0, [A.slots.WR3], [te], PLAYERS, PLAYERS_BY_ID);
  assert.ok(plan.ok, plan.reason);
  assert.ok(plan.signs.length >= 1, 'no backfill was needed');
  for (const id of plan.signs) assert.ok(!gone.some((p) => p.id === id), `${PLAYERS_BY_ID.get(id).name} has left the league and was signed anyway`);
});

test('the trade block values a parting against men a club could sign', () => {
  const lg = proLeague();
  const gone = drained(lg, 'QB', 3);
  const best = bestAvailable(lg, PLAYERS);
  assert.ok(best.QB, 'no quarterback at all');
  assert.ok(!gone.some((p) => p.id === best.QB.id), `${best.QB.name} has left the league but prices the block`);
});

test('a man on injured reserve is on a roster as far as the drain is concerned', () => {
  const lg = proLeague();
  // A free agent the drain had scheduled, claimed during the season, hurt,
  // and on reserve when the offseason opens.
  const owned = ownerMap(lg);
  const k = PLAYERS.find((p) => p.pos === 'K' && !owned.has(p.id));
  const t = lg.teams[0];
  t.slots.K1 = null;
  t.ir = [k.id];
  lg.drain = { ...(lg.drain || {}), [k.id]: lg.season };
  lg.phase = 'complete';
  enterOffseason(lg, pool(lg), index(lg));
  const onRoster = ROSTER_SLOTS.some((s) => lg.teams.some((x) => x.slots[s.id] === k.id));
  assert.ok(onRoster, 'the fixture meant him to come back off reserve');
  assert.ok(!departedSet(lg).has(k.id), `${k.name} was shown out of the league while on ${t.abbr}'s reserve list, and came back to its roster`);
});

test('the offseason prices the tag on who a player is now', () => {
  const lg = proLeague();
  lg.phase = 'complete';
  // Handed the index as it stood at the end of the season, as the app does.
  enterOffseason(lg, pool(lg), index(lg));
  assert.ok(lg.offseason.aged > 0, 'careers did not run');
  assert.deepEqual(lg.offseason.rates, positionRates(lg, index(lg)));
});
