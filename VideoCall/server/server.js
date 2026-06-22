const express = require('express');
console.log('Starting server...');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

const rooms = {}; // { roomId: { socketId: userName } }
const socketToRoom = {}; // { socketId: roomId }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomId, userName }) => {
    if (rooms[roomId]) {
      rooms[roomId][socket.id] = userName;
    } else {
      rooms[roomId] = { [socket.id]: userName };
    }
    socketToRoom[socket.id] = roomId;
    socket.join(roomId);

    const otherUsers = Object.entries(rooms[roomId])
      .filter(([id]) => id !== socket.id)
      .map(([id, name]) => ({ socketId: id, userName: name }));

    socket.emit('all-users', otherUsers);
    socket.to(roomId).emit('user-joined', { socketId: socket.id, userName });
  });

  // Chat message handling with IST Timestamp
  socket.on('send-message', (data) => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      // Force Indian Standard Time (IST)
      const istTime = new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      io.to(roomId).emit('receive-message', {
        text: data.text,
        senderId: socket.id,
        senderName: data.senderName,
        timestamp: istTime
      });
    }
  });

  socket.on('offer', (data) => {
    io.to(data.to).emit('offer', {
      from: socket.id,
      fromName: rooms[data.roomId]?.[socket.id] || 'Unknown',
      offer: data.offer
    });
  });

  socket.on('answer', (data) => {
    io.to(data.to).emit('answer', { from: socket.id, answer: data.answer });
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate', { from: socket.id, candidate: data.candidate });
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    if (roomId && rooms[roomId]) {
      delete rooms[roomId][socket.id];
      if (Object.keys(rooms[roomId]).length === 0) delete rooms[roomId];
      socket.to(roomId).emit('user-left', socket.id);
    }
    delete socketToRoom[socket.id];
  });

  socket.on('leave-room', () => {
    const roomId = socketToRoom[socket.id];
    if (roomId && rooms[roomId]) {
      delete rooms[roomId][socket.id];
      socket.to(roomId).emit('user-left', socket.id);
      socket.leave(roomId);
    }
    delete socketToRoom[socket.id];
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
