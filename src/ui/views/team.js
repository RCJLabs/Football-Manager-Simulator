import { html, render, raw } from '../../util.js';
import { ROSTER_SLOTS, POSITION_ORDER } from '../../data/positions.js';
import { GM_PERSONALITIES } from '../../data/teams.js';
import { buildLineup, teamPower, overall } from '../../engine/ratings.js';
import { playerItem, playerModal, teamChip, esc, outBadge } from '../components.js';
import { fillLineup, fmtWeeks } from '../../engine/injuries.js';
import { fantasyPoints } from '../../engine/stats.js';

const STRATEGY_FIELDS = [
  { key: 'passRate', label: 'Pass / run balance', lo: 'Run heavy', hi: 'Pass heavy', min: 0.35, max: 0.7 },
  { key: 'aggression', label: '4th-down aggression', lo: 'Conservative', hi: 'Go for it', min: 0, max: 1 },
  { key: 'tempo', label: 'Tempo', lo: 'Slow', hi: 'Fast', min: 0, max: 1 },
  { key: 'blitzRate', label: 'Blitz frequency', lo: 'Rarely', hi: 'Often', min: 0.05, max: 0.6 },
  { key: 'deepShell', label: 'Deep coverage', lo: 'Aggressive', hi: 'Prevent', min: 0, max: 0.6 },
];

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/'); return; }
  const idx = Number(params.idx);
  const team = league.teams[idx];
  if (!team) { ctx.navigate('#/'); return; }
  const injuries = league.injuries || {};
  // Who actually takes the field this week: hurt players sit, short groups get fill-ins.
  const lineup = fillLineup(buildLineup(team.slots, ctx.byId, injuries));
  const power = teamPower(lineup);
  const hurt = ROSTER_SLOTS.map((s) => team.slots[s.id]).filter((id) => id && injuries[id]).map((id) => ({ p: ctx.byId.get(id), inj: injuries[id] }));
  const fillIns = Object.values(lineup).flat().filter((p) => p.replacement);
  const gm = GM_PERSONALITIES.find((g) => g.id === team.gm);
  const canEdit = team.isUser;
  const stats = team.seasonStats.players;

  const groups = POSITION_ORDER.map((pos) => {
    const slots = ROSTER_SLOTS.filter((s) => s.pos === pos);
    return { pos, slots: slots.map((s, i) => ({ slot: s, i, total: slots.length, p: team.slots[s.id] ? ctx.byId.get(team.slots[s.id]) : null })) };
  });

  const depthRows = groups.flatMap((g) => g.slots.map(({ slot, i, total, p }) => {
    if (!p) return `<li class="prow dim"><span class="badge slot">${slot.id}</span><div class="who"><div class="meta">empty${canEdit && league.phase === 'season' ? ' · <a href="#/moves">claim a free agent</a>' : ''}</div></div><div class="act"></div></li>`;
    const fp = stats[p.id] ? fantasyPoints(stats[p.id]) : 0;
    const inj = injuries[p.id];
    const c = league.contracts?.[p.id];
    const deal = c ? (league.draftType === 'auction' ? `<span class="badge" title="contract">$${c.salary}${c.kept ? ` · kept ${c.kept}×` : ''}</span>` : c.kept ? `<span class="badge" title="keeper">kept ${c.kept}×</span>` : '') : '';
    // A bench player starts when the man ahead of him is hurt.
    const healthyAhead = ROSTER_SLOTS.filter((x) => x.pos === slot.pos).slice(0, i).filter((x) => team.slots[x.id] && !injuries[team.slots[x.id]]).length;
    const stepsUp = !inj && !slot.starter && healthyAhead < ROSTER_SLOTS.filter((x) => x.pos === slot.pos && x.starter).length;
    const arrows = canEdit && total > 1
      ? `${i > 0 ? `<button class="btn sm ghost" data-move="${slot.id}" data-dir="-1" aria-label="Move up">▲</button>` : ''}${i < total - 1 ? `<button class="btn sm ghost" data-move="${slot.id}" data-dir="1" aria-label="Move down">▼</button>` : ''}`
      : '';
    return playerItem(p, {
      cls: inj ? 'dim' : slot.starter || stepsUp ? '' : 'dim',
      meta: `<span class="badge slot">${slot.id}</span>${outBadge(inj).__raw}${slot.starter ? '' : stepsUp ? '<span class="badge" style="background:#2c4a37;color:#cfe6d6">starts</span>' : '<span class="badge">bench</span>'}${deal}${fp ? `<span class="badge" title="fantasy points">${fp.toFixed(1)} fp</span>` : ''}`,
      action: arrows,
      era: false,
    });
  })).join('');

  render(root, html`<div id="team-view">
    <div class="card">
      <h1 style="margin:0">${teamChip(team)}</h1>
      <p class="muted" style="margin:.25rem 0 .5rem;font-size:.9rem">${team.record.w}-${team.record.l}${team.record.t ? `-${team.record.t}` : ''} · PF ${team.record.pf} · PA ${team.record.pa} · Power <b>${power}</b>${gm ? html` · <span class="badge gm">${gm.name}</span>` : ''}</p>
      ${league.teams.length > 12
        ? html`<select id="teamPick" style="max-width:20rem">${league.teams.map((t, i) => html`<option value="${i}" ${i === idx ? 'selected' : ''}>${t.abbr} · ${t.name}${t.isUser ? ' (you)' : ''}</option>`)}</select>`
        : html`<div class="tabs">${league.teams.map((t, i) => html`<a class="tab ${i === idx ? 'active' : ''}" href="#/team/${i}">${t.abbr}</a>`)}</div>`}
    </div>
    <div class="grid grid-3" style="margin-top:.75rem">
      <div class="card tight">
        <h3>Depth chart</h3>
        ${canEdit ? html`<p class="muted" style="font-size:.78rem;margin:-.25rem 0 .4rem">▲▼ reorders players within a position.</p>` : ''}
        <ul class="plist">${raw(depthRows)}</ul>
      </div>
      <div class="stack">
        ${hurt.length || fillIns.length ? html`<div class="card tight">
          <h3>Injury report</h3>
          ${hurt.length ? raw(`<ul class="plain ticker" style="max-height:none">${hurt.map(({ p, inj }) => `<li><b>${esc(p.name)}</b> <small class="muted">${p.pos}</small> — ${esc(inj.kind)}, <b>${fmtWeeks(inj.weeks)}</b></li>`).join('')}</ul>`) : ''}
          ${fillIns.length ? html`<p class="muted" style="font-size:.85rem;margin:.4rem 0 0">${fillIns.length === 1 ? 'A replacement-level fill-in starts at' : 'Replacement-level fill-ins start at'} ${fillIns.map((p) => p.pos).join(', ')}. ${canEdit ? html`<a href="#/moves">Find cover on the wire.</a>` : ''}</p>` : ''}
        </div>` : ''}
        <div class="card tight">
          <h3>Strategy ${canEdit ? '' : html`<small class="muted">(AI)</small>`}</h3>
          ${STRATEGY_FIELDS.map((f) => html`<div class="slider-row">
            <div class="lbl"><span>${f.label}</span><b id="lbl-${f.key}">${pctLabel(f, team.strategy[f.key])}</b></div>
            <input type="range" data-strat="${f.key}" min="${f.min}" max="${f.max}" step="0.01" value="${team.strategy[f.key]}" ${canEdit ? '' : 'disabled'}>
            <div class="lbl"><span>${f.lo}</span><span>${f.hi}</span></div>
          </div>`)}
        </div>
        <div class="card tight">
          <h3>Unit ratings</h3>
          ${raw(unitTable(lineup))}
        </div>
      </div>
    </div>
  </div>`);

  const el = root.querySelector('#team-view');
  el.querySelector('#teamPick')?.addEventListener('change', (e) => ctx.navigate(`#/team/${e.target.value}`));
  el.addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) { playerModal(ctx.byId.get(show.dataset.show)); return; }
    const mv = e.target.closest('[data-move]');
    if (mv && canEdit) {
      const slotId = mv.dataset.move, dir = Number(mv.dataset.dir);
      const pos = ROSTER_SLOTS.find((s) => s.id === slotId).pos;
      const group = ROSTER_SLOTS.filter((s) => s.pos === pos);
      const i = group.findIndex((s) => s.id === slotId);
      const j = i + dir;
      if (j < 0 || j >= group.length) return;
      ctx.update((s) => {
        const t = s.league.teams[idx];
        const a = t.slots[group[i].id], b = t.slots[group[j].id];
        t.slots[group[i].id] = b; t.slots[group[j].id] = a;
      });
    }
  });
  for (const input of el.querySelectorAll('[data-strat]')) {
    const f = STRATEGY_FIELDS.find((x) => x.key === input.dataset.strat);
    input.addEventListener('input', () => { el.querySelector(`#lbl-${f.key}`).textContent = pctLabel(f, Number(input.value)); });
    input.addEventListener('change', () => ctx.update((s) => { s.league.teams[idx].strategy[f.key] = Number(input.value); }, { silent: true }));
  }
}

function pctLabel(f, v) {
  if (f.key === 'passRate') return `${Math.round(v * 100)}% pass`;
  return `${Math.round(((v - f.min) / (f.max - f.min)) * 100)}`;
}

function unitTable(lineup) {
  const avg = (arr, n) => { const a = (arr || []).slice(0, n); return a.length ? Math.round(a.reduce((s, p) => s + overall(p), 0) / a.length) : 0; };
  const rows = [
    ['QB', avg(lineup.QB, 1)], ['RB', avg(lineup.RB, 2)], ['WR', avg(lineup.WR, 3)], ['TE', avg(lineup.TE, 1)], ['OL', avg(lineup.OL, 5)],
    ['DL', avg(lineup.DL, 4)], ['LB', avg(lineup.LB, 3)], ['CB', avg(lineup.CB, 2)], ['S', avg(lineup.S, 2)],
    ['K/P', Math.round(((lineup.K?.[0] ? overall(lineup.K[0]) : 70) + (lineup.P?.[0] ? overall(lineup.P[0]) : 70)) / 2)],
  ];
  return `<div class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd><div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${v}%"></i></div><b style="min-width:2rem;text-align:right">${v || '—'}</b></div></dd>`).join('')}</div>`;
}
