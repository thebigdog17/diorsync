import { useRef, useEffect, useState } from "react";
import socket from "../socket";

const CHUNK_SIZE = 1 * 1024 * 1024;

function formatTime(s) {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
}

function getSupportedMime(file) {
    const name = file.name.toLowerCase();
    const candidates = name.endsWith(".webm")
        ? ['video/webm; codecs="vp8, vorbis"', 'video/webm; codecs="vp9"', "video/webm"]
        : ['video/mp4; codecs="avc1.42E01E, mp4a.40.2"', "video/mp4"];
    for (const mime of candidates) {
        if (MediaSource.isTypeSupported(mime)) return mime;
    }
    return "video/mp4";
}

export default function VideoPlayer({ currentUser, currentMovie, onMovieNameSet }) {
    const videoRef = useRef(null);
    const progressRef = useRef(null);
    const fileRef = useRef(null);
    const mediaSourceRef = useRef(null);
    const sourceBufferRef = useRef(null);
    const chunkQueueRef = useRef([]);
    const isAppendingRef = useRef(false);
    const streamingRef = useRef(false);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [buffered, setBuffered] = useState(0);
    const [movieName, setMovieName] = useState(currentMovie?.name || null);
    const [viewerReady, setViewerReady] = useState(false);
    const [viewerLoading, setViewerLoading] = useState(false);
    const [loadingText, setLoadingText] = useState("Waiting for host...");

    const controlsTimer = useRef(null);
    const isHost = currentUser?.isHost;

    function handleMouseMove() {
        setShowControls(true);
        clearTimeout(controlsTimer.current);
        controlsTimer.current = setTimeout(() => { if (isPlaying) setShowControls(false); }, 3000);
    }

    function handleFilePick(e) {
        const file = e.target.files[0];
        if (!file) return;
        fileRef.current = file;
        const url = URL.createObjectURL(file);
        const v = videoRef.current;
        if (v) { v.src = url; v.load(); }
        const name = file.name.replace(/\.[^/.]+$/, "").replace(/[._-]/g, " ");
        const mimeType = getSupportedMime(file);
        setMovieName(name);
        onMovieNameSet?.(name);
        socket.emit("host-set-movie", { movieName: name, mimeType });
        streamFileToViewers(file, mimeType);
    }

    async function streamFileToViewers(file, mimeType) {
        streamingRef.current = true;
        let offset = 0;
        while (offset < file.size && streamingRef.current) {
            const end = Math.min(offset + CHUNK_SIZE, file.size);
            const blob = file.slice(offset, end);
            try {
                const arrayBuffer = await blob.arrayBuffer();
                const uint8 = new Uint8Array(arrayBuffer);
                let binary = "";
                for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
                const base64 = btoa(binary);
                socket.emit("video-chunk", { chunk: base64, mimeType });
                offset = end;
                await new Promise((r) => setTimeout(r, 50));
            } catch (err) { console.error("Chunk error:", err); break; }
        }
        if (streamingRef.current) socket.emit("video-chunk", { chunk: null, mimeType, done: true });
    }

    function togglePlay() {
        if (!isHost) return;
        const v = videoRef.current; if (!v) return;
        if (isPlaying) {
            v.pause(); setIsPlaying(false); socket.emit("host-pause", { currentTime: v.currentTime });
        } else {
            v.play().then(() => { setIsPlaying(true); socket.emit("host-play", { currentTime: v.currentTime }); }).catch(console.error);
        }
    }

    function handleSeek(e) {
        if (!isHost) return;
        const v = videoRef.current;
        const rect = progressRef.current.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        v.currentTime = ratio * duration;
        socket.emit("host-seek", { currentTime: v.currentTime });
    }

    function handleTimeUpdate() {
        const v = videoRef.current; if (!v) return;
        setCurrentTime(v.currentTime);
        if (v.buffered.length > 0) setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
    }

    function setupMediaSource(mimeType) {
        const v = videoRef.current; if (!v) return;
        chunkQueueRef.current = [];
        isAppendingRef.current = false;
        const ms = new MediaSource();
        mediaSourceRef.current = ms;
        v.src = URL.createObjectURL(ms);
        ms.addEventListener("sourceopen", () => {
            try {
                const mime = MediaSource.isTypeSupported(mimeType) ? mimeType : "video/mp4";
                const sb = ms.addSourceBuffer(mime);
                sourceBufferRef.current = sb;
                sb.addEventListener("updateend", () => { isAppendingRef.current = false; appendNextChunk(); });
                appendNextChunk();
                setViewerLoading(true);
                setLoadingText("Buffering video...");
            } catch (err) { console.error("MediaSource error:", err); setLoadingText("Format error. Host should use MP4."); }
        });
    }

    function appendNextChunk() {
        const sb = sourceBufferRef.current;
        const ms = mediaSourceRef.current;
        if (!sb || isAppendingRef.current || chunkQueueRef.current.length === 0 || sb.updating) return;
        const item = chunkQueueRef.current.shift();
        if (item.done) { try { if (ms.readyState === "open") ms.endOfStream(); } catch (e) {} return; }
        try {
            isAppendingRef.current = true;
            sb.appendBuffer(item.data);
            const v = videoRef.current;
            if (v && v.buffered.length > 0 && v.buffered.end(0) > 3 && !viewerReady) {
                setViewerReady(true); setViewerLoading(false);
            }
        } catch (err) { console.error("appendBuffer error:", err); isAppendingRef.current = false; }
    }

    useEffect(() => {
        if (isHost) return;

        function onMovieSet({ movieName, mimeType }) {
            setMovieName(movieName); setViewerReady(false); setViewerLoading(true); setLoadingText("Setting up stream...");
            setupMediaSource(mimeType || "video/mp4");
        }

        function onChunk({ chunk, mimeType, done }) {
            if (done) { chunkQueueRef.current.push({ done: true }); appendNextChunk(); return; }
            try {
                const binary = atob(chunk);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                chunkQueueRef.current.push({ data: bytes.buffer });
                appendNextChunk();
                const v = videoRef.current;
                if (v && !viewerReady && v.buffered.length > 0 && v.buffered.end(0) > 2) { setViewerReady(true); setViewerLoading(false); }
            } catch (err) { console.error("Chunk decode error:", err); }
        }

        function onSyncPlay({ currentTime }) { const v = videoRef.current; if (!v) return; v.currentTime = currentTime; v.play().then(() => setIsPlaying(true)).catch(() => {}); }
        function onSyncPause({ currentTime }) { const v = videoRef.current; if (!v) return; v.pause(); v.currentTime = currentTime; setIsPlaying(false); }
        function onSyncSeek({ currentTime }) { if (videoRef.current) videoRef.current.currentTime = currentTime; }

        socket.on("movie-set", onMovieSet);
        socket.on("video-chunk", onChunk);
        socket.on("sync-play", onSyncPlay);
        socket.on("sync-pause", onSyncPause);
        socket.on("sync-seek", onSyncSeek);
        socket.emit("request-sync");

        return () => {
            socket.off("movie-set", onMovieSet); socket.off("video-chunk", onChunk);
            socket.off("sync-play", onSyncPlay); socket.off("sync-pause", onSyncPause); socket.off("sync-seek", onSyncSeek);
        };
    }, [isHost]);

    useEffect(() => () => { streamingRef.current = false; }, []);

    const progress = duration ? (currentTime / duration) * 100 : 0;

    if (!movieName && !isHost) return (
        <div className="flex items-center justify-center w-full h-full mesh-bg">
            <div className="text-center">
                <div style={{ fontSize: 60, marginBottom: 16 }}>🎬</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>Waiting for the host...</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>Grab some popcorn 🍿</div>
            </div>
        </div>
    );

    if (!movieName && isHost) return (
        <div className="flex items-center justify-center w-full h-full mesh-bg">
            <div className="text-center">
                <div style={{ fontSize: 60, marginBottom: 16 }}>📂</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>Pick a movie to begin</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8, marginBottom: 28 }}>Select an MP4 or WebM file from your PC</div>
                <label style={{ display: "inline-block", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", borderRadius: 10, padding: "13px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Syne, sans-serif", boxShadow: "0 8px 24px rgba(59,130,246,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Choose File
                    <input type="file" accept="video/mp4,video/webm" onChange={handleFilePick} style={{ display: "none" }} />
                </label>
            </div>
        </div>
    );

    if (!isHost && !viewerReady) return (
        <div className="flex items-center justify-center w-full h-full" style={{ background: "#000" }}>
            <div className="text-center">
                <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>{loadingText}</div>
                {movieName && <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>{movieName}</div>}
                <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 10 }}>Streaming from host... may take a minute for large files</div>
            </div>
        </div>
    );

    return (
        <div className="relative w-full h-full" onMouseMove={handleMouseMove} style={{ background: "#000", cursor: showControls ? "default" : "none" }}>
            <video ref={videoRef} className="w-full h-full object-contain" onTimeUpdate={handleTimeUpdate} onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onClick={togglePlay} playsInline />
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(3,7,18,0.96))", padding: "50px 20px 16px", transition: "opacity 0.3s", opacity: showControls ? 1 : 0, pointerEvents: showControls ? "auto" : "none" }}>
                <div ref={progressRef} onClick={isHost ? handleSeek : undefined} style={{ height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2, marginBottom: 12, cursor: isHost ? "pointer" : "default", position: "relative" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${buffered}%`, background: "rgba(255,255,255,0.12)", borderRadius: 2 }} />
                    <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #3b82f6, #6366f1)", borderRadius: 2 }} />
                    {isHost && <div style={{ position: "absolute", top: "50%", left: `${progress}%`, transform: "translate(-50%,-50%)", width: 13, height: 13, borderRadius: "50%", background: "#60a5fa", boxShadow: "0 0 8px #3b82f6" }} />}
                </div>
                <div className="flex items-center gap-4">
                    {isHost ? (
                        <button onClick={togglePlay} style={{ background: "none", border: "none", color: "white", fontSize: 22, cursor: "pointer", padding: "2px 8px", lineHeight: 1 }}>{isPlaying ? "⏸" : "▶"}</button>
                    ) : (
                        <span style={{ fontSize: 13, opacity: 0.5 }}>👁 Viewing</span>
                    )}
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, minWidth: 90 }}>{formatTime(currentTime)} / {formatTime(duration)}</span>
                    {movieName && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{movieName}</span>}
                    <div style={{ flex: 1 }} />
                    {isHost && (
                        <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", cursor: "pointer", padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", flexShrink: 0 }}>
                            📂 Change
                            <input type="file" accept="video/mp4,video/webm" onChange={handleFilePick} style={{ display: "none" }} />
                        </label>
                    )}
                    <button onClick={() => { setMuted((m) => { if (videoRef.current) videoRef.current.muted = !m; return !m; }); }} style={{ background: "none", border: "none", color: "white", fontSize: 16, cursor: "pointer" }}>
                        {muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
                    </button>
                    <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(e) => { const v = parseFloat(e.target.value); setVolume(v); if (videoRef.current) videoRef.current.volume = v; setMuted(v === 0); }} style={{ width: 65, accentColor: "#3b82f6", cursor: "pointer" }} />
                    <button onClick={() => { const el = videoRef.current?.parentElement?.parentElement; if (!el) return; if (!document.fullscreenElement) el.requestFullscreen(); else document.exitFullscreen(); }} style={{ background: "none", border: "none", color: "white", fontSize: 16, cursor: "pointer" }}>⛶</button>
                    {isHost && <span style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>HOST</span>}
                </div>
            </div>
        </div>
    );
}