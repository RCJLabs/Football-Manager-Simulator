import { html, render, raw } from '../../util.js';
import { POSITION_ORDER, ROSTER_SLOTS } from '../../data/positions.js';
import { ERAS } from '../../data/db.js';
import { overall, buildLineup } from '../../engine/ratings.js';
import { RNG } from '../../engine/rng.js';
import { startSeason } from '../../engine/season.js';
import {
  advanceToUser, nominate, settle, priceGuide, maxAffordable, slotsLeft, openSlotsByPos,
  currentNominator, nominatable, autoCompleteAll, autoUserMax, canRoster, MIN_BID, TOTAL_SLOTS,
} from '../../engine/auction.js';
import { playerItem, playerModal, teamChip, toast, ovrBadge, esc, posBadge } from '../components.js';

const ui = { pos: 'ALL', era: 'ALL', q: '', minAsk: 85, bid: null, limit: 60 };

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.draftType !== 'auction') { ctx.navigate('#/draft'); return; }
  if (league.phase !== 'draft') { ctx.navigate('#/season'); return; }

  const a = league.auction;
  const u = league.teams.findIndex((t) => t.isUser);
  const me = league.teams[u];

  // Run the room forward until it needs the human.
  let reason = a.complete ? 'complete' : null;
  if (!reason) {
    ctx.update((s) => {
      const rng = new RNG(s.league.rngState);
      reason = advanceToUser(s.league.auction, s.league, ctx.players, rng, ctx.byId, { minOverall: ui.minAsk });
      s.league.rngState = rng.state;
    }, { silent: true });
  }

  if (a.complete) return complete(root, ctx, league, u);

  const guide = priceGuide(a, league, ctx.players);
  const cap = maxAffordable(a, u, league);
  const left = slotsLeft(me);
  const open = openSlotsByPos(me);
  const sold = a.sold.length;
  const totalToSell = league.teams.length * TOTAL_SLOTS;
  const nominator = currentNominator(a, league);

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
    </div>`;

  const board = html`
    <div class="stack">
      <div class="card tight">
        <h3>Recent lots</h3>
        <ul class="plain ticker">${raw(a.sold.slice(-12).reverse().map((s) => {
          const p = ctx.byId.get(s.playerId);
          const t = league.teams[s.team];
          return `<li class="${t.isUser ? 'me' : ''}"><b>$${s.price}</b> ${teamChip(t, { abbr: true }).__raw} — ${esc(p.name)} <small class="muted">${p.pos} · ${p.season}</small></li>`;
        }).join('') || '<li class="muted">No lots sold yet.</li>')}</ul>
      </div>
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
        <button class="btn danger block" id="autoAll">Auto-complete my roster</button>
      </div>
    </div>`;

  let main;
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
        <div class="tabs" id="posTabs">${raw(['ALL', ...posOpen].map((p) => `<button class="tab ${ui.pos === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join(''))}</div>
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
    main = html`<div class="card"><p class="empty">Waiting on the room…</p><button class="btn block" id="autoAll">Auto-complete my roster</button></div>`;
  }

  render(root, html`<div id="auction-view">
    ${header}
    <div class="grid grid-3" style="margin-top:.75rem">${main}${board}</div>
  </div>`);

  const el = root.querySelector('#auction-view');
  const redraw = () => view(root, params, ctx);

  el.querySelector('#minAsk')?.addEventListener('input', (e) => { el.querySelector('#askLbl').textContent = `${e.target.value}+`; });
  el.querySelector('#minAsk')?.addEventListener('change', (e) => { ui.minAsk = Number(e.target.value); redraw(); });
  el.querySelector('#autoAll')?.addEventListener('click', () => {
    ctx.update((s) => {
      const rng = new RNG(s.league.rngState);
      autoCompleteAll(s.league.auction, s.league, ctx.players, rng, ctx.byId);
      s.league.rngState = rng.state;
    });
  });

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
}

function attrRow(p) {
  return Object.entries(p.r).map(([k, v]) => `<span class="attr ${v >= 92 ? 'hi' : v <= 70 ? 'lo' : ''}">${k} <b>${v}</b></span>`).join('');
}

function priceNote(guide, id) {
  const ask = guide.prices.get(id);
  return ask ? `<p class="muted">Asking price $${ask}.</p>` : '';
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
      <p class="muted">You spent $${spent} of $${a.budget} on ${buys.length} players. $${a.budgets[u]} left on the table.</p>
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
