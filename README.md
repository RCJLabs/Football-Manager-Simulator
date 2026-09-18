# Gridiron Eras — all-time fantasy football simulator

Draft real football players from every era at their prime season — Otto Graham to Patrick Mahomes, Jim Brown to Saquon Barkley — then simulate a season against AI-built all-time teams, play by play. Single-player, runs entirely in the browser, installable as a PWA.

**Play it:** open `index.html` from any static host (GitHub Pages works as-is; see Deploy below).

## What's in the box

- **Snake draft** against AI general managers with personalities (Air Raid, Ground & Pound, Defense Wins, Old School, Analytics…). 26-man rosters: QB, 2 RB, 4 WR, TE, 5 OL, 4 DL, 3 LB, 2 CB, 2 S, K, P.
- **Play-by-play simulation** driven by ratings: pass rush vs. protection, coverage vs. separation, tackling vs. run-after-catch, kicker range, punter placement, clock management, timeouts, two-minute drill, overtime.
- **Manager or coach.** Set strategy sliders and watch, or turn on coach mode and call every play (and defensive call) yourself.
- **Season mode.** Double round-robin schedule, standings, season leaders, playoffs, champion. Play another season with the same rosters or start a new league.
- **Box scores** with passing/rushing/receiving/defense/kicking lines, scoring summary, full play-by-play, and PPR fantasy points.
- **Offline-capable PWA** with local save, export/import.

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
npm run icons        # re-rasterize icons/icon.svg to PNG (needs Playwright)
```

## Deploy to GitHub Pages

Paths are relative, so the app works from a repo subpath. Settings → Pages → Deploy from a branch → `main` / root. `.nojekyll` is included so nothing gets processed. When you ship a new version, bump `CACHE` in `sw.js` so installed clients pick it up.

For a Play Store TWA, point Bubblewrap / PWABuilder at the deployed manifest. `icons/` holds 192 and 512 PNGs plus a maskable variant.

## Project layout

```
index.html, manifest.webmanifest, sw.js   app shell + PWA
src/main.js, router.js, store.js         boot, hash router, persisted state (localStorage)
src/data/positions.js                    position attributes, overall weights, roster template
src/data/players.js                      the player database (one prime-season snapshot per entry)
src/data/teams.js                        AI franchise names and GM personalities
src/engine/game.js                       the simulation state machine (kickoff → play → PAT …)
src/engine/playcall.js                   AI play-calling, 4th-down logic, timeouts, tempo
src/engine/ratings.js                    overall ratings and team composite ratings
src/engine/draft.js                      snake draft with value-over-replacement AI
src/engine/season.js                     league, schedule, standings, playoffs, stat rollups
src/ui/views/*.js                        screens (home, setup, draft, team, season, game, box score, players, settings)
scripts/                                 validator, calibration, icon generator, synthetic pools for tests
tests/                                   node:test suites
```

See `DESIGN.md` for how the simulation works and how to tune it.

## Editing the player pool

`src/data/players.js` is a plain array. Each entry:

```js
{ id: 'jerry-rice-1995', name: 'Jerry Rice', pos: 'WR', season: 1995, team: 'SF', r: { spd: 90, cth: 99, rte: 99, rac: 95 } }
```

Attributes per position are listed in `src/data/positions.js`. Ratings are 40–99, scaled cross-era ("how dominant relative to his time, translated to a modern-athlete scale"). The same player can appear more than once at different seasons; ids must stay unique. Run `npm run validate` after editing.

Ratings are editorial estimates, not official statistics. Names are used for identification only; there are no likenesses, logos, or team marks.

## License

MIT.
