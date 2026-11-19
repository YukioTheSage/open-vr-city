import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CULL_FRUSTUM,
  CULL_OCCLUDED,
  CULL_VISIBLE,
  CityOcclusionCuller,
  generateCityBuildings,
} from '../public/js/culling.js';

/**
 * Standard OpenGL/Three.js perspective * lookAt column-major 4x4 matrix helper
 * so culling math can be unit-tested in Node with zero external dependencies.
 */
function createViewProjMatrix({ eye, target, fovDeg = 75, aspect = 16 / 9, near = 0.1, far = 400 }) {
  // Perspective matrix (column-major)
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  const proj = new Float32Array(16);
  proj[0] = f / aspect;
  proj[5] = f;
  proj[10] = (far + near) * nf;
  proj[11] = -1;
  proj[14] = 2 * far * near * nf;

  // LookAt view matrix (column-major)
  let zx = eye.x - target.x;
  let zy = eye.y - target.y;
  let zz = eye.z - target.z;
  const zLen = Math.hypot(zx, zy, zz);
  zx /= zLen; zy /= zLen; zz /= zLen;

  // up = (0, 1, 0) => x = normalize(up x z)
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  const xLen = Math.hypot(xx, xy, xz);
  xx /= xLen; xz /= xLen;

  // y = z x x
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const view = new Float32Array(16);
  view[0] = xx; view[4] = xy; view[8] = xz;  view[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  view[1] = yx; view[5] = yy; view[9] = yz;  view[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  view[2] = zx; view[6] = zy; view[10] = zz; view[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  view[15] = 1;

  // out = proj * view (column-major)
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        proj[0 * 4 + row] * view[col * 4 + 0] +
        proj[1 * 4 + row] * view[col * 4 + 1] +
        proj[2 * 4 + row] * view[col * 4 + 2] +
        proj[3 * 4 + row] * view[col * 4 + 3];
    }
  }
  return out;
}

function makeBox(index, x, z, width, depth, height) {
  return {
    index,
    x,
    z,
    width,
    depth,
    height,
    minX: x - width / 2,
    maxX: x + width / 2,
    minY: 0,
    maxY: height,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
  };
}

test('generateCityBuildings produces exactly 160 buildings around an open Central Plaza', () => {
  const buildings = generateCityBuildings();
  assert.equal(buildings.length, 160);

  for (const b of buildings) {
    assert.ok(!(Math.abs(b.gx) <= 1 && Math.abs(b.gz) <= 1), 'No building inside 3x3 Central Plaza');
    assert.ok(b.minX >= -95 && b.maxX <= 95, 'Building X within world bounds');
    assert.ok(b.minZ >= -95 && b.maxZ <= 95, 'Building Z within world bounds');
    assert.ok(b.height >= 10 && b.height <= 45, `Unexpected building height ${b.height}`);
  }
});

test('CityOcclusionCuller culls fully occluded towers while keeping taller skyscrapers peeking above', () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  const vp = createViewProjMatrix({ eye, target: { x: 0, y: 1.6, z: -50 } });

  const buildings = [
    makeBox(0, 0, -20, 14, 6, 12),  // Foreground blocker (top at ~80% of screen height)
    makeBox(1, 0, -40, 6, 6, 15),   // Shorter tower fully hidden behind blocker
    makeBox(2, 0, -40, 6, 6, 29),   // Taller skyscraper visibly peeking above blocker inside FOV
    makeBox(3, 0, 25, 8, 8, 20),    // Behind camera (frustum culled)
  ];

  const culler = new CityOcclusionCuller(buildings, { width: 96, height: 54 });
  const res = culler.cull(vp, eye, { occlusionEnabled: true });

  assert.equal(res.states[0], CULL_VISIBLE, 'Foreground blocker must be visible');
  assert.equal(res.states[1], CULL_OCCLUDED, 'Shorter tower behind blocker must be occlusion-culled');
  assert.equal(res.states[2], CULL_VISIBLE, 'Taller skyscraper peeking above blocker must stay visible');
  assert.equal(res.states[3], CULL_FRUSTUM, 'Building behind camera must be frustum-culled');
  assert.equal(res.visibleCount, 2);
  assert.equal(res.occlusionCulled, 1);
  assert.equal(res.frustumCulled, 1);

  // Disabling occlusion culling must restore the hidden tower while keeping frustum culling active
  const noOcc = culler.cull(vp, eye, { occlusionEnabled: false });
  assert.equal(noOcc.occlusionCulled, 0);
  assert.equal(noOcc.states[1], CULL_VISIBLE);
  assert.equal(noOcc.states[3], CULL_FRUSTUM);
  assert.equal(noOcc.visibleCount, 3);
});

test('CityOcclusionCuller culls significant portions of the 160-building city from Central Plaza', () => {
  const buildings = generateCityBuildings();
  const culler = new CityOcclusionCuller(buildings, { width: 96, height: 54 });
  const eye = { x: 0, y: 1.6, z: 12 };
  const vp = createViewProjMatrix({ eye, target: { x: 0, y: 1.6, z: -40 } });

  const res = culler.cull(vp, eye, { occlusionEnabled: true });

  assert.equal(res.total, 160);
  assert.equal(res.visibleCount + res.frustumCulled + res.occlusionCulled, 160);
  assert.ok(res.frustumCulled > 40, `Expected >40 frustum-culled buildings, got ${res.frustumCulled}`);
  assert.ok(res.occlusionCulled > 10, `Expected >10 occlusion-culled buildings, got ${res.occlusionCulled}`);
  assert.ok(res.visibleCount > 0 && res.visibleCount < 100, `Unexpected visibleCount: ${res.visibleCount}`);
});
