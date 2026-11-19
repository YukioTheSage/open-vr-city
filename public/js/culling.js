export const CULL_VISIBLE = 0;
export const CULL_FRUSTUM = 1;
export const CULL_OCCLUDED = 2;

export const CITY_GRID_HALF = 6; // 13x13 = 169 cells
export const PLAZA_HALF = 1;     // 3x3 = 9 open plaza cells -> 160 buildings
export const GRID_SPACING = 14;
export const BUILDING_SIZE = 8;

const DEPTH_EPS = 1e-4;
const NEAR_W_THRESHOLD = 0.1;

/**
 * Generates a deterministic 160-building city around Central Plaza
 * (13x13 grid minus the 3x3 central plaza = 160 buildings).
 */
export function generateCityBuildings() {
  const buildings = [];
  let index = 0;

  for (let gx = -CITY_GRID_HALF; gx <= CITY_GRID_HALF; gx++) {
    for (let gz = -CITY_GRID_HALF; gz <= CITY_GRID_HALF; gz++) {
      if (Math.abs(gx) <= PLAZA_HALF && Math.abs(gz) <= PLAZA_HALF) continue;

      const x = gx * GRID_SPACING;
      const z = gz * GRID_SPACING;
      const hash = Math.abs(Math.sin(gx * 12.9898 + gz * 78.233) * 43758.5453) % 1;
      const ring = Math.max(Math.abs(gx), Math.abs(gz));

      // Mix of mid-rise foreground towers and tall skyline skyscrapers
      const baseHeight = ring === 2 ? 14 : 10;
      const height = Number((baseHeight + hash * 30).toFixed(2));
      const half = BUILDING_SIZE * 0.5;

      buildings.push({
        index: index++,
        gx,
        gz,
        x,
        z,
        width: BUILDING_SIZE,
        depth: BUILDING_SIZE,
        height,
        minX: x - half,
        maxX: x + half,
        minY: 0,
        maxY: height,
        minZ: z - half,
        maxZ: z + half,
        shade: 0.78 + hash * 0.42,
      });
    }
  }

  return buildings;
}

/**
 * Conservative CPU frustum + software depth-buffer occlusion culler.
 * Designed for instanced city rendering (zero GPU readback stalls, WebXR-safe).
 */
export class CityOcclusionCuller {
  constructor(buildings, { width = 96, height = 54 } = {}) {
    this.buildings = buildings;
    this.count = buildings.length;
    this.width = width;
    this.height = height;
    this.depthBuffer = new Float32Array(width * height);
    this.states = new Uint8Array(this.count);
    this.visibleIndices = new Int32Array(this.count);

    // Pre-allocated scratch buffers (zero per-frame GC pressure)
    this._planes = new Float32Array(24); // 6 planes * (a, b, c, d)
    this._frustumCandidates = new Int32Array(this.count);
    this._candidateDistSq = new Float32Array(this.count);
    this._quadSX = new Float32Array(4);
    this._quadSY = new Float32Array(4);
    this._quadZ = new Float32Array(4);
  }

  _extractFrustumPlanes(m) {
    const p = this._planes;
    // Column-major 4x4 matrix m: row r = (m[r], m[4+r], m[8+r], m[12+r])
    // Left: row3 + row0
    p[0] = m[3] + m[0]; p[1] = m[7] + m[4]; p[2] = m[11] + m[8]; p[3] = m[15] + m[12];
    // Right: row3 - row0
    p[4] = m[3] - m[0]; p[5] = m[7] - m[4]; p[6] = m[11] - m[8]; p[7] = m[15] - m[12];
    // Bottom: row3 + row1
    p[8] = m[3] + m[1]; p[9] = m[7] + m[5]; p[10] = m[11] + m[9]; p[11] = m[15] + m[13];
    // Top: row3 - row1
    p[12] = m[3] - m[1]; p[13] = m[7] - m[5]; p[14] = m[11] - m[9]; p[15] = m[15] - m[13];
    // Near: row3 + row2
    p[16] = m[3] + m[2]; p[17] = m[7] + m[6]; p[18] = m[11] + m[10]; p[19] = m[15] + m[14];
    // Far: row3 - row2
    p[20] = m[3] - m[2]; p[21] = m[7] - m[6]; p[22] = m[11] - m[10]; p[23] = m[15] - m[14];
  }

  _intersectsFrustum(b) {
    const p = this._planes;
    for (let i = 0; i < 24; i += 4) {
      const a = p[i];
      const bp = p[i + 1];
      const c = p[i + 2];
      const d = p[i + 3];
      const px = a >= 0 ? b.maxX : b.minX;
      const py = bp >= 0 ? b.maxY : b.minY;
      const pz = c >= 0 ? b.maxZ : b.minZ;
      if (a * px + bp * py + c * pz + d < 0) return false;
    }
    return true;
  }

  _isOccluded(b, m) {
    const W = this.width;
    const H = this.height;
    const depth = this.depthBuffer;

    let minNdcX = Infinity;
    let maxNdcX = -Infinity;
    let minNdcY = Infinity;
    let maxNdcY = -Infinity;
    let minNdcZ = Infinity;

    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
    const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
    const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
    const m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];

    for (let ix = 0; ix < 2; ix++) {
      const x = ix === 0 ? b.minX : b.maxX;
      for (let iy = 0; iy < 2; iy++) {
        const y = iy === 0 ? b.minY : b.maxY;
        for (let iz = 0; iz < 2; iz++) {
          const z = iz === 0 ? b.minZ : b.maxZ;
          const cw = m3 * x + m7 * y + m11 * z + m15;
          // Conservative: never occlusion-cull boxes crossing the near plane
          if (cw <= NEAR_W_THRESHOLD) return false;
          const invW = 1 / cw;
          const nx = (m0 * x + m4 * y + m8 * z + m12) * invW;
          const ny = (m1 * x + m5 * y + m9 * z + m13) * invW;
          const nz = (m2 * x + m6 * y + m10 * z + m14) * invW;
          if (nx < minNdcX) minNdcX = nx;
          if (nx > maxNdcX) maxNdcX = nx;
          if (ny < minNdcY) minNdcY = ny;
          if (ny > maxNdcY) maxNdcY = ny;
          if (nz < minNdcZ) minNdcZ = nz;
        }
      }
    }

    const x0 = Math.max(0, Math.floor((minNdcX * 0.5 + 0.5) * W));
    const x1 = Math.min(W - 1, Math.ceil((maxNdcX * 0.5 + 0.5) * W) - 1);
    const y0 = Math.max(0, Math.floor((minNdcY * 0.5 + 0.5) * H));
    const y1 = Math.min(H - 1, Math.ceil((maxNdcY * 0.5 + 0.5) * H) - 1);

    if (x0 > x1 || y0 > y1) return false;

    const testZ = minNdcZ - DEPTH_EPS;
    for (let py = y0; py <= y1; py++) {
      const rowOffset = py * W;
      for (let px = x0; px <= x1; px++) {
        if (testZ <= depth[rowOffset + px]) {
          return false; // At least one pixel is visible
        }
      }
    }

    return true;
  }

  _rasterizeWallQuad(
    x0, y0, z0,
    x1, y1, z1,
    x2, y2, z2,
    x3, y3, z3,
    m
  ) {
    const W = this.width;
    const H = this.height;
    const sx = this._quadSX;
    const sy = this._quadSY;
    const qz = this._quadZ;

    const xs = [x0, x1, x2, x3];
    const ys = [y0, y1, y2, y3];
    const zs = [z0, z1, z2, z3];

    let minPX = Infinity;
    let maxPX = -Infinity;
    let minPY = Infinity;
    let maxPY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < 4; i++) {
      const x = xs[i];
      const y = ys[i];
      const z = zs[i];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= NEAR_W_THRESHOLD) return; // Conservative: skip near-clipped wall
      const invW = 1 / cw;
      const px = ((m[0] * x + m[4] * y + m[8] * z + m[12]) * invW * 0.5 + 0.5) * W;
      const py = ((m[1] * x + m[5] * y + m[9] * z + m[13]) * invW * 0.5 + 0.5) * H;
      const nz = (m[2] * x + m[6] * y + m[10] * z + m[14]) * invW;
      sx[i] = px;
      sy[i] = py;
      qz[i] = nz;
      if (px < minPX) minPX = px;
      if (px > maxPX) maxPX = px;
      if (py < minPY) minPY = py;
      if (py > maxPY) maxPY = py;
      if (nz > maxZ) maxZ = nz;
    }

    const bx0 = Math.max(0, Math.floor(minPX));
    const bx1 = Math.min(W - 1, Math.floor(maxPX));
    const by0 = Math.max(0, Math.floor(minPY));
    const by1 = Math.min(H - 1, Math.floor(maxPY));
    if (bx0 > bx1 || by0 > by1) return;

    // Determine quad winding so edge functions are positive inside the convex quad
    const area2 = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sy[1] - sy[0]) * (sx[2] - sx[0]);
    if (Math.abs(area2) < 1e-4) return;
    const sign = area2 > 0 ? 1 : -1;

    const e0x = sx[1] - sx[0], e0y = sy[1] - sy[0];
    const e1x = sx[2] - sx[1], e1y = sy[2] - sy[1];
    const e2x = sx[3] - sx[2], e2y = sy[3] - sy[2];
    const e3x = sx[0] - sx[3], e3y = sy[0] - sy[3];

    const depth = this.depthBuffer;

    // Conservative inner rasterization: a pixel cell is written only when ALL 4 of its
    // corners lie inside the opaque wall quad, using the wall's farthest depth (maxZ).
    for (let py = by0; py <= by1; py++) {
      const rowOffset = py * W;
      const py1 = py + 1;
      for (let px = bx0; px <= bx1; px++) {
        const px1 = px + 1;
        // Edge 0
        if (sign * (e0x * (py - sy[0]) - e0y * (px - sx[0])) < 0) continue;
        if (sign * (e0x * (py - sy[0]) - e0y * (px1 - sx[0])) < 0) continue;
        if (sign * (e0x * (py1 - sy[0]) - e0y * (px - sx[0])) < 0) continue;
        if (sign * (e0x * (py1 - sy[0]) - e0y * (px1 - sx[0])) < 0) continue;
        // Edge 1
        if (sign * (e1x * (py - sy[1]) - e1y * (px - sx[1])) < 0) continue;
        if (sign * (e1x * (py - sy[1]) - e1y * (px1 - sx[1])) < 0) continue;
        if (sign * (e1x * (py1 - sy[1]) - e1y * (px - sx[1])) < 0) continue;
        if (sign * (e1x * (py1 - sy[1]) - e1y * (px1 - sx[1])) < 0) continue;
        // Edge 2
        if (sign * (e2x * (py - sy[2]) - e2y * (px - sx[2])) < 0) continue;
        if (sign * (e2x * (py - sy[2]) - e2y * (px1 - sx[2])) < 0) continue;
        if (sign * (e2x * (py1 - sy[2]) - e2y * (px - sx[2])) < 0) continue;
        if (sign * (e2x * (py1 - sy[2]) - e2y * (px1 - sx[2])) < 0) continue;
        // Edge 3
        if (sign * (e3x * (py - sy[3]) - e3y * (px - sx[3])) < 0) continue;
        if (sign * (e3x * (py - sy[3]) - e3y * (px1 - sx[3])) < 0) continue;
        if (sign * (e3x * (py1 - sy[3]) - e3y * (px - sx[3])) < 0) continue;
        if (sign * (e3x * (py1 - sy[3]) - e3y * (px1 - sx[3])) < 0) continue;

        const idx = rowOffset + px;
        if (maxZ < depth[idx]) {
          depth[idx] = maxZ;
        }
      }
    }
  }

  _rasterizeBuilding(b, camX, camZ, m) {
    // Rasterize up to 2 vertical faces facing the camera
    if (camX < b.minX) {
      this._rasterizeWallQuad(
        b.minX, b.minY, b.minZ,
        b.minX, b.minY, b.maxZ,
        b.minX, b.maxY, b.maxZ,
        b.minX, b.maxY, b.minZ,
        m
      );
    } else if (camX > b.maxX) {
      this._rasterizeWallQuad(
        b.maxX, b.minY, b.maxZ,
        b.maxX, b.minY, b.minZ,
        b.maxX, b.maxY, b.minZ,
        b.maxX, b.maxY, b.maxZ,
        m
      );
    }

    if (camZ < b.minZ) {
      this._rasterizeWallQuad(
        b.maxX, b.minY, b.minZ,
        b.minX, b.minY, b.minZ,
        b.minX, b.maxY, b.minZ,
        b.maxX, b.maxY, b.minZ,
        m
      );
    } else if (camZ > b.maxZ) {
      this._rasterizeWallQuad(
        b.minX, b.minY, b.maxZ,
        b.maxX, b.minY, b.maxZ,
        b.maxX, b.maxY, b.maxZ,
        b.minX, b.maxY, b.maxZ,
        m
      );
    }
  }

  /**
   * Evaluates frustum + occlusion visibility for all buildings.
   * @param {Float32Array | number[]} projScreenMatrixElements - 16-element column-major VP matrix
   * @param {{ x: number, y: number, z: number }} cameraPos - Camera world position
   * @param {{ occlusionEnabled?: boolean }} [options]
   */
  cull(projScreenMatrixElements, cameraPos, { occlusionEnabled = true } = {}) {
    const startMs = performance.now();
    const buildings = this.buildings;
    const states = this.states;
    const candidates = this._frustumCandidates;
    const distSqArr = this._candidateDistSq;

    this._extractFrustumPlanes(projScreenMatrixElements);

    let candidateCount = 0;
    let frustumCulled = 0;

    // Stage 1: View Frustum Culling
    for (let i = 0; i < this.count; i++) {
      const b = buildings[i];
      if (!this._intersectsFrustum(b)) {
        states[i] = CULL_FRUSTUM;
        frustumCulled++;
        continue;
      }

      const dx = Math.max(b.minX - cameraPos.x, 0, cameraPos.x - b.maxX);
      const dy = Math.max(b.minY - cameraPos.y, 0, cameraPos.y - b.maxY);
      const dz = Math.max(b.minZ - cameraPos.z, 0, cameraPos.z - b.maxZ);
      candidates[candidateCount] = i;
      distSqArr[i] = dx * dx + dy * dy + dz * dz;
      candidateCount++;
    }

    // Insertion sort candidates front-to-back (fast on <= 160 nearly-sorted items, zero allocations)
    for (let i = 1; i < candidateCount; i++) {
      const idx = candidates[i];
      const key = distSqArr[idx];
      let j = i - 1;
      while (j >= 0 && distSqArr[candidates[j]] > key) {
        candidates[j + 1] = candidates[j];
        j--;
      }
      candidates[j + 1] = idx;
    }

    // Stage 2: Front-to-Back Software Depth-Buffer Occlusion Culling
    let visibleCount = 0;
    let occlusionCulled = 0;

    if (occlusionEnabled) {
      this.depthBuffer.fill(1.0);
    }

    for (let i = 0; i < candidateCount; i++) {
      const idx = candidates[i];
      const b = buildings[idx];

      if (occlusionEnabled && this._isOccluded(b, projScreenMatrixElements)) {
        states[idx] = CULL_OCCLUDED;
        occlusionCulled++;
        continue;
      }

      states[idx] = CULL_VISIBLE;
      this.visibleIndices[visibleCount++] = idx;

      if (occlusionEnabled) {
        this._rasterizeBuilding(b, cameraPos.x, cameraPos.z, projScreenMatrixElements);
      }
    }

    const cullMs = performance.now() - startMs;

    return {
      total: this.count,
      visibleCount,
      frustumCulled,
      occlusionCulled,
      cullMs,
      visibleIndices: this.visibleIndices,
      states,
    };
  }
}
