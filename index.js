const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Waiting queues for each mode
const waitingUsers = {
  chat: [],
  audio: [],
  video: []
};

// Active pairs
const pairs = new Map();
const userInfo = new Map();

app.get('/', (req, res) => {
  const online = io.engine.clientsCount;
  res.json({ 
    status: 'RandomChat Server Running! 🚀',
    online: online,
    waiting: {
      chat: waitingUsers.chat.length,
      audio: waitingUsers.audio.length,
      video: waitingUsers.video.length
    }
  });
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Send online count to all
  io.emit('onlineCount', io.engine.clientsCount);

  // User wants to find partner
  socket.on('findPartner', (data) => {
    const { mode, profile } = data;
    
    // Store user info
    userInfo.set(socket.id, { mode, profile });
    
    // Remove from any existing queue
    Object.keys(waitingUsers).forEach(m => {
      waitingUsers[m] = waitingUsers[m].filter(id => id !== socket.id);
    });
    
    // Check if someone is waiting
    if (waitingUsers[mode].length > 0) {
      const partnerId = waitingUsers[mode].shift();
      const partnerInfo = userInfo.get(partnerId);
      
      // Create pair
      pairs.set(socket.id, partnerId);
      pairs.set(partnerId, socket.id);
      
      // Notify both users
      socket.emit('matched', { 
        partnerId: partnerId,
        partnerProfile: partnerInfo?.profile || { name: 'Stranger', avatar: '👤' }
      });
      
      io.to(partnerId).emit('matched', { 
        partnerId: socket.id,
        partnerProfile: profile || { name: 'Stranger', avatar: '👤' }
      });
      
      console.log(`Matched: ${socket.id} <-> ${partnerId}`);
    } else {
      // Add to waiting queue
      waitingUsers[mode].push(socket.id);
      socket.emit('waiting');
      console.log(`Waiting: ${socket.id} for ${mode}`);
    }
  });

  // Handle messages
  socket.on('message', (data) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('message', {
        text: data.text,
        from: 'stranger'
      });
    }
  });

  // Handle typing
  socket.on('typing', (isTyping) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partnerTyping', isTyping);
    }
  });

  // WebRTC Signaling
  socket.on('offer', (data) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('offer', data);
    }
  });

  socket.on('answer', (data) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('answer', data);
    }
  });

  socket.on('ice-candidate', (data) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('ice-candidate', data);
    }
  });

  // Find next partner
  socket.on('next', () => {
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partnerLeft');
      pairs.delete(partnerId);
    }
    pairs.delete(socket.id);
    
    // Re-queue with same mode
    const info = userInfo.get(socket.id);
    if (info) {
      socket.emit('findPartner', { mode: info.mode, profile: info.profile });
    }
  });

  // User stops/disconnects
  socket.on('stop', () => {
    handleDisconnect(socket);
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket);
    io.emit('onlineCount', io.engine.clientsCount);
  });

  function handleDisconnect(socket) {
    // Remove from waiting queues
    Object.keys(waitingUsers).forEach(mode => {
      waitingUsers[mode] = waitingUsers[mode].filter(id => id !== socket.id);
    });
    
    // Notify partner
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partnerLeft');
      pairs.delete(partnerId);
    }
    pairs.delete(socket.id);
    userInfo.delete(socket.id);
    
    console.log('User disconnected:', socket.id);
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
