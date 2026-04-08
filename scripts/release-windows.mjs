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
const tauriConfigRepoPath = 'apps/windows/desktop-tauri/src-tauri/tauri.conf.json';
const cargoTomlRepoPath = 'apps/windows/desktop-tauri/src-tauri/Cargo.toml';
const desktopPackageJsonRepoPath = 'apps/windows/desktop-tauri/package.json';

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

function pickInstallerAssets(nextVersion) {
  const files = walkFiles(bundleRoot);
  const normalizedVersion = `_${nextVersion}_`;

  const nsisCandidates = files.filter((filePath) => {
    const lower = filePath.toLowerCase();
    return lower.includes(`${path.sep}nsis${path.sep}`) && lower.endsWith('-setup.exe');
  });
  const msiCandidates = files.filter((filePath) => {
    const lower = filePath.toLowerCase();
    return lower.includes(`${path.sep}msi${path.sep}`) && lower.endsWith('.msi');
  });

  const pickNewestCandidate = (candidates) => {
    if (candidates.length === 0) return null;
    const exact = candidates.filter((filePath) =>
      path.basename(filePath).toLowerCase().includes(normalizedVersion.toLowerCase()),
    );
    const pool = exact.length > 0 ? exact : candidates;
    return pool
      .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0].filePath;
  };

  const nsisExe = pickNewestCandidate(nsisCandidates);
  const msi = pickNewestCandidate(msiCandidates);

  const assets = [];
  if (nsisExe) {
    assets.push(nsisExe);
  }
  if (msi) {
    assets.push(msi);
  }
  if (assets.length > 0) {
    return assets;
  }

  throw new Error(`Could not find Windows installer assets under ${bundleRoot}`);
}

function hasStagedChanges() {
  try {
    execSync('git diff --cached --quiet', { cwd: rootDir, stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

function releaseTagExists(tagName) {
  try {
    execSync(`gh release view ${tagName}`, { cwd: rootDir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function quoteShellArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
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

  const installerAssets = pickInstallerAssets(nextVersion);
  console.log(`Installer assets built:\n${installerAssets.map((asset) => `  - ${asset}`).join('\n')}`);

  console.log('\nCommitting version bump locally...');
  execSync(
    `git add -- "${tauriConfigRepoPath}" "${cargoTomlRepoPath}" "${desktopPackageJsonRepoPath}"`,
    { stdio: 'inherit', cwd: rootDir }
  );

  if (hasStagedChanges()) {
    execSync(`git commit -m "chore: bump windows version to win-v${nextVersion}"`, {
      stdio: 'inherit',
      cwd: rootDir,
    });
  } else {
    console.log('No version-file changes staged; continuing without creating a new commit.');
  }

  console.log('\nPushing changes to remote...');
  execSync('git push', { stdio: 'inherit', cwd: rootDir });

  const tagName = `win-v${nextVersion}`;
  const releaseTitle = `Windows Release ${tagName}`;
  const assetArgs = installerAssets.map((assetPath) => quoteShellArg(assetPath)).join(' ');
  if (releaseTagExists(tagName)) {
    console.log(`\nRelease ${tagName} already exists; uploading assets with --clobber...`);
    execSync(`gh release upload ${tagName} ${assetArgs} --clobber`, {
      stdio: 'inherit',
      cwd: rootDir,
    });
  } else {
    console.log(`\nCreating GitHub Release for tag ${tagName}...`);
    execSync(
      `gh release create ${tagName} ${assetArgs} --title "${releaseTitle}" --generate-notes`,
      { stdio: 'inherit', cwd: rootDir }
    );
  }

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
