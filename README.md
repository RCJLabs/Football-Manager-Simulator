# Gridiron Eras — all-time fantasy football simulator

Draft real football players from every era at their prime season — Otto Graham to Patrick Mahomes, Jim Brown to Saquon Barkley — then simulate a season against AI-built all-time teams, play by play. Single-player, runs entirely in the browser, installable as a PWA.

**Play it:** open `index.html` from any static host (GitHub Pages works as-is; see Deploy below).

## What's in the box

- **Salary-cap auction** against AI general managers with personalities (Air Raid, Ground & Pound, Defense Wins, Old School, Analytics…) who game-plan each opponent, drift their strategy with the season and trade among themselves. $200 buys 27 players, so you cannot have everything. Asking prices follow reputation rather than real win impact, which leaves bargains on the board: bidding well is worth about two to three wins a season over paying sticker price. A plain snake draft is still an option.
- **Play-by-play simulation** driven by ratings: pass rush vs. protection, coverage vs. separation, tackling vs. run-after-catch, kicker range, punter placement, clock management, timeouts, two-minute drill, overtime, and flags: false starts, holding, interference, roughing and the rest, at rates tied to the players on the field.
- **Manager or coach.** Set strategy sliders and watch, or turn on coach mode and call every play (and defensive call) yourself. A live win-probability curve, a drive chart and a game story (turning points, stars, injuries) come with every game you play.
- **1,269 real players** from the 1940s to 2025, one prime season each, on a real talent curve: the top tenth are stars, the median is a solid starter, the bottom quarter should not be starting. A 32-team league drafts 864 of them, so somebody does. A rating editor with a diff export lets you argue with any number, and a fictional-name toggle swaps every real name for a stable made-up one.
- **Two league modes.** A fantasy league of 8, 10 or 12 clubs with a 13 to 14 game slate and a short bracket, or a **pro league**: the full 32 teams in two conferences of four divisions, an 18-week, 17-game season built the way the real league builds one (byes between weeks 5 and 14, rivalry week last, standings-based opponents from season two), division standings with the full tiebreak order and clinch markers, seven playoff seeds per conference with a bye for the top seed, and a neutral-site final. Home teams get a modest edge (about 55/45 between equals).
- **Injuries that change the season.** Every play carries a small chance that somebody gets hurt, weighted by who was involved and how fragile the position is. A hurt player leaves the game on the spot, the next man on the depth chart starts, and a position left short gets a street free agent worse than anyone on the wire. Weeks out carry across the schedule, a QB2 slot exists because of it, and a dial (Off / Low / Normal / High) keeps rates well under the real league's.
- **Injured reserve.** Park a player out four weeks or more, free his slot to sign cover, and decide later whether he is worth a roster spot when he is fit. Two places a club, and the man you filled in behind him is the price of getting him back.
- **A trade market that calls you.** AI clubs ring with two-for-two offers when they are deep where you are thin, gated so an insulting offer is never made and a declined deal never comes back. About four calls a season, half of them worth taking.
- **In-season roster moves.** A waiver wire with weekly priority (rolling in fantasy leagues, reverse standings in the pro league), a two-claim weekly limit, AI clubs that work the wire too, and position-matched trades with AI general managers who judge every offer on lineup strength and refuse to be fleeced. A trade deadline and a full transaction log.
- **A dynasty loop.** Every player carries a contract from his auction price. In the offseason each club keeps a handful at a raised price (three years running at most), everyone else goes back to the pool, and the market reopens with whatever cap is left, worst club first. AI clubs keep their bargains, not their names. Or run it back with the same rosters if you prefer.
- **Season hub.** Standings with clinch markers, playoff picture, season leaders, box scores, and a history card that keeps every season's champion and your finish.
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
src/data/positions.js                    position attributes, overall weights, roster template
src/data/names.js, tuning.js             fictional names, rating overrides
src/data/players.js                      the player database (1,269 prime-season snapshots)
src/data/pro.js                          the 32 pro franchises, conferences and divisions
src/data/teams.js                        AI franchise names and GM personalities
src/engine/game.js                       the simulation state machine (kickoff → play → PAT …)
src/engine/playcall.js                   AI play-calling, 4th-down logic, timeouts, tempo
src/engine/ratings.js                    overall ratings and team composite ratings
src/engine/draft.js                      snake draft with value-over-replacement AI
src/engine/auction.js                    salary-cap auction: pricing, AI bidding, bid resolution
src/engine/season.js                     league, schedule, standings, playoffs, stat rollups
src/engine/transactions.js               free agents, waiver claims, trades, AI roster moves
src/engine/injuries.js                   injury rolls, replacement-level fill-ins, the weeks-out ledger
src/engine/penalties.js                  flags: rates, enforcement, half the distance
src/engine/offseason.js                  contracts, keepers, the offseason market
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
