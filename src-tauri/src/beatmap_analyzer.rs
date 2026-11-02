
use rosu_pp::Beatmap;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatmapAnalysis {
    pub object_count: usize,
    pub first_object_time: f64,
    pub last_object_time: f64,
    pub duration_ms: f64,
}

#[tauri::command]
pub fn analyze_beatmap(
    path: String,
) -> Result<BeatmapAnalysis, String> {
    let file_path = Path::new(&path);

    if !file_path.is_file() {
        return Err(
            "Beatmap file does not exist.".to_string()
        );
    }

    if file_path.extension().and_then(|e| e.to_str()) != Some("osu") {
        return Err(
            "Please select a .osu beatmap file.".to_string()
        );
    }

    let map = Beatmap::from_path(file_path)
        .map_err(|error| format!(
            "Failed to read beatmap: {error}"
        ))?;

    let first = map
        .hit_objects
        .first()
        .map(|object| object.start_time)
        .unwrap_or(0.0);

    let last = map
        .hit_objects
        .last()
        .map(|object| object.start_time)
        .unwrap_or(0.0);

    Ok(BeatmapAnalysis {
        object_count: map.hit_objects.len(),
        first_object_time: first,
        last_object_time: last,
        duration_ms: (last - first).max(0.0),
    })
}
