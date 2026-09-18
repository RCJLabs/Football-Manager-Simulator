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
  const weekBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('gridiron-eras:state:v1')).league.week);
  await page.click('#advance');
  await page.waitForSelector('#play');
  await page.waitForFunction((w) => JSON.parse(localStorage.getItem('gridiron-eras:state:v1')).league.week === w + 1, weekBefore, { timeout: 5000 });
  const wire = await page.evaluate(() => { const lg = JSON.parse(localStorage.getItem('gridiron-eras:state:v1')).league; return { user: lg.teams.findIndex((t) => t.isUser), week: lg.lastWaivers && lg.lastWaivers.week, results: lg.lastWaivers ? lg.lastWaivers.results : [] }; });
  if (wire.week !== weekBefore) errors.push(`the wire resolved for week ${wire.week}, expected ${weekBefore}`);
  if (!wire.results.some((r) => r.team === wire.user)) errors.push(`the user claim never resolved on advance: ${JSON.stringify(wire)}`);
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

  await page.goto(`http://localhost:${port}/#/players`);
  await page.waitForSelector('.plist .prow');
  await page.fill('#q', 'rice');
  await sleep(120);
  await checkOverflow('player pool');
  await shot('11-players');

  await page.goto(`http://localhost:${port}/#/settings`);
  await page.waitForSelector('#speed');
  await checkOverflow('settings');

  await page.goto(`http://localhost:${port}/#/season`);
  await page.reload();
  await page.waitForSelector('#advance');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gridiron-eras:state:v1')).league.week);
  console.log('persisted week:', saved);

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
