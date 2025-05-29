const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

const io = new Server(server);

// Test route (optional, frontend se ab serve ho raha hai)
app.get("/api", (req, res) => {
  res.send("Server is running on same domain");
});

// Socket.io logic
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (roomId) => {
    console.log(`User ${socket.id} joined room: ${roomId}`);
    socket.join(roomId);
    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("offer", (data) => {
    console.log(`User ${socket.id} sending offer to room: ${data.room}`);
    socket.to(data.room).emit("offer", data);
  });

  socket.on("answer", (data) => {
    console.log(`User ${socket.id} sending answer to room: ${data.room}`);
    socket.to(data.room).emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    console.log(`User ${socket.id} sending ICE candidate to room: ${data.room}`);
    
    socket.to(data.room).emit("ice-candidate", data);
  });

  socket.on("disconnecting", () => {
    console.log(`User ${socket.id} is disconnecting`);
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((room) => {
      socket.to(room).emit("user-left", socket.id);
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    socket.broadcast.emit("user-disconnected", socket.id);
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
