# Gridiron Eras — all-time fantasy football simulator

Draft real football players from every era at their prime season — Otto Graham to Patrick Mahomes, Jim Brown to Saquon Barkley — then simulate a season against AI-built all-time teams, play by play. Single-player, runs entirely in the browser, installable as a PWA.

**Play it:** open `index.html` from any static host (GitHub Pages works as-is; see Deploy below).

## What's in the box

- **It tells you where games are won.** The auction is deliberately mispriced — asking prices follow reputation, real value follows win impact — and a panel in the draft and auction rooms shows the gap per position, with a standalone page you can read before you start. Positional only: it will tell you the room overpays for receivers, never what a particular receiver is worth. The numbers behind it were re-measured from scratch in an audit that found the tight end had been valued at nearly double what he is worth.
- **Salary-cap auction** against AI general managers with personalities (Air Raid, Ground & Pound, Defense Wins, Old School, Analytics…) who game-plan each opponent, drift their strategy with the season and trade among themselves. $200 buys 27 players, so you cannot have everything. Asking prices follow reputation rather than real win impact, which leaves bargains on the board: bidding well is worth about four wins a season over paying sticker price. A plain snake draft is still an option.
- **Play-by-play simulation** driven by ratings: pass rush vs. protection, coverage vs. separation, tackling vs. run-after-catch, kicker range, punter placement, clock management, timeouts, two-minute drill, overtime, and flags: false starts, holding, interference, roughing and the rest, at rates tied to the players on the field.
- **Manager or coach.** Set strategy sliders and watch, or turn on coach mode and call every play (and defensive call) yourself. A live win-probability curve, a drive chart and a game story (turning points, stars, injuries) come with every game you play.
- **1,269 real players** from the 1940s to 2025, one prime season each, on a real talent curve: the top tenth are stars, the median is a solid starter, the bottom quarter should not be starting. A 32-team league drafts 864 of them, so somebody does. A rating editor with a diff export lets you argue with any number, and a fictional-name toggle swaps every real name for a stable made-up one.
- **Two league modes.** A fantasy league of 8, 10 or 12 clubs with a 13 to 14 game slate and a short bracket, or a **pro league**: the full 32 teams in two conferences of four divisions, an 18-week, 17-game season built the way the real league builds one (byes between weeks 5 and 14, rivalry week last, standings-based opponents from season two), division standings with the full tiebreak order and clinch markers, seven playoff seeds per conference with a bye for the top seed, and a neutral-site final. Home teams get a modest edge (about 55/45 between equals).
- **Injuries that change the season.** Every play carries a small chance that somebody gets hurt, weighted by who was involved and how fragile the position is. A hurt player leaves the game on the spot, the next man on the depth chart starts, and a position left short gets a street free agent worse than anyone on the wire. Weeks out carry across the schedule, a QB2 slot exists because of it, and a dial (Off / Low / Normal / High) keeps rates well under the real league's.
- **Injured reserve.** Park a player out four weeks or more, free his slot to sign cover, and decide later whether he is worth a roster spot when he is fit. Two places a club, and the man you filled in behind him is the price of getting him back.
- **A trade market that calls you.** AI clubs ring with two-for-two offers when they are deep where you are thin, gated so an insulting offer is never made and a declined deal never comes back. About four calls a season, half of them worth taking.
- **In-season roster moves.** A waiver wire with weekly priority (rolling in fantasy leagues, reverse standings in the pro league), a two-claim weekly limit, AI clubs that work the wire too, and position-matched trades with AI general managers who judge every offer on lineup strength and refuse to be fleeced. A trade deadline and a full transaction log.
- **A dynasty loop.** Every player carries a contract from his auction price. In the offseason each club keeps a handful at a raised price (three years running at most), everyone else goes back to the pool, and the market reopens with whatever cap is left, worst club first. AI clubs keep their bargains, not their names. Or run it back with the same rosters if you prefer.
- **A difficulty dial.** Four levels that change how well the other clubs bid, scout and trade, and how patient an owner is — and nothing else. No level gives anybody a rating bonus or a thumb on the scale in a game, so the score always means what it says. Measured, it moves a good manager by about 1.2 wins a season and collapses their point differential from +52 to +5.
- **A weekly pulse.** What happened across the league, not just in your game: upsets against the power table, blowouts and shutouts, who is on a run, who went down and for how long, and every deal. Read back out of records the season already keeps, so an old save gets one too.
- **A coaching career, in the pro league.** An owner who wants something specific — set against your squad's rank, not a flat target — and sacks you when you keep missing it. Every other club has a coach under the same pressure, so roughly one in ten changes hands each year, and their vacancies are the jobs you get offered. Being sacked does not end the save: you take over somebody else's squad, with their contracts and none of the chemistry you had built, which is the actual price. Your reputation decides who calls, and below the floor nobody does and the career is over. The seat is shown in words, never a hidden meter.
- **Careers that run.** Sign a man and his career starts: rostered players age every offseason, rookies develop along hidden growth curves, and the old retire and free their slots. The pool itself stays frozen at its prime until you sign somebody, so the auction is the same puzzle — it is what happens afterwards that changes. A keeper's third year costs him about a point and a half; a patient club can watch a 63-overall rookie become an 80. Backs go early and quarterbacks late, legs fade before hands and hands before the head. Each season a club can name three men for its staff to develop — a climber climbs faster, a veteran slips more slowly — and the rest of the roster pays for the attention, so it moves development rather than adding any. Switchable off per league.
- **Position changes, in the pro league.** Move one of your own men into an open slot at a position his skills translate to — safety to corner and back, tight end to receiver, linebacker to the line — and he is rated on what his skills are worth there. Only between positions whose players are rated against the same peers, since a linebacker's 90 in coverage is a linebacker's 90, and only where at most one skill has to be estimated and the estimate cannot move his rating by more than a point; receiver to tight end and linebacker to the secondary are turned away, and why is written down. His first two seasons at a new position cost him while he learns it, and a move to a position the market pays more for raises his salary by the difference, so buying safeties to play corner is not a free lunch. Measured, it is a way to fill a hole the market cannot, not a way to get better for nothing — which is also why the AI clubs do not use it.
- **Scouting.** A generated rookie shows a projected range — `58–86` — instead of a rating, until he has played a season. The width is the information: a safe 70–76 against a boom-or-bust 58–86 is a real draft-day choice, and a bust's band comes out narrow and low all by itself. Every AI club scouts too, through its own error, so you can win a prospect because you rated him higher than the room and find out you were wrong. Clubs draft a rookie on what their scouts think he is now rather than on his upside: his upside arrives, on average, after the four-year rookie deal, when keeping him costs market price — measured, that picks about a rating point better over the deal. Real players are never hidden — you always know exactly who you are bidding on. Each offseason reports last year's class against what you projected.
- **Weather, in the pro league.** Every club plays in its own city's climate, month by month — snow in Buffalo in December, wind off Lake Michigan, thin air in Denver, and eleven clubs under a roof. Wind costs completions (deep ones most) and kicking range, rain and snow loosen the ball, cold shortens a kick, and a big arm and a big leg resist the wind, so a cold-weather club has a reason to want them. The matchup card says what the sky will be, because the game is played under that same draw. Built as a spread around the engine's calibrated average rather than a tax on it: measured over 20,000 paired games, a season with weather scores what one without did, within 0.04 points a team-game. A gale costs about four points a game.
- **Team chemistry.** A settled squad from a tight era band plays a little better than a roster of strangers assembled from eight decades. Worth at most 1.8 rating points — under two home-field edges — measured against the rest of your league rather than an absolute scale, and shown on the team screen with both its inputs so you can see where it comes from. A wide era spread is a first-season tax, not a life sentence: it stops mattering once the squad has played together. Building era-themed is a genuine alternative to taking the best player available.
- **A rookie class every offseason.** Three and a half per club with invented names from 343,200 combinations, rated the way a real intake is rated: most of them replacement level, the odd genuine prospect, and attributes that scatter so you get a fast receiver who drops the ball rather than a smooth one. They enter the same market as everyone else. How much they matter depends on league size — an eight-club league's worst starter is an 88, so most classes are noise there, while the pro league's cutoff is 75 and a good rookie beats what is left on the wire. Anyone nobody signs in three seasons washes out, so a twenty-season dynasty's free-agent list stays readable.
- **Simulate ahead.** Jump to the halfway point, to the playoffs, through the playoffs, or straight into next season. The weekly machinery still runs underneath — waivers, trades, injuries, AI strategy drift all happen — so it removes the clicking, not the season. Going into next season picks your keepers and runs the market for you; it warns you first and tells you what it decided.
- **Season hub.** Standings with clinch markers, playoff picture, season leaders, box scores, and a history card that keeps every season's champion and your finish.
- **Season cards.** Finish a season and copy a short card: your record, where you finished, how far you went, the champion, the MVP and your three biggest seasons. Paste a friend's card, after you have both played the same shared league, to see who did more with the same rosters. Because every game is seeded from the league, two people who decide nothing get the same season, so what the comparison measures is the decisions. Shareable as an image.
- **Awards, records, a hall of fame.** An MVP race scored against each player's own position, players of the year on both sides of the ball, an all-league team, a record book of season, single-game and team marks, and careers that build a résumé toward induction.
- **Box scores** with passing/rushing/receiving/defense/kicking lines, scoring summary, full play-by-play, and PPR fantasy points.
- **Offline-capable PWA** with save slots for several leagues, export/import, a pasteable league code that opens the same rosters on another device, and a roster card you can share as an image. Phone-first layout: no horizontal scrolling at 360px, verified on every screen by the smoke test.

## Running locally

No build step. Any static server works:

```bash
npm start            # serves the folder on http://localhost:8080
# or: python3 -m http.server 8080
```

ES modules require http(s); opening `index.html` via `file://` will not work.

## Tests and tools

```bash
npm test             # engine tests (node:test, no dependencies)
npm run validate     # schema-check src/data/players.js
npm run calibrate    # simulate 300 games between synthetic teams and print league averages
npm run auction      # compare roster variety: auction vs snake draft
npm run strategy     # measure whether how you bid changes how much you win
npm run moves        # AI waiver activity over a season and a fleece test of the trade evaluator
npm run offers       # how often AI clubs call with a trade and what the offers are worth
npm run ir           # injured-reserve usage by injury setting
npm run injuries     # injury rates by dial setting, weeks lost per club, and what a missing QB costs
npm run dynasty      # keeper counts, cap committed and roster turnover over four-season runs
npm run careers      # ageing curves: decline from a prime signing, rookie development, career lengths
npm run resign       # the keeper round and the market: who is re-signed, declined, won back, and on what lengths
npm run terms        # what each contract length is worth, following real signings for five seasons
npm run focus        # what a development focus moves, measured against the same seasons without it
npm run convert      # which position changes exist, what they do to a rating, and whether any club gains by making them
npm run rookies      # what a rookie pick is worth: the draft's read against alternatives, the value of scouting, position weights by wins
npm run weather      # weather: whether a season with it averages what one without did, the spread by condition, and whether an offence should run more
npm run cap          # twenty-five seasons of pro leagues: whether the cap still binds as the all-time greats retire
npm run schemes      # whether a coordinator's scheme would re-sort who is good among starters
npm run passrate     # what the pass/run dial is worth: to the AI clubs (ai) and to you, setting by setting against real opponents (read)
npm run leverage     # re-measure what each position is worth, the table the auction economy rests on
npm run fingerprint  # hash 232 simulated games play-for-play; diff before and after a refactor
npm run report       # top and bottom of every position, multi-season players, era balance
node scripts/apply-overrides.mjs edits.json [--write]   # bake exported rating edits into the data file
npm run icons        # re-rasterize icons/icon.svg to PNG (needs Playwright)
npm run smoke        # headless browser pass: full game flow + layout overflow checks
```

## Deploy to GitHub Pages

Paths are relative, so the app works from a repo subpath. Settings → Pages → Deploy from a branch → `main` / root. `.nojekyll` is included so nothing gets processed. When you ship a new version, bump `CACHE` in `sw.js` so installed clients pick it up.

For a Play Store TWA, point Bubblewrap / PWABuilder at the deployed manifest. `icons/` holds 192 and 512 PNGs plus a maskable variant.

## Project layout

```
index.html, manifest.webmanifest, sw.js   app shell + PWA
src/main.js, router.js, store.js         boot, hash router, persisted state (localStorage)
src/slots.js                             save slots: several leagues in one browser
src/engine/share.js                      league codes: a pasteable snapshot of a league
src/engine/result.js                     season cards and the comparison between two of them
src/data/positions.js                    position attributes, overall weights, roster template
src/data/names.js, tuning.js             fictional names, rating overrides
src/data/rookie-names.js                 first and last names for generated rookies
src/data/players.js                      the player database (1,269 prime-season snapshots)
src/data/pro.js                          the 32 pro franchises, conferences and divisions
src/data/teams.js                        AI franchise names and GM personalities
src/engine/game.js                       the simulation state machine (kickoff → play → PAT …)
src/engine/game/plays.js                 what happens on a snap: run, pass, field goal, punt
src/engine/game/picks.js                 who gets the ball and who makes the play
src/engine/playcall.js                   AI play-calling, 4th-down logic, timeouts, tempo
src/engine/ratings.js                    overall ratings and team composite ratings
src/engine/draft.js                      snake draft with value-over-replacement AI
src/engine/auction.js                    salary-cap auction: pricing, AI bidding, bid resolution
src/engine/season.js                     league, schedule, standings, playoffs, stat rollups
src/engine/transactions.js               free agents, waiver claims, trades, AI roster moves
src/engine/injuries.js                   injury rolls, replacement-level fill-ins, the weeks-out ledger
src/engine/penalties.js                  flags: rates, enforcement, half the distance
src/engine/offseason.js                  contracts, keepers, the offseason market
src/engine/rookies.js                    generated rookie classes, wash-out, the league's own pool
src/engine/careers.js                    ageing, development, ceilings and retirement
src/engine/chemistry.js                  continuity and era cohesion, scored against the league
src/engine/weather.js                    each pro city's climate, a game's conditions, and effects centred on the league's average afternoon
src/engine/scouting.js                   rookie projections, per-club error, the report card
src/engine/jobs.js                       owners, expectations, the sack and the coaching carousel
src/engine/difficulty.js                 how good the opposition is: bidding, scouting, trading, patience
src/engine/pulse.js                      the weekly digest, read back out of results and the logs
src/ui/value-panel.js                    the positional value board, derived from the auction tables
src/engine/autosim.js                    simulating ahead to a named point in the calendar
src/engine/clinch.js                     conservative clinch and elimination markers
src/engine/winprob.js                    win probability fitted to the simulation
src/engine/awards.js                     season honours, the record book, careers and the hall of fame
src/engine/gm.js                         AI game plans and weekly strategy drift
src/ui/charts.js                         inline-SVG win probability and drive charts, the game story
src/ui/views/*.js                        screens (home, setup, draft, auction, team, season, moves, offseason, awards, game, box score, players, settings)
scripts/                                 validator, calibration, icon generator, synthetic pools for tests
tests/                                   node:test suites
```

See `DESIGN.md` for how the simulation works and how to tune it.

## Editing the player pool

`src/data/players.js` holds one row per player, grouped by position:

```js
WR: [
  ['Jerry Rice', 1995, 'SF', 90, 99, 99, 95],   // spd, cth, rte, rac
  ...
```

Columns are `[name, season, team, ...ratings]`, with ratings in the attribute order listed for that position at the top of the file (and in `src/data/positions.js`). Ratings are 40–99, scaled cross-era ("how dominant relative to his time, translated to a modern-athlete scale"). Ids are derived from name + season, so the same player can appear at several seasons (Brady 2007 and Brady 2017 both exist).

To add players in bulk, write a JSON file of `{ "QB": [["Name", season, "TEAM", ...ratings], ...] }` and run `node scripts/add-players.mjs additions.json`. It merges, re-sorts each position by overall, and rejects duplicates or malformed rows. Run `npm run validate` after editing, and `node scripts/db-report.mjs` to see the top and bottom of each position.

Ratings are editorial estimates, not official statistics. Names are used for identification only; there are no likenesses, logos, or team marks.

## License

MIT.
