import { html, render, raw } from '../../util.js';
import { ROSTER_SLOTS, POSITION_ORDER } from '../../data/positions.js';
import { overall } from '../../engine/ratings.js';
import { userTeamIndex, newSeasonSameRosters, standings } from '../../engine/season.js';
import { PLAYERS } from '../../data/db.js';
import {
  keeperCost, keeperEligible, keeperLimit, validateKeepers, enterOffseason, aiKeepers, confirmKeepers, closeFreeAgency, seasonSummary, MAX_KEEPS,
} from '../../engine/offseason.js';
import { playerItem, playerModal, teamChip, toast, esc, modal } from '../components.js';
import { simulateAhead, describeRun } from '../../engine/autosim.js';
import { scoutingHits, scoutingOn } from '../../engine/scouting.js';
import { takeJob } from '../../engine/offseason.js';
import { jobsOn, yourCoach, careerSummary, coachOf } from '../../engine/jobs.js';
import { RNG } from '../../engine/rng.js';
import { capOn, capHit, PRO_CAP } from '../../engine/cap.js';
import { keeperBoard, keeperAdvice } from '../../engine/market.js';
import {
  askingBoard, biddingRoom, openCount, submitOffer, freeAgencyReport, AI_FA_SHARE,
} from '../../engine/freeagency.js';

const ui = { picked: null, leagueId: null, season: null };
const faUi = { pos: 'ALL', limit: 40 };

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.phase === 'draft') { ctx.navigate(league.draftType === 'auction' ? '#/auction' : '#/draft'); return; }
  if (league.phase !== 'complete' && league.phase !== 'offseason') { ctx.navigate('#/season'); return; }
  if (league.phase === 'complete') {
    ctx.update((s) => { enterOffseason(s.league, ctx.players, ctx.byId); }, { silent: true });
  }
  // Sacked: the owners have moved, and nothing else in the offseason happens
  // until you have somewhere to work.
  if (league.phase === 'offseason' && league.offseason.step === 'jobs') { jobMarket(root, league, ctx); return; }
  // The market before the draft: the same men, but certainty costs money.
  if (league.phase === 'offseason' && league.offseason.step === 'freeagency') { freeAgency(root, league, ctx); return; }
  if (jobsOn(league) && league.jobs.status === 'retired') { careerOver(root, league, ctx); return; }

  const u = userTeamIndex(league);
  const me = league.teams[u];
  const auction = league.draftType === 'auction';
  const capped = capOn(league);
  const money = capped ? (league.cap ?? PRO_CAP) : 200;
  const limit = keeperLimit(league);
  if (ui.leagueId !== league.id || ui.season !== league.season || !ui.picked) { ui.leagueId = league.id; ui.season = league.season; ui.picked = new Set(); }
  const picked = [...ui.picked].filter((id) => ROSTER_SLOTS.some((s) => me.slots[s.id] === id));
  ui.picked = new Set(picked);
  const v = validateKeepers(league, u, picked, ctx.byId);
  const summary = seasonSummary(league);
  const table = standings(league);
  const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], k = n % 100; return n + (s[(k - 20) % 10] || s[k] || s[0]); };

  // Keeping a man has always shown its price and never its value. The auction's
  // own guide knows what the room would pay to buy him back, and the difference
  // is the entire decision — it is the number `aiKeepers` has always ranked on.
  const board = keeperBoard(league, ctx.players || PLAYERS, ctx.byId, u);
  const kb = new Map(board.rows.map((r) => [r.id, r]));
  // Best value first, so the bargains are the rows you read. Sorting by
  // position put a kicker you must not keep above a quarterback you must.
  const groups = [{
    pos: 'Best value first',
    rows: board.rows.map((r) => ({ p: ctx.byId.get(r.id), c: league.contracts[r.id] || {} })).filter((x) => x.p),
  }];

  const rowFor = ({ p, c }) => {
    const on = ui.picked.has(p.id);
    const eligible = keeperEligible(c, league);
    const cost = keeperCost(c, p, league);
    const r = kb.get(p.id);
    const verdict = r && r.surplus != null && eligible
      ? ` <span class="badge ${r.surplus >= 3 ? 'bargain' : r.surplus > -3 ? '' : 'overpay'}" title="${esc(keeperAdvice(r))}">${r.surplus > 0 ? `saves $${r.surplus}` : r.surplus === 0 ? 'market price' : `$${-r.surplus} over`}</span>`
      : '';
    const meta = auction
      ? ` · last <b>$${c.salary ?? 1}</b>${eligible ? ` → keep at <b>$${cost}</b> <span class="muted">(market $${r?.market ?? '?'})</span>` : ''}${verdict}${c.kept ? ` · kept ${c.kept}×` : ''}`
      : capped
        // A deal that has run out is the whole decision on this screen: he is
        // still yours, and he now costs what he is worth rather than what he
        // was paid on a rookie contract.
        ? ` · <b>$${c.salary ?? 1}</b>${c.expiring ? ` · <span class="badge out">deal up</span> re-sign at <b>$${cost}</b>` : ` · ${c.years ?? '?'}y left`}`
        : ` · round ${c.round ?? '—'}${c.kept ? ` · kept ${c.kept}×` : ''}`;
    const action = eligible
      ? `<button class="btn sm ${on ? 'primary' : ''}" data-keep="${esc(p.id)}">${on ? 'Keeping' : 'Keep'}</button>`
      : `<span class="badge out" title="kept ${MAX_KEEPS} years running">must return</span>`;
    return playerItem(p, { attrs: false, cls: on ? 'me' : eligible ? '' : 'dim', meta, action });
  };

  const aiTable = league.teams.map((t, i) => {
    if (t.isUser) return '';
    const ids = league.offseason.keepers[i] || [];
    const cost = (auction || capped) ? ids.reduce((s, id) => s + keeperCost(league.contracts[id], ctx.byId.get(id), league), 0) : 0;
    return `<tr><td>${teamChip(t, { responsive: true }).__raw}</td><td class="num">${ids.length}</td>${auction || capped ? `<td class="num">$${cost}</td><td class="num muted">$${money - cost}</td>` : ''}<td class="hide-sm muted" style="font-size:.8rem">${ids.map((id) => esc(ctx.byId.get(id)?.name)).join(', ') || '—'}</td></tr>`;
  }).join('');

  // A year passed: who grew into something, who is going, who is gone.
  const off = league.offseason;
  const movers = (list, dir) => list.map((m) => `${esc(m.name)} <span class="muted">${m.pos} ${m.age}</span> ${m.from}<b>${dir}</b>${m.to}`).join(' · ');
  const yearOlder = off.aged ? html`<div class="card tight" style="margin-top:.5rem">
    <h3>A year older <small class="muted" style="text-transform:none;letter-spacing:0">· ${off.aged} careers running</small></h3>
    ${!off.risers?.length && !off.fallers?.length && !off.retired?.length ? html`<p class="muted" style="font-size:.9rem;margin:.2rem 0">Nobody moved more than a couple of points this year. Ageing is slow; it is the third and fourth seasons that show.</p>` : ''}
    ${off.risers?.length ? html`<p style="font-size:.9rem;margin:.2rem 0"><b>Improved.</b> ${raw(movers(off.risers, '→'))}</p>` : ''}
    ${off.fallers?.length ? html`<p style="font-size:.9rem;margin:.2rem 0"><b>Declined.</b> ${raw(movers(off.fallers, '→'))}</p>` : ''}
    ${off.retired?.length ? html`<p style="font-size:.9rem;margin:.2rem 0"><b>Retired.</b> ${raw(off.retired.map((r) => `${esc(r.name)} <span class="muted">${r.pos}, ${r.age}</span>`).join(' · '))} — their slots are empty and the market fills them.</p>` : ''}
    <small class="muted">Rostered players age each offseason; everyone still in the pool waits at his prime. Keep that in mind before you pay a keeper's raise.</small>
  </div>` : '';

  // Last year's class, one season on: what you projected against what happened.
  // Fog is only worth having if you find out afterwards whether you were right.
  const seen = scoutingOn(league) ? scoutingHits(league, ctx.players, league.teams.findIndex((t) => t.isUser)) : [];
  const scoutCard = seen.length ? html`<div class="card tight" style="margin-top:.5rem">
    <h3>Last year's rookies <small class="muted" style="text-transform:none;letter-spacing:0">· one season on</small></h3>
    <div class="table-wrap"><table style="font-size:.88rem"><thead><tr><th>Player</th><th></th><th class="num">Projected</th><th class="num">Now</th><th class="hide-sm">First year</th></tr></thead><tbody>
      ${seen.slice(0, 8).map((h) => html`<tr><td>${h.name}</td><td class="muted">${h.pos}</td><td class="num muted">${h.low}–${h.high}</td><td class="num"><b>${h.now}</b> ${h.moved >= 0 ? `+${h.moved}` : h.moved}</td><td class="hide-sm muted">${h.verdict}</td></tr>`)}
    </tbody></table></div>
    <small class="muted">A projection is a career range, not a first-year target — the top of it is four or five seasons away. What one season tells you is the direction.</small>
  </div>` : '';

  render(root, html`<div id="offseason-view">
    <div class="card">
      <h1 style="margin:0">Offseason · after season ${league.offseason.season}</h1>
      ${league.offseason.rookies ? html`<p class="notice" style="margin:.5rem 0 0"><b>${league.offseason.rookies} rookies</b> entered the pool${league.offseason.washedOut ? `, and ${league.offseason.washedOut} unsigned from earlier classes washed out` : ''}. <a href="#/players">Look them over</a> before the ${auction ? 'auction' : 'draft'}.</p>` : ''}
      ${summary ? html`<p class="muted" style="margin:.3rem 0 0">${teamChip(summary.champion)} won the title. You finished <b>${ord(summary.user.rank)}</b> of ${summary.teams} at ${summary.user.record.w}-${summary.user.record.l}${summary.user.record.t ? `-${summary.user.record.t}` : ''}.</p>` : ''}
      <p class="muted" style="font-size:.9rem;margin:.5rem 0 0">
        ${auction
          ? html`Keep up to <b>${limit}</b> players. A keeper costs last year's price plus the greater of $3 or 15%, and a player can be kept three years running before he must go back to the pool. Everyone else returns to the pool and the remaining cap buys the rest at auction. The worst club nominates first.`
          : html`Keep up to <b>${limit}</b> players; they hold their slots. Everyone else returns to the pool and a draft fills the rest, worst club first. A player can be kept three years running before he must go back to the pool.`}
      </p>
    </div>
    ${yearOlder}
    ${scoutCard}
    <div class="grid grid-2" style="margin-top:.75rem">
      <div class="card tight">
        <h3>Your keepers <small class="muted" style="text-transform:none;letter-spacing:0">· ${picked.length} of ${limit}</small></h3>
        ${auction ? html`<p class="muted" style="margin:0 0 .3rem;font-size:.8rem">A keeper is worth having when he costs less than the room would pay to buy him back. Green saves you money; red is an overpay you should let the auction settle.</p>` : ''}
        ${capped ? html`<p class="muted" style="margin:0 0 .3rem;font-size:.8rem">Men still under contract cost what they are being paid. A deal that has run out is marked, and re-signing him costs what he is now worth — which is where a cap actually hurts.</p>` : ''}
        ${raw(groups.map((g) => `<div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;margin:.5rem 0 .2rem">${g.pos}</div><ul class="plist">${g.rows.map(rowFor).join('')}</ul>`).join(''))}
      </div>
      <div class="stack">
        <div class="card tight" style="position:sticky;top:.5rem;z-index:5">
          <h3>${auction || capped ? 'Cap' : 'Summary'}</h3>
          ${auction || capped ? html`
            <div class="kv">
              <dt>${capped ? 'On the books' : 'Keepers'}</dt><dd><b>$${v.committed ?? 0}</b> for ${picked.length}</dd>
              <dt>${capped ? 'Left under the cap' : 'For the auction'}</dt><dd><b>$${v.ok ? v.budget : Math.max(0, money - (v.committed ?? 0))}</b> across ${ROSTER_SLOTS.length - picked.length} slots</dd>
            </div>
            <div class="bar" style="margin:.4rem 0"><i style="width:${Math.min(100, ((v.committed ?? 0) / money) * 100)}%"></i></div>` : html`<p class="muted" style="margin:0">${picked.length} kept, ${ROSTER_SLOTS.length - picked.length} to draft.</p>`}
          ${v.ok ? '' : html`<p class="notice" style="margin:.4rem 0">${v.reason}</p>`}
          <div class="btn-group" style="margin-top:.5rem">
            <button class="btn primary lg" id="confirm" ${v.ok ? '' : 'disabled'}>Confirm keepers and open the ${auction ? 'auction' : 'draft'}</button>
            <button class="btn" id="autoKeep">Pick my keepers for me</button>
            <button class="btn ghost" id="clear">Clear</button>
          </div>
          <button class="btn block" id="skipOff" style="margin-top:.4rem">Skip it: pick my keepers and run the market</button>
          <details style="margin-top:.6rem"><summary class="muted" style="cursor:pointer;font-size:.85rem">Skip contracts and run it back with the same rosters</summary>
            <button class="btn danger sm" id="runBack" style="margin-top:.4rem">Same rosters, season ${league.season + 1}</button></details>
        </div>
        <div class="card tight">
          <h3>What the other clubs kept</h3>
          <div class="table-wrap"><table><thead><tr><th>Club</th><th class="num">Kept</th>${auction ? '<th class="num">Cost</th><th class="num">Cap left</th>' : ''}<th class="hide-sm">Who</th></tr></thead><tbody>${raw(aiTable)}</tbody></table></div>
        </div>
        <div class="card tight">
          <h3>Final table · season ${league.offseason.season}</h3>
          <div class="table-wrap"><table><tbody>${raw(table.map((r, i) => `<tr class="${r.team.isUser ? 'me' : ''}"><td>${i + 1}</td><td>${teamChip(r.team, { responsive: true }).__raw}${league.champion === r.idx ? ' 🏆' : ''}</td><td class="num">${r.w}-${r.l}${r.t ? `-${r.t}` : ''}</td><td class="num hide-sm">${r.diff > 0 ? '+' : ''}${r.diff}</td></tr>`).join(''))}</tbody></table></div>
        </div>
      </div>
    </div>
  </div>`);

  const el = root.querySelector('#offseason-view');
  const redraw = () => view(root, params, ctx);
  el.addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) { playerModal(ctx.byId.get(show.dataset.show)); return; }
    const k = e.target.closest('[data-keep]');
    if (k) {
      const id = k.dataset.keep;
      if (ui.picked.has(id)) ui.picked.delete(id);
      else if (ui.picked.size >= limit) toast(`At most ${limit} keepers`);
      else ui.picked.add(id);
      redraw();
    }
  });
  el.querySelector('#clear').addEventListener('click', () => { ui.picked.clear(); redraw(); });
  el.querySelector('#autoKeep').addEventListener('click', () => {
    ui.picked = new Set(aiKeepers(league, u, ctx.players, ctx.byId, null));
    toast(ui.picked.size ? `Kept ${ui.picked.size} on value` : 'Nothing on this roster is worth its keeper price');
    redraw();
  });
  el.querySelector('#confirm').addEventListener('click', () => {
    try {
      ctx.update((s) => { confirmKeepers(s.league, [...ui.picked], ctx.players, ctx.byId); }, { silent: true });
      ui.picked = new Set();
      ctx.navigate(auction ? '#/auction' : '#/draft');
    } catch (err) { toast(err.message); }
  });
  el.querySelector('#skipOff').addEventListener('click', () => {
    let result;
    ctx.update((s) => {
      const rng = new RNG(s.league.rngState);
      result = simulateAhead(s.league, ctx.byId, ctx.players, rng, 'nextSeason');
      s.league.rngState = rng.state;
      s.game = null;
    }, { silent: true });
    toast(describeRun(result));
    ctx.navigate('#/season');
  });
  el.querySelector('#runBack').addEventListener('click', () => {
    const m = modal(html`<h2>Skip the offseason?</h2><p class="muted">Same rosters, no contracts, season ${league.season + 1} starts now.</p><div class="row"><button class="btn primary" id="yes">Run it back</button><button class="btn" data-close>Cancel</button></div>`);
    m.el.querySelector('#yes').addEventListener('click', () => {
      m.close();
      ctx.update((s) => { s.league.offseason = null; s.league.phase = 'complete'; newSeasonSameRosters(s.league, ctx.byId); s.game = null; });
      ctx.navigate('#/season');
    });
  });
  void PLAYERS;
}

/** The offer screen: who wants you, what they expect, and how long you get. */
/**
 * Free agency: sealed bids, then the draft.
 *
 * The screen has one job beyond taking offers, which is to make the trade-off
 * legible. Every man here will also be in the draft, so a bid buys certainty
 * rather than a player — and because a club's picks are its open slots, each
 * signing quietly costs a pick. Both of those are said out loud, because
 * neither is guessable from a list of names and prices.
 */
function freeAgency(root, league, ctx) {
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const cap = league.cap ?? PRO_CAP;
  const offers = league.freeAgency?.offers?.[u] || {};
  const mine = Object.entries(offers);
  const room = biddingRoom(league, u);
  const open = openCount(me);
  const board = askingBoard(league, ctx.players || PLAYERS, { limit: 400 })
    .filter((r) => faUi.pos === 'ALL' || r.pos === faUi.pos)
    .filter((r) => ROSTER_SLOTS.some((sl) => sl.pos === r.pos && !me.slots[sl.id]));
  const shown = board.slice(0, faUi.limit);

  const row = (r) => {
    const p = ctx.byId.get(r.id);
    if (!p) return '';
    const bid = offers[r.id];
    const meta = ` · asking <b>$${r.ask}</b>${bid ? ` · <span class="badge bargain">you bid $${bid}</span>` : ''}`;
    const action = `<button class="btn sm ${bid ? 'primary' : ''}" data-bid="${esc(r.id)}">${bid ? 'Raise' : 'Bid'}</button>`;
    return playerItem(p, { attrs: false, meta, action, cls: bid ? 'me' : '' });
  };

  render(root, html`<div id="fa-view">
    <div class="card tight">
      <h2 style="margin:.1rem 0">Free agency</h2>
      <details class="tight" style="margin:.2rem 0 .5rem">
        <summary style="cursor:pointer;font-size:.85rem" class="muted"><b>What bidding actually buys</b> · certainty, and it costs a pick</summary>
        <p class="muted" style="margin:.3rem 0 0;font-size:.85rem">
          Everybody here goes into the draft if nobody signs them, so a bid does not win you a player you could not otherwise have — it wins you the <b>certainty</b> of him, at market price instead of rookie money. And it costs a pick: a club drafts as many times as it has slots left, so sign four and you draft four times fewer.
        </p>
      </details>
      <div class="kv">
        <dt>On the books</dt><dd><b>$${capHit(league, u)}</b> of $${cap}</dd>
        <dt>Left to bid</dt><dd><b>$${room}</b></dd>
        <dt>Slots open</dt><dd><b>${open}</b> · ${mine.length} bid on</dd>
      </div>
      <div class="bar" style="margin:.4rem 0"><i style="width:${Math.min(100, Math.max(0, (1 - room / cap) * 100))}%"></i></div>
      <button class="btn primary block" id="faDone">Close the market and draft</button>
    </div>

    ${mine.length ? html`<div class="card tight" style="margin-top:.5rem">
      <h3>Your offers <small class="muted" style="text-transform:none;letter-spacing:0">· $${mine.reduce((a, [, v]) => a + v, 0)} committed if they all land</small></h3>
      <ul class="plist">${raw(mine.map(([id, v]) => {
        const p = ctx.byId.get(id);
        // playerItem returns a string, not an html`` object — asking it for
        // `.__raw` got undefined and drew an empty list.
        return p ? playerItem(p, { attrs: false, meta: ` · <b>$${v}</b>`, action: `<button class="btn sm" data-drop="${esc(id)}">Pull out</button>` }) : '';
      }).join(''))}</ul>
    </div>` : ''}

    <div class="card tight" style="margin-top:.5rem">
      <h3>On the market <small class="muted" style="text-transform:none;letter-spacing:0">· ${board.length} you have room for</small></h3>
      <div class="tabs" id="faPos">${raw(['ALL', ...POSITION_ORDER].map((pp) => `<button class="tab ${faUi.pos === pp ? 'active' : ''}" data-pos="${pp}">${pp}</button>`).join(''))}</div>
      ${board.length ? html`<ul class="plist">${raw(shown.map(row).join(''))}</ul>` : html`<p class="empty">No open slots left to fill.</p>`}
      ${board.length > shown.length ? html`<button class="btn sm block" id="faMore">Show more</button>` : ''}
    </div>
  </div>`);

  const el = root.querySelector('#fa-view');
  el.querySelector('#faPos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pos]');
    if (b) { faUi.pos = b.dataset.pos; faUi.limit = 40; freeAgency(root, league, ctx); }
  });
  el.querySelector('#faMore')?.addEventListener('click', () => { faUi.limit += 40; freeAgency(root, league, ctx); });
  el.addEventListener('click', (e) => {
    const drop = e.target.closest('[data-drop]');
    if (drop) {
      ctx.update((st) => { submitOffer(st.league, u, drop.dataset.drop, 0, ctx.byId); }, { silent: true });
      freeAgency(root, ctx.getState().league, ctx);
      return;
    }
    const bidBtn = e.target.closest('[data-bid]');
    if (!bidBtn) return;
    const id = bidBtn.dataset.bid;
    const p = ctx.byId.get(id);
    const entry = league.freeAgency.offers[u]?.[id];
    const ask = askingBoard(league, ctx.players || PLAYERS, { limit: 400 }).find((r) => r.id === id)?.ask ?? 1;
    const start = entry || ask;
    const m = modal(`<h3 style="margin:.1rem 0">${esc(p.name)}</h3>
      <p class="muted" style="margin:.2rem 0 .5rem;font-size:.85rem">Asking <b>$${ask}</b>. You have <b>$${room}</b> to bid. Other clubs are bidding too, and the best offer wins — ties go to the worse record.</p>
      <input type="number" id="faAmt" value="${start}" min="${ask}" max="${Math.max(ask, room)}" style="width:100%;font-size:1.1rem;padding:.5rem">
      <div class="row" style="gap:.4rem;margin-top:.6rem"><button class="btn primary" id="faOk">Offer</button><button class="btn" data-close>Cancel</button></div>`);
    m.el.querySelector('#faOk').addEventListener('click', () => {
      const amt = Number(m.el.querySelector('#faAmt').value);
      let res;
      ctx.update((st) => { res = submitOffer(st.league, u, id, amt, ctx.byId); }, { silent: true });
      if (!res.ok) { toast(res.reason); return; }
      m.close();
      freeAgency(root, ctx.getState().league, ctx);
    });
  });
  el.querySelector('#faDone').addEventListener('click', () => {
    ctx.update((st) => { closeFreeAgency(st.league, ctx.players || PLAYERS, ctx.byId); }, { silent: true });
    const after = ctx.getState().league;
    const rep = freeAgencyReport(after, u);
    const name = (id) => esc(ctx.byId.get(id)?.name || id);
    modal(`<h3 style="margin:.1rem 0">The market has closed</h3>
      ${rep.won.length ? `<p style="margin:.3rem 0"><b>Signed:</b> ${rep.won.map((w) => `${name(w.id)} <span class="muted">$${w.salary}</span>`).join(', ')}</p>` : '<p class="muted" style="margin:.3rem 0">You signed nobody.</p>'}
      ${rep.lost.length ? `<p style="margin:.3rem 0"><b>Missed out on:</b> ${rep.lost.map((l) => `${name(l.id)} <span class="muted">${l.bid === l.at ? `you both bid $${l.bid} — ties go to the worse record` : `your $${l.bid}, he took $${l.at}`}</span>`).join(', ')}</p>` : ''}
      <p class="muted" style="margin:.4rem 0 0;font-size:.85rem">${(after.offseason.signed || []).length} signings across the league. Whoever is left is in the draft.</p>
      <div class="row" style="gap:.4rem;margin-top:.6rem"><button class="btn primary" data-close>To the draft</button></div>`, {
      onClose: () => ctx.navigate(after.draftType === 'auction' ? '#/auction' : '#/draft'),
    });
  });
}

function jobMarket(root, league, ctx) {
  const car = league.offseason.carousel || {};
  const offers = car.offers || [];
  const you = yourCoach(league);
  const oldClub = league.teams.find((t) => t.isUser);
  render(root, html`<div id="offseason-view">
    <div class="card">
      <h1 style="margin:0">You are out of a job</h1>
      <p class="muted" style="margin:.4rem 0 0">${oldClub ? `${oldClub.name} have let you go` : 'Your club has let you go'} after season ${league.offseason.season}. Your reputation around the league is <b>${you.rep}</b>.</p>
      <p class="muted" style="font-size:.9rem;margin:.5rem 0 0">Whatever you had built stays behind. The keepers, the contracts and the squad you know are theirs now; you take over somebody else's, with their deals already on the books.</p>
    </div>
    ${car.sacked && car.sacked.length > 1 ? html`<div class="card tight" style="margin-top:.75rem">
      <h3>Around the league</h3>
      <p class="muted" style="font-size:.88rem;margin:.2rem 0">${car.sacked.filter((x) => !x.you).map((x) => `${x.name} (${league.teams[x.team].abbr})`).join(' · ')} went too.</p>
    </div>` : ''}
    <div class="card" style="margin-top:.75rem">
      <h2 style="margin:0 0 .5rem">${offers.length === 1 ? 'One club is interested' : `${offers.length} clubs are interested`}</h2>
      <div class="stack">
        ${offers.map((o) => {
    const t = league.teams[o.team];
    return html`<div class="card tight" style="margin:0">
          <div class="row between" style="align-items:baseline">
            <h3 style="margin:0">${teamChip(t)}</h3>
            <span class="muted" style="font-size:.85rem">${t.record ? `${t.record.w}-${t.record.l}${t.record.t ? `-${t.record.t}` : ''} last year` : ''}</span>
          </div>
          <p class="muted" style="font-size:.88rem;margin:.35rem 0 .1rem">The owner wants you to <b>${o.goal.text}</b>. Squad ranked <b>${o.goal.rank}</b> of ${league.teams.length}.</p>
          <p class="muted" style="font-size:.88rem;margin:.1rem 0 .5rem">${o.patience <= 3 ? 'Impatient: you would get about three seasons.' : o.patience >= 6 ? 'Patient: you would get time to build.' : 'Reasonable: four or five seasons of rope.'}${o.lastResort ? ' Nobody else was calling.' : ''}</p>
          <button class="btn primary block" data-take="${o.team}">Take the ${t.name} job</button>
        </div>`;
  })}
      </div>
    </div>
  </div>`);
  root.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', () => {
    const idx = Number(b.dataset.take);
    let club;
    ctx.update((s) => { club = takeJob(s.league, idx, ctx.players, ctx.byId); }, { silent: true });
    toast(`You are the new coach of the ${club.name}`);
    ctx.navigate('#/offseason');
  }));
}

/** Nobody called. The league stays readable; the career does not go on. */
function careerOver(root, league, ctx) {
  const c = careerSummary(league);
  render(root, html`<div id="offseason-view">
    <div class="card">
      <h1 style="margin:0">That is the end of it</h1>
      <p class="muted" style="margin:.4rem 0 0">${league.jobs.retiredReason}</p>
      <div class="table-wrap" style="margin-top:.75rem"><table><tbody>
        <tr><td>Seasons coached</td><td class="num"><b>${c.seasons}</b></td></tr>
        <tr><td>Record</td><td class="num"><b>${c.w}-${c.l}${c.t ? `-${c.t}` : ''}</b> · ${(c.winPct * 100).toFixed(1)}%</td></tr>
        <tr><td>Titles</td><td class="num"><b>${c.titles}</b></td></tr>
        <tr><td>Times sacked</td><td class="num"><b>${c.sacked}</b></td></tr>
        <tr><td>Clubs</td><td class="num">${c.clubs.map((j) => j.name).join(', ')}</td></tr>
      </tbody></table></div>
      <p class="muted" style="font-size:.9rem;margin-top:.75rem">The league, its records and its hall of fame are all still here to read. A new career means a new league.</p>
      <div class="row" style="margin-top:.5rem"><a class="btn" href="#/awards/hall">Hall of fame</a><a class="btn" href="#/players">Player pool</a><a class="btn primary" href="#/new">Start again</a></div>
    </div>
  </div>`);
}
