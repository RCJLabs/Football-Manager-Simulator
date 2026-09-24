import { html, render, raw } from '../../util.js';
import { ROSTER_SLOTS, POSITION_ORDER, POSITIONS } from '../../data/positions.js';
import { GM_PERSONALITIES } from '../../data/teams.js';
import { buildLineup, teamPower, overall } from '../../engine/ratings.js';
import { playerItem, playerModal, teamChip, esc, outBadge, toast, modal } from '../components.js';
import { fillLineup, fmtWeeks, irList, irReady, canPlaceOnIr, placeOnIr, activateFromIr, releaseFromIr, irCapacity, IR_MIN_WEEKS } from '../../engine/injuries.js';
import { squadList, squadCapacity, squadOn, canStash, stash, promote, releaseFromSquad, SQUAD_SEASONS } from '../../engine/squad.js';
import { fantasyPoints } from '../../engine/stats.js';
import { chemistryFor, describeChemistry, MAX_BONUS } from '../../engine/chemistry.js';
import { strategyRead } from '../../engine/strategy.js';
import { autoDepth } from '../../engine/season.js';
import { focusOn, focusOf, namedFocus, toggleFocus, resetFocus, ageOf, FOCUS_SLOTS } from '../../engine/focus.js';
import { careerPhase, primeOf, rootOf } from '../../engine/careers.js';
import { teamContractIds } from '../../engine/cap.js';
import { movesOpen, candidatesFor, convertPlayer } from '../../engine/convert.js';
import { SETTLING } from '../../engine/translate.js';

// Grouped by what each one was measured to be worth, because presenting five
// dials as five equal decisions is not what the numbers say. See strategy.js.
const STRATEGY_FIELDS = [
  { key: 'passRate', label: 'Pass / run balance', lo: 'Run heavy', hi: 'Pass heavy', min: 0.35, max: 0.7, group: 'decides' },
  { key: 'aggression', label: '4th-down aggression', lo: 'Conservative', hi: 'Go for it', min: 0, max: 1, group: 'helps' },
  { key: 'tempo', label: 'Tempo', lo: 'Slow', hi: 'Fast', min: 0, max: 1, group: 'flat' },
  { key: 'blitzRate', label: 'Blitz frequency', lo: 'Rarely', hi: 'Often', min: 0.05, max: 0.6, group: 'helps' },
  { key: 'deepShell', label: 'Deep coverage', lo: 'Aggressive', hi: 'Prevent', min: 0, max: 0.6, group: 'helps' },
];

const GROUP_NOTES = {
  helps: 'Measured against the clubs you play. Going for it on fourth down more is worth a sixth to a third of a point a game four-fifths of the way up the dial against where it starts, and no more at the very top, while going for it less costs about a fifth; a weak offence with a poor kicker gains next to nothing either way. Blitzing less wins four-tenths to half a point at the far end, and sitting deeper in coverage about a third of a point in a fantasy league and nothing in a pro one.',
  flat: 'Pace changes how a game looks more than who wins it. At every setting it comes out within about a quarter of a point of the default, so set it to taste.',
};

/**
 * Which section is open. The team page was doing four unrelated jobs in one
 * scroll — the depth chart, chemistry, the injury desk and the strategy dials —
 * which measured 3,341px on a phone with the chart itself only 1,831px of it.
 * Kept module-level and mirrored in the route the way moves.js does it, so it
 * survives a re-render and the back button works.
 */
const TABS = [['depth', 'Depth'], ['squad', 'Squad'], ['injuries', 'Injuries'], ['strategy', 'Strategy']];
const ui = { tab: 'depth', devOpen: false };

export function view(root, params, ctx) {
  if (params && params.tab) {
    if (TABS.some(([k]) => k === params.tab)) ui.tab = params.tab;
    delete params.tab;
  }
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
  const onSquad = squadList(team).map((id) => ctx.byId.get(id)).filter(Boolean);
  const squadOpen = squadCapacity(league) - onSquad.length;
  const ready = new Set(irReady(league, team));
  const irOpen = irCapacity(league) - onIr.length;
  const gm = GM_PERSONALITIES.find((g) => g.id === team.gm);
  const canEdit = team.isUser;
  const stats = team.seasonStats.players;

  // A young player can be sent down instead of being beaten out of the league.
  const downable = (p) => canEdit && canStash(league, idx, p.id, ctx.byId);

  const groups = POSITION_ORDER.map((pos) => {
    const slots = ROSTER_SLOTS.filter((s) => s.pos === pos);
    return { pos, slots: slots.map((s, i) => ({ slot: s, i, total: slots.length, p: team.slots[s.id] ? ctx.byId.get(team.slots[s.id]) : null })) };
  });

  // The attribute line is a third of a row's height, and the chart is 27 rows
  // long. Someone reading their own squad wants the numbers; someone hunting for
  // a kicker wants the list short. `showAttrs` has been in the preferences since
  // the beginning without anything reading it — this is what it was for.
  const showAttrs = ctx.getState().prefs?.showAttrs !== false;

  // An open slot can be filled by moving one of your own men into it, when his
  // skills translate — see convert.js. Asked per open slot only, so a full
  // chart costs nothing.
  const converting = canEdit && movesOpen(league);
  const rowFor = ({ slot, i, total, p }) => {
    if (!p) {
      const movable = converting && candidatesFor(league, idx, slot.id, ctx.byId).length > 0;
      return `<li class="prow dim"><span class="badge slot">${slot.id}</span><div class="who"><div class="meta">empty${canEdit && league.phase === 'season' ? ' · <a href="#/moves">claim a free agent</a>' : ''}</div></div><div class="act">${movable ? `<button class="btn sm" data-convert="${slot.id}">Move a man here</button>` : ''}</div></li>`;
    }
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
      meta: `<span class="badge slot">${slot.id}</span>${p.moved ? `<span class="badge" title="${esc(`Moved from ${p.moved.from} for ${p.moved.season}${p.settling ? ` and still learning the job: ${p.settling} off every skill this season` : ''}`)}">was ${p.moved.from}${p.settling ? ` · −${p.settling}` : ''}</span>` : ''}${outBadge(inj).__raw}${slot.starter ? '' : stepsUp ? '<span class="badge" style="background:#2c4a37;color:#cfe6d6">starts</span>' : '<span class="badge">bench</span>'}${deal}${fp ? `<span class="badge" title="fantasy points">${fp.toFixed(1)} fp</span>` : ''}`,
      action: `${irable ? `<button class="btn sm" data-ir="${esc(p.id)}" title="${esc(`Free his slot; he stays yours and keeps healing. ${irOpen} place${irOpen === 1 ? '' : 's'} left.`)}">To IR</button>` : ''}${downable(p) ? `<button class="btn sm" data-down="${esc(p.id)}" title="${esc(`Free his slot; he stays yours, keeps developing and costs the minimum. ${squadOpen} place${squadOpen === 1 ? '' : 's'} left.`)}">Send down</button>` : ''}${arrows}`,
      era: false,
      attrs: showAttrs,
      // The group header says the position and the slot badge says which one he
      // is; a third copy next to the name only wraps it onto another line.
      pos: false,
    });
  };

  /**
   * One line per position group, so a 27-row scroll has landmarks in it. The
   * summary is what you would go looking for anyway: how deep the group is, the
   * best man in it, and whether anything is wrong — an empty slot or an injury
   * that the rows themselves only reveal once you have scrolled to them.
   */
  function groupHead(g) {
    const filled = g.slots.filter((x) => x.p);
    const best = filled.reduce((m, x) => Math.max(m, overall(x.p)), 0);
    const empty = g.slots.length - filled.length;
    const out = filled.filter((x) => injuries[x.p.id]).length;
    const flags = [
      empty ? `<span class="badge warn">${empty} empty</span>` : '',
      out ? `<span class="badge warn">${out} out</span>` : '',
    ].join('');
    return `<h4 class="poshead" id="pos-${g.pos}">
      <span>${POSITIONS[g.pos]?.name || g.pos}</span>
      <small>${g.slots.length} deep${best ? ` · best ${best}` : ''}</small>${flags}
    </h4>`;
  }

  const depthChart = groups.map((g) => `${groupHead(g)}<ul class="plist">${g.slots.map(rowFor).join('')}</ul>`).join('');
  const jumpBar = `<div class="jump" role="navigation" aria-label="Jump to a position">${
    groups.map((g) => `<button type="button" class="chip" data-jump="${g.pos}">${g.pos}</button>`).join('')}</div>`;

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

  // Development focus. Only your own club chooses, and only while a season's
  // development is still to come: it is applied when the offseason opens.
  const focusing = canEdit && focusOn(league) && ['season', 'playoffs', 'complete'].includes(league.phase);
  let devCard = '';
  if (focusing) {
    const named = namedFocus(league, idx);
    const picked = focusOf(league, idx, ctx.byId);
    const full = picked.length >= FOCUS_SLOTS;
    // A man whose career has not started yet shows the age it will start at —
    // the same one the staff's picks read — rather than no age at all.
    const aged = (p) => (p && p.age == null ? { ...p, age: ageOf(league, p) } : p);
    const devRow = (id) => {
      const p = aged(ctx.byId.get(id));
      if (!p) return '';
      const on = picked.includes(id);
      const phase = p.age != null ? ` · ${careerPhase(rootOf(p).pos, p.age)}` : '';
      const button = `<button class="btn sm ${on ? 'primary' : ''}" data-focus="${esc(id)}" ${!on && full ? 'disabled title="Three at most — take somebody off first"' : ''}>${on ? 'Focused' : 'Focus'}</button>`;
      return playerItem(p, { attrs: false, meta: phase, action: button, cls: on ? 'me' : '' });
    };
    // Youngest against his position's peak first: the list reads from the men
    // with the most season ahead of them to the ones with the most behind.
    const rest = teamContractIds(league, idx).filter((id) => !picked.includes(id)).map((id) => aged(ctx.byId.get(id))).filter(Boolean)
      .sort((a, b) => ((a.age ?? 99) - primeOf(a)) - ((b.age ?? 99) - primeOf(b)) || overall(b) - overall(a));
    devCard = html`<div class="card tight" id="devCard">
      <h3>Development focus <small class="muted" style="text-transform:none;letter-spacing:0">· ${picked.length} of ${FOCUS_SLOTS}${named ? '' : ' · your staff\'s picks'}</small></h3>
      <p class="muted" style="font-size:.85rem;margin:.2rem 0 .4rem">Name up to ${FOCUS_SLOTS} men. One still climbing climbs faster; one past his peak slips more slowly. It is not free — every man you name makes the rest of the roster develop a little slower. Name nobody and your staff chooses, as every other club's does. It is applied when the season ends.</p>
      ${picked.length ? html`<ul class="plist">${raw(picked.map(devRow).join(''))}</ul>` : html`<p class="empty">Nobody — the whole roster develops at its own rate.</p>`}
      ${named ? html`<button type="button" class="btn sm ghost" id="focusReset">Back to the staff's picks</button>` : ''}
      <details id="devMore" ${ui.devOpen ? 'open' : ''} style="margin-top:.4rem"><summary style="cursor:pointer;font-size:.85rem" class="muted">Choose from your roster (${rest.length})</summary>
        <ul class="plist">${raw(rest.map((p) => devRow(p.id)).join(''))}</ul>
      </details>
    </div>`;
  }

  const irCard = onIr.length || (canEdit && league.phase === 'season' && hurt.some(({ inj }) => inj.weeks >= IR_MIN_WEEKS)) ? html`<div class="card tight">
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
  </div>` : '';

  const psCard = squadOn(league) && (onSquad.length || canEdit) ? html`<div class="card tight">
    <h3>Practice squad <small class="muted" style="text-transform:none;letter-spacing:0">· ${onSquad.length} of ${squadCapacity(league)}</small></h3>
    ${onSquad.length ? raw(`<ul class="plist">${onSquad.map((p) => playerItem(p, {
      attrs: false,
      meta: ` · <span class="badge">class of ${esc(String(p.draftClass ?? ''))}</span>`,
      action: canEdit ? `<button class="btn sm primary" data-up="${esc(p.id)}">Bring up</button><button class="btn sm danger" data-cut="${esc(p.id)}">Release</button>` : '',
    })).join('')}</ul>`) : html`<p class="muted" style="margin:0;font-size:.85rem">Empty. A player within ${SQUAD_SEASONS} seasons of his draft class can be sent down here, which frees his roster slot. He stays yours, keeps developing, and costs the minimum while he is down — but he cannot play until you bring him up, which costs a roster spot in turn.</p>`}
  </div>` : '';

  const reportCard = hurt.length || fillIns.length ? html`<div class="card tight">
    <h3>Injury report</h3>
    ${hurt.length ? raw(`<ul class="plain ticker" style="max-height:none">${hurt.map(({ p, inj }) => `<li><b>${esc(p.name)}</b> <small class="muted">${p.pos}</small> — ${esc(inj.kind)}, <b>${fmtWeeks(inj.weeks)}</b></li>`).join('')}</ul>`) : ''}
    ${fillIns.length ? html`<p class="muted" style="font-size:.85rem;margin:.4rem 0 0">${fillIns.length === 1 ? 'A replacement-level fill-in starts at' : 'Replacement-level fill-ins start at'} ${fillIns.map((p) => p.pos).join(', ')}. ${canEdit ? html`<a href="#/moves">Find cover on the wire.</a>` : ''}</p>` : ''}
  </div>` : '';

  // Only the club you manage gets a read: telling you what a rival should be
  // doing is coaching the opposition.
  const read = canEdit ? strategyRead(league, idx, ctx.byId) : null;

  // A tab that has nothing to say is worth saying so on, rather than showing an
  // empty page and leaving the player wondering whether it failed to load.
  const nothing = (what) => html`<div class="card tight"><p class="muted" style="margin:0">${what}</p></div>`;
  const hurtCount = hurt.length + onIr.length;

  const sections = {
    depth: html`<div class="stack"><div class="card tight">
      <div class="row between" style="align-items:baseline">
        <h3 style="margin:0">Depth chart</h3>
        <button type="button" class="btn sm ghost" id="density" aria-pressed="${showAttrs ? 'false' : 'true'}">${showAttrs ? 'Compact' : 'Show ratings'}</button>
      </div>
      ${raw(jumpBar)}
      ${canEdit ? html`<p class="muted" style="font-size:.78rem;margin:.1rem 0 .4rem">▲▼ reorders players within a position. <button type="button" class="btn sm" id="autoDepth" style="margin-left:.3rem">Auto-order</button></p>` : ''}
      ${raw(depthChart)}
    </div>${psCard}</div>`,
    squad: html`<div class="grid grid-2">
      ${devCard}
      ${chemCard || nothing('Chemistry is switched off for this league.')}
      <div class="card tight"><h3>Unit ratings</h3>${raw(unitTable(lineup))}</div>
    </div>`,
    injuries: irCard || reportCard ? html`<div class="stack">${reportCard}${irCard}</div>` : nothing('Nobody is hurt and the injured reserve is empty.'),
    strategy: html`<div class="stack">
      ${read ? html`<div class="card tight">
        <h3>What you built</h3>
        <p style="margin:.1rem 0 .4rem"><b>${read.lean === 'run' ? 'A running team.' : read.lean === 'pass' ? 'A throwing team.' : 'An even team.'}</b> <span class="muted">${read.why}</span></p>
        <div class="row between" style="align-items:baseline;gap:.6rem;flex-wrap:wrap">
          <span class="muted" style="font-size:.9rem">Suits this squad: <b style="color:var(--fg,#e8f0ea)">${Math.round(read.rate * 100)}% pass</b> · you are at ${Math.round(read.current * 100)}%</span>
          ${canEdit && read.act ? html`<button class="btn sm primary" id="useFit">Set it there</button>` : ''}
        </div>
        <small class="muted">${read.act ? `Moving it is ${read.strength}.` : read.even ? 'Your squad is even enough that this is close to a free choice.' : 'Your dial is already about where it should be.'} The read comes from who is on the field now, so it moves when you sign, drop or lose somebody.</small>
      </div>` : ''}
      <div class="card tight">
        <h3>Strategy ${canEdit ? '' : html`<small class="muted">(AI)</small>`}</h3>
        ${['decides', 'helps', 'flat'].map((group) => html`${STRATEGY_FIELDS.filter((f) => f.group === group).map((f) => html`<div class="slider-row">
          <div class="lbl"><span>${f.label}</span><b id="lbl-${f.key}">${pctLabel(f, team.strategy[f.key])}</b></div>
          <input type="range" data-strat="${f.key}" min="${f.min}" max="${f.max}" step="0.01" value="${team.strategy[f.key]}" ${canEdit ? '' : 'disabled'}>
          <div class="lbl"><span>${f.lo}</span><span>${f.hi}</span></div>
        </div>`)}${GROUP_NOTES[group] ? html`<small class="muted" style="display:block;margin:-.2rem 0 .7rem">${GROUP_NOTES[group]}</small>` : ''}`)}
      </div>
    </div>`,
  };

  render(root, html`<div id="team-view">
    <div class="card">
      <h1 style="margin:0">${teamChip(team)}</h1>
      <p class="muted" style="margin:.25rem 0 .5rem;font-size:.9rem">${team.record.w}-${team.record.l}${team.record.t ? `-${team.record.t}` : ''} · PF ${team.record.pf} · PA ${team.record.pa} · Power <b>${power}</b>${gm ? html` · <span class="badge gm">${gm.name}</span>` : ''}</p>
      ${league.teams.length > 12
        ? html`<select id="teamPick" style="max-width:20rem">${league.teams.map((t, i) => html`<option value="${i}" ${i === idx ? 'selected' : ''}>${t.abbr} · ${t.name}${t.isUser ? ' (you)' : ''}</option>`)}</select>`
        : html`<div class="tabs">${league.teams.map((t, i) => html`<a class="tab ${i === idx ? 'active' : ''}" href="#/team/${i}/${ui.tab}">${t.abbr}</a>`)}</div>`}
    </div>
    <div class="tabs sections" style="margin-top:.75rem">${TABS.map(([k, label]) => html`<a class="tab ${ui.tab === k ? 'active' : ''}" href="#/team/${idx}/${k}">${label}${k === 'injuries' && hurtCount ? raw(`<i class="dot" title="${hurtCount} hurt or on injured reserve"></i>`) : ''}</a>`)}</div>
    <div style="margin-top:.6rem">${sections[ui.tab] || sections.depth}</div>
  </div>`);

  const el = root.querySelector('#team-view');
  el.querySelector('#teamPick')?.addEventListener('change', (e) => ctx.navigate(`#/team/${e.target.value}/${ui.tab}`));

  // The jump bar cannot be links: this is a hash router, so `href="#pos-OL"`
  // would be read as a route and take you off the page.
  el.querySelector('.jump')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-jump]');
    if (!chip) return;
    el.querySelector(`#pos-${chip.dataset.jump}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  el.querySelector('#useFit')?.addEventListener('click', () => {
    ctx.update((s) => { s.league.teams[idx].strategy.passRate = read.rate; });
    toast(`Pass/run balance set to ${Math.round(read.rate * 100)}% pass`);
  });

  el.querySelector('#density')?.addEventListener('click', () => {
    ctx.update((s) => { s.prefs.showAttrs = !showAttrs; });
  });

  el.querySelector('#devMore')?.addEventListener('toggle', (e) => { ui.devOpen = e.target.open; });
  el.querySelector('#focusReset')?.addEventListener('click', () => ctx.update((st) => { resetFocus(st.league, idx); }));
  el.addEventListener('click', (e) => {
    const fb = e.target.closest('[data-focus]');
    if (fb && canEdit) {
      let res;
      ctx.update((st) => { res = toggleFocus(st.league, idx, fb.dataset.focus, ctx.byId); });
      if (res && !res.ok) toast(res.reason);
      return;
    }
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
          ctx.navigate(`#/team/${idx}/injuries`);
        } catch (err) { toast(err.message); }
      });
      return;
    }
    const down = e.target.closest('[data-down]');
    if (down && canEdit) {
      const p = ctx.byId.get(down.dataset.down);
      const m = modal(html`<h2>Send ${p.name} down?</h2>
        <p class="muted">His slot opens so you can fill it. He stays yours, keeps developing, and costs only the minimum while he is on the practice squad — but he cannot play until you bring him up, and bringing him up will cost a roster spot.</p>
        <div class="row"><button class="btn primary" id="yes">To the practice squad</button><button class="btn" data-close>Cancel</button></div>`);
      m.el.querySelector('#yes').addEventListener('click', () => {
        m.close();
        try {
          ctx.update((s) => { stash(s.league, idx, p.id, ctx.byId); });
          toast(`${p.name} to the practice squad`);
          ctx.navigate(`#/team/${idx}/injuries`);
        } catch (err) { toast(err.message); }
      });
      return;
    }
    const up = e.target.closest('[data-up]');
    if (up && canEdit) { openPromote(ctx.byId.get(up.dataset.up)); return; }
    const conv = e.target.closest('[data-convert]');
    if (conv && canEdit) { openConvert(conv.dataset.convert); return; }
    const cut = e.target.closest('[data-cut]');
    if (cut && canEdit) {
      const p = ctx.byId.get(cut.dataset.cut);
      const m = modal(html`<h2>Release ${p.name}?</h2>
        <p class="muted">He leaves the club for good and goes back on the market, where anybody can sign him.</p>
        <div class="row"><button class="btn danger" id="yes">Release</button><button class="btn" data-close>Cancel</button></div>`);
      m.el.querySelector('#yes').addEventListener('click', () => {
        m.close();
        ctx.update((s) => { releaseFromSquad(s.league, idx, p.id); });
        toast(`${p.name} released`);
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
    if (e.target.closest('#autoDepth') && canEdit) {
      // Best men into the starting slots, ranked the way the rest of the game
      // shows them — a scouted player by his number, an unscouted rookie by the
      // estimate, never by a truth the screen is withholding.
      let moved = 0;
      ctx.update((s) => { moved = autoDepth(s.league, idx, ctx.byId); });
      toast(moved ? `Depth chart reordered — ${moved} slot${moved === 1 ? '' : 's'} changed` : 'Already in order');
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
      <div class="row between"><h2 style="margin:0">Activate ${p.name}</h2><button class="btn sm ghost" data-close aria-label="Close">✕</button></div>
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

  /**
   * Who could fill this open slot by changing position, and what each would
   * be there. The three numbers are the decision: what he is now, what he is
   * in his first season at the new position, and what he settles at — with the
   * premium, since a move up the market's scale is paid for.
   */
  function openConvert(slotId) {
    const slot = ROSTER_SLOTS.find((s) => s.id === slotId);
    const list = candidatesFor(league, idx, slotId, ctx.byId);
    const name = (POSITIONS[slot.pos]?.name || slot.pos).toLowerCase();
    const m = modal(html`
      <div class="row between"><h2 style="margin:0">Move to ${name}</h2><button class="btn sm ghost" data-close aria-label="Close">✕</button></div>
      <p class="muted">He is rated on what his skills are worth at ${name}. Learning a new position costs ${SETTLING[0]} on every skill in his first season there and ${SETTLING[1]} in his second. A move to a position the market pays more for raises his salary by the difference for the rest of his deal. The slot he leaves opens.</p>
      ${list.length ? html`<ul class="plist">${raw(list.map((c) => playerItem(c.p, {
        attrs: false,
        meta: ` · <span class="badge slot">${esc(c.from)}</span> ${c.home ? `back home at ${esc(slot.pos)}: <b>${c.settled}</b>` : `${esc(slot.pos)} <b>${c.first}</b> first season, <b>${c.settled}</b> settled`}${c.premium ? ` · <span class="badge warn">+$${c.premium} a year</span>` : ''}`,
        action: `<button class="btn sm primary" data-to="${esc(c.id)}">Move</button>`,
      })).join(''))}</ul>` : html`<p class="empty">Nobody on your club can play there.</p>`}`);
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-to]');
      if (!b) return;
      let res;
      ctx.update((s) => { res = convertPlayer(s.league, idx, b.dataset.to, slotId, ctx.byId); });
      m.close();
      if (!res?.ok) { toast(res?.reason || 'That move is not possible'); return; }
      const who = ctx.byId.get(b.dataset.to)?.name || 'He';
      toast(`${who} moves to ${slot.pos}${res.premium ? ` — +$${res.premium} a year` : ''}${res.opened ? `; ${res.opened} is open` : ''}`);
    });
  }

  function openPromote(p) {
    const open = ROSTER_SLOTS.find((s) => s.pos === p.pos && !team.slots[s.id]);
    const options = ROSTER_SLOTS.filter((s) => s.pos === p.pos && team.slots[s.id]).map((s) => ({ s, q: ctx.byId.get(team.slots[s.id]) })).filter((x) => x.q);
    const m = modal(html`
      <div class="row between"><h2 style="margin:0">Bring up ${p.name}</h2><button class="btn sm ghost" data-close aria-label="Close">✕</button></div>
      <p class="muted">${open ? `The ${open.id} slot is open, so nobody has to go.` : 'Your roster is full at his position. Who makes way?'}</p>
      ${open ? html`<button class="btn primary block" data-take="" style="margin-bottom:.5rem">Into the open ${open.id} slot</button>` : ''}
      <ul class="plist">${raw(options.map(({ s, q }) => playerItem(q, { attrs: false, meta: ` · <span class="badge slot">${s.id}</span>`, action: `<button class="btn sm danger" data-take="${esc(q.id)}">Release</button>` })).join(''))}</ul>`);
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-take]');
      if (!b) return;
      try {
        ctx.update((s) => { promote(s.league, idx, p.id, b.dataset.take || null, ctx.byId); });
        toast(`${p.name} brought up`);
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
