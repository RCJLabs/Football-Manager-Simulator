// Headless browser smoke test at phone width: boots the app, creates a league
// with auto-draft, plays part of a game in coach mode, sims a week, and checks
// every screen for console errors and horizontal overflow.
// Usage: NODE_PATH=<global node_modules> node scripts/smoke.mjs  (needs playwright and http-server resolvable)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const port = 8123;
const server = spawn(process.execPath, [require.resolve('http-server/bin/http-server'), '.', '-p', String(port), '-s', '-c-1'], { stdio: 'ignore' });
await sleep(800);
const browser = await chromium.launch();
// Narrowest phone we support: 360 CSS px (Galaxy S-series portrait).
const page = await browser.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const shot = async (name) => page.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/${name}.png`, fullPage: false });

/** Fails if the page scrolls sideways, and names the widest offending element. */
async function checkOverflow(where) {
  const bad = await page.evaluate(() => {
    const docW = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= docW + 1) return null;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > docW + 1 || r.left < -1) {
        const style = getComputedStyle(el);
        // An element that scrolls internally is fine; it is not pushing the page.
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
        offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(r.right)}`);
      }
    }
    return { docW, scrollW: document.documentElement.scrollWidth, offenders: offenders.slice(0, 5) };
  });
  if (bad) errors.push(`overflow on ${where}: page is ${bad.scrollW}px wide in a ${bad.docW}px viewport — ${bad.offenders.join(', ') || 'no single offender found'}`);
}

try {
  await page.goto(`http://localhost:${port}/#/`);
  await page.waitForSelector('.hero');
  await checkOverflow('home');
  await shot('01-home');

  await page.click('a[href="#/new"]');
  await page.waitForSelector('#setup');
  await page.check('input[name="coach"]');
  await page.check('input[name="type"][value="auction"]');
  await page.check('input[name="injuries"][value="high"]');
  await checkOverflow('setup');
  await page.click('button[type="submit"]');

  // Auction room: nominate, bid, pass, then hand the rest to the AI.
  await page.waitForSelector('#auction-view');
  await checkOverflow('auction');
  await shot('02-auction');
  let bought = 0;
  for (let i = 0; i < 24; i++) {
    const nom = await page.$('button[data-nom]');
    if (nom) { await nom.click(); await sleep(30); await checkOverflow('auction bidding'); continue; }
    const bid = await page.$('#bid');
    if (bid) {
      // Alternate between bidding the slider value and passing.
      if (bought % 2 === 0) { await bid.click(); bought++; } else { await page.click('#pass'); bought++; }
      await sleep(30);
      continue;
    }
    break;
  }
  await shot('03-auction-bid');
  await checkOverflow('auction after bids');
  await page.click('#autoAll');
  await page.waitForSelector('#start');
  await checkOverflow('auction complete');
  await shot('04-auction-done');
  await page.click('#start');

  await page.waitForSelector('#play');
  await checkOverflow('season hub');
  await shot('05-season');

  await page.click('#play');
  await page.waitForSelector('.scoreboard');
  await checkOverflow('live game');
  for (let i = 0; i < 25; i++) {
    const off = await page.$('[data-off="pass_med"]');
    const next = await page.$('#next');
    const pat = await page.$('[data-pat="xp"]');
    if (off) await off.click(); else if (pat) await pat.click(); else if (next) await next.click(); else break;
    await sleep(20);
  }
  await checkOverflow('live game mid-drive');
  await shot('06-game');
  for (let i = 0; i < 3 && !(await page.$('#simEnd')); i++) {
    const pat = await page.$('[data-pat="xp"]');
    if (pat) await pat.click();
    await sleep(20);
  }
  await page.click('#simEnd');
  await page.waitForSelector('#finish');
  await shot('07-final');

  await page.click('a[href="#/box/live"]');
  await page.waitForSelector('.stat-compare');
  await checkOverflow('box score');
  await shot('08-box');

  await page.goto(`http://localhost:${port}/#/game`);
  await page.waitForSelector('#finish');
  await page.click('#finish');
  await page.waitForSelector('#advance');
  await page.click('#advance');
  await page.waitForSelector('#play');
  await page.click('#simWeek');
  await page.waitForSelector('#advance');
  await checkOverflow('season after week 1');
  await shot('09-week2');

  // Roster moves: claim a free agent, propose a like-for-like trade, resolve the wire on advance.
  await page.goto(`http://localhost:${port}/#/moves`);
  await page.waitForSelector('#moves-view .plist .prow');
  await checkOverflow('moves free agents');
  await shot('09b-moves');
  await page.click('button[data-pos="WR"]');
  await page.waitForSelector('button[data-claim]');
  await page.click('button[data-claim]');
  await page.waitForSelector('.modal button[data-drop]');
  await checkOverflow('claim modal');
  await page.click('.modal button[data-drop] >> nth=-1');
  await page.waitForSelector('.modal-back', { state: 'detached' });
  const claimTab = await page.$eval('button[data-tab="claims"]', (b) => b.textContent);
  if (!/\(1\//.test(claimTab)) errors.push(`claims tab reads "${claimTab}", expected one pending claim`);
  await page.click('button[data-tab="claims"]');
  await page.waitForSelector('button[data-cancel]');
  await checkOverflow('moves claims');
  await page.goto(`http://localhost:${port}/#/moves/trade`);
  await page.waitForSelector('#partner');
  await checkOverflow('moves trades');
  await page.click('[data-give]');
  await page.click('[data-get]');
  await page.waitForSelector('#propose:not([disabled])');
  await checkOverflow('moves trade selected');
  await shot('09c-trade');
  await page.click('#propose');
  await page.waitForSelector('.modal');
  await page.click('.modal [data-close]');
  await page.waitForSelector('.modal-back', { state: 'detached' });
  await page.goto(`http://localhost:${port}/#/season`);
  await page.waitForSelector('#advance');
  await sleep(400); // the store saves on a short debounce
  const weekBefore = await page.evaluate(() => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || '{"active":null}'); const raw = reg.active ? localStorage.getItem('gridiron-eras:slot:' + reg.active) : null; return raw ? JSON.parse(raw) : { league: null }; })().league.week);
  await page.click('#advance');
  await page.waitForSelector('#play');
  await page.waitForFunction((w) => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || '{"active":null}'); const raw = reg.active ? localStorage.getItem('gridiron-eras:slot:' + reg.active) : null; return raw ? JSON.parse(raw) : { league: null }; })().league.week === w + 1, weekBefore, { timeout: 5000 });
  const wire = await page.evaluate(() => { const lg = (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || '{"active":null}'); const raw = reg.active ? localStorage.getItem('gridiron-eras:slot:' + reg.active) : null; return raw ? JSON.parse(raw) : { league: null }; })().league; return { user: lg.teams.findIndex((t) => t.isUser), week: lg.lastWaivers && lg.lastWaivers.week, results: lg.lastWaivers ? lg.lastWaivers.results : [] }; });
  if (wire.week !== weekBefore) errors.push(`the wire resolved for week ${wire.week}, expected ${weekBefore}`);
  if (!wire.results.some((r) => r.team === wire.user)) errors.push(`the user claim never resolved on advance: ${JSON.stringify(wire)}`);
  await page.goto(`http://localhost:${port}/#/moves/offers`);
  await page.waitForSelector('#moves-view');
  await checkOverflow('moves offers');
  await shot('09d1-offers');
  await page.goto(`http://localhost:${port}/#/moves/log`);
  await page.waitForSelector('#moves-view');
  await checkOverflow('moves log');
  await shot('09d-log');
  await page.goto(`http://localhost:${port}/#/season`);
  await page.waitForSelector('#simWeek');
  await page.click('#simWeek');
  await page.waitForSelector('#advance');

  await page.goto(`http://localhost:${port}/#/team/0`);
  await page.waitForSelector('.slider-row');
  await checkOverflow('team page');
  await shot('10-team');

  // Injured reserve: park a long injury, then bring him back. Let the app's
  // debounced save flush first, or reloading writes its state over ours.
  await sleep(600);
  const irTarget = await page.evaluate(() => {
    const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
    const key = 'gridiron-eras:slot:' + reg.active;
    const st = JSON.parse(localStorage.getItem(key));
    const u = st.league.teams.findIndex((t) => t.isUser);
    const slot = Object.keys(st.league.teams[u].slots).find((k) => st.league.teams[u].slots[k]);
    const id = st.league.teams[u].slots[slot];
    st.league.injuries[id] = { weeks: 6, kind: 'knee sprain', since: null, season: st.league.season, team: u };
    localStorage.setItem(key, JSON.stringify(st));
    return { u, slot, id, phase: st.league.phase };
  });
  if (irTarget.phase !== 'season') errors.push(`injured reserve step ran in phase ${irTarget.phase}`);
  await page.goto(`http://localhost:${port}/#/team/${irTarget.u}`);
  await page.reload();
  await page.waitForSelector('[data-ir]');
  await checkOverflow('team page with an IR candidate');
  await page.click(`[data-ir="${irTarget.id}"]`);
  await page.waitForSelector('.modal #yes');
  await page.click('.modal #yes');
  await page.waitForSelector('[data-release]');
  await checkOverflow('injured reserve');
  await shot('10b-ir');
  const irSaved = (want) => page.waitForFunction((n) => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); const lg = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league; return (lg.teams.find((t) => t.isUser).ir || []).length === n; }, want, { timeout: 5000 }).then(() => true).catch(() => false);
  if (!(await irSaved(1))) errors.push('injured reserve did not persist');
  const parked = await page.evaluate((slot) => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); const lg = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league; const t = lg.teams.find((x) => x.isUser); return { ir: (t.ir || []).length, slot: t.slots[slot] }; })(), irTarget.slot);
  if (parked.slot) errors.push(`the slot did not open: ${JSON.stringify(parked)}`);

  // Heal him and activate back into the slot he left.
  await sleep(600);
  await page.evaluate(() => {
    const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
    const key = 'gridiron-eras:slot:' + reg.active;
    const st = JSON.parse(localStorage.getItem(key));
    const u = st.league.teams.findIndex((t) => t.isUser);
    for (const id of st.league.teams[u].ir) delete st.league.injuries[id];
    localStorage.setItem(key, JSON.stringify(st));
  });
  await page.reload();
  await page.waitForSelector('[data-activate]');
  await page.click('[data-activate]');
  await page.waitForSelector('.modal [data-take]');
  await checkOverflow('activate from IR');
  await page.click('.modal [data-take]');
  if (!(await irSaved(0))) errors.push('activation did not persist');
  const back = await page.evaluate((slot) => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); const lg = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league; const t = lg.teams.find((x) => x.isUser); return !!t.slots[slot]; })(), irTarget.slot);
  if (!back) errors.push('the activated player did not take his slot back');

  await page.goto(`http://localhost:${port}/#/players`);
  await page.waitForSelector('.plist .prow');
  await page.fill('#q', 'rice');
  await sleep(120);
  await checkOverflow('player pool');
  await shot('11-players');

  // The awards race after a few weeks.
  await page.goto(`http://localhost:${port}/#/awards`);
  await page.waitForSelector('#awards-view');
  await checkOverflow('awards race');
  await shot('11b-awards');
  await page.click('button[data-tab="records"]');
  await page.waitForSelector('#awards-view');
  await checkOverflow('awards records');

  await page.goto(`http://localhost:${port}/#/settings`);
  await page.waitForSelector('#speed');
  await page.waitForSelector('#injuries');
  await page.selectOption('#injuries', 'normal');
  await checkOverflow('settings');
  // The store saves on a short debounce.
  // Fictional names swap every name in the pool and back.
  await page.check('#fictional');
  await page.goto(`http://localhost:${port}/#/players`);
  await page.waitForSelector('#players-view');
  await page.fill('#q', 'rice');
  await sleep(150);
  const hidden = await page.$$eval('.plist .prow', (r) => r.length);
  if (hidden !== 0) errors.push(`fictional names still match "rice" (${hidden} rows)`);
  await page.goto(`http://localhost:${port}/#/settings`);
  await page.waitForSelector('#fictional');
  await page.uncheck('#fictional');
  await page.goto(`http://localhost:${port}/#/players`);
  await page.waitForSelector('#players-view');
  await page.fill('#q', 'rice');
  await sleep(150);
  const shown = await page.$$eval('.plist .prow', (r) => r.length);
  if (shown === 0) errors.push('real names did not come back');
  await page.goto(`http://localhost:${port}/#/settings`);
  await page.waitForSelector('#injuries');
  const dialSaved = await page.waitForFunction(() => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || '{"active":null}'); const raw = reg.active ? localStorage.getItem('gridiron-eras:slot:' + reg.active) : null; return raw ? JSON.parse(raw) : { league: null }; })().league.settings.injuries === 'normal', null, { timeout: 3000 }).then(() => true).catch(() => false);
  if (!dialSaved) errors.push('injury dial change was not saved');

  await page.goto(`http://localhost:${port}/#/season`);
  await page.reload();
  await page.waitForSelector('#advance');
  const saved = await page.evaluate(() => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || '{"active":null}'); const raw = reg.active ? localStorage.getItem('gridiron-eras:slot:' + reg.active) : null; return raw ? JSON.parse(raw) : { league: null }; })().league.week);
  console.log('persisted week:', saved);

  // Play the season out, then run the offseason: keepers, the auction, season two.
  let tookOffer = false;
  for (let i = 0; i < 40 && !(await page.$('.champ')); i++) {
    const sim = await page.$('#simWeek');
    if (sim) { await sim.click(); await page.waitForSelector('#advance'); }
    const adv = await page.$('#advance');
    if (adv) { await adv.click(); await sleep(60); } else break;
    // Take the first trade offer a club makes, to prove the whole path works.
    if (!tookOffer && (await page.$('a[href="#/moves/offers"].primary'))) {
      await page.click('a[href="#/moves/offers"].primary');
      await page.waitForSelector('[data-accept]');
      await checkOverflow('trade offer');
      await shot('09d2-offer');
      const before = await page.evaluate(() => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); const lg = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league; return (lg.transactions || []).filter((t) => t.type === 'trade').length; })());
      await page.click('[data-accept]');
      await sleep(400);
      const after = await page.evaluate(() => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); const lg = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league; return (lg.transactions || []).filter((t) => t.type === 'trade').length; })());
      if (after <= before) errors.push('accepting a trade offer did not log a trade');
      tookOffer = true;
      await page.goto(`http://localhost:${port}/#/season`);
      await page.waitForSelector('#season-view');
    }
  }
  if (!tookOffer) console.log('note: no AI trade offer appeared this run');
  if (!(await page.$('.champ'))) errors.push('the season never produced a champion');
  await checkOverflow('season complete');
  await shot('09e-champion');
  const mvpLine = await page.$eval('.champ', (e) => e.textContent);
  if (!/MVP:/.test(mvpLine)) errors.push('the champion card names no MVP');
  await page.goto(`http://localhost:${port}/#/awards/honours`);
  await page.waitForSelector('#awards-view');
  await checkOverflow('awards honours');
  await shot('09e2-honours');
  await page.goto(`http://localhost:${port}/#/awards/hall`);
  await page.waitForSelector('#awards-view');
  await checkOverflow('hall of fame');
  await page.goto(`http://localhost:${port}/#/season`);
  await page.waitForSelector('.champ');
  await page.click('a[href="#/offseason"]');
  await page.waitForSelector('#offseason-view');
  await checkOverflow('offseason');
  await shot('09f-offseason');
  await page.click('button[data-keep]');
  await page.waitForSelector('button[data-keep].primary');
  await page.click('#autoKeep');
  await sleep(80);
  await checkOverflow('offseason keepers picked');
  await page.click('#confirm');
  await page.waitForSelector('#autoAll');
  await checkOverflow('offseason auction');
  await shot('09g-offseason-auction');
  await page.click('#autoAll');
  await page.waitForSelector('#start');
  // The store saves on a short debounce; wait for the finished market to land.
  const marketSaved = await page.waitForFunction(() => { const lg = (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || '{"active":null}'); const raw = reg.active ? localStorage.getItem('gridiron-eras:slot:' + reg.active) : null; return raw ? JSON.parse(raw) : { league: null }; })().league; return lg.season === 2 && lg.auction && lg.auction.complete; }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  if (!marketSaved) errors.push('the offseason auction never persisted as complete in season 2');
  const leftover = await page.evaluate(() => { const lg = (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || '{"active":null}'); const raw = reg.active ? localStorage.getItem('gridiron-eras:slot:' + reg.active) : null; return raw ? JSON.parse(raw) : { league: null }; })().league; return { kept: Object.values(lg.contracts).filter((c) => c.kept > 0).length, full: lg.teams.every((t) => Object.values(t.slots).every(Boolean)) }; });
  if (!leftover.full) errors.push('the offseason auction left a slot open');
  if (!leftover.kept) errors.push('no keeper survived into season 2');
  await page.click('#start');
  await page.waitForSelector('#season-view');
  const phaseText = await page.$eval('#season-view .muted', (e) => e.textContent);
  if (!/Season 2/.test(phaseText)) errors.push(`hub reads "${phaseText}" after the offseason, expected season 2`);
  await checkOverflow('season two hub');
  await shot('09h-season2');

  // A second league goes into its own slot; the first stays and can be reopened.
  await page.goto(`http://localhost:${port}/#/new`);
  await page.waitForSelector('#setup');
  await page.fill('input[name="name"]', 'Second Club');
  await page.check('input[name="type"][value="auction"]');
  await page.check('input[name="draft"][value="auto"]');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#season-view');
  await page.goto(`http://localhost:${port}/#/`);
  await page.waitForSelector('[data-open]');
  await checkOverflow('home with two leagues');
  await shot('12a-slots');
  const slotCount = await page.$$eval('[data-del]', (b) => b.length);
  if (slotCount !== 2) errors.push(`home lists ${slotCount} leagues, expected 2`);
  await page.click('[data-open]');
  await page.waitForSelector('[data-open]');
  const reopened = await page.evaluate(() => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); return JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league.teams.find((t) => t.isUser).name; })());
  if (reopened !== 'Time Travelers') errors.push(`reopened slot belongs to ${reopened}`);
  // Sharing: the league code round-trips through the setup screen into a third slot.
  await page.goto(`http://localhost:${port}/#/settings`);
  await page.waitForSelector('#copyCode');
  await page.click('#copyCode');
  await page.waitForSelector('#codeOut:not([hidden])');
  const code = await page.$eval('#codeOut', (t) => t.value);
  if (!/^GE[01]\./.test(code)) errors.push(`league code looks wrong: ${code.slice(0, 20)}`);
  await page.goto(`http://localhost:${port}/#/new`);
  await page.waitForSelector('#setup');
  await page.evaluate(() => { document.querySelector('details').open = true; });
  await page.waitForSelector('#code');
  await page.fill('#code', code);
  await page.click('#openCode');
  await page.waitForSelector('#season-view');
  // The store saves on a short debounce; wait for the new slot's league to land.
  await page.waitForFunction(() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); const raw = reg.active && localStorage.getItem('gridiron-eras:slot:' + reg.active); return !!(raw && JSON.parse(raw).league); }, null, { timeout: 5000 }).catch(() => errors.push('the league from the code never saved'));
  const fromCode = await page.evaluate(() => (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); const lg = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league; return lg ? { n: reg.slots.length, shared: !!lg.shared, week: lg.week } : { n: reg.slots.length }; })());
  if (fromCode.n !== 3 || !fromCode.shared || fromCode.week !== 1) errors.push(`league from code: ${JSON.stringify(fromCode)}`);

  // The snake draft is still an option and must still work.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`http://localhost:${port}/#/new`);
  await page.waitForSelector('#setup');
  await page.check('input[name="type"][value="snake"]');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#draft-view .plist .prow');
  await checkOverflow('snake draft');
  await page.click('button[data-draft]');
  await page.waitForSelector('.ticker li.me');
  await page.click('#autoAll');
  await page.waitForSelector('#start');
  await page.click('#start');
  await page.waitForSelector('#play');
  await checkOverflow('snake season');

  // Pro league: 32 teams, divisions, a 17-game slate.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`http://localhost:${port}/#/new`);
  await page.waitForSelector('#setup');
  await page.check('input[name="mode"][value="pro"]');
  await page.selectOption('select[name="franchise"]', '12');
  await page.check('input[name="draft"][value="auto"]');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.division', { timeout: 60000 });
  await checkOverflow('pro season hub');
  await shot('12-pro-season');
  const divisions = await page.$$eval('.division', (d) => d.length);
  if (divisions !== 8) errors.push(`pro hub shows ${divisions} divisions, expected 8`);
  const weekGames = await page.$$eval('#season-view .card .matchup', (m) => m.length);
  if (weekGames < 16) errors.push(`pro week lists ${weekGames} matchups, expected at least 16`);
  await page.click('#simWeek');
  await page.waitForSelector('#advance');
  await page.click('#advance');
  await page.waitForSelector('#play');
  await checkOverflow('pro week 2');
  await page.goto(`http://localhost:${port}/#/team/12`);
  await page.waitForSelector('#teamPick');
  await checkOverflow('pro team page');
  await shot('13-pro-team');
  await page.goto(`http://localhost:${port}/#/moves/trade`);
  await page.waitForSelector('#partner');
  await checkOverflow('pro moves trades');
  const partners = await page.$$eval('#partner option', (o) => o.length);
  if (partners !== 31) errors.push(`pro trade partner list has ${partners} clubs, expected 31`);
  // A finished AI game shows team totals without player lines.
  await page.goto(`http://localhost:${port}/#/box/w/1/0`);
  await page.waitForSelector('.stat-compare');
  await checkOverflow('pro box score');

  // Tablet and desktop widths must stay clean too.
  for (const [w, h, label] of [[768, 1024, 'tablet'], [1280, 900, 'desktop']]) {
    await page.setViewportSize({ width: w, height: h });
    for (const route of ['#/season', '#/team/0', '#/players', '#/moves', '#/moves/trade', '#/']) {
      await page.goto(`http://localhost:${port}/${route}`);
      await sleep(150);
      await checkOverflow(`${label} ${route}`);
    }
  }
} catch (e) {
  errors.push(`script: ${e.message}`);
  await shot('99-error').catch(() => {});
}
await browser.close();
server.kill();
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('smoke OK — no console errors, no horizontal overflow at 360/768/1280px');
