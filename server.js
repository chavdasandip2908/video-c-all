const express = require("express"); // Import the Express.js framework for building web applications
const http = require("http"); // Import Node.js's built-in HTTP module to create a server
const path = require("path"); // Import Node.js's built-in Path module for working with file and directory paths
const { Server } = require("socket.io"); // Import the Server class from the Socket.IO library for real-time, two-way communication

// Initialize the Express application
const app = express();

// Serve static files from the 'public' directory.
// This allows your index.html, CSS, and client-side JavaScript to be accessed by browsers.
// path.join(__dirname, "public") ensures the correct path regardless of where the script is run.
app.use(express.static(path.join(__dirname, "public")));

// Create an HTTP server using the Express app.
// Socket.IO will attach to this HTTP server.
const server = http.createServer(app);

// Initialize Socket.IO and attach it to the HTTP server.
// This sets up the WebSocket server for real-time communication.
const io = new Server(server);

// --- Server-Side Room Management Data Structure ---
// This object will store the state of all active video call rooms.
// It's a key-value pair where:
// Key: roomId (string, the unique identifier for a room)
// Value: An object containing:
//   - creatorSocketId: The socket ID of the user who first created/joined this room.
//                      This user will receive join requests for this room.
//   - occupants: A Set of socket IDs currently connected and in this room.
//                Using a Set allows for efficient adding/deleting and ensures uniqueness.
const activeRooms = {};

// --- Socket.IO Connection Event Listener ---
// This block runs every time a new client connects to the Socket.IO server.
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`); // Log the ID of the newly connected user

  // --- Event: 'request-join-room' (from client) ---
  // This event is sent by a client when they want to either create a new room
  // or request to join an existing room.
  socket.on("request-join-room", (roomId) => {
    console.log(`User ${socket.id} requests to join room: "${roomId}"`);

    // Check if the requested room ID already exists in our activeRooms
    if (!activeRooms[roomId]) {
      // --- Scenario 1: Room Does Not Exist (User becomes the creator) ---
      // If the room doesn't exist, this user is the first one, so they become the creator.
      activeRooms[roomId] = {
        creatorSocketId: socket.id, // Set this user as the room creator
        occupants: new Set(), // Initialize an empty set for occupants
      };

      // Add the creator's socket to the Socket.IO room.
      socket.join(roomId);
      // Add the creator's socket ID to the room's occupants set.
      activeRooms[roomId].occupants.add(socket.id);

      console.log(
        `Room "${roomId}" created by ${socket.id}. User joined automatically.`
      );

      // Inform the client that they successfully created and joined the room.
      // 'isCreator: true' tells the client to show specific UI (e.g., waiting for requests).
      socket.emit("room-joined", {
        roomId,
        isCreator: true,
        message: `You created and joined room: "${roomId}". Waiting for others to request to join...`,
      });
    } else {
      // --- Scenario 2: Room Exists (User sends join request to creator) ---
      const creatorSocketId = activeRooms[roomId].creatorSocketId;

      // Check if the room's creator is still connected.
      // `io.sockets.sockets.get(creatorSocketId)` retrieves the actual Socket.IO object if it's active.
      if (creatorSocketId && io.sockets.sockets.get(creatorSocketId)) {
        // If the creator is present, send a join request to them.
        console.log(
          `Sending join request for ${socket.id} to creator ${creatorSocketId} of room "${roomId}"`
        );
        // Emit 'join-request-received' only to the creator's socket ID.
        io.to(creatorSocketId).emit("join-request-received", {
          roomId: roomId,
          requesterId: socket.id, // The ID of the user requesting to join
        });

        // Inform the requesting user that their request has been sent.
        socket.emit("awaiting-creator-approval", {
          roomId,
          message: `Request sent to room creator for room "${roomId}". Awaiting approval...`,
        });
      } else {
        // --- Scenario 3: Room Exists but Creator is Absent/Disconnected ---
        // This is a fallback. If the creator is gone, for simplicity, we'll allow
        // the user to directly join the room. In a more complex app, you might
        // implement a new creator election or force the user to create a new room.
        console.warn(
          `Creator for room "${roomId}" (${creatorSocketId}) not found or disconnected. Allowing direct join for ${socket.id}.`
        );

        // Add the user to the Socket.IO room.
        socket.join(roomId);
        // Add the user's socket ID to the room's occupants set.
        activeRooms[roomId].occupants.add(socket.id);

        // Inform the client that they directly joined the room.
        socket.emit("room-joined", {
          roomId,
          isCreator: false,
          message: `Joined room "${roomId}" (creator was absent).`,
        });

        // Notify other existing occupants in the room (if any) about the new user joining.
        // This triggers the WebRTC signaling process for them.
        socket.to(roomId).emit("user-joined", socket.id);
      }
    }
  });

  // --- Event: 'join-request-response' (from creator) ---
  // This event is sent by the room creator back to the server,
  // indicating whether they accept or decline a join request.
  socket.on("join-request-response", ({ roomId, requesterId, accepted }) => {
    console.log(
      `Creator ${socket.id} responded to join request for ${requesterId} in room "${roomId}". Accepted: ${accepted}`
    );

    // Get the Socket.IO object of the requesting user.
    // We need this to emit messages directly back to them.
    const requesterSocket = io.sockets.sockets.get(requesterId);

    // Check if the requesting user is still connected.
    if (!requesterSocket) {
      console.warn(`Requester ${requesterId} not found, perhaps disconnected.`);
      return; // Stop processing if the requester is no longer available.
    }

    if (accepted) {
      // --- If the join request is accepted ---
      // 1. Have the requesting user actually join the Socket.IO room.
      requesterSocket.join(roomId);
      // 2. Add the requesting user's ID to the room's occupants set.
      if (activeRooms[roomId]) { // Ensure room still exists
        activeRooms[roomId].occupants.add(requesterId);
      } else {
        console.error(`Room ${roomId} not found when accepting join request for ${requesterId}.`);
        requesterSocket.emit("join-declined", {
            roomId,
            message: `Room ${roomId} no longer exists.`,
        });
        return;
      }

      // 3. Inform the requesting user that their request was accepted and they have joined.
      requesterSocket.emit("room-joined", {
        roomId,
        isCreator: false,
        message: `You have been accepted into room: "${roomId}".`,
      });
      console.log(`User ${requesterId} officially joined room "${roomId}".`);

      // 4. Notify all *other* users in the room (including the creator who accepted)
      //    that a new user has officially joined. This triggers the WebRTC
      //    offer/answer exchange (user-joined event from index.html).
      //    `socket.to(roomId)` sends to all sockets in the room *except* the sender.
      socket.to(roomId).emit("user-joined", requesterId);
      //    Also, explicitly tell the creator (the sender) that the new user joined,
      //    as `socket.to` excludes the sender.
      socket.emit("user-joined", requesterId);

    } else {
      // --- If the join request is declined ---
      // Inform the requesting user that their request was declined.
      requesterSocket.emit("join-declined", {
        roomId,
        message: `Your request to join room "${roomId}" was declined.`,
      });
    }
  });

  // --- Event: 'offer' (WebRTC Signaling) ---
  // Relays WebRTC Session Description Protocol (SDP) offers between peers in the same room.
  socket.on("offer", (data) => {
    // `socket.to(data.room)` targets all sockets in the specified room *except* the sender.
    socket.to(data.room).emit("offer", data);
  });

  // --- Event: 'answer' (WebRTC Signaling) ---
  // Relays WebRTC SDP answers between peers in the same room.
  socket.on("answer", (data) => {
    socket.to(data.room).emit("answer", data);
  });

  // --- Event: 'ice-candidate' (WebRTC Signaling) ---
  // Relays ICE (Interactive Connectivity Establishment) candidates
  // (network information like IP addresses and ports) between peers.
  // This is crucial for establishing a direct peer-to-peer connection.
  socket.on("ice-candidate", (data) => {
    socket.to(data.room).emit("ice-candidate", data);
  });

  // --- Event: 'leave-room' (from client) ---
  // This custom event is sent by a client when they explicitly click the "Leave Call" button.
  socket.on("leave-room", (roomId) => {
    console.log(`User ${socket.id} explicitly leaving room: "${roomId}"`);
    // Ensure the socket actually leaves the Socket.IO room
    socket.leave(roomId);
    
    // Trigger the same cleanup logic as 'disconnecting' for this specific room
    // This ensures other users are notified and room state is updated.
    if (activeRooms[roomId] && activeRooms[roomId].occupants) {
        activeRooms[roomId].occupants.delete(socket.id); // Remove from occupants
        socket.to(roomId).emit("user-left", socket.id); // Notify others in room

        // If the leaving user was the creator
        if (activeRooms[roomId].creatorSocketId === socket.id) {
            console.log(`Creator ${socket.id} of room "${roomId}" is explicitly leaving.`);
            if (activeRooms[roomId].occupants.size > 0) {
                // Elect a new creator (for simplicity, the first occupant in the set)
                const newCreatorId = activeRooms[roomId].occupants.values().next().value;
                activeRooms[roomId].creatorSocketId = newCreatorId;
                io.to(newCreatorId).emit("you-are-creator", { roomId });
                console.log(`New creator for room "${roomId}" is ${newCreatorId}.`);
            } else {
                // Room is now empty, delete it
                delete activeRooms[roomId];
                console.log(`Room "${roomId}" is now empty and deleted.`);
            }
        } else if (activeRooms[roomId].occupants.size === 0) {
            // Room is empty and the creator was not the one leaving (they were already gone)
            delete activeRooms[roomId];
            console.log(`Room "${roomId}" is now empty and deleted.`);
        }
    }
  });


  // --- Event: 'disconnecting' (Socket.IO Built-in Event) ---
  // This event fires just BEFORE a socket leaves all rooms.
  // It's ideal for broadcasting "user left" messages, as `socket.rooms` is still populated.
  socket.on("disconnecting", () => {
    console.log(`User ${socket.id} is disconnecting.`);
    // Get all rooms the socket was in (excluding its own ID which is a default room)
    const roomsToLeave = [...socket.rooms].filter((r) => r !== socket.id);

    roomsToLeave.forEach((roomId) => {
      // Notify other users in the room that this user is leaving.
      socket.to(roomId).emit("user-left", socket.id);

      // Remove the user from the room's occupants set.
      if (activeRooms[roomId] && activeRooms[roomId].occupants) {
        activeRooms[roomId].occupants.delete(socket.id);

        // --- Creator Handover/Room Cleanup Logic ---
        // If the disconnected user was the creator of this room:
        if (activeRooms[roomId].creatorSocketId === socket.id) {
          console.log(`Creator ${socket.id} of room "${roomId}" is leaving.`);
          // If there are still other occupants left in the room:
          if (activeRooms[roomId].occupants.size > 0) {
            // Elect a new creator: For simplicity, we pick the first occupant in the Set.
            const newCreatorId = activeRooms[roomId].occupants.values().next().value;
            activeRooms[roomId].creatorSocketId = newCreatorId; // Assign new creator
            // Notify the new creator client-side so they know they are now in charge
            // (client-side will need to listen for 'you-are-creator' and update UI).
            io.to(newCreatorId).emit("you-are-creator", { roomId });
            console.log(
              `New creator for room "${roomId}" is ${newCreatorId}.`
            );
          } else {
            // If the creator leaves and no other occupants are left, delete the room.
            delete activeRooms[roomId];
            console.log(`Room "${roomId}" is now empty and deleted.`);
          }
        } else if (activeRooms[roomId].occupants.size === 0) {
          // If the room becomes empty (and the disconnected user was NOT the creator,
          // meaning the creator left earlier), delete the room.
          delete activeRooms[roomId];
          console.log(`Room "${roomId}" is now empty and deleted.`);
        }
      }
    });
  });

  // --- Event: 'disconnect' (Socket.IO Built-in Event) ---
  // This event fires AFTER the socket has completely disconnected and left all rooms.
  // 'disconnecting' is generally preferred for room-specific cleanup that needs 'socket.rooms'.
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    // No explicit room broadcast needed here as 'disconnecting' handles the room-specific cleanup and notifications.
  });
});

// Define the port the server will listen on.
// Uses process.env.PORT for deployment flexibility (e.g., on Heroku), or 5001 as a default for local development.
const PORT = process.env.PORT || 5001;

// Start the HTTP server and listen for incoming connections on the specified port.
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);