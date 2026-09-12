// Grid A* over the school's cells, plus a steering helper that walks a path
// and opens doors on the way through.
import { clamp } from '../util/util.js';

export class Nav {
  constructor(school) {
    this.s = school;
    const n = school.W * school.H;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.tick = 0;
  }

  // Nearest standable cell, in case something ends up inside furniture.
  snap(gx, gy) {
    const s = this.s;
    const ok = (x, y) => x >= 0 && y >= 0 && x < s.W && y < s.H &&
      s.cells[y * s.W + x] >= 0 && !s.blocked[y * s.W + x];
    if (ok(gx, gy)) return [gx, gy];
    for (let r = 1; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (ok(gx + dx, gy + dy)) return [gx + dx, gy + dy];
        }
      }
    }
    return null;
  }

  // Returns world-space waypoints, or null when there is no route.
  path(sx, sz, tx, tz) {
    const s = this.s;
    let a = this.snap(...s.cellOf(sx, sz));
    let b = this.snap(...s.cellOf(tx, tz));
    if (!a || !b) return null;
    const [ax, ay] = a, [bx, by] = b;
    const start = ay * s.W + ax, goal = by * s.W + bx;
    if (start === goal) return [[tx, tz]];

    this.tick++;
    const { g, f, came, stamp, closed, tick } = this;
    const h = (x, y) => Math.abs(x - bx) + Math.abs(y - by);

    // Small binary heap over node indices, keyed by f.
    const heap = [start];
    g[start] = 0; f[start] = h(ax, ay); came[start] = -1; stamp[start] = tick;
    const push = v => {
      heap.push(v);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f[heap[p]] <= f[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };

    // The heap holds stale duplicates by design (lazy decrease-key), so every
    // pop has to be checked against the closed set -- re-expanding settled
    // nodes is what made long routes across the building fail.
    while (heap.length) {
      const cur = pop();
      if (closed[cur] === tick) continue;
      closed[cur] = tick;
      if (cur === goal) break;
      const cx = cur % s.W, cy = (cur / s.W) | 0;
      const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (const [nx, ny] of nb) {
        if (!s.passable(cx, cy, nx, ny)) continue;
        const ni = ny * s.W + nx;
        // Doorways cost a little extra so patrols prefer open corridors.
        const step = 1 + (s.doorBetween(cx, cy, nx, ny) ? 0.6 : 0);
        const ng = g[cur] + step;
        if (closed[ni] === tick) continue;
        if (stamp[ni] === tick && ng >= g[ni]) continue;
        stamp[ni] = tick; g[ni] = ng; came[ni] = cur; f[ni] = ng + h(nx, ny);
        push(ni);
      }
    }
    if (stamp[goal] !== tick) return null;

    const cells = [];
    let n = goal;
    while (n !== -1 && n !== start) { cells.push(n); n = came[n]; }
    cells.reverse();
    const pts = cells.map(i => [s.cwx(i % s.W), s.cwz((i / s.W) | 0)]);
    if (pts.length) pts[pts.length - 1] = [tx, tz];
    return pts;
  }
}

// Follows a path with simple seek steering.
export class Walker {
  constructor(school, nav, collider, radius = 0.34) {
    this.s = school; this.nav = nav; this.collider = collider; this.r = radius;
    this.path = null;
    this.idx = 0;
    this.repathIn = 0;
    this.goal = null;
    this.heading = 0;
    this.stuck = 0;
    this.lastX = 0; this.lastZ = 0;
  }

  setGoal(x, z, force) {
    if (!force && this.goal && Math.hypot(this.goal[0] - x, this.goal[1] - z) < 1.2) return;
    this.goal = [x, z];
    this.repathIn = 0;
  }

  clear() { this.path = null; this.goal = null; }

  get arrived() { return !this.path || this.idx >= this.path.length; }

  // Returns the distance actually moved this frame.
  step(agent, dt, speed, onDoor) {
    if (!this.goal) return 0;
    this.repathIn -= dt;
    if (this.repathIn <= 0 || !this.path) {
      this.repathIn = 0.45 + Math.random() * 0.25;
      const p = this.nav.path(agent.x, agent.z, this.goal[0], this.goal[1]);
      if (p) { this.path = p; this.idx = 0; }
      else if (!this.path) return 0;
    }
    if (this.arrived) return 0;

    let [wx, wz] = this.path[this.idx];
    let d = Math.hypot(wx - agent.x, wz - agent.z);
    while (d < 0.5 && this.idx < this.path.length - 1) {
      this.idx++;
      [wx, wz] = this.path[this.idx];
      d = Math.hypot(wx - agent.x, wz - agent.z);
    }
    if (d < 0.35 && this.idx >= this.path.length - 1) { this.idx = this.path.length; return 0; }

    const dirX = (wx - agent.x) / (d || 1), dirZ = (wz - agent.z) / (d || 1);
    this.heading = Math.atan2(dirX, dirZ);

    // Open whatever is in the way.
    if (onDoor) {
      const [cx, cy] = this.s.cellOf(agent.x, agent.z);
      const [nx, ny] = this.s.cellOf(agent.x + dirX * 0.8, agent.z + dirZ * 0.8);
      if (cx !== nx || cy !== ny) {
        const door = this.s.doorBetween(cx, cy, nx, ny);
        if (door) onDoor(door);
      }
    }

    const mv = speed * dt;
    const [px, pz] = this.collider.move(agent.x, agent.z, this.r, dirX * mv, dirZ * mv);
    const moved = Math.hypot(px - agent.x, pz - agent.z);
    agent.x = px; agent.z = pz;

    // If we are wedged, throw the path away and try again next tick.
    if (moved < mv * 0.25) {
      this.stuck += dt;
      if (this.stuck > 0.7) { this.stuck = 0; this.path = null; this.repathIn = 0; }
    } else this.stuck = 0;

    return moved;
  }
}

// Shared helper: can A see B, given the walls and a view cone.
export function canSee(collider, ax, az, ayaw, bx, bz, range, halfAngle) {
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d > range) return 0;
  if (halfAngle < Math.PI) {
    const ang = Math.atan2(dx, dz);
    let diff = Math.abs(((ang - ayaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > halfAngle) return 0;
  }
  if (!collider.lineClear(ax, az, bx, bz)) return 0;
  return clamp(1 - d / range, 0.05, 1);
}
