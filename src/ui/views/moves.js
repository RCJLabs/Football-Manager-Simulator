import { html, render, raw } from '../../util.js';
import { POSITION_ORDER, ROSTER_SLOTS } from '../../data/positions.js';

import { overall } from '../../engine/ratings.js';
import { userTeamIndex, isPro, standings } from '../../engine/season.js';
import {
  freeAgents, fileClaim, cancelClaim, claimsThisWeek, waiverLimit, tradeDeadlineWeek, tradesOpen, movesOpen,
  validateTrade, proposeTrade, lineupStrength, initWaivers, slotOf, liveOffers, acceptOffer, declineOffer,
} from '../../engine/transactions.js';
import { playerItem, playerModal, teamChip, toast, modal, esc, ovrBadge, posBadge, outBadge } from '../components.js';
import { emptySlotAt } from '../../engine/transactions.js';
import { shownOverall } from '../../engine/scouting.js';

const ui = { tab: 'fa', pos: 'ALL', era: 'ALL', q: '', limit: 60, partner: null, give: new Set(), get: new Set() };

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
    const q = ui.q.trim().toLowerCase();
    const rows = fa
      .filter((p) => (ui.pos === 'ALL' || p.pos === ui.pos) && (ui.era === 'ALL' || `${Math.floor(p.season / 10) * 10}s` === ui.era) && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q))
      .sort((a, b) => scoutRank(b) - scoutRank(a));
    const shown = rows.slice(0, ui.limit);
    body = html`
      <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">${open ? `Claims resolve when the week advances. You are ${ordinalOf(myPriority)} of ${order.length} in the waiver order${isPro(league) ? ' (reverse standings)' : ' (a successful claim sends you to the back)'}.` : 'The wire is closed until next season.'}</p>
      <div class="tabs" id="posTabs">${raw(['ALL', ...POSITION_ORDER].map((p) => `<button class="tab ${ui.pos === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join(''))}</div>
      <div class="tabs" id="eraTabs">${raw(['ALL', ...[...new Set(ctx.players.map((p) => `${Math.floor(p.season / 10) * 10}s`))].sort()].map((e) => `<button class="tab ${ui.era === e ? 'active' : ''}" data-era="${e}">${e}</button>`).join(''))}</div>
      <input type="search" id="q" placeholder="Search player or team…" value="${ui.q}">
      <ul class="plist" style="margin-top:.5rem">${raw(shown.map((p) => playerItem(p, {
        meta: inj(p),
        cls: injuries[p.id] ? 'dim' : '',
        action: open ? `<button class="btn sm primary" data-claim="${esc(p.id)}" ${mine.length >= limit || mine.some((c) => c.add === p.id) ? 'disabled' : ''}>${mine.some((c) => c.add === p.id) ? 'Claimed' : 'Claim'}</button>` : '',
      })).join(''))}</ul>
      ${shown.length === 0 ? html`<p class="empty">Nobody matches those filters.</p>` : ''}
      ${rows.length > shown.length ? html`<button class="btn block" id="more">Show more (${rows.length - shown.length} left)</button>` : ''}`;
  } else if (ui.tab === 'claims') {
    body = html`
      ${last.length ? html`<div class="notice" style="margin-bottom:.6rem"><b>Last week's wire:</b> ${raw(last.map((r) => `${r.ok ? '✔' : '✘'} ${esc(ctx.byId.get(r.add)?.name)}${r.ok ? ' joined, ' + esc(ctx.byId.get(r.drop)?.name) + ' released' : ' — ' + esc(r.reason)}`).join('<br>'))}</div>` : ''}
      ${mine.length ? raw(`<ul class="plist">${mine.map((c) => { const a = ctx.byId.get(c.add), d = c.drop ? ctx.byId.get(c.drop) : null; return playerItem(a, { attrs: false, meta: d ? ` · drops <b>${esc(d.name)}</b> (${overall(d)})` : ` · into the open <b>${a.pos}</b> slot`, action: `<button class="btn sm danger" data-cancel="${esc(c.add)}">Cancel</button>` }); }).join('')}</ul>`) : html`<p class="empty">No claims filed this week. Up to ${limit} resolve when the week advances.</p>`}`;
  } else if (ui.tab === 'offers') {
    const card = (o) => {
      const them = league.teams[o.from];
      const side = (ids, label) => `<div><div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em">${label}</div><ul class="plist">${ids.map((id) => playerItem(ctx.byId.get(id), { attrs: false, meta: inj(ctx.byId.get(id)) })).join('')}</ul></div>`;
      const verdict = o.userDelta > 4 ? ['Helps your lineup', 'var(--good)'] : o.userDelta >= -1 ? ['About even', 'var(--muted)'] : ['Costs your lineup', 'var(--bad)'];
      return `<div class="card tight" style="margin-bottom:.6rem">
        <div class="row between"><b>${teamChip(them).__raw} are calling</b><small class="muted">week ${o.week}</small></div>
        <p class="muted" style="margin:.2rem 0 .4rem;font-size:.85rem">${esc(o.note)}</p>
        <div class="grid grid-2">${side(o.gives, 'You get')}${side(o.wants, 'You give')}</div>
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
    const list = (team, sel, key) => `<ul class="plist">${ROSTER_SLOTS.map((s) => {
      const p = ctx.byId.get(team.slots[s.id]);
      if (!p) return '';
      const on = sel.has(p.id);
      return playerItem(p, { attrs: false, cls: on ? 'me' : '', meta: ` · <span class="badge slot">${s.id}</span>${inj(p)}`, action: `<button class="btn sm ${on ? 'primary' : ''}" data-${key}="${esc(p.id)}">${on ? 'Selected' : 'Select'}</button>` });
    }).join('')}</ul>`;
    const give = [...ui.give].filter((id) => slotOf(me, id)), get = [...ui.get].filter((id) => slotOf(partner, id));
    const v = give.length || get.length ? validateTrade(league, u, ui.partner, give, get, ctx.byId) : null;
    const strengthNow = lineupStrength(me.slots, ctx.byId, league);
    body = html`
      <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">${tradesOpen(league) ? `Trades are open through week ${deadline}. Positions must match on both sides, up to three players each. The other club judges the lineup it would field afterwards.` : league.phase === 'season' ? `The trade deadline passed after week ${deadline}.` : 'Trades are open during the regular season only.'}</p>
      <div class="row" style="gap:.5rem;align-items:center">
        <label style="margin:0">Trade with</label>
        <select id="partner" style="max-width:18rem">${league.teams.map((t, i) => (t.isUser ? '' : html`<option value="${i}" ${i === ui.partner ? 'selected' : ''}>${t.abbr} · ${t.name} (${t.record.w}-${t.record.l})</option>`))}</select>
      </div>
      <div class="grid grid-2" style="margin-top:.6rem">
        <div class="card tight"><h3>You give <small class="muted">(${teamChip(me, { abbr: true })} · strength ${strengthNow})</small></h3>${raw(list(me, ui.give, 'give'))}</div>
        <div class="card tight"><h3>You get <small class="muted">(${teamChip(partner, { abbr: true })})</small></h3>${raw(list(partner, ui.get, 'get'))}</div>
      </div>
      <div class="card tight" style="margin-top:.6rem;position:sticky;bottom:.5rem;z-index:5">
        <div class="row between">
          <div class="muted" style="font-size:.85rem">${give.length || get.length ? (v.ok ? html`<b style="color:var(--good)">Balanced</b> · ${give.length} for ${get.length}` : html`<span style="color:var(--bad)">${v.reason}</span>`) : 'Select players on both sides.'}</div>
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
      return `<li class="${team.isUser || other.isUser ? 'me' : ''}"><small class="muted">Wk ${t.week}</small> ${teamChip(team, { abbr: true }).__raw} sent <b>${t.gives.map((id) => esc(ctx.byId.get(id)?.name)).join(', ')}</b> to ${teamChip(other, { abbr: true }).__raw} for <b>${t.gets.map((id) => esc(ctx.byId.get(id)?.name)).join(', ')}</b></li>`;
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
  el.querySelector('#partner')?.addEventListener('change', (e) => { ui.partner = Number(e.target.value); ui.get.clear(); redraw(); });
  el.querySelector('#clearTrade')?.addEventListener('click', () => { ui.give.clear(); ui.get.clear(); redraw(); });
  el.querySelector('#propose')?.addEventListener('click', () => {
    const give = [...ui.give], get = [...ui.get];
    let r;
    ctx.update((s) => { r = proposeTrade(s.league, u, ui.partner, give, get, ctx.byId); }, { silent: true });
    const partner = league.teams[ui.partner];
    const m = modal(html`<h2>${r.accepted ? 'Deal' : 'No deal'}</h2>
      <p>${r.reason}</p>
      ${r.accepted ? html`<p class="muted">${give.map((id) => ctx.byId.get(id).name).join(', ')} to ${partner.name}; ${get.map((id) => ctx.byId.get(id).name).join(', ')} join you. Check your depth chart.</p>` : ''}
      <div class="row"><button class="btn primary" data-close>OK</button>${r.accepted ? html`<a class="btn" href="#/team/${u}">Depth chart</a>` : ''}</div>`);
    void m;
    if (r.accepted) { ui.give.clear(); ui.get.clear(); ui.tab = 'log'; }
    redraw();
  });
  el.addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) { playerModal(ctx.byId.get(show.dataset.show)); return; }
    const g = e.target.closest('[data-give]');
    if (g) { const id = g.dataset.give; if (ui.give.has(id)) ui.give.delete(id); else if (ui.give.size < 3) ui.give.add(id); else toast('Three players a side at most'); redraw(); return; }
    const t = e.target.closest('[data-get]');
    if (t) { const id = t.dataset.get; if (ui.get.has(id)) ui.get.delete(id); else if (ui.get.size < 3) ui.get.add(id); else toast('Three players a side at most'); redraw(); return; }
    const accept = e.target.closest('[data-accept]');
    if (accept) {
      try {
        let tx;
        ctx.update((s) => { tx = acceptOffer(s.league, accept.dataset.accept, ctx.byId); }, { silent: true });
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
