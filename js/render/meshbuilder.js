// Accumulates quads into one merged BufferGeometry per material, so the whole
// school draws in a handful of calls instead of a few thousand.
import * as THREE from 'three';

export class MeshBuilder {
  constructor() { this.groups = new Map(); }

  group(mat) {
    let g = this.groups.get(mat);
    if (!g) { g = { pos: [], norm: [], uv: [] }; this.groups.set(mat, g); }
    return g;
  }

  // Corners given counter-clockwise as seen from the visible side.
  // uScale/vScale are metres per texture tile along the p1->p2 and p1->p4 edges.
  quad(mat, p1, p2, p3, p4, uScale = 2.4, vScale = 2.4, uOff = 0, vOff = 0) {
    const g = this.group(mat);
    const ax = p2[0] - p1[0], ay = p2[1] - p1[1], az = p2[2] - p1[2];
    const bx = p4[0] - p1[0], by = p4[1] - p1[1], bz = p4[2] - p1[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    const uLen = Math.hypot(ax, ay, az) / uScale;
    const vLen = Math.hypot(bx, by, bz) / vScale;
    const u0 = uOff, v0 = vOff, u1 = uOff + uLen, v1 = vOff + vLen;

    const push = (p, u, v) => {
      g.pos.push(p[0], p[1], p[2]);
      g.norm.push(nx, ny, nz);
      g.uv.push(u, v);
    };
    push(p1, u0, v0); push(p2, u1, v0); push(p3, u1, v1);
    push(p1, u0, v0); push(p3, u1, v1); push(p4, u0, v1);
  }

  // Axis-aligned floor/ceiling quad. `up` false makes it face downward.
  slab(mat, x0, z0, x1, z1, y, up = true, uScale = 2.4) {
    if (up) this.quad(mat, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], uScale, uScale);
    else this.quad(mat, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], uScale, uScale);
  }

  // A vertical panel along X (dir 'x') or Z (dir 'z'), facing +/- the other axis.
  panel(mat, dir, fixed, a0, a1, y0, y1, facing, uScale = 2.4, vScale = 2.4) {
    if (dir === 'x') {
      // spans X from a0..a1 at z = fixed
      if (facing > 0) this.quad(mat, [a0, y0, fixed], [a1, y0, fixed], [a1, y1, fixed], [a0, y1, fixed], uScale, vScale);
      else this.quad(mat, [a1, y0, fixed], [a0, y0, fixed], [a0, y1, fixed], [a1, y1, fixed], uScale, vScale);
    } else {
      // spans Z from a0..a1 at x = fixed
      if (facing > 0) this.quad(mat, [fixed, y0, a1], [fixed, y0, a0], [fixed, y1, a0], [fixed, y1, a1], uScale, vScale);
      else this.quad(mat, [fixed, y0, a0], [fixed, y0, a1], [fixed, y1, a1], [fixed, y1, a0], uScale, vScale);
    }
  }

  // Box centred at (cx,cy,cz), optionally spun about Y.
  box(mat, cx, cy, cz, hw, hh, hd, rot = 0, uScale = 2.4) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pt = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const A = pt(-hw, -hh, -hd), B = pt(hw, -hh, -hd), C = pt(hw, hh, -hd), D = pt(-hw, hh, -hd);
    const E = pt(-hw, -hh, hd), F = pt(hw, -hh, hd), G = pt(hw, hh, hd), H = pt(-hw, hh, hd);
    const w = hw * 2, h = hh * 2, d = hd * 2;
    this.quad(mat, E, F, G, H, uScale, uScale);          // +Z
    this.quad(mat, B, A, D, C, uScale, uScale);          // -Z
    this.quad(mat, F, B, C, G, uScale, uScale);          // +X
    this.quad(mat, A, E, H, D, uScale, uScale);          // -X
    this.quad(mat, D, H, G, C, uScale, uScale);          // top
    this.quad(mat, A, B, F, E, uScale, uScale);          // bottom
    void w; void h; void d;
  }

  // Cheap n-sided prism, used for pipes, poles, tree trunks and drums.
  cylinder(mat, cx, cy, cz, r, h, sides = 8, capTop = true) {
    const step = Math.PI * 2 / sides;
    for (let i = 0; i < sides; i++) {
      const a0 = i * step, a1 = (i + 1) * step;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      this.quad(mat, [x0, cy, z0], [x1, cy, z1], [x1, cy + h, z1], [x0, cy + h, z0], r * 1.6, r * 1.6);
      if (capTop) {
        this.quad(mat, [cx, cy + h, cz], [x0, cy + h, z0], [x1, cy + h, z1], [cx, cy + h, cz], r * 2, r * 2);
      }
    }
  }

  isEmpty() { return this.groups.size === 0; }

  // Turn everything accumulated into meshes. `materialFor` maps a key to a
  // THREE.Material.
  build(materialFor) {
    const meshes = [];
    for (const [key, g] of this.groups) {
      if (!g.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.norm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, materialFor(key));
      m.matrixAutoUpdate = false;
      m.name = 'merged:' + key;
      meshes.push(m);
    }
    return meshes;
  }
}
