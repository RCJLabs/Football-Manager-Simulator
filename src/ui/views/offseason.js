import { html, render, raw } from '../../util.js';
import { ROSTER_SLOTS, POSITION_ORDER } from '../../data/positions.js';
import { overall } from '../../engine/ratings.js';
import { userTeamIndex, newSeasonSameRosters, standings } from '../../engine/season.js';
import { PLAYERS } from '../../data/db.js';
import {
  keeperCost, keeperEligible, keeperLimit, validateKeepers, enterOffseason, aiKeepers, confirmKeepers, seasonSummary, MAX_KEEPS,
} from '../../engine/offseason.js';
import { playerItem, playerModal, teamChip, toast, esc, modal } from '../components.js';
import { simulateAhead, describeRun } from '../../engine/autosim.js';
import { RNG } from '../../engine/rng.js';

const ui = { picked: null, leagueId: null, season: null };

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.phase === 'draft') { ctx.navigate(league.draftType === 'auction' ? '#/auction' : '#/draft'); return; }
  if (league.phase !== 'complete' && league.phase !== 'offseason') { ctx.navigate('#/season'); return; }
  if (league.phase === 'complete') {
    ctx.update((s) => { enterOffseason(s.league, ctx.players, ctx.byId); }, { silent: true });
  }
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const auction = league.draftType === 'auction';
  const limit = keeperLimit(league);
  if (ui.leagueId !== league.id || ui.season !== league.season || !ui.picked) { ui.leagueId = league.id; ui.season = league.season; ui.picked = new Set(); }
  const picked = [...ui.picked].filter((id) => ROSTER_SLOTS.some((s) => me.slots[s.id] === id));
  ui.picked = new Set(picked);
  const v = validateKeepers(league, u, picked);
  const summary = seasonSummary(league);
  const table = standings(league);
  const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], k = n % 100; return n + (s[(k - 20) % 10] || s[k] || s[0]); };

  const groups = POSITION_ORDER.map((pos) => ({
    pos,
    rows: ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => me.slots[s.id]).filter(Boolean).map((id) => ({ p: ctx.byId.get(id), c: league.contracts[id] || {} })),
  })).filter((g) => g.rows.length);

  const rowFor = ({ p, c }) => {
    const on = ui.picked.has(p.id);
    const eligible = keeperEligible(c);
    const cost = keeperCost(c);
    const meta = auction
      ? ` · last <b>$${c.salary ?? 1}</b>${eligible ? ` → keep at <b>$${cost}</b>` : ''}${c.kept ? ` · kept ${c.kept}×` : ''}`
      : ` · round ${c.round ?? '—'}${c.kept ? ` · kept ${c.kept}×` : ''}`;
    const action = eligible
      ? `<button class="btn sm ${on ? 'primary' : ''}" data-keep="${esc(p.id)}">${on ? 'Keeping' : 'Keep'}</button>`
      : `<span class="badge out" title="kept ${MAX_KEEPS} years running">must return</span>`;
    return playerItem(p, { attrs: false, cls: on ? 'me' : eligible ? '' : 'dim', meta, action });
  };

  const aiTable = league.teams.map((t, i) => {
    if (t.isUser) return '';
    const ids = league.offseason.keepers[i] || [];
    const cost = auction ? ids.reduce((s, id) => s + keeperCost(league.contracts[id]), 0) : 0;
    return `<tr><td>${teamChip(t, { responsive: true }).__raw}</td><td class="num">${ids.length}</td>${auction ? `<td class="num">$${cost}</td><td class="num muted">$${200 - cost}</td>` : ''}<td class="hide-sm muted" style="font-size:.8rem">${ids.map((id) => esc(ctx.byId.get(id)?.name)).join(', ') || '—'}</td></tr>`;
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

  render(root, html`<div id="offseason-view">
    <div class="card">
      <h1 style="margin:0">Offseason · after season ${league.offseason.season}</h1>
      ${league.offseason.rookies ? html`<p class="notice" style="margin:.5rem 0 0"><b>${league.offseason.rookies} rookies</b> entered the pool${league.offseason.washedOut ? `, and ${league.offseason.washedOut} unsigned from earlier classes washed out` : ''}. <a href="#/players">Look them over</a> before the ${auction ? 'auction' : 'draft'}.</p>` : ''}
      ${yearOlder}
      ${summary ? html`<p class="muted" style="margin:.3rem 0 0">${teamChip(summary.champion)} won the title. You finished <b>${ord(summary.user.rank)}</b> of ${summary.teams} at ${summary.user.record.w}-${summary.user.record.l}${summary.user.record.t ? `-${summary.user.record.t}` : ''}.</p>` : ''}
      <p class="muted" style="font-size:.9rem;margin:.5rem 0 0">
        ${auction
          ? html`Keep up to <b>${limit}</b> players. A keeper costs last year's price plus the greater of $3 or 15%, and a player can be kept three years running before he must go back to the pool. Everyone else returns to the pool and the remaining cap buys the rest at auction. The worst club nominates first.`
          : html`Keep up to <b>${limit}</b> players; they hold their slots. Everyone else returns to the pool and a draft fills the rest, worst club first. A player can be kept three years running before he must go back to the pool.`}
      </p>
    </div>
    <div class="grid grid-2" style="margin-top:.75rem">
      <div class="card tight">
        <h3>Your keepers <small class="muted" style="text-transform:none;letter-spacing:0">· ${picked.length} of ${limit}</small></h3>
        ${raw(groups.map((g) => `<div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;margin:.5rem 0 .2rem">${g.pos}</div><ul class="plist">${g.rows.map(rowFor).join('')}</ul>`).join(''))}
      </div>
      <div class="stack">
        <div class="card tight" style="position:sticky;top:.5rem;z-index:5">
          <h3>${auction ? 'Cap' : 'Summary'}</h3>
          ${auction ? html`
            <div class="kv">
              <dt>Keepers</dt><dd><b>$${v.committed ?? 0}</b> for ${picked.length}</dd>
              <dt>For the auction</dt><dd><b>$${v.ok ? v.budget : Math.max(0, 200 - (v.committed ?? 0))}</b> across ${ROSTER_SLOTS.length - picked.length} slots</dd>
            </div>
            <div class="bar" style="margin:.4rem 0"><i style="width:${Math.min(100, ((v.committed ?? 0) / 200) * 100)}%"></i></div>` : html`<p class="muted" style="margin:0">${picked.length} kept, ${ROSTER_SLOTS.length - picked.length} to draft.</p>`}
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
