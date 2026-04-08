export const ROLE_ORDER = ["Unassigned", "Start", "Split 1", "Split 2", "Split 3", "Split 4", "Stop"] as const;

const SPLIT_ROLE_OPTIONS = ["Split 1", "Split 2", "Split 3", "Split 4"] as const;

export function roleOrderIndex(roleLabel: string): number {
  const index = ROLE_ORDER.indexOf(roleLabel as (typeof ROLE_ORDER)[number]);
  return index === -1 ? ROLE_ORDER.length : index;
}

export function normalizeAthleteNameForResult(rawAthleteName: unknown): string | null {
  const normalized = String(rawAthleteName ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const compacted = normalized.replace(/\s+/g, "_").replace(/[^a-z0-9_-]+/g, "").replace(/^_+|_+$/g, "");
  if (!compacted) {
    return null;
  }

  return compacted.slice(0, 40);
}

export function normalizeAthleteNameDraft(rawAthleteName: unknown): string {
  return normalizeAthleteNameForResult(rawAthleteName) ?? "";
}

export function formatDateForResultName(rawDate: string | number | Date): string {
  const date = new Date(rawDate);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}_${month}_${year}`;
}

export function computeProgressiveRoleOptions(assignedRoles: Iterable<string>): string[] {
  const assigned = new Set<string>();
  for (const role of assignedRoles) {
    if (typeof role === "string" && role.length > 0) {
      assigned.add(role);
    }
  }

  let unlockedSplitCount = 1;
  while (unlockedSplitCount < SPLIT_ROLE_OPTIONS.length && assigned.has(SPLIT_ROLE_OPTIONS[unlockedSplitCount - 1])) {
    unlockedSplitCount += 1;
  }

  const options = [
    "Unassigned",
    "Start",
    ...SPLIT_ROLE_OPTIONS.slice(0, unlockedSplitCount),
    "Stop",
  ];

  for (const assignedRole of assigned) {
    if (SPLIT_ROLE_OPTIONS.includes(assignedRole as (typeof SPLIT_ROLE_OPTIONS)[number]) && !options.includes(assignedRole)) {
      options.push(assignedRole);
    }
  }

  return options.sort((left, right) => roleOrderIndex(left) - roleOrderIndex(right));
}
