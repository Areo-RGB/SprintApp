use crate::generated::sprint_sync_telemetry_generated::sprint_sync::schema;
use crate::state::{
  CameraFacing, DeviceIdentityMessage, DeviceTelemetryMessage, LapResultMessage, ProtocolSnapshot,
  ProtocolSplitMark, SessionTriggerMessage, TimelineSnapshotPayload, TriggerRefinementMessage,
  TriggerRequestMessage, WireRole, FRAME_KIND_TELEMETRY_BINARY,
};

#[derive(Clone, Debug)]
pub enum DecodedTelemetryMessage {
  TriggerRequest(TriggerRequestMessage),
  SessionTrigger(SessionTriggerMessage),
  TimelineSnapshot(TimelineSnapshotPayload),
  SessionSnapshot(ProtocolSnapshot),
  TriggerRefinement(TriggerRefinementMessage),
  DeviceConfigUpdate { target_stable_device_id: String, sensitivity: i32 },
  ClockResyncRequest { sample_count: i32 },
  DeviceIdentity(DeviceIdentityMessage),
  DeviceTelemetry(DeviceTelemetryMessage),
  LapResult(LapResultMessage),
}

fn wrap_telemetry_frame(payload: &[u8]) -> Vec<u8> {
  let mut frame = Vec::with_capacity(5 + payload.len());
  frame.push(FRAME_KIND_TELEMETRY_BINARY);
  frame.extend_from_slice(&(payload.len() as i32).to_be_bytes());
  frame.extend_from_slice(payload);
  frame
}

fn to_optional_i64(raw_value: i64) -> Option<i64> {
  if raw_value < 0 {
    None
  } else {
    Some(raw_value)
  }
}

fn to_optional_i32(raw_value: i32) -> Option<i32> {
  if raw_value < 0 {
    None
  } else {
    Some(raw_value)
  }
}

fn session_device_role_to_wire_role(role: schema::SessionDeviceRole) -> WireRole {
  if role == schema::SessionDeviceRole::START {
    WireRole::Start
  } else if role == schema::SessionDeviceRole::SPLIT1 {
    WireRole::Split1
  } else if role == schema::SessionDeviceRole::SPLIT2 {
    WireRole::Split2
  } else if role == schema::SessionDeviceRole::SPLIT3 {
    WireRole::Split3
  } else if role == schema::SessionDeviceRole::SPLIT4 {
    WireRole::Split4
  } else if role == schema::SessionDeviceRole::STOP {
    WireRole::Stop
  } else if role == schema::SessionDeviceRole::DISPLAY {
    WireRole::Display
  } else {
    WireRole::Unassigned
  }
}

fn wire_role_to_session_device_role(role: &WireRole) -> schema::SessionDeviceRole {
  match role {
    WireRole::Start => schema::SessionDeviceRole::START,
    WireRole::Split | WireRole::Split1 => schema::SessionDeviceRole::SPLIT1,
    WireRole::Split2 => schema::SessionDeviceRole::SPLIT2,
    WireRole::Split3 => schema::SessionDeviceRole::SPLIT3,
    WireRole::Split4 => schema::SessionDeviceRole::SPLIT4,
    WireRole::Stop => schema::SessionDeviceRole::STOP,
    WireRole::Display => schema::SessionDeviceRole::DISPLAY,
    WireRole::Unassigned => schema::SessionDeviceRole::UNASSIGNED,
  }
}

fn maybe_string<'a: 'b, 'b, A: flatbuffers::Allocator + 'a>(
  builder: &'b mut flatbuffers::FlatBufferBuilder<'a, A>,
  value: Option<&str>,
) -> Option<flatbuffers::WIPOffset<&'a str>> {
  let text = value.unwrap_or("").trim();
  if text.is_empty() {
    None
  } else {
    Some(builder.create_string(text))
  }
}

pub fn decode_telemetry_envelope(payload: &[u8]) -> Option<DecodedTelemetryMessage> {
  let envelope = schema::root_as_telemetry_envelope(payload).ok()?;

  match envelope.payload_type() {
    schema::TelemetryPayload::SessionTriggerRequest => {
      let trigger_request = envelope.payload_as_session_trigger_request()?;
      Some(DecodedTelemetryMessage::TriggerRequest(TriggerRequestMessage {
        role: session_device_role_to_wire_role(trigger_request.role()),
        trigger_sensor_nanos: Some(trigger_request.triggerSensorNanos()),
        mapped_host_sensor_nanos: to_optional_i64(trigger_request.mappedHostSensorNanos()),
        source_device_id: Some(trigger_request.sourceDeviceId().to_string()),
        source_elapsed_nanos: Some(trigger_request.sourceElapsedNanos()),
        mapped_anchor_elapsed_nanos: to_optional_i64(trigger_request.mappedAnchorElapsedNanos()),
      }))
    }
    schema::TelemetryPayload::SessionTrigger => {
      let session_trigger = envelope.payload_as_session_trigger()?;
      Some(DecodedTelemetryMessage::SessionTrigger(SessionTriggerMessage {
        trigger_type: session_trigger.triggerType().to_string(),
        split_index: to_optional_i32(session_trigger.splitIndex()),
        trigger_sensor_nanos: Some(session_trigger.triggerSensorNanos()),
      }))
    }
    schema::TelemetryPayload::SessionTimelineSnapshot => {
      let timeline_snapshot = envelope.payload_as_session_timeline_snapshot()?;
      let mut host_split_marks = Vec::new();
      if let Some(markers) = timeline_snapshot.hostSplitMarks() {
        for index in 0..markers.len() {
          let marker = markers.get(index);
          host_split_marks.push(ProtocolSplitMark {
            role: session_device_role_to_wire_role(marker.role()),
            host_sensor_nanos: marker.hostSensorNanos(),
          });
        }
      }

      let host_split_sensor_nanos = host_split_marks
        .iter()
        .map(|split| split.host_sensor_nanos)
        .collect();

      Some(DecodedTelemetryMessage::TimelineSnapshot(TimelineSnapshotPayload {
        r#type: "timeline_snapshot".to_string(),
        host_start_sensor_nanos: to_optional_i64(timeline_snapshot.hostStartSensorNanos()),
        host_stop_sensor_nanos: to_optional_i64(timeline_snapshot.hostStopSensorNanos()),
        host_split_marks,
        host_split_sensor_nanos,
        sent_elapsed_nanos: timeline_snapshot.sentElapsedNanos(),
      }))
    }
    schema::TelemetryPayload::SessionSnapshot => {
      let session_snapshot = envelope.payload_as_session_snapshot()?;
      let mut devices = Vec::new();
      if let Some(snapshot_devices) = session_snapshot.devices() {
        for index in 0..snapshot_devices.len() {
          let device = snapshot_devices.get(index);
          devices.push(crate::state::ProtocolSnapshotDevice {
            id: device.id().map(str::to_string).unwrap_or_default(),
            name: device.name().map(str::to_string).unwrap_or_else(|| "Unknown".to_string()),
            role: match device.role().map(str::to_string).unwrap_or_else(|| "unassigned".to_string()).as_str() {
              "start" => WireRole::Start,
              "split" | "split1" => WireRole::Split1,
              "split2" => WireRole::Split2,
              "split3" => WireRole::Split3,
              "split4" => WireRole::Split4,
              "stop" => WireRole::Stop,
              "display" => WireRole::Display,
              _ => WireRole::Unassigned,
            },
            camera_facing: match device
              .cameraFacing()
              .map(str::to_string)
              .unwrap_or_else(|| "rear".to_string())
              .as_str()
            {
              "front" => CameraFacing::Front,
              _ => CameraFacing::Rear,
            },
            is_local: device.isLocal(),
          });
        }
      }

      let mut host_split_marks = Vec::new();
      if let Some(markers) = session_snapshot.hostSplitMarks() {
        for index in 0..markers.len() {
          let marker = markers.get(index);
          host_split_marks.push(ProtocolSplitMark {
            role: session_device_role_to_wire_role(marker.role()),
            host_sensor_nanos: marker.hostSensorNanos(),
          });
        }
      }

      Some(DecodedTelemetryMessage::SessionSnapshot(ProtocolSnapshot {
        r#type: "snapshot".to_string(),
        stage: session_snapshot
          .stage()
          .map(str::to_string)
          .unwrap_or_else(|| "lobby".to_string()),
        monitoring_active: session_snapshot.monitoringActive(),
        devices,
        timeline: crate::state::ProtocolTimelineSnapshot {
          host_start_sensor_nanos: to_optional_i64(session_snapshot.hostStartSensorNanos()),
          host_stop_sensor_nanos: to_optional_i64(session_snapshot.hostStopSensorNanos()),
          host_split_sensor_nanos: host_split_marks
            .iter()
            .map(|mark| mark.host_sensor_nanos)
            .collect(),
          host_split_marks,
        },
        run_id: session_snapshot.runId().map(str::to_string),
        host_sensor_minus_elapsed_nanos: session_snapshot.hostSensorMinusElapsedNanos(),
        host_gps_utc_offset_nanos: to_optional_i64(session_snapshot.hostGpsUtcOffsetNanos()),
        host_gps_fix_age_nanos: to_optional_i64(session_snapshot.hostGpsFixAgeNanos()),
        self_device_id: session_snapshot.selfDeviceId().map(str::to_string),
        anchor_device_id: session_snapshot.anchorDeviceId().map(str::to_string),
        anchor_state: session_snapshot.anchorState().map(str::to_string),
      }))
    }
    schema::TelemetryPayload::TriggerRefinement => {
      let trigger_refinement = envelope.payload_as_trigger_refinement()?;
      Some(DecodedTelemetryMessage::TriggerRefinement(
        TriggerRefinementMessage {
          run_id: trigger_refinement.runId().map(str::to_string).unwrap_or_default(),
          role: session_device_role_to_wire_role(trigger_refinement.role()),
          provisional_host_sensor_nanos: trigger_refinement.provisionalHostSensorNanos(),
          refined_host_sensor_nanos: trigger_refinement.refinedHostSensorNanos(),
        },
      ))
    }
    schema::TelemetryPayload::DeviceConfigUpdate => {
      let config_update = envelope.payload_as_device_config_update()?;
      Some(DecodedTelemetryMessage::DeviceConfigUpdate {
        target_stable_device_id: config_update
          .targetStableDeviceId()
          .map(str::to_string)
          .unwrap_or_default(),
        sensitivity: config_update.sensitivity(),
      })
    }
    schema::TelemetryPayload::ClockResyncRequest => {
      let request = envelope.payload_as_clock_resync_request()?;
      Some(DecodedTelemetryMessage::ClockResyncRequest {
        sample_count: request.sampleCount(),
      })
    }
    schema::TelemetryPayload::DeviceIdentity => {
      let identity = envelope.payload_as_device_identity()?;
      Some(DecodedTelemetryMessage::DeviceIdentity(DeviceIdentityMessage {
        stable_device_id: identity.stableDeviceId().map(str::to_string).unwrap_or_default(),
        device_name: identity.deviceName().map(str::to_string).unwrap_or_default(),
      }))
    }
    schema::TelemetryPayload::DeviceTelemetry => {
      let telemetry = envelope.payload_as_device_telemetry()?;
      Some(DecodedTelemetryMessage::DeviceTelemetry(DeviceTelemetryMessage {
        stable_device_id: telemetry.stableDeviceId().map(str::to_string).unwrap_or_default(),
        role: session_device_role_to_wire_role(telemetry.role()),
        sensitivity: telemetry.sensitivity(),
        latency_ms: to_optional_i32(telemetry.latencyMs()),
        clock_synced: telemetry.clockSynced(),
        analysis_width: to_optional_i32(telemetry.analysisWidth()),
        analysis_height: to_optional_i32(telemetry.analysisHeight()),
        timestamp_millis: telemetry.timestampMillis(),
      }))
    }
    schema::TelemetryPayload::LapResult => {
      let lap_result = envelope.payload_as_lap_result()?;
      Some(DecodedTelemetryMessage::LapResult(LapResultMessage {
        sender_device_name: lap_result
          .senderDeviceName()
          .map(str::to_string)
          .unwrap_or_default(),
        started_sensor_nanos: lap_result.startedSensorNanos(),
        stopped_sensor_nanos: lap_result.stoppedSensorNanos(),
      }))
    }
    _ => None,
  }
}

pub fn encode_session_snapshot(snapshot: &ProtocolSnapshot) -> Option<Vec<u8>> {
  let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(1024);

  let stage_offset = maybe_string(&mut builder, Some(snapshot.stage.as_str()));

  let mut device_offsets = Vec::with_capacity(snapshot.devices.len());
  for device in &snapshot.devices {
    let id_offset = maybe_string(&mut builder, Some(device.id.as_str()));
    let name_offset = maybe_string(&mut builder, Some(device.name.as_str()));
    let role_offset = maybe_string(&mut builder, Some(device.role.as_str()));
    let camera_offset = maybe_string(
      &mut builder,
      Some(match device.camera_facing {
        CameraFacing::Rear => "rear",
        CameraFacing::Front => "front",
      }),
    );

    let device_offset = schema::SessionSnapshotDevice::create(
      &mut builder,
      &schema::SessionSnapshotDeviceArgs {
        id: id_offset,
        name: name_offset,
        role: role_offset,
        cameraFacing: camera_offset,
        isLocal: device.is_local,
      },
    );

    device_offsets.push(device_offset);
  }

  let devices_vector = if device_offsets.is_empty() {
    None
  } else {
    Some(builder.create_vector(&device_offsets))
  };

  let mut split_mark_offsets = Vec::with_capacity(snapshot.timeline.host_split_marks.len());
  for split_mark in &snapshot.timeline.host_split_marks {
    split_mark_offsets.push(schema::SessionSplitMark::create(
      &mut builder,
      &schema::SessionSplitMarkArgs {
        role: wire_role_to_session_device_role(&split_mark.role),
        hostSensorNanos: split_mark.host_sensor_nanos,
      },
    ));
  }

  let split_marks_vector = if split_mark_offsets.is_empty() {
    None
  } else {
    Some(builder.create_vector(&split_mark_offsets))
  };

  let run_id_offset = maybe_string(&mut builder, snapshot.run_id.as_deref());
  let self_device_offset = maybe_string(&mut builder, snapshot.self_device_id.as_deref());
  let anchor_device_offset = maybe_string(&mut builder, snapshot.anchor_device_id.as_deref());
  let anchor_state_offset = maybe_string(&mut builder, snapshot.anchor_state.as_deref());

  let snapshot_offset = schema::SessionSnapshot::create(
    &mut builder,
    &schema::SessionSnapshotArgs {
      stage: stage_offset,
      monitoringActive: snapshot.monitoring_active,
      devices: devices_vector,
      hostStartSensorNanos: snapshot.timeline.host_start_sensor_nanos.unwrap_or(-1),
      hostStopSensorNanos: snapshot.timeline.host_stop_sensor_nanos.unwrap_or(-1),
      hostSplitMarks: split_marks_vector,
      runId: run_id_offset,
      hostSensorMinusElapsedNanos: snapshot.host_sensor_minus_elapsed_nanos,
      hostGpsUtcOffsetNanos: snapshot.host_gps_utc_offset_nanos.unwrap_or(-1),
      hostGpsFixAgeNanos: snapshot.host_gps_fix_age_nanos.unwrap_or(-1),
      selfDeviceId: self_device_offset,
      anchorDeviceId: anchor_device_offset,
      anchorState: anchor_state_offset,
    },
  );

  let envelope_offset = schema::TelemetryEnvelope::create(
    &mut builder,
    &schema::TelemetryEnvelopeArgs {
      payload_type: schema::TelemetryPayload::SessionSnapshot,
      payload: Some(snapshot_offset.as_union_value()),
    },
  );

  schema::finish_telemetry_envelope_buffer(&mut builder, envelope_offset);
  Some(wrap_telemetry_frame(builder.finished_data()))
}

pub fn encode_device_config_update(target_stable_device_id: &str, sensitivity: i32) -> Option<Vec<u8>> {
  if target_stable_device_id.trim().is_empty() {
    return None;
  }

  let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(96);
  let target_id_offset = builder.create_string(target_stable_device_id.trim());

  let config_offset = schema::DeviceConfigUpdate::create(
    &mut builder,
    &schema::DeviceConfigUpdateArgs {
      targetStableDeviceId: Some(target_id_offset),
      sensitivity,
    },
  );

  let envelope_offset = schema::TelemetryEnvelope::create(
    &mut builder,
    &schema::TelemetryEnvelopeArgs {
      payload_type: schema::TelemetryPayload::DeviceConfigUpdate,
      payload: Some(config_offset.as_union_value()),
    },
  );

  schema::finish_telemetry_envelope_buffer(&mut builder, envelope_offset);
  Some(wrap_telemetry_frame(builder.finished_data()))
}

pub fn encode_clock_resync_request(sample_count: i32) -> Option<Vec<u8>> {
  let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(64);

  let resync_offset = schema::ClockResyncRequest::create(
    &mut builder,
    &schema::ClockResyncRequestArgs {
      sampleCount: sample_count,
    },
  );

  let envelope_offset = schema::TelemetryEnvelope::create(
    &mut builder,
    &schema::TelemetryEnvelopeArgs {
      payload_type: schema::TelemetryPayload::ClockResyncRequest,
      payload: Some(resync_offset.as_union_value()),
    },
  );

  schema::finish_telemetry_envelope_buffer(&mut builder, envelope_offset);
  Some(wrap_telemetry_frame(builder.finished_data()))
}

pub fn encode_trigger_refinement(
  run_id: &str,
  role: WireRole,
  provisional_host_sensor_nanos: i64,
  refined_host_sensor_nanos: i64,
) -> Option<Vec<u8>> {
  if run_id.trim().is_empty() {
    return None;
  }

  let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(196);
  let run_id_offset = builder.create_string(run_id.trim());

  let refinement_offset = schema::TriggerRefinement::create(
    &mut builder,
    &schema::TriggerRefinementArgs {
      runId: Some(run_id_offset),
      role: wire_role_to_session_device_role(&role),
      provisionalHostSensorNanos: provisional_host_sensor_nanos,
      refinedHostSensorNanos: refined_host_sensor_nanos,
    },
  );

  let envelope_offset = schema::TelemetryEnvelope::create(
    &mut builder,
    &schema::TelemetryEnvelopeArgs {
      payload_type: schema::TelemetryPayload::TriggerRefinement,
      payload: Some(refinement_offset.as_union_value()),
    },
  );

  schema::finish_telemetry_envelope_buffer(&mut builder, envelope_offset);
  Some(wrap_telemetry_frame(builder.finished_data()))
}

pub fn encode_session_trigger(trigger_type: &str, trigger_sensor_nanos: i64, split_index: Option<i32>) -> Option<Vec<u8>> {
  if trigger_type.trim().is_empty() {
    return None;
  }

  let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(128);
  let trigger_type_offset = builder.create_string(trigger_type.trim());

  let trigger_offset = schema::SessionTrigger::create(
    &mut builder,
    &schema::SessionTriggerArgs {
      triggerType: Some(trigger_type_offset),
      splitIndex: split_index.unwrap_or(-1),
      triggerSensorNanos: trigger_sensor_nanos,
    },
  );

  let envelope_offset = schema::TelemetryEnvelope::create(
    &mut builder,
    &schema::TelemetryEnvelopeArgs {
      payload_type: schema::TelemetryPayload::SessionTrigger,
      payload: Some(trigger_offset.as_union_value()),
    },
  );

  schema::finish_telemetry_envelope_buffer(&mut builder, envelope_offset);
  Some(wrap_telemetry_frame(builder.finished_data()))
}

pub fn encode_timeline_snapshot(payload: &TimelineSnapshotPayload) -> Option<Vec<u8>> {
  let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(384);

  let mut split_mark_offsets = Vec::with_capacity(payload.host_split_marks.len());
  for split_mark in &payload.host_split_marks {
    split_mark_offsets.push(schema::SessionSplitMark::create(
      &mut builder,
      &schema::SessionSplitMarkArgs {
        role: wire_role_to_session_device_role(&split_mark.role),
        hostSensorNanos: split_mark.host_sensor_nanos,
      },
    ));
  }

  let split_marks_vector = if split_mark_offsets.is_empty() {
    None
  } else {
    Some(builder.create_vector(&split_mark_offsets))
  };

  let timeline_offset = schema::SessionTimelineSnapshot::create(
    &mut builder,
    &schema::SessionTimelineSnapshotArgs {
      hostStartSensorNanos: payload.host_start_sensor_nanos.unwrap_or(-1),
      hostStopSensorNanos: payload.host_stop_sensor_nanos.unwrap_or(-1),
      hostSplitMarks: split_marks_vector,
      sentElapsedNanos: payload.sent_elapsed_nanos,
    },
  );

  let envelope_offset = schema::TelemetryEnvelope::create(
    &mut builder,
    &schema::TelemetryEnvelopeArgs {
      payload_type: schema::TelemetryPayload::SessionTimelineSnapshot,
      payload: Some(timeline_offset.as_union_value()),
    },
  );

  schema::finish_telemetry_envelope_buffer(&mut builder, envelope_offset);
  Some(wrap_telemetry_frame(builder.finished_data()))
}
