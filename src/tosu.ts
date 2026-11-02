
export type TosuData = {
    client?: string;

    state?: {
        number: number;
        name: string;
    };

    gameplay?: {
        time?: number;
    };

    beatmap?: {
        id?: number;
        set?: number;
        checksum?: string;

        artist: string;
        title: string;
        version: string;
        mapper: string;

        time?: {
            live?: number;
            firstObject?: number;
            lastObject?: number;
            mp3Length?: number;
        };

        stats?: {
            stars?: {
                total: number;
            };

            bpm?: {
                common: number;
            };

            ar?: {
                original: number;
            };

            od?: {
                original: number;
            };

            maxCombo?: number;
        };
    };

    play?: {
        failed?: boolean;
        playerName?: string;
        score?: number;
        accuracy?: number;

        combo?: {
            current: number;
            max: number;
        };

        hits?: {
            "0"?: number;
            "50"?: number;
            "100"?: number;
            "300"?: number;
            geki?: number;
            katu?: number;
            sliderBreaks?: number;
        };

        pp?: {
            current?: number;
            fc?: number;
            maxAchieved?: number;
            maxAchievable?: number;
        };

        unstableRate?: number;
    };
};

export type PlayResult = {
    id: string;
    playedAt: string;

    beatmapId?: number;

    artist: string;
    title: string;
    difficulty: string;
    mapper: string;

    accuracy: number;
    score: number;

    misses: number;
    sliderBreaks: number;

    maxCombo: number;
    mapMaxCombo: number;

    pp: number;
    fcPp: number;

    failed: boolean;
    unstableRate: number | null;
};

export function createPlayResult(
    data: TosuData
): PlayResult | null {
    const beatmap = data.beatmap;
    const play = data.play;

    if (!beatmap || !play) {
        return null;
    }

    return {
        id: `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 9)}`,

        playedAt: new Date().toISOString(),

        beatmapId: beatmap.id,

        artist: beatmap.artist,
        title: beatmap.title,
        difficulty: beatmap.version,
        mapper: beatmap.mapper,

        accuracy: play.accuracy ?? 0,
        score: play.score ?? 0,

        misses: play.hits?.["0"] ?? 0,
        sliderBreaks: play.hits?.sliderBreaks ?? 0,

        maxCombo: play.combo?.max ?? 0,
        mapMaxCombo: beatmap.stats?.maxCombo ?? 0,

        pp: play.pp?.current ?? 0,
        fcPp: play.pp?.fc ?? 0,

        failed: play.failed ?? false,
        unstableRate: play.unstableRate ?? null,
    };
}

export function connectToTosu(
    onData: (data: TosuData) => void,
    onStatus: (connected: boolean) => void
): () => void {
    let socket: WebSocket | null = null;

    let reconnectTimer:
        | ReturnType<typeof setTimeout>
        | null = null;

    let stopped = false;

    function connect() {
        if (stopped) {
            return;
        }

        socket = new WebSocket(
            "ws://127.0.0.1:24050/websocket/v2"
        );

        socket.onopen = () => {
            if (!stopped) {
                onStatus(true);
            }
        };

        socket.onmessage = (event) => {
            if (stopped) {
                return;
            }

            try {
                const data = JSON.parse(
                    event.data
                ) as TosuData;

                onData(data);
            } catch (error) {
                console.error(
                    "Invalid tosu data:",
                    error
                );
            }
        };

        socket.onerror = () => {
            if (!stopped) {
                onStatus(false);
            }
        };

        socket.onclose = () => {
            if (stopped) {
                return;
            }

            onStatus(false);

            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, 2000);
        };
    }

    connect();

    return () => {
        stopped = true;

        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        if (socket !== null) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.onclose = null;

            socket.close();
            socket = null;
        }
    };
}
