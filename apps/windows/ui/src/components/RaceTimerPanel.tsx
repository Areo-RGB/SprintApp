import {
  formatAcceleration,
  formatDurationNanos,
  formatMeters,
  formatSpeedWithUnit,
} from "../utils";
import ActionButton from "./ActionButton";

type RaceTimerPanelProps = {
  raceClockDisplay: string;
  timerStateLabel: string;
  activeTab: string;
  onOpenSavedResults: () => void;
  busyAction: string;
  postControl: (path: string, body?: unknown, actionKey?: string) => Promise<unknown>;
  canStartMonitoring: boolean;
  monitoringActive: boolean;
  saveResultsJson: () => void;
  canSaveResults: boolean;
  monitoringPointRows: Array<{ lap: any; pointSpeedMps: number | null; accelerationMps2: number | null }>;
  speedUnit: string;
  toggleSpeedUnit: () => void;
  mergeWithHeader?: boolean;
  withFloatingTabs?: boolean;
};

export default function RaceTimerPanel({
  raceClockDisplay,
  timerStateLabel,
  activeTab,
  onOpenSavedResults,
  busyAction,
  postControl,
  canStartMonitoring,
  monitoringActive,
  saveResultsJson,
  canSaveResults,
  monitoringPointRows,
  speedUnit,
  toggleSpeedUnit,
  mergeWithHeader = false,
  withFloatingTabs = false,
}: RaceTimerPanelProps) {
  return (
    <section
      className={`border-[3px] border-black bg-white p-6 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${
        mergeWithHeader ? "border-t-0" : ""
      } ${withFloatingTabs ? "pt-20" : ""}`}
    >
      <div className="space-y-8">
        <div className="border-[3px] border-black bg-white p-6 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-[3px] border-black pb-4">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-black">Race Timer</p>
            <nav className="inline-flex items-center gap-2 border-[3px] border-black bg-white p-1 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              <button
                type="button"
                className={`px-5 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
                  activeTab === "live" ? "bg-black text-[#FFEA00]" : "text-black hover:bg-gray-100"
                }`}
              >
                Live Monitor
              </button>
              <button
                type="button"
                onClick={onOpenSavedResults}
                className={`px-5 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
                  activeTab === "saved" ? "bg-black text-[#FFEA00]" : "text-black hover:bg-gray-100"
                }`}
              >
                Saved Results
              </button>
            </nav>
            <div className="flex items-center gap-2 text-sm font-bold uppercase text-black">
              <span className="relative flex h-3 w-3">
                {timerStateLabel === "Monitoring" && (
                  <span className="absolute inline-flex h-full w-full animate-ping border-2 border-black bg-[#00E676] opacity-75"></span>
                )}
                <span className={`relative inline-flex h-3 w-3 border-2 border-black ${timerStateLabel === "Monitoring" ? "bg-[#00E676]" : "bg-gray-300"}`}></span>
              </span>
              {timerStateLabel}
            </div>
          </div>
          
          <div className="mt-6 flex items-center justify-center border-[4px] border-black bg-[#FFEA00] py-12 shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.15)] relative overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#000_1px,transparent_1px),linear-gradient(to_bottom,#000_1px,transparent_1px)] bg-[size:2rem_2rem] opacity-[0.05]"></div>
            <p className="relative font-mono text-7xl font-black leading-none tracking-tighter text-black md:text-[9rem]">
              {raceClockDisplay}
            </p>
          </div>
          
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t-[3px] border-black pt-5">
            <div className="flex flex-wrap gap-3">
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

          {monitoringPointRows.length === 0 ? (
            <p className="mt-5 text-sm font-bold uppercase text-gray-500">
              No monitoring results recorded yet.
            </p>
          ) : (
            <div className="mt-5 overflow-auto border-[2px] border-black">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#FFEA00] text-xs font-bold uppercase tracking-widest text-black border-b-[2px] border-black">
                  <tr>
                    <th className="p-3 border-r-[2px] border-black">Distance</th>
                    <th className="p-3 border-r-[2px] border-black">Time</th>
                    <th className="p-3 border-r-[2px] border-black">Speed</th>
                    <th className="p-3">Acceleration (m/s^2)</th>
                  </tr>
                </thead>
                <tbody className="divide-y-[2px] divide-black bg-white">
                  {monitoringPointRows.map(({ lap, pointSpeedMps, accelerationMps2 }) => {
                    return (
                      <tr key={lap.id}>
                        <td className="p-3 border-r-[2px] border-black font-bold uppercase text-black">{formatMeters(lap.distanceMeters)}</td>
                        <td className="p-3 border-r-[2px] border-black font-mono font-bold text-black">{formatDurationNanos(lap.elapsedNanos)}</td>
                        <td className="p-3 border-r-[2px] border-black font-bold text-black">
                          <button type="button" onClick={toggleSpeedUnit} className="font-mono hover:text-[#FF1744] transition-colors">
                            {formatSpeedWithUnit(pointSpeedMps ?? 0, speedUnit)}
                          </button>
                        </td>
                        <td className="p-3 font-bold text-black">{formatAcceleration(accelerationMps2 ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
