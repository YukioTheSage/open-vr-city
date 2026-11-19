import * as THREE from 'three';
import { createWorld } from './scene.js';
import { createControls } from './controls.js';
import { createNetworkClient } from './network.js';
import { CULL_OCCLUDED, CULL_VISIBLE } from './culling.js';

const world = createWorld();
const controls = createControls({
  rig: world.rig,
  camera: world.camera,
  renderer: world.renderer,
});
const network = createNetworkClient({
  statusEl: document.getElementById('status'),
  rig: world.rig,
  renderer: world.renderer,
  controls,
  world,
});

const perfEl = document.getElementById('perf');
const toggleOcclusionBtn = document.getElementById('toggle-occlusion');
const toggleRadarBtn = document.getElementById('toggle-radar');
const radarWrap = document.getElementById('radar-wrap');
const radarCanvas = document.getElementById('cull-radar');
const radarCtx = radarCanvas.getContext('2d');

let occlusionEnabled = true;
let radarEnabled = true;

function syncToggleButtons() {
  toggleOcclusionBtn.textContent = `Occlusion Culling: ${occlusionEnabled ? 'ON' : 'OFF'} (O)`;
  toggleOcclusionBtn.setAttribute('aria-pressed', String(occlusionEnabled));
  toggleOcclusionBtn.classList.toggle('is-off', !occlusionEnabled);

  toggleRadarBtn.textContent = `Cull Radar: ${radarEnabled ? 'ON' : 'OFF'} (M)`;
  toggleRadarBtn.setAttribute('aria-pressed', String(radarEnabled));
  toggleRadarBtn.classList.toggle('is-off', !radarEnabled);

  radarWrap.hidden = !radarEnabled || world.renderer.xr.isPresenting;
}

toggleOcclusionBtn.addEventListener('click', () => {
  occlusionEnabled = !occlusionEnabled;
  syncToggleButtons();
});

toggleRadarBtn.addEventListener('click', () => {
  radarEnabled = !radarEnabled;
  syncToggleButtons();
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyO') {
    occlusionEnabled = !occlusionEnabled;
    syncToggleButtons();
  } else if (e.code === 'KeyM') {
    radarEnabled = !radarEnabled;
    syncToggleButtons();
  }
});

world.renderer.xr.addEventListener('sessionstart', syncToggleButtons);
world.renderer.xr.addEventListener('sessionend', syncToggleButtons);
syncToggleButtons();

const camForward = new THREE.Vector3();

function drawRadar(cullStats) {
  if (!radarEnabled || world.renderer.xr.isPresenting) return;

  const size = radarCanvas.width;
  const half = size * 0.5;
  const scale = (size - 16) / 196; // maps [-98, 98] world meters onto canvas

  radarCtx.clearRect(0, 0, size, size);
  radarCtx.fillStyle = 'rgba(9, 13, 22, 0.9)';
  radarCtx.fillRect(0, 0, size, size);

  // Draw all 160 buildings colored by live cull state
  const buildings = world.buildings;
  const states = cullStats.states;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const st = states[i];
    if (st === CULL_VISIBLE) {
      radarCtx.fillStyle = '#38bdf8';
    } else if (st === CULL_OCCLUDED) {
      radarCtx.fillStyle = '#f43f5e';
    } else {
      radarCtx.fillStyle = '#263244';
    }
    const bw = Math.max(4, b.width * scale);
    const rx = half + b.x * scale - bw * 0.5;
    const ry = half + b.z * scale - bw * 0.5;
    radarCtx.fillRect(rx, ry, bw, bw);
  }

  // Draw camera position & FOV cone
  world.camera.getWorldDirection(camForward);
  const angle = Math.atan2(camForward.z, camForward.x);
  const px = half + cullStats.camX * scale;
  const py = half + cullStats.camZ * scale;
  const fovHalf = (world.camera.fov * Math.PI) / 360;
  const coneLen = 36;

  radarCtx.beginPath();
  radarCtx.moveTo(px, py);
  radarCtx.lineTo(px + Math.cos(angle - fovHalf) * coneLen, py + Math.sin(angle - fovHalf) * coneLen);
  radarCtx.lineTo(px + Math.cos(angle + fovHalf) * coneLen, py + Math.sin(angle + fovHalf) * coneLen);
  radarCtx.closePath();
  radarCtx.fillStyle = 'rgba(56, 189, 248, 0.16)';
  radarCtx.fill();

  radarCtx.beginPath();
  radarCtx.arc(px, py, 3, 0, Math.PI * 2);
  radarCtx.fillStyle = '#ffffff';
  radarCtx.fill();
}

let lastTime = 0;
let lastHudUpdate = 0;

window.__CITY_STATS__ = {
  totalBuildings: world.buildings.length,
  visible: world.buildings.length,
  frustumCulled: 0,
  occlusionCulled: 0,
  cityDrawCalls: 2,
  totalDrawCalls: 0,
  cullMs: 0,
  occlusionEnabled,
};

world.renderer.setAnimationLoop((time) => {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 1 / 60;
  lastTime = time;

  world.updateMonument(dt);
  controls.update(dt);
  world.interpolateAvatars(network.avatars, dt);
  network.sync(time);

  const cullStats = world.updateCityVisibility({ occlusionEnabled });
  world.renderer.render(world.scene, world.camera);

  const totalDrawCalls = world.renderer.info.render.calls;
  window.__CITY_STATS__ = {
    totalBuildings: cullStats.total,
    visible: cullStats.visibleCount,
    frustumCulled: cullStats.frustumCulled,
    occlusionCulled: cullStats.occlusionCulled,
    cityDrawCalls: cullStats.cityDrawCalls,
    totalDrawCalls,
    cullMs: Number(cullStats.cullMs.toFixed(2)),
    occlusionEnabled,
  };

  if (time - lastHudUpdate >= 100) {
    lastHudUpdate = time;
    perfEl.textContent =
      `${cullStats.total} buildings • ${cullStats.cityDrawCalls} city draw calls (${totalDrawCalls} total) • ` +
      `${cullStats.visibleCount} visible | ${cullStats.frustumCulled} frustum | ${cullStats.occlusionCulled} occluded ` +
      `(${cullStats.cullMs.toFixed(2)} ms)`;
    drawRadar(cullStats);
  }
});
