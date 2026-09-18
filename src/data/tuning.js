// Rating overrides: edits made in the app's rating editor, kept as a diff in
// preferences, applied to the pool at boot, exportable as a file that
// scripts/apply-overrides.mjs can bake into the data file.
import { POSITIONS } from './positions.js';
import { forgetOverall } from '../engine/ratings.js';

/** Apply { id: { attr: value } } to the pool in place, remembering the base ratings so it can be undone. */
export function applyOverrides(players, byId, overrides = {}) {
  let n = 0;
  for (const [id, attrs] of Object.entries(overrides || {})) {
    const p = byId.get(id);
    if (!p || !attrs) continue;
    p.baseR ??= { ...p.r };
    for (const [a, v] of Object.entries(attrs)) {
      if (!POSITIONS[p.pos].attrs.includes(a)) continue;
      const val = Math.max(40, Math.min(99, Math.round(Number(v))));
      if (!Number.isFinite(val)) continue;
      p.r[a] = val;
      n++;
    }
    forgetOverall(id);
  }
  return n;
}

/** Put every edited player back on the shipped ratings. */
export function clearOverrides(players) {
  for (const p of players) {
    if (p.baseR) { p.r = { ...p.baseR }; delete p.baseR; forgetOverall(p.id); }
  }
}

/** Record one edit in the overrides map and apply it to the player; returns the map. */
export function setOverride(overrides, p, attr, value) {
  const val = Math.max(40, Math.min(99, Math.round(Number(value))));
  if (!Number.isFinite(val)) return overrides;
  p.baseR ??= { ...p.r };
  overrides[p.id] ??= {};
  if (val === p.baseR[attr]) delete overrides[p.id][attr]; else overrides[p.id][attr] = val;
  if (!Object.keys(overrides[p.id]).length) delete overrides[p.id];
  p.r[attr] = val;
  forgetOverall(p.id);
  return overrides;
}

/** The export file: a diff against a fingerprinted pool, with names for human readers. */
export function overridesFile(overrides, byId, poolFingerprint) {
  const entries = Object.entries(overrides || {}).filter(([id]) => byId.get(id)).map(([id, attrs]) => {
    const p = byId.get(id);
    return { id, name: p.realName || p.name, pos: p.pos, season: p.season, from: Object.fromEntries(Object.keys(attrs).map((a) => [a, (p.baseR || p.r)[a]])), to: { ...attrs } };
  });
  return { version: 1, pool: poolFingerprint, count: entries.length, changes: entries };
}
