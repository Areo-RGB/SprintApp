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
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap gap-2">
        <ActionButton
          label={refreshing ? "Refreshing..." : "Refresh"}
          onClick={fetchState}
          busy={refreshing}
          variant="secondary"
        />
        <ActionButton
          label="Start Monitoring"
          onClick={() => {
            void postControl("/api/control/start-monitoring");
          }}
          busy={busyAction === "/api/control/start-monitoring"}
          disabled={!canStartMonitoring}
          variant="start"
          active={monitoringActive}
        />
        <ActionButton
          label="Stop Monitoring"
          onClick={() => {
            void postControl("/api/control/stop-monitoring");
          }}
          busy={busyAction === "/api/control/stop-monitoring"}
          disabled={!monitoringActive}
          variant="stop"
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
        <ActionButton
          label="Save Results JSON"
          onClick={saveResultsJson}
          busy={busyAction === "/api/control/save-results"}
          disabled={!canSaveResults}
          variant="secondary"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {triggerRoles.map((roleLabel) => (
          <ActionButton
            key={roleLabel}
            label={roleLabel}
            onClick={() => fireTrigger(roleLabel)}
            busy={busyAction === `trigger:${roleLabel}`}
            disabled={triggerDisabled(roleLabel)}
            variant={roleLabel === "Start" ? "start" : roleLabel === "Stop" ? "stop" : "secondary"}
            active={triggerActive(roleLabel)}
          />
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Monitoring controls switch stage only. Trigger buttons emit Start, progressive Splits, and Stop packets while monitoring is active.
      </p>
      {!monitoringActive && (!hasStartAssignment || !hasStopAssignment) ? (
        <p className="mt-2 text-xs text-amber-700">
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
