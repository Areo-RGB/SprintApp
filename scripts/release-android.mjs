import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const buildGradlePath = path.join(rootDir, 'apps', 'android', 'app', 'build.gradle.kts');

function run() {
  console.log('Reading build.gradle.kts...');
  if (!fs.existsSync(buildGradlePath)) {
    console.error(`Could not find build.gradle.kts at ${buildGradlePath}`);
    process.exit(1);
  }

  let gradleContent = fs.readFileSync(buildGradlePath, 'utf8');

  // Parse versionCode
  const versionCodeMatch = gradleContent.match(/versionCode\s*=\s*(\d+)/);
  if (!versionCodeMatch) {
    console.error('Could not find versionCode in build.gradle.kts');
    process.exit(1);
  }
  const currentVersionCode = parseInt(versionCodeMatch[1], 10);
  const newVersionCode = currentVersionCode + 1;

  // Parse versionName
  const versionNameMatch = gradleContent.match(/versionName\s*=\s*"([^"]+)"/);
  if (!versionNameMatch) {
    console.error('Could not find versionName in build.gradle.kts');
    process.exit(1);
  }
  const currentVersionName = versionNameMatch[1];

  // Bump patch version in versionName (e.g., 1.0.0 -> 1.0.1)
  const versionParts = currentVersionName.split('.');
  if (versionParts.length === 3) {
    versionParts[2] = (parseInt(versionParts[2], 10) + 1).toString();
  } else if (versionParts.length === 2) {
    versionParts[1] = (parseInt(versionParts[1], 10) + 1).toString();
  } else {
    versionParts[0] = (parseInt(versionParts[0], 10) + 1).toString();
  }
  const newVersionName = versionParts.join('.');

  console.log(`Bumping versionCode: ${currentVersionCode} -> ${newVersionCode}`);
  console.log(`Bumping versionName: ${currentVersionName} -> ${newVersionName}`);

  // Replace in content
  gradleContent = gradleContent.replace(
    /versionCode\s*=\s*\d+/,
    `versionCode = ${newVersionCode}`
  );
  gradleContent = gradleContent.replace(
    /versionName\s*=\s*"[^"]+"/,
    `versionName = "${newVersionName}"`
  );

  fs.writeFileSync(buildGradlePath, gradleContent, 'utf8');
  console.log('build.gradle.kts updated successfully.');

  try {
    // Build release APK
    console.log('\nBuilding release APK...');
    execSync('npm run build:release:apk', { stdio: 'inherit', cwd: rootDir });

    // Check if the APK exists
    const apkPath = path.join(rootDir, 'apps', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    if (!fs.existsSync(apkPath)) {
      console.error(`\nError: APK not found at expected path: ${apkPath}`);
      process.exit(1);
    }
    console.log(`APK built successfully at: ${apkPath}`);

    // IMPORTANT: It's best to commit the version bump before creating the GitHub release,
    // so the tag is created on the commit containing the bumped versions.
    console.log('\nCommitting version bump locally...');
    execSync(`git add "${buildGradlePath}"`, { stdio: 'inherit', cwd: rootDir });
    execSync(`git commit -m "chore: bump android version to v${newVersionCode} (${newVersionName})"`, { stdio: 'inherit', cwd: rootDir });

    console.log('\nPushing changes to remote...');
    execSync('git push', { stdio: 'inherit', cwd: rootDir });

    // Create GitHub release
    const tagName = `v${newVersionCode}`;
    const releaseTitle = `Release ${tagName} (${newVersionName})`;

    console.log(`\nCreating GitHub Release for tag ${tagName}...`);
    // Create the tag and release, uploading the APK
    const ghCmd = `gh release create ${tagName} "${apkPath}" --title "${releaseTitle}" --generate-notes`;
    execSync(ghCmd, { stdio: 'inherit', cwd: rootDir });

    console.log('\nRelease created successfully!');
    console.log(`https://github.com/Areo-RGB/SprintApp/releases/tag/${tagName}`);
  } catch (error) {
    console.error('\nAn error occurred during the release process:');
    console.error(error.message);
    process.exit(1);
  }
}

run();
