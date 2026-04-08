import { execSync } from "node:child_process";

const PORT = 9000;

function getListeningPids(port) {
  const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const columns = trimmed.split(/\s+/);
    if (columns.length < 5) continue;

    const localAddress = columns[1] ?? "";
    const state = (columns[3] ?? "").toUpperCase();
    const pid = columns[4] ?? "";

    if (!localAddress.endsWith(`:${port}`)) continue;
    if (state !== "LISTENING") continue;
    if (!/^\d+$/.test(pid)) continue;

    pids.add(pid);
  }

  return [...pids];
}

function killPid(pid) {
  execSync(`taskkill /PID ${pid} /F`, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

try {
  if (process.platform !== "win32") {
    console.log(`[windows:kill:port:9000] Skipping: current platform is ${process.platform}.`);
    process.exit(0);
  }

  let pids = [];
  try {
    pids = getListeningPids(PORT);
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const output = `${stdout}\n${stderr}`.trim();

    if (output && !/no matches found/i.test(output)) {
      throw error;
    }
  }

  if (pids.length === 0) {
    console.log(`[windows:kill:port:9000] No LISTENING process found on TCP ${PORT}.`);
    process.exit(0);
  }

  for (const pid of pids) {
    try {
      killPid(pid);
      console.log(`[windows:kill:port:9000] Killed PID ${pid} on TCP ${PORT}.`);
    } catch (error) {
      const message = typeof error?.message === "string" ? error.message : String(error);
      console.error(`[windows:kill:port:9000] Failed to kill PID ${pid}: ${message}`);
      process.exit(1);
    }
  }
} catch (error) {
  const message = typeof error?.message === "string" ? error.message : String(error);
  console.error(`[windows:kill:port:9000] Error: ${message}`);
  process.exit(1);
}
