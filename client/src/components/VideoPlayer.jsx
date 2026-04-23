import { useRef, useEffect, useState } from "react";
import socket from "../socket";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
  ],
};

function formatTime(s) {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function VideoPlayer({ currentUser, currentMovie, onMovieNameSet }) {
  const videoRef = useRef(null);
  const progressRef = useRef(null);
  const fileRef = useRef(null);
  const peerConns = useRef({});
  const viewerConn = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const [movieName, setMovieName] = useState(currentMovie?.name || null);
  const [streamReady, setStreamReady] = useState(false);
  const [loadingStream, setLoadingStream] = useState(false);

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
    if (videoRef.current) { videoRef.current.src = url; videoRef.current.load(); }
    const name = file.name.replace(/\.[^/.]+$/, "").replace(/[._-]/g, " ");
    setMovieName(name);
    onMovieNameSet?.(name);
    socket.emit("host-set-movie", { movieName: name });
    setTimeout(() => {
      Object.keys(peerConns.current).forEach((id) => createPeerForViewer(id));
    }, 600);
  }

  async function createPeerForViewer(viewerId) {
    if (peerConns.current[viewerId]) peerConns.current[viewerId].close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConns.current[viewerId] = pc;
    let stream;
    try {
      stream = videoRef.current.captureStream ? videoRef.current.captureStream() : videoRef.current.mozCaptureStream();
    } catch (err) { console.error("captureStream failed:", err); return; }
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit("webrtc-ice", { targetId: viewerId, candidate: e.candidate }); };
    pc.onconnectionstatechange = () => { if (["failed","closed"].includes(pc.connectionState)) delete peerConns.current[viewerId]; };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc-offer", { viewerId, offer });
  }

  function togglePlay() {
    if (!isHost) return;
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) { v.pause(); setIsPlaying(false); socket.emit("host-pause", { currentTime: v.currentTime }); }
    else { v.play(); setIsPlaying(true); socket.emit("host-play", { currentTime: v.currentTime }); }
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

  // Host socket events
  useEffect(() => {
    if (!isHost) return;
    function onViewerJoined({ viewerId }) {
      peerConns.current[viewerId] = null;
      if (fileRef.current && videoRef.current?.src) createPeerForViewer(viewerId);
    }
    function onAnswer({ viewerId, answer }) {
      const pc = peerConns.current[viewerId];
      if (pc) pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
    function onIce({ fromId, candidate }) {
      const pc = peerConns.current[fromId];
      if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    }
    function onPeerDisconnected({ peerId }) {
      const pc = peerConns.current[peerId];
      if (pc) { pc.close(); delete peerConns.current[peerId]; }
    }
    socket.on("viewer-joined", onViewerJoined);
    socket.on("webrtc-answer", onAnswer);
    socket.on("webrtc-ice", onIce);
    socket.on("peer-disconnected", onPeerDisconnected);
    return () => {
      socket.off("viewer-joined", onViewerJoined);
      socket.off("webrtc-answer", onAnswer);
      socket.off("webrtc-ice", onIce);
      socket.off("peer-disconnected", onPeerDisconnected);
    };
  }, [isHost]);

  // Viewer socket events
  useEffect(() => {
    if (isHost) return;
    async function onOffer({ hostId, offer }) {
      setLoadingStream(true);
      if (viewerConn.current) viewerConn.current.close();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      viewerConn.current = pc;
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); setStreamReady(true); setLoadingStream(false); }
      };
      pc.onicecandidate = (e) => { if (e.candidate) socket.emit("webrtc-ice", { targetId: hostId, candidate: e.candidate }); };
      pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") { setLoadingStream(false); setStreamReady(false); } };
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc-answer", { hostId, answer });
    }
    function onIce({ candidate }) { if (viewerConn.current) viewerConn.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {}); }
    function onSyncPlay({ currentTime }) { const v = videoRef.current; if (!v) return; v.currentTime = currentTime; v.play().then(() => setIsPlaying(true)).catch(() => {}); }
    function onSyncPause({ currentTime }) { const v = videoRef.current; if (!v) return; v.pause(); v.currentTime = currentTime; setIsPlaying(false); }
    function onSyncSeek({ currentTime }) { if (videoRef.current) videoRef.current.currentTime = currentTime; }
    function onMovieSet({ movieName }) { setMovieName(movieName); setStreamReady(false); setLoadingStream(true); }
    function onPeerDisconnected() { if (viewerConn.current) { viewerConn.current.close(); viewerConn.current = null; } setStreamReady(false); setLoadingStream(false); }
    socket.on("webrtc-offer", onOffer);
    socket.on("webrtc-ice", onIce);
    socket.on("sync-play", onSyncPlay);
    socket.on("sync-pause", onSyncPause);
    socket.on("sync-seek", onSyncSeek);
    socket.on("movie-set", onMovieSet);
    socket.on("peer-disconnected", onPeerDisconnected);
    socket.emit("request-sync");
    return () => {
      socket.off("webrtc-offer", onOffer); socket.off("webrtc-ice", onIce);
      socket.off("sync-play", onSyncPlay); socket.off("sync-pause", onSyncPause);
      socket.off("sync-seek", onSyncSeek); socket.off("movie-set", onMovieSet);
      socket.off("peer-disconnected", onPeerDisconnected);
    };
  }, [isHost]);

  useEffect(() => () => {
    Object.values(peerConns.current).forEach((pc) => pc?.close());
    if (viewerConn.current) viewerConn.current.close();
  }, []);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  const emptyState = (icon, title, subtitle, showPicker = false) => (
    <div className="flex items-center justify-center w-full h-full mesh-bg">
      <div className="text-center">
        <div style={{ fontSize: 60, marginBottom: 16 }}>{icon}</div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>{title}</div>
        {subtitle && <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8, marginBottom: showPicker ? 28 : 0 }}>{subtitle}</div>}
        {showPicker && (
          <label style={{ display: "inline-block", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", borderRadius: 10, padding: "13px 28px", fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: "Syne, sans-serif", boxShadow: "0 8px 24px rgba(59,130,246,0.3)" }}>
            Choose File
            <input type="file" accept="video/*" onChange={handleFilePick} style={{ display: "none" }} />
          </label>
        )}
      </div>
    </div>
  );

  if (!movieName && !isHost) return emptyState("🎬", "Waiting for the host...", "Grab some popcorn 🍿");
  if (!movieName && isHost) return emptyState("📂", "Pick a movie to begin", "Select any video file from your PC", true);
  if (!isHost && !streamReady) return emptyState(loadingStream ? "📡" : "⏳", loadingStream ? "Connecting to stream..." : "Host is loading...", loadingStream ? movieName : "");

  return (
    <div className="relative w-full h-full" onMouseMove={handleMouseMove} style={{ background: "#000", cursor: showControls ? "default" : "none" }}>
      <video ref={videoRef} className="w-full h-full object-contain" onTimeUpdate={handleTimeUpdate} onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onClick={togglePlay} playsInline />

      {/* Controls */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(3,7,18,0.95))", padding: "50px 20px 16px", transition: "opacity 0.3s", opacity: showControls ? 1 : 0, pointerEvents: showControls ? "auto" : "none" }}>
        {/* Progress bar */}
        <div ref={progressRef} onClick={isHost ? handleSeek : undefined} style={{ height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2, marginBottom: 12, cursor: isHost ? "pointer" : "default", position: "relative" }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${buffered}%`, background: "rgba(255,255,255,0.15)", borderRadius: 2 }} />
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #3b82f6, #6366f1)", borderRadius: 2 }} />
          {isHost && <div style={{ position: "absolute", top: "50%", left: `${progress}%`, transform: "translate(-50%,-50%)", width: 12, height: 12, borderRadius: "50%", background: "#60a5fa", boxShadow: "0 0 8px #3b82f6" }} />}
        </div>

        <div className="flex items-center gap-4">
          {isHost ? (
            <button onClick={togglePlay} style={{ background: "none", border: "none", color: "white", fontSize: 20, cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}>{isPlaying ? "⏸" : "▶"}</button>
          ) : (
            <span style={{ fontSize: 13, opacity: 0.5 }}>👁 Viewing</span>
          )}

          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, minWidth: 90 }}>{formatTime(currentTime)} / {formatTime(duration)}</span>

          {movieName && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{movieName}</span>}

          <div style={{ flex: 1 }} />

          {isHost && (
            <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", cursor: "pointer", padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)" }}>
              📂 Change
              <input type="file" accept="video/*" onChange={handleFilePick} style={{ display: "none" }} />
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
