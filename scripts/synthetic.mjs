// Synthetic player pool for engine calibration/tests (no real-player data needed).
import { POSITIONS, ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';

/** Make a full 26-man team whose ratings center on `mean` with spread `sd`. */
export function syntheticTeam(id, mean, sd, seed, opts = {}) {
  const rng = new RNG(seed);
  const slots = {};
  const byId = new Map();
  const counters = {};
  for (const slot of ROSTER_SLOTS) {
    const def = POSITIONS[slot.pos];
    const n = (counters[slot.pos] = (counters[slot.pos] || 0) + 1);
    const r = {};
    // Depth: bench players a bit worse. opts.posMeans can override a position's mean.
    const m = ((opts.posMeans && opts.posMeans[slot.pos]) ?? mean) - (slot.starter ? 0 : 6);
    for (const a of def.attrs) r[a] = Math.round(Math.min(99, Math.max(40, rng.normal(m, sd))));
    const p = { id: `${id}-${slot.id}`, name: `${id} ${slot.pos}${n}`, pos: slot.pos, season: 2000, team: id.toUpperCase().slice(0, 3), r };
    byId.set(p.id, p);
    slots[slot.id] = p.id;
  }
  return { id, name: `Team ${id}`, abbr: id.toUpperCase().slice(0, 3), color: '#888', slots, byId, strategy: { passRate: 0.55, aggression: 0.4, tempo: 0.5, blitzRate: 0.25, deepShell: 0.2, ...opts.strategy } };
}

/** A synthetic free-agent pool big enough for an 8-team draft (~1.4x demand). */
export function syntheticPool(seed = 7, multiplier = 1.4) {
  const rng = new RNG(seed);
  const pool = [];
  for (const [pos, def] of Object.entries(POSITIONS)) {
    const n = Math.ceil((ROSTER_SLOTS.filter((s) => s.pos === pos).length) * 8 * multiplier);
    for (let i = 0; i < n; i++) {
      const talent = rng.normal(84, 5);
      const r = {};
      for (const a of def.attrs) r[a] = Math.round(Math.min(99, Math.max(40, rng.normal(talent, 4))));
      const season = 1950 + rng.int(0, 75);
      pool.push({ id: `syn-${pos.toLowerCase()}-${i}-${season}`, name: `Syn ${pos} ${i}`, pos, season, team: 'SYN', r });
    }
  }
  return pool;
}
