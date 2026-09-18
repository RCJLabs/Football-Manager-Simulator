// What an AI general manager does between the auction and the final: read
// the matchup and adjust the play-calling for it, and drift the club's
// strategy sliders week to week in response to how the season is going.
// Personalities stay recognisable: drift is bounded around each one's base.

import { GM_PERSONALITIES } from '../data/teams.js';
import { clamp } from './rng.js';

const DEFAULT_STRATEGY = { passRate: 0.55, aggression: 0.4, tempo: 0.5, blitzRate: 0.25, deepShell: 0.2 };

export const DRIFT_LIMIT = 0.12;

/**
 * A game plan for one side against the other, from the two clubs' composite
 * ratings. Returns slider deltas the play-caller adds to the club's
 * strategy for this game, plus short notes for the matchup card.
 */
export function makeGameplan(mine, theirs) {
  const plan = { passRate: 0, blitzRate: 0, deepShell: 0, deep: 0, screen: 0, notes: [] };
  const protect = theirs.passRush - mine.passBlock;      // positive: their rush beats my line
  const ground = mine.runBlock - theirs.runStop;         // positive: my run game should travel
  const air = (mine.qb ? mine.qb.r.tha : 60) - theirs.covMed; // positive: my passer beats their coverage
  const deepEdge = (mine.wr && mine.wr.length ? Math.max(...mine.wr.map((p) => p.r.spd)) : 80) - theirs.defSpeed;
  if (protect > 5) { plan.passRate -= 0.06; plan.screen += 6; plan.deep -= 4; plan.notes.push('quick throws and screens to blunt the rush'); }
  if (ground > 5) { plan.passRate -= 0.08; plan.notes.push('lean on the run against a soft front'); }
  if (air > 8) { plan.passRate += 0.08; plan.notes.push('attack the coverage through the air'); }
  if (deepEdge > 6 && protect <= 5) { plan.deep += 5; plan.notes.push('take deep shots at a slow secondary'); }
  // Defense.
  const theirProtect = mine.passRush - theirs.passBlock; // positive: my rush beats their line
  const theirGround = theirs.runBlock - mine.runStop;
  const theirAir = (theirs.qb ? theirs.qb.r.tha : 60) - mine.covDeep;
  const replacementQb = !!(theirs.qb && theirs.qb.replacement);
  if (theirProtect > 5 || replacementQb) { plan.blitzRate += replacementQb ? 0.15 : 0.08; plan.notes.push(replacementQb ? 'blitz the fill-in quarterback' : 'bring pressure at a weak line'); }
  if (theirGround > 5) { plan.blitzRate -= 0.04; plan.deepShell -= 0.05; plan.notes.push('stack the box against their run game'); }
  if (theirAir > 8 && !replacementQb) { plan.deepShell += 0.08; plan.blitzRate -= 0.03; plan.notes.push('keep a shell over the top of their passer'); }
  return plan;
}

/** Strategy for a club this game: its sliders plus the plan, clamped to the slider ranges. */
export function effectiveStrategy(strategy, plan) {
  if (!plan) return strategy;
  return {
    ...strategy,
    passRate: clamp(strategy.passRate + (plan.passRate || 0), 0.3, 0.75),
    blitzRate: clamp(strategy.blitzRate + (plan.blitzRate || 0), 0.05, 0.6),
    deepShell: clamp(strategy.deepShell + (plan.deepShell || 0), 0, 0.6),
  };
}

/**
 * Weekly drift for every AI club, from its own season so far: throw more
 * when the passing game is the efficient one, gamble on defence when points
 * are pouring in, get aggressive when the playoff line is slipping away and
 * careful when it is safe. Every slider stays within DRIFT_LIMIT of the
 * personality's base, so a Ground & Pound club never becomes an Air Raid.
 */
export function aiAdjustStrategies(league, { fieldSize = 4, inField = () => false } = {}) {
  const teams = league.teams;
  const played = teams.map((t) => t.record.w + t.record.l + t.record.t);
  const avgPa = teams.reduce((s, t, i) => s + (played[i] ? t.record.pa / played[i] : 0), 0) / Math.max(1, teams.filter((_, i) => played[i]).length);
  const weeksTotal = league.schedule?.length || 14;
  const late = league.week >= Math.ceil(weeksTotal * 0.6);
  teams.forEach((t, i) => {
    if (t.isUser || !played[i]) return;
    const gm = GM_PERSONALITIES.find((g) => g.id === t.gm);
    const base = gm ? gm.strategy : DEFAULT_STRATEGY;
    const ts = t.seasonStats?.team || {};
    const ypa = ts.passAtt ? ts.passYds / ts.passAtt : 7;
    const ypc = ts.rushAtt ? ts.rushYds / ts.rushAtt : 4.2;
    const sackRate = ts.passAtt ? ts.sacksAllowed / (ts.passAtt + ts.sacksAllowed) : 0.06;
    const pa = t.record.pa / played[i];
    const s = { ...t.strategy };
    // Offence: follow the efficient unit; protect a passer who is getting hit.
    if (ypa - ypc * 1.6 > 1.0) s.passRate += 0.02; else if (ypc * 1.6 - ypa > 1.0) s.passRate -= 0.02;
    if (sackRate > 0.09) { s.passRate -= 0.02; s.tempo -= 0.02; }
    // Defence: gamble when the points are pouring in, sit back when they are not.
    if (pa > avgPa + 3) { s.blitzRate += 0.02; s.deepShell -= 0.01; } else if (pa < avgPa - 3) { s.blitzRate -= 0.01; s.deepShell += 0.01; }
    // The table: chase late, protect late.
    if (late) {
      if (inField(i)) { s.aggression -= 0.03; s.tempo -= 0.02; } else { s.aggression += 0.04; s.tempo += 0.02; }
    }
    for (const k of Object.keys(base)) s[k] = clamp(s[k], Math.max(0, base[k] - DRIFT_LIMIT), Math.min(1, base[k] + DRIFT_LIMIT));
    t.strategy = s;
  });
  void fieldSize;
}
