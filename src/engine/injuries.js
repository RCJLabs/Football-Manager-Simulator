// Injuries: a per-play chance that somebody on the field gets hurt, a severity
// roll, replacement-level fill-ins for a position group left short, and the
// league ledger of who is out and for how long.
//
// Rates sit below the real league's on purpose. A 13-game fantasy season is
// short enough that injury luck would otherwise swamp roster quality, so the
// default costs a club about one starter a week and the dial goes both ways.

import { POSITIONS, ROSTER_SLOTS } from '../data/positions.js';
import { overall } from '../engine/ratings.js';

export const INJURY_LEVELS = { off: 0, low: 0.5, normal: 1, high: 2 };
export const INJURY_LEVEL_LABELS = { off: 'Off', low: 'Low', normal: 'Normal', high: 'High' };
export const DEFAULT_INJURY_LEVEL = 'normal';
/** Weeks-out value that means "done for the year". */
export const SEASON_ENDING = 99;

/** Chance per scrimmage play that someone on the field is hurt, at level 1. */
export const BASE_PER_PLAY = 0.01;
/** Exposure by play type relative to a scrimmage play. Kick returns are the most dangerous plays in the game. */
export const PLAY_FACTOR = { run: 1, pass: 1, incomplete: 0.6, sack: 1.1, int: 1, fumble: 1.1, kickoff: 1.5, punt: 1.2, fg: 0.12, kneel: 0.05, spike: 0.05 };
/** Vulnerability by position: backs take the most hits, specialists barely any. */
export const POS_RISK = { QB: 0.8, RB: 1.5, WR: 1.15, TE: 1.1, OL: 0.85, DL: 0.9, LB: 1.0, CB: 1.0, S: 1.0, K: 0.12, P: 0.12 };

// Severity bands: cumulative probability, weeks missed after this game, and the diagnoses that fit.
const BANDS = [
  { p: 0.55, min: 0, max: 0, kinds: ['shaken up', 'cramps', 'stinger', 'bruised ribs', 'rolled ankle', 'hip pointer'] },
  { p: 0.80, min: 1, max: 2, kinds: ['hamstring', 'ankle sprain', 'concussion', 'groin strain', 'shoulder', 'calf strain'] },
  { p: 0.92, min: 3, max: 5, kinds: ['high ankle sprain', 'MCL sprain', 'broken hand', 'hamstring tear', 'cracked ribs', 'AC joint'] },
  { p: 0.98, min: 6, max: 9, kinds: ['broken collarbone', 'foot fracture', 'knee sprain', 'torn pectoral', 'broken forearm'] },
  { p: 1.00, min: SEASON_ENDING, max: SEASON_ENDING, kinds: ['torn ACL', 'ruptured Achilles', 'broken leg', 'neck'] },
];

/** Per-play injury probability for a given dial level and play type. */
export function injuryChance(level, playType) {
  if (!level) return 0;
  return BASE_PER_PLAY * level * (PLAY_FACTOR[playType] ?? 1);
}

/** Roll how bad it is. Returns { kind, weeks } where weeks is time missed after this game. */
export function rollSeverity(rng) {
  const u = rng.next();
  const band = BANDS.find((b) => u < b.p) || BANDS[BANDS.length - 1];
  const weeks = band.min === band.max ? band.min : rng.int(band.min, band.max);
  const kind = band.kinds[rng.int(0, band.kinds.length - 1)];
  return { kind, weeks };
}

export function injuryText(p, kind, weeks) {
  const when = weeks === 0 ? 'Out for the rest of the game.' : weeks >= SEASON_ENDING ? 'Out for the season.' : `Expected to miss ${weeks} week${weeks > 1 ? 's' : ''}.`;
  return `${p.name} (${p.pos}) is hurt on the play — ${kind}. ${when}`;
}

export function fmtWeeks(weeks) {
  return weeks >= SEASON_ENDING ? 'season' : `${weeks} wk`;
}

// ---------------------------------------------------------------------------
// Replacement-level fill-ins
// ---------------------------------------------------------------------------

/** Overall a street free agent brings when a position group is left short. */
export const REPLACEMENT_OVR = { QB: 48, RB: 52, WR: 52, TE: 52, OL: 54, DL: 54, LB: 52, CB: 52, S: 52, K: 58, P: 60 };

export const STARTER_COUNT = {};
for (const s of ROSTER_SLOTS) if (s.starter) STARTER_COUNT[s.pos] = (STARTER_COUNT[s.pos] || 0) + 1;

export function replacementPlayer(pos, n = 1) {
  const def = POSITIONS[pos];
  const r = {};
  for (const a of def.attrs) r[a] = REPLACEMENT_OVR[pos] ?? 48;
  return { id: `rep:${pos}:${n}`, name: `Replacement ${pos}${n > 1 ? ` ${n}` : ''}`, pos, season: 0, team: '—', r, replacement: true };
}

export function isReplacementId(id) {
  return typeof id === 'string' && id.startsWith('rep:');
}

export function replacementFromId(id) {
  const [, pos, n] = String(id).split(':');
  return POSITIONS[pos] ? replacementPlayer(pos, Number(n) || 1) : null;
}

/**
 * Pad every position group up to its starter count with replacement-level
 * players so the simulation always has a full unit to work with. Returns a new
 * lineup object; the input is not touched.
 */
export function fillLineup(lineup) {
  const out = {};
  for (const pos of Object.keys(STARTER_COUNT)) {
    const arr = (lineup[pos] || []).slice();
    let n = 1;
    while (arr.length < STARTER_COUNT[pos]) arr.push(replacementPlayer(pos, n++));
    out[pos] = arr;
  }
  for (const pos of Object.keys(lineup)) if (!out[pos]) out[pos] = lineup[pos].slice();
  return out;
}

// ---------------------------------------------------------------------------
// League ledger
// ---------------------------------------------------------------------------

/** Is this player unavailable this week? */
export function isOut(injuries, id) {
  return !!(injuries && injuries[id]);
}

/**
 * Write a finished game's injuries into the league ledger. `since` is the week
 * number the game was played in, so the first tick does not eat a week.
 */
export function recordGameInjuries(league, g, sides, since) {
  league.injuries ??= {};
  sides.forEach((teamIdx, side) => {
    for (const inj of g.teams[side].injuries || []) {
      if (inj.weeks <= 0) continue;
      league.injuries[inj.id] = { weeks: inj.weeks, kind: inj.kind, since, season: league.season, team: teamIdx };
      // The worst band is the one that follows a man into next season. Noted
      // here and paid in the offseason, because that is when a career moves;
      // `advanceCareers` reads this ledger and clears it.
      if (inj.weeks >= SEASON_ENDING) {
        league.knocks ??= {};
        league.knocks[inj.id] = (league.knocks[inj.id] || 0) + 1;
      }
    }
  });
}

/** Called once per week advance: everyone hurt before this week heals a week. */
export function tickInjuries(league, weekNo) {
  if (!league.injuries) return;
  for (const [id, inj] of Object.entries(league.injuries)) {
    if (inj.since === weekNo && inj.season === league.season) { inj.since = null; continue; }
    inj.weeks -= 1;
    if (inj.weeks <= 0) delete league.injuries[id];
  }
}

/** Weeks left to play this season including a rough playoff run, for valuing an injured player. */
export function weeksLeft(league) {
  if (league.phase === 'season') return Math.max(1, (league.schedule?.length || 14) - league.week + 1 + 2);
  if (league.phase === 'playoffs') return 2;
  return 1;
}

/** Share of the remaining season a player is available for: 1 healthy, 0 done. */
export function availability(league, id) {
  const inj = league.injuries && league.injuries[id];
  if (!inj) return 1;
  if (inj.weeks >= SEASON_ENDING) return 0;
  return Math.max(0, Math.min(1, 1 - inj.weeks / weeksLeft(league)));
}

// ---------------------------------------------------------------------------
// Injured reserve
// ---------------------------------------------------------------------------
//
// A long injury used to be a dead roster slot: the man could not play and
// could not be replaced without cutting him. Injured reserve makes it a
// decision. A player out four weeks or more can be moved to IR, which frees
// his slot for a signing; he keeps healing there and keeps his contract, but
// he cannot play or be traded until he is activated, and activating him costs
// a roster spot in turn. Two IR places a club, so the decision stays a real
// one rather than a parking lot.

export const IR_SLOTS = 2;
export const IR_MIN_WEEKS = 4;

export function irList(team) {
  return (team && team.ir) || [];
}

const slotHolding = (team, id) => ROSTER_SLOTS.find((s) => team.slots[s.id] === id)?.id || null;

/** Why this player cannot go on IR, or null if he can. */
export function irBlocker(league, teamIdx, id) {
  const team = league.teams[teamIdx];
  if (!team) return 'No such club';
  if (irList(team).length >= irCapacity(league)) return `Only ${irCapacity(league)} places on injured reserve`;
  if (!slotHolding(team, id)) return 'He is not on your roster';
  const inj = (league.injuries || {})[id];
  if (!inj) return 'Only an injured player can go on injured reserve';
  if (inj.weeks < IR_MIN_WEEKS) return `Injured reserve needs an absence of ${IR_MIN_WEEKS} weeks or more; he is out ${fmtWeeks(inj.weeks)}`;
  return null;
}

export function irCapacity(league) {
  return league.settings?.irSlots ?? IR_SLOTS;
}

export function canPlaceOnIr(league, teamIdx, id) {
  return irBlocker(league, teamIdx, id) === null;
}

/** Move a player to injured reserve, emptying his slot. Throws with a readable reason. */
export function placeOnIr(league, teamIdx, id) {
  const blocker = irBlocker(league, teamIdx, id);
  if (blocker) throw new Error(blocker);
  const team = league.teams[teamIdx];
  team.ir ??= [];
  team.slots[slotHolding(team, id)] = null;
  team.ir.push(id);
  (league.transactions ??= []).push({ week: league.week, season: league.season, type: 'ir', team: teamIdx, add: id });
  return id;
}

/** Players on IR who have healed and are waiting for a roster spot. */
export function irReady(league, team) {
  return irList(team).filter((id) => !(league.injuries || {})[id]);
}

/**
 * Bring a player back. `dropId` is the man released to make room, or null to
 * use an open slot at his position.
 */
export function activateFromIr(league, teamIdx, id, dropId, byId) {
  const team = league.teams[teamIdx];
  if (!irList(team).includes(id)) throw new Error('He is not on injured reserve');
  if ((league.injuries || {})[id]) throw new Error('He is not fit yet');
  const p = byId.get(id);
  if (!p) throw new Error('Unknown player');
  let slotId;
  if (dropId) {
    slotId = slotHolding(team, dropId);
    if (!slotId) throw new Error('That player is not on your roster');
    const drop = byId.get(dropId);
    if (drop && drop.pos !== p.pos) throw new Error(`Release a ${p.pos} to activate a ${p.pos}`);
  } else {
    slotId = ROSTER_SLOTS.find((s) => s.pos === p.pos && !team.slots[s.id])?.id;
    if (!slotId) throw new Error(`No open ${p.pos} slot; name a player to release`);
  }
  team.slots[slotId] = id;
  team.ir = irList(team).filter((x) => x !== id);
  (league.transactions ??= []).push({ week: league.week, season: league.season, type: 'activate', team: teamIdx, add: id, drop: dropId || null });
  return slotId;
}

/** Let a player on IR go; he returns to the pool. */
export function releaseFromIr(league, teamIdx, id) {
  const team = league.teams[teamIdx];
  if (!irList(team).includes(id)) return false;
  team.ir = irList(team).filter((x) => x !== id);
  (league.transactions ??= []).push({ week: league.week, season: league.season, type: 'release', team: teamIdx, drop: id });
  return true;
}

/** At the playoffs, anyone fit again slides back into an open slot at his position. */
export function returnFromIr(league, byId) {
  const back = [];
  for (const [ti, team] of league.teams.entries()) {
    for (const id of irReady(league, team)) {
      const p = byId.get(id);
      const slotId = p && ROSTER_SLOTS.find((s) => s.pos === p.pos && !team.slots[s.id])?.id;
      if (!slotId) continue;
      team.slots[slotId] = id;
      team.ir = irList(team).filter((x) => x !== id);
      back.push({ team: ti, id });
    }
  }
  return back;
}

/** Offseason: injured reserve empties. Anyone without a slot to return to is released. */
export function clearIr(league, byId) {
  const released = [];
  for (const [ti, team] of league.teams.entries()) {
    for (const id of irList(team)) {
      const p = byId && byId.get(id);
      const slotId = p && ROSTER_SLOTS.find((s) => s.pos === p.pos && !team.slots[s.id])?.id;
      if (slotId) team.slots[slotId] = id;
      else released.push({ team: ti, id });
    }
    team.ir = [];
  }
  return released;
}

/**
 * The AI's use of injured reserve: park anyone out long enough when there is
 * room, and activate a fit player when he beats the worst man at his position
 * (or when a slot at it is open). The wire fills whatever this leaves empty.
 */
export function aiManageIr(league, byId) {
  const moves = [];
  league.teams.forEach((team, ti) => {
    if (team.isUser) return;
    for (const id of irReady(league, team)) {
      const p = byId.get(id);
      if (!p) continue;
      const open = ROSTER_SLOTS.find((s) => s.pos === p.pos && !team.slots[s.id]);
      if (open) { activateFromIr(league, ti, id, null, byId); moves.push({ team: ti, id, type: 'activate' }); continue; }
      const worst = ROSTER_SLOTS.filter((s) => s.pos === p.pos && team.slots[s.id])
        .map((s) => ({ s, q: byId.get(team.slots[s.id]) })).filter((x) => x.q)
        .sort((a, b) => overall(a.q) - overall(b.q))[0];
      if (worst && overall(p) > overall(worst.q)) { activateFromIr(league, ti, id, worst.q.id, byId); moves.push({ team: ti, id, type: 'activate' }); }
    }
    const hurt = ROSTER_SLOTS.map((s) => team.slots[s.id]).filter(Boolean)
      .map((id) => ({ id, inj: (league.injuries || {})[id] })).filter((x) => x.inj && x.inj.weeks >= IR_MIN_WEEKS)
      .sort((a, b) => b.inj.weeks - a.inj.weeks);
    for (const h of hurt) {
      if (!canPlaceOnIr(league, ti, h.id)) continue;
      placeOnIr(league, ti, h.id);
      moves.push({ team: ti, id: h.id, type: 'ir' });
    }
  });
  return moves;
}
