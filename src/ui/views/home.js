import { html, render, raw } from '../../util.js';
import { teamChip, toast, modal } from '../components.js';
import { fmtPhase } from './season.js';
import { listSlots, switchSlot, removeSlot, nameSlot, openNewSlot } from '../../store.js';

function slotsCard(ctx, league) {
  const { active, slots } = listSlots();
  if (!slots.length || (slots.length === 1 && league)) return '';
  const phaseText = (s) => s.summary && s.summary.phase !== 'empty' ? `${s.summary.mode === 'pro' ? 'Pro' : 'Fantasy'} · season ${s.summary.season} · ${s.summary.phase === 'season' ? `week ${s.summary.week} of ${s.summary.weeks}` : s.summary.phase}${s.summary.record ? ` · ${s.summary.team} ${s.summary.record}` : ''}` : 'empty';
  const total = slots.reduce((a, s) => a + (s.kb || 0), 0);
  return html`<div class="card" style="margin-top:1rem">
    <div class="row between"><h2 style="margin:0">Your leagues</h2><small class="muted">${slots.length} saved · ${total > 1024 ? `${(total / 1024).toFixed(1)} MB` : `${total} KB`} of browser storage${total > 3500 ? ' · getting close to the limit, export and delete old ones' : ''}</small></div>
    <ul class="plain ticker" style="max-height:none;margin-top:.5rem">${raw(slots.map((s) => `<li class="${s.id === active ? 'me' : ''}" style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap"><span style="min-width:0"><b>${s.name}</b>${s.id === active ? ' <span class="badge">open</span>' : ''}<br><small class="muted">${phaseText(s)} · ${s.kb || 0} KB</small></span><span class="btn-group">${s.id === active ? '' : `<button class="btn sm" data-open="${s.id}">Open</button>`}<button class="btn sm ghost" data-rename="${s.id}">Rename</button><button class="btn sm danger" data-del="${s.id}">Delete</button></span></li>`).join(''))}</ul>
  </div>`;
}

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) {
    render(root, html`
      <section class="hero">
        <h1>Every era. One league.</h1>
        <p>Draft real players at their prime — Otto Graham to Patrick Mahomes, Jim Brown to Saquon Barkley — then simulate a season against AI-built all-time teams, play by play.</p>
        <a class="btn primary lg" href="#/new">Start a league</a>
        <span style="display:inline-block;width:.5rem"></span>
        <a class="btn lg" href="#/players">Browse the player pool</a>
      </section>
      ${slotsCard(ctx, null)}
      <div class="features">
        <div class="feature"><b>Snake draft vs. AI GMs</b><span class="muted">Each rival general manager has a personality: Air Raid, Ground &amp; Pound, Old School, Analytics…</span></div>
        <div class="feature"><b>Play-by-play simulation</b><span class="muted">Ratings drive every snap: pass rush vs. protection, coverage vs. separation, tackling vs. YAC.</span></div>
        <div class="feature"><b>Manager or coach</b><span class="muted">Set strategy and watch, or call every play yourself, 4th-down decisions included.</span></div>
      </div>
      <p class="muted" style="margin-top:1.25rem;font-size:.85rem">Everything runs in your browser and saves locally. Installable as an app.</p>
    `);
    wireSlots(root, ctx);
    return;
  }
  const u = league.teams.findIndex((t) => t.isUser);
  const me = league.teams[u];
  const cont = league.phase === 'draft' ? (league.draftType === 'auction' ? '#/auction' : '#/draft') : league.phase === 'offseason' ? '#/offseason' : '#/season';
  render(root, html`
    <div class="card">
      <div class="row between">
        <div>
          <h2 style="margin:0">${league.name}</h2>
          <p class="muted" style="margin:.25rem 0 0">${fmtPhase(league)} · ${league.teams.length} teams</p>
        </div>
        <div class="row">
          <a class="btn primary" href="${cont}">Continue</a>
          <a class="btn" href="#/new">New league</a>
        </div>
      </div>
      <hr>
      <div class="row between">
        <div>${teamChip(me)} <span class="muted">${me.record.w}-${me.record.l}${me.record.t ? `-${me.record.t}` : ''}</span></div>
        <a class="btn sm" href="#/team/${u}">Roster &amp; strategy</a>
      </div>
    </div>
    <div class="features" style="margin-top:1rem">
      <a class="feature" href="#/players"><b>Player pool</b><span class="muted">Browse every player and who owns them.</span></a>
      <a class="feature" href="#/settings"><b>Settings &amp; sharing</b><span class="muted">Coach mode, injuries, save files, league codes.</span></a>
      <a class="feature" href="${cont}"><b>${league.phase === 'draft' ? 'Back to the auction room' : 'League hub'}</b><span class="muted">Schedule, standings, playoffs.</span></a>
    </div>
    ${slotsCard(ctx, league)}
  `);
  wireSlots(root, ctx);
}

function wireSlots(root, ctx) {
  root.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { switchSlot(open.dataset.open); toast('League opened'); ctx.navigate('#/'); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      const { slots } = listSlots();
      const s = slots.find((x) => x.id === del.dataset.del);
      const m = modal(html`<h2>Delete ${s ? s.name : 'this league'}?</h2><p class="muted">This removes it from this browser. Export it first if you want a backup.</p><div class="row"><button class="btn danger" id="yes">Delete</button><button class="btn" data-close>Cancel</button></div>`);
      m.el.querySelector('#yes').addEventListener('click', () => { m.close(); removeSlot(del.dataset.del); toast('Deleted'); ctx.navigate('#/'); });
      return;
    }
    const ren = e.target.closest('[data-rename]');
    if (ren) {
      const { slots } = listSlots();
      const s = slots.find((x) => x.id === ren.dataset.rename);
      const name = window.prompt('Name this save', s ? s.name : '');
      if (name && name.trim()) { nameSlot(ren.dataset.rename, name.trim()); ctx.navigate('#/'); }
    }
  });
  void openNewSlot;
}
