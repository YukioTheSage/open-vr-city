import { DESKTOP_EYE_HEIGHT } from './scene.js';

const SYNC_INTERVAL_MS = 50;
const POS_EPSILON = 0.01;
const ROT_EPSILON = 0.01;
const MAX_RECONNECT_DELAY_MS = 10_000;

export function createNetworkClient({ statusEl, rig, renderer, controls, world }) {
  const avatars = new Map();
  let ws = null;
  let myId = null;
  let hasSpawned = false;
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  let lastSyncTime = 0;
  let forceSync = false;

  const lastSent = { x: NaN, y: NaN, z: NaN, ry: NaN };

  function updateStatus(message) {
    if (message) {
      statusEl.textContent = message;
      return;
    }
    statusEl.textContent = `Online • ${avatars.size + 1} player(s) in Central Plaza`;
  }

  function clearAvatars() {
    for (const group of avatars.values()) {
      world.disposeAvatar(group);
    }
    avatars.clear();
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}`);

    ws.onopen = () => {
      reconnectDelay = 1000;
      updateStatus();
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'init') {
        myId = msg.id;
        clearAvatars();
        for (const p of msg.players) {
          if (p.id === myId) {
            if (!hasSpawned) {
              hasSpawned = true;
              rig.position.set(
                p.x,
                renderer.xr.isPresenting ? 0 : DESKTOP_EYE_HEIGHT,
                p.z
              );
              controls.setYaw(p.ry || 0);
              lastSent.x = rig.position.x;
              lastSent.y = rig.position.y;
              lastSent.z = rig.position.z;
              lastSent.ry = rig.rotation.y;
            } else {
              // Sync current local position after a reconnect
              forceSync = true;
            }
          } else {
            avatars.set(p.id, world.createAvatar(p));
          }
        }
        updateStatus();
      } else if (msg.type === 'join' && msg.player.id !== myId) {
        if (!avatars.has(msg.player.id)) {
          avatars.set(msg.player.id, world.createAvatar(msg.player));
        }
        updateStatus();
      } else if (msg.type === 'move' && avatars.has(msg.player.id)) {
        world.updateAvatarTarget(avatars.get(msg.player.id), msg.player);
      } else if (msg.type === 'leave' && avatars.has(msg.id)) {
        world.disposeAvatar(avatars.get(msg.id));
        avatars.delete(msg.id);
        updateStatus();
      }
    };

    ws.onerror = () => {
      updateStatus('Offline / Solo Mode — retrying connection...');
    };

    ws.onclose = () => {
      clearAvatars();
      updateStatus('Disconnected (Solo Mode) — reconnecting...');
      scheduleReconnect();
    };
  }

  function sync(time) {
    if (!ws || ws.readyState !== 1) return;
    if (!forceSync && time - lastSyncTime < SYNC_INTERVAL_MS) return;

    const dx = Math.abs(rig.position.x - lastSent.x);
    const dy = Math.abs(rig.position.y - lastSent.y);
    const dz = Math.abs(rig.position.z - lastSent.z);
    const dry = Math.abs(rig.rotation.y - lastSent.ry);

    if (!forceSync && dx < POS_EPSILON && dy < POS_EPSILON && dz < POS_EPSILON && dry < ROT_EPSILON) {
      return;
    }

    forceSync = false;
    lastSyncTime = time;
    lastSent.x = rig.position.x;
    lastSent.y = rig.position.y;
    lastSent.z = rig.position.z;
    lastSent.ry = rig.rotation.y;

    ws.send(JSON.stringify({
      type: 'move',
      x: Number(rig.position.x.toFixed(3)),
      y: Number(rig.position.y.toFixed(3)),
      z: Number(rig.position.z.toFixed(3)),
      ry: Number(rig.rotation.y.toFixed(3)),
    }));
  }

  connect();

  return { avatars, sync };
}
