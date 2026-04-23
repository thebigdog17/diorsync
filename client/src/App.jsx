import { useState, useEffect, useCallback } from "react";
import socket, { wakeServer, SERVER_URL } from "./socket";
import RoomLobby from "./components/RoomLobby";
import VideoPlayer from "./components/VideoPlayer";
import Chat from "./components/Chat";
import Reactions from "./components/Reactions";
import UserList from "./components/UserList";

export default function App() {
  const [view, setView] = useState("lobby");
  const [currentUser, setCurrentUser] = useState(null);
  const [roomInfo, setRoomInfo] = useState(null);
  const [users, setUsers] = useState([]);
  const [currentMovie, setCurrentMovie] = useState(null);
  const [roomError, setRoomError] = useState("");
  const [isWaking, setIsWaking] = useState(false);
  const [showRoomId, setShowRoomId] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("room-created", ({ roomId, roomName, user }) => {
      setIsWaking(false);
      setCurrentUser(user);
      setRoomInfo({ roomId, roomName });
      setRoomError("");
      setView("room");
      setShowRoomId(true);
    });

    socket.on("join-success", ({ roomId, roomName, user, roomState }) => {
      setIsWaking(false);
      setCurrentUser(user);
      setRoomInfo({ roomId, roomName });
      setCurrentMovie(roomState.currentMovie);
      setRoomError("");
      setView("room");
    });

    socket.on("room-error", ({ message }) => {
      setIsWaking(false);
      setRoomError(message);
    });

    socket.on("users-update", (updated) => {
      setUsers(updated);
      setCurrentUser((prev) => {
        if (!prev) return prev;
        const me = updated.find((u) => u.id === prev.id);
        return me ? { ...prev, isHost: me.isHost } : prev;
      });
    });

    socket.on("movie-set", ({ movieName }) => setCurrentMovie({ name: movieName }));

    return () => {
      socket.off("connect"); socket.off("disconnect");
      socket.off("room-created"); socket.off("join-success");
      socket.off("room-error"); socket.off("users-update"); socket.off("movie-set");
    };
  }, []);

  async function connectAndEmit(event, data) {
    setIsWaking(true);
    setRoomError("");
    try {
      // Wake the server first (important for Render free tier)
      await wakeServer();
      // Then connect socket
      if (!socket.connected) {
        socket.connect();
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Connection timeout")), 30000);
          socket.once("connect", () => { clearTimeout(timeout); resolve(); });
          socket.once("connect_error", (err) => { clearTimeout(timeout); reject(err); });
        });
      }
      socket.emit(event, data);
    } catch (err) {
      setIsWaking(false);
      setRoomError("Could not connect to server. Please try again.");
    }
  }

  function handleCreateRoom(data) { connectAndEmit("create-room", data); }
  function handleJoinRoom(data) { connectAndEmit("join-room", data); }

  function copyRoomId() {
    navigator.clipboard.writeText(roomInfo?.roomId || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (view === "lobby") {
    return <RoomLobby onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} error={roomError} isWaking={isWaking} />;
  }

  return (
    <div className="grain" style={{ display: "grid", gridTemplateColumns: "1fr 310px", gridTemplateRows: showRoomId ? "48px 46px 1fr" : "48px 1fr", height: "100vh", width: "100vw", background: "var(--bg-deep)", overflow: "hidden" }}>

      {/* ── Top Bar ── */}
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", padding: "0 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", gap: 14 }}>
        {/* Logo */}
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.06em", background: "linear-gradient(135deg, #60a5fa, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", flexShrink: 0 }}>
          DIORSYNC
        </div>
        <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />

        {/* Room name */}
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {roomInfo?.roomName}
        </span>
        {currentMovie?.name && (
          <span style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}>
            · 🎬 {currentMovie.name}
          </span>
        )}

        <button onClick={() => setShowRoomId((s) => !s)} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "var(--text-secondary)", cursor: "pointer", flexShrink: 0, fontFamily: "Syne, sans-serif", fontWeight: 600 }}>
          {showRoomId ? "Hide" : "Share Room"}
        </button>

        <div style={{ flex: 1 }} />

        {/* Connection */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "var(--green)" : "var(--red)", boxShadow: connected ? "0 0 6px var(--green)" : "none" }} />
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{users.length} watching</span>
        </div>

        {/* User badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 20, padding: "3px 10px 3px 5px", flexShrink: 0 }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", background: currentUser?.avatar?.color || "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>
            {currentUser?.avatar?.initials}
          </div>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{currentUser?.name}</span>
          {currentUser?.isHost && <span style={{ fontSize: 11 }}>👑</span>}
        </div>
      </div>

      {/* ── Share Banner ── */}
      {showRoomId && (
        <div style={{ gridColumn: "1 / -1", background: "rgba(59,130,246,0.06)", borderBottom: "1px solid rgba(59,130,246,0.2)", padding: "0 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Room ID:</span>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.25em", background: "linear-gradient(135deg, #60a5fa, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            {roomInfo?.roomId}
          </span>
          <button onClick={copyRoomId} style={{ background: copied ? "var(--green)" : "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", border: "none", borderRadius: 6, padding: "4px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "Syne, sans-serif" }}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>· Share this + your password</span>
          <button onClick={() => setShowRoomId(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-secondary)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* ── Video ── */}
      <div style={{ position: "relative", background: "#000", overflow: "hidden" }}>
        <VideoPlayer currentUser={currentUser} currentMovie={currentMovie} onMovieNameSet={(name) => setCurrentMovie({ name })} />
        <Reactions />
      </div>

      {/* ── Sidebar ── */}
      <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)", background: "var(--bg-panel)", overflow: "hidden" }}>
        <UserList users={users} currentUser={currentUser} />
        <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <button style={{ width: "100%", background: "none", border: "none", borderBottom: "2px solid var(--accent)", color: "var(--accent)", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", padding: "10px 0", cursor: "pointer", fontFamily: "Syne, sans-serif" }}>
            💬 Live Chat
          </button>
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <Chat currentUser={currentUser} />
        </div>
      </div>
    </div>
  );
}
