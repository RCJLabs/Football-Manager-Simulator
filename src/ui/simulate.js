// Simulating ahead from a screen, without the screen freezing.
//
// Played straight through, a pro league's run to the halfway point held the
// page for twenty-six seconds with the CPU slowed four times to stand in for a
// phone, and a run into the next season for ten, with nothing on screen moving
// and every tap queued behind it. Here the same run goes a step at a time — a
// week, or a stage of the offseason — and the page draws between steps, behind
// a panel that says how far it has got.
import { RNG } from '../engine/rng.js';
import { simulateAheadAsync, describeStep, TARGET_LABELS } from '../engine/autosim.js';
import { busyOverlay } from './components.js';

/** After the next frame is drawn. A hidden page draws none, so a run waits there until it is back. */
const nextFrame = () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));

let running = false;

/**
 * Run the open league to `target` behind a progress panel. The league moves in
 * place and is written once, when the run is done: every step leaves it at
 * rest, where the player could have stopped, but a save between steps would
 * cost a phone a serialization of the whole league every week, and a run cut
 * off by the page closing is better lost whole than kept in part. Nothing else
 * on the page changes it meanwhile, because the panel makes the rest inert and
 * nothing is re-rendered until the end, which also keeps the run doing the same
 * work in the same order as one played straight through.
 */
export async function simulateWithProgress(ctx, target, { silent = false } = {}) {
  if (running) return null;
  running = true;
  const s = ctx.getState();
  const league = s.league;
  const rng = new RNG(league.rngState);
  // Its week is about to be simulated: nothing on screen may show it against a
  // league that has moved on.
  s.game = null;
  const busy = busyOverlay(TARGET_LABELS[target] ? `Simulating ${TARGET_LABELS[target].toLowerCase()}` : 'Simulating');
  let result;
  try {
    result = await simulateAheadAsync(league, ctx.byId, ctx.players, rng, target, {
      pause: nextFrame,
      onStep: (at) => {
        // Kept current, so a save that lands mid-run carries the random state
        // that goes with the league it writes.
        league.rngState = rng.state;
        busy.set(describeStep(league, at));
      },
    });
  } finally {
    busy.close();
    running = false;
  }
  ctx.update((st) => { st.league.rngState = rng.state; st.game = null; }, { silent });
  return result;
}
