import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(publicDir));
app.get('/', (_req, res) => {
  res.sendFile(join(publicDir, 'index.html'));
});

const players = new Map();

function broadcast(data, excludeId = null) {
  const payload = JSON.stringify(data);
  for (const [id, client] of players.entries()) {
    if (id !== excludeId && client.ws.readyState === 1) {
      client.ws.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  const id = randomUUID().slice(0, 8);
  const color = Math.floor(Math.random() * 0xffffff);
  const state = { id, color, x: (Math.random() - 0.5) * 10, y: 1.6, z: (Math.random() - 0.5) * 10, ry: 0 };

  players.set(id, { ws, state });

  // Send existing world state to the new player
  ws.send(JSON.stringify({
    type: 'init',
    id,
    players: Array.from(players.values()).map((p) => p.state),
  }));

  // Notify others
  broadcast({ type: 'join', player: state }, id);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'move') {
        const entry = players.get(id);
        if (!entry) return;
        entry.state.x = msg.x;
        entry.state.y = msg.y;
        entry.state.z = msg.z;
        entry.state.ry = msg.ry;
        broadcast({ type: 'move', player: entry.state }, id);
      }
    } catch {
      // Ignore malformed packets
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
  });
});

export default server;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Open VR City server running on http://localhost:${PORT}`);
  });
}
