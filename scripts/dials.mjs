// What the other four dials are worth, measured the way you play them.
//
//   node scripts/dials.mjs <aggression|tempo|blitzRate|deepShell> [leagues] [games per club] [pro|8|10|12] [first seed]
//
// The team page groups the sliders by what measuring them said. The pass/run
// balance decides games; fourth-down aggression "pays off with a strong offence
// and a poor kicker, and costs little otherwise"; tempo, the blitz and the deep
// shell "change how a game looks more than who wins it". Those claims were
// measured on 19 September, in the same pass as a pass/run read that later
// turned out to have gone stale when a dozen changes to the play model went by
// unmeasured (DESIGN.md, "The pass/run read").
//
// Measured the way the read now is (`npm run passrate -- read`): every club in
// real drafted leagues is played as the human's club is — no matchup plan, the
// default sliders, its pass rate on the read — at each setting of one dial, every
// game paired against the same game at the default setting, against its own
// league's AI clubs. Grouped by what each note says the dial depends on:
//
//   aggression   offence (top or bottom half of the league, by the
//                leverage-weighted overall of its offensive starters) and
//                kicker (top or bottom half, by overall)
//   tempo, blitzRate, deepShell
//                club strength against its league, in thirds by teamPower
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG, hashSeed } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, teamForGame } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { leagueIndex } from '../src/engine/rookies.js';
import { careerIndex } from '../src/engine/careers.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { strategyRead } from '../src/engine/strategy.js';
import { DEFAULT_STRATEGY } from '../src/engine/playcall.js';
import { teamPower, overall, TRUE_LEVERAGE } from '../src/engine/ratings.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';

registerPlayers(PLAYERS_BY_ID);
const SETTINGS = {
  aggression: [0, 0.2, 0.6, 0.8, 1],
  tempo: [0, 0.25, 0.75, 1],
  blitzRate: [0.05, 0.15, 0.4, 0.6],
  deepShell: [0, 0.1, 0.4, 0.6],
};
const [DIAL, ...rest] = process.argv.slice(2);
if (!SETTINGS[DIAL]) { console.error(`which dial? ${Object.keys(SETTINGS).join(', ')}`); process.exit(1); }
const LEAGUES = Number(rest[0] || 8);
const GAMES = Number(rest[1] || 150);
const KIND = rest[2] || '8';
const SEED0 = Number(rest[3] || 41);
const DEFAULT = DEFAULT_STRATEGY[DIAL];
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const se = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1) / xs.length); };
const pm = (xs) => (xs.length > 1 ? `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(2)} ± ${se(xs).toFixed(2)}` : '—');
const OFFENCE = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);

/** The leverage-weighted overall of a lineup's offensive starters. */
function offence(lineup) {
  let s = 0, w = 0;
  const seen = {};
  for (const slot of ROSTER_SLOTS) {
    if (!slot.starter || !OFFENCE.has(slot.pos)) continue;
    const i = seen[slot.pos] = (seen[slot.pos] ?? -1) + 1;
    const p = lineup[slot.pos]?.[i];
    if (!p) continue;
    const k = TRUE_LEVERAGE[p.pos] ?? 1;
    s += overall(p) * k; w += k;
  }
  return w ? s / w : 0;
}

function play(mine, opp, cHome, seed) {
  const g = createGame(cHome ? mine : opp, cHome ? opp : mine, { seed, injuryLevel: 0 });
  simulateGame(g);
  const side = cHome ? 0 : 1;
  return g.score[side] - g.score[1 - side];
}

const rows = [];
for (let L = 0; L < LEAGUES; L++) {
  const seed = SEED0 + 97 * L;
  const pro = KIND === 'pro';
  const lg = createLeague({ name: 'D', mode: pro ? 'pro' : 'fantasy', numTeams: pro ? 32 : Number(KIND), franchise: 5, seed, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' }, injuries: 'normal' });
  lg.settings.jobs = false;
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  const byId = careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
  const teams = lg.teams.map((_, i) => teamForGame(lg, i, byId));
  const n = teams.length;
  // Where each club stands in its own league, on the axes the notes name.
  const power = teams.map((t) => teamPower(t.lineup));
  const off = teams.map((t) => offence(t.lineup));
  const kick = teams.map((t) => (t.lineup.K?.[0] ? overall(t.lineup.K[0]) : 60));
  const rank = (xs, i) => xs.filter((x) => x < xs[i]).length / (n - 1);
  for (let c = 0; c < n; c++) {
    const read = strategyRead(lg, c, byId);
    const asYou = (v) => ({ ...teams[c], isUser: true, strategy: { ...DEFAULT_STRATEGY, passRate: read.rate, [DIAL]: v } });
    const place = { power: rank(power, c), offence: rank(off, c), kicker: rank(kick, c) };
    for (let k = 0; k < GAMES; k++) {
      const o = (c + 1 + ((k * 7 + L * 3) % (n - 1))) % n;
      const cHome = k % 2 === 0, gs = hashSeed(`dl:${seed}:${c}:${k}`);
      const base = play(asYou(DEFAULT), teams[o], cHome, gs);
      const gain = {};
      for (const v of SETTINGS[DIAL]) gain[v] = play(asYou(v), teams[o], cHome, gs) - base;
      rows.push({ ...place, gain });
    }
  }
}

const where = KIND === 'pro' ? 'pro leagues of 32' : `fantasy leagues of ${KIND}`;
console.log(`${DIAL}: ${LEAGUES} ${where} from seed ${SEED0}; every club played as yours (no plan, default sliders, pass rate on its read), ${GAMES} games against its league at each setting, paired against the default ${DEFAULT}`);
console.log(`  ${'group'.padEnd(34)} ${'n'.padStart(6)} ` + SETTINGS[DIAL].map((v) => `at ${v}`.padStart(14)).join('') + '   best');
const line = (label, rs) => {
  const means = SETTINGS[DIAL].map((v) => mean(rs.map((r) => r.gain[v])));
  const top = Math.max(0, ...means);
  const best = top === 0 ? DEFAULT : SETTINGS[DIAL][means.indexOf(top)];
  console.log(`  ${label.padEnd(34)} ${String(rs.length).padStart(6)} ` + SETTINGS[DIAL].map((v) => pm(rs.map((r) => r.gain[v])).padStart(14)).join('') + `   ${best}`);
};
line('every club', rows);
// One line per setting, for the audit to read without parsing the table.
for (const v of SETTINGS[DIAL]) console.log(`  every club at ${v}: ${pm(rows.map((r) => r.gain[v]))}`);
if (DIAL === 'aggression') {
  for (const [label, test] of [
    ['strong offence, poor kicker', (r) => r.offence >= 0.5 && r.kicker < 0.5],
    ['strong offence, good kicker', (r) => r.offence >= 0.5 && r.kicker >= 0.5],
    ['weak offence, poor kicker', (r) => r.offence < 0.5 && r.kicker < 0.5],
    ['weak offence, good kicker', (r) => r.offence < 0.5 && r.kicker >= 0.5],
  ]) line(label, rows.filter(test));
} else {
  line('strongest third of the league', rows.filter((r) => r.power >= 2 / 3));
  line('middle third', rows.filter((r) => r.power >= 1 / 3 && r.power < 2 / 3));
  line('weakest third', rows.filter((r) => r.power < 1 / 3));
}
