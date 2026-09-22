import { html, render, raw } from '../../util.js';
import { valuePanel, valueHint } from '../value-panel.js';
import { POSITION_ORDER, ROSTER_SLOTS, POSITIONS } from '../../data/positions.js';
import { ERAS } from '../../data/db.js';
import { overall, buildLineup } from '../../engine/ratings.js';
import { RNG } from '../../engine/rng.js';
import { startSeason } from '../../engine/season.js';
import {
  advanceToUser, nominate, settle, priceGuide, maxAffordable, slotsLeft, openSlotsByPos,
  currentNominator, nominatable, autoCompleteAll, autoUserMax, canRoster, MIN_BID, TOTAL_SLOTS,
} from '../../engine/auction.js';
import { lotAdvice, lotNote, positionScarcity } from '../../engine/market.js';
import { playerItem, playerModal, teamChip, toast, announce, ovrBadge, esc, posBadge, withBusy } from '../components.js';
import { draftBoard, boardOverlay, auctionRows, scrollToPick, lastName } from '../draft-board.js';
import { SPEEDS, DEFAULT_SPEED } from './draft.js';

const ui = { pos: 'ALL', era: 'ALL', q: '', minAsk: 85, bid: null, limit: 60, boardOpen: false };

// The room used to run itself forward to the next thing it needed from you and
// apply everything in between in one go — at the default ask of 85 that is most
// of the auction, sold in silence. It is paced now, a lot at a time, onto the
// same board the snake draft uses.
//
// This view is not self-rendering: it is re-mounted by the store on every
// change, and the timer lives out here so it survives that. `stopAuction` is
// exported so the view's own teardown can cancel a tick that would otherwise
// fire into a screen the player has already left.
let lotTimer = null;
let freshLot = null;   // sold-index of the lot that just went, for the flash
// What has already been said out loud, keyed by the lot it was said about.
//
// Not by the text and not cleared on teardown, both of which were tried and
// both of which are wrong for the same reason: this view is re-mounted by the
// store on every change and again on the lot timer, and `mount` runs a view's
// teardown before each of those re-mounts as well as on the way out. Anything
// reset from there is reset several times a second. Keying on the lot is what
// makes "once per lot" mean once per lot.
let saidFor = null;
export function stopAuction() { clearTimeout(lotTimer); lotTimer = null; }

/**
 * What the room says to a screen reader.
 *
 * A sale was already announced, through the toast `placeBid` raises — but only
 * for the lots the human was part of, and only once they were over. What was
 * never said is the part a bidder needs *before* deciding: who is on the block,
 * and whose turn it is. A sighted player reads both off the panel in a glance;
 * there was nothing at all to hear, on the one screen in the game with a clock.
 *
 * It says only the moments the room stops and waits for you. Announcing every
 * sale instead would be unusable: a full auction sells two hundred-odd lots,
 * most of them while the room runs itself, and `aria-live="polite"` queues
 * rather than drops — at the fast speeds that is minutes of backlog for
 * information the ticker already carries for anyone who wants it.
 *
 * Guarded on the lot rather than on the text, for the reason `saidFor` gives:
 * unguarded it would read the same line several times a second, and guarding on
 * the text instead meant a lot whose sentence happened to shorten — because the
 * purse had just been read out — was announced twice.
 */
function say(key, build) {
  if (key == null || key === saidFor) return;
  saidFor = key;
  announce(build());
}

// The purse as it was last read out, so it is only read out again when it moves.
let lastPurse = null;
function purseIfChanged(budget, left) {
  const now = `${budget}:${left}`;
  if (now === lastPurse) return '';
  lastPurse = now;
  return ` You have $${budget} and ${left} ${left === 1 ? 'slot' : 'slots'} to fill.`;
}

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.draftType !== 'auction') { ctx.navigate('#/draft'); return; }
  if (league.phase !== 'draft') { ctx.navigate('#/season'); return; }

  const a = league.auction;
  const u = league.teams.findIndex((t) => t.isUser);
  const me = league.teams[u];

  // Move the room on by one lot, then hand back so the screen can show it.
  // `advanceToUser` with a single step either reaches something the human has to
  // answer, or does one piece of business and reports back as "stalled".
  stopAuction();
  const speedName = ctx.getState().prefs?.draftSpeed || DEFAULT_SPEED;
  const speedMs = (SPEEDS.find(([n]) => n === speedName) || SPEEDS[1])[1];
  let reason = a.complete ? 'complete' : null;
  if (!reason) {
    const before = a.sold.length;
    ctx.update((s) => {
      const rng = new RNG(s.league.rngState);
      reason = speedMs === 0
        ? advanceToUser(s.league.auction, s.league, ctx.players, rng, ctx.byId, { minOverall: ui.minAsk })
        : advanceToUser(s.league.auction, s.league, ctx.players, rng, ctx.byId, { minOverall: ui.minAsk, maxSteps: 1 });
      s.league.rngState = rng.state;
    }, { silent: true });
    freshLot = a.sold.length > before ? a.sold.length - 1 : null;
    // Still the room's business: come back for the next lot on the clock.
    if (reason === 'stalled' && !a.complete) {
      lotTimer = setTimeout(() => { lotTimer = null; ctx.notify(); }, speedMs || 0);
    }
  }

  if (a.complete) return complete(root, ctx, league, u);

  const guide = priceGuide(a, league, ctx.players);
  const cap = maxAffordable(a, u, league);
  const scarcity = positionScarcity(a, league, ctx.players, guide);
  const left = slotsLeft(me);
  const open = openSlotsByPos(me);
  const sold = a.sold.length;
  const totalToSell = a.sold.length + league.teams.reduce((s, t) => s + slotsLeft(t), 0);
  const nominator = currentNominator(a, league);

  const rows = auctionRows(league, a);
  // The flash goes on the cell the newest sale landed in: its club's column,
  // and the row it took in that club's stack.
  let freshKey = null;
  if (freshLot != null && a.sold[freshLot]) {
    const sale = a.sold[freshLot];
    const upTo = a.sold.slice(0, freshLot + 1).filter((x) => x.team === sale.team).length - 1;
    freshKey = `${upTo}:${sale.team}`;
  }
  const last = a.sold[a.sold.length - 1];
  const boardCard = () => (ui.boardOpen
    ? boardOverlay(draftBoard(league, rows, {
      labels: rows.map((_, i) => String(i + 1)),
      freshKey, byId: ctx.byId, observer: u, order: a.order,
    }), { title: 'The room', sub: `${a.sold.length} lots sold` })
    : '');

  const header = html`
    <div class="card tight">
      <div class="row between" style="gap:.5rem">
        <div>
          <div class="clock">$${a.budgets[u]} left · ${left} ${left === 1 ? 'slot' : 'slots'}</div>
          <div class="muted" style="font-size:.8rem">Max bid $${cap}. You always keep $1 per unfilled slot.</div>
        </div>
        <div class="muted" style="font-size:.8rem;text-align:right;white-space:nowrap">Lot ${sold + 1}<br>of ${totalToSell}</div>
      </div>
      <div class="needs" style="margin-top:.45rem">${raw(POSITION_ORDER.filter((p) => open[p]).map((pos) => `<span class="need open">${pos} ×${open[pos]}</span>`).join('') || '<span class="need">Roster full</span>')}</div>
      <div class="btn-group" style="margin-top:.6rem"><button class="btn sm primary" id="openBoard">The room <span class="muted">${a.sold.length} sold</span></button></div>
      <div class="row between" style="align-items:baseline;gap:.5rem;flex-wrap:wrap;margin-top:.5rem">
        <div class="ticker-line">${last
          ? raw(`<span class="pick-line ${freshKey ? 'fresh' : ''}"><b>$${last.price}</b> ${teamChip(league.teams[last.team], { abbr: true }).__raw} take <b>${esc(lastName(ctx.byId.get(last.playerId)?.name || ''))}</b></span>`)
          : html`<span class="muted">The room has not sold anything yet.</span>`}</div>
        <div class="speed">${raw(SPEEDS.map(([n]) => `<button class="tab ${speedName === n ? 'active' : ''}" data-speed="${n}">${n}</button>`).join(''))}</div>
      </div>
    </div>`;

  const board = html`
    <div class="stack">
      <div class="card tight">
        <h3>Budgets</h3>
        <div class="table-wrap"><table><tbody>${raw(league.teams.map((t, i) => `<tr class="${t.isUser ? 'me' : ''}"><td>${teamChip(t, { abbr: true }).__raw}</td><td class="num"><b>$${a.budgets[i]}</b></td><td class="num muted">${slotsLeft(t)} left</td><td class="num muted">$${slotsLeft(t) ? Math.floor(a.budgets[i] / slotsLeft(t)) : 0}/slot</td></tr>`).join(''))}</tbody></table></div>
      </div>
      <div class="card tight">
        <h3>My roster (${TOTAL_SLOTS - left}/${TOTAL_SLOTS})</h3>
        ${raw(unitGrades(buildLineup(me.slots, ctx.byId)))}
      </div>
      <div class="card tight">
        <div class="slider-row">
          <div class="lbl"><span>Only ask me about players rated</span><b id="askLbl">${ui.minAsk}+</b></div>
          <input type="range" id="minAsk" min="70" max="99" step="1" value="${ui.minAsk}">
        </div>
        <button class="btn danger block" id="autoAll" data-autoall>Auto-complete my roster</button>
      </div>
    </div>`;

  let main;
  // What the room will say out loud once it is drawn, built where the lot's
  // details are already to hand rather than dug back out of the DOM. A function
  // rather than a string, so the purse is only marked as read out on the render
  // that actually says it.
  let onBlock = null;
  if (reason === 'nominate') {
    const cands = nominatable(a, league, ctx.players, u);
    const q = ui.q.trim().toLowerCase();
    const rows = cands
      .filter((p) => (ui.pos === 'ALL' || p.pos === ui.pos) && (ui.era === 'ALL' || `${Math.floor(p.season / 10) * 10}s` === ui.era) && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q))
      .sort((x, y) => (guide.prices.get(y.id) - guide.prices.get(x.id)) || overall(y) - overall(x));
    const shown = rows.slice(0, ui.limit);
    const posOpen = POSITION_ORDER.filter((p) => open[p]);
    main = html`
      <div class="card tight stack">
        <h2 style="margin:0">Your nomination</h2>
        <p class="muted" style="margin:0;font-size:.85rem">Pick anyone at a position you still need. Nominating opens the bidding at $1 from you, so you can win him cheap if the room stays quiet.</p>
        <div class="tabs" id="posTabs">${raw(['ALL', ...posOpen].map((p) => {
          const sc = p === 'ALL' ? null : scarcity[p];
          const mark = sc && sc.tight ? ' ●' : '';
          const title = sc ? ` title="${sc.drop} points from the best ${p} left down to replacement${sc.tight ? ' — tighter than most of the board right now' : ''}"` : '';
          return `<button class="tab ${ui.pos === p ? 'active' : ''}"${title} data-pos="${p}">${p}${mark}</button>`;
        }).join(''))}</div>
        <p class="muted" style="margin:.3rem 0 0;font-size:.78rem">A dot marks a position where the gap from the best man left down to replacement is bigger than most — the top of it is worth paying for. The rest will stay cheap.</p>
        <div class="tabs" id="eraTabs">${raw(['ALL', ...ERAS].map((e) => `<button class="tab ${ui.era === e ? 'active' : ''}" data-era="${e}">${e}</button>`).join(''))}</div>
        <input type="search" id="q" placeholder="Search player or team…" value="${ui.q}">
        <ul class="plist">${raw(shown.map((p) => playerItem(p, {
          action: `<button class="btn sm primary" data-nom="${esc(p.id)}">$${guide.prices.get(p.id)}</button>`,
        })).join(''))}</ul>
        ${shown.length === 0 ? html`<p class="empty">Nothing available matches.</p>` : ''}
        ${rows.length > shown.length ? html`<button class="btn block" id="more">Show more (${rows.length - shown.length} left)</button>` : ''}
      </div>`;
  } else if (reason === 'bid' && a.current) {
    const p = ctx.byId.get(a.current.playerId);
    const ask = guide.prices.get(p.id) ?? MIN_BID;
    const mine = a.current.nominator === u;
    if (ui.bid == null) ui.bid = Math.min(cap, Math.max(MIN_BID, ask));
    const presets = [...new Set([MIN_BID, Math.round(ask * 0.7), ask, Math.round(ask * 1.3), cap])]
      .filter((v) => v >= MIN_BID && v <= cap).sort((x, y) => x - y);
    // What you have to spend goes on the end only when it has changed since it
    // was last said. It moves when you win a lot, and that is announced on its
    // own, so repeating it on every lot is a third of the sentence spent on
    // something the listener was told a moment ago.
    onBlock = () => `On the block: ${p.name}, ${POSITIONS[p.pos].name}, ${overall(p)} overall, asking $${ask}.`
      + (mine ? ' Your nomination.' : ` Nominated by ${league.teams[a.current.nominator].name}.`)
      + purseIfChanged(a.budgets[u], left);
    main = html`
      <div class="card stack">
        <div class="row between"><h2 style="margin:0">On the block</h2><small class="muted">${mine ? 'Your nomination' : `Nominated by ${league.teams[a.current.nominator].abbr}`}</small></div>
        <div class="row" style="gap:.6rem;flex-wrap:nowrap;align-items:flex-start">
          ${ovrBadge(p)}
          <div style="min-width:0">
            <div style="font-weight:800;font-size:1.05rem">${p.name} ${posBadge(p.pos)}</div>
            <div class="muted" style="font-size:.85rem">${p.season} ${p.team} · asking <b>$${ask}</b></div>
          </div>
        </div>
        <div class="attrs row" style="gap:.1rem .6rem">${raw(attrRow(p))}</div>
        ${raw(lotPanel(a, league, ctx, u, p, guide))}
        ${mine ? html`<p class="muted" style="margin:0;font-size:.82rem">You opened at $1. Set your maximum, or pass and hope nobody else bids.</p>` : ''}
        <div class="slider-row">
          <div class="lbl"><span>Your maximum</span><b id="bidLbl">$${ui.bid}</b></div>
          <input type="range" id="bidRange" min="${MIN_BID}" max="${cap}" step="1" value="${ui.bid}">
        </div>
        <div class="btn-group">${presets.map((v) => html`<button class="btn sm" data-preset="${v}">$${v}</button>`)}</div>
        <div class="btn-group">
          <button class="btn primary lg" id="bid">Bid up to <span id="bidBtnVal">$${ui.bid}</span></button>
          <button class="btn lg" id="pass">Pass</button>
        </div>
        <small class="muted">The highest maximum wins and pays $1 more than the runner-up, so bidding your true limit costs you nothing.</small>
      </div>`;
  } else {
    main = html`<div class="card"><p class="empty">Waiting on the room…</p><button class="btn block" data-autoall>Auto-complete my roster</button></div>`;
  }

  render(root, html`<div id="auction-view">
    ${header}
    ${raw(boardCard())}
    <details class="card tight" id="valueGuide" style="margin-top:.5rem">
      <summary style="cursor:pointer"><b>Where money wins games</b> <span class="muted">${valueHint()}</span></summary>
      ${valuePanel()}
    </details>
    <div class="grid grid-3" style="margin-top:.75rem">${main}${board}</div>
  </div>`);

  if (reason === 'bid' && a.current) say(`lot:${a.current.playerId}`, onBlock);
  else if (reason === 'nominate') {
    say(`nom:${a.sold.length}`, () => {
      // The purse always goes with the nomination: it is the moment you choose
      // what to spend on, so it is news whether or not it has moved.
      lastPurse = `${a.budgets[u]}:${left}`;
      return `Your nomination. $${a.budgets[u]} left, ${left} ${left === 1 ? 'slot' : 'slots'} to fill. Pick anyone at a position you still need.`;
    });
  }

  const el = root.querySelector('#auction-view');
  el.querySelector('.speed')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (b) ctx.update((s) => { s.prefs.draftSpeed = b.dataset.speed; });
  });
  el.querySelector('#openBoard')?.addEventListener('click', () => { ui.boardOpen = true; freshLot = null; view(root, params, ctx); });
  el.querySelector('#boardClose')?.addEventListener('click', () => { ui.boardOpen = false; view(root, params, ctx); });
  if (ui.boardOpen) scrollToPick(root, { onlyFresh: true });
  const redraw = () => view(root, params, ctx);

  el.querySelector('#minAsk')?.addEventListener('input', (e) => { el.querySelector('#askLbl').textContent = `${e.target.value}+`; });
  el.querySelector('#minAsk')?.addEventListener('change', (e) => { ui.minAsk = Number(e.target.value); redraw(); });
  // Two of these render at once — one beside the roster, one in the panel that
  // shows while the room is bidding on somebody else — and they shared an id,
  // so `querySelector` bound the first and the other was a button that did
  // nothing when pressed. Bind by attribute and both work; the id stays on one
  // so anything addressing it still can.
  el.querySelectorAll('[data-autoall]').forEach((b) => b.addEventListener('click', (e) => {
    // Filling every remaining seat runs the rest of the room, which measures
    // over a second on a desktop and several on a phone.
    withBusy(e.currentTarget, () => {
      ctx.update((s) => {
        const rng = new RNG(s.league.rngState);
        autoCompleteAll(s.league.auction, s.league, ctx.players, rng, ctx.byId);
        s.league.rngState = rng.state;
      });
    }, 'Completing…');
  }));

  el.querySelector('#posTabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-pos]'); if (b) { ui.pos = b.dataset.pos; ui.limit = 60; redraw(); } });
  el.querySelector('#eraTabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-era]'); if (b) { ui.era = b.dataset.era; ui.limit = 60; redraw(); } });
  el.querySelector('#more')?.addEventListener('click', () => { ui.limit += 60; redraw(); });
  el.querySelector('#q')?.addEventListener('input', (e) => {
    ui.q = e.target.value; ui.limit = 60;
    const pos = e.target.selectionStart;
    redraw();
    const input = root.querySelector('#q'); input.focus(); input.setSelectionRange(pos, pos);
  });

  const range = el.querySelector('#bidRange');
  if (range) {
    const sync = (v) => {
      ui.bid = Number(v);
      el.querySelector('#bidLbl').textContent = `$${ui.bid}`;
      el.querySelector('#bidBtnVal').textContent = `$${ui.bid}`;
      range.value = ui.bid;
    };
    range.addEventListener('input', (e) => sync(e.target.value));
    el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => sync(b.dataset.preset)));
    el.querySelector('#bid').addEventListener('click', () => placeBid(ui.bid));
    el.querySelector('#pass').addEventListener('click', () => placeBid(0));
  }

  el.addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) { playerModal(ctx.byId.get(show.dataset.show), priceNote(guide, show.dataset.show)); return; }
    const nom = e.target.closest('[data-nom]');
    if (nom) {
      ctx.update((s) => { nominate(s.league.auction, s.league, ctx.players, nom.dataset.nom, ctx.byId); }, { silent: true });
      ui.bid = null; ui.q = '';
      redraw();
    }
  });

  function placeBid(max) {
    const player = ctx.byId.get(a.current.playerId);
    let sale = null;
    ctx.update((s) => {
      const rng = new RNG(s.league.rngState);
      sale = settle(s.league.auction, s.league, ctx.players, rng, ctx.byId, max);
      s.league.rngState = rng.state;
    }, { silent: true });
    ui.bid = null;
    if (sale) {
      const t = league.teams[sale.team];
      toast(sale.team === u ? `You bought ${player.name} for $${sale.price}` : `${t.abbr} took ${player.name} for $${sale.price}`);
    }
    redraw();
  }

  // Leaving the room cancels the lot that was about to be called.
  return stopAuction;
}

function attrRow(p) {
  return Object.entries(p.r).map(([k, v]) => `<span class="attr ${v >= 92 ? 'hi' : v <= 70 ? 'lo' : ''}">${k} <b>${v}</b></span>`).join('');
}

function priceNote(guide, id) {
  const ask = guide.prices.get(id);
  return ask ? `<p class="muted">Asking price $${ask}.</p>` : '';
}

/**
 * What losing this lot would mean. An auction does not turn on what a man is
 * worth — the price guide has said that all along — but on what you get instead
 * if somebody outbids you, and whether anybody still can.
 */
function lotPanel(a, league, ctx, u, p, guide) {
  const adv = lotAdvice(a, league, ctx.players, ctx.byId, u, p, guide, { currentBid: a.current?.bid ?? MIN_BID });
  const next = adv.next ? ctx.byId.get(adv.next.id) : null;
  // Red only where it matters: a slot you are forced to fill at any price. The
  // gap to the next man is never big enough here to warrant a colour of its own.
  const gapClass = adv.mustFill ? 'overpay' : '';
  const chips = [
    adv.next
      ? `<span class="badge ${gapClass}" title="The best man left at this position if you lose him">next: ${esc(lastNameOf(next.name))} ${adv.next.ovr} · $${adv.next.ask}</span>`
      : '<span class="badge overpay">last one at this position</span>',
    `<span class="badge ${adv.scarcity.tight ? 'bargain' : ''}" title="Gap from the best ${p.pos} left down to replacement level, against the rest of the board">${p.pos} ${adv.scarcity.tight ? 'tight' : 'deep'}</span>`,
    `<span class="badge rivals" title="Clubs that still have a slot for a ${p.pos} and can afford to raise the bid. Not what they would pay — that is theirs to decide.">${adv.rivals} can still bid</span>`,
  ].join(' ');
  return `<div class="lot-advice">
    <div class="row" style="gap:.3rem;flex-wrap:wrap">${chips}</div>
    <p class="muted" style="margin:.3rem 0 0;font-size:.8rem">${esc(lotNote(adv, next ? lastNameOf(next.name) : null))}</p>
  </div>`;
}

/** Boards and chips are narrow; a surname carries the man. */
function lastNameOf(name) {
  const bits = String(name).trim().split(/\s+/);
  return bits.length > 1 ? bits[bits.length - 1] : name;
}

/** Live unit grades, so you can see the holes you are leaving as you spend. */
function unitGrades(lineup) {
  const want = { QB: 1, RB: 2, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, CB: 2, S: 2, K: 1, P: 1 };
  const rows = Object.entries(want).map(([pos, n]) => {
    const arr = (lineup[pos] || []).slice(0, n);
    const avg = arr.length ? Math.round(arr.reduce((s, p) => s + overall(p), 0) / arr.length) : 0;
    const filled = (lineup[pos] || []).length;
    return `<dt>${pos} <small class="muted">${filled}/${n}</small></dt><dd><div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${avg}%"></i></div><b style="min-width:2rem;text-align:right">${avg || '—'}</b></div></dd>`;
  });
  return `<div class="kv">${rows.join('')}</div>`;
}

function complete(root, ctx, league, u) {
  const a = league.auction;
  const me = league.teams[u];
  const buys = a.sold.filter((s) => s.team === u).sort((x, y) => y.price - x.price);
  const spent = buys.reduce((s, x) => s + x.price, 0);
  const lineup = buildLineup(me.slots, ctx.byId);
  render(root, html`<div id="auction-done">
    <div class="card">
      <h1 style="margin:0">Auction complete</h1>
      <p class="muted">You spent $${spent} of $${a.startBudgets ? a.startBudgets[u] : a.budget} on ${buys.length} players. $${a.budgets[u]} left on the table.${league.offseason ? ` Season ${league.season} is next.` : ''}</p>
      <button class="btn primary lg block" id="start">Start the season</button>
    </div>
    <div class="grid grid-3" style="margin-top:.75rem">
      <div class="card tight">
        <h3>What you bought</h3>
        <ul class="plist">${raw(buys.map((s) => playerItem(ctx.byId.get(s.playerId), { attrs: false, meta: ` · <b>$${s.price}</b>` })).join(''))}</ul>
      </div>
      <div class="stack">
        <div class="card tight"><h3>Your units</h3>${raw(unitGrades(lineup))}</div>
        <div class="card tight">
          <h3>Biggest sales</h3>
          <ul class="plain ticker">${raw(a.sold.slice().sort((x, y) => y.price - x.price).slice(0, 10).map((s) => {
            const p = ctx.byId.get(s.playerId);
            const t = league.teams[s.team];
            return `<li class="${t.isUser ? 'me' : ''}"><b>$${s.price}</b> ${teamChip(t, { abbr: true }).__raw} — ${esc(p.name)} <small class="muted">${p.pos}</small></li>`;
          }).join(''))}</ul>
        </div>
      </div>
    </div>
  </div>`);
  root.querySelector('#start').addEventListener('click', () => {
    ctx.update((s) => { startSeason(s.league, ctx.byId); }, { silent: true });
    ctx.navigate('#/season');
  });
  root.querySelector('#auction-done').addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) playerModal(ctx.byId.get(show.dataset.show));
  });
}
