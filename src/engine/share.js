// League codes: a compact, pasteable snapshot of a league at the start of a
// season (every club's roster, contracts, settings, seed), so a friend can
// run the same league on another device. Results, logs and history are not
// carried; the code is a starting point, not a replay.
//
// The players file must match on both ends, so the code carries a fingerprint
// of the pool and refuses to open against a different one.

import { ROSTER_SLOTS } from '../data/positions.js';
import { createLeague, startSeason } from './season.js';

export const CODE_VERSION = 1;

/** A cheap fingerprint of the player pool: count plus a rolling hash of the ids. */
export function poolFingerprint(players) {
  let h = 2166136261;
  for (const p of players) for (let i = 0; i < p.id.length; i++) { h ^= p.id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${players.length}-${h.toString(36)}`;
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/** What the code carries. Player ids become pool indices to keep it short. */
export function snapshot(league, players) {
  const index = new Map(players.map((p, i) => [p.id, i]));
  return {
    v: CODE_VERSION,
    pool: poolFingerprint(players),
    name: league.name, mode: league.mode, seed: league.seed, season: league.season, draftType: league.draftType,
    franchise: league.mode === 'pro' ? league.teams.findIndex((t) => t.isUser) : undefined,
    settings: { ...league.settings },
    teams: league.teams.map((t) => ({
      n: t.name, a: t.abbr, c: t.color, g: t.gm, u: t.isUser ? 1 : 0,
      s: ROSTER_SLOTS.map((sl) => (t.slots[sl.id] ? index.get(t.slots[sl.id]) ?? -1 : -1)),
      st: t.strategy,
    })),
    contracts: Object.fromEntries(Object.entries(league.contracts || {}).map(([id, c]) => [index.get(id), c]).filter(([k]) => k != null)),
  };
}

export async function encodeLeagueCode(league, players) {
  const json = JSON.stringify(snapshot(league, players));
  const bytes = new TextEncoder().encode(json);
  const packed = await deflate(bytes);
  return packed ? `GE1.${b64url(packed)}` : `GE0.${b64url(bytes)}`;
}

export async function decodeLeagueCode(code) {
  const text = String(code || '').trim().replace(/\s+/g, '');
  const m = /^GE([01])\.([A-Za-z0-9_-]+)$/.exec(text);
  if (!m) throw new Error('That is not a league code');
  const bytes = unb64url(m[2]);
  const json = new TextDecoder().decode(m[1] === '1' ? await inflate(bytes) : bytes);
  const snap = JSON.parse(json);
  if (snap.v !== CODE_VERSION) throw new Error(`League code version ${snap.v} is not supported`);
  return snap;
}

/** Rebuild a league from a snapshot: same clubs, rosters, contracts and settings, at the start of its season. */
export function leagueFromSnapshot(snap, players, byId) {
  if (snap.pool !== poolFingerprint(players)) throw new Error('This code was made with a different player pool; both games need the same version');
  const userTeam = snap.teams.find((t) => t.u);
  const league = createLeague({
    name: snap.name, mode: snap.mode, numTeams: snap.teams.length, seed: snap.seed, draftType: snap.draftType,
    franchise: snap.franchise, user: userTeam ? { name: userTeam.n, abbr: userTeam.a, color: userTeam.c } : {},
    injuries: snap.settings?.injuries, keepers: snap.settings?.keepers,
  });
  league.settings = { ...league.settings, ...snap.settings };
  league.season = snap.season || 1;
  snap.teams.forEach((st, i) => {
    const t = league.teams[i];
    t.name = st.n; t.abbr = st.a; t.color = st.c; t.gm = st.g; t.isUser = !!st.u;
    t.strategy = { ...t.strategy, ...(st.st || {}) };
    const slots = {};
    ROSTER_SLOTS.forEach((sl, k) => { const idx = st.s[k]; slots[sl.id] = idx >= 0 && players[idx] ? players[idx].id : null; });
    t.slots = slots;
  });
  league.contracts = Object.fromEntries(Object.entries(snap.contracts || {}).map(([k, c]) => [players[Number(k)]?.id, c]).filter(([id]) => id));
  // The market is over: the auction or draft is complete by definition.
  if (league.auction) { league.auction.complete = true; league.auction.taken = Object.fromEntries(league.teams.flatMap((t, ti) => Object.values(t.slots).filter(Boolean).map((id) => [id, ti]))); }
  if (league.draft) { league.draft.complete = true; league.draft.taken = Object.fromEntries(league.teams.flatMap((t, ti) => Object.values(t.slots).filter(Boolean).map((id) => [id, ti]))); }
  league.shared = true;
  startSeason(league, byId);
  return league;
}
