import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createAppServer } from '../server.js';

function nextMessage(ws, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    function onMsg(raw) {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    }
    ws.on('message', onMsg);
  });
}

function closeSocket(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', resolve);
    ws.close();
  });
}

test('Open VR City HTTP endpoints and WebSocket multiplayer sync', async (t) => {
  const { server } = createAppServer({ heartbeatIntervalMs: 60_000 });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('serves index.html, client ES modules, and /health', async () => {
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /Open VR City/);
    assert.match(html, /\/js\/main\.js/);

    for (const asset of ['/js/main.js', '/js/scene.js', '/js/controls.js', '/js/network.js']) {
      const res = await fetch(`${baseUrl}${asset}`);
      assert.equal(res.status, 200, `Expected 200 for ${asset}`);
    }

    const health = await (await fetch(`${baseUrl}/health`)).json();
    assert.deepEqual(health, { status: 'ok', players: 0 });
  });

  await t.test('syncs join, move, clamping, validation, and leave across two clients', async () => {
    const ws1 = new WebSocket(wsUrl);
    const init1 = await nextMessage(ws1, (m) => m.type === 'init');
    assert.ok(init1.id);
    assert.equal(init1.players.length, 1);

    const spawnDist = Math.hypot(init1.players[0].x, init1.players[0].z);
    assert.ok(spawnDist >= 5.9 && spawnDist <= 12.1, `Expected plaza ring spawn, got radius ${spawnDist}`);

    const joinP = nextMessage(ws1, (m) => m.type === 'join');
    const ws2 = new WebSocket(wsUrl);
    const init2 = await nextMessage(ws2, (m) => m.type === 'init');
    const join1 = await joinP;

    assert.equal(init2.players.length, 2);
    assert.equal(join1.player.id, init2.id);

    const health2 = await (await fetch(`${baseUrl}/health`)).json();
    assert.equal(health2.players, 2);

    // Send malformed JSON and invalid move payloads before a valid out-of-bounds move
    const moveP = nextMessage(ws2, (m) => m.type === 'move');
    ws1.send('{{{not-json');
    ws1.send(JSON.stringify({ type: 'move', x: 'bad', y: 1.6, z: null, ry: 0 }));
    ws1.send(JSON.stringify({ type: 'move', x: 500, y: 120, z: -500, ry: 1.25 }));

    const move2 = await moveP;
    assert.equal(move2.player.id, init1.id);
    assert.equal(move2.player.x, 95);
    assert.equal(move2.player.y, 50);
    assert.equal(move2.player.z, -95);
    assert.equal(move2.player.ry, 1.25);

    const leaveP = nextMessage(ws2, (m) => m.type === 'leave');
    await closeSocket(ws1);
    const leave2 = await leaveP;
    assert.equal(leave2.id, init1.id);

    const healthAfter = await (await fetch(`${baseUrl}/health`)).json();
    assert.equal(healthAfter.players, 1);

    await closeSocket(ws2);
  });
});
