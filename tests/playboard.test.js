// The play board as the game screen prints it (ui/playboard.js): a diagram
// for every call, the line over the calls, and the fold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { OFFENSE_CALLS, DEFENSE_CALLS, CALL_GRID } from '../src/engine/playcall.js';
import { readSnaps } from '../src/engine/tendencies.js';
import { PLAY_KEYS, callIcon, tendencyLine, playBoard, fmtPoints } from '../src/ui/playboard.js';

const A = syntheticTeam('alpha', 86, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const G = simulateGame(createGame({ ...A, lineup: buildLineup(A.slots, A.byId) }, { ...B, lineup: buildLineup(B.slots, B.byId) }, { seed: 77 }));
const ENTITY = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
/** What the markup reads as: tags out, a space where each was, entities decoded. */
const text = (h) => (typeof h === 'string' ? h : h.__raw).replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITY[m]).replace(/\s+/g, ' ').trim();
/** The game at a given down, distance and spot, for the line to read. */
const at = (down, toGo, ballOn) => ({ ...G, down, toGo, ballOn });
/** A snap as readSnaps gives one. */
const snap = (off, call, defCall, key, points = 0) => ({ off, call, defCall, key, points, down: 1, toGo: 10, ballOn: 30 });

test('every scrimmage call and every look has a diagram, drawn in the button\'s colour and hidden from a screen reader', () => {
  assert.deepEqual([...PLAY_KEYS].sort(), Object.keys(CALL_GRID).sort(), 'the buttons are the calls the grid measures');
  for (const k of [...PLAY_KEYS, ...Object.keys(DEFENSE_CALLS)]) {
    const svg = callIcon(k);
    assert.match(svg, /^<svg class="callicon" viewBox="0 0 36 24" aria-hidden="true" focusable="false"/, k);
    // No colour of its own: the theme and a pressed button decide it.
    const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(colours.every((c) => c === 'currentColor' || c === 'none'), `${k}: ${colours.join(', ')}`);
    assert.ok(!/<text/.test(svg), `${k} has words in it`);
    // Inside its own box.
    for (const n of svg.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)) {
      const x = Number(n[1]), y = Number(n[2]);
      assert.ok(x >= 0 && x <= 36 && y >= 0 && y <= 24, `${k} draws at ${x},${y}`);
    }
  }
  assert.notEqual(callIcon('base'), callIcon('run_stop'));
  assert.equal(callIcon('fg'), '');
});

test('the line says what the other side has shown in this situation, most first', () => {
  const snaps = [
    snap(0, 'pass_med', 'deep', 'long'), snap(0, 'pass_deep', 'deep', 'long'), snap(0, 'pass_med', 'blitz', 'long'),
    snap(0, 'run_in', 'base', 'first'), snap(0, 'run_in', 'base', 'first'),
    snap(1, 'run_in', 'base', 'first'), snap(1, 'pass_short', 'blitz', 'long'), snap(1, 'run_out', 'deep', 'long'),
  ];
  // On the ball: their defence, the human being side 0.
  assert.equal(text(tendencyLine(at(3, 8, 40), 'offense', 0, snaps)), 'Their defence on 3rd & long: Deep Shell 2 · Blitz 1');
  // A situation that has not come up yet reads every down.
  assert.equal(text(tendencyLine(at(3, 4, 40), 'offense', 0, snaps)), 'None on 3rd & medium yet. Their defence on every down: Base 2 · Deep Shell 2 · Blitz 1');
  // On defence: their offence, run or pass.
  assert.equal(text(tendencyLine(at(3, 8, 40), 'defense', 0, snaps)), 'Their offence on 3rd & long: Run 1 · Pass 1');
  assert.equal(text(tendencyLine(at(1, 10, 40), 'defense', 0, snaps)), 'Their offence on 1st down: Run 1');
  // Nothing shown yet, nothing said.
  assert.equal(tendencyLine(at(1, 10, 25), 'offense', 0, []), '');
});

test('points print signed to a tenth with a real minus, and nothing is printed as minus nought', () => {
  assert.equal(fmtPoints(0.42), '+0.4');
  assert.equal(fmtPoints(-1.25), '−1.2');
  assert.equal(fmtPoints(0.04), '0.0');
  assert.equal(fmtPoints(-0.04), '0.0');
  assert.equal(fmtPoints(3), '+3.0');
});

test('the board: their plan, the situation the call is in, only the calls made, and the colours from the human\'s side', () => {
  const g = { ...G, teams: G.teams.map((t, i) => (i === 1 ? { ...t, plan: { notes: ['bring pressure at a weak line'] } } : t)) };
  const snaps = [snap(0, 'screen', 'blitz', 'long', 2.5), snap(0, 'run_in', 'run_stop', 'short', -1), snap(1, 'pass_deep', 'deep', 'first', -0.8)];
  const off = playBoard({ ...g, down: 3, toGo: 9, ballOn: 40 }, 'offense', 0, snaps).__raw;
  assert.match(off, /^<details class="playboard" data-fold="board" >/);
  assert.match(text(off), /^Play board · 2 snaps Their game plan: bring pressure at a weak line\./);
  assert.match(off, /<tr class="now"><th scope="row" class="lbl">3rd &amp; 7\+ <span class="nowtag">now<\/span>/);
  assert.match(off, /<caption>Your calls against theirs<\/caption>/);
  // Rows for the calls made, and no others.
  assert.match(off, /<th scope="row" class="lbl">Screen<\/th>/);
  assert.match(off, /<th scope="row" class="lbl">Inside Run<\/th>/);
  assert.doesNotMatch(off, /<th scope="row" class="lbl">Deep Shot<\/th>/);
  // Your points: plus is good.
  assert.match(off, /<span class="pts good">\+2\.5<\/span><small>1<\/small>/);
  assert.match(off, /<span class="pts bad">−1\.0<\/span><small>1<\/small>/);
  // On defence the points are theirs, so minus is good for you.
  const def = playBoard({ ...g, down: 1, toGo: 10, ballOn: 30 }, 'defense', 0, snaps).__raw;
  assert.match(def, /<caption>Their calls against yours<\/caption>/);
  assert.match(def, /<th scope="row" class="lbl">Deep Shot<\/th>/);
  assert.match(def, /<span class="pts good">−0\.8<\/span>/);
  assert.match(text(def), /Plus is theirs\./);
  assert.match(text(def), /Their offence, by situation Situation Run Pass 1st down now – 1/);
  // Open when the player left it open; empty before the first snap.
  assert.match(playBoard(g, 'offense', 0, snaps, { open: true }).__raw, /data-fold="board" open>/);
  assert.match(text(playBoard(g, 'offense', 0, [])), /Nothing yet: the board fills in from the first snap\./);
});

test('on a real game the board holds every snap of the side with the ball once', () => {
  const snaps = readSnaps(G.log);
  const mine = snaps.filter((s) => s.off === 0).length;
  const h = playBoard({ ...G, down: 1, toGo: 10, ballOn: 25 }, 'offense', 0, snaps).__raw;
  assert.match(h, new RegExp(`Play board · ${mine} snaps`));
  // The grid's corner is every snap.
  assert.match(h, new RegExp(`<tfoot><tr><th scope="row" class="lbl">All</th>.*<small>${mine}</small></td></tr></tfoot>`));
  for (const k of PLAY_KEYS) assert.equal(h.includes(`>${OFFENSE_CALLS[k].label}</th>`), snaps.some((s) => s.off === 0 && s.call === k), k);
});
