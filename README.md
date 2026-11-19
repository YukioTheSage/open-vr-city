# Open VR City (v0.1 Prototype)

A browser-first, cross-platform open-world social city built with **Three.js**, **WebXR**, and **Node.js WebSockets**. Anyone on a VR headset or desktop browser can drop into the same persistent city block with zero downloads.

## What's Working Now (v0.1)
- Procedural 3D Central Plaza & surrounding city block
- Native WebXR headset support (`VRButton`) + desktop WASD/mouse controls
- Real-time WebSocket multiplayer server syncing player avatars & positions

## Quick Start
```bash
npm install
npm start
# Open http://localhost:3000 in two browser tabs to test multiplayer
```

## Devin Bots Parallel Engineering Roadmap

1. **Multiplayer & Spatial Voice Agent:** Migrate to spatial partitioning + WebRTC proximity voice chat for 50+ concurrent players per district.
2. **VR & World Building Agent:** Add WebXR thumbstick locomotion, teleportation, custom avatars, and interactive buildings/venues.
3. **QA & Load Testing Agent:** Automated headless browser bots to stress-test WebSocket sync, latency, and frame drops across districts.
