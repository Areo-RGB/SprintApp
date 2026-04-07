import ActionButton from "./ActionButton";

type MonitoringControlsProps = {
  refreshing: boolean;
  fetchState: () => void;
  busyAction: string;
  postControl: (path: string, body?: unknown, actionKey?: string) => Promise<unknown>;
  canStartMonitoring: boolean;
  monitoringActive: boolean;
  saveResultsJson: () => void;
  canSaveResults: boolean;
  triggerRoles: string[];
  fireTrigger: (roleLabel: string) => void;
  triggerDisabled: (roleLabel: string) => boolean;
  triggerActive: (roleLabel: string) => boolean;
  hasStartAssignment: boolean;
  hasStopAssignment: boolean;
  lastSavedFilePath: string | null;
  lastSavedAtIso: string | null;
  formatIsoTime: (iso: string) => string;
};

export default function MonitoringControls({
  refreshing,
  fetchState,
  busyAction,
  postControl,
  canStartMonitoring,
  monitoringActive,
  saveResultsJson,
  canSaveResults,
  triggerRoles,
  fireTrigger,
  triggerDisabled,
  triggerActive,
  hasStartAssignment,
  hasStopAssignment,
  lastSavedFilePath,
  lastSavedAtIso,
  formatIsoTime,
}: MonitoringControlsProps) {
  const splitRoles = triggerRoles.filter((roleLabel) => /^Split\s+\d+$/i.test(roleLabel));
  const startRole = triggerRoles.find((roleLabel) => roleLabel === "Start") ?? "Start";
  const stopRole = triggerRoles.find((roleLabel) => roleLabel === "Stop") ?? "Stop";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap gap-2">
          <ActionButton
            label={refreshing ? "Refreshing..." : "Refresh"}
            onClick={fetchState}
            busy={refreshing}
            variant="secondary"
          />
          <ActionButton
            label={monitoringActive ? "Stop Monitoring" : "Start Monitoring"}
            onClick={() => {
              void postControl(monitoringActive ? "/api/control/stop-monitoring" : "/api/control/start-monitoring");
            }}
            busy={busyAction === "/api/control/start-monitoring" || busyAction === "/api/control/stop-monitoring"}
            disabled={monitoringActive ? false : !canStartMonitoring}
            variant={monitoringActive ? "stop" : "start"}
            active={monitoringActive}
          />
          <ActionButton
            label="Reset Run"
            onClick={() => {
              void postControl("/api/control/reset-run");
            }}
            busy={busyAction === "/api/control/reset-run"}
            variant="secondary"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            label="Save Results JSON"
            onClick={saveResultsJson}
            busy={busyAction === "/api/control/save-results"}
            disabled={!canSaveResults}
            variant="secondary"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <ActionButton
          label={startRole}
          onClick={() => fireTrigger(startRole)}
          busy={busyAction === `trigger:${startRole}`}
          disabled={triggerDisabled(startRole)}
          variant="start"
          active={triggerActive(startRole)}
        />

        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-100 px-1 py-1">
          {splitRoles.map((roleLabel) => (
            <button
              key={roleLabel}
              type="button"
              onClick={() => fireTrigger(roleLabel)}
              disabled={triggerDisabled(roleLabel) || busyAction === `trigger:${roleLabel}`}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                triggerActive(roleLabel)
                  ? "border border-slate-300 bg-white text-slate-800 shadow-sm"
                  : "border border-transparent bg-transparent text-slate-700 hover:bg-slate-200"
              }`}
            >
              {busyAction === `trigger:${roleLabel}` ? "Working..." : roleLabel}
            </button>
          ))}
        </div>

        <ActionButton
          label={stopRole}
          onClick={() => fireTrigger(stopRole)}
          busy={busyAction === `trigger:${stopRole}`}
          disabled={triggerDisabled(stopRole)}
          variant="stop"
          active={triggerActive(stopRole)}
        />
      </div>

      <p className="text-xs text-slate-600">
        Monitoring controls switch stage only. Trigger buttons emit Start, progressive Splits, and Stop packets while monitoring is active.
      </p>
      {!monitoringActive && (!hasStartAssignment || !hasStopAssignment) ? (
        <p className="mt-1 text-xs text-amber-700">
          Assign one device to Start and one device to Stop before starting monitoring.
        </p>
      ) : null}
      {lastSavedFilePath ? (
        <p className="mt-2 break-all text-xs text-slate-500">
          Last saved: {lastSavedFilePath}
          {lastSavedAtIso ? ` (${formatIsoTime(lastSavedAtIso)})` : ""}
        </p>
      ) : null}
    </div>
  );
}
