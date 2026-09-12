// Axis-aligned collision against a static box soup, bucketed into a grid so
// each step only tests the handful of boxes actually nearby.

const BUCKET = 4.8;

export class Collider {
  constructor() {
    this.boxes = [];
    this.grid = new Map();
    this.dynamic = [];        // doors: boxes that come and go
  }

  key(gx, gz) { return gx + ',' + gz; }

  add(box) {
    const i = this.boxes.length;
    this.boxes.push(box);
    const x0 = Math.floor((box.x - box.hw) / BUCKET), x1 = Math.floor((box.x + box.hw) / BUCKET);
    const z0 = Math.floor((box.z - box.hd) / BUCKET), z1 = Math.floor((box.z + box.hd) / BUCKET);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const k = this.key(gx, gz);
        let list = this.grid.get(k);
        if (!list) { list = []; this.grid.set(k, list); }
        list.push(i);
      }
    }
    return i;
  }

  addDynamic(box) { this.dynamic.push(box); return box; }

  // Every box that could overlap a circle of radius r at (x, z).
  near(x, z, r, out) {
    out.length = 0;
    const x0 = Math.floor((x - r) / BUCKET), x1 = Math.floor((x + r) / BUCKET);
    const z0 = Math.floor((z - r) / BUCKET), z1 = Math.floor((z + r) / BUCKET);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const list = this.grid.get(this.key(gx, gz));
        if (!list) continue;
        for (const i of list) {
          const b = this.boxes[i];
          if (out.indexOf(b) < 0) out.push(b);
        }
      }
    }
    for (const b of this.dynamic) {
      if (!b.active) continue;
      if (Math.abs(b.x - x) < b.hw + r + 0.1 && Math.abs(b.z - z) < b.hd + r + 0.1) out.push(b);
    }
    return out;
  }

  // Slide along one axis at a time -- cheap, and never lets you tunnel a wall.
  move(x, z, r, dx, dz) {
    const scratch = [];
    let nx = x + dx;
    this.near(nx, z, r, scratch);
    for (const b of scratch) {
      if (Math.abs(nx - b.x) < b.hw + r && Math.abs(z - b.z) < b.hd + r) {
        nx = dx > 0 ? b.x - b.hw - r - 0.001 : b.x + b.hw + r + 0.001;
      }
    }
    let nz = z + dz;
    this.near(nx, nz, r, scratch);
    for (const b of scratch) {
      if (Math.abs(nx - b.x) < b.hw + r && Math.abs(nz - b.z) < b.hd + r) {
        nz = dz > 0 ? b.z - b.hd - r - 0.001 : b.z + b.hd + r + 0.001;
      }
    }
    return [nx, nz];
  }

  // Static-only version, used to work out which cells the AI may stand in.
  // Doors are deliberately excluded: a closed door is still a route.
  freeStatic(x, z, r) {
    const x0 = Math.floor((x - r) / BUCKET), x1 = Math.floor((x + r) / BUCKET);
    const z0 = Math.floor((z - r) / BUCKET), z1 = Math.floor((z + r) / BUCKET);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const list = this.grid.get(this.key(gx, gz));
        if (!list) continue;
        for (const i of list) {
          const b = this.boxes[i];
          if (Math.abs(x - b.x) < b.hw + r && Math.abs(z - b.z) < b.hd + r) return false;
        }
      }
    }
    return true;
  }

  // Is this spot free? Used when placing things and when spawning AI.
  free(x, z, r) {
    const scratch = [];
    this.near(x, z, r, scratch);
    for (const b of scratch) {
      if (Math.abs(x - b.x) < b.hw + r && Math.abs(z - b.z) < b.hd + r) return false;
    }
    return true;
  }

  // Straight-line visibility, stepped. Good enough for "can Bob see you".
  lineClear(x0, z0, x1, z1, step = 0.4) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return true;
    const n = Math.ceil(len / step);
    const scratch = [];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const px = x0 + dx * t, pz = z0 + dz * t;
      this.near(px, pz, 0.05, scratch);
      for (const b of scratch) {
        if (b.seeThrough) continue;
        if (Math.abs(px - b.x) < b.hw && Math.abs(pz - b.z) < b.hd) return false;
      }
    }
    return true;
  }
}

// Build the collider for a generated school. Props shorter than head height
// still block movement but do not block sight, so you can be seen crouching
// behind a desk unless you are actually hidden in something.
export function buildCollider(school) {
  const c = new Collider();
  for (const w of school.collision) c.add({ x: w.x, z: w.z, hw: w.hw, hd: w.hd });
  for (const p of school.props) {
    if (!p.solid) continue;
    const cos = Math.abs(Math.cos(p.rot)), sin = Math.abs(Math.sin(p.rot));
    const hw = p.hw * cos + p.hd * sin;
    const hd = p.hw * sin + p.hd * cos;
    c.add({ x: p.x, z: p.z, hw: hw * 0.94, hd: hd * 0.94, seeThrough: !p.tall, prop: p });
  }
  for (const d of school.doors) {
    const along = d.dir === 'w' ? 'z' : 'x';
    const hw = along === 'x' ? 1.05 : 0.14;
    const hd = along === 'x' ? 0.14 : 1.05;
    d.box = c.addDynamic({ x: d.x, z: d.z, hw, hd, active: !d.open, door: d });
  }
  return c;
}

// Work out which cells an AI can stand in by actually testing the geometry.
// Furniture pushed flat against a wall leaves the middle of its cell free, so
// asking the collider is far more accurate than guessing from footprints.
export function computeNavBlocking(school, collider) {
  const { W, H, blocked, cells } = school;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (cells[i] < 0) { blocked[i] = 1; continue; }
      blocked[i] = collider.freeStatic(school.cwx(x), school.cwz(y), 0.36) ? 0 : 1;
    }
  }
  // A doorway must never be sealed, or the room behind it drops off the graph.
  for (const d of school.doors) {
    blocked[d.gy * W + d.gx] = 0;
    if (d.dir === 'w' && d.gx > 0) blocked[d.gy * W + d.gx - 1] = 0;
    if (d.dir === 'n' && d.gy > 0) blocked[(d.gy - 1) * W + d.gx] = 0;
  }
  return blocked;
}

// Label every connected island of standable cells.
function cellComponents(school) {
  const { W, H, cells, blocked } = school;
  const comp = new Int32Array(W * H).fill(-1);
  const sizes = [];
  for (let i = 0; i < W * H; i++) {
    if (cells[i] < 0 || blocked[i] || comp[i] >= 0) continue;
    const id = sizes.length;
    const q = [i];
    comp[i] = id;
    let size = 0;
    while (q.length) {
      const c = q.pop();
      size++;
      const cx = c % W, cy = (c / W) | 0;
      const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (const [nx, ny] of nb) {
        if (!school.passable(cx, cy, nx, ny)) continue;
        const ni = ny * W + nx;
        if (comp[ni] >= 0) continue;
        comp[ni] = id;
        q.push(ni);
      }
    }
    sizes.push(size);
  }
  return { comp, sizes };
}

// Furniture is placed at random, so on some seeds it walls a corner of a room
// off from that room's own door. Rather than thinning the furniture everywhere
// -- which would make every room look sparse to fix a rare case -- find the
// specific pieces that are sealing a pocket and take those out.
//
// Runs before the geometry is built, so removed props never get drawn.
// Returns true if anything was removed.
export function repairConnectivity(school) {
  const { W, H, blocked, cells } = school;
  const propAt = new Map();
  for (const p of school.props) {
    if (!p.solid) continue;
    const gx = Math.floor((p.x - school.OX) / school.CELL);
    const gy = Math.floor((p.z - school.OZ) / school.CELL);
    const k = gy * W + gx;
    if (!propAt.has(k)) propAt.set(k, []);
    propAt.get(k).push(p);
  }

  const doomed = new Set();
  for (let pass = 0; pass < 8; pass++) {
    const { comp, sizes } = cellComponents(school);
    if (sizes.length <= 1) break;
    let main = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;

    // A blocked cell touching both the main island and a stranded one is a
    // doorway waiting to happen.
    const bridges = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (cells[i] < 0 || !blocked[i]) continue;
        const touch = new Set();
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (!school.wallOpen(x, y, nx, ny)) continue;
          const c = comp[ny * W + nx];
          if (c >= 0) touch.add(c);
        }
        if (touch.size > 1 && touch.has(main)) bridges.push(i);
      }
    }
    // Nothing furniture-shaped left to clear: the rest is walls, and every room
    // is guaranteed a door, so stop rather than spin.
    if (!bridges.length) break;

    for (const i of bridges) {
      blocked[i] = 0;
      for (const p of (propAt.get(i) || [])) doomed.add(p);
    }
  }

  if (!doomed.size) return false;
  school.props = school.props.filter(p => !doomed.has(p));
  return true;
}
