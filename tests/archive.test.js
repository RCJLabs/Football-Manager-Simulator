import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, userTeamIndex, newSeasonSameRosters } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { seasonTeamStats, rankTeams, fmtCategory, CATEGORY_BY_KEY } from '../src/engine/teamstats.js';
import { archiveSeason, archivedSeasons, pastRows, series, seriesLine } from '../src/engine/archive.js';

registerPlayers(byId);

function playSeason(seed, numTeams = 8) {
  const lg = createLeague({ name: 'A', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams, seed, draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  while (lg.phase === 'season' || lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  return lg;
}

/** Every result between two clubs this season, counted straight off the schedule. */
function direct(lg, a, b) {
  const out = { w: 0, l: 0, t: 0 };
  const games = [...lg.schedule.flatMap((w) => w.games), ...(lg.playoffs?.rounds || []).flatMap((r) => r.games)];
  for (const g of games) {
    if (!g.result || !((g.home === a && g.away === b) || (g.home === b && g.away === a))) continue;
    const [hs, as] = g.result.score;
    const mine = g.home === a ? hs : as, theirs = g.home === a ? as : hs;
    if (mine > theirs) out.w++; else if (mine < theirs) out.l++; else out.t++;
  }
  return out;
}

const pairs = (n) => { const out = []; for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) out.push([a, b]); return out; };

test('a crowned season is filed once, and reads back as the rows it was built from', () => {
  const lg = playSeason(41);
  assert.equal(lg.phase, 'complete');
  assert.equal(lg.archive.seasons.length, 1);
  assert.deepEqual(archivedSeasons(lg), [{ season: lg.season, user: userTeamIndex(lg) }]);
  const built = seasonTeamStats(lg);
  const filed = pastRows(lg, lg.season);
  assert.equal(filed.length, lg.teams.length);
  for (const [i, r] of built.entries()) {
    assert.equal(filed[i].games, r.games, `club ${i} games`);
    assert.deepEqual(filed[i].off, r.off, `club ${i} offence`);
    assert.deepEqual(filed[i].def, r.def, `club ${i} defence`);
    const rec = lg.teams[i].record;
    assert.deepEqual(filed[i].record, { w: rec.w, l: rec.l, t: rec.t }, `club ${i} record`);
  }
  // Filing again is a no-op, or a head-to-head would count a season twice.
  const before = JSON.stringify(lg.archive);
  assert.equal(archiveSeason(lg, 0), false);
  assert.equal(JSON.stringify(lg.archive), before);
  assert.equal(pastRows(lg, lg.season + 1), null, 'a season never filed read back as something');
});

test('the series counts every meeting once, from both sides', () => {
  const lg = playSeason(42);
  let meetings = 0;
  for (const [a, b] of pairs(lg.teams.length)) {
    const s = series(lg, a, b), r = series(lg, b, a), d = direct(lg, a, b);
    // Filed and still on the schedule: this is the moment a live count would
    // add the season a second time.
    assert.deepEqual([s.w, s.l, s.t], [d.w, d.l, d.t], `${a} v ${b}`);
    assert.deepEqual([r.w, r.l, r.t], [s.l, s.w, s.t], `${a} v ${b} read from the other side`);
    meetings += s.games;
  }
  const played = lg.schedule.flatMap((w) => w.games).filter((g) => g.result).length
    + (lg.playoffs?.rounds || []).flatMap((r) => r.games).filter((g) => g.result).length;
  assert.equal(meetings, played, 'every game belongs to exactly one pair');
});

test('the next season adds to the series without counting the last one twice', () => {
  const lg = playSeason(43);
  const first = Object.fromEntries(pairs(lg.teams.length).map(([a, b]) => [`${a}-${b}`, direct(lg, a, b)]));
  newSeasonSameRosters(lg, byId);
  for (let w = 0; w < 4; w++) { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  for (const [a, b] of pairs(lg.teams.length)) {
    const now = direct(lg, a, b), was = first[`${a}-${b}`], s = series(lg, a, b);
    assert.deepEqual([s.w, s.l, s.t], [was.w + now.w, was.l + now.l, was.t + now.t], `${a} v ${b}`);
  }
  assert.equal(series(lg, 0, 1).since, 1);
  // And through to the second final: two seasons filed, newest first, the
  // record still dated from the first, and still nothing counted twice.
  while (lg.phase === 'season' || lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  assert.deepEqual(archivedSeasons(lg).map((x) => x.season), [2, 1]);
  for (const [a, b] of pairs(lg.teams.length)) {
    const now = direct(lg, a, b), was = first[`${a}-${b}`], s = series(lg, a, b);
    assert.deepEqual([s.w, s.l, s.t], [was.w + now.w, was.l + now.l, was.t + now.t], `${a} v ${b} after two finals`);
    assert.equal(s.since, 1, 'the record stopped dating from the first season it covers');
  }
});

test('a league from before the archive counts only the season in front of it', () => {
  const lg = playSeason(44);
  newSeasonSameRosters(lg, byId);
  for (let w = 0; w < 3; w++) { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  delete lg.archive;
  const [a, b] = lg.schedule[0].games.map((g) => [g.home, g.away])[0];
  const s = series(lg, a, b), d = direct(lg, a, b);
  assert.deepEqual([s.w, s.l, s.t], [d.w, d.l, d.t]);
  assert.equal(s.since, lg.season, 'a series with no filed seasons claimed to go back further');
  assert.deepEqual(archivedSeasons(lg), []);
  assert.equal(pastRows(lg, lg.season - 1), null);
});

test('a field a season never recorded reads as no figure, not as zero', () => {
  const lg = playSeason(45);
  const s = lg.archive.seasons[0];
  const at = s.fields.indexOf('redZoneTd');
  assert.ok(at >= 0);
  const n = s.fields.length;
  // A season filed before the team line had this field.
  s.clubs = s.clubs.map((c) => c.filter((_, i) => i !== 4 + at && i !== 4 + n + at));
  s.fields = s.fields.filter((f) => f !== 'redZoneTd');
  const rows = pastRows(lg, lg.season);
  const rz = rankTeams(rows, CATEGORY_BY_KEY.rz);
  assert.ok(rz.every((r) => r.rank == null), 'a red-zone rate was ranked off a field the season never had');
  assert.equal(fmtCategory(CATEGORY_BY_KEY.rz, rz[0].v), '—');
  // Everything else still reads.
  assert.ok(rankTeams(rows, CATEGORY_BY_KEY.ppg).every((r) => r.rank != null));
  assert.equal(rows[0].off.redZoneAtt, lg.archive.seasons[0].clubs[0][4 + s.fields.indexOf('redZoneAtt')]);
});

test('a filed season keeps the league\'s books balanced', () => {
  const lg = playSeason(46);
  const rows = pastRows(lg, lg.season);
  for (const f of lg.archive.seasons[0].fields) {
    const off = rows.reduce((a, r) => a + r.off[f], 0), def = rows.reduce((a, r) => a + r.def[f], 0);
    assert.equal(off, def, `${f}: ${off} gained against ${def} allowed`);
  }
});

test('a tie is a tie from both sides, and a win is the winner\'s from either seat', () => {
  // Built by hand: a seeded season may hold no tie at all, and a tie counted
  // as somebody's win is the error nobody would ever spot on the screen.
  const g = (home, away, hs, as) => ({ home, away, result: { score: [hs, as] } });
  const lg = { season: 1, teams: [{}, {}, {}], schedule: [
    { games: [g(0, 1, 10, 10), g(2, 0, 3, 0)] },
    { games: [g(1, 0, 17, 20), g(0, 2, 7, 21)] },
  ] };
  assert.deepEqual(series(lg, 0, 1), { w: 1, l: 0, t: 1, games: 2, since: 1 });
  assert.deepEqual(series(lg, 1, 0), { w: 0, l: 1, t: 1, games: 2, since: 1 });
  assert.deepEqual(series(lg, 0, 2), { w: 0, l: 2, t: 0, games: 2, since: 1 });
  assert.deepEqual(series(lg, 2, 0), { w: 2, l: 0, t: 0, games: 2, since: 1 });
  archiveSeason(lg, 0);
  assert.deepEqual(series(lg, 0, 1), { w: 1, l: 0, t: 1, games: 2, since: 1 }, 'filing the season changed the series');
  assert.deepEqual(series(lg, 2, 0), { w: 2, l: 0, t: 0, games: 2, since: 1 });
});

test('the series reads as words', () => {
  assert.equal(seriesLine({ w: 0, l: 0, t: 0, games: 0 }), 'first meeting');
  assert.equal(seriesLine({ w: 7, l: 5, t: 0, games: 12 }), 'you lead 7–5');
  assert.equal(seriesLine({ w: 2, l: 4, t: 1, games: 7 }), 'you trail 2–4–1');
  assert.equal(seriesLine({ w: 3, l: 3, t: 1, games: 7 }), 'level at 3–3–1');
  assert.equal(seriesLine({ w: 4, l: 1, t: 0, games: 5 }, { who: 'DAL' }), 'DAL leads 4–1');
});
