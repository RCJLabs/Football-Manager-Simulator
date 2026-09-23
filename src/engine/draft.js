// Snake draft with value-over-replacement AI.
import { ROSTER_SLOTS, SLOT_COUNTS } from '../data/positions.js';
import { GM_PERSONALITIES } from '../data/teams.js';
import { overall } from './ratings.js';
import { RNG } from './rng.js';
import { scoutedOverall } from './scouting.js';
import { applyOwedPicks } from './owedpicks.js';
import { proPools, proDraftRounds, rookieClass } from './proleague.js';

export const TOTAL_ROUNDS = ROSTER_SLOTS.length;

// Positional impact on the simulation, used to scale value over replacement.
//
// Hand-set in the first commit and never measured, and it is not the measured
// leverage table: that one weighs a quarterback five times a receiver where
// this weighs him two and a half. It was checked the way that matters, by
// wins — clubs in the same league drafting on each table, the halves swapped
// on every seed — and drafting on leverage won no more games: −0.8 ± 1.3
// points of win share over thirty twelve-club leagues, −0.6 ± 0.8 and
// +1.5 ± 1.3 over two sets of twelve thirty-two-club ones. So it stays. See
// DESIGN.md, "What a rookie pick is worth", and `npm run rookies weights`.
export const POS_BASE = { QB: 2.6, RB: 1.15, WR: 1.0, TE: 0.8, OL: 0.75, DL: 0.9, LB: 0.8, CB: 1.1, S: 0.9, K: 0.5, P: 0.35 };

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
  // A pro league past its first season drafts its rookie class and nothing
  // else, over as many rounds as the class needs. Everything else — the
  // fantasy league, and the opening draft that populates a pro one — drafts
  // the whole pool over a round per roster slot, as it always did.
  const rookiesOnly = proPools(league);
  const draft = {
    order: order ? order.slice() : rng.shuffle([...Array(n).keys()]),
    round: 1,
    pickInRound: 0,
    picks: [],
    taken: { ...taken },
    complete: false,
    rounds: rookiesOnly ? proDraftRounds(league) : TOTAL_ROUNDS,
    // A rookie draft runs straight, worst to first, every round — which is
    // what the real thing does and the opposite of what this did. The snake
    // exists to make a *fantasy* draft fair: over twenty-seven rounds from one
    // all-time pool, picking last every round would be ruinous, so the order
    // turns round on itself. A rookie draft is five rounds over one class and
    // the unfairness is the whole design — a bad club is supposed to get the
    // better of it. Absent on a save written before this, and `snakes` reads
    // that as the snake, so nothing already in progress changes shape.
    snake: !rookiesOnly,
    // Held as ids rather than a flag, so the board, the AI and the trade
    // projection all read the same list without needing the league.
    eligible: rookiesOnly ? rookieClass(league).map((p) => p.id) : null,
  };
  // Picks promised in last year's draft come due here, and here is the first
  // moment they can: a future pick is a round and a club, and it takes an
  // order to turn that into a pick number. Before `settlePointer`, because
  // what is owed can change who is on the clock.
  applyOwedPicks(league, draft);
  settlePointer(league, draft);
  return draft;
}

/** Move the pointer off any club whose roster is already full; end the draft when everyone's is. */
export function settlePointer(league, draft) {
  // A rookie draft can run out of players before it runs out of rounds — the
  // class does not divide evenly by the number of clubs. Checked off the
  // draft's own two lists so this needs no pool, and so a board with nobody
  // left on it ends rather than sitting on the clock forever.
  if (draft.eligible && !draft.eligible.some((id) => draft.taken[id] == null)) { draft.complete = true; return; }
  let guard = 0;
  while (!draft.complete && guard++ < draftRounds(draft) * draft.order.length + 1) {
    if (league.teams.every((t) => openSlots(t).length === 0) || draft.round > draftRounds(draft)) { draft.complete = true; return; }
    if (openSlots(league.teams[currentPicker(draft)]).length > 0) return;
    draft.pickInRound++;
    if (draft.pickInRound >= draft.order.length) { draft.pickInRound = 0; draft.round++; }
  }
  draft.complete = true;
}

/** Whether this draft turns the order round on itself each round. */
export function snakes(draft) {
  return draft?.snake !== false;
}

/**
 * Which seat in the order is on the clock at this point of this draft.
 *
 * Its own inverse, in both shapes: in a straight draft seat and position are
 * the same, and in a snake they are `n - 1 - x` of each other either way. That
 * is what lets `applyOwedPicks` use the same arithmetic to go from a club's
 * seat to the pick number it owns.
 */
export function seatAt(draft, round, pickInRound) {
  if (!snakes(draft)) return pickInRound;
  return round % 2 === 1 ? pickInRound : draft.order.length - 1 - pickInRound;
}

/**
 * Team index whose turn it is, unless this pick has been traded.
 * `draft.traded` maps an overall pick number to its new owner and is absent
 * in every league where nobody has dealt, so the lookup costs nothing.
 */
export function currentPicker(draft) {
  const n = draft.order.length;
  const traded = draft.traded?.[(draft.round - 1) * n + draft.pickInRound + 1];
  return traded == null ? draft.order[seatAt(draft, draft.round, draft.pickInRound)] : traded;
}

export function overallPickNumber(draft) {
  return (draft.round - 1) * draft.order.length + draft.pickInRound + 1;
}

/** Players still available (from a pool array). */
export function availablePlayers(draft, pool) {
  const only = draft.eligible ? new Set(draft.eligible) : null;
  return pool.filter((p) => draft.taken[p.id] == null && !p.retired && (!only || only.has(p.id)));
}

/** How many rounds this particular draft runs. Older saves carry none and ran the full twenty-seven. */
export function draftRounds(draft) {
  return draft?.rounds ?? TOTAL_ROUNDS;
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
 *
 * With `bestOnly` it returns just the top man and skips the sort. That matters
 * because `aiChoose` reads `ranked[0]` and nothing else, and it is called once
 * per pick — eight hundred and sixty-four times in a thirty-two club draft,
 * and a whole draft is what `projectPickTrade` runs to value a single pick
 * swap. Sorting a thousand players to read one of them was a third of the cost
 * of every projection. The scoring loop is shared so the random draws happen
 * in the same order either way, which keeps a seeded draft identical.
 */
export function rankForTeam(league, draft, pool, teamIdx, rng, { bestOnly = false, read = scoutedOverall, weights = POS_BASE } = {}) {
  const team = league.teams[teamIdx];
  const open = openSlotsByPos(team);
  const available = availablePlayers(draft, pool);
  const demand = demandByPos(league);
  const repl = replacementLevels(available, demand);
  const gm = GM_PERSONALITIES.find((g) => g.id === team.gm) || GM_PERSONALITIES[0];
  const roundsLeft = draftRounds(draft) - draft.round + 1;
  const openCount = openSlots(team).length;
  const ranked = [];
  let best = null;
  for (const p of available) {
    if (!open[p.pos]) continue;
    // A club drafts on what its own scouts say, not on the truth. `read` and
    // `weights` exist for measuring the draft against alternatives (see
    // scripts/rookie-read.mjs); play always drafts on the defaults.
    const ovr = read(league, p, teamIdx);
    let value = (ovr - (repl[p.pos] ?? 60)) * weights[p.pos] * (gm.pos[p.pos] ?? 1);
    if (gm.era) value *= gm.era(p.season);
    value += (ovr - 80) * 0.15; // slight preference for raw talent
    // Kickers/punters: wait until the last rounds unless forced.
    if ((p.pos === 'K' || p.pos === 'P') && draft.round <= draftRounds(draft) - 3) value -= 15;
    // Forced needs: if a position's open slots equal rounds left, must fill.
    if (open[p.pos] >= roundsLeft) value += 100;
    // Don't hoard: second RB / fourth WR lower priority early.
    const filled = SLOT_COUNTS[p.pos] - open[p.pos];
    if (p.pos === 'RB' && filled >= 1 && draft.round < 12) value -= 4;
    if (p.pos === 'WR' && filled >= 3 && draft.round < 16) value -= 5;
    // A backup quarterback is insurance, not a starter: last few rounds.
    if (p.pos === 'QB' && filled >= 1 && draft.round <= draftRounds(draft) - 4) value -= 14;
    if (rng) value += rng.normal(0, 1.6);
    if (bestOnly) {
      // Strictly greater, so a tie keeps the earlier player — which is what a
      // stable sort on the full list would also have done.
      if (best === null || value > best.value) best = { player: p, value };
      continue;
    }
    ranked.push({ player: p, value });
  }
  if (bestOnly) return best ? [best] : [];
  ranked.sort((a, b) => b.value - a.value);
  return ranked;
}

export function aiChoose(league, draft, pool, teamIdx, rng) {
  const ranked = rankForTeam(league, draft, pool, teamIdx, rng, { bestOnly: true });
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
    if (draft.round > draftRounds(draft)) draft.complete = true;
  }
  settlePointer(league, draft);
  return teamIdx;
}

/**
 * Give up a turn nobody can use.
 *
 * A rookie draft can reach a club whose only open slot is at a position the
 * class has run out of — thirty-two clubs and seven punters between them is
 * enough for it to happen. An all-time draft never could, because the board
 * held every player who ever lived, so the loop simply stopped when the AI had
 * nothing to take. Measured on a second-season pro draft that cost 83 of 160
 * picks: the draft halted at pick 77 with 99 rookies still on the board and
 * six clubs still short of a full roster, and a club that had been promised
 * five picks made four.
 *
 * So a club that cannot use its turn passes it, exactly as the real thing
 * does, and the draft carries on to the clubs behind it.
 */
export function passPick(league, draft) {
  if (draft.complete) return;
  draft.pickInRound++;
  if (draft.pickInRound >= draft.order.length) {
    draft.pickInRound = 0;
    draft.round++;
    if (draft.round > draftRounds(draft)) { draft.complete = true; return; }
  }
  settlePointer(league, draft);
}

/**
 * Exactly one AI pick, for a screen that shows a draft happening rather than
 * applying it. Returns the pick record, or null if there was nothing to do.
 * `runAiPicks` stays for everything that wants the whole burst at once — the
 * scripts, the tests and the auto-draft button all still do.
 */
export function stepAiPick(league, draft, pool, rng) {
  if (draft.complete) return null;
  const t = currentPicker(draft);
  if (t == null || league.teams[t].isUser) return null;
  const p = aiChoose(league, draft, pool, t, rng);
  if (!p) { passPick(league, draft); return null; }
  makePick(league, draft, p);
  return draft.picks[draft.picks.length - 1];
}

/** Run AI picks until it is the user's turn (or the draft ends). */
export function runAiPicks(league, draft, pool, rng, { stopAtUser = true } = {}) {
  let guard = 0;
  while (!draft.complete && guard++ < draftRounds(draft) * draft.order.length + 5) {
    const t = currentPicker(draft);
    if (stopAtUser && league.teams[t].isUser) break;
    const p = aiChoose(league, draft, pool, t, rng);
    // Every turn of this loop moves the pointer on by exactly one, pick or
    // pass, so the guard above still bounds it at the number of picks there are.
    if (!p) { passPick(league, draft); continue; }
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
