import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { SavedResultSummary } from "./types.js";

interface SavedResultLapLike {
  elapsedNanos?: unknown;
}

interface SavedResultsFilePayload {
  resultName?: unknown;
  athleteName?: unknown;
  notes?: unknown;
  runId?: unknown;
  exportedAtIso?: unknown;
  latestLapResults?: SavedResultLapLike[];
}

export function sanitizeFileNameSegment(rawName: unknown): string {
  const normalized = String(rawName ?? "").trim();
  const stripped = normalized.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!stripped) {
    return "results";
  }

  return stripped.slice(0, 80);
}

export function isSafeSavedResultsFileName(fileName: string): boolean {
  return /^[a-zA-Z0-9._-]+\.json$/u.test(fileName);
}

export async function loadSavedResultsFile(
  resultsDir: string,
  fileName: string,
): Promise<{ fileName: string; filePath: string; payload: unknown } | null> {
  if (!isSafeSavedResultsFileName(fileName)) {
    return null;
  }

  const filePath = path.join(resultsDir, fileName);
  try {
    const rawContent = await fs.readFile(filePath, "utf8");
    const payload = JSON.parse(rawContent);
    return {
      fileName,
      filePath,
      payload,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function summarizeSavedResults(
  fileName: string,
  filePath: string,
  payload: SavedResultsFilePayload,
  stat: fsSync.Stats,
): SavedResultSummary {
  const latestLapResults = Array.isArray(payload?.latestLapResults) ? payload.latestLapResults : [];
  const bestLap = latestLapResults.find((lap) => Number.isFinite(Number(lap?.elapsedNanos)));

  return {
    fileName,
    filePath,
    resultName: String(payload?.resultName ?? fileName.replace(/\.json$/iu, "")),
    athleteName: typeof payload?.athleteName === "string" ? payload.athleteName : null,
    notes: typeof payload?.notes === "string" ? payload.notes : null,
    runId: typeof payload?.runId === "string" ? payload.runId : null,
    savedAtIso:
      typeof payload?.exportedAtIso === "string" && payload.exportedAtIso.length > 0
        ? payload.exportedAtIso
        : new Date(stat.mtimeMs).toISOString(),
    resultCount: latestLapResults.length,
    bestElapsedNanos: bestLap ? Number(bestLap.elapsedNanos) : null,
  };
}

export async function listSavedResultItems(resultsDir: string): Promise<SavedResultSummary[]> {
  await fs.mkdir(resultsDir, { recursive: true });
  const dirEntries = await fs.readdir(resultsDir, { withFileTypes: true });
  const savedFiles = dirEntries.filter((entry) => entry.isFile() && isSafeSavedResultsFileName(entry.name));

  const items: SavedResultSummary[] = [];
  for (const entry of savedFiles) {
    const filePath = path.join(resultsDir, entry.name);
    try {
      const [rawContent, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
      const payload = JSON.parse(rawContent);
      items.push(summarizeSavedResults(entry.name, filePath, payload, stat));
    } catch {
      // Ignore unreadable or malformed files to keep listing resilient.
    }
  }

  return items.sort((left, right) => String(right.savedAtIso).localeCompare(String(left.savedAtIso)));
}
