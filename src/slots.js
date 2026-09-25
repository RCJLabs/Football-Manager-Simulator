// Save slots: three leagues in one browser. A registry lists the slots and
// which one is open; each slot's state lives under its own key. The logic
// takes the storage object as an argument so it can be tested without a
// browser (any object with getItem/setItem/removeItem works).
//
// **Three fixed slots, not a growing list.** Slots used to be created on
// demand and removed outright, which meant a player with one league saw no
// slot list at all — the card hid itself — and the only way to delete was a
// button in Settings. Now the three are always there, numbered and in the same
// order, and an empty one is a place to start rather than an absence.
//
// **Deleting never opens something else.** It used to hand the next slot to
// whoever deleted one, so a player who removed the league they were playing
// landed back on a home screen with a Continue button, a league name and a
// record — all belonging to a different save that happened to share the
// default name. That reads exactly like a delete that did not work. Deleting
// the open slot now leaves nothing open, and the player picks.

import { packCareers, unpackCareers } from './engine/awards.js';
import { encode, decode } from './savecodec.js';

export const REGISTRY_KEY = 'gridiron-eras:slots:v1';
/** How many saves a browser holds. Three is a menu; a list is a filing system. */
export const MAX_SLOTS = 3;
export const LEGACY_KEY = 'gridiron-eras:state:v1';
export const PREFS_KEY = 'gridiron-eras:prefs:v1';
export const slotKey = (id) => `gridiron-eras:slot:${id}`;

function read(storage, key) {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(decode(raw)) : null; } catch { return null; }
}
function write(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

/** A slot with nothing in it: a place to start, not an absence. */
function blankSlot() {
  return { id: newId(), name: '', created: Date.now(), updated: 0, summary: summarize(null) };
}

/** Whether a slot holds a league. */
export function slotIsEmpty(storage, slot) {
  if (!slot) return true;
  if (slot.summary && slot.summary.phase && slot.summary.phase !== 'empty') return false;
  return !readSlot(storage, slot.id)?.league;
}

/**
 * The registry, created on first use and always padded out to three. A save
 * from before slots existed becomes slot one; a browser that already holds
 * more than three keeps every one of them, because silently dropping somebody's
 * save to enforce a new rule is not a thing to do.
 */
export function loadRegistry(storage) {
  let reg = read(storage, REGISTRY_KEY);
  if (!reg || !Array.isArray(reg.slots)) {
    reg = { active: null, slots: [] };
    const legacy = read(storage, LEGACY_KEY);
    if (legacy && legacy.league) {
      const id = newId();
      write(storage, slotKey(id), { league: legacy.league, game: legacy.game || null });
      reg.slots.push({ id, name: legacy.league.name || 'League', created: Date.now(), updated: Date.now(), summary: summarize(legacy.league) });
      reg.active = id;
      if (legacy.prefs) write(storage, PREFS_KEY, legacy.prefs);
      try { storage.removeItem(LEGACY_KEY); } catch { /* fine */ }
    }
  }
  let padded = false;
  while (reg.slots.length < MAX_SLOTS) { reg.slots.push(blankSlot()); padded = true; }
  if (padded || !read(storage, REGISTRY_KEY)) write(storage, REGISTRY_KEY, reg);
  return reg;
}

/** The first slot with nothing in it, or null when all three are taken. */
export function firstEmptySlot(storage, reg) {
  return reg.slots.find((s) => slotIsEmpty(storage, s)) || null;
}

export function newId() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** One line for the slot list. */
export function summarize(league) {
  if (!league) return { phase: 'empty', season: 0, team: '', teams: 0, record: '' };
  const me = league.teams.find((t) => t.isUser);
  const r = me ? me.record : null;
  return {
    phase: league.phase,
    season: league.season,
    mode: league.mode,
    teams: league.teams.length,
    team: me ? me.name : '',
    record: r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : '',
    week: league.week,
    weeks: league.schedule ? league.schedule.length : 0,
  };
}

/**
 * Whatever a save can do without carrying, it does not carry.
 *
 * This is the only place a league is written in a shape nothing reads. The
 * career table is twenty-one fields a man and most of them are zero for
 * anybody — 258 KB of a pro save against 94 packed — and stripping those in
 * memory would leave every reader of `c.sacks` coping with it being absent,
 * which fails as a silent NaN in a record book rather than as an error. So it
 * is packed on the way out and unpacked on the way in, here, at the boundary
 * where the quota actually bites.
 */
function packLeague(league) {
  if (!league?.careers) return league;
  return { ...league, careers: packCareers(league.careers) };
}

export function readSlot(storage, id) {
  const raw = read(storage, slotKey(id));
  if (raw?.league?.careers) raw.league.careers = unpackCareers(raw.league.careers);
  return raw;
}

/** A slot's state as the JSON it is stored as, before packing. */
export function serializeSlot(state) {
  return JSON.stringify({ league: packLeague(state.league), game: state.game });
}

/** What the registry says about a slot, taken when its state is serialized. */
export function slotMeta(state) {
  return { summary: summarize(state.league), name: state.league?.name || null };
}

/**
 * Put an already-packed slot on disk and bring the registry up to date. Split
 * from `writeSlot` because the store packs its routine saves off the page's
 * thread and lands them here when they come back.
 */
export function commitSlot(storage, reg, id, packed, meta) {
  storage.setItem(slotKey(id), packed);
  const s = reg.slots.find((x) => x.id === id);
  if (s) {
    s.updated = Date.now();
    s.summary = meta.summary;
    if (meta.name) s.name = meta.name;
  }
  write(storage, REGISTRY_KEY, reg);
}

/**
 * Serialize, pack and store a slot, all at once. Deflate's fast level, because
 * whoever calls this is waiting: the page going away, a slot being switched.
 */
export function writeSlot(storage, reg, id, state) {
  commitSlot(storage, reg, id, encode(serializeSlot(state), 1), slotMeta(state));
}

/**
 * Take a slot for a new league: the first empty one, or a fourth slot when a
 * browser is already carrying more than three. Returns its id, or null when
 * all three are full — which the caller has to handle rather than quietly
 * overwriting somebody's dynasty.
 */
export function createSlot(storage, reg, name = 'New league', { force = false } = {}) {
  const empty = firstEmptySlot(storage, reg);
  if (!empty && !force) return null;
  const slot = empty || (() => { const s = blankSlot(); reg.slots.push(s); return s; })();
  slot.name = name;
  slot.created = Date.now();
  slot.updated = Date.now();
  slot.summary = summarize(null);
  write(storage, slotKey(slot.id), { league: null, game: null });
  reg.active = slot.id;
  write(storage, REGISTRY_KEY, reg);
  return slot.id;
}

export function activateSlot(storage, reg, id) {
  if (!reg.slots.some((s) => s.id === id)) throw new Error('No such save slot');
  reg.active = id;
  write(storage, REGISTRY_KEY, reg);
  return readSlot(storage, id) || { league: null, game: null };
}

/**
 * Empty a slot. The slot itself stays — it is slot two whether or not there is
 * a league in it — and nothing else is opened in its place. Returns the id
 * that is open afterwards, which is null when the slot deleted was the open
 * one.
 */
export function deleteSlot(storage, reg, id) {
  const slot = reg.slots.find((s) => s.id === id);
  try { storage.removeItem(slotKey(id)); } catch { /* fine */ }
  if (slot) {
    slot.name = '';
    slot.updated = 0;
    slot.summary = summarize(null);
    write(storage, slotKey(id), { league: null, game: null });
  } else {
    // A slot beyond the three, from a browser that had more: drop it outright.
    reg.slots = reg.slots.filter((s) => s.id !== id);
  }
  if (reg.active === id) reg.active = null;
  write(storage, REGISTRY_KEY, reg);
  return reg.active;
}

export function renameSlot(storage, reg, id, name) {
  const s = reg.slots.find((x) => x.id === id);
  if (s) { s.name = name; write(storage, REGISTRY_KEY, reg); }
}

/** Rough size of a slot in KB, for the warning about browser storage limits. */
export function slotSizeKb(storage, id) {
  try { const raw = storage.getItem(slotKey(id)); return raw ? Math.round(raw.length / 1024) : 0; } catch { return 0; }
}
