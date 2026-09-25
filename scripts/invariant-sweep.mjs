// Does every kind of league still hold together after a few offseasons?
//
//   npm run sweep                         every combination, 5 seasons, seed 101
//   node scripts/invariant-sweep.mjs [seasons] [seed] [filter]
//
// A bug that lives in one combination of setup choices is invisible to a test
// written for another. A pro league that auctioned took the fantasy path in
// four places and nothing noticed for as long as that choice had existed,
// because every test and every measurement built a pro league by draft. This
// plays each combination worth telling apart — a base per kind of league (the
// two modes by the two ways to build a roster), one setting changed at a time,
// and a few pairs that meet in the offseason's money — through several
// offseasons with every decision left to the AI, and checks what must hold in
// any league at all.
//
// The season is played by `simulateAhead`, the app's own path, weekly moves
// and trades included. The offseason is stepped by hand in the same order, so
// the keeper round can be checked between what it is priced at and what is
// written.
//
// At every kickoff:
//   the league reached the new season, and its market completed
//   every slot filled, each by a man of that position; nobody on two clubs;
//     nobody retired, and nobody the drain has shown out, on any roster
//   every man a club carries has a contract, and nobody else does; under a cap
//     each has a term of at least a year and no deal is left marked expiring;
//     a fantasy keeper has been kept at most MAX_KEEPS times
//   no club over the cap; no fantasy auction club paying more than its room
//   reserve and squad within capacity; a fantasy club within its keeper quota
//   records reset, a schedule, one club the user's
// In every keeper round:
//   every AI club's own list passes the check the user's must pass
//   what a club's keepers were priced at is what was written
//
// Runs on as many workers as the machine has cores to spare. Exits 1 on any
// problem, printing each; the numbers for the last run are in DESIGN.md, "What
// the invariant sweep found".
import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { autoCompleteAll, BUDGET_SPREADS } from '../src/engine/auction.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { enterOffseason, aiKeepers, confirmKeepers, validateKeepers, keeperCost, takeJob, closeFreeAgency, MAX_KEEPS } from '../src/engine/offseason.js';
import { makeOffers } from '../src/engine/jobs.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { capOn, capHit, PRO_CAP, MIN_SALARY } from '../src/engine/cap.js';
import { departedSet } from '../src/engine/proleague.js';
import { irCapacity } from '../src/engine/injuries.js';
import { squadCapacity } from '../src/engine/squad.js';
import { LEVELS, DEFAULT_DIFFICULTY } from '../src/engine/difficulty.js';

registerPlayers(PLAYERS_BY_ID);
const SEASONS = Number(process.argv[2] || 5);
const SEED = Number(process.argv[3] || 101);
const FILTER = process.argv[4] || '';
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));

const BASES = {
  FA: { mode: 'fantasy', draftType: 'auction', numTeams: 8 },
  FS: { mode: 'fantasy', draftType: 'snake', numTeams: 8 },
  PS: { mode: 'pro', draftType: 'snake', franchise: 3 },
  PA: { mode: 'pro', draftType: 'auction', franchise: 3 },
};
const lo = LEVELS[0], hi = LEVELS[LEVELS.length - 1];
const fantasy = (b) => b.mode === 'fantasy';
const pro = (b) => b.mode === 'pro';
const VARIANTS = [
  ['base', {}],
  ['careers-off', { settings: { careers: false } }],
  ['injuries-off', { injuries: 'off' }],
  ['injuries-high', { injuries: 'high' }],
  [`difficulty-${lo}`, { settings: { difficulty: lo } }],
  [`difficulty-${hi}`, { settings: { difficulty: hi } }],
  ['extras-off', { settings: { chemistry: false, scouting: false, focus: false } }],
  ['teams-10', { numTeams: 10 }, fantasy],
  ['teams-12', { numTeams: 12 }, fantasy],
  ['keepers-0', { keepers: 0 }, fantasy],
  ['keepers-22', { keepers: 22 }, fantasy],
  ['spread-wide', { budgetSpread: BUDGET_SPREADS.wide }, (b) => fantasy(b) && b.draftType === 'auction'],
  ['jobs-off', { settings: { jobs: false } }, pro],
  ['positions-off', { settings: { positions: false } }, pro],
];
const PAIRS = [
  ['FA', 'teams-12+keepers-22+spread', { numTeams: 12, keepers: 22, budgetSpread: BUDGET_SPREADS.wide }],
  ['FA', 'keepers-0+careers-off', { keepers: 0, settings: { careers: false } }],
  ['FS', 'teams-12+keepers-0', { numTeams: 12, keepers: 0 }],
  ['FS', 'keepers-22+careers-off', { keepers: 22, settings: { careers: false } }],
  ['PA', 'careers-off+jobs-off', { settings: { careers: false, jobs: false } }],
  ['PS', 'careers-off+injuries-high', { injuries: 'high', settings: { careers: false } }],
];
const CONFIGS = [];
for (const [bk, base] of Object.entries(BASES)) for (const [vk, v, when] of VARIANTS) if (!when || when(base)) CONFIGS.push({ name: `${bk}:${vk}`, base, v });
for (const [bk, vk, v] of PAIRS) CONFIGS.push({ name: `${bk}:${vk}`, base: BASES[bk], v });
CONFIGS.forEach((c, i) => { c.seed = SEED + i; });

function build(cfg) {
  const { base, v } = cfg;
  const lg = createLeague({ name: cfg.name, user: { name: 'Me', abbr: 'ME', color: '#fff' }, seed: cfg.seed, mode: base.mode, draftType: base.draftType, numTeams: v.numTeams ?? base.numTeams ?? 8, franchise: base.franchise ?? 0, injuries: v.injuries, keepers: v.keepers, budgetSpread: v.budgetSpread ?? 0 });
  // The setup form's defaults, then the variant's.
  Object.assign(lg.settings, { coachMode: false, careers: true, chemistry: true, scouting: true, focus: true, jobs: base.mode === 'pro', positions: base.mode === 'pro', weather: base.mode === 'pro', difficulty: DEFAULT_DIFFICULTY }, v.settings || {});
  const rng = new RNG(cfg.seed);
  if (base.draftType === 'auction') autoCompleteAll(lg.auction, lg, PLAYERS, rng, PLAYERS_BY_ID); else autoDraftAll(lg, lg.draft, PLAYERS, rng);
  lg.rngState = rng.state;
  startSeason(lg, PLAYERS_BY_ID, PLAYERS);
  return lg;
}

function kickoff(lg, room) {
  const v = [];
  const byId = index(lg);
  const retired = new Set(lg.retired || []);
  const gone = departedSet(lg);
  const seen = new Map();
  const capped = capOn(lg);
  if (lg.phase !== 'season') v.push(`phase ${lg.phase}`);
  if (lg.teams.filter((t) => t.isUser).length !== 1) v.push('user clubs != 1');
  if (!lg.schedule?.length) v.push('no schedule');
  const onBooks = new Set();
  lg.teams.forEach((t, i) => {
    const slotIds = ROSTER_SLOTS.map((s) => t.slots[s.id]);
    const empty = slotIds.filter((x) => !x).length;
    if (empty) v.push(`${t.abbr}: ${empty} empty slot(s)`);
    for (const s of ROSTER_SLOTS) {
      const id = t.slots[s.id];
      if (!id) continue;
      const p = byId.get(id);
      if (!p) v.push(`${t.abbr} ${s.id}: unknown ${id}`);
      else if (p.pos !== s.pos) v.push(`${t.abbr} ${s.id}: a ${p.pos} (${p.name})`);
    }
    let salaries = 0;
    for (const id of [...slotIds.filter(Boolean), ...(t.ir || []), ...(t.squad || [])]) {
      onBooks.add(id);
      const name = byId.get(id)?.name || id;
      if (seen.has(id)) v.push(`${name} on ${seen.get(id)} and ${t.abbr}`); else seen.set(id, t.abbr);
      if (retired.has(id) || byId.get(id)?.retired) v.push(`retired ${name} on ${t.abbr}`);
      if (gone.has(id)) v.push(`drained ${name} on ${t.abbr}`);
      const c = lg.contracts?.[id];
      if (!c) { v.push(`${t.abbr}: ${name} has no contract`); continue; }
      if (capped) {
        if (!(Number.isInteger(c.years) && c.years >= 1)) v.push(`${t.abbr}: ${name} term ${c.years}`);
        if (c.expiring) v.push(`${t.abbr}: ${name} still marked expiring`);
        if (!(c.salary >= MIN_SALARY)) v.push(`${t.abbr}: ${name} salary ${c.salary}`);
      } else {
        if ((c.kept ?? 0) > MAX_KEEPS) v.push(`${t.abbr}: ${name} kept ${c.kept} times`);
        if (lg.draftType === 'auction') {
          if (!(c.salary >= 1)) v.push(`${t.abbr}: ${name} salary ${c.salary}`);
          salaries += c.salary ?? 0;
        }
      }
    }
    if ((t.ir || []).length > irCapacity(lg)) v.push(`${t.abbr}: reserve ${(t.ir || []).length} of ${irCapacity(lg)}`);
    if ((t.squad || []).length > squadCapacity(lg)) v.push(`${t.abbr}: squad ${(t.squad || []).length} of ${squadCapacity(lg)}`);
    if (capped && capHit(lg, i) > (lg.cap ?? PRO_CAP)) v.push(`${t.abbr}: cap hit ${capHit(lg, i)}`);
    if (!capped && lg.draftType === 'auction' && room && salaries > room[i]) v.push(`${t.abbr}: paying ${salaries} from a room of ${room[i]}`);
    if (!capped && lg.season > 1) {
      const kept = slotIds.filter((id) => id && (lg.contracts?.[id]?.kept ?? 0) > 0).length;
      if (kept > (lg.settings.keepers ?? 6)) v.push(`${t.abbr}: ${kept} keepers over a quota of ${lg.settings.keepers}`);
    }
    const r = t.record || {};
    if ((r.w || 0) + (r.l || 0) + (r.t || 0) !== 0) v.push(`${t.abbr}: record not reset`);
  });
  for (const id of Object.keys(lg.contracts || {})) if (!onBooks.has(id)) v.push(`a contract for ${byId.get(id)?.name || id}, who is on no roster`);
  return v;
}

function run(cfg) {
  const out = { name: cfg.name, seed: cfg.seed, problems: [], ms: 0 };
  const t0 = Date.now();
  const note = (season, list) => { for (const p of list) out.problems.push(`season ${season}: ${p}`); };
  try {
    const lg = build(cfg);
    note(1, kickoff(lg, lg.auction?.startBudgets?.slice()));
    for (let s = 2; s <= SEASONS; s++) {
      simulateAhead(lg, index(lg), pool(lg), new RNG(cfg.seed * 97 + s), 'offseason');
      if (lg.phase !== 'complete') throw new Error(`season ${s - 1} ended in ${lg.phase}`);
      enterOffseason(lg, pool(lg), index(lg));
      if (lg.offseason?.step === 'jobs') {
        const byId = index(lg);
        const offers = lg.offseason.carousel?.offers || makeOffers(lg, byId);
        if (offers?.length) takeJob(lg, offers[0].team, pool(lg), byId);
      }
      if (lg.offseason?.step !== 'keepers') throw new Error(`offseason ${s - 1} stopped at ${lg.offseason?.step}`);
      const byId = index(lg);
      const u = lg.teams.findIndex((t) => t.isUser);
      const lists = { ...(lg.offseason.keepers || {}), [u]: aiKeepers(lg, u, pool(lg), byId, null) };
      const round = [];
      lg.teams.forEach((t, i) => {
        const res = validateKeepers(lg, i, lists[i] || [], byId);
        if (!res.ok) round.push(`${t.abbr}${i === u ? ' (the user, on the AI)' : ''}: its keeper list fails: ${res.reason}`);
      });
      const priced = lg.teams.map((_, i) => (lists[i] || []).reduce((sum, id) => sum + keeperCost(lg.contracts[id], byId.get(id), lg), 0));
      confirmKeepers(lg, lists[u], pool(lg), byId);
      if (capOn(lg) || lg.draftType === 'auction') {
        lg.teams.forEach((t, i) => {
          const written = (lists[i] || []).reduce((sum, id) => sum + (lg.contracts[id]?.salary ?? 0), 0);
          if (written !== priced[i]) round.push(`${t.abbr}: keepers priced at ${priced[i]}, written at ${written}`);
        });
      }
      if (lg.phase === 'offseason' && lg.offseason?.step === 'freeagency') closeFreeAgency(lg, pool(lg), index(lg));
      if (lg.phase !== 'draft') throw new Error(`offseason ${s - 1}: the market did not open (${lg.phase}/${lg.offseason?.step})`);
      const mrng = new RNG(cfg.seed * 131 + s);
      let room = null;
      if (lg.draftType === 'auction') {
        room = lg.auction.startBudgets.slice();
        // A fantasy club's room for the season is its keepers plus what it had to bid.
        if (!capOn(lg)) room = room.map((b, i) => b + priced[i]);
        autoCompleteAll(lg.auction, lg, pool(lg), mrng, index(lg));
        if (!lg.auction.complete) round.push('the auction did not complete');
      } else {
        autoDraftAll(lg, lg.draft, pool(lg), mrng);
        if (!lg.draft.complete) round.push('the draft did not complete');
      }
      startSeason(lg, index(lg));
      if (lg.season !== s) throw new Error(`reached season ${lg.season}, expected ${s}`);
      note(s, [...round, ...kickoff(lg, room)]);
    }
  } catch (e) {
    out.problems.push(`threw: ${e.message}`);
  }
  out.ms = Date.now() - t0;
  return out;
}

const configs = CONFIGS.filter((c) => !FILTER || c.name.includes(FILTER));
if (process.env.SWEEP_PART) await worker(); else await main();

/** A slice of the leagues, each result sent to the parent as it finishes. */
async function worker() {
  const [k, n] = process.env.SWEEP_PART.split('/').map(Number);
  // Each result waits for its send, and the channel closes after the last, so
  // nothing is dropped on the way out.
  for (const cfg of configs.filter((_, i) => i % n === k)) await new Promise((sent) => process.send(run(cfg), sent));
  process.disconnect();
}

async function main() {
  const workers = Math.max(1, Math.min(configs.length, cpus().length - 1, 6));
  console.log(`${configs.length} leagues, ${SEASONS} seasons each, seed ${SEED}, ${workers} worker(s)`);
  const results = [];
  await Promise.all(Array.from({ length: workers }, (_, k) => new Promise((done, fail) => {
    const child = fork(fileURLToPath(import.meta.url), process.argv.slice(2), { env: { ...process.env, SWEEP_PART: `${k}/${workers}` } });
    child.on('message', (r) => {
      results.push(r);
      console.log(`${r.name.padEnd(30)} ${(r.ms / 1000).toFixed(0).padStart(4)}s  ${r.problems.length ? `${r.problems.length} problem(s)` : 'ok'}`);
    });
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`worker ${k} exited ${code}`))));
  })));
  const bad = results.filter((r) => r.problems.length);
  for (const r of bad) {
    console.log(`\n${r.name} (seed ${r.seed}):`);
    for (const p of r.problems.slice(0, 12)) console.log(`  ${p}`);
    if (r.problems.length > 12) console.log(`  … and ${r.problems.length - 12} more`);
  }
  console.log(`\n${results.length} leagues: ${results.length - bad.length} clean, ${bad.length} with problems (${bad.reduce((n, r) => n + r.problems.length, 0)} in all)`);
  process.exit(bad.length ? 1 : 0);
}
