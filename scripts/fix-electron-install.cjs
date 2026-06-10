const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const electronDir = path.resolve(__dirname, '../node_modules/electron');
const { version } = require(path.join(electronDir, 'package.json'));
const checksums = require(path.join(electronDir, 'checksums.json'));
const distPath = path.resolve(electronDir, 'dist');
const platformPath = 'Electron.app/Contents/MacOS/Electron';

function findPnpmPackage(name) {
  const pnpmDir = path.resolve(__dirname, '../node_modules/.pnpm');
  const folder = fs.readdirSync(pnpmDir).find((entry) => entry.startsWith(`${name}@`));
  if (!folder) {
    throw new Error(`Could not find pnpm package matching ${name}`);
  }
  const nodeModules = path.join(pnpmDir, folder, 'node_modules');
  if (name.includes('+')) {
    return path.join(nodeModules, name.replace('+', '/'));
  }
  return path.join(nodeModules, name);
}

async function extractZip(zipPath, targetDir) {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    execSync(`unzip -qo "${zipPath}" -d "${targetDir}"`, { stdio: 'inherit' });
    return;
  }

  const extract = require(findPnpmPackage('extract-zip'));
  await extract(zipPath, { dir: targetDir });
}

async function main() {
  const { downloadArtifact } = require(findPnpmPackage('@electron+get'));

  fs.rmSync(distPath, { recursive: true, force: true });
  fs.rmSync(path.join(electronDir, 'path.txt'), { force: true });
  fs.mkdirSync(distPath, { recursive: true });

  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    force: true,
    checksums,
    platform: process.platform,
    arch: process.arch,
  });

  const zipSize = fs.statSync(zipPath).size;
  console.log('Downloaded zip:', zipPath, `(${zipSize} bytes)`);

  if (zipSize < 50_000_000) {
    throw new Error('Electron zip looks too small; download may be corrupt');
  }

  await extractZip(zipPath, distPath);

  const appPath = path.join(distPath, 'Electron.app');
  const binaryPath = path.join(appPath, 'Contents', 'MacOS', 'Electron');
  if (!fs.existsSync(binaryPath)) {
    throw new Error('Electron binary missing after extract');
  }

  const appSize = execSync(`du -sh "${appPath}"`).toString().trim();
  console.log('Extracted:', appSize);

  if (appSize.includes('K')) {
    throw new Error(`Electron.app is too small (${appSize}); extract likely failed`);
  }

  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath);
  console.log('Created path.txt — Electron install fixed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
