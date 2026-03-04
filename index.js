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
  },
  pingTimeout: 60000,
  pingInterval: 25000
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

// Health check endpoint
app.get('/', (req, res) => {
  const online = io.engine.clientsCount;
  res.json({ 
    status: 'RandomChat Server Running! 🚀',
    online: online,
    waiting: {
      chat: waitingUsers.chat.length,
      audio: waitingUsers.audio.length,
      video: waitingUsers.video.length
    },
    uptime: Math.floor(process.uptime()) + ' seconds'
  });
});

// Ping endpoint for keep-alive
app.get('/ping', (req, res) => {
  res.send('pong');
});

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  
  // Send online count to all immediately
  const onlineCount = io.engine.clientsCount;
  io.emit('onlineCount', onlineCount);
  console.log('📊 Online users:', onlineCount);

  // User wants to find partner
  socket.on('findPartner', (data) => {
    const { mode, profile } = data;
    console.log('🔍 Finding partner for:', socket.id, 'Mode:', mode);
    
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
      
      // Verify partner is still connected
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (!partnerSocket) {
        // Partner disconnected, add current user to queue
        waitingUsers[mode].push(socket.id);
        socket.emit('waiting');
        console.log('⏳ Partner was disconnected, waiting:', socket.id);
        return;
      }
      
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
      
      console.log('🎉 Matched:', socket.id, '<->', partnerId);
    } else {
      // Add to waiting queue
      waitingUsers[mode].push(socket.id);
      socket.emit('waiting');
      console.log('⏳ Waiting:', socket.id, 'Queue size:', waitingUsers[mode].length);
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
      console.log('💬 Message from', socket.id, 'to', partnerId);
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
    console.log('⏭️ Next requested by:', socket.id);
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partnerLeft');
      pairs.delete(partnerId);
    }
    pairs.delete(socket.id);
  });

  // User stops
  socket.on('stop', () => {
    console.log('🛑 Stop requested by:', socket.id);
    handleDisconnect(socket);
  });

  // Disconnect
  socket.on('disconnect', () => {
    handleDisconnect(socket);
    io.emit('onlineCount', io.engine.clientsCount);
    console.log('📊 Online users after disconnect:', io.engine.clientsCount);
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
    
    console.log('❌ User disconnected:', socket.id);
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // ⭐ KEEP ALIVE - Ping itself every 14 minutes to prevent sleep
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  setInterval(() => {
    fetch(`${RENDER_URL}/ping`)
      .then(() => console.log('🏓 Self-ping successful'))
      .catch(() => console.log('🏓 Self-ping (local)'));
  }, 14 * 60 * 1000); // Every 14 minutes
});
