import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { overall, rawOverall } from '../src/engine/ratings.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll, rankForTeam, createDraft, POS_BASE } from '../src/engine/draft.js';
import { generateRookies } from '../src/engine/rookies.js';
import { startCareer } from '../src/engine/careers.js';
import { scoutReport, scoutedOverall, MIN_WIDTH } from '../src/engine/scouting.js';

registerPlayers(PLAYERS_BY_ID);

function league(seed) {
  const lg = createLeague({ name: 'R', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  lg.settings.scouting = true;
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  return lg;
}
const userIdx = (lg) => lg.teams.findIndex((t) => t.isUser);

test('a club drafts a rookie on its read of what he is now, and pays nothing for the upside', () => {
  const lg = league(41);
  const u = userIdx(lg);
  const rookies = generateRookies(lg, new RNG(41), { size: 200, season: 1 });
  for (const p of rookies) {
    const r = scoutReport(lg, p, u);
    assert.equal(r.known, false);
    assert.equal(scoutedOverall(lg, p, u), r.low, `${p.name} is drafted on something other than the low end of his band`);
  }
  // The band still carries the upside; the pick just does not pay for it.
  assert.ok(rookies.some((p) => { const r = scoutReport(lg, p, u); return r.high - r.low >= 15; }), 'no prospect in the class has real upside, so this proves nothing');
  // A known man is what he is.
  for (const p of PLAYERS.slice(0, 30)) assert.equal(scoutedOverall(lg, p, u), overall(p));
});

test('the draft ranks on that read, and only a measurement ever passes another', () => {
  const lg = league(45);
  lg.rookies = generateRookies(lg, new RNG(45), { size: 120, season: 1 });
  for (const t of lg.teams) for (const s of Object.keys(t.slots)) t.slots[s] = null;
  const draft = createDraft(lg, new RNG(45));
  const pool = [...PLAYERS.filter((p) => overall(p) < 62), ...lg.rookies];
  const u = userIdx(lg);
  const ids = (xs) => xs.slice(0, 40).map((x) => x.player.id).join();
  const byDefault = rankForTeam(lg, draft, pool, u, null);
  assert.equal(ids(byDefault), ids(rankForTeam(lg, draft, pool, u, null, { read: scoutedOverall })), 'the default read is not scoutedOverall');
  const paysForUpside = rankForTeam(lg, draft, pool, u, null, { read: (league, p, t) => scoutReport(league, p, t).estimate });
  assert.notEqual(ids(byDefault), ids(paysForUpside), 'counting upside changed nothing on a board of rookies');
});

test('a perfect read reads the band exactly: floor to ceiling, off the same draws', () => {
  const lg = league(42);
  const u = userIdx(lg);
  for (const p of generateRookies(lg, new RNG(42), { size: 60, season: 1 })) {
    const r = scoutReport(lg, p, u, { accuracy: 1 });
    const ceiling = Math.max(overall(p), startCareer(lg, p).ceiling ?? overall(p));
    assert.equal(r.low, overall(p));
    assert.equal(r.high, Math.min(99, Math.max(ceiling, r.low + MIN_WIDTH)));
    assert.equal(scoutedOverall(lg, p, u, { accuracy: 1 }), overall(p), 'a perfect scout drafts a rookie on anything but what he is');
  }
});

test('the draft honours the position weights it is given, or a check of them would compare a table with itself', () => {
  const lg = league(46);
  for (const t of lg.teams) for (const s of Object.keys(t.slots)) t.slots[s] = null;
  const draft = createDraft(lg, new RNG(46));
  const u = userIdx(lg);
  const onlyKickers = Object.fromEntries(Object.keys(POS_BASE).map((k) => [k, k === 'K' ? 5 : 0.01]));
  const top = rankForTeam(lg, draft, PLAYERS, u, null, { bestOnly: true, weights: onlyKickers })[0].player;
  assert.equal(top.pos, 'K', `weighted to kickers, the board still led with a ${top.pos}`);
  assert.notEqual(rankForTeam(lg, draft, PLAYERS, u, null, { bestOnly: true })[0].player.pos, 'K', 'a kicker leads the default board anyway, so this proves nothing');
});

test('two leagues on one seed never hand each other a rookie\'s rating through the cache', () => {
  // Rookie ids are the league seed, the class and a number, so a league and
  // its own share code — or two arms of a paired measurement — can each hold
  // a different man under one id once their classes have come apart.
  const mine = { id: 'rk-cache-3-0', pos: 'WR', generated: true, r: { spd: 90, cth: 90, rte: 90, rac: 90 } };
  const theirs = { ...mine, r: { spd: 50, cth: 50, rte: 50, rac: 50 } };
  assert.equal(overall(mine), rawOverall('WR', mine.r));
  assert.equal(overall(theirs), rawOverall('WR', theirs.r), 'the second league read the first league\'s rookie');
});
