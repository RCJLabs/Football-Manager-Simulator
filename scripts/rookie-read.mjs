// What a rookie pick is worth, and what reading a prospect better buys.
//
// Three measurements, each on the engine as shipped (`rankForTeam` takes a
// `read` and `weights` for exactly this; play never passes either).
//
//   picks    Every club's rookie picks in simulated pro leagues. At each pick
//            the same board is read several ways at the same moment — the old
//            read (floor plus 35% of the band), the read the game now drafts
//            on (the low end: what he is now), each at the club's own
//            accuracy, at a perfect read, and with the club's top three
//            prospects "worked out" (their error cut to 30%); other shares of
//            upside; and the arrival-aware read that was tried and dropped —
//            and the draft carries on under the old read, so the league never
//            diverges and every difference is the read and nothing else. Each
//            man picked is scored by his own seeded future, which careers make
//            exact: leverage-weighted seasons above 75 over six years (V); his
//            mean rating over the deal after each season's growth (deal); the
//            same as a lineup counts him, from his debut rating (kickoff) —
//            the one that matters to the club that drafts him; and his peak.
//   weights  The snake draft's hand-set POS_BASE against the measured leverage
//            table, by wins: half the clubs in each league draft on each, a
//            season is played, and every seed is run again with the halves
//            swapped so draft slot cancels.
//   dynasty  Whole pro dynasties with every offseason draft run on the old
//            read or another, paired by seed: the computer clubs' mean lineup
//            strength at each kickoff. Both arms run in one process, which is
//            only sound because `overall` no longer caches generated players —
//            see the note there; before that fix the second arm read the
//            first arm's rookies and every alternative looked forty points
//            worse.
//
// Usage: node scripts/rookie-read.mjs picks   [leagues] [offseasons] [first seed]
//        node scripts/rookie-read.mjs weights [seeds] [clubs] [league mode] [first seed]
//        node scripts/rookie-read.mjs dynasty [leagues] [seasons] [first seed] [now | arrival | upside:0.15]
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll, rankForTeam, makePick, passPick, currentPicker, POS_BASE } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { enterOffseason, aiKeepers, confirmKeepers, closeFreeAgency } from '../src/engine/offseason.js';
import { applyCareers, careerIndex, startCareer, stepCareer } from '../src/engine/careers.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { TRUE_LEVERAGE, overall } from '../src/engine/ratings.js';
import { lineupStrength } from '../src/engine/transactions.js';
import { scoutReport, scoutedOverall, accuracyOf, UPSIDE_WEIGHT, ARRIVE_AT_PACE_1 } from '../src/engine/scouting.js';

registerPlayers(PLAYERS_BY_ID);
const [MODE = 'picks', ...rest] = process.argv.slice(2);
const arg = (i, d) => (rest[i] != null ? Number(rest[i]) : d);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const poolOf = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const se = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length / xs.length); };
const pm = (xs, d = 1) => `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(d)} ± ${se(xs).toFixed(d)}`;

// The old read: the band's floor plus a flat 35% of the way to its ceiling.
const OLD = (lg, p, t) => scoutReport(lg, p, t).estimate;
// The read the game drafts on now: the low end of the band, what he is now.
const NOW = (lg, p, t) => scoutedOverall(lg, p, t);
// Tried and not shipped: the old read's upside share, scaled by how much of the
// four-year deal he spends arrived, normalised so an average developer
// (arriving in ARRIVE_AT_PACE_1 seasons) reads as before.
const arrivedShare = (years) => { let s = 0; for (let k = 1; k <= 4; k++) s += Math.min(1, k / Math.max(1, years)); return s / 4; };
const ARRIVAL = (lg, p, t, opts = {}) => {
  const r = scoutReport(lg, p, t, opts);
  if (r.known) return r.estimate;
  return Math.round(r.low + (r.high - r.low) * UPSIDE_WEIGHT * arrivedShare((r.soon + r.late) / 2) / arrivedShare(ARRIVE_AT_PACE_1));
};
/** The new read without its normalisation: the plain mean of his projected seasons over the deal. */
const PLAIN = (lg, p, t) => {
  const r = scoutReport(lg, p, t);
  if (r.known) return r.estimate;
  const years = Math.max(1, (r.soon + r.late) / 2);
  let m = 0;
  for (let k = 1; k <= 4; k++) m += Math.min(1, k / years);
  return Math.round(r.low + (r.high - r.low) * (m / 4));
};
/** The old read with a different share of the band counted as upside. */
const upside = (w) => (lg, p, t) => { const r = scoutReport(lg, p, t); return r.known ? r.estimate : Math.round(r.low + (r.high - r.low) * w); };
const withAccuracy = (read, lg, p, t, accuracy) => (read === NOW ? scoutedOverall(lg, p, t, { accuracy })
  : read === ARRIVAL ? ARRIVAL(lg, p, t, { accuracy }) : scoutReport(lg, p, t, { accuracy }).estimate);
const perfect = (read) => (lg, p, t) => withAccuracy(read, lg, p, t, 1);
/** A workout cuts a club's error on a prospect to this share of what it was. */
const WORKOUT_RESIDUAL = 0.3;
const workedOut = (read, boards) => (lg, p, t) => {
  if (!boards.get(t)?.has(p.id)) return read(lg, p, t);
  return withAccuracy(read, lg, p, t, 1 - (1 - accuracyOf(lg, t)) * WORKOUT_RESIDUAL);
};

/** A man's own future from here, which careers make exact: no knocks, no focus. */
const scored = new Map();
function score(lg, p) {
  const key = `${lg.seed}:${p.id}:${lg.season}`;
  if (scored.has(key)) return scored.get(key);
  const src = p.base || p;
  let c = lg.dev?.[p.id] ? { ...lg.dev[p.id] } : { ...startCareer(lg, src), from: lg.season };
  let V = 0, deal = 0, peak = 0;
  // What a lineup counts him at, kickoff by kickoff over the deal: his debut
  // season at the rating he arrives with, then after each season's growth.
  let kick = overall(p) / 4;
  for (let k = 0; k < 6; k++) {
    const s = stepCareer(lg, src, c, lg.season + k, 0, null);
    c = s.career;
    V += (TRUE_LEVERAGE[p.pos] ?? 1) * Math.max(0, s.after - 75);
    if (k < 4) deal += s.after / 4;
    if (k < 3) kick += s.after / 4;
    peak = Math.max(peak, s.after);
    if (c.age >= c.retireAt) break;
  }
  const out = { V, deal, peak, kick };
  scored.set(key, out);
  return out;
}

/** Season, offseason and market to the draft's open, the way simulating ahead gets there. */
function toDraft(lg, seed, yr) {
  simulateAhead(lg, index(lg), poolOf(lg), new RNG(seed * 7 + yr), 'offseason');
  if (lg.phase !== 'complete') return false;
  enterOffseason(lg, poolOf(lg), index(lg));
  const u = lg.teams.findIndex((t) => t.isUser);
  confirmKeepers(lg, aiKeepers(lg, u, poolOf(lg), index(lg), null), poolOf(lg), index(lg));
  closeFreeAgency(lg, poolOf(lg), index(lg));
  return lg.phase === 'draft';
}

/** Run the draft on a read, calling `each(team, pool)` before every pick. */
function runDraft(lg, read, rng, each = null) {
  const draft = lg.draft, pool = poolOf(lg);
  let guard = 0;
  while (!draft.complete && guard++ < 5000) {
    const t = currentPicker(draft);
    if (each) each(t, pool);
    const pick = rankForTeam(lg, draft, pool, t, rng, { bestOnly: true, read })[0]?.player;
    if (!pick) passPick(lg, draft); else makePick(lg, draft, pick);
  }
  startSeason(lg, index(lg));
}

function newLeague(seed) {
  const lg = createLeague({ name: 'R', mode: 'pro', numTeams: 32, franchise: 9, seed, draftType: 'snake', user: {}, injuries: 'normal' });
  lg.settings.jobs = false;
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  return lg;
}

if (MODE === 'picks') {
  const LEAGUES = arg(0, 4), SEASONS = arg(1, 4), SEED0 = arg(2, 9100);
  const ARMS = ['old, perfect read', 'old + 3 workouts', 'now (shipped)', 'now, perfect read', 'now + 3 workouts',
    'upside 0.15', 'upside 0.25', 'upside 0.5', 'arrival', 'arrival, plain mean', 'hindsight'];
  const res = Object.fromEntries(ARMS.map((a) => [a, { V: [], deal: [], peak: [], kick: [], changed: 0 }]));
  let picks = 0;
  for (let L = 0; L < LEAGUES; L++) {
    const seed = SEED0 + L * 61;
    const lg = newLeague(seed);
    for (let yr = 1; yr <= SEASONS; yr++) {
      if (!toDraft(lg, seed, yr)) break;
      const draft = lg.draft;
      // Each club's workouts go on the top three prospects of its own board,
      // under each read, taken when the draft opens.
      const boards = { old: new Map(), now: new Map() };
      const pool0 = poolOf(lg);
      lg.teams.forEach((_, t) => {
        for (const [k, read] of [['old', OLD], ['now', NOW]]) {
          boards[k].set(t, new Set(rankForTeam(lg, draft, pool0, t, null, { read }).filter((x) => x.player.generated).slice(0, 3).map((x) => x.player.id)));
        }
      });
      const reads = {
        'old, perfect read': perfect(OLD), 'old + 3 workouts': workedOut(OLD, boards.old),
        'now (shipped)': NOW, 'now, perfect read': perfect(NOW), 'now + 3 workouts': workedOut(NOW, boards.now),
        'upside 0.15': upside(0.15), 'upside 0.25': upside(0.25), 'upside 0.5': upside(0.5),
        arrival: ARRIVAL, 'arrival, plain mean': PLAIN,
      };
      runDraft(lg, OLD, new RNG(seed * 13 + yr), (t, pool) => {
        const choose = (read) => rankForTeam(lg, draft, pool, t, null, { bestOnly: true, read })[0]?.player;
        const base = choose(OLD);
        if (!base?.generated) return;
        picks++;
        const b = score(lg, base);
        const alts = Object.fromEntries(Object.entries(reads).map(([k, read]) => [k, choose(read) || base]));
        // Hindsight: the best of the rookies this club's own ranking would consider.
        const ranked = rankForTeam(lg, draft, pool, t, null, { read: OLD }).filter((x) => x.player.generated).map((x) => x.player);
        alts.hindsight = ranked.reduce((a, c) => (score(lg, c).V > score(lg, a).V ? c : a), base);
        for (const [k, p] of Object.entries(alts)) {
          const s = score(lg, p);
          res[k].V.push(s.V - b.V); res[k].deal.push(s.deal - b.deal); res[k].peak.push(s.peak - b.peak); res[k].kick.push(s.kick - b.kick);
          if (p.id !== base.id) res[k].changed++;
        }
      });
    }
  }
  console.log(`${picks} rookie picks by every club, ${LEAGUES} leagues × ${SEASONS} offseasons from seed ${SEED0}; each read against the old flat read's pick from the same board`);
  for (const [k, r] of Object.entries(res)) {
    console.log(`  ${k.padEnd(18)} changes ${String(Math.round(100 * r.changed / picks)).padStart(2)}% · V ${pm(r.V)} · over the deal ${pm(r.deal, 2)} · at kickoff over the deal ${pm(r.kick, 2)} · peak ${pm(r.peak, 2)}`);
  }
} else if (MODE === 'weights') {
  const SEEDS = arg(0, 30), CLUBS = arg(1, 12), LEAGUE = rest[2] || (CLUBS === 32 ? 'pro' : 'fantasy'), SEED0 = arg(3, 100);
  const scale = mean(Object.values(POS_BASE)) / mean(Object.values(TRUE_LEVERAGE));
  const LEV = Object.fromEntries(Object.entries(TRUE_LEVERAGE).map(([k, v]) => [k, v * scale]));
  const diffs = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = SEED0 + s * 17;
    const pair = [];
    for (const swap of [0, 1]) {
      const lg = createLeague({ name: 'W', mode: LEAGUE, numTeams: CLUBS, seed, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' }, ...(LEAGUE === 'pro' ? { franchise: 5 } : {}), injuries: 'normal' });
      lg.settings.jobs = false;
      const lev = lg.teams.map((_, i) => ((i % 2) ^ swap) === 1);
      const rng = new RNG(seed);
      let guard = 0;
      while (!lg.draft.complete && guard++ < 5000) {
        const t = currentPicker(lg.draft);
        const pick = rankForTeam(lg, lg.draft, PLAYERS, t, rng, { bestOnly: true, weights: lev[t] ? LEV : POS_BASE })[0]?.player;
        if (!pick) passPick(lg, lg.draft); else makePick(lg, lg.draft, pick);
      }
      startSeason(lg, PLAYERS_BY_ID);
      simulateAhead(lg, PLAYERS_BY_ID, PLAYERS, new RNG(seed * 3 + swap), 'offseason');
      const pct = lg.teams.map((t) => (t.record.w + 0.5 * t.record.t) / Math.max(1, t.record.w + t.record.l + t.record.t));
      const g = (want) => mean(pct.filter((_, i) => lev[i] === want));
      pair.push(g(true) - g(false));
    }
    diffs.push((pair[0] + pair[1]) / 2);
  }
  console.log(`${LEAGUE}, ${CLUBS} clubs, ${SEEDS} seeds from ${SEED0} × 2 swaps: clubs drafting on the leverage table minus clubs drafting on POS_BASE, win share ${pm(diffs.map((d) => 100 * d))} points · ahead in ${diffs.filter((d) => d > 0).length} of ${diffs.length}`);
} else if (MODE === 'dynasty') {
  const LEAGUES = arg(0, 4), SEASONS = arg(1, 6), SEED0 = arg(2, 1200);
  // The read to set against the old one: the shipped read by default,
  // `arrival` for the one tried and dropped, or `upside:0.15` for the old read
  // counting that share of the band.
  const ALT = rest[3] || 'now';
  const altRead = ALT.startsWith('upside:') ? upside(Number(ALT.slice(7))) : ALT === 'arrival' ? ARRIVAL : NOW;
  const gap = {};
  for (let L = 0; L < LEAGUES; L++) {
    const seed = SEED0 + L * 71;
    const strength = {};
    for (const [name, read] of [['old', OLD], ['alt', altRead]]) {
      const lg = newLeague(seed);
      for (let yr = 1; yr <= SEASONS; yr++) {
        if (!toDraft(lg, seed, yr)) break;
        runDraft(lg, read, new RNG(seed * 13 + yr));
        const byId = index(lg);
        const ai = lg.teams.filter((t) => !t.isUser);
        (strength[name] ??= {})[lg.season] = mean(ai.map((t) => lineupStrength(t.slots, byId)));
      }
    }
    for (const season of Object.keys(strength.old)) if (strength.alt[season] != null) (gap[season] ??= []).push(strength.alt[season] - strength.old[season]);
    if (process.env.ROOKIE_READ_DUMP) console.log('LEAGUE ' + JSON.stringify({ seed, old: strength.old, alt: strength.alt }));
  }
  console.log(`${LEAGUES} pro leagues from seed ${SEED0}, drafts on ${ALT} minus the old read: the computer clubs' mean lineup strength at kickoff (a point of scoring margin a game is about 25)`);
  for (const [season, xs] of Object.entries(gap)) console.log(`  season ${season}: ${pm(xs)}`);
} else {
  console.error(`unknown mode ${MODE}: picks, weights or dynasty`);
  process.exit(1);
}
