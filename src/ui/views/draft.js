// The snake draft room.
//
// This screen used to apply the other clubs' picks in one silent burst: seven
// or thirty-one selections landed inside a single state update and the only
// trace was a twelve-line ticker. So it is self-rendering now, the way the live
// game view is, and owns a timer that lets one pick land at a time onto a board
// you can watch. Same engine, same seeds, same results — `stepAiPick` is
// `runAiPicks` with the loop moved out here where it can be paced.
//
// Two things keep that from being a tax on the player's time. A 32-club draft
// is 864 picks, so the speed control goes up to instant and is remembered; and
// "skip to my pick" is always one tap away.

import { html, render, raw } from '../../util.js';
import { valuePanel, valueHint } from '../value-panel.js';
import { POSITION_ORDER, ROSTER_SLOTS } from '../../data/positions.js';
import { ERAS } from '../../data/db.js';
import { overall } from '../../engine/ratings.js';
import { currentPicker, overallPickNumber, availablePlayers, openSlotsByPos, makePick, runAiPicks, stepAiPick, aiChoose, autoDraftAll, TOTAL_ROUNDS, RNG } from '../../engine/draft.js';
import { startSeason } from '../../engine/season.js';
import { GM_PERSONALITIES } from '../../data/teams.js';
import { ovrBadge, playerItem, playerModal, teamChip, toast, esc, withBusy } from '../components.js';
import { shownOverall } from '../../engine/scouting.js';
import { draftBoard, boardOverlay, snakeRows, scrollToPick, lastName } from '../draft-board.js';
import { openPickTrade, pickOfferCard } from '../pick-trade.js';
import { survivalOdds, remainingPicks, nextPickFor, pickOfferCandidates, tryPickOffer, OFFER_BUDGET, executePickTrade } from '../../engine/draftpicks.js';

export const selfRendering = true;

const ui = { pos: 'ALL', era: 'ALL', q: '', boardOpen: false };

/**
 * Both of these cost real time — a survival read drafts the board forward
 * eight times, an offer drafts it twice — so each is worked out once per turn
 * and kept against the pick count, which is what changes when a turn does.
 */
const turnCache = { key: null, odds: null, untilPick: null, offers: null, declined: new Set() };

/** Beyond here the order barely matters and the clubs stop ringing about it. */
const OFFER_ROUNDS = 6;
const PAGE = 120;

/** Watchable, brisk, and a way out. Remembered across drafts in preferences. */
export const SPEEDS = [['slow', 900], ['normal', 420], ['fast', 180], ['instant', 0]];
export const DEFAULT_SPEED = 'normal';

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.draftType === 'auction') { ctx.navigate('#/auction'); return; }
  if (league.phase !== 'draft') { ctx.navigate('#/season'); return; }

  const draft = league.draft;
  const u = league.teams.findIndex((t) => t.isUser);
  const me = league.teams[u];
  const scoutRank = (p) => shownOverall(league, p, u);

  let timer = null;
  let fresh = null;          // `${row}:${team}` of the pick that just landed
  // Seeded from the draft, not left null: coming back to a room already twenty
  // picks deep used to announce "waiting on the first pick".
  let lastPick = draft.picks.length ? draft.picks[draft.picks.length - 1] : null;
  let stopped = false;       // set by the cleanup so a late tick cannot draw

  const speedName = () => ctx.getState().prefs?.draftSpeed || DEFAULT_SPEED;
  const speedMs = () => (SPEEDS.find(([n]) => n === speedName()) || SPEEDS[1])[1];
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stop = () => { clearTimeout(timer); timer = null; };

  /** One AI pick, then schedule the next. Stops on the user's turn. */
  function tick() {
    if (stopped) return;
    let landed = null;
    ctx.update((s) => {
      const rng = new RNG(s.league.rngState);
      landed = stepAiPick(s.league, s.league.draft, ctx.players, rng);
      s.league.rngState = rng.state;
    }, { silent: true });
    if (!landed) { stop(); draw(); return; }
    lastPick = landed;
    fresh = `${(landed.round || 1) - 1}:${landed.team}`;
    draw();
    run();
  }

  /** Keep picking while it is somebody else's turn. */
  function run() {
    stop();
    if (draft.complete || currentPicker(draft) === u) { draw(); return; }
    const ms = speedMs();
    if (ms === 0) {
      // Instant still has to yield, or a 864-pick draft locks the page up.
      ctx.update((s) => {
        const rng = new RNG(s.league.rngState);
        runAiPicks(s.league, s.league.draft, ctx.players, rng);
        s.league.rngState = rng.state;
      }, { silent: true });
      fresh = null;
      draw();
      return;
    }
    timer = setTimeout(tick, reduced ? Math.min(ms, 120) : ms);
  }

  /**
   * The two expensive reads on the player's turn, done after the screen is up.
   *
   * These used to run inside `draw()`, which meant the board, the player list
   * and every button waited on them. Measured in the browser, arriving at the
   * first pick of a draft blocked the main thread for **9.4 seconds in one
   * task** on a desktop — and the player was on a phone, where it is several
   * times worse. That is the freeze reported on starting a league, on making a
   * pick and on accepting a pick trade: all three end a turn, and ending a
   * turn is what triggered this.
   *
   * They are now two deferred steps, so the screen paints first and the odds
   * and the offer appear as they are worked out. A job is tied to the turn it
   * was started for and checks it is still the live one before touching the
   * cache or redrawing, because a turn can end while it is thinking — the
   * player can trade a pick, or the AI board can move on.
   */
  let turnJob = null;

  /** Redraw without stealing the caret out of the search box. */
  function redraw() {
    const active = document.activeElement;
    const inQ = active && active.id === 'q';
    const at = inQ ? active.selectionStart : 0;
    draw();
    if (!inQ) return;
    const again = root.querySelector('#q');
    if (again) { again.focus(); again.setSelectionRange(at, at); }
  }

  function startTurnWork(turnKey) {
    if (turnJob) turnJob.cancelled = true;
    const job = { key: turnKey, cancelled: false };
    turnJob = job;
    // Claim the turn straight away, or every redraw would start another job.
    turnCache.key = turnKey;
    turnCache.odds = null;
    turnCache.untilPick = null;
    turnCache.offers = null;
    const live = () => !job.cancelled && !stopped && turnJob === job;
    const step = (fn) => setTimeout(() => { if (live()) fn(); }, 0);
    step(() => {
      const sv = survivalOdds(league, draft, ctx.players, u, { trials: 8 });
      if (!live()) return;
      turnCache.odds = sv.odds;
      turnCache.untilPick = sv.untilPick;
      redraw();
      if (draft.round > OFFER_ROUNDS) { turnCache.offers = []; return; }
      // One candidate per task. Each is a single simulated draft; running the
      // whole budget in one go measured a two-second block on a throttled
      // phone, which is the freeze this is all about.
      step(() => {
        const plan = pickOfferCandidates(league, draft, ctx.players, ctx.byId, null);
        if (!live()) return;
        if (!plan) { turnCache.offers = []; return; }
        let i = 0, spent = 0;
        const askOne = () => {
          if (!live()) return;
          if (spent >= OFFER_BUDGET || i >= plan.candidates.length) {
            turnCache.offers = turnCache.offers || [];
            return;
          }
          spent++;
          const offer = tryPickOffer(league, plan, plan.candidates[i++]);
          if (!live()) return;
          if (offer && !turnCache.declined.has(offer.id)) {
            turnCache.offers = [offer];
            redraw();
            return;
          }
          step(askOne);
        };
        askOne();
      });
    });
  }

  function draw() {
    if (stopped) return;
    if (draft.complete) return drawComplete();

    const onClock = currentPicker(draft);
    const mine = onClock === u;
    const open = openSlotsByPos(me);
    const pickNo = overallPickNumber(draft);
    const turnKey = `${draft.picks.length}:${u}`;
    if (mine && turnCache.key !== turnKey) startTurnWork(turnKey);
    const rows = snakeRows(league, draft);
    const clockTeam = league.teams[onClock];

    // The player list is only built when it can be used. On an AI pick at 180ms
    // a thousand-row sort every tick is the one thing that makes this stutter.
    let listHtml = '';
    if (mine) {
      const q = ui.q.trim().toLowerCase();
      const all = availablePlayers(draft, ctx.players)
        .filter((p) => (ui.pos === 'ALL' || p.pos === ui.pos) && (ui.era === 'ALL' || `${Math.floor(p.season / 10) * 10}s` === ui.era) && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q))
        .sort((a, b) => scoutRank(b) - scoutRank(a));
      const shown = all.slice(0, PAGE);
      listHtml = `<div class="card tight stack">
        <div class="tabs" id="posTabs">${['ALL', ...POSITION_ORDER].map((p) => `<button class="tab ${ui.pos === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join('')}</div>
        <div class="tabs" id="eraTabs">${['ALL', ...ERAS].map((e) => `<button class="tab ${ui.era === e ? 'active' : ''}" data-era="${e}">${e}</button>`).join('')}</div>
        <input type="search" id="q" placeholder="Search player or team…" value="${esc(ui.q)}">
        <div class="plist-scroll"><ul class="plist">${shown.map((p) => playerItem(p, {
          cls: open[p.pos] ? '' : 'dim',
          meta: lastsBadge(p.id),
          action: `<button class="btn sm primary" data-draft="${esc(p.id)}" ${open[p.pos] ? '' : 'disabled'}>Draft</button>`,
        })).join('')}</ul>
        ${shown.length === 0 ? '<p class="empty">No available players match.</p>' : ''}
        ${all.length > shown.length ? `<p class="empty">${all.length - shown.length} more — narrow the filters or search.</p>` : ''}
        </div></div>`;
    }

    /**
     * Whether a man lasts to your next turn. Only the ones in danger are
     * marked: a list of a hundred rows each saying "100%" is a list nobody
     * reads, and the whole point is to find the three you have to take now.
     */
    function lastsBadge(id) {
      const odds = turnCache.odds;
      if (!odds || !turnCache.untilPick) return '';
      const q = odds.get(id);
      if (q == null || q > 0.75) return '';
      const pct = Math.round(q * 100);
      const cls = q <= 0.15 ? 'gone' : 'risky';
      return ` <span class="badge lasts ${cls}" title="How often he was still there at your next pick, #${turnCache.untilPick}, over eight runs of the rest of the draft">${pct === 0 ? 'gone by #' + turnCache.untilPick : pct + '% to last'}</span>`;
    }

    const announce = lastPick ? (() => {
      const p = ctx.byId.get(lastPick.playerId);
      const t = league.teams[lastPick.team];
      return `<span class="pick-line ${fresh ? 'fresh' : ''}"><b>#${lastPick.overall}</b> ${teamChip(t, { abbr: true }).__raw} take <b>${esc(lastName(p.name))}</b> <small class="muted">${esc(p.pos)} · ${p.season}</small></span>`;
    })() : '<span class="muted">Waiting on the first pick.</span>';

    render(root, html`<div id="draft-view">
      <div class="card tight draft-head ${mine ? 'mine' : ''}">
        <div class="row between" style="align-items:baseline;gap:.5rem;flex-wrap:wrap">
          <div class="clock">Round ${draft.round} of ${TOTAL_ROUNDS} · Pick ${pickNo}</div>
          <div class="speed">${raw(SPEEDS.map(([n]) => `<button class="tab ${speedName() === n ? 'active' : ''}" data-speed="${n}">${n}</button>`).join(''))}</div>
        </div>
        <div class="whoson">${mine
          ? html`<b>You are on the clock.</b> <span class="muted">Pick a man below, or let the room carry on.</span>`
          : raw(`<span class="spinner"></span><b>${teamChip(clockTeam).__raw} on the clock…</b>`)}</div>
        <div class="ticker-line">${raw(announce)}</div>
        <div class="needs" style="margin-top:.45rem">${raw(POSITION_ORDER.map((pos) => `<span class="need ${open[pos] ? 'open' : ''}" data-filter="${pos}">${pos} ${open[pos] ? `×${open[pos]}` : '✓'}</span>`).join(''))}</div>
        <div class="btn-group" style="margin-top:.6rem">
          <button class="btn sm primary" id="openBoard">Draft board <span class="muted">${draft.picks.length}/${TOTAL_ROUNDS * league.teams.length}</span></button>
          <button class="btn sm" id="tradePicks">Trade picks <span class="muted">${remainingPicks(draft, u).length} left</span></button>
          ${mine ? html`<button class="btn sm" id="autoOne">Auto-pick for me</button>` : html`<button class="btn sm" id="skip">Skip to my pick</button>`}
          <button class="btn sm" id="autoAll">Auto-draft the rest</button>
        </div>
      </div>
      ${mine && turnCache.offers?.length ? raw(turnCache.offers.map((o) => pickOfferCard(league, o)).join('')) : ''}
      ${ui.boardOpen ? raw(boardOverlay(draftBoard(league, rows, {
        labels: rows.labels,
        onClock: { row: rows.roundRow[draft.round - 1] ?? draft.round - 1, team: onClock },
        freshKey: fresh, byId: ctx.byId, observer: u, order: draft.order,
      }), { title: 'Draft board', sub: `${draft.picks.length} of ${TOTAL_ROUNDS * league.teams.length} picks` })) : ''}
      <details class="card tight" id="valueGuide" style="margin-top:.5rem">
        <summary style="cursor:pointer"><b>Where money wins games</b> <span class="muted">${valueHint()}</span></summary>
        ${valuePanel()}
      </details>
      <div class="grid grid-3" style="margin-top:.75rem">
        ${raw(listHtml)}
        <div class="stack">
          <div class="card tight">
            <h3>My roster (${ROSTER_SLOTS.filter((s) => me.slots[s.id]).length}/${TOTAL_ROUNDS})</h3>
            ${raw(ROSTER_SLOTS.map((s) => (me.slots[s.id] ? playerItem(ctx.byId.get(me.slots[s.id]), { attrs: false, pos: false, meta: ` <span class="badge slot">${s.id}</span>` }) : '')).join('') || '<p class="muted" style="font-size:.85rem">No picks yet.</p>')}
          </div>
          <div class="card tight">
            <h3>Draft order</h3>
            <ul class="plain ticker">${raw(draft.order.map((ti, i) => { const t = league.teams[ti]; const gm = GM_PERSONALITIES.find((g) => g.id === t.gm); return `<li class="${t.isUser ? 'me' : ''}">${i + 1}. ${teamChip(t).__raw} ${gm ? `<span class="badge gm" title="${esc(gm.blurb)}">${gm.name}</span>` : ''}</li>`; }).join(''))}</ul>
            <small class="muted">Snake order: it reverses every round.</small>
          </div>
        </div>
      </div>
    </div>`);
    wire();
    scrollToPick(root, { onlyFresh: true });
  }

  function drawComplete() {
    stop();
    render(root, html`<div id="draft-view">
      <div class="card" style="text-align:center">
        <h1>Draft complete</h1>
        <p class="muted">${league.teams.length} rosters are set.${league.offseason ? ` Season ${league.season} is next.` : ''}</p>
        <div class="btn-group" style="justify-content:center">
          <a class="btn" href="#/team/${u}">Review my roster</a>
          <button class="btn primary lg" id="start">Start the season</button>
        </div>
      </div>
      ${ui.boardOpen ? raw(boardOverlay(draftBoard(league, snakeRows(league, draft), {
        labels: snakeRows(league, draft).map((_, i) => `R${i + 1}`), byId: ctx.byId, observer: u, order: draft.order,
      }), { title: 'The board', sub: `${draft.picks.length} picks` })) : ''}
      <div class="card tight" style="text-align:center"><button class="btn primary" id="openBoard">See the full draft board</button></div>
    </div>`);
    root.querySelector('#start').addEventListener('click', () => {
      ctx.update((s) => { startSeason(s.league, ctx.byId); }, { silent: true });
      ctx.navigate('#/season');
    });
    const done = root.querySelector('#draft-view');
    done.querySelector('#openBoard')?.addEventListener('click', () => { ui.boardOpen = true; drawComplete(); });
    done.querySelector('#boardClose')?.addEventListener('click', () => { ui.boardOpen = false; drawComplete(); });
    done.addEventListener('click', (e) => {
      const show = e.target.closest('[data-show]');
      if (show) playerModal(ctx.byId.get(show.dataset.show));
    });
    if (ui.boardOpen) scrollToPick(root);
  }

  function wire() {
    const el = root.querySelector('#draft-view');
    if (!el) return;
    el.querySelector('#openBoard')?.addEventListener('click', () => { ui.boardOpen = true; fresh = null; draw(); });
    el.querySelector('#tradePicks')?.addEventListener('click', () => {
      stop();
      let dealt = false;
      const m = openPickTrade({
        league, draft, pool: ctx.players, byId: ctx.byId, userIdx: u,
        onDone: () => { dealt = true; ctx.update(() => {}, { silent: true }); turnCache.key = null; fresh = null; run(); },
      });
      // Closing the room without dealing has to start the board moving again.
      const back = m.el;
      const observer = new MutationObserver(() => {
        if (back.isConnected) return;
        observer.disconnect();
        if (!dealt && !stopped) run();
      });
      observer.observe(document.body, { childList: true });
    });
    el.addEventListener('click', (e) => {
      const acc = e.target.closest('[data-pkaccept]');
      if (acc) {
        const o = (turnCache.offers || []).find((x) => x.id === acc.dataset.pkaccept);
        if (!o) return;
        try {
          executePickTrade(league, draft, o.from, u, o.gives, o.wants);
          ctx.update(() => {}, { silent: true });
          toast('Deal done');
        } catch (err) { toast(err.message); }
        turnCache.key = null; fresh = null; draw();
        return;
      }
      const dec = e.target.closest('[data-pkdecline]');
      if (dec) {
        turnCache.declined.add(dec.dataset.pkdecline);
        turnCache.offers = (turnCache.offers || []).filter((x) => x.id !== dec.dataset.pkdecline);
        draw();
      }
    });
    el.querySelector('#boardClose')?.addEventListener('click', () => { ui.boardOpen = false; draw(); });
    el.querySelector('.speed').addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (!b) return;
      ctx.update((s) => { s.prefs.draftSpeed = b.dataset.speed; }, { silent: true });
      run();
    });
    el.querySelector('#skip')?.addEventListener('click', () => {
      stop();
      ctx.update((s) => {
        const rng = new RNG(s.league.rngState);
        runAiPicks(s.league, s.league.draft, ctx.players, rng);
        s.league.rngState = rng.state;
      }, { silent: true });
      fresh = null;
      draw();
    });
    el.querySelector('#autoOne')?.addEventListener('click', () => {
      const rng = new RNG(league.rngState);
      const p = aiChoose(league, draft, ctx.players, u, rng);
      if (p) pick(p);
    });
    el.querySelector('#autoAll')?.addEventListener('click', (e) => {
      stop();
      withBusy(e.currentTarget, () => {
        ctx.update((s) => {
          const rng = new RNG(s.league.rngState);
          autoDraftAll(s.league, s.league.draft, ctx.players, rng);
          s.league.rngState = rng.state;
        }, { silent: true });
        draw();
      }, 'Drafting…');
    });
    el.querySelector('#posTabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-pos]'); if (b) { ui.pos = b.dataset.pos; draw(); } });
    el.querySelector('#eraTabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-era]'); if (b) { ui.era = b.dataset.era; draw(); } });
    el.querySelector('.needs').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { ui.pos = b.dataset.filter; draw(); } });
    const q = el.querySelector('#q');
    if (q) q.addEventListener('input', (e) => {
      ui.q = e.target.value;
      const at = e.target.selectionStart;
      draw();
      const again = root.querySelector('#q');
      if (again) { again.focus(); again.setSelectionRange(at, at); }
    });
    el.addEventListener('click', (e) => {
      const show = e.target.closest('[data-show]');
      if (show) { playerModal(ctx.byId.get(show.dataset.show)); return; }
      const btn = e.target.closest('[data-draft]');
      if (btn) pick(ctx.byId.get(btn.dataset.draft));
    });
  }

  function pick(p) {
    try {
      let landed = null;
      ctx.update((s) => { makePick(s.league, s.league.draft, p); landed = s.league.draft.picks[s.league.draft.picks.length - 1]; }, { silent: true });
      lastPick = landed;
      fresh = landed ? `${(landed.round || 1) - 1}:${landed.team}` : null;
      toast(`Drafted ${p.name}`);
      // Show it before handing the room back: `run` only redraws when it is
      // about to stop, so without this your own pick waits for the next AI one.
      draw();
      run();
    } catch (err) {
      toast(err.message);
    }
  }

  draw();
  run();
  return () => { stopped = true; stop(); };
}
