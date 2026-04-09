use crate::state::{CompareResultsPayload, CompareResultsSeries, LoadedSavedResultFile, SavedResultSummary, SavedResultsFilePayload};
use regex::Regex;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn parse_i64_field(value: Option<&Value>) -> Option<i64> {
  value.and_then(|entry| {
    if let Some(integer) = entry.as_i64() {
      Some(integer)
    } else if let Some(float) = entry.as_f64() {
      Some(float as i64)
    } else if let Some(text) = entry.as_str() {
      text.parse::<i64>().ok()
    } else {
      None
    }
  })
}

fn parse_string_field(value: Option<&Value>) -> Option<String> {
  value
    .and_then(Value::as_str)
    .map(str::trim)
    .filter(|entry| !entry.is_empty())
    .map(str::to_string)
}

pub fn sanitize_file_name_segment(raw_name: &str) -> String {
  let normalized = raw_name.trim();
  let cleaned = Regex::new(r"[^a-zA-Z0-9._-]+")
    .expect("sanitize regex must compile")
    .replace_all(normalized, "_");
  let stripped = cleaned.trim_matches('_');
  if stripped.is_empty() {
    "results".to_string()
  } else {
    stripped.chars().take(80).collect()
  }
}

pub fn is_safe_saved_results_file_name(file_name: &str) -> bool {
  Regex::new(r"^[a-zA-Z0-9._-]+\.json$")
    .expect("safe filename regex must compile")
    .is_match(file_name)
}

pub async fn load_saved_results_file(
  results_dir: &Path,
  file_name: &str,
) -> Result<Option<LoadedSavedResultFile>, String> {
  if !is_safe_saved_results_file_name(file_name) {
    return Ok(None);
  }

  let file_path = results_dir.join(file_name);
  let raw_content = match tokio::fs::read_to_string(&file_path).await {
    Ok(content) => content,
    Err(error) => {
      if error.kind() == std::io::ErrorKind::NotFound {
        return Ok(None);
      }
      return Err(format!("failed to read saved result file {}: {error}", file_path.display()));
    }
  };

  let payload = serde_json::from_str::<SavedResultsFilePayload>(&raw_content)
    .map_err(|error| format!("failed to parse saved result file {}: {error}", file_path.display()))?;

  Ok(Some(LoadedSavedResultFile {
    file_name: file_name.to_string(),
    file_path: file_path.to_string_lossy().to_string(),
    payload,
  }))
}

fn summarize_saved_results(file_name: &str, file_path: &Path, payload: &Value, metadata: &std::fs::Metadata) -> SavedResultSummary {
  let latest_lap_results = payload
    .get("latestLapResults")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();

  let best_elapsed_nanos = latest_lap_results
    .iter()
    .find_map(|lap| parse_i64_field(lap.get("elapsedNanos")));

  let result_name = parse_string_field(payload.get("resultName"))
    .unwrap_or_else(|| file_name.trim_end_matches(".json").to_string());

  let saved_at_iso = parse_string_field(payload.get("exportedAtIso")).unwrap_or_else(|| {
    metadata
      .modified()
      .ok()
      .map(|modified| chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339())
      .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
  });

  SavedResultSummary {
    file_name: file_name.to_string(),
    file_path: file_path.to_string_lossy().to_string(),
    result_name,
    athlete_name: parse_string_field(payload.get("athleteName")),
    notes: parse_string_field(payload.get("notes")),
    run_id: parse_string_field(payload.get("runId")),
    saved_at_iso,
    result_count: latest_lap_results.len(),
    best_elapsed_nanos,
  }
}

pub async fn list_saved_result_items(results_dir: &Path) -> Result<Vec<SavedResultSummary>, String> {
  tokio::fs::create_dir_all(results_dir)
    .await
    .map_err(|error| format!("failed to create results directory {}: {error}", results_dir.display()))?;

  let mut reader = tokio::fs::read_dir(results_dir)
    .await
    .map_err(|error| format!("failed to read results directory {}: {error}", results_dir.display()))?;

  let mut items = Vec::<SavedResultSummary>::new();

  loop {
    let entry = reader
      .next_entry()
      .await
      .map_err(|error| format!("failed to iterate results directory {}: {error}", results_dir.display()))?;
    let Some(dir_entry) = entry else {
      break;
    };

    let file_name = dir_entry.file_name().to_string_lossy().to_string();
    if !is_safe_saved_results_file_name(&file_name) {
      continue;
    }

    let file_path = dir_entry.path();
    let Ok(raw_content) = tokio::fs::read_to_string(&file_path).await else {
      continue;
    };
    let Ok(payload) = serde_json::from_str::<Value>(&raw_content) else {
      continue;
    };
    let Ok(metadata) = dir_entry.metadata().await else {
      continue;
    };

    items.push(summarize_saved_results(&file_name, &file_path, &payload, &metadata));
  }

  items.sort_by(|left, right| right.saved_at_iso.cmp(&left.saved_at_iso));
  Ok(items)
}

pub async fn save_results(
  results_dir: &Path,
  file_name: &str,
  payload: &SavedResultsFilePayload,
) -> Result<String, String> {
  if !is_safe_saved_results_file_name(file_name) {
    return Err("invalid file name".to_string());
  }

  tokio::fs::create_dir_all(results_dir)
    .await
    .map_err(|error| format!("failed to create results directory {}: {error}", results_dir.display()))?;

  let file_path = results_dir.join(file_name);
  let content = format!(
    "{}\n",
    serde_json::to_string_pretty(payload).map_err(|error| format!("failed to serialize results payload: {error}"))?
  );

  tokio::fs::write(&file_path, content)
    .await
    .map_err(|error| format!("failed to write result file {}: {error}", file_path.display()))?;

  Ok(file_path.to_string_lossy().to_string())
}

pub async fn compare_results(
  results_dir: &Path,
  selected_file_names: &[String],
  athlete_name: Option<&str>,
) -> Result<CompareResultsPayload, String> {
  let all_items = list_saved_result_items(results_dir).await?;
  let all_by_file_name = all_items
    .iter()
    .map(|item| (item.file_name.clone(), item.clone()))
    .collect::<std::collections::HashMap<_, _>>();

  let target_file_names: Vec<String> = if selected_file_names.is_empty() {
    all_items.iter().take(4).map(|item| item.file_name.clone()).collect()
  } else {
    selected_file_names.to_vec()
  };

  let requested_athlete = athlete_name
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string);

  let mut resolved_athlete = requested_athlete;
  if resolved_athlete.is_none() {
    if let Some(first_item) = target_file_names.first().and_then(|name| all_by_file_name.get(name)) {
      resolved_athlete = first_item.athlete_name.clone();
    }
  }

  let mut series = Vec::<CompareResultsSeries>::new();
  let mut labels = Vec::<String>::new();

  for file_name in target_file_names {
    let Some(loaded_file) = load_saved_results_file(results_dir, &file_name).await? else {
      continue;
    };

    if let Some(expected_athlete) = &resolved_athlete {
      if loaded_file
        .payload
        .athlete_name
        .as_deref()
        .map(|candidate| candidate.eq_ignore_ascii_case(expected_athlete))
        != Some(true)
      {
        continue;
      }
    }

    let mut values_seconds = Vec::<Option<f64>>::new();
    let mut local_labels = Vec::<String>::new();

    for (index, lap) in loaded_file.payload.latest_lap_results.iter().enumerate() {
      let checkpoint_label = if lap.role_label.as_str().is_empty() {
        format!("Point {}", index + 1)
      } else {
        lap.role_label.as_str().to_string()
      };
      local_labels.push(checkpoint_label);

      let elapsed_seconds = if lap.base.elapsed_nanos > 0 {
        Some(((lap.base.elapsed_nanos as f64) / 1_000_000_000.0 * 1000.0).round() / 1000.0)
      } else {
        None
      };
      values_seconds.push(elapsed_seconds);
    }

    if labels.is_empty() {
      labels = local_labels;
    }

    series.push(CompareResultsSeries {
      label: loaded_file.payload.result_name.clone(),
      values_seconds,
      source_file_name: loaded_file.file_name,
    });
  }

  Ok(CompareResultsPayload {
    athlete_name: resolved_athlete,
    labels,
    series,
  })
}

pub fn app_results_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
  let Some(app_data_dir) = app_handle.path().app_data_dir().ok() else {
    return Err("failed to resolve app data dir".to_string());
  };
  Ok(app_data_dir.join("results"))
}
