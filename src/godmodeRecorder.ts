
import type { TosuData } from "./tosu";

export type GodmodeSample = {
    time: number;
    combo: number;
    maxCombo: number;
    misses: number;
    sliderBreaks: number;
    accuracy: number;
};

export type GodmodeSegment = {
    startTime: number;
    endTime: number;
    duration: number;
    startCombo: number;
    endCombo: number;
    comboGain: number;
};

export type GodmodeRecording = {
    id: string;
    beatmap: string;
    recordedAt: string;
    samples: GodmodeSample[];
    bestSegment: GodmodeSegment | null;
    completeTiming: boolean;
};

// Čas beatmapy z tosu v milisekundách.
function getBeatmapTime(data: TosuData): number | null {
    const time = data.beatmap?.time?.live;

    if (
        typeof time !== "number" ||
        !Number.isFinite(time) ||
        time < 0
    ) {
        return null;
    }

    return time;
}

// Najde nejdelší zaznamenaný úsek bez ztráty comba.
// Zatím hodnotíme počet získaných combo bodů,
// nikoliv skutečnou obtížnost mapy.
function findBestSegment(
    samples: GodmodeSample[]
): GodmodeSegment | null {
    if (samples.length < 2) {
        return null;
    }

    let best: GodmodeSegment | null = null;
    let start = samples[0];

    for (let i = 1; i < samples.length; i++) {
        const previous = samples[i - 1];
        const current = samples[i];

        const comboBroken =
            current.combo < previous.combo ||
            current.misses > previous.misses ||
            current.sliderBreaks > previous.sliderBreaks;

        // Pokud došlo k chybě, začneme nový úsek.
        if (comboBroken) {
            start = current;
            continue;
        }

        // Bez platného pořadí časů úsek nepočítáme.
        if (current.time < start.time) {
            start = current;
            continue;
        }

        const candidate: GodmodeSegment = {
            startTime: start.time,
            endTime: current.time,
            duration: current.time - start.time,
            startCombo: start.combo,
            endCombo: current.combo,
            comboGain: current.combo - start.combo,
        };

        if (
            candidate.comboGain > 0 &&
            (
                best === null ||
                candidate.comboGain > best.comboGain
            )
        ) {
            best = candidate;
        }
    }

    return best;
}

export class GodmodeRecorder {
    private recording = false;
    private samples: GodmodeSample[] = [];
    private beatmap = "";
    private hasMissingTiming = false;

    update(data: TosuData): GodmodeRecording | null {
        const state = data.state?.name;

        // Gameplay právě probíhá.
        if (state === "play") {
            if (!this.recording) {
                this.recording = true;
                this.samples = [];
                this.hasMissingTiming = false;

                this.beatmap = data.beatmap
                    ? `${data.beatmap.artist} — ${data.beatmap.title} [${data.beatmap.version}]`
                    : "Unknown beatmap";
            }

            const play = data.play;
            const time = getBeatmapTime(data);

            if (!play) {
                return null;
            }

            if (time === null) {
                this.hasMissingTiming = true;
                return null;
            }

            const sample: GodmodeSample = {
                time,
                combo: play.combo?.current ?? 0,
                maxCombo: play.combo?.max ?? 0,
                misses: play.hits?.["0"] ?? 0,
                sliderBreaks:
                    play.hits?.sliderBreaks ?? 0,
                accuracy: play.accuracy ?? 0,
            };

            const previous =
                this.samples[this.samples.length - 1];

            // Ignorujeme identické snapshoty.
            if (
                previous &&
                previous.time === sample.time &&
                previous.combo === sample.combo &&
                previous.misses === sample.misses &&
                previous.sliderBreaks ===
                sample.sliderBreaks
            ) {
                return null;
            }

            // Čas se vrátil zpět: pravděpodobný
            // restart beatmapy.
            if (
                previous &&
                sample.time < previous.time
            ) {
                console.log(
                    "Godmode Recorder: beatmap restarted"
                );

                this.samples = [];
                this.hasMissingTiming = false;
            }

            this.samples.push(sample);

            return null;
        }

        // Pokud ještě nic nenahráváme,
        // nemáme co ukládat.
        if (!this.recording) {
            return null;
        }

        // Neznámý stav nepovažujeme za
        // potvrzený konec pokusu.
        if (!state || state === "unknown") {
            return null;
        }

        // Gameplay skončil.
        this.recording = false;

        const samples = [...this.samples];
        this.samples = [];

        if (samples.length < 2) {
            return null;
        }

        const recording: GodmodeRecording = {
            id: crypto.randomUUID(),
            beatmap: this.beatmap,
            recordedAt: new Date().toISOString(),
            samples,
            bestSegment: findBestSegment(samples),
            completeTiming: !this.hasMissingTiming,
        };

        try {
            localStorage.setItem(
                "chokelens-last-godmode",
                JSON.stringify(recording)
            );
        } catch (error) {
            console.error(
                "Failed to save Godmode recording:",
                error
            );
        }

        return recording;
    }

    reset() {
        this.recording = false;
        this.samples = [];
        this.beatmap = "";
        this.hasMissingTiming = false;
    }
}
