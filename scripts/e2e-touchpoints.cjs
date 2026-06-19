#!/usr/bin/env node
/**
 * E2E touchpoint reconciliation + coverage gate + drift checks.
 *
 * Coverage is a custom *user-journey* metric (distinct from code coverage): a
 * touchpoint in tests/e2e/touchpoint-inventory.json is "covered" when its id
 * appears as an `@id` tag in a spec title under tests/e2e.
 *
 * Fails (exit 1) when:
 *   - a spec references an `@id` not in the inventory (orphan tag), or vice
 *     versa for ids the inventory claims are covered;
 *   - a tier's covered % is below its floor (critical 100%, standard 80%);
 *   - route drift: a route in src/App.tsx is not claimed by any touchpoint;
 *   - channel drift: an IPC channel in electron/preload.ts is neither exercised
 *     by a touchpoint nor listed in untestedChannels.
 *
 * Warns (exit 0) when a tier is above its floor but below its target.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const E2E_DIR = path.join(ROOT, 'tests', 'e2e');
const INVENTORY_PATH = path.join(E2E_DIR, 'touchpoint-inventory.json');
const APP_PATH = path.join(ROOT, 'src', 'App.tsx');
const PRELOAD_PATH = path.join(ROOT, 'electron', 'preload.ts');

const errors = [];
const warnings = [];

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function collectSpecTags() {
  const tags = new Map(); // tag -> [specFile, ...]
  const files = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.spec.ts'));
  const tagRe = /@([a-z][\w-]*(?:\.[\w-]+)+)/g;
  for (const file of files) {
    const content = readFile(path.join(E2E_DIR, file));
    let m;
    while ((m = tagRe.exec(content)) !== null) {
      const tag = m[1];
      if (!tags.has(tag)) tags.set(tag, []);
      tags.get(tag).push(file);
    }
  }
  return tags;
}

function normalizeRoute(route) {
  // Skip the catch-all and the layout/shell parent route ("/" only renders an
  // index redirect; its children are the real destinations).
  if (route === '*' || route === '' || route === '/') return null;
  return route.startsWith('/') ? route : `/${route}`;
}

function collectAppRoutes() {
  const content = readFile(APP_PATH);
  const routes = new Set();
  const re = /path="([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const r = normalizeRoute(m[1]);
    if (r) routes.add(r);
  }
  return routes;
}

function collectPreloadChannels() {
  const content = readFile(PRELOAD_PATH);
  const channels = new Set();
  const re = /ipcRenderer\.invoke\('([^']+)'/g;
  let m;
  while ((m = re.exec(content)) !== null) channels.add(m[1]);
  return channels;
}

function main() {
  const inventory = JSON.parse(readFile(INVENTORY_PATH));
  const touchpoints = inventory.touchpoints;
  const ids = new Set(touchpoints.map((t) => t.id));

  // --- Reconcile spec tags <-> inventory ids ---
  const specTags = collectSpecTags();
  for (const [tag, files] of specTags) {
    if (!ids.has(tag)) {
      errors.push(`Orphan tag @${tag} in ${[...new Set(files)].join(', ')} — not in touchpoint inventory.`);
    }
  }
  const coveredIds = new Set([...specTags.keys()].filter((t) => ids.has(t)));

  // --- Coverage per tier ---
  const tierStats = {};
  for (const tierName of Object.keys(inventory.tiers)) {
    tierStats[tierName] = { total: 0, covered: 0, uncovered: [] };
  }
  for (const tp of touchpoints) {
    const stat = tierStats[tp.tier];
    if (!stat) {
      errors.push(`Touchpoint ${tp.id} has unknown tier "${tp.tier}".`);
      continue;
    }
    stat.total += 1;
    if (coveredIds.has(tp.id)) stat.covered += 1;
    else stat.uncovered.push(tp.id);
  }

  // --- Route drift ---
  const appRoutes = collectAppRoutes();
  const claimedRoutes = new Set();
  for (const tp of touchpoints) for (const r of tp.routes || []) claimedRoutes.add(r);
  for (const tp of touchpoints) {
    for (const r of tp.routes || []) {
      if (!appRoutes.has(r)) errors.push(`Touchpoint ${tp.id} claims route ${r} that no longer exists in App.tsx.`);
    }
  }
  for (const r of appRoutes) {
    if (!claimedRoutes.has(r)) {
      errors.push(`Route drift: ${r} (in App.tsx) is not claimed by any touchpoint. Add a touchpoint for it.`);
    }
  }

  // --- Channel drift ---
  const preloadChannels = collectPreloadChannels();
  const untested = new Set(inventory.untestedChannels || []);
  const journeyChannels = new Set();
  for (const tp of touchpoints) for (const c of tp.channels || []) journeyChannels.add(c);
  const known = new Set([...journeyChannels, ...untested]);
  for (const c of preloadChannels) {
    if (!known.has(c)) {
      errors.push(`Channel drift: '${c}' (in preload.ts) is neither exercised by a touchpoint nor in untestedChannels.`);
    }
  }
  for (const c of known) {
    if (!preloadChannels.has(c)) {
      errors.push(`Stale channel: '${c}' is referenced in the inventory but not in preload.ts.`);
    }
  }
  const overlap = [...journeyChannels].filter((c) => untested.has(c));
  if (overlap.length) {
    errors.push(`Channels listed as both journey-covered and untested: ${overlap.join(', ')}.`);
  }

  // --- Gate ---
  for (const [tierName, tier] of Object.entries(inventory.tiers)) {
    const stat = tierStats[tierName];
    const pct = stat.total ? (stat.covered / stat.total) * 100 : 100;
    stat.pct = pct;
    if (pct < tier.floorPct) {
      errors.push(
        `Coverage gate: ${tierName} at ${pct.toFixed(1)}% is below the ${tier.floorPct}% floor ` +
          `(${stat.covered}/${stat.total}). Uncovered: ${stat.uncovered.join(', ') || 'none'}.`
      );
    } else if (pct < tier.targetPct) {
      warnings.push(
        `${tierName} at ${pct.toFixed(1)}% is below the ${tier.targetPct}% target (floor ${tier.floorPct}%). ` +
          `Uncovered: ${stat.uncovered.join(', ') || 'none'}.`
      );
    }
  }

  // --- Report ---
  console.log('E2E touchpoint coverage');
  console.log('=======================');
  for (const [tierName, tier] of Object.entries(inventory.tiers)) {
    const stat = tierStats[tierName];
    console.log(
      `  ${tierName.padEnd(9)} ${stat.covered}/${stat.total} = ${stat.pct.toFixed(1)}% ` +
        `(floor ${tier.floorPct}%, target ${tier.targetPct}%)`
    );
  }
  console.log(`  channels   ${journeyChannels.size} journey + ${untested.size} acknowledged untested = ${preloadChannels.size} total`);
  console.log(`  routes     ${appRoutes.size} app routes, all claimed`);

  if (warnings.length) {
    console.log('\nWarnings:');
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  if (errors.length) {
    console.error('\nFailures:');
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error(`\n${errors.length} touchpoint check(s) failed.`);
    process.exit(1);
  }

  console.log('\nAll touchpoint checks passed.');
}

main();
