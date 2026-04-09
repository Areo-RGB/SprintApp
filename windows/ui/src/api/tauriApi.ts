import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AssignRoleRequest,
  CompareResultsPayload,
  CompareResultsRequest,
  DeviceConfigRequest,
  GenericOkResponse,
  ListResultsResponse,
  LoadResultResponse,
  ResyncDeviceRequest,
  SaveResultsRequest,
  SaveResultsResponse,
  Snapshot,
  StartMonitoringResponse,
} from "./types";

function normalizeInvokeError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return new Error(error);
  }
  return new Error(fallbackMessage);
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    if (args) {
      return await invoke<T>(command, args);
    }
    return await invoke<T>(command);
  } catch (error) {
    throw normalizeInvokeError(error, `${command} failed`);
  }
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const candidateWindow = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(candidateWindow.__TAURI__ || candidateWindow.__TAURI_INTERNALS__);
}

export async function getState(): Promise<Snapshot> {
  return invokeCommand<Snapshot>("get_state");
}

export async function startMonitoring(): Promise<StartMonitoringResponse> {
  return invokeCommand<StartMonitoringResponse>("start_monitoring");
}

export async function stopMonitoring(): Promise<GenericOkResponse> {
  return invokeCommand<GenericOkResponse>("stop_monitoring");
}

export async function startLobby(): Promise<GenericOkResponse> {
  return invokeCommand<GenericOkResponse>("start_lobby");
}

export async function resetLaps(): Promise<GenericOkResponse> {
  return invokeCommand<GenericOkResponse>("reset_laps");
}

export async function resetRun(): Promise<GenericOkResponse> {
  return invokeCommand<GenericOkResponse>("reset_run");
}

export async function returnSetup(): Promise<GenericOkResponse> {
  return invokeCommand<GenericOkResponse>("return_setup");
}

export async function assignRole(payload: AssignRoleRequest): Promise<GenericOkResponse> {
  return invokeCommand<GenericOkResponse>("assign_role", { payload });
}

export async function updateDeviceConfig(payload: DeviceConfigRequest): Promise<GenericOkResponse> {
  return invokeCommand<GenericOkResponse>("update_device_config", { payload });
}

export async function resyncDevice(payload: ResyncDeviceRequest): Promise<GenericOkResponse> {
  return invokeCommand<GenericOkResponse>("resync_device", { payload });
}

export async function saveResults(payload: SaveResultsRequest): Promise<SaveResultsResponse> {
  return invokeCommand<SaveResultsResponse>("save_results", { payload });
}

export async function clearEvents(): Promise<GenericOkResponse> {
  return invokeCommand<GenericOkResponse>("clear_events");
}

export async function listResults(): Promise<ListResultsResponse> {
  return invokeCommand<ListResultsResponse>("list_results");
}

export async function loadResult(fileName: string): Promise<LoadResultResponse> {
  return invokeCommand<LoadResultResponse>("load_result", { fileName });
}

export async function compareResults(payload: CompareResultsRequest): Promise<CompareResultsPayload> {
  return invokeCommand<CompareResultsPayload>("compare_results", { payload });
}

export async function subscribeStateUpdates(
  onSnapshot: (snapshot: Snapshot) => void,
): Promise<UnlistenFn> {
  return listen<Snapshot>("state-update", (event) => {
    if (event.payload) {
      onSnapshot(event.payload);
    }
  });
}
