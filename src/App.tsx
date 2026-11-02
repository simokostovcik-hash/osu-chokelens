
import {
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type MouseEvent,
} from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

import {
    connectToTosu,
    createPlayResult,
    type PlayResult,
    type TosuData,
} from "./tosu";

import {
    GodmodeRecorder,
    type GodmodeRecording,
} from "./godmodeRecorder";

import "./App.css";

type ThemeSettings = {
    background: string;
    text: string;
    accent: string;
    border: string;
    opacity: number;
};

type ColorKey =
    | "background"
    | "text"
    | "accent"
    | "border";

type BeatmapAnalysis = {
    objectCount: number;
    firstObjectTime: number;
    lastObjectTime: number;
    durationMs: number;
};

type BeatmapLookup = {
    checksum: string;
    status: "loading" | "ready" | "error";
    path?: string;
    analysis?: BeatmapAnalysis;
    error?: string;
};

const DEFAULT_HOTKEY = "Ctrl+Shift+K";
const THEME_KEY = "chokelens-theme";
const LAST_PLAY_KEY = "chokelens-last-play";
const LAST_GODMODE_KEY = "chokelens-last-godmode";

const defaults: ThemeSettings = {
    background: "#101827",
    text: "#ffffff",
    accent: "#65bfff",
    border: "#406080",
    opacity: 92,
};

const colorFields: {
    key: ColorKey;
    label: string;
}[] = [
    { key: "background", label: "Background" },
    { key: "text", label: "Text color" },
    { key: "accent", label: "Accent color" },
    { key: "border", label: "Border color" },
];

function loadStored<T>(key: string): T | null {
    try {
        const value = localStorage.getItem(key);
        return value ? (JSON.parse(value) as T) : null;
    } catch {
        return null;
    }
}

function loadSettings(): ThemeSettings {
    return {
        ...defaults,
        ...(loadStored<Partial<ThemeSettings>>(THEME_KEY) ?? {}),
    };
}

function formatNumber(
    value: number,
    digits = 2
): string {
    return Number.isFinite(value)
        ? value.toFixed(digits)
        : "0";
}

function formatTime(milliseconds: number): string {
    const seconds = Math.floor(
        Math.max(0, milliseconds) / 1000
    );

    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(
        remaining
    ).padStart(2, "0")}`;
}

function formatHotkey(value: string): string {
    return value.split("+").join(" + ");
}

function getShortcutKey(
    event: KeyboardEvent<HTMLButtonElement>
): string | null {
    if (/^Key[A-Z]$/.test(event.code)) {
        return event.code.slice(3);
    }

    if (/^Digit[0-9]$/.test(event.code)) {
        return event.code.slice(5);
    }

    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) {
        return event.code;
    }

    return null;
}

function getChokeAnalysis(result: PlayResult): {
    label: string;
    description: string;
    color: string;
} {
    if (result.failed) {
        return {
            label: "Failed attempt",
            description: "The play ended in a fail.",
            color: "#ff8585",
        };
    }

    const comboRatio =
        result.mapMaxCombo > 0
            ? result.maxCombo / result.mapMaxCombo
            : 0;

    if (
        result.misses > 0 &&
        result.misses <= 3 &&
        comboRatio >= 0.75
    ) {
        return {
            label: "Possible choke",
            description:
                "Few misses and a high max combo suggest a possible choke.",
            color: "#ffca78",
        };
    }

    if (
        result.misses === 0 &&
        result.sliderBreaks === 0 &&
        result.mapMaxCombo > 0 &&
        result.maxCombo >= result.mapMaxCombo
    ) {
        return {
            label: "Full combo",
            description:
                "No misses or sliderbreaks detected.",
            color: "#62e6a2",
        };
    }

    return {
        label: "Play recorded",
        description: "Basic statistics are available.",
        color: "#65bfff",
    };
}

function App() {
    const [theme, setTheme] =
        useState<ThemeSettings>(loadSettings);

    const [settingsOpen, setSettingsOpen] =
        useState(false);

    const [analysisOpen, setAnalysisOpen] =
        useState(true);

    const [godmodeOpen, setGodmodeOpen] =
        useState(true);

    const [tosuData, setTosuData] =
        useState<TosuData | null>(null);

    const [tosuConnected, setTosuConnected] =
        useState(false);

    const [lastPlay, setLastPlay] =
        useState<PlayResult | null>(() =>
            loadStored<PlayResult>(LAST_PLAY_KEY)
        );

    const [lastGodmode, setLastGodmode] =
        useState<GodmodeRecording | null>(() =>
            loadStored<GodmodeRecording>(LAST_GODMODE_KEY)
        );

    const [beatmapLookup, setBeatmapLookup] =
        useState<BeatmapLookup | null>(null);

    const [hotkey, setHotkey] =
        useState(DEFAULT_HOTKEY);

    const [recordingHotkey, setRecordingHotkey] =
        useState(false);

    const [hotkeySaving, setHotkeySaving] =
        useState(false);

    const [hotkeyError, setHotkeyError] =
        useState("");

    const [hotkeyMessage, setHotkeyMessage] =
        useState("");

    const [hexDrafts, setHexDrafts] = useState<
        Record<ColorKey, string>
    >(() => {
        const settings = loadSettings();

        return {
            background: settings.background,
            text: settings.text,
            accent: settings.accent,
            border: settings.border,
        };
    });

    const previousGameStateRef =
        useRef<string | null>(null);

    const lastGameplayDataRef =
        useRef<TosuData | null>(null);

    const gameplaySeenRef = useRef(false);

    const godmodeRecorderRef =
        useRef<GodmodeRecorder>(new GodmodeRecorder());

    const hotkeyButtonRef =
        useRef<HTMLButtonElement>(null);

    // Cache výsledků hledání. Stejnou mapu
    // nebudeme zbytečně prohledávat znovu.
    const beatmapCacheRef = useRef<
        Map<string, BeatmapLookup>
    >(new Map());

    const checksum =
        tosuData?.beatmap?.checksum?.trim().toLowerCase() ?? "";

    // Uložení vzhledu.
    useEffect(() => {
        try {
            localStorage.setItem(
                THEME_KEY,
                JSON.stringify(theme)
            );
        } catch (error) {
            console.error("Theme save failed:", error);
        }
    }, [theme]);

    // Načtení hotkey z Rust backendu.
    useEffect(() => {
        invoke<string>("get_hotkey")
            .then(setHotkey)
            .catch((error) => {
                console.error(
                    "Failed to load hotkey:",
                    error
                );
            });
    }, []);

    // Připojení k tosu.
    useEffect(() => {
        return connectToTosu(
            (data) => {
                setTosuData(data);

                // GODMODE RECORDER
                const recording =
                    godmodeRecorderRef.current.update(data);

                if (recording) {
                    setLastGodmode(recording);
                    setGodmodeOpen(true);

                    console.log(
                        "Godmode recording:",
                        recording
                    );
                }

                // LAST PLAY ANALYSIS
                const currentState =
                    data.state?.name ?? "unknown";

                const previousState =
                    previousGameStateRef.current;

                if (currentState === "play") {
                    if (data.play && data.beatmap) {
                        lastGameplayDataRef.current = data;
                        gameplaySeenRef.current = true;
                    }
                } else if (
                    previousState === "play" &&
                    gameplaySeenRef.current
                ) {
                    const gameplayData =
                        lastGameplayDataRef.current;

                    if (gameplayData) {
                        const result =
                            createPlayResult(gameplayData);

                        if (result) {
                            setLastPlay(result);
                            setAnalysisOpen(true);

                            try {
                                localStorage.setItem(
                                    LAST_PLAY_KEY,
                                    JSON.stringify(result)
                                );
                            } catch (error) {
                                console.error(
                                    "Play save failed:",
                                    error
                                );
                            }
                        }
                    }

                    lastGameplayDataRef.current = null;
                    gameplaySeenRef.current = false;
                }

                previousGameStateRef.current =
                    currentState;
            },
            (connected) => {
                setTosuConnected(connected);

                if (!connected) {
                    setTosuData(null);

                    previousGameStateRef.current = null;
                    lastGameplayDataRef.current = null;
                    gameplaySeenRef.current = false;

                    godmodeRecorderRef.current.reset();
                }
            }
        );
    }, []);

    // Automatické vyhledání beatmapy.
    // Spustí se pouze při změně checksumu.
    useEffect(() => {
        if (!checksum) {
            setBeatmapLookup(null);
            return;
        }

        const cached =
            beatmapCacheRef.current.get(checksum);

        if (cached) {
            setBeatmapLookup(cached);
            return;
        }

        let cancelled = false;

        setBeatmapLookup({
            checksum,
            status: "loading",
        });

        async function loadBeatmap() {
            try {
                const path = await invoke<string>(
                    "find_beatmap",
                    { checksum }
                );

                const analysis =
                    await invoke<BeatmapAnalysis>(
                        "analyze_beatmap",
                        { path }
                    );

                const result: BeatmapLookup = {
                    checksum,
                    status: "ready",
                    path,
                    analysis,
                };

                beatmapCacheRef.current.set(
                    checksum,
                    result
                );

                if (!cancelled) {
                    setBeatmapLookup(result);
                }

                console.log(
                    "Beatmap found and analyzed:",
                    result
                );
            } catch (error) {
                const result: BeatmapLookup = {
                    checksum,
                    status: "error",
                    error: String(error),
                };

                // Chyby neukládáme do cache,
                // aby šlo hledání zopakovat.
                if (!cancelled) {
                    setBeatmapLookup(result);
                }

                console.error(
                    "Beatmap analysis failed:",
                    error
                );
            }
        }

        void loadBeatmap();

        return () => {
            cancelled = true;
        };
    }, [checksum]);

    // Informování Rust backendu o stavu hry.
    useEffect(() => {
        const gameState = tosuConnected
            ? tosuData?.state?.name ?? "unknown"
            : "disconnected";

        invoke("update_game_state", {
            gameState,
        }).catch((error) => {
            console.error(
                "Failed to update osu! state:",
                error
            );
        });
    }, [tosuData?.state?.name, tosuConnected]);

    useEffect(() => {
        if (recordingHotkey) {
            hotkeyButtonRef.current?.focus();
        }
    }, [recordingHotkey]);

    function updateTheme(
        key: keyof ThemeSettings,
        value: string | number
    ) {
        setTheme((current) => ({
            ...current,
            [key]: value,
        }));

        if (
            key !== "opacity" &&
            typeof value === "string"
        ) {
            setHexDrafts((current) => ({
                ...current,
                [key]: value,
            }));
        }
    }

    function updateHexDraft(
        key: ColorKey,
        value: string
    ) {
        setHexDrafts((current) => ({
            ...current,
            [key]: value,
        }));

        if (/^#[0-9a-fA-F]{6}$/.test(value)) {
            setTheme((current) => ({
                ...current,
                [key]: value,
            }));
        }
    }

    function resetHexDraft(key: ColorKey) {
        setHexDrafts((current) => ({
            ...current,
            [key]: theme[key],
        }));
    }

    function resetSettings() {
        setTheme({ ...defaults });

        setHexDrafts({
            background: defaults.background,
            text: defaults.text,
            accent: defaults.accent,
            border: defaults.border,
        });
    }

    async function saveNewHotkey(value: string) {
        if (hotkeySaving) return;

        setHotkeySaving(true);
        setHotkeyError("");
        setHotkeyMessage("");
        setRecordingHotkey(false);

        try {
            const saved = await invoke<string>(
                "set_hotkey",
                { hotkey: value }
            );

            setHotkey(saved);
            setHotkeyMessage(
                "Shortcut saved successfully."
            );
        } catch (error) {
            setHotkeyError(
                `Could not save shortcut: ${String(error)}`
            );
        } finally {
            setHotkeySaving(false);
        }
    }

    function handleHotkeyKeyDown(
        event: KeyboardEvent<HTMLButtonElement>
    ) {
        if (!recordingHotkey) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.key === "Escape") {
            setRecordingHotkey(false);
            setHotkeyMessage("");
            return;
        }

        if (
            ["Control", "Shift", "Alt", "Meta"].includes(
                event.key
            )
        ) {
            return;
        }

        const key = getShortcutKey(event);

        if (!key) {
            setHotkeyError(
                "Use a letter, number, or function key (F1–F24)."
            );
            return;
        }

        if (!event.ctrlKey && !event.altKey) {
            setHotkeyError(
                "Your shortcut must include Ctrl or Alt."
            );
            return;
        }

        const modifiers: string[] = [];

        if (event.ctrlKey) modifiers.push("Ctrl");
        if (event.shiftKey) modifiers.push("Shift");
        if (event.altKey) modifiers.push("Alt");

        void saveNewHotkey(
            [...modifiers, key].join("+")
        );
    }

    async function startDragging(
        event: MouseEvent<HTMLElement>
    ) {
        if (event.button !== 0) return;

        const target = event.target as HTMLElement;

        if (
            target.closest(
                "button, input, a, select, textarea"
            )
        ) {
            return;
        }

        try {
            await getCurrentWindow().startDragging();
        } catch (error) {
            console.error(
                "Window dragging failed:",
                error
            );
        }
    }

    async function hideOverlay() {
        try {
            await getCurrentWindow().hide();
        } catch (error) {
            console.error(
                "Failed to hide overlay:",
                error
            );
        }
    }

    function clearLastPlay() {
        localStorage.removeItem(LAST_PLAY_KEY);
        setLastPlay(null);
    }

    function clearGodmode() {
        localStorage.removeItem(LAST_GODMODE_KEY);
        setLastGodmode(null);
    }

    const hudStyle = {
        color: theme.text,
        borderColor: theme.border,
        backgroundColor:
            `color-mix(in srgb, ${theme.background} ${theme.opacity}%, transparent)`,
        "--accent": theme.accent,
    } as CSSProperties;

    const beatmap = tosuData?.beatmap;
    const gameState =
        tosuData?.state?.name ?? "unknown";

    const analysis = lastPlay
        ? getChokeAnalysis(lastPlay)
        : null;

    const bestSegment =
        lastGodmode?.bestSegment ?? null;

    return (
        <main className="hud" style={hudStyle}>
            <header
                className="hud-header"
                onMouseDown={startDragging}
            >
                <strong
                    style={{ color: theme.accent }}
                >
                    osu! ChokeLens
                </strong>

                <div className="header-actions">
                    <button
                        type="button"
                        onClick={() =>
                            setAnalysisOpen(
                                (open) => !open
                            )
                        }
                    >
                        Analysis
                    </button>

                    <button
                        type="button"
                        onClick={() =>
                            setGodmodeOpen(
                                (open) => !open
                            )
                        }
                    >
                        Godmode
                    </button>

                    <button
                        type="button"
                        onClick={() =>
                            setSettingsOpen(
                                (open) => !open
                            )
                        }
                    >
                        ⚙ Settings
                    </button>

                    <button
                        type="button"
                        onClick={hideOverlay}
                        title="Hide overlay"
                    >
                        ✕
                    </button>
                </div>
            </header>

            <section className="hud-content">
                <p>
                    AI Performance Analyzer for osu!stable
                </p>

                <p
                    className="demo-label"
                    style={{
                        color: tosuConnected
                            ? "#62e6a2"
                            : "#ff8585",
                    }}
                >
                    {tosuConnected
                        ? "● tosu Connected"
                        : "● tosu Disconnected"}
                </p>

                {tosuConnected && beatmap ? (
                    <div className="beatmap-info">
                        <h2>
                            {beatmap.artist} — {beatmap.title}
                        </h2>

                        <p>
                            [{beatmap.version}]
                            {" · "}
                            mapped by {beatmap.mapper}
                        </p>

                        <p>
                            ★{" "}
                            {beatmap.stats?.stars?.total?.toFixed(
                                2
                            ) ?? "?"}
                            {" · "}
                            BPM{" "}
                            {beatmap.stats?.bpm?.common ?? "?"}
                        </p>

                        <p>
                            AR{" "}
                            {beatmap.stats?.ar?.original ?? "?"}
                            {" · "}
                            OD{" "}
                            {beatmap.stats?.od?.original ?? "?"}
                        </p>

                        <p>osu! state: {gameState}</p>
                    </div>
                ) : (
                    <p className="demo-label">
                        {tosuConnected
                            ? "Waiting for beatmap data..."
                            : "Start osu!stable and tosu to connect."}
                    </p>
                )}

                {/* AUTOMATIC BEATMAP FINDER */}
                {tosuConnected && beatmap && (
                    <div className="settings-panel">
                        <h2>Automatic Beatmap Finder</h2>

                        {!checksum ? (
                            <p className="demo-label">
                                Waiting for beatmap checksum...
                            </p>
                        ) : beatmapLookup?.status ===
                        "loading" ? (
                            <p className="demo-label">
                                Searching Songs and analyzing
                                beatmap...
                            </p>
                        ) : beatmapLookup?.status ===
                        "ready" &&
                        beatmapLookup.analysis ? (
                            <>
                                <p
                                    style={{
                                        color: "#62e6a2",
                                        fontWeight: 700,
                                    }}
                                >
                                    ✓ Beatmap found
                                </p>

                                <p>
                                    Hit objects:{" "}
                                    <strong>
                                        {
                                            beatmapLookup
                                                .analysis
                                                .objectCount
                                        }
                                    </strong>
                                </p>

                                <p>
                                    First object:{" "}
                                    <strong>
                                        {formatTime(
                                            beatmapLookup
                                                .analysis
                                                .firstObjectTime
                                        )}
                                    </strong>
                                </p>

                                <p>
                                    Last object:{" "}
                                    <strong>
                                        {formatTime(
                                            beatmapLookup
                                                .analysis
                                                .lastObjectTime
                                        )}
                                    </strong>
                                </p>

                                <p>
                                    Object time span:{" "}
                                    <strong>
                                        {formatNumber(
                                            beatmapLookup
                                                .analysis
                                                .durationMs /
                                            1000,
                                            1
                                        )}{" "}
                                        s
                                    </strong>
                                </p>

                                <p
                                    className="demo-label"
                                    style={{
                                        overflowWrap:
                                            "anywhere",
                                    }}
                                >
                                    {beatmapLookup.path}
                                </p>
                            </>
                        ) : beatmapLookup?.status ===
                        "error" ? (
                            <>
                                <p
                                    style={{
                                        color: "#ff8585",
                                    }}
                                >
                                    Beatmap not found
                                </p>

                                <p className="demo-label">
                                    {beatmapLookup.error}
                                </p>
                            </>
                        ) : (
                            <p className="demo-label">
                                Preparing beatmap lookup...
                            </p>
                        )}
                    </div>
                )}

                {/* GODMODE RECORDING */}
                {godmodeOpen && (
                    <div className="settings-panel">
                        <h2>Godmode Recording</h2>

                        {lastGodmode ? (
                            <>
                                <p>
                                    <strong>
                                        {lastGodmode.beatmap}
                                    </strong>
                                </p>

                                <p>
                                    Samples recorded:{" "}
                                    <strong>
                                        {
                                            lastGodmode.samples
                                                .length
                                        }
                                    </strong>
                                </p>

                                <p>
                                    Timing data:{" "}
                                    <strong>
                                        {lastGodmode.completeTiming
                                            ? "Available"
                                            : "Incomplete"}
                                    </strong>
                                </p>

                                {bestSegment ? (
                                    <>
                                        <p
                                            style={{
                                                color:
                                                theme.accent,
                                                fontWeight: 700,
                                            }}
                                        >
                                            Best Combo Segment
                                        </p>

                                        <p>
                                            Time:{" "}
                                            <strong>
                                                {formatTime(
                                                    bestSegment.startTime
                                                )}
                                                {" – "}
                                                {formatTime(
                                                    bestSegment.endTime
                                                )}
                                            </strong>
                                        </p>

                                        <p>
                                            Duration:{" "}
                                            <strong>
                                                {formatNumber(
                                                    bestSegment.duration /
                                                    1000,
                                                    1
                                                )}{" "}
                                                s
                                            </strong>
                                        </p>

                                        <p>
                                            Combo gained:{" "}
                                            <strong>
                                                +
                                                {
                                                    bestSegment.comboGain
                                                }
                                                x
                                            </strong>
                                        </p>

                                        <p>
                                            Combo:{" "}
                                            {
                                                bestSegment.startCombo
                                            }
                                            x →{" "}
                                            {
                                                bestSegment.endCombo
                                            }
                                            x
                                        </p>
                                    </>
                                ) : (
                                    <p className="demo-label">
                                        No valid combo segment
                                        detected yet.
                                    </p>
                                )}

                                <p className="demo-label">
                                    Combo-based recording.
                                    Difficulty calculation will
                                    be added later.
                                </p>

                                <button
                                    type="button"
                                    onClick={clearGodmode}
                                >
                                    Clear recording
                                </button>
                            </>
                        ) : (
                            <p className="demo-label">
                                No Godmode recording yet.
                                Play a map to record your
                                first segment automatically.
                            </p>
                        )}
                    </div>
                )}

                {/* LAST PLAY ANALYSIS */}
                {analysisOpen && (
                    <div className="settings-panel">
                        <h2>Last Play Analysis</h2>

                        {lastPlay && analysis ? (
                            <>
                                <p>
                                    <strong>
                                        {lastPlay.artist} —{" "}
                                        {lastPlay.title}
                                    </strong>
                                </p>

                                <p>
                                    [{lastPlay.difficulty}]
                                </p>

                                <p>
                                    Accuracy:{" "}
                                    <strong>
                                        {formatNumber(
                                            lastPlay.accuracy
                                        )}
                                        %
                                    </strong>
                                </p>

                                <p>
                                    Misses:{" "}
                                    <strong>
                                        {lastPlay.misses}
                                    </strong>
                                    {" · "}
                                    Sliderbreaks:{" "}
                                    <strong>
                                        {lastPlay.sliderBreaks}
                                    </strong>
                                </p>

                                <p>
                                    Max combo:{" "}
                                    <strong>
                                        {lastPlay.maxCombo}x
                                    </strong>
                                    {lastPlay.mapMaxCombo > 0
                                        ? ` / ${lastPlay.mapMaxCombo}x`
                                        : ""}
                                </p>

                                <p>
                                    PP:{" "}
                                    <strong>
                                        {formatNumber(
                                            lastPlay.pp
                                        )}
                                    </strong>
                                    {" · "}
                                    FC estimate:{" "}
                                    <strong>
                                        {formatNumber(
                                            lastPlay.fcPp
                                        )}
                                    </strong>
                                </p>

                                {lastPlay.unstableRate !==
                                    null && (
                                        <p>
                                            Unstable rate:{" "}
                                            {formatNumber(
                                                lastPlay.unstableRate
                                            )}
                                        </p>
                                    )}

                                <p
                                    style={{
                                        color: analysis.color,
                                        fontWeight: 700,
                                    }}
                                >
                                    {analysis.label}
                                </p>

                                <p>
                                    {analysis.description}
                                </p>

                                <p className="demo-label">
                                    Recorded:{" "}
                                    {new Date(
                                        lastPlay.playedAt
                                    ).toLocaleString()}
                                </p>

                                <button
                                    type="button"
                                    onClick={clearLastPlay}
                                >
                                    Clear last play
                                </button>
                            </>
                        ) : (
                            <p className="demo-label">
                                No play recorded yet.
                                Play a map to see your
                                first analysis.
                            </p>
                        )}
                    </div>
                )}

                {/* SETTINGS */}
                {settingsOpen && (
                    <div className="settings-panel">
                        <h2>HUD Customization</h2>

                        {colorFields.map(
                            ({ key, label }) => (
                                <div
                                    className="setting"
                                    key={key}
                                >
                                    <label>{label}</label>

                                    <div className="color-controls">
                                        <input
                                            type="color"
                                            value={theme[key]}
                                            onChange={(event) =>
                                                updateTheme(
                                                    key,
                                                    event.target
                                                        .value
                                                )
                                            }
                                        />

                                        <input
                                            type="text"
                                            value={
                                                hexDrafts[key]
                                            }
                                            maxLength={7}
                                            spellCheck={false}
                                            onChange={(event) =>
                                                updateHexDraft(
                                                    key,
                                                    event.target
                                                        .value
                                                )
                                            }
                                            onBlur={() =>
                                                resetHexDraft(
                                                    key
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            )
                        )}

                        <div className="setting">
                            <label>
                                Background opacity:{" "}
                                {theme.opacity}%
                            </label>

                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={theme.opacity}
                                onChange={(event) =>
                                    updateTheme(
                                        "opacity",
                                        Number(
                                            event.target.value
                                        )
                                    )
                                }
                            />
                        </div>

                        <div className="setting hotkey-setting">
                            <label>
                                Keyboard shortcut
                            </label>

                            <p className="hotkey-description">
                                Show / hide ChokeLens
                            </p>

                            <div className="hotkey-controls">
                                <span className="hotkey-value">
                                    {formatHotkey(hotkey)}
                                </span>

                                <button
                                    ref={hotkeyButtonRef}
                                    type="button"
                                    disabled={hotkeySaving}
                                    onClick={() => {
                                        if (recordingHotkey) {
                                            setRecordingHotkey(
                                                false
                                            );
                                        } else {
                                            setHotkeyError("");
                                            setHotkeyMessage("");
                                            setRecordingHotkey(
                                                true
                                            );
                                        }
                                    }}
                                    onKeyDown={
                                        handleHotkeyKeyDown
                                    }
                                    onBlur={() =>
                                        setRecordingHotkey(
                                            false
                                        )
                                    }
                                >
                                    {hotkeySaving
                                        ? "Saving..."
                                        : recordingHotkey
                                            ? "Press keys..."
                                            : "Change"}
                                </button>
                            </div>

                            {recordingHotkey && (
                                <p className="hotkey-description">
                                    Press your new shortcut.
                                    Esc to cancel.
                                </p>
                            )}

                            {hotkeyError && (
                                <p className="hotkey-error">
                                    {hotkeyError}
                                </p>
                            )}

                            {hotkeyMessage && (
                                <p
                                    className="hotkey-description"
                                    style={{
                                        color: "#62e6a2",
                                    }}
                                >
                                    {hotkeyMessage}
                                </p>
                            )}

                            <button
                                type="button"
                                disabled={hotkeySaving}
                                onClick={() =>
                                    void saveNewHotkey(
                                        DEFAULT_HOTKEY
                                    )
                                }
                            >
                                Reset shortcut
                            </button>
                        </div>

                        <button
                            type="button"
                            className="reset-button"
                            onClick={resetSettings}
                        >
                            Reset colors to defaults
                        </button>
                    </div>
                )}
            </section>
        </main>
    );
}

export default App;
