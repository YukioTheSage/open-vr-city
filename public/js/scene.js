import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

export const DESKTOP_EYE_HEIGHT = 1.6;
export const WORLD_LIMIT = 95;

function shortestAngleDiff(from, to) {
  let diff = (to - from + Math.PI) % (Math.PI * 2);
  if (diff < 0) diff += Math.PI * 2;
  return diff - Math.PI;
}

export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d16);
  scene.fog = new THREE.FogExp2(0x090d16, 0.015);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    300
  );
  const rig = new THREE.Group();
  rig.position.set(0, DESKTOP_EYE_HEIGHT, 12);
  rig.add(camera);
  scene.add(rig);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  // Lighting
  scene.add(new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.9));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(20, 40, 20);
  scene.add(dirLight);

  // City Plaza Floor & Grid
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.add(new THREE.GridHelper(200, 100, 0x38bdf8, 0x1e293b));

  // Central Plaza Monument
  const monument = new THREE.Mesh(
    new THREE.OctahedronGeometry(2.2, 0),
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6,
      wireframe: true,
    })
  );
  monument.position.set(0, 4, 0);
  scene.add(monument);

  // Procedural City Block Buildings
  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.6,
    metalness: 0.2,
  });
  const accentMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

  for (let x = -48; x <= 48; x += 12) {
    for (let z = -48; z <= 48; z += 12) {
      if (Math.abs(x) < 18 && Math.abs(z) < 18) continue; // Keep Central Plaza open
      const h = 8 + Math.abs(Math.sin(x * 13.7 + z * 7.3)) * 28;
      const building = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8), buildingMat);
      building.position.set(x, h / 2, z);
      scene.add(building);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(8.1, 0.25, 8.1), accentMat);
      trim.position.set(x, h - 0.5, z);
      scene.add(trim);
    }
  }

  // Shared avatar geometries & visor material to avoid GPU memory leaks
  const avatarBodyGeo = new THREE.CapsuleGeometry(0.35, 1.0, 4, 8);
  const avatarVisorGeo = new THREE.BoxGeometry(0.45, 0.18, 0.2);
  const avatarVisorMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

  function createAvatar(player) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: player.color,
      emissive: player.color,
      emissiveIntensity: 0.25,
    });
    const body = new THREE.Mesh(avatarBodyGeo, bodyMat);
    body.position.y = 0.9;

    const visor = new THREE.Mesh(avatarVisorGeo, avatarVisorMat);
    visor.position.set(0, 1.45, -0.28);

    group.add(body, visor);
    group.position.set(player.x, 0, player.z);
    group.rotation.y = player.ry || 0;
    group.userData = {
      bodyMat,
      targetPos: new THREE.Vector3(player.x, 0, player.z),
      targetRy: player.ry || 0,
    };
    scene.add(group);
    return group;
  }

  function updateAvatarTarget(group, player) {
    group.userData.targetPos.set(player.x, 0, player.z);
    group.userData.targetRy = player.ry || 0;
  }

  function interpolateAvatars(avatars, dt) {
    const alpha = 1 - Math.exp(-15 * dt);
    for (const group of avatars.values()) {
      group.position.lerp(group.userData.targetPos, alpha);
      group.rotation.y += shortestAngleDiff(group.rotation.y, group.userData.targetRy) * alpha;
    }
  }

  function disposeAvatar(group) {
    scene.remove(group);
    group.userData?.bodyMat?.dispose();
  }

  function updateMonument(dt) {
    monument.rotation.y += 0.48 * dt;
    monument.rotation.x += 0.24 * dt;
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    scene,
    camera,
    rig,
    renderer,
    createAvatar,
    updateAvatarTarget,
    interpolateAvatars,
    disposeAvatar,
    updateMonument,
  };
}
