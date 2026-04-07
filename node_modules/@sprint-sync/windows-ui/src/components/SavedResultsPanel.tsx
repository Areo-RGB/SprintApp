import ActionButton from "./ActionButton";
import Card from "./Card";
import {
  formatAcceleration,
  formatDurationNanos,
  formatIsoTime,
  formatMeters,
  formatSpeedWithUnit,
} from "../utils";

type SavedResultsPanelProps = {
  savedResultsLoading: boolean;
  fetchSavedResultsList: (preferredFileName?: string | null) => void;
  savedResults: any[];
  selectedSavedFileName: string;
  setSelectedSavedFileName: (fileName: string) => void;
  setSelectedSavedMeta: (item: any) => void;
  savedResultLoading: boolean;
  selectedSavedPayload: any;
  selectedSavedMeta: any;
  savedLatestLapResults: any[];
  savedMonitoringPointRows: Array<{ lap: any; pointSpeedMps: number | null; accelerationMps2: number | null }>;
  speedUnit: string;
  toggleSpeedUnit: () => void;
};

export default function SavedResultsPanel({
  savedResultsLoading,
  fetchSavedResultsList,
  savedResults,
  selectedSavedFileName,
  setSelectedSavedFileName,
  setSelectedSavedMeta,
  savedResultLoading,
  selectedSavedPayload,
  selectedSavedMeta,
  savedLatestLapResults,
  savedMonitoringPointRows,
  speedUnit,
  toggleSpeedUnit,
}: SavedResultsPanelProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card title="Saved Results" subtitle="Browse and open locally saved result files">
        <div className="mb-3 flex gap-2">
          <ActionButton
            label={savedResultsLoading ? "Refreshing..." : "Refresh List"}
            onClick={() => fetchSavedResultsList()}
            busy={savedResultsLoading}
            variant="secondary"
          />
        </div>

        {savedResults.length === 0 ? (
          <p className="text-sm text-slate-500">No saved results yet.</p>
        ) : (
          <ul className="space-y-2">
            {savedResults.map((item) => (
              <li key={item.fileName}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSavedFileName(item.fileName);
                    setSelectedSavedMeta(item);
                  }}
                  className={`w-full rounded-md border px-3 py-2 text-left ${
                    item.fileName === selectedSavedFileName
                      ? "border-slate-700 bg-slate-700 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-800"
                  }`}
                >
                  <div className="text-sm font-semibold">{item.resultName ?? item.fileName}</div>
                  <div className="text-xs opacity-80">
                    {item.athleteName ? `${item.athleteName} · ` : ""}
                    {formatIsoTime(item.savedAtIso)}
                  </div>
                  <div className="text-xs opacity-80">
                    Results: {item.resultCount ?? 0}
                    {Number.isFinite(item.bestElapsedNanos) ? ` · Best ${formatDurationNanos(item.bestElapsedNanos)}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="xl:col-span-2">
        <Card title="Saved Result Details" subtitle="No overlays; open and review directly in this tab">
          {savedResultLoading ? (
            <p className="text-sm text-slate-500">Loading saved result...</p>
          ) : !selectedSavedPayload ? (
            <p className="text-sm text-slate-500">Select a saved result to view details.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-2">
                <p>
                  Name: <span className="font-semibold">{selectedSavedPayload.resultName ?? selectedSavedMeta?.resultName ?? "-"}</span>
                </p>
                <p>
                  Athlete: <span className="font-semibold">{selectedSavedPayload.athleteName ?? "-"}</span>
                </p>
                <p>
                  Saved: <span className="font-semibold">{formatIsoTime(selectedSavedPayload.exportedAtIso)}</span>
                </p>
                <p>
                  Run ID: <span className="font-mono text-xs">{selectedSavedPayload.runId ?? "-"}</span>
                </p>
              </div>

              {selectedSavedPayload.notes ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Notes: {selectedSavedPayload.notes}
                </p>
              ) : null}

              {savedLatestLapResults.length === 0 ? (
                <p className="text-sm text-slate-500">Saved file has no lap rows.</p>
              ) : (
                <div className="overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="pb-2 pr-3">Distance</th>
                        <th className="pb-2 pr-3">Time</th>
                        <th className="pb-2 pr-3">Speed</th>
                        <th className="pb-2">Acceleration (m/s^2)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {savedMonitoringPointRows.map(({ lap, pointSpeedMps, accelerationMps2 }, index) => {
                        return (
                          <tr key={lap.id ?? `${lap.roleLabel ?? "lap"}-${index}`}>
                            <td className="py-2 pr-3 text-slate-700">{formatMeters(lap.distanceMeters)}</td>
                            <td className="py-2 pr-3 font-mono text-slate-900">{formatDurationNanos(lap.elapsedNanos)}</td>
                            <td className="py-2 pr-3 text-slate-700">
                              <button
                                type="button"
                                onClick={toggleSpeedUnit}
                                className="font-mono"
                              >
                                {formatSpeedWithUnit(pointSpeedMps, speedUnit)}
                              </button>
                            </td>
                            <td className="py-2 text-slate-700">{formatAcceleration(accelerationMps2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
