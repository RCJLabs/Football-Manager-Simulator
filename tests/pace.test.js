// How soon a prospect arrives, as against how high he gets.
//
// These were the same number before. `ceilingFor` sets a prospect's room to
// `growth * 13 * …` and `step` climbs at a rate also proportional to `growth`,
// so distance and speed cancelled and every prospect reached his ceiling in
// about five seasons whoever he was. Measured across the whole range of
// development, room ran 7.2 points to 18.1 while the years sat at 5.0, 4.8,
// 5.0, 4.5, 5.1. `pace` multiplies the climb and leaves the ceiling alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, registerPlayers } from '../src/engine/season.js';
import { generateRookies } from '../src/engine/rookies.js';
import { startCareer, stepCareer, developed } from '../src/engine/careers.js';
import { scoutReport, readyLabel, ARRIVE_AT_PACE_1 } from '../src/engine/scouting.js';
import { overall } from '../src/engine/ratings.js';
import { RNG } from '../src/engine/rng.js';

registerPlayers(PLAYERS_BY_ID);
const league = (seed = 5) => createLeague({
  name: 'P', mode: 'pro', numTeams: 32, seed, draftType: 'snake',
  user: { name: 'Me', abbr: 'ME', color: '#fff' },
});

/** Walk a career and report when he first reaches his own ceiling. */
function yearsToCeiling(lg, p) {
  let c = startCareer(lg, p);
  const cap = c.ceiling ?? 99;
  for (let y = 1; y <= 14; y++) {
    c = stepCareer(lg, p, c, y, 0).career;
    if (overall(developed(p, c)) >= cap - 1) return y;
  }
  return null;
}

test('pace decides when he arrives and leaves where alone', () => {
  // Five classes, not one. A class has a dozen slow developers, so its mean
  // arrival carries about a third of a season of noise, and the gap it is held
  // to is one season: one class read 1.09 and then 0.87 when the rating weights
  // changed which season a man first reads his ceiling in, while the five
  // together read 1.38 and 1.40.
  const rows = [];
  for (const seed of [5, 6, 7, 8, 9]) {
    const lg = league(seed);
    for (const p of generateRookies(lg, new RNG(seed)) || []) {
      const c = startCareer(lg, p);
      const room = (c.ceiling ?? 0) - overall(developed(p, c));
      if (room < 6) continue;
      const y = yearsToCeiling(lg, p);
      if (y) rows.push({ pace: c.pace ?? 1, room, y });
    }
  }
  assert.ok(rows.length >= 200, `only ${rows.length} prospects with room reached a ceiling`);
  const slow = rows.filter((r) => r.pace < 0.9);
  const fast = rows.filter((r) => r.pace > 1.15);
  assert.ok(slow.length >= 40 && fast.length >= 40, 'the draw produces both kinds');
  const mean = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;

  // The point of the whole thing: slow developers take longer.
  assert.ok(mean(slow, 'y') > mean(fast, 'y') + 1,
    `slow ${mean(slow, 'y').toFixed(1)} vs fast ${mean(fast, 'y').toFixed(1)} seasons — pace must move arrival`);
  // And do not end up anywhere different. If pace moved the ceiling too it
  // would just be `growth` again under another name.
  assert.ok(Math.abs(mean(slow, 'room') - mean(fast, 'room')) < 4,
    `room ${mean(slow, 'room').toFixed(1)} vs ${mean(fast, 'room').toFixed(1)} — pace must not move the destination`);
});

test('a career stored before pace existed develops exactly as it did', () => {
  // `pace` defaults to 1 wherever it is read, so an old save is untouched.
  const lg = league(6);
  const p = (generateRookies(lg, new RNG(6)) || [])[0];
  assert.ok(p, 'no rookie generated');
  const withPace = { ...startCareer(lg, p), pace: 1 };
  const legacy = { ...startCareer(lg, p) };
  delete legacy.pace;
  const a = stepCareer(lg, p, withPace, 1, 0);
  const b = stepCareer(lg, p, legacy, 1, 0);
  assert.equal(b.after, a.after, 'a career with no pace field must step like pace 1');
});

test('the scout is told when, not only how high', () => {
  const lg = league(5);
  const rookies = (generateRookies(lg, new RNG(5)) || []).slice(0, 60);
  const reports = rookies.map((p) => scoutReport(lg, p, 0, { force: true }));
  for (const r of reports) {
    assert.ok(r.soon >= 1 && r.late <= 10, `arrival out of range: ${r.soon}-${r.late}`);
    assert.ok(r.late > r.soon, 'a range with no width is a number');
    assert.ok(r.ready >= r.soon && r.ready <= r.late, 'the midpoint sits inside its own band');
  }
  // The class must not all read the same, or this is a noisier number.
  const mids = [...new Set(reports.map((r) => r.ready))];
  assert.ok(mids.length >= 4, `only ${mids.length} distinct arrival reads across the class`);

  // There must actually BE fog. `late` is clamped to at least `soon + 1`, so a
  // band of width one is what you get when the uncertainty is zero — asserting
  // `late > soon` is asserting the clamp, not the feature. A first version of
  // this test did exactly that, and deleting the whole scouting error passed it.
  const widths = reports.map((r) => r.late - r.soon);
  const meanWidth = widths.reduce((a, b) => a + b, 0) / widths.length;
  assert.ok(meanWidth > 1.5, `mean arrival band is ${meanWidth.toFixed(2)} wide — that is the clamp, not a projection`);

  // And the fog has to answer to how good the scouts are. A club that reads
  // players well gets a tighter band out of the same prospects.
  const lgSharp = league(5);
  for (const t of lgSharp.teams) t.isUser = false;
  const sharp = rookies.map((p) => scoutReport(lgSharp, p, 0, { force: true }));
  const sharpWidth = sharp.reduce((s, r) => s + (r.late - r.soon), 0) / sharp.length;
  assert.notEqual(sharpWidth.toFixed(2), meanWidth.toFixed(2),
    'the band does not respond to who is doing the scouting');
  // And it has to track the truth, or it is noise rather than fog.
  const err = reports.map((r, i) => {
    const arc = startCareer(lg, rookies[i]);
    const truth = Math.max(1, Math.min(9, Math.round(ARRIVE_AT_PACE_1 / (arc.pace ?? 1))));
    return Math.abs(r.ready - truth);
  });
  assert.ok(err.reduce((s, x) => s + x, 0) / err.length < 1.2, 'the read does not track the truth');
});

test('a known player is not given an arrival at all', () => {
  const lg = league(7);
  const p = PLAYERS_BY_ID.get([...PLAYERS_BY_ID.keys()][0]);
  const rep = scoutReport(lg, p, 0);
  assert.equal(rep.known, true, 'a real player is known');
  assert.equal(readyLabel(rep), '', 'nothing to project about a man who has played');
});
