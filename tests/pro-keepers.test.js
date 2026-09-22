// A pro league has no keeper quota, and the setup screen used to pretend it did.
//
// `keeperLimit` returns the whole roster whenever the cap is on, and `capOn` is
// exactly `mode === 'pro'` — so the "Keepers per club" control was offered,
// defaulted to 18, stored, and then ignored. The help text beside it said "the
// pro league to 18", which was the wrong rule for the mode a player was picking.
//
// The part that made this more than cosmetic is `futureDepth`: it read the dead
// setting directly rather than through `keeperLimit`, and it was the only thing
// deciding how deep next year's draft runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, registerPlayers, defaultKeepers } from '../src/engine/season.js';
import { keeperLimit } from '../src/engine/offseason.js';
import { futureDepth, PRO_OPEN_SLOTS } from '../src/engine/futurepicks.js';
import { keeperPickValue } from '../src/engine/pickvalue.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { capOn } from '../src/engine/cap.js';

registerPlayers(PLAYERS_BY_ID);
const pro = (settings = {}) => {
  const lg = createLeague({ name: 'P', mode: 'pro', numTeams: 32, franchise: 3, seed: 5, draftType: 'snake', user: {} });
  Object.assign(lg.settings, settings);
  return lg;
};
const fantasy = (keepers) => {
  const lg = createLeague({ name: 'F', numTeams: 8, seed: 5, draftType: 'auction', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
  lg.settings.keepers = keepers;
  return lg;
};

test('a pro club keeps whoever it can afford, whatever the setting says', () => {
  assert.equal(capOn(pro()), true, 'the cap is on in pro mode by definition');
  for (const k of [0, 6, 18, 22, undefined]) {
    assert.equal(keeperLimit(pro({ keepers: k })), ROSTER_SLOTS.length,
      `a stored keepers=${k} must not change what a pro club may keep`);
  }
});

test('next year\'s draft depth does not come from the dead setting', () => {
  // This is the one that bit. `futureDepth` read `settings.keepers` directly,
  // so a pro league that stopped storing it would have valued its draft at the
  // full twenty-seven rounds instead of nine.
  assert.equal(futureDepth(pro({ keepers: 18 })), PRO_OPEN_SLOTS);
  assert.equal(futureDepth(pro({ keepers: 0 })), PRO_OPEN_SLOTS);
  assert.equal(futureDepth(pro({})), PRO_OPEN_SLOTS, 'no setting stored at all');
  assert.equal(futureDepth(pro({ keepers: 22 })), PRO_OPEN_SLOTS);
});

test('and the depth it does come from is worth a great deal', () => {
  // Why the test above matters rather than being tidiness: pick value decays in
  // fractions of the USABLE draft, so depth is not a rounding detail.
  const deep = keeperPickValue(70, 27, 32);
  const real = keeperPickValue(70, PRO_OPEN_SLOTS, 32);
  assert.ok(deep > real * 50,
    `a round-three pick is ${real.toFixed(2)} at the real depth and ${deep.toFixed(2)} at twenty-seven rounds; if those were close this would not be worth pinning`);
});

test('a fantasy league still sets its own quota', () => {
  // The fix must not reach across into the mode the setting is for.
  assert.equal(keeperLimit(fantasy(6)), 6);
  assert.equal(keeperLimit(fantasy(12)), 12);
  assert.equal(futureDepth(fantasy(6)), ROSTER_SLOTS.length - 6);
  assert.equal(futureDepth(fantasy(12)), ROSTER_SLOTS.length - 12);
  assert.equal(defaultKeepers('fantasy'), 6, 'the fantasy default is unchanged');
});

test('what a pro league stores agrees with what it does', () => {
  // The stored setting is inert in pro mode, so 18 sat there harmlessly and
  // untruthfully: a share code carried it, the settings screen had to special-
  // case it, and anything reading it later would have read a quota that no
  // longer exists. Store the figure that is actually enforced instead.
  assert.equal(defaultKeepers('pro'), ROSTER_SLOTS.length);
  assert.equal(pro().settings.keepers, keeperLimit(pro()),
    'a fresh pro league must not record a limit different from the one it enforces');
});
