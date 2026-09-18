// Rasterize icons/icon.svg to the PNG sizes the manifest references.
// Requires Playwright (npm i -D playwright, or a global install on NODE_PATH).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('Playwright not found. Run: npm i -D playwright  (or set NODE_PATH to a global install)'); process.exit(1); }

const svg = readFileSync(resolve(here, '../icons/icon.svg'), 'utf8');
const targets = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'maskable-512.png', size: 512, pad: 0.1 }, // maskable: keep art inside the safe zone
];
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
for (const t of targets) {
  const inner = Math.round(t.size * (1 - 2 * t.pad));
  const html = `<html><body style="margin:0;background:#0f1a12;width:${t.size}px;height:${t.size}px;display:flex;align-items:center;justify-content:center">${svg.replace('width="512" height="512"', `width="${inner}" height="${inner}"`)}</body></html>`;
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(html);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: t.size, height: t.size }, omitBackground: false });
  writeFileSync(resolve(here, '../icons', t.file), buf);
  console.log('wrote', t.file);
}
await browser.close();
