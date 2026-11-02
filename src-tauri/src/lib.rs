
mod beatmap_analyzer;
mod beatmap_finder;

use std::fs;
use std::sync::Mutex;

use tauri::{Manager, State};
use tauri_plugin_global_shortcut::{
    GlobalShortcutExt, Shortcut, ShortcutState,
};

const DEFAULT_HOTKEY: &str = "Ctrl+Shift+K";

struct HotkeyState {
    current: Mutex<String>,
}

struct GameState {
    overlay_allowed: Mutex<bool>,
}

// Zjistí, jestli je aktivní okno osu!stable.
#[cfg(target_os = "windows")]
fn is_osu_foreground() -> bool {
    use std::ffi::c_void;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> *mut c_void;

        fn GetWindowThreadProcessId(
            hwnd: *mut c_void,
            process_id: *mut u32,
        ) -> u32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(
            desired_access: u32,
            inherit_handle: i32,
            process_id: u32,
        ) -> *mut c_void;

        fn QueryFullProcessImageNameW(
            process: *mut c_void,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;

        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    unsafe {
        let hwnd = GetForegroundWindow();

        if hwnd.is_null() {
            return false;
        }

        let mut process_id = 0u32;

        GetWindowThreadProcessId(
            hwnd,
            &mut process_id,
        );

        if process_id == 0 {
            return false;
        }

        let process = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            process_id,
        );

        if process.is_null() {
            return false;
        }

        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;

        let success = QueryFullProcessImageNameW(
            process,
            0,
            buffer.as_mut_ptr(),
            &mut size,
        );

        CloseHandle(process);

        if success == 0 {
            return false;
        }

        let path = String::from_utf16_lossy(
            &buffer[..size as usize],
        );

        let executable = path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();

        executable == "osu!.exe"
    }
}

#[cfg(not(target_os = "windows"))]
fn is_osu_foreground() -> bool {
    false
}

// Cesta k uloženému nastavení hotkey.
fn hotkey_file(
    app: &tauri::AppHandle,
) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    fs::create_dir_all(&directory)
        .map_err(|error| error.to_string())?;

    Ok(directory.join("hotkey.txt"))
}

// Uložení hotkey.
fn save_hotkey(
    app: &tauri::AppHandle,
    hotkey: &str,
) -> Result<(), String> {
    let path = hotkey_file(app)?;

    fs::write(path, hotkey)
        .map_err(|error| error.to_string())
}

// Načtení uložené hotkey.
fn load_hotkey(app: &tauri::AppHandle) -> String {
    hotkey_file(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string())
}

// Vrátí aktuální hotkey do Reactu.
#[tauri::command]
fn get_hotkey(
    state: State<'_, HotkeyState>,
) -> Result<String, String> {
    state
        .current
        .lock()
        .map(|value| value.clone())
        .map_err(|error| error.to_string())
}

// Změna hotkey z Reactu.
#[tauri::command]
fn set_hotkey(
    app: tauri::AppHandle,
    state: State<'_, HotkeyState>,
    hotkey: String,
) -> Result<String, String> {
    let hotkey = hotkey.trim().to_string();

    let new_shortcut: Shortcut = hotkey
        .parse()
        .map_err(|_| {
            "Invalid keyboard shortcut".to_string()
        })?;

    let mut current = state
        .current
        .lock()
        .map_err(|error| error.to_string())?;

    let old_shortcut: Shortcut = current
        .parse()
        .map_err(|_| {
            "Current shortcut is invalid".to_string()
        })?;

    if new_shortcut == old_shortcut {
        return Ok(current.clone());
    }

    let shortcuts = app.global_shortcut();

    shortcuts
        .register(new_shortcut)
        .map_err(|error| {
            format!(
                "This shortcut is unavailable: {error}"
            )
        })?;

    if let Err(error) = save_hotkey(&app, &hotkey) {
        let _ = shortcuts.unregister(new_shortcut);
        return Err(error);
    }

    if shortcuts.is_registered(old_shortcut) {
        if let Err(error) =
            shortcuts.unregister(old_shortcut)
        {
            let _ = shortcuts.unregister(new_shortcut);
            let _ = save_hotkey(&app, &current);

            return Err(format!(
                "Failed to unregister previous shortcut: {error}"
            ));
        }
    }

    *current = hotkey.clone();

    println!(
        "[ChokeLens] Hotkey changed to: {}",
        hotkey
    );

    Ok(hotkey)
}

// React posílá aktuální stav osu!.
#[tauri::command]
fn update_game_state(
    app: tauri::AppHandle,
    state: State<'_, GameState>,
    game_state: String,
) -> Result<(), String> {
    let allowed = game_state == "selectPlay";

    println!(
        "[ChokeLens] Game state: {}, overlay allowed: {}",
        game_state,
        allowed
    );

    {
        let mut overlay_allowed = state
            .overlay_allowed
            .lock()
            .map_err(|error| error.to_string())?;

        *overlay_allowed = allowed;
    }

    // Během hraní a mimo výběr map overlay skryjeme.
    if !allowed {
        if let Some(window) = app.get_webview_window("main") {
            if let Err(error) = window.hide() {
                eprintln!(
                    "[ChokeLens] Failed to hide overlay: {}",
                    error
                );
            }
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(HotkeyState {
            current: Mutex::new(
                DEFAULT_HOTKEY.to_string()
            ),
        })
        .manage(GameState {
            overlay_allowed: Mutex::new(false),
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(
                    |app, pressed_shortcut, event| {
                        if event.state()
                            != ShortcutState::Pressed
                        {
                            return;
                        }

                        let hotkey_state =
                            app.state::<HotkeyState>();

                        let current_hotkey = hotkey_state
                            .current
                            .lock()
                            .map(|value| value.clone())
                            .unwrap_or_default();

                        let is_current = current_hotkey
                            .parse::<Shortcut>()
                            .map(|shortcut| {
                                shortcut == *pressed_shortcut
                            })
                            .unwrap_or(false);

                        if !is_current {
                            println!(
                                "[ChokeLens] Ignored shortcut: not current hotkey"
                            );
                            return;
                        }

                        let game_state =
                            app.state::<GameState>();

                        let allowed = game_state
                            .overlay_allowed
                            .lock()
                            .map(|value| *value)
                            .unwrap_or(false);

                        let osu_active = is_osu_foreground();

                        println!(
                            "[ChokeLens] Hotkey pressed. Allowed: {}, osu foreground: {}",
                            allowed,
                            osu_active
                        );

                        if let Some(window) =
                            app.get_webview_window("main")
                        {
                            let visible = window
                                .is_visible()
                                .unwrap_or(false);

                            if visible {
                                // Overlay lze vždy zavřít.
                                match window.hide() {
                                    Ok(()) => {
                                        println!(
                                            "[ChokeLens] Overlay hidden"
                                        );
                                    }
                                    Err(error) => {
                                        eprintln!(
                                            "[ChokeLens] Hide failed: {}",
                                            error
                                        );
                                    }
                                }
                            } else if allowed && osu_active {
                                // Otevření pouze při song selectu.
                                match window.show() {
                                    Ok(()) => {
                                        println!(
                                            "[ChokeLens] Overlay shown"
                                        );

                                        if let Err(error) =
                                            window.set_focus()
                                        {
                                            eprintln!(
                                                "[ChokeLens] Focus failed: {}",
                                                error
                                            );
                                        }
                                    }
                                    Err(error) => {
                                        eprintln!(
                                            "[ChokeLens] Show failed: {}",
                                            error
                                        );
                                    }
                                }
                            } else {
                                println!(
                                    "[ChokeLens] Overlay blocked: allowed={}, osu_active={}",
                                    allowed,
                                    osu_active
                                );
                            }
                        } else {
                            eprintln!(
                                "[ChokeLens] Main window not found"
                            );
                        }
                    },
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_hotkey,
            set_hotkey,
            update_game_state,
            beatmap_analyzer::analyze_beatmap,
            beatmap_finder::find_beatmap,
        ])
        .setup(|app| {
            let handle = app.handle();
            let saved = load_hotkey(handle);

            let shortcuts = app.global_shortcut();

            let saved_registered = saved
                .parse::<Shortcut>()
                .ok()
                .map(|shortcut| {
                    shortcuts.register(shortcut).is_ok()
                })
                .unwrap_or(false);

            let active_hotkey = if saved_registered {
                println!(
                    "[ChokeLens] Registered saved hotkey: {}",
                    saved
                );

                saved
            } else {
                let fallback: Shortcut =
                    DEFAULT_HOTKEY.parse().map_err(
                        |error| {
                            format!(
                                "Invalid default hotkey: {error}"
                            )
                        },
                    )?;

                if saved != DEFAULT_HOTKEY {
                    match shortcuts.register(fallback) {
                        Ok(()) => {
                            println!(
                                "[ChokeLens] Registered fallback hotkey: {}",
                                DEFAULT_HOTKEY
                            );
                        }
                        Err(error) => {
                            eprintln!(
                                "[ChokeLens] Cannot register fallback hotkey: {}",
                                error
                            );
                        }
                    }
                } else {
                    eprintln!(
                        "[ChokeLens] Shortcut {} is unavailable",
                        DEFAULT_HOTKEY
                    );
                }

                DEFAULT_HOTKEY.to_string()
            };

            let state = app.state::<HotkeyState>();

            *state
                .current
                .lock()
                .map_err(|error| error.to_string())? =
                active_hotkey.clone();

            println!(
                "[ChokeLens] Active hotkey: {}",
                active_hotkey
            );

            if let Some(window) =
                app.get_webview_window("main")
            {
                if let Err(error) = window.hide() {
                    eprintln!(
                        "[ChokeLens] Initial hide failed: {}",
                        error
                    );
                }
            } else {
                eprintln!(
                    "[ChokeLens] Main window not found during setup"
                );
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect(
            "error while running tauri application"
        );
}
