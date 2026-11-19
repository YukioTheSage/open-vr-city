import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import {
  BUILDING_SIZE,
  CityOcclusionCuller,
  generateCityBuildings,
} from './culling.js';

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
  scene.fog = new THREE.FogExp2(0x090d16, 0.0085);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    400
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
  scene.add(new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.95));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(30, 60, 30);
  scene.add(dirLight);

  // City Plaza Floor & Grid
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.add(new THREE.GridHelper(240, 120, 0x38bdf8, 0x1e293b));

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

  // 160 Procedural Buildings rendered in exactly 2 GPU draw calls (towers + neon trims)
  const buildings = generateCityBuildings();
  const totalBuildings = buildings.length;
  const culler = new CityOcclusionCuller(buildings, { width: 96, height: 54 });

  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.25,
  });
  const buildingsMesh = new THREE.InstancedMesh(buildingGeo, buildingMat, totalBuildings);
  buildingsMesh.frustumCulled = false; // Managed by per-instance frustum + occlusion culling

  const trimGeo = new THREE.BoxGeometry(BUILDING_SIZE + 0.14, 0.28, BUILDING_SIZE + 0.14);
  const accentMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const trimsMesh = new THREE.InstancedMesh(trimGeo, accentMat, totalBuildings);
  trimsMesh.frustumCulled = false;

  // Precompute all 160 building transforms and shades once for fast per-frame compaction
  const buildingMatrices = new Float32Array(totalBuildings * 16);
  const buildingColors = new Float32Array(totalBuildings * 3);
  const trimMatrices = new Float32Array(totalBuildings * 16);

  const dummy = new THREE.Object3D();
  const baseTowerColor = new THREE.Color(0x1e293b);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < totalBuildings; i++) {
    const b = buildings[i];

    dummy.position.set(b.x, b.height * 0.5, b.z);
    dummy.scale.set(b.width, b.height, b.depth);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    dummy.matrix.toArray(buildingMatrices, i * 16);
    buildingsMesh.setMatrixAt(i, dummy.matrix);

    tmpColor.copy(baseTowerColor).multiplyScalar(b.shade);
    buildingColors[i * 3] = tmpColor.r;
    buildingColors[i * 3 + 1] = tmpColor.g;
    buildingColors[i * 3 + 2] = tmpColor.b;
    buildingsMesh.setColorAt(i, tmpColor);

    dummy.position.set(b.x, b.height - 0.5, b.z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    dummy.matrix.toArray(trimMatrices, i * 16);
    trimsMesh.setMatrixAt(i, dummy.matrix);
  }

  buildingsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (buildingsMesh.instanceColor) {
    buildingsMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  trimsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  buildingsMesh.instanceMatrix.needsUpdate = true;
  if (buildingsMesh.instanceColor) buildingsMesh.instanceColor.needsUpdate = true;
  trimsMesh.instanceMatrix.needsUpdate = true;

  scene.add(buildingsMesh);
  scene.add(trimsMesh);

  // Pre-allocated culling scratch objects
  const projScreenMatrix = new THREE.Matrix4();
  const camWorldPos = new THREE.Vector3();

  function updateCityVisibility({ occlusionEnabled = true } = {}) {
    rig.updateMatrixWorld(true);
    const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    activeCamera.updateMatrixWorld(true);

    projScreenMatrix.multiplyMatrices(
      activeCamera.projectionMatrix,
      activeCamera.matrixWorldInverse
    );
    activeCamera.getWorldPosition(camWorldPos);

    const result = culler.cull(projScreenMatrix.elements, camWorldPos, { occlusionEnabled });
    const visibleCount = result.visibleCount;
    const visIndices = result.visibleIndices;

    const bMatArr = buildingsMesh.instanceMatrix.array;
    const bColArr = buildingsMesh.instanceColor.array;
    const tMatArr = trimsMesh.instanceMatrix.array;

    for (let slot = 0; slot < visibleCount; slot++) {
      const src = visIndices[slot];
      const srcMatOffset = src * 16;
      const dstMatOffset = slot * 16;
      for (let k = 0; k < 16; k++) {
        bMatArr[dstMatOffset + k] = buildingMatrices[srcMatOffset + k];
        tMatArr[dstMatOffset + k] = trimMatrices[srcMatOffset + k];
      }

      const srcColOffset = src * 3;
      const dstColOffset = slot * 3;
      bColArr[dstColOffset] = buildingColors[srcColOffset];
      bColArr[dstColOffset + 1] = buildingColors[srcColOffset + 1];
      bColArr[dstColOffset + 2] = buildingColors[srcColOffset + 2];
    }

    buildingsMesh.count = visibleCount;
    trimsMesh.count = visibleCount;
    buildingsMesh.instanceMatrix.needsUpdate = true;
    buildingsMesh.instanceColor.needsUpdate = true;
    trimsMesh.instanceMatrix.needsUpdate = true;

    return {
      ...result,
      cityDrawCalls: visibleCount > 0 ? 2 : 0,
      camX: camWorldPos.x,
      camZ: camWorldPos.z,
    };
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
    buildings,
    updateCityVisibility,
    createAvatar,
    updateAvatarTarget,
    interpolateAvatars,
    disposeAvatar,
    updateMonument,
  };
}
