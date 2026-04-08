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
    <div className="border-[3px] border-black bg-white p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b-[3px] border-black pb-5">
        <div className="flex flex-wrap gap-3">
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
        <div className="flex flex-wrap gap-3">
          <ActionButton
            label="Save Results JSON"
            onClick={saveResultsJson}
            busy={busyAction === "/api/control/save-results"}
            disabled={!canSaveResults}
            variant="secondary"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <ActionButton
          label={startRole}
          onClick={() => fireTrigger(startRole)}
          busy={busyAction === `trigger:${startRole}`}
          disabled={triggerDisabled(startRole)}
          variant="start"
          active={triggerActive(startRole)}
        />

        <div className="inline-flex items-center gap-1 border-[3px] border-black bg-gray-100 p-1 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          {splitRoles.map((roleLabel) => (
            <button
              key={roleLabel}
              type="button"
              onClick={() => fireTrigger(roleLabel)}
              disabled={triggerDisabled(roleLabel) || busyAction === `trigger:${roleLabel}`}
              className={`px-5 py-2 text-sm font-bold uppercase tracking-widest transition-colors disabled:opacity-50 ${
                triggerActive(roleLabel)
                  ? "border-[2px] border-black bg-white text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  : "border-[2px] border-transparent bg-transparent text-gray-600 hover:bg-gray-200"
              }`}
            >
              {busyAction === `trigger:${roleLabel}` ? "WORKING..." : roleLabel}
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

      <p className="text-xs font-bold uppercase tracking-wide text-gray-600">
        Monitoring controls switch stage only. Trigger buttons emit Start, progressive Splits, and Stop packets while monitoring is active.
      </p>
      {!monitoringActive && (!hasStartAssignment || !hasStopAssignment) ? (
        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-[#FF1744]">
          Assign one device to Start and one device to Stop before starting monitoring.
        </p>
      ) : null}
      {lastSavedFilePath ? (
        <p className="mt-3 break-all text-xs font-bold uppercase tracking-wide text-gray-500">
          Last saved: {lastSavedFilePath}
          {lastSavedAtIso ? ` (${formatIsoTime(lastSavedAtIso)})` : ""}
        </p>
      ) : null}
    </div>
  );
}
