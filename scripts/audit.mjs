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
    expect: 0.0525, tol: 0,
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
    expect: 0.0525, tol: 0.002,
    why: 'the constant is a cached fit; if the curve moves and the constant does not, everything priced off it is wrong',
  },
  {
    name: 'a giveaway at 1st and 10 from the 25',
    cost: 'slow',
    script: 'turnover-price', extract: /1&10@25\s+\d+\s+[\d.]+\s+(\d+)/,
    doc: /it is (\d+) yards at this grid's/,
    expect: 53, tol: 4,
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
    expect: 40.2, tol: 0.5,
    why: 'the number the auction exists to produce; the win figure it replaced drifted from 7.4 to 8.6 to 9.1 on noise alone. Weighed by the shipped table since 2026-09-24, where it used to carry a stale copy of the first one',
  },
  {
    name: 'overall predicts production at quarterback',
    cost: 'slow',
    script: 'yardstick-fit', args: ['QB', '500', '24'],
    extract: /overall vs point differential:\s+r = ([\d.]+)/,
    doc: /\| QB \| \*\*r = ([\d.]+)\*\*/,
    expect: 0.975, tol: 0.015,
    why: 'the table under "do not rebuild it"',
  },
  {
    name: 'overall predicts production at cornerback',
    cost: 'slow',
    script: 'yardstick-fit', args: ['CB', '500', '24'],
    extract: /overall vs point differential:\s+r = ([\d.]+)/,
    doc: /\| CB \| \*\*r = ([\d.]+)\*\*/,
    expect: 0.975, tol: 0.02,
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
    expect: 1.15, tol: 0.15,
    why: 'the left-hand column of the injury table, which is the injury model itself',
  },
  {
    name: 'how much of a club is missing at the default setting',
    cost: 'slow',
    script: 'injury-sim', extract: /normal\s+([\d.]+) rostered players out per club-week/,
    doc: /\| normal \| [\d.]+ \| [\d.]+ \| ([\d.]+) \| [\d.]+% of weeks \|/,
    expect: 0.32, tol: 0.08,
    why: 'the right-hand column, which measures how well clubs cope rather than how violent the game is — it had halved while the left-hand column stood still',
  },
  {
    name: 'overall predicts production for generated players too',
    cost: 'slow',
    script: 'yardstick-fit', args: ['CB', '500', '24', 'rookies'],
    extract: /overall vs point differential:\s+r = ([\d.]+)/,
    doc: /\| CB \| 500 \| [\d.]+ \| \*\*([\d.]+)\*\* \|/,
    expect: 0.968, tol: 0.02,
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
    expect: 5.4, tol: 0.5,
    why: "the high-count figure in the pro injury table, and the one that shows the 17-game season costing about 1.2x the 14-game one. It has read 5.1, 5.8 and 5.4 on the drafts of three successive tables and weights, so the band is half a starter-week; the drive model's extra snaps account for about 5% of any rise, since injury risk is per snap. NOT the season-enders column beside it, which reads 0.10 over ten fantasy seasons and 0.17 over forty and is too thin at this sample to compare across modes",
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
    expect: '90/88', text: true,
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
    expect: 87.7, tol: 0,
    why: 'the same for kicking range, where a mean taken at an 80 leg sits 0.07 yards off',
  },
  {
    name: 'the position-value table still matches the engine',
    cost: 'slow',
    script: 'leverage-sim', args: ['4000', '1'], extract: /positions where the shipped table and the engine disagree: (\d+)/,
    expect: 0, tol: 0,
    why: 'TRUE_LEVERAGE prices every player — the auction, pro salaries, the value panel, AI bidding and trades — and it has gone stale twice the same way, a change to the run game and no re-measure after it. The second time it was set on 21 September, the same day an engine change wired a back\'s elusiveness and power into play, and his real value rose half again while the table stood still for three days. On 2026-09-24 it was set four times: once on an engine whose run game was itself wrong, with the back at nearly a quarterback, again at a third of one once the run game matched real carries, a third time once the passer and the receivers were held to real seasons, and a fourth once the drive was held to real play-by-play. This replays one roster and counts positions more than 30% and three standard errors away from the table. Roster 1 at 4,000 games reads 0 on the second table and 1 on the first, the back; about two minutes',
  },
  {
    name: 'the pass/run read still beats a flat 0.55',
    cost: 'slow',
    script: 'pass-rate', args: ['read', '8', '150', '8', '41'], extract: /the read as it is \(strategy\.js\)\s+([+-]?[\d.]+)/,
    doc: /The audit re-measures it on eight of those leagues[^+]*\+([\d.]+)/,
    expect: 0.71, tol: 0.4,
    why: 'the read has gone stale twice: measured once at +0.98 and left behind a dozen engine changes, then refitted to an engine whose backs were worth far too much, where it told nearly every squad to run and scored +0.77, and -1.17 once the run game matched real carries. It tells every squad to throw, worth +1.04 on that engine, +0.68 once the passer and the receivers were held to real seasons and +0.71 once the drive was held to real play-by-play. This plays it: eight eight-club leagues, 150 games a club at each setting, about ninety seconds; a band rather than tol 0 because any engine change moves a deterministic figure a little',
  },
  {
    name: 'fourth-down aggression still pays four-fifths of the way up the dial',
    cost: 'slow',
    script: 'dials', args: ['aggression', '4', '100', 'pro', '41'], extract: /every club at 0\.8: ([+-]?[\d.]+)/,
    doc: /The audit now replays the pro leagues[^+]*\+([\d.]+)/,
    expect: 0.33, tol: 0.3,
    why: 'the team page tells the player that going for it more is worth about a third of a point a game four-fifths of the way up the dial, and no more at the top. The first measurement had it helping only a strong offence with a poor kicker; later it helped every squad by a point and a quarter at the top, two-thirds once the run game matched real carries and every squad threw, and half that once the fourth-down call itself was fitted to real coaches, when the best setting moved off the top. It read +0.66 at the top here before the drive model; +0.56 at the top and +0.48 at 0.8 on it, on four eight-club leagues whose drafts then changed with the rating weights and read -0.03, a standard error and a half from the rest. So it replays four pro leagues now, where the error is half as large: +0.33 at 0.8. About four minutes; a band because any change to the drafts moves it',
  },
  {
    name: 'a back\'s rating moves his carries as far as the real game\'s',
    cost: 'slow',
    script: 'run-realism', extract: /backs, real on engine slope: ([\d.]+)/,
    doc: /the\s+backs'\s+slope\s+\(([\d.]+),\s+flagged/,
    expect: 0.86, tol: 0.15,
    why: 'the 81 backs in the pool with a real season from 1999 on, each in the same average side, against what each really ran (nflverse): the slope of real yards a carry on the engine\'s. 1 is the engine\'s differences between backs coming true one for one; it read 0.20 before 2026-09-24, when a point of a back\'s rating moved his carries five times too far and nothing compared the two, then 0.77 at a carrier weight of 0.2 and 0.88 at 0.16, once the argument for stopping short of a slope of 1 turned out to be wrong. About four minutes, shared with the check below',
  },
  {
    name: 'a league of all-time greats runs like a real league',
    cost: 'slow',
    script: 'run-realism', extract: /pro league yards a carry: ([\d.]+)/,
    doc: /a\s+pro\s+league's\s+yards\s+a\s+carry\s+\(([\d.]+)/,
    expect: 4.58, tol: 0.25,
    why: 'the realism check plays sides rated 82, where the engine was fitted, and cannot see a term that grows with the level of play. Two of them did — power and elusiveness measured against a fixed 82 rather than the defence — and drafted pro leagues ran at 5.95 yards a carry against a real 4.49 while it read clean',
  },
  {
    name: 'how far a quarterback\'s rating moves his passing, against the real game',
    cost: 'slow',
    script: 'pass-realism', extract: /passers, real on engine slope \(adjusted net yards a dropback\): ([\d.]+)/,
    doc: /the quarterbacks'\s+slope\s+\(([\d.]+)\s+at\s+200\s+games/,
    expect: 1.15, tol: 0.15,
    why: 'the 58 quarterbacks in the pool with a real season from 1999 on, each in the same average side, against what each really did (nflverse): the slope of real adjusted net yards a dropback on the engine\'s. 1 is the engine\'s differences between quarterbacks coming true one for one. It read 0.41 when first measured on 2026-09-24, with a point of a passer\'s rating moving his production 2.4 times as far as the real game\'s, and 0.99 once every passer term read the defence and was weighted to the real quarterbacks (DESIGN.md, "The passing game, held to real quarterbacks"). About thirty seconds, shared with the check below',
  },
  {
    name: 'how hot a league of all-time greats throws',
    cost: 'slow',
    script: 'pass-realism', extract: /pro league adjusted net yards a dropback: ([\d.]+)/,
    doc: /a\s+pro\s+league's\s+adjusted\s+net\s+yards\s+a\s+dropback\s+\(([\d.]+)/,
    expect: 6.13, tol: 0.3,
    why: 'the realism check plays sides rated 82 and cannot see a term that grows with the level of play. Drafted pro leagues threw for 7.18 adjusted net yards a dropback against a real 5.84 to 6.18 (2019-2023) while it read clean, because the sack, the line and the arm read the quarterback against fixed numbers. 6.81 once they read the defence, 6.63 once each passer term was weighted to real quarterbacks, and 6.03, inside the real range, once yards a completion came to real length with the drive model held to real play-by-play',
  },
  {
    name: 'a receiver\'s rating moves his share of the targets as far as the real game\'s',
    cost: 'slow',
    script: 'skill-realism', extract: /receivers, share of targets, real on engine slope: ([\d.]+)/,
    doc: /the\s+receivers'\s+target-share\s+slope\s+\(([\d.]+)/,
    expect: 0.89, tol: 0.2,
    why: 'the 103 receivers in the pool with a real season from 1999 on, each in the same average side, against the share of his team\'s targets he really drew (nflverse): at a target spread of 9 a point of rating moved it six times as far as the real game\'s and a star took the ball from everyone else, which priced receivers, tight ends and backs far above what their play is worth. About seventy seconds, shared with the check below',
  },
  {
    name: 'a back\'s rating moves how often he carries as far as the real game\'s',
    cost: 'slow',
    script: 'skill-realism', extract: /backs, carries a game, real on engine slope: ([\d.]+)/,
    doc: /the\s+backs'\s+carries\s+slope\s+\(([\d.]+)/,
    expect: 1.03, tol: 0.25,
    why: 'the play caller leaned on the run by the quarterback\'s rating less the back\'s, and at /200 a back eight points better took 2.3 more carries a game: 2.6 times the real game\'s pull. That is volume on top of his yards a carry, which the rushing checks cannot see',
  },
  {
    name: 'a game at 82 runs as many plays as a real one',
    cost: 'slow',
    script: 'drive-realism', args: ['2000'], extract: /scrimmage plays a team game: ([\d.]+)/,
    doc: /A\s+club\s+runs\s+([\d.]+)\s+scrimmage\s+plays\s+a\s+game\s+at\s+82/,
    expect: 61.5, tol: 0.6,
    why: 'the clock: snap to snap on a running clock took four seconds too long, and a game had 58.7 scrimmage plays a club against a real 62.1 (every snap of 2022 and 2023, nflverse). Every drive, point and play count in the value table sits on this. About twelve seconds, shared with the three checks below',
  },
  {
    name: 'a game at 82 scores as a real one does',
    cost: 'slow',
    script: 'drive-realism', args: ['2000'], extract: /points a team game: ([\d.]+)/,
    doc: /scores\s+([\d.]+)\s+points\s+a\s+team\s+game\s+at\s+82/,
    expect: 22.1, tol: 0.6,
    why: 'real 21.8 in 2022-23. It sat at the floor of the realism range, 20.9, before the drive model was held to real play-by-play, and fell under it whenever the passing game was cut to real length',
  },
  {
    name: 'a neutral first and ten is thrown as often as a real one',
    cost: 'slow',
    script: 'drive-realism', args: ['2000'], extract: /neutral first-and-ten pass rate: ([\d.]+)/,
    doc: /throws\s+on\s+([\d.]+)%\s+of\s+neutral\s+first-and-tens/,
    expect: 46.0, tol: 1.5,
    why: 'the play caller was the dial plus a flat step by down, which threw 54% of neutral first-and-tens against a real 46 and converted early downs a quarter too often. The dial moves this, so it is read at the default',
  },
  {
    name: 'third and long converts as often as a real one',
    cost: 'slow',
    script: 'drive-realism', args: ['2000'], extract: /third and seven to nine converted: ([\d.]+)/,
    doc: /converts\s+third\s+and\s+seven\s+to\s+nine\s+([\d.]+)%\s+of\s+the/,
    expect: 32.8, tol: 2,
    why: 'real 32.8. It was right before, by taking seven yards off every catch on third and long, which left the catch at 1.9 yards after it against a real 5.2; now it is right by the rush getting home and the throw having to go past the marker',
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
    expect: 'd4e8f37688a6c7e3', text: true,
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
