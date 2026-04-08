package com.paul.sprintsync.features.race_session

import SprintSync.Schema.ClockResyncRequest as FlatBufferClockResyncRequest
import SprintSync.Schema.DeviceConfigUpdate as FlatBufferDeviceConfigUpdate
import SprintSync.Schema.DeviceIdentity as FlatBufferDeviceIdentity
import SprintSync.Schema.DeviceTelemetry as FlatBufferDeviceTelemetry
import SprintSync.Schema.LapResult as FlatBufferLapResult
import SprintSync.Schema.SessionDeviceRole as FlatBufferSessionDeviceRole
import SprintSync.Schema.SessionSnapshot as FlatBufferSessionSnapshot
import SprintSync.Schema.SessionSnapshotDevice as FlatBufferSessionSnapshotDevice
import SprintSync.Schema.SessionSplitMark as FlatBufferSessionSplitMark
import SprintSync.Schema.SessionTimelineSnapshot as FlatBufferSessionTimelineSnapshot
import SprintSync.Schema.SessionTrigger as FlatBufferSessionTrigger
import SprintSync.Schema.SessionTriggerRequest as FlatBufferSessionTriggerRequest
import SprintSync.Schema.TelemetryEnvelope
import SprintSync.Schema.TelemetryPayload
import SprintSync.Schema.TriggerRefinement as FlatBufferTriggerRefinement
import com.google.flatbuffers.FlatBufferBuilder
import java.nio.ByteBuffer

sealed interface DecodedTelemetryEnvelope {
    data class TriggerRequest(val message: SessionTriggerRequestMessage) : DecodedTelemetryEnvelope

    data class Trigger(val message: SessionTriggerMessage) : DecodedTelemetryEnvelope

    data class TimelineSnapshot(val message: SessionTimelineSnapshotMessage) : DecodedTelemetryEnvelope

    data class Snapshot(val message: SessionSnapshotMessage) : DecodedTelemetryEnvelope

    data class TriggerRefinementEnvelope(val message: SessionTriggerRefinementMessage) : DecodedTelemetryEnvelope

    data class ConfigUpdate(val message: SessionDeviceConfigUpdateMessage) : DecodedTelemetryEnvelope

    data class ClockResync(val message: SessionClockResyncRequestMessage) : DecodedTelemetryEnvelope

    data class Identity(val message: SessionDeviceIdentityMessage) : DecodedTelemetryEnvelope

    data class DeviceTelemetryEnvelope(val message: SessionDeviceTelemetryMessage) : DecodedTelemetryEnvelope

    data class LapResultEnvelope(val message: SessionLapResultMessage) : DecodedTelemetryEnvelope
}

object TelemetryEnvelopeFlatBufferCodec {
    private const val MISSING_OPTIONAL_LONG = -1L
    private const val MISSING_OPTIONAL_INT = -1

    fun encodeTriggerRequest(message: SessionTriggerRequestMessage): ByteArray {
        val builder = FlatBufferBuilder(256)
        val sourceDeviceIdOffset = builder.createString(message.sourceDeviceId)
        val payloadOffset = FlatBufferSessionTriggerRequest.createSessionTriggerRequest(
            builder,
            roleToByte(message.role),
            message.triggerSensorNanos,
            message.mappedHostSensorNanos ?: MISSING_OPTIONAL_LONG,
            sourceDeviceIdOffset,
            message.sourceElapsedNanos,
            message.mappedAnchorElapsedNanos ?: MISSING_OPTIONAL_LONG,
        )
        return finishEnvelope(builder, TelemetryPayload.SessionTriggerRequest, payloadOffset)
    }

    fun encodeTrigger(message: SessionTriggerMessage): ByteArray {
        val builder = FlatBufferBuilder(128)
        val triggerTypeOffset = builder.createString(message.triggerType)
        val payloadOffset = FlatBufferSessionTrigger.createSessionTrigger(
            builder,
            triggerTypeOffset,
            message.splitIndex ?: MISSING_OPTIONAL_INT,
            message.triggerSensorNanos,
        )
        return finishEnvelope(builder, TelemetryPayload.SessionTrigger, payloadOffset)
    }

    fun encodeTimelineSnapshot(message: SessionTimelineSnapshotMessage): ByteArray {
        val builder = FlatBufferBuilder(256)
        val splitMarkOffsets = IntArray(message.hostSplitMarks.size) { index ->
            val splitMark = message.hostSplitMarks[index]
            FlatBufferSessionSplitMark.createSessionSplitMark(
                builder,
                roleToByte(splitMark.role),
                splitMark.hostSensorNanos,
            )
        }
        val splitMarksVectorOffset = if (splitMarkOffsets.isNotEmpty()) {
            FlatBufferSessionTimelineSnapshot.createHostSplitMarksVector(builder, splitMarkOffsets)
        } else {
            0
        }
        val payloadOffset = FlatBufferSessionTimelineSnapshot.createSessionTimelineSnapshot(
            builder,
            message.hostStartSensorNanos ?: MISSING_OPTIONAL_LONG,
            message.hostStopSensorNanos ?: MISSING_OPTIONAL_LONG,
            splitMarksVectorOffset,
            message.sentElapsedNanos,
        )
        return finishEnvelope(builder, TelemetryPayload.SessionTimelineSnapshot, payloadOffset)
    }

    fun encodeSnapshot(message: SessionSnapshotMessage): ByteArray {
        val builder = FlatBufferBuilder(768)
        val stageOffset = builder.createString(message.stage.name.lowercase())
        val deviceOffsets = IntArray(message.devices.size) { index ->
            val device = message.devices[index]
            val idOffset = builder.createString(device.id)
            val nameOffset = builder.createString(device.name)
            val roleOffset = builder.createString(device.role.name.lowercase())
            val cameraFacingOffset = builder.createString(device.cameraFacing.name.lowercase())
            FlatBufferSessionSnapshotDevice.createSessionSnapshotDevice(
                builder,
                idOffset,
                nameOffset,
                roleOffset,
                cameraFacingOffset,
                device.isLocal,
            )
        }
        val devicesVectorOffset = if (deviceOffsets.isNotEmpty()) {
            FlatBufferSessionSnapshot.createDevicesVector(builder, deviceOffsets)
        } else {
            0
        }
        val splitMarkOffsets = IntArray(message.hostSplitMarks.size) { index ->
            val splitMark = message.hostSplitMarks[index]
            FlatBufferSessionSplitMark.createSessionSplitMark(
                builder,
                roleToByte(splitMark.role),
                splitMark.hostSensorNanos,
            )
        }
        val splitMarksVectorOffset = if (splitMarkOffsets.isNotEmpty()) {
            FlatBufferSessionSnapshot.createHostSplitMarksVector(builder, splitMarkOffsets)
        } else {
            0
        }
        val runIdOffset = message.runId?.takeIf { it.isNotBlank() }?.let(builder::createString) ?: 0
        val selfDeviceIdOffset = message.selfDeviceId?.takeIf { it.isNotBlank() }?.let(builder::createString) ?: 0
        val anchorDeviceIdOffset = message.anchorDeviceId?.takeIf { it.isNotBlank() }?.let(builder::createString) ?: 0
        val anchorStateOffset = message.anchorState?.name?.lowercase()?.let(builder::createString) ?: 0
        val payloadOffset = FlatBufferSessionSnapshot.createSessionSnapshot(
            builder,
            stageOffset,
            message.monitoringActive,
            devicesVectorOffset,
            message.hostStartSensorNanos ?: MISSING_OPTIONAL_LONG,
            message.hostStopSensorNanos ?: MISSING_OPTIONAL_LONG,
            splitMarksVectorOffset,
            runIdOffset,
            message.hostSensorMinusElapsedNanos ?: MISSING_OPTIONAL_LONG,
            message.hostGpsUtcOffsetNanos ?: MISSING_OPTIONAL_LONG,
            message.hostGpsFixAgeNanos ?: MISSING_OPTIONAL_LONG,
            selfDeviceIdOffset,
            anchorDeviceIdOffset,
            anchorStateOffset,
        )
        return finishEnvelope(builder, TelemetryPayload.SessionSnapshot, payloadOffset)
    }

    fun encodeTriggerRefinement(message: SessionTriggerRefinementMessage): ByteArray {
        val builder = FlatBufferBuilder(256)
        val runIdOffset = builder.createString(message.runId)
        val payloadOffset = FlatBufferTriggerRefinement.createTriggerRefinement(
            builder,
            runIdOffset,
            roleToByte(message.role),
            message.provisionalHostSensorNanos,
            message.refinedHostSensorNanos,
        )
        return finishEnvelope(builder, TelemetryPayload.TriggerRefinement, payloadOffset)
    }

    fun encodeDeviceConfigUpdate(message: SessionDeviceConfigUpdateMessage): ByteArray {
        val builder = FlatBufferBuilder(128)
        val targetStableDeviceIdOffset = builder.createString(message.targetStableDeviceId)
        val payloadOffset = FlatBufferDeviceConfigUpdate.createDeviceConfigUpdate(
            builder,
            targetStableDeviceIdOffset,
            message.sensitivity,
        )
        return finishEnvelope(builder, TelemetryPayload.DeviceConfigUpdate, payloadOffset)
    }

    fun encodeClockResyncRequest(message: SessionClockResyncRequestMessage): ByteArray {
        val builder = FlatBufferBuilder(64)
        val payloadOffset = FlatBufferClockResyncRequest.createClockResyncRequest(builder, message.sampleCount)
        return finishEnvelope(builder, TelemetryPayload.ClockResyncRequest, payloadOffset)
    }

    fun encodeDeviceIdentity(message: SessionDeviceIdentityMessage): ByteArray {
        val builder = FlatBufferBuilder(128)
        val stableDeviceIdOffset = builder.createString(message.stableDeviceId)
        val deviceNameOffset = builder.createString(message.deviceName)
        val payloadOffset = FlatBufferDeviceIdentity.createDeviceIdentity(
            builder,
            stableDeviceIdOffset,
            deviceNameOffset,
        )
        return finishEnvelope(builder, TelemetryPayload.DeviceIdentity, payloadOffset)
    }

    fun encodeDeviceTelemetry(message: SessionDeviceTelemetryMessage): ByteArray {
        val builder = FlatBufferBuilder(256)
        val stableDeviceIdOffset = builder.createString(message.stableDeviceId)
        val payloadOffset = FlatBufferDeviceTelemetry.createDeviceTelemetry(
            builder,
            stableDeviceIdOffset,
            roleToByte(message.role),
            message.sensitivity,
            message.latencyMs ?: MISSING_OPTIONAL_INT,
            message.clockSynced,
            message.analysisWidth ?: MISSING_OPTIONAL_INT,
            message.analysisHeight ?: MISSING_OPTIONAL_INT,
            message.timestampMillis,
        )
        return finishEnvelope(builder, TelemetryPayload.DeviceTelemetry, payloadOffset)
    }

    fun encodeLapResult(message: SessionLapResultMessage): ByteArray {
        val builder = FlatBufferBuilder(128)
        val senderDeviceNameOffset = builder.createString(message.senderDeviceName)
        val payloadOffset = FlatBufferLapResult.createLapResult(
            builder,
            senderDeviceNameOffset,
            message.startedSensorNanos,
            message.stoppedSensorNanos,
        )
        return finishEnvelope(builder, TelemetryPayload.LapResult, payloadOffset)
    }

    fun decode(payloadBytes: ByteArray): DecodedTelemetryEnvelope? {
        return runCatching {
            val byteBuffer = ByteBuffer.wrap(payloadBytes)
            val envelope = TelemetryEnvelope.getRootAsTelemetryEnvelope(byteBuffer)
            when (envelope.payloadType) {
                TelemetryPayload.SessionTriggerRequest -> {
                    val payload = envelope.payload(FlatBufferSessionTriggerRequest()) as? FlatBufferSessionTriggerRequest
                        ?: return null
                    DecodedTelemetryEnvelope.TriggerRequest(
                        SessionTriggerRequestMessage(
                            role = byteToRole(payload.role),
                            triggerSensorNanos = payload.triggerSensorNanos,
                            mappedHostSensorNanos = payload.mappedHostSensorNanos.takeUnless {
                                it == MISSING_OPTIONAL_LONG
                            },
                            sourceDeviceId = payload.sourceDeviceId,
                            sourceElapsedNanos = payload.sourceElapsedNanos,
                            mappedAnchorElapsedNanos = payload.mappedAnchorElapsedNanos.takeUnless {
                                it == MISSING_OPTIONAL_LONG
                            },
                        ),
                    )
                }

                TelemetryPayload.SessionTrigger -> {
                    val payload = envelope.payload(FlatBufferSessionTrigger()) as? FlatBufferSessionTrigger
                        ?: return null
                    DecodedTelemetryEnvelope.Trigger(
                        SessionTriggerMessage(
                            triggerType = payload.triggerType,
                            splitIndex = payload.splitIndex.takeUnless { it == MISSING_OPTIONAL_INT },
                            triggerSensorNanos = payload.triggerSensorNanos,
                        ),
                    )
                }

                TelemetryPayload.SessionTimelineSnapshot -> {
                    val payload = envelope.payload(FlatBufferSessionTimelineSnapshot()) as? FlatBufferSessionTimelineSnapshot
                        ?: return null
                    val hostSplitMarks = buildList {
                        for (index in 0 until payload.hostSplitMarksLength) {
                            val splitMark = payload.hostSplitMarks(index) ?: continue
                            val role = byteToRole(splitMark.role)
                            if (!role.isSplitCheckpointRole()) {
                                continue
                            }
                            add(
                                SessionSplitMark(
                                    role = role,
                                    hostSensorNanos = splitMark.hostSensorNanos,
                                ),
                            )
                        }
                    }
                    DecodedTelemetryEnvelope.TimelineSnapshot(
                        SessionTimelineSnapshotMessage(
                            hostStartSensorNanos = payload.hostStartSensorNanos.takeUnless {
                                it == MISSING_OPTIONAL_LONG
                            },
                            hostStopSensorNanos = payload.hostStopSensorNanos.takeUnless {
                                it == MISSING_OPTIONAL_LONG
                            },
                            hostSplitMarks = hostSplitMarks,
                            sentElapsedNanos = payload.sentElapsedNanos,
                        ),
                    )
                }

                TelemetryPayload.SessionSnapshot -> {
                    val payload = envelope.payload(FlatBufferSessionSnapshot()) as? FlatBufferSessionSnapshot
                        ?: return null
                    val stage = sessionStageFromName(payload.stage) ?: return null
                    val devices = buildList {
                        for (index in 0 until payload.devicesLength) {
                            val device = payload.devices(index) ?: continue
                            val id = device.id?.trim().orEmpty()
                            val name = device.name?.trim().orEmpty()
                            if (id.isEmpty() || name.isEmpty()) {
                                continue
                            }
                            val role = sessionDeviceRoleFromName(device.role) ?: SessionDeviceRole.UNASSIGNED
                            val cameraFacing = sessionCameraFacingFromName(device.cameraFacing) ?: SessionCameraFacing.REAR
                            add(
                                SessionDevice(
                                    id = id,
                                    name = name,
                                    role = role,
                                    cameraFacing = cameraFacing,
                                    isLocal = device.isLocal,
                                ),
                            )
                        }
                    }
                    if (devices.isEmpty()) {
                        return null
                    }
                    val hostSplitMarks = buildList {
                        for (index in 0 until payload.hostSplitMarksLength) {
                            val splitMark = payload.hostSplitMarks(index) ?: continue
                            val role = byteToRole(splitMark.role)
                            if (!role.isSplitCheckpointRole()) {
                                continue
                            }
                            add(
                                SessionSplitMark(
                                    role = role,
                                    hostSensorNanos = splitMark.hostSensorNanos,
                                ),
                            )
                        }
                    }
                    DecodedTelemetryEnvelope.Snapshot(
                        SessionSnapshotMessage(
                            stage = stage,
                            monitoringActive = payload.monitoringActive,
                            devices = devices,
                            hostStartSensorNanos = payload.hostStartSensorNanos.takeUnless {
                                it == MISSING_OPTIONAL_LONG
                            },
                            hostStopSensorNanos = payload.hostStopSensorNanos.takeUnless {
                                it == MISSING_OPTIONAL_LONG
                            },
                            hostSplitMarks = hostSplitMarks,
                            runId = payload.runId?.ifBlank { null },
                            hostSensorMinusElapsedNanos = payload.hostSensorMinusElapsedNanos.takeUnless {
                                it == MISSING_OPTIONAL_LONG
                            },
                            hostGpsUtcOffsetNanos = payload.hostGpsUtcOffsetNanos.takeUnless {
                                it == MISSING_OPTIONAL_LONG
                            },
                            hostGpsFixAgeNanos = payload.hostGpsFixAgeNanos.takeUnless {
                                it == MISSING_OPTIONAL_LONG
                            },
                            selfDeviceId = payload.selfDeviceId?.ifBlank { null },
                            anchorDeviceId = payload.anchorDeviceId?.ifBlank { null },
                            anchorState = sessionAnchorStateFromName(payload.anchorState),
                        ),
                    )
                }

                TelemetryPayload.TriggerRefinement -> {
                    val payload = envelope.payload(FlatBufferTriggerRefinement()) as? FlatBufferTriggerRefinement
                        ?: return null
                    val runId = payload.runId?.trim().orEmpty()
                    if (runId.isEmpty()) {
                        return null
                    }
                    DecodedTelemetryEnvelope.TriggerRefinementEnvelope(
                        SessionTriggerRefinementMessage(
                            runId = runId,
                            role = byteToRole(payload.role),
                            provisionalHostSensorNanos = payload.provisionalHostSensorNanos,
                            refinedHostSensorNanos = payload.refinedHostSensorNanos,
                        ),
                    )
                }

                TelemetryPayload.DeviceConfigUpdate -> {
                    val payload = envelope.payload(FlatBufferDeviceConfigUpdate()) as? FlatBufferDeviceConfigUpdate
                        ?: return null
                    val targetStableDeviceId = payload.targetStableDeviceId?.trim().orEmpty()
                    if (targetStableDeviceId.isEmpty() || payload.sensitivity !in 1..100) {
                        return null
                    }
                    DecodedTelemetryEnvelope.ConfigUpdate(
                        SessionDeviceConfigUpdateMessage(
                            targetStableDeviceId = targetStableDeviceId,
                            sensitivity = payload.sensitivity,
                        ),
                    )
                }

                TelemetryPayload.ClockResyncRequest -> {
                    val payload = envelope.payload(FlatBufferClockResyncRequest()) as? FlatBufferClockResyncRequest
                        ?: return null
                    if (payload.sampleCount !in 3..24) {
                        return null
                    }
                    DecodedTelemetryEnvelope.ClockResync(
                        SessionClockResyncRequestMessage(sampleCount = payload.sampleCount),
                    )
                }

                TelemetryPayload.DeviceIdentity -> {
                    val payload = envelope.payload(FlatBufferDeviceIdentity()) as? FlatBufferDeviceIdentity
                        ?: return null
                    val stableDeviceId = payload.stableDeviceId?.trim().orEmpty()
                    val deviceName = payload.deviceName?.trim().orEmpty()
                    if (stableDeviceId.isEmpty() || deviceName.isEmpty()) {
                        return null
                    }
                    DecodedTelemetryEnvelope.Identity(
                        SessionDeviceIdentityMessage(
                            stableDeviceId = stableDeviceId,
                            deviceName = deviceName,
                        ),
                    )
                }

                TelemetryPayload.DeviceTelemetry -> {
                    val payload = envelope.payload(FlatBufferDeviceTelemetry()) as? FlatBufferDeviceTelemetry
                        ?: return null
                    val stableDeviceId = payload.stableDeviceId?.trim().orEmpty()
                    if (stableDeviceId.isEmpty() || payload.sensitivity !in 1..100) {
                        return null
                    }
                    val latencyMs = when {
                        payload.latencyMs == MISSING_OPTIONAL_INT -> null
                        payload.latencyMs >= 0 -> payload.latencyMs
                        else -> return null
                    }
                    val analysisWidth = when {
                        payload.analysisWidth == MISSING_OPTIONAL_INT -> null
                        payload.analysisWidth > 0 -> payload.analysisWidth
                        else -> return null
                    }
                    val analysisHeight = when {
                        payload.analysisHeight == MISSING_OPTIONAL_INT -> null
                        payload.analysisHeight > 0 -> payload.analysisHeight
                        else -> return null
                    }
                    if ((analysisWidth == null) != (analysisHeight == null)) {
                        return null
                    }
                    if (payload.timestampMillis <= 0L) {
                        return null
                    }
                    DecodedTelemetryEnvelope.DeviceTelemetryEnvelope(
                        SessionDeviceTelemetryMessage(
                            stableDeviceId = stableDeviceId,
                            role = byteToRole(payload.role),
                            sensitivity = payload.sensitivity,
                            latencyMs = latencyMs,
                            clockSynced = payload.clockSynced,
                            analysisWidth = analysisWidth,
                            analysisHeight = analysisHeight,
                            timestampMillis = payload.timestampMillis,
                        ),
                    )
                }

                TelemetryPayload.LapResult -> {
                    val payload = envelope.payload(FlatBufferLapResult()) as? FlatBufferLapResult
                        ?: return null
                    val senderDeviceName = payload.senderDeviceName?.trim().orEmpty()
                    if (senderDeviceName.isEmpty() || payload.stoppedSensorNanos <= payload.startedSensorNanos) {
                        return null
                    }
                    DecodedTelemetryEnvelope.LapResultEnvelope(
                        SessionLapResultMessage(
                            senderDeviceName = senderDeviceName,
                            startedSensorNanos = payload.startedSensorNanos,
                            stoppedSensorNanos = payload.stoppedSensorNanos,
                        ),
                    )
                }

                else -> null
            }
        }.getOrNull()
    }

    private fun finishEnvelope(builder: FlatBufferBuilder, payloadType: UByte, payloadOffset: Int): ByteArray {
        val envelopeOffset = TelemetryEnvelope.createTelemetryEnvelope(builder, payloadType, payloadOffset)
        TelemetryEnvelope.finishTelemetryEnvelopeBuffer(builder, envelopeOffset)
        return builder.sizedByteArray()
    }

    private fun roleToByte(role: SessionDeviceRole): Byte {
        return when (role) {
            SessionDeviceRole.UNASSIGNED -> FlatBufferSessionDeviceRole.UNASSIGNED
            SessionDeviceRole.START -> FlatBufferSessionDeviceRole.START
            SessionDeviceRole.SPLIT1 -> FlatBufferSessionDeviceRole.SPLIT1
            SessionDeviceRole.SPLIT2 -> FlatBufferSessionDeviceRole.SPLIT2
            SessionDeviceRole.SPLIT3 -> FlatBufferSessionDeviceRole.SPLIT3
            SessionDeviceRole.SPLIT4 -> FlatBufferSessionDeviceRole.SPLIT4
            SessionDeviceRole.STOP -> FlatBufferSessionDeviceRole.STOP
            SessionDeviceRole.DISPLAY -> FlatBufferSessionDeviceRole.DISPLAY
        }
    }

    private fun byteToRole(role: Byte): SessionDeviceRole {
        return when (role) {
            FlatBufferSessionDeviceRole.START -> SessionDeviceRole.START
            FlatBufferSessionDeviceRole.SPLIT1 -> SessionDeviceRole.SPLIT1
            FlatBufferSessionDeviceRole.SPLIT2 -> SessionDeviceRole.SPLIT2
            FlatBufferSessionDeviceRole.SPLIT3 -> SessionDeviceRole.SPLIT3
            FlatBufferSessionDeviceRole.SPLIT4 -> SessionDeviceRole.SPLIT4
            FlatBufferSessionDeviceRole.STOP -> SessionDeviceRole.STOP
            FlatBufferSessionDeviceRole.DISPLAY -> SessionDeviceRole.DISPLAY
            else -> SessionDeviceRole.UNASSIGNED
        }
    }
}
