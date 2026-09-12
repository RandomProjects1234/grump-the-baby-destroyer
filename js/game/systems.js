// The generator, the mess-cleaning chores, dropped items and portable lights.
import * as THREE from 'three';
import { makeItem } from '../render/models.js';
import { clamp, dist2, makeRng } from '../util/util.js';

// ---------------------------------------------------------------- generator

export class Generator {
  constructor(game, prop) {
    this.game = game;
    this.prop = prop;
    this.x = prop.x; this.z = prop.z;
    this.fuel = 62;
    this.condition = 74;
    this.running = false;
    this.sputterT = 12;
    this.startFails = 0;
  }

  get canStart() { return this.fuel > 1 && this.condition > 12; }

  // Burn is deliberately transparent, and additive rather than multiplicative so
  // the numbers stay legible: a tidy school on a healthy machine with only the
  // rooms you need switched on lasts roughly two and a half nights. Neglect it
  // on every axis at once and a full tank barely covers one.
  //
  //   base                     0.20/s   -> 100% fuel = 8m20s
  //   + wear                 <=0.12/s
  //   + each mess left        0.012/s
  //   + each lit room over 4  0.008/s
  //   all of it scaled by how deep into the week you are.
  burnRate(game) {
    const wear = 1 - clamp(this.condition / 100, 0, 1);
    const messes = game.messes ? game.messes.remaining : 0;
    const litRooms = game.school.rooms.filter(r =>
      !r.outdoor && r.type !== 'hall' && r.lightsOn !== false).length;
    const raw = 0.20
      + 0.12 * wear
      + 0.012 * messes
      + 0.008 * Math.max(0, litRooms - 4);
    return raw * (1 + (game.night - 1) * 0.10);
  }

  start(game) {
    if (this.running) return false;
    if (!this.canStart) {
      game.sfx.genFail();
      game.ui.toast(this.fuel <= 1 ? 'No fuel in it.' : 'Too broken to turn over.');
      return false;
    }
    // A knackered generator does not catch first pull.
    const chance = clamp(0.35 + this.condition / 140, 0.35, 0.98);
    if (Math.random() > chance && this.startFails < 3) {
      this.startFails++;
      game.sfx.genFail();
      game.emitNoise(this.x, this.z, 0.7, 'generator');
      game.ui.toast('It coughs and dies. Pull again.');
      return false;
    }
    this.startFails = 0;
    this.running = true;
    game.sfx.genStart();
    game.sfx.setGenerator(true, this.condition / 100);
    game.emitNoise(this.x, this.z, 1.0, 'generator');
    game.onPowerChanged(true);
    if (game.cardKid) game.cardKid.maybeTrigger();
    return true;
  }

  stop(game, quiet) {
    if (!this.running) return;
    this.running = false;
    game.sfx.setGenerator(false, 0);
    if (!quiet) { game.sfx.blackout(); game.ui.flash('blackout'); }
    game.onPowerChanged(false);
  }

  refuel(game, amount = 38) {
    const before = this.fuel;
    this.fuel = clamp(this.fuel + amount, 0, 100);
    game.sfx.pour();
    game.player.stats.fuelPoured++;
    game.score += 30;
    game.ui.toast(`Fuel ${Math.round(before)}% → ${Math.round(this.fuel)}%`);
    if (game.cardKid) game.cardKid.maybeTrigger();
  }

  repair(game, amount = 26) {
    const before = this.condition;
    this.condition = clamp(this.condition + amount, 0, 100);
    game.sfx.wrench();
    game.player.stats.repairs++;
    game.score += 25;
    game.ui.toast(`Condition ${Math.round(before)}% → ${Math.round(this.condition)}%`);
    if (game.cardKid) game.cardKid.maybeTrigger();
  }

  update(dt, game) {
    if (!this.running) return;
    this.fuel = clamp(this.fuel - this.burnRate(game) * dt, 0, 100);
    this.condition = clamp(this.condition - dt * 0.35, 0, 100);
    game.sfx.setGenerator(true, this.condition / 100);
    const d = dist2(game.player.x, game.player.z, this.x, this.z);
    game.sfx.setGeneratorProximity(clamp(1 - d / 26, 0, 1));

    if (this.fuel <= 0) {
      game.ui.bigLine('THE LIGHTS GO OUT');
      this.stop(game);
      return;
    }
    // A neglected machine stalls on its own.
    if (this.condition < 42) {
      this.sputterT -= dt * (1 + (42 - this.condition) / 30);
      if (this.sputterT <= 0) {
        this.sputterT = 22 + Math.random() * 26;
        game.sfx.genFail();
        game.ui.bigLine('THE GENERATOR STALLS');
        this.stop(game);
      }
    }
    // Warnings you can act on.
    const secondsLeft = this.fuel / this.burnRate(game);
    if (secondsLeft < 30 && !this._warned) {
      this._warned = true;
      game.ui.toast('The generator is running dry.');
      game.sfx.genFail();
    }
    if (secondsLeft > 45) this._warned = false;
  }

  serialize() { return { f: +this.fuel.toFixed(1), c: +this.condition.toFixed(1), r: this.running ? 1 : 0 }; }
}

// ---------------------------------------------------------------- messes

const MESS_KINDS = [
  { kind: 'spill', label: 'spilled paint', color: 0x8a3aa8, time: 2.6 },
  { kind: 'trash', label: 'a heap of rubbish', color: 0x6a6a4a, time: 2.2 },
  { kind: 'blocks', label: 'scattered blocks', color: 0xd8a13a, time: 2.0 },
  { kind: 'glass', label: 'broken glass', color: 0x9fc4d8, time: 3.0 }
];

export class Messes {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.renderer.scene.add(this.group);
  }

  get remaining() { return this.list.filter(m => !m.done).length; }

  clear() {
    for (const m of this.list) this.group.remove(m.mesh);
    this.list = [];
  }

  spawnForDay(night, seed) {
    this.clear();
    const rng = makeRng((seed ^ (night * 3313)) >>> 0);
    const s = this.game.school;
    const rooms = s.rooms.filter(r => !r.outdoor);
    const count = clamp(3 + night, 3, 10);
    for (let i = 0; i < count; i++) {
      const r = rooms[Math.floor(rng() * rooms.length)];
      const def = MESS_KINDS[Math.floor(rng() * MESS_KINDS.length)];
      const x = r.cx + (rng() - 0.5) * (r.w - 1) * s.CELL;
      const z = r.cz + (rng() - 0.5) * (r.h - 1) * s.CELL;
      this.add(x, z, def, rng);
    }
  }

  add(x, z, def, rng = Math.random) {
    const g = new THREE.Group();
    const mat = new THREE.MeshPhongMaterial({ color: def.color, shininess: def.kind === 'spill' ? 60 : 4 });
    const blobs = def.kind === 'spill' ? 5 : 7;
    for (let i = 0; i < blobs; i++) {
      const r = 0.18 + rng() * 0.3;
      const geo = def.kind === 'spill'
        ? new THREE.CircleGeometry(r, 8)
        : new THREE.BoxGeometry(r * 0.7, r * 0.5, r * 0.7);
      const m = new THREE.Mesh(geo, mat);
      if (def.kind === 'spill') { m.rotation.x = -Math.PI / 2; m.position.y = 0.012 + i * 0.001; }
      else { m.position.y = r * 0.25; m.rotation.y = rng() * 6.28; }
      m.position.x = (rng() - 0.5) * 1.1;
      m.position.z = (rng() - 0.5) * 1.1;
      g.add(m);
    }
    g.position.set(x, 0, z);
    this.group.add(g);
    const mess = { id: this.list.length, x, z, kind: def.kind, label: def.label, time: def.time, mesh: g, done: false };
    this.list.push(mess);
    return mess;
  }

  nearest(x, z, maxD = 2.0) {
    let best = null, bd = maxD;
    for (const m of this.list) {
      if (m.done) continue;
      const d = dist2(x, z, m.x, m.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  clean(m, game) {
    if (m.done) return;
    m.done = true;
    this.group.remove(m.mesh);
    game.sfx.clean();
    game.player.stats.cleaned++;
    game.score += 35;
    // Tidying is the one thing that reliably takes the edge off him.
    game.grump.anger(-1.5, game, 'tidy');
    game.ui.toast(`Cleaned up ${m.label}. (${this.remaining} left)`);
  }

  applySnapshot(rows) {
    for (const r of rows) {
      const m = this.list[r];
      if (m && !m.done) { m.done = true; this.group.remove(m.mesh); }
    }
  }
  serialize() { return this.list.filter(m => m.done).map(m => m.id); }
}

// ---------------------------------------------------------------- ground items

export class GroundItems {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextId = 1;
    this.group = new THREE.Group();
    game.renderer.scene.add(this.group);
  }

  spawn(kind, x, z, id) {
    const model = makeItem(kind);
    model.position.set(x, 0.05, z);
    this.group.add(model);
    const it = { id: id || this.nextId++, kind, x, z, model, t: Math.random() * 6 };
    this.list.push(it);
    return it;
  }

  remove(it) {
    this.group.remove(it.model);
    const i = this.list.indexOf(it);
    if (i >= 0) this.list.splice(i, 1);
  }

  clearAll() {
    for (const it of this.list) this.group.remove(it.model);
    this.list = [];
  }

  nearest(x, z, maxD = 1.8) {
    let best = null, bd = maxD;
    for (const it of this.list) {
      const d = dist2(x, z, it.x, it.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  update(dt) {
    for (const it of this.list) {
      it.t += dt;
      it.model.rotation.y = it.t * 0.9;
      it.model.position.y = 0.05 + Math.sin(it.t * 2) * 0.03;
    }
  }

  serialize() { return this.list.map(i => ({ i: i.id, k: i.kind, x: +i.x.toFixed(2), z: +i.z.toFixed(2) })); }

  applySnapshot(rows) {
    const seen = new Set(rows.map(r => r.i));
    for (const it of this.list.slice()) if (!seen.has(it.id)) this.remove(it);
    const have = new Set(this.list.map(i => i.id));
    for (const r of rows) if (!have.has(r.i)) this.spawn(r.k, r.x, r.z, r.i);
  }
}

// ---------------------------------------------------------------- portable light

// Night lights and glow sticks are the player's own private grid: small,
// battery-limited pools of safety that work when the generator does not.
export class PortableLights {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.renderer.scene.add(this.group);
  }

  place(kind, x, z) {
    const model = makeItem(kind === 'glow' ? 'glowstick' : 'nightlight');
    model.position.set(x, 0.02, z);
    this.group.add(model);
    const life = kind === 'glow' ? 150 : 999;
    const l = {
      kind, x, z, model, life,
      fixture: { id: -1, room: -1, x, z, y: kind === 'glow' ? 0.2 : 0.35, on: true, broken: false, flicker: 0, portable: true, radius: kind === 'glow' ? 4.2 : 5.5, power: kind === 'glow' ? 0.55 : 0.8 }
    };
    this.list.push(l);
    this.game.school.fixtures.push(l.fixture);
    return l;
  }

  update(dt) {
    for (const l of this.list.slice()) {
      l.life -= dt;
      if (l.kind === 'glow' && l.life < 20) l.fixture.flicker = 1;
      if (l.life <= 0) {
        this.group.remove(l.model);
        const fi = this.game.school.fixtures.indexOf(l.fixture);
        if (fi >= 0) this.game.school.fixtures.splice(fi, 1);
        this.list.splice(this.list.indexOf(l), 1);
      }
    }
  }

  clearAll() {
    for (const l of this.list) {
      this.group.remove(l.model);
      const fi = this.game.school.fixtures.indexOf(l.fixture);
      if (fi >= 0) this.game.school.fixtures.splice(fi, 1);
    }
    this.list = [];
  }
}
