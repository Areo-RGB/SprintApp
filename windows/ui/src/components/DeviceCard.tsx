import ActionButton from "./ActionButton";
import { formatMeters } from "../utils";

type DeviceCardProps = {
  key?: string | number;
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
    <div key={client.endpointId} className="min-w-[320px] flex-1 border-[3px] border-black bg-white p-4 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
      <div className="text-lg font-black uppercase tracking-tight text-black">{client.deviceName ?? "Unknown device"}</div>
      <div className="mb-4 font-mono text-xs font-bold text-gray-500">{targetId}</div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold uppercase tracking-wide text-black">
          Role
          {monitoringActive ? (
            <p className="mt-1 border-[2px] border-black bg-gray-100 px-2 py-2 text-center text-sm font-bold uppercase text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{assignedRole}</p>
          ) : (
            <select
              className="mt-1 w-full border-[2px] border-black bg-white px-2 py-2 text-center text-sm font-bold uppercase text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-[#FFEA00]"
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

        <label className="text-xs font-bold uppercase tracking-wide text-black">
          Distance (m)
          <input
            type="number"
            min={0}
            max={100000}
            step={0.1}
            className="mt-1 w-full border-[2px] border-black bg-white px-2 py-2 text-center text-sm font-bold text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-[#FFEA00]"
            value={distanceDraft}
            disabled={busyAction === distanceActionKey}
            onChange={(event) => updateDistanceDraft(targetId, event.target.value, effectiveDistance)}
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-wide text-black">
          Camera
          <button
            type="button"
            className="mt-1 w-full border-[2px] border-black bg-white px-2 py-2 text-sm font-bold uppercase text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition hover:bg-gray-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            disabled={busyAction === cameraActionKey}
            onClick={() => toggleCameraFacing(targetId, cameraFacing)}
          >
            {busyAction === cameraActionKey ? "SWITCHING..." : cameraFacing === "front" ? "FRONT" : "REAR"}
          </button>
        </label>

        <label className="text-xs font-bold uppercase tracking-wide text-black">
          Sensitivity
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            className="mt-1 w-full border-[2px] border-black bg-white px-2 py-2 text-center text-sm font-bold text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-[#FFEA00]"
            value={sensitivityDraft}
            disabled={busyAction === sensitivityActionKey}
            onChange={(event) => updateSensitivityDraft(targetId, event.target.value, effectiveSensitivity)}
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t-[3px] border-black pt-3">
        <p className="text-xs font-bold uppercase text-gray-600">
          Latency: {latencyLabel} · Clock: {syncLabel} · Dist: {formatMeters(client.distanceMeters)}
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
