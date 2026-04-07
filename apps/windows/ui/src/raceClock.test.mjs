import test from "node:test";
import assert from "node:assert/strict";

import { deriveMonitoringElapsedMs } from "./raceClock.js";

test("deriveMonitoringElapsedMs uses monitoringStartedAtMs while monitoring is active", () => {
  const result = deriveMonitoringElapsedMs({
    monitoringActive: true,
    monitoringStartedAtMs: 10_000,
    monitoringElapsedMs: 0,
    nowMs: 10_750,
  });

  assert.equal(result, 750);
});

test("deriveMonitoringElapsedMs falls back to monitoringElapsedMs when monitoring is inactive", () => {
  const result = deriveMonitoringElapsedMs({
    monitoringActive: false,
    monitoringStartedAtMs: 10_000,
    monitoringElapsedMs: 420,
    nowMs: 20_000,
  });

  assert.equal(result, 420);
});

test("deriveMonitoringElapsedMs keeps the value non-negative and at least the fallback value", () => {
  const result = deriveMonitoringElapsedMs({
    monitoringActive: true,
    monitoringStartedAtMs: 20_000,
    monitoringElapsedMs: 300,
    nowMs: 19_000,
  });

  assert.equal(result, 300);
});
