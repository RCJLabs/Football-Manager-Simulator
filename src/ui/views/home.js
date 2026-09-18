import { html, render, raw } from '../../util.js';
import { teamChip } from '../components.js';
import { fmtPhase } from './season.js';

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
      <div class="features">
        <div class="feature"><b>Snake draft vs. AI GMs</b><span class="muted">Each rival general manager has a personality: Air Raid, Ground &amp; Pound, Old School, Analytics…</span></div>
        <div class="feature"><b>Play-by-play simulation</b><span class="muted">Ratings drive every snap: pass rush vs. protection, coverage vs. separation, tackling vs. YAC.</span></div>
        <div class="feature"><b>Manager or coach</b><span class="muted">Set strategy and watch, or call every play yourself, 4th-down decisions included.</span></div>
      </div>
      <p class="muted" style="margin-top:1.25rem;font-size:.85rem">Everything runs in your browser and saves locally. Installable as an app.</p>
    `);
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
      <a class="feature" href="#/settings"><b>Settings</b><span class="muted">Coach mode, export/import, reset.</span></a>
      <a class="feature" href="${cont}"><b>${league.phase === 'draft' ? 'Back to the auction room' : 'League hub'}</b><span class="muted">Schedule, standings, playoffs.</span></a>
    </div>
  `);
}
