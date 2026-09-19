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

/**
 * Everything in the nav has to be reachable: on the bar, or in the menu that
 * holds whatever does not fit. The bar is a sideways scroller, so before this
 * it could silently strand Settings off the end of a strip nothing marked as
 * scrollable.
 */
async function checkNav(where) {
  const nav = await page.evaluate(() => {
    const el = document.getElementById('nav'), more = document.getElementById('navMore'), menu = document.getElementById('navMenu');
    if (!el) return null;
    const links = [...el.querySelectorAll('a')];
    return {
      total: links.length,
      onBar: links.filter((a) => !a.hidden).length,
      inMenu: menu ? menu.querySelectorAll('a').length : 0,
      moreShown: more ? !more.hidden : false,
      overflowing: el.scrollWidth > el.clientWidth + 1,
      activeHidden: links.some((a) => a.classList.contains('active') && a.hidden),
    };
  });
  if (!nav) return;
  if (nav.overflowing) errors.push(`nav on ${where} still scrolls sideways`);
  if (nav.onBar + nav.inMenu !== nav.total) errors.push(`nav on ${where}: ${nav.total - nav.onBar - nav.inMenu} items reachable from neither bar nor menu`);
  if (nav.activeHidden) errors.push(`nav on ${where} hid the page you are on`);
  if (nav.inMenu && !nav.moreShown) errors.push(`nav on ${where} has items in the menu and no button to open it`);
}

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
  await checkNav(where);
}

try {
  await page.goto(`http://localhost:${port}/#/`);
  await page.waitForSelector('.hero');
  await checkOverflow('home');
  await shot('01-home');

  // The guide stands alone: readable from the home screen before a league exists.
  await page.click('a[href="#/guide"]');
  await page.waitForSelector('#guide-view');
  const guideText = await page.$eval('#guide-view', (e) => e.textContent);
  if (!/wrong on purpose/.test(guideText)) errors.push('the guide does not explain why prices are mispriced');
  await checkOverflow('how it is won');
  await shot('01c-guide');
  await page.goto(`http://localhost:${port}/#/`);
  await page.waitForSelector('a[href="#/new"]');

  await page.click('a[href="#/new"]');
  await page.waitForSelector('#setup');
  await page.check('input[name="type"][value="auction"]');
  // Coach mode and the injury dial live behind the fold now, so open it first.
  await page.evaluate(() => { document.querySelector('#moreOpts').open = true; });
  await page.check('input[name="coach"]');
  await page.check('input[name="injuries"][value="high"]');
  await checkOverflow('setup');
  await page.click('button[type="submit"]');

  // Auction room: nominate, bid, pass, then hand the rest to the AI.
  await page.waitForSelector('#auction-view');

  // The board: the room used to sell most of its lots in silence. It opens full
  // screen from a button rather than living in a banner.
  await page.waitForSelector('#openBoard');
  if (await page.$('#auction-view .board')) errors.push('the auction board should be behind its button, not on the page');
  await page.click('#openBoard');
  await page.waitForSelector('.board-full .board');
  const aucBoard = await page.evaluate(() => {
    const o = document.querySelector('.board-full').getBoundingClientRect();
    return {
      cols: document.querySelectorAll('.board thead th').length - 1,
      speeds: document.querySelectorAll('.speed .tab').length,
      scrolls: getComputedStyle(document.querySelector('.board-scroll')).overflow,
      fills: Math.round(o.width) >= innerWidth - 1 && Math.round(o.height) >= innerHeight - 1,
    };
  });
  if (aucBoard.cols !== 8) errors.push(`the auction board shows ${aucBoard.cols} clubs, expected 8`);
  if (aucBoard.speeds !== 4) errors.push(`the auction has ${aucBoard.speeds} speed settings, expected 4`);
  if (!/auto|scroll/.test(aucBoard.scrolls)) errors.push('the board must scroll inside itself, not push the page');
  if (!aucBoard.fills) errors.push('the board overlay does not fill the screen');
  await checkOverflow('auction with the board open');
  await page.click('#boardClose');
  await page.waitForFunction(() => !document.querySelector('.board-full'));
  // A new manager has no way to know where a budget wins games, so it is on the
  // screen where the budget is being spent.
  const guideRows = await page.$$eval('#valueGuide .value-table tbody tr', (r) => r.length);
  if (guideRows !== 11) errors.push(`the value panel lists ${guideRows} positions, expected 11`);
  const summaryText = await page.$eval('#valueGuide summary', (e) => e.textContent);
  if (!/go for less than they are worth/.test(summaryText)) errors.push('the value panel gives away no hint when closed');
  await page.evaluate(() => { document.querySelector('#valueGuide').open = true; });
  await checkOverflow('auction with the value panel open');
  await shot('02b-value');
  await page.evaluate(() => { document.querySelector('#valueGuide').open = false; });
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

  // The team page is four tabs now: the depth chart alone was 27 rows deep and
  // everything else was stacked under it in one scroll.
  await page.goto(`http://localhost:${port}/#/team/0`);
  await page.waitForSelector('.poshead');
  await checkOverflow('team page');
  await shot('10-team');
  const groups = await page.$$eval('.poshead', (h) => h.length);
  if (groups !== 11) errors.push(`the depth chart shows ${groups} position groups, expected 11`);
  const tabStrip = await page.evaluate(() => {
    const strips = [...document.querySelectorAll('#team-view .tabs')];
    const s = strips[strips.length - 1];
    const box = s.getBoundingClientRect();
    return { n: s.querySelectorAll('.tab').length, scrollW: s.scrollWidth, clientW: s.clientWidth,
      cut: [...s.querySelectorAll('.tab')].filter((a) => a.getBoundingClientRect().right > box.right + 1).map((a) => a.textContent.trim()) };
  });
  if (tabStrip.n !== 4) errors.push(`the team page shows ${tabStrip.n} section tabs, expected 4`);
  if (tabStrip.cut.length) errors.push(`section tabs do not fit at 360px: ${tabStrip.scrollW}px of tabs in a ${tabStrip.clientW}px strip, ${tabStrip.cut.join(', ')} off the end`);

  // The jump bar is the whole point of the grouping: a position in one tap. A
  // group near the bottom cannot reach the top of the viewport because there is
  // nothing below it to scroll up into, so it only has to come into view.
  await page.evaluate(() => document.querySelector('[data-jump="DL"]').click());
  await sleep(800);
  const dlTop = await page.evaluate(() => Math.round(document.querySelector('#pos-DL').getBoundingClientRect().top));
  if (dlTop < 0 || dlTop > 140) errors.push(`jumping to the defensive line left its header ${dlTop}px from the top of the viewport`);
  await page.evaluate(() => document.querySelector('[data-jump="K"]').click());
  await sleep(800);
  const kTop = await page.evaluate(() => Math.round(document.querySelector('#pos-K').getBoundingClientRect().top));
  if (kTop < 0 || kTop > 800) errors.push(`jumping to the kicker did not bring him on screen (${kTop}px)`);

  // Reordering used to throw you back to the top of a page four screens long.
  await page.evaluate(() => document.querySelector('[data-jump="OL"]').click());
  await sleep(700);
  const yBefore = await page.evaluate(() => Math.round(window.scrollY));
  const mover = await page.$('[data-move="OL3"][data-dir="1"]');
  if (!mover) errors.push('no reorder control on OL3');
  else {
    await mover.click();
    await sleep(400);
    const yAfter = await page.evaluate(() => Math.round(window.scrollY));
    if (Math.abs(yAfter - yBefore) > 40) errors.push(`reordering scrolled the page from ${yBefore}px to ${yAfter}px`);
  }

  for (const tab of ['squad', 'injuries', 'strategy']) {
    await page.goto(`http://localhost:${port}/#/team/0/${tab}`);
    await sleep(250);
    await checkOverflow(`team page · ${tab}`);
  }
  await page.waitForSelector('.slider-row');

  // The pass/run read: the one dial measured to decide games, and the only one
  // the player had no way to set correctly for the squad they drafted.
  const readText = await page.$eval('#team-view', (e) => e.textContent);
  if (!/What you built/.test(readText)) errors.push('no strategy read on your own club');
  if (!/Suits this squad/.test(readText)) errors.push('the read does not say what the squad suits');
  const fitBtn = await page.$('#useFit');
  if (fitBtn) {
    const was = await page.$eval('[data-strat="passRate"]', (e) => Number(e.value));
    await fitBtn.click();
    await sleep(400);
    const now = await page.$eval('[data-strat="passRate"]', (e) => Number(e.value));
    if (now === was) errors.push(`"Set it there" did not move the pass rate off ${was}`);
    if (now < 0.35 || now > 0.7) errors.push(`the read set the pass rate to ${now}, outside the slider`);
    if (await page.$('#useFit')) errors.push('the read still offers to move a dial that is already where it wants it');
  }
  await shot('10c-strategy');
  // A rival's strategy tab must not coach you through their squad.
  await page.goto(`http://localhost:${port}/#/team/1/strategy`);
  await page.waitForSelector('.slider-row');
  if (/What you built/.test(await page.$eval('#team-view', (e) => e.textContent))) {
    errors.push('a rival club shows the strategy read');
  }
  await page.goto(`http://localhost:${port}/#/team/0/depth`);
  await page.waitForSelector('.poshead');
  await page.goto(`http://localhost:${port}/#/team/0/depth`);
  await page.waitForSelector('#density');

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
  await page.goto(`http://localhost:${port}/#/team/${irTarget.u}/depth`);
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

  // Simulating ahead: jump to the playoffs in one press.
  await page.goto(`http://localhost:${port}/#/season`);
  await page.waitForSelector('[data-sim="playoffs"]');
  await checkOverflow('simulate ahead');
  await shot('09z-simahead');
  await page.click('[data-sim="playoffs"]');
  const inPlayoffs = await page.waitForFunction(() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); const lg = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league; return lg.phase === 'playoffs' || lg.phase === 'complete'; }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!inPlayoffs) errors.push('simulating to the playoffs did not get there');
  await checkOverflow('after simulating to the playoffs');

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

  // The season card: copy it, then compare it against itself to prove the loop closes.
  await page.goto(`http://localhost:${port}/#/awards/card`);
  await page.waitForSelector('#copyCard');
  await checkOverflow('season card');
  await shot('09e3-card');
  await page.click('#copyCard');
  await page.waitForSelector('#cardOut:not([hidden])');
  const cardCode = await page.$eval('#cardOut', (t) => t.value);
  if (!/^GR[01]\./.test(cardCode)) errors.push(`season card code looks wrong: ${cardCode.slice(0, 16)}`);
  await page.fill('#theirCard', cardCode);
  await page.click('#compare');
  await page.waitForSelector('#awards-view table');
  const verdict = await page.$eval('#awards-view', (e) => e.textContent);
  if (!/Dead heat/.test(verdict)) errors.push('comparing a card with itself did not read as a dead heat');
  await checkOverflow('season card comparison');
  await shot('09e4-compare');
  // A code from a different league is refused rather than compared.
  await page.fill('#theirCard', 'GR0.bm9wZQ');
  await page.click('#compare');
  await sleep(200);
  const refused = await page.$eval('#awards-view', (e) => e.textContent);
  if (!/not a season card|damaged or incomplete|different leagues|version/.test(refused)) errors.push('a bad card code was not refused');
  await page.goto(`http://localhost:${port}/#/awards/hall`);
  await page.waitForSelector('#awards-view');
  await checkOverflow('hall of fame');
  await page.goto(`http://localhost:${port}/#/season`);
  await page.waitForSelector('.champ');
  await page.click('a[href="#/offseason"]');
  await page.waitForSelector('#offseason-view');
  await checkOverflow('offseason');
  await shot('09f-offseason');
  const intake = await page.$eval('#offseason-view', (e) => e.textContent);
  if (!/rookies entered the pool/.test(intake)) errors.push('the offseason did not announce a rookie class');
  // The store saves on a debounce, so read the slot only once the class has landed in it.
  const readRookies = () => page.evaluate(() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || 'null'); if (!reg) return 0; const slot = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active) || 'null'); return slot?.league?.rookies?.length || 0; });
  await page.waitForFunction(() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || 'null'); if (!reg) return false; const slot = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active) || 'null'); return (slot?.league?.rookies?.length || 0) >= 16; }, { timeout: 4000 }).catch(() => {});
  const rookieCount = await readRookies();
  if (rookieCount < 16) errors.push(`only ${rookieCount} rookies were generated`);
  // Rookies sit around the middle of the pool, so find them by their RK team code rather
  // than expecting one in the top 120 by overall.
  await page.goto(`http://localhost:${port}/#/players`);
  await page.waitForSelector('.plist .prow');
  await page.fill('#q', 'RK');
  await page.waitForFunction(() => document.querySelectorAll('.plist .prow').length > 0 && !!document.querySelector('.badge.rookie'), { timeout: 4000 }).catch(() => {});
  const badged = await page.$$eval('.badge.rookie', (b) => b.length);
  if (badged === 0) errors.push('no rookie badge appears in the player pool');
  await checkOverflow('player pool with rookies');
  await shot('11c-rookies');
  // A year passed: the offseason reports who aged, and careers are running.
  await page.goto(`http://localhost:${port}/#/offseason`);
  await page.waitForSelector('#offseason-view');
  const yearOlder = await page.$eval('#offseason-view', (e) => e.textContent);
  if (!/A year older/.test(yearOlder)) errors.push('the offseason did not report the ageing');
  await page.waitForFunction(() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || 'null'); if (!reg) return false; const slot = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active) || 'null'); return Object.keys(slot?.league?.dev || {}).length > 20; }, { timeout: 4000 }).catch(() => {});
  const careers = await page.evaluate(() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1') || 'null'); if (!reg) return 0; const slot = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active) || 'null'); return Object.keys(slot?.league?.dev || {}).length; });
  if (careers < 20) errors.push(`only ${careers} careers started after a season`);
  // Rookies are fogged in the pool: a band, not a number, until they have played.
  await page.goto(`http://localhost:${port}/#/players`);
  await page.waitForSelector('.plist .prow');
  await page.fill('#q', 'RK');
  await page.waitForFunction(() => !!document.querySelector('.badge.rookie'), { timeout: 4000 }).catch(() => {});
  const bands = await page.$$eval('.ovr.range', (e) => e.map((x) => x.textContent.trim()));
  if (!bands.length) errors.push('no scouting band on any unplayed rookie');
  else if (!bands.some((b) => /^\d{2}[–-]\d{2}$/.test(b))) errors.push(`a scouting band did not read as a range: ${bands[0]}`);
  const exactRookie = await page.$$eval('.plist .prow', (rows) => rows.filter((r) => r.querySelector('.badge.rookie') && r.querySelector('.ovr:not(.range)')).length);
  if (exactRookie) errors.push(`${exactRookie} unplayed rookies showed an exact rating`);
  await checkOverflow('player pool with scouting bands');
  await shot('11e-scouting');

  // Chemistry is on the team screen with its inputs, not hidden in the engine.
  // It lives on the Squad tab now. Reached by its address rather than by the nav
  // link, which at 360px may be in the overflow menu — the nav itself is checked
  // by `checkNav` on every screen.
  const teamHref = await page.$eval('#nav a[href^="#/team/"], #navMenu a[href^="#/team/"]', (a) => a.getAttribute('href'));
  await page.goto(`http://localhost:${port}/${teamHref}`);
  await page.waitForSelector('#team-view');
  await page.click('#team-view .tab[href$="/squad"]');
  await page.waitForFunction(() => /Era spread|Chemistry is switched off/.test(document.querySelector('#team-view').textContent), { timeout: 5000 });
  const teamText = await page.$eval('#team-view', (e) => e.textContent);
  if (!/Chemistry/.test(teamText)) errors.push('no chemistry card on the team screen');
  if (!/Era spread/.test(teamText)) errors.push('the chemistry card does not show what it is made of');
  await checkOverflow('team screen with chemistry');
  await shot('11d-chemistry');
  await page.goto(`http://localhost:${port}/#/offseason`);
  await page.waitForSelector('#offseason-view');
  await page.waitForSelector('button[data-keep]');
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
  await page.evaluate(() => { document.querySelector('#codeBlock').open = true; });
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
  // The draft room: picks land one at a time onto a board, rather than the
  // other clubs' selections being applied in one silent burst.
  await page.waitForSelector('#openBoard');
  await checkOverflow('snake draft');
  await page.click('#openBoard');
  await page.waitForSelector('.board-full .board');
  const board = await page.evaluate(() => ({
    cols: document.querySelectorAll('.board thead th').length - 1,
    speeds: document.querySelectorAll('.speed .tab').length,
    scrolls: getComputedStyle(document.querySelector('.board-scroll')).overflow,
    onClock: !!document.querySelector('.board .bc.clock, .draft-head.mine'),
    // Columns follow the draft order, so the picks made so far run left to
    // right with nothing skipped. By team index instead they scatter.
    row1: [...document.querySelectorAll('.board tbody tr')[0].querySelectorAll('.bc')]
      .map((c) => (c.classList.contains('empty') ? '.' : '#')).join(''),
  }));
  if (/#\.+#/.test(board.row1)) errors.push(`round one has gaps in it, so the columns are out of draft order: ${board.row1}`);
  await checkOverflow('draft board open');
  if (board.cols !== 8) errors.push(`the draft board shows ${board.cols} clubs, expected 8`);
  if (board.speeds !== 4) errors.push(`the draft has ${board.speeds} speed settings, expected 4`);
  if (!/auto|scroll/.test(board.scrolls)) errors.push('the board must scroll inside itself, not push the page');
  if (!board.onClock) errors.push('nothing on the board says who is on the clock');

  // Picks have to keep arriving without the player doing anything — unless the
  // player happens to hold the first pick, in which case the room is correctly
  // waiting on them and there is nothing to watch yet.
  const waitingOnMe = await page.evaluate(() => !!document.querySelector('.draft-head.mine'));
  if (!waitingOnMe) {
    const before = await page.$$eval('.board .bc:not(.empty)', (n) => n.length);
    await page.waitForFunction((n) => document.querySelectorAll('.board .bc:not(.empty)').length > n, before, { timeout: 8000 })
      .catch(() => errors.push('no pick landed on the board on its own'));
  }
  await shot('02-draft');
  await page.click('#boardClose');
  await page.waitForFunction(() => !document.querySelector('.board-full'));

  // Skip the queue, then take somebody and check he lands on the board.
  const skip = await page.$('#skip');
  if (skip) await skip.click();
  await page.waitForSelector('#draft-view .plist .prow', { timeout: 8000 });
  const mine = await page.evaluate(() => !!document.querySelector('.draft-head.mine'));
  if (!mine) errors.push('skipping to my pick did not put me on the clock');
  const wanted = await page.$eval('button[data-draft]', (b) => b.dataset.draft);
  await page.click('button[data-draft]');
  await sleep(300);
  await page.click('#openBoard');
  await page.waitForSelector('.board-full .board');
  const onBoard = await page.evaluate(
    (id) => [...document.querySelectorAll('.board .bc')].some((c) => c.dataset.show === id), wanted,
  );
  if (!onBoard) errors.push('the pick did not appear on the board');
  await page.click('#boardClose');
  await page.waitForFunction(() => !document.querySelector('.board-full'));

  await page.click('#autoAll');
  await page.waitForSelector('#start');
  await page.click('#openBoard');
  await page.waitForSelector('.board-full .board');
  const rounds = await page.$$eval('.board tbody tr', (r) => r.length);
  if (rounds !== 27) errors.push(`the finished board has ${rounds} rounds, expected 27`);
  await checkOverflow('the finished board');
  await shot('02b-board-done');
  await page.click('#boardClose');
  await page.waitForFunction(() => !document.querySelector('.board-full'));
  await page.click('#start');
  await page.waitForSelector('#play');
  await checkOverflow('snake season');

  // Pro league: 32 teams, divisions, a 17-game slate.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`http://localhost:${port}/#/new`);
  await page.waitForSelector('#setup');
  await page.check('input[name="mode"][value="pro"]');
  // The fantasy-only options must actually disappear, not just be marked hidden.
  const fantasyShown = await page.$eval('#fantasyOpts', (e) => e.getBoundingClientRect().height > 0);
  if (fantasyShown) errors.push('pro mode still shows the fantasy team-count options');
  const proShown = await page.$eval('#proOpts', (e) => e.getBoundingClientRect().height > 0);
  if (!proShown) errors.push('pro mode does not show the franchise picker');
  await checkOverflow('setup in pro mode');
  await shot('01b-setup-pro');
  const levels = await page.$$eval('select[name="difficulty"] option', (o) => o.map((x) => x.value));
  if (levels.length !== 4) errors.push(`setup offers ${levels.length} difficulty levels, expected 4`);
  if (levels[1] !== 'standard') errors.push(`difficulty defaults look wrong: ${levels.join(',')}`);
  // The advanced options start folded away: a first league should be a handful
  // of decisions, not a fourteen-item form.
  const foldOpen = await page.$eval('#moreOpts', (e) => e.open);
  if (foldOpen) errors.push('the advanced options are not folded away by default');
  const foldedInputs = await page.$$eval('#moreOpts input, #moreOpts select', (e) => e.length);
  if (foldedInputs < 8) errors.push(`only ${foldedInputs} inputs are behind the fold, expected the advanced set`);
  // How far a first-time player has to scroll before they can start. Measured in
  // screens at phone height, because a form nobody reaches the bottom of is a
  // form nobody finishes.
  // Every field on this form has a working default, so the primary action has
  // to be reachable without reading the whole thing. It used to sit 1.6 screens
  // down; it is pinned to the bottom of the viewport now.
  const reach = await page.evaluate(() => {
    const b = document.querySelector('button[type="submit"]');
    const r = b.getBoundingClientRect();
    return { down: (r.top + window.scrollY) / window.innerHeight, onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  console.log(`setup: Create league sits ${reach.down.toFixed(1)} screens down`);
  if (!reach.onScreen) errors.push('the Create league button is not on screen without scrolling');
  if (reach > 2.6) errors.push(`setup makes you scroll ${reach.toFixed(1)} screens to reach Create league`);
  await page.evaluate(() => { document.querySelector('#moreOpts').open = true; });
  // Coaching jobs are a pro-league option and appear only in pro mode.
  const jobsShown = await page.$eval('#jobsOpt', (e) => e.getBoundingClientRect().height > 0);
  if (!jobsShown) errors.push('pro mode does not offer coaching jobs');
  await checkOverflow('setup with the options open');
  await page.evaluate(() => { document.querySelector('#moreOpts').open = false; });
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
  // The pro league has an owner, a bar to clear, and a league of rival coaches.
  const ownerText = await page.$eval('#season-view', (e) => e.textContent);
  if (!/The owner/.test(ownerText)) errors.push('no owner card on a pro season hub');
  if (!/Squad ranked/.test(ownerText)) errors.push('the owner card does not say what the bar is set against');
  await page.click('a[href="#/career"]');
  await page.waitForSelector('#career-view');
  const careerText = await page.$eval('#career-view', (e) => e.textContent);
  if (!/Coaches around the league/.test(careerText)) errors.push('the career screen does not list rival coaches');
  const rivalRows = await page.$$eval('#career-view tbody tr', (r) => r.length);
  if (rivalRows < 20) errors.push(`career screen listed only ${rivalRows} coach rows, expected a league of them`);
  await checkOverflow('coaching career');
  await shot('13a-career');
  await page.goto(`http://localhost:${port}/#/season`);
  await page.waitForSelector('#season-view');
  await page.click('#simWeek');
  await page.waitForSelector('#advance');
  await page.click('#advance');
  await page.waitForSelector('#play');
  // What you act on comes before what you read. A 32-club league renders 16
  // matchups, and when those sat first every decision on this screen was below
  // the fold on a phone — the grid collapses to one column under 820px, so DOM
  // order is reading order.
  const cardOrder = await page.$$eval('#season-view .card h3, #season-view details.card summary', (els) => els.map((e) => e.textContent.trim().split('·')[0].trim()));
  const at = (re) => cardOrder.findIndex((t) => re.test(t));
  // The first purely-referential card: the week's full slate, or the table.
  const reference = [/^Week \d+ games/, /Conference$/, /^Standings/, /^Power rankings/]
    .map(at).filter((i) => i !== -1).sort((a, b) => a - b)[0];
  for (const [label, re] of [['Roster moves', /^Roster moves/], ['Injuries', /^Injuries/], ['Around the league', /^Around the league/]]) {
    const i = at(re);
    if (i === -1 || reference == null) continue;
    if (i > reference) errors.push(`"${label}" sits below the reference cards on the season hub: ${cardOrder.join(' | ')}`);
  }
  const pulseItems = await page.$$eval('#season-view ul.pulse li', (l) => l.map((x) => x.textContent.trim()));
  if (!pulseItems.length) errors.push('no league pulse after a played week');
  const sentinel = pulseItems.find((t) => /99 week/.test(t));
  if (sentinel) errors.push(`the pulse printed the season-ending sentinel: ${sentinel}`);
  await checkOverflow('pro week 2');
  await shot('12b-pulse');
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

  // A browser that has stopped accepting saves has to say so, on whatever screen
  // the player is on, and the band must not push the page sideways on a phone.
  await page.goto(`http://localhost:${port}/#/season`);
  await page.waitForSelector('#nav a');
  if (!(await page.$eval('#savewarn', (el) => el.hidden))) errors.push('the save warning is showing when saving works');
  await page.evaluate(() => {
    const real = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => {
      if (k.startsWith('gridiron-eras:slot:')) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      return real(k, v);
    };
  });
  // The band appears on the first save that is actually refused, so make a real
  // change: toggling a setting goes through the same store as any other move.
  await page.goto(`http://localhost:${port}/#/settings`);
  await page.waitForSelector('#penalties');
  await page.click('#penalties');
  await sleep(700);
  const warned = await page.$eval('#savewarn', (el) => !el.hidden && el.textContent.includes('not being saved'));
  if (!warned) errors.push('a browser that refuses saves did not warn the player');
  await checkOverflow('save warning at 360px');
  await shot('14-savewarn');

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
