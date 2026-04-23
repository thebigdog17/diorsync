import { useState, useEffect } from "react";
import socket from "../socket";

const EMOJIS = ["😂", "🔥", "😭", "👏", "😱", "❤️", "💀", "🤣", "😍", "👀"];

export default function Reactions() {
  const [floating, setFloating] = useState([]);

  useEffect(() => {
    function onReaction(data) {
      const id = `${Date.now()}-${Math.random()}`;
      setFloating((p) => [...p, { ...data, id }]);
      setTimeout(() => setFloating((p) => p.filter((r) => r.id !== id)), 2600);
    }
    socket.on("reaction", onReaction);
    return () => socket.off("reaction", onReaction);
  }, []);

  return (
    <>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 40, overflow: "hidden" }}>
        {floating.map((r) => (
          <div key={r.id} className="reaction-float" style={{ left: `${r.x}%` }} title={r.name}>{r.emoji}</div>
        ))}
      </div>
      <div style={{ position: "absolute", bottom: 76, left: "50%", transform: "translateX(-50%)", zIndex: 45, display: "flex", gap: 4, background: "rgba(8,15,30,0.9)", border: "1px solid var(--border)", borderRadius: 40, padding: "7px 12px", backdropFilter: "blur(12px)" }}>
        {EMOJIS.map((emoji) => (
          <button key={emoji} onClick={() => socket.emit("reaction", { emoji })} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "2px 4px", borderRadius: 6, transition: "transform 0.1s" }}
            onMouseEnter={(e) => (e.target.style.transform = "scale(1.4)")}
            onMouseLeave={(e) => (e.target.style.transform = "scale(1)")}>
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
}
