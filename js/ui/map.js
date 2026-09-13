// The school map: a small north-up minimap in the corner, and a full map on M.
//
// The walls and rooms never change, so they are drawn once per school into an
// offscreen canvas. Everything that moves -- you, your friends, the little
// ones, the food, the jobs on the list -- is drawn on top every few frames.
//
// Bob never appears on the map. Grump only does in daylight, before day 4,
// while he is still pretending to be your friend.
import { ITEMS } from '../game/items.js';

const B = 16;                    // base image pixels per grid cell

const ROOM_FILL = {
  hall: '#3b4337', home: '#2c5566', boiler: '#5a4228', yard: '#2f4d2a', gym: '#3a3a30',
  cafeteria: '#3c3a2e', kitchen: '#343a36', storage: '#3a342c', lostfound: '#3a3244',
  staff: '#40302c', nurse: '#2f3f40', library: '#3a3326', art: '#3d3040', music: '#2f3548',
  bathroom: '#2e3a3c', classroom: '#2e342b'
};

const SHORT = {
  home: 'YOUR CLASSROOM', boiler: 'BOILER', yard: 'PLAYGROUND', gym: 'GYM', cafeteria: 'CAFETERIA',
  kitchen: 'KITCHEN', storage: 'STORAGE', lostfound: 'LOST & FOUND', staff: 'STAFF (locked)',
  nurse: 'NURSE', library: 'LIBRARY', art: 'ART', music: 'MUSIC', bathroom: 'TOILETS'
};

export class MapView {
  constructor(game) {
    this.game = game;
    this.mini = document.querySelector('#minimap');
    this.big = document.querySelector('#bigmap');
    this.bigCanvas = document.querySelector('#bigmapc');
    this.open = false;
    this.t = 0;
    this.pulse = 0;
    this.base = null;
    this.school = null;
  }

  toggle(on) {
    this.open = on === undefined ? !this.open : on;
    this.big.classList.toggle('hidden', !this.open);
    if (this.open) this.drawBig();
  }

  // ---------------------------------------------------------------- static layer

  buildBase(school) {
    this.school = school;
    const c = document.createElement('canvas');
    c.width = school.W * B;
    c.height = school.H * B;
    const g = c.getContext('2d');

    for (const r of school.rooms) {
      g.fillStyle = ROOM_FILL[r.type] || ROOM_FILL.classroom;
      g.fillRect(r.x0 * B, r.y0 * B, r.w * B, r.h * B);
    }

    // walls
    g.strokeStyle = '#b8b09c';
    g.lineWidth = 2.5;
    g.lineCap = 'square';
    g.beginPath();
    for (const w of school.wallFaces) {
      if (w.dir === 'w') { g.moveTo(w.gx * B, w.gy * B); g.lineTo(w.gx * B, (w.gy + 1) * B); }
      else { g.moveTo(w.gx * B, w.gy * B); g.lineTo((w.gx + 1) * B, w.gy * B); }
    }
    g.stroke();

    // fence
    g.strokeStyle = '#7d8a72';
    g.lineWidth = 1.5;
    g.setLineDash([3, 3]);
    g.beginPath();
    for (const f of school.fences) {
      g.moveTo((f.x1 - school.OX) / school.CELL * B, (f.z1 - school.OZ) / school.CELL * B);
      g.lineTo((f.x2 - school.OX) / school.CELL * B, (f.z2 - school.OZ) / school.CELL * B);
    }
    g.stroke();
    g.setLineDash([]);

    this.base = c;
  }

  // world -> base-image pixels
  px(x) { return (x - this.school.OX) / this.school.CELL * B; }
  pz(z) { return (z - this.school.OZ) / this.school.CELL * B; }

  // ---------------------------------------------------------------- per-frame

  update(dt) {
    if (!this.base || this.school !== this.game.school) return;
    this.t -= dt;
    this.pulse += dt;
    if (this.t > 0) return;
    this.t = 0.1;
    this.drawMini();
    if (this.open) this.drawBig();
  }

  // Things that appear on both maps, drawn in base-image pixel space. `s` is
  // how many screen pixels one base pixel becomes, so markers keep a constant
  // on-screen size whatever the zoom.
  drawDynamic(g, s, labels) {
    const game = this.game, school = this.school;
    const inv = 1 / s;

    // lit rooms
    if (game.generator && game.generator.running) {
      g.fillStyle = 'rgba(255, 220, 120, 0.13)';
      for (const r of school.rooms) {
        if (r.outdoor || r.type === 'hall' || r.lightsOn === false) continue;
        g.fillRect(r.x0 * B, r.y0 * B, r.w * B, r.h * B);
      }
    }

    // rooms that today's list wants you to go to
    const wanted = new Set();
    if (game.quests) for (const q of game.quests.list) if (!q.done && q.spec.p) wanted.add(q.spec.p);
    const glow = 0.45 + Math.sin(this.pulse * 4) * 0.35;
    g.strokeStyle = `rgba(229, 168, 58, ${glow})`;
    g.lineWidth = 3 * inv;
    for (const r of school.rooms) {
      if (!wanted.has(r.type)) continue;
      g.strokeRect(r.x0 * B + 2 * inv, r.y0 * B + 2 * inv, r.w * B - 4 * inv, r.h * B - 4 * inv);
    }

    // room names
    if (labels) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const r of school.rooms) {
        const name = SHORT[r.type] || (r.type === 'classroom' ? r.name.toUpperCase() : null);
        if (!name) continue;
        // Shrink the name until it fits inside its own room.
        const weight = r.type === 'home' ? 700 : 600;
        let size = 12 * inv;
        const room = r.w * B - 8 * inv;
        g.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
        const w = g.measureText(name).width;
        if (w > room) { size *= room / w; g.font = `${weight} ${size}px Inter, system-ui, sans-serif`; }
        g.fillStyle = r.type === 'home' ? '#9fd8f0' : wanted.has(r.type) ? '#f0c060' : 'rgba(239, 233, 220, 0.55)';
        g.fillText(name, (r.x0 + r.w / 2) * B, (r.y0 + r.h / 2) * B - 10 * inv);
      }
    }

    // locked doors and the way out (a double door, so label it once)
    let exitLabelled = false;
    for (const d of school.doors) {
      const x = this.px(d.x), z = this.pz(d.z);
      if (d.exit) {
        g.fillStyle = game.escapeOpen ? '#7ad07a' : '#c4342a';
        this.dot(g, x, z, 5 * inv);
        if (labels && !exitLabelled) {
          exitLabelled = true;
          const pair = school.exitDoors;
          const cx = pair.reduce((a, e) => a + this.px(e.x), 0) / pair.length;
          this.label(g, game.escapeOpen ? 'EXIT (open)' : 'EXIT (chained)', cx, z - 12 * inv, inv, g.fillStyle);
        }
      } else if (d.locked) {
        g.fillStyle = '#c4342a';
        g.fillRect(x - 3 * inv, z - 3 * inv, 6 * inv, 6 * inv);
      }
    }

    // generator + fusebox
    if (game.generator) {
      const x = this.px(game.generator.x), z = this.pz(game.generator.z);
      g.fillStyle = game.generator.running ? '#f0d040' : '#c4342a';
      this.diamond(g, x, z, 7 * inv);
      if (labels) this.label(g, game.generator.running ? `GENERATOR ${Math.round(game.generator.fuel)}%` : 'GENERATOR (off)', x, z + 14 * inv, inv, g.fillStyle);
    }
    if (game.fusebox) {
      g.fillStyle = '#a0c0e0';
      g.fillRect(this.px(game.fusebox.x) - 3 * inv, this.pz(game.fusebox.z) - 3 * inv, 6 * inv, 6 * inv);
    }
    if (game.crib) {
      g.strokeStyle = '#9fd8f0';
      g.lineWidth = 2 * inv;
      g.strokeRect(this.px(game.crib.x) - 5 * inv, this.pz(game.crib.z) - 5 * inv, 10 * inv, 10 * inv);
    }

    // messes
    if (game.messes) {
      g.strokeStyle = '#c07ae0';
      g.lineWidth = 2 * inv;
      for (const m of game.messes.list) {
        if (m.done) continue;
        const x = this.px(m.x), z = this.pz(m.z), r = 3.5 * inv;
        g.beginPath();
        g.moveTo(x - r, z - r); g.lineTo(x + r, z + r);
        g.moveTo(x + r, z - r); g.lineTo(x - r, z + r);
        g.stroke();
      }
    }

    // items worth walking to
    if (game.groundItems) {
      for (const it of game.groundItems.list) {
        const def = ITEMS[it.kind];
        if (!def) continue;
        const x = this.px(it.x), z = this.pz(it.z);
        if (def.quest || it.kind === 'drawing') {
          g.fillStyle = '#f0c060';
          this.star(g, x, z, 6 * inv);
        } else if (def.food || it.kind === 'lunchbox') {
          g.fillStyle = '#7ad07a';
          this.dot(g, x, z, 2.6 * inv);
        } else if (it.kind === 'fuel' || it.kind === 'part' || it.kind === 'wrench') {
          g.fillStyle = it.kind === 'fuel' ? '#e0604a' : '#b8c0c8';
          g.fillRect(x - 2.6 * inv, z - 2.6 * inv, 5.2 * inv, 5.2 * inv);
        }
      }
    }

    // the little ones
    if (game.toddlers) {
      for (const t of game.toddlers.list) {
        if (t.state === 'taken' || t.state === 'carried') continue;
        const x = this.px(t.x), z = this.pz(t.z);
        g.fillStyle = t.state === 'safe' ? '#7ad07a' : '#f09040';
        this.dot(g, x, z, 3.6 * inv);
        if (labels && t.state !== 'safe') this.label(g, t.name, x, z - 10 * inv, inv, '#f09040');
      }
    }

    // Mrs. Honeywell, by her board, for as long as she is there
    if (game.honeywell && game.honeywell.visible) {
      const x = this.px(game.honeywell.x), z = this.pz(game.honeywell.z);
      g.fillStyle = '#e8c060';
      this.dot(g, x, z, 4 * inv);
      if (labels) this.label(g, 'Mrs. Honeywell', x, z + 12 * inv, inv, '#e8c060');
    }

    // Meredith at the counter, and Jerry when he is out of the gym
    if (game.meredith && game.meredith.visible) {
      const x = this.px(game.meredith.x), z = this.pz(game.meredith.z);
      g.fillStyle = '#6ad0b0';
      this.dot(g, x, z, 4 * inv);
      if (labels) this.label(g, 'Meredith (lunch)', x, z + 12 * inv, inv, '#6ad0b0');
    }
    if (game.jerry && game.jerry.visible) {
      const x = this.px(game.jerry.x), z = this.pz(game.jerry.z);
      g.fillStyle = '#ff5a3a';
      this.dot(g, x, z, 4 * inv);
      if (labels) this.label(g, 'Jerry', x, z + 12 * inv, inv, '#ff5a3a');
    }

    // Grump, only while he is still pretending
    if (game.grump && game.phase === 'day' && !game.grump.turned) {
      const x = this.px(game.grump.x), z = this.pz(game.grump.z);
      g.fillStyle = '#6f8f5a';
      this.dot(g, x, z, 4.5 * inv);
      if (labels) this.label(g, 'Grump', x, z - 11 * inv, inv, '#8fb07a');
    }

    // friends
    for (const rp of game.remotePlayers.values()) {
      if (rp.dead) continue;
      const x = this.px(rp.x), z = this.pz(rp.z);
      g.fillStyle = rp.downed ? '#c4342a' : '#5b8fd0';
      this.arrow(g, x, z, rp.yaw, 6 * inv);
      this.label(g, rp.downed ? rp.name + ' (down)' : rp.name, x, z - 11 * inv, inv, g.fillStyle);
    }

    // you
    const p = game.player;
    g.fillStyle = '#ffffff';
    this.arrow(g, this.px(p.x), this.pz(p.z), p.yaw, 8 * inv);
  }

  drawMini() {
    const c = this.mini, g = c.getContext('2d');
    const size = c.width;
    const zoom = 0.5;                                   // screen px per base px
    const p = this.game.player;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(8, 11, 9, 0.85)';
    g.fillRect(0, 0, size, size);
    g.translate(size / 2, size / 2);
    g.scale(zoom, zoom);
    g.translate(-this.px(p.x), -this.pz(p.z));
    g.drawImage(this.base, 0, 0);
    this.drawDynamic(g, zoom, false);
    g.restore();
    g.strokeStyle = 'rgba(160, 175, 145, 0.45)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(239, 233, 220, 0.7)';
    g.font = '600 10px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('N', size / 2, 12);
  }

  drawBig() {
    const c = this.bigCanvas;
    // Some embedded viewers report a 0x0 window while hidden; fall back.
    const vw = window.innerWidth || 1280, vh = window.innerHeight || 720;
    const maxW = Math.min(vw * 0.92, 1100);
    const maxH = vh * 0.8;
    const scale = Math.min(maxW / this.base.width, maxH / this.base.height);
    const w = Math.round(this.base.width * scale), h = Math.round(this.base.height * scale);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.save();
    g.scale(scale, scale);
    g.drawImage(this.base, 0, 0);
    this.drawDynamic(g, scale, true);
    g.restore();
  }

  // ---------------------------------------------------------------- shapes

  dot(g, x, z, r) { g.beginPath(); g.arc(x, z, r, 0, Math.PI * 2); g.fill(); }

  diamond(g, x, z, r) {
    g.beginPath();
    g.moveTo(x, z - r); g.lineTo(x + r, z); g.lineTo(x, z + r); g.lineTo(x - r, z);
    g.closePath(); g.fill();
  }

  star(g, x, z, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      g.lineTo(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }

  // yaw uses the game's convention: forward is (-sin yaw, -cos yaw).
  arrow(g, x, z, yaw, r) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const sx = -fz, sz = fx;
    g.beginPath();
    g.moveTo(x + fx * r, z + fz * r);
    g.lineTo(x - fx * r * 0.6 + sx * r * 0.65, z - fz * r * 0.6 + sz * r * 0.65);
    g.lineTo(x - fx * r * 0.25, z - fz * r * 0.25);
    g.lineTo(x - fx * r * 0.6 - sx * r * 0.65, z - fz * r * 0.6 - sz * r * 0.65);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = r * 0.18;
    g.stroke();
  }

  label(g, text, x, z, inv, color) {
    g.font = `600 ${Math.round(10 * inv)}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3 * inv;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(text, x, z);
    g.fillStyle = color;
    g.fillText(text, x, z);
  }
}
