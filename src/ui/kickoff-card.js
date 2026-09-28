// The market's last screen, for the human club: the men the market left over
// who beat one of its starters by five, each with a mark to take him at
// kickoff.
//
// At kickoff the clubs take such men on the minimum for a year, in waiver
// order once the fill has seen to every empty slot, and whoever is left
// retires (`kickoffUpgrades`, `drainAtKickoff`). The computer clubs take them
// by rule. This is the human club's way to the same men: a mark is taken at
// the club's turn if the man is still there and still beats the weakest
// starter at his position by five. Without it the computer clubs had a market
// the human could not reach.

import { ordinal } from '../util.js';
import { kickoffChoices, markKickoffWant, UPGRADE_MARGIN } from '../engine/freeagency.js';
import { proPools } from '../engine/proleague.js';
import { shownOverall } from '../engine/scouting.js';
import { playerItem, esc } from './components.js';

/** The list stops here: past a dozen the gains are small and the screen is long. */
const SHOWN = 12;

function fate(league, ctx, teamIdx, c) {
  const man = (id) => ctx.byId.get(id);
  const name = (id) => esc(man(id)?.name || 'Unknown');
  const goes = c.squad ? 'goes to the practice squad'
    : c.dead ? `is released, still owed $${c.dead.amount} a year for ${c.dead.years} year${c.dead.years === 1 ? '' : 's'}`
    : 'is released';
  const over = `replaces ${name(c.plan.starter)} (${man(c.plan.starter) ? shownOverall(league, man(c.plan.starter), teamIdx) : '?'})`;
  return c.plan.demote
    ? `${over}, who drops to the bench; ${name(c.plan.release)} ${goes}`
    : `${over}, who ${goes}`;
}

/** The card's HTML, or nothing where there is no kickoff market: the opening season, or a fantasy league. */
export function kickoffCard(league, ctx, teamIdx) {
  if (teamIdx < 0 || !proPools(league)) return '';
  const all = kickoffChoices(league, ctx.players, ctx.byId, teamIdx);
  const marked = new Set(league.kickoffWants || []);
  // A mark stays on the list even if it would fall below the cut.
  const shown = all.filter((c, i) => i < SHOWN || marked.has(c.player.id));
  const order = league.waiverOrder?.length === league.teams.length ? league.waiverOrder : league.teams.map((_, i) => i);
  const turn = order.indexOf(teamIdx) + 1;
  const rows = shown.map((c) => {
    const on = marked.has(c.player.id);
    return playerItem(c.player, {
      attrs: false,
      meta: `<br>${fate(league, ctx, teamIdx, c)}`,
      action: `<button type="button" class="btn sm${on ? ' primary' : ''}" data-kmark="${esc(c.player.id)}" aria-pressed="${on}">${on ? 'Marked' : 'Mark'}</button>`,
    });
  }).join('');
  const count = shown.filter((c) => marked.has(c.player.id)).length;
  return `<div class="card" id="kickoff-card">
    <h3 style="margin-top:0">Before kickoff</h3>
    <p class="muted" style="margin:.2rem 0 .5rem">Whoever the market left over retires at kickoff. Before that, clubs take any who beat one of their starters by ${UPGRADE_MARGIN}, on the minimum for a year, worst record first: you go <b>${ordinal(turn)}</b> of ${order.length}. A man you mark replaces your weakest starter at his position if he is still there at your turn and still beats him by ${UPGRADE_MARGIN}. Nobody from this year's rookie class makes way.</p>
    ${rows ? `<ul class="plist">${rows}</ul><p class="muted" style="margin:.4rem 0 0;font-size:.85rem">${count ? `${count} marked.` : 'Nothing marked: your roster starts the season as it is.'}</p>`
      : `<p class="muted" style="margin:0">Nobody the market left over beats one of your starters by ${UPGRADE_MARGIN}.</p>`}
  </div>`;
}

/** Marks and unmarks, then `redraw` so the card shows it. */
export function wireKickoffCard(root, ctx, redraw) {
  root.querySelector('#kickoff-card')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kmark]');
    if (!b) return;
    const id = b.dataset.kmark;
    const on = b.getAttribute('aria-pressed') !== 'true';
    ctx.update((s) => { markKickoffWant(s.league, id, on); }, { silent: true });
    redraw();
  });
}
