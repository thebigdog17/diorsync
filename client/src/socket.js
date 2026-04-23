import { io } from "socket.io-client";

export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? ""
    : "http://localhost:3001");

// Wake the Render server up before connecting (free tier sleeps after 15min)
export async function wakeServer() {
  if (!SERVER_URL) return;
  try {
    const res = await fetch(`${SERVER_URL}/ping`, { method: "GET" });
    if (res.ok) console.log("[DiorSync] Server awake");
  } catch (e) {
    console.warn("[DiorSync] Wake ping failed, trying anyway...");
  }
}

const socket = io(SERVER_URL, {
  autoConnect: false,
  // polling FIRST — critical for Render. WebSocket upgrade happens automatically after.
  transports: ["polling", "websocket"],
  reconnectionAttempts: 15,
  reconnectionDelay: 1500,
  reconnectionDelayMax: 5000,
  timeout: 30000,
  forceNew: true,
});

socket.on("connect", () => {
  console.log(`[DiorSync] Connected via ${socket.io.engine.transport.name}`);
});

socket.on("connect_error", (err) => {
  console.warn("[DiorSync] Connection error:", err.message);
});

export default socket;
