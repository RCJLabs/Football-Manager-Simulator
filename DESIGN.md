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

Run: stuff chance from run stop vs. run block (+RB vision against the front's awareness, power against its run stopping); otherwise base gain + blocking edge + break-tackle chance (power/elusiveness vs. tackling) + breakaway chance (speed vs. secondary speed, elusiveness vs. tackling). Every term that reads the carrier reads him against his opposite number, at `CARRIER_WEIGHT` — a fifth, measured against real carries (see "The back was worth nearly three times too much"). QB sneaks on 4th-and-1. Fumbles scale with ball security and tackling.

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

**A convergence worth noting.** Strengthening the run — `RUN_IN`, `RUN_OUT` and a lower `STUFF_RATE` — fixed a strategy problem as a side effect. The pass/run dial used to reward maximum passing at every setting; on a balanced roster it now peaks at 0.65 (+0.21 points against a flat 0.55) and turns back down at 0.70 (−0.18), and a run-tilted roster wants 0.35. Re-measured after the tuning above with `scripts/gameplan-sim.mjs` and a 600-game-per-cell sweep. A dial with an interior optimum is a decision; a monotone one is a tax on anybody who doesn't know to max it. (That was the engine of the time, in mirror matches. The play model has changed since, and against real AI clubs the dial is now two-ended — see **The pass/run read**.)

Leverage, measured by boosting one position group 8 points on an otherwise equal synthetic team: QB → 69% wins, WR → 66%, RB/OL/DL → 62%, LB/CB → 61%, S → 58%, K → no effect on win rate. Boosting every group by 2 points wins ~78% because the effects stack. In a snake draft with the value-over-replacement AI, total talent equalizes (team power spread ≈ 1 point), so AI-vs-AI seasons are close to coin flips and the user's edge comes from out-drafting the AI and from strategy. Constants to reach for when tuning: `baseComp`, `baseInt`, `yacMean`, `stuffP`, the run `base` normals, `pressureP`, and the `edge()` k values (bigger k = flatter response to rating gaps).

### Penalties (`penalties.js`)

Every play can draw a flag, and the rates are tied to the people on the field rather than rolled flat. A line with low awareness false-starts and holds; a defense that is being beaten holds and interferes; a blitzing front jumps early; the away side false-starts a little more. There are two shapes of flag, which is what keeps the stat lines honest:

- **Instead of a play.** False start, delay of game, offside and neutral-zone infractions are dead-ball fouls: five yards, replay the down, no play run. Offensive holding is rolled before the snap is resolved and wipes the play (ten yards, replay the down), which is statistically the same as a nullified play and avoids un-crediting a run that never counted. Pass interference (a spot foul, the 1 at most, never a score) and defensive holding or illegal contact (five yards) replace an incompletion with an automatic first down; the pass attempt and the target are taken back.
- **Added on to a play.** Roughing the passer, unnecessary roughness and a facemask are enforced from the end of the play with an automatic first down; the play stands. Holding on a kick or punt return takes ten yards off the return, never behind the catch.

Half the distance to the goal applies everywhere. Flags stop the clock, and a nullified play does not count as a play. Kick-return holds aside, a flag names the player: the offensive lineman with the lowest awareness is likeliest to be the one holding, the beaten defender the one interfering.

Measured on synthetic equal teams (300 games): 9.6 flags and 79 penalty yards a game across both clubs, against the real league's roughly 12 and 100. The mix: false start 2.1, holding 2.0, pass interference 1.0, offside and neutral zone 1.1, defensive holding and illegal contact 0.9, kick-return holding 0.9, roughness and facemask 0.8, delay of game 0.5, roughing the passer 0.3. The rates live in `RATES` in `penalties.js`. Penalties are on by default and can be turned off per league in settings; the engine takes `penalties: false` for calibration work. Not modeled: intentional grounding, illegal formation, taunting, penalties on scoring plays (enforced on the kickoff in real football; here a touchdown simply stands), and the free-play offside where the offense gets to keep a big gain, which is folded into a dead-ball whistle.

## The auction (`auction.js`)

The snake draft had a structural problem: it hands every team a full roster from the
same pool in alternating order, so total talent equalizes. Measured over 48
simulated seasons (`npm run auction 48`), the best-built roster in a snake-draft
league wins 7.2 of 14 and the worst-built 6.6 — well under a win apart; under the
auction it is 8.5 to 6.2, about two wins. The central activity of the game had
almost no consequence.

This used to say "nearly three wins (8.6 to 5.9)", from twelve seasons, and the
audit held that figure to within 0.4. At twelve leagues it is the average of
twelve teams' records, which moves by about half a win from nothing but a
reshuffled random stream: an injury change that drew one extra number per
injury took it to 9.1, while two 48-league samples either side of that change
read 8.2 and 8.5. So the audit now holds the thing the auction produces before a
ball is snapped, which no in-season randomness can move — the spread of roster
quality, leverage-weighted: a standard deviation of 37.0 under the auction
against 26.9 from the draft, over the default twelve leagues.

"Leverage-weighted" meant a table of its own until 2026-09-24: `auction-sim`
carried a literal copy of the very first measurement (tight end 9.3, back 5.0)
through both re-measurements, so the check weighed rosters by a table the game
had thrown out and moved only when the auction's own bidding did. It reads the
shipped table now. Weighed that way, the table before the back's rise gave 43.8
against 29.0, the one after it 41.1 against 30.2, and the one set once the run
game matched real carries 37.0 against 26.9: the auction still spreads rosters
about a third more than the draft does, where on the oldest of those it was
half again more.

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

**Which positions are actually the bargains**, on the table as it stands (set on 2026-09-24 once the run game matched real carries; see "The back was worth nearly three times too much"):

| | QB | CB | TE | S | OL | LB | RB | DL | WR |
|---|---|---|---|---|---|---|---|---|---|
| Wins share | 33.3% | 9.9% | 10.0% | 6.2% | 4.7% | 6.4% | 11.2% | 5.9% | 6.5% |
| Price share | 22.5% | 6.9% | 9.3% | 5.9% | 4.9% | 7.3% | 15.7% | 9.3% | 14.7% |
| Value | 1.48× | 1.45× | 1.08× | 1.05× | 0.96× | 0.87× | 0.72× | 0.64× | 0.44× |

Cheap is not the same as underpriced, which is where the intuition goes wrong: linemen have low glamour and low leverage together and come out overpaid. The quarterback and the corner are the bargains; receivers, the defensive line and the back are the traps. For a few hours on 2026-09-24 the back was the one clear bargain at 1.69×, on a table that was right about an engine whose run game was wrong. The strategy table below agrees independently — the trenches-first buyer has never beaten the value shopper.

One limitation to carry openly: this is an average across a position's starters, and where a position has several the first is worth appreciably more than the average. Measured solo over the same six rosters, a number one receiver is worth 2.14 against the positional average of 1.12 — nearly twice. The value panel says so.

Measured over twenty-four 8-team leagues with the human team following fixed
strategies, on the current 1,500-player pool with the 27-slot roster, injuries
at the default setting and penalties on:

| Strategy | Wins of 14 | Point differential | Average finish of 8 | Titles of 24 |
|---|---|---|---|---|
| Value shopper (bid 1.15× true worth) | 8.8 | +61 | 2.9 | 8 |
| Stars and scrubs (2.4× asking for anyone rated 93+, $1 for the rest) | 7.8 | +18 | 3.4 | 4 |
| Trenches first (1.7× worth on the lines) | 6.5 | −12 | 4.9 | 0 |
| Skill players first (1.5× asking at QB/RB/WR/TE) | 5.3 | −49 | 6.4 | 1 |
| Spread it evenly | 5.0 | −72 | 6.4 | 0 |
| Market follower (pay the asking price) | 4.8 | −74 | 6.4 | 0 |

Re-run on 2026-09-24 after the run game was measured against real carries and the table re-set with it. Value shopping reads 8.8, the best it has measured; skill players first falls from 6.4 to 5.3 and trenches first rises from 5.8 to 6.5, which is the back being worth a third of what he was. Earlier the same day, paired on the same leagues, the table that had the back at nearly a quarterback took value shopping from 7.3 to 8.2 over the one before it — right about an engine that was wrong. Every correction to the worth table so far has made the strategy bidding off it better, which is what a more accurate table should do. Twenty-four leagues is a small sample and the ordering is stable across runs while the individual numbers move by a few tenths.

About four wins separate reading the market from following it, so how you bid is
still the main thing that decides a season.
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

The auction's mispricing was the most interesting thing in the game and it was documented here and nowhere in the product. A first-time manager faced $200 over 1,500 names with no way to know a kicker is worth less than a tenth of a quarterback, and the only way to find out was to lose a season to it.

It is positional, never per player. Showing what an individual is worth would hand over the answer and delete the auction; showing which positions the room underpays is a strategy you still have to execute under a budget, against nine other bidders, with the best names gone by the time you commit. There is no per-player worth figure anywhere on screen.

Everything is derived from `positionValue()` at render time rather than written into the view, so retuning a leverage number moves the panel with it and it cannot quietly start teaching something the simulation no longer does. A test asserts the derivation against the tables directly for exactly that reason.

It appears as a collapsed panel in the auction room and the draft room — closed by default, with the one-sentence version in the summary, because both screens are busy and the reader is mid-decision — and as a standalone page at `#/guide`, linked from the home screen so somebody can read it before they have a league to ruin, and from settings for later.

The page also carries the three things the table cannot show: that bench slots are insurance rather than luxury, that a rating is not a career now that players age, and that chemistry is worth about two home-field edges. A live per-position read of the market as the auction runs stood here as "not built, and closer to giving the answer away". It is built now — see **What losing a lot costs you** — and the worry turned out to be misplaced, because what it reads out is the shape of the board, which is already on screen. What is still deliberately withheld is any estimate of what a rival would bid.

## Draft AI (`draft.js`)

Value over replacement: for each position, the replacement level is the overall of the Nth-best available player where N is the league's remaining demand at that position. Pick = highest (overall − replacement) × positional impact multiplier (`POS_BASE`: QB 2.6, RB 1.15, CB 1.1, WR 1.0, DL 0.9 … K 0.5, P 0.35 — hand-set, not the measured leverage table, and checked against it by wins under "The draft's position weights") × GM personality weights (+ era bias for Old School / Analytics) + noise. Kickers and punters are held until the last three rounds unless forced. A slot-count guard guarantees every roster fills.

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
worth, so every roster is part bargain and part rookie deal. It has drifted
further over since: 120% at founding on the table before 2026-09-24, 122% on
the one set that morning and 119% on the one set once the run game matched real
carries (`npm run cap -- 1 4`), with the cap left where it was for the reasons
under "Twenty-five seasons in".

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

### Twenty-five seasons in, and why the cap does not grow (`npm run cap`)

Eight seasons was as far as the cap had been measured, and a dynasty runs longer. What changes after that is the talent: the all-time greats age and retire, generated classes take their places, and the men nobody drafted stay frozen at their prime until somebody signs them. A fixed cap over a league like that could loosen into decoration or tighten into a wall, and growing it every year, as the real league does, was proposed to deal with it. It was measured first.

Four 32-club leagues, every club run by the AI, read at each of 25 kickoffs, means over the leagues:

| season | hit | clubs within 5% of the cap | rosters at market | starters | generated | cut at kickoff | free agents, paid over asking | rookie deals, paid over market |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 102 | 0 | 120% | 87.4 | 0% | 0 | — | 0.43× |
| 2 | 139 | 1.5 | 112% | 84.9 | 13% | 0.3 | 1.65× | 0.55× |
| 5 | 174 | 6.5 | 100% | 81.8 | 23% | 2.3 | 1.60× | 1.78× |
| 10 | 178 | 7.5 | 81% | 77.1 | 48% | 1.3 | 1.87× | 1.64× |
| 15 | 185 | 13.5 | 74% | 76.5 | 82% | 9.3 | 1.84× | 1.66× |
| 20 | 181 | 14.8 | 72% | 76.3 | 93% | 5.0 | 1.87× | 1.50× |
| 25 | 183 | 14.0 | 71% | 76.1 | 97% | 6.3 | 1.69× | 1.48× |

**The cap never stops binding.** From season four to twenty-five the league spends 173 to 186 of 200 (one league's mean went as low as 164 and as high as 190), a fifth to a half of the clubs sit within 5% of it, and clubs are shedding men to fit at nearly every kickoff. Nothing about it drifts loose.

**The talent under it drifts a great deal.** Starters fall from 87 to 76 by season twelve and stay there, and by season twenty 93% of the league is generated. Priced at `marketSalary`, a roster that cost 120% of the cap at founding costs 71% of it. The cap binds anyway because the market takes up the scarcity: free agents sign for 1.5 to 1.7 times asking in the first five seasons and 1.7 to 1.9 times from season ten on — sealed bids for the same few names — and men on rookie deals go on costing 1.4 to 1.8 times what they are worth, the premium already measured and accepted above when the scale was fixed to read its own draft. The price of talent floats. The cap does not need to.

**So the cap does not grow.** Nothing in this game grows — there is no revenue and no money model — so a rising cap would be inflation and nothing else. Salaries would have to rise with it or it would stop binding, and then its one real effect is that every contract already signed gets cheaper against the cap each year: a subsidy to whoever holds long deals. At 5% a year a five-year deal costs about 9% less in real terms and a three-year deal about 5% less, on top of `TERM_PRICE`'s 0.92 against 1.04. That is the lever the contract-length work spent itself balancing, when five years won at every age. Re-fitting the length prices to absorb it would bring every decision back to where it is now, with larger numbers. That much is arithmetic. Not measured: whether it would flip the closest calls in the length table — it can only push them toward longer deals.

The founding season is its own economy, which the table also shows. A draft of all-time greats on rookie money is a 57% discount on what they are worth, so hits start at 102 and take four seasons to reach the level they then hold for twenty.

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

Measured on the 8-team auction league (`scripts/moves-sim.mjs`, 12 seasons, injuries off): AI clubs land about two claims a season between them, worth about +8 lineup strength per club, because the pool left after an auction is the talent tail and few swaps clear the +2 overall bar. With injuries at the default setting the same clubs file about eleven a season, most of them cover for a starter lost for the year: the wire is an injury market first. On 4,000 random one-for-one offers the AI accepted 29%, and on every accepted deal the human had given up the higher-rated player; the AI gained +12 of **lineup strength** on average and the human lost 14. Those are model units and not points — see **What `lineupStrength` is worth** for how far they can be trusted on a single deal, which is less far than one decimal place implies. That is the intended shape: an AI club cannot be talked into a bad trade on its own yardstick. What it does not rule out is a trade that is even on the overall-based yardstick but not in the simulation — a receiver whose overall is carried by an attribute the play resolution weights lightly. That stood unmeasured for a long time and is measured now; see **Is the yardstick sound** below.

### Is the yardstick sound

Every market in the game — trades, the waiver wire, keepers, the auction advice — prices a player as `overall` weighted by his position's leverage. DESIGN.md carried a caveat about that for a long time: a player whose overall rests on an attribute the play resolution weights lightly would trade even and play worse, and nobody had checked. Checked now, and the answer is that the yardstick is sound.

**How it was measured** (`npm run yardstick` and `npm run yardstick-fit`). Put one man into an otherwise identical synthetic team, play a few hundred games against a fixed opponent, record the points that team scores. Do it across the whole rating range at a position, and correlate production against `overall`.

One man swapped into an otherwise fixed side, 24 men a position. The sample is
stated per row because it has to be: at 250 games this table said things that
were not true, and the 250/500 swing column is why.

| position | `overall` vs point differential | games | swing, 250 vs 500 | differential, worst to best |
| --- | --- | --- | --- | --- |
| QB | **r = 0.988** | 500 | 0.005 | 22.0 |
| CB | **r = 0.984** | 500 | 0.034 | 7.7 |
| OL | r = 0.972 | 1500 | 0.065 | 3.6 |
| S | r = 0.956 | 1500 | 0.064 | 3.4 |
| DL | r = 0.952 | 1500 | 0.136 | 3.9 |
| LB | r = 0.928 | 1500 | 0.132 | 2.7 |
| RB | r = 0.889 | 500 | 0.000 | 7.7 |
| TE | r = 0.889 | 1500 | 0.105 | 3.9 |
| K | r = 0.872 | 500 | 0.013 | 2.1 |
| WR | r = 0.722 | 1500 | 0.197 | 4.2 |
| P | r = 0.425 | 1500 | 0.590 | 0.8 |

**`overall` is a better guide than this file has ever claimed, and the reason it
looked otherwise was sampling.** Nine of eleven positions sit at 0.87 or above
once measured properly. An earlier version of this table, run at 300 games,
reported the line at 0.844, the defensive line at 0.872 and the tight end at
0.810; at 1500 those are 0.972, 0.952 and 0.889. Every one of them was being
dragged down by noise, and the ordering the table implied was largely an
artifact of which positions happened to draw a bad sample.

**The swing column is the part to keep.** It is the difference between the same
measurement at 250 games and at 500, and it ranges from 0.005 at quarterback to
**0.590 at punter**. Any row with a swing above about a tenth was never saying
anything at 300 games, and three separate conclusions in this repo's history —
about the line, about the corner, about the receiver — were drawn from rows in
exactly that state. A correlation quoted to three decimals without a stability
figure beside it is a number pretending to be a measurement.

**Two positions are genuinely poorly predicted, and they are the two the fewest
decisions turn on.** The receiver reads 0.722 and the punter 0.425. The punter's
is barely a measurement at all: he is worth 0.8 points from worst to best, which
is close enough to the noise floor that the correlation cannot settle even at
1500 games a man. The receiver's is real, and it survived being chased — see
below.

**No weight move rescues the receiver.** Three receivers share the field, his
`cth` and `rte` are 0.97 correlated in the shipped pool so half his formula is
one number, and `rac` predicts him better (0.732) than `overall` does while
carrying the lowest weight of the four at 0.19. That looks like an obvious
mis-pricing and it is not a free one. Shifting weight from the hands pair to
`rac` moves the correlation by at most 0.03 and costs the record every time:
`rac` at 0.27 puts three receivers into violation, at 0.35 it is five, and
raising `spd` instead costs three and makes the correlation worse. The shipped
vector is the only one on that line that leaves `legacy-check` where it is, so
it stays — the same verdict the tight end got, reached the same way.

**The instrument was blind to half the team, and that is why the corner looked
broken.** This harness swaps one man into a fixed side and scores him, and until
now it scored him by *the points his own team put up*. That is the whole story
for a quarterback and almost none of it for a defender, who does not score
points: he stops them. Split out, the signature is unmistakable — a defensive
lineman's rating correlates with his own team's scoring at **r = 0.038**, which
is nothing at all, and with the opponent's at **−0.945**. A safety reads 0.163
and −0.909, a corner 0.720 and −0.976, a linebacker 0.455 and −0.798. All four
defensive positions were being read through a channel that barely carries them.
`yardstick-fit` prints all three columns now and correlates against the
differential.

So the corner's long-standing 0.82, and the story built on it about `overall`
being a poor guide at that position, were an artifact of reading the echo
instead of the effect. Scored on the differential — which is right for both
halves of a team — a corner is the **second best predicted position in the
game**, at 0.972. The two earlier accounts of this in the git history, one
claiming a drift and one claiming the number was never real, were both chasing a
number that was measuring the wrong quantity.

**Read the last column as what one man is worth, not what a position is worth.**
Only one player is swapped, so a receiver is one of three on the field and a
lineman one of five, while a quarterback is the only one of him. That is the
right thing for an economy where you buy individuals, and it is why the column
is not a ranking of positional importance on its own.

**The quarterback is not four times a corner, and the old table implied he was.**
On the honest measure he is 22.0 points worst-to-best against the corner's 7.7 —
still the most valuable man on the field by a distance, which is what the
auction's pricing says, but the gap is a factor of three rather than the factor
of seven the points-scored column made it look.

**That paragraph and this one are both corrections to what stood here a commit
ago**, when the table was measured at 300 games and said the receiver was the
weakest outfield position at r = 0.652 and called it the one open question. He
is still the weakest, but at 0.722, and the number moved because the sample did
rather than because anything was learned. It is recorded here rather than
quietly fixed because it is the third conclusion in this file to have been drawn
from an unstable row, after the line and the corner, and the pattern is more
useful than any of the three findings were.

### Two instruments that had never been compared

`TRUE_LEVERAGE` — the table the whole auction economy hangs on — is measured by
`leverage-sim.mjs`: boost a position group by eight points on an otherwise equal
team, take the extra *margin*, divide by the number of starters. The yardstick
above swaps one real player from the actual pool and correlates his rating
against the differential he produces. Different populations, different
perturbations, different arithmetic. They had never been checked against each
other, and it turns out `leverage-sim` had been reading the right column all
along while the yardstick read the wrong one — which is why they looked like
they disagreed about the defence.

| position | `TRUE_LEVERAGE` | yardstick spread | starters | spread per starter |
| --- | --- | --- | --- | --- |
| QB | 15.89 | 22.02 | 1 | 22.02 |
| RB | 9.39 | 7.73 | 1 | 7.73 |
| TE | 5.58 | 3.86 | 1 | 3.86 |
| CB | 4.39 | 7.68 | 2 | 3.84 |
| WR | 2.95 | 4.16 | 3 | 1.39 |
| S | 2.87 | 3.37 | 2 | 1.69 |
| LB | 2.76 | 2.65 | 3 | 0.88 |
| DL | 2.46 | 3.86 | 4 | 0.96 |
| OL | 2.17 | 3.57 | 5 | 0.71 |
| P | 2.00 | 0.82 | 1 | 0.82 |
| K | 1.25 | 2.10 | 1 | 2.10 |

`TRUE_LEVERAGE` is already per-starter, so the right comparison is the last
column: **r = 0.968**, with rank agreement of 0.869. That is the first
independent corroboration the leverage table has ever had, and it is a strong
one — two unrelated routes to "what is a position worth" landing on the same
answer.

**Where they disagree is the specialists, and they disagree by inverting them.**
`leverage-sim` prices the punter at 2.00 and the kicker at 1.25; the yardstick
makes the kicker 2.10 and the punter the least valuable man on the field at
0.82, with the weakest correlation of any position at 0.570. Both cannot be
right. The punter is the one position whose contribution is almost entirely
field position rather than points, so a points-based instrument is expected to
under-read him — but 0.82 against a kicker's 2.10 is a bigger inversion than
that explains. Left open: the two tables disagree about two of eleven positions,
and nothing in the game turns on it until somebody is deciding what to bid for a
punter.

**Both columns moved on 2026-09-24, and the yardstick one is now stale.** The
table re-measured that morning, with the back at 13.99, correlated with this
yardstick column at 0.864; the one set once the run game matched real carries,
with the back at 5.44, correlates at 0.979. That second figure is not the
corroboration the first 0.968 was, because the yardstick column was measured
on 22 September, on the run game that turned out to move a back's carries five
times too far — his 7.73 here is that engine's. Re-played on the fixed engine,
real backs come out at 0.077 points of differential per overall point against a
quarterback's 0.574, where they were 0.288 and 0.535. The column needs
re-measuring before it can check the table again. Details under "The back was
worth nearly three times too much".

### What the general managers' decisions are worth (`npm run gm`)

`overall`, `TRUE_LEVERAGE` and `lineupStrength` have all now been checked
against a scoreboard. The layer above them — the clubs deciding what to bid —
never had been. Everything measuring the AI measured it against itself:
`auction-sim` reports how the best-built roster does, and both `strategy-sim`
and the difficulty table measure what savvy does to the **human's** win total.
Nothing had asked what a club's own savvy does for the club.

**Held to one persona, with savvy the only difference** (30 leagues, 240
club-seasons — the personalities vary in savvy, a positional bias and the
play-calling sliders all at once, so comparing Analytics with Air Raid cannot
say which of the three did the work):

| savvy | roster strength | wins of 14 |
|---|---|---|
| 0.10 | 8526 | 5.33 |
| 0.20 | 8545 | 5.40 |
| 0.30 | 8557 | 6.07 |
| 0.40 | 8573 | 7.13 |
| 0.50 | 8588 | 7.20 |
| 0.60 | 8597 | 7.90 |
| 0.70 | 8606 | **8.47** |
| 0.85 | 8605 | 8.20 |

It works, and it works the way it is supposed to: savvy buys roster strength
(r = 0.815) and roster strength buys wins (r = 0.517), for about **three wins of
fourteen** across the range. The causal chain the whole economy assumes is
measured end to end for the first time.

**It flattens above 0.70**, where the shipped table happens to stop — 0.85 is no
better than 0.70 and slightly worse. Whether that ceiling was known when `SAVVY`
was written or is a coincidence, the table is not leaving anything on the floor.

**As shipped, the personalities are a savvy ladder** (40 leagues, 40 titles):

| general manager | savvy | roster strength | wins | titles |
|---|---|---|---|---|
| Analytics | 0.70 | 8601 | 8.37 | **14** |
| Trenches | 0.62 | 8583 | 7.86 | 4 |
| *the user's club* | 0.30 | 8584 | 7.28 | 4 |
| Defense Wins | 0.50 | 8582 | 7.08 | 4 |
| Balanced | 0.34 | 8579 | 7.03 | 5 |
| Ground & Pound | 0.16 | 8554 | 6.84 | 4 |
| Gambler | 0.26 | 8553 | 6.47 | 2 |
| Old School | 0.18 | 8552 | 6.13 | 3 |
| Air Raid | 0.10 | 8509 | 5.51 | **0** |

Savvy against wins across the personalities is **r = 0.899**. The positional
biases and the play-calling sliders — the parts a player can actually see, and
the parts the blurbs describe — barely offset it at all. The table is in savvy
order with two swaps.

**This is the documented intent, and this is its size.** The design says the
Analytics GM chases value while the Air Raid GM chases names, so the market is
"beatable without being free money", and that is exactly what happens. What was
never measured is how far it goes: Analytics takes **fourteen of forty titles**
where an even share of an eight-club league is five, and Air Raid takes **none
in forty seasons**, at 5.51 wins.

Worth knowing rather than worth fixing, and the judgement is a design one rather
than a measurement one. A club run by somebody chasing names *should* be worse,
and real franchises do go decades without winning. But the blurbs present the
personalities as taste — *"Loves quarterbacks and receivers"* — and nothing on
screen says that one of them is three wins a season worse at its job than
another. A player who learns the ladder can read the final table off the GM
names before a ball is kicked. If that is not wanted, the fix is to draw savvy
per club independently of persona, leaving the persona to carry style and the
difficulty dial to carry skill; it is not built, because it changes how every
league plays.

One detail the same run turned up: **the user's own club has no `gm`**, so
`savvyFor` falls through to its `?? 0.3` default. When a league is simulated
ahead, or the user's roster is auto-completed, it is bidding as a slightly
below-average general manager. That is a defensible default and it had never
been written down.

### What `lineupStrength` is worth, which nothing had ever asked

Every trade, waiver claim, draft pick and market screen in this game is judged
by `lineupStrength` — the sum over a roster of `overall` x `TRUE_LEVERAGE`. Six
scripts in `scripts/` report their results in its units and **not one of them
ever looks at a scoreboard**: `trade-sim`, `moves-sim`, `draft-sim`,
`market-sim`, `pickcurve` and `playthrough`. This document quotes their output
as though it were an outcome — "the AI gained +12 on average and the human lost
14" — and those are units of a model, not points.

Both of the model's inputs have now been measured. `overall` predicts a man's
point differential at 0.87 or better for nine of eleven positions, and
`TRUE_LEVERAGE` agrees with the yardstick at r = 0.968. What had never been
checked is the **sum**: that a roster is the sum of its parts, with no
interaction between them. `npm run strength` asks it, in two halves that have
different answers.

**The level: does a stronger roster win by more? Yes, and solidly.** Across
rosters whose every position is drawn independently — so a side can be elite at
quarterback and replacement level on the line — r = **0.935**, over a
differential range of about eighty points. Built the easy way instead, by
walking the ranked pool so every roster is uniformly good or uniformly bad, it
reads 0.995; that number flatters the model, because it confounds strength with
quality by construction and never builds the lopsided side where additivity
would break. The 0.935 is the honest one.

**But it is not exactly additive, and the error is structural.** The residual
around the fit is **2.14 points rms**, worst cases −5.1 and +5.0. Quadrupling
the sample from 150 games a roster to 600 left it at 2.14 and moved the
correlation from 0.934 to 0.935, so none of it is game noise: two rosters the
model calls equal really do differ by a couple of points, and sometimes ten,
according to how the talent is spread.

At the fitted slope a point of differential is worth about 25 strength, so that
residual is **roughly 53 strength units** — against a typical accepted trade of
12 to 14. The model's shape error is about four times the size of the thing it
is most often used to judge.

**The delta: when it says a swap gained you N, did it?** This is the question
the six scripts actually lean on, and it is a kinder one, because the shape
error is a property of the roster and largely cancels when you compare the same
roster before and after. Measured with paired seeds — the same games either side
of the swap, so nothing moves but the man — r = **0.806** over ninety swaps.

It is kinder, not kind. Among the swaps the model called significant it got the
**sign wrong 9 times in 58**, about one in six: it said the roster improved and
the roster got worse, or the reverse. And among trade-sized swaps, the 5-to-30
strength range the economy actually deals in, the correlation falls to
**0.686** — the model is least reliable exactly where it is used most.

**What to do about it is nothing, for now, and the reason is worth stating.**
`lineupStrength` ranks rosters well, which is what the auction, the draft board
and the AI's roster building need. It judges a single deal considerably less
well than a number quoted to one decimal place suggests, which is a caveat on
how this document reports `trade-sim` and `moves-sim` rather than a defect to
fix. Making it additive would mean modelling interactions between positions, and
nothing measured here says which interactions those are — only that they are
worth about two points of differential in total. The honest change is the one
made: the figures are labelled as model units, and there is now a script that
will say if that ever stops being true.

Not registered in `npm run audit`, deliberately. The level check is 12,000 games
and the delta check another 54,000, which would roughly quadruple a check that
already takes twenty minutes and is only useful if somebody runs it. The numbers
live here with their samples printed beside them, the same treatment the line,
the receiver and the punter get in the yardstick table.

### The shipped pool has fewer dimensions than it looks like it has

Chasing why `overall` predicts a receiver worse than anyone else turned up
something underneath it that is not about receivers at all. **Every outfield
position in the shipped pool contains a pair of attributes that are very nearly
the same number.** Correlation across the real players at each position, against
the same pair measured on a generated rookie class:

| position | the pair | real pool | generated rookies |
|---|---|---|---|
| S | `tck` / `rsd` | **0.99** | 0.72 |
| QB | `tha` / `awr` | **0.98** | 0.73 |
| TE | `cth` / `rte` | **0.98** | 0.76 |
| LB | `tck` / `rsd` | **0.98** | 0.71 |
| WR | `cth` / `rte` | **0.97** | 0.73 |
| RB | `spd` / `elu` | 0.95 | 0.77 |
| DL | `tck` / `awr` | 0.95 | 0.75 |
| CB | `cov` / `awr` | 0.95 | 0.74 |
| OL | `rbk` / `awr` | 0.88 | 0.76 |
| P | `ppw` / `pac` | 0.67 | 0.80 |
| K | `kpw` / `kac` | 0.60 | 0.74 |

A real quarterback's accuracy and awareness are the same number to within two
per cent. A real safety's tackling and run defence are the same number to within
one. The ratings were written by hand, one player at a time, and a good player
was given good attributes across the board — so within a position the shipped
pool is close to one-dimensional. The two specialists are the exception, and
they are the only positions where somebody clearly sat down and decided that leg
and placement were different things.

**The generated rookies are not like this.** `makeRookie` scatters each
attribute independently around a target, so a generated class lands at 0.71 to
0.80 — genuinely lopsided players, which is what the rookie generator's comment
promises and what makes an intake interesting. The two populations in this game
have different shapes, and the game has never said so.

**The consequence is that a position's weights are underdetermined by the
players they price.** Take each position's most duplicated pair, delete one
attribute outright and give its entire weight to its twin, then ask how far a
rating moves:

| position | move | real players | generated rookies |
|---|---|---|---|
| QB | all of `awr` onto `tha` | **0.85** | 2.25 |
| RB | all of `elu` onto `spd` | 0.76 | 1.20 |
| TE | all of `rte` onto `cth` | 0.74 | 1.30 |
| WR | all of `rte` onto `cth` | 0.60 | 1.69 |
| LB | all of `rsd` onto `tck` | 0.48 | 1.50 |
| CB | all of `awr` onto `cov` | 0.39 | 0.80 |
| S | all of `rsd` onto `tck` | 0.32 | 0.81 |
| DL | all of `awr` onto `tck` | 0.15 | 0.50 |

Deleting awareness from the quarterback formula and handing its 0.35 to accuracy
moves a real quarterback by **0.85 of a point**, which is under the rounding the
screen already does. On a defensive lineman the same surgery is worth 0.15. This
repo has spent a lot of effort moving weights a hundredth at a time, bounded by
what `legacy-check` allows, and for the real pool most of that argument is about
a decimal place nobody can see. It matters two to three times more for the
generated players, which is where the variance actually lives.

**It also explains why reweighting never rescues a violation.** Raise awareness's
weight to lift Ronde Barber and every corner with high awareness rises with him,
and since awareness and coverage move together at 0.95 across the pool, almost
every corner is one. His *relative* standing barely changes. A player under-
rated against the record has to be fixed by changing his ratings, not by
changing what ratings are worth — which is what the next section turned out to
be about.

Not chased: whether the shipped ratings should be spread out within a position,
or the rookie generator tightened to match them. The half of this that could be
settled without touching either has been — see *The weights survive the
population they were never tested on* below, which measures `overall` against
the generated pool and finds it holds. What remains is a question about what a
pool should look like, not about whether the number works. Both are large content changes
with the fingerprint, the legacy check and every league code downstream of them,
and neither is obviously right — a pool where great players are great at
everything is a defensible way to write a pool. It is recorded because two
sessions of weight-fitting would have been read very differently with this table
next to them.

### The career table nobody could read

`league.careers` has been filled in since awards shipped. Every season
`updateCareers` adds a man's games, his passing, rushing and receiving yards and
touchdowns, his sacks, interceptions, tackles and field goals, and bumps a
counter for every MVP, Offensive and Defensive Player of the Year, All-League
selection, league lead and title. It records the clubs he has played for and the
last season he appeared in. `packCareers` strips the zeroes at the localStorage
boundary, taking 258 KB down to 94 KB for a pro league's 864 men.

**The only thing that ever read it was Hall of Fame membership.** Twelve seasons
into a dynasty you could not open your own quarterback and see what he had done
for you. The data was there, stored, compressed and unpacked on every load, and
it reached the screen as a single yes-or-no about the hall.

`careerBlock` puts it in the player modal: seasons and games, the clubs if he has
played for more than one, a stat line chosen for his position, his honours, and
whether he is in the hall. It is read from the store rather than threaded
through `playerModal`'s ten call sites, the same way the rating editor and the
scouting view already are. **Nothing new is stored.** This is a display, not a
feature — the feature shipped years of commits ago and was invisible.

The stat line is per position because a career line that reads "0 sacks, 0
tackles, 0 field goals" for a quarterback is worse than none. A lineman and a
punter get seasons, games and honours only, which is what this simulation
actually records about them.

**How this was found is the uncomfortable part.** It was proposed as new work —
"career statistics that accumulate", ranked for the meaning it would give a long
save, with a caution about save size. The save-size problem had been solved
already by `packCareers`, and the accumulation had been running the whole time.
The grep that convinced me otherwise looked for `careerTotals`, `lifetime` and
`totals` and never for `careers`. That is two proposals out of three — this and
the turning points below — that were already built.

### "Expected to miss 3 weeks" was not an expectation

The line under every injury has always read *"Expected to miss 3 weeks"*. What
sat under it was one draw of `rng.int(band.min, band.max)`, fixed at the moment
of the injury and counted straight down. The man was back on exactly that week,
every time. The sentence was a forecast and the mechanic was a certainty.

A week can go wrong now. `tickInjuries` rolls each week: `SETBACK_CHANCE` (0.10)
costs a week and sometimes two, `AHEAD_CHANCE` (0.18) gives one back. Over
200,000 injuries, 61% still resolve exactly as first quoted, 17% run late, 22%
come back early, and a wrong one is wrong by 1.33 weeks.

**There is no hidden true return date.** `inj.weeks` is still the one number
everything reads — the badge, the injured-reserve gate, the AI's waiver
arithmetic — and it is a live estimate rather than a countdown. That was a
deliberate choice over a shown estimate with a concealed truth: concealment
would hand AI clubs foresight the human does not have, and difficulty here lives
in explicit levers rather than in what the computer secretly knows. The
uncertainty is real, not informational — the date is not decided yet.

**The rates are not symmetric and cannot be.** A setback costs one week and
sometimes two; a good week saves one. Equal probabilities would therefore bleed
player-weeks into the league and quietly make injuries worse, and the dial above
is calibrated. 0.10 against 0.18 is where total time lost stops moving.

**Which took three measurements to establish, because the first two disagreed.**
Run through `tickInjuries` itself over 8,745 injuries, drift is **−0.0%**. But
`injury-sim` came back 6% heavier — 0.34 to 0.36 players out per club-week — and
a 6% rise in a calibrated dial is not something to wave through. A control with
the roll still drawn and its result discarded reproduced the old figures
exactly, which ruled out the RNG stream. The answer came from measuring the
thing the claim is actually about: injuries served **2.66 weeks against 2.72**
with the slip off, over 966 ledger-weeks against 969. Durations are flat. What
moved was `injury-sim`'s starter-weeks column, which counts only men occupying
starting slots across about 400 events, where 6% is inside one standard error.
The dial's own tolerances already covered it.

The figures in both tables above are the new deterministic output. They moved
because the sample re-drew, not because injuries got worse.

**A season-ending injury does not slip**, and getting that right took a second
attempt. Testing `inj.weeks < SEASON_ENDING` after the decrement let a torn ACL
drop to 98 on its first week and qualify as a forecast from the second week on,
so it had good days. It is tested against `VERDICT_FLOOR` now, which needs no
flag on the record and so needs nothing done to saves written before this: the
worst ordinary band is nine weeks and creeps up a week at a time, while a
season-ender starts at 99 and sheds at most eighteen in a season. The two
populations cannot meet.

**The setback is rolled after the decrement**, so a man due back this week can
still break down — named in the side, went in the warm-up, out another
fortnight. Rolling before it would have made that impossible, and it is the
setback that actually happens.

Not chased: whether a club should be told *why* a date moved. The ledger knows
a week slipped and the screen does not say so, which is a line of text rather
than a mechanic, and worth having once there is a save long enough to judge it.

### The archive told a different story than the game did

The box score already names a game's turning points: `gameStory` takes the three
plays that moved win probability most and prints them with the swing. That has
been there since the win-probability work. What nobody checked is whether it
still tells the truth once a season is over.

It did not. `thinCompletedLogs` drops a finished season's routine plays to keep
a save under the browser's quota, and what survived was chosen by
`tellsTheStory` — scoring, flags, drives, interceptions, fumbles, injuries.
**Leverage is not a play type.** A twenty-two-yard completion is routine in the
first quarter and the whole game with forty seconds left, and the filter cannot
tell them apart.

Measured over sixty games, the archive named different turning points than the
live game in **31 of them**. Six understated the decisive play by more than
three points of win probability and the worst by 78. The single largest swing
thrown away across the sample:

    -0.98   a. K1 50-yard field goal is NO GOOD (wide right).

Ninety-eight points of win probability — the kick that lost the game — gone,
because a missed field goal is neither a score nor a turnover. By type, the big
swings being dropped were 39 passes, 11 runs, 10 sacks, 7 incompletions (one a
turnover on downs), 4 punts and 3 kicks. It was never mostly about kicks.

**The fix is to keep a play the story could cite, and to make that structural.**
`TURNING_POINT` (0.05) and `FAINT_TURN` (0.03) now live in `winprob.js`, and
both `thinLog` and `gameStory` read them. The archive keeps everything at or
above the lower bar, so it cannot drop a play the line wants to name — not
because the thresholds were fitted to agree, but because they are the same two
numbers.

**What it costs, and the cheaper shape that was taken.** A big-swing play does
not need its whole entry preserved, only what the line reads — quarter, clock,
text, situation, win probability. Over 120 games:

| what is kept | size | top three right |
|---|---|---|
| the old thinning | 1,371 KB | 49 / 120 |
| every swing ≥ 0.05, whole entry | 1,604 KB | 110 / 120 |
| every swing ≥ 0.03, whole entry | 1,885 KB (+37%) | **120 / 120** |
| every swing ≥ 0.03, five fields | **1,599 KB (+17%)** | **120 / 120** |

The last row ships. Seventeen per cent on a thinned log against an archive that
stops contradicting the game.

**Why 0.03 and not 0.02.** The fallback bar was 0.02, and thinning at 0.02 costs
43% of the full log against 37%. Over 300 games the faint branch fires in 40 and
exactly one of those cited a swing between 0.02 and 0.03 — so the bar moved up
rather than the archive down, and that one game now says nothing about where it
turned. Which is the honest answer about a game whose largest swing was two and
a half points of win probability.

**This was found by proposing to build it.** The feature was on a list of five
ideas as "cheapest, do first"; the check that it did not already exist found
that it did, and the check that it worked where it mattered — in seasons already
filed away — found that it did not.

### The pro keeper round had no cover in a browser

The smoke test drives pro mode as far as its setup screen and no further: the
season it plays out and the offseason it walks through are the fantasy ones. So
the franchise tag's whole screen — the price on the button, the one-a-club rule,
what clicking it does to the keeper list — was tested only at the engine level,
where none of those things live.

The league is built in Node and injected rather than played in the page. Driving
32 clubs through eighteen weeks in a browser would be by far the longest thing
in that file, and it would be exercising the season loop, which
`playthrough.mjs` already runs headlessly over whole dynasties. What was
uncovered is the screen, so the screen is what gets set up for. `enterOffseason`
only asks that a season be finished, not that it be played, and contracts still
run down and men still come out of term — which is all the keeper round needs.

Three things about the injection are load-bearing and each cost a run to find:

- **A `goto` that only changes the hash does not reload.** Without an explicit
  `reload()` the app never re-reads the slot just written under it, and the page
  sits on whatever it was already showing.
- **A fabricated registry entry is rejected.** The app rewrites a slot it does
  not recognise and lands back on the new-league screen with the save sitting
  there unopened. Adopting a slot the app already made works.
- **The index has to carry ages.** `main.js` hands the real offseason a
  `careerIndex`, and `aiTagChoice` reads `p.age`; injected with a raw index the
  AI never tags, and the league under test is not the league the app builds.

Three mutations, all caught: tagging that does not pick the man up (the state
`validateKeepers` refuses to confirm), a missing one-a-club rule, and a tag
button with no price on it.

### The cheapest route is not always the honest one

`legacy-check` reports the cheapest **single-attribute** route to a player's bar,
and that is the right thing for a diagnostic to report — it is the lower bound on
what the record costs. It is not automatically the right change to make.

George Blanda's 1961 is the case. The check said `tha` 83 → 89: six points of
accuracy and he clears 85. But 1961 is the season the record is built on, and in
it he threw 36 touchdowns against 22 interceptions on a **41.5% completion
rate**. Twenty-seven of the pool's 128 quarterbacks sit at `tha` 89 or better;
putting a passer who completed fewer than half his throws among them is buying
the record's respect with a lie about what he was.

What his career does support is awareness. He played twenty-six seasons, started
at thirty-four in the season being rated, and kicked and quarterbacked into his
forties. Two attributes, moved less far each, reach the same bar:

| route | change | overall | what it claims |
|---|---|---|---|
| the check's | `tha` 83 → 89 | 85 | top-fifth accuracy for a 41.5% passer |
| shipped | `tha` 83 → 85, `awr` 87 → 92 | 85 | near-median accuracy, top-15% awareness |
| `awr` alone | 87 → 93 | 84 | does not reach |

The shipped route leaves him just above the pool's median for accuracy (82) and
at 92 for awareness, where 23 of 128 quarterbacks already sit. Both halves of
that are things his record argues for.

**This is why the five-point rule recorded him rather than correcting him.** The
guarding test treats a violation as a rating to fix when a nudge of five points
or fewer would clear it, and Blanda's cheapest single move was six — one point
outside. Split across two attributes the largest move is five. The rule was
reading a lower bound as though it were the only option.

Csonka and Riggins stay recorded, and the reasoning in the section above is
unchanged: their routes make bruising fullbacks into sprinters, and no split
across attributes rescues that, because `spd` is where the whole shortfall
lives. Two violations remain and both are disagreements about what this
simulation thinks a running back is.

### The weights survive the population they were never tested on

The table above leaves an obvious worry unstated. If a position's attributes run
together at 0.95 and above, then almost any monotone weighting ranks the shipped
pool correctly, and `overall` scoring r = 0.988 against production there is weak
evidence that the *weights* are right rather than merely harmless. Meanwhile a
dynasty is mostly made of generated players, whose attributes are scattered
independently — and nothing had ever measured `overall` against them.

`scripts/yardstick-fit.mjs` takes `rookies` as a fifth argument now and swaps the
sample, matching the generated set's rating range to the shipped one's because
correlation is range-sensitive and an unmatched range would answer a different
question. Three positions, chosen to span the collinearity range, each at the
sample size the yardstick table specifies for it:

| position | games a man | shipped pool | generated rookies | pair correlation, shipped / generated |
|---|---|---|---|---|
| QB | 200 | 0.988 | **0.988** | 0.98 / 0.82 |
| CB | 500 | 0.984 | **0.991** | 0.96 / 0.79 |
| DL | 1500 | 0.952 | **0.964** | 0.95 / 0.79 |

**The weights transfer, and that makes the original numbers worth more rather
than less.** On the generated pool the weight vector is genuinely identified —
there is no twin attribute to hide behind — and `overall` predicts production at
least as well there as on the players it was fitted against. The worry above is
answered: the weights are right, not just unfalsifiable.

It does not license reopening the weight-fitting. What the earlier table says
about *leverage* still holds — moving a weight a hundredth still moves a real
player by less than the screen's rounding, and still moves a generated one two
to three times as much. What is now established is that the vector those
hundredths sit around is sound at both ends of the population.

**A caution, because it nearly went in as a finding.** The first pass ran DL and
S at 200 games and read 0.587 and 0.847 against their true 0.952 and 0.956, then
read the gap against the rookie column as though it meant something. The
yardstick table's games column is not decoration: a position whose best-to-worst
differential is under four points needs the 1500 it specifies, and a quick run
of one is worth nothing at all. The shipped halves above reproduce the published
figures exactly, which is the check that the harness is reading what it always
read.

### The check said four ratings were unfixable, and it was testing the wrong attribute

Four recorded violations had sat for a long time, each ending with the same
line: *caps at 82 with `awr` 99 — the weights, not the rating*. Read as it was
meant, that says no rating change can reach the record's bar, so the weight
vector is the thing to argue with and the player is not. All four were parked on
that basis.

It was testing the wrong attribute. `legacy-check` perfected the attribute the
player was already **highest** at:

    const best = attrs.reduce((a, b) => (p.r[a] >= p.r[b] ? a : b));

which is by definition the one with the least room left, and in this pool — where
a position's attributes run together at 0.95 and above, see the section above —
usually not the one carrying the weight. Ronde Barber's highest is `awr` at 90,
worth a single point of overall. His `cov` carries 0.57 of the vector and takes
him from 81 to 92. The check had been reporting a ceiling of 82 for a player
four points of coverage away from his bar.

**It reports the cheapest route now, and the price is the finding:**

| player | needs | the cheapest way there |
|---|---|---|
| Ronde Barber '01 | 84 | `cov` 80 → 84 — **four points** |
| George Blanda '61 | 85 | `tha` 83 → 89 |
| John Riggins '83 | 85 | `spd` 78 → 89 |
| Larry Csonka '72 | 84 | `spd` 72 → 94 — **twenty-two points** |

(Blanda has since been corrected too, by a route this column cannot see — see
*The cheapest route is not always the honest one* above.)

That is not four instances of one thing. Csonka's route is making a bruising
fullback into a sprinter, and Riggins' is the same archetype the same way: those
two are the weight vector refusing to rate a power back, which is a real finding
about what this simulation thinks a running back is. Blanda's is a quarterback
whose case in the record is longevity being made accurate, which is arguable.
Barber's is a four-point nudge on the one skill he is known for.

**So Barber was corrected and the other three stood.** (Blanda has since been
corrected as well, on the grounds above; two remain.) He is a Hall of Famer,
three times a first-team All-Pro, with 47 interceptions, and the pool had him at
`cov` 80 — level with Dre Bly and Aqib Talib, below Johnny Sample. At 84 he sits
just above Terence Newman and a long way below the elite tier, which is where a
corner of his record belongs. Three violations remain, all of them disagreements
rather than oversights.

**The test that guarded this was encoding the same bug.** It asserted that every
remaining violation was unreachable — `f.ceiling < f.floor` — and passed for
years because `ceiling` was computed from the wrong attribute. It now asserts a
price instead: any violation a nudge of five points or fewer would fix is a
rating to correct rather than a disagreement to record, and reverting Barber's
four points fails it. A second test checks the route is real and is genuinely
the cheapest, since a price that is not the lowest price is not a price.

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
| low | 4.3 | 2.3 | 17% | 1.7 |
| normal | 7.7 | 3.1 | 27% | 4.3 |
| high | 14.8 | 5.8 | 53% | 8.5 |

At the default setting that is about one placement per club per season and over a quarter of club-weeks with somebody parked, which is the rate the four-week minimum was chosen to produce. The players let go are not lost to the league; they return to the pool and are bought again in the offseason auction.

The dial is a league setting: Off, Low, Normal (default), High, as a multiplier of 0, 0.5, 1 and 2 on the base per-play chance. Measured with `scripts/injury-sim.mjs`:

| setting | injuries per game (both clubs) | player-weeks lost per club per game | players out per club-week (8-team league) | QB1 missing |
|---|---|---|---|---|
| low | 0.61 | 0.49 | 0.14 | 1.7% of weeks |
| normal | 1.16 | 0.85 | 0.36 | 3.4% of weeks |
| high | 2.56 | 2.03 | 0.74 | 4.6% of weeks |

The two right-hand columns used to read 0.3 / 0.7 / 1.2 and 4% / 6% / 10%, and
they have roughly halved without the injury model moving at all — the two
left-hand columns are the same figures they always were. What changed is
downstream: injured reserve and the waiver wire both got better at refilling a
hole, so less of a club is missing at any given moment for the same number of
injuries. Worth knowing before reading the right-hand columns as a measure of
how violent the game is; they measure how well clubs cope.

The real league runs at roughly three to four times "normal" by adjusted games lost, so even High is a gentle version. That is deliberate: a 13-to-14-game season is short enough that injury luck at real rates would decide more leagues than the auction does. (Thirteen is what leagues of ten or twelve play; the eight-team default every measurement here uses plays everyone twice, so fourteen. `buildSchedule` says so precisely and this paragraph used to round it to thirteen.) What a missing quarterback costs, on one auction roster against every opponent in the league with no other injuries: 50% with the starter, 44% with the backup the auction bought for him, 4% with a replacement-level fill-in. The backup is worth roughly six points of win probability per week he plays, which is what the QB2 slot is for and why the auction AI pays about a third of starter money for one.

Established: the rates and the effects above.

#### The same dial in the pro league

This paragraph carried a labelled guess for a long time — that seventeen games
and a thinner quarterback pool "make backups much weaker; the same setting will
bite harder there, and nothing yet re-measures it". Nothing did, until now. The
guess was right about the conclusion and wrong about which half does the work.

Per club-season, 10 fantasy seasons and 12 pro (`scripts/injury-sim.mjs`, and
per season rather than per club-week for a reason given below):

| mode | setting | games a club | starter-weeks lost | QB1 misses | season-enders |
|---|---|---|---|---|---|
| fantasy | low | 14.0 | 2.0 | 0.24 | 0.11 |
| pro | low | 17.0 | 2.6 | 0.26 | 0.07 |
| fantasy | normal | 14.0 | 5.1 | 0.47 | 0.14 |
| pro | normal | 17.0 | 5.7 | 0.49 | 0.16 |
| fantasy | high | 14.0 | 10.4 | 0.65 | 0.33 |
| pro | high | 17.0 | 11.6 | 1.11 | 0.39 |

**The rate cannot differ between the modes, and does not.** Injury risk is
`BASE_PER_PLAY` per snap, so a game is a game whichever league it is played in,
and any figure quoted per club-week is blind to season length by construction —
which is why the first attempt at this measured per club-week, found the two
modes identical, and had measured something that could not have come out any
other way. Per season the seventeen-game schedule shows up exactly as
arithmetic predicts: starter-weeks lost run 1.20, 1.13 and 1.14 times the
fantasy figure against an exposure ratio of 17/14 = 1.21. That agreement is
itself the evidence the per-game rates match.

**What actually bites is the bench.** Thirty-two clubs roster 64 of the pool's
128 quarterbacks where eight clubs roster 16, so a pro club's QB2 is drawn from
very much further down:

| mode | clubs | QB1 | QB2 | backup gap | sd |
|---|---|---|---|---|---|
| fantasy | 64 | 93.9 | 90.7 | 3.3 | 1.4 |
| pro | 256 | 90.0 | 84.3 | **5.7** | **3.7** |

Both ends are diluted and the backup end far more. The spread matters as much
as the mean: at sd 1.4 a fantasy club is near-certain to be well covered at
quarterback, while at sd 3.8 a pro club's cover is a lottery. Measured over
every club in eight leagues per mode, because the first attempt read one club's
QB1/QB2 pair as a finding and a single pair is one draw from a wide
distribution.

So the dial bites harder in the pro league because each injury costs more, not
because more of them happen — the opposite emphasis to the guess this replaces.

**Two cautions on reading the table.** The season-enders column is
under-sampled at the shipped sample size: fantasy reads 0.10 over 10 seasons
and 0.17 over 40, which is 8 events against 54, so pro-against-fantasy on that
column is not a safe comparison. Starter-weeks lost is the high-count figure
and the one to read.

How thin those columns are was then demonstrated by accident. Correcting one
quarterback's ratings — George Blanda, two attributes, see above — changed
where quarterbacks fall in 32 clubs' drafts, and the pro rows moved with it:
starter-weeks by 0.1, but QB1-misses from 0.53 to 0.42 and season-enders from
0.16 to 0.14. Those are not perturbations of the same sample, they are a fresh
sample, because a different draft produces different rosters and therefore
entirely different injury draws. The high-count column barely noticed. That is
the whole argument for reading it and not its neighbours. And what the backup gap is worth in wins is **not
measured**: the only conversion to hand is a single fantasy roster where a
3.2-point drop at quarterback cost 12.1 points of win rate, and carrying that
to 5.8 points across a different league size would be inventing a number.

**A correction this forced.** The sentence replaced above said the pool holds
103 quarterbacks. It holds 128. "64 drafted" was right, and the contrast worth
stating is 64 of 128 against 16 of 128.

Speculation: nothing here argues the pro default should move. This measures
what the setting does, not where it ought to sit.

### The pro league offered a keeper quota it has never used

A pro league showed "Keepers per club" on the setup screen, defaulted it to 18,
stored it, and ignored it. `keeperLimit` returns the whole roster whenever the
cap is on and `capOn` is exactly `mode === 'pro'`, so the control could not
affect anything: under a cap the contract decides who stays, because two
mechanisms of attrition would double-count. The help text beside it said
*"Fantasy leagues default to 6, the pro league to 18"*, which is the wrong rule
for the mode a player was choosing as they read it.

**The part that made it more than cosmetic.** `futureDepth` read
`settings.keepers` *directly* rather than through `keeperLimit`, and it was the
only thing deciding how deep next year's draft runs. Twenty-seven slots minus
eighteen keepers gives nine rounds, and a pro league does turn over about nine
slots a club — so a dead setting had been standing in for a live measurement by
coincidence, and getting the right answer.

That is not a rounding detail, because `KEEPER_DECAY` is in fractions of the
**usable** draft. At nine rounds a round-three pick is worth **0.01**; at
twenty-seven it is **3.39**. Removing the control without noticing this would
have repriced every late pick in the pro league by two orders of magnitude, and
`madeOdds` would have gone on telling the truth beside it — round 7 is made 77%
of the time — so the numbers would have disagreed with each other quietly.

`futureDepth` asks the measurement now: `PRO_OPEN_SLOTS = 9`, the figure the
comment had been citing all along, and the keeper setting is read only in the
mode that has one. The control is hidden in a pro league on both screens that
carried it — the setup form and the in-game settings — and replaced by a line
saying what actually decides, which is the cap and the length of a deal.

The setting is still stored and still round-trips through a league code, because
a fantasy league needs it and nothing is gained by breaking compatibility to
delete a field that is simply not read. What it stores changed, though:
`defaultKeepers('pro')` returned 18, so a pro league recorded — and shared, and
showed to anything that looked — a quota different from the one it enforces. It
returns the roster size now, and a fifth test asserts that a fresh pro league's
stored figure equals `keeperLimit`'s, so the two cannot drift apart again. The
same pass removed the branch the fix had orphaned: `keeperLimit` still read
`league.mode === 'pro' ? 18 : 6` on the line after `capOn` had already returned
for exactly that case.

Five tests pin it, and every mutation is caught: restoring the direct read,
setting the pro depth to the full draft, letting `keeperLimit` honour the
setting under a cap, and letting the pro branch leak into fantasy. The smoke
test checks the control is genuinely not on screen in pro mode and that the
explanation is, rather than trusting a `hidden` attribute.

### The pro keeper round had no decision in it

Re-signing a man whose deal was up cost `marketSalary`. Declining him and
buying him back in free agency cost `marketSalary` too — his asking price is
the same number — except that four rounds of sealed bids stood in the way. Same
price, strictly more risk: **declining was dominated**, so the keeper round was
arithmetic, not a choice.

Two likelier-sounding accounts of this are both wrong, and both were written
down here before being measured. It was NOT that a club could never lose a
player: men declined at the keeper round go into free agency and get bid for.
It was NOT that clubs kept everyone they could afford: the AI's surplus test
already let **64%** of expiring men go. The defect was narrower and duller than
either, and only the third guess survived contact with a measurement.

`RESIGN_PREMIUM` prices the exclusive window, so the two options differ. Over
32 clubs and four seasons (`scripts/resign-sim.mjs`):

| premium | declined to market | continuity | stars declined / re-signed | star lost to a rival |
|---|---|---|---|---|
| 1.00 (before) | 64.0% | 84.1% | 80 / 85 | 49% |
| 1.04 (shipped) | 73.1% | 80.8% | 104 / 73 | 49% |
| 1.08 | 79.4% | 81.1% | 104 / 68 | 48% |

**It is a switch, not a dial.** Everything happens between 1.00 and 1.04; going
on to 1.08 leaves star behaviour identical and only sheds more of the players
nobody was going to miss. So the value is the smallest one that un-dominates
the choice, and tuning it for drama is not available.

**The gamble is real exactly where it should be.** Declining a 90+ player means
a 48–49% chance a rival takes him and about 11% that nobody wants him. Below 85
it inverts: 87% go unsigned against 7% to a rival, which is attrition rather
than a market — and correctly so, since there are 864 roster places for a pool
well past 1,500. A decision that mattered for squad players would be a decision
about nothing.

Note what the premium does NOT move: the rate at which a declined star is taken
is 49 / 49 / 48 across all three settings. That is a property of the
free-agency market, not of this constant. The premium decides who reaches the
market; the market decides what happens to him.

It must stay below `BIRD_IN_HAND` (1.15), which is what an AI club thinks
certainty is worth. At or above it every surplus goes negative and every roster
empties into free agency.

`Math.ceil` floors the premium at a dollar, so a cheap man pays proportionally
more than a dear one. Left as it is on purpose: the choice is only ever live
for players the market wants, and those are the ones the percentage reaches.

**A caution about the first version of the measurement.** It inferred "declined"
from the player not being on the club afterwards, which made "declined and not
got back" come out at exactly 100% — true by construction rather than by
measurement, and the same trap as a test asserting what a clamp guarantees. The
keeper round and the market have to be observed separately, which means
stopping at `offseason` rather than running through to `nextSeason`.

### A refusal that names the deal

A refused trade used to end at "No deal" and a hint at the size of the gap —
"they want roughly three more points of lineup value" — which says how far off
you are and nothing about how to close it. You guessed, proposed, and were
refused again. The deal finder searches the whole league for trades a club would
take; `counterOffer` answers the narrower question the human is asking at the
moment of refusal: what would *this* club take, starting from what I offered?

Every change of one piece is tried — one more of your players, one fewer of
theirs, one of your future picks — and kept only if the club's own rule accepts
it and `validateTrade` allows it, the same pair of tests `proposeTrade` applies,
in the same order. Of the survivors, the one that costs *you* least is offered:
the nearest deal that works, not the one the club would like best. A pick is
arithmetic rather than a re-simulation, for the reason `closeWithPick` gives.
Over thirty refused proposals, 26 had a single-change answer; the search takes a
median of 6 ms.

**The cheapest thing a club will accept can be your starting quarterback.** The
first version offered it as "Counter: add Steve Young" — technically correct,
a terrible suggestion dressed as help. It is not hidden, because knowing the true
price is information; it is priced. Every counter says what it leaves you with
against standing pat, so "that would leave you 22.5 lineup points worse off —
the price of their answer, not a recommendation" reads as the bad deal it is.

The load-counter button carries `data-close`, so the dialog shuts through its own
path rather than being torn out of the page; driven end to end in a browser, the
builder holds exactly the counter and proposing it is accepted.

**One mutation escapes, and the reason is kept rather than papered over.**
Removing `validateTrade` from the search breaks no test. The club's arithmetic
genuinely does accept illegal deals — three four-player offers against a limit of
three in one league — and validation is the only rule that names why. But in
every case found, across five leagues, seven clubs and four positions, your own
roster backfill *also* fails on those deals, so a second check catches the same
candidates first. The guard is pre-empted in practice rather than redundant in
principle, and it stays: it is the rule proposals are held to, and a change to
backfill could open the gap it covers. Removing the "never strip their side to
nothing" guard also escapes, and that one is genuinely equivalent —
`validateTrade` already refuses a side that gives nothing.

Single changes only. A two-piece counter multiplies the search by the roster and
is a negotiation rather than an answer.

### Scouting the next opponent

The matchup card said how two rosters compare on paper — power, unit
composites, the other GM's habits, a ratings-based guess at their game plan.
Nothing said how the opponent had actually *played*, which is often a different
answer: a defence rated well can be giving up 140 yards a game on the ground.

`scoutingReport` reads the opponent's league rank in every unit category and
names the two strongest and two weakest — one per unit, since yards per carry
and rushing yards a game describe the same run defence and the first version
spent both strengths saying so. Then it does the part a coach acts on: sets your
offence's rank against their defence's in the same thing (`MATCHUPS` — run, pass,
third down, red zone) and names the widest gap each way, as *your edge* and
*watch*.

Two floors keep it honest. No report until the opponent has played twice,
because a rank after one game is a coin and a line built on it would be
confident and wrong. And a gap only counts once it is a quarter of the league
wide: fourth against eighth is noise with a sign on it.

Strong and Weak carry the direction, which matters for the stats where lower is
better. "8th in turnovers per game" alone is ambiguous — eighth-most, or eighth-
best? Under *Weak* it can only mean the bad end.

### Team statistics, both sides of the ball

**The offence was recorded all along.** Every game writes third- and
fourth-down attempts and conversions, red-zone trips and touchdowns, rushing
and passing, completions, first downs, turnovers, sacks taken, time of
possession, drives and penalties, and they accumulate into `seasonStats.team`.
Measured per club per game over sixty games they read like football: 327 yards,
a 39% third-down rate, 56% of red-zone trips ending in a touchdown, 19.8 points.

**Nothing recorded the defence.** No field anywhere held what a club *allowed*,
so "the best red-zone defence" or "the best run defence" could not be answered
from anything the game kept. And no screen showed any team statistic
league-wide — the box score of a single game was the only place they appeared.

`teamstats.js` derives both halves from the schedule rather than storing
anything new. Every played game already keeps both sides' lines in
`result.teamStats`, and a club's defence is simply what its opponents did
against it. That makes it retroactive: a save halfway through a season shows a
defence for every game already played, not only those after this was written.
Regular season only, the way `seasonStats.team` has always counted.

Twenty-six categories — fourteen offensive, ten defensive, point and turnover
differential — each carrying which direction wins, so a defence ranking never
has to be read backwards. A rate with no denominator yet is unknown rather than
0%, so in week one a club that has not faced a third down does not rank as the
stingiest third-down defence in the league.

**Two tests do most of the work.** A conservation law: across the league, every
yard gained is a yard allowed, so the offence and defence totals of every field
must match exactly. And a cross-check: the offence derived from stored results
must equal the `seasonStats.team` the season already accumulated, field for
field, or the two are counting different games.

The screen is a **Team stats** tab under Awards rather than an eighth item on a
phone's bottom bar: league leaders in every category, where your own club ranks
in each, and a full table for any one.

**Verifying it turned up two wrong turns of my own.** The first check of which
fields were populated used `grep` over `src/engine/*.js`, missed the
`src/engine/game/` directory the engine was split into, and reported
`sacksAllowed` as never incremented. It is incremented, in `game/plays.js`. Text
search cannot follow `const ts = g.stats[off].team; ts.thirdAtt++`, so the
answer came from playing sixty games and reading which fields ever left zero.

And the first layout put each figure in its own column, which at 360 px ran out
of the table's scroll container: invisible, and invisible to the smoke test's
page-overflow check too, because the page never got wider. Smoke now measures
each figure's right edge against the viewport and names any that fall outside.
One run reported seven hidden figures on a later layout, and this section used
to call the cause not established. It is established now. Every `td` in the app
is `white-space: nowrap` from the base table rule, so the fix made then —
pinning only the figure on one line so the rest of the cell could wrap — changed
nothing: no cell could wrap, the label included, and a row was as wide as its
label, figure and club chip laid end to end. The long defensive labels crossed
360 px whenever the digits and the leading club's abbreviation added up, which
is why it came and went. It came back while shipping free-agent lengths — eight
of fifty-two figures, all defensive, 3 to 12 px off the edge — and went to none
on the same league once the label cells were released (`td.lbl`). Why the
deterministic worst case built for it then showed nothing is not established;
the smoke run that failed and then passed is the evidence now.

### Past seasons, and every series

Team statistics used to cover one season: the schedule they are derived from is
replaced every year, so the moment a new season began the last one's numbers
were gone, and so was every result between two clubs. `league.history` kept the
champion and the finishing order and nothing a club had done on the field.

`archive.js` files a season when it is crowned — the one moment the whole of it,
playoffs included, is still on the schedule — and keeps two things:

- **Each club's regular-season totals, both sides of the ball, and its record.**
  Totals, not the finished figures: a rate cannot be re-derived from a rate, and
  a figure stored today is no use to a category added tomorrow. They read back
  as exactly the rows `seasonTeamStats` builds, so the Team stats tab renders a
  past season through the code it uses for the current one, and a season picker
  is the only new screen. Stored as arrays against a field list kept with each
  season; a field the team line gains later reads as *no figure* in seasons
  that never had it — NaN, which every category and `rankTeams` already treat
  as unknown — rather than as a real-looking zero, which is what a per-game
  category dividing by games played would otherwise show.
- **Every pair of clubs' record against each other**, regular season and
  playoffs, which the matchup card quotes: "All-time: you lead 7–5." Bounded by
  the number of pairs, not the number of seasons. The season still being played
  is counted live off the schedule until it is filed, and not after — between
  the final and the next season's first week the schedule still holds the
  season just filed, and counting it again would double every game in it.

A league that began before this has nothing for its earlier seasons, because
their schedules are long gone. Both halves carry the season they start from,
and the screens say so ("Since season 4: you trail 1–2") rather than passing a
partial record off as the whole of it.

What it costs, measured over six seasons of each:

| league | per season filed | series | whole save grows per season |
|---|---|---|---|
| 32-club pro | 5.8 KB | 7.6 KB, full once all 496 pairs have met (season 4) | ~110 KB |
| 12-club fantasy | 2.3 KB | 0.9 KB, full after one season | ~35 KB |

About 5% of what a pro save already grows by each season. That growth — 634 KB
after one season to 1,202 KB after six — was measured along the way and is not
this feature's; nothing here looks into it.

Not built: a club page listing its series against everybody, and records per
season in the Every club table. Both read what is now kept.

### Every veteran contract was three years

`VET_YEARS` is 3, and until now that was every veteran deal in the game:
re-signings, free-agency signings, all of them, for everybody. The franchise
tag added at one year was the only exception in the whole system. So the cap
was a budgeting exercise — you knew what a man cost and you knew you had him
three years, and there was nothing to decide about either.

There is no signing-bonus proration here, so length cannot move the early cap
hit the way it does in the real league. What it can move is the annual price,
in the direction that security is worth something to a player and flexibility
is worth something to a club:

| term | price | on a $20 man |
|---|---|---|
| 1 year (the tag) | 1.60 | $32, one a club |
| 2 years | 1.12 | $23 a year, $46 committed |
| 3 years | **1.04** | $21 a year, $63 committed |
| 4 years | 0.98 | $20 a year, $80 committed |
| 5 years | 0.92 | $19 a year, $95 committed |

These are the second set of prices. The first — 1.22 / 1.04 / 0.96 / 0.90 —
were set by feel, and measured they made five years the right answer at every
age; see **What a contract's length is worth**.

**The three-year figure IS `RESIGN_PREMIUM`**, not a number that happens to
equal it, so a league that ignores the control prices exactly as it did before
and the registered check on that constant still holds.

**The menu starts at two on purpose.** One year is the tag — 1.6 and limited to
one man a club — and a freely available one-year deal at anything less would
make the tag a strictly worse version of itself. That is the dominated-option
defect this file has now had twice, and a test pins it rather than a comment.

**The AI chooses too.** The first rule was intuition — a man past his
position's peak bought a year or two at a time, one still climbing locked up
while he was cheap — and measured, it bought old men the dearest length on the
menu. It is now read off the measurement: five years up to two past the peak,
three from three to four past, two from five past. Without a rule at all the
human would hold a lever the league does not, which is the asymmetry the injury
work refused for the same reason.

This paragraph used to end: *a league with careers off has no ages, so every
club offers three years and the feature is inert — honest, since with nobody
ageing there is no reason to prefer a length.* The AI half of that was true and
the human half was not. With nobody ageing nobody declines, so five years at
0.90 (as it was then) was simply cheaper than three at 1.04 with nothing to pay for it later, and
the keeper screen offered it to the human while every AI club took three. Found
while adding length to free agency, which would have doubled it; `termsOpen`
now holds a league without careers to three years for everybody, the rule such
a league was started under.

What clubs signed on re-signing, under the first rule and under the measured
one (32 clubs; seven seasons for the first, three sets of four leagues × six
seasons for the second):

| term | first rule: share, average age | measured rule: share, average age |
|---|---|---|
| 2 years | 52%, 33.0 | 17%, 34.1 |
| 3 years | 30%, 29.4 | 39%, 30.4 |
| 4 years | 16%, 28.0 | — |
| 5 years | 2%, 25.7 | 44%, 29.3 |

The first rule bought short and called it the right direction; that was
asserted, not measured, and measured it was wrong — see **What a contract's
length is worth** below, which also has what the change did to the league. When
this shipped, roster continuity was **80.2%** against 80.4% without the
control, and the share of expiring men kept 37.6% against 38.7% — both inside
noise.

**A five-year deal looked like dead code and was not.** Over four seasons it was
chosen exactly zero times, and the obvious reading is that the trigger is too
narrow. The real reason is that a rookie deal runs four years, so a four-season
run can barely produce a man young enough to want one. At seven seasons it
appears, thirteen times, at an average age of 25.7 — precisely the players
coming off rookie scale. Widening the trigger would have been fitting a
measurement artefact.

Length in free agency came later; see **Length in free agency** below.

### The franchise tag, which could not be the real one

The NFL's tag exists because a club cannot simply re-sign a player: he has to
agree, and the tag is the one tool that overrides him. No such constraint exists
here. Re-signing is already unilateral and already certain, so a tag that
guaranteed retention would be `RESIGN_PREMIUM` at a worse price — a strictly
dominated option, which is the exact defect the entry above was written to fix.

What it can buy instead is **term**. Re-signing an expiring man writes a fresh
`VET_YEARS` deal and `DEAD_SHARE` makes leaving one early cost half of what is
left, which is a trap the ageing curve springs: the men worth that money are
usually the men about to decline. The tag is one season, at a premium, with
nothing owed afterwards.

`TAG_PREMIUM` is 1.6 against `RESIGN_PREMIUM`'s 1.04, and the gap is the price
of not committing three years. Measured over 32 clubs and four seasons
(`scripts/resign-sim.mjs`):

| tag premium | clubs using it | tagged man | age | years past peak | paid over re-signing |
|---|---|---|---|---|---|
| 1.2 | 56% | 87.0 ovr | 30.9 | 3.7 | $1.3 |
| 1.6 (shipped) | 41% | 87.0 ovr | 31.6 | 4.4 | $3.4 |

**1.2 was too cheap to be a decision.** Salaries here are small in absolute
terms — the tagged man's market is about $6.6 — so a 20% premium is $1.3 against
a cap near $200, while the term benefit it buys is worth an order of magnitude
more: two years of decline at full price plus the dead money to escape them. At
that price every club with an eligible player should tag, and 56% did, which is
roughly everyone who had one. At 1.6 the price binds and usage halves.

**Usage climbs as a save ages** — 25% of clubs by season three, 41% by season
four — because more of the league passes its peak each year. The real league
tags somebody about 15–30% of the time, so the early seasons sit in that band
and a long save runs above it. Nothing has been done about that: it follows from
the ageing model rather than from this constant, and inventing a decay here to
flatten it would be fitting the symptom.

**Who gets tagged.** `aiTagChoice` takes the kept man furthest past the peak for
his position, weighted by what he earns, because a year of decline on a cheap
player is not worth protecting against. It lands on a 87-overall 31-year-old,
4.4 years past his position's prime — which is the man the feature is for. A
league with careers switched off never tags at all, and that is the honest
answer rather than a guess: with no ageing there is no decline to avoid and the
tag is a pure overpay.

**The position rate is a floor, and a rarely-binding one.** `positionRates`
means the dearest `TAG_TOP_N` men at a position so that tagging a squad player
costs what a star earns. At the shipped premium it binds **4% of the time**
(28% at 1.2), because `marketSalary` is flat enough in `overall` that the top-
five mean is only about 1.28x a good player's own price. It is kept for the
degenerate case it guards, not because it is doing much work.

**An ordering bug worth keeping.** The tag was first chosen before the keeper
list was priced, which is the obvious order and is wrong: the tag IS what a man
costs, so a club could tag somebody its own surplus test then declined, and
`validateKeepers` threw on a list that had spent its tag on a player who was not
on it. It surfaced as a crash in the middle of a four-season simulation. The
list is decided first now, the tag chosen inside it, and the price re-checked —
and if the premium no longer fits, the tag comes off rather than the player.

### Length in free agency

A man re-signed by his own club had a choice of length; the same man declined
and bought on the market an hour later did not — every free-agent deal was
`FA_YEARS`, three years, flat. An offer is now `{ salary, years }`, and a bare
number, which is what a league saved in the middle of its market still holds,
reads as the three-year deal it always was.

**The price for a length is the re-signing curve without its premium.** Nobody
on the market has an exclusive window to charge for, so `FA_TERM` is
`TERM_PRICE` over its own three-year figure: three years is market exactly, as
before, and on a $40 man the menu reads $44 / $40 / $38 / $36 for two to five
years. Rounded up like every price here, so a cheap man gets no discount for
length and pays a whole dollar for two years. No float error moves the ceiling
at any market value the game can produce; that was checked for every one.

**The best offer is the one furthest over his asking price for its length**
(`offerValue`), not the biggest salary. Comparing salaries would hand every
contested man to whoever offered two years, since a short deal costs more a
year by construction. It has to be the *rounded* ask, not the curve: against
the curve, five years at a $5 ask reads 13% better than three years at the
same ask, and the ceiling would be deciding contested signings. Against the
rounded ask every offer at the asking price is worth exactly 1 whatever its
length, and the tie goes to the worse record as it always did. Because a
smaller salary can now beat a bigger one, the closing report names both
lengths when they differ — "your $31 × 3y, he took $29 × 5y, which was further
over what he asks for that length" — where it would otherwise read as the
market cheating.

**AI clubs choose by `aiTerm`**, the keeper round's rule, and hold everybody to
three years where `termsOpen` says nobody ages.

What it did to a 32-club league: three seed sets of four leagues × six seasons
each (`scripts/resign-sim.mjs`), before and after, the range across the three:

| | before | after |
|---|---|---|
| of the men a club declined, not got back | **83.7–86.1%** | **87.6–88.6%** |
| cap used at kickoff | **82.1–83.1%** | **81.4–81.9%** |
| expiring men declined to the market | 72.7–75.5% | 71.2–73.6% |
| declined 90+ players taken by a rival | 50–56% | 55–61% |
| roster continuity | 78.2–78.6% | 77.5–78.2% |
| dead money across the league | $77–107 | $89–113 |
| best-to-worst lineup spread | 658–747 | 658–692 |

Two shifts are clear of the spread between seeds: a club gets fewer of its
declined men back, and a little less of the cap is used. The next four moved
the same way in every one of the three pairs, but by less than the seeds
disagree, and three pairs agreeing is a one-in-four chance for any single
figure — so they are not established. The spread moved both ways and is noise.

Market signings split 60% two years, 27% three, 12% four and 1% five, at about
+4.7, +1.6, −0.4 and −3.5 years from peak: the market is mostly men past their
best, and the AI bought them short. Under the measured rule that replaced it
(next section) the split is 24% two, 33% three and 43% five, at +6.1, +3.6 and
+0.9. **Inferred, not established:** a club that
declines a man to save money now meets a market that prices his two-year deal
at 1.17 rather than plain market (at the prices of the time; 1.08 since), so it
is less able to buy him back.

### What a contract's length is worth

The length menu rests on a premise: a long deal is cheaper a year and costs you
later, when he declines. `scripts/term-value.mjs` (`npm run terms`) tests that
on what really happened. It follows every market signing in real leagues for
five seasons — his actual rating each year, knocks included, and whether he
retired — and prices all four lengths at the same distance over his asking
price. A season's value is what he was worth that year (`marketSalary`) minus
what he was paid; a deal that has ended is worth zero, which flatters short
deals, since winning a man back costs a premium; a club may cut him in any year
if that is cheaper.

**The first prices failed it.** At 1.22 / 1.04 / 0.96 / 0.90, over 951
signings in six leagues, five years was the best length at the asking price
**in every age band** and two years the worst: +0.8 for five against −6.6 for
two even at five-plus years past a position's peak. So the AI's rule — old men
short — bought the dearest length there was for exactly the men it applied to,
in the keeper round since it shipped. Two causes, both measured: the long-end
discount outran how fast a man declines inside five seasons, and a man who
retired took his contract with him — `releaseRetired` deleted it and `bookDead`
never saw it — so the years a long deal was supposed to cost were the years
men retired into, and they were never paid.

**Two changes.** Retirement now leaves the guaranteed half of every year left
behind, booked as dead money exactly as a cut is (`bookRetirements`); a deal
that has just run out, or a minimum one, leaves nothing. And the curve is
flatter: 1.12 / 1.04 / 0.98 / 0.92. Candidate curves were scored offline
against the saved trajectories, and it takes both. With retirement still free,
the flattest curves in the grid moved old men to three years in the market but
left every re-signing at four; with retirement booked on the old steep curve,
only men five or more past their peak moved off five years. Together they give
the gradient in both markets.

Measured on 795 fresh signings, from leagues played under the new rules, at
the asking price — mean dollars over five seasons, and how often each length
is the best one:

| years from peak | n | 2 years | 3 years | 4 years | 5 years | best |
|---|---|---|---|---|---|---|
| 2 before to peak | 115 | −4.3 | −0.9 | +0.2 | **+5.1** | five, 83% |
| 1–2 past | 218 | −4.6 | −1.7 | −1.2 | **+3.3** | five, 74% |
| 3–4 past | 256 | −4.4 | **−2.3** | −3.4 | −2.8 | three, 50% |
| 5+ past | 201 | **−3.8** | −3.9 | −6.7 | −8.2 | two 48%, three 40% |

On the re-signing curve the pattern is the same with the edges softer: five
years at and just past the peak (about half, four years next at 36–38%), two
years clearly at five-plus past (71%), and 2 / 3 / 4 within a dollar in
between. With retirement still free on the same signings, five years would win
at 3–4 past (58%) and at 5+ past (55%) again: the retirement rule is what turns
the old end. Bought well over the asking price, as bidding wars are, two years
is best in every band with a real sample (95–100%): every year of an overpaid
deal loses money, so the fewest lose least. So length is now decided by two things a manager can
see — how old he is and how much he is being overpaid.

`aiTerm` is read off that table: five years up to two past the peak, three from
three to four past, two from five. Four years is never its answer; it is on the
menu for a human who judges a man better than his age says.

**What it did to the league** — three seed sets of four 32-club leagues × six
seasons (`npm run resign`), before and after, the range across the three:

| | before | after |
|---|---|---|
| roster continuity | 77.5–78.2% | **81.7–81.9%** |
| expiring men re-signed | 35.4–36.9% | **41.2–41.7%** |
| declined men not won back | 87.6–88.6% | **81.9–86.1%** |
| cap used at kickoff | 81.4–81.9% | **83.9–84.0%** |
| dead money across the league | $89–113 | **$170–195** |
| expiring men declined | 71.2–73.6% | 68.4–71.1% |
| declined 90+ players taken by a rival | 55–61% | 45–56% |
| best-to-worst lineup spread | 658–692 | 672–680 |

The bold rows are clear of the spread between seeds; the rest overlap it. Clubs
keep more of their own men, because five years at 0.92 and two at 1.12 are both
cheaper than what the first rule paid, and `aiKeepers` weighs every price
against `BIRD_IN_HAND`. Continuity at 81.8% is comparable to the 80.8–84.1%
measured when the re-sign premium was set, over shorter runs. Dead money nearly
doubles, to about
2.8% of each club's cap — the price of long deals now being a real risk. How
much of that is retirements and how much is cuts of long deals is **not
measured**; the dead-money ledger does not record why a charge was booked.

The trajectories are kept (`TERM_VALUE_DUMP`) so a curve can be scored in
seconds rather than by re-running the leagues.

## Dynasty loop (`offseason.js`)

A season ends at the final; the offseason starts from the hub. Every rostered player carries a contract from the moment a season starts: the price he went for at auction (or the round he was drafted in), how many seasons running he has been kept, and when it started. A player claimed off the wire is on a $1 deal. Contracts are keyed by player, so a trade moves the deal with the man.

**Keepers.** A fantasy club keeps up to `settings.keepers` players (6 by default, changeable at setup or in settings, 0 for a full re-auction every year). A pro club has no quota at all — the cap and the length of a deal decide, and `keeperLimit` returns the whole roster under a cap; see *The pro league offered a keeper quota it has never used* above. An auction keeper costs last year's price plus the greater of $3 or 15%, compounding each year; a pro re-signing costs market plus `RESIGN_PREMIUM`, for the reason in *The pro keeper round had no decision in it* above; a player can be kept three seasons running and then must return to the pool. Keepers plus a dollar for every open slot must fit under the $200 cap. In a draft league keepers simply hold their slots. Everyone not kept returns to the pool with the players nobody rostered.

**The market.** The auction reopens with each club's leftover cap and the worst club nominating first; the price guide re-prices the thinner pool and the smaller pot on its own. A draft league drafts worst to first, and the pointer skips clubs whose rosters are already full, so a fantasy club that set its quota to 18 and filled it sits out the last nine rounds. Whether the order turns round on itself each round depends on what is being drafted — see the two-pools section. Either way the existing auction and draft screens run the market, and the season starts from their finish button. The hub's history card keeps every season's champion and your own finish.

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

**The ceiling was flat at 96, and the pool is not.** That number was picked to sit just under the best real players, and at quarterback, receiver and corner it does — Rodgers, Rice and Sanders are 96. At the other eight positions it does not. The best real tight end is 92, the best back and the best linebacker 93, the best safety and the best punter 94, so a flat cap licensed a fictional player to beat the best there has ever been at his own position by up to five points. Played through, it did: a generated punter at 97 against Ray Guy's 94, a linebacker at 97 against Ray Lewis's 93, a safety at 96 against Ronnie Lott's 94. The cap is now `positionPeak(pos)`, computed once from the shipped pool through `rawOverall`, so it moves when the pool does and cannot drift out of date. Two seeds re-run: nothing generated now exceeds the best real player at its position, and equalling him is still allowed, which is the intended rule — the ceiling is a ceiling, not a reservation.

One detail that had to be fixed with it: the scale-back lands on the cap by rounding, and rounding up crossed it. A season whose rounded attributes overshoot now has its largest gain shaved by a tenth at a time until it is back under, bounded so a pathological case cannot spin. It shaves this season's biggest *gain* rather than the biggest career delta, which are different attributes for anyone past his rookie year — taking it off the career total would claw back progress from earlier seasons to pay for a tenth of a point of rounding in this one.

**Then the fix was checked, and the ceiling was being broken a second way.** Rather than trust the playthrough, a probe walked 112,000 career-seasons and counted how many finished above the player's own stored ceiling. The answer was 4,993, worst case four points over. Run again with injuries switched off it was zero, which named the culprit exactly: the knock branch.

Two mistakes, compounding. The branch lowered `next.ceiling` after an injury, but the clamp a few lines down read `c.ceiling` — the *incoming* career's, i.e. the old high one — so the season of the injury developed against a ceiling that had already been lowered and ignored. From then on the man began every season already above his own ceiling, and the clamp's `after > before` guard, meant to stop a declining player being dragged down, saw that he was not improving and declined to act. He stayed over it for the rest of his career. The second mistake was in the scale-back itself: it rebuilt from `c.d`, the pre-injury deltas, so a clamped season handed the injury damage straight back.

The repair separates two things that had been conflated. `before` is what he was last season and is still what gets reported; `start` is what he is worth after the knock and before this year's growth, which is where development actually begins, and every clamp now measures against that. The ceiling drops by what the knock cost rather than being pinned to what he is worth the day after it — pinning it froze him there permanently, which contradicted the comment three lines above promising he could still grow through an injury from further back. 4,993 violations to zero.

Three mutations confirm the probe is not just agreeing with itself: restoring the `c.ceiling` read gives 272 violations, measuring the clamps against `before` gives 267, and deleting the rounding shave gives 140 with injuries off entirely. Each is caught by a different one of the three tests now in `knocks.test.js`. Reinstating the old ceiling pin also breaks a *pre-existing* test — the one asserting a back loses more to a knee than a quarterback does — which is the strongest evidence that the pin had been quietly distorting the injury toll all along.

**Measured** (`scripts/career-sim.mjs`, the pool's top 200 and 600 generated rookies, run through the engine's own step function so the harness cannot drift):

| | |
|---|---|
| Signed at his prime, after 1 / 3 / 5 / 10 seasons | −0.1 / −1.7 / −4.1 / −11.9 overall |
| Career length | median 9 seasons, range 5–14 |
| Rookie entry → peak, median | 63 → 72 |
| Rookie peak, 90th / 99th percentile | 83 / 91, best in 600 was 95 |
| Class that peaks at 80+ / 88+ | 19.0% / 3.2% |
| Class that never gains 5 | 33.3% |

A keeper run is three seasons, which costs about 1.3 overall — noticeable when you are paying a raise for it, and not a cliff. The rookie numbers are the ones that matter most, because they fix the honest limitation the intake shipped with: an eight-club league's worst starter is an 88, so a class whose median peaks at 72 still mostly does not matter, but 3.2% peaking at 88 or better means roughly one genuine prospect per class instead of none. In the pro league, where the cutoff is 75, a fifth of every class becomes a starter somewhere.

**Retirement.** A player retires nine seasons past his prime, give or take a few, or whenever he drops below 52 overall. He is flagged rather than deleted: league codes and season cards tell player pools apart by counting ids, so dropping a retired man would move that fingerprint and a league would stop being able to open its own code. Signing him is blocked at the three places that offer players — free agency, the auction and the draft — and he stays visible in the pool, which is where a retired great belongs. Retiring frees his roster slot and ends his contract, and the offseason market fills the hole — but a man who retires with years left leaves the guaranteed half of each behind, booked as dead money exactly as a cut is (see **What a contract's length is worth**).

**Plumbing.** State lives on `league.dev`, not `league.careers`, because awards.js got there first and uses that name for the statistics a hall-of-fame case is built from. `applyCareers`/`careerIndex` build the league's view of the pool and are idempotent; a developed player carries the base he was built from and his own `ovr`, because the overall cache is keyed by id and two open leagues can hold the same man at different ages. Anything rating a set of attributes not attached to a fixed id goes through `rawOverall`, which does not cache — getting that wrong silently froze the ceiling logic at its pre-scaling value, which is a bug worth remembering.

**Both settings default on for a new league and stay off for an old one.** An absent setting is not a false one: it means the save was written before the feature existed. Turning chemistry on mid-season moves every club by up to two points at once, measured, which is changing the rules under somebody halfway through a season. So a league from before this keeps playing exactly as it did, and the settings screen says so and offers the switch.

**How soon, as against how high.** The feature asked for here was scouting fog over a rookie's growth curve, and measurement said it could not be built as specified: there was nothing to be uncertain about. Among rookies who gained a similar total (8 to 16 points), the season they reached their ceiling ran p10 = 3, median 4, p90 = 5. A two-season spread across the whole class is a noisier number, not a decision.

The cause is structural rather than a tuning miss. `ceilingFor` sets a prospect's room in proportion to `growth`, and `step` climbs at a rate also proportional to `growth`. Distance and speed both scale with the same draw, so the time to cover it cancels. Measured directly: room ran 7.2 points for the slowest developers to 18.1 for the fastest, two and a half times as far, while years-to-ceiling sat at 5.0, 4.8, 5.0, 4.5, 5.1. Flat. Every prospect in the game arrived in about five seasons whoever he was.

So the two were separated. `pace` is drawn independently at `normal(1, 0.28)` clamped to 0.5–1.8, and multiplies the climb only — the ceiling is still drawn from `growth` alone, which is what lets them vary independently. Measured by pace band afterwards: room stays flat at 11 to 13 points while years run 6.7 down to 3.3. That is the decision the fog needed — a quick study is worth something different to a club contending now than to one building, and at the same projected ceiling they are now different players.

It defaults to 1 where absent, so a career stored before this develops exactly as it did, and a test holds that. League drift is unchanged: the same dynasty's mean starter went 85.1 → 76.3 against 85.0 → 75.8 before, so nothing about the aggregate arc moved.

**One dead end worth recording.** The first attempt gave each player a per-position peak offset (`peakShift`), on the theory that arrival is when the curve turns. It moved almost nothing — p90 arrival went from 5 seasons to 6 — and was reverted. The reason is that the *ceiling* binds before the curve turns: a player stops climbing because he has run out of room, not because he has aged past his prime, so moving the prime does not move arrival. Worth knowing before anyone tries it again.

**The quarterback was the one position ageing could not reach.** Every other position on the field runs down: measured peak-to-last across a whole career, a punter falls 17.4 rating points, a defensive lineman 15.9, a receiver 15.4, a back 13.9, and even the offensive line — the position that holds up best after him — falls 8.9. A quarterback fell **4.7**, and 22% of them never declined by three at all.

Season by season, a quarterback signed at his prime got *better* for seven years: +1.1, +1.8, +2.1, +2.0, +1.5, +0.9, +0.4, turning negative only in his eighth season at the age of thirty-seven, which is around when he retires anyway. There was never a year in which a club had to decide anything about him. At the position that decides more games than any other, the dynasty had no question to ask.

**It was a filing error, not a tuning one.** `tha`, throwing accuracy, was classified as a mental attribute alongside `awr`. Those two are 75% of a quarterback's rating — 0.40 and 0.35 — and the mental curve does not turn until *six seasons past the prime*, then declines at 0.40 a year against the physical curve's 0.95. So three quarters of a quarterback was still climbing at thirty-four.

The line that fixes it is the one the rest of the list already draws: reading the game is mental, executing is a skill. Catching, route running, blocking, coverage, tackling and ball skills are all `skill`. Throwing a ball accurately is the same kind of thing — what a quarterback *does*, not what he knows — while awareness, which is what he knows, stays where it was. `tha` now sits with the other execution skills and turns one season past the prime rather than six.

**Nothing was retuned, and nothing else moved.** `tha` is a quarterback attribute and nobody else's, so every other position's ageing is unchanged to the decimal: 13.9, 15.4, 13.2, 8.9, 15.9, 10.9, 10.2, 11.2, 14.7, 17.4, exactly as before. Career length is unchanged at a median of 10, range 5 to 14.

| | before | after |
|---|---|---|
| Peak age, against a stated prime of 29 | 31.2 | 30.0 |
| Peak-to-last across a career | 4.7 | 7.9 |
| Share who ever decline by three | 78% | 94% |
| Seasons no worse than the day you signed him | 6.7 | 3.6 |

He is still the best-ageing position in the game, which is the point — 7.9 against the line's 8.9 and everybody else's 10 to 17, and still the safest man to commit three years to. He is simply no longer immune. The arc now reads like a career: a point or so for two seasons, flat at thirty-two, then −1.8 at thirty-four, −4.7 at thirty-seven, −7.2 at thirty-eight. A thirty-three-year-old is worth keeping and a thirty-six-year-old is costing you five points, which is a decision where there was none.

**The alternative was tried and it is worse.** The obvious fix is to retune the mental curve — turn it earlier, drop it faster — and it fails on its own terms. `awr` is carried by nine of the eleven positions, so tightening the curve moves all of them to fix one, and pushed far enough to matter at quarterback it makes him age *worse* than the players whose legs he is supposed to outlast. That is now a test: reverting the classification and retuning `mental` from a start of 6 to 1 instead fails "he still ages better than anybody else". The curve numbers were right; what was wrong was which attributes were being sent down them.

Four tests, four mutations, each caught by the test that should catch it — putting `tha` back with `awr`, filing it as physical instead, leaving it off both lists so it reaches the `skill` default by accident rather than by decision, and retuning the curve in its place.

One consequence worth stating: this changes how an existing save's quarterbacks will age from here. Stored careers keep every point they have already gained — the deltas in `league.dev` are untouched — but a thirty-two-year-old who was going to keep climbing will now start coming down. That is the fix working rather than a migration, and there is nothing to migrate.

**How a man ages, which was not a fact about him at all.** The item this closes was *positional decline that forces a squad move*, and none of the three things that phrase could mean survived measurement.

*A declining player moving position* cannot be built without inventing attributes he has never had. Only three moves keep a man inside his own attribute set — tight end to receiver, linebacker to lineman, safety to corner — and all three get *further* away with age, not closer: own-position rating minus the best kindred one went 0.00 to 0.75 for the tight end and 6.63 to 8.67 for the linebacker between a player's prime and five seasons past it. The safety reads −0.37 at his prime, meaning he is already rated better as a corner, and that is a standing property of two weight vectors rather than anything to do with ageing.

*Later:* position changes were built after all, on a narrower claim than this paragraph rejects — not as a response to ageing, and with at most one skill estimated rather than invented, under a bound on how far that estimate can move a rating. See **Position changes** below.

*A depth chart drifting out of order* does not happen. `sortDepthCharts` keeps every group in rating order, and `confirmKeepers` clears `depthSorted` every offseason, so even a chart the user arranged by hand is re-sorted the following year. Measured over twelve seasons of a user club that never touched its chart again: zero slots out of order, in every season, in every league.

*Decline forcing anything at all* was the real finding, and it was upstream of both. `step` scales its growth branch per player, twice over, by `growth` and by `pace`. Its decline branch was `-(c.drop + c.accel * past)` for everybody — the same slope for a twenty-three-year-old lineman and a thirty-four-year-old back, with nothing in it belonging to the man. A season past prime cost −0.58 at the prime and −2.14 ten years on, with a standard deviation of 0.7 that was per-attribute rounding noise, and **no career in 2,400 ever lost six points in a season**.

There was spread in the totals — five seasons past prime ran a standard deviation of 2.19, and 3.09 once injuries counted — but none of it was attributable. It was the same coin flipped for everybody, so there was no such thing as a player who ages well, nothing to judge, and therefore nothing that could force a decision.

**`wear` is the missing term.** Drawn at career start at `normal(1, 0.34)` clamped to 0.35–2.0, it multiplies the decline and leaves the climb alone, the way `pace` multiplies the climb and leaves the ceiling alone. Five seasons past prime now runs −2.62 for the men who age best against −8.13 for the men who fall away, with the population mean held at −5.14 against −5.11 before. Every documented career aggregate is unmoved: measured at `wear` fixed to 1 against the shipped draw, career length is median 9 in both, and the decline at three, five and ten seasons is −1.7, −4.1 and −11.2 against −1.7, −4.1 and −11.3. The spread is free.

The spread stops at 0.34 because the clamps start to bite past it. At 0.42 the read is worth 3.97 rather than 3.57 over a keeper window, but 6.1% of players pile up on the floor instead of 2.8%, and a one-in-sixteen spike of men who age perfectly is a distribution artifact rather than a population.

**What it does not do is force a squad move, and that claim should not be made for it.** Measured across 1,056 club-seasons, the rate at which a starter loses his place while declining went from 0.33 a club a season to 0.32. It cannot move: depth-chart gaps at a club run twelve to thirty-eight rating points and five seasons of decline spread covers about five. A club replaces a fading starter from the market, not from its own bench, and that mechanism already existed.

**What it does is make a veteran judgeable.** `wear` is never shown. What is shown is what he has already done — the player screen now reads "down 7 in 6 seasons" rather than "down 7", which turns a total into a rate. Tested the way a manager would use it, watching four seasons and then deciding about the next three, and compared *within a single age* so the answer is not just the age badge restated: the third of veterans who had held up best lose 3.93 over the next three seasons against 7.90 for the third who had slid, a gap of 3.69 overall, at a correlation of 0.623 between what the screen says and what happens next.

That read is a strengthening rather than an invention, and the honest number is the difference: before `wear`, the same test gave a gap of 2.57 at a correlation of 0.518, driven by injury luck and accumulated noise. "He has held up" used to mean mostly "he has been lucky". It now also means something about him.

**A seed that had been moving underneath all of this.** `ceilingFor` draws from the career RNG at the end of `startCareer`, so every field added above it re-rolls every prospect's ceiling. Adding `pace` in the previous change did exactly that, and the share of a class peaking at 80+ moved 18.8% to 19.8% while the share that never gains five went 31.3% to 33.3% — which reads like a tuning decision and was a shifted stream. The arc traits now come off their own seeded stream, so `ceilingFor` sees what it always saw and the next trait added there costs nothing. A test states the career stream's draw order directly and fails if anything is inserted into it.

**Two instrument mistakes, both caught before shipping.** The first was a name collision: `advanceCareers` already writes `from` on a career, meaning the league season it began, and it spreads over whatever `startCareer` returned. Storing the entry age under the same name made every veteran on the team screen read "down 7 in 35 seasons". It is `startAge` now, and a test covers the collision.

The second is the more useful one, and it is the same mistake as the last change's. Six mutations were run; five were caught and the one that escaped was moving the arc traits back onto the ceiling's RNG stream — the precise regression the test existed to prevent. The test asserted that `startCareer` is deterministic and that the traits land in range, and both of those are true whichever stream they come off, so the mutation passed cleanly. A test of a draw *order* has to state the draw order: it now rebuilds the career stream draw for draw and compares the ceiling, and both variants of the mutation fail it. Twice now the first version of a test has measured something guaranteed by a clamp or by construction rather than the property in question, which is worth treating as the default failure mode rather than an accident.

Injuries that shorten a career are built — see **What a knee costs** below.
Scouting fog over the growth curve is built too — see **The band says where, and now also when** under Scouting.
The roadmap above and everything after it is now finished.

### Development focus (`focus.js`)

Careers gave every man hidden traits — `pace` scales how fast he climbs,
`wear` how fast he declines — and nothing a club did could touch either. A
club now names up to three men a season for its staff to work with: one still
climbing climbs faster (`FOCUS_CLIMB`, the climb doubled), one past his peak
declines slower (`FOCUS_EASE`, 60% less). It is applied at the one moment
careers move, when the offseason opens, and the picks are then cleared so a
stale choice cannot carry into a season it no longer fits.

**It costs the rest of the roster, on purpose.** A boost with no cost is a
choice with one right answer, and used by every club it would inflate the
league — and ratings are what every salary, the draft and the cap are priced
from. So the staff's time is a budget: every man focused makes each teammate
climb `FOCUS_COST` (2.8%) slower and decline 2.8% faster. What a club gains is
concentration — the men who matter most, at the ages where a season moves them
most — not development from nowhere.

**The staff picks for anybody who does not**, AI clubs and a human who names
nobody alike, from what every club can see: age, position, starter or not, and
for a rookie his scouting range, which caps what hurrying him can buy. Never
the hidden traits focus acts on. The expected season at an age comes from
`expectedChange`, derived from the career curves themselves so it cannot go
stale when they are retuned. A man whose career has not started yet — anybody
in a league's first season, or signed this season — is read at the age his
career will start at, which is fixed by the seed and is exactly what the next
offseason records; without that the staff picked nobody in a first season
while a human could name anyone. Leaving the choice alone is therefore never
worse than the league around you.

Measured exactly (`npm run focus`, `scripts/focus-sim.mjs`): before each
offseason every rostered man's season is stepped with the focus plan and
without it, off the same random stream, so the difference is focus and nothing
else. Two seed sets of two 32-club leagues × five offseasons, 320 club-seasons
each:

| | seeds 4000 | seeds 9000 |
|---|---|---|
| gained by focused men | +907 | +926 |
| paid by their teammates | −906 | −960 |
| **net across the league** | **+1** | **−34** |
| starters, leverage-weighted, a club a season | +12.2 | +13.7 |
| staff's picks, as a share of the best three | 79% | 82% |
| three at random, as a share of the best three | 25% | 25% |

What focus did for the man focused, in overall points that season:

| where he was | seeds 4000 | seeds 9000 |
|---|---|---|
| climbing, 3+ years before his peak | +1.87 | +1.75 |
| near the peak, −2 to +1 | +0.82 | +0.91 |
| declining, +2 to +4 | +0.77 | +0.80 |
| well past, +5 on | +0.79 | +0.82 |

The net is within 4% of the ~915 points moved, so focus redistributes and does
not inflate. Choosing matters: the staff's picks are worth about three times
three at random, and a human who reads a man's history — "up 7 in 2 seasons"
says more about his pace than his age does — can beat the staff, which reads
population averages. At the measured slope of 25 strength to a point of
differential, the +12 to +14 on starters is about half a point a game per
season of focus, and it stays as long as the men do.

**How it was sized, including two wrong turns.** At a cost of 0.035 the
teammates paid nearly twice what the focused men gained: a net of −409, which
would have deflated the league. Halving the cost fixed the sign, but at
`FOCUS_CLIMB` 0.5 a focused man gained +0.5 to +0.85 a season, and in whole
rating points that reads "+0" half the time — a screen reporting nothing is
not a decision anybody can feel. Doubling the climb and easing decline 60%
made it +0.8 to +1.9. Then the measurement itself was wrong twice. It skipped
every man whose career had not started — this season's signings — which
counted his teammates' bill for his focus and not the focus; and the
first-season age fix above made the staff pick exactly those men, which is how
the net suddenly read −160. Counting them, the net is the +1 and −34 above.

Rounding still shows: a veteran's report often reads +1 or "no change", which
is honest — a season held at 0.8 of a point is below the resolution of a
rating. On for new leagues; off, like careers and chemistry before it, for a
league started before it existed, until switched on in settings; and only where
careers are on, since without ageing there is nothing to focus.

### Position changes (`translate.js`, `convert.js`)

A club can move one of its own men into an open slot at another position, and
he is rated there on what his skills are worth. The engine plays a man by his
skills whatever the depth chart calls him, so within limits this is not a
figure of speech: a safety moved to corner has every skill a corner is rated
on, and what the move changes is the weighting. The limits are the design.

**Two things written earlier had to be faced first.** Under positional
decline, above, a position change was recorded as something that "cannot be
built without inventing attributes he has never had". And the rating scale
itself, at the top of this document, is defined as how dominant a man was at a
skill *relative to his contemporaries*, anchored by honours — All-Pro, Pro
Bowl — that are awarded position by position. A linebacker's 90 in coverage is
therefore a linebacker's 90. The pool shows it: linebackers rate as fast as
corners, 83.1 against 82.5, and faster than safeties at 81.8, which is true of
no common scale. The first build of this carried skills across as they stood
and made Ray Lewis a 92 cornerback. Nobody in the pool is rated at two
positions with a skill in common — the three names that appear twice are two
Mark Ingrams, two Jimmy Smiths and Yale Lary, safety and punter — so the gap
cannot be measured and corrected.

**So there are two rules, and the table is derived from them rather than
listed.** A move stays inside a group whose players are rated against
overlapping peers: defensive backs with defensive backs, where safeties come
out a little slower than corners and far better tacklers (82.0 against 72.6),
which is what one scale would show; receivers with receivers, where tight ends
are slower than receivers, 75.3 against 82.5, likewise; and the pass rush with
the pass rush, since an edge rusher is the same athlete at either end of the
line. And a move may need at most one skill the old position never rated, and
only when guessing it cannot move his rating by more than `MAX_GUESS`, one
overall point. The guess is a least-squares fit over the new position's own
players — what men there with his other skills are rated at it — and the bound
is its weight times the fit's residual standard error, taking the heavier of a
linebacker's two weight vectors so an edge rusher's pass rush counts.

| move | guessed | weight | typical miss | R² | could move him by | on offer |
|---|---|---|---|---|---|---|
| S → CB | — | | | | 0 | yes |
| CB → S | run defence | 0.12 | 1.17 | 0.98 | 0.14 | yes |
| TE → WR | — | | | | 0 | yes |
| LB → DL | — | | | | 0 | yes |
| WR → TE | blocking | 0.25 | 9.28 | 0.44 | 2.32 | no: the guess |
| LB → S | ball skills | 0.12 | 2.59 | 0.93 | 0.31 | no: the group |
| LB → CB | ball skills | 0.11 | 5.50 | 0.75 | 0.61 | no: the group |
| S → LB | pass rush | 0.45 (edge) | 7.16 | 0.64 | 3.22 | no: both |
| S → DL | pass rush | 0.61 | 5.28 | 0.68 | 3.22 | no: both |

Receiver to tight end is the loss that hurts, since it is a real move, but a
tight end's blocking is barely predictable from his receiving — true of the
sport — and it is a quarter of his rating. Linebacker into the secondary would
pass the guess bound and still be wrong, which is what the group rule is for.
A fit checked only on the men it was fitted to says how well it describes them,
not how well it carries over, so where another position has the guessed skill
and every predictor the fit was tried there too: linebacker to corner's
ball-skills fit, on safeties, misses by 3.9 with a bias of −0.6; safety to
lineman's pass-rush fit, on linebackers, misses by 22.2 with a bias of +18.2 —
which is what guessing the one skill that matters most looks like once it is
checked.

The guess is marked down `UNTRAINED` (5) for a skill he was never asked to use,
read once, at the move, from who he is then rather than from the pool's record
of him, and stored as a base rating with his career's delta for that skill
taken out, so development adds to it exactly once. The job takes learning:
his first season at a new position costs every skill `SETTLING[0]` (4) and his
second `SETTLING[1]` (2). Both numbers are chosen, not measured. Going back to
his own position is not a move — the record is deleted and there is nothing to
learn.

**The premium, because the table is also an arbitrage.** Over the real pool
(`npm run convert`):

| move | rating change, mean | p10 | p90 | worth more there by leverage, unpriced |
|---|---|---|---|---|
| S → CB | −0.2 | −3 | +2 | 95% |
| TE → WR | +0.8 | −2 | +5 | 7% |
| LB → DL | −5.3 | −11 | +1 | 1% |
| CB → S | −3.2 | −5 | −1 | 1% |

A safety is the same player at corner, near enough, and the market prices a
corner's points half as high again — leverage 4.39 against 2.87. Charged
nothing, buying safeties to play corner would be a choice with one right
answer. So a move to a position the market pays more for raises his salary by
the difference, his market value there once settled against his value where he
was, for the rest of his deal; a move down costs nothing and refunds nothing.
The median premium for safety to corner is $3. By the market's own arithmetic a
move is then worth what it costs, and the settling seasons make it slightly
worse than signing an equal man.

**Whether anybody gains from it, measured.** Thirty-two-club pro leagues were
stopped at free agency, when a club can see the market, and each club's best
move under a rule was applied to a copy of the league. Both copies ran to
kickoff off the same random stream — the no-move baseline is run twice and has
to reproduce — so the difference in that club's lineup (overall × leverage)
and payroll is what the move did. "Net" counts payroll at the market's rate,
$1 to 11 lineup points. Three rules: *market*, which scores a move by what it
puts in the hole against the best man still unsigned there, and what it leaves
against the best still unsigned at the position he vacates, less the premium;
*naive*, which moves anybody worth more at the new position by leverage; and an
*oracle*, which runs every move open to the club to kickoff and keeps the best,
or none.

| 3 leagues × 3 offseasons × 32 clubs | seeds 5100 | seeds 6100 |
|---|---|---|
| market: moves in | 18.1% | 26.7% |
| market: lineup, payroll, **net** | −10.8, +$1.1, **−23.4 ± 16.2** | −20.3, −$0.1, **−19.8 ± 15.4** |
| naive: moves in | 37.2% | 40.3% |
| naive: lineup, payroll, **net** | −29.1, +$0.8, **−38.3 ± 11.9** | −32.6, −$2.5, **−4.4 ± 10.7** |
| oracle: a move helps at all | 36% | 46% |
| oracle: lineup, payroll, **net** | −7.2, −$2.8, **+23.3 ± 6.0** | −2.3, −$3.7, **+39.4 ± 10.6** |

No rule a club can follow gains, in either seed set, and every one of them
leaves the kickoff lineup worse — by 11 to 33. The market rule's estimate is
optimistic about landing the best man at the hole it opens, since the clubs
ahead of it are shopping too; the naive rule, almost entirely safety to corner,
pays the premium and a season of learning for a rating it does not get until
the year after. The oracle's gain is real but it is the best of three or four
noisy outcomes — a move changes what a club drafts, which changes what everyone
after it drafts — and it comes from payroll, not the lineup, which it also
leaves worse. Nobody can see that in advance. The two seed sets agree on the
sign of every row and not on sizes, which is as far as this should be read.

That is the case for **AI clubs not moving anybody**, and it is an asymmetry,
so it is worth being plain about: a human holds a lever the league does not.
Measured, the lever is worth nothing on average to anyone who cannot see the
future; what is left is situational — a hole the market cannot fill well and a
man of your own who can, read by looking. If a rule is ever found that gains,
it belongs to every club.

**What moves with him.** He ages on his own position's clock (`primeOf`):
legs are as old as they are, and moving a fading corner to safety must not be
a way to buy two years of slower decline. His career's ceiling moves by what
the move did to his rating, so the room he had left is the room he keeps, and
never above the new position's peak. A rookie still behind the scouting fog
cannot be moved, since his rating at a new position would read the fog
straight off the screen. The move is recorded, travels in a league code, and
the depth chart and player screen say where he came from and what the job is
still costing him.

**Faults found building it.** The app's pool cache was keyed on rookies,
careers and retirements only, and handed the career code a stand-in league
object with none of the rest, so a move would have left the screen showing him
at his old position until something else changed; it now carries the moves and
the season, since the season decides the settling cost. Simulating ahead built
its player index before the keeper round turns the calendar and used it for the
market, the draft and the depth charts, so a man moved in the offseason was
read as if his first season were already behind him; it is rebuilt after the
keeper round.

Fourteen tests and twenty-four mutations, twenty-three caught. The one that is
not is equivalent: pointing a settled view's `base` at the developed view
rather than the undeveloped record changes nothing, because `developed()`
unwraps `base` one level before it reads anything. Two of the catches needed
fixing first. A move down priced as a refund escaped the first pass — it never
reached a salary, since `convertPlayer` only adds a positive premium, but the
dialog would have read "+$-3 a year" — and is now tested. And the mutation that
writes a career in place was "caught" by a syntax error of its own making,
which proves nothing; rewritten as valid code it is caught by the ceiling
test. Pro leagues only, since the premium needs a cap; on for new leagues and
off for existing ones until switched on in settings.

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

Not built: assistant coaches (see **Why there are no coordinators** below), contracts or compensation for a coach, interviews, or any say in which club poaches you. Speculation: whether 10% turnover is the right number. It is chosen against chemistry's three-season payoff rather than against the real league, and it has not been tested for how it feels over a long save.

### Why there are no coordinators (`npm run schemes`)

Assistant coaches were proposed after all — coordinators with scheme strengths — and a premise check stopped them. Three reasons, each enough on its own.

**You are already the coach.** Scheme and play-calling are the human's job in this game: the strategy sliders, coach mode, and an owner who sacks you for the results. A coordinator under you either takes that control away, which makes the game worse, or matters only to the computer's clubs, which leaves you nothing to decide.

**A scheme identity is already four systems.** Every AI personality drafts and calls plays as one (Air Raid throws at 0.66, Ground & Pound at 0.44); the pass/run read fits a club's mix to its roster, about half a point a game for following it; clubs game-plan each opponent; and every slider drifts weekly from results. A coordinator's scheme would be one more name for the same numbers.

**A "strength" needs either a bonus or new physics.** An edge a coordinator adds outside the ratings is the thumb on the scale the difficulty dial was built without. The honest alternative is scheme fit — players who suit one scheme and not another — and the pool would support it. Each position ranked under two schemes that weight its attributes toward opposite sides of a real choice:

| position | schemes | rank correlation, every man | top quarter | top quarter who fall out of it |
| --- | --- | --- | --- | --- |
| QB | pocket passer / mobile, vertical | 0.90 | 0.20 | 27% |
| RB | power / zone and space | 0.79 | 0.09 | 44% |
| WR | vertical / timing | 0.80 | 0.22 | 49% |
| TE | in-line / move | 0.80 | 0.00 | 43% |
| OL | pass protection / run blocking | 0.92 | 0.37 | 23% |
| DL | penetrate / two-gap | 0.59 | 0.25 | 38% |
| CB | press man / zone | 0.97 | 0.82 | 17% |
| S | centre field / box | 0.72 | 0.14 | 50% |

Across a whole position the two rankings agree, because good against bad dominates — the collinearity the audit's yardstick check already records. Among the men who start they barely agree at all. It is the engine that does not support it. An inside run and an outside run read the back identically — speed, elusiveness, power and vision enter both the same way, behind one run-blocking composite — so a power scheme and a zone scheme would differ in base yards and in nothing about the roster. Every pass reads a receiver's routes and hands at the same weights, and only the deep shot adds his speed and the arm. Press against zone, and a box safety against a centre fielder, are not in the play model at all. Of the axes a coordinator would sell, the engine plays pass against run, which the read already fits, and in part deep against short.

Making the rest real means new run, coverage and safety physics, then re-measuring realism, the position weights and the leverage table the auction economy rests on. By design it would also make a player's worth depend on his club, lowering how well overall predicts production, which the audit holds at 0.98 to 0.99. That is a different game's worth of change for a feature whose first effect would be to take decisions away from the player. Not built.

## Scouting (`scouting.js`)

Everything in this game was arithmetic. Every rating of all 1,500 players was exact and permanent, so once you had internalised the leverage table you won auctions forever and the economy stopped being a puzzle. Real general-manager games run on fog.

**Real players are never fogged, and that is not a compromise.** They are the content. Somebody playing all-time fantasy football wants to know they are bidding on Jerry Rice at 97; hiding it turns the marquee feature into a guessing game rather than a decision. The fog goes on generated rookies, who nobody has seen play, and lifts the moment they have.

**The width of the band is the information.** A range that is merely a noisier number changes nothing — you would still take the highest midpoint. So the band runs from what a rookie is today to what his career could reach, which careers.js already derives deterministically from the league seed and his id before he is ever signed. A safe prospect reads 70–76 and a boom-or-bust reads 58–86, and choosing between them at the same price is the decision this exists to create. A bust's ceiling is barely above his floor, so his band comes out narrow and low with no extra machinery. Measured over 400 rookies: widths run 5 to 39, median 14.

The low end leans conservative on purpose and the high end does not. A first pass used symmetric error on both, and the band failed to contain the player's current rating 43% of the time, which makes the low end meaningless. Biasing it down fixes that (100% now) and puts the genuine uncertainty where it belongs: how far up his own band he climbs. The band contains his true ceiling 64% of the time. No band is ever narrower than five points, because a range that collapses to a single number claims a precision nobody has.

**Everyone scouts, not just the human.** Fog on one side only is a handicap, not a mechanic. Each club reads the same rookie through its own seeded error, scaled by the GM's savvy — the same table that decides who chases value and who chases names. Measured against a perfect scout, error runs monotonically with savvy: Air Raid at 0.10 accuracy misses by 2.27 points, Analytics at 0.70 by 0.75, the human by 1.47. You can win a player because you rated him higher than the room, and be wrong.

**The asking price comes from the room, not from the truth.** This is the leak that would have made the whole thing theatre: the auction's price guide is built from ratings, so a rookie's price would let anyone read his real number straight off the board. Unscouted rookies are therefore priced on `marketView` — the consensus, computed directly rather than by averaging every club's read, since the observational errors are mean-zero and cancel. It sits above a rookie's current rating by the upside the room pays for, so chasing a prospect is a risk rather than a free option. List ordering had the same leak, and for the same reason the player pool, the free-agent list and the draft board all rank by what the observer believes rather than by what is true: a place in a table is a number.

**Attributes coarsen rather than disappear.** A scout can tell you the shape of a player — fast, hands of stone — without giving you the number, and the rookie generator makes lopsided players on purpose, so hiding the shape would throw away the most interesting part. Unscouted rookies show attributes rounded to the nearest five with a `~`.

**A rookie is known once he has been on a roster through a completed season**, marked by his career entry in `league.dev`. Statistics count too, and they count for every club, since season totals accumulate for every player in every game. That is a correction: this document and the code both used to say the opposite, that a rookie could start three years for a computer club with no games to his name, measured at 50 rookies on rosters and not one with a recorded game. The measurement was real and the reading of it was wrong — the zeroes came from `closeSeasonBooks` writing through a stale module-level player index that held no generated players, so rookies were dropped from the books in silence. `bookIndex()` in `season.js` rebuilds that index from the league itself and the same dynasty now shows about half its rookies with a career record after one season, the rest being the ones who did not play. The career entry stays the primary marker because it is the honest test of "has been somewhere for a season": a rookie who sat all year has still been watched in practice for twelve months.

**The band says where, and now also when.** A scouted rookie reads as a range and an arrival: "61-74, real upside, 2-4 yrs away" against "70-86, real upside, 7-9 yrs away". The second is the better player and the first may win you a division this decade. That second question did not exist before the careers work above made it exist — see **How soon, as against how high** — because until then every prospect arrived in about five seasons whoever he was.

`ARRIVE_AT_PACE_1` is 5.2 seasons, measured rather than chosen, and years scale as the reciprocal of pace, running 3.3 to 6.7 across the draw. The read is fogged by the same scouting error as the rating, at `PACE_ERROR` = 0.16 years per rating point, so a poor scout reads "two to seven" and a good one "three to four". A player already on a roster returns no arrival at all rather than a confident one, which is the same rule the rating band follows.

Measured over a class: arrival spans 3 to 8 seasons, band widths run 1 to 4 with a median of 2. It appears in the overall badge's tooltip and as its own line in the player modal.

**Two instrument mistakes, both caught before shipping.** The first label bucketed arrival into phrases, and read "a long way off" for 7 of 12 prospects in a class — the buckets were wider than the signal and swallowed exactly the variation the feature was built to create. It shows the range instead.

The second is the more useful one. Four mutations were run against the new tests; three were caught and the fourth escaped. Collapsing the scouted arrival band to a single point — the precise failure the test existed to catch — did not fail it, because the assertion was `late > soon` and `late` is clamped to `soon + 1`. The test was measuring the clamp, not the projection, and would have passed against a completely deterministic scout. It now asserts a mean band width above 1.5 seasons and, separately, that the width responds to who is doing the scouting, so a fog that ignores savvy fails too. With those in, the mutation is caught.

**The payoff is an annual report card.** Last year's class, one season on, with what you projected against where they actually are. Fog is only worth having if you find out afterwards whether you were right. The verdict is about the first year's movement rather than arrival, because the top of a band is a career ceiling four to six seasons away and judging a rookie against it after one year would make almost everyone read as a bust.

Not built: a scouting budget, staff to hire, or fog over anything a club already owns. The error is free and automatic, so scouting is a risk to weigh rather than a resource to spend. Speculation: whether error of one to two rating points is enough to make auctions feel uncertain. The larger uncertainty is inherent — the band says 60–85 and he may finish at 65 — and that is the part intended to carry the drama.

### What a rookie pick is worth (`npm run rookies`)

This was going to be a pre-draft combine, then a change to how the draft reads
a prospect's arrival, and it is neither. What shipped is smaller than both and
the measurements that got there are most of the value, including two that were
wrong.

**How it is measured.** At every club's rookie picks in pro leagues, the same
board is read several ways at the same moment, and the draft carries on under
one read, so the league never diverges and each difference is the read and
nothing else. Each man picked is scored by his own seeded future, which careers
make exact: V, his leverage-weighted seasons above 75 over six years; his mean
rating over the four-year rookie deal as a lineup counts him — his debut
rating, then after each season's growth — which is what the club that drafts
him actually gets; and his peak. About 1,750 picks a seed set.

Each cell is the change in his rating over the deal as a lineup counts it
± its standard error, then V, then his peak, then the share of picks the read
changed — each against the pick the old read made from the same board.

| per pick | seeds 9100 | seeds 9900 |
|---|---|---|
| old read, perfect scouting | +0.32 ± 0.09 · +3.0 · +0.31 (38%) | +0.13 ± 0.08 · +3.2 · +0.11 (37%) |
| old read, top three worked out | +0.03 ± 0.01 · +1.3 · +0.03 (1%) | +0.05 ± 0.02 · +0.8 · +0.05 (1%) |
| **what he is now (shipped)** | **+1.03 ± 0.11 · +0.6 · +0.11 (44%)** | **+0.85 ± 0.10 · −2.1 · −0.17 (44%)** |
| shipped, perfect scouting | +1.06 ± 0.10 · +1.0 · −0.11 (47%) | +0.74 ± 0.10 · −2.9 · −0.41 (48%) |
| shipped, top three worked out | +1.04 ± 0.11 · +1.0 · +0.12 (44%) | +0.88 ± 0.10 · −1.0 · −0.15 (43%) |
| arrival-aware (tried, dropped) | +0.01 ± 0.09 · +5.5 · +0.50 (34%) | +0.01 ± 0.08 · +4.7 · +0.50 (33%) |
| arrival, plain mean | −0.84 ± 0.11 · +4.6 · +0.35 (49%) | −0.90 ± 0.10 · +4.6 · +0.20 (46%) |
| hindsight, for scale | +3.67 ± 0.15 · +50.0 · +5.56 (63%) | +3.70 ± 0.16 · +56.1 · +5.74 (64%) |

**The combine was not worth building.** Scouting fog existed and nothing let a
club spend effort against it, but the fog is small — a club's read misses a
perfect scout's by one to two points — and most of a band's width is the real
gap between what a rookie is and what he could become, which no workout
removes. A perfect read of the whole class, at the draft's old read, buys
+0.32 and +0.13 of a rating point over the deal; three workouts on a club's
best prospects buy +0.03 and +0.05 and change one pick in a hundred.

**What was wrong instead: the draft paid for upside it does not get.** It
valued a fogged rookie at the floor of his band plus a flat 35% of the way to
the top. But a drafted man signs a four-year deal, his upside arrives on
average after it, and most drafted men are gone soon after: followed through
a dynasty, 394 men from a first rookie draft were down to 90 still in the
league two seasons after their deals ended. Keeping one costs market price. Upside in
the draft is a player somebody else gets. Counting less of it was better at
every step tried, in both seed sets, on the deal as a lineup counts it:

| share of the band counted as upside | seeds 9100 | seeds 9900 |
|---|---|---|
| none — what he is now (shipped) | +1.03 ± 0.11 | +0.85 ± 0.10 |
| 15% | +0.86 ± 0.09 | +0.62 ± 0.08 |
| 25% | +0.50 ± 0.07 | +0.33 ± 0.06 |
| 35% — the old read | 0 | 0 |
| 50% | −0.94 ± 0.08 | −0.99 ± 0.08 |

`scoutedOverall` now returns the low end of a club's band, its own view of
what the man is now, and costs nothing measurable in the long run: V and peak
are level within their noise, +0.6 ± 1.2 and −2.1 ± 1.5 in V. It also retires
the combine for good — once the draft reads what a man is now, scouting
accuracy barely matters to it, a perfect read adding +0.03 and −0.11 and three
workouts +0.01 and +0.03.
The band itself is unchanged and still shows the upside to anybody reading it;
this is only what a club pays for with a pick. Your own draft list ranks on
the same read. Across whole dynasties, eight paired leagues, the computer
clubs' lineups come out level with the old read at every season, within about
eleven points either way: the gain is real and a point a pick, and too small to
move a club where a season can see it.

**The read tried first, and dropped.** Reading *when* a prospect's upside
arrives — the old share scaled by how much of the deal he spends arrived,
normalised so an average developer read as before — looked like the fix: +5.5
and +4.7 in V, +0.35 over the deal after each season's growth, better at the
peak, on both seed sets. Every one of those counted growth the drafting club
does not get. As a lineup counts him it was +0.01 on both, and across whole
dynasties it was mildly worse: −12.6 ± 5.2 and −14.3 ± 5.8 at seasons five and
seven over eight leagues. The first yardstick for "over the deal" was off by a
season — it skipped the debut and counted a fifth year the club does not have —
which is how a read that chases post-deal growth looked like it was reading
the deal.

**The draft's position weights, checked by wins.** `POS_BASE` was hand-set in
the first commit and never measured, and it is not the measured leverage table
the auction runs on: it weighs a quarterback at two and a half receivers where
leverage says five. Scored by V it would look wrong, but V is built on that
leverage table, so that comparison proves nothing. It was checked by games —
half the clubs in each league drafting on each table, a season played, and
every seed run again with the halves swapped so draft slot cancels:

| league | seeds | leverage table minus `POS_BASE`, win share |
|---|---|---|
| fantasy, 12 clubs | 30 from 100, each swapped | −0.8 ± 1.3 points (ahead in 13 of 30) |
| pro, 32 clubs | 12 from 100, each swapped | −0.6 ± 0.8 points (ahead in 6 of 12) |
| pro, 32 clubs | 12 from 300, each swapped | +1.5 ± 1.3 points (ahead in 8 of 12) |

No difference a season can see, so it stays; replacement levels and each
club's open slots settle most picks before the weights do.

On the tables re-measured on 2026-09-24 there is a difference, and it points the
same way: in 12-club fantasy leagues the table's clubs come out −3.9 ± 1.2
points (ahead in 7 of 30) with the back at nearly a quarterback, against −0.6 ±
1.3 for the old table on that engine, and −3.9 ± 1.4 (ahead in 6 of 30) on the
table set once the run game matched real carries. The first time they spent an
early pick on a second back, round 3.5 against `POS_BASE`'s 18.8, which looked
like the cause; the second time they take him in round 13.5 and lose by just as
much, so it was not. Why drafting on the table loses is not established.
`POS_BASE` stays on firmer ground than before; the detail is under "The back was
worth nearly three times too much".

**A bug in the engine, found because a measurement was impossible.** The first
dynasty comparisons ran both arms in one process and had every alternative
read losing forty to sixty points by the seventh season — the arrival read,
drafting on current rating, fifteen percent upside, reads that move in opposite
directions — all by about the same amount. That is the signature of the
instrument, not the reads. Rookie ids are the league seed, the class and a
number, so two leagues on one seed name different men the same once their
classes come apart, and `overall` cached ratings by id: the second arm drafted,
sorted and was scored on the first arm's rookies. The scratch run that had put
each arm in its own process had found roughly nothing, which was right. In the
game it needed two diverged leagues on one seed open in one session — a league
and its own share code on one device — and it is fixed at the root: a
generated player is never cached, a handful of multiplications a man. The game
fingerprint is unchanged.

Five new tests, one rewritten, and eight mutations, seven caught. The eighth is equivalent: a
known man's band is a single number, so reading its low end is reading him.

**Found and left alone.** Two of the draft's guards are written for the
twenty-seven-round founding draft and never fire in a rookie draft, which runs
about three rounds: a backup quarterback is held back while
`round <= rounds − 4` and a kicker or punter while `round <= rounds − 3`. What
that costs was not measured cleanly — the runs that counted it were the ones
the cache bug corrupted — so it is noted rather than changed.

## Team chemistry (`chemistry.js`)

Chemistry in sports games is usually an invisible multiplier that either does nothing you can feel or quietly decides your season. This one is a number on the team screen with both its inputs shown, and it is worth at most 1.8 rating points, which is under two home-field edges.

**Continuity** is the ordinary half: starters who were here last year, and the year before, saturating at three seasons. It is counted in seasons on the roster, not in contract age — a fantasy club re-buys most of its roster at auction every year, so contract age says almost nothing about whether the same eleven men have been playing together. `league.tenure`, maintained by `syncTenure` at the start of each season, counts the man rather than the paperwork.

**Era cohesion** is particular to this game. A squad drawn from 1948 to 2024 is the whole fantasy, and it is also eleven men who have never played the same football. The standard deviation of the starters' seasons runs near 4 for a single-decade squad and past 25 for an all-time scatter. It is a first-season tax rather than a permanent penalty: the era term decays as continuity rises, so a scattered all-time team is rough in year one and fine by year three.

**It is scored against the league, not against 100.** The absolute number is not the thing: every club is unsettled in season one and most are settled by season four, and an effect everybody gets at once is no effect at all. Measured across three eight-club and three 32-club dynasties, the raw score climbs from a mean of 17 to 27 in a fantasy league and from 20 to 69 in the pro league — the same mechanic, two completely different scales, because a fantasy league re-auctions most of its rosters and the pro league keeps eighteen. Centring on the league mean cancels that artifact: both modes then hand their best club a 1.1 to 1.8 point edge over their worst, consistently, in every season. The team screen shows the raw score, which is stable and legible, and the bonus, which is relative.

**It is a real choice.** An era-themed squad built only from the 2010s scored 45 against best-available's 15 in season one with zero continuity on either side — a 1.9-point swing, bought by giving up the better players at several positions. That is the trade the mechanic exists to offer.

**Where it lands.** Chemistry rides the same composite keys as the home-field edge (blocking, rush, run stop, coverage, tackling) and is carried on the composite as `chem` for four quarterback reads: two-point conversions, sack avoidance, completion probability and interceptions. It never touches speed or arm strength, because knowing each other does not make anyone faster. `gameOptions` computes both sides once per league-and-tenure and caches it, since it is a league-wide calculation every game in a week asks for.

Speculation, not measured: whether 1.8 points is the right ceiling. It is calibrated against the home-field edge of 1.1, which is worth about two points of margin, so the widest realistic chemistry gap is roughly three points of margin — about half a win over a season. That felt like the right size for something you can see and plan around but never buy outright; it has not been tested against how it feels to play.

## Weather (`weather.js`)

A pro club plays where its city is, and from September to January that means heat in Miami, wind in Chicago and snow in Buffalo. Weather is on for new pro leagues and absent from fantasy ones, whose clubs are nicknames with no city; a save from before it has no setting and plays as it always did.

**The flaw it had to be designed around.** The engine was fitted to real league averages (`scripts/realism.mjs`), and the real league plays in real weather, so the old engine already played an average afternoon. Weather that only took things away — wind costing completions, cold costing kicks — would have pulled every documented average below the league it was fitted to. So each effect is a spread around that average rather than a tax on it: its league-wide mean, over every home and every week of a season on a fixed stream drawn when the module loads, is taken out. A dome or a still afternoon plays a little above the old engine (a deep throw +1.0 completion points, a kicker +0.4 yards of range, a punt +0.5 yards, fumbles ×0.976), a gale well below it, and a season of them averages what a season did.

**Where the conditions come from.** Each club has a rounded climate by month — temperature, mean wind, a chance of rain or snow — from general knowledge of climate normals, not from weather records. Eleven clubs play under a roof; Denver kicks a mile up. A game's conditions are drawn around its home's month, seeded by league, season, week and home club, so a replayed week, a share code and the matchup card all see the same sky: the card's conditions line is the draw the game will be played under, not a forecast. The playoffs are January, and the final is at a neutral dome.

**What it touches, and what resists it.** Every size is chosen, not measured; what is measured is what they add up to.

| Condition | What it costs | Resisted by |
|---|---|---|
| Wind over 8 mph | completion, 0.35 points a mph at a medium throw, a fifth of that on a screen, 1.6 times it on a deep ball; a quarter-yard a mph of field-goal range and of punt | arm strength on a throw, leg strength on a kick |
| Rain, snow | 2 or 3 completion points; fumbles ×1.25 or ×1.35, on runs, catches and strip sacks alike; 1 or 2 yards of kick and of punt | — |
| Below 32°F | 1 completion point | — |
| Below 45°F | 0.08 yards of kicking range a degree, 0.05 of punt | — |
| Altitude | adds 3 yards to a kick and to a punt | — |

**The one decision it adds** is an arm and a leg. At 20 mph a 95 arm gives up 3.6 points of deep completion and an 80 arm 6.1; a 95 leg gives up 1.4 yards of range and a 75 leg 2.9. A club that plays eight games a year by Lake Michigan has a reason to want both that a dome club does not. It is a small reason — 9% of games blow 15 mph or more — and the rest of weather is atmosphere, which is what it was built to be.

**The means are taken at the arm and leg that start.** The first version took them at the centres of the engine's own formulas, an 82 arm and an 80 leg. But the starters throw nearly every pass and kick every kick, and eight founding pro drafts start an 89.9 arm (sd 4.8) and an 87.3 leg (sd 4.6) (`npm run weather arms`). The wind costs a strong arm less than the middling one the means had assumed, so weather lifted league completion by 0.13 ± 0.03 points; with the means taken at the starters', the same games give 0.04 ± 0.03.

### Measured (`npm run weather`)

**It averages what it did.** Twenty thousand games between real lineups, in four independent sets of 5,000, each played under the conditions its home and week draw and again from the same seed with none:

| per team-game unless marked | none | weather minus none |
|---|---|---|
| points | 25.73 | +0.04 ± 0.04 |
| completion % | 67.53 | +0.04 ± 0.03 |
| yards a pass | 7.59 | +0.00 ± 0.01 |
| turnovers | 0.98 | −0.006 ± 0.004 |
| field-goal % | 89.3 | −0.02 ± 0.10 |
| yards a punt | 47.44 | −0.05 ± 0.02 |

The punt residual is probably the goal line: a long punt is cut short there, so a spread in distance loses a little at the top that it does not lose at the bottom. Whole seasons, weather on and off and paired by league seed, agree within their much wider noise — points a team-game −0.09 ± 0.27 and −0.03 ± 0.21 over two sets of six — and every audit check passes with weather on for new pro leagues, including three added for it: the arm and leg that start, and the constants rounded from them. The fingerprint is unchanged, since with weather off every draw is the one it was.

**The spread.** The same lineups under each condition and again indoors, from the same seed, 1,500 games a condition:

| condition | points a game, against indoors | completion % | field-goal % | yards a punt | fumbles a game |
|---|---|---|---|---|---|
| indoors, or a mild still day | 51.5 | 67.8 | 88.9 | 47.9 | 1.18 |
| 20 mph | −2.5 ± 0.4 | 65.5 | 89.4 | 45.3 | 1.17 |
| 28 mph | −3.8 ± 0.4 | 63.9 | 88.7 | 43.3 | 1.13 |
| rain | −1.8 ± 0.4 | 65.8 | 89.2 | 46.6 | 1.46 |
| 18°F | −1.4 ± 0.4 | 66.9 | 88.9 | 46.0 | 1.14 |
| snow, 18 mph | −4.6 ± 0.4 | 62.1 | 87.5 | 42.8 | 1.63 |
| a mile up | +0.3 ± 0.3 | 67.9 | 90.2 | 50.6 | 1.12 |

Field-goal percentage hardly moves in the wind because the kicks change, not the kicker: the coach knows the range has shrunk and does not try the long ones. Held to the same distances it moves a lot — the storm test in `tests/weather.test.js` has a kick from 40 to 47 yards, which both sides still try, going from 94% indoors to 68% in a snowy gale, and tries from 48 yards and beyond falling from 144 to 33 in 200 games.

Speculation, not measured: that these sizes are right. The ordering, wind by a distance and then rain, matches the common reading of real games, but the numbers were set to be plausible and modest and have not been checked against game records.

**No lean on the run.** Real coaches run more in bad weather, so an AI that did the same was tested before it was built: the same games again with the home side's pass rate moved, by condition, 1,200 games a cell, scored on the margin against the unmoved game from the same seed.

| condition | pass rate −0.15 | −0.10 | −0.05 | +0.05 |
|---|---|---|---|---|
| indoors | +1.56 ± 0.47 | +0.67 ± 0.47 | +0.77 ± 0.42 | +0.27 ± 0.43 |
| 20 mph | +0.96 ± 0.49 | +0.41 ± 0.49 | +0.55 ± 0.43 | −0.33 ± 0.45 |
| 28 mph | +1.49 ± 0.49 | +0.59 ± 0.47 | +0.53 ± 0.42 | +0.38 ± 0.44 |
| rain | +0.05 ± 0.47 | −0.78 ± 0.47 | +0.16 ± 0.43 | −0.72 ± 0.45 |
| snow, 18 mph | +0.43 ± 0.49 | +0.76 ± 0.48 | +0.91 ± 0.43 | +0.03 ± 0.45 |

Running more pays no more in any weather than it does indoors, and in rain if anything less, since a wet ball costs a runner as well as a passer. So the AI does not lean. The table resolves a difference of about 0.7 points between two conditions; a rough estimate from what a gale does to a medium throw (five completion points, about half a yard an attempt at 0.053 points a yard, over the ten plays a 0.15 lean moves) puts the true gain near 0.3 points in a gale and less elsewhere. So "too small to matter" is the honest reading, not "none".

It turned up one thing that looked like it was not about weather: in every condition, indoors included, the home side gained about a point and a half of margin by running 15 points more than its kickoff pass rate. Investigated since, and it did not replicate — across eight pro leagues an AI club's pass rate is flat, anywhere from −0.20 to +0.10 — and the "every condition" was the same games replayed under five skies, which is one sample seen five times. Chasing it found something real elsewhere: the read that sets the human's pass rate had gone stale. See **The pass/run read** below.

**Tests** (`tests/weather.test.js`, 11) cover the setting and old saves, the seeding and the domes, the climate, each effect's direction and resistance, the means on an independent stream, every hook in a game, the recorded result and the share code. A mutation pass over `weather.js` and every hook in the engine killed 32 of 36 mutants. Four survive, each below what the tests resolve: dropping the wet-ball factor from any one of the three fumble sites alone — each is about a third of the fumbles, and dropping all three is caught — and the weather in the end-of-half kick's range, a handful of decisions a season.

#### Not done

- **Heat** is described and does nothing. A hot afternoon is real, but its effect on a game is fatigue over a drive, which the engine does not model.
- **Retractable roofs** are always closed.
- **Weather changes within a game.** A game has one sky.
- **Fantasy leagues** have no weather, for want of a city.

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

### The back is worth nearly a quarterback now

*Superseded the same day by "The back was worth nearly three times too much",
below. The table this section set was right about the engine, and the engine
was wrong: its run game moved a back's carries five times as far as the real
game's. The method stands — six rosters, the error taken between them, the
audit replaying the table — and so does the finding that one commit did it.
The convexity, the draft explanation and the knock-on figures below describe
the engine that was wrong.*

`TRUE_LEVERAGE` went stale a second time the way it did the first: a change to
how the run game plays, and no re-measure after it. The audit replays the table
now, so a third time would be caught.

**One roster was not enough to set it.** Every table before this one came from
synthetic roster 1, and a position's worth depends on the roster around it by
more than one roster's game noise: over six rosters at 10,000 games each the
quarterback read 5.12 to 6.28, at ±0.12 apiece. The table is now the mean of
rosters 1 to 6 (`npm run leverage -- 10000 <roster>`, each roster on its own
game seeds), with its error taken between rosters, scaled as always so the
starter-weighted total stays 86.45 and `aiGreed`'s thresholds still mean what
they meant:

| | QB | **RB** | TE | CB | WR | S | LB | DL | OL | P | K |
|---|---|---|---|---|---|---|---|---|---|---|---|
| per starter, six rosters | 5.67 | **5.48** | 1.72 | 1.70 | 1.10 | 1.07 | 1.08 | 1.01 | 0.76 | 0.59 | 0.51 |
| ± between rosters | 0.21 | 0.18 | 0.13 | 0.02 | 0.03 | 0.02 | 0.02 | 0.02 | 0.02 | 0.04 | 0.05 |
| table before | 15.89 | **9.39** | 5.58 | 4.39 | 2.95 | 2.87 | 2.76 | 2.46 | 2.17 | 2.00 | 1.25 |
| table now | 14.46 | **13.99** | 4.38 | 4.33 | 2.80 | 2.73 | 2.75 | 2.57 | 1.95 | 1.51 | 1.31 |
| z, now against before | −2.7 | **+10.0** | −3.6 | −1.0 | −2.2 | −2.6 | −0.2 | +2.7 | −4.5 | −4.8 | +0.4 |

The back is the change that matters: half as much again, from 0.59 of a
quarterback to 0.97. The tight end, the line and the punter moved by more than
three standard errors too, each by a quarter or less.

**The cause is one commit.** The harness as it is now, copied into a checkout of
each commit since the old table was set so that only the engine varies, roster 1
at 4,000 paired games a reading:

| engine at | QB | RB | TE | WR |
|---|---|---|---|---|
| a8cd49c, the engine the old table was set on | 5.90 | 3.53 | 1.95 | 1.06 |
| 9ccd5b1, awareness, power and elusiveness given something to do | 6.14 | **5.83** | 1.92 | 1.08 |
| 188dfec, the short passing game | 6.24 | 5.97 | 1.94 | 1.26 |
| bc1b5f1, the tight end's job | 6.23 | 5.74 | 1.56 | 1.24 |
| today | 6.23 | 5.74 | 1.56 | 1.24 |

On the engine it was set on, the old table was right: a back at 0.60 of a
quarterback against a shipped 0.59. 9ccd5b1 wired elusiveness and power into the
run game and took the back from 3.53 to 5.83 in one commit; nothing since has
moved him by a quarter of a point. The receiver's rise and the tight end's fall
are the two later commits, and they are in the new table too. Today reads the
same as bc1b5f1 to the hundredth: nothing since has touched these games, and the
table itself does not reach play. Outcomes read the attributes; the table prices
players and sets the win-probability prior, which is only ever logged — so the
fingerprint moved with it (it hashes that line) while no score did.

**Real backs agree at the top and not below it.** The method boosts every
attribute of a synthetic man by eight. The yardstick swaps real men in instead,
and across the whole pool it disagrees: 0.29 points of differential per overall
point for a back (24 men, 67 to 93, 500 games each) against 0.54 for a
quarterback (59 to 96), which is nearly the old ratio. Putting the method's own
boost onto real men in the yardstick's harness shows why:

| eight points on everything | rated | worth per overall point |
|---|---|---|
| David Montgomery, RB | 75 | 0.17 |
| Rick Casares, RB | 83 | 0.42 |
| Bill Dudley, RB | 85 | 0.56 |
| Adrian Peterson, RB | 88 | 0.80 |
| Jim Everett, QB | 70 | 0.43 |
| Jalen Hurts, QB | 79 | 0.64 |
| Boomer Esiason, QB | 85 | 0.61 |

A back's worth is steeply convex in his rating, where a quarterback's is close to
straight. Where starters sit, a point on a back is worth about what a point on a
quarterback is, as the table says; below that it is worth far less, and a
whole-pool slope is an average over a pool where most backs sit below. Also
tested, and ruled out: that the table holds only at the synthetic rosters' level
of 82. At a mean of 90, a fantasy league's level, the back reads
5.12, 5.67 and 6.54 on three rosters against the quarterback's 5.11, 5.50 and
5.54. What this does mean is that a table of one number a position now
overprices every back below starter level by more than it did, and the value
panel says so. (On the fixed engine the convexity is gone within the noise of
500 games a man, and the panel no longer says it.)

**Drafting on the table loses, so the draft keeps POS_BASE.** Nothing in play
drafts on the table, but `npm run rookies -- weights` asks whether it should:
half of each league drafting on it and half on `POS_BASE`, then the halves
swapped. Paired on today's engine, 12-club fantasy leagues, 30 seeds from 100:

| table | its clubs minus `POS_BASE`'s, win share |
|---|---|
| before 2026-09-24 | −0.6 ± 1.3 points (ahead in 11 of 30) |
| now | **−3.9 ± 1.2 points** (ahead in 7 of 30) |

In 32-club pro leagues it is −0.7 ± 0.8 (12 seeds from 100), against −0.6 ±
0.8 when first measured. Measured, not inferred, is how the table's clubs draft,
over ten of those fantasy leagues: they take their second back in round 3.5 on
average against round 18.8 on `POS_BASE`, nearly two backs each in the first six
rounds. The draft's guard against an early second back is a flat four points,
sized for `POS_BASE`'s back weight of 1.15, and the table's 2.88 swamps it, so an
early pick goes on a bench back — who plays only when the starter is hurt, and
who tends to be the lower-rated back the table overprices.
How much of the 3.9 that accounts for is not measured. (None of it, as it
turned out: on the fixed engine the table's clubs take their second back in
round 13.5 and lose by just as much.) The answer it gives is the one already
shipped: the snake draft keeps `POS_BASE`.

**What else moved, paired against the old table on today's engine.**

| | old table | new table |
|---|---|---|
| AI trade offers to the human, a league-season (`npm run offers`) | 9.3 | 9.0 |
| weeks with an offer | 43% | 44% |
| offers that help the human | 61% | 52% |
| their mean worth to the human, lineup strength | 3.2 | 1.6 |
| roster spread, auction against draft (`npm run auction`) | 43.8 / 29.0 | 41.1 / 30.2 |
| a roster at market against the cap, founding (`npm run cap -- 1 4`) | 120% | 122% |
| MVPs to backs in 40 seasons, the award reading the table | 2 | 37 |
| the human bidding off the table (value shopper), wins of 14 in 24 leagues (`npm run strategy 24`) | 7.3 | **8.2** |

Offers stay where `OFFER_LOPSIDED` put them, about half of them worth taking.
The MVP could not stay on the table and now has one number of its own (Awards,
above). The value board's verdicts follow the table at render time: the back is
now its one clear bargain at 1.69×, and the tight end goes from better than
fair (1.16×) to overpaid (0.89×).

**Open: whether a back should be worth nearly a quarterback at all.** The real
game's own analytics say not by a distance. This engine says so at starter
level, and the cause is identified — how much elusiveness and power buy in the
run game since 9ccd5b1. If that is too strong, the fix belongs there, and this
table would follow it on the next re-measure; it is not decided here.

**The audit replays the table.** `the position-value table still matches the
engine` runs roster 1 at 4,000 games and counts positions that differ from the
shipped table by more than 30% and by more than three standard errors, both. It
reads 0 on this table and 2 on the one before it, the back and the tight end,
in about two minutes.

### The back was worth nearly three times too much

The table in the section above was right about the engine, and the engine was
wrong. Measured against real carries, a point of a back's rating moved his five
times as far as it does in the real game, and leagues of all-time greats ran at
5.95 yards a carry. Both came from the terms in the run game that read the ball
carrier. Fixed, the back is worth a third of a quarterback, the pass/run read
points the other way, and `npm run rushing` holds the run game to the real one.

**The real game, from nflverse** (regular seasons; the numbers are written into
`scripts/run-realism.mjs` so it runs offline):

- Backs with 150 or more carries in a season, 1999–2024, 820 seasons: 4.24
  yards a carry, standard deviation 0.58, ninetieth percentile 5.05, best 6.38
  (Jamaal Charles, 2010). The same back's next season correlates at 0.27, so the
  spread of real talent is about 0.30 a carry, and some of that is his line.
- Every run in 2022–23 play-by-play, kneels left out: 4.49 a carry; 17.3%
  stopped at or behind the line; 11.6% gain ten or more; 2.52% twenty or more;
  0.66 twenty-yard runs a team a game.
- In expected points: a starter one standard deviation of real talent better is
  worth 0.52 a game at back and 2.57 at quarterback — talent from the
  year-to-year correlation, times how often each has the ball. About one to five.

**Backs against the seasons they are rated on.** Eighty-five backs in the pool
have seasons from 1999 on, and 81 of them carried 150 or more times that year.
Each played 300 games in the same average side, 82 against 82, set against what
he really ran:

| | engine | real, same backs and seasons |
|---|---|---|
| mean | 4.61 | 4.65 |
| standard deviation | 1.88 | 0.56 |
| range | 2.00 to 8.86 | 3.35 to 6.03 |
| per overall point | 0.178 | 0.036 |

Saquon Barkley's 2024 ran 8.86 in the engine and 5.81 in the real game;
LaDainian Tomlinson's 2006, 8.49 and 5.20; Julius Jones's 2006, 2.00 and 4.06.
The engine had them in the right order — correlation 0.67 — and five times too
far apart: regressing what they really ran on what the engine said gives a
slope of 0.20.

**And leagues of greats ran hot.** A season of drafted pro leagues averaged 5.95
a carry with 6.3% of runs going twenty yards; twelve-club fantasy leagues 6.25
and 7.1%; starting backs averaged 6.33 with a deviation of 1.02 and a best of
8.86. The realism check never saw it, because it plays sides rated 82. Power
resisted the stuff and elusiveness drove the breakaway against a fixed 82
rather than against anybody, and the section that wired them in called the
result correct: "they are better than the reference". They were better than
the reference on both sides of the ball, and only one side was being counted.

**How much of it was 9ccd5b1.** Reverting only that commit's three run terms:
0.098 a carry per point, deviation 1.06, slope 0.37; pro leagues at 5.36 a
carry and 4.5% twenty-yard runs. So backs were already too far apart and too
hot before it, through the older speed and vision terms — the speed term's flat
30% longer burst for any back at 92 speed among them — and 9ccd5b1 roughly
doubled both.

**Quarterbacks, the same way.** Fifty-eight real quarterbacks with 250 or more
real attempts: adjusted net yards an attempt, deviation 2.39 in the engine
against 1.22 real, slope 0.43, 0.189 a point against 0.080. At the top it is
right — Aaron Rodgers's 2011 at 9.51 against a real 9.40, Patrick Mahomes's
2018 at 9.13 against 8.89 — and the excess is all at the bottom, where
quarterbacks rated in the fifties collapse to 1 to 3 against a real 4.5 to 6.5.
Not fixed here: it moves backups and the last rounds of a draft, not the
starters the table prices.

**The fix is one constant and a change of reference.** `CARRIER_WEIGHT` in
plays.js: every term that reads the carrier reads him against his opposite
number — vision against the front's awareness, power against its run stopping,
elusiveness against its tackling, speed against its speed, and the burst's
flat bonus at 92 speed becomes a continuous one against the secondary's pace —
at a fifth of the weight. At the level the engine was fitted, nothing moves:
none of the 44 realism rows outside the real range, yards a carry 4.51 → 4.45.
At the level people play, it comes into line:

| | before | after | real |
|---|---|---|---|
| backs in the average side: standard deviation | 1.88 | 0.47 | 0.56 |
| per overall point | 0.178 | 0.045 | 0.036 |
| slope, real on engine | 0.20 | 0.77 ± 0.10 | 1 |
| pro leagues: yards a carry | 5.95 | 4.66 | 4.49 |
| twenty-yard runs | 6.28% | 3.17% | 2.52% |
| starting backs: deviation / ninetieth percentile / best | 1.02 / 7.69 / 8.86 | 0.49 / 5.32 / 6.07 | 0.58 / 5.05 / 6.38 |

A fifth rather than the 0.16 a slope of exactly 1 would ask for: the slope
carries a standard error of 0.10, the ratings are editorial and their errors
pull it under 1 even for a correct engine, and at a fifth a season's spread
between starting backs already sits a little under the real one.

**Re-measured, the back is worth a third of a quarterback.** Six rosters at
10,000 games each again:

| | QB | RB | TE | CB | WR | S | LB | DL | OL | P | K |
|---|---|---|---|---|---|---|---|---|---|---|---|
| per starter | 5.75 | 1.94 | 1.74 | 1.71 | 1.12 | 1.07 | 1.10 | 1.02 | 0.81 | 0.52 | 0.50 |
| table that morning | 14.46 | 13.99 | 4.38 | 4.33 | 2.80 | 2.73 | 2.75 | 2.57 | 1.95 | 1.51 | 1.31 |
| table now | 16.13 | 5.44 | 4.87 | 4.81 | 3.14 | 3.00 | 3.09 | 2.88 | 2.27 | 1.47 | 1.39 |

On the fixed engine the audit's table check reads 0 on this table and flags
only the back on the morning's (0.35×, z −16.9). Real backs in the yardstick's
harness come out lower still: 0.077 points of differential per overall point
against a quarterback's 0.574. The two methods — a synthetic back boosted on
every attribute, real backs whose ratings differ by a mix of them — have always
disagreed about backs, and they now disagree by about two and a half times
(0.34 of a quarterback against 0.13), where the real game's expected points
say about one to five for a standard deviation of talent. Every instrument puts
the back well below the quarterback; which ratio is right is left open.

**What moved with it**, against the table that morning on the old run game:

| | before | now |
|---|---|---|
| value shopper, wins of 14 in 24 leagues | 8.2 | 8.8 |
| skill players first | 6.4 | 5.3 |
| AI offers a league-season / weeks with one | 9.0 / 44% | 8.0 / 37% |
| offers that help the human | 52% | 35% |
| roster spread, auction / draft | 41.1 / 30.2 | 37.0 / 26.9 |
| a roster at market against the cap, founding | 122% | 119% |
| value board | back 1.69×, the one bargain | back 0.72×; QB 1.48×, CB 1.45× |
| MVPs to backs in 40 seasons, the table read straight | 37 | 0 |

Offers that help the human fall to a third, under the half the gate was built
for; recorded, not retuned.

**And what else it moved or turned up.**

- The pass/run read had nearly every squad running; every squad now does best
  throwing. See "The pass/run read".
- The MVP keeps its own ratio, refitted from 1.55 to 1.7 (Awards).
- The other four dials, re-measured with every club throwing: fourth-down
  aggression at the top +0.64 a game in eight-club leagues and +0.88 in pro
  ones, blitzing least +0.32 and +0.34, the deepest shell +0.66 and nothing
  measurable, tempo flat.
- A scramble for a loss from inside the three was logged past the goal line,
  which drew the play off the field strip: the scramble path never capped the
  loss the way the run path does. A changed random stream found it.
- A club took the user's kicker for its best receiver. The trade-down premium
  charges per point of leverage shipped, and a kicker eight points better than
  the club's own outweighed it. This document always said such a deal "is
  refused out of hand"; now it is — a position player for specialists alone is
  refused whatever the arithmetic.
- Drafting on the table still loses to `POS_BASE` by 3.9 ± 1.4 in twelve-club
  fantasy leagues, with the second back taken in round 13.5 rather than 3.5, so
  the bench back named above as the likely cause was not it.
- A test held twenty-yard runs above 0.7 a team a game, a floor taken from what
  the engine did while its backs broke too many; the real game gives 0.66, and
  that is where the engine now sits.
- The win-probability prior's two constants were checked and left: final
  margins spread 12.9 against 12.5 shipped, and a point of power is worth 3.42
  against 3.3. The old run game had drifted the second to 3.83.
- One realism figure noticed and left: 21.4% of runs are stopped at or behind
  the line against a real 17.3%. It is inside the realism check's 16–22 range,
  and `STUFF_RATE` was last fitted to that range's ceiling.

**Open.**

- The passing game runs hot at the level people play: starting quarterbacks
  throw for 8.0 yards an attempt in drafted leagues against 7.1 for real
  starters, and low-rated ones collapse (above). If passing has terms measured
  against a fixed level too, it is the same defect, and fixing it would move
  the pass/run read again.
- The engine's defences never adjust to how often an offence throws, so
  throwing more costs nothing, which is most of why that dial now has one end.
- The yardstick column under "Is the yardstick sound" was measured on the
  broken run game, and the agreement figure built on it needs re-measuring.

**Held to it by the audit.** `npm run rushing` plays both halves — the 81 backs
against their real seasons, and a season of two drafted pro leagues — and the
audit reads two numbers from it: the backs' slope (0.77, flagged outside
±0.15) and a pro league's yards a carry (4.66, ±0.25). About four minutes.

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
are not what a play is worth. A play is worth its yards less its turnover rate
times what a giveaway costs, and that price is measured rather than asserted —
see **What a giveaway is actually worth** below; it is 58 yards at this grid's
situation. Scored that way, the deep ball leaves the mix altogether — it is the
riskiest throw on the field — and the equilibrium is:

    defence   base 30%, shell 70%, stacked box 0%, blitz 0%
    offence   outside run 28%, play action 72%
    worth     6.67 yards a play

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

The final closes the books. Every player with a stat line is scored against his own position first: how many standard deviations above the league's starters at that position (players with at least half the season) he finished, on fantasy points, with punters rated on placement and distance and linemen, who keep no statistics, left out. The MVP is the best of those z-scores weighted by positional leverage, so a quarterback wins most years, as one does in the real league, while a back or receiver with a truly outlying season can beat him. Offensive and defensive players of the year are the best z-scores on their side of the ball, the kicker award goes on points, and coach of the year to the club that finished furthest above its roster's power rank. An all-league team takes the top scorers at each position in starter numbers, and the season leaders are recorded in eleven categories. The awards screen shows the same race mid-season, so the MVP argument runs all year.

The record book keeps season marks (twelve player categories), single-game marks from the games that kept player lines (yours and the playoffs; AI regular-season box scores hold team totals only), and team marks: points and margin in a game, points and wins in a season. Each entry names the holder, the club, the season and, for games, the opponent; a mark is replaced only when beaten.

Careers accumulate per player across seasons: games, totals, honours, statistical titles and rings (every member of the champion's roster gets one). The hall of fame is a résumé score: a point a season, four for an MVP, two for a player-of-the-year award or a title, one and a half per all-league selection, half per statistical title, and a point per 300 fantasy points; induction at 12 with at least three seasons. That is deliberately reachable in a short dynasty and deliberately not reachable by longevity alone. Established: the scoring above.

**The exponent was measured, and the answer was to delete it.** The line above used to end by admitting that nobody had checked whether the leverage exponent let non-quarterbacks win often enough. Twenty-nine seasons across three seeds say the opposite problem: backs won 48% of the MVPs to the quarterbacks' 17%. `^0.35` compresses a 1.7x leverage advantage at quarterback down to 1.2x, which is not enough to survive a back's noisier fantasy line, and the running-back leverage rise that fixed his auction price made it worse without anyone noticing, because the two numbers were never read together.

Swept over the same seasons, by patching the constant and playing the dynasty out at each value:

| exponent | QB | RB | others |
| --- | --- | --- | --- |
| 0.35 | 17% | 48% | DL 4, WR 3, TE 3 |
| 0.7 | 66% | 34% | — |
| 1.0 | 79% | 21% | — |
| 1.3 | 86% | 14% | — |

Real MVP voting since 2000 runs about 79% quarterbacks and 12% backs. That makes 1.0 the fit, and 1.0 is not an exponent — it is the leverage table itself, so the parameter is gone and the award is simply a player's season weighted by what his position is worth. Backs keep one in five, a shade more often than they really manage; correcting that would need a value past 1.0, which buys a point of realism at the price of a league where nobody but a quarterback ever wins.

Two caveats that are not speculation but are worth stating. The sweep holds the rest of the engine fixed, so a later change to `TRUE_LEVERAGE` moves this distribution again — it now moves it *directly*, with no exponent damping it, which is a feature only if the leverage table is trusted. And 29 seasons is a small sample for a distribution: the per-seed splits ranged from 44% to 80% quarterbacks at the chosen value, so the pooled 79% carries real width.

**The first caveat came true, twice in a day, and the award has one number of its own now.** Re-measured on the morning of 2026-09-24, the table had the back at 0.97 of a quarterback, and read straight it handed backs 37 MVPs in 40 seasons. Forty seasons at four seeds (2026 to 2029, ten each, the playthrough's dynasty), every eligible line kept at each season's end so every weighting is scored on the same seasons; the harness names the engine's own MVP in all forty:

| weighting | QB | RB |
| --- | --- | --- |
| the table, read straight (quarterback over back 1.03) | 3 | 37 |
| the table before 2026-09-24 (1.69) | 38 | 2 |
| quarterback over back 1.5 | 30 | 10 |
| 1.55 or 1.6 | 33 | 7 |
| 1.65 | 37 | 3 |

It is the same failure as the first time, reached from the other side: the season's best back stands further above his position than the best quarterback does above his — a z of 2.78 against 2.11, averaged over those forty seasons — so once the weights are level his noisier line decides it. The award is modelled on real voting, and voters do not weigh a back like a quarterback, so it was given a ratio of its own: 1.55, which named 33 quarterbacks and 7 backs.

The same afternoon the run game was measured against real carries and fixed, and the table re-set with the back at 0.34 of a quarterback. Read straight, that table hands every one of 40 seasons to a quarterback — the other way — and the fixed engine moved the ratio's fit too, because a season's best back now stands at a z of 3.02 against the quarterback's 2.09:

| quarterback over back, fixed engine | QB | RB |
| --- | --- | --- |
| the table read straight (2.97) | 40 | 0 |
| 1.55 | 27 | 13 |
| 1.6 or 1.65 | 30 | 10 |
| 1.7 | 31 | 9 |
| 1.75 | 34 | 6 |
| 2.0 | 39 | 1 |

So `MVP_QB_OVER_RB` is 1.7: 31 quarterbacks and 9 backs, 78% against real voting's 79%, seven or eight quarterbacks in each ten-season run. The award cannot follow the table in either direction, which is the case for it having a number of its own. Every other position is still weighted by the table, so a later re-measure still moves them, and the playthrough is where that shows. A test reads the ratio back from the race's own scores, and pointing the award at the table again fails it.

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

That is not a flat league. The pass/run read is worth about half a point (see **The pass/run read**), so tactics come to roughly a twelfth of the roster gap, which is a defensible ratio rather than a broken one. The premise was wrong; there is no structural problem here to fix.

What is true, and was never the point being argued: the draft distributes talent evenly *relative to what the pool allows*. An eight-club league could produce a 6.40 power spread and produces 0.88 — 12% of the available range, and the same 12% at every league size, because the snake order hands out equal draft capital and the roster template forbids concentrating it. The pool is not the constraint: at eight clubs every drafted player is 88 or better.

If more variety is ever wanted, the one lever that measured worth having is
**unequal auction budgets**, and it is built now — a *Cap room* choice on the
setup screen, auction only, off by default. See **Unequal cap room** below,
which re-measures it and corrects one half of what this paragraph used to
claim.

### A code that outlives the pool

A league code used to store a roster as indices into the shipped player pool,
which made it a statement about an array rather than about a league. Grow the
pool by one name — and `add-players.mjs` re-sorts every position by overall when
it merges, so one name shuffles everyone below him — and every index after it
points at a different man. The only safe response was to refuse the code
outright, which is what `poolFingerprint` was for.

That was a known risk when codes were built, written down in the roadmap at the
time. It came due this session: the pool went from 1,269 players to 1,500, and
every code anyone had ever made died with it.

Version 3 carries `ids`, a table of the players a code actually mentions, and
every reference is an index into that. The code is then about players rather
than positions, and opens against any pool containing them. Version 2 is still
read, but only against a matching fingerprint, which is the only thing it ever
worked against anyway.

**A player the recipient has not got is reported rather than silently swapped.**
He gets `migrationNote` — the same channel a save problem uses, which sits above
the view and stays until it is read — naming how many men were missing and that
their places were filled from the market. A code that quietly hands over a
different league under the same name is worse than one that refuses.

**It costs roughly double.** An eight-club code goes from about 3,300 characters
to 6,200; a 32-club pro league from 16,600 to 33,600. The table is the whole
cost, and it does not compress away: sorting it so deflate sees like next to
like was measured at 2–3%, which is not worth the remapping. A 32-bit hash per
player instead of the id would be about a quarter of the raw size, but hashes do
not compress at all where ids share surnames and seasons, so the saving after
deflate is nearer 27% — bought at the price of a collision silently resolving to
the wrong man. Correctness won. The bound is asserted in the test so it cannot
creep further unnoticed.

Why a pro code names the whole pool: 864 men are rostered, and `drain` — the
schedule on which unsigned all-time players leave the market — names the other
636. Dropping it would save 42% and hand the recipient four hundred players back
on the free-agent market, which is the exact problem carrying the drain was
added to fix. Left alone deliberately.

### What a knee costs

An injury used to cost weeks and nothing else, which made a thirty-four-year-old
star an arithmetic slope: he declined on schedule whatever happened to him, and
a torn ACL was a bad month. Now the worst band — torn ACL, ruptured Achilles,
broken leg, neck — leaves a mark. `recordGameInjuries` notes it in
`league.knocks`; `advanceCareers` settles that ledger in the offseason and
clears it, because the same knee must not be charged every year until the man
retires of it.

The toll is two things: he comes back a step slower, and he has a year less in
him. It is weighted to `PHYSICAL`, which is where a knee goes, so it costs a
running back half again what it costs a quarterback — a back's career ends at a
knee and a quarterback's mostly does not. It scales with age past prime, because
a twenty-three-year-old walks it off. And a ceiling he can no longer reach is
lowered to match, or the development code would spend the next three seasons
handing the loss back.

**The split between the two figures was measured, not chosen.** At 3.0 physical
and 0.8 general a *punter* lost more than a running back — `ppw` is physical and
carries most of his rating — while an offensive lineman lost almost nothing,
because `pbk`, `rbk` and `awr` are none of them physical and a knee does not
care about that. Moving weight into the general figure (2.6 / 1.3) closes both
gaps without flattening the one that should be there:

| position | overall lost to one knock | years lost |
| --- | --- | --- |
| P | 2.69 | 1 |
| RB, DL | 2.38 | 1 |
| WR, K | 2.1 | 1 |
| QB, LB, TE | 1.9 | 1 |
| CB, S | 1.8 | 1 |
| OL | 1.59 | 1 |

The punter is still top and that is not ideal; what makes it tolerable is that
`POS_RISK` puts a specialist at 0.12, an eighth of a linebacker, so he is barely
ever hurt in the first place.

**Frequency, measured over 40 league-seasons of a 32-club pro league**: about
4.8 marked careers a season, 0.15 a club — a club sees one roughly every seven
seasons. That is 0.56% of the 864 men under contract, so the league-wide drag is
arithmetically nil and the ageing drift in a long save (85.0 down to 78.1 by the
eighth season, 75.8 by the tenth) is the pre-existing one, not this. The toll is a per-player
event, which is what it should be: rare enough to be news, heavy enough to
change a keeper decision.

`npm run knocks` measures both halves. A control arm was tried first and
abandoned — `simulateAhead('nextSeason')` runs the season and the offseason
inside one call, so there is no seam to clear a ledger in, and both arms came
back identical. Stepping the same career twice, once with the knock and once
without, isolates the toll exactly and is what the table above comes from.

### Auto-ordering a depth chart

`sortDepthCharts` puts the best men in the starting slots for every AI club on
every roster move, and leaves yours alone the moment you touch it — a depth
chart is a decision, and having it reordered under you is the opposite of one.
`autoDepth` is the button that asks for it, on the depth tab of your own team.

It ranks by `shownOverall` rather than `overall`, so it orders a player the way
the rest of the game shows him. Sorting an unscouted rookie by his true rating
would put the number back on screen as his place on the chart, which is the leak
the player pool and the draft board already avoid. Injury is deliberately not
considered: the chart says who is ahead when everyone is fit, `buildLineup`
already sits the hurt man and moves the next one up, and demoting him for being
injured would leave him behind when he came back.

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
| even | 1.51 ± 0.08 | 4.9 | — |
| ±10% (`mild`) | 1.93 ± 0.07 | 6.3 | 0.59 |
| ±20% (`wide`) | 2.56 ± 0.10 | 8.3 | 0.81 |
| ±40% | 3.73 ± 0.08 | 12.1 | 0.93 |

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

### What a giveaway is actually worth

The payoff grid above prices a turnover, and for a long time that price was a
sentence rather than a measurement: *a giveaway is worth about four points and
four points is about forty yards*. Both halves were wrong, in opposite
directions.

Four points is not forty yards. `EP_PER_YARD` is 0.0528, so four points is
seventy-six. And the swing is not four points: under a linear expected-points
curve what you lose and what the other side gains move oppositely at the same
rate, so

    EP(x) + EP(100 - x) = (0.0528x - 0.268) + (5.012 - 0.0528x) = 4.74

constant in field position. A test in `winprob.test.js` pins that constancy,
because the whole idea of pricing a grid off one number depends on it.

`npm run turnover` fits the real thing from the engine instead of arguing about
it. For every snap it takes the offence's whole position value — score plus
expected points, the same quantity `winProbability` reads — before and after,
regresses that change on yards over plays that kept the ball, averages it over
plays that lost it, and reports the gap in yards. Over 120,000 snaps:

| situation | cost in points | in yards |
| --- | --- | --- |
| pooled over the down tree | 4.04 | 43 |
| 1st down | 4.33 | 56 |
| 2nd down | 4.11 | 41 |
| 3rd down | 2.95 | 18 |
| **1st and 10 from the 25** | **4.32** | **58** |

Two things fall out. The price is not one number: on third down a giveaway
costs a fifth of what it costs on first, because on third down you were likely
to lose the ball anyway and the turnover is only taking what a punt would have.
And the grid takes every snap at first and ten from the 25, so 58 is the figure
it needs — not the pooled 43 and certainly not 40.

The other finding is that **a yard gained on a play is worth about 0.093
points, not `EP_PER_YARD`'s 0.0528**. Both are correct and they are not the same
quantity: the constant prices field position, while a yard gained also converts
downs, which the EP model charges at 0.45 a down. That is written down here
because the two numbers look like a contradiction and somebody will eventually
try to make one match the other. A test says so too.

**The conclusion survives the correction**, which is the reassuring part and the
reason this was worth doing rather than worth worrying about. At 40 the defence
mixes base 17% with the shell 83% and the offence outside run 39% with play
action 61%; at 58 it is 27/73 and 37/63. Two live defensive calls and two dead
ones either way, deep ball out of the mix either way. The run-game, short-pass
and shell rebalances all rest on that shape, and the shape did not move.

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

#### Re-measured against real leagues (`npm run dials`)

The table above was measured on 19 September on identical rosters, in the same pass as the pass/run read that later turned out to have gone stale. Re-measured the way that read now is — every club played as the human's club (no plan, the default sliders, its pass rate on the read) at each setting of one dial, paired against the default, against its own league's AI clubs:

| dial, against its default | eight-club leagues, 9,600 club-games | pro leagues, 12,800 | now |
| --- | --- | --- | --- |
| 4th-down aggression at 1.0 | +1.25 ± 0.11 | +1.19 ± 0.09 | helps every squad: +0.98 to +1.51 in every mix of strong or weak offence and good or poor kicker |
| Blitz at 0.05 | +0.48 ± 0.15 | +0.31 ± 0.13 | less helps a little |
| Deep coverage at its best | +0.47 ± 0.16 at 0.4 | +0.33 ± 0.15 at 0.6 | more helps a little |
| Tempo at any setting | within ±0.2 | within ±0.2 | flat, for the strongest and weakest thirds alike |

What moved the first three is not isolated: the same dozen play-model changes went by, and the method differs too (a league's clubs, with their plans, rather than identical rosters). The team page now files aggression, the blitz and the shell under dials that help and says by how much, and tempo alone under taste. One thing this leaves standing, and it is not fixed here: a dial that goes one way for every squad is a tax on anybody who does not know to max it — the objection this document makes about a monotone pass rate. Telling the player is the fix made; making fourth-down aggression a decision again would be a change to the AI's fourth-down logic. The audit replayed aggression on four of those leagues, 100 games a club, at +1.23.

**Measured again once the run game matched real carries** (see "The back was worth nearly three times too much"), with every club throwing on the read, which now says 0.70 for every squad:

| dial, against its default | eight-club leagues, 9,600 club-games | pro leagues, 12,800 |
| --- | --- | --- |
| 4th-down aggression at 1.0 | +0.64 ± 0.10 | +0.88 ± 0.09 |
| Blitz at 0.05 | +0.32 ± 0.14 | +0.34 ± 0.12 |
| Deep coverage at its best | +0.66 ± 0.16 at 0.6 | +0.11 ± 0.13 at 0.4 |
| Tempo at any setting | within ±0.22 | within ±0.22 |

Aggression still helps every mix of offence and kicker (+0.48 to +0.72 at the top in eight-club leagues), at about half what it did when every squad ran. Deep coverage now helps in fantasy leagues and does nothing measurable in pro ones. The team page's notes say these numbers. The audit replays aggression on four of those leagues, 100 games a club: +0.62 at the top of the dial, flagged if it leaves +0.12 to +1.12.

Also measured and not built: the per-opponent game plan the audit proposed. `makeGameplan` already exists and every AI club gets one; it nudges the dials by ±0.06 to ±0.15 and fires in **16 of 1,500** even matchups because its thresholds need a composite gap over 5 or 8 points. Where it does fire it is worth +0.39 ± 0.41 points. The `planForUser` option that would extend it to the human has never been passed by anything, which is deliberate (see the game plan note above) and costs the player nothing measurable.

### The pass/run read (`strategy.js`)

Every AI personality drafts and calls plays coherently — Air Raid buys quarterbacks and receivers and throws at 0.66, Ground & Pound buys backs and linemen and runs at 0.44. The human's roster is whatever the human drafted and the dial starts at a flat 0.55 regardless. That asymmetry, not the absence of a weekly decision, was the real gap.

`runEdge(comp)` scores how much a club's running game beats its passing game from the composites the engine already builds, so it moves when a player is signed, hurt, dropped down the depth chart or developed.

**The first read had gone stale.** It was a line through a synthetic sweep, 450 paired games a cell, with the best pass rate falling from 0.70 at a run edge of −19.6 to 0.35 at +19.0: `clamp(0.64 − edge × 0.023, 0.35, 0.70)`. It was checked by playing real drafted clubs against their own clones, both on the default sliders and neither allowed a game plan, and came out at +0.98 ± 0.22 a game against a flat 0.55 — the figure the team page quoted. That was the engine of 19 September. A dozen changes to the play model followed, several of them strengthening the run ("A look that rewards the run", awareness, power and elusiveness given work to do, a passing game rebuilt around short throws), and nothing measured the read again. Its test pinned the formula to the table it had come from rather than to the engine, so no retune could make it fail. Replayed today in exactly that clone setup, it loses to 0.55: −0.29 ± 0.08 a game in eight-club leagues and −0.13 ± 0.14 in pro ones.

It came to light sideways: testing weather turned up one set of pro lineups that gained a point and a half by running more, and chasing that showed the AI clubs were fine and the human's advice was not.

**What the dial is worth to you, measured the way you play.** Every club in real drafted leagues was played as the human's club is — no matchup plan, the default sliders — at each setting the dial allows, against its own league's AI clubs, every game paired against the same game at 0.55 (`npm run passrate -- read`). By run edge, in fifths:

| run edge, sixteen eight-club leagues | at 0.35 | at 0.45 | at 0.65 | at 0.70 |
| --- | --- | --- | --- | --- |
| −7.8 to −4.9 | −0.34 | −0.17 | −0.06 | +0.01 |
| −4.9 to −4.0 | +0.81 | +0.44 | +0.04 | +0.34 |
| −4.0 to −3.1 | +0.51 | +0.15 | −0.13 | −0.27 |
| −3.1 to −2.2 | +0.77 | +0.43 | −0.30 | −0.36 |
| −2.2 to +1.1 | +1.37 | +0.72 | −0.58 | −0.59 |

| run edge, four pro leagues | at 0.35 | at 0.45 | at 0.65 | at 0.70 |
| --- | --- | --- | --- | --- |
| −11.8 to −5.5 | −0.85 | −0.61 | +0.44 | +1.13 |
| −5.5 to −3.9 | −0.38 | +0.14 | +0.24 | +0.67 |
| −3.9 to −1.9 | +0.57 | +0.51 | −0.11 | −0.02 |
| −1.9 to +0.1 | +1.05 | +0.57 | −0.24 | +0.06 |
| +0.1 to +5.5 | +1.18 | +0.47 | −0.37 | −0.67 |

A cell carries ±0.16 to 0.18 in the first table and ±0.31 to 0.36 in the second. The payoff is two-ended: the most pass-built squads want the dial all the way up, nearly everybody else all the way down, and between the two it is flat. A middle setting is almost never the best one.

**The read now** is a ramp through the run edge where the two ends trade places: `clamp(0.525 − 0.15 × (edge − crossover), 0.35, 0.70)`, with the crossover at −5.25 in a fantasy league and −3.5 in a pro one. It was fitted by what following it earns — every ramp scored on the margin it would have won over these club-games — and each crossover is rounded between what its populations chose: eight-club leagues −5.5, ten-club −6.0, twelve-club −4.75 to −5.0; three pro seed sets −3.0, −3.25 and −3.75 to −4.25. A fantasy squad has an elite passer and faces elite opponents, a pro squad neither, which is why the two differ. A hard switch at the crossover earned the same out of sample, and would have flipped the advice between 35% and 70% whenever one injury nudged the edge, so the ramp runs over about two and a third points instead. Following it, against a flat 0.55:

| league | the read now | the read as it was | always 0.35 |
| --- | --- | --- | --- |
| eight clubs, where it was fitted | +0.66 ± 0.07 | −0.16 ± 0.07 | +0.62 ± 0.08 |
| ten clubs | +0.47 ± 0.10 | −0.27 ± 0.10 | +0.46 ± 0.10 |
| twelve clubs | +0.66 ± 0.10 | −0.27 ± 0.10 | +0.49 ± 0.10 |
| pro, the seeds it was fitted on | +0.80 ± 0.15 | +0.31 ± 0.14 | +0.31 ± 0.15 |
| pro, a second seed set | +0.68 ± 0.15 | +0.28 ± 0.14 | +0.29 ± 0.15 |
| pro, a third | +0.42 ± 0.15 | −0.13 ± 0.14 | +0.16 ± 0.15 |

Out of sample it is worth +0.42 to +0.68 a game where the read it replaced was worth −0.27 to +0.28, and the team page now says about half a point. In a fantasy league it comes out close to "always run", because most fantasy squads sit on the run side of −5.25, and that is the answer rather than a defect in it. Where the advice reads backwards — a squad whose passer is its best player, told to run — the screen says so and says the advice is measured, because the reason is not established. The audit re-measured it on eight of those leagues, 150 games a club at each setting: +0.77 ± 0.17 against 0.55, where the read it replaced scored +0.04 on the same games. Half that sample was tried first and could not tell the two apart.

**Why running pays is not established, and one likely reason was tested and mostly ruled out.** An AI club plans against its opponent's personnel, and against a good passer its plan is a shell over the top — the look the run eats, +2.0 and +2.2 yards a carry. That was the first explanation, and it is testable: take the opponents' plans away and see whether the run stops paying. It mostly does not. In eight-club leagues running at 0.35 earns +0.55 ± 0.08 a game with nobody planning against +0.62 ± 0.08 with plans on, and +0.22 against +0.31 in pro leagues; the most run-built fifth barely moves either way. The clone replay above points the same way, since nobody plans there and running still wins. So the plans explain a small part at most, and the rest belongs to the play model as it now stands — which of the changes since the first read moved it was not isolated.

**Why running paid, established the same day: the run game was broken.** A point of a back's rating moved his carries five times as far as the real game's, and power and elusiveness were measured against a fixed 82, so drafted leagues of greats ran at 5.95 yards a carry against a real 4.49 (see "The back was worth nearly three times too much"). Once the run game matched real carries, the read above went from +0.77 a game to −1.17.

**Measured again on the fixed engine, the dial goes all the way up for everybody.** The same measurement, by run edge in fifths:

| run edge, eight eight-club leagues | at 0.35 | at 0.45 | at 0.65 | at 0.70 |
| --- | --- | --- | --- | --- |
| −7.8 to −5.0 | −2.06 | −1.04 | +0.43 | +1.52 |
| −5.0 to −4.0 | −1.77 | −1.23 | +0.23 | +1.04 |
| −4.0 to −3.2 | −2.43 | −1.40 | +0.47 | +0.51 |
| −3.2 to −2.1 | −1.23 | −0.21 | +1.06 | +1.68 |
| −2.1 to +1.1 | −1.50 | −0.67 | +0.52 | +0.44 |

| run edge, three pro leagues | at 0.35 | at 0.45 | at 0.65 | at 0.70 |
| --- | --- | --- | --- | --- |
| −9.3 to −5.8 | −1.64 | −0.49 | +0.92 | +1.42 |
| −5.8 to −3.7 | −1.37 | +0.03 | +0.96 | +1.44 |
| −3.7 to −1.9 | −1.40 | −0.75 | +0.55 | +0.51 |
| −1.9 to −0.3 | −1.19 | −1.07 | +0.75 | +0.93 |
| −0.3 to +4.5 | −0.47 | −0.24 | +1.24 | +1.23 |

A cell carries ±0.34 to 0.38. Ten- and twelve-club leagues say the same: every fifth of every kind of league gains +0.40 to +1.68 at 0.70. Against a flat 0.55, with the read below in place:

| league | always 0.70, the read now | the read of 19 September | the read fitted that morning |
| --- | --- | --- | --- |
| eight clubs | +1.04 ± 0.16 | +1.05 ± 0.16 | −1.17 ± 0.16 |
| ten clubs | +1.01 ± 0.17 | +0.89 ± 0.16 | −0.93 ± 0.16 |
| twelve clubs | +1.10 ± 0.16 | +0.99 ± 0.15 | −0.98 ± 0.15 |
| pro | +1.11 ± 0.17 | +0.98 ± 0.15 | +0.10 ± 0.16 |

The last column was measured while that read was still in place, so the human's club was playing it as everybody's opponent too; the others with the new one. The ramp fitted to these games puts the crossover at the right-hand end of the range it is searched over, and in-sample it beats always throwing by five hundredths at most. So there is no crossover: `CROSSOVER` is `null` in both kinds of league, and the read tells every squad to throw — a run-built squad in so many words, "Even so, squads built like yours win more by throwing, measured against the clubs you play" — and says moving the dial is worth about a point a game. The ramp stays in the code for the day a crossover comes back. The read of 19 September, fitted on synthetic rosters before the run game was broken, had the direction right all along.

A dial that goes one way for every squad is a tax on anybody who does not max it. Two things would make it a decision again, and both are recorded rather than done: the passing game runs hot at a league's level (starting quarterbacks at 8.0 yards an attempt against 7.1), and the engine's defences never adjust to how often an offence throws, so throwing more has no price. The audit re-measures it on eight of those leagues, 150 games a club at each setting: +1.04 against 0.55, flagged outside +0.64 to +1.44.

**The AI clubs were fine, give or take the opening weeks** — on the engine before the run game was fixed, and not measured since. Every club in four pro leagues played its own league with its pass rate moved, paired by seed (`npm run passrate -- ai`). Moving every club the same way, anywhere from −0.20 to +0.10, was worth −0.13 to +0.29 — flat — and flat again at midseason. The weather finding did not replicate. What is left is fit: moved each to its own read at kickoff, AI clubs would gain +0.46 ± 0.14 a game, nearly all of it run-built clubs that open too pass-heavy (Ground & Pound +0.96, the most run-built third +1.02), and the weekly drift walks those down by midseason — Ground & Pound from 0.44 to 0.33, after which running still more earns nothing. Starting AI clubs on the read is a possible change, not made.

What makes the metric trustworthy is that it reads the league correctly without being told: sorted by average run edge, Ground & Pound clubs come out the most run-leaning (−0.1) and Air Raid the most pass-leaning (−6.1), in personality order, with the personality never consulted.

Only the club you manage gets a read; telling you what a rival should be doing is coaching the opposition.

**The opening position is now fitted too.** `assignGms` hands every AI club its personality's strategy when the league is created, matched to the roster that personality then drafts — Air Raid at 0.66, Ground & Pound at 0.44. The human's dial sat at `DEFAULT_STRATEGY`'s flat 0.55 whatever they built, and that club was the only one the default ever reached. `fitUserStrategy` in `season.js` points it at the squad once, when the roster first exists. Once only: after that the dial is the player's and the team page says when the squad has changed enough to want a different one. `scripts/gameplan-sim.mjs` runs the clone test the first read was checked on, and `scripts/pass-rate.mjs` everything above it.

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

**What is left is the honest part.** Every one of those 16 is a position whose weight vector cannot express the archetype, and the script proves it rather than asserting it: it recomputes each flagged player with his strongest attribute set to 99 and prints the result. Derrick Thomas caps at 77 against a floor of 85 with a perfect pass rush. Kevin Greene caps at 76. Thirteen of the sixteen are edge rushers, because pass rush is 15% of a linebacker's rating and run defence is 35% of a lineman's — the one thing they were paid for is the one thing the formula barely counts. *Since resolved: a linebacker is now rated on whichever of two weight vectors suits the job he does, and the edge rushers among those sixteen all clear their bars. See **One linebacker position, two jobs**.* Larry Csonka caps at 79 because a fullback who cannot catch spends half his rating on speed, elusiveness and receiving. That is a real mis-specification and it is not fixed here: changing `POSITIONS` moves every player's overall, the leverage table, auction prices, the draft board and every trade valuation at once, which is a separate decision with its own measurement to do first.

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

*And the original premise turned out to be right after all, for a reason neither
reading had found: the linebacker's pass rush was over-priced because it was
nearly inert, and it was nearly inert because `passRush` read one elite rusher at
a sixth of what it read a lineman. Both of those measurements were taken on a
population with no edge rushers in it. See **One linebacker position, two
jobs**.*

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

**That was wrong, and it was the largest defect in the run game.** They are
better than the reference on both sides of the ball, and power and elusiveness
were only ever counted on one: measured against a fixed 82 rather than against
the defence, they took drafted pro leagues to 5.95 yards a carry against a real
4.49. Both terms, and every other one that reads the ball carrier, now read him
against his opposite number. See "The back was worth nearly three times too
much".

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
work, and it is engine work. *It was done — see **One linebacker position, two
jobs** below. The diagnosis held: it took an engine change, and reweighting on
its own could never have got there.*

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

### The tight end, where the two authorities disagree about the job itself

The original sweep noted in passing that a tight end is mostly a blocker. That
note was several engine changes old and had never been checked. Checked, it is
true, and it is the deepest disagreement in this document — not about a number
but about what the position is.

#### The instrument was lying, in a way worth understanding

The first reading, on 6,000 games, said `blk` was **0.656** of a tight end's
leverage against a shipped 0.250, with `cth` at 0.044 and `rte` at 0.035. That
looks decisive. It is not a measurement.

The tight end is one starter, so the harness lifts one player and the margins
are small: `cth` came in at 0.055 ± 0.139 and `rte` at 0.043 ± 0.140. Both are
indistinguishable from zero. And the normalised column divides each margin by
the sum of all of them — so when four of five are noise, the share of the one
that measured is not a fact about the engine, it is roughly one over the number
of attributes that beat the noise.

The proof came free. Lowering the tight end's blocking share in `composites`
cut `blk`'s absolute margin from 0.813 to 0.540 — and its normalised share went
*up*, to 0.670. A number that does not move when the thing it measures is
halved is not measuring it.

Run at 24,000 games the standard errors halve and the picture changes:

| TE | priced | at 6k | at 24k | σ |
| --- | --- | --- | --- | --- |
| `blk` | 0.250 | 0.656 | **0.509** | 8.3 |
| `cth` | 0.250 | 0.044 | **0.143** | 1.9 |
| `spd` | 0.100 | 0.076 | **0.132** | 1.7 |
| `rac` | 0.200 | 0.189 | **0.128** | 2.4 |
| `rte` | 0.200 | 0.035 | **0.087** | 1.1 |

About half a blocker, with the receiving attributes splitting the rest fairly
evenly — a believable picture, and a different one from "two thirds blocker with
worthless hands". `npm run attrs` now prints a σ column and refuses to let a
sub-2σ split pass without saying so, because this repo came within one commit of
repricing a position on noise.

#### One thing was genuinely wrong, and it was not the weights

`runBlock` gave the tight end **0.20** while five linemen shared 0.80 — 0.16
each. The tight end was the single most important run blocker on the field. He
is one of six blockers and usually the least central of them. At 0.12 he is
worth about two thirds of a lineman, which is the right end of the order, and
because the shares still sum to one the calibration does not move. Realism stays
clean; `runs stopped at or behind` came the rest of the way into band with it.

#### The weights do not move, and this time that is the answer

There is no free move. Not a small one: f = 0.125 already costs Brock Bowers,
and it escalates — half way costs Winslow and Gates too, all the way costs
Shannon Sharpe as well. Four of the position's defining names, and every one of
them a receiving tight end.

That is not the record being fussy about an edge case, the way it was about one
power back or one instincts corner. It is the record saying that the great tight
ends of this sport are pass catchers, while the simulation says the job is
mostly blocking. Both are coherent. A tight end in this engine blocks on sixty
snaps and is thrown to six times, and the arithmetic of that is not wrong — it
is simply a different game from the one the hall of fame was voted on.

So the weights stay where they are, and the disagreement is recorded rather than
split. Of everything in this document this is the one where "measure it again"
is least likely to help: the measurement is now solid, and it is the premise
underneath that the two authorities do not share.

### The receiver, and the time the engine turned out to be right

The last disagreement left was the receiver: `spd` measured 0.396 of his
leverage against a shipped 0.270. Re-measured first, against the settled engine
rather than the one it was taken on, because the section below had just been
caught fitting weights to a passing game that then changed.

Two hypotheses, both wrong, and both wrong in a way worth keeping.

**Speed is counted twice in deep targeting.** `picks.js` puts `spd` at 0.2 of a
`skill` term that goes through `Math.exp((skill - 82) / 9)`, and then multiplies
again by `Math.exp((spd - 88) / 10)` on deep throws. `rte` gets only the shared
amplifier. At 90 against 82 that second multiplier alone is worth about 2.2x the
deep-target share, compounding on the first, which looks exactly like the kind
of double count that inflates a measurement.

Removing it moved `spd` from 0.396 to **0.375**. Real, and about five per cent
of the total — nowhere near enough to explain the gap. The reason is the
harness: it lifts all three receivers at once, and a multiplier that decides
which of *them* gets the ball barely moves when they all move together.

**The pass breakaway is over-sensitive to speed.** `PASS_BREAKAWAY` is 0.024 and
the speed term, `max(0, spd - defSpeed) / 300`, is additive and unscaled, so
eight points of edge more than doubles the rate — against the run breakaway,
where the same shaped term sits inside a `BREAKAWAY_RATE` multiplier. An
asymmetry, plainly.

Measured, the asymmetry runs the other way. Eight points of speed multiplies the
run breakaway by 2.90 and the pass breakaway by 2.11, and is worth 1.92 yards a
carry against 0.80 a completion. The run game is the more speed-sensitive of the
two. There is no artifact here to remove.

**So the engine is right, and that is the finding.** Speed measures 0.446 at
running back and 0.396 at receiver — the dominant skill-position attribute in
both cases — because explosive plays drive scoring and explosive plays key off
speed, and the explosive rate itself is calibrated (3.84 twenty-yard plays a
team against a real 3.5-5.5). It is a coherent property of the model rather than
a bug in one position, and nothing was changed.

#### The rule worked, for once

Every reweight before this one ran into the same wall: the record allowed no
free move, so the rule said stop and stopping meant shipping a known
mis-pricing. The receiver has one. Moving a quarter of the way to the
measurement — `spd` 0.27 to 0.30 — costs nothing the record notices; three
eighths costs Tom Fears; three quarters costs Raymond Berry as well. Both are
1950s and 60s possession receivers, hands and route craft rather than legs,
which is a coherent thing for a speed-heavy vector to punish rather than an
arbitrary one.

So: the free move, and stop. Re-measured under its own new weights the reading
holds at 0.402, which says the loop settles rather than chasing itself.

That leaves a **residual of 0.102** on the largest single attribute gap in the
game, and it is left deliberately. The engine is not wrong, the measurement is
not an artifact, and the record will not have it — which is a different kind of
open question from the others in this document, and not one more measurement
will settle.

Not done: the tight end has never been re-measured against the current engine at
all, and the original sweep's note that he is mostly a blocker is now several
engine changes old.

### The one realism miss nobody had diagnosed

`yards / completion` had sat outside its range for as long as the realism check
has existed — 12.10 against 10.8-12.0 — and had never been looked at, because
0.8% over the top of a judgement call is easy to leave.

**The metric was measured correctly, which took checking first.** There is an
arithmetic inconsistency in the output that looks like a bug: pass yards over
attempts gives 7.21, and completion percentage implies 11.36 yards a completion,
not 12.10. The two differ because `yards / attempt` runs off team `passYds`,
which is net of sack yardage, while `yards / completion` is the mean of the
completed-pass log entries, which is gross. Gross is the right convention for
comparing to the real range, so the instrument was sound and the engine really
was high.

**Decomposed, the small miss was the tip of a composition error.** Air yards and
run-after-catch are fitted separately, so splitting them says which to look at:

| | engine | real game, approximately |
| --- | --- | --- |
| air yards / completion | **8.93** | ~6.0 |
| after the catch | **3.81** | ~5.3 |

A completion here was seventy per cent air where the real game is a bit over
half. The two errors mostly cancel, which is exactly why only a derived ratio
poked out while the shape underneath was a downfield passing game in a sport
that mostly throws short and runs after it.

The clearest single wrong thing was a clamp: `pass_short` air yards were
`normal(6, 2.4)` bounded to **[1, 11]**, so this offence could not throw a
checkdown at or behind the line of scrimmage — a large share of real short
passing simply did not exist. `pass_short` is 47% of completions.

#### Getting it back without breaking the rest

Lowering air yards alone cost 3 points a game and took scoring drives, total
points and overtime frequency out of band: three new misses to fix one. Raising
run-after-catch to compensate recovered most of it but left the ratio straddling
its boundary, because `yards / completion` and total points are coupled through
the same pass yards — you cannot lower one and hold the other by moving yards
around.

What broke the coupling was noticing that completion probability in this engine
is **per call, not per yard**. `pass_short` was made a yard and a half shorter
and went on completing at the same 0.745 it had when it was longer. Moving that
rate with the throw adds completions rather than yards: it lifts completion
percentage into the middle of its range, restores the points, and *lowers* yards
per completion, because the completions it adds are short ones.

One more thing had to move with it. `runs stopped at or behind` had sat on its
boundary all session and went 0.2 over it — not from anything in the passing
game, but because the linebacker and line weights had been refitted toward what
the field measures, and a front that fits the run better stops more runs behind
it. `STUFF_RATE` has been fought over before (0.145, then 0.1415, per its own
comment) and went to 0.1370, which puts the share at 21.9 while mean run holds
at 4.51 against a 4.2-4.6 range.

Result: **none of 44 metrics wholly outside**, the first fully clean run this
check has had. Composition moved from 70% air to 63%, which is about halfway to
the real game and deliberately not further — the direction is solid but the
targets are league averages quoted to a precision this document cannot justify.

#### What it dragged with it, which is the real lesson

Changing what a drive is worth invalidates everything fitted on top of drives.
The expected-points curve re-fitted from 0.0539 to 0.0528 and settled on the
second pass, as `winprob.js` says it does. The turnover price moved 58 yards to
56. The playbook equilibrium was re-run and its shape held: two live defensive
calls, two dead ones.

And then the awkward one. The cornerback weights in the section below were
fitted an hour earlier **against a passing game this section then changed**.
Re-measured, CB `awr` had gone from 0.048 to 0.106 — the shipped 0.05 was now
wrong by more than the gap that justified moving it in the first place, and
wrong in the direction that had cost Ronde Barber his bar. It has been re-fitted
against the engine as it now stands.

The ordering rule that falls out: **fit weights after the engine has stopped
moving, not before.** Every leverage number is a measurement of a specific
engine, and this session changed that engine four times.

Left open rather than chased: the receiver wants a re-measure too — `spd` now
reads 0.405 against a shipped 0.270, the largest remaining disagreement in the
game — and the safety was fitted in the same stale pass as the corner, though
its gaps were small enough that the shift is inside the noise. Both are the next
piece of work, not this one.

### Deep coverage is a footrace, and nothing said so

The corner was the last position where the price and the field plainly
disagreed: `cov` measured 0.611 of his leverage against a shipped 0.480, and
`spd` 0.094 against 0.170. The `spd` half is the same question `thp` raised —
genuinely cheap, or barely wired? — and the answer was the same.

**A corner's speed reached the simulation through one composite, and every use
of it is clamped.** `defSpeed` appears three times, and twice as
`Math.max(0, receiver.spd - defSpeed)`: once the secondary is fast enough, more
speed does nothing whatever. Measured on the calibration population, the
receiver is the faster man in **38% of matchups**, so a corner's legs are inert
in the other 62%. The one unclamped channel is deep completion, about a tenth of
throws.

What was missing is more basic: speed never helped him *cover*. `covDeep` read
`covOf(cb)`, `covOf(s)` and `covOfLb()`, all of which are coverage and awareness
— so two corners with identical `cov` and four tenths of a second between them
covered a post identically. That is not a debatable modelling choice, it is a
gap.

`covDeep` now carries a footrace term, weighted 0.6 to the corner and 0.4 to the
safety, because the corner is the man on the receiver and the safety is help.
Short and intermediate coverage are deliberately untouched: a quick slant is not
a footrace. Centred on 82 so an ordinary secondary sits exactly where the
calibration put it.

Re-measured, the wiring did what it was supposed to and nothing more:

| | before | after | priced |
| --- | --- | --- | --- |
| CB `spd` | 0.094 | **0.141** | 0.170 |
| S `spd` | 0.090 | **0.143** | 0.130 |

Both inside the band everything else sits in. As with arm strength, the fix was
wiring, not price.

#### The reweight, and the man it costs

What remained was a genuine mis-pricing: `cov` under-priced by 0.114, `awr` over
by 0.072. The safety moved 0.75 of the way to the measurement, which is the
largest move the record allows for free. The corner has no free move — the cost
is **one violation at every blend from 0.05 to 1.00**, flat, so there is nothing
to buy by stopping early.

It went the whole way, and this is the point where the judgement differs from
the running back. There the partial move was chosen because `spd` at 0.446 was a
faithful measurement of this engine's breakaway model and a weak claim about
football. Here there is no such reservation: `cov` at 0.594 came in at fourteen
sigma, and coverage being about sixty per cent of a cornerback is not a
contentious statement about the sport.

The cost is **Ronde Barber**, and he is a recognisable archetype rather than a
rounding error: `awr` 90 with `cov` 80 and `spd` 78, both under the median for
the position — the instincts corner, in an engine that measures a corner's
awareness at 0.048. The legacy check says it plainly: *caps at 81 with awr 99 —
the weights, not the rating.* He cannot reach his bar with perfect awareness,
which means the disagreement is about what the simulation rewards, not about
what he was worth.

That makes four recorded violations, and all four are the same kind of thing: a
power back who cannot run (Csonka, Riggins), a quarterback whose case is
longevity (Blanda), and an instincts corner. None of them is a bug; each is a
place where the record and this simulation disagree about football, and the
check names the weights as the binding constraint every time it runs.

> **Corrected later.** The last sentence was true of what the check printed and
> false about the world. It was perfecting the attribute each player was already
> highest at, which for Barber is `awr` at 90 and worth one point, while his
> `cov` carries 0.57 of the vector. He was four points of coverage from his bar,
> not beyond reach, and he has since been corrected to `cov` 84 — leaving three
> violations, which genuinely are the disagreement this paragraph describes. See
> **The check said four ratings were unfixable** above.

### Two attributes worth nothing, and why only one of them was

After the linebacker, the two remaining ratings the record disputed were Larry
Csonka, who wants more from `pow`, and George Blanda, who wants more from `thp`.
Measuring the positions rather than arguing about the players turned up two
attributes priced far above what they were worth:

| | priced | measured |
| --- | --- | --- |
| RB `car` | 0.150 | **0.007** |
| QB `thp` | 0.170 | **0.052** |

Fifteen per cent of a running back's price for under one per cent of his effect,
and seventeen of a quarterback's for five. The obvious move is to cut both
prices. That was right for one and wrong for the other, and the difference is
the one `defAwr` taught this engine already: **an attribute can measure as
worthless because it is barely wired, not because it does not matter.**

**Arm strength was under-wired.** `thp` appeared in exactly two places, both of
them `pass_deep` — the throw distance and the deep completion. Deep shots are
about a tenth of attempts, so the attribute was very nearly decorative, and
cutting its price would have locked that in. In the sport a strong arm is
velocity into a closing window, which is a sideline out as much as a post. It
now scales with how far the ball has to travel, centred on 82 so a league of
ordinary arms sits exactly where the calibration left it. Re-measured, `thp`
went **0.052 → 0.131** against its 0.170 price: inside the noise band the other
attributes sit in. The wiring was the fix, and the QB weights did not need to
move at all.

**Ball security was not.** `car` reaches every carry through the fumble rate and
it plainly works — measured directly, 0.810 fumbles a game at `car` 60 against
0.427 at 99. It is simply that fumbles are rare and the offence recovers half of
them, so that whole 39-point swing buys 0.55 points of margin. One genuine gap
was closed for consistency — the fumble after a catch read only the defence's
tackling, so a back who coughed it up carrying never did catching — which lifted
`car` from 0.007 to **0.020**. Still an eighth of its price. Here the price was
the thing that was wrong.

#### Where the constrained fit ran out

The rule this document has used for every reweight is *the largest move toward
the measurement that leaves the record no worse*. At running back it had no
answer. Every move from `spd` 0.25 to 0.45 costs **exactly one** extra violation
— John Riggins joining Csonka, the same power-back archetype — and the count is
flat the whole way; only the severity grows. So the rule says move nothing, and
moving nothing leaves the largest mis-pricing in the game in place.

The call was to take a partial move, `spd` 0.20 → 0.30 and `car` 0.15 → 0.08,
and to say plainly that it is a partial move. It closes most of both gaps and
stops short of the measurement's own answer, because `spd` at 0.446 is a
faithful measurement of *this engine's* breakaway model and a much weaker claim
about football. Going further would have bought agreement with a number this
document is not confident enough in to deepen a hall of famer's miss for.

Violations go 2 → 3. Csonka -5 → -7, Riggins joins at -4, and both are the same
thing: a slow, punishing back in a simulation that pays for speed. That is
recorded rather than fixed.

#### The fit was wrong the first time, and the way it was wrong is the point

The first constrained fit tested ten quarterbacks and ten backs chosen by hand
and reported that a full move to the measurement broke nobody. Applied, it took
the violations from 2 to 10: it had missed an entire cohort of 1960s and 70s MVP
quarterbacks — Lamonica, Namath, Van Brocklin, Morrall, Brodie, Rypien — every
one of them rated on the arm that had just been made to matter.

The fix was to stop sampling and fit against `auditLegacy` itself, mutating the
weight vector in memory and clearing the rating cache between candidates, so the
constraint is the whole record rather than the part of it that came to mind. A
yardstick you check against a list you wrote yourself is not a yardstick.

#### Not done

The defensive line has an interior-versus-edge spread — Freeney and Gastineau
rush thirty points better than they hold up against the run — and it was looked
at and deliberately left alone, which is a change from what this document said
before. `runStop` reads `fitOf(dl)` and `passRush` reads `prs`, so a speed
rusher *already* trades run defence for pass rush. That is the tradeoff, already
expressed. The linebacker needed a role because the engine contradicted itself,
counting one man as a rusher and a coverer at once; a lineman genuinely plays
both downs, so there is no contradiction to remove and a DL role would be a
concept added for nothing.

Csonka and Blanda stay. Both are cases where the record and the simulation
disagree about football rather than cases where the game is wrong about itself,
and the legacy check's own output says so every time it runs: *caps at 78 with
pow 99 — the weights, not the rating.*

### One linebacker position, two jobs (`edgeness` in `positions.js`)

Derrick Thomas is in the hall of fame, holds the single-game sack record with
seven, and made nine Pro Bowls. He rated **77** — below an average starter. So
did Kevin Greene at 76, DeMarcus Ware at 78, Von Miller at 79. Twelve of the
sixteen ratings `npm run legacy` disputed were the same kind of player, and the
legacy check named the cause itself: *caps at 77 with prs 99 — the weights, not
the rating.* Maxing his pass rush to 99 could not get him past 77.

His attribute line was not wrong. Coverage 58 is an honest description of
Derrick Thomas. The weights were wrong, because they were being asked to price
two different jobs with one vector:

| | spd | tck | rsd | cov | prs | awr | was |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Derrick Thomas | 92 | 78 | 74 | 58 | 99 | 76 | 77 |
| Ray Lewis | 92 | 98 | 97 | 90 | 78 | 99 | 93 |

Sixty per cent of a linebacker's rating sat in tackling, run fit and coverage.
An off-ball linebacker is paid for exactly those. A 3-4 edge rusher is paid to
get to the quarterback and is a liability in coverage by design — he is not on
the field to cover, and in the real sport somebody else does it.

**Reweighting alone cannot fix it, and the measurement says so.** LB `prs`
measured 0.108 of the position's leverage against a shipped 0.150: *over*-priced
already. Raising it to rescue the edge rushers would have moved the economy
further from the field, not closer — which is why this sat open through two
earlier reweights.

**The engine alone cannot fix it either, and that measurement is the
interesting one.** `composites` read the rush as `0.6 × top-two linemen + 0.25 ×
the rest of the line + 0.15 × the mean of all three linebackers`. One elite edge
rusher therefore moved the pass rush by 0.05 a point where a top lineman moved
it by 0.30 — six times less. That is why LB `prs` measured near nothing: the
attribute was very nearly inert, and a whole class of famous players had nothing
in the game to be good at.

But fixing the formula on its own reaches almost nobody. Measured over 128
drafted rosters, edge rushers took **0.34 of the four rushing places**, because
at a rating of 77 they were drafted late and rarely started. The rating caused
the absence; the engine change could not reach past it. **Both halves are
required, and they bootstrap**: fix the rating and they start, fix the engine
and starting them pays.

#### The role is derived, not tagged

`edgeness` is how much better a linebacker rushes than he covers, `(prs - cov) /
30`, clamped to 0..1. Nothing is hand-tagged, for three reasons: a stored flag
would need 158 edits and a rule for generated rookies anyway; a derived one
cannot go stale when the pool is re-rated; and the derivation is checkable,
which a list of names is not.

It sorts the pool on its own. Derrick Thomas, Kevin Greene, Ware, Von Miller,
T.J. Watt and James Harrison all reach 1.00; Khalil Mack and Terrell Suggs 0.93;
Micah Parsons 0.87; **Lawrence Taylor 0.70**, which is the case that says the
measure is doing something real — chiefly a rusher, genuinely both, and he lands
between the two groups without anybody putting him there. Ray Lewis, Urlacher,
Seau and Kuechly read 0.00. Forty-six of 158 carry any edge character, fourteen
reach the cap.

`EDGE_SPAN` was chosen against the record, not for tidiness. Widening it to 45
stops anyone saturating, which looks better and costs four of the twelve rated
seasons the record argues for. Saturation is not a defect: a man who rushes
forty points better than he covers and one who rushes thirty better are both
simply rushers.

#### Three changes, and what each is for

**The rush.** A defence sends four. Two linemen always go; the other two seats
are contested between the rest of the line and any edge linebacker, ranked by a
`prs` that pulls a backer toward replacement level by how little of a rusher he
is. An off-ball backer never takes a seat; a Derrick Thomas takes one off a
mediocre lineman. The two terms are normalised over the four men actually
rushing, at `0.67 / 0.33`, which holds the synthetic calibration mean to within
0.02 on both populations.

**The coverage.** The half that was missing, and the record is what exposed it.
With the rush fixed, the edge rushers still failed their bars for any non-zero
coverage weight — measured: they clear only at exactly 0.00. That is the engine
charging a man for coverage he is not doing, having already counted him among
the rushers. The linebackers' share of coverage is now weighted by how much of
an off-ball player each one is. A front with no off-ball backer left still has
to cover somebody and covers with the men it has, so below a floor the plain
mean returns — fielding three rushers is still a coverage problem, which is the
trade-off this exists to create.

**Blitzing is deliberately left alone.** Sending extra men is precisely when an
off-ball linebacker does rush, so `blitzRush` still reads the whole corps.

#### The rating is a maximum, not a blend

The first version blended the two vectors by `edgeness`, and the blend had a
defect worth recording because the economy would have carried it silently.
Blending made the rating **non-monotonic in coverage**. Raising a rusher's `cov`
lowers his `edgeness`, shifting weight off a vector paying `prs` 0.45 onto one
paying 0.05, and for an elite rusher that loss exceeds anything the coverage
gains him. Swept across a grid: a linebacker with `prs` 96 read 88 at `cov` 67
and **84 at `cov` 82**. Improving a player by fifteen points made him four points
worse — and `overall` is the price, so that is a man getting cheaper for getting
better, with development, the rating editor and the draft board all acting on it.

Taking the better of the two vectors is monotonic by construction: the maximum
of two non-negative weighted sums is non-decreasing in every attribute. Swept
over the same grid, zero non-monotonic steps in `cov` and zero in `prs`. It is
also the more honest description — nobody rates Derrick Thomas as seven-tenths
of a coverage linebacker. `edgeness` stays, and stays continuous, because the
engine asks a different question: not what a man is worth, but how often he
rushes, which really is a matter of degree.

#### What the field said afterwards

Re-measured, the off-ball vector agrees with the simulation to within 0.005 on
every attribute — `tck` 0.269 against 0.270, `cov` 0.232 against 0.230, `prs`
0.055 against 0.050. The defensive line was refitted in the same pass, `prs`
0.55 → 0.61 and `rsd` 0.27 → 0.20, which is what the field measured and which
also lifted the two remaining edge-rusher violations, Dwight Freeney and Mark
Gastineau, under the tolerance.

Measuring the *edge* vector needed a new instrument, and the first two attempts
measured the wrong thing. `npm run attrs EDGE` reshapes a linebacker into a
rusher, because a synthetic roster draws attributes independently and its
backers are off-ball players almost every time. Reshaping **all three** — the
first attempt — produced a roster nobody fields, and with every backer saturated
the coverage floor correctly hands back the plain mean, so the reading announced
that an edge rusher's coverage was the most valuable attribute on the defence.
It is, when all three of them are edge rushers. Reshaping one, which is what a
real defence fields:

| EDGE | prs | tck | rsd | spd | awr | cov |
| --- | --- | --- | --- | --- | --- | --- |
| measured | 0.401 | 0.237 | 0.211 | 0.087 | 0.063 | **−0.200 → 0** |
| shipped | 0.45 | 0.17 | 0.19 | 0.11 | 0.08 | **0.00** |

The coverage reading is the confirmation. It comes out *negative* and clamps to
zero, exactly the shipped weight: a single edge rusher's coverage does nothing
for the defence, which is what the coverage gate asserts. The rest is a
constrained fit — the largest move toward the measurement that leaves the record
no worse, which is halfway. Going the whole way costs Terrell Suggs his bar.

Derrick Thomas now reads 89, T.J. Watt 92, Lawrence Taylor 96. Ray Lewis,
Urlacher, Seau and Kuechly are untouched by any of it, because a vector they are
not rated on cannot move them. Legacy violations **16 → 2**, and both survivors
are unrelated to edge rushing: Larry Csonka wants more from `pow` at running
back, George Blanda more from `thp`.

Realism holds at its baseline — 1 of 44 outside, the same pre-existing
yards-per-completion. The engine fingerprint moved, `7cbe66ddb0bfd37c` →
`079635dc4406a02e`, which is correct and expected: this is the first change in
some time that reaches play resolution.

#### Three mistakes, since the method is the point

The pass rush was fitted against `syntheticTeam(..., 82, **2**, seed)`, copied
from the leverage script, while `npm run realism` builds its population at SD 4.
The split that preserved the level on one did not on the other; scoring went to
44.9 points and TD:FG out of band before the numbers were re-fitted on the right
population. Both agree on 0.67/0.33.

The rush gate read `edgeness` unconditionally, and `edgeness` correctly returns
0 for a lineman — so the first version discounted the entire defensive line to
the replacement floor, quietly taking three points off every pass rush in the
game. It was caught by two measurements of the same formula disagreeing, not by
reading the code.

And the blend's non-monotonicity above, which no test would have caught and
which was found only by asking whether the derived role could ever make a better
player cheaper.

#### One thing it turned up that was nothing to do with linebackers

Three seed-pinned tests broke on the reweight, and two were the usual thing — a
fixed seed asserting something the code never guaranteed, now searched rather
than pinned. The third was real. `makeOffers` has always refused to show the
user a vacancy at the club that just sacked him; that is the rule written up
under Coaching jobs, and the reason is that being handed your own job back makes
the sacking meaningless. `fillVacancies` never applied it to anybody else, so an
AI club could sack a coach and rehire him in the same offseason. It now prefers
anyone whose `lastClub` is not that club, and falls back only if he is genuinely
the last man available, because a coached club beats the principle.

Worth noting how it was found: not by reading `jobs.js`, which nobody had reason
to open, but because a rating change shifted which coach ranked highest and the
assertion that had been passing by luck stopped passing. Pinned seeds are a
nuisance most of the time and occasionally an instrument.

#### Not done

The defensive line has an interior-versus-edge spread — Freeney and Gastineau
are undersized speed rushers whose `rsd` drags them — and it is deliberately
left alone. *Looked at properly afterwards, and the reasoning above was wrong:
the line needs no role at all. See **Two attributes worth nothing** below. The
tradeoff is already expressed through `prs` feeding the rush and `rsd` feeding
run defence, and a lineman really does play both downs, so unlike the linebacker
there is no double-charge to undo.*

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
currency and the note says so, reading the table live: a running back was worth
9.39 against a quarterback's 15.89 when this was written, was 13.99 against
14.46 for a few hours on 2026-09-24, and is 5.44 against 16.13 since the run
game was measured against real carries.

The overall badge sits above the name rather than below it. With it below, a
name that wrapped to two lines pushed its badge a line clear of the other
player's, so the one pair of numbers most worth reading together did not line
up.

### Colour, focus and where you are (`scripts/smoke.mjs`)

Three things were left undone when the accessibility pass first went in, all
with the same excuse: nobody had measured them. Colour contrast had never been
checked, the auction had never been driven without a mouse, and the nav told a
screen reader nothing about which page you were on. Measuring each one found a
real defect, and in two cases the first instrument was wrong before the code
was.

**Contrast is measured on what renders, not on the palette.** Reading the tokens
off `:root` says which pairs are *possible*; it cannot say which appear, on what
background, at what size. So `checkContrast` walks every element holding visible
text on every screen the smoke test already visits, resolves the background by
compositing the ancestor chain, and applies the threshold WCAG gives for that
text's size — 3:1 for large, 4.5:1 otherwise. Five things came back:

| | was | now |
| --- | --- | --- |
| `.ovr.o90`, the badge on every player rated 90–94 | white on `#3a9d5a`, 3.41:1 | `#31854d`, 4.57:1 |
| `.muted` inside a gold primary button — the auction's "N sold" | 1.34:1 | dimmed ink, 5.26:1 |
| yard numbers on the field strip | white at 0.4 alpha, 3.81:1 | 0.55, 6.08:1 |
| end-zone label on a club colour | 3.56:1, no ink chosen at all | `textOn`, 4.53:1 worst |
| the newest play's flash | `.sit` at 3.10:1 under it | a ring, 4.97:1 |

The last one is the one worth reading twice. The play-by-play flashed the newest
row gold at `rgba(233,196,106,0.35)`, so the single play you are most likely to
be reading was the hardest to read for the moment it arrived. It flashes a ring
now, which is a stronger cue and costs the text nothing. While in there: the
flash had been left out of the `prefers-reduced-motion` block, so somebody who
had asked for less motion still got the newest play animating at them every
snap.

**`textOn` was wrong for everybody, not just the end zone.** The helper that
picks ink for a club colour weighted the raw 0–255 channels and switched at 150.
That is the usual shortcut and it is wrong near the boundary, because sRGB is
gamma-encoded and the channels mean nothing until they are linearised. It put
white on `#e63946` for 4.17:1 where black gives 4.53, and white on `#2a9d8f` for
3.32:1 where black gives 5.68 — on labels that name a team, everywhere a chip
appears. It now measures both inks and takes the better. One club colour could
not be saved by either, topping out at 4.46, and was darkened one per cent in
the data. All 48 clear AA; the worst is 4.54.

**Where you are is announced, not only highlighted.** All three nav renderers
now set `aria-current="page"` alongside the class, and the smoke test asserts
the two agree — exactly as many destinations announced as highlighted, and never
more than one.

**The room can be played with a keyboard**, and that is now pressed rather than
assumed. `checkKeyboard` tabs through the auction at the two moments a decision
is live, and asserts that tabbing reaches what a bid needs and that whatever
holds focus is visibly focused.

#### Both instruments were wrong before the code was

The contrast probe blended the first translucent layer it found against an
*assumed* page colour rather than compositing the chain, so it reported
backgrounds no rule in the stylesheet produces, and the hunt for the offending
element went after a colour that was never on screen. It composites properly now
and names the element that supplied the background, which identified
`li.penalty.latest` — two stacked yellows — immediately.

The keyboard probe called `.focus()` and asked whether anything changed.
`:focus-visible` matches on keyboard interaction, so a programmatic focus raises
no ring, and the check accused four perfectly good controls before anybody read
the stylesheet and found the global rule that had been there all along. It
presses Tab now.

And the verification for `textOn` imported `TEAMS` from `data/teams.js`, which
exports `AI_TEAMS`. The destructure quietly yielded `undefined`, a `|| []`
fallback swallowed it, and the check silently measured the 32 pro clubs while
reporting confidently on all of them. The sixteen fantasy clubs were never
looked at until a test file failed to import the same name. All three mistakes
are the same mistake: an instrument that returns a plausible number is not the
same as an instrument that is measuring the right thing.

Each check is mutation-tested: restoring the old badge green, dropping
`aria-current`, and removing the focus ring each fail smoke, on the intended
line.

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

### Ten seasons, read rather than asserted (`scripts/playthrough.mjs`)

Every suite in this repository asks a question it already knows the shape of.
`npm run playbook` asks whether a call is priced right, `npm run realism` asks
whether 44 numbers sit in their ranges, the 449 unit tests ask whether a
function keeps its contract. None of them asks the open question: play this
thing for ten years and does the *story* come out right. That is a different
kind of check, and it is the only one that catches a defect nobody thought to
write an assertion for.

So `scripts/playthrough.mjs` plays a ten-season pro dynasty and prints what
happened. It does carry invariants — rosters legal and full at every position,
nobody on two clubs, no retired player in a lineup, no NaN in any rating or
stat, a complete history entry and a named MVP per season — and all of them
held, at every seed tried. The invariants found nothing. Reading the output
found two things.

**Running backs were winning the MVP.** Pooled over twenty-nine seasons at three
seeds: fourteen backs to five quarterbacks, with the rest going to linemen,
receivers and tight ends. That is not a close call in the wrong direction, it is
the wrong sport. The cause and the fix are under
Awards above; what matters here is that no test could have caught it. There is
no contract being broken — `mvpOf` returns the highest weighted z-score, which
is exactly what it promises, and it promised it correctly for every one of
those twelve seasons. The defect only exists in aggregate, over a population
of seasons, against a fact about the real league that lives outside the code.

**Generated rookies were beating the best players who ever lived.** A fictional
punter finished a career at 97 with Ray Guy in the same league at 94. Same
story at linebacker and safety. Again no contract was broken: `ceilingFor`
clamped at 96 and returned a number under 96. The bug is that 96 was a single
number standing in for eleven different ones. Fix under Player careers above.

Fixing the second one found a third, which is the part worth keeping. The
obvious repair — cap the ceiling per position — was applied, the playthrough
re-run, and nothing exceeded its position's best any more. That looked like
done. Probing it instead of believing it, by walking 112,000 career-seasons and
counting how many finished above their own stored ceiling, returned 4,993. The
per-position cap was correct and a second, older bug in the injury path had been
breaking the same rule the whole time; the playthrough had not shown it because
a knocked player rarely ends up the best man at his position, so the symptom the
report prints was the wrong symptom to watch. Details under Player careers
above. The rule: a fix confirmed by the same instrument that found the bug is
not confirmed, because that instrument only ever looked at one symptom.

The first two defects share a shape worth naming, because it predicts where the
next one will be. Each is a *constant that was right when it was written and went
stale when something else moved* — the MVP exponent was fitted before running
backs got their leverage raised, the flat ceiling was chosen before the pool
grew to 1,500 and re-rated. Neither module changed. Neither has a test that
could fail. The only instrument that sees this class of defect is playing the
game and looking at the result, which is why this script exists and why it
prints a readable season summary rather than a pass/fail.

What it does not do: it plays passively, so it exercises the simulation and
the offseason but never the auction, trades, or any decision a human makes.
A passive dynasty is the cheap half of the space. The expensive half — does
the game reward playing it well — is what `npm run strategy` and the season
card comparison measure instead, and neither is a substitute for the other.

## UI

Vanilla ES modules, hash router, one persisted state object (`store.js`). Views re-render from state; the live game view manages its own DOM and autoplay timer. Everything is relative-path so it deploys to a GitHub Pages subpath. Service worker: network-first for HTML, cache-first for assets (bump `CACHE` in `sw.js` on every release or installed clients keep the old CSS). The precache list is explicit, and three modules shipped without being on it — team statistics, the side-by-side comparison and the contract-length prices. Online that is invisible, since a missing module is fetched and cached on first use; offline, the first launch after an update fails, because activation deletes the old cache and the module was never in the new one. `tests/precache.test.js` now walks the import graph from `main.js` and fails on any module the list does not carry, and on any entry that no longer exists, since `cache.addAll` is all or nothing and one 404 leaves the old app installed for good.

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

### The auction room, out loud

**The room was played in silence, and the check for that passed.** The auction is the one screen in this game where the state changes under you: lots go up while the room runs itself, a price moves, and the thing you are being asked about is replaced every few seconds. A sighted player reads that off the panel. A screen-reader user was told none of it.

What was announced, through the toast `placeBid` raises, was the *result*: "You bought Jerry Rice for $31", "ORC took Tom Brady for $27". Both come after the fact, and only for lots the human was part of. What was never said is the part a bidder needs before deciding — who is on the block, what he costs, and whose turn it is to nominate.

**Why a session of accessibility work walked straight past it.** `checkA11y` asserts that the live region exists and is not muted, and a live region nobody ever writes to passes that perfectly. The room was visited by every probe — contrast and a11y on six auction states, keyboard on two — and every one of them came back clean, because none of them listened.

`say()` now announces the two moments the room stops and waits for you: a lot going up (name, position, overall, asking price, who nominated), and your turn to nominate. Not every sale. A full auction sells two hundred-odd lots, mostly while the room runs itself, and `aria-live="polite"` queues rather than drops — announcing all of them is minutes of backlog for something the ticker already carries. What you have left to spend goes on the end only when it has moved, because it moves when you win a lot and that is announced on its own.

**One thing measured and found not to be true.** The first reading said focus was dropped to `<body>` on every action, which would mean a keyboard user is thrown to the top of the page on every bid. It is not: the probe was pressing controls that legitimately destroy themselves — committing a maximum closes the lot, so of course the button is gone. Measured against a control that must survive its own action, the bid slider nudged with an arrow key, focus is kept 6 times out of 6. There is no focus bug.

**Three tries to get the guard right, and the third is the one that counts.** The first version of the probe asked whether the player's name was ever said during the auction. It can never fail: the sale is announced too and names the same man, so once the lot is over the question answers itself. It now snapshots what had been said *at the moment the lot stood*, which is the property — you are told who you are bidding on before you bid, not after.

The second problem was that it had nothing to work with. Smoke's auction walk broke the instant a control was missing, which ended it after a single lot, so every check ran on one sample. Waiting for the room to call the next lot takes it to twenty-one or twenty-two, and the checks have something to fail on.

Four mutations, all four now caught: silencing the room, reading the purse out on every lot, announcing the lot without naming the player, and breaking the once-per-lot key so it speaks once and never again. Before the fix all four passed.

**And the same mistake inside the feature.** Saying a thing "once" in this view is harder than it looks, because the store re-mounts it on every change and again on the lot timer, and `mount` runs a view's teardown before each re-mount as well as on the way out. Guarding on the text was tried and announced a lot twice whenever its sentence shortened; clearing the memory from the teardown was tried and cleared it several times a second, which is how the purse came to be read out on every single lot after being written to say it only when it moves. The key is the lot.

Not built: announcing the room's own sales as they happen, for the volume reason above; and the sale toast reads its club as an abbreviation, so a screen reader says "eff zed tee took John Hannah" — fixing that means either changing text the toast shows visually or announcing a second, longer version of the same event, and neither is clearly right.

### Reading order is DOM order

A two-column `.grid-2` collapses to one column under 820px, so on a phone the **whole** first column renders before the **whole** second. That is easy to forget and it quietly broke the season hub: a 32-club league lists sixteen matchups, and with the slate, the table and the full schedule filling the first column, every decision on the screen — trade offers with a deadline, injured players, the owner's patience, the simulate-ahead buttons — sat below them. The app had started apologising for its own layout with a toast reading "2 clubs have trade offers for you", because the card saying so was off-screen.

The columns are therefore split by **purpose, not by size**: what you act on first (playoff bracket, roster moves, injuries, the weekly pulse, the owner, simulating ahead), what you read second (the week's slate, standings, leaders, power rankings, the full schedule, history). A slate of more than six games folds into a `<details>`, since it is reference rather than a decision and your own game already has its own card at the top.

The smoke test asserts the ordering rather than trusting it, by reading the rendered card headings and checking the actionable ones come first.

### A form nobody reaches the bottom of

Setup had grown to fourteen sections, five of them added in one run of feature work, each with a paragraph of explanation. On a phone the first screen ended in the middle of naming your club. The options with sensible defaults — injuries, keepers, ageing, chemistry, scouting, coach mode — now sit behind one **More options** fold, and the prose above it was cut to what you need to choose with rather than everything true about the choice.

Measured at 360×780, the Create league button moved from roughly four screens down to **1.6**. The smoke test prints that number every run and fails past 2.6, because this is the kind of thing that creeps back one paragraph at a time.

## Keeping this document honest

Every number in this file was measured once. Nothing re-measured them, and the
engine has moved underneath them continuously — so the question "which of these
are still true?" had never been asked. It has now been, by re-running every
script in `scripts/` against the engine as it stands and comparing what each one
prints with what this document and the source constants claim.

The headline is reassuring and the detail is not. **Every conclusion in this
document survived. Several of the numbers underneath them did not.**

**What had gone stale.**

- `EP_PER_YARD` was refitted from 0.0539 to 0.0528 and three passages went on
  quoting the old value, one of them carrying a worked calculation built on it.
  The document contradicted itself: another section recorded the refit correctly.
- `scripts/turnover-price.mjs` printed "the model's own `EP_PER_YARD` is 0.0539"
  as a literal rather than importing it. A measuring tool disagreeing with the
  thing it measures against is worse than a stale paragraph, because it will
  keep producing stale paragraphs. It imports the constant now.
- The injury table's two right-hand columns were out by about a factor of two —
  0.3 / 0.7 / 1.2 players out per club-week against a measured 0.14 / 0.34 /
  0.73. The injury model itself had not moved at all; the left-hand columns
  re-measure exactly. What changed is downstream, injured reserve and the waiver
  wire getting better at refilling a hole.
- The auction's own justification was understated. "A win and a half (7.4 to
  5.9)" is now 8.6 to 5.9, nearly three wins. *Later: neither was a finding.
  Both were twelve-league samples, which move half a win on a reshuffled random
  stream; 48 leagues put the gap at about two wins, and the audit now checks
  roster spread instead — see **The auction**.*
- Waiver activity, trade acceptance, the budget-spread table and the ageing
  drift had all drifted by small amounts.

**The one that mattered turned out to be the instrument, after three tries.**
The yardstick table — how well `overall` predicts what a player produces —
appeared to have fallen at cornerback, from r = 0.926 to 0.818, and the audit
blamed this repo's two-authority problem: a change made to satisfy
`attribute-leverage` moving a number the yardstick owns. That was written up
confidently and was wrong. Testing the weights directly showed the pre-change
vector was *worse*, 0.807. Running the old engine showed 0.926 was never
reproducible at any sample size. And running the old engine at all required
first finding that both yardstick scripts hardcoded an absolute path and had
been importing the live tree throughout.

The real answer was underneath all three: **the harness scored every man by the
points his own team put up**, which is most of a quarterback and almost none of
a corner. Scored on the differential, a corner reads 0.972 and is the second
best predicted position in the game. There was never a weakness — see **The
instrument was blind to half the team** above, and the eleven-position table
that came out of it.

**A finding about sampling rather than the engine.** The line's entry swings
from r = 0.770 at 160 games to 0.962 at 400 on the old measure, and 0.844 to
0.910 on the new one. The documented 0.901 was a coin landing in the middle of
its own noise, quoted to three decimals. The document had even guessed the cause
correctly — "mostly the narrow points range" — and then kept quoting the number
anyway. The line is still the least stable row in the table, and `npm run audit`
now carries that instability as its tolerance rather than pretending to three
decimals of precision.

**And one finding that was my own error, which is worth recording because the
mistake is the instructive part.** I reported that the price of a giveaway had
moved from 58 yards to 43, and repriced `playbook-equilibrium.mjs` on the
strength of it. It had not moved. `npm run turnover` leads with a pooled figure
across the whole down tree — 43 — and then prints a by-situation table
underneath, where first and ten from the 25 reads 58. The grid takes every snap
at first and ten from the 25. This document already said so, in terms: "so 58 is
the figure it needs — not the pooled 43 and certainly not 40." I read the
headline instead of the row, in the middle of an exercise whose entire purpose
was checking numbers carefully. Both changes are reverted, and the script now
says in its own comments which row it wants.

**And now there is a standing check.** `npm run audit` registers the
load-bearing numbers against the scripts that produce them, so drift is reported
rather than stumbled on. Thirteen entries, and each is a three-way comparison
rather than a two-way one:

- **the engine** — what the script prints now, or what the module exports;
- **the registry** — what `scripts/audit.mjs` expects, the last agreed answer;
- **the document** — what DESIGN.md tells a reader, pulled out by a regex
  anchored on the passage that carries it.

Comparing all three is the point, and it is what makes the check worth having.
Engine against registry catches the simulation moving. Document against registry
catches prose going stale, or somebody editing prose without re-measuring. A
check comparing only the first two would have passed contentedly through the
whole period in which this file said 0.0539.

Two entries exist purely because of what the audit found. One asserts that the
expected-points *fit* still lands on the `EP_PER_YARD` the engine ships, because
the constant is a cached measurement and the refit is what came apart from it.
The other holds the corner's yardstick correlation, which is the number that
moved because a different measurement was acted on.

`--quick` runs only the checks that cost nothing — reading a module, reading the
file — which is a couple of seconds and still catches a constant drifting away
from the paragraph quoting it. The full run takes about twenty minutes because
it re-runs most of `scripts/`, and naming words on the command line
(`npm run audit -- turnover yardstick`) narrows it.

Four mutations, all four caught: moving the engine's constant, editing the
document without re-measuring, changing a script's output format so the check
silently stops checking anything, and a registry expectation nobody re-measured.
A fifth was attempted and turned out to be a no-op — the string I tried to break
is built by interpolation and the literal I edited was never there — which is
the same class of mistake as reading a pooled headline for a situational row,
made twice in one day.

**The check found its own blind spot, once.** `scripts/yardstick.mjs` and
`scripts/yardstick-fit.mjs` both opened with `const R =
'/home/user/Football-Manager-Simulator'` — the absolute path of one particular
checkout — and imported the engine, the weights and the player pool through it.
A copy of either script running anywhere else therefore measured *that* tree and
reported the answer as its own, silently, with no error and no warning.

It cost a whole experiment. Checking the corner's old correlation meant checking
out a 59-commit-old worktree and re-running the harness there, and four runs
came back agreeing with today's engine to three decimal places — which is what
"the engine has not moved this in a year" looks like, and is also exactly what
"you are running today's engine" looks like. The tell was that the fingerprints
differed while the yardstick numbers did not, and the proof was a marker line
added to the worktree's engine that never printed.

Both scripts resolve their root from `import.meta.url` now, and `npm run audit`
carries a free check that fails if any script in `scripts/` hardcodes a path
under `/home`, `/Users` or `/root`. The whole point of the two yardstick scripts
is to say whether a number is real; a measuring tool that reports on somebody
else's checkout is worse than no measuring tool, because it is confident.

**What it is not.** Thirteen numbers out of the several hundred in this file. It
covers the ones a decision rests on and leaves the rest to the next person who
goes looking. A failing check is also not automatically a bug: a number moving
because the engine was deliberately changed is the system working, and the
answer then is to re-measure, update the prose and update the expectation in the
same commit. What it exists to prevent is a number moving and nobody knowing.

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

9. **Save slots and shareable leagues.** *Shipped; see Save slots and sharing above.* Evidence at the time: `store.js` holds one league under one localStorage key; a second league overwrites the first, and export/import is the only backup. Because every game is seeded, a league is reproducible from its seed and pick history, so a short share code could rebuild a league on another device and a roster card could be rendered to an image for sharing. Touches `store.js`, settings view, a canvas renderer. Risk: the players file must stay byte-identical for codes to replay; version the code with the data file's hash. *That risk landed and has since been removed — see **A code that outlives the pool**.*

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
