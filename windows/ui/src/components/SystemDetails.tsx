import Card from "./Card";
import { stageLabel } from "../utils";
import type { SessionSplitMark, SessionSnapshot, Snapshot } from "../api/types";

type SystemDetailsProps = {
  stage: string;
  session: SessionSnapshot;
  monitoringActive: boolean;
  hostStartSensorNanos: number | null;
  hostSplitMarks: SessionSplitMark[];
  hostStopSensorNanos: number | null;
  snapshot: Snapshot | null;
};

export default function SystemDetails({
  stage,
  session,
  monitoringActive,
  hostStartSensorNanos,
  hostSplitMarks,
  hostStopSensorNanos,
  snapshot,
}: SystemDetailsProps) {
  return (
    <details className="border-[3px] border-black bg-white p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
      <summary className="cursor-pointer text-sm font-bold uppercase tracking-widest text-black hover:text-[#FF1744] transition-colors">
        System Details
      </summary>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Session Status" subtitle="Current host state">
          <div className="space-y-2 text-sm font-bold text-black">
            <p>
              STAGE: <span className="text-[#FF1744]">{stageLabel(stage)}</span>
            </p>
            <p>
              RUN ID: <span className="font-mono text-xs bg-gray-200 px-1">{session.runId ?? "-"}</span>
            </p>
            <p>
              MONITORING ACTIVE: <span className={monitoringActive ? "text-[#00E676]" : "text-[#FF1744]"}>{monitoringActive ? "YES" : "NO"}</span>
            </p>
            <p className="text-xs uppercase tracking-wide">
              Timeline: Start {hostStartSensorNanos !== null ? "SET" : "PENDING"} | Splits {hostSplitMarks.length}/4 | Stop{" "}
              {hostStopSensorNanos !== null ? "SET" : "PENDING"}
            </p>
          </div>
        </Card>

        <Card title="Server Status" subtitle="Runtime and counters">
          <div className="space-y-2 text-sm font-bold text-black font-mono">
            <p>
              TCP: {snapshot?.server?.tcp?.host ?? "-"}:{snapshot?.server?.tcp?.port ?? "-"}
            </p>
            <p>
              HTTP: {snapshot?.server?.http?.host ?? "-"}:{snapshot?.server?.http?.port ?? "-"}
            </p>
            <p>CLIENTS: {snapshot?.stats?.connectedClients ?? 0}</p>
            <p>FRAMES: {snapshot?.stats?.totalFrames ?? 0}</p>
            <p>ERRORS: {snapshot?.stats?.parseErrors ?? 0}</p>
          </div>
        </Card>

        <Card title="Clock Domain" subtitle="Host time-domain mapping">
          <p className="text-sm font-bold text-black">{snapshot?.clockDomainMapping?.description ?? "Clock-domain status unavailable."}</p>
          <p className={`mt-3 text-xs font-bold uppercase tracking-widest ${snapshot?.clockDomainMapping?.implemented ? "text-[#00E676]" : "text-[#FF1744]"}`}>
            {snapshot?.clockDomainMapping?.implemented ? "IMPLEMENTED" : "NOT IMPLEMENTED YET"}
          </p>
        </Card>
      </div>
    </details>
  );
}
