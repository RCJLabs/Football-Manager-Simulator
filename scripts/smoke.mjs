// Headless browser smoke test at phone width: boots the app, creates a league
// with auto-draft, plays part of a game in coach mode, sims a week, and checks
// every screen for console errors and horizontal overflow.
// Usage: NODE_PATH=<global node_modules> node scripts/smoke.mjs  (needs playwright and http-server resolvable)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const require = createRequire(import.meta.url);
// Resolved from this file, never written down: a copy of this script running in
// another checkout must smoke-test THAT tree's engine, not this one's.
const R = new URL('..', import.meta.url).href.replace(/\/$/, '');
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
    const tabs = document.getElementById('tabbar');
    if (!el) return null;
    const phone = tabs && getComputedStyle(tabs).display !== 'none';
    const links = [...el.querySelectorAll('a')];
    const tabItems = tabs ? [...tabs.querySelectorAll('.tabitem')] : [];
    return {
      phone,
      bothShown: phone && getComputedStyle(el).display !== 'none',
      total: links.length,
      tabCount: tabItems.length,
      tabsLit: tabItems.filter((a) => a.classList.contains('active')).length,
      hasMore: !!document.getElementById('tabMore'),
      // Desktop only: the top strip and its overflow menu.
      onBar: links.filter((a) => !a.hidden).length,
      inMenu: menu ? menu.querySelectorAll('a').length : 0,
      moreShown: more ? !more.hidden : false,
      overflowing: el.scrollWidth > el.clientWidth + 1,
      activeHidden: links.some((a) => a.classList.contains('active') && a.hidden),
    };
  });
  if (!nav) return;
  if (nav.phone) {
    // A phone navigates from the bottom bar: five destinations, one of them lit.
    if (nav.bothShown) errors.push(`nav on ${where}: both the top strip and the tab bar are showing`);
    if (nav.tabCount < 2 || nav.tabCount > 5) errors.push(`nav on ${where}: ${nav.tabCount} tabs, expected 2 to 5`);
    if (nav.tabsLit !== 1) errors.push(`nav on ${where}: ${nav.tabsLit} tabs lit, expected exactly 1`);
    if (nav.total > nav.tabCount && !nav.hasMore) errors.push(`nav on ${where}: ${nav.total} destinations, ${nav.tabCount} tabs and no More`);
    return;
  }
  if (nav.overflowing) errors.push(`nav on ${where} still scrolls sideways`);
  if (nav.onBar + nav.inMenu !== nav.total) errors.push(`nav on ${where}: ${nav.total - nav.onBar - nav.inMenu} items reachable from neither bar nor menu`);
  if (nav.activeHidden) errors.push(`nav on ${where} hid the page you are on`);
  if (nav.inMenu && !nav.moreShown) errors.push(`nav on ${where} has items in the menu and no button to open it`);
}

/** Fails if the page scrolls sideways, and names the widest offending element. */
/**
 * The accessibility floor, asserted on every screen the run visits.
 *
 * Three things, each of which had actually gone wrong rather than being
 * theoretical: a control nobody can name, two elements sharing an id, and a
 * live region that is not there to speak. The id check earns its place — adding
 * a skip link as `#skip` quietly stole the id the draft screen uses for Skip to
 * my pick, and the first thing that noticed was a click timing out.
 */
async function checkA11y(where) {
  const bad = await page.evaluate(() => {
    const out = { unnamed: [], dupes: [], live: null, current: [] };
    const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title')
      || (el.getAttribute('aria-labelledby') ? 'labelledby' : '') || el.textContent || '').trim();
    for (const el of document.querySelectorAll('button, a[href]')) {
      if (el.offsetParent === null && el.id !== 'skipnav') continue;   // not rendered, cannot be reached
      if (!name(el)) out.unnamed.push(`${el.tagName.toLowerCase()}#${el.id || ''}.${(el.className || '').toString().split(' ')[0]}`);
    }
    const seen = new Set();
    for (const el of document.querySelectorAll('[id]')) {
      if (seen.has(el.id)) out.dupes.push(el.id); else seen.add(el.id);
    }
    const live = document.getElementById('srlive');
    out.live = live && !live.hidden && live.getAttribute('aria-live') === 'polite';
    // Where you are has to be announced, not just highlighted. Exactly one
    // destination per navigation region may claim it.
    for (const [region, sel] of [['nav', '#nav a'], ['tabbar', '#tabbar .tabitem']]) {
      const links = [...document.querySelectorAll(sel)].filter((a) => a.offsetParent !== null);
      if (!links.length) continue;
      const lit = links.filter((a) => a.classList.contains('active'));
      const said = links.filter((a) => a.getAttribute('aria-current') === 'page');
      if (lit.length !== said.length) out.current.push(`${region}: ${lit.length} highlighted, ${said.length} announced`);
      if (said.length > 1) out.current.push(`${region}: ${said.length} claim to be the current page`);
    }
    return out;
  });
  if (bad.unnamed.length) errors.push(`a11y ${where}: ${bad.unnamed.length} control(s) with no accessible name: ${bad.unnamed.slice(0, 4).join(', ')}`);
  if (bad.dupes.length) errors.push(`a11y ${where}: duplicate id(s): ${[...new Set(bad.dupes)].slice(0, 4).join(', ')}`);
  if (!bad.live) errors.push(`a11y ${where}: the live region is missing or muted`);
  if (bad.current.length) errors.push(`a11y ${where}: ${bad.current.join('; ')}`);
}

/**
 * Colour contrast, measured on what is actually rendered.
 *
 * The token table is not the check. Reading the palette off `:root` says which
 * pairs are POSSIBLE; what matters is which pairs appear, on which background,
 * at what size — a foreground that fails on the pitch green is fine if nothing
 * is ever drawn there. So this walks every element that holds visible text,
 * resolves the background by climbing until it finds something opaque, and
 * applies the threshold WCAG gives for that text's size: 3:1 for large (24px,
 * or 18.66px bold), 4.5:1 for everything else.
 *
 * It found one thing on its first run and it was a real one: the overall badge
 * worn by every player rated 90 to 94 was white on #3a9d5a at 3.41:1.
 */
async function checkContrast(where) {
  const bad = await page.evaluate(() => {
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const parse = (s) => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x)); return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; };
    const blend = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
    // Composite the WHOLE ancestor chain, not just the first translucent layer.
    // Blending one layer against an assumed page colour reported backgrounds
    // that no rule in the stylesheet produced, which sent the first search for
    // the offending element off after a colour that was never on screen.
    const bgOf = (el) => {
      const layers = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.004) { layers.push({ ...c, who: n }); if (c.a >= 0.999) break; }
      }
      let out = [15, 26, 18], src = null;
      for (let i = layers.length - 1; i >= 0; i--) {
        out = layers[i].a >= 0.999 ? layers[i].rgb : blend(layers[i].rgb, out, layers[i].a);
        src = src || layers[i].who;
      }
      const top = layers[0] ? layers[0].who : null;
      return { rgb: out, from: top ? `${top.tagName.toLowerCase()}.${(top.className || '').toString().split(' ').slice(0, 2).join('.')}` : 'page' };
    };
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent.trim()).join(' ');
      if (!txt) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const fgc = parse(cs.color);
      if (!fgc || fgc.a < 0.1) continue;
      const { rgb: bg, from } = bgOf(el);
      const fg = fgc.a >= 0.999 ? fgc.rgb : blend(fgc.rgb, bg, fgc.a);
      const l1 = lum(fg), l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
      const need = (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5;
      if (ratio < need - 0.01) {
        out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0, 2).join('.')}`
          + ` ${ratio.toFixed(2)}:1 (needs ${need}) ${cs.color} on rgb(${bg.map(Math.round).join(',')})`
          + ` from ${from} "${txt.slice(0, 20)}"`);
      }
    }
    return [...new Set(out)];
  });
  if (bad.length) errors.push(`contrast on ${where}: ${bad.length} combination(s) below WCAG AA — ${bad.slice(0, 3).join(' | ')}`);
}

/**
 * Can the room be played with a keyboard?
 *
 * The auction is the one screen where a decision is on a clock, and it is the
 * one screen nobody had ever driven without a mouse. This presses Tab for real
 * rather than calling `.focus()`: `:focus-visible` matches on keyboard
 * interaction, so a programmatic focus does not raise the ring and a check
 * built on one reports every control in the room as unfocusable. That first
 * version accused four innocent controls before the stylesheet was read.
 *
 * What it asserts: tabbing reaches the controls a bid actually needs, and
 * whatever holds focus is visibly focused.
 */
async function checkKeyboard(where, mustReach = []) {
  await page.evaluate(() => { document.body.setAttribute('tabindex', '-1'); document.body.focus(); });
  const seen = [];
  const noRing = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
        || (cs.boxShadow && cs.boxShadow !== 'none');
      const id = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`;
      return { id, ring, tag: el.tagName.toLowerCase() };
    });
    if (!at) break;
    if (seen.includes(at.id) && seen.length > 3) break;   // wrapped round
    seen.push(at.id);
    if (!at.ring) noRing.push(at.id);
  }
  await page.evaluate(() => document.body.removeAttribute('tabindex'));
  const reached = async (sel) => page.evaluate((q) => {
    const el = document.querySelector(q);
    return !!el && el.offsetParent !== null && el.tabIndex >= 0 && !el.hasAttribute('disabled');
  }, sel);
  const missing = [];
  for (const sel of mustReach) if (!(await reached(sel))) missing.push(sel);
  if (!seen.length) errors.push(`keyboard ${where}: tabbing reached nothing at all`);
  if (noRing.length) errors.push(`keyboard ${where}: no visible focus on ${[...new Set(noRing)].slice(0, 4).join(', ')}`);
  if (missing.length) errors.push(`keyboard ${where}: cannot reach ${missing.join(', ')}`);
}

/**
 * Does the room actually say anything?
 *
 * `checkA11y` asserts the live region exists and is not muted — and a region
 * nobody ever writes to passes that perfectly. Which is exactly how the auction
 * came through a whole session of accessibility work running its entire length
 * in silence: a screen reader was told who won each lot, after the fact, and
 * never once told who was on the block or that it was your turn to nominate.
 *
 * So this watches what actually lands in the region, and checks it against the
 * player the screen says is up. Matching on the name rather than the sentence
 * keeps it a test of whether you are told, not of how it is worded.
 */
async function listenLive() {
  await page.evaluate(() => {
    window.__said = [];
    const live = document.getElementById('srlive');
    if (!live) return;
    new MutationObserver(() => {
      const t = (live.textContent || '').replace(/\u200b/g, '').trim();
      if (t && window.__said[window.__said.length - 1] !== t) window.__said.push(t);
    }).observe(live, { childList: true, characterData: true, subtree: true });
  });
}
const heard = () => page.evaluate(() => window.__said || []);

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
  await checkA11y(where);
  await checkContrast(where);
}

try {
  await page.goto(`http://localhost:${port}/#/`);
  await page.waitForSelector('.hero');
  await checkOverflow('home');
  await shot('01-home');
  // Fantasy is the default and hides the pro league's systems entirely, so the
  // first screen is where a player learns there is another kind of league.
  const tiles = await page.$eval('.features', (e) => e.textContent);
  if (!/Fantasy or pro league/.test(tiles) || !/salary cap/.test(tiles)) errors.push('the first screen does not say what a pro league has');

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
  // A league never changes kind, so the choice is where it is said what each has.
  const kinds = await page.$$eval('.mode-choice', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ')));
  if (!/salary cap/.test(kinds[1] || '') || !/position changes/.test(kinds[1] || '')) errors.push(`the pro choice does not say what it adds: ${kinds[1]}`);
  await page.check('input[name="mode"][value="pro"]');
  const proFold = await page.$eval('#moreList', (e) => e.textContent);
  // Uneven cap room is a fantasy auction's alone: a pro league has one cap, and
  // the first kickoff cut back whatever a richer club had spent past it.
  await page.check('input[name="type"][value="auction"]');
  const proRoom = await page.$eval('#spreadRow', (e) => e.hidden);
  await page.check('input[name="mode"][value="fantasy"]');
  const fanFold = await page.$eval('#moreList', (e) => e.textContent);
  const fanRoom = await page.$eval('#spreadRow', (e) => e.hidden);
  if (!proRoom || fanRoom) errors.push(`cap room: ${proRoom ? 'hidden' : 'shown'} for a pro auction, ${fanRoom ? 'hidden' : 'shown'} for a fantasy one`);
  if (!/position changes/.test(proFold) || /position changes/.test(fanFold) || !/keepers/.test(fanFold)) errors.push(`the options fold lists "${fanFold}" for fantasy and "${proFold}" for pro`);
  await page.check('input[name="type"][value="auction"]');
  // Coach mode and the injury dial live behind the fold now, so open it first.
  await page.evaluate(() => { document.querySelector('#moreOpts').open = true; });
  await page.check('input[name="coach"]');
  await page.check('input[name="injuries"][value="high"]');
  await checkOverflow('setup');
  await page.click('button[type="submit"]');

  // Auction room: nominate, bid, pass, then hand the rest to the AI.
  await page.waitForSelector('#auction-view');
  await listenLive();

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
  let kbChecked = { nominate: false, bid: false };
  const blocked = [];   // who the screen said was up for auction
  for (let i = 0; i < 24; i++) {
    const nom = await page.$('button[data-nom]');
    if (nom) {
      if (!kbChecked.nominate) { await checkKeyboard('auction, nominating', ['button[data-nom]']); kbChecked.nominate = true; }
      await nom.click(); await sleep(30); await checkOverflow('auction bidding'); continue;
    }
    let bid = await page.$('#bid');
    if (!bid && !nom) {
      // The room needs a moment to call the next lot. Breaking the instant a
      // control is missing ended the walk after a single lot, which left every
      // check below with one sample and nothing to fail on.
      await page.waitForSelector('#bid, button[data-nom]', { timeout: 1500 }).catch(() => {});
      bid = await page.$('#bid');
      if (!bid && !(await page.$('button[data-nom]'))) break;
      if (!bid) continue;
    }
    if (bid) {
      // The three controls a bid actually needs: raise, commit, and get out.
      if (!kbChecked.bid) { await checkKeyboard('auction, a lot on the block', ['#bid', '#pass']); kbChecked.bid = true; }
      const up = await page.evaluate(() => {
        const el = document.querySelector('#auction-view .card.stack div[style*="font-weight:800"]');
        return el ? el.textContent.replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ') : null;
      });
      // Read the transcript AS THE LOT STANDS, not at the end. The sale is
      // announced too and names the same player, so asking whether his name was
      // ever said is a question that answers itself once the lot is over.
      if (up) blocked.push({ up, saidByThen: await heard() });
      // Alternate between bidding the slider value and passing.
      if (bought % 2 === 0) { await bid.click(); bought++; } else { await page.click('#pass'); bought++; }
      await sleep(30);
      continue;
    }
    break;
  }
  await shot('03-auction-bid');
  {
    const said = await heard();
    if (!said.length) errors.push('auction: the room ran its whole length without saying anything to a screen reader');
    if (blocked.length < 3) errors.push(`auction: only ${blocked.length} lot(s) reached a bid — the room was not exercised enough to check what it says`);
    const mute = blocked.filter(({ up, saidByThen }) => !saidByThen.some((line) => line.includes(up)));
    if (mute.length) {
      errors.push(`auction: ${mute.length} of ${blocked.length} lot(s) went up without being announced — a bidder is not told who he is bidding on until after it sells (${mute.map((m) => m.up).slice(0, 3).join(', ')})`);
    }
    // The purse is worth saying when it moves, and grating on every lot.
    const purses = said.filter((l) => /You have \$\d+ and \d+ slots?/.test(l)).length;
    if (purses > Math.max(2, Math.ceil(blocked.length / 3))) {
      errors.push(`auction: what you have left was read out ${purses} times over ${blocked.length} lots — it should be said when it moves, not every lot`);
    }
  }
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
  // `Sim to end` moved behind a disclosure on the watching controls — three
  // buttons you want occasionally and never by accident. It still stands on its
  // own in the coach-mode panels, so advance until the other club has the ball,
  // which is when the watching controls are up, and open it as a player would.
  for (let i = 0; i < 60 && !(await page.$('.skipahead')); i++) {
    const pat = await page.$('[data-pat="xp"]');
    const off = await page.$('[data-off="pass_med"]');
    const def = await page.$('[data-def="ai"]');
    if (pat) await pat.click(); else if (off) await off.click(); else if (def) await def.click(); else break;
    await sleep(20);
  }
  await page.click('.skipahead > summary');
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
  // Like-for-like, and found rather than assumed. The give list is ordered by
  // what each man costs to replace, so its first row is whoever the club can
  // most easily spare — offering him for the other club's best quarterback is
  // a deal the engine rightly refuses. Match the positions instead.
  const paired = await page.evaluate(() => {
    const posOf = (el) => el.closest('li')?.querySelector('.badge.pos')?.textContent.trim();
    for (const get of document.querySelectorAll('[data-get]')) {
      const pos = posOf(get);
      const give = [...document.querySelectorAll('[data-give]')].find((g) => posOf(g) === pos);
      if (give) { give.click(); get.click(); return pos; }
    }
    return null;
  });
  if (!paired) errors.push('no like-for-like pair on the trade screen');
  await page.waitForSelector('#propose:not([disabled])');
  await checkOverflow('moves trade selected');
  await shot('09c-trade');
  await page.click('#propose');
  await page.waitForSelector('.modal');
  // A refusal names the nearest deal the club would take, or says plainly
  // that no single change gets there — never just "No deal" and a hint.
  const answer = await page.evaluate(() => {
    const m = document.querySelector('.modal');
    return { text: m.innerText, counter: !!m.querySelector('#loadCounter') };
  });
  if (/No deal/i.test(answer.text) && !/They would take it|No single change closes/i.test(answer.text)) {
    errors.push('a refused trade said neither what the club would take nor that nothing single would do');
  }
  await checkOverflow('trade answer at 360px');
  await shot('09c2-trade-answer');
  if (answer.counter) {
    // Loading it must put their answer in the builder, ready to propose.
    await page.click('#loadCounter');
    await page.waitForSelector('.modal-back', { state: 'detached' });
    const ready = await page.$('#propose:not([disabled])');
    if (!ready) errors.push('loading the counter left nothing proposable in the builder');
  } else {
    await page.click('.modal [data-close]');
    await page.waitForSelector('.modal-back', { state: 'detached' });
  }
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

  // Development focus on the Squad tab: the staff's picks until you choose,
  // taking one off keeps the other two, and a third can be named from the list.
  {
    await page.goto(`http://localhost:${port}/#/team/0/squad`);
    await sleep(300);
    const head = async () => (await page.$eval('#devCard h3', (e) => e.textContent).catch(() => '')).replace(/\s+/g, ' ');
    const h0 = await head();
    if (!/Development focus/i.test(h0)) errors.push('the Squad tab has no development focus card');
    else {
      if (!/3 of 3/.test(h0) || !/staff's picks/.test(h0)) errors.push(`the focus card opens as "${h0}", not the staff's three`);
      await page.click('#devCard [data-focus]');
      await sleep(300);
      const h1 = await head();
      if (!/2 of 3/.test(h1) || /staff's picks/.test(h1)) errors.push(`taking one off left "${h1}"`);
      if (!(await page.$('#focusReset'))) errors.push('no way back to the staff\'s picks once you have chosen');
      await page.click('#devMore summary');
      await sleep(150);
      await page.click('#devMore [data-focus]:not([disabled])');
      await sleep(300);
      const h2 = await head();
      if (!/3 of 3/.test(h2)) errors.push(`naming a man from the list left "${h2}"`);
      if (!(await page.$eval('#devMore', (e) => e.open).catch(() => false))) errors.push('the roster list snapped shut after choosing from it');
      const full = await page.$$eval('#devMore [data-focus]', (bs) => bs.every((b) => b.disabled));
      if (!full) errors.push('with three named, the list still offers a fourth');
      await checkOverflow('development focus card at 360px');
      await shot('20-focus');
    }
  }
  await page.goto(`http://localhost:${port}/#/team/0/strategy`);
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

  // The scouting report on the next opponent. It only scouts a game not yet
  // played, and only once the opponent has two games behind it, so advance to
  // an unplayed week first — at week three, played, it rightly shows nothing.
  {
    await page.click('#advance');
    await sleep(400);
    const scout = await page.evaluate(() => {
      const el = document.querySelector('.scout');
      return el ? { text: el.innerText, overflow: el.scrollWidth > el.clientWidth + 1 } : null;
    });
    if (!scout) errors.push('no scouting report on an unplayed week-four game');
    else {
      if (!/Strong:/.test(scout.text) || !/Weak:/.test(scout.text)) errors.push(`the scouting report is missing strengths or weaknesses: ${scout.text.slice(0, 120)}`);
      if (!/\d+(st|nd|rd|th) in /.test(scout.text)) errors.push('the scouting report names no league ranks');
      if (scout.overflow) errors.push('the scouting report overflows its card');
    }
    await checkOverflow('matchup card with a scouting report');
    await shot('09a-scouting');
  }

  // Simulating ahead: jump to the playoffs in one press.
  await page.goto(`http://localhost:${port}/#/season`);
  await page.waitForSelector('[data-sim="playoffs"]');
  await checkOverflow('simulate ahead');
  await shot('09z-simahead');
  await page.click('[data-sim="playoffs"]');
  const inPlayoffs = await page.waitForFunction(() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); const lg = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league; return lg.phase === 'playoffs' || lg.phase === 'complete'; }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!inPlayoffs) errors.push('simulating to the playoffs did not get there');
  await checkOverflow('after simulating to the playoffs');

  // Team statistics, both sides of the ball, with a full regular season behind
  // them. Checked here and not on the injected pro league further down: that
  // one skips its season, so it would show the empty state and prove nothing.
  {
    await page.goto(`http://localhost:${port}/#/awards/teams`);
    await sleep(500);
    const t = await page.evaluate(() => ({
      text: document.body.innerText,
      leaders: document.querySelectorAll('#awards-view .card')[1]?.querySelectorAll('tbody tr').length || 0,
      clubs: document.querySelector('#statCat') ? document.querySelector('#statCat').closest('.card').querySelectorAll('tbody tr').length : 0,
      teams: (() => { const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1')); return JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active)).league.teams.length; })(),
    }));
    if (!/League leaders/i.test(t.text)) errors.push('the team stats tab has no league leaders');
    if (!/Red-zone touchdown % allowed/i.test(t.text)) errors.push('team stats carry no red-zone defence');
    if (!/Rushing yards allowed per game/i.test(t.text)) errors.push('team stats carry no run defence');
    if (!/Third-down conversion %/i.test(t.text)) errors.push('team stats carry no third-down offence');
    if (t.leaders < 10) errors.push(`only ${t.leaders} league leaders shown`);
    if (t.clubs !== t.teams) errors.push(`the full table lists ${t.clubs} clubs of ${t.teams}`);
    if (/Team statistics start with/.test(t.text)) errors.push('team stats claim nothing has been played after a whole regular season');
    // Changing category must re-rank, not just relabel.
    const before = await page.evaluate(() => [...document.querySelector('#statCat').closest('.card').querySelectorAll('tbody tr')].map((r) => r.innerText).join('|'));
    await page.selectOption('#statCat', 'drush');
    await sleep(250);
    const after = await page.evaluate(() => ({ head: document.querySelector('#statCat').closest('.card').querySelector('thead').innerText,
      rows: [...document.querySelector('#statCat').closest('.card').querySelectorAll('tbody tr')].map((r) => r.innerText).join('|') }));
    if (!/Rushing yards allowed/i.test(after.head)) errors.push('choosing run defence did not change the column');
    if (after.rows === before) errors.push('choosing a different category left the ranking unchanged');
    // Page overflow cannot see this: a number pushed out of a table's own
    // scroll container is hidden without the page ever getting wider, which is
    // exactly how the first version shipped its leaders with no figures.
    const hidden = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll('.stat-v')]
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width === 0 || b.right > vw + 1; })
        .map((el) => `${el.closest('tr')?.cells[0]?.innerText.trim()} (right edge ${Math.round(el.getBoundingClientRect().right)} of ${vw})`);
    });
    const shown = await page.evaluate(() => document.querySelectorAll('.stat-v').length);
    if (!shown) errors.push('team stats show no figures at all');
    if (hidden.length) errors.push(`${hidden.length} of ${shown} team-stat figures sit outside the screen at 360px: ${hidden.join('; ')}`);
    await checkOverflow('team stats at 360px');
    await shot('09y-team-stats');
    // Back where the season walk below expects to be.
    await page.goto(`http://localhost:${port}/#/season`);
    await sleep(400);
  }

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
  // What a fantasy league does not have is named where its settings are, and a
  // card that is switched off says where to switch it on: an empty space reads
  // as a feature that does not exist.
  await page.goto(`http://localhost:${port}/#/settings`);
  await page.waitForSelector('#chemistry');
  const proOnly = await page.$eval('#proOnly', (e) => e.textContent).catch(() => '');
  if (!/position changes/.test(proOnly) || !/cannot change kind/.test(proOnly)) errors.push('a fantasy league\'s settings do not name what only a pro league has');
  await page.click('#chemistry');
  await page.waitForSelector('#focus');
  await page.click('#focus');
  await sleep(300);
  await page.goto(`http://localhost:${port}/#/team/0/squad`);
  await page.waitForSelector('.tabs.sections');
  const offCards = await page.$eval('#app', (e) => e.textContent.replace(/\s+/g, ' '));
  for (const what of ['Development focus', 'Chemistry']) if (!new RegExp(`${what} is switched off for this league\\. Settings turns it on`).test(offCards)) errors.push(`the squad tab does not say ${what.toLowerCase()} is switched off and where`);
  await checkOverflow('squad tab with features off');
  await page.goto(`http://localhost:${port}/#/`);
  await page.waitForSelector('[data-open]');
  await checkOverflow('home with two leagues');
  // Both saves have to be on disk before the slots are counted; a slot that has
  // not been written to yet is, correctly, still an empty one.
  await page.waitForFunction(() => document.querySelectorAll('[data-del]').length === 2, null, { timeout: 5000 }).catch(() => {});
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
  await page.reload();
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
  await page.reload();
  await page.goto(`http://localhost:${port}/#/new`);
  await page.waitForSelector('#setup');
  await page.check('input[name="mode"][value="pro"]');
  // The fantasy-only options must actually disappear, not just be marked hidden.
  const fantasyShown = await page.$eval('#fantasyOpts', (e) => e.getBoundingClientRect().height > 0);
  if (fantasyShown) errors.push('pro mode still shows the fantasy team-count options');
  const proShown = await page.$eval('#proOpts', (e) => e.getBoundingClientRect().height > 0);
  if (!proShown) errors.push('pro mode does not show the franchise picker');
  // The keeper quota is a fantasy idea. `keeperLimit` returns the whole roster
  // under a cap, so a pro league keeps whoever it can afford — the control was
  // offered here for a long time, defaulted to 18, and silently ignored.
  await page.evaluate(() => document.querySelector('#moreOpts').open = true);
  const keeperShown = await page.$eval('#keeperOpt', (e) => e.getBoundingClientRect().height > 0);
  if (keeperShown) errors.push('pro mode still offers a keeper quota it does not use');
  const noteShown = await page.$eval('#proKeeperNote', (e) => e.getBoundingClientRect().height > 0);
  if (!noteShown) errors.push('pro mode hides the keeper control without saying what decides instead');
  // Folded away again: a later check asserts this form opens with the advanced
  // options closed, and opening one to look inside it is not a reason to fail.
  await page.evaluate(() => document.querySelector('#moreOpts').open = false);
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
  // Either bar, whichever this width uses: the links are hidden by their
  // container's display, so a `[hidden]` filter does not see it.
  await page.waitForFunction(() => [...document.querySelectorAll('#tabbar .tabitem, #nav a')].some((e) => e.offsetParent !== null));
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

  // --- the pro keeper round, which nothing else here reaches --------------
  //
  // Everything above plays a FANTASY league. Pro mode is checked only as far as
  // its setup screen, so the keeper round's tag control — the price on the
  // button, the one-a-club rule, what clicking it does to the list — had no
  // cover at all in a browser.
  //
  // The league is built here in Node and injected rather than played in the
  // page. Driving 32 clubs through eighteen weeks of a pro season would be by
  // far the longest thing in this file, and it would be testing the season
  // loop, which `playthrough.mjs` already runs headlessly over whole dynasties.
  // What is uncovered is the SCREEN, so the screen is what this sets up for.
  {
    const { PLAYERS, PLAYERS_BY_ID } = await import(`${R}/src/data/db.js`);
    const { RNG } = await import(`${R}/src/engine/rng.js`);
    const { createLeague, startSeason, registerPlayers } = await import(`${R}/src/engine/season.js`);
    const { autoDraftAll } = await import(`${R}/src/engine/draft.js`);
    const { enterOffseason } = await import(`${R}/src/engine/offseason.js`);
    const { leaguePool, leagueIndex } = await import(`${R}/src/engine/rookies.js`);
    const { careerIndex } = await import(`${R}/src/engine/careers.js`);
    registerPlayers(PLAYERS_BY_ID);
    const lg = createLeague({ name: 'Smoke Pro', mode: 'pro', numTeams: 32, franchise: 3, seed: 7, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
    autoDraftAll(lg, lg.draft, PLAYERS, new RNG(7));
    startSeason(lg, PLAYERS_BY_ID);
    // The season itself is not what is being tested, and `enterOffseason` only
    // asks that one be finished. Contracts still run down and men still come
    // out of term, which is what the screen needs. The index carries ages
    // because that is what `main.js` hands the real one — without them the AI
    // never tags, and the injected league would not be the app's league.
    lg.phase = 'complete';
    // One of the user's men under contract retires this offseason, seeded
    // rather than waited for: the summary has to say what he leaves owed.
    const { startCareer } = await import(`${R}/src/engine/careers.js`);
    const { ROSTER_SLOTS } = await import(`${R}/src/data/positions.js`);
    const me = lg.teams.findIndex((t) => t.isUser);
    // Not the quarterback: the career-line check below writes a passer's career
    // onto the first man on the roster, and retiring QB1 made that a back.
    const retiree = ROSTER_SLOTS.filter((s) => s.pos !== 'QB').map((s) => lg.teams[me].slots[s.id]).filter(Boolean)
      .find((id) => (lg.contracts[id]?.years ?? 0) >= 3 && (lg.contracts[id]?.salary ?? 0) >= 4);
    if (retiree) {
      const career = startCareer(lg, PLAYERS_BY_ID.get(retiree));
      lg.dev = { ...(lg.dev || {}), [retiree]: { ...career, from: lg.season, retireAt: career.age + 1 } };
    }
    enterOffseason(lg, leaguePool(lg, PLAYERS), careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID)));

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`http://localhost:${port}/`);
    await sleep(600); // let the debounced save flush, or it writes over ours
    await page.evaluate((league) => {
      const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
      // Adopt a slot the app already made. Inventing a registry entry does not
      // work: the app rewrites one it does not recognise and lands back on the
      // new-league screen with the save sitting there unopened.
      const slot = reg.slots.find((x) => x.id === reg.active) || reg.slots[0];
      reg.active = slot.id;
      slot.name = league.name;
      slot.updated = Date.now();
      slot.summary = { phase: league.phase, season: league.season, team: 'ME', teams: league.teams.length, record: '' };
      localStorage.setItem('gridiron-eras:slots:v1', JSON.stringify(reg));
      localStorage.setItem('gridiron-eras:slot:' + slot.id, JSON.stringify({ league, savedAt: Date.now() }));
    }, JSON.parse(JSON.stringify(lg)));
    // A goto that only changes the hash does not reload, so without this the
    // app never re-reads the slot just written under it.
    await page.goto(`http://localhost:${port}/#/offseason`);
    await page.reload();
    await sleep(600);

    // The other clubs' keepers: a header for every column the rows carry. The
    // cost and room headers were a plain string in the template, so they were
    // escaped and printed their own markup as text.
    const kept = await page.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((x) => /What the other clubs kept/.test(x.textContent)); const t = h?.parentElement.querySelector('table'); return t ? { head: t.querySelectorAll('thead th').length, row: t.querySelector('tbody tr')?.querySelectorAll('td').length, raw: /<th/.test(t.textContent) } : null; });
    if (!kept || kept.head !== kept.row || kept.raw) errors.push(`the other clubs' keeper table: ${JSON.stringify(kept)}`);
    if (!retiree) errors.push('the pro smoke league gave the user nobody under contract to retire');
    else {
      const owedLine = await page.evaluate(() => document.body.textContent.match(/you owe \$\d+ a year for (one more season|\d+ more seasons)/)?.[0] || null);
      if (!owedLine) errors.push('a retirement under contract does not tell the user what is still owed');
    }
    const tagBtns = await page.$$('[data-tag]');
    if (!tagBtns.length) errors.push('the pro keeper round offers no tag on any expiring man');
    else {
      const label = await tagBtns[0].innerText();
      if (!/^Tag \$\d+$/.test(label.trim())) errors.push(`the tag button reads "${label.trim()}" rather than a price`);
      const who = await tagBtns[0].getAttribute('data-tag');
      await tagBtns[0].click();
      await sleep(250);
      const after = await page.evaluate((id) => {
        const b = document.querySelector(`[data-tag="${id}"]`);
        const keep = document.querySelector(`[data-keep="${id}"]`);
        return { label: b && b.innerText.trim(), keeping: keep && keep.innerText.trim(), others: document.querySelectorAll('[data-tag]').length };
      }, who);
      if (after.label !== 'Tagged') errors.push(`tagging a man left his button reading "${after.label}"`);
      // A tagged man has to be kept, or confirming throws on his own list.
      if (after.keeping !== 'Keeping') errors.push(`tagging did not pick the man up: his keep button reads "${after.keeping}"`);
      // One a club: every other expiring man's tag button goes away.
      if (after.others !== 1) errors.push(`${after.others} men still offer a tag after one was used; a club gets one`);
      await checkOverflow('pro keeper round with a man tagged');
      await shot('15-pro-keepers');
    }

    // A career line in the player modal, which reads `league.careers` — a table
    // that has been filled in since awards shipped and that nothing but Hall of
    // Fame membership ever read. Faked here rather than played for, because
    // twelve seasons of a 32-club league is not a smoke test.
    {
      await page.evaluate(() => {
        const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
        const key = 'gridiron-eras:slot:' + reg.active;
        const st = JSON.parse(localStorage.getItem(key));
        const u = st.league.teams.findIndex((t) => t.isUser);
        const id = Object.values(st.league.teams[u].slots).find(Boolean);
        st.league.careers = { [id]: { seasons: 12, games: 174, pts: 4200, passYds: 58211, passTd: 402,
          rushYds: 1100, rushTd: 12, recYds: 0, recTd: 0, sacks: 0, interceptions: 0, tackles: 0,
          fieldGoals: 0, mvp: 2, opoy: 0, dpoy: 0, allLeague: 5, leader: 3, titles: 1, teams: [u], last: 12 } };
        localStorage.setItem(key, JSON.stringify(st));
        window.__careerId = id;
      });
      const { u, id } = await page.evaluate(() => {
        const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
        const st = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active));
        const i = st.league.teams.findIndex((t) => t.isUser);
        return { u: i, id: Object.values(st.league.teams[i].slots).find(Boolean) };
      });
      // His own club, not club zero: the career was written onto the user's man
      // and the user is not always the first seat.
      await page.goto(`http://localhost:${port}/#/team/${u}`);
      await page.reload();
      await sleep(600);
      const opened = await page.$(`[data-show="${id}"]`);
      if (!opened) errors.push('could not open a player to look at his career');
      else {
        await opened.click();
        await sleep(300);
        const txt = await page.evaluate(() => document.body.innerText);
        if (!/12 seasons, 174 games/.test(txt)) errors.push('the player modal shows no career line for a twelve-season man');
        if (!/58,211 pass yds/.test(txt)) errors.push('the career line does not carry his passing yards');
        if (!/2. MVP/.test(txt)) errors.push('the career line does not carry his honours');
        if (!/Hall of Fame/.test(txt)) errors.push('a two-time MVP with a title is not shown as a Hall of Famer');
        await checkOverflow('player modal with a career');
        await shot('16-career');
        const close = await page.$('[data-close]');
        if (close) await close.click();
      }
    }

    // Position changes from the player's card. The only way in used to be a
    // button on an EMPTY depth-chart slot, and a drafted roster has none, so
    // the feature was there and a player could not find it. A pro league's
    // keeper round has moves open; a defensive back's card has to offer one.
    {
      const { u, id } = await page.evaluate(() => {
        const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
        const st = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active));
        const i = st.league.teams.findIndex((t) => t.isUser);
        const sl = st.league.teams[i].slots;
        return { u: i, id: sl.S1 || sl.S2 || sl.CB1 || sl.CB2 };
      });
      await page.goto(`http://localhost:${port}/#/team/${u}/depth`);
      await page.reload();
      await sleep(600);
      const card = id && await page.$(`[data-show="${id}"]`);
      if (!card) errors.push('could not open a defensive back to change his position');
      else {
        await card.click();
        await sleep(300);
        const offer = await page.evaluate(() => document.querySelectorAll('.modal [data-pswap], .modal [data-pmove]').length);
        if (!offer) errors.push('a defensive back\'s card in a pro league offers no position change');
        await checkOverflow('player card with a position change');
        await shot('16b-position');
        const close = await page.$('[data-close]');
        if (close) await close.click();
      }
    }

    // The free-agent market with contract lengths: the bid dialog offers a
    // length, moving it moves the asking price and the amount with it, and the
    // offer that goes in is the length chosen. Built from the same league,
    // keepers confirmed in Node so the page opens straight onto the market.
    {
      const { confirmKeepers, aiKeepers } = await import(`${R}/src/engine/offseason.js`);
      const { userTeamIndex } = await import(`${R}/src/engine/season.js`);
      const { askAt } = await import(`${R}/src/engine/freeagency.js`);
      const fa = JSON.parse(JSON.stringify(lg));
      const faPool = leaguePool(fa, PLAYERS);
      const faIdx = careerIndex(fa, leagueIndex(fa, PLAYERS_BY_ID));
      confirmKeepers(fa, aiKeepers(fa, userTeamIndex(fa), faPool, faIdx, new RNG(8)), faPool, faIdx);
      if (fa.offseason?.step !== 'freeagency') errors.push(`confirming keepers left the pro league at "${fa.offseason?.step}", not the market`);
      await page.evaluate((league) => {
        const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
        localStorage.setItem('gridiron-eras:slot:' + reg.active, JSON.stringify({ league, savedAt: Date.now() }));
      }, JSON.parse(JSON.stringify(fa)));
      await page.goto(`http://localhost:${port}/#/offseason`);
      await page.reload();
      await sleep(600);
      // A man dear enough for length to move his price, that the user can afford.
      // textContent, not innerText: the row's meta line is a flex container,
      // and innerText breaks the line between "asking" and the figure.
      const pick = await page.evaluate(() => {
        const room = Number((document.body.textContent.match(/Left to bid\s*\$(\d+)/) || [])[1]);
        for (const b of document.querySelectorAll('[data-bid]')) {
          const ask = Number(((b.closest('li') || b.parentElement).textContent.match(/asking\s*\$(\d+)/) || [])[1]);
          if (ask >= 8 && ask <= room) return { id: b.dataset.bid, ask, room };
        }
        return { room };
      });
      if (!pick.id) errors.push(`the market shows nobody at $8+ within the $${pick.room} the user can bid`);
      else {
        await page.click(`[data-bid="${pick.id}"]`);
        await sleep(250);
        const opts = await page.$$eval('#faYears option', (os) => os.map((o) => Number(o.value)));
        if (opts.join() !== '2,3,4,5') errors.push(`the bid dialog offers lengths [${opts}], expected 2-5 years`);
        const amt0 = Number(await page.inputValue('#faAmt'));
        if (amt0 !== pick.ask) errors.push(`the bid opens at $${amt0}, not his three-year asking price of $${pick.ask}`);
        await page.selectOption('#faYears', '5');
        await sleep(150);
        const five = askAt(pick.ask, 5);
        const amt5 = Number(await page.inputValue('#faAmt'));
        const shown = (await page.innerText('#faAsk')).trim();
        if (amt5 !== five) errors.push(`switching to five years left the amount at $${amt5}; five years asks $${five}`);
        if (shown !== `$${five}`) errors.push(`switching to five years shows an asking price of ${shown}, not $${five}`);
        await checkOverflow('free agency bid dialog with lengths');
        await shot('17-fa-length');
        await page.click('#faOk');
        await sleep(300);
        const txt = await page.evaluate(() => document.body.textContent);
        if (!/a year for\s*5/.test(txt)) errors.push('an offer made for five years is not listed as one');
        if (!/×\s*5y/.test(txt)) errors.push('the market row does not show the length of the standing bid');
        await checkOverflow('free agency with a five-year offer in');
      }
      // Careers off: one length, so no choice is drawn at all.
      await page.evaluate(() => {
        const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
        const key = 'gridiron-eras:slot:' + reg.active;
        const st = JSON.parse(localStorage.getItem(key));
        st.league.settings.careers = false;
        localStorage.setItem(key, JSON.stringify(st));
      });
      await page.reload();
      await sleep(600);
      const anyBid = await page.$('[data-bid]');
      if (anyBid) {
        await anyBid.click();
        await sleep(250);
        if (await page.$('#faYears')) errors.push('a league without careers still offers a choice of length');
        const close = await page.$('[data-close]');
        if (close) await close.click();
      }
    }

    // Position changes: an open corner slot offers the club's own men whose
    // skills translate, with what each would be there, and moving one fills
    // the slot, opens his old one, and says so on the chart and in the log.
    // The same market-step league, with the user's second corner released.
    {
      const { confirmKeepers, aiKeepers } = await import(`${R}/src/engine/offseason.js`);
      const { userTeamIndex } = await import(`${R}/src/engine/season.js`);
      const pc = JSON.parse(JSON.stringify(lg));
      const pcPool = leaguePool(pc, PLAYERS);
      const pcIdx = careerIndex(pc, leagueIndex(pc, PLAYERS_BY_ID));
      confirmKeepers(pc, aiKeepers(pc, userTeamIndex(pc), pcPool, pcIdx, new RNG(8)), pcPool, pcIdx);
      const u = pc.teams.findIndex((t) => t.isUser);
      const gone = pc.teams[u].slots.CB2;
      pc.teams[u].slots.CB2 = null;
      if (gone) delete pc.contracts[gone];
      await page.evaluate((league) => {
        const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
        localStorage.setItem('gridiron-eras:slot:' + reg.active, JSON.stringify({ league, savedAt: Date.now() }));
      }, pc);
      await page.goto(`http://localhost:${port}/#/team/${u}/depth`);
      await page.reload();
      await sleep(600);
      const saved = () => page.evaluate(() => {
        const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
        const st = JSON.parse(localStorage.getItem('gridiron-eras:slot:' + reg.active));
        const t = st.league.teams.find((x) => x.isUser);
        return { cb2: t.slots.CB2, moves: st.league.moves || {} };
      });
      const btn = await page.$('[data-convert="CB2"]');
      if (!btn) errors.push('an open corner slot offers no way to move a man into it');
      else {
        await btn.click();
        await sleep(300);
        const who = await page.$$eval('.modal [data-to]', (bs) => bs.map((b) => b.dataset.to));
        const txt = (await page.$eval('.modal', (m) => m.textContent)).replace(/\s+/g, ' ');
        if (!who.length) errors.push('the move dialog lists nobody who could play corner');
        if (!/first season/.test(txt) || !/settled/.test(txt)) errors.push('the move dialog does not say what each man would be at corner');
        await checkOverflow('position change dialog at 360px');
        await shot('21-position-change');
        if (who.length) {
          await page.click(`.modal [data-to="${who[0]}"]`);
          await sleep(700); // the store saves on a short debounce
          const st = await saved();
          if (st.cb2 !== who[0]) errors.push(`moving a man to corner left CB2 holding ${st.cb2}`);
          if (st.moves[who[0]]?.to !== 'CB') errors.push('the move to corner was not recorded on the league');
          const row = await page.evaluate((id) => document.querySelector(`#team-view [data-id="${id}"]`)?.textContent.replace(/\s+/g, ' ') || '', who[0]);
          if (!/was (S|LB)/.test(row)) errors.push(`the moved man's row does not say where he came from: "${row.slice(0, 120)}"`);
          await checkOverflow('depth chart with a moved man');
          await shot('22-moved');
          await page.goto(`http://localhost:${port}/#/moves/log`);
          await sleep(400);
          const log = (await page.evaluate(() => document.body.textContent)).replace(/\s+/g, ' ');
          if (!/moved .{1,60} from (S|LB) to CB/.test(log)) errors.push('the transaction log does not record the change of position');
        }
      }
    }

    // Past seasons: a league with one season filed and a few weeks into the
    // next. The Team stats tab offers the filed season, reads it back, and
    // the matchup card quotes the series with the season it starts from.
    {
      const { simulateWeekAi, advanceWeek, newSeasonSameRosters } = await import(`${R}/src/engine/season.js`);
      const past = createLeague({ name: 'Smoke Past', numTeams: 8, seed: 21, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
      autoDraftAll(past, past.draft, PLAYERS, new RNG(21));
      startSeason(past, PLAYERS_BY_ID);
      while (past.phase === 'season' || past.phase === 'playoffs') { simulateWeekAi(past, PLAYERS_BY_ID, { includeUser: true }); advanceWeek(past, PLAYERS_BY_ID); }
      newSeasonSameRosters(past, PLAYERS_BY_ID);
      for (let w = 0; w < 2; w++) { simulateWeekAi(past, PLAYERS_BY_ID, { includeUser: true }); advanceWeek(past, PLAYERS_BY_ID); }
      await page.evaluate((league) => {
        const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
        localStorage.setItem('gridiron-eras:slot:' + reg.active, JSON.stringify({ league, savedAt: Date.now() }));
      }, JSON.parse(JSON.stringify(past)));
      await page.goto(`http://localhost:${port}/#/awards/teams`);
      await page.reload();
      await sleep(600);
      const opts = await page.$$eval('#statSeason option', (os) => os.map((o) => [o.value, o.textContent.trim()]));
      if (opts.length !== 2) errors.push(`the season picker offers ${opts.length} choices; one filed season plus this one is 2`);
      else if (opts[1][0] !== '1' || !/in progress/i.test(opts[0][1])) errors.push(`the season picker reads ${JSON.stringify(opts)}`);
      if (opts.length) {
        await page.selectOption('#statSeason', '1');
        await sleep(250);
        const txt = await page.evaluate(() => document.body.textContent);
        if (!/Season 1, filed at its final/.test(txt)) errors.push('choosing a filed season does not say which season is showing');
        if (!/Where you stood/.test(txt)) errors.push('a filed season still says "where you stand"');
        const shown = await page.evaluate(() => document.querySelectorAll('.stat-v').length);
        const hidden = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          return [...document.querySelectorAll('.stat-v')].filter((el) => { const b = el.getBoundingClientRect(); return b.width === 0 || b.right > vw + 1; }).length;
        });
        if (!shown) errors.push('a filed season shows no figures');
        if (hidden) errors.push(`${hidden} of ${shown} figures from a filed season sit outside the screen at 360px`);
        await checkOverflow('team stats for a filed season');
        await shot('18-past-season');
      }
      await page.goto(`http://localhost:${port}/#/season`);
      await sleep(400);
      const seriesText = await page.evaluate(() => document.querySelector('.series')?.textContent.trim() || null);
      if (!seriesText) errors.push('the matchup card has no series line');
      else if (!/^All-time: (you (lead|trail)|level at) \d+–\d+(–\d+)?\.$/.test(seriesText)) errors.push(`the matchup card's series reads "${seriesText}"`);
      await checkOverflow('matchup card with a series');
      if (await page.$('.wx')) errors.push('a fantasy league shows weather, and its clubs have no city');
    }

    // A pro league that auctions reads its keeper round as a pro league: its
    // contracts, not the fantasy keeper's raise, and a market of this year's
    // rookies. The screen tested the auction before the cap and showed it the
    // fantasy sentence and prices. Only the screen's branch is under test here;
    // the engine's is in tests/pro-auction.test.js.
    {
      const l = createLeague({ name: 'Smoke Pro Auction', mode: 'pro', numTeams: 32, franchise: 5, seed: 12, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
      autoDraftAll(l, l.draft, PLAYERS, new RNG(12));
      startSeason(l, PLAYERS_BY_ID);
      l.phase = 'complete';
      enterOffseason(l, leaguePool(l, PLAYERS), careerIndex(l, leagueIndex(l, PLAYERS_BY_ID)));
      l.draftType = 'auction';
      await page.evaluate((league) => {
        const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
        localStorage.setItem('gridiron-eras:slot:' + reg.active, JSON.stringify({ league, savedAt: Date.now() }));
      }, JSON.parse(JSON.stringify(l)));
      await page.reload();
      await sleep(500);
      await page.goto(`http://localhost:${port}/#/offseason`);
      await page.reload();
      await sleep(600);
      const view = await page.evaluate(() => document.querySelector('#offseason-view')?.textContent.replace(/\s+/g, ' ') || '');
      if (!/an auction of this year's rookies fills what is left/.test(view)) errors.push('a pro league that auctions is not told its market is the rookie class');
      if (/keep at \$|kept three years running|A keeper is worth having/.test(view)) errors.push('a pro league that auctions is shown the fantasy keeper round');
      await checkOverflow('pro auction keeper round');
    }

    // Weather: a pro league's matchup card gives the conditions its game will
    // be played under — the same draw, so not a forecast — and the live
    // scoreboard and the box score repeat them. With the setting off, nothing.
    {
      const { conditionsFor, conditionsLine, describeWeather } = await import(`${R}/src/engine/weather.js`);
      const { weekNumber, userGameThisWeek } = await import(`${R}/src/engine/season.js`);
      const mk = (on) => {
        const l = createLeague({ name: 'Smoke Weather', mode: 'pro', numTeams: 32, franchise: 1, seed: 33, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
        l.settings.weather = on;
        autoDraftAll(l, l.draft, PLAYERS, new RNG(33));
        startSeason(l, PLAYERS_BY_ID);
        return l;
      };
      const put = async (league) => {
        await page.evaluate((league) => {
          const reg = JSON.parse(localStorage.getItem('gridiron-eras:slots:v1'));
          localStorage.setItem('gridiron-eras:slot:' + reg.active, JSON.stringify({ league, savedAt: Date.now() }));
        }, JSON.parse(JSON.stringify(league)));
        await page.goto(`http://localhost:${port}/#/season`);
        await page.reload();
        await sleep(600);
      };
      const wx = mk(true);
      const w = conditionsFor(wx, userGameThisWeek(wx), weekNumber(wx));
      await put(wx);
      const card = await page.evaluate(() => document.querySelector('.wx')?.textContent.replace(/\s+/g, ' ').trim() || null);
      if (!card) errors.push('a pro league with weather has no conditions on the matchup card');
      else if (!card.includes(describeWeather(w))) errors.push(`the matchup card reads "${card}"; the game will be played in "${describeWeather(w)}"`);
      await checkOverflow('matchup card with conditions');
      await shot('23-weather-card');
      await page.click('#play');
      await page.waitForSelector('.scoreboard');
      // Watching is the default; before the kickoff the game says who is calling the plays and how to take them.
      if (!/Your staff calls the plays\. Coach mode hands them to you\./.test(await page.$eval('#app', (e) => e.textContent.replace(/\s+/g, ' ')))) errors.push('a watched game does not say coach mode exists');
      const live = await page.evaluate(() => document.querySelector('.wxline')?.textContent.trim() || null);
      if (live !== conditionsLine(w)) errors.push(`the live scoreboard reads "${live}", expected "${conditionsLine(w)}"`);
      await checkOverflow('live game with conditions');
      await page.goto(`http://localhost:${port}/#/season`);
      await page.waitForSelector('#abandon');
      await page.click('#abandon');
      await page.click('.modal #yes');
      await page.waitForSelector('#simMine');
      await page.click('#simMine');
      await sleep(700); // the store saves on a short debounce
      const boxLink = await page.$('a.btn[href^="#/box/"]');
      if (!boxLink) errors.push('no box score link after simming the game');
      else {
        await boxLink.click();
        await page.waitForSelector('.stat-compare');
        const box = await page.evaluate(() => document.querySelector('.wxline')?.textContent.trim() || null);
        if (box !== conditionsLine(w)) errors.push(`the box score reads "${box}", expected "${conditionsLine(w)}"`);
        await checkOverflow('box score with conditions');
      }
      await put(mk(false));
      if (await page.$('.wx')) errors.push('a pro league with weather off still shows conditions');
      await page.goto(`http://localhost:${port}/#/settings`);
      await page.waitForSelector('#jobs');
      if (await page.$('#proOnly')) errors.push('a pro league\'s settings say its own settings are pro-only');
    }
  }

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
