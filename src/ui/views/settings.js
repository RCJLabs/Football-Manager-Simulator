import { html, render, download } from '../../util.js';
import { exportJSON, importJSON, resetAll } from '../../store.js';
import { modal } from '../components.js';
import { INJURY_LEVEL_LABELS } from '../../engine/injuries.js';

export function view(root, params, ctx) {
  const s = ctx.getState();
  const league = s.league;
  render(root, html`
    <div class="grid grid-2">
      <div class="card">
        <h2>Game settings</h2>
        ${league ? html`
          <label class="check"><input type="checkbox" id="coach" ${league.settings.coachMode ? 'checked' : ''}> Coach mode — call offensive plays in my games</label>
          <label class="check" style="margin-top:.4rem"><input type="checkbox" id="coachDef" ${league.settings.coachDefense ? 'checked' : ''}> Call defensive plays too</label>
          <div class="row" style="margin-top:.8rem;gap:.5rem;align-items:center">
            <label style="margin:0">Injuries</label>
            <select id="injuries" style="max-width:10rem">${Object.entries(INJURY_LEVEL_LABELS).map(([k, label]) => html`<option value="${k}" ${(league.settings.injuries || 'normal') === k ? 'selected' : ''}>${label}</option>`)}</select>
          </div>
          <small class="muted">Applies to games from now on. Players already hurt stay hurt.</small>
        ` : html`<p class="muted">Create a league to set coach mode.</p>`}
        <div class="slider-row" style="margin-top:1rem">
          <div class="lbl"><span>Autoplay speed</span><b id="speedLbl">${(s.prefs.autoplayMs / 1000).toFixed(1)}s per play</b></div>
          <input type="range" id="speed" min="200" max="3000" step="100" value="${s.prefs.autoplayMs}">
        </div>
      </div>
      <div class="card">
        <h2>Save data</h2>
        <p class="muted">Your league lives in this browser's local storage. Export a backup before clearing site data or switching devices.</p>
        <div class="btn-group">
          <button class="btn" id="export" ${league ? '' : 'disabled'}>Export league (.json)</button>
          <button class="btn" id="import">Import league</button>
          <input type="file" id="file" accept="application/json,.json" hidden>
        </div>
        <hr>
        <button class="btn danger" id="reset" ${league ? '' : 'disabled'}>Delete league</button>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h2>About</h2>
        <p>Gridiron Eras is a single-player all-time football simulator. Player ratings are editorial estimates of each player's prime season, scaled so eras can be compared; they are not official statistics. Names are used for identification only — no likenesses, logos, or team marks.</p>
        <p class="muted">Ratings live in <code>src/data/players.js</code>. Simulation constants live in <code>src/engine/game.js</code>. Version 0.1.0.</p>
      </div>
    </div>
  `);
  if (league) {
    root.querySelector('#coach').addEventListener('change', (e) => ctx.update((st) => { st.league.settings.coachMode = e.target.checked; }));
    root.querySelector('#coachDef').addEventListener('change', (e) => ctx.update((st) => { st.league.settings.coachDefense = e.target.checked; }));
    root.querySelector('#injuries').addEventListener('change', (e) => ctx.update((st) => { st.league.settings.injuries = e.target.value; }, { silent: true }));
  }
  const speed = root.querySelector('#speed');
  speed.addEventListener('input', () => { root.querySelector('#speedLbl').textContent = `${(speed.value / 1000).toFixed(1)}s per play`; });
  speed.addEventListener('change', () => ctx.update((st) => { st.prefs.autoplayMs = Number(speed.value); }, { silent: true }));
  root.querySelector('#export').addEventListener('click', () => {
    download(`gridiron-eras-${(league.name || 'league').replace(/\W+/g, '-').toLowerCase()}.json`, exportJSON());
  });
  root.querySelector('#import').addEventListener('click', () => root.querySelector('#file').click());
  root.querySelector('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { importJSON(await f.text()); ctx.toast('League imported'); ctx.navigate('#/'); }
    catch (err) { ctx.toast(`Import failed: ${err.message}`); }
  });
  root.querySelector('#reset').addEventListener('click', () => {
    const m = modal(html`<h2>Delete this league?</h2><p class="muted">This removes the league, rosters, and results from this browser. Export first if you want a backup.</p>
      <div class="row"><button class="btn danger" id="yes">Delete</button><button class="btn" data-close>Cancel</button></div>`);
    m.el.querySelector('#yes').addEventListener('click', () => { m.close(); resetAll(); ctx.toast('League deleted'); ctx.navigate('#/'); });
  });
}
