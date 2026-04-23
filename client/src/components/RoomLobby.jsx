import { useState } from "react";

export default function RoomLobby({ onCreateRoom, onJoinRoom, error, isWaking }) {
  const [tab, setTab] = useState("create");
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit() {
    if (!name.trim()) return;
    if (tab === "create") {
      if (!roomName.trim() || !password.trim()) return;
      onCreateRoom({ name: name.trim(), roomName: roomName.trim(), password });
    } else {
      if (!roomId.trim() || !password.trim()) return;
      onJoinRoom({ name: name.trim(), roomId: roomId.trim().toUpperCase(), password });
    }
  }

  function handleKey(e) { if (e.key === "Enter") handleSubmit(); }

  return (
    <div className="h-screen w-screen flex items-center justify-center relative overflow-hidden grain mesh-bg">
      {/* Animated blue orbs */}
      <div style={{ position: "absolute", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)", top: "30%", left: "20%", transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)", bottom: "20%", right: "15%", pointerEvents: "none" }} />

      {/* Grid lines */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `repeating-linear-gradient(0deg,transparent,transparent 60px,#3b82f6 60px,#3b82f6 61px),repeating-linear-gradient(90deg,transparent,transparent 60px,#3b82f6 60px,#3b82f6 61px)` }} />

      <div className="slide-up relative z-10 w-full max-w-md px-4">
        <div className="card" style={{ padding: "44px 40px" }}>

          {/* Logo */}
          <div className="text-center mb-8">
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, lineHeight: 1, letterSpacing: "0.04em", background: "linear-gradient(135deg, #60a5fa, #818cf8, #38bdf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              DIORSYNC
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 11, marginTop: 6, letterSpacing: "0.2em", textTransform: "uppercase" }}>
              Watch Together · Live
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "linear-gradient(90deg, transparent, var(--border), transparent)", marginBottom: 28 }} />

          {/* Tabs */}
          <div style={{ display: "flex", background: "var(--bg-card)", borderRadius: 10, padding: 4, marginBottom: 28, border: "1px solid var(--border)" }}>
            {["create", "join"].map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "10px 0", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "Syne, sans-serif", transition: "all 0.2s", background: tab === t ? "linear-gradient(135deg, #3b82f6, #6366f1)" : "transparent", color: tab === t ? "#fff" : "var(--text-secondary)", boxShadow: tab === t ? "0 4px 12px rgba(59,130,246,0.3)" : "none" }}>
                {t === "create" ? "🎬 Create Room" : "🚪 Join Room"}
              </button>
            ))}
          </div>

          {/* Fields */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label className="label-text">Your Name</label>
              <input className="input-field" type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={handleKey} placeholder="e.g. Dior" maxLength={20} />
            </div>

            {tab === "create" ? (
              <div>
                <label className="label-text">Room Name</label>
                <input className="input-field" type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)} onKeyDown={handleKey} placeholder="e.g. Friday Night Cinema" maxLength={40} />
              </div>
            ) : (
              <div>
                <label className="label-text">Room ID</label>
                <input className="input-field" type="text" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} onKeyDown={handleKey} placeholder="e.g. AB12CD" maxLength={10} style={{ textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 700 }} />
              </div>
            )}

            <div>
              <label className="label-text">{tab === "create" ? "Set a Password" : "Room Password"}</label>
              <input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={handleKey} placeholder={tab === "create" ? "Friends will need this" : "Ask the host"} />
            </div>

            {error && (
              <div style={{ color: "var(--red)", fontSize: 13, padding: "10px 14px", background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.2)", borderRadius: 8 }}>
                {error}
              </div>
            )}

            <button onClick={handleSubmit} disabled={isWaking} className="pulse-blue" style={{ marginTop: 4, background: isWaking ? "#1e3a5f" : "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", cursor: isWaking ? "not-allowed" : "pointer", fontFamily: "Syne, sans-serif", boxShadow: isWaking ? "none" : "0 8px 24px rgba(59,130,246,0.3)", transition: "all 0.2s" }}>
              {isWaking ? "⏳ Waking up server..." : tab === "create" ? "Create Room & Host →" : "Join Party →"}
            </button>
          </div>

          <p style={{ color: "var(--text-secondary)", fontSize: 12, textAlign: "center", marginTop: 20 }}>
            {tab === "create" ? "You get a Room ID to share with friends 👑" : "Get the Room ID + password from the host"}
          </p>
        </div>
      </div>
    </div>
  );
}
