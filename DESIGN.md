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

Measured over twenty-four 8-team leagues with the human team following fixed
strategies, on the current 1,269-player pool with the 27-slot roster, injuries
at the default setting and penalties on:

| Strategy | Wins of 14 | Point differential | Average finish of 8 | Titles of 24 |
|---|---|---|---|---|
| Value shopper (bid 1.15× true worth) | 7.7 | +21 | 3.5 | 6 |
| Stars and scrubs (2.4× asking for anyone rated 93+, $1 for the rest) | 6.8 | −6 | 5.0 | 1 |
| Skill players first (1.5× asking at QB/RB/WR/TE) | 6.1 | −32 | 5.2 | 3 |
| Trenches first (1.7× worth on the lines) | 5.6 | −42 | 5.7 | 0 |
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

User games keep the full log and every player line. Playoff games keep player lines. AI regular-season games keep team totals only, since a 32-team season is 272 games and keeping every box score would outgrow localStorage; season totals accumulate for everyone regardless. Game seeds derive from league seed, season, week and matchup, so re-simulating a week reproduces it.

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

Simplifications, all deliberate: no aging or development (the pool is one snapshot per player, so the churn the rules force is what makes one year differ from the next), no rookie draft, no pick cost for draft-league keepers, and no contract lengths beyond the keep count. Speculation: whether the 15% raise is steep enough to stop a club sitting on a $10 quarterback for three years. It is not measured; the three-year limit is the backstop.

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

**Weekly drift.** After each week every AI club drifts its sliders from its own season: toward the pass when the passing game is the efficient unit, away from it when the passer is being sacked, toward the blitz when points are pouring in, toward aggression when the playoff line is slipping away late and toward caution when it is safe. Every slider stays within 0.12 of the personality's base, so a Ground & Pound club never turns into an Air Raid.

**Deals among themselves.** Surplus for need: a club with a good bench player at one position and a weak starter at another looks for a club in the mirror image and swaps two for two, positions matching, when both lineups improve by at least their greed. A few pairs are tried each week before the deadline and every deal lands in the log, so the human can see the market move without being in every trade.

Depth charts were already revisited after every waiver claim and trade. Not built: AI clubs proposing trades to the human (the position-matching rule leaves few deals that are good for both sides and worth the interruption) and any memory of a specific opponent beyond the ratings.

## Save slots and sharing (`slots.js`, `share.js`)

Several leagues live in one browser. A registry lists the slots and which one is open; each slot's league and in-progress game sit under their own key, and preferences are shared. A save from before slots existed becomes slot one on first load. Creating a league while one is open puts the new one in a new slot, an import goes into a new slot, and deleting the open league opens the most recent other one. The home screen lists the slots with a size, because browser storage is a few megabytes and a 32-club season with box scores is a real fraction of that; the list warns past about 3.5 MB.

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

13. **A replayable share code.** *Not built, and the audit argues against building it as written.* The code is a snapshot of a league at the start of a season, which is enough for a friend to play the same rosters. Turning it into a true replay is not blocked by determinism: the league seed, every game seed and the RNG state are already stored, and the only unseeded values are the league id and creation time, which a snapshot fixes. The cost is elsewhere.

   A replay log would have to carry every human decision in order: about twenty-five league-level ones (nominations, a maximum bid on each of 208 to 864 auction lots, claims and cancels, proposed trades, accepted and declined offers, keeper picks, injured-reserve moves, slider changes, depth-chart reorders, and the choice to play or sim each week), plus every coach-mode call, which is roughly nine hundred entries in a fourteen-game season. That is a log format, a size problem, and a versioning story.

   The versioning is the real objection. A replay is only valid against the exact engine that produced it, and the constants move: penalty rates, injury rates, replacement level, general-manager greed, the keeper raise and the offer gate all changed while the ten items were being built, each one re-measured. Every such change invalidates every stored replay, so the feature would need a frozen engine version per code and a migration path, for a payoff the snapshot already mostly delivers.

   What the idea was actually for — two people playing the same league and comparing — is better served by a small result card: the final table, your record, the champion and the MVP, exported from a finished season and compared against a friend's. That is a fraction of the work and does not rot when a constant moves. It is not built either; it is the honest version of the request.

Smaller items that did not make the list: an 18-week pro calendar (folded into 5), two-minute-drill timeouts for the coach-mode user, a compare-players view, keyboard and screen-reader passes on the auction room, and an in-app explainer for what actually wins games (the leverage table is documented above, not surfaced in the product).
