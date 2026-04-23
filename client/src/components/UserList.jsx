export default function UserList({ users, currentUser }) {
  return (
    <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.12em", color: "var(--text-secondary)" }}>IN THE ROOM</span>
        <span style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 11, color: "var(--text-secondary)", padding: "1px 8px" }}>{users.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {users.map((user) => {
          const isYou = user.id === currentUser?.id;
          return (
            <div key={user.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 8px", borderRadius: 8, background: isYou ? "rgba(59,130,246,0.06)" : "transparent", border: isYou ? "1px solid rgba(59,130,246,0.15)" : "1px solid transparent" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: user.avatar?.color || "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0, position: "relative" }}>
                {user.avatar?.initials || user.name?.slice(0,2).toUpperCase()}
                <div style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderRadius: "50%", background: "var(--green)", border: "1.5px solid var(--bg-panel)", boxShadow: "0 0 4px var(--green)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: isYou ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", background: isYou ? "linear-gradient(135deg,#60a5fa,#818cf8)" : "none", WebkitBackgroundClip: isYou ? "text" : "none", WebkitTextFillColor: isYou ? "transparent" : "var(--text-primary)", backgroundClip: isYou ? "text" : "none", color: isYou ? "transparent" : "var(--text-primary)" }}>
                  {user.name}{isYou && <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-secondary)", WebkitTextFillColor: "var(--text-secondary)" }}> (you)</span>}
                </div>
              </div>
              {user.isHost && <span style={{ fontSize: 13 }}>👑</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
