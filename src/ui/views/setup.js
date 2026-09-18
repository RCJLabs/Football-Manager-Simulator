import { html, render } from '../../util.js';
import { createLeague, startSeason } from '../../engine/season.js';
import { autoDraftAll, RNG } from '../../engine/draft.js';
import { autoCompleteAll } from '../../engine/auction.js';

export function view(root, params, ctx) {
  const existing = ctx.getState().league;
  render(root, html`
    <div class="card" style="max-width:640px;margin:0 auto">
      <h1>New league</h1>
      ${existing ? html`<div class="notice">Starting a new league replaces your current one (${existing.name}). Export it from Settings first if you want to keep it.</div>` : ''}
      <form id="setup" class="stack" style="margin-top:1rem">
        <div class="form-row">
          <div><label>League name</label><input type="text" name="league" value="All-Time League" maxlength="40"></div>
          <div><label>Teams</label>
            <select name="teams">
              <option value="4">4 teams · 6 games</option>
              <option value="6">6 teams · 10 games</option>
              <option value="8" selected>8 teams · 14 games</option>
              <option value="10">10 teams · 9 games</option>
              <option value="12">12 teams · 11 games, 8 make the playoffs</option>
              <option value="14">14 teams · 13 games, 8 make the playoffs</option>
              <option value="16">16 teams · 15 games, 8 make the playoffs</option>
            </select>
            <small class="muted">More teams means thinner rosters. In a 12-team league the bottom of the player pool starts every week.</small></div>
        </div>
        <div class="form-row">
          <div><label>Your team name</label><input type="text" name="name" value="Time Travelers" maxlength="28" required></div>
          <div class="row" style="align-items:flex-end">
            <div style="flex:1"><label>Abbreviation</label><input type="text" name="abbr" value="TTV" maxlength="4" pattern="[A-Za-z]{2,4}" required></div>
            <div><label>Color</label><input type="color" name="color" value="#e63946"></div>
          </div>
        </div>
        <div>
          <label>How you build your team</label>
          <label class="check"><input type="radio" name="type" value="auction" checked> <span><b>Auction</b> — $200 cap, bid against the other GMs. Star names cost star money, so you cannot have everything.</span></label>
          <label class="check"><input type="radio" name="type" value="snake"> <span><b>Snake draft</b> — take turns picking. Simpler, but every roster ends up about equally good.</span></label>
        </div>
        <div>
          <label>Who builds it</label>
          <label class="check"><input type="radio" name="draft" value="manual" checked> I'll do it myself</label>
          <label class="check"><input type="radio" name="draft" value="auto"> Fill my roster automatically and jump to the season</label>
        </div>
        <div>
          <label>Game control</label>
          <label class="check"><input type="checkbox" name="coach"> Coach mode: I call the offensive plays in my games</label>
          <label class="check"><input type="checkbox" name="coachDef"> …and the defensive calls too</label>
        </div>
        <div class="row" style="margin-top:.5rem">
          <button class="btn primary lg" type="submit">Create league</button>
          <a class="btn ghost" href="#/">Cancel</a>
        </div>
      </form>
    </div>
  `);
  root.querySelector('#setup').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const draftType = f.get('type') === 'snake' ? 'snake' : 'auction';
    const league = createLeague({
      name: f.get('league').trim() || 'All-Time League',
      numTeams: Number(f.get('teams')),
      draftType,
      user: { name: f.get('name').trim() || 'My Team', abbr: f.get('abbr').trim() || 'ME', color: f.get('color') },
    });
    league.settings.coachMode = f.get('coach') === 'on';
    league.settings.coachDefense = f.get('coachDef') === 'on';
    const auto = f.get('draft') === 'auto';
    if (auto) {
      const rng = new RNG(league.rngState);
      if (draftType === 'auction') autoCompleteAll(league.auction, league, ctx.players, rng, ctx.byId);
      else autoDraftAll(league, league.draft, ctx.players, rng);
      league.rngState = rng.state;
      startSeason(league);
    }
    ctx.update((s) => { s.league = league; s.game = null; }, { silent: true });
    ctx.navigate(auto ? '#/season' : (draftType === 'auction' ? '#/auction' : '#/draft'));
  });
}
