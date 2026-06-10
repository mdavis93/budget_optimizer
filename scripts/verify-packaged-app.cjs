const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const platform = process.platform === 'darwin' ? 'mac-arm64' : process.platform;
const appName = process.platform === 'darwin' ? 'Budget Optimizer.app' : 'Budget Optimizer.exe';
const appDir = path.join(root, 'release', platform, appName);

if (!fs.existsSync(appDir)) {
  console.error('Packaged app not found:', appDir);
  process.exit(1);
}

const binary =
  process.platform === 'darwin'
    ? path.join(appDir, 'Contents/MacOS/Budget Optimizer')
    : path.join(appDir, 'Budget Optimizer.exe');

const asarPath = path.join(appDir, 'Contents/Resources/app.asar');
const asarCli = path.join(root, 'node_modules/@electron/asar/bin/asar.js');

const requiredAsarPaths = [
  '/node_modules/bindings/',
  '/node_modules/file-uri-to-path/',
  '/node_modules/better-sqlite3/',
  '/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
];

if (fs.existsSync(asarPath) && fs.existsSync(asarCli)) {
  const list = spawnSync(process.execPath, [asarCli, 'list', asarPath], {
    encoding: 'utf8',
  });
  const asarListing = list.stdout || '';
  for (const required of requiredAsarPaths) {
    if (!asarListing.includes(required)) {
      console.error(`Packaged asar is missing ${required}`);
      process.exit(1);
    }
  }
}

const resourcesPath = path.join(appDir, 'Contents/Resources');
const verifyCode = `
  try {
    const path = require('path');
    const bs3 = path.join(process.resourcesPath, 'app.asar/node_modules/better-sqlite3');
    const Database = require(bs3);
    const db = new Database(':memory:');
    db.close();
    console.log('PACKAGED_DB_OK');
    process.exit(0);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
`;

const result = spawnSync(binary, ['-e', verifyCode], {
  encoding: 'utf8',
  timeout: 60000,
  cwd: os.tmpdir(),
  env: { ...process.env, NODE_PATH: '' },
});

const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

if (result.status !== 0 || !output.includes('PACKAGED_DB_OK')) {
  console.error('Packaged SQLite verification failed.');
  if (output) console.error(output);
  process.exit(1);
}

console.log('Packaged SQLite verification passed.');
