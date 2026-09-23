// Does this repository still believe what it says about itself?
//
//   npm run audit            every check, which runs most of scripts/ (~6 min)
//   npm run audit -- --quick only the checks that cost nothing (~2s)
//   npm run audit -- turnover yardstick     only checks matching these words
//
// Every number in DESIGN.md was measured once, and for a long time nothing ever
// measured them again. The first full re-run found a constant quoted in three
// places after it had been refitted, a measuring script printing that same old
// constant as a literal, an injury table out by a factor of two, and a
// correlation that had moved because a DIFFERENT measurement was acted on and
// nobody re-ran this one. None of that was found by anybody noticing. It was
// found by going and looking, months late.
//
// So each entry below is a three-way check rather than a two-way one:
//
//   the engine     what the script prints now, or what the module exports
//   the registry   what this file expects, which is the last agreed answer
//   the document   what DESIGN.md tells a reader
//
// Comparing all three is the point. Engine against registry catches the
// simulation moving. Document against registry catches prose going stale, or
// somebody editing the prose without re-measuring. A check that only compared
// the first two would have passed happily while DESIGN.md said 0.0539.
//
// Tolerances are per entry and deliberately explicit. Some of these scripts are
// deterministic and some are not, and writing `tol: 0` where it is earned says
// something a shared default cannot.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8');

/**
 * `cost` is what it takes to answer: 'free' reads a module or a file, 'slow'
 * runs a simulation. `--quick` keeps the free ones, which is enough to catch a
 * constant drifting away from the paragraph that quotes it.
 */
const CHECKS = [
  {
    name: 'EP_PER_YARD is what the document says it is',
    cost: 'free',
    from: async () => (await import('../src/engine/winprob.js')).EP_PER_YARD,
    doc: /`EP_PER_YARD` is ([\d.]+)/,
    expect: 0.0528, tol: 0,
    why: 'refitted 0.0539 -> 0.0528, and three passages went on quoting the old value',
  },
  {
    name: 'no script measures a tree other than its own',
    cost: 'free',
    from: async () => {
      const { readdirSync } = await import('node:fs');
      const dir = join(ROOT, 'scripts');
      const bad = readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'audit.mjs')
        .filter((f) => /['"`]\/(?:home|Users|root)\/[^'"`\n]*['"`]/.test(readFileSync(join(dir, f), 'utf8')));
      return bad.length ? bad.join(', ') : 'none';
    },
    expect: 'none', text: true,
    why: "both yardstick scripts opened with `const R = '/home/user/...'`, so a copy running anywhere else — a worktree at an older commit, a clone, CI — silently imported THAT tree's engine and reported the answer as its own. It cost four runs against a 59-commit-old checkout that were all quietly measuring today's code",
  },
  {
    name: 'the expected-points fit still lands on EP_PER_YARD',
    cost: 'slow',
    script: 'expected-points', extract: /ep = ballOn \* ([\d.]+)/,
    doc: /`EP_PER_YARD` is ([\d.]+)/,
    expect: 0.0528, tol: 0.002,
    why: 'the constant is a cached fit; if the curve moves and the constant does not, everything priced off it is wrong',
  },
  {
    name: 'a giveaway at 1st and 10 from the 25',
    cost: 'slow',
    script: 'turnover-price', extract: /1&10@25\s+\d+\s+[\d.]+\s+(\d+)/,
    doc: /it is (\d+) yards at this grid's/,
    expect: 58, tol: 4,
    why: "the playbook grid prices every snap with this. NOT the pooled headline the script leads with, which is a different number and reading it instead is a mistake already made once",
  },
  {
    name: 'the auction beats the draft for spread',
    cost: 'slow',
    script: 'auction-sim',
    // Roster spread, not wins. "Best-built team wins X of 14" averages twelve
    // teams' records and moves half a win on a reshuffled random stream, so a
    // 0.4 tolerance on it flagged noise more often than not. What the auction
    // produces is fixed before a snap, and nothing in-season can move it.
    extract: /=== AUCTION[\s\S]*?roster quality \(leverage-weighted\): sd ([\d.]+)/,
    doc: /a standard deviation of ([\d.]+) under the auction/,
    expect: 42.3, tol: 0.5,
    why: 'the number the auction exists to produce; the win figure it replaced drifted from 7.4 to 8.6 to 9.1 on noise alone',
  },
  {
    name: 'overall predicts production at quarterback',
    cost: 'slow',
    script: 'yardstick-fit', args: ['QB', '500', '24'],
    extract: /overall vs point differential:\s+r = ([\d.]+)/,
    doc: /\| QB \| \*\*r = ([\d.]+)\*\*/,
    expect: 0.988, tol: 0.015,
    why: 'the table under "do not rebuild it"',
  },
  {
    name: 'overall predicts production at cornerback',
    cost: 'slow',
    script: 'yardstick-fit', args: ['CB', '500', '24'],
    extract: /overall vs point differential:\s+r = ([\d.]+)/,
    doc: /\| CB \| \*\*r = ([\d.]+)\*\*/,
    expect: 0.984, tol: 0.02,
    why: "for most of this file's life the harness scored a man by his own team's points, which a corner barely affects — he read 0.72 there and 0.82 overall, and two commits were written about a weakness that was the instrument. Against the opponent's points he reads -0.976",
  },
  // Deliberately not registered: the line, the receiver and the punter. Their
  // entries in the yardstick table need 1500 games a man before they hold still
  // — the punter swings 0.59 between 250 and 500 — and running that here would
  // add most of an hour to a check nobody would then run. Their numbers live in
  // DESIGN.md with the sample size and the swing printed beside them, which is
  // the honest way to carry a figure this check cannot afford to verify.
  {
    name: 'injuries per game at the default setting',
    cost: 'slow',
    script: 'injury-sim', extract: /normal\s+([\d.]+) injuries/,
    doc: /\| normal \| ([\d.]+) \| [\d.]+ \| [\d.]+ \| [\d.]+% of weeks \|/,
    expect: 1.16, tol: 0.15,
    why: 'the left-hand column of the injury table, which is the injury model itself',
  },
  {
    name: 'how much of a club is missing at the default setting',
    cost: 'slow',
    script: 'injury-sim', extract: /normal\s+([\d.]+) rostered players out per club-week/,
    doc: /\| normal \| [\d.]+ \| [\d.]+ \| ([\d.]+) \| [\d.]+% of weeks \|/,
    expect: 0.36, tol: 0.08,
    why: 'the right-hand column, which measures how well clubs cope rather than how violent the game is — it had halved while the left-hand column stood still',
  },
  {
    name: 'overall predicts production for generated players too',
    cost: 'slow',
    script: 'yardstick-fit', args: ['CB', '500', '24', 'rookies'],
    extract: /overall vs point differential:\s+r = ([\d.]+)/,
    doc: /\| CB \| 500 \| [\d.]+ \| \*\*([\d.]+)\*\* \|/,
    expect: 0.991, tol: 0.02,
    why: "the shipped pool is collinear enough that almost any monotone weighting scores well on it, so the headline yardstick numbers are weak evidence the weights are RIGHT. This is the same fit against independently scattered attributes, where they have to earn it. CB rather than DL because DL needs 1500 games a man and this check runs beside twenty others",
  },
  {
    name: 'the quarterback pool is the size the document says',
    cost: 'free',
    from: async () => (await import('../src/data/db.js')).PLAYERS.filter((p) => p.pos === 'QB').length,
    doc: /64 of the pool['\u2019]s\s+(\d+) quarterbacks/,
    expect: 128, tol: 0,
    why: "the paragraph on the pro injury dial said 103 for long enough that a conclusion was drawn from it. The pool only ever grows, so a figure like this goes stale silently and in one direction",
  },
  {
    name: 'a pro club\'s backup quarterback is this much worse than its starter',
    cost: 'slow',
    script: 'injury-sim', extract: /pro backup gap ([\d.]+)/,
    doc: /\| pro \| 256 \| [\d.]+ \| [\d.]+ \| \*\*([\d.]+)\*\* \|/,
    expect: 5.7, tol: 0,
    why: 'the whole reason the dial bites harder in the pro league. tol 0 is earned: the block draws eight fixed-seed leagues and reads ratings, with no simulation in it, so any movement at all is the draft or the pool changing and is worth hearing about',
  },
  {
    name: 'what a pro club loses to injury over a season',
    cost: 'slow',
    script: 'injury-sim', extract: /pro\s+normal\s+[\d.]+ games a club · ([\d.]+) starter-weeks/,
    doc: /\| pro \| normal \| 17\.0 \| ([\d.]+) \|/,
    expect: 5.7, tol: 0.4,
    why: "the high-count figure in the pro injury table, and the one that shows the 17-game season costing 1.15x the 14-game one. NOT the season-enders column beside it, which reads 0.10 over ten fantasy seasons and 0.17 over forty and is too thin at this sample to compare across modes",
  },
  {
    name: 'the re-sign premium still un-dominates the keeper round',
    cost: 'free',
    from: async () => {
      const { RESIGN_PREMIUM, BIRD_IN_HAND } = await import('../src/engine/offseason.js');
      return RESIGN_PREMIUM > 1 && RESIGN_PREMIUM < BIRD_IN_HAND ? RESIGN_PREMIUM : `out of range against BIRD_IN_HAND ${BIRD_IN_HAND}`;
    },
    doc: /\| ([\d.]+) \(shipped\) \|/,
    expect: 1.04, tol: 0,
    why: 'at 1 the keeper round is arithmetic again — re-signing and declining cost the same and only declining risks the player. At or above BIRD_IN_HAND every AI surplus goes negative and every roster empties into free agency. The window between them is the whole feature',
  },
  {
    name: 'the tag stays dearer than re-signing',
    cost: 'free',
    from: async () => {
      const { TAG_PREMIUM, RESIGN_PREMIUM } = await import('../src/engine/offseason.js');
      return TAG_PREMIUM > RESIGN_PREMIUM ? TAG_PREMIUM : `at or under RESIGN_PREMIUM ${RESIGN_PREMIUM}`;
    },
    doc: /\| ([\d.]+) \(shipped\) \| \d+% \|/,
    expect: 1.6, tol: 0,
    why: 'a tag priced at or below a re-signing buys a shorter deal for free, which is the dominated-option defect over again with the sides swapped',
  },
  {
    name: 'what five seasons past signing costs',
    cost: 'slow',
    script: 'career-sim', extract: /\+5 seasons: (-?[\d.]+) overall/,
    doc: /Signed at his prime[^|]*\| [\u2212+\d.]+ \/ [\u2212+\d.]+ \/ \u2212([\d.]+)/,
    expect: -4.1, tol: 0.5, docSign: -1,
    why: 'the keeper decision is priced on this',
  },
  {
    name: 'weather\'s means are taken at the arm and leg the two checks below measure',
    cost: 'free',
    from: async () => { const { STARTER_ARM, STARTER_LEG } = await import('../src/engine/weather.js'); return `${STARTER_ARM}/${STARTER_LEG}`; },
    expect: '90/87', text: true,
    why: 'the rounded measurements; if either check below drifts, re-measure, move the constant, and this with it',
  },
  {
    name: 'the arm that starts in a founding pro league',
    cost: 'slow',
    script: 'weather-sim', args: ['arms'], extract: /the starting quarterback's arm ([\d.]+)/,
    doc: /start an ([\d.]+) arm \(sd/,
    expect: 89.9, tol: 0,
    why: "taken at the formulas' 82 instead, weather lifted league completion by 0.13 points, because the wind costs a strong arm less than the means assumed. tol 0 is earned: eight fixed-seed drafts and a read of their ratings, no simulation",
  },
  {
    name: 'the leg that starts in a founding pro league',
    cost: 'slow',
    script: 'weather-sim', args: ['arms'], extract: /the kicker's leg ([\d.]+)/,
    doc: /and an ([\d.]+) leg \(sd/,
    expect: 87.3, tol: 0,
    why: 'the same for kicking range, where a mean taken at an 80 leg sits 0.07 yards off',
  },
  {
    name: 'the game still looks like football',
    cost: 'slow',
    script: 'realism', extract: /(none|\d+) of 44 wholly outside/,
    expect: 0, tol: 0,
    map: (v) => (v === 'none' ? 0 : Number(v)),
    why: 'the standing guardrail; anything above zero is a metric outside the real league\'s range',
  },
  {
    name: 'the record still supports the ratings',
    cost: 'slow',
    script: 'legacy-check', extract: /(\d+) rating\(s\) off by 3\+/,
    expect: 2, tol: 0,
    why: "two known violations — Csonka and Riggins, both the weight vector refusing to rate a power back — each recorded with a reason; a third means something moved. This expectation sat at 4 long after Barber was corrected and was only caught the first time anybody ran the full audit afterwards, which is the argument for running it",
  },
  {
    name: 'the simulation fingerprint',
    cost: 'slow',
    script: 'game-fingerprint', extract: /fingerprint: ([0-9a-f]+)/,
    expect: '9bdd8b3cabb95381', text: true,
    why: 'changes whenever the game engine does, which is what makes a careers-only change provable',
  },
];

const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const words = argv.filter((a) => !a.startsWith('--'));
const wanted = CHECKS.filter((c) => (!quick || c.cost === 'free')
  && (!words.length || words.some((w) => c.name.toLowerCase().includes(w.toLowerCase())
    || (c.script || '').includes(w))));

const num = (s) => Number(String(s).trim());
const near = (a, b, tol) => Math.abs(a - b) <= tol + 1e-9;

/**
 * Run a measuring script, once per distinct invocation.
 *
 * Several checks read different figures out of the same script's output, and
 * without the memo each one paid for its own run. `injury-sim` was registered
 * four times with identical arguments, and it had just grown a pro-league block
 * that multiplied what it costs — so three quarters of the slowest thing in
 * this audit was re-deriving an answer it already had. These scripts are
 * deterministic for a given argument list, which is what makes the memo safe:
 * a second run cannot say anything the first did not.
 */
const scriptCache = new Map();
function runScript(name, args = []) {
  const key = `${name} ${args.join(' ')}`;
  if (!scriptCache.has(key)) {
    scriptCache.set(key, execFileSync(process.execPath, [join(ROOT, 'scripts', `${name}.mjs`), ...args],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: ROOT }));
  }
  return scriptCache.get(key);
}

const problems = [];
const ran = [];
console.log(`${wanted.length} check(s)${quick ? ', free ones only' : ''}\n`);

for (const c of wanted) {
  let measured;
  try {
    if (c.from) {
      measured = await c.from();
    } else {
      const out = runScript(c.script, c.args || []);
      const m = out.match(c.extract);
      if (!m) { problems.push(`${c.name}: could not find the figure in ${c.script}'s output — the script's format has changed, so this check is not checking anything`); continue; }
      measured = c.map ? c.map(m[1]) : (c.text ? m[1] : num(m[1]));
    }
  } catch (e) {
    problems.push(`${c.name}: ${c.script || 'the module'} failed to run — ${String(e.message).split('\n')[0]}`);
    continue;
  }

  // The engine against the last agreed answer.
  const engineOk = c.text ? measured === c.expect : near(measured, c.expect, c.tol ?? 0);
  if (!engineOk) problems.push(`${c.name}: the engine now says ${measured}, this file expects ${c.expect}${c.tol ? ` ± ${c.tol}` : ''}\n    ${c.why}`);

  // The document against the same answer, where the document claims to say it.
  let documented = null;
  if (c.doc) {
    const d = DESIGN.match(c.doc);
    if (!d) problems.push(`${c.name}: DESIGN.md no longer carries this figure where the check expects it — either the prose moved or the check is stale`);
    else {
      // `docSign` is for a figure the prose writes with the sign outside the
      // number, e.g. a table of losses rendered as −4.1 rather than -4.1.
      documented = c.text ? d[1] : num(d[1]) * (c.docSign ?? 1);
      const docOk = c.text ? documented === c.expect : near(documented, c.expect, c.tol ?? 0);
      if (!docOk) problems.push(`${c.name}: DESIGN.md says ${documented}, this file expects ${c.expect} — the prose and the measurement have come apart`);
    }
  }
  ran.push({ name: c.name, measured, documented, ok: engineOk });
  console.log(`  ${engineOk ? 'ok  ' : 'DRIFT'}  ${c.name}: ${measured}${documented !== null ? ` (document: ${documented})` : ''}`);
}

console.log();
if (!problems.length) {
  console.log(`${ran.length} check(s) agree: the engine, this file and DESIGN.md all say the same thing.`);
  process.exit(0);
}
console.log(`${problems.length} problem(s):\n`);
for (const p of problems) console.log(`  - ${p}`);
console.log(`
Nothing here is automatically a bug. A number moving because the engine was
deliberately changed is the system working; the answer then is to re-measure,
update DESIGN.md, and update the expectation in this file in the same commit.
The failure this exists to prevent is a number moving and NOBODY KNOWING.`);
process.exit(1);
