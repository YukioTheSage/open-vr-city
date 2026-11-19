# Open VR City (v0.1 Prototype)

A browser-first, cross-platform open-world social city built with **Three.js**, **WebXR**, and **Node.js WebSockets**. Anyone on a VR headset or desktop browser can drop into the same shared Central Plaza with zero build step and zero downloads.

- **Live Demo:** https://open-vr-city.vercel.app *(open two tabs to see live avatar sync)*
- **Source Repo:** https://github.com/YukioTheSage/open-vr-city

---

## What's Working Now (v0.1)

- **160-Building City in 2 GPU Draw Calls:** Procedural 13×13 skyline around an open 3×3 Central Plaza rendered via two `THREE.InstancedMesh` batches (towers + neon trims) with dynamic per-frame instance compaction (`public/js/scene.js`).
- **Real-Time Frustum + Software Occlusion Culling:** Zero-stall front-to-back `96×54` conservative software depth-buffer culler (`public/js/culling.js`) that drops off-screen and fully occluded towers before GPU submission (works identically on desktop and WebXR), complete with live HUD draw-call telemetry, `O` toggle, and a real-time top-down Cull Radar (`M`).
- **Cross-Platform Desktop + WebXR Support:** Native `VRButton` with automatic WebXR floor-height rig adjustment (`sessionstart`/`sessionend`), plus frame-rate-independent (`dt`) WASD / Arrow movement and drag-to-look desktop controls (`public/js/controls.js`).
- **Real-Time WebSocket Multiplayer:** Plaza-ring spawning, smooth remote avatar interpolation, dirty-checked 20Hz position sync, auto-reconnect with exponential backoff, server-side coordinate validation/clamping, and heartbeat pruning for dead sockets (`server.js`, `public/js/network.js`).
- **Automated Unit & Integration Tests:** Built-in `node:test` suite verifying occlusion culling math (`test/culling.test.js`) and HTTP/WebSocket multiplayer sync (`test/server.test.js`).

---

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3000 in two browser tabs to test multiplayer
```

Run the integration test suite:

```bash
npm test
```

### Controls
- **Desktop:** `WASD` or Arrow keys to move, click-and-drag on the canvas to turn, `O` to toggle occlusion culling, `M` to toggle the top-down cull radar.
- **VR Headset:** Click **Enter VR** (`VRButton`) in any WebXR-capable browser (e.g., Meta Quest Browser).

---

## Architecture

The codebase is intentionally modular with zero bundler overhead so workstreams stay decoupled across distinct modules:

```text
open-vr-city/
├── server.js               # Express + ws multiplayer server & Vercel entrypoint
├── test/
│   ├── culling.test.js     # Unit tests for 160-building grid & software occlusion culler
│   └── server.test.js      # Integration tests (HTTP assets, /health, WebSocket protocol)
└── public/
    ├── index.html          # HUD, live draw-call/cull telemetry, radar canvas & importmap
    └── js/
        ├── main.js         # Animation loop, HUD telemetry, and top-down cull radar
        ├── scene.js        # 2-draw-call InstancedMesh city (160 towers), lighting, avatars
        ├── culling.js      # Zero-dep frustum + 96x54 conservative depth-buffer occlusion culler
        ├── controls.js     # Delta-time desktop controls & WebXR session height handling
        └── network.js      # WebSocket client, auto-reconnect, dirty-checked state sync
```

### HTTP & WebSocket Protocol

- `GET /` — Serves the Central Plaza client (`public/index.html`)
- `GET /health` — Returns `{ "status": "ok", "players": <count> }`
- `WS /` (or `WSS /` over HTTPS):

| Direction | `type` | Payload | Purpose |
| :--- | :--- | :--- | :--- |
| Server → Client | `init` | `{ type: "init", id, players: Player[] }` | Assigns player ID, plaza spawn, and full snapshot of active players |
| Server → Peers | `join` | `{ type: "join", player: Player }` | Notifies existing clients when a new player enters |
| Client → Server | `move` | `{ type: "move", x, y, z, ry }` | Throttled (20Hz max), dirty-checked transform updates (clamped server-side) |
| Server → Peers | `move` | `{ type: "move", player: Player }` | Broadcasts validated avatar transform to peers |
| Server → Peers | `leave` | `{ type: "leave", id }` | Removes disconnected or heartbeat-expired players |

`Player` schema: `{ id: string, color: number, x: number, y: number, z: number, ry: number }`.

---

## Deployment Notes & Scaling Constraints

- `server.js` exports the Node `http.Server` as default so Vercel Fluid Compute can run Express + native `ws` WebSockets out of the box at https://open-vr-city.vercel.app.
- **v0.1 Limit:** Player state is currently held in a single-process in-memory `Map`. That works cleanly for small demos on one instance, but scaling across districts, multi-instance serverless/container replicas, or 50+ concurrent users requires external pub/sub + spatial partitioning (see Track 1 below).

---

## v0.2 Roadmap (Parallel Workstreams)

Each track has isolated file ownership and concrete acceptance criteria so contributors can ship PRs concurrently without merge conflicts:

### Track 1 — Multiplayer Scaling & Spatial Voice (`server.js`, `server/*`, `public/js/network.js`)
- Replace full-room broadcast with spatial grid/interest-management partitioning for 50+ concurrent players per district.
- Add Redis pub/sub adapter so multiple server instances share district state.
- Implement WebRTC signaling + proximity voice chat attenuation based on avatar distance.
- **Done when:** Load tests sustain 50+ simultaneous bots at <100ms p95 broadcast latency across horizontally scaled instances.

### Track 2 — WebXR Locomotion & World Building (`public/js/controls.js`, `public/js/scene.js`)
- Add WebXR controller thumbstick smooth locomotion, snap-turning, and arc teleportation.
- Add avatar head/hand pose syncing, player nameplates, and building collision detection.
- Build interactive district venues (plaza portals, shared media screens, seated social zones).
- **Done when:** Full VR session supports controller movement + hand tracking sync without breaking desktop controls.

### Track 3 — QA, CI & Load Testing (`test/*`, `.github/workflows/*`)
- Add GitHub Actions CI running `npm test` + headless browser E2E checks on every PR.
- Build a WebSocket bot-swarm load generator (`npm run loadtest`) measuring tick jitter, packet loss, and memory growth under 50–200 simulated avatars.
- Add client FPS / WebGL regression benchmarks.
- **Done when:** Every PR automatically reports unit tests, 2-tab E2E status, and 50-bot load benchmark numbers.

---

## License

MIT — see [LICENSE](./LICENSE).
