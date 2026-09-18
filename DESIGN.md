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

`npm run calibrate` runs synthetic equal teams (ratings ~85). Targets are roughly modern NFL per-team-per-game: 23–26 points, 340–360 yards, 63–65% completions, ~7.7 yards/attempt, ~4.2 yards/carry, ~1.1 turnovers, ~2.1 sacks, ~84% FG. All-star rosters drafted from the real pool score a little higher (~27 per team).

Leverage, measured by boosting one position group 8 points on an otherwise equal synthetic team: QB → 69% wins, WR → 66%, RB/OL/DL → 62%, LB/CB → 61%, S → 58%, K → no effect on win rate. Boosting every group by 2 points wins ~78% because the effects stack. In a snake draft with the value-over-replacement AI, total talent equalizes (team power spread ≈ 1 point), so AI-vs-AI seasons are close to coin flips and the user's edge comes from out-drafting the AI and from strategy. Constants to reach for when tuning: `baseComp`, `baseInt`, `yacMean`, `stuffP`, the run `base` normals, `pressureP`, and the `edge()` k values (bigger k = flatter response to rating gaps).

## The auction (`auction.js`)

The snake draft had a structural problem: it hands every team a full roster from the
same pool in alternating order, so total talent equalizes. Measured over ten
simulated seasons, the best-built roster in a league beat the worst by half a win.
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
strategies, on the current 1,065-player pool:

| Strategy | Wins of 14 | Point differential | Average finish of 8 | Titles of 24 |
|---|---|---|---|---|
| Value shopper (bid by true worth) | 8.3 | +41 | 3.0 | 6 |
| Stars and scrubs | 7.9 | +25 | 3.4 | 6 |
| Pay the asking price | 5.7 | −42 | 6.1 | 1 |
| Chase the famous names | 5.6 | −30 | 6.0 | 0 |
| Trenches first | 4.8 | −70 | 7.0 | 1 |
| Spread the budget evenly | 4.0 | −89 | 7.5 | 0 |

Roughly four wins separate the best approach from the worst, so how you bid is
the main thing that decides a season. The lesson is learnable from play: buy the
positions the room undervalues, and do not pay a premium for a name. Note that
stars and scrubs closed most of the gap once the pool gained a real tail, because
concentrating money now buys genuinely better starters, while spreading the
budget evenly buys a roster of mediocrities.

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

**Pro** (32 teams): two conferences of four divisions, original franchise identities on real geography (no league or club marks). The 17-game slate is built from the same blocks the real league uses: six division games home and away, four against one same-conference division, four against one other-conference division, two more against a second same-conference division, and one more across the conference. Every block is a set of perfect matchings over all 32 teams, so each of the 17 weeks has exactly 16 games and nobody sits. Which divisions meet rotates by season number. The real league uses standings from the previous season to pick the two extra same-conference opponents; here they come from a rotation instead, and there are no bye weeks. Hosting inside a cross-division block follows a 4×4 pattern with two home games in every row and column, so every team hosts 8 or 9 games.

Pro standings are grouped by division with division and conference records. Tiebreakers run win% → head-to-head → division record (same division only) → conference record → point differential → points for. Seven seeds per conference: the four division winners by record, then three wild cards. The bracket engine works on pools of seeds, gives byes when a field is not a power of two, reseeds every round (the top seed always meets the lowest survivor), and when two pools each have one team left it schedules a final at a neutral site with no home edge. Rounds are named Wild Card, Divisional, Conference Championships, Championship.

Home teams get a flat edge of 1.1 composite points to blocking, rush, coverage and tackling, which measures out to a 55/45 split between identical rosters. The setup screen defaults the pro league to the snake draft, since 832 auction lots is a long evening, but the auction works there too.

User games keep the full log and every player line. Playoff games keep player lines. AI regular-season games keep team totals only, since a 32-team season is 272 games and keeping every box score would outgrow localStorage; season totals accumulate for everyone regardless. Game seeds derive from league seed, season, week and matchup, so re-simulating a week reproduces it.

At season start every position group is ordered by overall. Slots fill in the order players were bought, so an auction could otherwise leave a 92 back at RB2 behind a 75. AI clubs are re-sorted each season; the user's club only the first time.

## Transactions (`transactions.js`)

Rosters are exactly 27 slots, so every in-season move is a swap and no separate bench-management screen is needed (the one exception is a slot left open by an older save, which a claim can fill outright). Three kinds of move exist, all from the Moves screen during the regular season.

**Waiver claims.** A claim names the free agent coming in and the player going out at the same position; each club may hold two claims a week. Claims resolve when the week advances, in waiver order: in a fantasy league the order starts as the reverse of the draft order and a successful claim sends that club to the back, in the pro league it is reverse standings every week. AI clubs file their claims at the same moment, so the human never gets first pick of the pool for free. An AI club claims only when the newcomer is at least two overall points better than the man he replaces and the swap adds at least six points of lineup strength; how often a club bothers to look at the wire at all is a per-personality activity rate (Analytics 90%, Old School 30%).

**Trades.** Up to three players a side, and the position sets on both sides must match exactly, so the roster template is preserved without any roster-size rules. The trade deadline is 65% of the way through the schedule (week 10 of 14, week 12 of 17). An AI club judges an offer by one yardstick, *lineup strength*: every player's overall weighted by his position's true leverage from the auction, starters at full weight and bench players at a quarter. It accepts when its own strength rises by at least its greed margin (Analytics 8, Trenches 6, Old School and Defense 5, most others 4, Gambler 2) and tells you roughly how far short an offer fell.

**The log.** Every claim and every deal is recorded with week and season, and the Log tab shows all of them, so any lopsided outcome can be traced.

Injuries feed the same yardstick: a player on the ledger counts for the share of the remaining season he will play, so an AI club will not take your hurt star at full value, will not give up a healthy starter for one, and goes to the wire itself when a starter is done for the year. It keeps a hurt player who will be back this season unless the pickup is better anyway, and it never claims a man who cannot play.

Measured on the 8-team auction league (`scripts/moves-sim.mjs`, 12 seasons): AI clubs land about six claims a season between them, worth about +19 lineup strength per club, because the pool left after an auction is the talent tail and few swaps clear the +2 overall bar. The wire will only get busy once ratings can change in season, which is what injuries (roadmap item 2) are for. On 4,000 random one-for-one offers the AI accepted 28%, and on every accepted deal the human had given up the higher-rated player; the AI gained +13 on average and the human lost 11. That is the intended shape: an AI club cannot be talked into a bad trade on its own yardstick. What it does not rule out, and what has not been measured, is a trade that is even on the overall-based yardstick but not in the simulation, for instance a receiver whose overall is carried by an attribute the play resolution weights lightly. The yardstick would need to move from overall to composite contributions to close that, which the auction pricing already knows how to do.

## Injuries and depth (`injuries.js`)

Every play rolls once for an injury somewhere on the field. The victim is drawn from the players the play involved (carrier, target, tackler, the quarterback when pressured, a lineman on either side, the returner and a cover man on kicks), weighted by exposure and by position fragility: backs are the most fragile, specialists barely register. Severity is a five-band roll: 55% leave the game and are fine next week, 25% miss one or two weeks, 12% three to five, 6% six to nine, 2% are done for the season, each band with its own diagnoses for the log.

A hurt player leaves on the spot. He comes off the game's depth chart, the unit composites are rebuilt around whoever is left (with the home edge re-applied), and any position group left short is padded with a replacement-level fill-in: a street free agent rated just under the worst player in the pool (QB 48, most positions 52 to 54, kickers 58), so nobody on the wire is ever worse than the fill-in. That keeps the incentive pointing at the waiver wire.

Between games the league keeps a ledger keyed by player: weeks out, diagnosis, when it happened. `buildLineup` skips anyone on it, so the next man at the position starts (the depth chart marks him "starts"), the week advance ticks it down, and a new season clears it. The ledger travels with the player: a hurt free agent stays hurt if you claim him. There is no injured-reserve slot, so a hurt starter keeps his roster spot; a club rides out a short injury with the fill-in or the bench, or cuts the man for healthy cover. Both are real decisions and the moves screen supports either.

The dial is a league setting: Off, Low, Normal (default), High, as a multiplier of 0, 0.5, 1 and 2 on the base per-play chance. Measured with `scripts/injury-sim.mjs`:

| setting | injuries per game (both clubs) | player-weeks lost per club per game | players out per club-week (8-team league) | QB1 missing |
|---|---|---|---|---|
| low | 0.65 | 0.5 | 0.3 | 4% of weeks |
| normal | 1.2 | 1.0 | 0.7 | 6% of weeks |
| high | 2.5 | 2.1 | 1.2 | 10% of weeks |

The real league runs at roughly three to four times "normal" by adjusted games lost, so even High is a gentle version. That is deliberate: a 13-game season is short enough that injury luck at real rates would decide more leagues than the auction does. What a missing quarterback costs, on one auction roster against every opponent in the league with no other injuries: 50% with the starter, 44% with the backup the auction bought for him, 4% with a replacement-level fill-in. The backup is worth roughly six points of win probability per week he plays, which is what the QB2 slot is for and why the auction AI pays about a third of starter money for one.

Established: the rates and the effects above. Speculation: how the dial should sit for the pro league, where 17 games and 64 quarterbacks drafted out of 103 make backups much weaker; the same setting will bite harder there, and nothing yet re-measures it.

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

3. **A dynasty loop: contracts, keepers, an offseason.** Evidence: `newSeasonSameRosters` replays the same roster forever, and `history` records champions but nothing else changes year to year. Auction prices are the natural contract: each purchase is a 1 to 3 year deal at that price, expiring players return to the pool, draft order runs worst to first, and the cap carries over. Touches `auction.js`, `season.js`, a new offseason phase and view. Risk: the pool is one snapshot per player, so there is no aging; contracts and re-drafts have to carry the sense of change instead.

4. **Penalties.** Evidence: the play log has never shown a flag, and `DESIGN.md` lists it as a known gap; the real league averages about a dozen per game and they decide drives. Touches `game.js` (false start, holding, pass interference, offsides, with rates tied to awareness and pressure) and the clock rules. Risk: cheap to add but changes every calibration number in this document; re-run `npm run calibrate`, `npm run auction` and `npm run strategy` afterwards.

5. **Pro-mode fidelity.** Evidence: the 17-game slate is structurally right but uses a rotation where the real league uses last season's standings for two of the games; there are no bye weeks; tiebreakers stop at conference record (no common games, strength of victory or schedule); the standings page has no clinch or elimination markers. Touches `buildProSchedule` (18-week calendar with byes, standings-aware pairings from season two), `makeComparator`, `proStandings`. Risk: byes break the "every week has 16 games" invariant that the tests lean on; write the new invariant first.

6. **Live game presentation.** Evidence: the game view is a text log with a scoreboard and a field bar; there is no win-probability line, no drive chart, no quarter summary, and no highlight reel at the end. The engine already exposes drives and every play's yardage and result. Touches `game.js` view only, plus a small win-probability model fitted from simulated games. Risk: none to the engine; the `dataviz` skill should drive any chart.

7. **Awards, records and a hall of fame.** Evidence: `seasonStats` and `history` already hold everything needed, and the completion screen shows only the champion. MVP, offensive and defensive player of the year, all-league teams, single-season and career records per franchise. Touches `season.js` (a `records` structure) and the completion view. Risk: low; the leverage table decides MVP weighting, so a quarterback wins most years unless the formula corrects for position.

8. **Smarter AI general managers.** Evidence: personalities are static presets; AI clubs never change a strategy slider, never revisit a depth chart after the season-start sort, and never respond to what beat them last week. Touches `playcall.js` (per-opponent adjustments: blitz more against a weak line, run against a weak front) and a weekly AI housekeeping pass. Risk: a smarter field narrows the strategy spread measured in the auction section; re-measure and keep the spread near four wins.

9. **Save slots and shareable leagues.** Evidence: `store.js` holds one league under one localStorage key; a second league overwrites the first, and export/import is the only backup. Because every game is seeded, a league is reproducible from its seed and pick history, so a short share code could rebuild a league on another device and a roster card could be rendered to an image for sharing. Touches `store.js`, settings view, a canvas renderer. Risk: the players file must stay byte-identical for codes to replay; version the code with the data file's hash.

10. **Rating tooling and a fictional-name toggle.** Evidence: 310 of 1,269 players are from the 2010s against 32 from the 1950s; every rating is editorial; the README carries a licensing caveat for real names on a store listing. An in-app rating editor with a diff export, an era-balance report, and a switch that replaces names with generated ones would let the pool be argued with in public and keep a Play Store build clear of the name question. Touches `players.js` loading, settings, `scripts/db-report.mjs`. Risk: the fictional names must map one-to-one and stay stable across versions or saves break.

Smaller items that did not make the list: an 18-week pro calendar (folded into 5), two-minute-drill timeouts for the coach-mode user, a compare-players view, keyboard and screen-reader passes on the auction room, and an in-app explainer for what actually wins games (the leverage table is documented above, not surfaced in the product).
