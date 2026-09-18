// Snake draft with value-over-replacement AI.
import { ROSTER_SLOTS, SLOT_COUNTS } from '../data/positions.js';
import { GM_PERSONALITIES } from '../data/teams.js';
import { overall } from './ratings.js';
import { RNG } from './rng.js';

export const TOTAL_ROUNDS = ROSTER_SLOTS.length;

// Positional impact on the simulation, used to scale value over replacement.
const POS_BASE = { QB: 2.6, RB: 1.15, WR: 1.0, TE: 0.8, OL: 0.75, DL: 0.9, LB: 0.8, CB: 1.1, S: 0.9, K: 0.5, P: 0.35 };

export function openSlots(team) {
  return ROSTER_SLOTS.filter((s) => !team.slots[s.id]);
}

export function openSlotsByPos(team) {
  const out = {};
  for (const s of openSlots(team)) out[s.pos] = (out[s.pos] || 0) + 1;
  return out;
}

export function createDraft(league, rng, { order = null, taken = {} } = {}) {
  const n = league.teams.length;
  const draft = {
    order: order ? order.slice() : rng.shuffle([...Array(n).keys()]),
    round: 1,
    pickInRound: 0,
    picks: [],
    taken: { ...taken },
    complete: false,
  };
  settlePointer(league, draft);
  return draft;
}

/** Move the pointer off any club whose roster is already full; end the draft when everyone's is. */
export function settlePointer(league, draft) {
  let guard = 0;
  while (!draft.complete && guard++ < TOTAL_ROUNDS * draft.order.length + 1) {
    if (league.teams.every((t) => openSlots(t).length === 0) || draft.round > TOTAL_ROUNDS) { draft.complete = true; return; }
    if (openSlots(league.teams[currentPicker(draft)]).length > 0) return;
    draft.pickInRound++;
    if (draft.pickInRound >= draft.order.length) { draft.pickInRound = 0; draft.round++; }
  }
  draft.complete = true;
}

/** Team index whose turn it is. */
export function currentPicker(draft) {
  const n = draft.order.length;
  const idx = draft.round % 2 === 1 ? draft.pickInRound : n - 1 - draft.pickInRound;
  return draft.order[idx];
}

export function overallPickNumber(draft) {
  return (draft.round - 1) * draft.order.length + draft.pickInRound + 1;
}

/** Players still available (from a pool array). */
export function availablePlayers(draft, pool) {
  return pool.filter((p) => draft.taken[p.id] == null);
}

/** League-wide open demand per position. */
function demandByPos(league) {
  const d = {};
  for (const t of league.teams) for (const [pos, n] of Object.entries(openSlotsByPos(t))) d[pos] = (d[pos] || 0) + n;
  return d;
}

/** Replacement-level overall per position: the Nth best available where N = league demand. */
function replacementLevels(available, demand) {
  const byPos = {};
  for (const p of available) (byPos[p.pos] ??= []).push(p);
  const out = {};
  for (const [pos, arr] of Object.entries(byPos)) {
    arr.sort((a, b) => overall(b) - overall(a));
    const need = Math.max(1, demand[pos] || 1);
    const idx = Math.min(arr.length - 1, need - 1);
    out[pos] = arr.length ? overall(arr[idx]) - 2 : 40;
  }
  return out;
}

/**
 * Rank available players for `teamIdx`. Returns [{ player, value }] sorted desc.
 */
export function rankForTeam(league, draft, pool, teamIdx, rng) {
  const team = league.teams[teamIdx];
  const open = openSlotsByPos(team);
  const available = availablePlayers(draft, pool);
  const demand = demandByPos(league);
  const repl = replacementLevels(available, demand);
  const gm = GM_PERSONALITIES.find((g) => g.id === team.gm) || GM_PERSONALITIES[0];
  const roundsLeft = TOTAL_ROUNDS - draft.round + 1;
  const openCount = openSlots(team).length;
  const ranked = [];
  for (const p of available) {
    if (!open[p.pos]) continue;
    const ovr = overall(p);
    let value = (ovr - (repl[p.pos] ?? 60)) * POS_BASE[p.pos] * (gm.pos[p.pos] ?? 1);
    if (gm.era) value *= gm.era(p.season);
    value += (ovr - 80) * 0.15; // slight preference for raw talent
    // Kickers/punters: wait until the last rounds unless forced.
    if ((p.pos === 'K' || p.pos === 'P') && draft.round <= TOTAL_ROUNDS - 3) value -= 15;
    // Forced needs: if a position's open slots equal rounds left, must fill.
    if (open[p.pos] >= roundsLeft) value += 100;
    // Don't hoard: second RB / fourth WR lower priority early.
    const filled = SLOT_COUNTS[p.pos] - open[p.pos];
    if (p.pos === 'RB' && filled >= 1 && draft.round < 12) value -= 4;
    if (p.pos === 'WR' && filled >= 3 && draft.round < 16) value -= 5;
    // A backup quarterback is insurance, not a starter: last few rounds.
    if (p.pos === 'QB' && filled >= 1 && draft.round <= TOTAL_ROUNDS - 4) value -= 14;
    if (rng) value += rng.normal(0, 1.6);
    ranked.push({ player: p, value });
  }
  ranked.sort((a, b) => b.value - a.value);
  return ranked;
}

export function aiChoose(league, draft, pool, teamIdx, rng) {
  const ranked = rankForTeam(league, draft, pool, teamIdx, rng);
  return ranked.length ? ranked[0].player : null;
}

/** Apply a pick for the current picker. Throws if invalid. */
export function makePick(league, draft, player) {
  if (draft.complete) throw new Error('Draft is complete');
  if (draft.taken[player.id] != null) throw new Error(`${player.name} already taken`);
  const teamIdx = currentPicker(draft);
  const team = league.teams[teamIdx];
  const slot = openSlots(team).find((s) => s.pos === player.pos);
  if (!slot) throw new Error(`No open ${player.pos} slot`);
  team.slots[slot.id] = player.id;
  draft.taken[player.id] = teamIdx;
  draft.picks.push({ overall: overallPickNumber(draft), round: draft.round, team: teamIdx, playerId: player.id, slot: slot.id });
  draft.pickInRound++;
  if (draft.pickInRound >= draft.order.length) {
    draft.pickInRound = 0;
    draft.round++;
    if (draft.round > TOTAL_ROUNDS) draft.complete = true;
  }
  settlePointer(league, draft);
  return teamIdx;
}

/** Run AI picks until it is the user's turn (or the draft ends). */
export function runAiPicks(league, draft, pool, rng, { stopAtUser = true } = {}) {
  let guard = 0;
  while (!draft.complete && guard++ < TOTAL_ROUNDS * draft.order.length + 5) {
    const t = currentPicker(draft);
    if (stopAtUser && league.teams[t].isUser) break;
    const p = aiChoose(league, draft, pool, t, rng);
    if (!p) break;
    makePick(league, draft, p);
  }
  return draft;
}

/** Fill everyone's roster instantly (user included, using the AI valuation). */
export function autoDraftAll(league, draft, pool, rng) {
  return runAiPicks(league, draft, pool, rng, { stopAtUser: false });
}

/** Randomly assign GM personalities to AI teams. */
export function assignGms(league, rng) {
  const ids = rng.shuffle(GM_PERSONALITIES.map((g) => g.id));
  let i = 0;
  for (const t of league.teams) {
    if (t.isUser) continue;
    t.gm = ids[i % ids.length];
    const gm = GM_PERSONALITIES.find((g) => g.id === t.gm);
    t.strategy = { ...gm.strategy };
    i++;
  }
}

export { RNG };
