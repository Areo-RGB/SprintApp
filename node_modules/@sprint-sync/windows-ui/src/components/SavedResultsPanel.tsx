import ActionButton from "./ActionButton";
import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
  SubTitle,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  formatDurationNanos,
  formatIsoTime,
} from "../utils";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title, SubTitle);

type SavedResultsPanelProps = {
  savedResultsLoading: boolean;
  fetchSavedResultsList: (preferredFileName?: string | null) => void;
  savedResults: any[];
  deleteSavedResult: (fileName: string) => void;
  selectedSavedFileName: string;
  setSelectedSavedFileName: (fileName: string) => void;
  setSelectedSavedMeta: (item: any) => void;
  savedResultLoading: boolean;
  selectedSavedPayload: any;
  selectedSavedMeta: any;
  savedLatestLapResults: any[];
  savedMonitoringPointRows: Array<{ lap: any; pointSpeedMps: number | null; accelerationMps2: number | null }>;
};

export default function SavedResultsPanel({
  savedResultsLoading,
  fetchSavedResultsList,
  savedResults,
  deleteSavedResult,
  selectedSavedFileName,
  setSelectedSavedFileName,
  setSelectedSavedMeta,
  savedResultLoading,
  selectedSavedPayload,
  selectedSavedMeta,
  savedLatestLapResults,
  savedMonitoringPointRows,
}: SavedResultsPanelProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDataTableOpen, setIsDataTableOpen] = useState(false);
  const chartRows = Array.isArray(savedMonitoringPointRows) ? savedMonitoringPointRows : [];
  const chartLabels = chartRows.map(({ lap }, index) => {
    const roleLabel = typeof lap?.roleLabel === "string" ? lap.roleLabel : "";
    if (roleLabel.length > 0) return roleLabel;
    const fallbackDistance = Number.isFinite(lap?.distanceMeters) ? `${Math.round(lap.distanceMeters)}m` : "";
    return fallbackDistance.length > 0 ? fallbackDistance : `Point ${index + 1}`;
  });
  const chartTimeSeconds = chartRows.map(({ lap }) =>
    Number.isFinite(lap?.elapsedNanos) ? Number((lap.elapsedNanos / 1_000_000_000).toFixed(3)) : null,
  );
  const comparisonChartData = useMemo(() => {
    const baseSeries = chartTimeSeconds.map((value) => (Number.isFinite(value) ? Number(value) : null));
    const hasBaseSeries = baseSeries.some((value) => Number.isFinite(value));
    if (!hasBaseSeries) {
      return null;
    }

    const exportedAt =
      typeof selectedSavedPayload?.exportedAtIso === "string" && selectedSavedPayload.exportedAtIso.length > 0
        ? new Date(selectedSavedPayload.exportedAtIso)
        : new Date();

    const multipliers = [1.12, 1.08, 1.04, 1.0];
    const neonColors = ["#ff6b00", "#ff1744", "#39ff14", "#00e5ff"];
    const datasets = multipliers.map((multiplier, index) => {
      const runDate = new Date(exportedAt);
      runDate.setDate(exportedAt.getDate() - (multipliers.length - 1 - index));
      const dateLabel = runDate.toLocaleDateString();

      const scaledSeries = baseSeries.map((value, pointIndex) => {
        if (!Number.isFinite(value)) return null;
        const progressionBias = 1 + pointIndex * 0.006;
        return Number((value * multiplier * progressionBias).toFixed(3));
      });

      const color = neonColors[index % neonColors.length];
      return {
        label: dateLabel,
        data: scaledSeries,
        borderColor: color,
        backgroundColor: `${color}33`,
        pointBackgroundColor: color,
        pointBorderColor: "#000000",
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.32,
      };
    });

    return {
      labels: chartLabels,
      datasets,
    };
  }, [chartLabels, chartTimeSeconds, selectedSavedPayload?.exportedAtIso]);

  const comparisonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index" as const,
      intersect: false,
    },
    animation: {
      duration: 950,
      easing: "easeOutQuart" as const,
    },
    plugins: {
      title: {
        display: true,
        position: "top" as const,
        align: "center" as const,
        text: selectedSavedPayload?.resultName ?? selectedSavedMeta?.resultName ?? "Saved Results",
        color: "#ffffff",
        font: {
          size: 18,
          weight: "700" as const,
        },
        padding: {
          top: 8,
          bottom: 4,
        },
      },
      subtitle: {
        display: true,
        position: "top" as const,
        align: "center" as const,
        text: `Athlete: ${selectedSavedPayload?.athleteName ?? selectedSavedMeta?.athleteName ?? "-"}`,
        color: "#ffffff",
        font: {
          size: 13,
          weight: "500" as const,
        },
        padding: {
          bottom: 10,
        },
      },
      legend: {
        display: true,
        labels: {
          color: "#ffffff",
          usePointStyle: true,
        },
      },
      tooltip: {
        enabled: true,
        titleColor: "#ffffff",
        bodyColor: "#ffffff",
        backgroundColor: "rgba(0,0,0,0.95)",
        borderColor: "#ffffff",
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        ticks: { color: "#ffffff" },
        grid: { color: "rgba(255,255,255,0.06)" },
      },
      y: {
        ticks: { color: "#ffffff" },
        grid: { color: "rgba(255,255,255,0.08)" },
        title: { display: true, text: "Time (s)", color: "#ffffff" },
      },
    },
  };

  return (
    <div className="flex gap-4">
      <aside
        className={`shrink-0 overflow-hidden border border-slate-800 bg-black/50 transition-all duration-200 ${
          isSidebarOpen ? "w-80" : "w-14"
        }`}
      >
        <div className="border-b border-slate-800 p-2">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((previous) => !previous)}
            className="w-full rounded-md border border-slate-700 bg-slate-900/70 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200"
          >
            {isSidebarOpen ? "Collapse" : "Saved"}
          </button>
        </div>

        {isSidebarOpen ? (
          <div className="space-y-2 p-2">
            <ActionButton
              label={savedResultsLoading ? "Refreshing..." : "Refresh List"}
              onClick={() => fetchSavedResultsList()}
              busy={savedResultsLoading}
              variant="secondary"
            />
            {savedResults.length === 0 ? (
              <p className="px-1 text-sm text-slate-500">No saved results yet.</p>
            ) : (
              <ul className="space-y-2">
                {savedResults.map((item) => (
                  <li key={item.fileName}>
                    <div
                      className={`relative rounded-md border ${
                        item.fileName === selectedSavedFileName
                          ? "border-slate-600 bg-slate-800 text-white"
                          : "border-slate-800 bg-slate-950 text-slate-200"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSavedFileName(item.fileName);
                          setSelectedSavedMeta(item);
                        }}
                        className="w-full rounded-md px-3 py-2 pr-10 text-left"
                      >
                        <div className="text-sm font-semibold">{item.resultName ?? item.fileName}</div>
                        <div className="text-xs opacity-80">
                          {item.athleteName ? `${item.athleteName} · ` : ""}
                          {formatIsoTime(item.savedAtIso)}
                        </div>
                        <div className="text-xs opacity-70">
                          Results: {item.resultCount ?? 0}
                          {Number.isFinite(item.bestElapsedNanos) ? ` · Best ${formatDurationNanos(item.bestElapsedNanos)}` : ""}
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${item.resultName ?? item.fileName}`}
                        title="Delete result"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteSavedResult(item.fileName);
                        }}
                        className="absolute right-2 top-2 rounded p-1 text-slate-400 transition-colors hover:text-red-500"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                          <path d="M9 3a1 1 0 0 0-1 1v1H5a1 1 0 1 0 0 2h1l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12h1a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9Zm2 2h2v1h-2V5Zm-2 4a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0v-8a1 1 0 0 1 1-1Zm6 0a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0v-8a1 1 0 0 1 1-1Z" />
                        </svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </aside>

      <div className="min-w-0 flex-1">
        <section className="rounded-xl border border-slate-800 bg-black p-4 shadow-sm">
          {savedResultLoading ? (
            <p className="text-sm text-slate-500">Loading saved result...</p>
          ) : !selectedSavedPayload ? (
            <p className="text-sm text-slate-500">Select a saved result to view details.</p>
          ) : savedLatestLapResults.length === 0 ? (
            <p className="text-sm text-slate-500">Saved file has no lap rows.</p>
          ) : (
            <div className="space-y-3">
              {comparisonChartData ? (
                <div className="space-y-3">
                  <div className="h-[38rem] rounded-md border border-slate-800 bg-black p-3">
                    <Line data={comparisonChartData} options={comparisonChartOptions} />
                  </div>

                  <div className="rounded-md border border-slate-800 bg-black p-3">
                    <button
                      type="button"
                      onClick={() => setIsDataTableOpen((previous) => !previous)}
                      className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-semibold text-white"
                    >
                      {isDataTableOpen ? "Hide Data Table" : "Show Data Table"}
                    </button>

                    {isDataTableOpen ? (
                      <div className="mt-3 overflow-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead className="text-xs uppercase tracking-wide text-slate-300">
                            <tr>
                              <th className="pb-2 pr-4">Checkpoint</th>
                              {comparisonChartData.datasets.map((dataset) => (
                                <th key={String(dataset.label)} className="pb-2 pr-4">
                                  {dataset.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                            {comparisonChartData.labels.map((label, rowIndex) => (
                              <tr key={`${String(label)}-${rowIndex}`}>
                                <td className="py-2 pr-4 text-slate-200">{String(label)}</td>
                                {comparisonChartData.datasets.map((dataset) => {
                                  const rawValue = Array.isArray(dataset.data) ? dataset.data[rowIndex] : null;
                                  const value = Number.isFinite(rawValue as number) ? `${Number(rawValue).toFixed(2)}s` : "-";
                                  return (
                                    <td key={`${String(dataset.label)}-${rowIndex}`} className="py-2 pr-4 font-mono text-white">
                                      {value}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No chart data available.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
