const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'node_modules/electron');

if (!fs.existsSync(electronDir)) {
  console.log('Skipping native rebuild: electron is not installed.');
  process.exit(0);
}

try {
  execSync('pnpm exec electron-rebuild -f -w better-sqlite3,keytar', {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('Native modules rebuilt for Electron.');
} catch (error) {
  console.error('Failed to rebuild native modules for Electron.');
  console.error('Try running: pnpm run rebuild:native');
  process.exit(1);
}
