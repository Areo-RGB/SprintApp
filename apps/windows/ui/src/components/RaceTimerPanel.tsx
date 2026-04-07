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
          <p className="mt-2 font-mono text-5xl font-bold leading-none md:text-7xl">{raceClockDisplay}</p>
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
            <div className="mt-3 space-y-3">
              {monitoringPointRows.map(({ lap, pointSpeedMps, accelerationMps2 }, index) => {
                const checkpointLabel = lap.roleLabel ?? lap.senderDeviceName ?? `Checkpoint ${index + 1}`;
                const isLatest = index === monitoringPointRows.length - 1;

                return (
                  <div
                    key={`timer-result-${lap.id ?? `${checkpointLabel}-${index}-${lap.elapsedNanos}`}`}
                    className={`rounded-lg border px-4 py-4 ${
                      isLatest ? "border-amber-300 bg-amber-50/95 text-slate-900" : "border-slate-600 bg-slate-800/70 text-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p
                        className={`text-sm font-semibold uppercase tracking-[0.16em] ${
                          isLatest ? "text-amber-800" : "text-slate-300"
                        }`}
                      >
                        {checkpointLabel}
                      </p>
                      {isLatest ? (
                        <span className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                          Latest
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <p
                          className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                            isLatest ? "text-amber-700" : "text-slate-400"
                          }`}
                        >
                          Distance
                        </p>
                        <p
                          className={`mt-2 font-mono font-black leading-none ${
                            isLatest ? "text-6xl text-slate-950 md:text-7xl" : "text-5xl text-white md:text-6xl"
                          }`}
                        >
                          {formatMeters(lap.distanceMeters)}
                        </p>
                      </div>

                      <div>
                        <p
                          className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                            isLatest ? "text-amber-700" : "text-slate-400"
                          }`}
                        >
                          Time
                        </p>
                        <p
                          className={`mt-2 font-mono font-black leading-none ${
                            isLatest ? "text-6xl text-slate-950 md:text-7xl" : "text-5xl text-white md:text-6xl"
                          }`}
                        >
                          {formatDurationNanos(lap.elapsedNanos)}
                        </p>
                      </div>

                      <div>
                        <p
                          className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                            isLatest ? "text-amber-700" : "text-slate-400"
                          }`}
                        >
                          Speed ({speedUnit === "kmh" ? "km/h" : "m/s"})
                        </p>
                        <button
                          type="button"
                          onClick={toggleSpeedUnit}
                          className={`mt-2 font-mono text-3xl font-bold leading-none underline decoration-dotted underline-offset-2 ${
                            isLatest ? "text-slate-900" : "text-white"
                          }`}
                        >
                          {formatSpeedWithUnit(pointSpeedMps, speedUnit)}
                        </button>
                      </div>

                      <div>
                        <p
                          className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                            isLatest ? "text-amber-700" : "text-slate-400"
                          }`}
                        >
                          Acceleration
                        </p>
                        <p
                          className={`mt-2 font-mono text-3xl font-bold leading-none ${
                            isLatest ? "text-slate-900" : "text-white"
                          }`}
                        >
                          {formatAcceleration(accelerationMps2)}
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
