// Every module the app loads is in the service worker's shell.
//
// The shell is a hand-kept list in sw.js, and an ES module whose import fails
// offline takes the whole app down with it: installed and offline, the app
// sits on "Loading…". Only the browser smoke's offline launch caught the last
// module left off it, several minutes into a run; this walks the imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function shell() {
  const src = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const at = src.indexOf('const SHELL');
  return new Set([...src.slice(at, src.indexOf('];', at)).matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));
}

/** Every module reachable from `entries` by static import, as paths from the root. */
function reachable(entries) {
  const seen = new Set();
  const IMPORT = /(?:^|[\s;])(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|(?:^|[\s;])import\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] || m[2];
      walk(path.relative(root, path.resolve(path.dirname(path.join(root, rel)), spec)).split(path.sep).join('/'));
    }
  };
  entries.forEach(walk);
  return seen;
}

test('every stylesheet the page links is in the service worker shell', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sheets.includes('src/styles.css') && sheets.includes('src/eracards.css'), sheets.join(', '));
  const have = shell();
  assert.deepEqual(sheets.filter((f) => !have.has(f)), []);
});

test('every module the app and its save worker import is in the service worker shell', () => {
  const have = shell();
  const graph = reachable(['src/main.js', 'src/save-worker.js']);
  assert.ok(graph.size > 40, `only ${graph.size} modules found; the walk is not reading imports`);
  assert.deepEqual([...graph].filter((f) => !have.has(f)).sort(), []);
});
