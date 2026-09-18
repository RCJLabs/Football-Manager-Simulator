// Single persisted app state. league + in-progress game + preferences.
import { migrateLeague } from './engine/season.js';

const KEY = 'gridiron-eras:state:v1';

const listeners = new Set();
let state = { league: null, game: null, prefs: { autoplayMs: 900, showAttrs: true } };
let dirty = false;
let saveTimer = null;

export function getState() {
  return state;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed, prefs: { ...state.prefs, ...(parsed.prefs || {}) } };
      if (state.league) migrateLeague(state.league);
    }
  } catch (e) {
    console.warn('Could not load saved state', e);
  }
  return state;
}

export function saveNow() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
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

export function resetAll() {
  state = { league: null, game: null, prefs: state.prefs };
  saveNow();
  notify();
}

export function exportJSON() {
  return JSON.stringify(state, null, 0);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !('league' in parsed)) throw new Error('Not a Gridiron Eras save file');
  state = { ...state, ...parsed, prefs: { ...state.prefs, ...(parsed.prefs || {}) } };
  if (state.league) migrateLeague(state.league);
  saveNow();
  notify();
}

window.addEventListener('pagehide', () => { if (dirty) saveNow(); });
window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty) saveNow(); });
