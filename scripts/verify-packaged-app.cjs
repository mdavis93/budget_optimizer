const { spawnSync } = require('child_process');
const asar = require('@electron/asar');
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

const forbiddenAsarPaths = [
  '/node_modules/exceljs/',
];

const forbiddenPatterns = ['7289/ingest', '#region agent log', 'debug-f84ef2', 'VITE_DEV_SERVER_URL'];

function readAsarListing() {
  if (!fs.existsSync(asarPath) || !fs.existsSync(asarCli)) {
    return '';
  }

  const list = spawnSync(process.execPath, [asarCli, 'list', asarPath], {
    encoding: 'utf8',
  });
  return list.stdout || '';
}

function readPackagedMainSource() {
  try {
    return asar.extractFile(asarPath, 'dist-electron/main.js').toString('utf8');
  } catch (error) {
    console.error('Failed to read packaged dist-electron/main.js from asar.');
    console.error(error.message || error);
    process.exit(1);
  }
}

function usesExternalExceljs(mainSource) {
  return /require\(["']exceljs["']\)/.test(mainSource);
}

function runElectronNodeVerify(label, verifyCode, expectedToken) {
  const result = spawnSync(binary, ['-e', verifyCode], {
    encoding: 'utf8',
    timeout: 60000,
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      NODE_PATH: '',
      ELECTRON_RUN_AS_NODE: '1',
    },
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

  if (result.status !== 0 || !output.includes(expectedToken)) {
    console.error(`Packaged ${label} verification failed.`);
    if (result.signal) {
      console.error(`Process terminated by signal: ${result.signal}`);
    }
    if (result.status != null && result.status !== 0) {
      console.error(`Exit code: ${result.status}`);
    }
    if (output) console.error(output);
    else if (!result.signal && result.status == null) {
      console.error('No output from packaged app (did the GUI launch instead of headless verify?)');
    }
    process.exit(1);
  }

  console.log(`Packaged ${label} verification passed.`);
}

function verifyBundledExceljs(mainSource) {
  if (usesExternalExceljs(mainSource)) {
    console.error('Packaged dist-electron/main.js still externalizes exceljs.');
    process.exit(1);
  }

  if (!mainSource.includes('generateXlsx') || !mainSource.includes('openxmlformats')) {
    console.error('Packaged dist-electron/main.js is missing bundled spreadsheet export code.');
    process.exit(1);
  }

  console.log('Packaged exceljs bundle verification passed.');
}

const asarListing = readAsarListing();

if (asarListing) {
  for (const required of requiredAsarPaths) {
    if (!asarListing.includes(required)) {
      console.error(`Packaged asar is missing ${required}`);
      process.exit(1);
    }
  }

  for (const forbidden of forbiddenAsarPaths) {
    if (asarListing.includes(forbidden)) {
      console.error(`Packaged asar should not include ${forbidden} when exceljs is bundled`);
      process.exit(1);
    }
  }

  for (const pattern of forbiddenPatterns) {
    if (asarListing.includes(pattern)) {
      console.error(`Packaged asar contains forbidden pattern: ${pattern}`);
      process.exit(1);
    }
  }
}

verifyBundledExceljs(readPackagedMainSource());

try {
  asar.extractFile(asarPath, 'dist-electron/schedule-worker.js');
  console.log('Packaged schedule-worker.js verification passed.');
} catch (error) {
  console.error('Packaged dist-electron/schedule-worker.js is missing from asar.');
  console.error(error.message || error);
  process.exit(1);
}

runElectronNodeVerify(
  'SQLite',
  `
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
`,
  'PACKAGED_DB_OK'
);
