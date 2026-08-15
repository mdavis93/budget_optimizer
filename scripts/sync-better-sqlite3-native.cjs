'use strict';

const fs = require('fs');
const path = require('path');
const {
  bs3Root,
  rebuiltBinary,
  getElectronAbi,
  getElectronVersion,
  loadsUnderElectron,
} = require('./lib/abi.cjs');

function isLinuxMusl() {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    return fs.readFileSync('/usr/bin/ldd', 'utf8').includes('musl');
  } catch {
    return false;
  }
}

function napiPrebuildPath() {
  if (!['linux', 'darwin', 'win32'].includes(process.platform)) {
    return null;
  }
  if (!['x64', 'arm64'].includes(process.arch)) {
    return null;
  }
  const target = `${isLinuxMusl() ? 'linuxmusl' : process.platform}-${process.arch}`;
  return path.join(bs3Root, 'prebuilds', `${target}.node`);
}

function legacyAbiPrebuildPath(electronAbi) {
  const prebuildPlatform = `${process.platform}-${process.arch}-${electronAbi}`;
  return path.join(bs3Root, 'bin', prebuildPlatform, 'better-sqlite3.node');
}

function copyPrebuildToRelease(prebuild, label) {
  const targetDir = path.join(bs3Root, 'build', 'Release');
  const target = path.join(targetDir, 'better_sqlite3.node');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(prebuild, target);
  console.log(`Synced better-sqlite3 native binary from ${prebuild} (${label})`);
  return 0;
}

function syncBetterSqlite3Native() {
  if (!fs.existsSync(bs3Root)) {
    console.log('better-sqlite3 not installed; skipping native sync.');
    return 0;
  }

  // better-sqlite3@13+ ships N-API prebuilds that can load under both Node and
  // Electron. Prefer an existing Release binary when Electron can load it —
  // including when it also loads under Node (do not delete dual-load NAPI).
  if (fs.existsSync(rebuiltBinary) && loadsUnderElectron()) {
    const electronVersion = getElectronVersion() || 'unknown';
    console.log(
      `Using better-sqlite3 at ${rebuiltBinary} (Electron ${electronVersion})`
    );
    return 0;
  }

  const napiPrebuild = napiPrebuildPath();
  if (napiPrebuild && fs.existsSync(napiPrebuild)) {
    return copyPrebuildToRelease(napiPrebuild, 'N-API prebuild');
  }

  const electronAbi = getElectronAbi();
  if (!electronAbi) {
    console.error(
      'Electron is not installed or its NODE_MODULE_VERSION could not be determined.'
    );
    console.error('Run: pnpm install');
    return 1;
  }

  const legacyPrebuild = legacyAbiPrebuildPath(electronAbi);
  if (fs.existsSync(legacyPrebuild)) {
    return copyPrebuildToRelease(
      legacyPrebuild,
      `Electron ABI ${electronAbi}`
    );
  }

  console.error(
    `Could not find a better-sqlite3 native binary for ${process.platform}-${process.arch}` +
      ` (N-API prebuild or Electron ABI ${electronAbi}).`
  );
  console.error('Run: pnpm install');
  return 1;
}

module.exports = { syncBetterSqlite3Native };

if (require.main === module) {
  process.exit(syncBetterSqlite3Native());
}
