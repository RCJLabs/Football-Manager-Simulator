// Two attributes that read as nearly worthless, and why only one of them was.
//
// `thp` measured 0.052 of a quarterback's leverage against a shipped 0.170, and
// `car` 0.007 of a back's against 0.150. The obvious move for both is to cut
// the price. That was right for one and wrong for the other, and the difference
// is whether the attribute was WIRED to anything: arm strength reached only the
// deep ball, a tenth of the throws, so it measured low for want of a job.
// Ball security reached every carry and still measured low, because fumbles are
// rare and half of them come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';

/** A synthetic side with one attribute forced on every starter at a position. */
function teamWith(seed, pos, attr, value) {
  const t = syntheticTeam(`t${seed}`, 82, 2, seed);
  const byId = new Map(t.byId);
  for (const s of ROSTER_SLOTS) {
    if (s.pos !== pos) continue;
    const p = byId.get(t.slots[s.id]);
    if (p) byId.set(p.id, { ...p, r: { ...p.r, [attr]: value } });
  }
  return { ...t, lineup: buildLineup(t.slots, byId), byId };
}

/** Aggregate a few hundred games against a fixed opponent. */
function run(pos, attr, value, games = 260) {
  let att = 0, cmp = 0, yds = 0, carries = 0, fum = 0, margin = 0;
  for (let k = 0; k < games; k++) {
    const home = teamWith(k, pos, attr, value);
    const a = syntheticTeam('opp', 82, 2, 70000 + k);
    const away = { ...a, lineup: buildLineup(a.slots, a.byId) };
    const g = simulateGame(createGame(home, away, { seed: 4400 + k, homeAdvantage: false }));
    const tm = g.stats?.[0]?.team;
    if (tm) { att += tm.passAtt || 0; cmp += tm.passCmp || 0; yds += tm.passYds || 0; carries += tm.rushAtt || 0; }
    for (const id in (g.stats?.[0]?.players || {})) {
      const s = g.stats[0].players[id];
      if (s.rush) fum += s.rush.fum || 0;
    }
    margin += g.score[0] - g.score[1];
  }
  return { cmpPct: cmp / att, fumPerGame: fum / games, margin: margin / games, carries: carries / games };
}

test('a strong arm completes more than a weak one, and not only deep', () => {
  // The whole point of the rewiring. Deep shots are roughly a tenth of throws,
  // so if arm strength only reached them it could not move a season.
  const weak = run('QB', 'thp', 62);
  const strong = run('QB', 'thp', 99);
  assert.ok(strong.cmpPct > weak.cmpPct + 0.01,
    `arm strength must move completion rate (${(weak.cmpPct * 100).toFixed(1)}% -> ${(strong.cmpPct * 100).toFixed(1)}%)`);
  assert.ok(strong.margin > weak.margin + 0.5,
    `and must be worth something on the scoreboard (${weak.margin.toFixed(2)} -> ${strong.margin.toFixed(2)})`);
});

test('the arm term is centred so the league does not drift', () => {
  // A CALIBRATION PIN, and the reason for one: `ARM_MID` decides where the new
  // term is worth nothing, so getting it wrong shifts every completion in the
  // game rather than only the ones it should. Centred on 82, the mean of the
  // synthetic population the constants were fitted against, the league throws
  // 63.30%. At 70 it throws 64.45% and at 92, 62.54% — a full point either way,
  // and BOTH of those sit inside any sane realistic range, so a loose band
  // cannot catch it. Hence the narrow one.
  //
  // Centring on the wrong population has happened twice in this engine's
  // history. If this fails after a deliberate change, re-measure and move the
  // number; do not widen the band.
  let att = 0, cmp = 0;
  for (let k = 0; k < 400; k++) {
    const a = syntheticTeam('x', 82, 2, k), b = syntheticTeam('y', 82, 2, 9000 + k);
    const g = simulateGame(createGame(
      { ...a, lineup: buildLineup(a.slots, a.byId) },
      { ...b, lineup: buildLineup(b.slots, b.byId) },
      { seed: 77 + k, homeAdvantage: false }));
    for (const t of [0, 1]) { att += g.stats[t].team.passAtt || 0; cmp += g.stats[t].team.passCmp || 0; }
  }
  const pct = 100 * cmp / att;
  assert.ok(pct > 62.9 && pct < 63.8, `league completion drifted to ${pct.toFixed(2)}%, expected 63.30%`);
});

test('ball security counts on a catch, not only on a carry', () => {
  // It read the defence's tackling alone, so a back who coughed it up running
  // never did catching — `car` meaning two things on two plays.
  //
  // Counted on CATCHES ALONE, and for one side only. A first version compared
  // total fumbles and could not see this at all: a back fumbles roughly half a
  // time a game carrying and a tenth of a time catching, so the change worth
  // testing was five per cent of the number being measured and reverting it
  // failed nothing.
  const catchFumbles = (car, games = 320) => {
    let n = 0;
    for (let k = 0; k < games; k++) {
      const home = teamWith(k, 'RB', 'car', car);
      const a = syntheticTeam('opp', 82, 2, 70000 + k);
      const g = simulateGame(createGame(home, { ...a, lineup: buildLineup(a.slots, a.byId) },
        { seed: 4400 + k, homeAdvantage: false }));
      const mine = new Set((home.lineup.RB || []).map((p) => p.name.split(' ').pop()));
      for (const e of g.log || []) {
        const t = e.text || '';
        if (!/FUMBLE/.test(t) || !/complete to/.test(t)) continue;
        if ([...mine].some((nm) => t.includes(nm))) n++;
      }
    }
    return n / games;
  };
  const loose = catchFumbles(45);
  const safe = catchFumbles(99);
  assert.ok(loose > safe * 1.5 && loose - safe > 0.01,
    `a careless back must drop more of what he catches (${safe.toFixed(3)} vs ${loose.toFixed(3)} a game)`);
});

test('but ball security is still cheap, which is why its price came down', () => {
  // The honest other half. `car` is wired, it works, and a back who never
  // fumbles is worth well under a point a game — because fumbles are rare and
  // the offence recovers half of them. That is why the weight fell to 0.08
  // rather than the engine being changed to make it matter more.
  const loose = run('RB', 'car', 45);
  const safe = run('RB', 'car', 99);
  const swing = safe.margin - loose.margin;
  assert.ok(swing > 0, `perfect ball security must be worth something, got ${swing.toFixed(2)}`);
  assert.ok(swing < 3, `and must stay small: a 54-point swing bought ${swing.toFixed(2)} points of margin`);
});
