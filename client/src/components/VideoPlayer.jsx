import { useRef, useEffect, useState, useCallback } from "react";
import socket from "../socket";

const CHUNK_SIZE = 512 * 1024; // 512KB chunks

function formatTime(s) {
    if (!s || isNaN(s) || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function VideoPlayer({ currentUser, currentMovie, onMovieNameSet }) {
    const videoRef = useRef(null);
    const progressRef = useRef(null);
    const mediaSourceRef = useRef(null);
    const sourceBufferRef = useRef(null);
    const chunkQueueRef = useRef([]);
    const appendingRef = useRef(false);
    const streamingRef = useRef(false);
    const mimeTypeRef = useRef("video/mp4");

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [movieName, setMovieName] = useState(null);
    const [hostReady, setHostReady] = useState(false);
    const [viewerReady, setViewerReady] = useState(false);
    const [viewerStatus, setViewerStatus] = useState("Waiting for host to pick a movie...");

    const controlsTimerRef = useRef(null);
    const isHost = currentUser?.isHost;

    function handleMouseMove() {
        setShowControls(true);
        clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }

    // ─── HOST: pick file ──────────────────────────────────────────────────────
    function handleFilePick(e) {
        const file = e.target.files[0];
        if (!file) return;

        // Detect mime type
        const name = file.name.toLowerCase();
        let mime = "video/mp4";
        if (name.endsWith(".webm")) mime = "video/webm";
        else if (name.endsWith(".mp4")) mime = "video/mp4";
        mimeTypeRef.current = mime;

        const displayName = file.name.replace(/\.[^/.]+$/, "").replace(/[._-]/g, " ");
        setMovieName(displayName);
        setHostReady(false);
        onMovieNameSet?.(displayName);

        // Play locally
        const v = videoRef.current;
        if (v) {
            v.pause();
            v.removeAttribute("src");
            v.load();
            const url = URL.createObjectURL(file);
            v.src = url;
            v.load();
            v.onloadeddata = () => {
                setHostReady(true);
                setDuration(v.duration || 0);
            };
            v.onerror = () => {
                setHostReady(true); // show player anyway so host can see controls
            };
// Fallback in case neither fires
            setTimeout(() => setHostReady(true), 3000);
        }

        // Tell everyone
        socket.emit("host-set-movie", { movieName: displayName, mimeType: mime });

        // Stream chunks to viewers
        streamChunks(file, mime);
    }

    async function streamChunks(file, mime) {
        streamingRef.current = true;
        let offset = 0;
        console.log(`[Stream] Starting: ${file.name} (${file.size} bytes)`);

        while (offset < file.size && streamingRef.current) {
            const slice = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await slice.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            // Send as array for reliability
            socket.emit("video-chunk", { chunk: Array.from(bytes), mimeType: mime, done: false });
            offset += CHUNK_SIZE;
            await new Promise((r) => setTimeout(r, 30));
        }

        if (streamingRef.current) {
            socket.emit("video-chunk", { chunk: null, mimeType: mime, done: true });
            console.log("[Stream] All chunks sent");
        }
    }

    // ─── HOST: controls ───────────────────────────────────────────────────────
    function togglePlay() {
        if (!isHost) return;
        const v = videoRef.current; if (!v) return;
        if (v.paused) {
            v.play().then(() => {
                setIsPlaying(true);
                socket.emit("host-play", { currentTime: v.currentTime });
            }).catch(console.error);
        } else {
            v.pause();
            setIsPlaying(false);
            socket.emit("host-pause", { currentTime: v.currentTime });
        }
    }

    function handleSeek(e) {
        if (!isHost) return;
        const v = videoRef.current; if (!v) return;
        const rect = progressRef.current.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        v.currentTime = ratio * (v.duration || 0);
        socket.emit("host-seek", { currentTime: v.currentTime });
    }

    function handleTimeUpdate() {
        const v = videoRef.current; if (!v) return;
        setCurrentTime(v.currentTime);
        setDuration(v.duration || 0);
    }

    // ─── VIEWER: MediaSource setup ────────────────────────────────────────────
    function initMediaSource(mime) {
        const v = videoRef.current; if (!v) return;

        // Reset
        chunkQueueRef.current = [];
        appendingRef.current = false;
        sourceBufferRef.current = null;

        try {
            const ms = new MediaSource();
            mediaSourceRef.current = ms;
            v.src = URL.createObjectURL(ms);

            ms.addEventListener("sourceopen", () => {
                try {
                    const useMime = MediaSource.isTypeSupported(mime) ? mime : "video/mp4";
                    const sb = ms.addSourceBuffer(useMime);
                    sourceBufferRef.current = sb;
                    sb.mode = "sequence";
                    sb.addEventListener("updateend", () => {
                        appendingRef.current = false;
                        flushQueue();
                        // Show player once we have 2+ seconds buffered
                        if (!viewerReady && v.buffered.length > 0 && v.buffered.end(0) >= 2) {
                            setViewerReady(true);
                        }
                    });
                    flushQueue();
                } catch (err) {
                    console.error("SourceBuffer error:", err);
                    setViewerStatus("Video format not supported. Ask host to use MP4.");
                }
            });
        } catch (err) {
            console.error("MediaSource error:", err);
        }
    }

    function flushQueue() {
        const sb = sourceBufferRef.current;
        const ms = mediaSourceRef.current;
        if (!sb || appendingRef.current || sb.updating) return;
        if (chunkQueueRef.current.length === 0) return;

        const item = chunkQueueRef.current.shift();
        if (item.done) {
            try { if (ms && ms.readyState === "open") ms.endOfStream(); } catch (e) {}
            return;
        }
        try {
            appendingRef.current = true;
            sb.appendBuffer(item.data);
        } catch (err) {
            appendingRef.current = false;
            console.error("appendBuffer:", err);
        }
    }

    // ─── Socket events ────────────────────────────────────────────────────────
    useEffect(() => {
        if (isHost) return;

        function onMovieSet({ movieName, mimeType }) {
            setMovieName(movieName);
            setViewerReady(false);
            setViewerStatus("Receiving stream...");
            mimeTypeRef.current = mimeType || "video/mp4";
            initMediaSource(mimeTypeRef.current);
        }

        function onChunk({ chunk, mimeType, done }) {
            if (done) {
                chunkQueueRef.current.push({ done: true });
                flushQueue();
                return;
            }
            if (!chunk) return;
            try {
                const bytes = new Uint8Array(chunk);
                chunkQueueRef.current.push({ data: bytes.buffer });
                flushQueue();
            } catch (err) {
                console.error("Chunk error:", err);
            }
        }

        function onSyncPlay({ currentTime }) {
            const v = videoRef.current; if (!v) return;
            v.currentTime = currentTime;
            v.play().then(() => setIsPlaying(true)).catch(() => {});
        }

        function onSyncPause({ currentTime }) {
            const v = videoRef.current; if (!v) return;
            v.pause(); v.currentTime = currentTime; setIsPlaying(false);
        }

        function onSyncSeek({ currentTime }) {
            const v = videoRef.current; if (!v) return;
            v.currentTime = currentTime;
        }

        function onSyncState({ currentTime, isPlaying: playing, currentMovie: movie }) {
            if (movie) { setMovieName(movie.name); }
        }

        socket.on("movie-set", onMovieSet);
        socket.on("video-chunk", onChunk);
        socket.on("sync-play", onSyncPlay);
        socket.on("sync-pause", onSyncPause);
        socket.on("sync-seek", onSyncSeek);
        socket.on("sync-state", onSyncState);
        socket.emit("request-sync");

        return () => {
            socket.off("movie-set", onMovieSet);
            socket.off("video-chunk", onChunk);
            socket.off("sync-play", onSyncPlay);
            socket.off("sync-pause", onSyncPause);
            socket.off("sync-seek", onSyncSeek);
            socket.off("sync-state", onSyncState);
        };
    }, [isHost]);

    useEffect(() => () => { streamingRef.current = false; }, []);

    const progress = duration ? (currentTime / duration) * 100 : 0;

    // ─── EMPTY STATES ─────────────────────────────────────────────────────────
    if (!movieName && !isHost) return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "var(--bg-deep)" }}>
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 64 }}>🎬</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--text-secondary)", marginTop: 16, letterSpacing: "0.1em" }}>Waiting for the host...</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>Grab some popcorn 🍿</div>
            </div>
        </div>
    );

    if (!movieName && isHost) return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "var(--bg-deep)" }}>
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 64 }}>📂</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--text-secondary)", marginTop: 16, letterSpacing: "0.1em" }}>Pick a movie to begin</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8, marginBottom: 32 }}>Select any MP4 or WebM file from your PC</div>
                <label style={{ display: "inline-block", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", borderRadius: 10, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "Syne, sans-serif", boxShadow: "0 8px 24px rgba(59,130,246,0.35)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    📂 Choose File
                    <input type="file" accept="video/mp4,video/webm,.mp4,.webm" onChange={handleFilePick} style={{ display: "none" }} />
                </label>
            </div>
        </div>
    );

    // Host loading
    if (isHost && !hostReady && movieName) return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "#000" }}>
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>Loading {movieName}...</div>
            </div>
        </div>
    );

    // Viewer loading
    if (!isHost && !viewerReady) return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "#000" }}>
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>{viewerStatus}</div>
                {movieName && <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 10 }}>{movieName}</div>}
                <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 8 }}>Wait for the first 2 seconds to buffer...</div>
            </div>
        </div>
    );

    // ─── MAIN PLAYER ──────────────────────────────────────────────────────────
    return (
        <div style={{ position: "relative", width: "100%", height: "100%", background: "#000", cursor: showControls ? "default" : "none" }} onMouseMove={handleMouseMove}>
            <video
                ref={videoRef}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={() => { if (videoRef.current) setDuration(videoRef.current.duration || 0); }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onClick={togglePlay}
                playsInline
                preload="auto"
            />

            {/* Controls */}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.95))", padding: "60px 20px 18px", opacity: showControls ? 1 : 0, transition: "opacity 0.3s", pointerEvents: showControls ? "auto" : "none" }}>
                {/* Progress bar */}
                <div ref={progressRef} onClick={isHost ? handleSeek : undefined}
                     style={{ height: 5, background: "rgba(255,255,255,0.12)", borderRadius: 3, marginBottom: 14, cursor: isHost ? "pointer" : "default", position: "relative" }}>
                    <div style={{ position: "absolute", inset: 0, width: `${progress}%`, background: "linear-gradient(90deg,#3b82f6,#6366f1)", borderRadius: 3 }} />
                    {isHost && duration > 0 && (
                        <div style={{ position: "absolute", top: "50%", left: `${progress}%`, transform: "translate(-50%,-50%)", width: 14, height: 14, borderRadius: "50%", background: "#60a5fa", boxShadow: "0 0 8px #3b82f6" }} />
                    )}
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    {isHost ? (
                        <button onClick={togglePlay} style={{ background: "none", border: "none", color: "#fff", fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 0 }}>
                            {isPlaying ? "⏸" : "▶"}
                        </button>
                    ) : (
                        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>👁 Viewing</span>
                    )}

                    <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, minWidth: 100 }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

                    {movieName && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>{movieName}</span>}

                    <div style={{ flex: 1 }} />

                    {isHost && (
                        <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer", padding: "4px 10px", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 5 }}>
                            📂 Change
                            <input type="file" accept="video/mp4,video/webm,.mp4,.webm" onChange={handleFilePick} style={{ display: "none" }} />
                        </label>
                    )}

                    <button onClick={() => { const m = !muted; setMuted(m); if (videoRef.current) videoRef.current.muted = m; }}
                            style={{ background: "none", border: "none", color: "#fff", fontSize: 17, cursor: "pointer" }}>
                        {muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
                    </button>

                    <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume}
                           onChange={(e) => { const val = parseFloat(e.target.value); setVolume(val); if (videoRef.current) videoRef.current.volume = val; setMuted(val === 0); }}
                           style={{ width: 70, accentColor: "#3b82f6" }} />

                    <button onClick={() => { const el = document.fullscreenElement; if (!el) videoRef.current?.parentElement?.parentElement?.requestFullscreen(); else document.exitFullscreen(); }}
                            style={{ background: "none", border: "none", color: "#fff", fontSize: 17, cursor: "pointer" }}>⛶</button>

                    {isHost && (
                        <span style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4, letterSpacing: "0.12em" }}>HOST</span>
                    )}
                </div>
            </div>
        </div>
    );
}
