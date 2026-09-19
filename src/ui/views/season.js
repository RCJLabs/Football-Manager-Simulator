import { html, render, raw } from '../../util.js';
import { currentWeek, userTeamIndex, userGameThisWeek, simulateWeekAi, weekComplete, advanceWeek, standings, proStandings, powerRankings, teamForGame, gameOptions, weekNumber, recordResult, newSeasonSameRosters, isPro } from '../../engine/season.js';
import { ROSTER_SLOTS } from '../../data/positions.js';
import { fmtWeeks, IR_MIN_WEEKS, irList } from '../../engine/injuries.js';
import { clinchMarkers, markerLetter, MARKER_LEGEND } from '../../engine/clinch.js';
import { makeGameplan } from '../../engine/gm.js';
import { simulateAhead, targetAvailable, describeRun, TARGET_LABELS, TARGETS } from '../../engine/autosim.js';
import { jobsOn, seatWarmth, goalFor, yourCoach, coachOf } from '../../engine/jobs.js';
import { weekPulse, quietWeek } from '../../engine/pulse.js';
import { composites, buildLineup } from '../../engine/ratings.js';
import { fillLineup } from '../../engine/injuries.js';
import { createGame, simulateGame } from '../../engine/game.js';
import { fantasyPoints } from '../../engine/stats.js';
import { GM_PERSONALITIES } from '../../data/teams.js';
import { DIVISIONS } from '../../data/pro.js';
import { teamChip, toast, modal } from '../components.js';
import { advanceWeekWithMoves, freeAgents, claimsThisWeek, tradeDeadlineWeek, tradesOpen, liveOffers } from '../../engine/transactions.js';
import { RNG } from '../../engine/rng.js';

export function fmtPhase(league) {
  if (league.phase === 'draft') return league.draftType === 'auction' ? 'Auction in progress' : 'Draft in progress';
  if (league.phase === 'season') return `Season ${league.season} · Week ${league.week} of ${league.schedule.length}`;
  if (league.phase === 'playoffs') return `Season ${league.season} · ${league.playoffs.rounds[league.playoffs.round - 1].name}`;
  return `Season ${league.season} complete`;
}

const rec = (t) => `${t.record.w}-${t.record.l}${t.record.t ? `-${t.record.t}` : ''}`;
const recOf = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;

export function view(root, params, ctx) {
  const state = ctx.getState();
  const league = state.league;
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.phase === 'draft') { ctx.navigate(league.draftType === 'auction' ? '#/auction' : '#/draft'); return; }
  if (league.phase === 'offseason') { ctx.navigate('#/offseason'); return; }
  const pro = isPro(league);
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const wk = currentWeek(league);
  const myGame = userGameThisWeek(league);
  const myGameIdx = wk ? wk.games.indexOf(myGame) : -1;
  const liveGame = state.game && state.game.phase === league.phase && state.game.weekNo === weekNumber(league) ? state.game : null;
  if (state.game && !liveGame) ctx.update((s) => { s.game = null; }, { silent: true });
  const complete = weekComplete(league);
  const power = powerRankings(league, ctx.byId);
  const playoffs = league.phase === 'playoffs';
  const roundName = playoffs ? wk.name : null;
  const kindOf = () => (playoffs ? 'p' : 'w');
  const weekNoOf = () => (playoffs ? league.playoffs.round : league.week);

  const injuries = league.injuries || {};
  const hurtList = (ti) => ROSTER_SLOTS.map((s) => league.teams[ti].slots[s.id]).filter((id) => id && injuries[id]).map((id) => ({ p: ctx.byId.get(id), inj: injuries[id] }));

  // ----- matchup card -----
  let matchupCard = '';
  if (league.phase === 'complete') {
    const champ = league.teams[league.champion];
    matchupCard = html`<div class="champ">
      <div style="font-size:3rem">🏆</div>
      <h1>${champ.name} are the champions</h1>
      <p class="muted">Season ${league.season} · ${rec(champ)} in the regular season${champ.isUser ? ' · That\'s you!' : ''}</p>
      ${(() => { const aw = (league.history || []).find((h) => h.season === league.season)?.awards; return aw && aw.mvp ? html`<p class="muted" style="margin-top:-.4rem">MVP: <b>${ctx.byId.get(aw.mvp.id)?.name}</b> (${league.teams[aw.mvp.team].abbr}) · <a href="#/awards/honours">all honours</a></p>` : ''; })()}
      <div class="btn-group" style="justify-content:center;margin-top:.75rem">
        <a class="btn primary lg" href="#/offseason">Start the offseason: keepers, then the ${league.draftType === 'auction' ? 'auction' : 'draft'}</a>
        <button class="btn" id="again">Run it back with these rosters</button>
        <a class="btn" href="#/awards/card">Season card</a>
        <a class="btn ghost" href="#/new">Start a new league</a>
      </div>
    </div>`;
  } else if (myGame) {
    const oppIdx = myGame.home === u ? myGame.away : myGame.home;
    const opp = league.teams[oppIdx];
    const oppPower = power.find((p) => p.idx === oppIdx).power;
    const myPower = power.find((p) => p.idx === u).power;
    const gm = GM_PERSONALITIES.find((g) => g.id === opp.gm);
    const where = myGame.neutral ? 'Neutral site' : myGame.home === u ? 'Home' : 'Away';
    matchupCard = html`<div class="card">
      <h3>${roundName || `Week ${league.week}`} · ${where} vs ${opp.abbr}${pro && !myGame.neutral ? html` <small class="muted" style="text-transform:none;letter-spacing:0">(${DIVISIONS[opp.div]}${opp.conf === me.conf && opp.div === me.div ? ', division game' : ''})</small>` : ''}</h3>
      <div class="matchup mine" style="margin:.5rem 0">
        <div class="side">${teamChip(league.teams[myGame.home], { responsive: true })}<small class="muted">${rec(league.teams[myGame.home])}</small></div>
        <div class="vs">${myGame.result ? html`${myGame.result.score[0]}–${myGame.result.score[1]}${myGame.result.overtime ? ' (OT)' : ''}` : 'vs'}</div>
        <div class="side right"><small class="muted">${rec(league.teams[myGame.away])}</small>${teamChip(league.teams[myGame.away], { responsive: true })}</div>
      </div>
      <p class="muted" style="font-size:.9rem">Power: you ${myPower} · them ${oppPower}${gm ? ` · ${gm.name} GM (${gm.blurb.toLowerCase().replace(/\.$/, '')})` : ''}</p>
      ${(() => { if (myGame.result || opp.isUser) return ''; const oc = composites(fillLineup(buildLineup(opp.slots, ctx.byId, injuries))), mc = composites(fillLineup(buildLineup(me.slots, ctx.byId, injuries))); const notes = makeGameplan(oc, mc).notes; return notes.length ? html`<p class="muted" style="font-size:.85rem;margin-top:-.4rem">Their game plan: ${notes.join('; ')}.</p>` : ''; })()}
      ${hurtList(u).length || hurtList(oppIdx).length ? html`<p class="muted" style="font-size:.85rem;margin-top:-.4rem">${hurtList(u).length ? html`You are missing <b>${hurtList(u).map((x) => `${x.p.name} (${x.p.pos})`).join(', ')}</b>. ` : ''}${hurtList(oppIdx).length ? html`They are missing <b>${hurtList(oppIdx).map((x) => `${x.p.name} (${x.p.pos})`).join(', ')}</b>.` : ''}</p>` : ''}
      <div class="btn-group">
        ${myGame.result
          ? html`<a class="btn" href="#/box/${kindOf()}/${weekNoOf()}/${myGameIdx}">Box score</a>`
          : liveGame
            ? html`<a class="btn primary lg" href="#/game">Resume game</a><button class="btn danger" id="abandon">Abandon game</button>`
            : html`<button class="btn primary lg" id="play">Play ${league.settings.coachMode ? '(coach mode)' : '(watch)'}</button><button class="btn" id="simMine">Sim my game</button>`}
        ${!complete ? html`<button class="btn" id="simWeek">Sim ${playoffs ? 'round' : 'week'}</button>` : ''}
        ${complete ? html`<button class="btn primary lg" id="advance">${playoffs ? 'Next round' : league.week >= league.schedule.length ? 'Start playoffs' : `Advance to week ${league.week + 1}`}</button>` : ''}
      </div>
    </div>`;
  } else if (wk) {
    const bye = playoffs ? wk.byes && wk.byes.some((b) => b.team === u) : (wk.byes || []).includes(u);
    matchupCard = html`<div class="card">
      <h3>${roundName || `Week ${league.week}`}${bye && !playoffs ? ' · Bye week' : ''}</h3>
      <p class="muted">${bye ? (playoffs ? 'You have a bye this round. Rest up.' : 'Your bye week. Injuries heal a week, the wire stays open, and the rest of the league plays on.') : playoffs ? 'You have been eliminated from the playoffs. Sim the remaining rounds to crown a champion.' : 'You are idle this week.'}</p>
      <div class="btn-group">
        ${!complete ? html`<button class="btn primary" id="simWeek">Sim ${playoffs ? 'round' : 'week'}</button>` : ''}
        ${complete ? html`<button class="btn primary lg" id="advance">${playoffs ? 'Next round' : 'Advance'}</button>` : ''}
      </div>
    </div>`;
  }

  // ----- games list -----
  const gamesList = (games, kind, weekNo, poolLabel) => games.map((g, i) => {
    const h = league.teams[g.home], a = league.teams[g.away];
    const mine = g.home === u || g.away === u;
    const r = g.result;
    const hw = r && r.score[0] > r.score[1], aw = r && r.score[1] > r.score[0];
    const inner = `<div class="side ${hw ? 'w' : ''}">${teamChip(h, { responsive: true }).__raw}<small class="muted">${rec(h)}</small></div><div class="vs">${r ? `${r.score[0]}–${r.score[1]}${r.overtime ? '<small> OT</small>' : ''}` : g.neutral ? 'final' : 'vs'}</div><div class="side right ${aw ? 'w' : ''}"><small class="muted">${rec(a)}</small>${teamChip(a, { responsive: true }).__raw}</div>`;
    return r ? `<a class="matchup ${mine ? 'mine' : ''}" href="#/box/${kind}/${weekNo}/${i}">${inner}</a>` : `<div class="matchup ${mine ? 'mine' : ''}">${inner}</div>`;
  }).join('');

  // ----- standings -----
  let standingsCard;
  const marks = clinchMarkers(league);
  const mark = (idx) => { const m = markerLetter(marks[idx]); return m ? `<span class="clinch ${m}" title="${MARKER_LEGEND[m]}">${m}</span>` : ''; };
  const usedMarks = [...new Set(Object.values(marks).map(markerLetter).filter(Boolean))].sort();
  const legend = usedMarks.length ? `<small class="muted" style="display:block;margin-top:.4rem">${usedMarks.map((m) => `<b>${m}</b> ${MARKER_LEGEND[m]}`).join(' · ')}</small>` : '';
  if (pro) {
    const table = proStandings(league);
    standingsCard = table.map((conf, ci) => {
      const divs = conf.divisions.map((d) => `
        <div class="division">
          <div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;margin:.5rem 0 .2rem">${conf.name} ${d.name}</div>
          <div class="table-wrap"><table class="standings">
            <thead><tr><th>Team</th><th class="num">W-L</th><th class="num hide-sm">Div</th><th class="num hide-sm">Conf</th><th class="num">Diff</th></tr></thead>
            <tbody>${d.rows.map((r, i) => `<tr class="clickable ${r.team.isUser ? 'me' : ''}" data-team="${r.idx}"><td>${mark(r.idx)}${teamChip(r.team, { responsive: true }).__raw}${i === 0 && r.gp && !marks[r.idx]?.division ? ' <span class="badge" title="leads the division">1st</span>' : ''}</td><td class="num">${recOf(r)}</td><td class="num hide-sm">${recOf(r.divRec)}</td><td class="num hide-sm">${recOf(r.confRec)}</td><td class="num">${r.diff > 0 ? '+' : ''}${r.diff}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>`).join('');
      const seeds = conf.seeds.map((idx, i) => `<span class="need ${idx === u ? 'open' : ''}">${i + 1}. ${league.teams[idx].abbr}${i < 4 ? '' : ' <small>wc</small>'}</span>`).join('');
      const hunt = conf.inHunt.map((idx) => league.teams[idx].abbr).join(', ');
      return `<div class="card tight"><h3>${conf.name} Conference</h3>${divs}
        <div style="margin-top:.6rem"><div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em">Playoff picture</div><div class="needs" style="margin-top:.3rem">${seeds}</div>${hunt ? `<small class="muted">In the hunt: ${hunt}</small>` : ''}${ci === 1 ? legend : ''}</div>
      </div>`;
    }).join('');
    standingsCard = raw(standingsCard);
  } else {
    const rows = standings(league);
    standingsCard = html`<div class="card tight">
      <h3>Standings</h3>
      <div class="table-wrap"><table class="standings">
        <thead><tr><th>#</th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num hide-sm">T</th><th class="num hide-sm">PCT</th><th class="num hide-sm">PF</th><th class="num hide-sm">PA</th><th class="num">Diff</th></tr></thead>
        <tbody>${raw(rows.map((r, i) => `<tr class="clickable ${r.team.isUser ? 'me' : ''}" data-team="${r.idx}"><td>${i + 1}</td><td>${mark(r.idx)}${teamChip(r.team).__raw}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num hide-sm">${r.t}</td><td class="num hide-sm">${r.gp ? r.pct.toFixed(3).replace(/^0/, '') : '—'}</td><td class="num hide-sm">${r.pf}</td><td class="num hide-sm">${r.pa}</td><td class="num">${r.diff > 0 ? '+' : ''}${r.diff}</td></tr>`).join(''))}</tbody>
      </table></div>
      ${raw(legend)}
    </div>`;
  }

  // ----- bracket -----
  let bracketCard = '';
  if (league.playoffs) {
    const po = league.playoffs;
    const rounds = po.rounds.map((r, ri) => {
      const byPool = {};
      r.games.forEach((g, gi) => { (byPool[g.pool] ??= []).push({ g, gi }); });
      const byes = (r.byes || []).map((b) => `<div class="matchup"><div class="side">${teamChip(league.teams[b.team], { responsive: true }).__raw}</div><div class="vs muted">bye</div><div class="side right"></div></div>`).join('');
      const groups = Object.entries(byPool).map(([pi, items]) => {
        const label = po.pools.length > 1 && Number(pi) >= 0 ? `<small class="muted">${po.pools[pi].name}</small>` : '';
        const list = items.map(({ g, gi }) => gamesList([g], 'p', ri + 1).replace(/href="#\/box\/p\/(\d+)\/0"/, `href="#/box/p/$1/${gi}"`)).join('');
        return `${label}<div class="stack">${list}</div>`;
      }).join('');
      return `<div><div class="muted" style="font-size:.8rem;margin-bottom:.3rem"><b>${r.name}</b>${ri + 1 === po.round && league.phase === 'playoffs' ? ' · now' : ''}</div><div class="stack">${groups}${byes}</div></div>`;
    }).join('');
    const seedLine = po.pools.map((p) => `${po.pools.length > 1 ? `<b>${p.name}</b>: ` : ''}${p.seeds.map((s, i) => `${i + 1}. ${league.teams[s].abbr}`).join(' · ')}`).join('<br>');
    bracketCard = raw(`<div class="card tight"><h3>Playoffs</h3><div class="bracket">${rounds}</div><small class="muted" style="display:block;margin-top:.5rem">${seedLine}</small></div>`);
  }

  const leaders = seasonLeaders(league, ctx.byId);
  const faCount = league.phase === 'season' ? freeAgents(league, ctx.players).length : 0;
  const myClaims = league.phase === 'season' ? claimsThisWeek(league, u).length : 0;
  const offerCount = league.phase === 'season' ? liveOffers(league).filter((o) => !o.answered).length : 0;
  const movesCard = league.phase === 'season' ? html`<div class="card tight">
    <h3>Roster moves</h3>
    ${offerCount ? html`<p class="notice" style="margin:0 0 .5rem">${offerCount === 1 ? 'A club is on the phone with an offer' : `${offerCount} clubs are on the phone with offers`}. <a href="#/moves/offers">Hear them out</a>.</p>` : ''}
    <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">${faCount} free agents · ${myClaims ? `${myClaims} claim${myClaims > 1 ? 's' : ''} pending, resolve when the week advances` : 'no claims pending'} · ${tradesOpen(league) ? `trades open through week ${tradeDeadlineWeek(league)}` : 'trade deadline passed'}</p>
    <div class="btn-group"><a class="btn sm" href="#/moves">Free agents</a><a class="btn sm ${offerCount ? 'primary' : ''}" href="#/moves/offers">Offers${offerCount ? ` (${offerCount})` : ''}</a><a class="btn sm" href="#/moves/trade">Trades</a></div>
  </div>` : '';
  const powerShown = pro ? power.slice(0, 12) : power;
  // The owner, and how close you are to the door. A hidden number nobody can
  // see is not pressure, it is a trap, so both the bar and the heat are shown.
  const seat = jobsOn(league) ? seatWarmth(league, u) : null;
  const jobCard = seat ? (() => {
    const goal = goalFor(league, u, ctx.byId);
    const you = yourCoach(league);
    const review = league.jobs.lastReview;
    const moved = review ? review.results.filter((r) => r.fired) : [];
    return html`<div class="card tight">
      <h3>The owner <small class="muted" style="text-transform:none;letter-spacing:0">· season ${you.seasons + 1} in the job</small></h3>
      <p style="margin:.2rem 0;font-size:.92rem">Wants you to <b>${goal.text}</b>. <span class="muted">Squad ranked ${goal.rank} of ${league.teams.length}.</span></p>
      <p class="muted" style="font-size:.88rem;margin:.2rem 0 .3rem"><span class="seat ${seat.band}">${seat.band === 'hot' ? 'Hot seat' : seat.band === 'warm' ? 'Under pressure' : 'Secure'}</span> ${seat.text}</p>
      ${moved.length ? html`<small class="muted">Last offseason ${moved.length === 1 ? 'one club' : `${moved.length} clubs`} changed coach.</small>` : ''}
      <div class="row" style="margin-top:.4rem"><a class="btn sm" href="#/career">Your career</a></div>
    </div>`;
  })() : '';
  // What happened last week, everywhere, not just in your game. Thirty-one
  // other clubs played and none of it used to be narrated.
  const pulseWeek = league.phase === 'season' ? league.week - 1 : (league.schedule || []).length;
  const pulse = pulseWeek >= 1 ? weekPulse(league, ctx.byId, pulseWeek, { limit: 5 }) : [];
  const quiet = pulseWeek >= 1 && !pulse.length ? quietWeek(league, pulseWeek) : null;
  const pulseCard = pulse.length || quiet ? html`<div class="card tight">
    <h3>Around the league <small class="muted" style="text-transform:none;letter-spacing:0">· week ${pulseWeek}</small></h3>
    ${pulse.length ? html`<ul class="pulse">${pulse.map((p) => html`<li class="p-${p.kind}">${p.text}</li>`)}</ul>`
    : html`<p class="muted" style="font-size:.9rem;margin:.2rem 0">${quiet}</p>`}
  </div>` : '';
  const simTargets = TARGETS.filter((t) => targetAvailable(league, t));
  const simCard = simTargets.length ? html`<div class="card tight">
    <h3>Simulate ahead</h3>
    <div class="btn-group">${raw(simTargets.map((t) => `<button class="btn sm" data-sim="${t}">${TARGET_LABELS[t]}</button>`).join(''))}</div>
    <small class="muted" style="display:block;margin-top:.4rem">Weeks run with everything on: the wire, trades, injuries and the AI's own moves.${simTargets.includes('nextSeason') ? ' Going into next season also picks your keepers on value and runs the market for you.' : ''}</small>
  </div>` : '';
  const myHurt = hurtList(u);
  const leagueHurt = Object.keys(injuries).length;
  const injuryCard = league.phase === 'season' || league.phase === 'playoffs' ? html`<div class="card tight">
    <h3>Injuries</h3>
    ${myHurt.length ? raw(`<ul class="plain ticker" style="max-height:none">${myHurt.map(({ p, inj }) => `<li><b>${p.name}</b> <small class="muted">${p.pos}</small> — ${inj.kind}, <b>${fmtWeeks(inj.weeks)}</b></li>`).join('')}</ul>`) : html`<p class="muted" style="margin:0;font-size:.85rem">Your club is healthy.</p>`}
    ${myHurt.some((x) => x.inj.weeks >= IR_MIN_WEEKS) && league.phase === 'season' ? html`<p class="muted" style="margin:.3rem 0 0;font-size:.85rem">Someone is out long enough for <a href="#/team/${u}">injured reserve</a>, which frees his slot to sign cover.</p>` : ''}
    ${irList(me).length ? html`<p class="muted" style="margin:.3rem 0 0;font-size:.85rem">${irList(me).length} on injured reserve.</p>` : ''}
    <small class="muted" style="display:block;margin-top:.4rem">${leagueHurt} player${leagueHurt === 1 ? '' : 's'} out league-wide · injuries set to ${league.settings.injuries || 'normal'}${myHurt.length ? html` · <a href="#/team/${u}">depth chart</a>` : ''}</small>
  </div>` : '';

  render(root, html`<div id="season-view">
    <div class="row between" style="margin-bottom:.75rem">
      <div><h1 style="margin:0">${league.name}</h1><span class="muted">${fmtPhase(league)}${pro ? ` · ${league.teams.length} teams` : ''}</span></div>
      <div class="row">${teamChip(me)} <b>${rec(me)}</b></div>
    </div>
    ${matchupCard}
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="stack">
        ${bracketCard}
        ${wk && league.phase === 'season' ? html`<div class="card tight"><h3>Week ${league.week} games${pro ? html` <small class="muted" style="text-transform:none;letter-spacing:0">· ${wk.games.length} games</small>` : ''}</h3><div class="stack">${raw(gamesList(wk.games, 'w', league.week))}</div>${(wk.byes || []).length ? html`<small class="muted" style="display:block;margin-top:.5rem">Bye: ${wk.byes.map((i) => league.teams[i].abbr).join(', ')}</small>` : ''}</div>` : ''}
        ${standingsCard}
        <details class="card tight"><summary><b>Full schedule &amp; results</b></summary>
          <div class="stack" style="margin-top:.5rem">${raw(league.schedule.map((w) => `<div><div class="muted" style="font-size:.8rem;margin:.4rem 0 .2rem">Week ${w.week}${w.week === league.week && league.phase === 'season' ? ' (current)' : ''}${(w.byes || []).length ? ` · bye: ${w.byes.map((i) => league.teams[i].abbr).join(', ')}` : ''}</div><div class="stack">${gamesList(w.games, 'w', w.week)}</div></div>`).join(''))}</div>
        </details>
      </div>
      <div class="stack">
        ${pulseCard}
        ${jobCard}
        ${simCard}
        ${injuryCard}
        ${movesCard}
        <div class="card tight">
          <h3>Season leaders</h3>
          ${leaders.length ? raw(leaders.map((l) => `<div style="margin-bottom:.6rem"><div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em">${l.title}</div>${l.rows.map((r) => `<div class="row between" style="font-size:.88rem;flex-wrap:nowrap;gap:.5rem"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="teamdot" style="background:${r.team.color}"></span>${r.p.name} <small class="muted">${r.p.pos} · ${r.team.abbr}</small></span><b class="mono">${r.val}</b></div>`).join('')}</div>`).join('')) : html`<p class="muted">No games played yet.</p>`}
        </div>
        <div class="card tight">
          <h3>Power rankings${pro ? html` <small class="muted" style="text-transform:none;letter-spacing:0">· top 12 of 32</small>` : ''}</h3>
          <div class="table-wrap"><table><tbody>${raw(powerShown.map((p, i) => { const gm = GM_PERSONALITIES.find((g) => g.id === p.team.gm); return `<tr class="clickable ${p.team.isUser ? 'me' : ''}" data-team="${p.idx}"><td>${i + 1}</td><td>${teamChip(p.team, { responsive: true }).__raw}</td><td class="hide-sm">${gm ? `<span class="badge gm">${gm.name}</span>` : '<span class="badge">You</span>'}</td><td class="num"><b>${p.power}</b></td></tr>`; }).join(''))}</tbody></table></div>
          ${pro && !powerShown.some((p) => p.team.isUser) ? html`<small class="muted">You are ranked ${power.findIndex((p) => p.team.isUser) + 1} of 32 (${power.find((p) => p.team.isUser).power}).</small>` : ''}
        </div>
        ${league.history && league.history.length ? html`<div class="card tight"><h3>History</h3>${raw(league.history.map((h) => `<div class="row between" style="font-size:.9rem"><span>Season ${h.season}</span><span>${teamChip(league.teams[h.champion], { abbr: true }).__raw} 🏆${h.user ? ` <small class="muted">· you ${h.user.record.w}-${h.user.record.l}, ${h.user.rank}${['th', 'st', 'nd', 'rd'][(h.user.rank % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][h.user.rank % 100] || 'th'}</small>` : ''}</span></div>`).join(''))}</div>` : ''}
      </div>
    </div>
  </div>`);

  const el = root.querySelector('#season-view');
  el.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-team]');
    if (tr) ctx.navigate(`#/team/${tr.dataset.team}`);
  });
  el.querySelector('#play')?.addEventListener('click', () => {
    const g = createGame(teamForGame(league, myGame.home, ctx.byId), teamForGame(league, myGame.away, ctx.byId), gameOptions(league, myGame, ctx.byId));
    ctx.update((s) => { s.game = { weekNo: weekNumber(league), phase: league.phase, entryIdx: myGameIdx, g }; }, { silent: true });
    ctx.navigate('#/game');
  });
  el.querySelector('#simMine')?.addEventListener('click', () => {
    ctx.update((s) => {
      const lg = s.league;
      const w = currentWeek(lg);
      const entry = w.games[myGameIdx];
      const g = createGame(teamForGame(lg, entry.home, ctx.byId), teamForGame(lg, entry.away, ctx.byId), gameOptions(lg, entry, ctx.byId));
      simulateGame(g);
      recordResult(lg, weekNumber(lg), entry, g, { keepLog: true });
      simulateWeekAi(lg, ctx.byId);
    });
  });
  el.querySelector('#simWeek')?.addEventListener('click', () => {
    ctx.update((s) => { simulateWeekAi(s.league, ctx.byId, { includeUser: true }); s.game = null; });
  });
  el.querySelector('#advance')?.addEventListener('click', () => {
    ctx.update((s) => {
      const rng = new RNG(s.league.rngState);
      advanceWeekWithMoves(s.league, ctx.byId, ctx.players, rng, advanceWeek);
      s.league.rngState = rng.state;
    });
    const after = ctx.getState().league;
    const lw = after.lastWaivers;
    const mineRes = lw ? lw.results.filter((r) => r.team === u) : [];
    if (mineRes.length) toast(mineRes.every((r) => r.ok) ? `Waivers: ${mineRes.length} claim${mineRes.length > 1 ? 's' : ''} landed` : `Waivers: ${mineRes.filter((r) => r.ok).length} of ${mineRes.length} claims landed`);
    else {
      const calls = liveOffers(after).filter((o) => !o.answered).length;
      if (calls) toast(calls === 1 ? 'A club has a trade offer for you' : `${calls} clubs have trade offers for you`);
    }
  });
  el.querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => {
    const target = b.dataset.sim;
    const run = () => {
      let result;
      ctx.update((s) => {
        const rng = new RNG(s.league.rngState);
        result = simulateAhead(s.league, ctx.byId, ctx.players, rng, target);
        s.league.rngState = rng.state;
        s.game = null;
      });
      toast(describeRun(result));
    };
    const warnings = [];
    if (target === 'nextSeason') warnings.push('Your keepers will be picked on value and the market run for you.');
    if (state.game && !state.game.g.final) warnings.push('The game you have in progress will be given up and simulated instead.');
    if (!warnings.length) { run(); return; }
    const m = modal(html`<h2>${TARGET_LABELS[target]}?</h2>${raw(warnings.map((w) => `<p class="muted">${w}</p>`).join(''))}
      <div class="row"><button class="btn primary" id="yes">Simulate</button><button class="btn" data-close>Cancel</button></div>`);
    m.el.querySelector('#yes').addEventListener('click', () => { m.close(); run(); });
  }));
  el.querySelector('#abandon')?.addEventListener('click', () => {
    const m = modal(html`<h2>Abandon the game in progress?</h2><p class="muted">You'll be able to start it over from the season hub.</p><div class="row"><button class="btn danger" id="yes">Abandon</button><button class="btn" data-close>Cancel</button></div>`);
    m.el.querySelector('#yes').addEventListener('click', () => { m.close(); ctx.update((s) => { s.game = null; }); });
  });
  el.querySelector('#again')?.addEventListener('click', () => {
    ctx.update((s) => { newSeasonSameRosters(s.league, ctx.byId); s.game = null; });
    toast(`Season ${league.season + 1} begins`);
  });
}

function seasonLeaders(league, byId) {
  const all = [];
  for (const team of league.teams) {
    for (const [pid, s] of Object.entries(team.seasonStats.players)) {
      const p = byId.get(pid);
      if (p) all.push({ p, team, s });
    }
  }
  if (!all.length) return [];
  const top = (title, get, fmt = (v) => v) => {
    const rows = all.map((r) => ({ ...r, v: get(r.s) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 3).map((r) => ({ p: r.p, team: r.team, val: fmt(r.v) }));
    return rows.length ? { title, rows } : null;
  };
  return [
    top('Passing yards', (s) => s.pass.yds),
    top('Rushing yards', (s) => s.rush.yds),
    top('Receiving yards', (s) => s.rec.yds),
    top('Touchdowns', (s) => s.rush.td + s.rec.td + s.def.td + s.ret.td),
    top('Sacks', (s) => s.def.sck),
    top('Interceptions', (s) => s.def.int),
    top('Fantasy points', (s) => fantasyPoints(s), (v) => v.toFixed(1)),
  ].filter(Boolean);
}
