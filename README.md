# osu! ChokeLens

**A real-time performance analysis overlay for osu!stable.**

osu! ChokeLens is an open-source Windows desktop application designed to help osu! players understand their performance, analyze missed opportunities, and identify their strongest gameplay segments.

Built with **Tauri 2, Rust, React, and TypeScript**, ChokeLens connects to [tosu](https://github.com/tosuapp/tosu) to receive live gameplay data and display performance information through a customizable overlay.

> **Development Status:** 🚧 Work in progress (early development). Some features are experimental, and overlay visibility may not work reliably in all osu! display modes.

## Features

### Real-Time osu! Integration

- Connects to osu!stable through the tosu WebSocket API.
- Detects game states, including song selection and gameplay.
- Displays beatmap information, including artist, title, difficulty, mapper, star rating, BPM, AR, and OD.
- Automatically hides the overlay during gameplay.

### Last Play Analysis

Automatically captures gameplay statistics after an attempt, including:

- Accuracy and score
- Misses and slider breaks
- Maximum combo
- Performance points (PP)
- Estimated full-combo PP
- Unstable rate, when available
- Basic potential-choke detection

The latest result is saved locally and remains available between application sessions.

### Godmode Recorder

Automatically records gameplay samples to identify strong combo segments.

- Records beatmap timestamps and combo progression.
- Tracks misses, slider breaks, and accuracy.
- Identifies the strongest recorded segment by combo gain.
- Displays segment start time, end time, duration, and combo progression.
- Saves the latest recording locally.

**Note:** The current Godmode Recorder uses combo-based detection. Difficulty-aware Godmode Detection is planned for a future release.

### Automatic Beatmap Finder

- Uses the beatmap checksum provided by tosu.
- Searches the local osu! Songs directory for a matching `.osu` file.
- Verifies beatmaps using MD5 checksums.
- Parses beatmap data with `rosu-pp`.
- Extracts hit object counts and timing information.

**Current limitation:** The Songs directory is configured in the Rust source code, and the initial search may be slow for large beatmap libraries.

### Customizable Overlay

- Transparent, borderless, always-on-top window.
- Draggable and resizable interface.
- Custom background, text, accent, and border colors.
- Adjustable background opacity.
- Configurable global keyboard shortcut.
- Persistent local settings.

## Tech Stack

| Technology | Purpose |
|---|---|
| Tauri 2 | Windows desktop application |
| Rust | Native backend and system integration |
| React | User interface |
| TypeScript | Frontend application logic |
| Vite | Development and frontend tooling |
| tosu | Live osu! gameplay data |
| rosu-pp | Beatmap parsing and analysis |

## Requirements

- Windows 10 or Windows 11
- osu!stable
- [tosu](https://github.com/tosuapp/tosu)
- Node.js and npm
- Rust toolchain
- Microsoft C++ Build Tools and WebView2, as required by Tauri on Windows

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/simokostovcik-hash/osu-chokelens.git
cd osu-chokelens
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start tosu

Launch tosu and make sure its local API is running.

ChokeLens currently connects to:

```text
ws://127.0.0.1:24050/websocket/v2
```

### 4. Configure your osu! Songs directory

The current Beatmap Finder uses a hardcoded Songs directory in:

```text
src-tauri/src/beatmap_finder.rs
```

Update `SONGS_DIRECTORY` to match your local osu!stable installation.

### 5. Run in development mode

```bash
npm run tauri dev
```

### 6. Build the application

```bash
npm run tauri build
```

## Keyboard Shortcut

The default shortcut is:

**Ctrl + Shift + K**

The shortcut can be changed in the overlay settings. A previously saved shortcut takes priority over the default.

The overlay is designed to open while osu!stable is in the song selection screen and hide during gameplay.

## How Godmode Recording Works

1. ChokeLens detects when gameplay starts.
2. It records periodic gameplay samples from tosu.
3. Each sample contains the current beatmap timestamp, combo, accuracy, misses, and slider breaks.
4. After gameplay ends, the recorder analyzes uninterrupted combo segments.
5. The segment with the highest combo gain is selected.
6. The result is saved locally and displayed in the overlay.

This is an initial detection method, not a complete measure of gameplay difficulty.

## Roadmap

- [x] Tauri desktop application
- [x] tosu WebSocket integration
- [x] Customizable overlay
- [x] Configurable global hotkey
- [x] Last Play Analysis
- [x] Automatic Godmode Recording
- [x] Combo-based segment detection
- [x] Beatmap checksum lookup
- [x] Beatmap parsing with rosu-pp
- [ ] Improve overlay compatibility and reliability
- [ ] Non-blocking beatmap indexing and caching
- [ ] Configurable osu! installation path
- [ ] Difficulty-aware Godmode Detection Engine
- [ ] More advanced choke analysis
- [ ] Dedicated replay viewer
- [ ] Automated replay file integration
- [ ] Release builds and installer

## Known Limitations

- The project is in early development and is not yet production-ready.
- Overlay visibility can be unreliable depending on osu! display settings.
- The Beatmap Finder currently performs a filesystem scan and may take time on large libraries.
- The Songs directory must currently be configured manually in the source code.
- Choke detection is heuristic and should not be treated as a definitive assessment.
- Godmode detection currently prioritizes combo gain rather than segment difficulty.
- Replay playback is not implemented.

## Contributing

Contributions, bug reports, and feature suggestions are welcome.

If you encounter a bug, please open an issue and include the steps needed to reproduce it, relevant logs, and your Windows and osu! display settings.

## Disclaimer

osu! ChokeLens is an independent community project and is not affiliated with, endorsed by, or officially supported by osu! or its developers.

osu! is a trademark of its respective owner.

---

**Built for osu! players who want to understand every play.**
