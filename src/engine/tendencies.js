// What the other side has called in this game, read back from the log.
//
// Coach mode hands the human one side's calls and leaves the other to the AI,
// whose choice leans on the down, the distance and the field (playcall.js,
// `chooseDefense` and `chooseOffense`) and on the club's own dials and game
// plan. None of that is shown, which is right: a real coordinator does not get
// the other side's call sheet. What he gets is what they have shown him, and
// every snap in the log already carries both calls. This reads them back by
// the situation they were called in, so a player can notice a club that
// blitzes on third and long and make it pay.
//
// Counts, not percentages. After a quarter there are a handful of snaps in any
// one situation, and "3 of 5" says how little that is where "60%" hides it.
//
// Nothing here is stored. It is read from `g.log` on every draw, so a game in
// progress from before this existed has its board the moment it is opened.

import { CALL_GRID, OFFENSE_CALLS, DEFENSE_CALLS } from './playcall.js';
import { expectedPoints } from './winprob.js';
import { clamp } from './rng.js';

/**
 * The situations a board is split by, in the order it lists them.
 *
 * They follow what the AI's calls actually lean on. `chooseDefense` moves its
 * weights on first down, on second to fourth down with two yards or less, on
 * third or fourth down with seven or more, and inside the opponent's ten, and
 * `chooseOffense` throws far more on third and long than on third and short.
 * Second down with room to spare and third down with three to six are split
 * even though the defence treats them alike, because the offence does not, and
 * a player reads them as different downs. Fourth downs count with third.
 */
export const SITUATIONS = [
  { key: 'first', label: '1st down', phrase: 'on 1st down' },
  { key: 'second', label: '2nd down', phrase: 'on 2nd down' },
  { key: 'medium', label: '3rd & 3–6', phrase: 'on 3rd & medium' },
  { key: 'long', label: '3rd & 7+', phrase: 'on 3rd & long' },
  { key: 'short', label: 'Short yardage', phrase: 'in short yardage' },
  { key: 'goal', label: 'Inside the 10', phrase: 'inside the 10' },
];

/** Which of the SITUATIONS a snap from this down, distance and spot belongs to. */
export function situationKey({ down, toGo, ballOn }) {
  if (ballOn >= 90) return 'goal';
  if (down === 1) return 'first';
  if (toGo <= 2) return 'short';
  if (down === 2) return 'second';
  return toGo >= 7 ? 'long' : 'medium';
}

// The down and distance a snap was called on. A play's own entry carries the
// down and distance *after* it (game.js, `logEvent` snapshots the game once
// the play has moved it), so the snap's are read back from the line the
// play-by-play prints in front of it, which game.js writes from the state at
// the call: "Q3 4:12 · 3rd & 7 at DAL 35", or "1st & Goal". The yard line is
// `from`, which the entry carries as a number. tests/tendencies.test.js holds
// this to the live state before every snap of a run of games.
const SITUATION_RE = /· (1st|2nd|3rd|4th) & (Goal|\d+) at /;
const ORDINAL = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };

/** `{ down, toGo, ballOn }` at the snap of a logged play, or null for anything that is not one. */
export function snapState(e) {
  if (!e || typeof e.situation !== 'string' || typeof e.from !== 'number') return null;
  const m = SITUATION_RE.exec(e.situation);
  if (!m) return null;
  return { down: ORDINAL[m[1]], toGo: m[2] === 'Goal' ? 100 - e.from : Number(m[2]), ballOn: e.from };
}

// The fourth-down arithmetic's prices (playcall.js, `byExpectedPoints`): a
// fresh first and ten is worth `expectedPoints` from its spot, and a kickoff
// hands the other side the ball at its own 25.
const firstAndTen = (spot) => expectedPoints(clamp(spot, 1, 99), 1, 10);
const KICKED_TO = 25;

/**
 * What a snap added to the snapping club's expected points: the value of what
 * it left behind less the value of what it started from, on the same curve the
 * fourth-down calls and the win probability run on.
 *
 * Yards would be the obvious measure and it is the wrong one for a board
 * organised by down and distance. Two yards on third and one is a first down
 * and two yards on third and eight is a punt; a pick thrown forty yards
 * downfield is no yards at all. Points price all of that the same way.
 *
 * A score is its points and then the ball handed to the other side, which is
 * how the fourth-down arithmetic prices a field goal; a touchdown counts the
 * extra point as made. A turnover is what the other side's first down is
 * worth from where they take over, costed to the club that gave it up.
 */
export function pointsAdded(e, before = [0, 0]) {
  const at = snapState(e);
  if (!at || typeof e.snapOff !== 'number' || !Array.isArray(e.score)) return null;
  const off = e.snapOff, def = 1 - off;
  const start = expectedPoints(at.ballOn, at.down, at.toGo);
  const ours = e.score[off] - (before[off] || 0), theirs = e.score[def] - (before[def] || 0);
  const handOver = firstAndTen(KICKED_TO);
  let end;
  if (ours >= 6) end = 7 - handOver;
  else if (theirs >= 6) end = -(7 - handOver);
  // A safety is two points and the free kick, and the club that scored it
  // takes the free kick.
  else if (theirs === 2) end = -2 - handOver;
  // Where the other side takes over, as game.js spots it (applyOutcome).
  else if (e.type === 'int') end = -firstAndTen(e.at >= 100 && (e.ret || 0) < 5 ? 20 : 100 - e.at + (e.ret || 0));
  else if (e.type === 'fumble') end = -firstAndTen(100 - clamp(at.ballOn + (e.yards || 0), 1, 99) + (e.ret || 0));
  // Short on fourth down: logged before the ball changes hands, as a fifth down.
  else if (e.down > 4) end = -firstAndTen(100 - e.ballOn);
  else end = expectedPoints(e.ballOn, e.down, e.toGo);
  return end - start;
}

/**
 * Every scrimmage snap of the game, in order: who had the ball, both calls,
 * the down, distance and spot it was called on, its situation, and the points
 * it added. Kicks, kneels and spikes are left out, as `CALL_GRID` leaves them
 * out: nobody defends them. So are snaps a flag wiped out, which log the
 * penalty rather than the play.
 */
export function readSnaps(log) {
  const out = [];
  if (!Array.isArray(log)) return out;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (!e || !CALL_GRID[e.call] || !DEFENSE_CALLS[e.defCall]) continue;
    const at = snapState(e);
    if (!at || typeof e.snapOff !== 'number') continue;
    const points = pointsAdded(e, i > 0 ? log[i - 1].score : [0, 0]);
    out.push({ i, off: e.snapOff, call: e.call, defCall: e.defCall, ...at, key: situationKey(at), points });
  }
  return out;
}

/** Counts of `pick(snap)` by situation, and over all of them, for the snaps `keep` lets through. */
function tally(snaps, keep, pick, names) {
  const blank = () => ({ n: 0, calls: Object.fromEntries(names.map((k) => [k, 0])) });
  const by = Object.fromEntries(SITUATIONS.map((s) => [s.key, blank()]));
  const all = blank();
  for (const s of snaps) {
    if (!keep(s)) continue;
    const k = pick(s);
    for (const t of [by[s.key], all]) { t.n++; t.calls[k]++; }
  }
  return { by, all };
}

/** The looks the club on `side` has shown on defence, by situation. */
export function defenceTendency(snaps, side) {
  return tally(snaps, (s) => s.off !== side, (s) => s.defCall, Object.keys(DEFENSE_CALLS));
}

/**
 * Whether the club on `side` has run or thrown, by situation. Run or pass is
 * the whole of the question a defence is answering: against every pass in
 * `CALL_GRID` the deep shell gives up the least, and against both runs the
 * stacked box does.
 */
export function offenceTendency(snaps, side) {
  return tally(snaps, (s) => s.off === side, (s) => OFFENSE_CALLS[s.call].kind, ['run', 'pass']);
}

/**
 * Each call the club on `side` made with the ball against each look it met:
 * plays and points added, per cell, per call and per look. The same shape as
 * `CALL_GRID`, offence down the side and defence across, whichever of the two
 * the human is calling.
 */
export function callGrid(snaps, side) {
  const rows = {}, cols = {};
  const total = { n: 0, points: 0 };
  const add = (t, p) => { t.n++; t.points += p; };
  for (const s of snaps) {
    if (s.off !== side) continue;
    const row = rows[s.call] ||= { n: 0, points: 0, cells: {} };
    add(row, s.points);
    add(row.cells[s.defCall] ||= { n: 0, points: 0 }, s.points);
    add(cols[s.defCall] ||= { n: 0, points: 0 }, s.points);
    add(total, s.points);
  }
  return { rows, cols, total };
}
