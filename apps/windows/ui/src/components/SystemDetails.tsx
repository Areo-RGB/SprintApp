import Card from "./Card";
import { stageLabel } from "../utils";

type SystemDetailsProps = {
  stage: string;
  session: any;
  monitoringActive: boolean;
  hostStartSensorNanos: number | null;
  hostSplitMarks: Array<unknown>;
  hostStopSensorNanos: number | null;
  snapshot: any;
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
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-700">
        System Details
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Session Status" subtitle="Current host state">
          <div className="space-y-1 text-sm">
            <p>
              Stage: <span className="font-semibold">{stageLabel(stage)}</span>
            </p>
            <p>
              Run ID: <span className="font-mono text-xs">{session.runId ?? "-"}</span>
            </p>
            <p>
              Monitoring Active: <span className="font-semibold">{monitoringActive ? "Yes" : "No"}</span>
            </p>
            <p>
              Timeline: Start {hostStartSensorNanos !== null ? "set" : "pending"} | Splits {hostSplitMarks.length}/4 | Stop{" "}
              {hostStopSensorNanos !== null ? "set" : "pending"}
            </p>
          </div>
        </Card>

        <Card title="Server Status" subtitle="Runtime and counters">
          <div className="space-y-1 text-sm">
            <p>
              TCP: {snapshot?.server?.tcp?.host ?? "-"}:{snapshot?.server?.tcp?.port ?? "-"}
            </p>
            <p>
              HTTP: {snapshot?.server?.http?.host ?? "-"}:{snapshot?.server?.http?.port ?? "-"}
            </p>
            <p>Connected Clients: {snapshot?.stats?.connectedClients ?? 0}</p>
            <p>Total Frames: {snapshot?.stats?.totalFrames ?? 0}</p>
            <p>Parse Errors: {snapshot?.stats?.parseErrors ?? 0}</p>
          </div>
        </Card>

        <Card title="Clock Domain" subtitle="Host time-domain mapping">
          <p className="text-sm text-slate-700">{snapshot?.clockDomainMapping?.description ?? "Clock-domain status unavailable."}</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
            {snapshot?.clockDomainMapping?.implemented ? "Implemented" : "Not Implemented Yet"}
          </p>
        </Card>
      </div>
    </details>
  );
}
