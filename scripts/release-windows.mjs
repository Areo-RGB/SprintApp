import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const tauriConfigPath = path.join(
  rootDir,
  'apps',
  'windows',
  'desktop-tauri',
  'src-tauri',
  'tauri.conf.json'
);
const cargoTomlPath = path.join(
  rootDir,
  'apps',
  'windows',
  'desktop-tauri',
  'src-tauri',
  'Cargo.toml'
);
const desktopPackageJsonPath = path.join(
  rootDir,
  'apps',
  'windows',
  'desktop-tauri',
  'package.json'
);
const bundleRoot = path.join(
  rootDir,
  'apps',
  'windows',
  'desktop-tauri',
  'src-tauri',
  'target',
  'release',
  'bundle'
);

function bumpPatchVersion(version) {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part) || part < 0)) {
    throw new Error(`Unsupported version format "${version}". Expected numeric semver like 0.1.0`);
  }
  while (parts.length < 3) {
    parts.push(0);
  }
  parts[2] += 1;
  return parts.slice(0, 3).join('.');
}

function updateCargoVersion(content, nextVersion) {
  const packageSectionVersion = /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/m;
  if (!packageSectionVersion.test(content)) {
    throw new Error(`Could not find [package] version in ${cargoTomlPath}`);
  }
  return content.replace(packageSectionVersion, `$1${nextVersion}$3`);
}

function walkFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const all = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      all.push(...walkFiles(fullPath));
    } else {
      all.push(fullPath);
    }
  }
  return all;
}

function pickInstallerAsset() {
  const files = walkFiles(bundleRoot);
  const nsisExe = files.find(
    (filePath) =>
      filePath.toLowerCase().includes(`${path.sep}nsis${path.sep}`) &&
      filePath.toLowerCase().endsWith('.exe')
  );
  if (nsisExe) {
    return nsisExe;
  }

  const setupExe = files.find((filePath) => {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.exe') && lower.includes('setup');
  });
  if (setupExe) {
    return setupExe;
  }

  const msi = files.find((filePath) => filePath.toLowerCase().endsWith('.msi'));
  if (msi) {
    return msi;
  }

  throw new Error(`Could not find a Windows installer asset under ${bundleRoot}`);
}

function run() {
  console.log('Reading Windows version files...');
  const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
  const desktopPackageJson = JSON.parse(fs.readFileSync(desktopPackageJsonPath, 'utf8'));
  const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');

  const currentVersion = String(tauriConfig.version ?? '').trim();
  if (!currentVersion) {
    throw new Error(`Could not read version from ${tauriConfigPath}`);
  }

  const nextVersion = bumpPatchVersion(currentVersion);
  console.log(`Bumping Windows version: ${currentVersion} -> ${nextVersion}`);

  tauriConfig.version = nextVersion;
  desktopPackageJson.version = nextVersion;
  const updatedCargoToml = updateCargoVersion(cargoToml, nextVersion);

  fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf8');
  fs.writeFileSync(desktopPackageJsonPath, `${JSON.stringify(desktopPackageJson, null, 2)}\n`, 'utf8');
  fs.writeFileSync(cargoTomlPath, updatedCargoToml, 'utf8');

  console.log('\nBuilding Windows desktop release...');
  execSync('npm run windows:package:desktop', { stdio: 'inherit', cwd: rootDir });

  const installerPath = pickInstallerAsset();
  console.log(`Installer built: ${installerPath}`);

  console.log('\nCommitting version bump locally...');
  execSync(
    `git add "${tauriConfigPath}" "${cargoTomlPath}" "${desktopPackageJsonPath}"`,
    { stdio: 'inherit', cwd: rootDir }
  );
  execSync(`git commit -m "chore: bump windows version to win-v${nextVersion}"`, {
    stdio: 'inherit',
    cwd: rootDir,
  });

  console.log('\nPushing changes to remote...');
  execSync('git push', { stdio: 'inherit', cwd: rootDir });

  const tagName = `win-v${nextVersion}`;
  const releaseTitle = `Windows Release ${tagName}`;
  console.log(`\nCreating GitHub Release for tag ${tagName}...`);
  execSync(
    `gh release create ${tagName} "${installerPath}" --title "${releaseTitle}" --generate-notes`,
    { stdio: 'inherit', cwd: rootDir }
  );

  console.log('\nWindows release created successfully!');
  console.log(`https://github.com/Areo-RGB/SprintApp/releases/tag/${tagName}`);
}

try {
  run();
} catch (error) {
  console.error('\nAn error occurred during the Windows release process:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
