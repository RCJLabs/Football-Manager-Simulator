import { html, render, raw } from '../../util.js';
import { POSITION_ORDER, ROSTER_SLOTS } from '../../data/positions.js';

import { overall } from '../../engine/ratings.js';
import { userTeamIndex, isPro, standings } from '../../engine/season.js';
import {
  freeAgents, fileClaim, cancelClaim, claimsThisWeek, waiverLimit, tradeDeadlineWeek, tradesOpen, movesOpen,
  validateTrade, proposeTrade, lineupStrength, initWaivers, slotOf, liveOffers, acceptOffer, declineOffer,
  slotsAfterTrade, MAX_TRADE_IMBALANCE, MAX_TRADE_SIDE,
} from '../../engine/transactions.js';
import { openBlock, teamNeeds, bestAvailable, partingCost, findPlayers } from '../../engine/tradeblock.js';
import {
  futureHand, futurePicksOpen, futureLabel, futureSeason, futurePickValue, pickTradeDelta,
  projectedSlots, slotBand, FUTURE_ROUNDS,
} from '../../engine/futurepicks.js';
import { faBoard, keeperAdvice } from '../../engine/market.js';
import { playerItem, playerModal, teamChip, toast, modal, esc, ovrBadge, posBadge, outBadge } from '../components.js';
import { emptySlotAt } from '../../engine/transactions.js';
import { shownOverall } from '../../engine/scouting.js';

const ui = {
  tab: 'fa', pos: 'ALL', era: 'ALL', q: '', limit: 60, partner: null, give: new Set(), get: new Set(),
  // Next year's picks, kept apart from the players because they travel as a
  // separate argument all the way down: a pick is not a roster slot, so it
  // never squares or unbalances a position count.
  givePicks: new Set(), getPicks: new Set(),
  // The trade finder keeps its own filters: it searches every club's roster,
  // not the free-agent pool the first tab is looking at.
  findQ: '', findPos: '', blockOnly: true, findLimit: 10,
};

export function view(root, params, ctx) {
  // Rank by what we believe about a player: sorting an unscouted rookie by his
  // true rating would put the number back on screen as his place in the list.
  const scoutObs = ctx.getState().league ? ctx.getState().league.teams.findIndex((t) => t.isUser) : -1;
  const scoutRank = (p) => (ctx.getState().league ? shownOverall(ctx.getState().league, p, scoutObs) : overall(p));
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.phase === 'draft') { ctx.navigate(league.draftType === 'auction' ? '#/auction' : '#/draft'); return; }
  initWaivers(league);
  // A deep link like #/moves/trade picks the tab once; later redraws keep whatever the user chose.
  if (params && params.tab) { if (['fa', 'claims', 'offers', 'trade', 'log'].includes(params.tab)) ui.tab = params.tab; delete params.tab; }
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const open = movesOpen(league);
  const fa = freeAgents(league, ctx.players);
  const injuries = league.injuries || {};
  const inj = (p) => outBadge(injuries[p.id]).__raw;
  const mine = claimsThisWeek(league, u);
  const limit = waiverLimit(league);
  const deadline = tradeDeadlineWeek(league);
  const order = isPro(league) ? standings(league).map((r) => r.idx).reverse() : league.waiverOrder;
  const myPriority = order.indexOf(u) + 1;
  const last = league.lastWaivers && league.lastWaivers.week === league.week - 1 ? league.lastWaivers.results.filter((r) => r.team === u) : [];
  if (ui.partner == null || ui.partner === u || !league.teams[ui.partner]) ui.partner = league.teams.findIndex((t) => !t.isUser);

  const offers = liveOffers(league).filter((o) => !o.answered);
  const tabs = [['fa', `Free agents (${fa.length})`], ['claims', `My claims (${mine.length}/${limit})`], ['offers', `Offers${offers.length ? ` (${offers.length})` : ''}`], ['trade', 'Trades'], ['log', 'Log']];

  let body;
  if (ui.tab === 'fa') {
    // Ranked by what each man would add to *this* lineup rather than by his
    // rating. The best free agent in the pool is often a kicker.
    const board = faBoard(league, ctx.players, ctx.byId, u, {
      q: ui.q, pos: ui.pos === 'ALL' ? '' : ui.pos, era: ui.era === 'ALL' ? '' : ui.era, limit: ui.limit,
    });
    const byIdRow = new Map(board.players.map((r) => [r.id, r]));
    const rows = board.players.map((r) => ctx.byId.get(r.id)).filter(Boolean);
    const shown = rows;
    // A badge only where there is something to say. Right after an auction the
    // honest answer for the whole pool is "none of these help", and printing
    // that sixty times is worse than printing it once above the list.
    const bestGain = board.players.length ? board.players[0].gain : 0;
    const faMeta = (p) => {
      const r = byIdRow.get(p.id);
      if (!r || r.gain <= 0) return inj(p);
      const g = `<span class="badge gain" title="Lineup points he adds, replacing the weakest man in that room — the same yardstick a trade is judged on">+${r.gain}</span>`;
      const rivals = r.rivals > 0
        ? ` <span class="badge rivals" title="AI clubs whose own bar he clears — they file for the same man, and waiver order decides it">${r.rivals} rival${r.rivals === 1 ? '' : 's'}</span>`
        : '';
      const drop = r.drop ? ` <span class="muted">over ${esc(ctx.byId.get(r.drop)?.name || '')}</span>` : '';
      return ` · ${g}${rivals}${drop}${inj(p)}`;
    };
    body = html`
      <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">${open ? `Ranked by what each man adds to your lineup, not by rating. Claims resolve when the week advances; you get ${limit} a week and are ${ordinalOf(myPriority)} of ${order.length} in the waiver order${isPro(league) ? ' (reverse standings)' : ' (a successful claim sends you to the back)'}.` : 'The wire is closed until next season.'}</p>
      ${open && bestGain <= 0 ? html`<p class="notice" style="margin:0 0 .5rem;font-size:.85rem">Nobody left in the pool would improve this lineup${ui.pos === 'ALL' ? '' : ` at ${ui.pos}`}. That changes the moment somebody gets hurt — the wire is an injury market first.</p>` : ''}
      <div class="tabs" id="posTabs">${raw(['ALL', ...POSITION_ORDER].map((p) => `<button class="tab ${ui.pos === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join(''))}</div>
      <div class="tabs" id="eraTabs">${raw(['ALL', ...[...new Set(ctx.players.map((p) => `${Math.floor(p.season / 10) * 10}s`))].sort()].map((e) => `<button class="tab ${ui.era === e ? 'active' : ''}" data-era="${e}">${e}</button>`).join(''))}</div>
      <input type="search" id="q" placeholder="Search player or team…" value="${ui.q}">
      <ul class="plist" style="margin-top:.5rem">${raw(shown.map((p) => playerItem(p, {
        meta: faMeta(p),
        cls: injuries[p.id] ? 'dim' : '',
        action: open ? `<button class="btn sm primary" data-claim="${esc(p.id)}" ${mine.length >= limit || mine.some((c) => c.add === p.id) ? 'disabled' : ''}>${mine.some((c) => c.add === p.id) ? 'Claimed' : 'Claim'}</button>` : '',
      })).join(''))}</ul>
      ${shown.length === 0 ? html`<p class="empty">Nobody matches those filters.</p>` : ''}
      ${board.total > shown.length ? html`<button class="btn block" id="more">Show more (${board.total - shown.length} left)</button>` : ''}`;
  } else if (ui.tab === 'claims') {
    body = html`
      ${last.length ? html`<div class="notice" style="margin-bottom:.6rem"><b>Last week's wire:</b> ${raw(last.map((r) => `${r.ok ? '✔' : '✘'} ${esc(ctx.byId.get(r.add)?.name)}${r.ok ? ' joined, ' + esc(ctx.byId.get(r.drop)?.name) + ' released' : ' — ' + esc(r.reason)}`).join('<br>'))}</div>` : ''}
      ${mine.length ? raw(`<ul class="plist">${mine.map((c) => { const a = ctx.byId.get(c.add), d = c.drop ? ctx.byId.get(c.drop) : null; return playerItem(a, { attrs: false, meta: d ? ` · drops <b>${esc(d.name)}</b> (${overall(d)})` : ` · into the open <b>${a.pos}</b> slot`, action: `<button class="btn sm danger" data-cancel="${esc(c.add)}">Cancel</button>` }); }).join('')}</ul>`) : html`<p class="empty">No claims filed this week. Up to ${limit} resolve when the week advances.</p>`}`;
  } else if (ui.tab === 'offers') {
    const card = (o) => {
      const them = league.teams[o.from];
      // An offer can carry next year's picks on either side, so each column
      // lists the players and then whatever picks come with them.
      const side = (ids, picks, label) => `<div><div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em">${label}</div><ul class="plist">${ids.map((id) => playerItem(ctx.byId.get(id), { attrs: false, meta: inj(ctx.byId.get(id)) })).join('')}${(picks || []).map((p) => `<li class="prow pick-row"><div class="who"><div class="nm">${esc(futureLabel(league, p))}</div><div class="meta"><span class="muted">${esc(slotBand(league, ctx.byId, p.from, null))}</span></div></div></li>`).join('')}</ul></div>`;
      const verdict = o.userDelta > 4 ? ['Helps your lineup', 'var(--good)'] : o.userDelta >= -1 ? ['About even', 'var(--muted)'] : ['Costs your lineup', 'var(--bad)'];
      return `<div class="card tight" style="margin-bottom:.6rem">
        <div class="row between"><b>${teamChip(them).__raw} are calling</b><small class="muted">week ${o.week}</small></div>
        <p class="muted" style="margin:.2rem 0 .4rem;font-size:.85rem">${esc(o.note)}</p>
        <div class="grid grid-2">${side(o.gives, o.givesNext, 'You get')}${side(o.wants, o.wantsNext, 'You give')}</div>
        ${o.fills && (o.fills.signs.length || o.fills.releases.length) ? `<p class="notice" style="margin:.4rem 0 0;font-size:.8rem"><b>Uneven.</b> Taking it means you ${[
          o.fills.signs.length ? `sign ${o.fills.signs.map((id) => `<b>${esc(ctx.byId.get(id)?.name)}</b>`).join(' and ')}` : '',
          o.fills.releases.length ? `release ${o.fills.releases.map((id) => `<b>${esc(ctx.byId.get(id)?.name)}</b>`).join(' and ')}` : '',
        ].filter(Boolean).join(', and ')}.</p>` : ''}
        <div class="row between" style="margin-top:.5rem">
          <small style="color:${verdict[1]}">${verdict[0]} <span class="muted">(${o.userDelta > 0 ? '+' : ''}${o.userDelta} lineup strength by the same yardstick the AI uses)</span></small>
          <span class="btn-group"><button class="btn primary sm" data-accept="${esc(o.id)}">Accept</button><button class="btn sm" data-decline="${esc(o.id)}">Decline</button></span>
        </div>
      </div>`;
    };
    body = html`
      <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">${tradesOpen(league) ? 'Clubs ring you when they are thin somewhere and deep where you are thin. An offer stands for the week; declining it takes that deal off the table for the season.' : `The trade deadline passed after week ${deadline}.`}</p>
      ${offers.length ? raw(offers.map(card).join('')) : html`<p class="empty">Nobody is calling this week.</p>`}`;
  } else if (ui.tab === 'trade') {
    const partner = league.teams[ui.partner];
    const best = bestAvailable(league, ctx.players);
    const needs = teamNeeds(league, ctx.byId);
    const block = openBlock(league, ctx.byId, ctx.players);
    const onBlock = new Map(block.map((b) => [b.id, b]));
    const give = [...ui.give].filter((id) => slotOf(me, id)), get = [...ui.get].filter((id) => slotOf(partner, id));

    // --- Find. One search across every club's roster, which is the thing that
    // used to take twenty-eight visits to a dropdown.
    const found = findPlayers(league, ctx.byId, { q: ui.findQ, pos: ui.findPos, exclude: u, limit: 400 });
    const rows = (ui.blockOnly ? found.players.filter((x) => onBlock.has(x.id)) : found.players);
    const shownFind = rows.slice(0, ui.findLimit);
    const findRow = (x) => {
      const p = ctx.byId.get(x.id);
      const b = onBlock.get(x.id);
      const held = league.teams[x.team];
      const wants = needs[x.team][0];
      const tag = b
        ? `<span class="badge block" title="What it would cost them to replace him">block · ${b.cost <= 0 ? 'free' : b.cost}</span>`
        : '';
      const want = wants ? ` <span class="badge need" title="${esc(league.teams[x.team].abbr)} are thinnest here">wants ${wants.pos}</span>` : '';
      // The era badge goes: the year is already in the line, and on a phone
      // every badge here costs a row of height across ten results.
      return playerItem(p, {
        attrs: false, era: false,
        cls: ui.get.has(x.id) ? 'me' : '',
        meta: ` · ${teamChip(held, { abbr: true }).__raw} <span class="badge slot">${x.slot}</span> ${tag}${want}${inj(p)}`,
        action: `<button class="btn sm ${ui.get.has(x.id) ? 'primary' : ''}" data-target="${esc(x.id)}" data-team="${x.team}">${ui.get.has(x.id) ? 'In the deal' : 'Target'}</button>`,
      });
    };

    // --- The deal. The user's side is ordered by what each man costs to
    // replace, so the cheap pieces to trade are the ones you see first.
    const mineRows = ROSTER_SLOTS.map((sl) => ({ sl, id: me.slots[sl.id] })).filter((x) => x.id)
      .map((x) => ({ ...x, p: ctx.byId.get(x.id), cost: partingCost(me, x.id, ctx.byId, best, league) }))
      .sort((a, b) => a.cost - b.cost);
    const giveList = `<ul class="plist">${mineRows.map(({ sl, p, cost }) => playerItem(p, {
      attrs: false, cls: ui.give.has(p.id) ? 'me' : '',
      meta: ` · <span class="badge slot">${sl.id}</span> <span class="badge cost" title="Lineup points it costs you to give him up and sign the best free agent there">${cost <= 0 ? 'free' : `−${cost}`}</span>${inj(p)}`,
      action: `<button class="btn sm ${ui.give.has(p.id) ? 'primary' : ''}" data-give="${esc(p.id)}">${ui.give.has(p.id) ? 'Selected' : 'Select'}</button>`,
    })).join('')}</ul>`;
    const getList = `<ul class="plist">${ROSTER_SLOTS.map((sl) => {
      const p = ctx.byId.get(partner.slots[sl.id]);
      if (!p) return '';
      const b = onBlock.get(p.id);
      return playerItem(p, {
        attrs: false, cls: ui.get.has(p.id) ? 'me' : '',
        meta: ` · <span class="badge slot">${sl.id}</span>${b ? ' <span class="badge block">on the block</span>' : ''}${inj(p)}`,
        action: `<button class="btn sm ${ui.get.has(p.id) ? 'primary' : ''}" data-get="${esc(p.id)}">${ui.get.has(p.id) ? 'Selected' : 'Select'}</button>`,
      });
    }).join('')}</ul>`;

    // --- Next year's picks, on both sides.
    const picksOpen = futurePicksOpen(league);
    const slots = picksOpen ? projectedSlots(league, ctx.byId) : null;
    const myHand = picksOpen ? futureHand(league, u) : [];
    const theirHand = picksOpen ? futureHand(league, ui.partner) : [];
    const givePicks = myHand.filter((p) => ui.givePicks.has(p.key));
    const getPicks = theirHand.filter((p) => ui.getPicks.has(p.key));
    const pickRow = (p, side, chosen, owner) => `
      <li class="prow pick-row ${chosen ? 'me' : ''}">
        <div class="who"><div class="nm">${esc(futureLabel(league, p))}</div>
          <div class="meta"><span class="muted">${esc(slotBand(league, ctx.byId, p.from, slots))} · worth ${futurePickValue(league, ctx.byId, p, slots, owner).toFixed(1)}</span></div>
        </div>
        <div class="act"><button class="btn sm ${chosen ? 'primary' : ''}" data-${side}="${esc(p.key)}">${chosen ? 'In' : 'Add'}</button></div>
      </li>`;
    const pickList = (hand, side, chosen, owner) => (hand.length
      ? `<ul class="plist pick-list" style="margin-top:.35rem">${hand.map((p) => pickRow(p, side, chosen.has(p.key), owner)).join('')}</ul>`
      : '<p class="muted" style="margin:.35rem 0 0;font-size:.8rem">No picks left to trade.</p>');

    // --- Squaring up, and what the deal does to your own lineup.
    const hasSomething = (give.length || givePicks.length) && (get.length || getPicks.length);
    const v = hasSomething
      ? validateTrade(league, u, ui.partner, give, get, ctx.byId, ctx.players, { aPicks: givePicks, bPicks: getPicks })
      : null;
    const strengthNow = lineupStrength(me.slots, ctx.byId, league);
    const mineAfter = v && v.ok ? slotsAfterTrade(league, u, give, get, ctx.players, ctx.byId) : null;
    const myPickDelta = picksOpen ? pickTradeDelta(league, ctx.byId, u, givePicks, getPicks, slots) : 0;
    const myDelta = mineAfter
      ? Math.round((lineupStrength(mineAfter.slots, ctx.byId, league) - strengthNow + myPickDelta) * 10) / 10
      : null;
    const nameOf = (id) => esc(ctx.byId.get(id)?.name || id);
    const paperwork = (fill, who) => {
      if (!fill || (!fill.signs.length && !fill.releases.length)) return '';
      const bits = [];
      if (fill.signs.length) bits.push(`sign ${fill.signs.map((id) => `<b>${nameOf(id)}</b> (${ctx.byId.get(id).pos})`).join(' and ')}`);
      if (fill.releases.length) bits.push(`release ${fill.releases.map((id) => `<b>${nameOf(id)}</b> (${ctx.byId.get(id).pos})`).join(' and ')}`);
      return `<li>${who} ${bits.join(', and ')}</li>`;
    };
    const squaring = v && v.ok && v.uneven
      ? `<div class="notice" style="margin-top:.6rem"><b>Squaring up.</b> The positions do not match, so the deal carries the moves that fix both rosters:<ul class="plain" style="margin:.35rem 0 0">${paperwork(v.fills.a, 'You')}${paperwork(v.fills.b, partner.abbr)}</ul></div>`
      : '';
    const chips = (list) => list.map((n) => `<span class="badge need">${n.pos}</span>`).join(' ') || '<span class="muted">nothing pressing</span>';

    body = html`
      <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">${tradesOpen(league)
        ? `Open through week ${deadline}, ${MAX_TRADE_SIDE} players a side. Positions need not match — an uneven deal carries the signing and the release that square both rosters.`
        : league.phase === 'season' ? `The trade deadline passed after week ${deadline}.` : 'Trades are open during the regular season only.'}</p>

      <div class="card tight">
        <div class="row between"><h3 style="margin:0">Find a player</h3><small class="muted">${rows.length} of ${found.total}</small></div>
        <div class="tabs" id="findPos" style="margin-top:.4rem">${raw(['', ...POSITION_ORDER].map((p) => `<button class="tab ${ui.findPos === p ? 'active' : ''}" data-fpos="${p}">${p || 'ALL'}</button>`).join(''))}</div>
        <div class="row" style="gap:.5rem;align-items:center;margin-top:.4rem">
          <input type="search" id="findQ" placeholder="Any club's roster — player or club…" value="${ui.findQ}">
          <label class="row" style="gap:.3rem;margin:0;white-space:nowrap"><input type="checkbox" id="blockOnly" ${ui.blockOnly ? 'checked' : ''}> On the block</label>
        </div>
        <p class="muted" style="margin:.4rem 0 0;font-size:.8rem">${ui.blockOnly ? 'Players their clubs could replace cheaply — the lower the number, the less they lose by moving him.' : 'Every rostered player in the league. Targeting one switches the club you are dealing with.'}</p>
        <ul class="plist" style="margin-top:.4rem">${raw(shownFind.map(findRow).join(''))}</ul>
        ${shownFind.length === 0 ? html`<p class="empty">${ui.blockOnly ? 'Nobody on the block matches. Untick "On the block" to search every roster.' : 'Nobody matches that.'}</p>` : ''}
        ${rows.length > shownFind.length ? html`<button class="btn block" id="findMore">Show more (${rows.length - shownFind.length} left)</button>` : ''}
      </div>

      <div class="row between" style="margin-top:.6rem;gap:.5rem;flex-wrap:wrap">
        <small class="muted">You are thin at ${raw(chips(needs[u]))}</small>
        <small class="muted">${teamChip(partner, { abbr: true })} are thin at ${raw(chips(needs[ui.partner]))}</small>
      </div>

      <div class="row" style="gap:.5rem;align-items:center;margin-top:.4rem">
        <label style="margin:0">Trade with</label>
        <select id="partner" style="max-width:18rem">${league.teams.map((t, i) => (t.isUser ? '' : html`<option value="${i}" ${i === ui.partner ? 'selected' : ''}>${t.abbr} · ${t.name} (${t.record.w}-${t.record.l})</option>`))}</select>
      </div>
      <div class="grid grid-2" style="margin-top:.6rem">
        <div class="card tight"><h3>You give <small class="muted">(${teamChip(me, { abbr: true })} · strength ${strengthNow})</small></h3>${raw(giveList)}${picksOpen ? html`<h4 style="margin:.6rem 0 0">${futureSeason(league)} picks</h4>${raw(pickList(myHand, 'givepick', ui.givePicks, u))}` : ''}</div>
        <div class="card tight"><h3>You get <small class="muted">(${teamChip(partner, { abbr: true })})</small></h3>${raw(getList)}${picksOpen ? html`<h4 style="margin:.6rem 0 0">${futureSeason(league)} picks</h4>${raw(pickList(theirHand, 'getpick', ui.getPicks, u))}` : ''}</div>
      </div>
      ${picksOpen ? html`<p class="muted" style="margin:.5rem 0 0;font-size:.78rem">Next year's first two rounds. Where a pick falls is a guess, made from each club's roster <b>and how its season is going</b> — by the deadline that ranks clubs against their finish about as well as the standings do, which is why a pick is worth more here than in the spring. A pick <b>closes a gap</b> rather than buying a star: measured, a first is worth about fifteen points of lineup and a second under one.</p>` : ''}
      ${raw(squaring)}
      <div class="card tight" style="margin-top:.6rem;position:sticky;bottom:.5rem;z-index:5">
        <div class="row between">
          <div class="muted" style="font-size:.85rem">${hasSomething
            ? (v.ok
              ? html`<b style="color:${myDelta > 0 ? 'var(--good)' : myDelta < 0 ? 'var(--bad)' : 'var(--muted)'}">${myDelta > 0 ? '+' : ''}${myDelta}</b> to your lineup${myPickDelta ? html` <span class="muted">(${myPickDelta > 0 ? '+' : ''}${Math.round(myPickDelta * 10) / 10} of it picks)</span>` : ''} · ${give.length + givePicks.length} for ${get.length + getPicks.length}${v.uneven ? ' · uneven' : ''}`
              : html`<span style="color:var(--bad)">${v.reason}</span>`)
            : 'Select something on both sides.'}</div>
          <div class="btn-group"><button class="btn ghost sm" id="clearTrade">Clear</button><button class="btn primary" id="propose" ${v && v.ok && tradesOpen(league) ? '' : 'disabled'}>Propose</button></div>
        </div>
      </div>`;
  } else {
    const log = (league.transactions || []).slice().reverse();
    body = log.length ? raw(`<ul class="plain ticker" style="max-height:none">${log.map((t) => {
      const team = league.teams[t.team];
      if (t.type === 'waiver') return `<li class="${team.isUser ? 'me' : ''}"><small class="muted">Wk ${t.week}</small> ${teamChip(team, { abbr: true }).__raw} claimed <b>${esc(ctx.byId.get(t.add)?.name)}</b>, released ${esc(ctx.byId.get(t.drop)?.name)}</li>`;
      if (t.type === 'ir') return `<li class="${team.isUser ? 'me' : ''}"><small class="muted">Wk ${t.week}</small> ${teamChip(team, { abbr: true }).__raw} placed <b>${esc(ctx.byId.get(t.add)?.name)}</b> on injured reserve</li>`;
      if (t.type === 'activate') return `<li class="${team.isUser ? 'me' : ''}"><small class="muted">Wk ${t.week}</small> ${teamChip(team, { abbr: true }).__raw} activated <b>${esc(ctx.byId.get(t.add)?.name)}</b>${t.drop ? `, released ${esc(ctx.byId.get(t.drop)?.name)}` : ''}</li>`;
      if (t.type === 'release') return `<li class="${team.isUser ? 'me' : ''}"><small class="muted">Wk ${t.week}</small> ${teamChip(team, { abbr: true }).__raw} released <b>${esc(ctx.byId.get(t.drop)?.name)}</b> from injured reserve</li>`;
      const other = league.teams[t.other];
      // An uneven trade carried a signing and a release on each side; the log
      // says so, because otherwise a roster changes for reasons nothing names.
      const tail = (t.signs || t.releases)
        ? ` <small class="muted">${[0, 1].map((k) => {
          const club = k === 0 ? team : other;
          const bits = [];
          if (t.signs?.[k]?.length) bits.push(`signed ${t.signs[k].map((id) => esc(ctx.byId.get(id)?.name)).join(' and ')}`);
          if (t.releases?.[k]?.length) bits.push(`released ${t.releases[k].map((id) => esc(ctx.byId.get(id)?.name)).join(' and ')}`);
          return bits.length ? `${esc(club.abbr)} ${bits.join(', ')}` : '';
        }).filter(Boolean).join('; ')}</small>`
        : '';
      // A deal can be all picks and no players, so both halves are named.
      const side = (ids, picks) => [...ids.map((id) => esc(ctx.byId.get(id)?.name)), ...(picks || []).map(esc)].join(', ') || 'nothing';
      return `<li class="${team.isUser || other.isUser ? 'me' : ''}"><small class="muted">Wk ${t.week}</small> ${teamChip(team, { abbr: true }).__raw} sent <b>${side(t.gives, t.givesNext)}</b> to ${teamChip(other, { abbr: true }).__raw} for <b>${side(t.gets, t.getsNext)}</b>${tail}</li>`;
    }).join('')}</ul>`) : html`<p class="empty">No transactions yet.</p>`;
  }

  render(root, html`<div id="moves-view">
    <div class="card tight">
      <div class="row between">
        <div><h2 style="margin:0">Roster moves</h2><small class="muted">${teamChip(me)} · week ${league.week}${league.phase === 'season' ? ` of ${league.schedule.length}` : ''}</small></div>
        <a class="btn sm" href="#/season">Season hub</a>
      </div>
      <div class="tabs" id="tabs" style="margin-top:.5rem">${raw(tabs.map(([k, label]) => `<button class="tab ${ui.tab === k ? 'active' : ''}" data-tab="${k}">${label}</button>`).join(''))}</div>
    </div>
    <div class="card tight" style="margin-top:.75rem">${body}</div>
  </div>`);

  const el = root.querySelector('#moves-view');
  const redraw = () => view(root, params, ctx);
  el.querySelector('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { ui.tab = b.dataset.tab; redraw(); } });
  el.querySelector('#posTabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-pos]'); if (b) { ui.pos = b.dataset.pos; ui.limit = 60; redraw(); } });
  el.querySelector('#eraTabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-era]'); if (b) { ui.era = b.dataset.era; ui.limit = 60; redraw(); } });
  el.querySelector('#more')?.addEventListener('click', () => { ui.limit += 60; redraw(); });
  el.querySelector('#q')?.addEventListener('input', (e) => {
    ui.q = e.target.value; ui.limit = 60;
    const pos = e.target.selectionStart; redraw();
    const input = root.querySelector('#q'); input.focus(); input.setSelectionRange(pos, pos);
  });
  el.querySelector('#partner')?.addEventListener('change', (e) => { ui.partner = Number(e.target.value); ui.get.clear(); ui.getPicks.clear(); redraw(); });
  el.querySelector('#findPos')?.addEventListener('click', (e) => { const b = e.target.closest('[data-fpos]'); if (b) { ui.findPos = b.dataset.fpos; ui.findLimit = 10; redraw(); } });
  el.querySelector('#blockOnly')?.addEventListener('change', (e) => { ui.blockOnly = e.target.checked; ui.findLimit = 10; redraw(); });
  el.querySelector('#findMore')?.addEventListener('click', () => { ui.findLimit += 15; redraw(); });
  el.querySelector('#findQ')?.addEventListener('input', (e) => {
    ui.findQ = e.target.value; ui.findLimit = 10;
    const caret = e.target.selectionStart; redraw();
    const input = root.querySelector('#findQ'); input.focus(); input.setSelectionRange(caret, caret);
  });
  el.querySelector('#clearTrade')?.addEventListener('click', () => { ui.give.clear(); ui.get.clear(); ui.givePicks.clear(); ui.getPicks.clear(); redraw(); });
  el.querySelector('#propose')?.addEventListener('click', () => {
    const give = [...ui.give], get = [...ui.get];
    const openNow = futurePicksOpen(league);
    const mine = openNow ? futureHand(league, u).filter((p) => ui.givePicks.has(p.key)) : [];
    const theirs = openNow ? futureHand(league, ui.partner).filter((p) => ui.getPicks.has(p.key)) : [];
    let r;
    ctx.update((s) => {
      // The club's own side of the picks, on the club's own books — a
      // contender and a rebuilding side put different numbers on the same
      // pair, which is the whole reason shopping one around is worth doing.
      const theirDelta = openNow
        ? pickTradeDelta(s.league, ctx.byId, ui.partner, theirs, mine, projectedSlots(s.league, ctx.byId))
        : 0;
      r = proposeTrade(s.league, u, ui.partner, give, get, ctx.byId, ctx.players, {
        userPicks: mine, aiPicks: theirs, pickDelta: theirDelta,
      });
    }, { silent: true });
    const partner = league.teams[ui.partner];
    const m = modal(html`<h2>${r.accepted ? 'Deal' : 'No deal'}</h2>
      <p>${r.reason}</p>
      ${r.accepted ? html`${[...give.map((id) => ctx.byId.get(id).name), ...mine.map((p) => futureLabel(league, p))].join(', ')} to ${partner.name}; ${[...get.map((id) => ctx.byId.get(id).name), ...theirs.map((p) => futureLabel(league, p))].join(', ')} join you.${r.fills?.a?.signs?.length ? ` You signed ${r.fills.a.signs.map((id) => ctx.byId.get(id).name).join(' and ')}.` : ''}${r.fills?.a?.releases?.length ? ` ${r.fills.a.releases.map((id) => ctx.byId.get(id).name).join(' and ')} released.` : ''} Check your depth chart.</p>` : ''}
      <div class="row"><button class="btn primary" data-close>OK</button>${r.accepted ? html`<a class="btn" href="#/team/${u}/depth">Depth chart</a>` : ''}</div>`);
    void m;
    if (r.accepted) { ui.give.clear(); ui.get.clear(); ui.givePicks.clear(); ui.getPicks.clear(); ui.tab = 'log'; }
    redraw();
  });
  el.addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) { playerModal(ctx.byId.get(show.dataset.show)); return; }
    const gp = e.target.closest('[data-givepick]');
    if (gp) { const k = gp.dataset.givepick; ui.givePicks.has(k) ? ui.givePicks.delete(k) : ui.givePicks.add(k); redraw(); return; }
    const tp = e.target.closest('[data-getpick]');
    if (tp) { const k = tp.dataset.getpick; ui.getPicks.has(k) ? ui.getPicks.delete(k) : ui.getPicks.add(k); redraw(); return; }
    const g = e.target.closest('[data-give]');
    if (g) { const id = g.dataset.give; if (ui.give.has(id)) ui.give.delete(id); else if (ui.give.size < MAX_TRADE_SIDE) ui.give.add(id); else toast(`${MAX_TRADE_SIDE} players a side at most`); redraw(); return; }
    const tgt = e.target.closest('[data-target]');
    if (tgt) {
      const id = tgt.dataset.target, team = Number(tgt.dataset.team);
      if (ui.get.has(id)) ui.get.delete(id);
      else {
        // A deal is with one club, so targeting somebody else's player moves
        // the negotiation rather than quietly mixing two rosters together.
        if (team !== ui.partner) { ui.partner = team; ui.get.clear(); }
        if (ui.get.size >= MAX_TRADE_SIDE) toast(`${MAX_TRADE_SIDE} players a side at most`);
        else ui.get.add(id);
      }
      redraw();
      return;
    }
    const t = e.target.closest('[data-get]');
    if (t) { const id = t.dataset.get; if (ui.get.has(id)) ui.get.delete(id); else if (ui.get.size < MAX_TRADE_SIDE) ui.get.add(id); else toast(`${MAX_TRADE_SIDE} players a side at most`); redraw(); return; }
    const accept = e.target.closest('[data-accept]');
    if (accept) {
      try {
        let tx;
        ctx.update((s) => { tx = acceptOffer(s.league, accept.dataset.accept, ctx.byId, ctx.players); }, { silent: true });
        toast('Deal done');
        void tx;
      } catch (err) { toast(err.message); }
      redraw();
      return;
    }
    const decline = e.target.closest('[data-decline]');
    if (decline) {
      ctx.update((s) => { declineOffer(s.league, decline.dataset.decline); }, { silent: true });
      toast('Turned down');
      redraw();
      return;
    }
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) { ctx.update((s) => { cancelClaim(s.league, u, cancel.dataset.cancel); }, { silent: true }); toast('Claim withdrawn'); redraw(); return; }
    const claim = e.target.closest('[data-claim]');
    if (claim) openClaim(ctx.byId.get(claim.dataset.claim));
  });

  function openClaim(p) {
    const options = ROSTER_SLOTS.filter((s) => s.pos === p.pos).map((s) => ctx.byId.get(me.slots[s.id])).filter(Boolean);
    const openSlot = emptySlotAt(me, p.pos);
    const hurtNote = injuries[p.id] ? html`<p class="notice">He is hurt: ${injuries[p.id].kind}, out ${fmtWeeksSafe(injuries[p.id].weeks)}. You can still claim him and wait.</p>` : '';
    const m = modal(html`
      <div class="row between"><h2 style="margin:0">Claim ${p.name}</h2><button class="btn sm ghost" data-close>✕</button></div>
      <p class="muted">${ovrBadge(p)} ${posBadge(p.pos)} ${p.season} ${p.team}. ${openSlot ? 'Fill the open slot, or release someone.' : 'Who goes to make room?'}</p>
      ${hurtNote}
      ${openSlot ? html`<button class="btn primary block" data-drop="" style="margin-bottom:.5rem">Into the open ${openSlot} slot</button>` : ''}
      <ul class="plist">${raw(options.map((d) => playerItem(d, { attrs: false, meta: ` · <span class="badge slot">${slotOf(me, d.id)}</span>${inj(d)}`, action: `<button class="btn sm primary" data-drop="${esc(d.id)}">Release</button>` })).join(''))}</ul>
      <small class="muted">The claim resolves when the week advances; higher waiver priority wins a contested player.</small>`);
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-drop]');
      if (!b) return;
      try {
        ctx.update((s) => { fileClaim(s.league, u, p.id, b.dataset.drop || null, ctx.byId); }, { silent: true });
        toast(`Claim filed for ${p.name}`);
        m.close();
        redraw();
      } catch (err) { toast(err.message); }
    });
  }
}

function fmtWeeksSafe(w) {
  return w >= 50 ? 'for the season' : `${w} week${w === 1 ? '' : 's'}`;
}

function ordinalOf(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
