const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bs3Root = path.join(root, 'node_modules/better-sqlite3');

if (!fs.existsSync(bs3Root)) {
  console.log('better-sqlite3 not installed; skipping native sync.');
  process.exit(0);
}

const electronVersion = process.versions.modules || '119';
const platform = `${process.platform}-${process.arch}-${electronVersion}`;
const prebuildCandidates = [
  path.join(bs3Root, 'bin', platform, 'better-sqlite3.node'),
  path.join(bs3Root, 'bin', `${process.platform}-${process.arch}-119`, 'better-sqlite3.node'),
  path.join(bs3Root, 'build', 'Release', 'better_sqlite3.node'),
];

const prebuild = prebuildCandidates.find((candidate) => fs.existsSync(candidate));
if (!prebuild) {
  console.error('Could not find a better-sqlite3 native binary to sync.');
  process.exit(1);
}

const targetDir = path.join(bs3Root, 'build', 'Release');
const target = path.join(targetDir, 'better_sqlite3.node');
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(prebuild, target);
console.log(`Synced better-sqlite3 native binary from ${prebuild}`);
