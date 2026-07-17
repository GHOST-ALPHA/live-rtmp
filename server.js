const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const execSync = require('child_process').execSync;
const NodeMediaServer = require('node-media-server');

// 1. Resolve FFmpeg Path dynamically (checks system PATH first, then installer package)
let ffmpegPath = 'ffmpeg';
try {
  if (process.platform !== 'win32') {
    ffmpegPath = execSync('which ffmpeg').toString().trim();
  } else {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  }
  console.log(`✔ System FFmpeg resolved to: ${ffmpegPath}`);
} catch (e) {
  console.log('ℹ System FFmpeg not found in PATH. Checking @ffmpeg-installer/ffmpeg...');
  try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    ffmpegPath = ffmpegInstaller.path;
    console.log('✔ FFmpeg path resolved from installer package:', ffmpegPath);
  } catch (err) {
    console.error('❌ Failed to locate any FFmpeg binary. HLS/DASH streaming will fail.');
  }
}

// 2. Ensure HLS output directory exists
const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

// 3. Configure Node-Media-Server (Ingestion on 1935, distribution on 8001)
const nmsConfig = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8001,
    allow_origin: '*',
    mediaroot: './media' // Segment outputs will go here: ./media/live/stream/...
  },
  trans: {
    ffmpeg: ffmpegPath,
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
        dash: true,
        dashFlags: '[f=dash:window_size=3:extra_window_size=5]'
      }
    ]
  }
};

const nms = new NodeMediaServer(nmsConfig);
nms.run();

console.log('RTMP Media Server started. Ingest: 1935, Web Stream Server: 8001');

// 4. Set up Express Web Server (Port 8000) for admin monitors and proxy APIs
const app = express();
const server = http.createServer(app);

// Serve static dashboard files if accessed directly
app.use(express.static(path.join(__dirname, 'public')));

// Simple proxy endpoints to fetch NMS stats without CORS issues
app.get('/api/server-stats', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:8001/api/server');
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch NMS server stats', details: error.message });
  }
});

app.get('/api/streams-stats', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:8001/api/streams');
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch NMS streams stats', details: error.message });
  }
});

// 5. WebSocket server for Live Broadcast Chat & Dashboard Viewer Stats
const wss = new WebSocket.Server({ server });

let viewerCount = 0;
const messagesHistory = [];

wss.on('connection', (ws) => {
  viewerCount++;
  console.log(`New client connected. Active dashboard viewers: ${viewerCount}`);

  // Broadcast updated viewer count to all clients
  broadcast({ type: 'viewer_count', count: viewerCount });

  // Send message history to the newly connected client
  ws.send(JSON.stringify({ type: 'history', messages: messagesHistory }));

  ws.on('message', (messageText) => {
    try {
      const data = JSON.parse(messageText);
      if (data.type === 'chat') {
        const chatMessage = {
          id: Date.now() + Math.random().toString(36).substr(2, 5),
          user: data.user || 'Anonymous',
          message: data.message,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          avatarColor: data.avatarColor || '#3b82f6'
        };

        // Save to history (limit to 50 messages)
        messagesHistory.push(chatMessage);
        if (messagesHistory.length > 50) messagesHistory.shift();

        // Broadcast to all clients
        broadcast({ type: 'chat', message: chatMessage });
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  });

  ws.on('close', () => {
    viewerCount = Math.max(0, viewerCount - 1);
    console.log(`Client disconnected. Active dashboard viewers: ${viewerCount}`);
    broadcast({ type: 'viewer_count', count: viewerCount });
  });
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// 6. Start the Express App Web server
const PORT = 8000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`📺 Broadcasting Dashboard Running at http://localhost:${PORT}`);
  console.log(`📹 Ingest RTMP stream on: rtmp://localhost/live`);
  console.log(`=======================================================`);
});

// 7. Security Ingestion Check Hook (Requires psk=naxatra_1a2b3c4d query parameter)
nms.on('prePublish', (id, StreamPath, args) => {
  console.log(`[NMS prePublish] Auth validation check. id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  
  const expectedPath = '/live/stream';
  const expectedPsk = 'naxatra_1a2b3c4d';

  if (StreamPath !== expectedPath) {
    console.warn(`[NMS prePublish] Connection REJECTED: Invalid stream path '${StreamPath}'. Expected '${expectedPath}'.`);
    const session = nms.getSession(id);
    if (session) session.reject();
    return;
  }

  if (!args || args.psk !== expectedPsk) {
    console.warn(`[NMS prePublish] Connection REJECTED: Invalid or missing pre-shared key (psk) parameter. Received: ${JSON.stringify(args)}`);
    const session = nms.getSession(id);
    if (session) session.reject();
    return;
  }

  console.log(`[NMS prePublish] Connection AUTHORIZED for stream path '${StreamPath}'. Ingestion starting...`);
});

// Notify web socket clients that a stream has started/stopped
nms.on('postPublish', (id, StreamPath, args) => {
  console.log('[NMS postPublish]', `id=${id} StreamPath=${StreamPath}`);
  broadcast({ type: 'stream_status', status: 'online', path: StreamPath });
});

nms.on('donePublish', (id, StreamPath, args) => {
  console.log('[NMS donePublish]', `id=${id} StreamPath=${StreamPath}`);
  broadcast({ type: 'stream_status', status: 'offline', path: StreamPath });
});
