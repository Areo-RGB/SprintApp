import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function fail(message, detail = '') {
  console.error(message);
  if (detail.trim().length > 0) {
    console.error(detail.trim());
  }
  process.exit(1);
}

function warn(message, detail = '') {
  console.warn(message);
  if (detail.trim().length > 0) {
    console.warn(detail.trim());
  }
}

function canRun(command) {
  const probe = spawnSync(command, ['version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return !probe.error;
}

function resolveAdbCommand() {
  const candidates = [process.env.ADB_BIN, process.env.ADB_PATH, 'adb', 'adb.exe'];
  const sdkRoots = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME].filter(Boolean);
  for (const sdkRoot of sdkRoots) {
    candidates.push(resolve(sdkRoot, 'platform-tools', 'adb'));
    candidates.push(resolve(sdkRoot, 'platform-tools', 'adb.exe'));
  }

  if (process.platform === 'linux') {
    const windowsUsers = new Set([process.env.USER].filter(Boolean));
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const segments = userProfile.replace(/\\/g, '/').split('/').filter(Boolean);
      if (segments.length > 0) {
        windowsUsers.add(segments[segments.length - 1]);
      }
    }
    for (const user of windowsUsers) {
      candidates.push(`/mnt/c/Users/${user}/AppData/Local/Android/Sdk/platform-tools/adb.exe`);
    }
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) {
        return candidate;
      }
      continue;
    }
    if (canRun(candidate)) {
      return candidate;
    }
  }

  fail(
    'Unable to locate adb/adb.exe. Set ADB_BIN to your adb path (for WSL usually /mnt/c/Users/<you>/AppData/Local/Android/Sdk/platform-tools/adb.exe).',
  );
}

const adbCommand = resolveAdbCommand();

const packageName = 'sync.sprint';
const apkCandidates = [
  resolve(process.cwd(), 'apps', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
  resolve(process.cwd(), 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
  // Legacy fallback for older custom Gradle layout.
  resolve(process.cwd(), 'build', 'app', 'outputs', 'apk', 'release', 'app-release.apk'),
];
const apkPath = apkCandidates.find((path) => existsSync(path));

if (!apkPath) {
  fail(
    `Release APK not found in expected paths:\n- ${apkCandidates.join('\n- ')}\nRun "npm run build:release:apk" first.`,
  );
}

function toAdbFilePath(filePath) {
  if (!adbCommand.toLowerCase().endsWith('.exe')) {
    return filePath;
  }

  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) {
    return filePath;
  }

  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
}

function readDeclaredPermissions() {
  const manifestCandidates = [
    resolve(process.cwd(), 'apps', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    resolve(process.cwd(), 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    resolve(process.cwd(), 'app', 'src', 'main', 'AndroidManifest.xml'),
  ];

  for (const manifestPath of manifestCandidates) {
    if (!existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifestText = readFileSync(manifestPath, 'utf8');
      const matches = [...manifestText.matchAll(/<uses-permission\b[^>]*\bandroid:name="([^"]+)"/g)];
      const permissions = Array.from(new Set(matches.map((match) => match[1]).filter(Boolean)));

      if (permissions.length > 0) {
        console.log(`Loaded ${permissions.length} declared permission(s) from ${manifestPath}.`);
      } else {
        warn(`No declared permissions found in ${manifestPath}; skipping permission grants.`);
      }

      return permissions;
    } catch (error) {
      warn(
        `Failed to read permissions from ${manifestPath}; skipping permission grants.`,
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  }

  warn('AndroidManifest.xml not found in expected paths; skipping permission grants.');
  return [];
}

const declaredPermissions = readDeclaredPermissions();

function grantDeclaredPermissionsBestEffort(connectedDeviceId, label) {
  if (declaredPermissions.length === 0) {
    return;
  }

  console.log(`Granting declared permissions on ${label} (${connectedDeviceId})...`);
  for (const permission of declaredPermissions) {
    try {
      const grantResult = run(adbCommand, ['-s', connectedDeviceId, 'shell', 'pm', 'grant', packageName, permission]);
      const grantOutput = `${grantResult.stdout}\n${grantResult.stderr}`.trim();

      if (grantResult.status === 0) {
        console.log(`Granted ${permission} on ${label}.`);
        continue;
      }

      warn(
        `Could not grant ${permission} on ${label}; continuing.`,
        grantOutput,
      );
    } catch (error) {
      warn(
        `Grant command crashed for ${permission} on ${label}; continuing.`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function resolveConnectedDeviceId(expectedDeviceId, onlineDeviceIds) {
  if (onlineDeviceIds.has(expectedDeviceId)) {
    return expectedDeviceId;
  }

  const tlsPrefix = `adb-${expectedDeviceId}-`;
  for (const deviceId of onlineDeviceIds) {
    if (deviceId.startsWith(tlsPrefix) && deviceId.includes('._adb-tls-connect._tcp')) {
      return deviceId;
    }
  }

  return null;
}

const installs = [
  {
    label: 'Pad 7 host',
    deviceId: process.env.ADB_DEVICE_PAD ?? '4c637b9e',
  },
  {
    label: 'Pixel 7 client',
    deviceId: process.env.ADB_DEVICE_PIXEL ?? '31071FDH2008FK',
  },
  {
    label: 'OnePlus client',
    deviceId: process.env.ADB_DEVICE_ONEPLUS ?? 'DMIFHU7HUG9PKVVK',
  },
  {
    label: 'Huawei client',
    deviceId: process.env.ADB_DEVICE_HUAWEI ?? 'UBV0218316007905',
  },
  {
    label: 'Xiaomi client',
    deviceId: process.env.ADB_DEVICE_XIAOMI ?? '29fec8f8',
  },
];

const adbDevices = run(adbCommand, ['devices']);
if (adbDevices.status !== 0) {
  fail('Failed to run "adb devices".', adbDevices.stderr);
}

const onlineDevices = new Set(
  adbDevices.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('\tdevice'))
    .map((line) => line.split('\t')[0]),
);

let processedDeviceCount = 0;
let successDeviceCount = 0;
let failedDeviceCount = 0;

for (const entry of installs) {
  const connectedDeviceId = resolveConnectedDeviceId(entry.deviceId, onlineDevices);
  if (!connectedDeviceId) {
    console.log(
      `Skipping ${entry.label}: device not online (${entry.deviceId}). ` +
      `Online devices: ${Array.from(onlineDevices).join(', ') || '(none)'}`,
    );
    continue;
  }

  if (connectedDeviceId !== entry.deviceId) {
    console.log(`Resolved ${entry.label} ${entry.deviceId} -> ${connectedDeviceId}`);
  }

  processedDeviceCount += 1;

  try {
    console.log(`Stopping ${entry.label} (${packageName}) if running...`);
    const stopResult = run(adbCommand, ['-s', connectedDeviceId, 'shell', 'am', 'force-stop', packageName]);
    const stopOutput = `${stopResult.stdout}\n${stopResult.stderr}`.trim();
    if (stopResult.status !== 0) {
      throw new Error(`Failed to stop app before reinstall.\n${stopOutput}`.trim());
    }

    const packageListResult = run(adbCommand, ['-s', connectedDeviceId, 'shell', 'pm', 'list', 'packages', packageName]);
    const packageListOutput = `${packageListResult.stdout}\n${packageListResult.stderr}`.trim();
    if (packageListResult.status !== 0) {
      throw new Error(`Failed to check installed package.\n${packageListOutput}`.trim());
    }

    const isInstalled = packageListResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes(`package:${packageName}`);

    if (isInstalled) {
      console.log(`Uninstalling existing ${packageName} from ${entry.label}...`);
      const uninstallResult = run(adbCommand, ['-s', connectedDeviceId, 'uninstall', packageName]);
      const uninstallOutput = `${uninstallResult.stdout}\n${uninstallResult.stderr}`.trim();
      const uninstallSuccess = uninstallResult.status === 0 && uninstallOutput.includes('Success');
      if (!uninstallSuccess) {
        throw new Error(`Uninstall failed.\n${uninstallOutput}`.trim());
      }
      console.log(`Uninstall success for ${entry.label}.`);
    } else {
      console.log(`${packageName} is not currently installed on ${entry.label}; skipping uninstall.`);
    }

    console.log(`Installing ${entry.label} on ${connectedDeviceId}...`);
    const installResult = run(adbCommand, ['-s', connectedDeviceId, 'install', toAdbFilePath(apkPath)]);
    const output = `${installResult.stdout}\n${installResult.stderr}`.trim();
    const success = installResult.status === 0 && output.includes('Success');
    if (!success) {
      throw new Error(`Install failed.\n${output}`.trim());
    }
    console.log(`Install success for ${entry.label}.`);

    // Permission grants are intentionally best-effort and should never stop device deployment.
    grantDeclaredPermissionsBestEffort(connectedDeviceId, entry.label);

    console.log(`Launching ${entry.label} (${packageName})...`);
    const launchResult = run(adbCommand, [
      '-s',
      connectedDeviceId,
      'shell',
      'monkey',
      '-p',
      packageName,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ]);
    const launchOutput = `${launchResult.stdout}\n${launchResult.stderr}`.trim();
    const launchSuccess =
      launchResult.status === 0 &&
      !launchOutput.includes('No activities found to run');
    if (!launchSuccess) {
      throw new Error(`Launch failed.\n${launchOutput}`.trim());
    }

    console.log(`Launch success for ${entry.label}.`);
    successDeviceCount += 1;
  } catch (error) {
    failedDeviceCount += 1;
    const detail = error instanceof Error ? error.message : String(error);
    warn(
      `Device pass failed for ${entry.label} (${connectedDeviceId}); continuing to next device.`,
      detail,
    );
  }
}

console.log(
  `Install/launch pass finished. Processed=${processedDeviceCount}, ` +
  `Succeeded=${successDeviceCount}, Failed=${failedDeviceCount}, ` +
  `Skipped=${installs.length - processedDeviceCount}.`,
);
