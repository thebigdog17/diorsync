require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());
app.get("/", (req, res) => res.json({ status: "DiorSync running" }));
app.get("/ping", (req, res) => res.json({ pong: true }));

const rooms = {};

function makeRoomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getAvatar(name) {
    const colors = ["#3b82f6","#6366f1","#0ea5e9","#8b5cf6","#06b6d4","#2563eb","#7c3aed","#0284c7","#4f46e5","#0891b2"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return { color: colors[Math.abs(hash) % colors.length], initials: name.slice(0, 2).toUpperCase() };
}

setInterval(() => {
    const now = Date.now();
    for (const id in rooms) {
        if (rooms[id].users.length === 0 && now - rooms[id].createdAt > 10 * 60 * 1000) delete rooms[id];
    }
}, 10 * 60 * 1000);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["polling", "websocket"],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 2e6,
});

io.on("connection", (socket) => {
    console.log(`[+] ${socket.id} connected`);

    socket.on("create-room", ({ name, roomName, password }) => {
        if (!name?.trim() || !roomName?.trim() || !password?.trim())
            return socket.emit("room-error", { message: "All fields are required." });
        const roomId = makeRoomId();
        const user = { id: socket.id, name: name.trim().slice(0,20), isHost: true, avatar: getAvatar(name) };
        rooms[roomId] = {
            id: roomId, name: roomName.trim().slice(0,40), password: password.trim(),
            hostId: socket.id, users: [user],
            currentMovie: null, isPlaying: false, currentTime: 0,
            createdAt: Date.now(),
        };
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.user = user;
        socket.emit("room-created", { roomId, roomName: rooms[roomId].name, user });
        console.log(`[ROOM] "${roomName}" (${roomId}) by ${name}`);
    });

    socket.on("join-room", ({ name, roomId, password }) => {
        if (!name?.trim() || !roomId?.trim() || !password?.trim())
            return socket.emit("room-error", { message: "All fields are required." });
        const room = rooms[roomId.trim().toUpperCase()];
        if (!room) return socket.emit("room-error", { message: "Room not found. Check the Room ID." });
        if (room.password !== password.trim()) return socket.emit("room-error", { message: "Wrong password." });
        const user = { id: socket.id, name: name.trim().slice(0,20), isHost: false, avatar: getAvatar(name) };
        room.users.push(user);
        socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.user = user;
        socket.emit("join-success", {
            roomId: room.id, roomName: room.name, user,
            roomState: { currentMovie: room.currentMovie, isPlaying: room.isPlaying, currentTime: room.currentTime, hostId: room.hostId },
        });
        io.to(room.id).emit("users-update", room.users);
        io.to(room.id).emit("system-message", { text: `${user.name} joined 🎉`, timestamp: Date.now() });
        console.log(`[JOIN] ${name} → ${room.id}`);
    });

    socket.on("video-chunk", ({ chunk, mimeType, done }) => {
        const room = getRoom(socket);
        if (!room || room.hostId !== socket.id) return;
        socket.to(room.id).emit("video-chunk", { chunk, mimeType, done });
    });

    socket.on("host-set-movie", ({ movieName, mimeType }) => {
        const room = getRoom(socket);
        if (!room || room.hostId !== socket.id) return;
        room.currentMovie = { name: movieName, mimeType };
        room.isPlaying = false; room.currentTime = 0;
        io.to(room.id).emit("movie-set", { movieName, mimeType });
        io.to(room.id).emit("system-message", { text: `${socket.data.user.name} loaded: ${movieName} 🎬`, timestamp: Date.now() });
    });

    socket.on("host-play", ({ currentTime }) => {
        const room = getRoom(socket);
        if (!room || room.hostId !== socket.id) return;
        room.isPlaying = true; room.currentTime = currentTime;
        socket.to(room.id).emit("sync-play", { currentTime });
    });

    socket.on("host-pause", ({ currentTime }) => {
        const room = getRoom(socket);
        if (!room || room.hostId !== socket.id) return;
        room.isPlaying = false; room.currentTime = currentTime;
        socket.to(room.id).emit("sync-pause", { currentTime });
    });

    socket.on("host-seek", ({ currentTime }) => {
        const room = getRoom(socket);
        if (!room || room.hostId !== socket.id) return;
        room.currentTime = currentTime;
        socket.to(room.id).emit("sync-seek", { currentTime });
    });

    socket.on("request-sync", () => {
        const room = getRoom(socket);
        if (!room) return;
        socket.emit("sync-state", { currentTime: room.currentTime, isPlaying: room.isPlaying, currentMovie: room.currentMovie });
    });

    socket.on("chat-message", ({ text }) => {
        const room = getRoom(socket); const user = socket.data.user;
        if (!room || !user || !text?.trim()) return;
        io.to(room.id).emit("chat-message", {
            id: `${Date.now()}-${socket.id}`, userId: socket.id,
            name: user.name, avatar: user.avatar,
            text: text.trim().slice(0, 300), timestamp: Date.now(),
        });
    });

    socket.on("reaction", ({ emoji }) => {
        const room = getRoom(socket); const user = socket.data.user;
        if (!room || !user) return;
        io.to(room.id).emit("reaction", { id: `${Date.now()}-${socket.id}`, emoji, name: user.name, x: Math.random() * 80 + 10 });
    });

    socket.on("disconnect", () => {
        const room = getRoom(socket); const user = socket.data.user;
        if (!room || !user) return;
        room.users = room.users.filter((u) => u.id !== socket.id);
        if (room.hostId === socket.id && room.users.length > 0) {
            room.users[0].isHost = true; room.hostId = room.users[0].id;
            io.to(room.id).emit("host-changed", { newHostId: room.hostId });
            io.to(room.id).emit("system-message", { text: `${room.users[0].name} is now the host 👑`, timestamp: Date.now() });
        }
        io.to(room.id).emit("users-update", room.users);
        io.to(room.id).emit("system-message", { text: `${user.name} left`, timestamp: Date.now() });
    });
});

function getRoom(socket) { return socket.data.roomId ? rooms[socket.data.roomId] : null; }

server.listen(PORT, "0.0.0.0", () => console.log(`\n🎬 DiorSync running on port ${PORT}\n`));