import {
  formatAcceleration,
  formatDurationNanos,
  formatMeters,
  formatSpeedWithUnit,
} from "../utils";

type RaceTimerPanelProps = {
  raceClockDisplay: string;
  timerStateLabel: string;
  hostStartSensorNanos: number | null;
  hostSplitMarks: Array<unknown>;
  hostStopSensorNanos: number | null;
  monitoringPointRows: Array<{ lap: any; pointSpeedMps: number | null; accelerationMps2: number | null }>;
  speedUnit: string;
  toggleSpeedUnit: () => void;
};

export default function RaceTimerPanel({
  raceClockDisplay,
  timerStateLabel,
  hostStartSensorNanos,
  hostSplitMarks,
  hostStopSensorNanos,
  monitoringPointRows,
  speedUnit,
  toggleSpeedUnit,
}: RaceTimerPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-900 p-6 text-white shadow-lg">
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Race Timer</p>
          <p className="mt-2 font-mono text-6xl font-bold leading-none md:text-8xl">{raceClockDisplay}</p>
          <p className="mt-3 text-sm text-slate-300">
            {timerStateLabel} · Start {hostStartSensorNanos !== null ? "set" : "pending"} · Splits {hostSplitMarks.length}/4 · Stop{" "}
            {hostStopSensorNanos !== null ? "set" : "pending"}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Monitoring Results</p>
          {monitoringPointRows.length === 0 ? (
            <div className="mt-3 rounded-xl border border-slate-700 bg-slate-800 px-5 py-6 text-center text-lg font-semibold text-slate-200">
              Waiting for split/finish results...
            </div>
          ) : (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {monitoringPointRows.map(({ lap, pointSpeedMps, accelerationMps2 }, index) => {
                const checkpointLabel = lap.roleLabel ?? lap.senderDeviceName ?? `Checkpoint ${index + 1}`;
                const isLatest = index === monitoringPointRows.length - 1;
                const speedDisplay = formatSpeedWithUnit(pointSpeedMps, speedUnit);
                const [speedValue, speedUnitLabel] = speedDisplay.split(" ");
                const accelerationDisplay = formatAcceleration(accelerationMps2);
                const [accelerationValue, accelerationUnitLabel] = accelerationDisplay.split(" ");

                return (
                  <div
                    key={`timer-result-${lap.id ?? `${checkpointLabel}-${index}-${lap.elapsedNanos}`}`}
                    className="min-w-[360px] flex-1 rounded-lg border border-slate-600 bg-slate-800/70 px-4 py-4 text-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">
                        {checkpointLabel}
                      </p>
                      {isLatest ? (
                        <span className="rounded-full border border-slate-500 bg-slate-700 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-100">
                          Latest
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Distance</p>
                        <p className="mt-2 font-mono text-4xl font-black leading-none text-white md:text-5xl">
                          {formatMeters(lap.distanceMeters)}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Time</p>
                        <p className="mt-2 font-mono text-4xl font-black leading-none text-white md:text-5xl">
                          {formatDurationNanos(lap.elapsedNanos)}
                        </p>
                      </div>
                    </div>

                    <div className="my-4 border-t border-slate-600" />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Speed</p>
                        <button
                          type="button"
                          onClick={toggleSpeedUnit}
                          className="mt-2 inline-flex items-baseline gap-1.5 font-mono leading-none"
                        >
                          <span className="text-2xl font-bold text-white">{speedValue}</span>
                          {speedUnitLabel ? (
                            <span className="text-base font-semibold text-slate-400">{speedUnitLabel}</span>
                          ) : null}
                        </button>
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Acceleration</p>
                        <p className="mt-2 inline-flex items-baseline gap-1.5 font-mono leading-none">
                          <span className="text-2xl font-bold text-white">{accelerationValue}</span>
                          {accelerationUnitLabel ? (
                            <span className="text-base font-semibold text-slate-400">{accelerationUnitLabel}</span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
