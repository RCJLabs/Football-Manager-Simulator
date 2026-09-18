import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, registerPlayers, userTeamIndex, newSeasonSameRosters } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { encodeLeagueCode, decodeLeagueCode, leagueFromSnapshot } from '../src/engine/share.js';
import { seasonResult, encodeResultCode, decodeResultCode, compareResults, leagueFingerprint, playoffRun, cardSeasons, fmtRecord, RESULT_VERSION } from '../src/engine/result.js';

registerPlayers(byId);

function playOut(lg) {
  while (lg.phase === 'season' || lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg); }
  return lg;
}
function league(seed) {
  const lg = createLeague({ name: 'Cup', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'off' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  return lg;
}

test('a card describes the finished season and refuses to be made early', () => {
  const lg = league(71);
  assert.throws(() => seasonResult(lg, byId, PLAYERS), /has not finished/);
  playOut(lg);
  const r = seasonResult(lg, byId, PLAYERS);
  assert.equal(r.v, RESULT_VERSION);
  assert.equal(r.season, 1);
  assert.equal(r.teams, 8);
  assert.equal(r.club.name, 'Me');
  const u = userTeamIndex(lg);
  assert.deepEqual(r.record, lg.teams[u].record);
  assert.ok(r.rank >= 1 && r.rank <= 8);
  assert.ok(r.champion && r.champion.name);
  assert.equal(r.champion.mine, lg.champion === u);
  assert.ok(r.mvp && r.mvp.name && r.mvp.pos);
  assert.equal(r.best.length, 3);
  assert.ok(r.best[0].pts >= r.best[1].pts);
  assert.match(r.playoff, /title|lost in|reached|missed|made/);
  assert.equal(r.fp, leagueFingerprint(lg, PLAYERS));
  // The run reads off the bracket.
  const run = playoffRun(lg, u);
  assert.equal(run.text, r.playoff);
  if (lg.champion === u) assert.ok(run.won);
  assert.equal(fmtRecord({ w: 9, l: 5, t: 0 }), '9-5');
  assert.equal(fmtRecord({ w: 8, l: 5, t: 1 }), '8-5-1');
  // The card survives into the next season, when the table has reset.
  assert.deepEqual(cardSeasons(lg), [1]);
  newSeasonSameRosters(lg, byId);
  assert.equal(lg.season, 2);
  assert.equal(lg.teams[u].record.w, 0, 'the table has reset');
  assert.deepEqual(seasonResult(lg, byId, PLAYERS, 1), r, 'season one still reads the same');
  assert.throws(() => seasonResult(lg, byId, PLAYERS, 2), /has not finished/);
});

test('a card round-trips through a short code', async () => {
  const lg = playOut(league(72));
  const r = seasonResult(lg, byId, PLAYERS);
  const code = await encodeResultCode(r);
  assert.match(code, /^GR[01]\./);
  assert.ok(code.length < 1200, `card code is ${code.length} characters`);
  const back = await decodeResultCode(`  ${code}\n`);
  assert.deepEqual(back, r);
  await assert.rejects(decodeResultCode('hello'), /not a season card/);
  await assert.rejects(decodeResultCode('GR0.bm9wZQ'), /damaged or incomplete/);
  await assert.rejects(decodeResultCode(await encodeLeagueCode(lg, PLAYERS)), /not a season card/);
});

test('two people who played the same shared league can be compared, and different leagues cannot', async () => {
  // One league, shared by code, played out twice from the same start.
  const origin = league(73);
  const code = await encodeLeagueCode(origin, PLAYERS);
  const a = leagueFromSnapshot(await decodeLeagueCode(code), PLAYERS, byId);
  const b = leagueFromSnapshot(await decodeLeagueCode(code), PLAYERS, byId);
  assert.equal(leagueFingerprint(a, PLAYERS), leagueFingerprint(b, PLAYERS), 'the same start is the same league');
  // Different simulated luck: play one with a different week order by simming separately.
  playOut(a);
  for (let i = 0; i < 3; i++) simulateWeekAi(b, byId, { includeUser: true }), advanceWeek(b);
  playOut(b);
  const mine = seasonResult(a, byId, PLAYERS), theirs = seasonResult(b, byId, PLAYERS);
  const cmp = compareResults(mine, theirs);
  assert.ok(cmp.ok, cmp.reason);
  assert.equal(cmp.season, 1);
  assert.equal(cmp.rows.length, 8);
  for (const row of cmp.rows) assert.ok('mine' in row && 'theirs' in row && [-1, 0, 1].includes(row.win), JSON.stringify(row));
  assert.ok([-1, 0, 1].includes(cmp.better));
  assert.match(cmp.verdict, /better season|Dead heat/);
  assert.equal(typeof cmp.sameChampion, 'boolean');

  // A card from another league is refused rather than compared.
  const other = seasonResult(playOut(league(74)), byId, PLAYERS);
  const bad = compareResults(mine, other);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /different leagues/);
  assert.throws(() => compareResults(mine, null), /Two cards/);
});

test('the verdict follows the title, then the run, then the table', () => {
  const base = { v: RESULT_VERSION, fp: 'x', league: 'L', season: 1, mode: 'fantasy', teams: 8, club: { name: 'A', abbr: 'A', color: '#fff' }, best: [], champion: null, mvp: null };
  const card = (over) => ({ ...base, record: { w: 7, l: 7, t: 0, pf: 300, pa: 300 }, rank: 4, playoff: 'missed the playoffs', ...over });
  const champ = card({ playoff: 'won the title', rank: 1, record: { w: 10, l: 4, t: 0, pf: 400, pa: 300 } });
  const runnerUp = card({ playoff: 'lost in the Championship', rank: 2, record: { w: 11, l: 3, t: 0, pf: 450, pa: 280 } });
  assert.equal(compareResults(champ, runnerUp).better, 1, 'the title beats a better record');
  assert.equal(compareResults(runnerUp, champ).better, -1);
  const deeper = card({ playoff: 'lost in the Wild Card', rank: 6 });
  const missed = card({ playoff: 'missed the playoffs', rank: 5 });
  assert.equal(compareResults(deeper, missed).better, 1, 'making the playoffs beats a higher finish without one');
  const higher = card({ rank: 3 }), lower = card({ rank: 6 });
  assert.equal(compareResults(higher, lower).better, 1);
  assert.match(compareResults(higher, lower).verdict, /higher finish/);
  const same = card({});
  assert.equal(compareResults(same, card({})).better, 0);
  assert.match(compareResults(same, card({})).verdict, /Dead heat/);
  const moreWins = card({ rank: 4, record: { w: 9, l: 5, t: 0, pf: 300, pa: 300 } });
  assert.equal(compareResults(moreWins, card({ rank: 4 })).better, 1);
  assert.match(compareResults(moreWins, card({ rank: 4 })).verdict, /more wins/);
});

test('the same league plays out identically until a decision differs, which is what makes the comparison mean something', async () => {
  const origin = league(75);
  const code = await encodeLeagueCode(origin, PLAYERS);
  const open = async () => leagueFromSnapshot(await decodeLeagueCode(code), PLAYERS, byId);
  const run = (lg, change) => {
    if (change) {
      const u = userTeamIndex(lg), me = lg.teams[u];
      [me.slots.RB1, me.slots.RB2] = [me.slots.RB2, me.slots.RB1];
      me.depthSorted = true;
    }
    return playOut(lg);
  };
  const a = seasonResult(run(await open(), false), byId, PLAYERS);
  const b = seasonResult(run(await open(), false), byId, PLAYERS);
  // Every game seed comes from the league seed, so two people who decide nothing get the same season.
  assert.equal(a.fp, b.fp);
  assert.deepEqual(a.record, b.record);
  assert.equal(a.rank, b.rank);
  assert.equal(compareResults(a, b).better, 0, 'identical play is a dead heat');

  // One decision, one different season.
  const c = seasonResult(run(await open(), true), byId, PLAYERS);
  assert.equal(a.fp, c.fp, 'still the same league');
  assert.notDeepEqual(a.record, c.record, 'starting the other back changed the season');
  const cmp = compareResults(a, c);
  assert.ok(cmp.ok);
  assert.notEqual(cmp.better, 0);
});
