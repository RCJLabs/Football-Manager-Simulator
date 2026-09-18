// Persisted app state: the active save slot's league and in-progress game,
// plus preferences shared by every slot. Slots are managed in slots.js.
import { migrateLeague } from './engine/season.js';
import {
  loadRegistry, readSlot, writeSlot, createSlot, activateSlot, deleteSlot, renameSlot, slotSizeKb, PREFS_KEY,
} from './slots.js';

const DEFAULT_PREFS = { autoplayMs: 900, showAttrs: true };
const listeners = new Set();
let state = { league: null, game: null, prefs: { ...DEFAULT_PREFS } };
let registry = null;
let dirty = false;
let saveTimer = null;

const storage = typeof localStorage !== 'undefined' ? localStorage : null;

export function getState() {
  return state;
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
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
    if (!registry) registry = loadRegistry(storage);
    if (!registry.active && state.league) createSlot(storage, registry, state.league.name);
    if (registry.active) writeSlot(storage, registry, registry.active, state);
    dirty = false;
  } catch (e) {
    console.warn('Could not save state', e);
  }
}

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
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

/** Delete the active league (its slot goes with it) and open the most recent other slot, if any. */
export function resetAll() {
  if (storage && registry && registry.active) {
    const next = deleteSlot(storage, registry, registry.active);
    const slot = next ? readSlot(storage, next) : null;
    state = { league: slot?.league || null, game: slot?.game || null, prefs: state.prefs };
    if (state.league) migrateLeague(state.league);
  } else {
    state = { league: null, game: null, prefs: state.prefs };
  }
  saveNow();
  notify();
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export function listSlots() {
  if (!storage) return { active: null, slots: [] };
  if (!registry) registry = loadRegistry(storage);
  return { active: registry.active, slots: registry.slots.map((s) => ({ ...s, kb: slotSizeKb(storage, s.id) })) };
}

/** Start a fresh, empty slot and make it active. The current league stays saved in its own slot. */
export function openNewSlot(name = 'New league') {
  if (dirty) saveNow();
  if (!storage) { state = { league: null, game: null, prefs: state.prefs }; return null; }
  if (!registry) registry = loadRegistry(storage);
  const id = createSlot(storage, registry, name);
  state = { league: null, game: null, prefs: state.prefs };
  notify();
  return id;
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
  const next = deleteSlot(storage, registry, id);
  if (wasActive) {
    const slot = next ? readSlot(storage, next) : null;
    state = { league: slot?.league || null, game: slot?.game || null, prefs: state.prefs };
    if (state.league) migrateLeague(state.league);
  }
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
