const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bs3Root = path.join(root, 'node_modules/better-sqlite3');

if (!fs.existsSync(bs3Root)) {
  console.log('better-sqlite3 not installed; skipping native sync.');
  process.exit(0);
}

const rebuiltBinary = path.join(bs3Root, 'build', 'Release', 'better_sqlite3.node');

function findAbiRegistry() {
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
    return path.join(
      electronDir,
      'dist/Electron.app/Contents/MacOS/Electron'
    );
  }

  if (process.platform === 'win32') {
    return path.join(electronDir, 'dist/electron.exe');
  }

  return path.join(electronDir, 'dist/electron');
}

function getElectronModulesAbiFromRuntime() {
  const binary = getElectronBinaryPath();
  if (!fs.existsSync(binary)) {
    return null;
  }

  try {
    const output = execSync(
      `"${binary}" -e "console.log(process.versions.modules)"`,
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const abi = output.trim();
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

  return matches[matches.length - 1].abi;
}

function getElectronModulesAbi() {
  const runtimeAbi = getElectronModulesAbiFromRuntime();
  if (runtimeAbi) {
    return runtimeAbi;
  }

  const electronVersion = getElectronVersion();
  if (!electronVersion) {
    return null;
  }

  return getElectronModulesAbiFromRegistry(electronVersion);
}

// Prefer electron-rebuild output; do not overwrite with a stale prebuild.
if (fs.existsSync(rebuiltBinary)) {
  const electronVersion = getElectronVersion() || 'unknown';
  console.log(
    `Using electron-rebuilt better-sqlite3 at ${rebuiltBinary} (Electron ${electronVersion})`
  );
  process.exit(0);
}

const electronAbi = getElectronModulesAbi();
if (!electronAbi) {
  console.error('Electron is not installed or its NODE_MODULE_VERSION could not be determined.');
  console.error('Run: pnpm install && pnpm run rebuild:native');
  process.exit(1);
}

const prebuildPlatform = `${process.platform}-${process.arch}-${electronAbi}`;
const prebuildCandidates = [
  path.join(bs3Root, 'bin', prebuildPlatform, 'better-sqlite3.node'),
];

const prebuild = prebuildCandidates.find((candidate) => fs.existsSync(candidate));
if (!prebuild) {
  console.error(
    `Could not find a better-sqlite3 native binary for Electron ABI ${electronAbi} (${prebuildPlatform}).`
  );
  console.error('Run: pnpm run rebuild:native');
  process.exit(1);
}

const targetDir = path.join(bs3Root, 'build', 'Release');
const target = path.join(targetDir, 'better_sqlite3.node');
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(prebuild, target);
console.log(`Synced better-sqlite3 native binary from ${prebuild} (Electron ABI ${electronAbi})`);
