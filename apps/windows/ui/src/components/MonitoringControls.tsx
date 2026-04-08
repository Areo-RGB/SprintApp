import ActionButton from "./ActionButton";

type MonitoringControlsProps = {
  busyAction: string;
  monitoringActive: boolean;
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
  busyAction,
  monitoringActive,
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
  const showManualTriggerControls = import.meta.env.DEV;
  const splitRoles = triggerRoles.filter((roleLabel) => /^Split\s+\d+$/i.test(roleLabel));
  const startRole = triggerRoles.find((roleLabel) => roleLabel === "Start") ?? "Start";
  const stopRole = triggerRoles.find((roleLabel) => roleLabel === "Stop") ?? "Stop";

  return (
    <div className="border-[3px] border-black bg-white p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
      {showManualTriggerControls ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <ActionButton
              label={startRole}
              onClick={() => fireTrigger(startRole)}
              busy={busyAction === `trigger:${startRole}`}
              disabled={triggerDisabled(startRole)}
              variant="start"
              active={triggerActive(startRole)}
            />

            <div className="inline-flex items-center gap-1 border-[3px] border-black bg-gray-100 p-1 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              {splitRoles.map((roleLabel) => (
                <button
                  key={roleLabel}
                  type="button"
                  onClick={() => fireTrigger(roleLabel)}
                  disabled={triggerDisabled(roleLabel) || busyAction === `trigger:${roleLabel}`}
                  className={`px-5 py-2 text-sm font-bold uppercase tracking-widest transition-colors disabled:opacity-50 ${
                    triggerActive(roleLabel)
                      ? "border-[2px] border-black bg-white text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
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
        </>
      ) : null}
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
