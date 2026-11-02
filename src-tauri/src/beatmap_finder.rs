
use std::fs;
use std::path::{Path, PathBuf};

const SONGS_DIRECTORY: &str = r"K:\osu!\Songs";

#[tauri::command]
pub fn find_beatmap(
    checksum: String,
) -> Result<String, String> {
    let checksum = checksum.trim().to_ascii_lowercase();

    if checksum.len() != 32
        || !checksum.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Invalid beatmap checksum".to_string());
    }

    let songs = Path::new(SONGS_DIRECTORY);

    if !songs.is_dir() {
        return Err(format!(
            "Songs directory not found: {}",
            songs.display()
        ));
    }

    let mut directories: Vec<PathBuf> =
        vec![songs.to_path_buf()];

    while let Some(directory) = directories.pop() {
        let entries = fs::read_dir(&directory)
            .map_err(|error| error.to_string())?;

        for entry in entries {
            let entry =
                entry.map_err(|error| error.to_string())?;

            let path = entry.path();

            if path.is_dir() {
                directories.push(path);
                continue;
            }

            let is_osu = path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| {
                    extension.eq_ignore_ascii_case("osu")
                })
                .unwrap_or(false);

            if !is_osu {
                continue;
            }

            let bytes = match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };

            let digest = format!("{:x}", md5::compute(bytes));

            if digest == checksum {
                return Ok(path.to_string_lossy().into_owned());
            }
        }
    }

    Err("Beatmap not found in Songs directory".to_string())
}
