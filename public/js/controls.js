import * as THREE from 'three';
import { DESKTOP_EYE_HEIGHT, WORLD_LIMIT } from './scene.js';

const SPEED_MPS = 6.5;
const UP = new THREE.Vector3(0, 1, 0);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function createControls({ rig, camera, renderer }) {
  const keys = Object.create(null);
  let dragging = false;
  let lastX = 0;
  let yaw = 0;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  function clearInput() {
    for (const code of Object.keys(keys)) {
      keys[code] = false;
    }
    dragging = false;
  }

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInput();
  });

  window.addEventListener('mousedown', (e) => {
    if (e.target !== renderer.domElement) return;
    dragging = true;
    lastX = e.clientX;
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.005;
    lastX = e.clientX;
    rig.rotation.y = yaw;
  });

  // WebXR headsets provide floor-relative eye height; avoid double-offsetting rig Y
  renderer.xr.addEventListener('sessionstart', () => {
    rig.position.y = 0;
  });
  renderer.xr.addEventListener('sessionend', () => {
    rig.position.y = DESKTOP_EYE_HEIGHT;
  });

  function setYaw(newYaw) {
    yaw = newYaw;
    rig.rotation.y = yaw;
  }

  function update(dt) {
    const step = SPEED_MPS * dt;
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0) forward.normalize();
    right.crossVectors(forward, UP).normalize();

    if (keys['KeyW'] || keys['ArrowUp']) rig.position.addScaledVector(forward, step);
    if (keys['KeyS'] || keys['ArrowDown']) rig.position.addScaledVector(forward, -step);
    if (keys['KeyA'] || keys['ArrowLeft']) rig.position.addScaledVector(right, -step);
    if (keys['KeyD'] || keys['ArrowRight']) rig.position.addScaledVector(right, step);

    rig.position.x = clamp(rig.position.x, -WORLD_LIMIT, WORLD_LIMIT);
    rig.position.z = clamp(rig.position.z, -WORLD_LIMIT, WORLD_LIMIT);
  }

  return { setYaw, update };
}
