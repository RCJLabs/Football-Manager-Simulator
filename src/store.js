// Persisted app state: the active save slot's league and in-progress game,
// plus preferences shared by every slot. Slots are managed in slots.js.
import { migrateLeague } from './engine/season.js';
import {
  loadRegistry, readSlot, writeSlot, createSlot, activateSlot, deleteSlot, renameSlot, slotSizeKb,
  firstEmptySlot, slotIsEmpty, MAX_SLOTS, PREFS_KEY,
} from './slots.js';

const DEFAULT_PREFS = { autoplayMs: 900, showAttrs: true };
const listeners = new Set();
let state = { league: null, game: null, prefs: { ...DEFAULT_PREFS } };
let registry = null;
let dirty = false;
let saveTimer = null;
// Why the last write did not reach the browser, or null while saves land.
//
// A full origin is the realistic failure and it is closer than it looks: a
// 32-club pro save measures about 2.4 MB and a browser gives an origin roughly
// 5 MB, so a second pro dynasty in the same browser is already at the edge.
// This used to be swallowed into a console warning, which meant the game
// carried on accepting moves it was no longer writing down and threw the whole
// session away at the next reload — a save system failing silently is worse
// than one failing loudly.
let lastSaveError = null;

const storage = typeof localStorage !== 'undefined' ? localStorage : null;

export function getState() {
  return state;
}

/**
 * Whether the browser is still accepting saves. Null when it is; otherwise
 * `{ quota, message, at }`, with `quota` true when the origin is out of room,
 * which is the case worth telling the player about because they can act on it.
 */
export function saveError() {
  return lastSaveError;
}

/**
 * Browsers disagree about how a full origin is reported: a modern one throws a
 * DOMException named QuotaExceededError, Firefox has used
 * NS_ERROR_DOM_QUOTA_REACHED (1014) and Safari in private mode code 22.
 */
function isQuotaError(e) {
  if (!e) return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || e.code === 22 || e.code === 1014;
}

function loadPrefs() {
  try { const raw = storage && storage.getItem(PREFS_KEY); return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS }; } catch { return { ...DEFAULT_PREFS }; }
}

export function load() {
  if (!storage) return state;
  try {
    registry = loadRegistry(storage);
    const prefs = loadPrefs();
    const slot = registry.active ? readSlot(storage, registry.active) : null;
    state = { league: slot?.league || null, game: slot?.game || null, prefs };
    if (state.league) migrateLeague(state.league);
  } catch (e) {
    console.warn('Could not load saved state', e);
  }
  return state;
}

export function saveNow() {
  if (!storage) return;
  const wasFailing = !!lastSaveError;
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
    if (!registry) registry = loadRegistry(storage);
    // A league in memory with nowhere to go keeps its data rather than losing
    // it to the slot limit: `force` makes room beyond the three if it has to.
    if (!registry.active && state.league) createSlot(storage, registry, state.league.name, { force: true });
    if (registry.active) writeSlot(storage, registry, registry.active, state);
    dirty = false;
    lastSaveError = null;
  } catch (e) {
    console.warn('Could not save state', e);
    // `dirty` is deliberately left set, so the next change tries again and a
    // save that starts working clears the warning without a reload.
    lastSaveError = { quota: isQuotaError(e), message: String((e && e.message) || e), at: Date.now() };
  }
  // Only on a change of answer. saveNow runs behind a 250ms debounce on every
  // move, and notifying each time would re-render the screen under the player.
  if (wasFailing !== !!lastSaveError) notify();
}

/**
 * Set when a slot has been taken but nothing written into it yet. Saves are
 * debounced by 250 ms, and in that window the new slot is on disk with no
 * league in it — so the home screen called the save you are playing an empty
 * slot, and the next new league would have been handed the same one. The first
 * write into a fresh slot therefore skips the debounce.
 */
let firstWritePending = false;

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  if (firstWritePending && state.league) { firstWritePending = false; saveNow(); return; }
  saveTimer = setTimeout(saveNow, 250);
}

/**
 * Forget a write that has not happened yet. Saves are debounced by 250 ms, so
 * a league deleted a moment after a move had a write still in flight against
 * it; the delete has to cancel that, not race it.
 */
function dropPendingSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  dirty = false;
  firstWritePending = false;
}

/** Mutate state in place via fn, then persist and notify. */
export function update(fn, { silent = false } = {}) {
  fn(state);
  scheduleSave();
  if (!silent) for (const l of listeners) l(state);
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const l of listeners) l(state);
}

/**
 * Empty the open slot. Nothing is opened in its place — see the note in
 * slots.js about why handing over another save reads as a failed delete.
 */
export function resetAll() {
  dropPendingSave();
  if (storage && registry && registry.active) deleteSlot(storage, registry, registry.active);
  state = { league: null, game: null, prefs: state.prefs };
  try { if (storage) storage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* prefs are not worth failing over */ }
  notify();
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * Re-read the registry from storage. The cached copy can be behind: another
 * tab of the same game writes to the same origin, and a browser's site data
 * can be cleared underneath a running page. Both of these queries are
 * read-only and cheap — one small JSON parse — so they ask rather than assume.
 */
function syncRegistry() {
  if (storage) registry = loadRegistry(storage);
  return registry;
}

export function listSlots() {
  if (!storage) return { active: null, slots: [], max: MAX_SLOTS, full: false };
  syncRegistry();
  const slots = registry.slots.map((s) => ({ ...s, kb: slotSizeKb(storage, s.id), empty: slotIsEmpty(storage, s) }));
  return { active: registry.active, slots, max: MAX_SLOTS, full: !slots.some((s) => s.empty) };
}

/**
 * Take an empty slot for a new league, keeping the current one saved where it
 * is. Returns null when all three are full, which the setup screen turns into
 * a message rather than overwriting anything.
 */
export function openNewSlot(name = 'New league') {
  if (dirty) saveNow();
  if (!storage) { state = { league: null, game: null, prefs: state.prefs }; return null; }
  if (!registry) registry = loadRegistry(storage);
  const id = createSlot(storage, registry, name);
  if (!id) return null;
  firstWritePending = true;
  state = { league: null, game: null, prefs: state.prefs };
  notify();
  return id;
}

/** Whether there is anywhere to put a new league. */
export function hasEmptySlot() {
  if (!storage) return true;
  syncRegistry();
  return !!firstEmptySlot(storage, registry);
}

export function switchSlot(id) {
  if (!storage) return;
  if (dirty) saveNow();
  if (!registry) registry = loadRegistry(storage);
  const slot = activateSlot(storage, registry, id);
  state = { league: slot.league || null, game: slot.game || null, prefs: state.prefs };
  if (state.league) migrateLeague(state.league);
  notify();
}

export function removeSlot(id) {
  if (!storage) return;
  if (!registry) registry = loadRegistry(storage);
  const wasActive = registry.active === id;
  // Cancel first: a debounced write still in flight would land on the slot
  // being emptied, or on whatever is open, moments after the delete.
  if (wasActive) dropPendingSave();
  else if (dirty) saveNow();
  deleteSlot(storage, registry, id);
  if (wasActive) state = { league: null, game: null, prefs: state.prefs };
  notify();
}

export function nameSlot(id, name) {
  if (!storage) return;
  if (!registry) registry = loadRegistry(storage);
  renameSlot(storage, registry, id, name);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function exportJSON() {
  return JSON.stringify({ league: state.league, game: state.game, prefs: state.prefs }, null, 0);
}

/** Import a save file into a new slot (the current league is kept). */
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !('league' in parsed)) throw new Error('Not a Gridiron Eras save file');
  if (storage && state.league) openNewSlot(parsed.league?.name || 'Imported league');
  state = { league: parsed.league || null, game: parsed.game || null, prefs: { ...state.prefs, ...(parsed.prefs || {}) } };
  if (state.league) migrateLeague(state.league);
  saveNow();
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (dirty) saveNow(); });
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty) saveNow(); });
}
