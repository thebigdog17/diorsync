import { useState, useEffect, useRef } from "react";
import socket from "../socket";

export default function Chat({ currentUser }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    socket.on("chat-message", (msg) => setMessages((p) => [...p.slice(-199), msg]));
    socket.on("system-message", (msg) => setMessages((p) => [...p.slice(-199), { ...msg, id: `sys-${msg.timestamp}`, isSystem: true }]));
    return () => { socket.off("chat-message"); socket.off("system-message"); };
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function send() {
    const text = input.trim();
    if (!text) return;
    socket.emit("chat-message", { text });
    setInput("");
    inputRef.current?.focus();
  }

  function handleKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }

  function formatTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-panel)" }}>
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13 }}>💬</span>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.1em", background: "linear-gradient(135deg, #60a5fa, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>LIVE CHAT</span>
        <span style={{ marginLeft: "auto", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 10, letterSpacing: "0.05em" }}>LIVE</span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--text-secondary)", fontSize: 13, textAlign: "center", marginTop: 40 }}>No messages yet. Say hi! 👋</div>
        )}
        {messages.map((msg) => {
          if (msg.isSystem) return (
            <div key={msg.id} className="msg-in" style={{ textAlign: "center", color: "var(--text-secondary)", fontSize: 11, padding: "5px 0", fontStyle: "italic" }}>
              {msg.text}
            </div>
          );
          const isOwn = msg.userId === currentUser?.id;
          return (
            <div key={msg.id} className="msg-in" style={{ display: "flex", gap: 8, padding: "5px 4px", borderRadius: 8, background: isOwn ? "rgba(59,130,246,0.05)" : "transparent" }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: msg.avatar?.color || "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0, marginTop: 2 }}>
                {msg.avatar?.initials || msg.name?.slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, background: isOwn ? "linear-gradient(135deg,#60a5fa,#818cf8)" : "none", WebkitBackgroundClip: isOwn ? "text" : "none", WebkitTextFillColor: isOwn ? "transparent" : "var(--text-primary)", backgroundClip: isOwn ? "text" : "none", color: isOwn ? "transparent" : "var(--text-primary)" }}>
                    {isOwn ? "You" : msg.name}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{formatTime(msg.timestamp)}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-primary)", wordBreak: "break-word", lineHeight: 1.4, marginTop: 2 }}>{msg.text}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKey} placeholder="Type a message..." maxLength={300}
          style={{ flex: 1, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text-primary)", fontSize: 13, outline: "none", fontFamily: "Syne, sans-serif" }}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.1)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }} />
        <button onClick={send} style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>↑</button>
      </div>
    </div>
  );
}
