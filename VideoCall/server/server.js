const express = require('express');
console.log('Starting server...');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
// mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/video-call');

// Simple user storage (in-memory for demo)
const users = {};

// Socket.io Events
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User joins
  socket.on('join', (userId) => {
    users[socket.id] = userId;

    // Send list of existing users to the new user
    const existingUsers = Object.entries(users)
      .filter(([id]) => id !== socket.id)
      .map(([id, name]) => ({ socketId: id, userId: name }));
    socket.emit('online-users', existingUsers);

    socket.broadcast.emit('user-joined', { socketId: socket.id, userId });
  });

  // Send offer (initiates call)
  socket.on('offer', (data) => {
    io.to(data.to).emit('offer', {
      from: socket.id,
      fromName: users[socket.id],
      offer: data.offer
    });
  });

  // Send answer
  socket.on('answer', (data) => {
    io.to(data.to).emit('answer', {
      from: socket.id,
      answer: data.answer
    });
  });

  // Send ICE candidates
  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate', {
      from: socket.id,
      candidate: data.candidate
    });
  });

  // End call
  socket.on('end-call', (data) => {
    io.to(data.to).emit('call-ended');
  });

  // Disconnect
  socket.on('disconnect', () => {
    delete users[socket.id];
    socket.broadcast.emit('user-left', socket.id);
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
