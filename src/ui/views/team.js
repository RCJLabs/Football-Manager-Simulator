import { html, render, raw } from '../../util.js';
import { ROSTER_SLOTS, POSITION_ORDER } from '../../data/positions.js';
import { GM_PERSONALITIES } from '../../data/teams.js';
import { buildLineup, teamPower, overall } from '../../engine/ratings.js';
import { playerItem, playerModal, teamChip, esc, outBadge, toast, modal } from '../components.js';
import { fillLineup, fmtWeeks, irList, irReady, canPlaceOnIr, placeOnIr, activateFromIr, releaseFromIr, irCapacity, IR_MIN_WEEKS } from '../../engine/injuries.js';
import { fantasyPoints } from '../../engine/stats.js';
import { chemistryFor, describeChemistry, MAX_BONUS } from '../../engine/chemistry.js';

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
  const onIr = irList(team).map((id) => ctx.byId.get(id)).filter(Boolean);
  const ready = new Set(irReady(league, team));
  const irOpen = irCapacity(league) - onIr.length;
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
    const irable = canEdit && league.phase === 'season' && canPlaceOnIr(league, idx, p.id);
    const arrows = canEdit && total > 1
      ? `${i > 0 ? `<button class="btn sm ghost" data-move="${slot.id}" data-dir="-1" aria-label="Move up">▲</button>` : ''}${i < total - 1 ? `<button class="btn sm ghost" data-move="${slot.id}" data-dir="1" aria-label="Move down">▼</button>` : ''}`
      : '';
    return playerItem(p, {
      cls: inj ? 'dim' : slot.starter || stepsUp ? '' : 'dim',
      meta: `<span class="badge slot">${slot.id}</span>${outBadge(inj).__raw}${slot.starter ? '' : stepsUp ? '<span class="badge" style="background:#2c4a37;color:#cfe6d6">starts</span>' : '<span class="badge">bench</span>'}${deal}${fp ? `<span class="badge" title="fantasy points">${fp.toFixed(1)} fp</span>` : ''}`,
      action: `${irable ? `<button class="btn sm" data-ir="${esc(p.id)}" title="${esc(`Free his slot; he stays yours and keeps healing. ${irOpen} place${irOpen === 1 ? '' : 's'} left.`)}">To IR</button>` : ''}${arrows}`,
      era: false,
    });
  })).join('');

  // Chemistry: the score is absolute so it does not jump around when another
  // club signs somebody, but what it is worth is measured against the league,
  // because an edge everyone has is not an edge.
  const chem = league.settings?.chemistry ? chemistryFor(league, idx, ctx.byId) : null;
  const chemCard = chem ? html`<div class="card tight">
    <h3>Chemistry <small class="muted" style="text-transform:none;letter-spacing:0">· ${chem.rank} of ${league.teams.length}</small></h3>
    <div class="row between" style="align-items:baseline">
      <b style="font-size:1.6rem">${chem.score}</b>
      <span class="muted" style="font-size:.85rem">league average ${chem.leagueMean} · worth ${chem.bonus >= 0 ? '+' : ''}${chem.bonus.toFixed(2)} on the field</span>
    </div>
    <p class="muted" style="font-size:.85rem;margin:.3rem 0 .4rem">${describeChemistry(chem)}</p>
    <table style="font-size:.85rem"><tbody>
      <tr><td>Together</td><td class="num">${chem.together} season${chem.together === 1 ? '' : 's'} on average</td></tr>
      <tr><td>Era spread</td><td class="num">±${chem.spread} years</td></tr>
    </tbody></table>
    <small class="muted">Worth at most ${MAX_BONUS.toFixed(1)} points either way, on blocking, coverage and a quarterback's timing — never on speed. A tight era band gels at once; a wide one stops mattering once the squad has played together.</small>
  </div>` : '';

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
        ${chemCard}
        ${onIr.length || (canEdit && league.phase === 'season' && hurt.some(({ inj }) => inj.weeks >= IR_MIN_WEEKS)) ? html`<div class="card tight">
          <h3>Injured reserve <small class="muted" style="text-transform:none;letter-spacing:0">· ${onIr.length} of ${irCapacity(league)}</small></h3>
          ${onIr.length ? raw(`<ul class="plist">${onIr.map((p) => {
            const inj = injuries[p.id];
            const fit = ready.has(p.id);
            return playerItem(p, {
              attrs: false,
              cls: fit ? '' : 'dim',
              meta: fit ? ' · <span class="badge" style="background:#2c4a37;color:#cfe6d6">fit</span>' : ` · ${esc(inj ? inj.kind : 'injured')}, <b>${fmtWeeks(inj ? inj.weeks : 0)}</b>`,
              action: canEdit ? `${fit ? `<button class="btn sm primary" data-activate="${esc(p.id)}">Activate</button>` : ''}<button class="btn sm danger" data-release="${esc(p.id)}">Release</button>` : '',
            });
          }).join('')}</ul>`) : html`<p class="muted" style="margin:0;font-size:.85rem">Empty. A player out ${IR_MIN_WEEKS} weeks or more can be parked here, which frees his roster slot to sign cover. He keeps healing and keeps his contract, but he cannot play or be traded until you activate him, which costs a roster spot in turn.</p>`}
        </div>` : ''}
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
    const ir = e.target.closest('[data-ir]');
    if (ir && canEdit) {
      const p = ctx.byId.get(ir.dataset.ir);
      const m = modal(html`<h2>Put ${p.name} on injured reserve?</h2>
        <p class="muted">His slot opens so you can sign cover from the wire. He stays yours and keeps healing, but he cannot play or be traded until you activate him, and activating him will cost a roster spot.</p>
        <div class="row"><button class="btn primary" id="yes">To injured reserve</button><button class="btn" data-close>Cancel</button></div>`);
      m.el.querySelector('#yes').addEventListener('click', () => {
        m.close();
        try {
          ctx.update((s) => { placeOnIr(s.league, idx, p.id); });
          toast(`${p.name} to injured reserve`);
        } catch (err) { toast(err.message); }
      });
      return;
    }
    const act = e.target.closest('[data-activate]');
    if (act && canEdit) { openActivate(ctx.byId.get(act.dataset.activate)); return; }
    const rel = e.target.closest('[data-release]');
    if (rel && canEdit) {
      const p = ctx.byId.get(rel.dataset.release);
      const m = modal(html`<h2>Release ${p.name}?</h2><p class="muted">He goes back into the pool and anyone can claim him.</p>
        <div class="row"><button class="btn danger" id="yes">Release</button><button class="btn" data-close>Cancel</button></div>`);
      m.el.querySelector('#yes').addEventListener('click', () => { m.close(); ctx.update((s) => { releaseFromIr(s.league, idx, p.id); }); toast(`${p.name} released`); });
      return;
    }
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
  function openActivate(p) {
    const open = ROSTER_SLOTS.find((s) => s.pos === p.pos && !team.slots[s.id]);
    const options = ROSTER_SLOTS.filter((s) => s.pos === p.pos && team.slots[s.id]).map((s) => ({ s, q: ctx.byId.get(team.slots[s.id]) })).filter((x) => x.q);
    const m = modal(html`
      <div class="row between"><h2 style="margin:0">Activate ${p.name}</h2><button class="btn sm ghost" data-close>✕</button></div>
      <p class="muted">${open ? `The ${open.id} slot is open, so nobody has to go.` : 'Your roster is full at his position. Who makes way?'}</p>
      ${open ? html`<button class="btn primary block" data-take="" style="margin-bottom:.5rem">Into the open ${open.id} slot</button>` : ''}
      <ul class="plist">${raw(options.map(({ s, q }) => playerItem(q, { attrs: false, meta: ` · <span class="badge slot">${s.id}</span>`, action: `<button class="btn sm danger" data-take="${esc(q.id)}">Release</button>` })).join(''))}</ul>`);
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-take]');
      if (!b) return;
      try {
        ctx.update((s) => { activateFromIr(s.league, idx, p.id, b.dataset.take || null, ctx.byId); });
        toast(`${p.name} activated`);
        m.close();
      } catch (err) { toast(err.message); }
    });
  }

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
