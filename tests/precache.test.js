import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

// The service worker precaches an explicit list, and nothing checked it against
// the code. Three modules shipped without being on it — team statistics, the
// side-by-side comparison and the contract-length prices — which works while
// the phone is online, because anything missing is fetched and cached on first
// use, and fails the first time the installed app is opened offline after an
// update: the old cache is deleted on activation and the module was never in
// the new one. So the list is checked against the import graph instead.

const sw = readFileSync('sw.js', 'utf8');
const listed = new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));

function reachable(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    // A worker is loaded by URL rather than imported, so that is followed too.
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|new\s+URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g)) {
      const target = normalize(join(dirname(file), m[1] || m[2] || m[3]));
      if (existsSync(target)) stack.push(target);
    }
  }
  return seen;
}

test('every module the app can load is precached by the service worker', () => {
  const modules = reachable('src/main.js');
  assert.ok(modules.size > 50, `only ${modules.size} modules found; the import scan is broken`);
  assert.ok(modules.has('src/save-worker.js'), 'the scan does not reach the save worker');
  const missing = [...modules].filter((f) => !listed.has(f)).sort();
  assert.deepEqual(missing, [], `not precached, so the installed app cannot load them offline after an update: ${missing.join(', ')}`);
});

test('the service worker precaches nothing that no longer exists', () => {
  // `cache.addAll` is all or nothing: one 404 and the install fails, which
  // leaves the old worker, and the old app, in place for good.
  const gone = [...listed].filter((f) => f && !existsSync(f));
  assert.deepEqual(gone, []);
});
