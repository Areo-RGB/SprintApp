package com.paul.sprintsync.features.race_session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class TelemetryEnvelopeFlatBufferCodecTest {
    @Test
    fun `trigger request envelope round trips`() {
        val message = SessionTriggerRequestMessage(
            role = SessionDeviceRole.START,
            triggerSensorNanos = 100L,
            mappedHostSensorNanos = 110L,
            sourceDeviceId = "device-a",
            sourceElapsedNanos = 200L,
            mappedAnchorElapsedNanos = 210L,
        )

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeTriggerRequest(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.TriggerRequest
        assertNotNull(payload)
        assertEquals(message, payload!!.message)
    }

    @Test
    fun `trigger envelope round trips with optional split index`() {
        val message = SessionTriggerMessage(
            triggerType = "split",
            splitIndex = 2,
            triggerSensorNanos = 999L,
        )

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeTrigger(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.Trigger
        assertNotNull(payload)
        assertEquals(message, payload!!.message)
    }

    @Test
    fun `timeline snapshot envelope round trips optional fields`() {
        val message = SessionTimelineSnapshotMessage(
            hostStartSensorNanos = 1_000L,
            hostStopSensorNanos = null,
            hostSplitMarks = listOf(
                SessionSplitMark(role = SessionDeviceRole.SPLIT1, hostSensorNanos = 1_500L),
                SessionSplitMark(role = SessionDeviceRole.SPLIT2, hostSensorNanos = 2_000L),
            ),
            sentElapsedNanos = 3_000L,
        )

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeTimelineSnapshot(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.TimelineSnapshot
        assertNotNull(payload)
        assertEquals(message.hostStartSensorNanos, payload!!.message.hostStartSensorNanos)
        assertNull(payload.message.hostStopSensorNanos)
        assertEquals(message.hostSplitMarks, payload.message.hostSplitMarks)
        assertEquals(message.sentElapsedNanos, payload.message.sentElapsedNanos)
    }

    @Test
    fun `device identity envelope round trips`() {
        val message = SessionDeviceIdentityMessage(
            stableDeviceId = "stable-1",
            deviceName = "Pixel 8",
        )

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeDeviceIdentity(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.Identity
        assertNotNull(payload)
        assertEquals(message, payload!!.message)
    }

    @Test
    fun `device telemetry envelope round trips with optional fields`() {
        val message = SessionDeviceTelemetryMessage(
            stableDeviceId = "stable-2",
            role = SessionDeviceRole.SPLIT2,
            sensitivity = 84,
            latencyMs = 27,
            clockSynced = true,
            analysisWidth = 1280,
            analysisHeight = 720,
            timestampMillis = 1_717_171_717_171L,
        )

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeDeviceTelemetry(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.DeviceTelemetryEnvelope
        assertNotNull(payload)
        assertEquals(message, payload!!.message)
    }

    @Test
    fun `lap result envelope round trips`() {
        val message = SessionLapResultMessage(
            senderDeviceName = "Display Tablet",
            startedSensorNanos = 10_000L,
            stoppedSensorNanos = 12_750L,
        )

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeLapResult(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.LapResultEnvelope
        assertNotNull(payload)
        assertEquals(message, payload!!.message)
    }

    @Test
    fun `snapshot envelope round trips`() {
        val message = SessionSnapshotMessage(
            stage = SessionStage.MONITORING,
            monitoringActive = true,
            devices = listOf(
                SessionDevice(
                    id = "host-ep",
                    name = "Host Phone",
                    role = SessionDeviceRole.START,
                    cameraFacing = SessionCameraFacing.REAR,
                    isLocal = false,
                ),
                SessionDevice(
                    id = "client-ep",
                    name = "Client Phone",
                    role = SessionDeviceRole.STOP,
                    cameraFacing = SessionCameraFacing.FRONT,
                    isLocal = false,
                ),
            ),
            hostStartSensorNanos = 5_000L,
            hostStopSensorNanos = 9_500L,
            hostSplitMarks = listOf(
                SessionSplitMark(role = SessionDeviceRole.SPLIT1, hostSensorNanos = 6_250L),
                SessionSplitMark(role = SessionDeviceRole.SPLIT2, hostSensorNanos = 7_500L),
            ),
            runId = "run-42",
            hostSensorMinusElapsedNanos = 12L,
            hostGpsUtcOffsetNanos = 15L,
            hostGpsFixAgeNanos = 20L,
            selfDeviceId = "client-ep",
            anchorDeviceId = "host-ep",
            anchorState = SessionAnchorState.ACTIVE,
        )

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeSnapshot(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.Snapshot
        assertNotNull(payload)
        assertEquals(message, payload!!.message)
    }

    @Test
    fun `trigger refinement envelope round trips`() {
        val message = SessionTriggerRefinementMessage(
            runId = "run-99",
            role = SessionDeviceRole.SPLIT3,
            provisionalHostSensorNanos = 10_000L,
            refinedHostSensorNanos = 10_120L,
        )

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeTriggerRefinement(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.TriggerRefinementEnvelope
        assertNotNull(payload)
        assertEquals(message, payload!!.message)
    }

    @Test
    fun `device config update envelope round trips`() {
        val message = SessionDeviceConfigUpdateMessage(
            targetStableDeviceId = "stable-3",
            sensitivity = 65,
        )

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeDeviceConfigUpdate(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.ConfigUpdate
        assertNotNull(payload)
        assertEquals(message, payload!!.message)
    }

    @Test
    fun `clock resync request envelope round trips`() {
        val message = SessionClockResyncRequestMessage(sampleCount = 8)

        val encoded = TelemetryEnvelopeFlatBufferCodec.encodeClockResyncRequest(message)
        val decoded = TelemetryEnvelopeFlatBufferCodec.decode(encoded)

        val payload = decoded as? DecodedTelemetryEnvelope.ClockResync
        assertNotNull(payload)
        assertEquals(message, payload!!.message)
    }
}
