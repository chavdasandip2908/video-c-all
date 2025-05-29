const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});


// test route
app.get("/", (req, res) => {
  res.send("Server is running");
});
// Handle socket connection
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // this code is for joining a room
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit("user-joined", socket.id);
  });

  // this code is for sending an offer to another user in the room
  socket.on("offer", (data) => {
    socket.to(data.room).emit("offer", data);
  });

  // this code is for sending an answer to the offer
  socket.on("answer", (data) => {
    socket.to(data.room).emit("answer", data);
  });

  // this code is for sending ICE candidates
  socket.on("ice-candidate", (data) => {
    socket.to(data.room).emit("ice-candidate", data);
  });

  // this code is for handling user disconnection from a room
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((room) => {
      socket.to(room).emit("user-left", socket.id);
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    // emit disconnecting
    socket.broadcast.emit("user-disconnected", socket.id);
  });
});

server.listen(5001, () =>
  console.log("Server running on http://localhost:5001")
);
