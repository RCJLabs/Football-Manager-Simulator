// Save slots: several leagues in one browser. A registry lists the slots and
// which one is active; each slot's state lives under its own key. The logic
// takes the storage object as an argument so it can be tested without a
// browser (any object with getItem/setItem/removeItem works).

export const REGISTRY_KEY = 'gridiron-eras:slots:v1';
export const LEGACY_KEY = 'gridiron-eras:state:v1';
export const PREFS_KEY = 'gridiron-eras:prefs:v1';
export const slotKey = (id) => `gridiron-eras:slot:${id}`;

function read(storage, key) {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

/** The registry, created on first use. A save from before slots existed becomes slot one. */
export function loadRegistry(storage) {
  let reg = read(storage, REGISTRY_KEY);
  if (reg && Array.isArray(reg.slots)) return reg;
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
  write(storage, REGISTRY_KEY, reg);
  return reg;
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

export function readSlot(storage, id) {
  return read(storage, slotKey(id));
}

export function writeSlot(storage, reg, id, state) {
  write(storage, slotKey(id), { league: state.league, game: state.game });
  const s = reg.slots.find((x) => x.id === id);
  if (s) {
    s.updated = Date.now();
    s.summary = summarize(state.league);
    if (state.league && state.league.name) s.name = state.league.name;
  }
  write(storage, REGISTRY_KEY, reg);
}

export function createSlot(storage, reg, name = 'New league') {
  const id = newId();
  reg.slots.push({ id, name, created: Date.now(), updated: Date.now(), summary: summarize(null) });
  write(storage, slotKey(id), { league: null, game: null });
  reg.active = id;
  write(storage, REGISTRY_KEY, reg);
  return id;
}

export function activateSlot(storage, reg, id) {
  if (!reg.slots.some((s) => s.id === id)) throw new Error('No such save slot');
  reg.active = id;
  write(storage, REGISTRY_KEY, reg);
  return readSlot(storage, id) || { league: null, game: null };
}

export function deleteSlot(storage, reg, id) {
  reg.slots = reg.slots.filter((s) => s.id !== id);
  try { storage.removeItem(slotKey(id)); } catch { /* fine */ }
  if (reg.active === id) reg.active = reg.slots.length ? reg.slots[reg.slots.length - 1].id : null;
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
