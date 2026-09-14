// Pathfinding and steering for everything that walks on its own.
//
// Nav: A* over the school's cell grid, eight directions. Diagonal steps are
// only allowed when both of the straight steps around the corner are open,
// so nobody cuts through the corner of a wall or squeezes diagonally through
// a doorway. An optional cost function lets each walker have its own idea of
// the map -- Bob treats a lit room as a wall.
//
// Walker: follows a path. Instead of visiting every cell centre it looks
// ahead and heads straight for the furthest waypoint it can actually walk to
// (checked against the real furniture and closed doors), which turns grid
// staircases into straight lines. When something is in the way it slides
// around it, and when it is properly stuck it throws the path away and
// thinks again; if that fails too it frees itself.
import { clamp } from '../util/util.js?v=2026-09-13f';

const SQRT2 = Math.SQRT2;

export class Nav {
  constructor(school, collider = null) {
    this.s = school;
    this.collider = collider;
    // 0 = not worked out yet, 1 = clear, 2 = furniture in the way
    this.edgeCache = new Map();
    const n = school.W * school.H;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.tick = 0;
    this.lastCells = 0;
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

  // Is the straight line between two cell centres clear of furniture? A table
  // straddling the edge between two cells leaves both centres standable but
  // the step between them impossible. Static geometry only, cached.
  edgeClear(x0, y0, x1, y1) {
    if (!this.collider) return true;
    const s = this.s;
    const a = y0 * s.W + x0, b = y1 * s.W + x1;
    const key = a < b ? a * 4096 + b : b * 4096 + a;
    let v = this.edgeCache.get(key);
    if (v === undefined) {
      const ax = s.cwx(x0), az = s.cwz(y0), bx = s.cwx(x1), bz = s.cwz(y1);
      v = 1;
      for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        if (!this.collider.freeStatic(ax + (bx - ax) * t, az + (bz - az) * t, 0.3)) { v = 2; break; }
      }
      this.edgeCache.set(key, v);
    }
    return v === 1;
  }

  // A straight step between neighbouring cells that is not a doorway.
  openNoDoor(x0, y0, x1, y1) {
    const s = this.s;
    return s.passable(x0, y0, x1, y1) && !s.doorBetween(x0, y0, x1, y1);
  }

  // Returns world-space waypoints, or null when there is no route.
  // opts.cost(gx, gy) -> extra cost for entering that cell, Infinity to forbid.
  // The start cell is never forbidden (you can always leave where you are).
  path(sx, sz, tx, tz, opts = null) {
    const s = this.s;
    const a = this.snap(...s.cellOf(sx, sz));
    const b = this.snap(...s.cellOf(tx, tz));
    if (!a || !b) return null;
    const [ax, ay] = a, [bx, by] = b;
    const W = s.W;
    const start = ay * W + ax, goal = by * W + bx;
    if (start === goal) return [[tx, tz]];
    const cost = opts && opts.cost;
    if (cost && cost(bx, by) === Infinity) return null;

    this.tick++;
    const { g, f, came, stamp, closed, tick } = this;
    // octile distance
    const h = (x, y) => {
      const dx = Math.abs(x - bx), dy = Math.abs(y - by);
      return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
    };

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

    let expanded = 0;
    // Lazy decrease-key: stale heap entries are skipped via the closed set.
    while (heap.length) {
      const cur = pop();
      if (closed[cur] === tick) continue;
      closed[cur] = tick;
      expanded++;
      if (cur === goal) break;
      const cx = cur % W, cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          let step;
          if (dx && dy) {
            // both L-shaped routes round the corner must be open, no doorways
            if (!this.openNoDoor(cx, cy, nx, cy) || !this.openNoDoor(nx, cy, nx, ny) ||
                !this.openNoDoor(cx, cy, cx, ny) || !this.openNoDoor(cx, ny, nx, ny)) continue;
            if (!this.edgeClear(cx, cy, nx, ny)) continue;
            step = SQRT2;
          } else {
            if (!s.passable(cx, cy, nx, ny)) continue;
            // doorways cost a little extra so patrols prefer open corridors
            step = 1 + (s.doorBetween(cx, cy, nx, ny) ? 0.6 : 0);
            // squeezing past furniture: possible, but only if there is no
            // better way round
            if (!this.edgeClear(cx, cy, nx, ny)) step += 8;
          }
          const ni = ny * W + nx;
          if (closed[ni] === tick) continue;
          if (cost) {
            const c = cost(nx, ny);
            if (c === Infinity) continue;
            step += c;
          }
          const ng = g[cur] + step;
          if (stamp[ni] === tick && ng >= g[ni]) continue;
          stamp[ni] = tick; g[ni] = ng; came[ni] = cur; f[ni] = ng + h(nx, ny);
          push(ni);
        }
      }
    }
    this.lastCells = expanded;
    if (stamp[goal] !== tick || closed[goal] !== tick) return null;

    const cells = [];
    let n = goal;
    while (n !== -1 && n !== start) { cells.push(n); n = came[n]; }
    cells.reverse();
    const pts = cells.map(i => [s.cwx(i % W), s.cwz((i / W) | 0)]);
    if (pts.length) pts[pts.length - 1] = [tx, tz];
    return pts;
  }

  // Route length in metres (Infinity when there is none). Handy for "how far
  // away does this noise really sound".
  distance(sx, sz, tx, tz, opts) {
    const p = this.path(sx, sz, tx, tz, opts);
    if (!p) return Infinity;
    let d = 0, px = sx, pz = sz;
    for (const [x, z] of p) { d += Math.hypot(x - px, z - pz); px = x; pz = z; }
    return d;
  }
}

// Follows a path with look-ahead smoothing and simple obstacle sliding.
export class Walker {
  constructor(school, nav, collider, radius = 0.34) {
    this.s = school; this.nav = nav; this.collider = collider; this.r = radius;
    this.path = null;
    this.idx = 0;
    this.repathIn = 0;
    this.goal = null;
    this.heading = 0;
    this.stuck = 0;
    this.stuckLong = 0;
    this.smoothIn = 0;
    this.failed = false;
    this.cost = null;          // optional (gx, gy) -> extra cost / Infinity
    this.side = null;          // [dx, dz, timeLeft] while stepping round something
    this.sideSign = 1;
    this.blockedT = 0;
  }

  setGoal(x, z, force) {
    if (!force && this.goal && Math.hypot(this.goal[0] - x, this.goal[1] - z) < 1.2) {
      // same place, near enough: just nudge the end of the path
      this.goal[0] = x; this.goal[1] = z;
      if (this.path && this.path.length) this.path[this.path.length - 1] = [x, z];
      return;
    }
    this.goal = [x, z];
    this.repathIn = 0;
    this.failed = false;
  }

  clear() { this.path = null; this.goal = null; this.idx = 0; this.failed = false; }

  get arrived() { return !this.path || this.idx >= this.path.length; }

  // Can a body of our radius walk straight from (x0, z0) to (x1, z1)?
  // Furniture and closed doors both count.
  walkable(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / 0.3));
    const r = this.r * 0.9;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.collider.free(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r)) return false;
    }
    return true;
  }

  // Returns the distance actually moved this frame.
  step(agent, dt, speed, onDoor) {
    if (!this.goal) return 0;
    this.repathIn -= dt;
    if (this.repathIn <= 0 || !this.path) {
      this.repathIn = 0.55 + Math.random() * 0.3;
      const p = this.nav.path(agent.x, agent.z, this.goal[0], this.goal[1], this.cost ? { cost: this.cost } : null);
      if (p) { this.path = p; this.idx = 0; this.failed = false; this.smoothIn = 0; }
      else {
        this.failed = true;
        if (!this.path) return 0;
      }
    }
    if (this.arrived || speed <= 0) return 0;

    // Drop waypoints we are already standing on.
    let [wx, wz] = this.path[this.idx];
    let d = Math.hypot(wx - agent.x, wz - agent.z);
    while (d < 0.5 && this.idx < this.path.length - 1) {
      this.idx++;
      [wx, wz] = this.path[this.idx];
      d = Math.hypot(wx - agent.x, wz - agent.z);
    }
    if (d < 0.3 && this.idx >= this.path.length - 1) { this.idx = this.path.length; return 0; }

    // Look ahead: aim for the furthest waypoint we can walk straight to.
    this.smoothIn -= dt;
    if (this.smoothIn <= 0) {
      this.smoothIn = 0.15;
      const last = Math.min(this.path.length - 1, this.idx + 6);
      for (let k = last; k > this.idx; k--) {
        const [kx, kz] = this.path[k];
        if (this.walkable(agent.x, agent.z, kx, kz)) { this.idx = k; break; }
      }
      [wx, wz] = this.path[this.idx];
      d = Math.hypot(wx - agent.x, wz - agent.z);
    }

    const dirX = (wx - agent.x) / (d || 1), dirZ = (wz - agent.z) / (d || 1);

    // Open whatever door is just ahead.
    if (onDoor) {
      const [cx, cy] = this.s.cellOf(agent.x, agent.z);
      for (const ahead of [0.5, 1.0]) {
        const [nx, ny] = this.s.cellOf(agent.x + dirX * ahead, agent.z + dirZ * ahead);
        if (cx === nx && cy === ny) continue;
        // a diagonal glance can span two cell edges: check both
        const cands = [[nx, ny], [nx, cy], [cx, ny]];
        for (const [ex, ey] of cands) {
          if (Math.abs(ex - cx) + Math.abs(ey - cy) !== 1) continue;
          const door = this.s.doorBetween(cx, cy, ex, ey);
          if (door) onDoor(door);
        }
      }
    }

    const mv = Math.min(speed * dt, d + 0.05);

    // Stepping round something: keep going sideways for a moment.
    if (this.side) {
      this.side[2] -= dt;
      const [sx, sz] = this.collider.move(agent.x, agent.z, this.r, this.side[0] * mv, this.side[1] * mv);
      const sm = Math.hypot(sx - agent.x, sz - agent.z);
      if (this.side[2] <= 0 || sm < mv * 0.2) { this.side = null; this.smoothIn = 0; }
      else {
        this.heading = Math.atan2(sx - agent.x, sz - agent.z);
        agent.x = sx; agent.z = sz;
        return sm;
      }
    }

    let best = this.tryMove(agent, dirX, dirZ, mv);
    // Blocked? Slide: try turning a little either way, keep whatever makes
    // the most progress toward the waypoint.
    if (best.progress < mv * 0.35) {
      for (const turn of [0.6, -0.6, 1.2, -1.2]) {
        const c = Math.cos(turn), sn = Math.sin(turn);
        const tx = dirX * c - dirZ * sn, tz = dirX * sn + dirZ * c;
        const tryIt = this.tryMove(agent, tx, tz, mv);
        if (tryIt.progress > best.progress + 0.002) best = tryIt;
        if (best.progress > mv * 0.6) break;
      }
    }
    const moved = Math.hypot(best.x - agent.x, best.z - agent.z);
    if (moved > 0.0005) this.heading = Math.atan2(best.x - agent.x, best.z - agent.z);
    else this.heading = Math.atan2(dirX, dirZ);
    agent.x = best.x; agent.z = best.z;

    // Flat against something: pick the open side and step round it.
    if (best.progress < mv * 0.1) {
      this.blockedT += dt;
      if (this.blockedT > 0.2) {
        this.blockedT = 0;
        const px = -dirZ, pz = dirX;             // perpendicular
        const open = sgn => this.collider.free(agent.x + px * sgn * 0.7, agent.z + pz * sgn * 0.7, this.r * 0.9) &&
          this.collider.free(agent.x + (px * sgn * 0.7 + dirX * 0.5), agent.z + (pz * sgn * 0.7 + dirZ * 0.5), this.r * 0.9);
        let sgn = this.sideSign;
        if (!open(sgn) && open(-sgn)) sgn = -sgn;
        this.sideSign = -sgn;                    // next time, try the other way first
        this.side = [px * sgn, pz * sgn, 0.45];
      }
    } else this.blockedT = 0;

    // Stuck: think again; stuck for ages: get free.
    if (best.progress < mv * 0.25) {
      this.stuck += dt;
      this.stuckLong += dt;
      if (this.stuck > 0.6) { this.stuck = 0; this.path = null; this.repathIn = 0; }
      if (this.stuckLong > 2.5) {
        this.stuckLong = 0;
        const spot = this.collider.nearestFree ? this.collider.nearestFree(agent.x, agent.z, this.r, 1.8) : null;
        if (spot) { agent.x = spot[0]; agent.z = spot[1]; }
      }
    } else { this.stuck = 0; this.stuckLong = Math.max(0, this.stuckLong - dt * 2); }

    return moved;
  }

  // Move along (dx, dz) by mv; report where we would end up and how much
  // closer that gets us along the intended direction.
  tryMove(agent, dx, dz, mv) {
    const [px, pz] = this.collider.move(agent.x, agent.z, this.r, dx * mv, dz * mv);
    const wx = this.path[this.idx][0], wz = this.path[this.idx][1];
    const before = Math.hypot(wx - agent.x, wz - agent.z);
    const after = Math.hypot(wx - px, wz - pz);
    return { x: px, z: pz, progress: before - after };
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
