// Headless browser smoke test: boots the app, creates a league with auto-draft,
// plays part of a game in coach mode, sims a week, and checks for console errors.
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
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const shot = async (name) => page.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/${name}.png`, fullPage: false });
try {
  await page.goto(`http://localhost:${port}/#/`);
  await page.waitForSelector('.hero');
  await shot('01-home');
  await page.click('a[href="#/new"]');
  await page.waitForSelector('#setup');
  await page.check('input[name="coach"]');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.pool');
  await shot('02-draft');
  // Draft the top available player, then auto-draft the rest.
  await page.click('button[data-draft]');
  await page.waitForSelector('.ticker li.me');
  await page.click('#autoAll');
  await page.waitForSelector('#start');
  await page.click('#start');
  await page.waitForSelector('#play');
  await shot('03-season');
  await page.click('#play');
  await page.waitForSelector('.scoreboard');
  // Kickoff then several coach-mode calls.
  for (let i = 0; i < 25; i++) {
    const off = await page.$('[data-off="pass_med"]');
    const next = await page.$('#next');
    const pat = await page.$('[data-pat="xp"]');
    if (off) await off.click(); else if (pat) await pat.click(); else if (next) await next.click(); else break;
    await sleep(20);
  }
  // Resolve a pending PAT choice so the "sim to end" control is present.
  for (let i = 0; i < 3 && !(await page.$('#simEnd')); i++) {
    const pat = await page.$('[data-pat="xp"]');
    if (pat) await pat.click();
    await sleep(20);
  }
  await shot('04-game');
  await page.click('#simEnd');
  await page.waitForSelector('#finish');
  await shot('05-final');
  await page.click('a[href="#/box/live"]');
  await page.waitForSelector('.stat-compare');
  await shot('06-box');
  await page.goto(`http://localhost:${port}/#/game`);
  await page.waitForSelector('#finish');
  await page.click('#finish');
  await page.waitForSelector('#advance');
  await page.click('#advance');
  await page.waitForSelector('#play');
  await page.click('#simWeek');
  await page.waitForSelector('#advance');
  await shot('07-week2');
  await page.goto(`http://localhost:${port}/#/team/0`);
  await page.waitForSelector('.slider-row');
  await shot('08-team');
  await page.goto(`http://localhost:${port}/#/players`);
  await page.waitForSelector('.pool');
  await page.fill('#q', 'rice');
  await sleep(100);
  await shot('09-players');
  // Reload persists
  await page.goto(`http://localhost:${port}/#/season`);
  await page.reload();
  await page.waitForSelector('#advance');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gridiron-eras:state:v1')).league.week);
  console.log('persisted week:', saved);
} catch (e) {
  errors.push(`script: ${e.message}`);
  await shot('99-error').catch(() => {});
}
await browser.close();
server.kill();
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('smoke OK');
