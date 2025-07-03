// socket-server/index.ts
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

type Participant = {
  userId: string;
  name: string;
  isReady: boolean;
};

const rooms: Record<
  string,
  {
    participants: Participant[];
    language: string;
  }
> = {};

const userSocketMap = new Map<string, string>(); // userId → socket.id

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // replace this with your frontend URL in production
    methods: ["GET", "POST"],
  },
});

app.use(cors());

io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`${socket.id} joined room here ${roomId}`);
  });

  socket.on("send-message", ({ roomId, message }) => {
    console.log(`📨 Message in ${roomId}: ${message}`);
    socket.to(roomId).emit("receive-message", message);
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
  socket.on("user-joined", ({ roomId, user }) => {
    console.log("🔔 user joined", user);

    // Broadcast to everyone else in the room
    socket.to(roomId).emit("new-user", user);
  });

  socket.on("ready-state-changed", ({ roomId, userId, isReady }) => {
    console.log(
      `✅ User ${userId} in room ${roomId} is now ${
        isReady ? "ready" : "not ready"
      }`
    );
    io.to(roomId).emit("user-ready-update", { userId, isReady });
  });

  socket.on("join-room", ({ roomId, user, language }) => {
    console.log({ roomId, user, language });
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        participants: [],
        language,
      };
    }

    const alreadyJoined = rooms[roomId].participants.some(
      (u) => u.userId === user.userId
    );
    if (!alreadyJoined) {
      rooms[roomId].participants.push({ ...user, isReady: false });
    }

    console.log(`🧑‍🤝‍🧑 ${user?.name} joined room ${roomId}`);
    io.to(roomId).emit("participants-update", rooms[roomId].participants);
  });

  // Server-side socket handling
  // Updated version of "user-left" handler
  socket.on("user-left", ({ roomId, userId, userName }) => {
    console.log(`User ${userName} left room ${roomId}`);

    const room = rooms[roomId];
    if (!room) return;

    // Remove the user from the room's participant list
    room.participants = room.participants.filter(
      (participant) => participant.userId !== userId
    );

    // Notify others
    socket.to(roomId).emit("user-left", { userId, userName });

    // Send the updated list to all clients in the room
    io.to(roomId).emit("participants-update", room.participants);

    // Optional: Clean up the room if it's now empty
    if (room.participants.length === 0) {
      delete rooms[roomId];
      console.log(`🧹 Room ${roomId} deleted due to no participants.`);
    }
  });

  socket.on("find-available-room", (language, callback) => {
    console.log({ rooms });
    const availableRoom = Object.entries(rooms).find(([roomId, data]) => {
      console.log({ data });
      return data.language === language && data.participants.length < 6;
    });

    if (availableRoom) {
      callback({ roomId: availableRoom[0] });
    } else {
      callback(null);
    }
  });

  socket.on("offer", ({ target, callerId, sdp }) => {
    io.to(target).emit("offer", { callerId, sdp });
  });

  socket.on("answer", ({ target, sdp }) => {
    io.to(target).emit("answer", { sdp });
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", { candidate });
  });

  socket.on("voice-join", ({ roomId, userId }) => {
    userSocketMap.set(userId, socket.id); // Track the socket ID for this user
    socket.join(roomId);
    socket.to(roomId).emit("voice-user-joined", { userId });
  });
  
  socket.on("voice-signal", ({ to, from, signal }) => {
    const targetSocketId = userSocketMap.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("voice-signal", { from, signal });
      console.log(`📡 Signal from ${from} to ${to} (socket: ${targetSocketId})`);
    } else {
      console.warn(`⚠️ No socket found for userId ${to}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  
    // Remove user from userSocketMap
    for (const [userId, sockId] of userSocketMap.entries()) {
      if (sockId === socket.id) {
        userSocketMap.delete(userId);
        console.log(`🧹 Removed mapping for ${userId}`);
        break;
      }
    }
  });
  
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Socket.IO server running on http://localhost:${PORT}`);
});
