# Design notes

## Concept

An all-time fantasy football league. Every player entry is a snapshot of one real player at one prime season. You draft a roster against AI GMs, then play a season of simulated games against them. "Manager" by default (set tendencies, watch), "coach" if you want to call plays.

Why one snapshot per player rather than a career: it keeps the pool legible (Brady 2007 is a different card from Brady 2017), avoids modeling aging, and matches how fans argue ("prime Moss vs. prime Deion").

## Cross-era ratings

Raw stats are not comparable across eras (a 1975 passing season looks like a 2020 backup). Ratings therefore describe skills, not stats: how dominant a player was at that skill *relative to his contemporaries*, translated onto one scale (40–99). Anchors: 97–99 is the best ever at that skill; 92–96 All-Pro; 85–91 Pro Bowl; 76–84 solid starter. Stars have real weaknesses (Marino's mobility, a mauling guard's awareness), which is what makes drafting and matchups interesting.

This is editorial. The file is meant to be argued with and edited.

## Roster and lineup

27 slots (see `ROSTER_SLOTS` in `src/data/positions.js`). 24 start; RB2 shares carries (~28%, more if he is the smarter back), WR4 gets a few targets, and QB2 plays only when the starter is hurt. Every bench player steps up when the man ahead of him is out; see Injuries and depth below. There is no fatigue model.

## Simulation model (`src/engine/game.js`)

A game is a plain JSON object advanced by `step()`. One step is one event: kickoff, scrimmage play, or PAT. All randomness comes from a mulberry32 RNG whose state lives inside the game object, so a game can be paused, saved, reloaded, and continued identically. Coach mode simply passes `{ off, def, pat }` into `step()`; anything omitted is chosen by the AI.

### How the simulation is split up

`game.js` had grown to 1,226 lines, more than twice the next module, and every feature touched it. It is now three files, and the line the split follows is one the code already had:

- **`game/plays.js`** — what happens on a snap. Each resolver reads the game, decides an outcome and returns it as a plain object: yards, seconds elapsed, whether the clock stops, the sentence to print. None of them advances the clock, changes possession, scores or writes to the log.
- **`game/picks.js`** — who gets the ball and who makes the play. Pure selection from a team's composite and a random number.
- **`game.js`** — the state machine: `createGame`, the step loop, the clock, drives, kickoffs, extra points, and `applyOutcome`, which takes the object a resolver returned and does everything that changes the game.

That seam was already there. Across four hundred lines of play resolution the only thing reached for outside the region was `statFor`, so lifting it out needed no new abstraction — just moving it and letting the imports point one way.

**It stops there deliberately.** What remains is `applyOutcome`, `changePossession`, `doKickoff` and `endOfQuarter`, which call each other and share the whole game object. Splitting mutually recursive state machinery across files makes it harder to follow, not easier; 836 lines against `season.js`'s 791 is no longer an outlier, which was the actual problem.

**How it was verified.** The engine is seeded, so the same rosters and seed must produce the same game down to the last word of play-by-play — which makes a hash of the output a far stronger check than the test suite, because a test asserts the properties somebody thought of and a fingerprint asserts everything. `scripts/game-fingerprint.mjs` (`npm run fingerprint`) simulates 256 games across the paths that diverge — five roster gaps, three rosters lopsided by position, penalties off, every injury rate, neutral sites, playoff rules, chemistry, and twelve coach-mode games driving `step()` by hand — and prints one hash over 47,821 log lines, plus a per-game hash so a divergence names itself. Before and after the split: `a9480bd47f40cac9`, identical. It reads `64ff480a39db399a` since the leverage table was corrected (below). Before that, `c0f42fd53ad4a81e` from the harness itself being fixed — see **A fingerprint that could not see the roster** below; the engine did not change for that one. Before that, `1e08b72a40e8bb25` from the two-high shell no longer erasing the deep ball (below). Before that, `318460005bde6589` from the short pass being given a counter (below). Before that, `328aac09ca0ef3eb` from the run game being given a look that rewards it and the second-quarter clock rules dropping their score gate (below). Before that, `fff8872cea59867e` from the defence playing the first-down marker and the red-zone squeeze being strengthened (below). Before that, `3147f969ccb7c6eb` from reshaping the run distribution, and `64ed7a2198e6daab` from win probability being stored to three decimals rather than to a double's full precision, which moved the annotation on every line and no play, and `6130e8df755f35db` from the realism audit below.

**The audit tool was under-reporting itself.** `scripts/realism.mjs` prints a header saying "! marks a number outside the real league's range" and then quietly exempted fifteen of its forty rows: everything below the penalty lines was a hand-written `console.log` carrying the reference range as a literal string, so it could never be marked. TD : FG sat at 1.99 against a stated 1.3–1.8 with no mark on it for as long as that lasted, and a claim of "37 of 40 in range" made in a commit message was read off marks that only covered part of the report. Every row goes through the same helper now, the helper judges the number *as printed* (a row reading 10.0 against a range of 10–13 and carrying a mark looks like a broken report), and the last line is a count.

**And then the count itself turned out not to reproduce.** Fixing the helper gave "6 of 44 outside the range", and that number was quoted for a while as a fact. It is not one. Run against three different seed ranges, the *same unchanged engine* scored 6, 8 and 9 — yards per completion came out 11.98, 12.08 and 12.15 against a boundary of 12.0, and TD : FG 1.99, 2.24 and 2.03 against 1.8. Half the rows sit within a noise-width of a boundary and flip on the draw. That invalidated more than the count: three tuning attempts had been reverted for "making it worse" on evidence that was inside the noise, and a fourth change had been called "net zero" on the same basis.

The audit now runs ten independent blocks and reports each row as a mean with a 95% t interval, marking a row only when the whole interval is outside the reference range and `~` when it straddles a boundary. The first attempt at this used the min-to-max spread and was wrong in an instructive way: min and max wander further apart the more blocks you draw, so *raising* the block count made findings disappear — the same engine scored 6, 7, 7, 6 at three blocks and 5, 7, 4, 3 at five. An error bar that grows with evidence is not an error bar. A t interval shrinks with √blocks, and ten blocks is the default because that is the point where the verdict was measured to settle: run against four separate seed sets it named the same rows every time, where three blocks named 3, 4, 2 and 4 with one row common to all four.

For comparing two builds of the engine, comparing two intervals is the wrong test and far too weak — the right one is paired, the same seeds run under both builds and differenced block by block, which cancels the draw. That is what `REALISM_JSON=1` exists for. It resolves a tenth of a yard where the overlapping-intervals test resolves nothing.

**Two attempts to close those and why both were reverted.** Four of the six say one thing — drives do not stall often enough, so there are too few of them and too many end in touchdowns. Giving the defence extra pressure on third and long, which is realistic and should shorten drives, *raised* third-down conversion from 42.6% to 43.8% and pushed TD : FG to 2.10. Raising the breakaway chance to restore 20+ yard plays hit its own target and broke yards per completion and mean margin instead; a gentler version broke yards per completion while still missing on 20+ plays. Those two measure the same thing from opposite ends — real football has a *fatter tail at the same mean*, more twenty-yard plays and more short ones, while this model's play-length distribution is too narrow at the top. That is a distribution-shape problem, not a knob, and the baseline of six was better than anything three attempts produced. Both changes were reverted and the fingerprint confirms the engine is untouched.

It is a tool, not a test. Pinning that hash in the suite would fire on every legitimate retune — and retuning constants is normal work here — so it stays something you run either side of a refactor. The property that *is* tested, in `tests/game.test.js`, is that a seed replays identically, which no tuning change can break.

### Team composites (`ratings.js`)

Offense: pass block (OL pbk + TE), run block, QB attributes, receiver target weights. Defense: pass rush (top two DL heavy, LB share; blitz shifts weight to LB/S), run stop, coverage at three depths (CB/LB/S weighted differently for short/medium/deep), ball skills, tackling, secondary speed.

### Play resolution

Offense chooses one of `run_in, run_out, screen, pass_short, pass_med, pass_deep, pa_pass, fg, punt, kneel, spike`; defense chooses `base, run_stop, blitz, deep`. A small matchup matrix (`MATRIX`) applies modifiers, e.g. blitz vs. screen favors the offense, deep shell vs. deep shot hurts completion, stacked box hurts runs.

Pass: pressure probability from rush vs. protection (logistic, `edge()`); pressure → sack (QB mobility/awareness reduce), scramble, or a hurried throw. Target chosen by role and skill; the primary defender is matched by role (WR1 ↔ CB1, TE ↔ best-coverage LB or S…), so Deion on Rice is a real matchup. Completion probability = base by depth + (QB accuracy/receiver skill − coverage) × slope. Interceptions scale with defense ball skills, QB awareness, pressure, and how badly coverage wins. Yards = air (by depth, QB arm for deep) + run-after-catch (exponential, receiver RAC vs. tackling, breakaway chance from speed vs. secondary speed).

Run: stuff chance from run stop vs. run block (+RB vision); otherwise base gain + blocking edge + break-tackle chance (power/elusiveness vs. tackling) + breakaway chance (speed vs. secondary speed). QB sneaks on 4th-and-1. Fumbles scale with ball security and tackling.

Special teams: FG probability is a logistic in distance with the midpoint set by kicker power and accuracy. Punts: distance from punter power, pooch logic near midfield, placement skill avoids touchbacks and forces fair catches. Kickoffs: touchback rate from kicker power, returns by the fastest non-starter, rare breakaway. Onside kicks when trailing late.

### Game management (`playcall.js`)

Situational pass/run mix from strategy sliders plus down, distance, field position, score and time. Fourth-down chart uses actual kicker make probability and an aggression slider; desperation logic when trailing late. Two-point chart, hurry-up (fewer seconds per snap, more passing), clock-kill when leading, victory formation, spikes, timeouts (offense trailing late; defense trailing while the opponent bleeds clock). Overtime: one 10-minute period in the regular season (both teams possess, then sudden death, ties allowed); playoffs continue until decided.

### Calibration

`npm run calibrate` runs synthetic equal teams (ratings ~85). Targets are roughly modern NFL per-team-per-game: 23–26 points, 340–360 yards, 63–65% completions, ~7.7 yards/attempt, ~4.2 yards/carry, ~1.1 turnovers, ~2.1 sacks, ~84% FG. With penalties on (300 games): 24.4 points, 348 yards, 64.2% completions, 7.6 yards/attempt, 4.0 yards/carry, 1.1 turnovers, 2.2 sacks, 86% FG, 65 plays and 10.5 drives per team. All-star rosters drafted from the real pool score a little higher (~27 per team).

### The realism audit (`scripts/realism.mjs`, `scripts/expected-points.mjs`)

`npm run calibrate` checks nine numbers. That is enough to keep scoring sane and not nearly enough to catch a simulation that arrives at the right score by the wrong route. `npm run realism` simulates ten blocks of 300 games from separate seeds and prints forty-four measurements against the real league's range, each as a mean with a 95% interval, marking anything whose interval falls wholly outside. Everything below was found by running it, not by reading the code — which is the point of writing it.

**The red zone was being counted five times.** `redZoneAtt` was incremented wherever the ball crossed the twenty *and* again on the field goal or touchdown that followed, so a game showed 6.4 trips out of 10.8 drives and converted 35% of them against a real 55 to 65. A trip is a property of a drive, so it now lives on the drive: `inRedZone`, set once by `markRedZone`, which also catches the short field that never crosses the line because it starts inside it. 3.4 trips, 61% converted.

**A drive's yardage disagreed with the field.** The live game screen draws the ground a drive has covered as a band across the field bar, and prints the same drive as a sentence underneath. They disagreed on 296 of 820 drives, by as much as 49 yards. Three separate causes, all found by diffing `drive.yards` against `endBallOn - startBallOn` until the count reached zero:

- Penalty yardage never reached the drive. A flag moved the ball and charged the club, but the drive's own total ignored it. Team total yards *should* ignore it — that is the league's convention for net yards — but a drive chart's yardage is the ground covered, so the two are now charged in different places.
- `endDrive` recorded wherever the ball happened to be sitting. On a fumble that is the pre-snap spot, not the spot downfield where the ball came out; on a safety it is wherever the play started. `endDrive` now takes the end spot explicitly.
- A kneel-down moved the ball and charged nobody.

A fourth fell out of the same check: an interception in the end zone applied its touchback *after* `changePossession`, which is what opens the new drive and announces the spot — so the log read "Team b ball at B 4" for a drive that snapped from the 20.

**Expected points was a straight line somebody wrote down.** `winprob.js` valued field position as `(ballOn - 20) / 12 + 0.6`. `npm run ep` measures it instead, from where drives start and what they end up scoring: own 20 is worth 0.53 points, midfield 1.81, the opponent's 20 4.81, against the old line's 0.60, 3.10 and 5.60. The line overvalued midfield by 1.3 points. A weighted fit gives `ballOn * 0.0525 + 0.009`, mean error 0.24 points, and that is what ships.

**Fourth down now decides on expected points.** It used to read a hand-written chart. It now compares going for it, kicking and punting in points, using the measured curve and a conversion probability fitted to real conversion rates by distance. The first version of this was far too aggressive — 2.94 attempts a game at 8.1 touchdowns per field goal — and the cause was the old expected-points line, which made midfield worth a point and a third more than it is. With the measured curve and a `RISK_AVERSION` bar of 1.15 points, it attempts 1.09 a game and converts 48%, against a real 1.0 to 1.5 at 45 to 55%.

**The red zone was the same football as midfield.** `resolvePass` and `resolveRun` read `rem` only to cap the gain at the goal line. Completion probability, coverage, yards after the catch and the stuff rate were identical on the five and on the fifty, which is why the red zone converted two thirds of its trips. `squeeze(ballOn)` runs from 0 outside the twenty-five to 1 on the goal line and costs completion probability (weighted by concept — a screen barely notices, a deep shot has nowhere to go), most of the yards after the catch, and a little run blocking. Red zone touchdowns 67% → 61%, field goal attempts 1.34 → 1.5.

**Two of the audit's own rows were wrong.** Its regex for a play's yardage matched "for 8 yards" and not "for no gain" or "for a loss of 3", so "mean run" was the mean of *successful* carries — 6.1 against a real 4.3 — and looked like an engine defect for as long as it went unread. Fixing the regex surfaced two findings the broken row had been hiding: 24% of carries were being stopped at or behind the line against a real 16 to 22, and completions averaged 12.4 yards against a real 11. `STUFF_RATE` came down from 0.19 to 0.145, and about half a yard per completion moved out of run-after-catch and into the catch itself, which left yards per attempt where it was and lifted completion percentage from 63 to 65. Two other rows compared a number against a range for a different statistic: turnover drives counted turnover-on-downs but was ranged as giveaways alone, and shutouts was ranged per game against a real figure per team-game.

**Run lengths were a cliff, and that was the explosive-play shortfall.** Twenty-plus-yard plays sat at 3.35 against a real 3.5 to 5.5, and the shortfall was almost entirely on the ground: 0.47 explosive runs a team against a real 1.1, where passing was 2.83 against 3.4. The distribution said why. Carries ran p50 4, p90 10, p95 13 — and then p99 30. A run was a normal four-to-ten or a thirty-yard housecall, with the thirteen-to-twenty-five band, the good run that is not a touchdown, nearly empty. The cause was that the breakaway was a uniform draw, `rng.int(12, 45)`: flat between its ends, nothing below, and a hard ceiling above. It is now a mixture, usually a medium burst and occasionally a long one off an exponential, firing more than twice as often and smaller when it does, with the break-tackle yardage cut to pay back the mean. Explosive plays 3.35 → 3.58, explosive runs 0.47 → 0.69, forty-plus runs held at 0.07, mean carry 4.48 → 4.55 and the stuffed share unmoved. Six findings to five, on all four seed sets.

The previous entry here said both remaining findings were "fixable only by pulling on knobs that move numbers currently in range". That was wrong, and wrong in a way worth keeping: it was true of every *knob* and false of the problem, because the defect was in the shape of a distribution rather than in the level of a constant. No amount of moving `RUN_IN` would have found it — the mean was already right.

**The defence could not get off the field, and the reason was that it did not know where the marker was.** Third-down attempts 10.9 (real 11–16), punts 3.21 (3.5–5.5), field-goal attempts 1.45 (1.5–2.5) and TD : FG 2.05 (1.3–1.8) were not four findings but one: drives did not stall often enough. Instrumenting the log by down and distance found two causes, and neither was a level.

The first: **nothing in the passing game read `toGo`**. A throw on third and nine was resolved exactly like one on first and ten, and the receiver ran after the catch as if the sticks were not there. So third down converted 43.9% against a real 39, the gap widened with distance (43% on third and seven to nine against a real 32), and the offence gained *more* on third down than on first — 6.27 yards against 6.18 — where real football has third down as the hardest down by more than a yard. `sticks(down, toGo)` now runs from 0 on early downs to 1 on third or fourth and long and takes yards after the catch away. It is subtracted, not scaled, and that is the whole trick: a first attempt that multiplied cost 0.18 explosive plays a team and would have undone the row fixed in the commit before, because scaling an exponential moves its tail with its mean. Taking a fixed seven yards off kills the three-yard checkdown that moves the chains and leaves a twenty-five-yard catch a twenty-yard catch.

The second: **the red zone was still the easiest place on the field to score**, 64% of trips ending in a touchdown against a real 56. That is the same defect as TD : FG — the drives that should have stalled into a kick were finishing. The four `squeeze` coefficients went up together.

Third-down conversion 43.9 → 39.4 (real ~39), red zone touchdowns 64.1 → 58.4, field-goal attempts 1.45 → 1.58, TD : FG 2.05 → 1.72, punts 3.21 → 3.49, yards per completion 12.11 → 12.01, drives 10.0 → 10.3, and explosive plays held at 3.58 by raising the pass breakaway to pay back what `sticks` costs. **Five findings to one**, on four separate seed sets.

**What is still out: third-down attempts, 10.9 against 11–16, and the cost of fixing it is known.** The conversion *profile* is now close to real (69/64/52/34/17 by distance against roughly 66/55/50/35/20). What remains is that only 35% of series reach third down at all, against a real 41%, because first and second down still average about 6.1 yards against a real 5.5. Series convert before they get to third down. Closing that means cutting early-down offence by about a tenth, which takes scoring to roughly 19.5 points a team — below the range's floor — and three attempts at it (extending `sticks` to second and long at three strengths) each came back 2 of 44 rather than 1, trading this row for explosive plays and total points. It is a real miss of about 15%, not a boundary artifact, and it is recorded rather than chased.

**A note on what this cost.** Scoring fell from 22.2 to 21.3 points a team and mean total points to 42.6, which straddles the bottom of its range. That is the honest price of a defence that gets off the field. Quarterback leverage was the thing worth checking, since the whole auction economy hangs on it, and it did not move: boosting one quarterback by eight points is worth 5.62 points of margin and a 69.7% win rate, against 5.26 and 69.3% before.

**A cascade that did not work,** recorded because it looked obvious and cost a day. Letting a carry break several tackles in a row, each less likely than the last, should produce the geometric tail real carries have. It does buy tail — +0.11 explosive plays, paired and significant — but it buys mean with it, and every way of paying that mean back costs more than it gives: shaving the base run moves the *left* tail too and pushes the stuffed share out of range, and shrinking each break to compensate cancels the gain outright (+0.002, inside the noise). The tail was coming from the extra yards and not from the stacking, so the cascade was an expensive way to write `+= more`. What worked instead was changing the shape of the draw that was already there.

**A convergence worth noting.** Strengthening the run — `RUN_IN`, `RUN_OUT` and a lower `STUFF_RATE` — fixed a strategy problem as a side effect. The pass/run dial used to reward maximum passing at every setting; on a balanced roster it now peaks at 0.65 (+0.21 points against a flat 0.55) and turns back down at 0.70 (−0.18), and a run-tilted roster wants 0.35. Re-measured after the tuning above with `scripts/gameplan-sim.mjs` and a 600-game-per-cell sweep. A dial with an interior optimum is a decision; a monotone one is a tax on anybody who doesn't know to max it.

Leverage, measured by boosting one position group 8 points on an otherwise equal synthetic team: QB → 69% wins, WR → 66%, RB/OL/DL → 62%, LB/CB → 61%, S → 58%, K → no effect on win rate. Boosting every group by 2 points wins ~78% because the effects stack. In a snake draft with the value-over-replacement AI, total talent equalizes (team power spread ≈ 1 point), so AI-vs-AI seasons are close to coin flips and the user's edge comes from out-drafting the AI and from strategy. Constants to reach for when tuning: `baseComp`, `baseInt`, `yacMean`, `stuffP`, the run `base` normals, `pressureP`, and the `edge()` k values (bigger k = flatter response to rating gaps).

### Penalties (`penalties.js`)

Every play can draw a flag, and the rates are tied to the people on the field rather than rolled flat. A line with low awareness false-starts and holds; a defense that is being beaten holds and interferes; a blitzing front jumps early; the away side false-starts a little more. There are two shapes of flag, which is what keeps the stat lines honest:

- **Instead of a play.** False start, delay of game, offside and neutral-zone infractions are dead-ball fouls: five yards, replay the down, no play run. Offensive holding is rolled before the snap is resolved and wipes the play (ten yards, replay the down), which is statistically the same as a nullified play and avoids un-crediting a run that never counted. Pass interference (a spot foul, the 1 at most, never a score) and defensive holding or illegal contact (five yards) replace an incompletion with an automatic first down; the pass attempt and the target are taken back.
- **Added on to a play.** Roughing the passer, unnecessary roughness and a facemask are enforced from the end of the play with an automatic first down; the play stands. Holding on a kick or punt return takes ten yards off the return, never behind the catch.

Half the distance to the goal applies everywhere. Flags stop the clock, and a nullified play does not count as a play. Kick-return holds aside, a flag names the player: the offensive lineman with the lowest awareness is likeliest to be the one holding, the beaten defender the one interfering.

Measured on synthetic equal teams (300 games): 9.6 flags and 79 penalty yards a game across both clubs, against the real league's roughly 12 and 100. The mix: false start 2.1, holding 2.0, pass interference 1.0, offside and neutral zone 1.1, defensive holding and illegal contact 0.9, kick-return holding 0.9, roughness and facemask 0.8, delay of game 0.5, roughing the passer 0.3. The rates live in `RATES` in `penalties.js`. Penalties are on by default and can be turned off per league in settings; the engine takes `penalties: false` for calibration work. Not modeled: intentional grounding, illegal formation, taunting, penalties on scoring plays (enforced on the kickoff in real football; here a touchdown simply stands), and the free-play offside where the offense gets to keep a big gain, which is folded into a dead-ball whistle.

## The auction (`auction.js`)

The snake draft had a structural problem: it hands every team a full roster from the
same pool in alternating order, so total talent equalizes. Measured over twelve
simulated seasons (`npm run auction`), the best-built roster in a league beats the worst by about a win (7.8 to 6.9 of 14); under the auction the same gap is a win and a half (7.4 to 5.9).
The central activity of the game had almost no consequence.

The auction fixes it with a $200 cap and 27 slots. Teams take turns nominating a
player they have room for; the nominator automatically opens at $1, so every
nomination sells and the room cannot stall. Each team states a maximum, the
highest maximum wins, and the winner pays one dollar more than the runner-up, so
bidding your true limit is never punished. A team always keeps $1 per unfilled
slot, which guarantees every roster fills.

### Why the price guide is deliberately wrong

The first version priced players by measured win impact. That made the market
efficient, and an efficient market with equal budgets hands every team the same
quality of roster: roster variety went up, but the link between roster quality
and wins went to zero. Parity came back through the front door.

So the asking price is built from **reputation**, not value: convex in overall
rating, multiplied by a `GLAMOUR` weight where quarterbacks, backs and receivers
are expensive and guards and safeties are cheap. Separately, `TRUE_LEVERAGE`
holds the measured per-player win impact. The gap between the two is the game.
Each AI GM sees a blend of the two according to a `SAVVY` rating, so the
Analytics GM chases value while the Air Raid GM chases names, and the market is
beatable without being free money.

### Re-measuring the table (2026 audit)

`TRUE_LEVERAGE` was re-measured from scratch by `scripts/leverage-sim.mjs` (`npm run leverage`), 10,000 games per reading, because the tight end at 9.3 — second only to the quarterback and nearly double the back — never looked right.

Two things had to be fixed in the *method* before any number could be trusted. Building the two sides from different random seeds left one roster simply better, so two supposedly equal teams split 59/41 and that bias sat inside every reading; the fix is a mirrored opponent, identical player for player, which puts the baseline at zero by construction (measured: margin 0.016 ± 0.116 over 10,000 games). And win rate is one bit per game, far too noisy to separate positions a point apart, so the headline is point margin with its standard error.

The result was narrower than expected. **The table was sound and one number in it was not.**

| | QB | RB | TE | CB | WR | S | LB | DL | OL | P | K |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Measured margin, per starter | 6.17 | 2.06 | 1.98 | 1.61 | 1.13 | 1.01 | 1.00 | 0.85 | 0.72 | 0.52 | 0.27 |
| Was | 16.6 | 5.0 | **9.3** | 4.2 | 4.4 | 3.0 | 2.7 | 2.45 | 1.9 | 0.2 | 0.35 |
| Now | 17.99 | 6.01 | **5.78** | 4.69 | 3.30 | 2.95 | 2.92 | 2.48 | 2.10 | 1.52 | 0.79 |

Everything but the tight end came back within about a tenth of where it was. He is not double a running back; he is a shade below one. The earlier suspicion that this was an artifact of the coverage model — the simulation covers a tight end with a linebacker or safety on a coin flip, never a corner — turns out not to explain it: that advantage is real and already priced into the measured 1.98. The 9.3 was simply a bad measurement.

Two things the re-measurement exposed that were not about the tight end at all:

**The absolute scale is not free.** The price guide normalises the table away, so only ratios were thought to matter. But `lineupStrength` in transactions.js sums `overall × leverage` raw and `aiGreed` compares the result against fixed thresholds of 2 to 8, so shrinking the table made AI clubs stop offering trades entirely. The offers test caught it. The corrected ratios are therefore scaled so the starter-weighted total is unchanged at 86.45, which leaves trade behaviour exactly as it was.

**A value ratio is meaningless when the stake is trivial.** Re-measured, the punter came out at better value-for-money than the quarterback — arithmetically true, and it had the value board telling a new manager that punters are the best buy in the game. `positionValue()` now carries each position's whole-squad stake and calls anything under 5% "barely matters" however good its ratio, measured on the group so five cheap linemen are not mistaken for a specialist.

**Which positions are actually the bargains**, after the correction:

| | QB | CB | TE | S | OL | LB | RB | DL | WR |
|---|---|---|---|---|---|---|---|---|---|
| Wins share | 35.6% | 9.3% | 11.4% | 5.8% | 4.2% | 5.8% | 11.9% | 4.9% | 6.5% |
| Price share | 22.5% | 6.9% | 9.3% | 5.9% | 4.9% | 7.3% | 15.7% | 9.3% | 14.7% |
| Value | 1.58× | 1.35× | 1.23× | 0.99× | 0.85× | 0.79× | 0.76× | 0.53× | 0.44× |

Cheap is not the same as underpriced, which is where the intuition goes wrong: linemen have low glamour and low leverage together and come out overpaid. The underpaid positions are the quarterback and the corner; receivers and the defensive line are the traps. The strategy table below agrees independently — the trenches-first buyer has never beaten the value shopper.

One limitation to carry openly: this is an average across a position's starters, and where a position has several the first is worth appreciably more than the average. Measured solo, a number one receiver is worth 1.90 against the positional average of 1.13 — about two-thirds again. The value panel says so.

Measured over twenty-four 8-team leagues with the human team following fixed
strategies, on the current 1,500-player pool with the 27-slot roster, injuries
at the default setting and penalties on:

| Strategy | Wins of 14 | Point differential | Average finish of 8 | Titles of 24 |
|---|---|---|---|---|
| Value shopper (bid 1.15× true worth) | 8.5 | +39 | 3.0 | 10 |
| Stars and scrubs (2.4× asking for anyone rated 93+, $1 for the rest) | 7.3 | +10 | 4.0 | 6 |
| Trenches first (1.7× worth on the lines) | 5.6 | −50 | 6.2 | 0 |
| Skill players first (1.5× asking at QB/RB/WR/TE) | 5.3 | −43 | 5.7 | 2 |
| Spread it evenly | 4.5 | −69 | 6.8 | 1 |
| Market follower (pay the asking price) | 4.4 | −87 | 7.0 | 0 |

Re-run after the 2026 leverage correction. Value shopping got *better*, not worse — 7.7 wins before, 8.5 after — which is what a more accurate worth table should do to a strategy that bids off it. The spread between reading the market and following it is four wins a season. Twenty-four leagues is a small sample and the ordering is stable across runs while the individual numbers move by a few tenths.
| Market follower (pay the asking price) | 5.0 | −60 | 6.4 | 0 |
| Spread the budget evenly | 4.5 | −83 | 6.8 | 0 |

About three wins separate the best approach from the worst, so how you bid is
still the main thing that decides a season, though the gap has narrowed from
four since injuries and penalties began adding noise a roster cannot control.
The lesson is learnable from play: buy the positions the room undervalues, and
do not pay a premium for a name. Stars and scrubs had closed the gap on value
shopping once the pool gained a real tail, then fell back a win when AI clubs
learned to game-plan: a roster of stars behind scrub lines now gets its
quarterback blitzed and its run game stacked, which is exactly what a real
coordinator would do to it. Spreading the budget evenly still buys a roster
of mediocrities.

Re-run `npm run strategy` after any change to pricing, leverage or the player
pool; these numbers move.

The priciest lot runs $29 to $40 of $200 depending on league size, against the 25
to 35 percent of budget a real fantasy auction puts on one player. The gap
narrowed when the pool deepened but has not closed, because a 27-deep roster
means every team must keep money back to fill it.

The snake draft is still available as a league option, and `draftType` on the
league selects between them.

## The value board (`ui/value-panel.js`, `ui/views/guide.js`)

The auction's mispricing was the most interesting thing in the game and it was documented here and nowhere in the product. A first-time manager faced $200 over 1,500 names with no way to know a kicker is worth a fortieth of a quarterback, and the only way to find out was to lose a season to it.

It is positional, never per player. Showing what an individual is worth would hand over the answer and delete the auction; showing that the room overpays for running backs is a strategy you still have to execute under a budget, against nine other bidders, with the best names gone by the time you commit. There is no per-player worth figure anywhere on screen.

Everything is derived from `positionValue()` at render time rather than written into the view, so retuning a leverage number moves the panel with it and it cannot quietly start teaching something the simulation no longer does. A test asserts the derivation against the tables directly for exactly that reason.

It appears as a collapsed panel in the auction room and the draft room — closed by default, with the one-sentence version in the summary, because both screens are busy and the reader is mid-decision — and as a standalone page at `#/guide`, linked from the home screen so somebody can read it before they have a league to ruin, and from settings for later.

The page also carries the three things the table cannot show: that bench slots are insurance rather than luxury, that a rating is not a career now that players age, and that chemistry is worth about two home-field edges. A live per-position read of the market as the auction runs stood here as "not built, and closer to giving the answer away". It is built now — see **What losing a lot costs you** — and the worry turned out to be misplaced, because what it reads out is the shape of the board, which is already on screen. What is still deliberately withheld is any estimate of what a rival would bid.

## Draft AI (`draft.js`)

Value over replacement: for each position, the replacement level is the overall of the Nth-best available player where N is the league's remaining demand at that position. Pick = highest (overall − replacement) × positional impact multiplier (QB 2.6, CB 1.1, RB/WR 1.0, DL 0.9 … K 0.5, P 0.35, mirroring measured sim leverage) × GM personality weights (+ era bias for Old School / Analytics) + noise. Kickers and punters are held until the last three rounds unless forced. A slot-count guard guarantees every roster fills.

### Trading picks (`draftpicks.js`)

A pick was never an object. `currentPicker` worked the snake out of `draft.order`, the round and the position in it, so there was nothing to hand over. `draft.traded` is the missing table — overall pick number to its new owner — consulted by `pickOwner` and absent from every league where nobody has dealt.

**Slots for slots.** Rosters are 27 slots and `TOTAL_ROUNDS` is 27, and `settlePointer` skips any club already full, so a club's remaining picks *always* equal its open slots — measured at zero gap across every round of every league checked. That invariant is the whole rule: draft capital cannot be accumulated the way it is in the real game, because three picks for one leaves one club a pick short of a full roster and the other holding a pick it can never use. Picks therefore trade **one for one**, up to three a side, and the refusal says why rather than just saying no.

That is a genuine narrowing against real football and it is worth being plain about: you cannot hoard picks here, only reorder them. Moving up still works, in exactly the shape it takes in the real game — a near pick plus a later one, for their early pick plus one much later. Measured: a straight one-for-one trade up was accepted **0 times in 38**, and the two-for-two version **8 times in 38**.

**A pick has no value chart, and the attempt to fit one is instructive.** Mean rating of the man taken at each pick falls from 95.8 at first overall to about 86 — and then *rises* again, to 87.6 by pick 312. That is where kickers and punters go: high overall ratings at a leverage of 0.79. A log fit missed by as much as 7.2 and was thrown away. What a pick is worth is what the club holding it can do with it, so `projectPickTrade` drafts the board forward under both ownerships and compares the rosters.

**Two things had to be got right for that number to be worth printing.**

- **Compare finished rosters, not part-built ones.** Stopping at the last pick involved was tried first and is wrong: lineup strength weights by position leverage, so a one-player roster holding a quarterback scores 96 × 18 against 96 × 3.3 for one holding a receiver, and a club that slid eight places read as *gaining three hundred points* because the man who fell to it happened to play a dearer position. Only finished rosters compare. A whole draft runs in about 200 ms, so a valuation costs about 400.
- **Switch the noise off.** `rankForTeam` adds N(0, 1.6) to every valuation, and which particular star falls to which club swings a roster by tens of leverage-weighted points. Sampling it was measured: at four runs the standard deviation of the answer **equalled the answer** (mean −64.5, sd 64.9), and sixteen runs cost 1.4 seconds to get sd down to 43.3 — still eighty per cent of the answer. A number whose error bar is its own size is not worth showing to anybody. Drafting both worlds deterministically removes the variance rather than averaging it away: the only difference between the two runs is the swap, which is the question being asked. Repeatability is now exact, sd 0.0. What it gives up is the spread, and the screen says so — this is the likeliest draft, not the average of every draft.

**Are pick swaps zero-sum?** Mostly but not entirely: 27% come out exactly zero-sum, the mean value a swap creates or destroys is 5.9 lineup points, and 6.1% are good for both sides — which happens when two clubs need different positions and the board falls so that each would rather pick where the other does. Those are small numbers next to a player trade, and that is the honest shape of the feature: every club drafts exactly 27 times from a pool of 1,269, so the talent gradient a pick buys you is shallow.

Clubs deal with each other and ring the human, both one for one, both gated on the same greed margin the in-season market uses, and an offer to the human must also be no worse than two points below even for them. Pick deals between AI clubs are kept deliberately rare — a draft whose order churns every round is one nobody can follow, and the board on screen is the thing being read.

**Will he last?** The question a drafter actually asks is not who is best available but who will still be there next time. `survivalOdds` answers it by running the rest of the draft the way the AI really drafts it, eight times, and counting: one run settles every player at once, which is why it is worth doing properly rather than approximating. It costs about 70 ms and is worked out once a turn, kept against the pick count. A club on the clock is asked about the pick *after* this one — the first version answered for the current pick, which is trivially 100% for everybody, and since the pool list only renders while you are on the clock the badge never once appeared. Only men below 75% are marked, because a list of a hundred rows each saying "100%" is a list nobody reads.

One board bug fell out of this: `snakeRows` wrote `rows[round][team]`, so a club holding two picks in one round lost the first. A round is now as many rows deep as its busiest club.

## Rating distribution and the talent tail

A hand-written pool bunches at the top, because the players you remember are the good ones. At 412 entries the 208th-best player was an 87, so every pick in an 8-team league was a good player and the back of a roster cost nothing to fill. Adding names alone did not fix it: at 1,065 entries the 700th was still an 83.

Two changes did. The pool grew to 1,065 players, roughly 650 added across every position and era, weighted toward the solid-starter and role-player tiers rather than more stars. Then `scripts/curve-ratings.mjs` mapped each position's rank order onto a realistic curve, shifting a player's attributes by the delta rather than scaling them, so each player keeps his own shape: a corner who cannot tackle still cannot tackle. The transform only ever shifts downward, which preserves the ordering at the top. An earlier version rounded a positive delta and floated second-ranked players past the best at their position, which briefly put Zack Martin above Anthony Muñoz.

| Percentile | Overall |
|---|---|
| Best in pool | 97 |
| 10th | 91 |
| 25th | 87 |
| Median | 80 |
| 75th | 70 |
| 90th | 63 |
| Worst | 52 |

The top tenth are stars, the median is a solid starter, and the bottom quarter should not be starting. The floor is 52 for quarterbacks and 58 for most positions, since a replacement-level quarterback really is that bad, and 62 to 64 for specialists who remain functional.

The tail only bites when demand approaches supply, which is why league size now runs to 16. An 8-team league buys the top 208 of 1,065 and never reaches the bad players; a 16-team league buys 416 and someone has to start a 72.

| League size | Players bought | Worst starter | Priciest lot |
|---|---|---|---|
| 8 teams | 208 | 79 | $29 |
| 12 teams | 312 | 76 | $36 |
| 16 teams | 416 | 72 | $40 |

`scripts/add-players.mjs` merges new rows into the data file and re-sorts each position, rejecting duplicates, bad seasons and wrong rating counts. Run `curve-ratings.mjs` again only after a large batch of additions, and never twice on the same data, since the transform is not idempotent. `scripts/auction-sim.mjs` compares roster variety between the two draft types and `scripts/strategy-sim.mjs` measures whether bidding strategy changes results.

## League (`season.js`)

Two modes share everything below the schedule.

**Fantasy** (8, 10 or 12 clubs): a round-robin via the circle method. Eight clubs play everyone twice (14 games); ten and twelve play a single round plus enough of a second cycle to reach 13, so a season is always 13 or 14 weeks. Standings: win% → head-to-head → point differential → points for. The field is 4 for 8 and 10 clubs, and 6 for 12 with byes for the top two seeds.

**Pro** (32 teams): two conferences of four divisions, original franchise identities on real geography (no league or club marks). The 17-game slate is built from the same blocks the real league uses: six division games home and away, four against one same-conference division, four against one other-conference division, one each against the two remaining same-conference divisions, and one more across the conference. Every block is a set of perfect matchings over all 32 teams. Which divisions meet rotates by season number. From season two the three single-game opponents are the clubs that finished in the same place in their division the season before, exactly as the real league does it (season one, with no table to read, uses a rotation). Hosting inside a cross-division block follows a 4×4 pattern with two home games in every row and column, and the rank-based games alternate by place and season, so every team hosts 8 or 9 games.

The calendar is 18 weeks with one bye per club. The six division rounds are placed in weeks 5 to 14 and each division sits out one of them; its two games that week move to a week 18 made entirely of division games, so the last week is rivalry week and byes fall where the real league puts them. Six bye weeks rest four or eight clubs each. A bye week still ticks the injury ledger and keeps the waiver wire open.

Pro standings are grouped by division with division and conference records. Tiebreakers run the real league's two-club order: win% → head-to-head → division record (same division only) → conference record → common games (at least four common opponents) → strength of victory → strength of schedule, then point differential and points for so a table is always deterministic. Three-way ties use the same comparator pairwise rather than the league's group procedure. Seven seeds per conference: the four division winners by record, then three wild cards.

The standings carry clinch markers from the first week: **z** a first-round bye, **y** the division, **x** a playoff berth, **e** eliminated. Exact clinching needs a scenario search over every remaining game, so `clinch.js` takes the conservative route: a club has clinched something if it still gets it when it loses out and every rival wins out, with ties going against it, and is eliminated if it misses even when it wins out and every rival loses out, with ties going its way. Both worlds are impossible (rivals also play each other), so a marker is never wrong, only occasionally a week late. The same markers work in a fantasy league against its playoff field.

The bracket engine works on pools of seeds, gives byes when a field is not a power of two, reseeds every round (the top seed always meets the lowest survivor), and when two pools each have one team left it schedules a final at a neutral site with no home edge. Rounds are named Wild Card, Divisional, Conference Championships, Championship.

Home teams get a flat edge of 1.1 composite points to blocking, rush, coverage and tackling, which measures out to a 55/45 split between identical rosters. The setup screen defaults the pro league to the snake draft, since 832 auction lots is a long evening, but the auction works there too.

User games keep the full log and every player line. Playoff games keep player lines. AI regular-season games keep team totals only, since a 32-team season is 272 games and keeping every box score would outgrow localStorage; season totals accumulate for everyone regardless. That trade-off was re-measured rather than assumed, and the measurement changed the argument for it. Of 272 regular-season games in a 32-club season, 17 keep player lines and 255 drop them; one box score serialises to 14.9 KB, so storing the dropped ones would add about 3,800 KB. Not per season, though — the schedule is replaced at `startSeason`, so a save does not accumulate games. Measured over eight simulated seasons it is essentially flat: 2,290 KB after the first and 2,526 KB after the eighth, growing around 30 KB a season from careers, rookies and the history list. So the box scores would not pile up; they would raise the permanent floor, from about 2.4 MB to about 6.2 MB. That is past the 3.5 MB slot warning and past the roughly 5 MB per-origin ceiling most browsers put on localStorage, which means the save would stop being written at all rather than merely getting large. It stays. Game seeds derive from league seed, season, week and matchup, so re-simulating a week reproduces it.

At season start every position group is ordered by overall. Slots fill in the order players were bought, so an auction could otherwise leave a 92 back at RB2 behind a 75. AI clubs are re-sorted each season; the user's club only the first time.

## Money in the pro league (`cap.js`)

The fantasy league has had an economy since the auction shipped. The pro league
had none: `contracts[id]` stored a draft *round* and no money, `keeperCost` fell
through to the minimum bid, and clubs kept eighteen of twenty-seven men a year
for free. A good pro roster therefore stayed good forever, because nothing ever
made you choose. The cap is that missing constraint, in the same $200 over 27
slots the auction already speaks, so the price guide's units carry over.

**A rookie scale by draft slot.** The first pick costs $20 — a tenth of
everything a club has — round four costs $10, and from round fifteen on it is
the minimum. The curve runs over the *fraction* of the draft rather than the
pick number, so it holds at 8, 12 and 32 clubs. It was tuned against one
requirement: a roster drafted top to bottom costs about 101 of 200, near enough
half, leaving room to re-sign anybody. Every steeper curve tried makes the first
pick worth about as much as the fourth, which is not a decision; every
shallower one spends the whole cap on rookies. This gives the uneven pick trades
above a second currency — moving up costs cap space as well as picks.

**Market money is charged in exactly one place.** `keeperCost` for a man whose
deal has run out. Everything else is cheap: a drafted player is on his slot
price for four years, and anyone arriving by waiver claim or signed to fill a
hole is on the minimum for one. That is deliberate, and it is the whole
mechanism — a cheap rookie deal runs out and the bill arrives at what the player
is now worth. `marketSalary` is leverage times rating over a replacement level,
calibrated so a roster priced entirely at market costs 104% to 114% of the cap.
Just over, on purpose: no club can field a side of men all paid what they are
worth, so every roster is part bargain and part rookie deal.

**Three things were wrong before it worked, and all three are the same mistake
in different clothes — the money kept being thrown away:**

- `confirmKeepers` rebuilds `league.contracts` wholesale each offseason and its
  non-auction branch wrote `{ round, kept, since }`, dropping `salary` and
  `years` on the floor. A whole league read a cap hit of 27 of 200 by its second
  season, and nothing ever expired, because the countdown reset every year
  before it could reach zero.
- Expiry released the player. That made the cap decoration: a star whose deal
  was up went back in the pool and was re-drafted at rookie money, so keeping
  good players never cost anything. He is now *marked* expiring and stays
  yours — at what he is worth.
- Every founding contract ran the same four years, so the entire league expired
  in the same offseason. 27 of 27 gone from every club in season five, then
  four years of nothing. Founding deals are now staggered by a hash of the
  player and the league seed; after the first season a rookie gets the full term
  and the spread maintains itself.

**The cap binds at kickoff and nowhere else**, which is the one place it is
checked. A club over it sheds what it is paying most for per point of lineup,
and the slot that opens is filled off the board at the minimum — which is what
makes shedding converge. `cutToCap` has to judge on `projectedHit`, not the
current hit, because it is cutting men into empty slots that `fillOpenSlots` is
about to fill: judging on the hit alone let a club cut its way to exactly the
cap and then go over when the replacements signed.

Measured over eight seasons of a 32-club league: cap hits run 142 to 200 against
a cap of 200, **no club is ever over at kickoff**, and 14 to 22 of 27 men are
kept a year. Before the cap it was 27 of 27, forever.

### Repairing a league signed all on one day

A pro league saved before `syncContracts` learned to stagger has every founding
contract on the full rookie term. The damage is not the one chaotic year I
expected, and the measurement is what settled the design. Three leagues, eight
seasons, against a staggered league run the same way:

| season | pre-fix expiring / roster kept | staggered |
| --- | --- | --- |
| 1 | 0 / 95% | 219 / 83% |
| 2 | 0 / 92% | 219 / 68% |
| 3 | 0 / 90% | 232 / 57% |
| 4 | **758** / 48% | 312 / 55% |
| 5 | 6 / 68% | 120 / 60% |

The bad year is survivable — by season five the two are back in step. **The
three dead years before it are the real cost**: nothing expires, ninety per
cent of every roster stays put, the lineup moves by 11 to 19 points against 58
to 97, and the cap sits at 122 of 200 without ever binding. Three seasons of a
dynasty with no decision in them.

`spreadFoundingContracts` runs once, from `migrateLeague` at version 4, and
adds `hash % ROOKIE_YEARS` years to each founding deal. Measured on a pre-fix
save loaded in season two or three, the season-four cliff of 758 expiries at
48% retention becomes **191 at 77%**, and the years after settle at about 200 a
year — the staggered league's own profile.

Three things about it are deliberate:

- **It never shortens a contract.** The keeper screen prints "3y left" and
  somebody may have been counting on it. Every deal keeps what it has and some
  get up to three years more, so the cohort fans out instead of landing
  together and nobody loses a man they were promised.
- **It only touches a flat cohort.** The shipped stagger guarantees a spread,
  so two distinct terms among the founding intake is enough to leave a league
  alone. A fantasy league and a first season are skipped outright.
- **It cannot undo the dead years.** Seasons already played stay played; there
  is no retroactively expiring a contract that did not. The migration fixes the
  future of such a save and says so.

It also says so on screen, once, in the banner a save problem uses, with a
button to dismiss it. Clearing the note during the render was the first attempt
and it is wrong: clearing fires `update`, which re-renders the banner, so the
message appeared and vanished inside one tick.

## Two pools in the pro league (`proleague.js`)

The fantasy league is an all-time draft and should stay one. The pro league was the same thing wearing a salary cap, and that is not how a football club is run: there is no year in which Anthony Muñoz is a free agent.

**What it actually did.** A thirty-two club league fills 864 slots from a pool of 1,269, so about four hundred all-time players are permanently unsigned — and a generated rookie has to beat them to be picked. Measured over a twelve-season save: the second-season draft made 102 picks and **nine of them were rookies**; the third made 203 and twenty-one were. Free agency still held 415 all-time players in season nine and 124 in season thirteen. For years the best free agent in the league was a kicker — Martin Gramatica, then Phil Dawson, then Robbie Gould — because leverage says no club should spend a slot on one, so nobody ever did. The rookie classes were generated, aged, washed out and barely used.

**The split.** Three rules, which between them are what the real thing does:

- **The draft is this year's rookie class and nothing else.** `draftablePool` narrows the board; `createDraft` records the eligible ids on the draft itself, so the board, the AI and the trade projection all read one list. It runs as many rounds as the class needs rather than one per roster slot — 176 rookies over 32 clubs is five, not twenty-seven.
- **Free agency is everyone who was in the league and is not on a roster now**: cut, let go when a deal ran out, never re-signed. `signablePool` is the narrowing, and free agency, the waiver wire and the kickoff fill all go through it, so all three agree on who exists. Not this year's rookies — they are in the draft.
- **The all-time players nobody drafted drain away.** Year one they *are* the market, which keeps an opening season feeling like an all-time league. From then on they leave.

**The drain is a rule, not a snapshot.** The first version scheduled the 405 founding leftovers once and spread them over four seasons. It does not work, and the reason is worth keeping: the unrostered *set* churns even though its size cannot. A club cuts a man for cap room and he is unsigned from then on, never having been on the original list — so the original 405 leave and a fresh 405 take their place, and the market a rookie has to beat never thins at all. `scheduleDrain` therefore runs every offseason: whoever is off a roster gets a season to find another one, and then he is done.

**And it has a floor, because it starved the league.** Run blind it took the market to no kickers and no punters, and clubs came out of an offseason unable to field one. The floor was first one spare per club per position, which is the wrong shape — a club fields one kicker and five offensive linemen, so a flat floor demands as much cover for the kicker as the whole league uses kickers. Across eleven positions it reserved 352 men, most of a market that settles near four hundred, and the drain could only ever reach the few dozen above that line. It is now a share of what the position is for (`DRAIN_FLOOR_SHARE`), and when a position is down to it the men who stay are the *worst* ones: a great player nobody will sign retires, and the journeyman is the one still taking calls in August.

**What it measures out to.** The same save, same seed, after: every pick from season two on is a rookie, and the all-time share of free agency falls 496, 445, 356, 279, 150, 109, 75, 49, 24, 20, 15, and then nothing. From about season eight the best player in the draft class outrates the best player on the market, which is the whole point — the draft becomes how a club gets better. Across four seeds and eighteen to twenty seasons every club fields a full roster every year, no position runs dry, and no retired player is ever on a roster.

**Three things it broke on the way, all of them real bugs it only exposed.**

- **The rookie scale was measured against the wrong draft.** `draftSize` returned a round per roster slot, so a five-round rookie draft was priced as the first 160 picks of 864 — the expensive top eleventh of the curve. A 49-rated punter taken in the last round was paid 12 of a 200 cap against a market value of 1, and a class cost its clubs 1,040 against the 151 it was worth. It now reads the rounds off the draft being held: the same punter costs the minimum, and the class costs 324 against 165, which is the premium a pick should carry rather than a penalty for having one.
- **A club that could not use its pick stopped the whole draft.** An all-time board always had somebody at every position; a rookie class does not. `runAiPicks` broke out of its loop the first time the AI had nothing to take, which on one second-season draft meant halting at pick 77 with 99 rookies still on the board, six clubs still short of a roster, and a club that had been promised five picks making four. A club that cannot use its turn now passes it (`passPick`), exactly as the real thing does.
- **The class was too small to be the only supply.** A fantasy intake only has to be interesting; a pro intake has to replace everyone the league loses. At 3.5 a club the market fell to about 135 men for 32 clubs, ran out of kickers and punters repeatedly, and still left a club an offseason short. `PRO_PER_CLUB` is 5.5. There is also a backstop (`topUpPositions`): a position whose *market* is too thin gets replacement-level bodies, stamped with last year's class so they are signable rather than draftable. Two things about it were wrong on the first pass and are worth keeping, because both read as healthy right up to the moment a club could not field a side. It counted the arriving class as supply — but the class belongs to the draft that year and `signablePool` keeps it off the market, so a league with five punters and no way to sign any of them looked fine. And it counted the whole league rather than the unrostered part of it, so thirty-two punters under contract read as thirty-two punters available. It now measures what can actually be signed: alive, off a roster, not in this year's draft. The run that found it went 21, 22, 24, 22, 19, 16, 12, 8, 5 punters on the market and then none, and Carolina came out of the eleventh offseason without one.

It is a floor and not a source: across five seeds and eighteen seasons it mints a couple of specialists a decade and nothing else. If it starts firing often that is the class being too small, which is what the low cover is there to reveal rather than hide.

**A contract under term is not a decision.** `keeperLimit` has said since the cap shipped that under a cap the contract decides rather than a quota — four-year rookie deals turning over about a quarter of a roster a year. `aiKeepers` did not implement it: it re-ran every player through a surplus test (`market × taste × BIRD_IN_HAND − cost > 0`) every offseason, so a contract meant nothing after the year it was signed in.

It fell hardest on the draft, which is priced above market on purpose. A first-round rookie costs 15 to 20 against an auction guide that says he is worth about 5, so his surplus is negative from the day he is picked and his own club let him go every time: measured over twelve seasons, a class drafted 155 strong came back the next year **17 strong** with three years still to run.

A man with years left is now kept without having to prove himself a bargain. He is still droppable — the same cap test is applied to him as to anyone else, and a club that cannot fit its own contracts sheds the ones it values least, which is a cut. What changed is the default.

The first attempt at this failed and the reason is worth keeping: it exempted men under contract from the cap test entirely, on the grounds that committed money is committed. `validateKeepers` then rejected the list — "keeping these costs $151; that leaves less than $4 a slot for the other 14" — and the offseason threw. Applying the test to everyone and merely *ordering* contracts ahead of re-signings fixes the defect without touching the validator at all, because the list it produces always fits.

It was also worth checking whether `SLOT_RESERVE` was still right, since it was calibrated when every open slot was a pick in a twenty-seven round draft. Measured on what clubs actually pay to fill a slot now: about 4 for a drafted man and 5 to 17 for one signed off the market, blended 4.6 to 10.2. Four a slot is if anything low, so it stays.

What it is worth, measured over twelve seasons of one league against the same league run the same way: first-year retention of a drafted class roughly doubles (11–12% to 26–28% in the early years, and 78% by season twelve as the all-time pool thins), mean cap usage goes from **136 of 200 to 165**, mean lineup strength from 7,440 to 7,489, and the gap between the best and worst roster narrows from 830 to 787. The cap sitting at 136 was the tell: clubs shed their contracts every year, so they never carried real money.

**The practice squad (`squad.js`).** Three changes in a row established what was *not* stripping a draft class. Contracts were not: a man under term is kept by default now, and first-year retention roughly doubled, but most of a class still went. Cutting being free was not: dead money is real money and the churn did not move at all. Draft order was not. What was left is the roster itself — twenty-seven slots, every one a starter or the first man off the bench, every one of them filled. A club's twenty-seventh best player really is worse than the best of a three-hundred-man market, so a fifth-round rookie really is the man to replace, and being right about that every week is what stripped the class. There was nowhere to be young.

A club may now hold up to `SQUAD_SLOTS` players outside its twenty-seven. They do not play, they cost the minimum while they are down there, and they age and develop like anybody else — that last one is the whole point, and it falls out of `ownedIds` in `careers.js` counting the squad. It is deliberately the injured-reserve shape, a parallel list beside the slots, because everything that walks a roster already knows to walk `ir` beside it: ownership, contracts, the washout, the market cover floor, the share code. Pro leagues only; a fantasy league drafts the all-time pool every year and has nobody to develop.

Eligibility is a generated player within `SQUAD_SEASONS` of his draft class. An all-time great cannot be sent down, which matters more than it sounds: without that rule the squad is not a place to grow but a place to park a roster you cannot afford, since a man on it costs the minimum. `agedOutOfSquad` settles it every kickoff — whoever has outgrown the squad is promoted if his club has room at his position and released if it does not, so nobody sits there for ever.

The behaviour that does the work is one line on the waiver wire. A young player beaten out for his slot goes *down* rather than out, if his club has room. That is where the class was being stripped, and losing a slot is no longer the same thing as losing the player. His contract is untouched while he is down, so he costs what it says again the day he comes up.

**What it is worth, and it is the change that actually did it.** First-year retention of a drafted class, measured over the same twelve seasons throughout: **11–12%** before any of this work, **26–28%** once contracts under term were kept, and **68–88%** with a squad to sit on. The real league runs about 70–80%. Generated players hold 783 of 864 slots by season thirteen. Squads settle at two to three of the six places, never over, and no club is ever a man short.

**The rookie draft runs straight; everything else still snakes.** The snake exists to make a *fantasy* draft fair: twenty-seven rounds out of one all-time pool, and the club picking last every round would be ruined by it, so the order reverses. None of that applies to a rookie draft. It is five rounds over one class, it runs worst to first off last season's table, and the unfairness is the entire design — a bad club is supposed to get the better of it, every round, exactly as the real thing does. `createDraft` records `snake: false` on a rookie draft and `seatAt` is the one place the order is worked out, so `currentPicker`, `pickOwner` and `originalOwner` all read it from there. The founding pro draft keeps the snake, for the same reason the fantasy one does.

`seatAt` is its own inverse in both shapes — in a straight draft seat and position are the same, in a snake they are `n - 1 - x` of each other either way — which is what lets `applyOwedPicks` turn a club's seat back into the pick number it owns with the same arithmetic. That file cannot import `draft.js`, since `draft.js` imports it, so it reads the flag off the draft directly.

It changes what a future pick is worth, and by a lot: the club picking first holds pick 1 under either rule, but its second-round pick is number 64 of a 32-club snake and number 33 running straight. `snakeOverall` takes the shape as an argument now and `futurePickValue` passes what next season's draft will actually be, so a pro league stops overrating the good clubs' future picks and underrating the bad ones'.

Measured over fourteen seasons on two seeds, it does what a straight draft is supposed to do: the gap between the best and worst roster falls from 873 to **750 and 773**, which more than takes back the widening dead money caused. Cap usage and mean roster strength are unchanged.

**Cutting is not free.** A cut used to delete the contract and hand the money straight back, which is the one thing that stopped a deal from meaning anything once it was signed. Half of it follows the man now, for the years that were left — `DEAD_SHARE`, booked by `bookDead` at the three places a roster actually loses somebody it was still paying: the cap shed at kickoff, a drop on the waiver wire, and the keeper round. Retirement is not one of them, and neither is a trade, where the contract goes with him. It runs down a year at a time beside the live deals and counts against the cap while it lasts.

The charge is floored rather than rounded, and that is load-bearing rather than tidy: `cutToCap` sheds salary until a club fits, so a cut that freed nothing could loop without ever converging. At half, and with a minimum deal leaving no bill at all, a cut always frees at least as much as it costs. A test pins it by putting a club far over and checking it gets under.

Measured over twelve to fourteen seasons across four seeds, clubs settle carrying **12 to 14 of the 200 cap** in money owed to men who are gone, with the worst-run clubs up near 60. Cap usage goes from 165 to about 168, rosters stay valid every season, and the gap between the best and worst club widens a little — from 787 to between 714 and 817 depending on the seed — which is what you would expect from a rule that makes bad decisions compound.

**A claim made here in the previous entry was wrong, and the correction matters more than the feature.** That entry said the in-season churn "is not football", on the evidence that a drafted class lost 36 of its members to the waiver wire in a season against 14 at the keeper round. That is the wrong denominator. Counted properly, the whole league makes **three to five wire moves per club per season** — about 110 waiver claims across 32 clubs and eighteen weeks. A real NFL club makes far more than five transactions a year. The churn here is not high, it is low.

So dead money does not reduce it, and was never going to. Dropping a man on a dear deal for a claim at the minimum is *cap-profitable* even after the charge: the club sheds his salary, pays half of it, and replaces him for one. Measured before and after, waiver drops from one class went 36 to 47 — dead money is a real cost that correctly does not change a decision that is still worth making.

What actually drives a drafted rookie off a roster is the twenty-seven slot roster where every slot is a starter, against a free-agent market of three to five hundred men. A late-round pick genuinely is the worst player at his position on the club and genuinely should be replaced; there is nowhere for him to sit and develop. That is the practice-squad problem, and it is the roster shape rather than the contracts. Dead money is worth having on its own terms — it makes a cut a decision with a bill, for the human as much as the AI — but it is not the answer to that.

## The free-agent market (`freeagency.js`)

Between the keeper round and the draft, and only in a capped league. What makes
it a decision rather than a shopping list is that the men on offer are the *same
men who will be in the draft an hour later*. A bid does not win you a player you
could not otherwise have; it wins you the **certainty** of him, at market price
instead of rookie money. And it costs a pick — a club's picks are its open
slots and `settlePointer` skips anybody already full, so a club that signs four
free agents simply never makes four of its picks. Nothing had to be written to
make that true; it falls out of slots-for-slots.

**How much of its roster a club buys here (`AI_FA_SHARE`), finally swept.** It was set at half when the market shipped and never revisited, through the two-pool split, the contract rules, dead money and the practice squad — every one of which changes what free agency is for. Four values over four seeds and twelve offseasons each, watching where a roster actually comes from:

| share | signed / drafted / scraped | cap | best-to-worst spread |
| --- | --- | --- | --- |
| 0.25 | 13 / 75 / 13 | 156 | 756 |
| **0.50** | **25 / 63 / 12** | **166** | **759** |
| 0.75 | 29 / 61 / 12 | 169 | 781 |
| 1.00 | 38 / 52 / 9 | 171 | 829 |

Half stays, now for a measured reason rather than an untested one. Above it the gap between the best and worst roster opens up — clubs that are already good buy the market — and the draft stops being where most of a roster comes from, which is what the two-pool split was for. Below it the market is vestigial at an eighth of all signings and the cap goes slack at 156 of 200. Between 0.25 and 0.5 the spread is flat, so this is not a knife-edge optimum; it is the top of the range before the cliff. One reading to be careful with: on a single seed 0.5 looked like a true minimum at 746 against 786 and 813, and across four seeds that turned out to be noise. The real signal is the cliff above it, not a dip at it.

**A club with one hole sits the market out, and that is load-bearing.** `want` is floored, so a single open slot rounds to nothing and the club drafts instead. It reads like an off-by-one. Measured over 256 club-offseasons it shuts out 8% of them — and they are the *good* clubs, because a club with one hole is one that kept everybody. Letting them shop with `Math.max(1, …)` was tried: the spread widens from 759 to **821**, well outside the range between seeds. A contender buying its last piece every single year is how a league stops being competitive. A test pins it, since the next person to read that `floor` will think it is a bug.

**Bids are sealed, and the asking price is a floor.** A player will not sign for
less than `marketSalary` says he is worth, because without that floor an
uncontested star goes for a dollar, which is not a market but an oversight. A
club is held to every bid landing at once — anything looser lets it bid the same
dollar on six men and field whichever it wins — and the slots it has not filled
are reserved at `SLOT_RESERVE` off the top.

**It settles in waves, and that is not a detail.** One pass is a lottery, not a
market: every club ranks the board by what a man adds to *its* lineup, and since
an empty quarterback slot is worth six times an empty punter to anybody, they
all crowd the same dozen names. Measured, a single pass drew about fourteen
bidders a player and produced **13 signings across 32 clubs** — most clubs got
nothing and fell back to the draft having wasted the round. Four waves, with the
losers turning to whoever is left, produce **42 to 50**. The human's outstanding
offers stand across waves; they are only spent when they win.

Within a wave the dearest man settles first, which matters because a club that
wins a bidding war is poorer for the next one — that cascade is most of what
makes overpaying for a star a real choice. Ties go to the worse record, the same
priority the waiver wire uses, and the screen says so rather than reporting "you
bid $24, he went for $24" and looking like a bug.

**Losing bids are recorded when they lose.** The first version worked the report
out afterwards from leftover offers, but a signing tears up every other offer for
that player — so a club that had been outbid four times was told it had lost
nothing. Each signing now carries who was underbid and for how much.

Measured over three offseasons of a 32-club league: 42 to 50 signings a year,
every one at or above the asking price, no club over the cap at kickoff and
every roster full. A fantasy league never sees any of it.

## Trading picks unevenly, and filling what is left

The draft used to insist on n picks for n picks, because rosters are 27 slots
and the draft is 27 rounds, so a club's picks and its open slots were the same
number by construction. Deals could move *order* but never *quantity*. That rule
is gone, and the two halves of what replaces it are not symmetrical:

- A club that **sends more than it takes** drafts that many times fewer and
  finishes the draft short. `fillOpenSlots` signs the difference off the board
  when the season starts, dearest slot first (an empty quarterback slot is worth
  six times an empty punter by leverage) and clubs in waiver order, worst first,
  because they are competing for the same few men.
- A club that **takes more than it sends** cannot use the surplus at all.
  `settlePointer` already skipped anybody with no open slots, so its *latest*
  picks are simply never made — and those are the cheapest ones it holds.

That asymmetry is the whole market. Measured over six leagues against the same
league drafted without the trade — and then, a commit later, measured again for
whether anybody would actually *sign* it:

| deal | worth to you | AI clubs who agreed |
| --- | --- | --- |
| your last two for their first | **+32** | **0 of 24** |
| your next two for their first | **−49** | **24 of 24** |
| your next one for their next two | **+13** | 2 of 24 |
| one for one | −16 | 12 of 24 |

**The second column is the finding, and it arrived late.** The first version of
this section stopped at the left-hand column and called packaging late picks to
move up "the deal that pays" — which it is, and which no club will ever sign,
because the same arithmetic that makes it good for you makes it terrible for
them. The only uneven deal an AI reliably agrees to is the one that costs you
forty-nine points. The trade room was advertising a trap.

The cause is structural rather than a tuning error. A club cannot use more picks
than it has slots, so surplus picks are never made: **quantity is worth exactly
nothing to whoever receives it.** Adding a late pick to either side of a deal was
measured to move the projection by *exactly zero* — it is a one-for-one with
extra paper. Uneven packages of early picks are near zero-sum, so one side's gain
is the other's loss and no bar can be cleared by both. Across every shape tried,
**0 of 24** cleared both; the lone exception is a club that is *already* short,
which will pay a little for a late pick because it fills a hole that would
otherwise go to a free agent, and that managed 2 of 24.

So uneven trades are legal, correctly valued, and mostly unsignable — and AI
clubs do not propose them because there is nothing fair to propose. Making them
work needs quantity to be worth something, which under a fixed twenty-seven-slot
roster and one draft a season it cannot be. The fix is future picks: a pick in
next season's draft has value because next season there are fresh slots. That is
the next section. `MAX_SHORT` caps how short a
club may trade itself, because a club that did this every year would arrive at
kickoff with half a roster of leftovers, which is not a decision, just a club
that has stopped playing the draft.

**The projection had to learn about the fill.** `projectPickTrade` compares two
finished rosters, and it scored an unfilled slot as nothing — so every move up
looked like a loss. That is the partial-roster trap from the leverage work
wearing a different hat, and the fix is the same one: both simulated worlds now
run `fillOpenSlots` before being valued. Paired against what actually happens,
the projection now reads −44 against a real −45 on the deal that was measured.

**Nobody starts a season a man short.** The fill runs inside `startSeason`
rather than at the end of the draft, so it holds however a league arrived at a
season: a fresh draft, an auction, a share code, or a simulated year. There is a
test for exactly that invariant.

AI clubs evaluate uneven offers — `evaluatePickTrade` runs the same projection —
but they only *propose* one for one, because the candidate space for uneven
packages is combinatorially larger and the offer budget is already the tightest
thing on that screen.

### The picks a club can actually make

A comment on `remainingPicks` claimed *"its length is always its number of open
slots, which is the invariant every trade here has to preserve."* True of an
opening draft, where twenty-seven rounds meet twenty-seven empty slots. Wildly
false of a keeper draft, and the wrongness had reached the screen.

Measured in a thirty-two club pro league: in its second season a club held **27
picks against 3 open slots**, and in its third, 27 against 7. A club stops
drafting the moment it is full — `settlePointer` skips it — so the rest are
never made by anybody. The draft screen said **"Trade picks · 27 left"** and the
room listed fourteen rows a side, of which three were real. The other eleven
were paper: a club could be offered one in exchange for a pick that would
actually become a player.

`usablePicks` is the first of a club's hand, as many as it has slots. That it
is exactly what a club drafts with is measured rather than reasoned — over two
keeper drafts the picks made were precisely the first `openSlots` held, for
**32 of 32 clubs both times**, which falls out of `settlePointer` walking a
hand in order and dropping a club when it fills.

**It is a display rule, not a trading rule.** A pick outside the window is not
worthless in a package: giving away an early one promotes a late one into it,
so a club trading its first three then drafts with its fourth, fifth and sixth.
Refusing to trade those would be wrong, so nothing does. What changed is that
the room lists what a club will make, the draft screen counts it, and the AI
builds its offers from it — handing the human a pick that will never become a
player, in exchange for one that will, reads as fair and is not.

`remainingPicks` still returns everything, because that is the mechanical truth
the snake and `applyOwedPicks` work in.

## Next year's picks (`futurepicks.js`, `pickvalue.js`)

The request was to ban pick trades in a league's opening draft and, from the
second year on, price picks off how each club performed. Half of that is right
and half of it is backwards, and the measurements say which half.

**Banning the opening draft's pick trades is the wrong ban.** The order of the
draft in front of you is *known* — pick 3 is pick 3, and `projectPickTrade`
prices it by drafting the board twice. There is nothing to estimate. What cannot
be valued in a league's first year is a pick in the *second* year, because the
estimate has to come from somewhere and in an opening draft every club is the
same twenty-seven empty slots. So the ban is on **future** picks until a season
has been played, and current-year picks stay tradeable from day one.

**Last season's record barely predicts next season's.** This is the finding
that changed the design. Over 512 club-seasons of the pro league, where a club
finished last year predicts where it picks this year at **r = 0.15** — mean
error nine and a half slots of thirty-two. Near enough nothing. The reason is
that the league is built to equalise: the draft order is reverse standings,
about nine slots a club turn over every offseason, and free agency runs before
the draft. Finishing last is most of a cure for finishing last. Pricing a
future pick off a club's record — the thing that was asked for — would be
pricing it off noise.

What does predict it is **the roster the club is about to field: r = 0.59**,
mean error six slots of thirty-two. What that is worth on the curve a keeper
draft actually has:

| what is traded | average worth | range across the league | priced to within |
| --- | --- | --- | --- |
| next year's round 1 | 15 | 0.2 to 56 | 9.4 |
| next year's round 2 | under 1 | — | 0.2 |
| next year's round 3 | under 1 | — | 0.0 |

Next year's first is the only future pick worth much, and only from the right
club — a first from a side about to be good is worth nothing, and telling the
difference is the gamble. Off last year's record instead of the roster, the
same round-1 pick prices to within 14.6, which is most of what it is worth.
Rounds two and three are throw-ins, and the code prices them accordingly rather
than pretending a cutoff at one is principled.

The number that matters more than any of those is the bias: **−0.0 points** on
a round-1 pick. Both sides use the same estimate, so a wide error bar makes a
future pick a gamble rather than a robbery. The room says so in as many words
rather than printing a number that implies precision it does not have.

**Three rounds, one year.** Two years out needs a guess at a roster that has not
been assembled. Three rounds is where a keeper draft ends: a pro league keeps
eighteen of twenty-seven, so it drafts about nine rounds and then everybody is
full and `settlePointer` ends it. Over 960 club-drafts a round-1 pick is
actually made 100% of the time, round 2 95%, round 3 93% — and round 7 only 77%.
Past round three a future pick is mostly a promise that quietly never comes due,
which is a miserable thing to have traded for. Those odds are priced in
(`madeOdds`). A fantasy league keeps six, drafts twenty-one rounds every year
and never voids one at all.

### The scale error that killed the feature once

The curve in `pickvalue.js` was fitted on an **opening** draft, where the whole
pool is on the board and a club has twenty-seven slots to fill. A keeper draft
is a different animal: eighteen of twenty-seven are already signed, the best
man left is nothing like the best man alive, and a club has about nine slots to
use. Measured in six second drafts:

| slot | measured in a keeper draft | opening curve says | ratio |
| --- | --- | --- | --- |
| 1 | 56.1 | 304 | 0.18 |
| 5 | 33.5 | 254 | 0.13 |
| 12 | 11.7 | 191 | 0.06 |
| 48 | 1.8 | 76 | 0.02 |

The shape is different too, not only the scale: the opening curve needs a slow
second exponential for its tail because there are slots deep in the draft worth
filling, and a keeper draft has no such tail — a **single** exponential fits as
well as two (rms 0.056 against 0.059, and with six points the extra parameters
are not earned). Value collapses inside the first round, because that is how
many useful players are left.

**This was not an academic error.** With future picks priced at 304 against
present picks correctly priced at 2 to 12, every market measured as dead: the
human selling next year's first was offered −145 points and every club took it;
the human buying one was refused by 123 of 124 clubs. Three shapes of AI offer
were built and all three measured unsignable — sweetening a straight swap 5 of
540, lump for lump 2 of 672, size-matched 1 of 631 — and I wrote "AI clubs
never ring about next year, and that is arithmetic" into three files as a
structural finding before checking the scale.

With `keeperPickValue` the same measurements read: the human selling next
year's first now averages +0.6 with a best of +26, 67 of 124 clubs will take
it and 41 of 124 will sell one, **26 of 248 pairings are good for the human and
acceptable to the club**, and 21 of 248 clear the bar a club needs to ring you
about it — against 14% for a straight present-pick swap. It is a real market.

What survives from the wrong version is the shape of AI offer: **one future
pick straight against one present pick, round one only**. Sweetening a swap
fails on units as much as on value — the smallest future pick worth trading is
worth more than the whole swing of a swap between two nearby present picks, so
no future pick is small enough to be change. Rounds two and three of a keeper
draft are worth about three points and a fifth of a point, which is not worth a
draft simulation to ask about.

`futureDiscount` gives each club its own time preference — a contender near the
top of the table discounts next year to 0.70, a rebuilding club values it in
full — so the same pick fetches 24 from a contender and 28 from a rebuilder.
That is what makes shopping one around worth doing.

**How it is stored.** `league.owedPicks` records only deviations — `{ season,
round, from, to }` — so a league where nobody has traded carries an empty array.
Ownership is rewritten in place rather than appended, which means a pick traded
on and then traded back leaves no row behind, and `futureOwner` falling through
to `from` is then always correct. The rows come due in `createDraft`, which is
the first moment an order exists and so the first moment a round and a club can
become a pick number; they are consumed as they are applied, so nothing fires
twice.

**Moving up costs twice.** Future picks are priced off the rosters the draft
*finishes* with, not the ones it started with. A club that trades up comes out
stronger, is guessed to finish higher, and so its own future pick falls later
and is worth less. That falls out of the arithmetic rather than being written
in, and it is the right answer.

### Picks in player trades

Once a pick is priced in lineup points, the in-season trade room can carry one,
and the natural deal — a player for a pick — becomes available. What it is
*not* is a way to buy a star.

**A pick closes a gap; it does not buy a player.** Measured at the deadline,
buying somebody outright for next year's first cleared both bars **0 of 564
times**, and the two sides' gains summed to −44.5. That is not the pick's
fault. A roster is twenty-seven slots and always full, so the selling club
loses a starter and signs a replacement off the street — the full cost — while
the buying club must release its own worst man at that position and gains only
the difference. A nought-for-one is structurally lossy whatever the price.

Where a pick does work is as the balancing item on a deal that nearly happened.
Over 10,527 one-for-one pairings at matching positions, **13 cleared both bars
on their own and a pick tipped 35 more over** — roughly tripling what a club
will sign. In **28 of those 35 it was the club paying**, which is the shape a
general manager recognises: you want the player, so you add a pick. That is why
`makeAiOffers` tries a pick only against its best near miss rather than against
every candidate: a deal that was never close stays not close, and the pass
costs one comparison instead of tripling a loop that already runs 162
validations a club.

**A pick is worth more at the deadline than in the spring, and measurably so.**
`projectedSlots` now blends the roster with the season's record. Over 6,912
club-weeks:

| | ranks clubs against their finish |
| --- | --- |
| roster strength, any week | r = 0.59 |
| record alone, week 5 | r = 0.59 |
| record alone, final week | r = 0.96 |
| the blend, week 12 (the deadline) | r = 0.86 |

The record overtakes the roster around week five and the blend beats either at
every single week. The weight is `played / (played + 4)`, fitted to that table:
it averages r = 0.799 across the season against a per-week optimum barely above
it. With no games played the record term weighs nothing, which is exactly the
offseason case — so the draft room's valuation is untouched by any of this.

**Two rounds, not three.** A keeper draft's value collapses inside the first
round: at thirty-two clubs a round-1 pick is worth 14.7 points to its holder, a
round-2 pick 0.1, and a round-3 pick 0.0. Across those 10,527 deals a first
closed 32 and a second closed 3; a third closed none. Two keeps the throw-in
that occasionally matters and stops both rooms listing rows worth nothing.

**`owedpicks.js` exists because of an import cycle, and the split is real.**
`transactions.js` has to move a pick when a deal goes through, and
`futurepicks.js` needs `lineupStrength` from `transactions.js` to guess where a
club will finish. One module holding both puts a cycle between them — which
does resolve, over hoisted function declarations, by luck; turn
`lineupStrength` into a `const` one day and the app stops loading. So the
bookkeeping half (who owns what, and moving it) sits in `owedpicks.js`, which
imports nothing that can come back around, and the valuation half stays in
`futurepicks.js` and re-exports it. For the same reason `evaluateTrade` takes
`pickDelta` as a number and `makeAiOffers` takes a `picks` handle: both are
valued by the caller, because this file cannot value them itself.

### Who would say yes (`dealfinder.js`)

The trade room was a guessing game. It listed every roster and told you who was
on the block, and then you picked two players, pressed Propose and were
refused — because a deal has to clear the club's greed **and** improve your own
lineup, and eyeballing two rosters will not tell you when both are true.

The market underneath it is busy. Sampling sixteen weeks across four leagues,
**14.4 deals a week exist that a club would accept and that improve the human's
lineup**, spread over about seven clubs of thirty-one, and there was never a
week with none — the spread ran 1 to 40. The human saw eleven offers a
*season*. So the finder is the same search `makeAiOffers` already runs, pointed
the other way, behind a button.

**It runs the whole sweep, and that is measured rather than lazy.** Ranking
candidates for free and stopping early is the pattern draftpicks.js uses, and
it was tried here first. Of 4,464 candidates only 9 were good, and the best
free estimate — the lesser of the two sides' marginal gains — found 3 of them
in the first 300 against 1 for no ranking at all:

| ordering | good deals in the first 300 (of 9) |
| --- | --- |
| lesser of the two sides | 3 |
| the sum | 1 |
| the club's side alone | 1 |
| the human's side alone | 0 |
| no ranking | 1 |

Better than nothing and nowhere near enough. A finder that reports three deals
when nine exist is worse than no finder, because you cannot tell which case you
are in. The ranking survives only to order the results.

**So it is chunked instead of budgeted.** The full sweep measures 717 ms on a
desktop, about 2.9 s on a mid-range phone — which is exactly the shape of thing
that froze the draft screen. `dealPlan` does the cheap half in one task and
`scanClub` does one club at a time, with the screen touching only its progress
line in between; redrawing the whole view thirty-one times would cost more than
the search. The worst single club measures 34 ms, or 135 ms throttled, which
stays inside a frame budget people can feel. In the browser the whole thing
takes about 950 ms and ticks its progress six times.

Each result is a deal that has already cleared both bars, so pressing it should
work: across three leagues the top-ranked deal was accepted every time. Loading
one fills both sides of the builder rather than executing it, so you can look
first — and it is re-checked on the way in, because rosters move between
finding a deal and pressing it.

**It closes a gap with a pick, and that costs no simulation at all.** A pick
does not touch either roster, so `evaluateTrade`'s answer for the player half
is unchanged by adding one: the pick is a flat offset on each side's ledger, in
the same lineup points. The club's bar is `delta >= greed` and the human's is
`delta >= DEAL_FLOOR`, so sweetening is subtraction on numbers the scan already
holds. Re-simulating each variant would have been about 380 extra
`evaluateTrade` calls a club — roughly doubling the per-club cost the chunking
was sized against — for answers that are arithmetic. Measured after: the worst
club still runs 25 to 30 ms, unchanged.

Only one side can ever be rescued, because a pick moves the two ledgers in
opposite directions: if the club is short the human pays, and if the human is
short the club pays. The cheapest pick that works is the one taken, since
spending next year's first to close a two-point gap is not a deal to show
anybody, and a deal needing no pick sorts above one that does at the same
lineup gain — the pick is a real cost the headline number does not show twice.

What it buys, across four second-season leagues: 41 of 90, 2 of 7, 7 of 12 and
6 of 14 deals needed a pick to stand up, and **0 to 3 clubs a league became
reachable that were not reachable at all** without one. Every top-ranked deal
was still accepted when proposed, pick and all.

**One bug the tests caught before the screen did.** `dealStillValid` passed the
two sides' picks to `validateTrade` the wrong way round — the club's picks
belong in `aPicks` because the club is that call's first club, and swapping
them checked each side's ownership against the other. The effect would have
been every pick-carrying deal reporting itself as no longer standing, so the
Load button would have said "that one has moved on" every time.

**One bug it surfaced that had nothing to do with it.** The Moves log treated
any row it did not recognise as a trade and read `league.teams[t.other].isUser`
off it. `cut`, `sign` and `fill` carry no second club, and a pro league makes
cap cuts at kickoff — so opening the tab in one threw. It only showed up here
because a completed trade is what sends you to the log tab, and until the
finder existed no trade ever completed in a test drive. Those three now have
their own lines, stamped with the season rather than week 0, and anything
unrecognised is skipped rather than thrown at.

## Why the interface froze (performance)

A report that pressing a button locked the game for a moment — starting a
league, making a draft pick, accepting a pick trade — and then worked. It was
one defect with one cause, and the cause was a function written earlier in this
file's history with a comment explaining why it was expensive and why that was
acceptable. It was not acceptable.

**Measured, in the browser, throttled to roughly a mid-range Android: arriving
at the player's first draft pick blocked the main thread for 17.8 seconds in a
single task.** Not spread over a second or two of work — one task, during which
nothing scrolls, no tap registers and no button depresses.

`projectPickTrade` values a pick swap by drafting the whole remaining draft
twice, once under each ownership, and comparing the finished rosters. That is
right, and the reason is in its comment: lineup strength weights by position
leverage, so part-built rosters do not compare — a club holding one quarterback
scores 96×18 against 96×3.3 for one holding a receiver. Truncating the horizon
was re-tested here and it is still wrong: padding the empty slots to
replacement level, which is the obvious fix for that trap and does help (the
correlation with the true answer goes from r=0.45 to r=0.75), still leaves a
six-round horizon at r=0.75 for only a 3x saving. The full draft stays.

What was wrong was how many of them ran. `makePickOffers` asked the question for
every other club against three of its picks and three of yours — up to
ninety-nine swaps, each drafted twice — to find the *best* offer, and it ran
inside `draw()` on every one of the player's turns in the first six rounds. All
three symptoms are the same moment: starting a league puts you on the clock in
round one, making a pick brings the next turn, and accepting a trade ends the
turn too.

Four changes, in order of how much they bought:

- **Only ask about a few swaps.** An offer has to clear two bars — the club's
  greed, and not costing the player more than `PICK_OFFER_FAIR_MARGIN` — and
  those are checked by the real projection whichever candidate goes through it,
  so there is no reason to find the *best* one. Candidates are ranked off the
  before-world for nothing and tried until one clears, with `OFFER_BUDGET`
  capping the turn. This is a behaviour change and worth stating plainly: the
  old exhaustive search produced an offer on **97% of the player's turns** at
  two seconds a turn, which is a club ringing you about a pick swap on
  essentially every pick. It is now about 30%.
- **Do the half that never changes once.** Every projection drafts the
  untouched world and the swapped one; the untouched one is identical for every
  candidate and was being rebuilt for each. `pickTradeProjector` holds it, so
  each further question costs one draft instead of two.
- **Stop sorting a thousand players to read one.** `aiChoose` takes
  `ranked[0]` and nothing else, and it is called once per pick — 864 times in a
  32-club draft, and a whole draft is what a projection runs. `rankForTeam`
  gained a `bestOnly` path that scans for the maximum instead of sorting. The
  scoring loop is shared so the random draws happen in the same order, and the
  draft output is byte-identical: same hash before and after.
- **Get it off the render path, one question per task.** The board, the player
  list and every button are drawn from what is already known; the odds and the
  offer fill in afterwards, each candidate in its own task, with the job tied
  to the turn that started it so a turn ending mid-thought cancels it.

17.8 seconds to a worst single block of 0.82. The remaining block is one
simulated draft, which is the floor without making `rollForward` resumable.

**The ranking heuristic, and two wrong numbers published about it.** The
before-world knows which player each pick slot produced, so a club's own board
prices a swap for free. Measured over ninety-eight turns at a budget of four it
finds an offer on 30% of turns against 22% for no ranking at all, and two
plausible alternatives are worse (ordering by the worse of the two sides, 7%;
by the player's side, 14%).

Its correlation with the real projection was published twice and wrong both
times. First as r = 0.84, from candidates pooled on a *fresh* draft where pick
numbers span the whole board — that measured "trading pick 3 for pick 50 is
bad", which is not the question. Then, correcting it, as r = −0.05, which came
from a single narrow slice: three twelve-club leagues against five opponents.
That slice is reproducible and unrepresentative. The same measurement reads
0.66 at six seeds and eleven opponents, 0.71 at thirty-two clubs, 0.73 on the
original slice's league size. **It correlates about 0.7.** It sorts well enough
and prices nothing; the projection decides.

**Everything else on a render path was measured and is fine**: the auction's
price guide 2–5 ms, position scarcity and lot advice under 1 ms, the free-agent
board 2–4 ms, the trade block 3 ms, player search 0.4 ms, the keeper board 3 ms.
A save is 279 KB after a week and stringifies in 2.6 ms, so the debounced write
is not the problem either. Two deliberate actions are genuinely slow and now say
so rather than appearing hung: completing an auction (1.1–1.4 s) and drafting
out the board (0.1–0.2 s) go through `withBusy`, which yields a frame so the
button can change before the thread disappears.

## Transactions (`transactions.js`)

Rosters are exactly 27 slots, so every in-season move is a swap and no separate bench-management screen is needed (the one exception is a slot left open by an older save, which a claim can fill outright). Three kinds of move exist, all from the Moves screen during the regular season.

**Waiver claims.** A claim names the free agent coming in and the player going out at the same position; each club may hold two claims a week. Claims resolve when the week advances, in waiver order: in a fantasy league the order starts as the reverse of the draft order and a successful claim sends that club to the back, in the pro league it is reverse standings every week. AI clubs file their claims at the same moment, so the human never gets first pick of the pool for free. An AI club claims only when the newcomer is at least two overall points better than the man he replaces and the swap adds at least six points of lineup strength; how often a club bothers to look at the wire at all is a per-personality activity rate (Analytics 90%, Old School 30%).

**Trades.** Up to three players a side. The trade deadline is 65% of the way through the schedule (week 10 of 14, week 12 of 17). An AI club judges an offer by one yardstick, *lineup strength*: every player's overall weighted by his position's true leverage from the auction, starters at full weight and bench players at a quarter. It accepts when its own strength rises by at least its greed margin (Analytics 8, Trenches 6, Old School and Defense 5, most others 4, Gambler 2) and tells you roughly how far short an offer fell. The position sets need not match; see **Uneven trades** below.

**A claim voided by a trade is reported, not silently dropped.** `executeTrade` has always voided any pending claim that named a player the deal moved, and it is right to: you cannot release a man you have just dealt away, and you cannot claim one a trading club has just signed. It did it in silence, though. The claim left the claims tab, never reached the wire, and produced no line in the results, so the only way to notice was to remember having filed it — file a claim on Tuesday, make a trade involving that same player on Thursday, and the claim simply stopped existing. Voided claims now go on `league.lapsedClaims` with a reason and surface as failed claims when the wire runs, next to the ones that lost on priority; the screen already knew how to draw a failed claim, so it reads "✘ Andre Reed — Hines Ward was traded before the wire ran".

Worth recording how it was found, because it was not found by looking: it fell out of the smoke test after an unrelated change to run lengths. The smoke test claims a receiver, names the most easily spared receiver as the drop, then proposes a like-for-like trade — which picks the most easily spared receiver, the same man. The bug needed that collision to show, and the collision needed a particular seeded week. A different run of the engine produced it and the assertion that had been passing for the wrong reason started failing for the right one.

**The log.** Every claim and every deal is recorded with week and season, and the Log tab shows all of them, so any lopsided outcome can be traced.

Injuries feed the same yardstick: a player on the ledger counts for the share of the remaining season he will play, so an AI club will not take your hurt star at full value, will not give up a healthy starter for one, and goes to the wire itself when a starter is done for the year. It keeps a hurt player who will be back this season unless the pickup is better anyway, and it never claims a man who cannot play.

**Offers.** The market runs the other way too. When the week advances, AI clubs look at the human's roster for the same surplus-for-need shape and ring — with a matched two-for-two, or, since uneven trades exist, a one-for-one across positions. What they are deep in for what they are thin in. A club calls only when the deal clears its own greed *and* is no worse than two points below even for the human on the same yardstick, because a general manager knows an insulting offer is a wasted call. Offers stand for the week and expire; declining one takes that exact deal off the table for the season, so the phone does not become a nuisance. How often a club bothers is the same per-personality activity rate the wire uses.

Measured over twenty 8-team seasons (`scripts/offer-sim.mjs`): 4.3 offers a season, one in roughly a quarter of weeks, and 40 of 85 of them improved the human's lineup on the yardstick, the rest costing a little. That is the shape the gate is meant to produce: about half the calls are worth taking, so reading one is a decision rather than a formality. The same caveat as every trade applies, and it is the reason the screen quotes the number rather than a verdict: the yardstick is built on overall ratings, so an offer that reads as even may still be bad in the simulation.

Measured on the 8-team auction league (`scripts/moves-sim.mjs`, 12 seasons, injuries off): AI clubs land about three claims a season between them, worth about +7 lineup strength per club, because the pool left after an auction is the talent tail and few swaps clear the +2 overall bar. With injuries at the default setting the same clubs file about seven a season, most of them cover for a starter lost for the year: the wire is an injury market first. On 4,000 random one-for-one offers the AI accepted 25%, and on every accepted deal the human had given up the higher-rated player; the AI gained +13 on average and the human lost 15. That is the intended shape: an AI club cannot be talked into a bad trade on its own yardstick. What it does not rule out is a trade that is even on the overall-based yardstick but not in the simulation — a receiver whose overall is carried by an attribute the play resolution weights lightly. That stood unmeasured for a long time and is measured now; see **Is the yardstick sound** below.

### Is the yardstick sound

Every market in the game — trades, the waiver wire, keepers, the auction advice — prices a player as `overall` weighted by his position's leverage. DESIGN.md carried a caveat about that for a long time: a player whose overall rests on an attribute the play resolution weights lightly would trade even and play worse, and nobody had checked. Checked now, and the answer is that the yardstick is sound.

**How it was measured** (`npm run yardstick` and `npm run yardstick-fit`). Put one man into an otherwise identical synthetic team, play a few hundred games against a fixed opponent, record the points that team scores. Do it across the whole rating range at a position, and correlate production against `overall`.

| position | `overall` vs points produced | rating range | points range |
| --- | --- | --- | --- |
| QB | **r = 0.979** | 58–96 | 13.0 → 30.5 |
| CB | r = 0.926 | 62–96 | 22.9 → 25.8 |
| OL | r = 0.901 | 65–97 | 22.7 → 25.2 |

`overall` explains 96% of the variance at quarterback, and it beats every single attribute taken on its own (awareness 0.970, throw accuracy 0.969, arm 0.864, mobility 0.528) — the blend is doing real work, not riding one number. The lower figures at corner and on the line are mostly the narrow points range: a lineman swings the scoreboard by two and a half points from worst to best, so noise is a bigger share of what is left.

**The caveat is real and it is small.** Among players the yardstick calls *identical* — eight quarterbacks all rated 86, eight receivers all rated 87 — production spreads by **1.81 points a game at quarterback and 0.88 at receiver**, against noise floors of 0.47 and 0.07 measured by replaying the same man with different seeds. So two men the market prices the same are not the same. But that is the residual 4%, not a systematic bias, and it is interaction and shape rather than a mis-weighted attribute.

**Recommendation: do not rebuild it.** Moving `lineupStrength` off `overall` would move every auction price, every trade valuation and every draft order in the game to chase 4% of the variance, and it would put a second "how good is he" number next to the one printed on every player card. The caveat stays documented; the yardstick stays.

### What a free agent is worth (`market.js`)

The free-agent tab had position tabs, an era tab and a search box, and was missing the one number a claim turns on: what this man would add to *your* lineup. Ranked by rating, the top of the pool is misleading in a specific way. Measured on one league (`npm run market`): the five best-rated free agents were a cornerback worth **−9.4** lineup points to that roster, a kicker worth **0**, two quarterbacks worth **−4.5**, and one defensive lineman worth +7.4. The best man actually available was a tight end rated two points lower, worth **+11.6**. Rating order was not just unhelpful, it was upside down.

`faBoard` ranks by `joinValue` — his rating replaces the weakest man in that room and the room is re-valued, in the same lineup points a trade is judged in, so the two screens agree. It names who he would replace. Where nobody helps, which is the honest answer for a whole pool straight after an auction, the screen says so once above the list rather than printing "no help" sixty times.

**Who else wants him.** One claim a week is precious and the wire is contested, so each row carries the number of AI clubs that clear their own claim bar on that man — the same bar `aiFileClaims` applies, copied rather than guessed at. It is deliberately approximate: it leaves out the per-club activity roll that decides whether a GM looks at the wire at all, because a probability of being outbid is not something a screen can usefully print. Measured over 78 club-weeks: **71% of the claims AI clubs actually filed were on men it had flagged**, somebody on the visible page is contested in 23% of weeks, and 8% of rows carry the badge. The board builds in 2 ms.

A note on measuring this, because the first answer was wrong: an early run reported *zero* contested men in twelve leagues, and the conclusion drawn was that the signal was dead and should be cut. The bug was in the measurement — rivals are computed only for the rows on screen, and that run asked for a page of forty while ranking by a different quantity than the clubs use, so the contested men were simply off the end of it. The feature was minutes from being deleted on the strength of a number that was an artefact of how it was sampled.

### What a keeper is worth

The offseason screen showed last year's price and the raised price: the cost side of the decision with no value side. The auction's own guide already knows what the room would pay to buy that player back if he went into it, so `keeperBoard` prints the difference, and the list is ordered by it rather than by position — sorting by position put a kicker you must not keep above a quarterback you must.

It is deliberately *not* the number `aiKeepers` ranks on. That one multiplies the market price by the club's positional taste and by `BIRD_IN_HAND`, the premium a GM pays to skip the auction's risk. Those model a personality; they are not facts about the market, and a human reading a price wants the price.

**What it shows is that keeping is usually wrong.** Across four clubs and 108 priced men: mean saving **−2.9**, only **9%** cost less than the market would charge, and only **2.5 men a club** are worth keeping against a limit of six. The keeper limit has never been the binding constraint — value is, and the raise (the greater of $3 or 15%) is set so that keeping everybody is a mistake. That was always true and the screen never said it: Tom Brady at $29 against a market of $21 looks like an obvious keep until the second number is on the row.

### What losing a lot costs you (the auction room)

The auction was the best-equipped of the three markets before any of this — it already had a price guide, a search, position tabs and an affordability cap — and it still left out the question an auction turns on. Not *what is he worth*; the guide had answered that all along. **What do I get instead if somebody outbids me.**

`lotAdvice` answers it: the best man left at that position, the gap down to him, his asking price, how tight the position is against the rest of the board, and how many clubs could still raise the bid. Three measurements shaped it, and two of them killed features.

**Scarcity by headcount is useless here, and the numbers say so plainly.** The pool is over a thousand all-time greats for a few hundred slots, so every position is deep by count: measured at the opening of a twelve-club auction the ratios run OL 3.7×, DL 3.4×, QB 4.3×, TE 6.0× — between three and six available for every slot needed, at every position. An absolute threshold flags all eleven or none. What is actually scarce is *quality*: the gap from the best man left down to replacement level, which the price guide already works out. That runs OL 12, DL 11, QB 9 … LB 7 at the opening and 7 down to 3 by the midpoint, and the flag is set against the median of the board rather than a fixed line, so it always divides it — 5 of 11 at the opening, 4 of 11 later. Same move as `teamNeeds`: measure against the rest of the league, because a league of all-time greats has no bad rooms in absolute terms and still has worst ones.

**A "real drop" branch was written, measured and deleted.** The advice originally had a case for a big gap to the next man — pay up, he is genuinely scarce. Across three whole auctions, 1,320 snapshots of every position still on the board, the gap from the best man left to the next was **never four points or more**. It was zero on 49% of them and one on another 35%. A branch that cannot fire is worse than no branch: it implies a situation the game never reaches. What the measurement leaves behind is the actual lesson of this auction, which the screen now says out loud — *the man on the block is almost never worth a premium, because somebody a point worse is a few dollars cheaper. What matters is which position you spend on*, which is what the leverage panel has always been trying to tell you.

**Lineup points per dollar was built and thrown away too.** It is the obvious summary — what does this bid buy me — and it is a ratio whose denominator can be one, so it ranks the cheapest man at the most valuable unfilled position above everybody. Sorting the room by it put a 72-overall quarterback at $1 top of the board at 1,295 points to the dollar, ahead of every star in the pool. A number that is only sane in the middle of its range is not a number to put on a screen.

**What the rival count deliberately is not** is a dollar figure. `aiMaxBid` carries a thirteen per cent random factor, and a screen that printed an estimate of what a club would go to would turn every lot into a snipe at their maximum plus one. It counts the clubs that still have a slot for that position and can afford to raise — which is derivable from the board already, and is a convenience rather than a leak.

**One correctness bug fell out.** `joinValue` always replaced the weakest man in a room, which is right for free agency — a claim always costs a release — and wrong everywhere a roster still has empty slots. It scored a perfectly good backup quarterback at **minus fifty-four** by charging the roster for a man it was not losing. It now adds where there is space and replaces where there is not, which is the same partial-roster trap that made a club sliding eight places in the draft read as *gaining* three hundred points.

### Uneven trades

A trade used to require the position sets to match exactly — a receiver for a receiver — which kept every roster valid for free and made the one deal anybody actually wants impossible. If you are deep at receiver and thin at cornerback, and so is the club you are ringing, there is no matched swap that helps either of you.

A deal may now be uneven, up to two unmatched positions a side, and it **carries the moves that square both rosters**: each club signs the best free agent at the position it is left short of, and releases the weakest man in the room it is left crowding. Both are computed by `backfillPlan` and written into the transaction, so the log says what happened rather than leaving a roster changed for reasons nothing names.

**Why this is balanced, and what it rests on.** Free agency is deep, measurably so: the best available free agent sits within nought and six overall points of the *median starter* at every position, and the pool barely drains — 945 free agents to 940 over nine weeks of a twelve-club season, because AI clubs claim only a handful. So the hole is cheap to plug in overall terms. What makes it expensive is leverage: vacating a position costs the overall gap times `TRUE_LEVERAGE`, which `npm run trades` measures at about 0.8 lineup points for a kicker and 70 to 110 for a starting quarterback, depending on the room behind him. The economics are the right shape without anything being added — fungible positions are cheap to trade away, franchise quarterbacks are not — and `partingCost` in `tradeblock.js` is exactly that number, shown in the interface as what each man costs you. `npm run trades` prints all four measurements below; run it after touching `backfillPlan`, `LEVERAGE_PREMIUM`, `aiGreed` or `TRUE_LEVERAGE`, because the feature rests on two things that are measurements rather than assumptions.

Two rules were needed on top:

- **A leverage premium.** A club whose kicker room is bad can make the arithmetic say it should hand over a starting receiver for a good kicker: a large gain at a position worth 0.79 against a small loss at one worth 3.30. The lineup model is right and a general manager still knows better. `LEVERAGE_PREMIUM` charges 1.6 points per point of leverage shipped out net, so an even swap costs nothing and a receiver-for-kicker enquiry is refused out of hand.
- **No buying a man to cut him.** If the weakest player in the crowded room turns out to be the one arriving, the deal spends a player on nothing. It is refused rather than executed, which also catches the mis-click.

The AI evaluates the roster it would *field* — hole filled, spare released — not the roster with a hole in it. Judging the hole would make every uneven deal read as a loss and no club would ever take one; without a pool to hand, `evaluateTrade` says so explicitly rather than pretending.

**Measured.** Against 1,343 lowball uneven one-for-ones — the user shipping whatever it can replace most cheaply for the best thing on any block — 1.1% were accepted and the user's total gain across sixteen leagues was 66 lineup points, under one greed threshold per league. Against the honest use, a user trying to fill its single biggest need, 73% of forty leagues succeeded, at a mean of 1.83 players given and a mean gain of 8.5; **every one of those twenty-nine successes was an uneven deal**, because a matched swap could not reach the need at all. That is the case the feature exists for. The range runs from −9.9 to +61.2, which is why the screen quotes your own lineup change before you propose rather than after. Across twelve full twelve-club seasons: 2.9 AI trades a season, 46% of them uneven, 11 offers a season to the human, and every roster legal at every week.

### Finding a trade (`tradeblock.js`)

The trade screen opened on a club dropdown and two lists of twenty-seven. Finding out whether anybody would part with a cornerback meant picking a club, reading its roster, picking the next one — 864 rows in a thirty-two club league, with no way to sort them. Two pure functions replace that, both derived from the league with no random numbers so a redraw never moves an answer under the cursor:

- **The block.** `tradeBlock` ranks every AI club's players by `partingCost` and shops the ones it can replace cheaply, skipping any position the club is itself short at. In practice that surfaces fourth receivers, second quarterbacks, kickers and punters, and never a starting quarterback — asserted, not assumed. `openBlock` flattens it into one league-wide list sorted cheapest first.
- **The search.** `findPlayers` filters every rostered player in the league by name, club, position and a rating floor, best first, so "who is the best cornerback anybody has" is one query rather than a tour.

`teamNeeds` measures where a club is thin against the league median rather than an absolute, because a league of all-time greats has no bad rooms in absolute terms and still has worst ones. Each block row carries the holder's top need, so one line tells you both what is available and what they would take: *Tyreek Hill · LOB WR3 · block 2.5 · wants OL*. Targeting a row switches the club you are dealing with, since a deal is with one club.

## Injuries and depth (`injuries.js`)

Every play rolls once for an injury somewhere on the field. The victim is drawn from the players the play involved (carrier, target, tackler, the quarterback when pressured, a lineman on either side, the returner and a cover man on kicks), weighted by exposure and by position fragility: backs are the most fragile, specialists barely register. Severity is a five-band roll: 55% leave the game and are fine next week, 25% miss one or two weeks, 12% three to five, 6% six to nine, 2% are done for the season, each band with its own diagnoses for the log.

A hurt player leaves on the spot. He comes off the game's depth chart, the unit composites are rebuilt around whoever is left (with the home edge re-applied), and any position group left short is padded with a replacement-level fill-in: a street free agent rated just under the worst player in the pool (QB 48, most positions 52 to 54, kickers 58), so nobody on the wire is ever worse than the fill-in. That keeps the incentive pointing at the waiver wire.

Between games the league keeps a ledger keyed by player: weeks out, diagnosis, when it happened. `buildLineup` skips anyone on it, so the next man at the position starts (the depth chart marks him "starts"), the week advance ticks it down, and a new season clears it. The ledger travels with the player: a hurt free agent stays hurt if you claim him.

**Injured reserve.** A long injury used to be a dead roster slot: the man could not play and could not be replaced without cutting him. A player out four weeks or more can now be moved to injured reserve, two places a club. His slot opens, so the wire can cover him; he keeps healing and keeps his contract, and he is still owned, so nobody can claim him. He cannot play or be traded until he is activated, and activating him costs a roster spot at his position in turn, which is the whole decision: park him and sign cover, and you may not have room when he is fit. Anyone fit again slides into an open slot when the playoffs start; the offseason empties injured reserve, and a player whose slot was filled behind him is let go into the pool. AI clubs park anyone out long enough, sign over the gap, and activate a fit player when he beats the worst man at his position.

This is the one place the roster invariant gives: a club owns its filled slots plus up to two on injured reserve, and a starting slot may be empty only because somebody is on it. `rostersValid` checks exactly that.

Measured over twelve 8-team seasons per setting (`scripts/ir-sim.mjs`):

| injuries | placements a season | activations | club-weeks with somebody on IR | let go at the offseason |
|---|---|---|---|---|
| low | 4.8 | 1.4 | 21% | 3.0 |
| normal | 8.3 | 2.8 | 31% | 5.3 |
| high | 14.0 | 5.8 | 49% | 7.3 |

At the default setting that is about one placement per club per season and a third of club-weeks with somebody parked, which is the rate the four-week minimum was chosen to produce. The players let go are not lost to the league; they return to the pool and are bought again in the offseason auction.

The dial is a league setting: Off, Low, Normal (default), High, as a multiplier of 0, 0.5, 1 and 2 on the base per-play chance. Measured with `scripts/injury-sim.mjs`:

| setting | injuries per game (both clubs) | player-weeks lost per club per game | players out per club-week (8-team league) | QB1 missing |
|---|---|---|---|---|
| low | 0.65 | 0.5 | 0.3 | 4% of weeks |
| normal | 1.2 | 1.0 | 0.7 | 6% of weeks |
| high | 2.5 | 2.1 | 1.2 | 10% of weeks |

The real league runs at roughly three to four times "normal" by adjusted games lost, so even High is a gentle version. That is deliberate: a 13-game season is short enough that injury luck at real rates would decide more leagues than the auction does. What a missing quarterback costs, on one auction roster against every opponent in the league with no other injuries: 50% with the starter, 44% with the backup the auction bought for him, 4% with a replacement-level fill-in. The backup is worth roughly six points of win probability per week he plays, which is what the QB2 slot is for and why the auction AI pays about a third of starter money for one.

Established: the rates and the effects above. Speculation: how the dial should sit for the pro league, where 17 games and 64 quarterbacks drafted out of 103 make backups much weaker; the same setting will bite harder there, and nothing yet re-measures it.

## Dynasty loop (`offseason.js`)

A season ends at the final; the offseason starts from the hub. Every rostered player carries a contract from the moment a season starts: the price he went for at auction (or the round he was drafted in), how many seasons running he has been kept, and when it started. A player claimed off the wire is on a $1 deal. Contracts are keyed by player, so a trade moves the deal with the man.

**Keepers.** Each club keeps up to `settings.keepers` players (6 in a fantasy league, 18 in the pro league, changeable at setup or in settings, 0 for a full re-auction every year). An auction keeper costs last year's price plus the greater of $3 or 15%, compounding each year; a player can be kept three seasons running and then must return to the pool. Keepers plus a dollar for every open slot must fit under the $200 cap. In a draft league keepers simply hold their slots. Everyone not kept returns to the pool with the players nobody rostered.

**The market.** The auction reopens with each club's leftover cap and the worst club nominating first; the price guide re-prices the thinner pool and the smaller pot on its own. A draft league drafts worst to first, and the pointer skips clubs whose rosters are already full, so a club that kept 18 sits out the last nine rounds. Whether the order turns round on itself each round depends on what is being drafted — see the two-pools section. Either way the existing auction and draft screens run the market, and the season starts from their finish button. The hub's history card keeps every season's champion and your own finish.

**AI keepers.** A club ranks its eligible players by surplus: what the fresh price guide says the player would fetch (true value for a savvy GM, reputation for the rest, through the GM's positional taste) times a bird-in-hand premium of 15%, minus the keeper cost. It keeps the best bargains that fit under the cap. The premium is there because an auction is a risk and a known price is not; without it a club kept fewer than two players a year, because a fair-price buy plus a raise is by definition slightly over market.

Measured across six 8-team auction leagues run four seasons each (`scripts/dynasty-sim.mjs`, AI keepers for the human too): clubs keep 5.0 of 6 on average, committing about $47 of $200, and the players they keep average 90 overall, which is to say keepers are the stars bought under market. About a third of a roster carries over season to season once re-buys are counted, so a league has continuity without freezing. With the $5 minimum raise that most keeper leagues use, the same clubs kept 2.4, because a 27-man roster is mostly $1 to $4 players and a $5 bump prices every one of them out; the lower floor is what makes late bargains worth keeping.

**Rookies and ageing.** Each offseason opens with a generated intake and a year on every career (both below), so the pool a league plays with grows and changes rather than only churning. That is also what makes a keeper's third year a different player from his first.

Simplifications, all deliberate: no separate rookie draft (the intake enters the same market as everyone else), no pick cost for draft-league keepers, and no contract lengths beyond the keep count. Speculation: whether the 15% raise is steep enough to stop a club sitting on a $10 quarterback for three years. It is not measured; the three-year limit is the backstop, and ageing now does some of the work the raise was doing alone.

## Generated rookie classes (`rookies.js`, `data/rookie-names.js`)

Every offseason a new intake enters the pool: invented names, ratings spread the way a draft class is spread, and a wash-out rule so a long dynasty does not drown in players nobody wants.

**Where they live.** On the league, in `league.rookies`, not in the shipped player file. Two leagues never see each other's players, and `src/data/players.js` keeps the fingerprint that league codes and season cards check, so a rookie class does not stop a code opening. `leaguePool(league, players)` and `leagueIndex(league, byId)` build the pool in play; both are idempotent (they strip generated entries from the base first), so calling them on an already-merged pool is safe. `main.js` holds the merged pool behind a getter keyed on the `league.rookies` array identity, so opening a different slot swaps the pool without anyone asking it to. `addRookieClass` replaces that array rather than pushing to it, which is what makes the identity check work.

**Size and names.** Three and a half per club, at least sixteen: 28 in an eight-club league, 42 in a twelve. A pro league takes 5.5 a club — 176 — because there the class is the only supply the league has; see the two-pools section. Positions come out in roster proportions, so every group gets somebody. Names are drawn from 440 first names and 780 last names, 343,200 combinations, and a name already in the league is re-rolled up to eight times. The lists are append-only for the same reason the fictional-name lists are: reordering them renames players in saved leagues.

**How good they are.** A single power law cannot give a class both a replacement-level body and a few genuine prospects — it either drowns the league in stars or leaves nobody worth a bid. So a rookie's target is `normal(62, 6.5)` plus, 7% of the time, `|normal(16, 7)|` on top, clamped to 40–99. Measured over 200,000 rolls: median 63, 17.3% at 70 or better, 3.3% at 80 or better, 0.8% at 90 or better, 3.5% at 50 or worse. Each attribute then scatters `normal(0, 6)` around that target, so classes contain lopsided players — a fast receiver who drops the ball, a mauler who cannot pass protect — rather than smooth ones.

**What that means in practice, and it depends on league size.** A club rosters 27, so eight clubs need 216 of 1,269 shipped players and the last man in is an 88 overall; twelve clubs need 324 and the cutoff is 86; the pro league's 32 clubs need 864 and the cutoff is 75. A 63-median class is therefore mostly irrelevant in a small fantasy league and genuinely useful in the pro league, where a 78 rookie beats what is left on the wire. That is the honest behaviour and it is what the tests assert: signed rookies average eight or more overall above their class mean, rather than every class producing a starter. Inflating the ratings to make small leagues care would break the pro league, which is the mode the intake exists for.

**Washing out.** A generated player nobody has rostered, from a class older than three seasons, leaves the league; a rostered one stays however old his class is. Without this the free-agent list in a twenty-season pro dynasty carries a couple of thousand names nobody will ever sign. Ids are `rk-<seed36>-<season>-<index>`, derived from the league seed, so the same league regenerated from the same seed produces the same class.

**In the interface.** Generated players carry a `rookie` badge and read "class of 2029" in lists and modals, and the players screen computes its era tabs from the pool in play rather than the shipped constant, so new classes get their own decade tab. Season cards and league codes both filter generated players out of the pool fingerprint; a league code rebuilds `league.rookies` from the snapshot and maps rosters through it, so a shared league arrives with its rookies intact.

A pro league now *does* run a separate rookie draft, and the fantasy league still does not: there a generated rookie goes into the same market as everybody else, which is what an all-time league is for. See the two-pools section. Aging and development are built and are the subject of the next section; this paragraph claimed the opposite for as long as it took somebody to read the two in sequence.

## Player careers (`careers.js`)

A dynasty where nobody changes has no arc. Before this, season six played exactly like season one with a different roster: the only thing that moved between years was which names the keeper rules forced back into the pool.

**Only rostered players age, and that is the whole design.** The shipped pool is one prime-season snapshot per player and carries no age at all, so ageing everyone would break the promise the draft screen makes — every era, at its best. A career starts the moment a club signs a man; until then he sits in the pool frozen at his prime. The auction is therefore the same puzzle it always was, and what changed is everything after it. Nothing runs during a season: careers advance once, in the offseason, before keepers are chosen, so you pick knowing who got better and who did not.

**Ages.** A real player enters within two years of his position's prime (backs at 25 and corners at 26, quarterbacks at 29, specialists at 31), because the pool is his prime season. Generated rookies enter at 22. Age, growth and the season a man retires are all derived from the league seed and his id, so he enters the same league at the same age with the same ceiling however late he is finally signed — and two leagues get different careers for the same player.

**The curves.** Attributes age in three groups: physical (speed, elusiveness, power, pass rush, arm strength) turns over a year before the prime, skill (hands, routes, blocking, coverage, tackling) a year after, and mental (awareness, throwing accuracy) six years after. Legs first, hands next, the head last. Each is a yearly gain that ramps in over the four seasons before the turn, then a loss that accelerates. A hidden growth multiplier, median 1 with a 9% chance of a breakout and a 10% chance of never arriving, scales the gains.

**The ceiling.** Growth carries a player toward a ceiling and stops. Without one the two rolls compound — the rookie generator's prospect bump lands a class-leading entry rating, a high growth draw adds twenty more, and a twenty-season pro dynasty manufactures a dozen fictional 98s, swamping the top of the real pool, which is the thing the game is about. Room also shrinks as the entry rating rises. A season that would cross the ceiling has its gains scaled back to land on it.

**Measured** (`scripts/career-sim.mjs`, the pool's top 200 and 600 generated rookies, run through the engine's own step function so the harness cannot drift):

| | |
|---|---|
| Signed at his prime, after 1 / 3 / 5 / 10 seasons | +0.0 / −1.3 / −3.4 / −10.0 overall |
| Career length | median 10 seasons, range 5–14 |
| Rookie entry → peak, median | 63 → 72 |
| Rookie peak, 90th / 99th percentile | 83 / 91, best in 600 was 96 |
| Class that peaks at 80+ / 88+ | 19.8% / 3.2% |
| Class that never gains 5 | 27.7% |

A keeper run is three seasons, which costs about 1.3 overall — noticeable when you are paying a raise for it, and not a cliff. The rookie numbers are the ones that matter most, because they fix the honest limitation the intake shipped with: an eight-club league's worst starter is an 88, so a class whose median peaks at 72 still mostly does not matter, but 3.2% peaking at 88 or better means roughly one genuine prospect per class instead of none. In the pro league, where the cutoff is 75, a fifth of every class becomes a starter somewhere.

**Retirement.** A player retires nine seasons past his prime, give or take a few, or whenever he drops below 52 overall. He is flagged rather than deleted: league codes and season cards tell player pools apart by counting ids, so dropping a retired man would move that fingerprint and a league would stop being able to open its own code. Signing him is blocked at the three places that offer players — free agency, the auction and the draft — and he stays visible in the pool, which is where a retired great belongs. Retiring frees his roster slot and drops his contract, and the offseason market fills the hole.

**Plumbing.** State lives on `league.dev`, not `league.careers`, because awards.js got there first and uses that name for the statistics a hall-of-fame case is built from. `applyCareers`/`careerIndex` build the league's view of the pool and are idempotent; a developed player carries the base he was built from and his own `ovr`, because the overall cache is keyed by id and two open leagues can hold the same man at different ages. Anything rating a set of attributes not attached to a fixed id goes through `rawOverall`, which does not cache — getting that wrong silently froze the ceiling logic at its pre-scaling value, which is a bug worth remembering.

**Both settings default on for a new league and stay off for an old one.** An absent setting is not a false one: it means the save was written before the feature existed. Turning chemistry on mid-season moves every club by up to two points at once, measured, which is changing the rules under somebody halfway through a season. So a league from before this keeps playing exactly as it did, and the settings screen says so and offers the switch.

Not built: injuries that shorten a career, positional decline that forces a move, or any scouting fog over a rookie's growth curve. The curve is hidden but its effects are immediate and exact, so a patient manager can read a breakout after one season.

## Difficulty (`difficulty.js`)

There was no difficulty setting at all: every league ran the same fixed spread of general managers, so a manager who had learned where value hides beat the room every year with no dial to turn.

**What a level changes, and what it deliberately does not.** It moves how well the computer clubs compete with you *for players*: how much of a bid follows real win impact rather than reputation, how far above its own valuation a club will go, how accurately it reads a prospect nobody has seen play, how hard it is to fleece in a trade, and how much rope an owner gives you. It never touches the simulation. No level hands a club a rating bonus or a thumb on the scale in a game — that kind of difficulty makes the score stop meaning what it says, breaks the calibration every other constant was tuned against, and teaches nothing transferable. A test asserts it. On Brutal the other clubs are not luckier than you; they are better at buying players than you are.

**Savvy alone is not difficulty, and the measurement caught it.** The first version scaled only how accurately clubs valued players. Run through the strategy simulation, the setting meant to be hard made the game *easier* for a value shopper — 9.1 wins against 8.5 at standard. The reason is plain in hindsight: a club that values a player correctly and bids exactly that loses every contested lot to somebody bidding fifteen per cent over. Accuracy decides which players the computer clubs chase. Aggression decides whether you can outbid them for it, so `bid` was added as a second lever.

Measured over twenty 8-club leagues per level, the human following each fixed strategy:

| | Relaxed | Standard | Sharp | Brutal |
|---|---|---|---|---|
| Value shopper, wins of 14 | 8.9 | 8.5 | 8.3 | 7.7 |
| Value shopper, point differential | +52 | +43 | +43 | +5 |
| Stars and scrubs, wins | 7.8 | 7.7 | 7.0 | 6.4 |
| Market follower, wins | 6.2 | 4.4 | 4.0 | 4.5 |

The honest reading: the dial moves a skilled manager by about 1.2 wins across its whole range, and moves dominance much more — point differential collapses from +52 to +5. Difficulty is deliberately a smaller effect than how you bid, which is worth about four wins. It is a headwind, not a handicap.

Savvy is capped at 0.95 rather than 1. A room where every club values every player perfectly has no bargains in it, and an auction with no bargains hands every club the same quality of roster — the parity problem the mispricing exists to avoid. Brutal should be hard, not pointless.

A league written before this reads as standard, and `standard` is defined as every multiplier at exactly 1, so it is not a tuning in disguise.

## The weekly pulse (`pulse.js`)

The hub had standings, a playoff picture and a transaction log, and no answer to the only question a manager asks on a Monday: what happened? Thirty-one other clubs played and none of it was narrated, so a season read as a table that changed rather than a thing that happened.

It reports upsets against the power table, blowouts, shutouts, overtime, long-term injuries, win and loss runs, trades and notable waiver claims — five lines on the season hub, most interesting first, with one of each kind before a second of any kind so a week of five blowouts still reads as a week.

Everything is read back out of records the season already keeps: the schedule's results, each game's injury list, the transaction log. Nothing new is stored, so an old save produces a pulse for its own past weeks. There is no randomness in it, because a shared league and a season card have to agree about what happened.

**One real limit shapes what it can say.** Per-game box scores are stored only for the human's games and the playoffs; an AI regular-season game keeps its team totals and drops the individual lines. Season totals still accumulate for every player on every club, so nobody is missing from the leaders or the record book — but a pulse is told game by game, so a computer club's week is told through team numbers and the players named are the ones the injury ledger and the transaction log know about. Lifting that would mean storing player lines for every AI game, at 14.9 KB each, which would put a save past what a browser will store at all — see the storage note under Simulation.

Your own club is weighted up but capped in practice: measured over eight weeks, under 60% of lines are about you.

## Coaching jobs (`jobs.js`)

There was no failure state. You could finish last for twenty seasons and nothing happened, which meant no decision ever really cost anything. An owner fixes that — but a hard game-over is the wrong shape for a dynasty, so being sacked moves you rather than ending you.

**That only works as a stake because careers and chemistry already exist.** Losing your job costs the squad you spent five seasons building, the keepers you were compounding, and the continuity your chemistry was made of, and hands you somebody else's mess with somebody else's contracts on the books. Without those systems, changing club would be a reroll; with them it is a real price.

**Pro mode only.** An eight-club league has no job market worth the name.

**The bar is set against the roster, not the table.** Power rank decides what an owner wants: the top quarter must win a playoff round, the second quarter reach the playoffs, the third finish above .500, and the bottom show progress on last year. A club with the worst roster in the league being told to make the playoffs is not an expectation, it is a pretext — and a coach who builds a great squad should be expected to win with it. The bar moves as the roster does, so it follows the job rather than the man. Measured across three 32-club leagues over eight seasons each, the bands come out at 41%, 51%, 45% and 45% met — close to a coin flip, and slightly the wrong side of it, which is what a job you can lose should feel like.

**Heat and reputation are separate on purpose.** Heat is what gets you sacked and resets when you move; reputation is what gets you hired and follows you. A good coach at a bad club can lose his job and still be wanted, which is the whole reason the carousel is interesting. Owners have a fixed temperament (three to six seasons of patience), set at league creation and never changed, so a club known for firing people keeps being one and you can learn that about the league.

**Rival coaches are the supply, not decoration.** If the computer clubs never changed coach there would be no vacancies, nobody would ever call you, and being sacked would be a dead end after all. Every club's coach is under the same pressure, sacked on the same rule, and when one goes his job is on the market. His GM personality travels with him, so a club that changes coach changes how it drafts and how it plays.

Measured: about 3 of 32 clubs change coach per season, roughly 10%. The real league runs at 20–25%, and this is deliberately gentler — chemistry saturates at three seasons of continuity, so a carousel spinning that fast would mean nobody ever saw the system pay off. Over five 15-season careers played passively, the human was sacked between one and three times and worked two to four clubs.

**Two rules stop the market being nonsense.** A club that has offered you the job keeps it open until you answer, or the carousel hires over your own offer before you can take it. And the club that just sacked you is never on your list — no owner fires a man in February and rehires him in March, and being handed your own job back would make the sacking meaningless.

That second rule creates a hole: if you were the only coach sacked that year, the only vacancy is the one you cannot have. Rather than end a career on the luck of being the only sacking, a coach the league still rates gets a club to make room for him — an employed coach rated ten points below you is moved on, which is a thing clubs do. It is the only path by which `acceptOffer` displaces a sitting coach, and it refuses if the incumbent is rated anywhere near you.

**The floor is where the career actually ends.** Below 18 reputation, nobody calls and that is that; the league, its records and its hall of fame stay readable, but there is no playing on. Reputation sits at a median near 47 across experienced coaches, so this is a tail risk rather than a treadmill: none of five 15-season careers reached it, though one finished at 20.

**Nothing is hidden.** The season hub shows what the owner wants, what the squad is ranked, and how warm the seat is in words rather than a number you cannot see. A hidden meter is a trap, not pressure. The career screen carries your record, the clubs you have worked, the carousel log and every rival coach with his reputation and his own seat.

Plumbing: `jobs.js` deliberately does not import `season.js`, because `startSeason` has to stand the carousel up; `isPro`, `userTeamIndex` and a power ranking are small enough to keep locally rather than build a cycle for. Moving the human between clubs needed no other changes at all — all 68 references to the user's team derive from one `userTeamIndex` lookup, and the history entry already snapshots each season's club name and colours, so a multi-club career reads correctly in the hub.

Not built: assistant coaches, contracts or compensation for a coach, interviews, or any say in which club poaches you. Speculation: whether 10% turnover is the right number. It is chosen against chemistry's three-season payoff rather than against the real league, and it has not been tested for how it feels over a long save.

## Scouting (`scouting.js`)

Everything in this game was arithmetic. Every rating of all 1,500 players was exact and permanent, so once you had internalised the leverage table you won auctions forever and the economy stopped being a puzzle. Real general-manager games run on fog.

**Real players are never fogged, and that is not a compromise.** They are the content. Somebody playing all-time fantasy football wants to know they are bidding on Jerry Rice at 97; hiding it turns the marquee feature into a guessing game rather than a decision. The fog goes on generated rookies, who nobody has seen play, and lifts the moment they have.

**The width of the band is the information.** A range that is merely a noisier number changes nothing — you would still take the highest midpoint. So the band runs from what a rookie is today to what his career could reach, which careers.js already derives deterministically from the league seed and his id before he is ever signed. A safe prospect reads 70–76 and a boom-or-bust reads 58–86, and choosing between them at the same price is the decision this exists to create. A bust's ceiling is barely above his floor, so his band comes out narrow and low with no extra machinery. Measured over 400 rookies: widths run 5 to 39, median 14.

The low end leans conservative on purpose and the high end does not. A first pass used symmetric error on both, and the band failed to contain the player's current rating 43% of the time, which makes the low end meaningless. Biasing it down fixes that (100% now) and puts the genuine uncertainty where it belongs: how far up his own band he climbs. The band contains his true ceiling 64% of the time. No band is ever narrower than five points, because a range that collapses to a single number claims a precision nobody has.

**Everyone scouts, not just the human.** Fog on one side only is a handicap, not a mechanic. Each club reads the same rookie through its own seeded error, scaled by the GM's savvy — the same table that decides who chases value and who chases names. Measured against a perfect scout, error runs monotonically with savvy: Air Raid at 0.10 accuracy misses by 2.27 points, Analytics at 0.70 by 0.75, the human by 1.47. You can win a player because you rated him higher than the room, and be wrong.

**The asking price comes from the room, not from the truth.** This is the leak that would have made the whole thing theatre: the auction's price guide is built from ratings, so a rookie's price would let anyone read his real number straight off the board. Unscouted rookies are therefore priced on `marketView` — the consensus, computed directly rather than by averaging every club's read, since the observational errors are mean-zero and cancel. It sits above a rookie's current rating by the upside the room pays for, so chasing a prospect is a risk rather than a free option. List ordering had the same leak, and for the same reason the player pool, the free-agent list and the draft board all rank by what the observer believes rather than by what is true: a place in a table is a number.

**Attributes coarsen rather than disappear.** A scout can tell you the shape of a player — fast, hands of stone — without giving you the number, and the rookie generator makes lopsided players on purpose, so hiding the shape would throw away the most interesting part. Unscouted rookies show attributes rounded to the nearest five with a `~`.

**A rookie is known once he has been on a roster through a completed season**, marked by his career entry in `league.dev`. Statistics count too, and they count for every club, since season totals accumulate for every player in every game. That is a correction: this document and the code both used to say the opposite, that a rookie could start three years for a computer club with no games to his name, measured at 50 rookies on rosters and not one with a recorded game. The measurement was real and the reading of it was wrong — the zeroes came from `closeSeasonBooks` writing through a stale module-level player index that held no generated players, so rookies were dropped from the books in silence. `bookIndex()` in `season.js` rebuilds that index from the league itself and the same dynasty now shows about half its rookies with a career record after one season, the rest being the ones who did not play. The career entry stays the primary marker because it is the honest test of "has been somewhere for a season": a rookie who sat all year has still been watched in practice for twelve months.

**The payoff is an annual report card.** Last year's class, one season on, with what you projected against where they actually are. Fog is only worth having if you find out afterwards whether you were right. The verdict is about the first year's movement rather than arrival, because the top of a band is a career ceiling four to six seasons away and judging a rookie against it after one year would make almost everyone read as a bust.

Not built: a scouting budget, staff to hire, or fog over anything a club already owns. The error is free and automatic, so scouting is a risk to weigh rather than a resource to spend. Speculation: whether error of one to two rating points is enough to make auctions feel uncertain. The larger uncertainty is inherent — the band says 60–85 and he may finish at 65 — and that is the part intended to carry the drama.

## Team chemistry (`chemistry.js`)

Chemistry in sports games is usually an invisible multiplier that either does nothing you can feel or quietly decides your season. This one is a number on the team screen with both its inputs shown, and it is worth at most 1.8 rating points, which is under two home-field edges.

**Continuity** is the ordinary half: starters who were here last year, and the year before, saturating at three seasons. It is counted in seasons on the roster, not in contract age — a fantasy club re-buys most of its roster at auction every year, so contract age says almost nothing about whether the same eleven men have been playing together. `league.tenure`, maintained by `syncTenure` at the start of each season, counts the man rather than the paperwork.

**Era cohesion** is particular to this game. A squad drawn from 1948 to 2024 is the whole fantasy, and it is also eleven men who have never played the same football. The standard deviation of the starters' seasons runs near 4 for a single-decade squad and past 25 for an all-time scatter. It is a first-season tax rather than a permanent penalty: the era term decays as continuity rises, so a scattered all-time team is rough in year one and fine by year three.

**It is scored against the league, not against 100.** The absolute number is not the thing: every club is unsettled in season one and most are settled by season four, and an effect everybody gets at once is no effect at all. Measured across three eight-club and three 32-club dynasties, the raw score climbs from a mean of 17 to 27 in a fantasy league and from 20 to 69 in the pro league — the same mechanic, two completely different scales, because a fantasy league re-auctions most of its rosters and the pro league keeps eighteen. Centring on the league mean cancels that artifact: both modes then hand their best club a 1.1 to 1.8 point edge over their worst, consistently, in every season. The team screen shows the raw score, which is stable and legible, and the bonus, which is relative.

**It is a real choice.** An era-themed squad built only from the 2010s scored 45 against best-available's 15 in season one with zero continuity on either side — a 1.9-point swing, bought by giving up the better players at several positions. That is the trade the mechanic exists to offer.

**Where it lands.** Chemistry rides the same composite keys as the home-field edge (blocking, rush, run stop, coverage, tackling) and is carried on the composite as `chem` for four quarterback reads: two-point conversions, sack avoidance, completion probability and interceptions. It never touches speed or arm strength, because knowing each other does not make anyone faster. `gameOptions` computes both sides once per league-and-tenure and caches it, since it is a league-wide calculation every game in a week asks for.

Speculation, not measured: whether 1.8 points is the right ceiling. It is calibrated against the home-field edge of 1.1, which is worth about two points of margin, so the widest realistic chemistry gap is roughly three points of margin — about half a win over a season. That felt like the right size for something you can see and plan around but never buy outright; it has not been tested against how it feels to play.

## Simulating ahead (`autosim.js`)

Four buttons on the season hub: to the halfway point, to the playoffs, through the playoffs, into next season. Each one runs the ordinary weekly machinery in a loop — `simulateWeekAi` then `advanceWeekWithMoves` — so the waiver wire, AI trades, injuries, strategy drift and clinch markers all still happen; the only thing removed is the clicking. A guard of 200 weeks stops a malformed league spinning.

`targetAvailable` hides a target that is behind you or not yet reachable (nothing runs during a draft or auction), so the card only ever offers moves that go forward.

"Into next season" is the one that decides things for you, and it says so before it runs and again afterwards. It finishes the season, opens the offseason, picks your keepers on the same surplus rule the AI clubs use, and runs the market to completion. Those are the two biggest decisions in the dynasty loop, so the button asks first and `describeRun` reports what was decided rather than only where it got to. The subtle part: a rookie class arrives with the offseason, so the run rebuilds its pool and index from `leaguePool`/`leagueIndex` after `enterOffseason` and before the market — without that the keeper and auction logic worked from a stale pool and no rookie was ever signed, which is exactly the bug the dynasty test caught.

## Live game presentation (`winprob.js`, `ui/charts.js`)

Every step of a game leaves a win probability on the event it produced, computed once the state has settled (possession changes included), so a saved log carries the whole curve. The model is a normal one fitted to this simulation rather than the real league: the final margin is the current margin, plus what the possession in hand is worth (expected points from field position, down and distance), plus what the stronger roster and the home crowd still expect to add over the time left, with a spread that shrinks with the clock. Fitted on synthetic games with penalties on: final margins spread about 12.5 points between equal rosters, a point of team power is worth about 3.3 points of margin (measured by moving a synthetic roster's mean rating, and confirmed at 3.25 by regressing differential on power across six drafted leagues), and the home edge is about two points. The prior is only as good as `teamPower`, which is why that was reweighted — see below. A calibration test bins predictions and checks the home side really won about that often in each bin.

The live screen shows the current probability in the scoreboard and a filled band over the game with quarter markers, the home side's colour above the 50% line and the away side's below; a drive chart (one row per drive on a 100-yard field, scoring drives in full colour) folds out beneath it. When the game ends a story card gives the result, the three plays that moved the probability most, each side's stars from the box score, and the injuries. Box scores of games that kept their log (your games) show the same charts and story. Charts are inline SVG scaled to the card, so they are as legible on a phone as on a desktop. Not built: a highlight reel; the drive chart is the highlight reel.

### The play on the field strip

The strip above the controls used to show only where the ball was sitting, so the one thing a play produces — the yards — was readable nowhere but in the text. It now draws the play itself as a bar from the snap to where the ball ended, coloured by outcome rather than by club: white for a gain, red for a loss or a turnover, gold for a score, yellow for a flag, and a hollow dashed box for a kick. Outcome, not club, because a green team on a green field is invisible and several of them are green; the drive band underneath still carries the colour, so identity is not lost.

Two engine fields make it possible, added to every scrimmage play and every penalty. `from` is the line of scrimmage and `snapOff` is the club that snapped it, because neither is recoverable from the rest of the log entry: `logEvent` snapshots `ballOn` and `possession` at the moment of the call, and that moment is post-play on an ordinary snap, pre-flip on a turnover, and post-enforcement when a flag is tacked on. A third field, `to`, rides only on punts and field goals, whose `yards` is 0 — nothing was gained from scrimmage, and the flight lives in `puntTo` or in the kick. The three cost 2.9 KB per game, 6.9% of an in-season log, and only the entries `thinLog` keeps carry it into a stored season.

Two things about the plumbing are worth knowing, because both were wrong first. The bar reads the last entry in the log that carries `from`, not `g.lastEvent`: a play that changes hands calls `changePossession` inside the same step, and that logs the new drive's header on top of it, so punts, interceptions, fumbles, missed field goals and turnovers on downs all had their bar overwritten before it could draw. And the phase is no authority either — a touchdown flips to `pat` and a made field goal to `kickoff` the moment they score, so gating on `phase === 'play'` hid the bar for exactly the plays most worth seeing. Nothing but a snap logs `from`, so the bar clears itself at the next kickoff or quarter break. A test pins all of it: every scrimmage type carries the fields, nothing else claims them, the drawn span stays on the field, and on a clean snap `from + yards` still equals the entry's own `ballOn`.

### The running back was underpriced, and what it took to fix it

`TRUE_LEVERAGE` was re-measured at the same 10,000 games a reading the last
audit used. Ten of the eleven positions came back where they were. One did not.

| per-starter margin | QB | **RB** | TE | CB | WR | S | LB | DL | OL | P | K |
|---|---|---|---|---|---|---|---|---|---|---|---|
| last audit | 6.17 | **2.06** | 1.98 | 1.61 | 1.13 | 1.01 | 1.00 | 0.85 | 0.72 | 0.52 | 0.27 |
| now | 5.87 | **3.47** | 2.06 | 1.62 | 1.09 | 1.06 | 1.02 | 0.91 | 0.80 | 0.74 | 0.46 |

The running back's real value rose 68% since the table was last set, which the
table never heard about. Tested against the shipped numbers on the same scale,
only three differences clear three standard errors: RB at +10.4, QB at −6.5 and
WR at −3.3. The two specialists look like they moved by half again but sit at
1.4 and 1.5 SE on readings whose error bar is a quarter of the reading, so they
have not moved at all.

It is not from the run-game work in this run of changes. Measured on the engine
as it stood before any of it, the back already came out at 10.35 against a
shipped 6.01; tonight's light-box change took that to 10.75, a 4% nudge inside
the noise. The cause is earlier run-game work — the reshaped run distribution
and the red-zone squeeze — after which nobody re-measured the table.

The corrected table, scaled to hold the starter-weighted total at 86.45 so that
`aiGreed`'s fixed thresholds still mean what they meant, is:

    { QB: 15.89, RB: 9.39, TE: 5.58, CB: 4.39, WR: 2.95, S: 2.87,
      LB: 2.76, DL: 2.46, OL: 2.17, P: 2.00, K: 1.25 }

Shipping it needed one other thing, and the first diagnosis of what was wrong.

Applying the table sent the mean value of an AI trade offer to the human from
4.6 to 32.8 and the share of offers that help the human from 38% to 67%. The
obvious reading is that `aiGreed`'s fixed thresholds of 2 to 8 had become easy
to clear, because a 56% heavier running back makes every strength delta bigger.
That reading is wrong, and measuring it said so: across 80,352 candidate swaps
in six leagues the delta distribution barely moves, mean 15.87 against 15.77
and the median within 5%. The thresholds were fine.

The mean was hiding the shape. Both sides of every offer, measured:

| | offers | human mean | human median | human p90 | human positive | club mean | club positive |
|---|---|---|---|---|---|---|---|
| before | 207 | 4.6 | −0.3 | 5.8 | 38% | 9.6 | 100% |
| corrected table | 203 | 32.8 | 2.5 | **130.8** | 67% | 13.4 | 100% |
| and capped | 186 | 2.9 | 0.6 | 9.1 | 59% | 12.4 | 100% |

The club gains on every offer it makes, before and after — it never proposes
anything that hurts it. The median offer to the human moved 2.8 points. What
changed was the tail: a ninetieth percentile of 130 points of lineup strength,
which is a free win button rather than a decision.

Those are deals where the club ships a reserve the human starts — a quarter
weight on one roster and full weight on the other — and the back being properly
valued gave them their real size. They are genuinely good for both sides, which
is why greed never blocked them. What blocked them is `OFFER_LOPSIDED`, a
ceiling to go with the floor `OFFER_FAIR_MARGIN` already provided: a general
manager who would not ask you for something insulting also does not hand over a
man worth far more to you than to him, because he would ask more for him. Twelve
points, from a sweep — the tail sits so far out that caps of 20, 12 and 8 all
give the same p90 of about 9 and the same volume to within five deals.

What it costs: offers per league 10.3 to 9.3, weeks with an offer 49% to 43%,
week-one offers 16 leagues in 20 to 12. The human is helped more often than
before (59% against 38%) but by less on average (2.9 against 4.6), which is a
market of small frequent edges rather than rare enormous ones. AI-to-AI trades
are unchanged at 3.8 a season. The strategy table does not move at all: value
shopping still leads on 7.8 wins and the ordering of all six is identical.

Two tests fell over and both were fragile rather than wrong-in-principle. One
had always, when its fixed seed produced no offer, made offers in a *second*
league and then checked them against the first — reading the wrong rosters
entirely; fewer offers finally made it fire. Both now go through the seed search
that was already sitting in the file for this purpose.

### A fingerprint that could not see the roster

The fingerprint is described above as the strongest check this project has,
because a test asserts what somebody thought of and a hash asserts everything.
It had a hole in it, found while asking a different question entirely.

`syntheticTeam` names its players after the club, so a club built as `alpha`
always produces a player called `alpha-QB1`. And `overall()` caches by player
id — deliberately, with a comment above it warning that anything computing a
rating from attributes not attached to a fixed id has to go through
`rawOverall` instead. Every pair in the fingerprint was built as alpha against
bravo. So the first pair's ratings were cached and handed back for every pair
after it, and `teamPower` reported the same gap for all five roster gaps:

| roster means | gap teamPower reported | gap it should have |
|---|---|---|
| 82 v 82 | 0.1 | 0.1 |
| 90 v 70 | 0.1 | **20.1** |
| 70 v 90 | 0.1 | **−19.9** |
| 86 v 84 | 0.1 | **2.3** |
| 95 v 60 | 0.1 | **34.9** |

A 95-against-60 blowout carried the same prior as an even matchup. Play
outcomes were never wrong — those read the raw attributes through
`composites()`, so every score in every case was right — but the win
probability stamped on every logged line comes from `priorMargin`, and the
fingerprint hashes that line. The one column meant to reflect the matchup
reflected nothing, in the check that is supposed to catch everything.

It is a harness bug rather than a product one: a real league gives every player
a unique id, and a man whose rating changes through ageing carries his own
`ovr`, which is what that comment was guarding. Nothing shipped was ever wrong.

The fix is a distinct construction id per case, with `abbr` and `name` put back
afterwards so the play-by-play still reads ALP and BRA. Three pairs that are
lopsided *by position* went in alongside it — one club buying the quarterback
against one buying the backfield and the line, one splitting the secondary
against the receivers, one absurd pair of clubs who spent everything on
specialists. Those matter because every other case draws all positions from a
single mean, so reweighting `TRUE_LEVERAGE` moves both sides equally and the
gap never moves; sides strong in different places make the leverage table reach
the output.

Proved rather than assumed: with the fix in, changing the leverage table moves
the fingerprint from `c0f42fd53ad4a81e` to `64ff480a39db399a`, and putting the
table back returns it exactly. Before the fix the same change moved nothing at
all.

### Every call has its down

The equilibrium solve over first and ten said the blitz and the stacked box were
never worth calling. That is a claim about first down, not about the playbook,
and `scripts/situational-grid.mjs` measures the rest of it: seven situations,
each solved on the payoff that situation actually has. On first and second down
that is yards less a turnover priced at forty of them. On third down yards
barely matter — converting does — so it is the conversion rate, less a turnover
priced at 0.8 of a conversion, because failing a third down means punting and
losing it means handing back the same field without the punt.

Where each defensive call earns its place, at 5% or more of the mix:

| call | lives in |
|---|---|
| Base | 1st & 10, 2nd & 7, 3rd & 7 |
| Stack the Box | **3rd & 1 (80% of the mix), 3rd & 3** |
| Blitz | 3rd & 3, **1st & goal from the 6 (96%)** |
| Deep Shell | everywhere except the red zone |

Nothing is dead. The stacked box is a third-and-one call, exactly as expected —
at 3rd & 1 the defence plays it 80% of the time and the offence answers by
mixing the inside run 53% with a short pass 47%, converting 74%. The blitz was
the surprise: its home is not third and long at all but the red zone, where it
takes 96% of the mix at first and goal from the six. That follows once stated —
in a compressed field the deep ball has nowhere to go, so the coverage a blitz
sells is worth nothing and the pressure it buys is worth everything.

Both prices are assumptions, so the table was re-solved at half and at nearly
double them. The two findings that matter do not move: the stacked box lives at
third and short at every price, the blitz lives in the red zone at every price.
What shifts is only the marginal appearances — whether the blitz also shows up
at 3rd & 3, whether base or a stacked box takes a share inside the six — and
those move with the sample size too, so they should not be read as anything.

Two things fell out of this that are worth keeping.

**Third down is a different game, and the engine knows it.** `sticks()` starts
at third down and scales with the distance, so the same inside run converts 81%
on 3rd & 1 and 8% on 3rd & 12, while a medium pass goes the other way. That is
the run's real job showing up in a number for the first time — the yards table
could never display it.

**Second and seven is first and ten to this engine, and deliberately so.** The
two situations solve identically: same mixes, 7.13 against 7.12 yards a play.
Down reaches a play only through `sticks()`, which does not fire until third,
and through short yardage. The difference between a first and ten and a second
and seven is which plays get called, which is `chooseOffense`'s job rather than
the resolver's. A test says so, so that nobody reads the situational grid and
files it as a bug.

### Reading the grid the wrong way

The call grid is a table of what each pairing yields, and I twice read it as if
it were a table of what each call is *worth*. It is not, and the difference
produced a confident, wrong conclusion that took a proper solve to undo.

The first mistake was taking a column's maximum — the offence's best answer to
a look — as a measure of that look's strength. By that reading the two-high
shell gave up 7.86 a play against a blitz's 9.48, so the shell was far and away
the best defensive call and needed weakening. The 9.48 was not even the blitz's
column maximum; it was the screen's row, read across instead of down. The blitz
actually gives up 11.52, so the gap I quoted was wrong in both directions.

The second mistake was deeper. Both sides call at the same time, so no pure
strategy is the answer to anything — what matters is the value of the game when
neither side can be predicted. `scripts/playbook-equilibrium.mjs` runs
fictitious play over the matrix and prints it, and it also prices the payoff
properly. Scored in raw yards the answer is degenerate: the offence should throw
deep on every snap and the defence should sit in a shell on every snap. Yards
are not what a play is worth. A giveaway costs about four points and four points
is about forty yards of field position, so a play is worth its yards less its
turnover rate times that. Scored that way, the deep ball leaves the mix
altogether — it is the riskiest throw on the field — and the equilibrium is:

    defence   base 20%, shell 80%, stacked box 0%, blitz 0%
    offence   outside run 35%, play action 65%
    worth     7.10 yards a play

So the shell is not pathologically strong. Base and the shell are near-tied
best replies, which is why the defence mixes them; the split between the two
swings twenty points between a 1,200-snap sample and a 2,500-snap one and means
nothing, so the script says so in its own output. What is stable across sample
sizes and across any sane turnover price is the shape.

And the shape appeared to name a different imbalance: **the blitz and the
stacked box are never worth calling at first and ten**, at any turnover price.
That was flagged as a thing to go and measure rather than a verdict, and
measuring it is what **Every call has its down** below does. They are not dead;
they were being asked about the one down where neither belongs.

### The shell stops the deep ball rather than erasing it

Asked to weaken the shell, and having established above that its dominance was
my own misreading, there was still one thing wrong with it on its own terms. It
cut the deep ball from 11.11 yards to 6.10, a 45% erasure, harsher than anything
else in the matrix. Cover two has holes — the deep middle between the safeties,
the sideline behind the corner — and a great deep passing attack finds them.
That cell is now `comp −0.08, cov +6, int 0.02`: 7.61, a 31% cut.

It is still by some way the harshest thing done to the deep ball, and the throw
is still intercepted 7% of the time into that look against 4.4% elsewhere,
because a shell inviting the throw and jumping it is the whole point. Loosening
it further was tried and reverted: at a 18% cut the deep ball overtakes the run
as the best answer to a shell, which is backwards — stopping it is what the look
is for. A test caught that, which is what the test is for.

Being honest about what this bought: **nothing at equilibrium.** Before and
after, the solve gives the same mixes and the same 7.10 a play, because the deep
ball is not in the offence's mix either way. League scoring does not move either
(44.6 points a game between the two clubs, against 44.6). This is a realism fix
to a cell a player can see on the matchup chip, and it is not the rebalancing it
was asked to be, because there was no imbalance there to fix.

### A counter for the quick game

### A counter for the quick game

The short pass was the one call with nothing to read. Its four cells spanned
0.75 yards — 6.53 against a base look, 7.28 against a stacked box, 7.03 against
a blitz, 6.64 against a shell — so whatever the defence guessed, the answer came
back the same, and the matchup chip could only ever say that committing changed
almost nothing. A call with no counter is a call with no decision behind it.

The first instinct was to make the stacked box the counter, on the grounds that
an extra defender in the box is standing exactly where short passes are caught.
That was wrong twice over. It breaks the matrix's clean rule — stack the box and
you get thrown on, progressively more by depth — and the football does not hold
either: eight in the box means man coverage behind it with little help, which is
what the quick game is *for*.

The counter is the two-high shell, and the reason is in the name. Two-high is
five underneath: the window closes and there is nowhere to run after the catch.
Its entry was a small *bonus* for the short pass (`comp +0.05, cov −6, yac −1`,
on a label that read "soft vs runs and short passes"); it is now `comp −0.08,
cov +6, yac −2.4`, and the label reads "Two-high, five underneath. Squeezes the
passing game. The run eats it." 6.53 into a base look becomes 4.28 into a shell.

That leaves the playbook divided cleanly between the two committed looks. Stack
the box is the answer to the run and gets thrown on; the shell is the answer to
the pass and gets run on. The blitz counters nothing — it is a gamble rather
than a read, worst of all against the screen — and base is the reference. Two
tests hold the structure: every row spans at least two yards, every call has at
least one look the chip says something about, and each of the seven calls fears
the look its family is supposed to fear.

The defensive balance did not move, and that was checked rather than assumed.
Because the two sides choose at the same time, what matters is each look's
column maximum — the offence's best answer — not its column mean. The best
answer to a shell was the outside run at 7.86 before this change and is the
outside run at 7.86 after it, because the short pass was never the best answer
to a shell anyway. What did move was league scoring, from 46.0 points a game
between the two clubs back to 44.6, which is roughly where it sat before the
second-quarter clock fix and squarely in the real league's range.

I wrote here that the column maxima made the shell the strongest defensive call
in the game — 7.86 a play against an offence answering optimally, where a blitz
gave up 9.48. Both halves of that were wrong, and **Reading the grid the wrong
way** below records what replaced it.

### A look that rewards the run

The call grid said no defensive look rewarded running: the medium pass beat
both runs against all four, its floor into a deep shell (7.49) sitting above
the inside run's ceiling against that same shell (6.56). At first down there
was never a reason to hand the ball off.

Two measurements had to come first, and both narrowed the problem. **The run
already scaled harder with personnel than the pass**: an elite backfield (RB and
OL at 95) takes the outside run from 5.65 to 9.69 yards a play, +71%, where an
elite quarterback and receiver take the medium pass from 8.69 to 11.61, +34%.
And **a run-built club already beat a pass-built one**: over 200 games with the
sides swapping home and away, a roster with RB 95 / OL 94 / QB 77 / WR 77
leaning on the run won 54.0% against the mirror-image roster leaning on the
pass. So "the run game is not viable" was wrong as a roster claim, and was only
ever true of the play-call grid at league-average rosters. The run also owns
short yardage, which a yards-per-play table cannot show at all: on 3rd & 1
against a base defence an inside run converts 81% against a medium pass's 58%.

What was actually broken was one cell. A two-high shell is the look that in
football means *run* — six in the box against five blockers and a back — and it
was worth only +1.2 yards to the inside run and +1.4 to the outside, not enough
to overtake a pass. It is now +2.0 and +2.2, with the stuff rate dropped from
−0.05 to −0.06 because a light box gets fewer bodies to the ball.

The other half of that cell was play-action, which beat both runs against a
shell and should not have. A run fake is wasted on a defence already sitting
deep; its value is against a defence crashing the line, which the matrix
already pays it handsomely for (+2.8 against a stacked box). Yet it was
punished *less* by a two-high look (`comp −0.04, cov +3`) than a straight
drop-back was (`comp −0.05, cov +4`). Now `comp −0.08, cov +6`.

Together those put the outside run at the top of the deep-shell column (7.74,
against play-action's 7.61 and the medium pass's 7.49) and leave the inside run
level with the pass. The run is no longer beaten by anything against every
defence. The inside run is still the lowest-yield call in the game, which is
correct — its job is 3rd & 1 and the clock, not yards.

The cost was checked rather than assumed. A run-built club committing to it
goes from 54.0% to 53.8% against a pass build, so the roster balance did not
move; and at league level scoring, yards per carry, yards per attempt and the
run's share of plays are all within noise of where they were (4.41 ypc, 7.48
ypa, 41.2% run share, 45.2 points a game between the two clubs — the real
league runs about 4.3, 7.2, 42% and 45).

### The second quarter is not about the score

`wantsTimeout` required `diff <= 3` before half, so a club leading by more than
a field goal never stopped the clock and simply took the two-minute drill off.
Measured over 400 games from 0:50 on the opponent's 40 leading by seven: 1.00
point and a 79.0% win rate, against 3.32 and 89.0% for spending the timeouts.
An eight-point swing thrown away by a condition that has no business being
there — before half the score is not the question, and there is no version of
football in which a three-point lead is worth stopping the clock for and a
seven-point lead is not.

The rule is now `left <= 90 && g.ballOn >= 45` for the club with the ball: what
decides it is whether there is something to gain — the ball, time to use it,
and field position to use it from. It is still gated, and deliberately: deep in
our own half with 0:50 left there is nothing to buy, and the measurement agrees
(78.1% doing nothing against 79.4% spending them all).

The same defect sat in `isHurryUp` one function away. `diff <= 7` meant a club
leading by more than a touchdown played the end of the half at walking pace
even standing in field-goal range, which is why fixing the timeout alone still
left 2.6 points on the field at 0:40 on the opponent's 35. A lead is a reason
to sit on the ball in your own half, not across midfield, so the gate is now
`diff <= 7 || g.ballOn >= 40`.

What the two are worth, over 400 games an arm, as the win rate of the club with
the ball and the points it scores before half:

| second-quarter situation | before | after |
|---|---|---|
| leading 7, 0:50, opponent 40 | 79.0% (1.00) | **87.0% (3.32)** |
| leading 7, 1:30, own 30 | 83.1% (0.91) | **86.8% (2.09)** |
| leading 14, 0:40, opponent 35 | 94.4% (0.16) | **96.9% (2.77)** |
| leading 3, 0:50, opponent 40 | 79.6% (3.32) | 80.1% (3.32) |
| tied, 0:50, opponent 40 | 73.3% (3.58) | 74.0% (3.58) |

The rows where the old rule already fired barely move, which is the check that
matters: this adds the cases it was wrong to skip rather than changing the ones
it had right. And the new rule beats spending indiscriminately in three of the
five rows — judgement still beats a reflex. League scoring rises from 44.5 to
46.0 points a game between the two clubs, because more halves now end with
somebody kicking.

### Who is having the game, while it is still being had

The box score already handled a game in progress — `#/box/live` renders it and
says IN PROGRESS across the top — but nothing linked to it until the whistle,
and the game screen itself said nothing about who was doing the damage. So this
turned out to be smaller than it looked: the data and the screen both existed,
and what was missing was a glance and a door.

`statLeaders` is the picker that was already inside `gameStory`, lifted out so
the live screen and the finished-game story share one definition of a leader.
The three offensive slots rank on yards, because that is what a leader board
means. The defender ranks on a weighted count — a sack is worth 2, an
interception 3, a forced fumble 2 — and tackles are worth nothing at all, since
the leading tackler is usually whoever plays the most snaps against the run
rather than anybody who did something. Fourteen tackles and nothing else does
not make the list, and a test says so. Nobody with a zero appears either: early
in a game most of these slots are empty, and a list of players who have done
nothing is worse than a short list.

On screen it is a disclosure next to the drive chart, so it costs one line
closed and 243px open, with the two leading passers in the summary for the
glance you want while watching rather than while studying. It carries a link to
the full box score, which is the door that was missing. It shows only while the
game is live: once it ends the story card above prints the same four lines as
prose, and two copies of the same thing is worse than one.

### Drive headers that are headers again

The play-by-play runs newest first, so the play that just happened is at the
top of the page. A drive header is logged *before* the plays it introduces, so
reversing the list put it underneath them — and that is not merely upside down.
An interception ends one possession and starts another, so the header for the
club that took the ball landed between the kneel it led to and the interception
that caused it:

    kneel    a. QB1 kneels.
    drive    Team alpha ball at BRA 37.
    int      b. QB1 deep pass is INTERCEPTED by a. CB1.

Causation inverted twice in three lines. `pbpOrder` groups by possession
instead of ordering by event: newest drive first, its header on top of its own
plays — a header labels a possession, it is not a moment inside one — and the
plays under it newest first, which keeps the play that just happened second
from the top. A kickoff is logged before the drive header it produces, so it is
carried down into the drive it started rather than stranded under the previous
one; eight of nineteen headers in a sample game had one. The final whistle is
hoisted clear of the last drive, because it is the result of the game rather
than a line inside somebody's possession.

A quarter break needed no special handling and got none: it happens mid-drive,
and reversing within the group puts it in its right chronological place between
the plays before and after it.

One consequence worth knowing: the `latest` flash could no longer key off row
zero, since row zero is now a header. It keys off the log's own event index
instead, so the animation lands on the play that just happened.

### What was called, and whether it was a good call

`Last: Medium Pass vs Base` named the two calls and said nothing about whether
either was any good, which is the only part of a play a person can learn from.
The information existed — `MATRIX` in `game/plays.js` decides every snap — but
as coefficients on completion, coverage, yards after catch and pressure. That is
the right shape for the engine and no use at all to somebody choosing a call.

`CALL_GRID` in `playcall.js` is the same thing measured from outside: 3,000
snaps per cell, every one a neutral 1st & 10 at our own 25, two evenly matched
84-rated clubs, penalties off so a flag before the snap cannot stand in for the
matchup. `scripts/call-grid.mjs` regenerates it and prints the literal to paste
back. It is a league-average reference, not a prediction for the two clubs on
the field; what holds across rosters is the ordering, because that comes from
the matrix rather than the ratings.

| yards/play | Base | Stack the Box | Blitz | Deep Shell |
|---|---|---|---|---|
| Inside Run | 4.84 | **3.13** | 5.07 | 7.37 |
| Outside Run | 4.96 | **3.57** | 6.65 | **7.74** |
| Screen | 5.45 | 6.27 | **9.46** | 4.74 |
| Short Pass | 6.53 | 7.28 | 7.03 | **4.28** |
| Medium Pass | 8.48 | 10.25 | 9.18 | 7.49 |
| Deep Shot | 11.11 | **15.47** | 11.79 | **7.61** |
| Play Action | 9.72 | 12.49 | 9.16 | 7.61 |

The rock-paper-scissors is real: the run dies against a stacked box and eats a
two-high shell, the screen is the answer to a blitz, and the deep ball punishes
a defence that crowded the line — and walks into an interception against the
shell, where its turnover rate jumps from 4.4% to 7.9%.

The chip on the live screen measures a pairing against the **base** look, not
against the row's average, and that choice was made twice. Against a row average
it came out slightly negative for nearly every call, because the three committed
looks are generous to passing and drag the mean up — so a defence playing it
straight read as a defensive win on almost every snap, and base is what a
defence calls 53% of the time. Against base as the reference, a defence that
commits gets credit or blame for committing and one that does not gets neither,
which is the honest reading of a neutral call. Base shows no chip at all, just
the sentence: playing it straight is not a number worth rendering as +0.0.
Thresholds come from the spread of the 21 committed cells — a quarter inside
0.78 yards, half inside 1.23 — so 0.75 and 2 split them roughly five even,
eleven slight, five decisive. Over 40 simulated games that works out at 53%
straight, 42% a slight or even read, and 5% decisive: a real moment about seven
times a game rather than wallpaper.

The measurement turned up two balance problems serious enough to fix. No
defensive look rewarded running, so at first down there was never a reason to
hand the ball off; and the short pass's four cells spanned 0.75 yards, so no
defensive call meaningfully changed it and the chip could never say anything
about it either way. Both are dealt with below, under **A look that rewards the
run** and **A counter for the quick game**.

The first version of this table was wrong, and how it was wrong is worth
keeping. `scripts/call-grid.mjs` reset the down, distance and spot before every
snap but not the possession, so a single fumble handed the ball over and every
snap after it was measured from the other side — in one cell, 2,388 of 3,000.
Each cell carried a different mixture, so the whole table was depressed by an
amount that varied per row. The grid also ran at a home site, which is not what
a league-average reference should be. Both are fixed; the numbers above are the
corrected ones.

### Autoplay, paced by what is at stake

Autoplay was a flat `setInterval`, so a kneel-down got the same 900ms as a
pick-six. That is most of why watching read as a ticker rather than a game: the
screen changed at a constant rate regardless of whether anything had happened.

The pacing signal was already there. Every event carries a win probability, so
the swing a play produced is a free measure of how much it mattered. Measured
over 5,785 snaps: half move it by less than half a point, the 75th percentile is
1.6 points, the 99th is 24, and the largest single swing seen was 58. That is a
range of two orders of magnitude being rendered at one speed.

`paceDelay(base, delta, beat)` turns the swing into a hold. The curve is a
square root, so the common small swings still separate from each other rather
than all collapsing onto the floor, saturating at `FULL` (about the 99th
percentile). `BEAT` is a separate floor — not a cap — for plays worth holding on
even when the number barely moves: a score that is not a routine extra point, a
turnover, the end of a period. A garbage-time touchdown is still the most
interesting thing on the screen, and an extra point is the dullest score there
is, which is why `xp` is excluded. 8.3% of snaps carry a beat.

The constants (MIN 0.55, MAX 2.8, FULL 0.20, BEAT 1.4) were swept rather than
guessed, against two requirements: a floor a person can actually read, and a
mean that lands on the speed the player set. At the 900ms default that gives a
495ms floor, an 846ms median, and a 2.5s ceiling, with a quarter of snaps at
the floor — and a mean within 2% of 900ms, so the slider keeps meaning what it
says and a game takes as long as it always did. Only the distribution changes. A
test pins the mean over 2,000+ snaps so the curve cannot be retuned into
something that quietly doubles a game. The result is clamped in absolute terms
too (250ms–4s), so neither end of a 200–3000ms slider becomes a flicker or a
slideshow.

Two mechanical notes. The loop is a self-rescheduling `setTimeout` rather than
an interval, because each gap differs; `stopAuto` clears it, and leaving the
screen is covered by the view's own teardown. And the first play runs on the
click instead of after a wait, so the button answers straight away.

Two things went wrong while measuring this and are worth recording, because both
were the instrument rather than the code. Sampling the page from the driver with
a dynamic `import()` per poll cost more than the gap being measured, and the
floor read as 886ms against a modelled 495ms until the sampler moved inside the
page. And the first "gap" of a run is the opening kickoff firing on the click,
not a pace at all.

### The clock, when a coach is running it

Coach mode let you call plays and nothing else. The clock was entirely the
engine's: `wantsTimeout` fired for *both* clubs, so the game spent the user's
timeouts for them, and `isHurryUp`/`isClockKill` read the situation with no way
to disagree. A coach in a two-minute drill was a passenger.

Two levers now. **`callTimeout(g, team)`** spends one, legal only with one left
and the clock running — a timeout buys back the play clock the next snap would
burn, so with the clock already stopped there is nothing to buy, and they cannot
be banked. **`setTempo(g, team, tempo)`** forces hurry-up, normal or bleed-clock
for that club. The override lives inside `isHurryUp`/`isClockKill` rather than
in `tempoSeconds`, because tempo is not only seconds: `chooseOffense` leans on
the same two predicates to bias toward the pass in a hurry-up and the run when
killing the clock, so a coach who sets the tempo and then lets the AI call it
gets plays that match, not just a different play clock.

`takeClock(g, team)` is what arms both, and it is set only while somebody is
actually watching and calling. Every skip-ahead path — `stepDrive`,
`stepQuarter`, `simulateGame` — hands it back for its own duration through one
`delegated` helper, so a **Sim to end** is managed exactly as it always was and a
simmed season is bit-for-bit unchanged. A test pins that: twenty games simmed
with the clock held come out with identical scores and identical timeout
spending to twenty simmed without it. The game fingerprint did not move when
this shipped, because with nothing set the overrides are inert; it has moved
since, for the reasons recorded above and under the second-quarter clock rules
below, which change what the engine does on its own.

What the levers are worth, over 400 seeds per arm, as the coaching club's win
rate:

| situation | AI manages | coach spends all | coach hoards |
|---|---|---|---|
| Trailing 4, 2:00 Q4, own 25, ball | 34.6% | 34.6% | 28.0% |
| Trailing 7, 2:30 Q4, on defence | 7.9% | 7.9% | 2.6% |
| Leading 7, 0:50 Q2, opponent 40, ball | 86.6% | **91.1%** | 86.6% |
| Trailing 21, 4:00 Q4, on defence | 0.0% | 0.0% | 0.0% |

Read that honestly: timeouts are worth five to seven points of win rate, and in
the classic late-game spots **the heuristic already spends them as well as a
coach would**. This is not a win-rate upgrade, it is agency — with one
exception. `wantsTimeout` requires `diff <= 3` in the second quarter, so a club
leading by more than a field goal never stops the clock before half, and
spending them there is worth 4.5 points. That is a gap in the AI's rule, not
only a missing button; it is left alone deliberately, because changing it moves
every simulated game in every league.

Tempo cuts both ways, which is the point of a manual control. Forced `kill` in
that trailing drill leaves 1.0% against auto's 28.0%, and a tempo set while
leading and forgotten costs 2.5 points when the score flips, because the
override is sticky where the heuristic adapts. So the control defaults to
**Auto** and says so, and Auto is a first-class button rather than a hidden
state you have to guess your way back to.

On screen it is a row that appears only in the last five minutes of a half, in
every branch: the timeout on its own line because it is the urgent one and wants
a thumb, and four tempo pills below it, shown only with the ball because you
cannot set the other club's. It costs 23px in the watching controls and 57px
in the coach-call panel, and nothing for the other fifty minutes. The scoreboard
already drew both clubs' timeouts as dots, so the count has somewhere to agree
with.

### One action, not five

The controls under the strip were five equal buttons — next play, next drive, end of quarter, sim to end, autoplay — measuring 179px of an 844px phone, a fifth of the screen for the least interesting thing on it, and pushing the play-by-play under the fold. Watching a game is one action. It is now two big buttons, **Next play** and **Autoplay**, with the three skip-ahead buttons folded into a disclosure: things you want occasionally and never by accident. 121px instead of 179px, the play-by-play starts at 513px instead of 572px, and the page is 1088px instead of 1147px. The coach-mode panels are unchanged, and `Sim to end` still stands on its own there.

## Awards, records and the hall of fame (`awards.js`)

The final closes the books. Every player with a stat line is scored against his own position first: how many standard deviations above the league's starters at that position (players with at least half the season) he finished, on fantasy points, with punters rated on placement and distance and linemen, who keep no statistics, left out. The MVP is the best of those z-scores weighted by positional leverage to the power 0.35, so a quarterback still wins most years, as one does in the real league, while a back or receiver with a truly outlying season can beat him. Offensive and defensive players of the year are the best z-scores on their side of the ball, the kicker award goes on points, and coach of the year to the club that finished furthest above its roster's power rank. An all-league team takes the top scorers at each position in starter numbers, and the season leaders are recorded in eleven categories. The awards screen shows the same race mid-season, so the MVP argument runs all year.

The record book keeps season marks (twelve player categories), single-game marks from the games that kept player lines (yours and the playoffs; AI regular-season box scores hold team totals only), and team marks: points and margin in a game, points and wins in a season. Each entry names the holder, the club, the season and, for games, the opponent; a mark is replaced only when beaten.

Careers accumulate per player across seasons: games, totals, honours, statistical titles and rings (every member of the champion's roster gets one). The hall of fame is a résumé score: a point a season, four for an MVP, two for a player-of-the-year award or a title, one and a half per all-league selection, half per statistical title, and a point per 300 fantasy points; induction at 12 with at least three seasons. That is deliberately reachable in a short dynasty and deliberately not reachable by longevity alone. Established: the scoring above. Speculation: whether the leverage exponent lets non-quarterbacks win often enough; it has not been measured over many seasons.

## AI general managers (`gm.js`)

Three things an AI club does that a preset never did.

**A game plan.** At kickoff each AI side reads the matchup from the two clubs' composites and adjusts its sliders for this game only: quick throws and screens when the other rush beats its line, more runs at a soft front, more passing when its quarterback beats their coverage, deep shots at a slow secondary; on defence, pressure at a weak line (and a heavy blitz at a replacement-level fill-in), a stacked box against a strong run game, a shell over a great passer. The human's sliders are the human's own; the matchup card tells you what the other side plans, which is the invitation to answer it.

### How even is the league, really

This section used to say the league was too even for tactics to matter, and that was measured on the wrong number. It rested on `teamPower` spread — 0.78 between the best and worst roster in an eight-club league, against a home edge of 1.1 — and `teamPower` turned out to explain **r = 0.34** of who actually beats whom. About a tenth. Every conclusion drawn from it was drawn from a weak proxy.

Measured properly, by point differential from a round robin of every club against every other, 20 games a pairing across three leagues:

| league | best club to worst |
| --- | --- |
| 8-club snake | **5.5 points a game** |
| 8-club auction | **6.4 points a game** |

That is not a flat league. The pass/run read is worth about a point, so tactics come to roughly a sixth of the roster gap, which is a defensible ratio rather than a broken one. The premise was wrong; there is no structural problem here to fix.

What is true, and was never the point being argued: the draft distributes talent evenly *relative to what the pool allows*. An eight-club league could produce a 6.40 power spread and produces 0.88 — 12% of the available range, and the same 12% at every league size, because the snake order hands out equal draft capital and the roster template forbids concentrating it. The pool is not the constraint: at eight clubs every drafted player is 88 or better.

If more variety is ever wanted, the one lever that measured worth having is
**unequal auction budgets**, and it is built now — a *Cap room* choice on the
setup screen, auction only, off by default. See **Unequal cap room** below,
which re-measures it and corrects one half of what this paragraph used to
claim.

### Unequal cap room

`spreadBudgets` hands the same money out unevenly: multipliers spaced evenly
from `1-spread` to `1+spread`, rounded, then shuffled. Evenly spaced rather than
drawn at random so the advertised range is exactly what clubs get, and summing
to the same total so this redistributes buying power rather than inflating the
market — a $160 club and a $240 club, not a poorer league. Which seat is rich is
the shuffle's business and yours is in the draw, because that is the variety
being bought.

The claim it was built on predated the pool rewrite, the attribute wiring and
the weight refit, so `npm run budgets` measures it again. The reading that
matters is the gap in roster strength between the best and worst club, because
a thirteen-game season's point differential is mostly luck — the same leagues
show a 17-point season gap with *equal* budgets, which is what the old
measurement's 6.4 was not counting.

| cap room | power gap | ≈ points a game | corr(budget, power) |
| --- | --- | --- | --- |
| even | 1.52 ± 0.08 | 4.9 | — |
| ±10% (`mild`) | 1.79 ± 0.05 | 5.8 | 0.55 |
| ±20% (`wide`) | 2.44 ± 0.08 | 7.9 | 0.81 |
| ±40% | 3.98 ± 0.09 | 12.9 | 0.93 |

Half the old claim holds: a fifth either way roughly doubles how far the best
squad finishes ahead of the worst. The other half does not. "±40% adds nothing
further" does not reproduce — it keeps climbing, and takes the correlation
between a club's budget and its roster strength to **0.93**, at which point the
draw has decided the season before a game is played. That is why the ladder
stops at `wide` rather than going further: the setting is for variety, and past
about a fifth it stops being variety and starts being the result.

A safety property worth stating because it is the auction's one promise: a club
always keeps $1 per unfilled slot, so every roster completes however poor it
started. A club on $160 with twenty-seven seats to fill is exactly where that
would break, and a test drives one to make sure it does not.

### What the strategy dials are actually worth

Five dials were presented as five decisions. Driven end to end on identical rosters, 700 to 1,500 paired games per cell, only one of them is:

| dial | measured end to end | verdict |
| --- | --- | --- |
| Pass / run balance | best setting flips with roster shape: run-built wants 0.35, pass-built wants 0.70 | a real decision |
| 4th-down aggression | +1.40 ± 0.38 with a strong offence and a poor kicker, +0.14 ± 0.51 otherwise | helps sometimes, never hurts |
| Blitz frequency | −0.58 ± 0.42 and −0.29 ± 0.51 on rosters built to want each end | flat |
| Deep coverage | −0.44 ± 0.43 and −0.36 ± 0.50, same test | flat |
| Tempo | **+3.81 ± 0.65** for a club six power points better; −1.68 ± 0.61 for one that much worse | real, but needs gaps this league never produces |

Tempo's first reading was a false negative twice over. A dial with a symmetric trade-off reads as noise on a balanced roster — which is what the pass rate did before it was tested on shaped ones — and tempo was worse than that: it had been measured against a mirror of itself, where both sides are equal by construction and extra possessions can favour neither. Given a real talent gap it is the strongest dial in the game. It still gets no read, for the reason in the section above.

Blitz and the deep shell were then given their own pass, and the answer was no. The trade-offs are real and measurable in the play matrix — across the dial a blitz buys +0.42 ± 0.08 sacks and concedes +0.26 ± 0.07 yards an attempt — but they net out, and three rounds of retuning the constants (a bigger rush bonus, a sack bonus, coverage cost scaled by how exposed the secondary is, pressure scaled by who is rushing) never made the answer flip with the roster. Two things came out of the attempt. The first was that the test rosters confounded their own axis: moving the front and the secondary together meant a poor defence liked the blitz more than an elite one did, simply because a poor defence gains more from any gamble. The second, once the axis was isolated, was that a *good* secondary loses by blitzing and a poor one gains — economically coherent, since abandoning good coverage costs more than abandoning bad, but the opposite of the conventional read and not a shape worth shipping. Sweeping the whole dial at five settings produced flat noise at every one.

The conclusion is that `chooseDefense` already adjusts for down, distance, score and clock, and the slider is a small global bias on top of logic that is doing the real work. The retune was reverted in full; the game fingerprint was unchanged at `a9480bd47f40cac9` (it has since moved to `e27d59dbc5d3340e` for the `teamPower` reweight below, which changes win-probability annotations and no play). `scripts/defense-tune.mjs` is the harness, kept so the next person does not have to rediscover any of it. A note on method: the first three rounds of that tuning were run against game margin, which carries a standard deviation of 13 points and leaves ±0.55 at 500 games — wider than the effect being tuned. They were three rounds of chasing noise. Points and yards allowed, taken paired and per play, land inside ±0.1 and are what the harness reports.

Also measured and not built: the per-opponent game plan the audit proposed. `makeGameplan` already exists and every AI club gets one; it nudges the dials by ±0.06 to ±0.15 and fires in **16 of 1,500** even matchups because its thresholds need a composite gap over 5 or 8 points. Where it does fire it is worth +0.39 ± 0.41 points. The `planForUser` option that would extend it to the human has never been passed by anything, which is deliberate (see the game plan note above) and costs the player nothing measurable.

### The pass/run read (`strategy.js`)

Every AI personality drafts and calls plays coherently — Air Raid buys quarterbacks and receivers and throws at 0.66, Ground & Pound buys backs and linemen and runs at 0.44. The human's roster is whatever the human drafted and the dial starts at a flat 0.55 regardless. That asymmetry, not the absence of a weekly decision, was the real gap.

`runEdge(comp)` scores how much a club's running game beats its passing game from the composites the engine already builds, so it moves when a player is signed, hurt, dropped down the depth chart or developed. The recommendation is a line fitted to a sweep of 450 paired games per cell:

| run edge | −19.6 | −13.1 | −6.8 | −0.2 | +6.2 | +12.5 | +19.0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| best pass rate | .70 | .70 | .70 | .65 | .50 | .35 | .35 |

giving `clamp(0.64 − edge × 0.023, 0.35, 0.70)`, which reproduces every cell.

**The honest size of it.** That sweep used synthetic rosters built to order and overstates what a real league offers. Surveyed across 144 drafted clubs the run edge only spans −7.3 to +1.4 in an eight-club snake league, −8.9 to −0.4 in an auction and −11.1 to +4.6 in a 32-club pro league: the pool and the worth table between them mean nearly every squad comes out leaning pass, and none comes out as run-built as the sweep's far end. So the figure quoted on screen is the one measured on real rosters — following the read rather than sitting at 0.55 is worth **+0.98 ± 0.22 points a game over 3,200 games**. Real, and about a point. The test that pins the fit to the sweep is the thing that will fail first if the engine is retuned.

What makes the metric trustworthy is that it reads the league correctly without being told: sorted by average run edge, Ground & Pound clubs come out the most run-leaning (−0.1) and Air Raid the most pass-leaning (−6.1), in personality order, with the personality never consulted.

Only the club you manage gets a read; telling you what a rival should be doing is coaching the opposition.

**The opening position is now fitted too.** `assignGms` hands every AI club its personality's strategy when the league is created, matched to the roster that personality then drafts — Air Raid at 0.66, Ground & Pound at 0.44. The human's dial sat at `DEFAULT_STRATEGY`'s flat 0.55 whatever they built, and that club was the only one the default ever reached. `fitUserStrategy` in `season.js` points it at the squad once, when the roster first exists. Once only: after that the dial is the player's and the team page says when the squad has changed enough to want a different one. `scripts/gameplan-sim.mjs` runs all of the above.

**Weekly drift.** After each week every AI club drifts its sliders from its own season: toward the pass when the passing game is the efficient unit, away from it when the passer is being sacked, toward the blitz when points are pouring in, toward aggression when the playoff line is slipping away late and toward caution when it is safe. Every slider stays within 0.12 of the personality's base, so a Ground & Pound club never turns into an Air Raid.

**Deals among themselves.** Surplus for need: a club with a good bench player at one position and a weak starter at another looks for a club in the mirror image and swaps two for two, positions matching, when both lineups improve by at least their greed. A few pairs are tried each week before the deadline and every deal lands in the log, so the human can see the market move without being in every trade.

Depth charts were already revisited after every waiver claim and trade. Both halves of what used to stand here as "not built" have since been built: AI clubs do ring the human (see **Offers** above), and the position-matching rule that made such deals scarce is gone (see **Uneven trades**). What is still not built is any memory of a specific opponent beyond the ratings.

## Save slots and sharing (`slots.js`, `share.js`)

**What a save actually costs.** Measured, because the figure had been quoted loosely: an eight-club league at the end of a played season is about **1.05 MB**, of which **595 KB is play-by-play** and 216 KB box scores. Only games the human *plays* keep a log, and `startSeason` rebuilds the schedule each year, so logs do not accumulate — a five-season dynasty carries about **220 KB** of durable history. Three full slots mid-season is roughly 3.2 MB against a browser's five, which is what the 3,500 KB warning on the home screen is set for; it is calibrated about right for a fantasy league. For a pro league it was not — see below.

**The pro league was on the way to a wall, and the eight-club measurement hid
it.** The figures above are an eight-club fantasy league. A pro league is
always 32 clubs, and measured at its worst moment — parked at the second
draft, where the season just played is still sitting in `league.schedule` —
a save is **2,116 KB**:

| | KB |
| --- | --- |
| schedule | 1,464 |
| careers | 258 |
| dev | 140 |
| everything else | 254 |

Three of those is **6.3 MB against an origin of roughly 5**, so three pro
dynasties could not coexist at all. Two fixes, both measured:

**A finished season's play-by-play comes down to the story.** 857 KB of that
schedule is seventeen logs at about 70 KB each — only the human's own games
keep one, and `startSeason` rebuilds the schedule, so they do not accumulate
across years; the offseason is simply the moment one season's worth is still
held. `thinCompletedLogs` runs when the offseason opens and keeps scoring
plays, flags, turnovers, injuries and drive markers whole. A routine play
leaves `{ q, wp }` behind rather than disappearing, and that detail is the
point: the win-probability chart spaces its points by index rather than by
clock, so dropping the quiet stretches would squeeze them out of the picture
and silently redraw the game. Those two fields cost 53 KB of the 590 saved,
which is the cheapest honest chart on offer. Story-only would have been 821 KB
against 874; the chart is worth the difference. The box score says "How it
went" rather than "Full play-by-play" when it is showing a thinned log, because
presenting the highlights as the whole game is the kind of quiet lie that gets
mistaken for a bug.

**The career table drops its zeroes at the storage boundary.** Twenty-one
fields a man, of which most are zero for anybody — a quarterback records no
sacks, tackles or field goals; a lineman records none of the offensive lines
either — is 306 bytes a player and 258 KB for the 864 of a pro league, packed
to 94. This is deliberately a *storage* format and not the shape anything
reads: stripping the zeroes in memory would leave every reader of `c.sacks`
coping with it being absent, and the failure when one did not would be a silent
NaN in a record book rather than an error. So `packCareers`/`unpackCareers` run
inside `writeSlot`/`readSlot` and nothing else ever sees a packed table.

Together: **2,116 KB to 1,361, and three parked pro dynasties from 6.3 MB to
4.0.** That is headroom rather than a ceiling removed — `dev` is 140 KB of
mostly-populated fields and the 17 box scores another 320 — so the quota error
in `store.js` still has to work, and does.

Two fields in every logged event were free to reclaim. Win probability was stored at a double's full precision — nineteen characters where three decimals is more than a chart drawn at pixel resolution and a label printed as a whole percent can use — and `flag` was written as `"flag":false` on almost every event when every reader tests it for truth. Together that is **8.4% off every log** and no visible change; the per-event cost went from 248 bytes to 227. What is left is mostly irreducible: the printed sentence is 24% of an event and the pre-play situation line another 13%, and the latter is built from state the event does not otherwise store, so it cannot be derived back.

**Three fixed slots.** A registry lists them and which one is open; each slot's league and in-progress game sit under their own key, and preferences are shared. A save from before slots existed becomes slot one on first load, and a browser already carrying more than three keeps every one of them — silently dropping somebody's save to enforce a new rule is not a thing to do. The home screen shows all three always, numbered, an empty one reading as a place to start rather than an absence, with a size against each because browser storage is a few megabytes and a 32-club season with box scores is a real fraction of that; the list warns past about 3.5 MB. A fourth league is refused with a message, not by overwriting one.

**Deleting never opens something else, and this was a bug report.** Slots used to be created on demand, removed outright, and the list hid itself whenever there was only one — so a player with a single league saw no slots at all and the only delete was a button in Settings. Worse, deleting handed the next slot to whoever deleted one: remove the league you are playing and you land on a home screen with a Continue button, a league name and a record, all belonging to a different save that shares the default name "All-Time League". That reads exactly like a delete that did not work, and it is what was reported. Deleting the open slot now empties it in place and leaves *nothing* open; the player picks what to open next. The confirmation names the league, its season, week and record, and the slot number.

**Three races closed while fixing it**, all of the same shape — a debounced write outliving the thing it was writing about:

- A save is debounced by 250 ms, so a league deleted a moment after a move had a write still in flight against it. Deleting now cancels the pending write rather than racing it.
- Between taking a slot for a new league and that first debounced write, the slot sat on disk with no league in it — so the home screen called the save you were playing an empty slot, and the next new league would have been handed the same one. The first write into a fresh slot skips the debounce.
- The cached registry could be behind what was on disk: another tab of the same game writes to the same origin, and site data can be cleared underneath a running page. `listSlots` and `hasEmptySlot` re-read rather than assume.

One unrelated bug fell out: the home screen added its delegated click listener on every render, and `mount` hands every view the same container, so four visits meant one Delete click opening four dialogs.

**A save that cannot be written says so.** Measuring the box-score trade-off showed how close the ceiling is: a 32-club pro save is about 2.4 MB against an origin allowance of roughly 5 MB, so a second pro dynasty in the same browser is already at the edge. `store.js` used to catch a failed write into a `console.warn`, which meant the game carried on accepting moves it was no longer recording and threw the session away at the next reload — a save system failing silently is worse than one failing loudly. It now keeps the failure on `saveError()`, distinguishes running out of room (`QuotaExceededError`, and the older Firefox and Safari spellings of it) from any other refusal, and notifies the screens — but only when the answer changes, since `saveNow` runs behind a 250 ms debounce on every move and re-rendering each time would pull the view out from under the player. `main.js` renders a red band above every view that stays until saving works again. It points at exporting, which still works with storage full because it reads the league out of memory, and at deleting a finished league. A refused write does not corrupt what is already stored: a browser rejects an oversized `setItem` without replacing the old value, and `writeSlot` writes the slot before the registry, so a failure stops before the registry can be moved on to describe a league that was never written.

A **league code** is a pasteable snapshot: every club's roster as pool indices, contracts, settings, the seed and the season number, deflated where the browser has `CompressionStream` and base64url-encoded, a few kilobytes for a 32-club league. It carries no results, logs or history; a friend who opens it gets the same league at the start of the same season with records at zero. The code holds a fingerprint of the player pool (count plus a hash of the ids) and refuses to open against a different one, since indices would point at the wrong men. A **roster card** draws the starters, overalls and record to a canvas and goes through the Web Share API on a phone or downloads as a PNG.

Not built: the roadmap's replayable share code. Games are seeded, but coach-mode calls, slider changes, claims, trades and keeper choices are not recorded, so a league is not reproducible from its seed; the snapshot is the honest version of the idea.

## Rating tooling and names (`data/tuning.js`, `data/names.js`)

**The rating editor.** Turned on in settings, every player modal shows his attributes as inputs. An edit applies everywhere at once (the overall cache is dropped for that player) and lives in preferences as a diff, `{ id: { attr: value } }`, applied to the pool at boot. Settings exports the diff as a file that names each player, the shipped value and the new one, with a fingerprint of the pool it was made against; `scripts/apply-overrides.mjs <file>` prints what would change and `--write` bakes it into the data file, after which `npm run validate` and the curve are the guard rails. Edits made in a browser stay in that browser; the file is how they travel.

**Era balance.** `npm run report` prints, per era, the count, mean overall and share of the top 100, per position. The players screen carries the same table. The pool leans modern in count (357 from the 2010s against 65 from the 1950s) and older in rating (the 1960s average 84, the 2010s 77), which is the talent tail doing its job: the modern depth players are the tail. The top 100 is spread 3/4/5/9/9/14/19/18/19 from the 1940s to the 2020s, which is the fairer measure of who runs a league.

### Fifteen hundred players, and what the record said about them

The pool is 1,500 players, up from 1,269. The count was the least interesting part of the job. Two things were wrong with the pool that no amount of adding fixes, and one of them was large.

**The pass rusher was not a player this game could describe.** Mark Gastineau's 1984 — twenty-two sacks, a record that stood for thirty-seven years, defensive player of the year — was rated 60, with a pass rush of 75 on a scale where Aaron Donald and Reggie White have 99. Dwight Freeney 61. Derrick Thomas, who has seven sacks in one game and still holds that record, 61. Kevin Greene, third on the all-time list, 60. Von Miller 62, DeMarcus Ware 64, T.J. Watt 70. Sixty-four defensive linemen and linebackers sat at 76 or below while carrying a pass rush of 70 or better, and the elite tier above them ran 92 to 99 with nothing in between. The mirror image was true of the nose tackles: Ted Washington, four times a Pro Bowl player, was the third-worst lineman in the pool at 59. Neither was a weighting artefact. The whole row was wrong — Gastineau's awareness was 52 and his tackling 54, for a man who made four Pro Bowls.

**And a scatter of individual mistakes.** Steve Atwater, in the Hall of Fame, was the *worst* of ninety-four safeties at 58. Paul Krause, who has eighty-one interceptions and will keep that record, was 87th. Eric Dickerson was an 85 in the exact season he ran for 2,105 yards. Earl Campbell's MVP year was a 67, which put him ninety-seventh of a hundred and twenty-three backs, behind Rocky Bleier.

**The fix was a yardstick, not a pass over the file.** Ratings are editorial estimates, and left alone they drift toward whoever the author pictured most clearly; a second editorial pass corrects that with more of the same. So `scripts/legacy-check.mjs` holds 443 seasons keyed by what the player actually did that year — league MVPs, the offensive and defensive awards, rookie of the year, the records a season is remembered for, the Hall of Fame, and the high picks the pool carries as cautionary tales. Each tier sets a floor the rating has to clear. An award is not an opinion: a player either won it that season or did not, so where the two disagree it is the rating that moved.

It reported 141 violations, the worst of them 27 points. Three override passes later — 610 attribute changes across 129 players, through `apply-overrides.mjs`, which dry-runs and prints every edit — it reports 16, the worst of them 8.

**What is left is the honest part.** Every one of those 16 is a position whose weight vector cannot express the archetype, and the script proves it rather than asserting it: it recomputes each flagged player with his strongest attribute set to 99 and prints the result. Derrick Thomas caps at 77 against a floor of 85 with a perfect pass rush. Kevin Greene caps at 76. Thirteen of the sixteen are edge rushers, because pass rush is 15% of a linebacker's rating and run defence is 35% of a lineman's — the one thing they were paid for is the one thing the formula barely counts. Larry Csonka caps at 79 because a fullback who cannot catch spends half his rating on speed, elusiveness and receiving. That is a real mis-specification and it is not fixed here: changing `POSITIONS` moves every player's overall, the leverage table, auction prices, the draft board and every trade valuation at once, which is a separate decision with its own measurement to do first.

**Who was added, and where.** 231 players, weighted at the thin end rather than the top: the 1940s through 1960s go from 115 players to 200, the 1950s from 32 to 65. Sid Luckman, Bob Griese, Earl Morrall and Daryle Lamonica for the quarterback hole before 1970; Jim Taylor, Bill Dudley, Doak Walker and Frank Gifford at back; Mick Tingelhoff, Rosey Brown, Jim Covert and Danny Fortmann on the line; Dick LeBeau, Ken Riley, Johnny Robinson and Jack Butler in the secondary; and the current names the pool was missing — Justin Herbert, C.J. Stroud, Jayden Daniels, Jonathan Taylor, Trent McDuffie, Joe Alt. Seventy-six of the first draft of that list collided with players already in the pool, including two that slug differently but are the same man (`Pat Surtain II` against the pool's `Patrick Surtain II`, `Jessie Bates` against `Jessie Bates III`); `scripts/add-players.mjs` catches the exact-id kind, and a normalised check that strips suffixes and nicknames catches the rest.

**Two things this does not claim.** It is not an assessment of all 1,500 players against history — it is an assessment of the 443 seasons where the record is unambiguous, plus the 64-player cluster the first check exposed. The rest of the pool is still editorial estimate, and the file has always said so. And the measurements written up elsewhere in this document — the auction ratios, the rookie-intake cutoffs, the draft spread — were taken against the 1,269-player pool and have not been re-run.

**What did not move.** The game fingerprint is `64ff480a39db399a` before and after, to the character, over 256 games and 47,821 log lines. The engine was not touched; only data was. What does move is every existing league code and season card: `poolFingerprint` counts ids and hashes them, so a code made against the old pool now refuses to open rather than silently pointing at the wrong men, which is the behaviour that guard was built for.

**Five tests fell over, and none of them was a regression.** Four were seed-pinned in ways that only held for one particular pool — a trade test that named two players and hoped both clubs would take them, a waiver test that assumed seed 4 produced a live wire, an offer test that wanted more than thirty offers from thirty fixed seeds and got twenty-nine. They search now instead of assuming. The fifth was better: `jobs.test.js` asserted that after a decade every club has a coach, and the decade ended with the user sacked and unhireable at reputation 11. `fillVacancies` skips `isUser` on purpose — the club you ran stays yours and the carousel will not hand it to somebody else — so a coachless club was the correct state and the assertion had quietly assumed the career never ends. It now asserts the sharper thing: the only club that may sit empty is your own.

### Two authorities, and where they disagree

The game holds two weight vectors and nothing kept them in agreement.
`POSITIONS[pos].weights` builds `overall`, which prices the auction, ranks the
draft board, values every trade and sorts every depth chart. `composites()` is
what the simulation actually reads. A weight that disagrees with the field is a
player the economy misprices, and clubs are robbed in the direction of the
error.

`npm run attrs` measures the second one: lift a single attribute eight points
across a position's starters, mirrored rosters, no home edge, twenty thousand
games a reading. It is `leverage-sim`'s method narrowed from a position to an
attribute, with two corrections. That harness advanced the seed and the flip
together, so the two halves of a swap never played the same game and a mirrored
roster — worth exactly nothing by construction — left 0.6 points of residue to
average away; paired, the baseline is exactly 0.000. And with the games paired
the error has to be taken over pairs, not games, which is what separates a
defensive lineman's awareness at ±0.265 from the ±0.615 the old estimator gave
it.

**The premise this started from was half wrong.** The audit said edge rushers
were suppressed by the weights, reasoning from `composites` reading a
linebacker's pass rush at 0.40 of `blitzRush`. Measured, a linebacker's `prs` is
worth 0.122 against the 0.150 he was priced at — slightly *over*weighted, because
a defence rarely blitzes and the coefficient is not the frequency. The defensive
lineman was the real case: 0.548 measured against 0.400 priced.

**Three attributes did nothing at all.** `defAwr` was gathered in `composites`
and consumed by no one, so two corners eight points apart in awareness played
games identical to the character — 0.000 ± 0.000 over twenty thousand of them —
while awareness was fifteen per cent of what a corner costs. A back's
elusiveness measured 0.000 and his power 0.000, thirty-five per cent of his
rating between them, because both reached the field only through a break-tackle
term worth eight hundredths of a yard a carry, while speed nearly tripled the
breakaway rate and owned the long run behind a hard floor at the defence's
speed. Across the eleven positions, 9.5% of the average rating bought nothing
measurable.

So the weights could not simply be set to the measurement: that would have
priced power, elusiveness and every defensive awareness at zero and made them
decoration. They were wired in first. Awareness now reaches the field through
the thing it improves and its own group's — `covOf` and `fitOf`, so a smart
corner covers better and a smart front fits the run. Power resists the stuff,
which `stuffP` did not previously consult the carrier to decide. Elusiveness
has its own path to the long run. Measured after: RB `elu` 0.000 → 0.189, RB
`pow` 0.000 → 0.097, CB `awr` 0.000 → 0.078, S 0.000 → 0.064, LB 0.013 → 0.060,
DL 0.016 → 0.035.

**Centred on the wrong population, first time.** These terms centre so the rates
themselves do not move, and centring them on the pool's starting players —
elusiveness 89, defensive awareness 88 — halved the breakaway rate: mean run
4.61 → 4.15, explosive plays 3.66 → 3.30, points 43.1 → 41.5, three of
forty-four realism metrics outside the real league's range where none had been.
Every constant in `plays.js` was fitted against synthetic teams at mean 82, and
that is the population that has to hold still. Centred there they recover — mean
run 4.47, explosives 3.62, points 43.1, the baseline exactly. A league of
all-time greats then runs hotter than the reference, which is correct: they are
better than the reference.

**Then the reweight, and the second authority.** Setting the weights three
quarters of the way to the measurement took `npm run legacy` from 16 violations
to 31. The regression was not spread evenly: DL improved (gap 16 → 7) while QB
went 1 → 7, WR 0 → 3 and TE 0 → 3. The reason is legible in the flagged names —
strong-armed pre-merger quarterbacks, receiving tight ends, possession
receivers. The simulation rewards accuracy over arm, blocking over receiving at
tight end, and speed over hands and routes, more than the historical record
does.

That disagreement is the finding. Following the field blindly imports the
simulation's blind spots into the economy; ignoring it leaves clubs paying for
what does not win. So each position moves **as far toward the measured vector as
the record will allow**: the largest blend that leaves `legacy-check` no worse at
that position, floored at 0.05 so nothing on screen is purely decorative.

| position | blend taken | what moved |
| --- | --- | --- |
| DL | all of it | `prs` .40 → .55, `rsd` .35 → .27 |
| S | all of it | `cov` .30 → .38, `awr` .15 → .06 |
| P | all of it | `ppw` .50 → .69 |
| CB | 40% | `cov` .40 → .48 |
| WR | 40% | `spd` .20 → .27 |
| K | no change measured | — |
| QB, RB, TE, OL, LB | none | the record blocks it |

Five positions taking nothing is not a null result. It says the simulation and
the record disagree there, and names where: a tight end who is mostly a blocker,
a quarterback whose arm barely matters, a linebacker whose pass rush the field
does not reward the way history did. All twelve of the linebacker violations are
edge rushers and neither direction of reweighting helps them, because the
disagreement is in the simulation, not the formula. That is the next piece of
work, and it is engine work.

Safety awareness dropping to 0.06 is not the wiring being wasted. Before it, the
correct weight was 0.00.

**What it cost.** Run-stuffing nose tackles lose ground — Ted Washington 79 → 75
— because `rsd` fell with `prs` rising, which is what the field says. The
fingerprint moved twice: `64ff480a39db399a` → `01e4d68b83544a38` for the wiring,
then → `7cbe66ddb0bfd37c` for the weights, that second one with the log line
count unchanged at 48,315, because weights reach the log through `teamPower` and
the win-probability prior rather than through any play. Six tests broke across
the two changes and none was a regression: every one had pinned a fixture — a
seed, a slot, a pair of "equal" synthetic teams — that only held for one
particular engine. They search, or mirror, or check their premise now.

**Fictional names.** A settings toggle swaps every real name for a made-up one, one to one, chosen from the hash of the player's id and settled in pool order so it never changes between sessions or versions as long as the name lists only grow at the end and the pool stays append-only. Ids, ratings, saves and league codes are untouched; the real name is kept on the player so the switch reverses. Logs and records keep the names they were written with. Team abbreviations in the pool (the club a player's prime season was with) are left as they are. `applyNameMode` runs at boot from the preference, so a store build can default it to `fictional` by changing one line in `main.js`; the real names still ship in the data file either way, which is a licensing question this toggle does not settle, only sidesteps on screen.

### Two players, side by side (`ui/compare.js`)

The pool is fifteen hundred deep and every position rates on its own
attributes, so choosing between two backs meant opening one modal, holding six
numbers in your head, closing it and opening another. This is that decision on
one screen.

It is deliberately not a route. The button lives in `playerModal`, so every
place a player can be tapped — the pool, a roster, the draft board, the auction
room, a box score — starts one for free, and arming it is a two-tap gesture:
`Compare…` on one player, then `Compare with <name>` on the next. The pending
player is module state rather than app state, because a half-finished gesture is
not something a save should remember.

Attributes are mirrored about their own name, bars growing outward from the
centre, so the eye reads the difference as the gap between two bars rather than
as two lengths to measure separately. The side leading a row takes the accent.

**The fog is the constraint that shaped it.** `attrList` coarsens an unscouted
rookie's attributes on purpose and `ovrBadge` shows him as a range, because a
precise number is not scoutable before he plays. A comparison that subtracted
true ratings would hand back exactly what those two withhold — the same leak
that made list *ordering* rank on `shownOverall` rather than on the truth. So
every number here comes through `coarseAttrs`, the same path the player list
uses, a delta is computed from what is shown rather than from what is true, and
where either side is an estimate the row is marked with a tilde. The scouting
view is injected rather than read, which is what makes that testable.

Two smaller decisions worth recording. A row an attribute's owner does not carry
reads as absent, not as zero: a tight end has no pass rush, which is not the
same as being bad at it. And a verdict needs at least three shared attributes —
a back and a quarterback share only awareness, and "right leads 1–0 of 1" reads
like a finding while saying nothing, so the cross-position note about leverage
carries that case instead. Overalls of different positions are not the same
currency and the note says so: a running back is worth 9.39 against a
quarterback's 15.89.

The overall badge sits above the name rather than below it. With it below, a
name that wrapped to two lines pushed its badge a line clear of the other
player's, so the one pair of numbers most worth reading together did not line
up.

### Reachable without a mouse

The audit counted 154 buttons against 18 aria attributes, zero live regions and
one `:focus-visible` rule in the whole stylesheet, and the counts undersold it
in one direction and oversold it in another. Nothing anywhere sets `outline:
none`, so keyboard focus was never invisible, only unstyled and thin against
dark green. What the counts missed was worse.

**A player's name was a `<span>` with a click handler.** The player card is the
app's detail view — ratings, age, the decline curve, the rating editor — and it
is opened by tapping a name, in the pool, on a roster, on the draft board, in
the auction room, in the honours list. A span is not in the tab order and a
click handler does not fire on Enter, so from a keyboard that screen did not
exist. They are buttons now, styled back down to bare text so nothing looks
different.

**The modal made a promise it did not keep.** `aria-modal="true"` tells
assistive technology that nothing behind the dialog is reachable, and the
browser does not enforce that on its own: Tab walked straight out of the panel
into a page that was still scrolled to wherever it had been. Focus now moves to
the panel on open, cycles inside it, and goes back to whatever opened it on
close — that last part mattering most, because a card opened from the fortieth
row of the pool used to leave you at the top of the document.

**Nothing was ever announced.** The toast is the whole feedback channel — a deal
going through, a claim refused — and a `hidden` element is not announced, nor is
unhiding one reliably a change worth announcing. Rather than make the toast
itself a live region, `toast()` mirrors into a permanent one, so announcement no
longer depends on the visible toast at all. The live game goes through the same
channel: the play-by-play list redraws whole, so a live region on it would read
the entire log again every snap, and instead the newest play is said once.

A screen change moves focus to `#app`. A single-page app replaces the screen
without the browser doing any of the things that normally tell a reader so, and
moving focus is what stands in for that. Only on a real screen change: `mount`
runs on every state change, so doing it unconditionally would snatch focus away
each time a depth-chart arrow was pressed, which is worse than never moving it.

**Two bugs found by building it, neither of them about accessibility.**

The skip link went in as `id="skip"`, which is the id the draft screen already
uses for *Skip to my pick*. Two elements sharing an id is invalid, and the
lookups it breaks are exactly the ones assistive technology depends on. Nothing
noticed except a smoke click that timed out against an off-screen button.

So the smoke run now asserts an accessibility floor on every screen it already
visits: every rendered control has an accessible name, no id appears twice, the
live region is present and unmuted. On its first run it found `autoAll` twice in
the auction — one beside the roster, one in the panel shown while the room bids
on somebody else — which meant `querySelector` bound the first and **the other
was a button that did nothing when pressed**. That had nothing to do with
screen readers and had been shipped for a while.

Also here: the skip link is a `<button>` rather than an `<a href="#app">`,
because this is a hash-routed app and that href would set the route to `/app`,
match nothing, and bounce the player home.

Not done: colour-contrast measurement, a keyboard pass over the auction room's
bidding controls specifically, and `aria-current` on the active nav item.

### Contracts for the two modules that had none

`season.js` is the largest engine module at eleven hundred lines and had no test
file; `ratings.js` had none either, and holds the id-keyed cache that produced
the blind fingerprint. Both were exercised sideways by other suites — `overall`
appears in eighteen of them — but as a helper, with nothing asserting what it
promises.

What is pinned, in `tests/ratings.test.js`: that `overall` caches by id and
therefore hands one player's rating to a different object sharing it, which is
the trap rather than an accident; that `rawOverall` is the way out and treats a
missing attribute as 60; that a player carrying his own `ovr` never consults the
cache; that a lineup follows slot order and an injury moves the next man up;
that awareness now reaches coverage and run fits and is neutral at 82, the
population the engine was fitted against; that pass rush leans on the best two
rushers rather than the mean of four; and that team power weighs starters by
leverage and ignores the bench. In `tests/season.test.js`: the schedule
invariants — nobody plays himself, nobody twice in a week, eight clubs get a
clean double round robin with hosting split exactly, the pro slate is seventeen
games and one bye with a last week of nothing but rivalries — plus that a game
seed is fixed by league, season, week and both clubs, and that power rankings
sort and feel an injury.

**They were checked by breaking the code.** A test written against behaviour
that already passes proves nothing until something fails it, so five mutations
went in one at a time: stop reading awareness, count the bench, flatten pass
rush to a four-man mean, stop flipping home and away, drop the week from the
game seed. Four were caught immediately. **The bench one was not**, and the
reason is the trap the first test in the file is about: it bumped the bench
*after* reading the squad once, by which point `overall` had cached those ids
and went on answering 80 whatever the attributes said. The fix is a second
squad with its own ids. Worth recording because the cache defeated a test
written by someone who had just finished documenting it.

## UI

Vanilla ES modules, hash router, one persisted state object (`store.js`). Views re-render from state; the live game view manages its own DOM and autoplay timer. Everything is relative-path so it deploys to a GitHub Pages subpath. Service worker: network-first for HTML, cache-first for assets (bump `CACHE` in `sw.js` on every release or installed clients keep the old CSS).

Layout is phone-first and the page must never scroll sideways. Two rules keep it that way:

1. Any grid or flex child that can contain a scroller gets `min-width: 0`. Without it a wide table inside a grid cell refuses to shrink below its content and pushes the whole page wider than the viewport — this was the original mobile bug.
2. Player lists are not tables. `playerItem()` in `ui/components.js` renders a `.prow` grid that stacks name, meta and ratings on a phone and spreads into rating / name / attributes / action columns from 860px. Tables are reserved for standings and box scores, where they sit in a `.table-wrap` scroller and drop low-value columns under 560px via `.hide-sm`.

`teamChip(team, { responsive: true })` renders the abbreviation on a phone and the full club name from 560px, so scoreboards and matchup rows stay legible instead of ellipsised. The smoke test asserts no horizontal overflow on every screen at 360, 768 and 1280px and names the offending element when it finds one.

3. A screen re-rendered by a state change keeps its scroll position. `mount()` in `main.js` compares the view and its route params against the last mount and only jumps to the top when the screen actually changed. Every state change re-renders the open view through the same path a route change takes, so before this, moving one player down the depth chart threw you back to the top of a page four and a half screens long.

### What "Power" means (`teamPower` in `ratings.js`)

The weights were a guess — QB 3, everything else between 0.2 and 1.2 — and they measured like one. Against point differential from a full round robin across six leagues, `teamPower` came out at **r = 0.34**, while being printed on the team page as "Power", used to rank clubs in the pulse, used to set what an owner expects of you in `jobs.js`, and — the part that actually mattered — fed into `priorMargin`, which is the prior the live win-probability model starts every game from.

It is weighted by `TRUE_LEVERAGE` now, the table this game already measured for exactly this question by boosting a position on an otherwise equal roster and taking the extra win rate. That takes it to **r = 0.56**. The same regression put a point of power at 3.25 points of margin against the 3.3 `winprob.js` was already using, so that constant did not move and the calibration test still passes.

The table lives in `ratings.js` and is re-exported from `auction.js`, where it is documented: `auction.js` imports `overall` from `ratings.js`, so the other direction would have been a cycle.

Two things worth being clear about. It is still only r = 0.56 — one number over a whole roster cannot capture a matchup, and the rest is the simulation's own variance; the claim on the team page is "this squad is stronger", not "this squad wins". And the reweight changes no game: 120 seeded games across four roster gaps hash identically on scores and play-by-play before and after, with only the win-probability annotations moving, which is why the fingerprint went from `a9480bd47f40cac9` to `e27d59dbc5d3340e`.

### The draft board (`ui/draft-board.js`)

Both rooms used to hide most of themselves. The snake draft applied the other clubs' picks inside one silent state update — seven of them in a fantasy league, thirty-one in a pro one — and left a twelve-line ticker as the only trace. The auction ran `advanceToUser` to the next thing it needed from you, which at the default ask of 85 is most of the lots, also in silence. A draft is a thing you watch; neither could be watched.

One component serves both, because the shape is the same: clubs across the top, what they have taken stacked underneath. In a snake draft a row is a round and it lines up exactly, since every club picks once per round. In an auction clubs buy at different rates, so a row is the Nth man that club bought and a column is read down rather than across; cells there carry the price. Cells show a surname, because a full name wraps to three lines and a board that cannot be read at a glance is not a board. Ratings on it go through `shownOverall`, so an unscouted rookie is not given away here.

**Columns follow the draft order, not the team list.** This is the difference between a board and a puzzle. `draft.order` is a shuffle of the club list, so laying the columns out by team index puts the picks made so far all over the board with gaps between them — twenty picks in, a player counts eight filled cells scattered across thirty-two columns and reasonably concludes the draft is broken. In draft order the filled cells run left to right and the board reads the way a draft board is supposed to. The smoke test asserts round one has no gap in it, which is the shape that fails if this regresses.

**It opens full screen.** A 32-club board is 27 rounds by 32 clubs and spent its first version in a banner a few centimetres tall showing four columns. It lives behind a button now and takes the whole viewport when opened, while the draft carries on behind it; cells shrink there so six or seven clubs are on screen at once rather than four. Opening it deliberately starts at the left rather than flinging you to the live pick — `scrollToPick` follows the action only when a pick actually lands — and your own column is tinted so it can be found among thirty-one others.

**The pacing.** `stepAiPick` is `runAiPicks` with the loop lifted out to where a screen can put time between iterations — same engine, same seeds, same draft, and a test asserts pick-for-pick that the paced room and the burst produce identical results. The draft view is self-rendering, like the live game view, and owns the timer; the auction is not, so its timer lives at module scope and survives the re-mounts the store drives, with the view's teardown cancelling a tick that would otherwise fire into a screen the player has left. Speed is slow, normal, fast or instant, shared by both rooms and remembered in preferences, because 864 picks at a watchable pace is several minutes and the way out has to be one tap. "Skip to my pick" is the other way out. `prefers-reduced-motion` drops the landing flash to a border and caps the tick.

Two things the pacing cost, both found by driving it in a browser rather than by reading it. The player list is now built only when it is the human's turn — sorting a thousand rows on every 180ms tick is the one thing that makes the room stutter. And a pick made by the human needs its own redraw: `run` only draws when it is about to stop, so without one your own selection sat unshown until the next AI pick landed.

### The nav, and forms you can finish

**A phone navigates from the bottom.** Five destinations within reach of a thumb, which is where an installed app puts them and where a hand actually is. `renderTabs` in `main.js` ranks the destinations by a `tab` field rather than by the order the top strip lists them, so a game in progress jumps the queue on the phone without moving in the bar above; anything past the fifth slot folds into the same More menu the top strip uses. Icons are inline stroked SVG on a 24 grid, the way the win-probability and drive charts are drawn, so there is nothing to fetch and they take the colour of the text. The top strip stays from 700px up, because a row of pills along the top is right for a wide screen and a bar pinned to the bottom of a monitor is not.

Sub-screens light the destination they were opened from: a box score and your coaching career light Season, the guide lights Home. A tab bar that goes dark whenever you open something is a tab bar that has stopped telling you where you are.

Three things about it are load-bearing and easy to get wrong. The tab bar, the form action bar and the toast all want the bottom of the screen, so they stack — the action bar sits on the tab bar's height plus the safe area, and the page carries padding for both. Those adjustments live at the *end* of the stylesheet, because a media query adds no specificity and `.actionbar { bottom: 0 }` declared later simply won, dropping the form's button underneath the bar. And the More menu had to move out of `<header>` in the markup: `.topbar` has `backdrop-filter`, which makes it the containing block for any fixed-position descendant, so a menu anchored to the viewport was anchored to the bar instead and opened off-screen. It is positioned from JavaScript now, against whichever button opened it — below a top-bar one, above a bottom-bar one — since only the runtime knows where the safe area leaves them.

**Whatever does not fit the top strip goes into a menu.** The strip is `overflow-x: auto`, so nothing was ever strictly unreachable — but a nav bar that scrolls sideways does not look like one, and there was no fade or arrow saying so. Measured at 360px with a league open, 340px of items sat in a 309px strip and Settings was simply off the end; in a pro season Awards and Players went with it. `fitNav()` in `main.js` measures the bar after every render, hides items from the right until it fits, and puts the spilled ones in a "More" menu pinned to the right-hand edge. Measured across a 32-club season: three of seven items on the bar at 360px, four at 412px, all seven with no button at 768px and above. Two rules it keeps: the page you are currently on never gets hidden (a nav that hides where you are is worse than one that scrolls), and the bar is refitted on resize so turning a phone sideways brings items back. The smoke test checks on every screen that bar plus menu accounts for every item, that the strip is not overflowing, and that the active item is on it.

**A form's primary action is pinned to the bottom of the screen.** Every field on the setup form has a working default, so a first-time player could always have pressed Create league immediately — except it sat 1.6 screens down and nothing said so. `.actionbar` is fixed to the viewport, and the view carries `has-actionbar` for the clearance underneath. It measures 0.9 screens now, which is to say on screen at every width, and the smoke test asserts that rather than printing it as a note the way it did for weeks.

Two details worth keeping. The bar is `position: fixed` rather than `sticky`, because it is the last thing in its form: a sticky element with nothing below it in its container has no range to stick over and simply sits where it falls, which is exactly what the first attempt did. And the clearance belongs to the whole view rather than the card — the bar is fixed to the viewport, so it also covers the league-code block below the form, which is how the smoke test found it.

### The team page

Measured at 360px, the old single-scroll team page was 3,341px — and the depth chart, which it is named for, was only 1,831px of that. The rest was chemistry, the injury desk, five strategy sliders and the unit ratings stacked underneath. So it is four sections behind tabs (`#/team/:idx/:tab`, the tab kept module-level and mirrored in the route the way `moves.js` does it): Depth, Squad, Injuries, Strategy. The depth tab is 2,906px with ratings shown and 2,329px compact; the other three are about one screen each. Tabs apply at every width, because a desktop had the same long scroll with a sidebar next to it.

Within the depth chart, twenty-seven rows get position group headers — name, how deep the group is, the best man in it, and a marker for an empty slot or an injury, which the rows themselves only reveal once you have scrolled to them — plus a sticky jump bar of position chips. The chips are buttons calling `scrollIntoView`, not links: this is a hash router and `href="#pos-OL"` would be read as a route. A group near the bottom cannot reach the top of the viewport because there is nothing below it to scroll up into, so the smoke test only asserts it comes into view.

Two smaller things fell out of the measurement. `showAttrs` had been in the preferences since the beginning with nothing reading it; it is now the depth chart's density toggle, worth 577px. And `playerItem()` grew a `pos` option, because on a screen already grouped by position — with the slot badge saying which one he is — a third copy of the position next to the name only wrapped it onto a second line.

The four section tabs come to 339px at the default `.tab` padding, which is 3px more than a 360px phone has, so `.tabs.sections` trims it; and the injury tab carries a dot rather than a count, since " (3)" put the strip back over the edge. Placing a man on injured reserve navigates to the Injuries tab, because otherwise he vanishes from the depth chart and reappears on a screen you are not looking at.

### Reading order is DOM order

A two-column `.grid-2` collapses to one column under 820px, so on a phone the **whole** first column renders before the **whole** second. That is easy to forget and it quietly broke the season hub: a 32-club league lists sixteen matchups, and with the slate, the table and the full schedule filling the first column, every decision on the screen — trade offers with a deadline, injured players, the owner's patience, the simulate-ahead buttons — sat below them. The app had started apologising for its own layout with a toast reading "2 clubs have trade offers for you", because the card saying so was off-screen.

The columns are therefore split by **purpose, not by size**: what you act on first (playoff bracket, roster moves, injuries, the weekly pulse, the owner, simulating ahead), what you read second (the week's slate, standings, leaders, power rankings, the full schedule, history). A slate of more than six games folds into a `<details>`, since it is reference rather than a decision and your own game already has its own card at the top.

The smoke test asserts the ordering rather than trusting it, by reading the rendered card headings and checking the actionable ones come first.

### A form nobody reaches the bottom of

Setup had grown to fourteen sections, five of them added in one run of feature work, each with a paragraph of explanation. On a phone the first screen ended in the middle of naming your club. The options with sensible defaults — injuries, keepers, ageing, chemistry, scouting, coach mode — now sit behind one **More options** fold, and the prose above it was cut to what you need to choose with rather than everything true about the choice.

Measured at 360×780, the Create league button moved from roughly four screens down to **1.6**. The smoke test prints that number every run and fails past 2.6, because this is the kind of thing that creeps back one paragraph at a time.

## Roadmap: ten audited recommendations

Each item names the evidence in the current build, what it touches, and the
risk. They are ordered by how much they would change whether someone plays a
third season, not by effort.

1. **In-season roster moves: free agency, waivers, trades.** *Shipped; see Transactions above.* Evidence at the time: rosters freeze the moment the draft ends. An 8-team fantasy league drafts 208 of 1,269 players and the other 1,061 sit idle; between games there is nothing to decide but strategy sliders. Touches `season.js` (a transaction log, a free-agent pool view, AI trade evaluation using the auction's `worth` table). Risk: AI trade logic is easy to exploit; gate AI acceptance on measured value with a margin, and log every deal so it can be audited.

2. **Injuries and a bench that matters.** *Shipped; see Injuries and depth above.* Evidence at the time: `game.js` has no attrition model; a 17-game pro season ends with the same 22 starters it began with. RB2 takes 28% of carries and WR4 a few targets; every other bench slot never plays. Touches `game.js` (per-play injury chance scaled by position and pace, a `weeksOut` field), `positions.js` (QB2, DL5, LB4, CB3 slots or a flex bench), depth-chart UI. Risk: injury luck can swamp skill in a 13-game season; keep rates below the real league's and let the user set the dial.

3. **A dynasty loop: contracts, keepers, an offseason.** *Shipped; see Dynasty loop above.* Evidence at the time: `newSeasonSameRosters` replays the same roster forever, and `history` records champions but nothing else changes year to year. Auction prices are the natural contract: each purchase is a 1 to 3 year deal at that price, expiring players return to the pool, draft order runs worst to first, and the cap carries over. Touches `auction.js`, `season.js`, a new offseason phase and view. Risk: the pool is one snapshot per player, so there is no aging; contracts and re-drafts have to carry the sense of change instead.

4. **Penalties.** *Shipped; see Penalties under the simulation model.* Evidence at the time: the play log has never shown a flag, and `DESIGN.md` lists it as a known gap; the real league averages about a dozen per game and they decide drives. Touches `game.js` (false start, holding, pass interference, offsides, with rates tied to awareness and pressure) and the clock rules. Risk: cheap to add but changes every calibration number in this document; re-run `npm run calibrate`, `npm run auction` and `npm run strategy` afterwards.

5. **Pro-mode fidelity.** *Shipped; see League above.* Evidence at the time: the 17-game slate is structurally right but uses a rotation where the real league uses last season's standings for two of the games; there are no bye weeks; tiebreakers stop at conference record (no common games, strength of victory or schedule); the standings page has no clinch or elimination markers. Touches `buildProSchedule` (18-week calendar with byes, standings-aware pairings from season two), `makeComparator`, `proStandings`. Risk: byes break the "every week has 16 games" invariant that the tests lean on; write the new invariant first.

6. **Live game presentation.** *Shipped; see Live game presentation above.* Evidence at the time: the game view is a text log with a scoreboard and a field bar; there is no win-probability line, no drive chart, no quarter summary, and no highlight reel at the end. The engine already exposes drives and every play's yardage and result. Touches `game.js` view only, plus a small win-probability model fitted from simulated games. Risk: none to the engine; the `dataviz` skill should drive any chart.

7. **Awards, records and a hall of fame.** *Shipped; see Awards above.* Evidence at the time: `seasonStats` and `history` already hold everything needed, and the completion screen shows only the champion. MVP, offensive and defensive player of the year, all-league teams, single-season and career records per franchise. Touches `season.js` (a `records` structure) and the completion view. Risk: low; the leverage table decides MVP weighting, so a quarterback wins most years unless the formula corrects for position.

8. **Smarter AI general managers.** *Shipped; see AI general managers above.* Evidence at the time: personalities are static presets; AI clubs never change a strategy slider, never revisit a depth chart after the season-start sort, and never respond to what beat them last week. Touches `playcall.js` (per-opponent adjustments: blitz more against a weak line, run against a weak front) and a weekly AI housekeeping pass. Risk: a smarter field narrows the strategy spread measured in the auction section; re-measure and keep the spread near four wins.

9. **Save slots and shareable leagues.** *Shipped; see Save slots and sharing above.* Evidence at the time: `store.js` holds one league under one localStorage key; a second league overwrites the first, and export/import is the only backup. Because every game is seeded, a league is reproducible from its seed and pick history, so a short share code could rebuild a league on another device and a roster card could be rendered to an image for sharing. Touches `store.js`, settings view, a canvas renderer. Risk: the players file must stay byte-identical for codes to replay; version the code with the data file's hash.

10. **Rating tooling and a fictional-name toggle.** *Shipped; see Rating tooling and names above.* Evidence at the time: 310 of 1,269 players are from the 2010s against 32 from the 1950s; every rating is editorial; the README carries a licensing caveat for real names on a store listing. An in-app rating editor with a diff export, an era-balance report, and a switch that replaces names with generated ones would let the pool be argued with in public and keep a Play Store build clear of the name question. Touches `players.js` loading, settings, `scripts/db-report.mjs`. Risk: the fictional names must map one-to-one and stay stable across versions or saves break.

## After the ten

The roadmap above is finished. What followed, and what is left:

11. **AI clubs offer you trades.** *Shipped; see Transactions above.* The market only ran one way: the human could ask, but no club ever called.

12. **Injured reserve.** *Shipped; see Injuries and depth above.* A long injury was a dead roster slot, so the only answer to a season-ending knee was to cut the player.

13. **A replayable share code.** *Not built; replaced by 14 after the audit below.* The code is a snapshot of a league at the start of a season, which is enough for a friend to play the same rosters. Turning it into a true replay is not blocked by determinism: the league seed, every game seed and the RNG state are already stored, and the only unseeded values are the league id and creation time, which a snapshot fixes. The cost is elsewhere.

   A replay log would have to carry every human decision in order: about twenty-five league-level ones (nominations, a maximum bid on each of 208 to 864 auction lots, claims and cancels, proposed trades, accepted and declined offers, keeper picks, injured-reserve moves, slider changes, depth-chart reorders, and the choice to play or sim each week), plus every coach-mode call, which is roughly nine hundred entries in a fourteen-game season. That is a log format, a size problem, and a versioning story.

   The versioning is the real objection. A replay is only valid against the exact engine that produced it, and the constants move: penalty rates, injury rates, replacement level, general-manager greed, the keeper raise and the offer gate all changed while the ten items were being built, each one re-measured. Every such change invalidates every stored replay, so the feature would need a frozen engine version per code and a migration path, for a payoff the snapshot already mostly delivers.

   What the idea was actually for, two people playing the same league and comparing, is served instead by the season card below.

14. **Season cards.** *Shipped.* A card is a pasteable code carrying one club's finished season: its record, where it finished, how far it went in the playoffs, the champion, the MVP and its own three biggest fantasy seasons. Around 400 characters. It is stamped with a fingerprint of the league it was played in, which is the seed, the mode, the number of clubs, the season number and the player pool, so two cards from different leagues are refused rather than quietly compared.

   Everything a card needs is written into the history entry when the title is decided, not read from the live table, so a card survives into later seasons and does not depend on any engine constant. That is the whole point of choosing it over a replay: retuning the simulation cannot invalidate a card.

   The comparison orders two seasons by winning the title, then how far each club went, then the table, then wins, then point differential, and says which of those decided it. A dead heat says so. The screen shows the row-by-row table alongside, and notes whether the same club won it in both, which is the interesting question when two people play the same rosters.

   One property to know about, because it looks like a bug and is not: every game seed derives from the league seed, season, week and matchup, so two people who open the same code and decide nothing get *identical* seasons down to the point totals, and the comparison correctly reads a dead heat. The comparison measures decisions, not luck, which is the point of holding the rosters fixed. Measured on one shared league: two passive runs both finished 4-10 with 405 points for; moving the second back ahead of the first on the depth chart, and nothing else, finished 6-8 with 432, and the league around it diverged too, thirty-five transactions instead of thirty-two. A test holds both halves of that.

Smaller items that did not make the list: an 18-week pro calendar (folded into 5), two-minute-drill timeouts for the coach-mode user, a compare-players view, keyboard and screen-reader passes on the auction room, and an in-app explainer for what actually wins games (the leverage table is documented above, not surfaced in the product).
