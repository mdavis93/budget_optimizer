'use strict';

const fs = require('fs');
const path = require('path');
const {
  bs3Root,
  rebuiltBinary,
  getElectronAbi,
  getElectronVersion,
  loadsUnderNode,
} = require('./lib/abi.cjs');

function syncBetterSqlite3Native() {
  if (!fs.existsSync(bs3Root)) {
    console.log('better-sqlite3 not installed; skipping native sync.');
    return 0;
  }

  // Prefer an Electron-targeted binary. A Node test rebuild loads under system Node.
  if (fs.existsSync(rebuiltBinary)) {
    if (!loadsUnderNode()) {
      const electronVersion = getElectronVersion() || 'unknown';
      console.log(
        `Using electron-rebuilt better-sqlite3 at ${rebuiltBinary} (Electron ${electronVersion})`
      );
      return 0;
    }

    console.warn(
      'Existing better-sqlite3 binary loads under Node but not Electron; re-syncing from prebuild.'
    );
    fs.rmSync(rebuiltBinary, { force: true });
  }

  const electronAbi = getElectronAbi();
  if (!electronAbi) {
    console.error(
      'Electron is not installed or its NODE_MODULE_VERSION could not be determined.'
    );
    console.error('Run: pnpm install');
    return 1;
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
    console.error('Run: pnpm install');
    return 1;
  }

  const targetDir = path.join(bs3Root, 'build', 'Release');
  const target = path.join(targetDir, 'better_sqlite3.node');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(prebuild, target);
  console.log(
    `Synced better-sqlite3 native binary from ${prebuild} (Electron ABI ${electronAbi})`
  );
  return 0;
}

module.exports = { syncBetterSqlite3Native };

if (require.main === module) {
  process.exit(syncBetterSqlite3Native());
}
