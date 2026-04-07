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
            <div className="mt-3 rounded-xl border border-slate-500 bg-slate-100 px-5 py-6 text-center text-lg font-semibold text-slate-200">
              Waiting for split/finish results...
            </div>
          ) : (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {monitoringPointRows.map(({ lap, pointSpeedMps, accelerationMps2 }, index) => {
                const checkpointLabel = lap.roleLabel ?? lap.senderDeviceName ?? `Checkpoint ${index + 1}`;
                const timeDisplay = formatDurationNanos(lap.elapsedNanos);
                const timeValue = timeDisplay.endsWith("s") ? timeDisplay.slice(0, -1) : timeDisplay;
                const hasSecondsSuffix = timeDisplay.endsWith("s");
                const [timeLeft, timeRight] = timeValue.split(".");
                const hasDecimal = typeof timeRight === "string" && timeRight.length > 0;

                return (
                  <div
                    key={`timer-result-${lap.id ?? `${checkpointLabel}-${index}-${lap.elapsedNanos}`}`}
                    className="min-w-[360px] flex-1 rounded-lg border border-slate-500 bg-slate-100 px-4 py-4 text-white"
                  >
                    <div className="mt-4 grid min-h-[170px] grid-rows-[0.75fr_auto_2.25fr]">
                      <div className="flex flex-col justify-center">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8ea2bf]">{checkpointLabel}</p>
                        <p className="mt-2 font-mono text-4xl font-semibold leading-none text-slate-400 md:text-5xl">
                          {formatMeters(lap.distanceMeters)}
                        </p>
                      </div>

                      <div className="my-4 h-px w-full bg-slate-500/70" />

                      <div className="flex items-center justify-center">
                        <p className="inline-flex w-full items-baseline justify-center gap-1.5 text-center font-mono leading-none">
                          <span className="inline-flex items-baseline text-7xl font-black text-white md:text-8xl">
                            <span>{timeLeft}</span>
                            {hasDecimal ? <span className="mx-[-0.08em]">.</span> : null}
                            {hasDecimal ? <span>{timeRight}</span> : null}
                          </span>
                          {hasSecondsSuffix ? (
                            <span className="text-5xl font-semibold text-slate-400 md:text-6xl">s</span>
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
