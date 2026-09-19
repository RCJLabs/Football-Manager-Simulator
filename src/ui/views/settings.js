import { html, render, download } from '../../util.js';
import { exportJSON, importJSON, resetAll } from '../../store.js';
import { modal } from '../components.js';
import { INJURY_LEVEL_LABELS } from '../../engine/injuries.js';
import { encodeLeagueCode } from '../../engine/share.js';
import { drawRosterCard, shareCanvas } from '../share-card.js';
import { applyNameMode } from '../../data/names.js';
import { clearOverrides, overridesFile } from '../../data/tuning.js';
import { poolFingerprint } from '../../engine/share.js';

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
          <label class="check" style="margin-top:.4rem"><input type="checkbox" id="penalties" ${league.settings.penalties !== false ? 'checked' : ''}> Penalties — flags for false starts, holding, interference and the rest</label>
          <label class="check" style="margin-top:.4rem"><input type="checkbox" id="careers" ${league.settings.careers ? 'checked' : ''}> Careers — rostered players age each offseason, rookies develop, the old retire</label>
          <label class="check" style="margin-top:.4rem"><input type="checkbox" id="chemistry" ${league.settings.chemistry ? 'checked' : ''}> Chemistry — a settled squad from a tight era band plays a little better</label>
          <label class="check" style="margin-top:.4rem"><input type="checkbox" id="scouting" ${league.settings.scouting ? 'checked' : ''}> Scouting — rookies show a projected range until they have played; real players are never hidden</label>
          ${league.mode === 'pro' ? html`<label class="check" style="margin-top:.4rem"><input type="checkbox" id="jobs" ${league.settings.jobs ? 'checked' : ''}> Coaching jobs — an owner who expects something, rival coaches who get sacked, and a job market you move around</label>` : ''}
          ${league.settings.careers && league.settings.chemistry && league.settings.scouting ? '' : html`<small class="muted">A league started before these existed keeps its old rules until you switch them on here.</small>`}
          <div class="row" style="margin-top:.8rem;gap:.5rem;align-items:center">
            <label style="margin:0">Injuries</label>
            <select id="injuries" style="max-width:10rem">${Object.entries(INJURY_LEVEL_LABELS).map(([k, label]) => html`<option value="${k}" ${(league.settings.injuries || 'normal') === k ? 'selected' : ''}>${label}</option>`)}</select>
          </div>
          <small class="muted">Applies to games from now on. Players already hurt stay hurt.</small>
          <div class="row" style="margin-top:.8rem;gap:.5rem;align-items:center">
            <label style="margin:0">Keepers per club</label>
            <select id="keepers" style="max-width:12rem">${[0, 3, 6, 9, 12, 18, 22].map((n) => html`<option value="${n}" ${(league.settings.keepers ?? 6) === n ? 'selected' : ''}>${n === 0 ? 'None' : n}</option>`)}</select>
          </div>
          <small class="muted">How many players each club carries into next season's market.</small>
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
      <div class="card">
        <h2>Share</h2>
        <p class="muted">A league code carries every club's roster, contracts and settings at the start of the season, small enough to paste in a chat; a friend opens it from the new-league screen and plays the same league. A roster card is a picture of your starters.</p>
        <div class="btn-group">
          <button class="btn" id="copyCode" ${league && league.phase !== 'draft' ? '' : 'disabled'}>Copy league code</button>
          <button class="btn" id="shareCard" ${league && league.phase !== 'draft' ? '' : 'disabled'}>Share roster card</button>
        </div>
        <textarea id="codeOut" rows="3" readonly hidden style="margin-top:.5rem;font-family:var(--mono);font-size:.75rem"></textarea>
        <small class="muted" id="shareNote"></small>
      </div>
      <div class="card">
        <h2>Player pool</h2>
        <label class="check"><input type="checkbox" id="fictional" ${s.prefs.nameMode === 'fictional' ? 'checked' : ''}> Fictional player names</label>
        <small class="muted" style="display:block;margin:-.1rem 0 .6rem">Every real name is swapped for a made-up one, one to one and stable across sessions. Ratings, ids and saves are untouched; logs and records keep the names they were written with.</small>
        <label class="check"><input type="checkbox" id="editor" ${s.prefs.ratingEditor ? 'checked' : ''}> Rating editor</label>
        <small class="muted" style="display:block;margin:-.1rem 0 .6rem">Tap any player to edit his ratings. Edits apply everywhere at once and are kept in this browser; export them as a diff to argue for a change to the shipped pool.</small>
        <div class="btn-group">
          <button class="btn" id="exportEdits" ${Object.keys(s.prefs.ratingOverrides || {}).length ? '' : 'disabled'}>Export rating edits (${Object.keys(s.prefs.ratingOverrides || {}).length})</button>
          <button class="btn danger sm" id="clearEdits" ${Object.keys(s.prefs.ratingOverrides || {}).length ? '' : 'disabled'}>Discard edits</button>
        </div>
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
    root.querySelector('#penalties').addEventListener('change', (e) => ctx.update((st) => { st.league.settings.penalties = e.target.checked; }, { silent: true }));
    root.querySelector('#careers').addEventListener('change', (e) => ctx.update((st) => { st.league.settings.careers = e.target.checked; }, { silent: true }));
    root.querySelector('#chemistry').addEventListener('change', (e) => ctx.update((st) => { st.league.settings.chemistry = e.target.checked; }));
    root.querySelector('#scouting').addEventListener('change', (e) => ctx.update((st) => { st.league.settings.scouting = e.target.checked; }));
    root.querySelector('#jobs')?.addEventListener('change', (e) => ctx.update((st) => { st.league.settings.jobs = e.target.checked; }));
    root.querySelector('#keepers').addEventListener('change', (e) => ctx.update((st) => { st.league.settings.keepers = Number(e.target.value); }, { silent: true }));
  }
  root.querySelector('#fictional').addEventListener('change', (e) => {
    const mode = e.target.checked ? 'fictional' : 'real';
    ctx.update((st) => { st.prefs.nameMode = mode; }, { silent: true });
    applyNameMode(ctx.players, mode);
    ctx.toast(mode === 'fictional' ? 'Fictional names on' : 'Real names back');
  });
  root.querySelector('#editor').addEventListener('change', (e) => ctx.update((st) => { st.prefs.ratingEditor = e.target.checked; }, { silent: true }));
  root.querySelector('#exportEdits').addEventListener('click', () => {
    download('gridiron-eras-rating-edits.json', JSON.stringify(overridesFile(ctx.getState().prefs.ratingOverrides || {}, ctx.byId, poolFingerprint(ctx.players)), null, 2));
  });
  root.querySelector('#clearEdits').addEventListener('click', () => {
    clearOverrides(ctx.players);
    ctx.update((st) => { st.prefs.ratingOverrides = {}; });
    ctx.toast('Rating edits discarded');
  });
  root.querySelector('#copyCode').addEventListener('click', async () => {
    const note = root.querySelector('#shareNote'), out = root.querySelector('#codeOut');
    try {
      const code = await encodeLeagueCode(league, ctx.players);
      out.value = code; out.hidden = false;
      try { await navigator.clipboard.writeText(code); note.textContent = `Copied (${code.length} characters). Results and history are not carried; the code opens at the start of season ${league.season}.`; }
      catch { note.textContent = 'Copy the code from the box above.'; out.select(); }
    } catch (err) { note.textContent = err.message; }
  });
  root.querySelector('#shareCard').addEventListener('click', async () => {
    const note = root.querySelector('#shareNote');
    try {
      const u = league.teams.findIndex((t) => t.isUser);
      const canvas = drawRosterCard(league, league.teams[u], ctx.byId);
      const how = await shareCanvas(canvas, `${(league.teams[u].name || 'roster').replace(/\W+/g, '-').toLowerCase()}.png`);
      note.textContent = how === 'shared' ? 'Shared.' : 'Saved as a PNG.';
    } catch (err) { if (err && err.name !== 'AbortError') note.textContent = err.message; }
  });
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
