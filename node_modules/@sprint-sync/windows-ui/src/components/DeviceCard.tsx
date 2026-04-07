import ActionButton from "./ActionButton";
import { formatMeters } from "../utils";

type DeviceCardProps = {
  client: any;
  targetId: string;
  assignedRole: string;
  monitoringActive: boolean;
  busyAction: string;
  actionKey: string;
  cameraActionKey: string;
  sensitivityActionKey: string;
  distanceActionKey: string;
  resyncActionKey: string;
  cameraFacing: "front" | "rear";
  latencyLabel: string;
  syncLabel: string;
  clientRoleOptions: string[];
  sensitivityDraft: string;
  distanceDraft: string;
  effectiveSensitivity: number;
  effectiveDistance: number;
  assignRole: (targetId: string, role: string) => void;
  toggleCameraFacing: (targetId: string, cameraFacing: "front" | "rear") => void;
  updateSensitivityDraft: (targetId: string, value: string, fallback: number) => void;
  updateDistanceDraft: (targetId: string, value: string, fallback: number) => void;
  requestDeviceClockResync: (targetId: string) => void;
};

export default function DeviceCard({
  client,
  targetId,
  assignedRole,
  monitoringActive,
  busyAction,
  actionKey,
  cameraActionKey,
  sensitivityActionKey,
  distanceActionKey,
  resyncActionKey,
  cameraFacing,
  latencyLabel,
  syncLabel,
  clientRoleOptions,
  sensitivityDraft,
  distanceDraft,
  effectiveSensitivity,
  effectiveDistance,
  assignRole,
  toggleCameraFacing,
  updateSensitivityDraft,
  updateDistanceDraft,
  requestDeviceClockResync,
}: DeviceCardProps) {
  return (
    <div key={client.endpointId} className="min-w-[320px] flex-1 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-sm font-semibold text-slate-900">{client.deviceName ?? "Unknown device"}</div>
      <div className="mb-2 font-mono text-xs text-slate-500">{targetId}</div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Role
          {monitoringActive ? (
            <p className="mt-1 rounded border border-slate-200 bg-white px-2 py-2 text-center text-sm text-slate-700">{assignedRole}</p>
          ) : (
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-center text-sm"
              value={assignedRole}
              disabled={busyAction === actionKey}
              onChange={(event) => assignRole(targetId, event.target.value)}
            >
              {clientRoleOptions.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Distance (m)
          <input
            type="number"
            min={0}
            max={100000}
            step={0.1}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-center text-sm text-slate-700"
            value={distanceDraft}
            disabled={busyAction === distanceActionKey}
            onChange={(event) => updateDistanceDraft(targetId, event.target.value, effectiveDistance)}
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Camera
          <button
            type="button"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
            disabled={busyAction === cameraActionKey}
            onClick={() => toggleCameraFacing(targetId, cameraFacing)}
          >
            {busyAction === cameraActionKey ? "Switching..." : cameraFacing === "front" ? "Front" : "Rear"}
          </button>
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Sensitivity
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-center text-sm text-slate-700"
            value={sensitivityDraft}
            disabled={busyAction === sensitivityActionKey}
            onChange={(event) => updateSensitivityDraft(targetId, event.target.value, effectiveSensitivity)}
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Latency: {latencyLabel} · Clock: {syncLabel} · Distance: {formatMeters(client.distanceMeters)}
        </p>
        <ActionButton
          label="Re-Sync"
          onClick={() => requestDeviceClockResync(targetId)}
          busy={busyAction === resyncActionKey}
          variant="secondary"
        />
      </div>
    </div>
  );
}
