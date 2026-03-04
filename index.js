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
  pingInterval: 25000,
  transports: ['websocket', 'polling']
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

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'RandomChat Server Running! 🚀',
    online: io.engine.clientsCount,
    waiting: {
      chat: waitingUsers.chat.length,
      audio: waitingUsers.audio.length,
      video: waitingUsers.video.length
    },
    uptime: Math.floor(process.uptime()) + ' seconds'
  });
});

app.get('/ping', (req, res) => {
  res.send('pong');
});

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  
  // Send online count immediately
  io.emit('onlineCount', io.engine.clientsCount);

  // Find partner
  socket.on('findPartner', (data) => {
    const { mode, profile } = data;
    console.log('🔍 Finding partner for:', socket.id, 'Mode:', mode, 'Profile:', profile?.name);
    
    // Store user info
    userInfo.set(socket.id, { mode, profile });
    
    // Remove from all queues first
    ['chat', 'audio', 'video'].forEach(m => {
      const index = waitingUsers[m].indexOf(socket.id);
      if (index > -1) {
        waitingUsers[m].splice(index, 1);
      }
    });
    
    // Check if someone is waiting in this mode
    console.log('📊 Queue before:', mode, waitingUsers[mode]);
    
    if (waitingUsers[mode].length > 0) {
      const partnerId = waitingUsers[mode].shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);
      
      // Check if partner is still connected
      if (!partnerSocket || !partnerSocket.connected) {
        console.log('⚠️ Partner disconnected, adding to queue:', socket.id);
        waitingUsers[mode].push(socket.id);
        socket.emit('waiting');
        return;
      }
      
      const partnerInfo = userInfo.get(partnerId);
      
      // Create pair
      pairs.set(socket.id, partnerId);
      pairs.set(partnerId, socket.id);
      
      console.log('🎉 MATCHED:', socket.id, '<->', partnerId);
      
      // Notify current user
      socket.emit('matched', { 
        partnerId: partnerId,
        partnerProfile: partnerInfo?.profile || { name: 'Stranger', avatar: '👤' }
      });
      
      // Notify partner
      partnerSocket.emit('matched', { 
        partnerId: socket.id,
        partnerProfile: profile || { name: 'Stranger', avatar: '👤' }
      });
      
    } else {
      // No one waiting, add to queue
      waitingUsers[mode].push(socket.id);
      socket.emit('waiting');
      console.log('⏳ Added to queue:', socket.id, 'Queue size:', waitingUsers[mode].length);
    }
  });

  // Handle messages
  socket.on('message', (data) => {
    const partnerId = pairs.get(socket.id);
    console.log('💬 Message from', socket.id, 'to', partnerId, ':', data.text);
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

  // WebRTC signaling
  socket.on('offer', (data) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId) io.to(partnerId).emit('offer', data);
  });

  socket.on('answer', (data) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId) io.to(partnerId).emit('answer', data);
  });

  socket.on('ice-candidate', (data) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId) io.to(partnerId).emit('ice-candidate', data);
  });

  // Next partner
  socket.on('next', () => {
    console.log('⏭️ Next requested by:', socket.id);
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partnerLeft');
      pairs.delete(partnerId);
    }
    pairs.delete(socket.id);
  });

  // Stop chat
  socket.on('stop', () => {
    console.log('🛑 Stop by:', socket.id);
    cleanup(socket.id);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.id);
    cleanup(socket.id);
    io.emit('onlineCount', io.engine.clientsCount);
  });

  function cleanup(socketId) {
    // Remove from all queues
    ['chat', 'audio', 'video'].forEach(mode => {
      const index = waitingUsers[mode].indexOf(socketId);
      if (index > -1) {
        waitingUsers[mode].splice(index, 1);
      }
    });
    
    // Notify partner
    const partnerId = pairs.get(socketId);
    if (partnerId) {
      io.to(partnerId).emit('partnerLeft');
      pairs.delete(partnerId);
    }
    pairs.delete(socketId);
    userInfo.delete(socketId);
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
