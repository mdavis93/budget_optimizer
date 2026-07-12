'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const bs3Root = path.join(root, 'node_modules/better-sqlite3');
const rebuiltBinary = path.join(bs3Root, 'build', 'Release', 'better_sqlite3.node');
const nativeCacheDir = path.join(root, '.cache', 'native');

const SAFE_IDENTITY = /^[A-Za-z0-9._-]+$/;
const PROBE_TIMEOUT_MS = 30000;

function getNodeAbi() {
  return String(process.versions.modules);
}

function findAbiRegistry() {
  // Prefer the hoisted install layout (see .npmrc node-linker=hoisted).
  const hoistedCandidates = [
    path.join(root, 'node_modules/node-abi/abi_registry.json'),
    path.join(root, 'node_modules/@electron/rebuild/node_modules/node-abi/abi_registry.json'),
  ];
  for (const candidate of hoistedCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Isolated pnpm virtual-store layout (node-linker=isolated).
  const pnpmDir = path.join(root, 'node_modules/.pnpm');
  if (!fs.existsSync(pnpmDir)) {
    return null;
  }

  const entries = fs
    .readdirSync(pnpmDir)
    .filter((entry) => entry.startsWith('node-abi@'))
    .sort()
    .reverse();

  for (const entry of entries) {
    const registry = path.join(pnpmDir, entry, 'node_modules/node-abi/abi_registry.json');
    if (fs.existsSync(registry)) {
      return registry;
    }
  }

  return null;
}

function getElectronVersion() {
  const electronPkg = path.join(root, 'node_modules/electron/package.json');
  if (!fs.existsSync(electronPkg)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(electronPkg, 'utf8')).version;
}

function getElectronBinaryPath() {
  const electronDir = path.join(root, 'node_modules/electron');
  const pathTxt = path.join(electronDir, 'path.txt');

  if (fs.existsSync(pathTxt)) {
    const relative = fs.readFileSync(pathTxt, 'utf8').trim();
    return path.join(electronDir, 'dist', relative);
  }

  if (process.platform === 'darwin') {
    return path.join(electronDir, 'dist/Electron.app/Contents/MacOS/Electron');
  }

  if (process.platform === 'win32') {
    return path.join(electronDir, 'dist/electron.exe');
  }

  return path.join(electronDir, 'dist/electron');
}

function getElectronModulesAbiFromPackage() {
  const abiVersionPath = path.join(root, 'node_modules/electron/abi_version');
  if (!fs.existsSync(abiVersionPath)) {
    return null;
  }

  const abi = String(fs.readFileSync(abiVersionPath, 'utf8')).trim();
  if (/^\d+$/.test(abi)) {
    return abi;
  }

  return null;
}

function getElectronModulesAbiFromRuntime() {
  const binary = getElectronBinaryPath();
  if (!fs.existsSync(binary)) {
    return null;
  }

  try {
    const result = spawnSync(
      binary,
      ['-e', 'console.log(process.versions.modules)'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    if (result.error) {
      console.warn(
        `Could not query Electron runtime ABI (${binary}): ${result.error.message}`
      );
      return null;
    }
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim();
      console.warn(
        `Could not query Electron runtime ABI (${binary}): exit ${result.status}` +
          (detail ? ` — ${detail}` : '')
      );
      return null;
    }
    const abi = String(result.stdout || '').trim();
    if (/^\d+$/.test(abi)) {
      return abi;
    }
  } catch (error) {
    console.warn('Could not query Electron runtime ABI:', error.message || error);
  }

  return null;
}

function getElectronModulesAbiFromRegistry(electronVersion) {
  const registryPath = findAbiRegistry();
  if (!registryPath) {
    return null;
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const major = electronVersion.split('.')[0];
  const matches = registry.filter(
    (entry) =>
      entry.runtime === 'electron' &&
      !entry.future &&
      entry.target.startsWith(`${major}.`)
  );

  if (matches.length === 0) {
    return null;
  }

  return String(matches[matches.length - 1].abi);
}

function getElectronAbi() {
  const runtimeAbi = getElectronModulesAbiFromRuntime();
  if (runtimeAbi) {
    return runtimeAbi;
  }

  // Electron ships abi_version with the npm package (no binary spawn required).
  // Critical on CI when the runtime probe cannot execute the binary yet the ABI
  // is still known — e.g. before system libs are present, or under xvfb quirks.
  const packageAbi = getElectronModulesAbiFromPackage();
  if (packageAbi) {
    return packageAbi;
  }

  const electronVersion = getElectronVersion();
  if (!electronVersion) {
    return null;
  }

  return getElectronModulesAbiFromRegistry(electronVersion);
}

function getBetterSqlite3Version() {
  const pkgPath = path.join(bs3Root, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
}

function loadsUnderNode() {
  try {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();",
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

function loadsUnderElectron() {
  const binary = getElectronBinaryPath();
  if (!fs.existsSync(binary)) {
    return false;
  }

  try {
    const result = spawnSync(
      binary,
      [
        '-e',
        "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();",
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

function assertSafeCacheIdentity(part, label) {
  const value = String(part ?? '');
  if (!SAFE_IDENTITY.test(value)) {
    throw new Error(`Unsafe ${label} for native cache identity: ${JSON.stringify(value)}`);
  }
  return value;
}

function resolveUnderNativeCache(...segments) {
  const cacheRoot = path.resolve(nativeCacheDir);
  const resolved = path.resolve(cacheRoot, ...segments);
  const relative = path.relative(cacheRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Native cache path escaped .cache/native: ${resolved}`);
  }
  return resolved;
}

module.exports = {
  root,
  bs3Root,
  rebuiltBinary,
  nativeCacheDir,
  getNodeAbi,
  getElectronAbi,
  getElectronVersion,
  getElectronBinaryPath,
  getElectronModulesAbiFromPackage,
  getElectronModulesAbiFromRuntime,
  getElectronModulesAbiFromRegistry,
  findAbiRegistry,
  getBetterSqlite3Version,
  loadsUnderNode,
  loadsUnderElectron,
  assertSafeCacheIdentity,
  resolveUnderNativeCache,
};
