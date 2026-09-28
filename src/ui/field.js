// The field: a top-down drawing of where the ball is, where it has to get to,
// and the play that has just been run.
//
// Along the field every figure is the engine's: where the snap was taken and
// where the play ended, how far a throw went in the air, where a pass was
// picked off and how far it was run back, where a punt or a kickoff came down
// and where the return finished, how a kick missed. Across the field nothing
// is, because the engine places nobody sideways: which way a run bounced,
// where the receiver stood, where a punt came down between the sidelines are
// drawn to fit. Those choices come from a hash of the play's place in the log,
// so a play is drawn the same way every time it is drawn, and they carry from
// one snap to the next the way a ball is spotted: where the last play ended,
// brought in to the nearer hash.
//
// Coordinates are yards. x runs from the home end line (-10) to the away end
// line (110), the home club attacking to the right as the strip this replaced
// did; y runs from the far sideline (0) to the near one (W).

import { esc, textOn } from '../util.js';

export const W = 53.33;
export const MID = W / 2;
export const HASH = [23.58, 29.75];

const PASSES = new Set(['screen', 'pass_short', 'pass_med', 'pass_deep', 'pa_pass']);
// How deep the passer sets up, and how far from the ball the throw goes
// sideways, by the call. Illustrative, like everything across the field.
const DROP = { screen: 3, pass_short: 4, pass_med: 6, pass_deep: 7, pa_pass: 7 };
const WIDE = { screen: [6, 12], pass_short: [4, 16], pass_med: [7, 20], pass_deep: [9, 22], pa_pass: [6, 18] };
// Yards a second, to pace one part of a play against another: a throw crosses
// the field in the time a back takes to reach the line.
const SPEED = { snap: 40, drop: 9, carry: 9, return: 9, throw: 26, kick: 20, walk: 24 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hashIn = (y) => clamp(y, HASH[0], HASH[1]);
const inside = (y, m = 1.2) => clamp(y, m, W - m);
// Inside the end lines: a defence on its own goal line stands in its end zone.
const onField = ([x, y]) => [clamp(x, -9.4, 109.4), y];
const gap = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lengthOf = (pts) => pts.slice(1).reduce((s, p, k) => s + gap(pts[k], p), 0);

/** A number in [0, 1) from a play's place in the log and a salt: the same every time. */
export function rnd(i, k) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((k | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A gentle curve from a to b, bowed sideways by `bend` of its length. */
function arc(a, b, bend, n = 10) {
  const L = gap(a, b) || 1;
  const c = [(a[0] + b[0]) / 2 - ((b[1] - a[1]) / L) * bend * L, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / L) * bend * L];
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], clamp(u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], 0.2, W - 0.2)]);
  }
  return out;
}

/**
 * The ball's journey as one timed polyline: each segment's share of the time
 * by its length at its own speed. `at[k]` is where segment k starts in `pts`.
 */
function timeline(segs) {
  const durs = segs.map((s) => Math.max(s.kind === 'snap' ? 0.1 : 0.16, lengthOf(s.pts) / SPEED[s.kind]));
  const total = durs.reduce((a, b) => a + b, 0) || 1;
  const pts = [], ts = [], at = [], wins = [];
  let t = 0;
  segs.forEach((s, k) => {
    const t0 = t / total, t1 = (t + durs[k]) / total;
    at.push(Math.max(0, pts.length - 1));
    s.pts.forEach((p, j) => {
      if (j === 0 && pts.length) return;
      pts.push(p);
      ts.push(t0 + (t1 - t0) * (j / (s.pts.length - 1 || 1)));
    });
    if (!pts.length) { pts.push(s.pts[0]); ts.push(t0); }
    wins.push([t0, t1]);
    t += durs[k];
  });
  if (pts.length === 1) { pts.push(pts[0]); ts.push(1); }
  ts[ts.length - 1] = 1;
  return { pts, ts, at, wins, seconds: total };
}

/** Points and times of segment `k` of a timeline, both ends included. */
function span(ball, k) {
  if (k < 0 || k >= ball.at.length) return { pts: [], ts: [] };
  const a = ball.at[k], b = k + 1 < ball.at.length ? ball.at[k + 1] : ball.pts.length - 1;
  return { pts: ball.pts.slice(a, b + 1), ts: ball.ts.slice(a, b + 1) };
}
/** A man's timed path from pieces laid end to end, held where it stops. */
function track(team, pieces) {
  const pts = [], ts = [];
  for (const piece of pieces) { pts.push(...piece.pts); ts.push(...piece.ts); }
  if (ts[ts.length - 1] < 1) { pts.push(pts[pts.length - 1]); ts.push(1); }
  return { team, pts, ts };
}
const still = (p, t = 0) => ({ pts: [p], ts: [t] });
/** A man who stands at `start` and closes on `to` over the window. */
function closer(team, start, to, t0, t1 = 1) {
  return { team, pts: [start, start, to, to], ts: [0, Math.min(t0, t1), t1, 1] };
}

/**
 * The men at the snap, faint: the five up front and whoever else is not drawn
 * moving. Eleven a side, counting the ones that are.
 */
function formation(x0, y0, d, s, { qb = true, rb = true, wrs = 3, lbs = 3 } = {}) {
  const off = [0, 1.3, -1.3, 2.6, -2.6].map((dy) => [x0 - d * 0.6, y0 + dy]);
  off.push([x0 - d * 0.7, inside(y0 + s * 3.9)]);
  off.push(...[[x0 - d * 0.7, 9.5], [x0 - d * 0.7, W - 9.5], [x0 - d * 1.2, inside(y0 - s * 8.5, 3)]].slice(0, wrs));
  if (qb) off.push([x0 - d * 4.5, y0]);
  if (rb) off.push([x0 - d * 6.5, y0]);
  const def = [[0.9, 1], [0.9, -1], [0.9, 3.3], [0.9, -3.3], ...[[4.5, 4.4], [4.5, -4.4], [4.5, 0]].slice(0, lbs), [12, 9], [12, -9]]
    .map(([dx, dy]) => [x0 + d * dx, inside(y0 + dy, 2)]);
  def.push([x0 + d * 6.5, 9.5], [x0 + d * 6.5, W - 9.5]);
  return { off: off.map(onField), def: def.map(onField) };
}

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : 'No gain');
const KICKOFFS = new Set(['kickoff', 'td']);

/**
 * How one logged play is drawn, or null for an event that is not a play.
 * `y0` is where across the field the ball was spotted for it.
 *
 * Returns the ball's timed path, the lines it leaves, the men who move, the
 * men who stand, marks (a flag, a loose ball, an incompletion), a label, and
 * `nextY`: where the ball is spotted for whatever comes next.
 */
export function playShape(e, y0 = MID) {
  if (!e) return null;
  const i = e.i ?? 0;
  const r = (k) => rnd(i, k);
  const pat = e.type === 'xp' || e.type === '2pt';
  if (!pat && (e.from == null || !Number.isFinite(e.from))) return null;
  const side = pat ? (e.off ?? 0) : (e.snapOff ?? e.off ?? 0);
  const d = side === 0 ? 1 : -1;
  const X = (v) => (side === 0 ? v : 100 - v);
  const toRoom = y0 < MID ? 1 : -1;
  const s = r(1) < 0.68 ? toRoom : -toRoom;
  const sideline = (dir) => (dir > 0 ? W - 0.4 : 0.4);
  const deep = (k) => 2 + r(k) * 4;
  const yards = Number.isFinite(e.yards) ? e.yards : 0;

  const segs = [];
  const lines = [];
  const actors = [];
  const marks = [];
  let form = null;
  let label = '';
  let tone = 'gain';
  let nextY = y0;
  let flash = null;
  // Filled in once the ball's timeline is known.
  const later = [];

  const idx = (kind) => segs.findIndex((sg) => sg.kind === kind);
  // The yard line a scrimmage play ended on, in the snapping club's frame:
  // into the end zone for a score, into its own for a safety.
  const endYard = () => {
    const v = e.from + yards;
    if (e.scoring && v >= 100) return 100 + deep(7);
    if (e.scoring && v <= 0) return -(1 + r(7) * 2);
    return clamp(v, 0.5, 99.5);
  };
  const bend = (a, q, k) => (gap(a, q) > 4 ? [a, [(a[0] + q[0]) / 2, inside((a[1] + q[1]) / 2 + (r(k) - 0.5) * 8)], q] : [a, q]);
  // A loose ball or a pick run back the other way from `p`, on yard line `v`,
  // by `ret` yards; into the snapping club's own end zone for a score.
  const runBack = (p, v, ret) => {
    const endV = e.scoring ? -deep(8) : clamp(v - (ret || 0), 0.5, 99.5);
    const q = [X(endV), inside(p[1] - s * r(9) * 8)];
    segs.push({ kind: 'return', pts: bend(p, q, 10) });
    nextY = hashIn(q[1]);
    if (e.scoring) flash = side === 0 ? 'left' : 'right';
    return q;
  };

  // A flag on a return: thrown where the run was stopped, and the ball walked
  // back from there to where it was spotted.
  const walkBack = (q, toV) => {
    const p = [X(clamp(toV, 0.5, 99.5)), q[1]];
    segs.push({ kind: 'walk', pts: [q, p] });
    marks.push({ kind: 'flag', at: [q[0], inside(q[1] - 2.5)] });
    label += ' \u00b7 flag';
    nextY = hashIn(p[1]);
  };
  const x0 = pat ? 0 : X(e.from);
  const snapTo = (v) => segs.push({ kind: 'snap', pts: [[x0, y0], [X(v), y0]] });

  if (e.type === 'penalty') {
    form = formation(x0, y0, d, s);
    segs.push({ kind: 'walk', pts: [[x0, y0], [X(clamp(e.from + yards, 0.5, 99.5)), y0]] });
    marks.push({ kind: 'flag', at: [x0 + d * 0.6, inside(y0 - 2.5)] });
    label = `Flag ${yards >= 0 ? '+' : '−'}${Math.abs(yards)}`;
    tone = 'flag';
  } else if (e.type === 'kneel' || e.type === 'spike') {
    form = formation(x0, y0, d, s, { qb: false });
    const qb = [X(e.from - 1), y0];
    snapTo(e.from - 1);
    segs.push({ kind: 'drop', pts: [qb, [X(clamp(e.from + yards, 0.5, 99.5)), y0]] });
    later.push(() => actors.push(track('off', [still(qb)])));
    label = e.type === 'kneel' ? 'Kneel' : 'Spike';
    tone = 'none';
  } else if (e.type === 'punt') {
    // Fourteen yards back, or at the end line when the snap is closer to it.
    const back = e.from - Math.min(14, e.from + 9.5);
    const pn = [X(back), y0];
    snapTo(back);
    if (yards < 0) {
      // Blocked: it squirts back behind the line.
      const q = [X(clamp(e.to ?? e.from + yards, 0.5, 99.5)), inside(y0 + (r(5) - 0.5) * 8)];
      segs.push({ kind: 'return', pts: [pn, q] });
      marks.push({ kind: 'burst', at: [X(e.from - 12), y0] });
      label = 'Blocked punt';
      tone = 'turn';
      nextY = hashIn(q[1]);
    } else {
      // A save from before punts recorded where they came down lands them
      // where the return finished.
      const landV = e.land ?? (e.scoring || e.to == null ? e.from + 40 : e.to);
      const land = [X(clamp(landV, 0, 109)), inside(y0 + (r(5) - 0.5) * 18, 4)];
      segs.push({ kind: 'kick', pts: arc(pn, land, 0.04 * s) });
      const touchback = landV >= 100 && !e.scoring;
      const gross = Math.round((touchback ? 100 : landV) - e.from);
      const ranV = e.ran ?? e.to;
      if (e.scoring || (!touchback && ranV < landV)) {
        const q = e.scoring ? [X(-deep(8)), inside(land[1] + (r(8) - 0.5) * 20)] : [X(clamp(ranV, 0.5, 99.5)), inside(land[1] + (r(8) - 0.5) * 14)];
        segs.push({ kind: 'return', pts: bend(land, q, 9) });
        label = e.scoring ? 'Punt return touchdown' : `Punt ${gross} · ${Math.round(landV - ranV)}-yd return`;
        tone = e.scoring ? 'turn' : 'kick';
        nextY = hashIn(q[1]);
        if (e.scoring) flash = side === 0 ? 'left' : 'right';
        if (e.ran != null) walkBack(q, e.to);
      } else {
        label = touchback ? `Punt ${gross} · touchback` : `Punt ${gross} · fair catch`;
        tone = 'kick';
        nextY = touchback ? MID : hashIn(land[1]);
      }
    }
  } else if (e.type === 'fg') {
    const h = [X(e.from - 7), y0];
    snapTo(e.from - 7);
    const dist = Math.round(100 - e.from + 17);
    if (e.miss === 'blocked') {
      segs.push({ kind: 'return', pts: [h, [X(e.from - 9), inside(y0 + (r(5) - 0.5) * 8)]] });
      marks.push({ kind: 'burst', at: [X(e.from - 6), y0] });
      label = `${dist}-yd field goal blocked`;
      tone = 'turn';
    } else {
      // Facing up the field, the kicker's right hand is toward +y when he
      // kicks to the right and toward -y when he kicks to the left.
      const target = e.scoring ? [X(110), MID + (r(5) - 0.5) * 2]
        : e.miss === 'short' ? [X(103 + r(5) * 4), MID + (r(6) - 0.5) * 3]
          : [X(110), MID + d * (e.miss === 'wide left' ? -1 : 1) * (5.5 + r(5) * 3)];
      segs.push({ kind: 'kick', pts: arc(h, target, 0.03) });
      label = `${dist}-yd field goal ${e.scoring ? 'good' : 'no good'}`;
      tone = e.scoring ? 'score' : 'turn';
    }
    nextY = e.scoring ? MID : hashIn(y0);
  } else if (KICKOFFS.has(e.type)) {
    // In the kicking club's frame: from its 35, or its 20 after a safety.
    const k = [X(e.from), MID];
    if (e.onside) {
      const land = [X(clamp(e.land ?? e.to, 0.5, 99.5)), inside(MID + (r(5) - 0.5) * 20, 4)];
      segs.push({ kind: 'kick', pts: arc(k, land, 0.02) });
      const kept = e.off === side;
      label = kept ? 'Onside kick recovered' : 'Onside kick fails';
      tone = kept ? 'score' : 'kick';
      nextY = hashIn(land[1]);
    } else if (e.land == null) {
      segs.push({ kind: 'kick', pts: arc(k, [X(103 + r(5) * 6), MID + (r(6) - 0.5) * 12], 0.03) });
      label = 'Kickoff · touchback';
      tone = 'kick';
      nextY = MID;
    } else {
      const land = [X(clamp(e.land, 0.5, 109)), inside(MID + (r(5) - 0.5) * 16, 6)];
      segs.push({ kind: 'kick', pts: arc(k, land, 0.03) });
      const ranV = e.ran ?? e.to;
      const q = e.scoring ? [X(-deep(8)), inside(land[1] + (r(7) - 0.5) * 24)] : [X(clamp(ranV, 0.5, 99.5)), inside(land[1] + (r(7) - 0.5) * 18, 2)];
      segs.push({ kind: 'return', pts: bend(land, q, 9) });
      label = e.scoring ? 'Kickoff return touchdown' : `Kickoff · ${Math.round(Math.min(e.land, 100) - ranV)}-yd return`;
      tone = e.scoring ? 'turn' : 'kick';
      nextY = hashIn(q[1]);
      if (e.scoring) flash = side === 0 ? 'left' : 'right';
      if (e.ran != null) walkBack(q, e.to);
    }
  } else if (pat) {
    const good = !!e.scoring;
    if (e.type === 'xp') {
      const k = [X(78), MID];
      segs.push({ kind: 'snap', pts: [[X(85), MID], k] });
      segs.push({ kind: 'kick', pts: arc(k, [X(110), good ? MID + (r(5) - 0.5) * 2 : MID + (r(5) < 0.5 ? -1 : 1) * (4.5 + r(6) * 2)], 0.02) });
      label = `Extra point ${good ? 'good' : 'no good'}`;
    } else if (e.call === 'pass_short') {
      const c = [X(100 + 1 + r(5) * 3), inside(MID + (r(6) < 0.5 ? -1 : 1) * (4 + r(7) * 8))];
      segs.push({ kind: 'snap', pts: [[X(98), MID], [X(93), MID]] });
      segs.push({ kind: 'throw', pts: arc([X(93), MID], c, 0.06) });
      if (!good) marks.push({ kind: 'x', at: c });
      label = `Two-point try ${good ? 'good' : 'no good'}`;
    } else {
      segs.push({ kind: 'snap', pts: [[X(98), MID], [X(95), MID]] });
      segs.push({ kind: 'carry', pts: [[X(95), MID], good ? [X(101 + r(5) * 2), MID + (r(6) - 0.5) * 4] : [X(99), MID + (r(6) - 0.5) * 4]] });
      label = `Two-point try ${good ? 'good' : 'no good'}`;
    }
    tone = good ? 'score' : 'turn';
    nextY = MID;
  } else if (e.type === 'sack' || (e.type === 'fumble' && PASSES.has(e.call) && e.air == null)) {
    // Sacked, or stripped in the pocket.
    form = formation(x0, y0, d, s, { qb: false, lbs: 2 });
    const qb0 = [X(e.from - 4.5), y0];
    const q = [X(e.from - (DROP[e.call] ?? 6)), y0];
    const sp = [X(endYard()), inside(y0 + (r(5) - 0.5) * 4)];
    snapTo(e.from - 4.5);
    segs.push({ kind: 'drop', pts: [qb0, q] });
    segs.push({ kind: 'carry', pts: [q, sp], loss: true });
    marks.push({ kind: 'burst', at: sp });
    const lost = e.type === 'fumble';
    if (lost) runBack(sp, e.from + yards, e.ret);
    else nextY = e.scoring ? MID : hashIn(sp[1]);
    label = lost ? 'Strip sack' : e.scoring ? 'Safety' : `Sack ${signed(yards)}`;
    tone = lost || e.scoring ? 'turn' : 'loss';
    later.push((ball) => {
      actors.push(track('off', [still(qb0), span(ball, 1), span(ball, 2)]));
      actors.push(closer('def', [X(e.from + 1), inside(y0 + s * (2 + r(6) * 3))], sp, ball.wins[1][0], ball.wins[2][1]));
      if (lost) actors.push(track('def', [still(sp), span(ball, 3)]));
    });
  } else if (e.type === 'run' || (e.type === 'fumble' && !PASSES.has(e.call))) {
    const endV = endYard();
    const ex = X(endV);
    const scramble = PASSES.has(e.call);
    const lost = e.type === 'fumble';
    const td = e.scoring && endV > 100;
    let start;
    if (scramble) {
      form = formation(x0, y0, d, s, { qb: false, lbs: 2 });
      start = [X(e.from - 4.5), y0];
      const q = [X(e.from - (DROP[e.call] ?? 5)), y0];
      const yEnd = e.oob ? sideline(s) : inside(y0 + s * (8 + r(3) * 9));
      snapTo(e.from - 4.5);
      segs.push({ kind: 'drop', pts: [start, q] });
      segs.push({ kind: 'carry', pts: [q, [X(e.from - 3.5), inside(y0 + s * 6)], [ex, yEnd]], loss: yards < 0 });
    } else {
      const outside = e.call === 'run_out';
      form = formation(x0, y0, d, s, { qb: false, rb: false, lbs: 2 });
      form.off.push([X(e.from - 1.2), y0]);
      start = [X(e.from - 6.5), y0];
      const mesh = [X(e.from - 3), y0 + s * (outside ? 2 : 0.8)];
      let pts;
      if (outside) {
        const lane = inside(y0 + s * (9 + r(3) * 6), 2);
        const yEnd = e.oob ? sideline(s) : inside(lane + s * r(4) * 4);
        pts = yards <= 0 ? [mesh, [ex, e.oob ? yEnd : inside(y0 + s * (4 + r(4) * 3))]] : [mesh, [X(e.from + 0.5), lane], [ex, yEnd]];
      } else {
        const lane = y0 + s * (0.4 + r(3) * 2.4);
        const yEnd = e.oob ? sideline(s) : inside(lane + (r(4) - 0.5) * Math.min(10, Math.abs(yards) * 0.5));
        // Stopped at or behind the line; bounced all the way out if it went out.
        pts = yards <= 0 ? [mesh, [ex, e.oob ? yEnd : lane]] : [mesh, [X(e.from + 0.3), lane], [ex, yEnd]];
      }
      snapTo(e.from - 1.2);
      segs.push({ kind: 'snap', pts: [[X(e.from - 1.2), y0], mesh] });
      segs.push({ kind: 'carry', pts, loss: yards < 0 });
    }
    const endPt = segs[segs.length - 1].pts[segs[segs.length - 1].pts.length - 1];
    if (lost) { marks.push({ kind: 'burst', at: endPt }); runBack(endPt, e.from + yards, e.ret); }
    else nextY = e.scoring ? MID : hashIn(endPt[1]);
    if (td) flash = side === 0 ? 'right' : 'left';
    label = lost ? 'Fumble' : td ? 'Touchdown' : e.scoring ? 'Safety' : signed(yards);
    tone = lost || (e.scoring && !td) ? 'turn' : td ? 'score' : yards < 0 ? 'loss' : 'gain';
    later.push((ball) => {
      const c = idx('carry');
      // A scrambler has the ball from the snap; a back takes it at the mesh.
      actors.push(track('off', scramble ? [still(start), span(ball, idx('drop')), span(ball, c)] : [still(start), span(ball, c)]));
      if (!td && !e.oob) actors.push(closer('def', [X(clamp(endV + 5 * (0.3 + r(8)), 0, 100)), inside(endPt[1] + (r(9) - 0.5) * 12)], endPt, 0.55 * ball.wins[c][1], ball.wins[c][1]));
      if (lost) actors.push(track('def', [still(endPt), span(ball, idx('return'))]));
    });
  } else if (e.type === 'pass' || e.type === 'incomplete' || e.type === 'int' || e.type === 'fumble') {
    const drop = DROP[e.call] ?? 5;
    const qb0 = [X(e.from - 4.5), y0];
    const q = [X(e.from - drop), y0];
    const [lo, hi] = WIDE[e.call] || [5, 16];
    const yc = inside(y0 + s * (lo + r(5) * (hi - lo)), 1.5);
    snapTo(e.from - 4.5);
    segs.push({ kind: 'drop', pts: [qb0, q] });
    if (e.type === 'incomplete' && e.air == null) {
      // Thrown away: out of bounds, short of anybody.
      form = formation(x0, y0, d, s, { qb: false });
      segs.push({ kind: 'throw', pts: arc(q, [X(e.from + 2 + r(5) * 10), s > 0 ? W - 0.2 : 0.2], 0.05 * s) });
      label = 'Thrown away';
      tone = 'none';
      later.push((ball) => actors.push(track('off', [still(qb0), span(ball, 1)])));
    } else {
      form = formation(x0, y0, d, s, { qb: false, wrs: 2, lbs: 2 });
      const catchV = e.type === 'int' ? (e.at ?? e.from + (e.air ?? 10)) : e.from + (e.air ?? 0);
      const c = [X(clamp(catchV, 0, 109)), yc];
      const align = e.call === 'screen' ? [X(e.from - 0.7), inside(yc - s * 2, 1.5)] : [X(e.from - 0.7), inside(yc + s * (r(6) - 0.3) * 6, 2)];
      segs.push({ kind: 'throw', pts: arc(q, c, 0.07 * s) });
      const route = e.call === 'pass_deep' ? [align, [X(clamp(e.from + (catchV - e.from) * 0.45, 0, 109)), inside(align[1] + (yc - align[1]) * 0.2)], c] : [align, c];
      let endPt = c;
      const caught = e.type === 'pass' || e.type === 'fumble';
      if (caught) {
        const endV = Math.max(endYard(), Math.min(catchV, 109));
        endPt = [X(endV), e.oob ? sideline(s) : inside(yc + (r(7) - 0.5) * Math.min(12, Math.abs(endV - catchV)))];
        if (gap(c, endPt) > 0.3) segs.push({ kind: 'carry', pts: [c, endPt] });
      }
      const td = e.scoring && e.type === 'pass';
      if (e.type === 'pass') {
        nextY = e.scoring ? MID : hashIn(endPt[1]);
        if (td) flash = side === 0 ? 'right' : 'left';
        label = td ? 'Touchdown' : signed(yards);
        tone = td ? 'score' : yards < 0 ? 'loss' : 'gain';
      } else if (e.type === 'incomplete') {
        marks.push({ kind: 'x', at: c });
        label = 'Incomplete';
        tone = 'none';
      } else if (e.type === 'int') {
        const touchback = catchV >= 100 && (e.ret || 0) < 5 && !e.scoring;
        if (touchback) nextY = MID;
        else runBack(c, catchV, e.ret);
        label = e.scoring ? 'Pick six' : touchback ? 'Intercepted · touchback' : 'Intercepted';
        tone = 'turn';
      } else {
        marks.push({ kind: 'burst', at: endPt });
        runBack(endPt, e.from + yards, e.ret);
        label = 'Fumble';
        tone = 'turn';
      }
      later.push((ball) => {
        const tCatch = ball.wins[2][1];
        actors.push(track('off', [still(qb0), span(ball, 1)]));
        // The receiver runs his route while the ball is in the air and is
        // caught up with at the catch; after it the ball is his.
        const legs = route.slice(1);
        const run = { pts: [align, ...legs], ts: [0, ...legs.map((_, k) => tCatch * ((k + 1) / legs.length))] };
        actors.push(track('off', caught && idx('carry') >= 0 ? [run, span(ball, idx('carry'))] : [run]));
        lines.push({ kind: 'route', pts: route, win: [0, tCatch] });
        const back = idx('return');
        if (e.type === 'int') {
          const hawk = [X(clamp(catchV + 4, 0, 105)), inside(yc - s * 4)];
          actors.push(track('def', back >= 0 ? [{ pts: [hawk, c], ts: [0, tCatch] }, span(ball, back)] : [{ pts: [hawk, c], ts: [0, tCatch] }]));
        } else if (e.type === 'fumble') {
          actors.push(track('def', [still(endPt), span(ball, back)]));
        } else if (e.type === 'pass' && !td && !e.oob) {
          const v = side === 0 ? endPt[0] : 100 - endPt[0];
          actors.push(closer('def', [X(clamp(v + 5 * (0.3 + r(8)), 0, 100)), inside(endPt[1] + (r(9) - 0.5) * 12)], endPt, Math.max(tCatch, 0.6)));
        } else if (e.type === 'incomplete') {
          actors.push(closer('def', [X(clamp(catchV + 3, 0, 105)), inside(yc - s * 3)], [c[0] + d * 0.8, inside(c[1] - s * 0.8)], 0, tCatch));
        }
      });
    }
  } else {
    return null;
  }

  const ball = timeline(segs);
  for (const [k, sg] of segs.entries()) {
    if (sg.kind === 'snap' || sg.kind === 'drop') continue;
    lines.push({ kind: sg.kind, pts: sg.pts, win: ball.wins[k], loss: !!sg.loss, turn: sg.kind === 'return' && tone === 'turn' });
  }
  for (const f of later) f(ball);
  if (!actors.length) {
    // Kicks: the man who kicked it, and whoever ran it back.
    const k = idx('kick');
    if (k >= 0) actors.push(track('off', [still(segs[k].pts[0])]));
    const back = idx('return');
    if (back >= 0) actors.push(track('def', [still(segs[back].pts[0]), span(ball, back)]));
  }
  return { i, side, ball, lines, actors, marks, form, flash, end: ball.pts[ball.pts.length - 1], label, tone, nextY, seconds: ball.seconds };
}

/**
 * Every play in a log drawn in order, the ball carried across the field from
 * one to the next. Sparse: an event that is not a play has no entry.
 */
export function playShapes(log) {
  const out = [];
  let y = MID;
  for (let k = 0; k < (log || []).length; k++) {
    const e = log[k];
    const restart = KICKOFFS.has(e.type) || e.type === 'xp' || e.type === '2pt';
    const shape = playShape(e, restart ? MID : y);
    if (shape) { out[k] = shape; y = shape.nextY; }
  }
  return out;
}

// The live screen redraws the whole view after every snap, and a game runs to
// two hundred events; the chain only ever grows, so it is extended rather than
// rebuilt.
let memo = { log: null, n: 0, y: MID, shapes: [] };
function shapesOf(log) {
  if (memo.log !== log || memo.n > log.length) memo = { log, n: 0, y: MID, shapes: [] };
  for (let k = memo.n; k < log.length; k++) {
    const e = log[k];
    const restart = KICKOFFS.has(e.type) || e.type === 'xp' || e.type === '2pt';
    const shape = playShape(e, restart ? MID : memo.y);
    if (shape) { memo.shapes[k] = shape; memo.y = shape.nextY; }
  }
  memo.n = log.length;
  return memo.shapes;
}

/** The latest play in a game's log and how it is drawn, or null before the first. */
export function latestPlay(g) {
  const shapes = shapesOf(g.log || []);
  for (let k = shapes.length - 1; k >= 0; k--) if (shapes[k]) return { k, shape: shapes[k] };
  return null;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const n2 = (v) => Math.round(v * 100) / 100;
const pathD = (pts) => `M${pts.map(([x, y]) => `${n2(x)} ${n2(y)}`).join(' L')}`;
const TONE = { gain: '#ffffff', loss: '#ff8f7a', turn: '#ff8f7a', score: '#e9c46a', flag: '#f2d14b', kick: '#ffffff', none: '#dfe9e1' };

function lineStyle(l) {
  if (l.kind === 'throw') return 'stroke="#fff" stroke-width=".42" stroke-dasharray="1.3 .9" stroke-linecap="round" opacity=".9"';
  if (l.kind === 'kick') return 'stroke="#fff" stroke-width=".4" stroke-dasharray=".05 .95" stroke-linecap="round" opacity=".85"';
  if (l.kind === 'route') return 'stroke="#fff" stroke-width=".28" opacity=".45" stroke-linecap="round"';
  if (l.kind === 'walk') return 'stroke="#f2d14b" stroke-width=".5" stroke-linecap="round"';
  if (l.kind === 'return') return `stroke="${l.turn ? '#ff8f7a' : '#f4d58d'}" stroke-width=".6" stroke-linecap="round" stroke-linejoin="round"`;
  return `stroke="${l.loss ? '#ff8f7a' : '#fff'}" stroke-width=".6" stroke-linecap="round" stroke-linejoin="round"`;
}

/** Key points along a polyline for `animateMotion`: the share of its length reached at each time. */
function motion(pts, ts) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + gap(pts[k - 1], pts[k]));
  const total = cum.at(-1);
  if (total < 0.05) return null;
  const keyPoints = cum.map((c) => n2(Math.min(1, c / total) * 1000) / 1000);
  const keyTimes = ts.map((t) => Math.round(t * 1000) / 1000);
  for (let k = 1; k < keyTimes.length; k++) if (keyTimes[k] < keyTimes[k - 1]) keyTimes[k] = keyTimes[k - 1];
  keyTimes[0] = 0; keyTimes[keyTimes.length - 1] = 1;
  return { path: pathD(pts), keyPoints: keyPoints.join(';'), keyTimes: keyTimes.join(';') };
}

function mover(inner, pts, ts, dur, animate, extra = '') {
  const m = animate ? motion(pts, ts) : null;
  if (!m) { const [x, y] = pts.at(-1); return `<g transform="translate(${n2(x)} ${n2(y)})"${extra}>${inner}</g>`; }
  return `<g${extra}><animateMotion dur="${dur}s" fill="freeze" calcMode="linear" keyPoints="${m.keyPoints}" keyTimes="${m.keyTimes}" path="${m.path}"/>${inner}</g>`;
}

const at = (v) => Math.round(v * 1000) / 1000;

/**
 * The field as SVG markup: markings, both end zones, the ground this drive
 * has covered, the line of scrimmage and the line to gain, the drive's
 * earlier plays faintly, and the latest play — animated over `seconds` when
 * `animate`, otherwise drawn as it finished.
 */
export function fieldSvg(g, { animate = false, seconds = null } = {}) {
  const last = latestPlay(g);
  const play = last ? last.shape : null;
  const live = g.phase === 'play' && !g.final;
  const off = g.possession;
  const X = (side, v) => (side === 0 ? v : 100 - v);
  const T = seconds ?? (play ? naturalSeconds(play) : 1);

  const out = ['<svg class="field" viewBox="-10 0 120 53.33" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">'];
  markings(g.teams, out);
  if (play?.flash && animate) out.push(flashSvg(play, T));
  // This drive's ground, in the attacking club's colour.
  if (live && g.drive && Number.isFinite(g.drive.startBallOn)) {
    const a = X(off, g.drive.startBallOn), b = X(off, g.ballOn);
    if (Math.abs(b - a) > 0.5) out.push(`<rect class="gained" x="${n2(Math.min(a, b))}" y="0" width="${n2(Math.abs(b - a))}" height="53.33" fill="${esc(g.teams[off].color)}" opacity=".2"/>`);
  }
  // The line of scrimmage and the line to gain for the snap to come.
  if (live) {
    const los = X(off, g.ballOn);
    out.push(`<path class="los" d="M${n2(los)} 0V53.33" stroke="#5aa9ff" stroke-width=".55"/>`);
    const togo = g.ballOn + g.toGo;
    if (togo < 100) out.push(`<path class="togo" d="M${n2(X(off, togo))} 0V53.33" stroke="#f2d14b" stroke-width=".55"/>`);
    const dd = off === 0 ? 1 : -1;
    out.push(`<path d="M${n2(los + dd * 0.9)} 1.1l${dd * 1.5} 1.05l${-dd * 1.5} 1.05z" fill="#5aa9ff"/>`);
  }
  if (play) out.push(playSvg(play, g.teams, { animate, seconds: T }));
  out.push('</svg>');
  return out.join('');
}

/**
 * One play on its own, for a recap: the field without the game's state on it
 * and, with `zoom`, cropped to the ground the play covered — kept in the
 * field's proportions, so a close-up sits in the same box as the whole field.
 */
export function playFieldSvg(play, teams, { animate = false, seconds = null, zoom = false, label = true } = {}) {
  const T = seconds ?? naturalSeconds(play);
  const [x, y, w, h] = zoom ? playBox(play) : [-10, 0, 120, W];
  const out = [`<svg class="field" viewBox="${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">`];
  markings(teams, out);
  if (play.flash && animate) out.push(flashSvg(play, T));
  out.push(playSvg(play, teams, { animate, seconds: T, label }));
  out.push('</svg>');
  return out.join('');
}

/** The ground a play covered, with a margin, in the field's proportions and inside its end lines. */
export function playBox(play) {
  const pts = [...play.ball.pts, ...play.lines.flatMap((l) => l.pts), ...play.actors.flatMap((a) => a.pts), ...play.marks.map((m) => m.at)];
  let x0 = Math.min(...pts.map((p) => p[0])) - 4, x1 = Math.max(...pts.map((p) => p[0])) + 4;
  let y0 = Math.min(...pts.map((p) => p[1])) - 4, y1 = Math.max(...pts.map((p) => p[1])) + 4;
  const ratio = 120 / W;
  let w = Math.max(x1 - x0, 34), h = y1 - y0;
  if (w / h < ratio) w = h * ratio; else h = w / ratio;
  if (h > W) { h = W; w = W * ratio; }
  if (w > 120) { w = 120; h = W; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  x0 = clamp(cx - w / 2, -10, 110 - w);
  y0 = clamp(cy - h / 2, 0, W - h);
  return [x0, y0, w, h];
}

/** Everything that does not move: turf, lines, numbers, uprights, both end zones. */
function markings(teams, out) {
  const [home, away] = teams;
  // Turf, mown in five-yard bands.
  out.push('<rect x="-10" y="0" width="120" height="53.33" fill="var(--field-dark)"/>');
  for (let x = 0; x < 100; x += 10) out.push(`<rect x="${x}" y="0" width="5" height="53.33" fill="var(--field)"/>`);
  // End zones in the clubs' colours, each defended by its own.
  for (const [t, x0] of [[home, -10], [away, 100]]) {
    const ink = textOn(t.color);
    out.push(`<rect x="${x0}" y="0" width="10" height="53.33" fill="${esc(t.color)}"/>`);
    out.push(`<text x="${x0 + 5}" y="${MID}" transform="rotate(${x0 < 0 ? -90 : 90} ${x0 + 5} ${MID})" text-anchor="middle" dominant-baseline="central" font-size="5.6" font-weight="800" letter-spacing=".6" fill="${ink}" opacity=".9">${esc(t.abbr)}</text>`);
  }
  // Lines every five yards, the goal lines heavier, and the hash marks.
  let lines = '';
  for (let x = 5; x < 100; x += 5) lines += `M${x} 0V53.33`;
  out.push(`<path d="${lines}" stroke="#fff" stroke-opacity=".38" stroke-width=".22"/>`);
  out.push('<path d="M0 0V53.33M100 0V53.33" stroke="#fff" stroke-opacity=".8" stroke-width=".45"/>');
  let hashes = '';
  for (let x = 1; x < 100; x++) {
    if (x % 5 === 0) continue;
    hashes += `M${x} ${HASH[0] - 0.7}V${HASH[0]}M${x} ${HASH[1]}V${HASH[1] + 0.7}M${x} .25V1M${x} 52.33V53.08`;
  }
  out.push(`<path d="${hashes}" stroke="#fff" stroke-opacity=".32" stroke-width=".16"/>`);
  for (let x = 10; x < 100; x += 10) {
    const n = x > 50 ? 100 - x : x;
    // Solid white: at any transparency the lighter turf takes them under 4.5:1.
    out.push(`<text x="${x}" y="8.6" text-anchor="middle" font-size="3.2" font-weight="700" fill="#fff">${n}</text>`);
    out.push(`<text x="${x}" y="47.2" text-anchor="middle" font-size="3.2" font-weight="700" fill="#fff">${n}</text>`);
  }
  // The uprights at each end line, seen from above.
  out.push(`<path d="M-9.6 ${MID - 3.08}V${MID + 3.08}M109.6 ${MID - 3.08}V${MID + 3.08}" stroke="#f2d14b" stroke-width=".5" stroke-linecap="round"/>`);
}

/** The end zone a score went into, lit as it lands. */
function flashSvg(play, T) {
  const x0 = play.flash === 'left' ? -10 : 100;
  return `<rect x="${x0}" y="0" width="10" height="53.33" fill="#fff" opacity="0"><animate attributeName="opacity" values="0;0;.55;.15" keyTimes="0;.82;.9;1" dur="${n2(T + 0.6)}s" fill="freeze"/></rect>`;
}

/** How long a play takes on screen when nothing is hurrying it. */
export function naturalSeconds(play) {
  return Math.round(clamp(0.3 + play.seconds * 0.42, 0.55, 2.1) * 100) / 100;
}

function playSvg(p, teams, { animate, seconds, label = true }) {
  const T = Math.max(0.25, seconds);
  const out = ['<g class="play">'];
  const color = (team) => teams[team === 'off' ? p.side : 1 - p.side].color;
  // The men at the snap, faint, fading as the play runs.
  if (p.form) {
    const dots = (pts, team) => pts.map(([x, y]) => `<circle cx="${n2(x)}" cy="${n2(y)}" r=".72" fill="${esc(color(team))}" stroke="${team === 'off' ? '#fff' : '#0b1a10'}" stroke-width=".22"/>`).join('');
    out.push(`<g class="form" opacity="${animate ? '.75' : '.38'}">${animate ? `<animate attributeName="opacity" values=".75;.75;.38" keyTimes="0;.3;1" dur="${T}s" fill="freeze"/>` : ''}${dots(p.form.off, 'off')}${dots(p.form.def, 'def')}</g>`);
  }
  for (const l of p.lines) {
    const d = pathD(l.pts);
    const [t0, t1] = l.win.map(at);
    if (!animate) { out.push(`<path d="${d}" fill="none" ${lineStyle(l)}/>`); continue; }
    if (l.kind === 'throw' || l.kind === 'kick') {
      out.push(`<path d="${d}" fill="none" ${lineStyle(l)} visibility="hidden"><set attributeName="visibility" to="visible" begin="${n2(t0 * T)}s" fill="freeze"/></path>`);
    } else {
      out.push(`<path d="${d}" fill="none" ${lineStyle(l)} pathLength="1" stroke-dasharray="1 2" stroke-dashoffset="1.01"><animate attributeName="stroke-dashoffset" values="1.01;1.01;0;0" keyTimes="0;${t0};${Math.max(t0, t1)};1" dur="${T}s" fill="freeze"/></path>`);
    }
  }
  for (const m of p.marks) {
    const [x, y] = m.at.map(n2);
    let body = '';
    if (m.kind === 'x') body = `<path d="M${x - 0.9} ${y - 0.9}L${x + 0.9} ${y + 0.9}M${x - 0.9} ${y + 0.9}L${x + 0.9} ${y - 0.9}" stroke="#ff8f7a" stroke-width=".45" stroke-linecap="round"/>`;
    else if (m.kind === 'burst') body = `<circle cx="${x}" cy="${y}" r="1.5" fill="none" stroke="#ff8f7a" stroke-width=".4"/><circle cx="${x}" cy="${y}" r=".45" fill="#ff8f7a"/>`;
    else if (m.kind === 'flag') body = `<path d="M${x} ${y + 1.1}V${y - 1.3}l1.5 .55l-1.5 .6" fill="#f2d14b" stroke="#f2d14b" stroke-width=".25" stroke-linejoin="round"/>`;
    out.push(animate ? `<g opacity="0">${body}<animate attributeName="opacity" values="0;0;1" keyTimes="0;.8;1" dur="${T}s" fill="freeze"/></g>` : body);
  }
  for (const a of p.actors) {
    const dot = `<circle r="1.25" fill="${esc(color(a.team))}" stroke="${a.team === 'off' ? '#fff' : '#0b1a10'}" stroke-width=".34"/>`;
    out.push(mover(dot, a.pts, a.ts, T, animate));
  }
  // The ball: a leather ellipse that turns along its path, and swells in
  // flight so a throw and a kick read as in the air rather than on the grass.
  const flights = p.lines.filter((l) => l.kind === 'throw' || l.kind === 'kick');
  let swell = '';
  if (animate && flights.length) {
    const [t0, t1] = flights[0].win.map(at);
    const tm = at((t0 + t1) / 2);
    if (t1 > t0 + 0.01) swell = `<animateTransform attributeName="transform" type="scale" values="1;1;${flights[0].kind === 'kick' ? 2.1 : 1.6};1;1" keyTimes="0;${t0};${tm};${t1};1" dur="${T}s" fill="freeze"/>`;
  }
  const ball = `<ellipse class="fb" rx=".72" ry=".46" fill="#8b4513" stroke="#fff" stroke-width=".16">${swell}</ellipse>`;
  const bm = animate ? motion(p.ball.pts, p.ball.ts) : null;
  if (bm) out.push(`<g class="ballg"><animateMotion dur="${T}s" fill="freeze" calcMode="linear" rotate="auto" keyPoints="${bm.keyPoints}" keyTimes="${bm.keyTimes}" path="${bm.path}"/>${ball}</g>`);
  else { const [x, y] = p.end; out.push(`<g class="ballg" transform="translate(${n2(x)} ${n2(y)})">${ball}</g>`); }
  // What it came to, beside where it ended.
  if (p.label && label) {
    const [ex, ey] = p.end;
    // Centred on where the play ended, unless that would run it past an end
    // line; then it is set flush against the line, which holds whatever the
    // width of the face — an estimate of it clipped "Touchdown" on a wider one.
    const half = p.label.length * 2.9 * 0.36 + 0.6;
    const [lx, anchor] = ex > 110 - half ? [109.4, 'end'] : ex < -10 + half ? [-9.4, 'start'] : [ex, 'middle'];
    const ly = ey < 9 ? ey + 5.2 : ey - 2.6;
    const txt = `<text class="plabel" x="${n2(lx)}" y="${n2(ly)}" text-anchor="${anchor}" font-size="2.9" font-weight="800" fill="${TONE[p.tone] || '#fff'}" stroke="#0b2014" stroke-width=".75" paint-order="stroke" stroke-linejoin="round">${esc(p.label)}</text>`;
    out.push(animate ? `<g opacity="0">${txt}<animate attributeName="opacity" values="0;0;1" keyTimes="0;.88;1" dur="${T}s" fill="freeze"/></g>` : txt);
  }
  out.push('</g>');
  return out.join('');
}
