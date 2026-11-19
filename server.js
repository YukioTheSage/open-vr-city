import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, 'public');

const WORLD_LIMIT = 95;
const HEARTBEAT_INTERVAL_MS = 30_000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createSpawnPosition() {
  // Spawn on a ring around the Central Plaza monument (radius 6..12)
  const angle = Math.random() * Math.PI * 2;
  const radius = 6 + Math.random() * 6;
  return {
    x: Number((Math.cos(angle) * radius).toFixed(3)),
    y: 1.6,
    z: Number((Math.sin(angle) * radius).toFixed(3)),
    ry: Number(Math.atan2(Math.cos(angle), Math.sin(angle)).toFixed(3)),
  };
}

function isValidMovePacket(msg) {
  return (
    msg &&
    msg.type === 'move' &&
    Number.isFinite(msg.x) &&
    Number.isFinite(msg.y) &&
    Number.isFinite(msg.z) &&
    Number.isFinite(msg.ry)
  );
}

export function createAppServer({ heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS } = {}) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const players = new Map();

  app.use(express.static(publicDir));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', players: players.size });
  });

  app.get('/', (_req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });

  function broadcast(data, excludeId = null) {
    const payload = JSON.stringify(data);
    for (const [id, client] of players.entries()) {
      if (id !== excludeId && client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    }
  }

  function removePlayer(id) {
    if (!players.has(id)) return;
    players.delete(id);
    broadcast({ type: 'leave', id });
  }

  wss.on('connection', (ws) => {
    const id = randomUUID().slice(0, 8);
    const color = Math.floor(Math.random() * 0xffffff);
    const spawn = createSpawnPosition();
    const state = { id, color, ...spawn };

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

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
        if (!isValidMovePacket(msg)) return;
        const entry = players.get(id);
        if (!entry) return;
        entry.state.x = clamp(msg.x, -WORLD_LIMIT, WORLD_LIMIT);
        entry.state.y = clamp(msg.y, -10, 50);
        entry.state.z = clamp(msg.z, -WORLD_LIMIT, WORLD_LIMIT);
        entry.state.ry = msg.ry;
        broadcast({ type: 'move', player: entry.state }, id);
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => removePlayer(id));
    ws.on('error', () => removePlayer(id));
  });

  const heartbeat = setInterval(() => {
    for (const [id, client] of players.entries()) {
      if (client.ws.isAlive === false) {
        client.ws.terminate();
        removePlayer(id);
        continue;
      }
      client.ws.isAlive = false;
      client.ws.ping();
    }
  }, heartbeatIntervalMs);

  heartbeat.unref();

  server.on('close', () => {
    clearInterval(heartbeat);
    for (const client of players.values()) {
      client.ws.terminate();
    }
    players.clear();
  });

  return { app, server, wss, players };
}

const { app, server, wss, players } = createAppServer();

export { app, server, wss, players };
export default server;

const isDirectRun =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase();

if (!process.env.VERCEL && isDirectRun) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Open VR City server running on http://localhost:${PORT}`);
  });
}
