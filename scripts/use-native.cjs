'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  root,
  rebuiltBinary,
  nativeCacheDir,
  getNodeAbi,
  getElectronAbi,
  getBetterSqlite3Version,
  loadsUnderNode,
  loadsUnderElectron,
  assertSafeCacheIdentity,
  resolveUnderNativeCache,
} = require('./lib/abi.cjs');

const MARKER_PATH = resolveUnderNativeCache('.current');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function status(message) {
  // Plain status lines only — must never match verify-test-output-clean.sh patterns.
  console.log(message);
}

function parseTarget(argv) {
  const target = argv[2];
  if (target !== 'node' && target !== 'electron') {
    fail('Usage: node scripts/use-native.cjs <node|electron>');
  }
  return target;
}

function resolveTargetAbi(target) {
  if (target === 'node') {
    return getNodeAbi();
  }
  const abi = getElectronAbi();
  if (!abi) {
    fail(
      'Electron ABI could not be determined. Run: pnpm install (electron must be present).'
    );
  }
  return abi;
}

function loadsUnderTarget(target) {
  return target === 'node' ? loadsUnderNode() : loadsUnderElectron();
}

function buildIdentity(bs3Version, targetAbi) {
  const version = assertSafeCacheIdentity(bs3Version, 'better-sqlite3 version');
  const abi = assertSafeCacheIdentity(targetAbi, 'ABI');
  return `${version}-modules${abi}`;
}

function cacheFileName(bs3Version, targetAbi) {
  const version = assertSafeCacheIdentity(bs3Version, 'better-sqlite3 version');
  const abi = assertSafeCacheIdentity(targetAbi, 'ABI');
  const platform = assertSafeCacheIdentity(process.platform, 'platform');
  const arch = assertSafeCacheIdentity(process.arch, 'arch');
  return `better_sqlite3-${version}-${platform}-${arch}-modules${abi}.node`;
}

function readMarker() {
  try {
    return fs.readFileSync(MARKER_PATH, 'utf8').trim();
  } catch {
    return null;
  }
}

function writeMarker(identity) {
  fs.mkdirSync(nativeCacheDir, { recursive: true });
  fs.writeFileSync(MARKER_PATH, `${identity}\n`, 'utf8');
}

function ensureReleaseDir() {
  fs.mkdirSync(path.dirname(rebuiltBinary), { recursive: true });
}

function installBinaryFrom(sourcePath) {
  ensureReleaseDir();
  const tempPath = path.join(
    path.dirname(rebuiltBinary),
    `.better_sqlite3.${process.pid}.${Date.now()}.tmp`
  );
  fs.copyFileSync(sourcePath, tempPath);
  fs.renameSync(tempPath, rebuiltBinary);
}

function stashCurrentBinary(cachePath) {
  if (!fs.existsSync(rebuiltBinary)) {
    fail(`Cannot stash native binary; missing ${rebuiltBinary}`);
  }
  fs.mkdirSync(nativeCacheDir, { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.tmp`;
  fs.copyFileSync(rebuiltBinary, tempPath);
  fs.renameSync(tempPath, cachePath);
}

function purgeCacheEntry(cachePath) {
  fs.rmSync(cachePath, { force: true });
  try {
    if (readMarker()) {
      fs.rmSync(MARKER_PATH, { force: true });
    }
  } catch {
    // ignore
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    fail(`Command failed (${command} ${args.join(' ')}); exit ${result.status ?? 'signal'}`);
  }
}

function compileForNode() {
  status('use-native: compiling better-sqlite3 for Node');
  runCommand('pnpm', ['rebuild', 'better-sqlite3']);
}

function compileForElectron() {
  status('use-native: trying Electron prebuild sync');
  const sync = spawnSync(process.execPath, [path.join(root, 'scripts/sync-better-sqlite3-native.cjs')], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (sync.status === 0 && loadsUnderElectron()) {
    return;
  }

  status('use-native: rebuilding better-sqlite3 for Electron (sqlite-only)');
  runCommand('pnpm', ['exec', 'electron-rebuild', '-f', '--only', 'better-sqlite3']);
}

function compileForTarget(target) {
  if (target === 'node') {
    compileForNode();
  } else {
    compileForElectron();
  }

  if (!loadsUnderTarget(target)) {
    fail(
      `use-native: ${target} binary still does not load after compile; refusing to write marker/cache`
    );
  }
}

function main() {
  const target = parseTarget(process.argv);

  if (!fs.existsSync(path.join(root, 'node_modules/better-sqlite3'))) {
    fail('better-sqlite3 is not installed. Run: pnpm install');
  }

  const bs3Version = getBetterSqlite3Version();
  if (!bs3Version) {
    fail('Could not read better-sqlite3 package version.');
  }

  const targetAbi = resolveTargetAbi(target);
  const identity = buildIdentity(bs3Version, targetAbi);
  const cachePath = resolveUnderNativeCache(cacheFileName(bs3Version, targetAbi));

  // Always probe under the target runtime. The marker is refreshed after a
  // successful probe/cache/compile for debugging, but is never trusted alone —
  // postinstall/rebuild can overwrite the binary while leaving a stale marker.
  if (loadsUnderTarget(target)) {
    writeMarker(identity);
    status(`use-native: noop-probe (${target})`);
    return;
  }

  // Cache hit → install → post-copy probe
  if (fs.existsSync(cachePath)) {
    status(`use-native: cache-hit (${target})`);
    installBinaryFrom(cachePath);
    if (loadsUnderTarget(target)) {
      writeMarker(identity);
      return;
    }
    status('use-native: post-copy probe failed; purging bad cache entry and recompiling');
    purgeCacheEntry(cachePath);
  }

  // Cache miss / purged → compile → post-compile probe → stash
  compileForTarget(target);
  stashCurrentBinary(cachePath);
  writeMarker(identity);
  status(`use-native: compile (${target})`);
}

main();
