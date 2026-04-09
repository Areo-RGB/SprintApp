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
import type {
  CompareResultsPayload,
  MonitoringPointRow,
  SavedResultSummary,
  SavedResultsFilePayload,
} from "../api/types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title, SubTitle);

type SavedResultsPanelProps = {
  savedResultsLoading: boolean;
  fetchSavedResultsList: (preferredFileName?: string | null) => void;
  savedResults: SavedResultSummary[];
  selectedSavedFileName: string;
  setSelectedSavedFileName: (fileName: string) => void;
  setSelectedSavedMeta: (item: SavedResultSummary | null) => void;
  savedResultLoading: boolean;
  selectedSavedPayload: SavedResultsFilePayload | null;
  selectedSavedMeta: SavedResultSummary | null;
  savedLatestLapResults: SavedResultsFilePayload["latestLapResults"];
  savedMonitoringPointRows: MonitoringPointRow[];
  compareResultsPayload: CompareResultsPayload | null;
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
  compareResultsPayload,
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
    if (!compareResultsPayload || compareResultsPayload.series.length === 0) {
      return null;
    }

    const labels = compareResultsPayload.labels.length > 0 ? compareResultsPayload.labels : chartLabels;
    if (labels.length === 0) {
      return null;
    }

    const highContrastColors = ["#000000", "#FF1744", "#2962FF", "#00E676", "#FF9100", "#7C4DFF"];
    const datasets = compareResultsPayload.series.map((series, index) => {
      const color = highContrastColors[index % highContrastColors.length];
      return {
        label: series.label,
        data: labels.map((_, labelIndex) => {
          const value = series.valuesSeconds?.[labelIndex];
          return Number.isFinite(value) ? Number(value) : null;
        }),
        borderColor: color,
        backgroundColor: `${color}33`,
        pointBackgroundColor: color,
        pointBorderColor: "#ffffff",
        borderWidth: 4,
        pointRadius: 6,
        pointHoverRadius: 8,
        tension: 0, // Brutalist sharp lines
      };
    });

    const hasAnyData = datasets.some((dataset) =>
      Array.isArray(dataset.data) && dataset.data.some((value) => Number.isFinite(value as number)),
    );
    if (!hasAnyData) {
      return null;
    }

    return {
      labels,
      datasets,
    };
  }, [chartLabels, compareResultsPayload]);

  const comparisonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index" as const,
      intersect: false,
    },
    animation: {
      duration: 0, // Brutalist instant
    },
    plugins: {
      title: {
        display: true,
        position: "top" as const,
        align: "center" as const,
        text: selectedSavedPayload?.resultName ?? selectedSavedMeta?.resultName ?? "Saved Results",
        color: "#000000",
        font: {
          family: "'Space Grotesk', sans-serif",
          size: 24,
          weight: "bold" as const,
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
        text: `Athlete: ${compareResultsPayload?.athleteName ?? selectedSavedPayload?.athleteName ?? selectedSavedMeta?.athleteName ?? "-"}`,
        color: "#000000",
        font: {
          family: "'JetBrains Mono', monospace",
          size: 14,
          weight: "bold" as const,
        },
        padding: {
          bottom: 16,
        },
      },
      legend: {
        display: true,
        labels: {
          color: "#000000",
          font: {
            family: "'Space Grotesk', sans-serif",
            weight: "bold" as const,
          },
          usePointStyle: true,
        },
      },
      tooltip: {
        enabled: true,
        titleColor: "#ffffff",
        bodyColor: "#ffffff",
        backgroundColor: "#000000",
        borderColor: "#000000",
        borderWidth: 2,
        titleFont: {
          family: "'Space Grotesk', sans-serif",
          weight: "bold" as const,
        },
        bodyFont: {
          family: "'JetBrains Mono', monospace",
          weight: "bold" as const,
        },
        cornerRadius: 0,
      },
    },
    scales: {
      x: {
        ticks: { 
          color: "#000000",
          font: {
            family: "'Space Grotesk', sans-serif",
            weight: "bold" as const,
          }
        },
        grid: { color: "rgba(0,0,0,0.1)", lineWidth: 2 },
        border: { color: "#000000", width: 3 },
      },
      y: {
        ticks: { 
          color: "#000000",
          font: {
            family: "'JetBrains Mono', monospace",
            weight: "bold" as const,
          }
        },
        grid: { color: "rgba(0,0,0,0.1)", lineWidth: 2 },
        border: { color: "#000000", width: 3 },
        title: { 
          display: true, 
          text: "TIME (S)", 
          color: "#000000",
          font: {
            family: "'Space Grotesk', sans-serif",
            weight: "bold" as const,
          }
        },
      },
    },
  };

  return (
    <div className="flex gap-4">
      <aside
        className={`shrink-0 overflow-hidden border-[3px] border-black bg-white transition-all duration-200 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${
          isSidebarOpen ? "w-80" : "w-14"
        }`}
      >
        <div className="border-b-[3px] border-black p-2 bg-[#FFEA00]">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((previous) => !previous)}
            className="w-full border-[2px] border-black bg-white px-2 py-2 text-xs font-bold uppercase tracking-widest text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          >
            {isSidebarOpen ? "COLLAPSE" : "SAVED"}
          </button>
        </div>

        {isSidebarOpen ? (
          <div className="space-y-4 p-4">
            <ActionButton
              label={savedResultsLoading ? "REFRESHING..." : "REFRESH LIST"}
              onClick={() => fetchSavedResultsList()}
              busy={savedResultsLoading}
              variant="secondary"
            />
            {savedResults.length === 0 ? (
              <p className="px-1 text-sm font-bold uppercase text-gray-500">No saved results yet.</p>
            ) : (
              <ul className="space-y-3">
                {savedResults.map((item) => (
                  <li key={item.fileName}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSavedFileName(item.fileName);
                        setSelectedSavedMeta(item);
                      }}
                      className={`w-full border-[3px] border-black px-4 py-3 text-left transition-all ${
                        item.fileName === selectedSavedFileName
                          ? "bg-black text-[#FFEA00] shadow-[1px_1px_0px_0px_rgba(0,0,0,0.2)]"
                          : "bg-white text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-100 hover:translate-y-[-2px] hover:shadow-[2px_3px_0px_0px_rgba(0,0,0,1)]"
                      }`}
                    >
                      <div className="text-sm font-bold uppercase tracking-wider">{item.resultName ?? item.fileName}</div>
                      <div className={`mt-1 text-xs font-bold ${item.fileName === selectedSavedFileName ? "text-gray-400" : "text-gray-600"}`}>
                        {item.athleteName ? `${item.athleteName} · ` : ""}
                        {formatIsoTime(item.savedAtIso)}
                      </div>
                      <div className={`mt-1 text-xs font-bold ${item.fileName === selectedSavedFileName ? "text-gray-500" : "text-gray-500"}`}>
                        Results: {item.resultCount ?? 0}
                        {Number.isFinite(item.bestElapsedNanos) ? ` · Best ${formatDurationNanos(item.bestElapsedNanos)}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </aside>

      <div className="min-w-0 flex-1">
        <section className="border-[3px] border-black bg-white p-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
          {savedResultLoading ? (
            <p className="text-sm font-bold uppercase tracking-widest text-black">Loading saved result...</p>
          ) : !selectedSavedPayload ? (
            <p className="text-sm font-bold uppercase tracking-widest text-black">Select a saved result to view details.</p>
          ) : savedLatestLapResults.length === 0 ? (
            <p className="text-sm font-bold uppercase tracking-widest text-black">Saved file has no lap rows.</p>
          ) : (
            <div className="space-y-6">
              {comparisonChartData ? (
                  <div className="space-y-6">
                  <div className="h-[38rem] border-[4px] border-black bg-white p-4 shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] bg-[linear-gradient(to_right,#000_1px,transparent_1px),linear-gradient(to_bottom,#000_1px,transparent_1px)] bg-[size:2rem_2rem]">
                      <div className="h-full w-full bg-white/90 backdrop-blur-sm p-2 border-2 border-black" role="img" aria-label="Historical run comparison chart">
                      <Line data={comparisonChartData} options={comparisonChartOptions} />
                    </div>
                  </div>

                  <div className="border-[3px] border-black bg-white p-4 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    <button
                      type="button"
                      onClick={() => setIsDataTableOpen((previous) => !previous)}
                      className="border-[2px] border-black bg-black px-4 py-2 text-sm font-bold uppercase tracking-widest text-white shadow-[1px_1px_0px_0px_rgba(0,0,0,0.2)] hover:bg-gray-800"
                    >
                      {isDataTableOpen ? "HIDE DATA TABLE" : "SHOW DATA TABLE"}
                    </button>

                    {isDataTableOpen ? (
                      <div className="mt-4 overflow-auto border-[2px] border-black">
                        <table className="min-w-full text-left text-sm" aria-label="Historical comparison table">
                          <thead className="bg-[#FFEA00] text-xs font-bold uppercase tracking-widest text-black border-b-[2px] border-black">
                            <tr>
                              <th className="p-3 border-r-[2px] border-black">Checkpoint</th>
                              {comparisonChartData.datasets.map((dataset) => (
                                <th key={String(dataset.label)} className="p-3 border-r-[2px] border-black last:border-r-0">
                                  {dataset.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y-[2px] divide-black bg-white">
                            {comparisonChartData.labels.map((label, rowIndex) => (
                              <tr key={`${String(label)}-${rowIndex}`}>
                                <td className="p-3 border-r-[2px] border-black font-bold uppercase text-black">{String(label)}</td>
                                {comparisonChartData.datasets.map((dataset) => {
                                  const rawValue = Array.isArray(dataset.data) ? dataset.data[rowIndex] : null;
                                  const value = Number.isFinite(rawValue as number) ? `${Number(rawValue).toFixed(2)}s` : "-";
                                  return (
                                    <td key={`${String(dataset.label)}-${rowIndex}`} className="p-3 border-r-[2px] border-black last:border-r-0 font-mono font-bold text-black">
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
                <p className="text-sm font-bold uppercase tracking-widest text-black">No chart data available.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
