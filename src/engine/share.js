// League codes: a compact, pasteable snapshot of a league at the start of a
// season (every club's roster, contracts, settings, seed), so a friend can
// run the same league on another device. Results, logs and history are not
// carried; the code is a starting point, not a replay.
//
// The players file must match on both ends, so the code carries a fingerprint
// of the pool and refuses to open against a different one.

import { ROSTER_SLOTS } from '../data/positions.js';
import { createLeague, startSeason } from './season.js';
import { leagueIndex } from './rookies.js';

export const CODE_VERSION = 1;

/** A cheap fingerprint of the player pool: count plus a rolling hash of the ids. */
export function poolFingerprint(players) {
  // Generated rookies belong to one league, so they are not part of what two
  // people have to agree on for a code to open.
  const base = players.filter((p) => !p.generated);
  let h = 2166136261;
  for (const p of base) for (let i = 0; i < p.id.length; i++) { h ^= p.id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${base.length}-${h.toString(36)}`;
}

export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

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

/**
 * Pack an object into a pasteable code with the given two-letter tag: deflated
 * where the browser can, plain base64url where it cannot. Both codes decode.
 */
export async function packCode(tag, obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const packed = await deflate(bytes);
  return packed ? `${tag}1.${b64url(packed)}` : `${tag}0.${b64url(bytes)}`;
}

/** The other direction. Throws if the text is not a code with this tag. */
export async function unpackCode(tag, code, what = 'code') {
  const text = String(code || '').trim().replace(/\s+/g, '');
  const m = new RegExp(`^${tag}([01])\\.([A-Za-z0-9_-]+)$`).exec(text);
  if (!m) throw new Error(`That is not a ${what}`);
  // A truncated or edited code decodes to nonsense; say so plainly rather
  // than leaking a decompression or JSON error to the screen.
  try {
    const bytes = unb64url(m[2]);
    return JSON.parse(new TextDecoder().decode(m[1] === '1' ? await inflate(bytes) : bytes));
  } catch {
    throw new Error(`That ${what} is damaged or incomplete. Copy the whole thing and try again.`);
  }
}

/** What the code carries. Player ids become pool indices to keep it short. */
export function snapshot(league, players) {
  const base = players.filter((p) => !p.generated);
  const index = new Map(base.map((p, i) => [p.id, i]));
  const rookies = league.rookies || [];
  const rookieAt = new Map(rookies.map((p, i) => [p.id, i]));
  // A slot holds a base-pool index, -1 for empty, or -(k + 2) for rookie k.
  const slotRef = (id) => (id == null ? -1 : index.has(id) ? index.get(id) : rookieAt.has(id) ? -(rookieAt.get(id) + 2) : -1);
  return {
    rookies,
    v: CODE_VERSION,
    pool: poolFingerprint(players),
    name: league.name, mode: league.mode, seed: league.seed, season: league.season, draftType: league.draftType,
    franchise: league.mode === 'pro' ? league.teams.findIndex((t) => t.isUser) : undefined,
    settings: { ...league.settings },
    teams: league.teams.map((t) => ({
      n: t.name, a: t.abbr, c: t.color, g: t.gm, u: t.isUser ? 1 : 0,
      s: ROSTER_SLOTS.map((sl) => slotRef(t.slots[sl.id])),
      ir: (t.ir || []).map((id) => slotRef(id)).filter((i) => i !== -1),
      st: t.strategy,
    })),
    contracts: Object.fromEntries(Object.entries(league.contracts || {}).map(([id, c]) => [slotRef(id), c]).filter(([k]) => k !== -1)),
  };
}

export async function encodeLeagueCode(league, players) {
  return packCode('GE', snapshot(league, players));
}

export async function decodeLeagueCode(code) {
  const snap = await unpackCode('GE', code, 'league code');
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
  // The league's own rookies come with it; a slot reference of -(k + 2) names one.
  league.rookies = (snap.rookies || []).map((p) => ({ ...p, r: { ...p.r } }));
  const base = players.filter((p) => !p.generated);
  const idAt = (ref) => (ref >= 0 ? base[ref]?.id : ref <= -2 ? league.rookies[-ref - 2]?.id : null) || null;
  snap.teams.forEach((st, i) => {
    const t = league.teams[i];
    t.name = st.n; t.abbr = st.a; t.color = st.c; t.gm = st.g; t.isUser = !!st.u;
    t.strategy = { ...t.strategy, ...(st.st || {}) };
    const slots = {};
    ROSTER_SLOTS.forEach((sl, k) => { slots[sl.id] = idAt(st.s[k]); });
    t.slots = slots;
    t.ir = (st.ir || []).map(idAt).filter(Boolean);
  });
  league.contracts = Object.fromEntries(Object.entries(snap.contracts || {}).map(([k, c]) => [idAt(Number(k)), c]).filter(([id]) => id));
  // The market is over: the auction or draft is complete by definition.
  const held = (t, ti) => [...Object.values(t.slots).filter(Boolean), ...(t.ir || [])].map((id) => [id, ti]);
  if (league.auction) { league.auction.complete = true; league.auction.taken = Object.fromEntries(league.teams.flatMap(held)); }
  if (league.draft) { league.draft.complete = true; league.draft.taken = Object.fromEntries(league.teams.flatMap(held)); }
  league.shared = true;
  startSeason(league, leagueIndex(league, byId));
  return league;
}
