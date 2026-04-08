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
  mergeWithHeader?: boolean;
  withFloatingTabs?: boolean;
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
  mergeWithHeader = false,
  withFloatingTabs = false,
}: RaceTimerPanelProps) {
  return (
    <section
      className={`border-[3px] border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] ${
        mergeWithHeader ? "border-t-0" : ""
      } ${withFloatingTabs ? "pt-20" : ""}`}
    >
      <div className="space-y-8">
        <div className="border-[3px] border-black bg-white p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-center justify-between border-b-[3px] border-black pb-4">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-black">Race Timer</p>
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
          
          <div className="mt-6 flex items-center justify-center border-[4px] border-black bg-[#FFEA00] py-12 shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.15)] relative overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#000_1px,transparent_1px),linear-gradient(to_bottom,#000_1px,transparent_1px)] bg-[size:2rem_2rem] opacity-[0.05]"></div>
            <p className="relative font-mono text-7xl font-black leading-none tracking-tighter text-black md:text-[9rem]">
              {raceClockDisplay}
            </p>
          </div>
          
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm md:gap-8">
            <div className={`flex items-center gap-2 border-[3px] border-black px-5 py-2 font-bold uppercase ${hostStartSensorNanos !== null ? "bg-[#00E676] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "bg-gray-100 text-gray-500"}`}>
              <span>Start</span>
              <span>
                {hostStartSensorNanos !== null ? "Set" : "Pending"}
              </span>
            </div>
            <div className="flex items-center gap-2 border-[3px] border-black bg-white px-5 py-2 font-bold uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <span>Splits</span>
              <span className="text-black">{hostSplitMarks.length}/4</span>
            </div>
            <div className={`flex items-center gap-2 border-[3px] border-black px-5 py-2 font-bold uppercase ${hostStopSensorNanos !== null ? "bg-[#FF1744] text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "bg-gray-100 text-gray-500"}`}>
              <span>Stop</span>
              <span>
                {hostStopSensorNanos !== null ? "Set" : "Pending"}
              </span>
            </div>
          </div>
        </div>

        <div>
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-black">Monitoring Results</p>
          {monitoringPointRows.length === 0 ? (
            <div className="mt-4 border-[3px] border-black bg-gray-100 px-5 py-8 text-center text-lg font-bold uppercase text-gray-500 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              Waiting for split/finish results...
            </div>
          ) : (
            <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
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
                    className="min-w-[360px] flex-1 border-[3px] border-black bg-white px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <div className="mt-2 grid min-h-[170px] grid-rows-[1fr_auto_2fr]">
                      <div className="flex flex-col items-center justify-center text-center">
                        <p className="text-sm font-bold uppercase tracking-[0.2em] text-black">{checkpointLabel}</p>
                        <p className="mt-2 font-mono text-4xl font-black leading-none text-black md:text-5xl">
                          {formatMeters(lap.distanceMeters)}
                        </p>
                      </div>

                      <div className="my-5 h-[3px] w-full bg-black" />

                      <div className="flex items-center justify-center">
                        <p className="inline-flex w-full items-baseline justify-center gap-1.5 text-center font-mono leading-none">
                          <span className="inline-flex items-baseline text-7xl font-black leading-[0.9] text-black md:text-8xl">
                            <span>{timeLeft}</span>
                            {hasDecimal ? <span className="mx-[-0.08em]">.</span> : null}
                            {hasDecimal ? <span>{timeRight}</span> : null}
                          </span>
                          {hasSecondsSuffix ? (
                            <span className="text-5xl font-bold leading-[0.9] text-black md:text-6xl">s</span>
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
