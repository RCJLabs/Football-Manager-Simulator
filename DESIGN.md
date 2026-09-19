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

**How it was verified.** The engine is seeded, so the same rosters and seed must produce the same game down to the last word of play-by-play — which makes a hash of the output a far stronger check than the test suite, because a test asserts the properties somebody thought of and a fingerprint asserts everything. `scripts/game-fingerprint.mjs` (`npm run fingerprint`) simulates 232 games across the paths that diverge — five roster gaps, penalties off, every injury rate, neutral sites, playoff rules, chemistry, and twelve coach-mode games driving `step()` by hand — and prints one hash over 43,269 log lines, plus a per-game hash so a divergence names itself. Before and after the split: `a9480bd47f40cac9`, identical.

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
strategies, on the current 1,269-player pool with the 27-slot roster, injuries
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

The auction's mispricing was the most interesting thing in the game and it was documented here and nowhere in the product. A first-time manager faced $200 over 1,269 names with no way to know a kicker is worth a fortieth of a quarterback, and the only way to find out was to lose a season to it.

It is positional, never per player. Showing what an individual is worth would hand over the answer and delete the auction; showing that the room overpays for running backs is a strategy you still have to execute under a budget, against nine other bidders, with the best names gone by the time you commit. There is no per-player worth figure anywhere on screen.

Everything is derived from `positionValue()` at render time rather than written into the view, so retuning a leverage number moves the panel with it and it cannot quietly start teaching something the simulation no longer does. A test asserts the derivation against the tables directly for exactly that reason.

It appears as a collapsed panel in the auction room and the draft room — closed by default, with the one-sentence version in the summary, because both screens are busy and the reader is mid-decision — and as a standalone page at `#/guide`, linked from the home screen so somebody can read it before they have a league to ruin, and from settings for later.

The page also carries the three things the table cannot show: that bench slots are insurance rather than luxury, that a rating is not a career now that players age, and that chemistry is worth about two home-field edges. Not built: any live per-position read of the market as the auction runs, which would be more useful and is also much closer to simply giving the answer away.

## Draft AI (`draft.js`)

Value over replacement: for each position, the replacement level is the overall of the Nth-best available player where N is the league's remaining demand at that position. Pick = highest (overall − replacement) × positional impact multiplier (QB 2.6, CB 1.1, RB/WR 1.0, DL 0.9 … K 0.5, P 0.35, mirroring measured sim leverage) × GM personality weights (+ era bias for Old School / Analytics) + noise. Kickers and punters are held until the last three rounds unless forced. A slot-count guard guarantees every roster fills.

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

## Transactions (`transactions.js`)

Rosters are exactly 27 slots, so every in-season move is a swap and no separate bench-management screen is needed (the one exception is a slot left open by an older save, which a claim can fill outright). Three kinds of move exist, all from the Moves screen during the regular season.

**Waiver claims.** A claim names the free agent coming in and the player going out at the same position; each club may hold two claims a week. Claims resolve when the week advances, in waiver order: in a fantasy league the order starts as the reverse of the draft order and a successful claim sends that club to the back, in the pro league it is reverse standings every week. AI clubs file their claims at the same moment, so the human never gets first pick of the pool for free. An AI club claims only when the newcomer is at least two overall points better than the man he replaces and the swap adds at least six points of lineup strength; how often a club bothers to look at the wire at all is a per-personality activity rate (Analytics 90%, Old School 30%).

**Trades.** Up to three players a side, and the position sets on both sides must match exactly, so the roster template is preserved without any roster-size rules. The trade deadline is 65% of the way through the schedule (week 10 of 14, week 12 of 17). An AI club judges an offer by one yardstick, *lineup strength*: every player's overall weighted by his position's true leverage from the auction, starters at full weight and bench players at a quarter. It accepts when its own strength rises by at least its greed margin (Analytics 8, Trenches 6, Old School and Defense 5, most others 4, Gambler 2) and tells you roughly how far short an offer fell.

**The log.** Every claim and every deal is recorded with week and season, and the Log tab shows all of them, so any lopsided outcome can be traced.

Injuries feed the same yardstick: a player on the ledger counts for the share of the remaining season he will play, so an AI club will not take your hurt star at full value, will not give up a healthy starter for one, and goes to the wire itself when a starter is done for the year. It keeps a hurt player who will be back this season unless the pickup is better anyway, and it never claims a man who cannot play.

**Offers.** The market runs the other way too. When the week advances, AI clubs look at the human's roster for the same surplus-for-need shape and ring with a two-for-two: what they are deep in for what they are thin in. A club calls only when the deal clears its own greed *and* is no worse than two points below even for the human on the same yardstick, because a general manager knows an insulting offer is a wasted call. Offers stand for the week and expire; declining one takes that exact deal off the table for the season, so the phone does not become a nuisance. How often a club bothers is the same per-personality activity rate the wire uses.

Measured over twenty 8-team seasons (`scripts/offer-sim.mjs`): 4.3 offers a season, one in roughly a quarter of weeks, and 40 of 85 of them improved the human's lineup on the yardstick, the rest costing a little. That is the shape the gate is meant to produce: about half the calls are worth taking, so reading one is a decision rather than a formality. The same caveat as every trade applies, and it is the reason the screen quotes the number rather than a verdict: the yardstick is built on overall ratings, so an offer that reads as even may still be bad in the simulation.

Measured on the 8-team auction league (`scripts/moves-sim.mjs`, 12 seasons, injuries off): AI clubs land about three claims a season between them, worth about +7 lineup strength per club, because the pool left after an auction is the talent tail and few swaps clear the +2 overall bar. With injuries at the default setting the same clubs file about seven a season, most of them cover for a starter lost for the year: the wire is an injury market first. On 4,000 random one-for-one offers the AI accepted 25%, and on every accepted deal the human had given up the higher-rated player; the AI gained +13 on average and the human lost 15. That is the intended shape: an AI club cannot be talked into a bad trade on its own yardstick. What it does not rule out, and what has not been measured, is a trade that is even on the overall-based yardstick but not in the simulation, for instance a receiver whose overall is carried by an attribute the play resolution weights lightly. The yardstick would need to move from overall to composite contributions to close that, which the auction pricing already knows how to do.

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

**The market.** The auction reopens with each club's leftover cap and the worst club nominating first; the price guide re-prices the thinner pool and the smaller pot on its own. A draft league drafts worst to first in snake order, and the pointer skips clubs whose rosters are already full, so a club that kept 18 sits out the last nine rounds. Either way the existing auction and draft screens run the market, and the season starts from their finish button. The hub's history card keeps every season's champion and your own finish.

**AI keepers.** A club ranks its eligible players by surplus: what the fresh price guide says the player would fetch (true value for a savvy GM, reputation for the rest, through the GM's positional taste) times a bird-in-hand premium of 15%, minus the keeper cost. It keeps the best bargains that fit under the cap. The premium is there because an auction is a risk and a known price is not; without it a club kept fewer than two players a year, because a fair-price buy plus a raise is by definition slightly over market.

Measured across six 8-team auction leagues run four seasons each (`scripts/dynasty-sim.mjs`, AI keepers for the human too): clubs keep 5.0 of 6 on average, committing about $47 of $200, and the players they keep average 90 overall, which is to say keepers are the stars bought under market. About a third of a roster carries over season to season once re-buys are counted, so a league has continuity without freezing. With the $5 minimum raise that most keeper leagues use, the same clubs kept 2.4, because a 27-man roster is mostly $1 to $4 players and a $5 bump prices every one of them out; the lower floor is what makes late bargains worth keeping.

**Rookies and ageing.** Each offseason opens with a generated intake and a year on every career (both below), so the pool a league plays with grows and changes rather than only churning. That is also what makes a keeper's third year a different player from his first.

Simplifications, all deliberate: no separate rookie draft (the intake enters the same market as everyone else), no pick cost for draft-league keepers, and no contract lengths beyond the keep count. Speculation: whether the 15% raise is steep enough to stop a club sitting on a $10 quarterback for three years. It is not measured; the three-year limit is the backstop, and ageing now does some of the work the raise was doing alone.

## Generated rookie classes (`rookies.js`, `data/rookie-names.js`)

Every offseason a new intake enters the pool: invented names, ratings spread the way a draft class is spread, and a wash-out rule so a long dynasty does not drown in players nobody wants.

**Where they live.** On the league, in `league.rookies`, not in the shipped player file. Two leagues never see each other's players, and `src/data/players.js` keeps the fingerprint that league codes and season cards check, so a rookie class does not stop a code opening. `leaguePool(league, players)` and `leagueIndex(league, byId)` build the pool in play; both are idempotent (they strip generated entries from the base first), so calling them on an already-merged pool is safe. `main.js` holds the merged pool behind a getter keyed on the `league.rookies` array identity, so opening a different slot swaps the pool without anyone asking it to. `addRookieClass` replaces that array rather than pushing to it, which is what makes the identity check work.

**Size and names.** Three and a half per club, at least sixteen: 28 in an eight-club league, 42 in a twelve, 112 in the pro league. Positions come out in roster proportions, so every group gets somebody. Names are drawn from 440 first names and 780 last names, 343,200 combinations, and a name already in the league is re-rolled up to eight times. The lists are append-only for the same reason the fictional-name lists are: reordering them renames players in saved leagues.

**How good they are.** A single power law cannot give a class both a replacement-level body and a few genuine prospects — it either drowns the league in stars or leaves nobody worth a bid. So a rookie's target is `normal(62, 6.5)` plus, 7% of the time, `|normal(16, 7)|` on top, clamped to 40–99. Measured over 200,000 rolls: median 63, 17.3% at 70 or better, 3.3% at 80 or better, 0.8% at 90 or better, 3.5% at 50 or worse. Each attribute then scatters `normal(0, 6)` around that target, so classes contain lopsided players — a fast receiver who drops the ball, a mauler who cannot pass protect — rather than smooth ones.

**What that means in practice, and it depends on league size.** A club rosters 27, so eight clubs need 216 of 1,269 shipped players and the last man in is an 88 overall; twelve clubs need 324 and the cutoff is 86; the pro league's 32 clubs need 864 and the cutoff is 75. A 63-median class is therefore mostly irrelevant in a small fantasy league and genuinely useful in the pro league, where a 78 rookie beats what is left on the wire. That is the honest behaviour and it is what the tests assert: signed rookies average eight or more overall above their class mean, rather than every class producing a starter. Inflating the ratings to make small leagues care would break the pro league, which is the mode the intake exists for.

**Washing out.** A generated player nobody has rostered, from a class older than three seasons, leaves the league; a rostered one stays however old his class is. Without this the free-agent list in a twenty-season pro dynasty carries a couple of thousand names nobody will ever sign. Ids are `rk-<seed36>-<season>-<index>`, derived from the league seed, so the same league regenerated from the same seed produces the same class.

**In the interface.** Generated players carry a `rookie` badge and read "class of 2029" in lists and modals, and the players screen computes its era tabs from the pool in play rather than the shipped constant, so new classes get their own decade tab. Season cards and league codes both filter generated players out of the pool fingerprint; a league code rebuilds `league.rookies` from the snapshot and maps rosters through it, so a shared league arrives with its rookies intact.

Not built: aging, development, or a separate rookie draft. A rookie is a player like any other from the moment he lands, and he is exactly as good at 40 as at 22, because nothing in this simulation knows what age is.

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

Everything in this game was arithmetic. Every rating of all 1,269 players was exact and permanent, so once you had internalised the leverage table you won auctions forever and the economy stopped being a puzzle. Real general-manager games run on fog.

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

Every step of a game leaves a win probability on the event it produced, computed once the state has settled (possession changes included), so a saved log carries the whole curve. The model is a normal one fitted to this simulation rather than the real league: the final margin is the current margin, plus what the possession in hand is worth (expected points from field position, down and distance), plus what the stronger roster and the home crowd still expect to add over the time left, with a spread that shrinks with the clock. Fitted on synthetic games with penalties on: final margins spread about 12.5 points between equal rosters, a point of team power is worth about 3.3 points of margin (measured by moving a synthetic roster's mean rating), and the home edge is about two points. A calibration test bins predictions and checks the home side really won about that often in each bin.

The live screen shows the current probability in the scoreboard and a filled band over the game with quarter markers, the home side's colour above the 50% line and the away side's below; a drive chart (one row per drive on a 100-yard field, scoring drives in full colour) folds out beneath it. When the game ends a story card gives the result, the three plays that moved the probability most, each side's stars from the box score, and the injuries. Box scores of games that kept their log (your games) show the same charts and story. Charts are inline SVG scaled to the card, so they are as legible on a phone as on a desktop. Not built: a highlight reel or animated field; the drive chart is the highlight reel.

## Awards, records and the hall of fame (`awards.js`)

The final closes the books. Every player with a stat line is scored against his own position first: how many standard deviations above the league's starters at that position (players with at least half the season) he finished, on fantasy points, with punters rated on placement and distance and linemen, who keep no statistics, left out. The MVP is the best of those z-scores weighted by positional leverage to the power 0.35, so a quarterback still wins most years, as one does in the real league, while a back or receiver with a truly outlying season can beat him. Offensive and defensive players of the year are the best z-scores on their side of the ball, the kicker award goes on points, and coach of the year to the club that finished furthest above its roster's power rank. An all-league team takes the top scorers at each position in starter numbers, and the season leaders are recorded in eleven categories. The awards screen shows the same race mid-season, so the MVP argument runs all year.

The record book keeps season marks (twelve player categories), single-game marks from the games that kept player lines (yours and the playoffs; AI regular-season box scores hold team totals only), and team marks: points and margin in a game, points and wins in a season. Each entry names the holder, the club, the season and, for games, the opponent; a mark is replaced only when beaten.

Careers accumulate per player across seasons: games, totals, honours, statistical titles and rings (every member of the champion's roster gets one). The hall of fame is a résumé score: a point a season, four for an MVP, two for a player-of-the-year award or a title, one and a half per all-league selection, half per statistical title, and a point per 300 fantasy points; induction at 12 with at least three seasons. That is deliberately reachable in a short dynasty and deliberately not reachable by longevity alone. Established: the scoring above. Speculation: whether the leverage exponent lets non-quarterbacks win often enough; it has not been measured over many seasons.

## AI general managers (`gm.js`)

Three things an AI club does that a preset never did.

**A game plan.** At kickoff each AI side reads the matchup from the two clubs' composites and adjusts its sliders for this game only: quick throws and screens when the other rush beats its line, more runs at a soft front, more passing when its quarterback beats their coverage, deep shots at a slow secondary; on defence, pressure at a weak line (and a heavy blitz at a replacement-level fill-in), a stacked box against a strong run game, a shell over a great passer. The human's sliders are the human's own; the matchup card tells you what the other side plans, which is the invitation to answer it.

### The league is too even for tactics to matter

This is the finding the whole strategy investigation kept running into, and it explains every flat measurement in the section below. Across four seeds:

| league | best roster to worst | sd |
| --- | --- | --- |
| 8-club snake | **0.78 power** | 0.23 |
| 8-club auction | 1.35 | 0.42 |
| 12-club auction | 1.45 | 0.41 |
| 32-club pro snake | 2.50 | 0.64 |

For scale: home advantage is 1.1 composite points and chemistry swings 1.8. **In an eight-club snake league the gap between the best and worst roster is smaller than home-field advantage.** That is not a bug in any one system, it is what an eight-club league drafting 208 of 1,269 all-time greats produces, with the snake order deliberately equalising on top.

Everything tactical is measured against that number, and it is why so little of it registers. The AI game plan needs composite gaps over 5 and 8 points to fire, so it fires in 16 of 1,500 even matchups. The pass/run read is worth 6.4 points a game across rosters built to order and +0.98 on the ones the draft actually produces. Tempo is a genuinely strong lever — +3.81 ± 0.65 for a club six power points better than its opponent — and gets no read at all, because no club here is ever six points better than anyone.

Whether to change it is a real design question and not a small one: parity is defensible for a fantasy game, and the alternatives (a thinner pool per league, scarcer talent at the top, deeper rosters so depth tells) all change how the game feels. It is recorded here because any future tactical feature will measure as noise until it is answered.

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

The conclusion is that `chooseDefense` already adjusts for down, distance, score and clock, and the slider is a small global bias on top of logic that is doing the real work. The retune was reverted in full; the game fingerprint is unchanged at `a9480bd47f40cac9`. `scripts/defense-tune.mjs` is the harness, kept so the next person does not have to rediscover any of it. A note on method: the first three rounds of that tuning were run against game margin, which carries a standard deviation of 13 points and leaves ±0.55 at 500 games — wider than the effect being tuned. They were three rounds of chasing noise. Points and yards allowed, taken paired and per play, land inside ±0.1 and are what the harness reports.

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

Depth charts were already revisited after every waiver claim and trade. Not built: AI clubs proposing trades to the human (the position-matching rule leaves few deals that are good for both sides and worth the interruption) and any memory of a specific opponent beyond the ratings.

## Save slots and sharing (`slots.js`, `share.js`)

Several leagues live in one browser. A registry lists the slots and which one is open; each slot's league and in-progress game sit under their own key, and preferences are shared. A save from before slots existed becomes slot one on first load. Creating a league while one is open puts the new one in a new slot, an import goes into a new slot, and deleting the open league opens the most recent other one. The home screen lists the slots with a size, because browser storage is a few megabytes and a 32-club season with box scores is a real fraction of that; the list warns past about 3.5 MB.

**A save that cannot be written says so.** Measuring the box-score trade-off showed how close the ceiling is: a 32-club pro save is about 2.4 MB against an origin allowance of roughly 5 MB, so a second pro dynasty in the same browser is already at the edge. `store.js` used to catch a failed write into a `console.warn`, which meant the game carried on accepting moves it was no longer recording and threw the session away at the next reload — a save system failing silently is worse than one failing loudly. It now keeps the failure on `saveError()`, distinguishes running out of room (`QuotaExceededError`, and the older Firefox and Safari spellings of it) from any other refusal, and notifies the screens — but only when the answer changes, since `saveNow` runs behind a 250 ms debounce on every move and re-rendering each time would pull the view out from under the player. `main.js` renders a red band above every view that stays until saving works again. It points at exporting, which still works with storage full because it reads the league out of memory, and at deleting a finished league. A refused write does not corrupt what is already stored: a browser rejects an oversized `setItem` without replacing the old value, and `writeSlot` writes the slot before the registry, so a failure stops before the registry can be moved on to describe a league that was never written.

A **league code** is a pasteable snapshot: every club's roster as pool indices, contracts, settings, the seed and the season number, deflated where the browser has `CompressionStream` and base64url-encoded, a few kilobytes for a 32-club league. It carries no results, logs or history; a friend who opens it gets the same league at the start of the same season with records at zero. The code holds a fingerprint of the player pool (count plus a hash of the ids) and refuses to open against a different one, since indices would point at the wrong men. A **roster card** draws the starters, overalls and record to a canvas and goes through the Web Share API on a phone or downloads as a PNG.

Not built: the roadmap's replayable share code. Games are seeded, but coach-mode calls, slider changes, claims, trades and keeper choices are not recorded, so a league is not reproducible from its seed; the snapshot is the honest version of the idea.

## Rating tooling and names (`data/tuning.js`, `data/names.js`)

**The rating editor.** Turned on in settings, every player modal shows his attributes as inputs. An edit applies everywhere at once (the overall cache is dropped for that player) and lives in preferences as a diff, `{ id: { attr: value } }`, applied to the pool at boot. Settings exports the diff as a file that names each player, the shipped value and the new one, with a fingerprint of the pool it was made against; `scripts/apply-overrides.mjs <file>` prints what would change and `--write` bakes it into the data file, after which `npm run validate` and the curve are the guard rails. Edits made in a browser stay in that browser; the file is how they travel.

**Era balance.** `npm run report` prints, per era, the count, mean overall and share of the top 100, per position. The players screen carries the same table. The pool leans modern in count (342 from the 2010s against 32 from the 1950s) and older in rating (the 1960s average 82, the 2010s 76), which is the talent tail doing its job: the modern depth players are the tail. The top 100 is spread 2/3/5/9/9/15/20/19/18 from the 1940s to the 2020s, which is the fairer measure of who runs a league.

**Fictional names.** A settings toggle swaps every real name for a made-up one, one to one, chosen from the hash of the player's id and settled in pool order so it never changes between sessions or versions as long as the name lists only grow at the end and the pool stays append-only. Ids, ratings, saves and league codes are untouched; the real name is kept on the player so the switch reverses. Logs and records keep the names they were written with. Team abbreviations in the pool (the club a player's prime season was with) are left as they are. `applyNameMode` runs at boot from the preference, so a store build can default it to `fictional` by changing one line in `main.js`; the real names still ship in the data file either way, which is a licensing question this toggle does not settle, only sidesteps on screen.

## UI

Vanilla ES modules, hash router, one persisted state object (`store.js`). Views re-render from state; the live game view manages its own DOM and autoplay timer. Everything is relative-path so it deploys to a GitHub Pages subpath. Service worker: network-first for HTML, cache-first for assets (bump `CACHE` in `sw.js` on every release or installed clients keep the old CSS).

Layout is phone-first and the page must never scroll sideways. Two rules keep it that way:

1. Any grid or flex child that can contain a scroller gets `min-width: 0`. Without it a wide table inside a grid cell refuses to shrink below its content and pushes the whole page wider than the viewport — this was the original mobile bug.
2. Player lists are not tables. `playerItem()` in `ui/components.js` renders a `.prow` grid that stacks name, meta and ratings on a phone and spreads into rating / name / attributes / action columns from 860px. Tables are reserved for standings and box scores, where they sit in a `.table-wrap` scroller and drop low-value columns under 560px via `.hide-sm`.

`teamChip(team, { responsive: true })` renders the abbreviation on a phone and the full club name from 560px, so scoreboards and matchup rows stay legible instead of ellipsised. The smoke test asserts no horizontal overflow on every screen at 360, 768 and 1280px and names the offending element when it finds one.

3. A screen re-rendered by a state change keeps its scroll position. `mount()` in `main.js` compares the view and its route params against the last mount and only jumps to the top when the screen actually changed. Every state change re-renders the open view through the same path a route change takes, so before this, moving one player down the depth chart threw you back to the top of a page four and a half screens long.

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
