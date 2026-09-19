import { html, render } from '../../util.js';
import { valuePanel } from '../value-panel.js';
import { TOTAL_SLOTS, DEFAULT_BUDGET } from '../../engine/auction.js';
import { ROSTER_SLOTS } from '../../data/positions.js';

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  render(root, html`<div id="guide-view">
    <div class="card">
      <h1 style="margin:0">How this league is won</h1>
      <p class="muted" style="margin:.3rem 0 0">One page, because everything below is measured against this simulation and none of it is obvious from the outside.</p>
    </div>

    <div class="card" style="margin-top:.75rem">
      <h2 style="margin:0 0 .3rem">Where money wins games</h2>
      ${valuePanel()}
    </div>

    <div class="card" style="margin-top:.75rem">
      <h2 style="margin:0 0 .4rem">Why the prices are wrong on purpose</h2>
      <p class="muted" style="font-size:.92rem;margin:.2rem 0">
        A market that priced players on what they are really worth would be efficient, and an efficient market with equal budgets hands every club the same quality of roster. That is the parity problem an auction is supposed to solve, not cause. So the asking prices follow reputation instead: quarterbacks, backs and receivers carry the headlines, and guards and safeties do not.
      </p>
      <p class="muted" style="font-size:.92rem;margin:.2rem 0">
        The AI general managers are not all equally fooled. Each one blends the asking price with real value in his own proportion, so the shrewd ones chase value and the rest chase names. Bidding well against them is worth about four wins a season over paying sticker price.
      </p>
      <p class="muted" style="font-size:.92rem;margin:.2rem 0">
        <b>$${DEFAULT_BUDGET} buys ${TOTAL_SLOTS} players</b>, and every open slot needs at least a dollar, so committing heavily early leaves you buying the bottom of the pool later. A club that spends nothing has ${TOTAL_SLOTS} men at a dollar each and no starters worth the name.
      </p>
    </div>

    <div class="card" style="margin-top:.75rem">
      <h2 style="margin:0 0 .4rem">Three things that are not in the table</h2>
      <p class="muted" style="font-size:.92rem;margin:.2rem 0"><b>Depth is not free.</b> ${ROSTER_SLOTS.filter((s) => !s.starter).length} of the ${TOTAL_SLOTS} slots are bench. They play when somebody is hurt, and a position left short signs a street free agent worse than anyone on the wire. A backup quarterback is insurance against a season, not a luxury.</p>
      <p class="muted" style="font-size:.92rem;margin:.2rem 0"><b>A rating is not a career.</b> Sign a man and he starts ageing; the pool waits at its prime but your roster does not. A keeper in his third year is not the player you bought.</p>
      <p class="muted" style="font-size:.92rem;margin:.2rem 0"><b>A squad that knows itself plays better.</b> Continuity and a tight era band are worth up to a couple of rating points, which is about two home-field edges. Never enough to buy a season, enough to decide a close one.</p>
    </div>

    <div class="row" style="margin-top:.75rem">
      <a class="btn" href="${league ? '#/season' : '#/'}">${league ? 'Back to the season' : 'Back'}</a>
      ${league ? '' : html`<a class="btn primary" href="#/new">New league</a>`}
    </div>
  </div>`);
}
