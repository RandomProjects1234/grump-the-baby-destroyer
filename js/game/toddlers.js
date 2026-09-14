// The other children left behind. Finding them is optional; keeping them is
// what the score is actually made of.
//
// About one in four is hurt. A hurt toddler sits still and whimpers (which
// makes noise), shows a red cross, and cannot be kept safe in your classroom
// until somebody carries them to the nurse's office and puts a plaster on.
import { makeToddler, animateWalk } from '../render/models.js?v=2026-09-13e';
import { clamp, dist2, makeRng } from '../util/util.js?v=2026-09-13e';

const NAMES = ['Pip', 'Moo', 'Bibi', 'Tog', 'Nell', 'Dot', 'Wex', 'Bun', 'Cricket', 'Snib'];

export class Toddlers {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextId = 1;
  }

  clear() {
    for (const t of this.list) this.game.renderer.scene.remove(t.model);
    this.list = [];
  }

  // Scatter a fresh batch each dawn, in rooms away from the safe classroom.
  spawnForDay(night, seed) {
    const rng = makeRng((seed ^ (night * 7717)) >>> 0);
    const s = this.game.school;
    // Never behind the staff room's locked door.
    const rooms = s.rooms.filter(r => !r.outdoor && r.type !== 'hall' && r !== s.home && r.type !== 'boiler' && r.type !== 'staff');
    const count = clamp(2 + Math.floor(night / 2), 2, 5);
    for (let i = 0; i < count; i++) {
      const r = rooms[Math.floor(rng() * rooms.length)];
      let x = r.cx, z = r.cz;
      for (let k = 0; k < 12; k++) {
        const tx = r.cx + (rng() - 0.5) * (r.w - 1.4) * s.CELL;
        const tz = r.cz + (rng() - 0.5) * (r.h - 1.4) * s.CELL;
        if (this.game.collider.free(tx, tz, 0.3)) { x = tx; z = tz; break; }
      }
      const t = this.add(x, z, rng);
      t.injured = rng() < 0.25;
      this.dress(t);
    }
  }

  // Show the red cross / plaster to match their state.
  dress(t) {
    const p = t.model.userData.parts;
    const hurt = t.injured && !t.bandaged;
    if (p.hurt) p.hurt.visible = hurt && t.state !== 'safe';
    if (p.scrape) p.scrape.visible = hurt;
    if (p.bandage) p.bandage.visible = !!(t.injured && t.bandaged);
  }

  get hurt() { return this.list.filter(t => t.injured && !t.bandaged && t.state !== 'taken'); }

  // Plaster on: they can go home now.
  bandage(t) {
    if (!t || !t.injured || t.bandaged) return false;
    t.bandaged = true;
    t.cryT = 30;
    this.dress(t);
    return true;
  }

  add(x, z, rng = Math.random) {
    const idx = this.list.length + this.nextId;
    const t = {
      id: this.nextId++,
      name: NAMES[idx % NAMES.length],
      x, z, yaw: rng() * 6.28,
      state: 'lost',
      injured: false,
      bandaged: false,
      cryT: 4 + rng() * 8,
      wanderT: 0,
      home: null,
      calm: false,          // given a teddy: sleeps through the night
      animT: rng() * 10,
      speed: 0
    };
    t.model = makeToddler(t.id);
    t.model.position.set(x, 0, z);
    this.game.renderer.scene.add(t.model);
    this.list.push(t);
    return t;
  }

  byId(id) { return this.list.find(t => t.id === id) || null; }

  // The ones Grump took are not coming back; stop sending them every snapshot.
  pruneTaken() {
    for (const t of this.list) if (t.state === 'taken') this.game.renderer.scene.remove(t.model);
    this.list = this.list.filter(t => t.state !== 'taken');
  }
  get saved() { return this.list.filter(t => t.state === 'safe').length; }
  get lost() { return this.list.filter(t => t.state === 'lost').length; }

  nearest(x, z, maxD = 2.4, state) {
    let best = null, bd = maxD;
    for (const t of this.list) {
      if (state && t.state !== state) continue;
      const d = dist2(x, z, t.x, t.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  pickUp(t, game) {
    if (t.state === 'carried') return false;
    t.state = 'carried';
    t.model.visible = false;
    game.sfx.babble();
    return true;
  }

  // Dropping one inside the safe classroom counts as rescuing them. `local` is
  // whether the player on this machine did it, which decides who gets thanked.
  place(t, x, z, game, local = true) {
    t.x = x; t.z = z;
    t.putDownAt = game.time;
    t.model.visible = true;
    t.model.position.set(x, 0, z);
    const room = game.school.roomAt(x, z);
    const wasSafe = t.state === 'safe';
    if (room === game.school.home && t.injured && !t.bandaged) {
      // not until they are patched up
      t.state = 'lost';
      if (local) {
        game.sfx.deny();
        game.ui.toast(t.name + ' is hurt. Take them to the nurse\'s office for a plaster first.');
      }
    } else if (room === game.school.home) {
      t.state = 'safe';
      t.home = [x, z];
      if (!wasSafe) {
        if (local) {
          game.sfx.ding();
          game.ui.toast(t.name + ' is safe in the classroom.');
          game.player.stats.saved++;
          game.score += 120;
        }
        if (game.isHost) game.questEvent('saved');
      }
    } else {
      t.state = 'lost';
      if (local) game.sfx.drop();
    }
    this.dress(t);
  }

  calm(t) { t.calm = true; }

  // Grump collects whoever is still out in the building when it gets dark.
  takeOne(game) {
    const outside = this.list.filter(t => t.state === 'lost');
    if (!outside.length) return null;
    const t = outside[(Math.random() * outside.length) | 0];
    t.state = 'taken';
    t.model.visible = false;
    game.score -= 80;
    return t;
  }

  update(dt, game) {
    const player = game.player;
    for (const t of this.list) {
      t.animT += dt;
      if (t.state === 'taken') continue;

      // Only the host simulates them; everyone else draws what they are told.
      if (!game.isHost) {
        if (t.state !== 'carried') {
          t.model.position.set(t.x, 0, t.z);
          t.model.rotation.y = t.yaw + Math.PI;
          animateWalk(t.model, t.animT, 0, { amp: 0.9 });
          this.bob(t);
        }
        continue;
      }
      if (t.state === 'carried') {
        // Ride on the carrier's shoulder.
        const carrier = game.carrierOf(t.id);
        if (carrier) { t.x = carrier.x; t.z = carrier.z; }
        continue;
      }

      const hurt = t.injured && !t.bandaged;
      if (t.state === 'lost') {
        // Wander a little during the day, freeze and whimper at night. A hurt
        // one just sits where they are.
        if (game.phase === 'day' && !hurt) {
          t.wanderT -= dt;
          if (t.wanderT <= 0) {
            t.wanderT = 3 + Math.random() * 5;
            t.tx = t.x + (Math.random() - 0.5) * 4;
            t.tz = t.z + (Math.random() - 0.5) * 4;
          }
          if (t.tx !== undefined) {
            const dx = t.tx - t.x, dz = t.tz - t.z;
            const d = Math.hypot(dx, dz);
            if (d > 0.2) {
              const mv = 0.75 * dt;
              const [nx, nz] = game.collider.move(t.x, t.z, 0.24, dx / d * mv, dz / d * mv);
              t.speed = Math.hypot(nx - t.x, nz - t.z) / dt;
              t.x = nx; t.z = nz;
              t.yaw = Math.atan2(dx, dz);
            } else t.speed = 0;
          }
        } else t.speed = 0;
      } else t.speed = 0;

      // A hurt one whimpers now and then -- and crying is a noise event,
      // which is the real cost of leaving them hurt.
      if (hurt && !t.calm) {
        t.cryT -= dt;
        if (t.cryT <= 0) {
          t.cryT = 12 + Math.random() * 8;
          game.emitNoise(t.x, t.z, 0.6, 'toddler');
          game.fx('cry', t.x, t.z, { name: t.name, hurt: true });
        }
      }

      t.model.position.set(t.x, 0, t.z);
      t.model.rotation.y = t.yaw + Math.PI;
      animateWalk(t.model, t.animT, t.speed, { amp: 0.9 });
      this.bob(t);
    }
  }

  // The cross over a hurt toddler's head bobs so it catches the eye.
  bob(t) {
    const h = t.model.userData.parts.hurt;
    if (h && h.visible) { h.position.y = 1.0 + Math.sin(t.animT * 3) * 0.05; h.rotation.y = t.animT * 1.5; }
  }

  serialize() {
    return this.list.map(t => ({
      i: t.id, x: +t.x.toFixed(2), z: +t.z.toFixed(2), y: +t.yaw.toFixed(2),
      s: t.state, j: t.injured ? (t.bandaged ? 2 : 1) : 0, c: t.calm ? 1 : 0, n: t.name
    }));
  }

  applySnapshot(rows) {
    const seen = new Set();
    for (const r of rows) {
      seen.add(r.i);
      let t = this.byId(r.i);
      if (!t) {
        t = this.add(r.x, r.z);
        t.id = r.i;
        this.nextId = Math.max(this.nextId, r.i + 1);
      }
      t.x = r.x; t.z = r.z; t.yaw = r.y;
      t.state = r.s; t.calm = !!r.c; t.name = r.n;
      t.injured = r.j > 0; t.bandaged = r.j === 2;
      t.model.visible = r.s !== 'carried' && r.s !== 'taken';
      this.dress(t);
    }
    for (const t of this.list.slice()) {
      if (!seen.has(t.id)) {
        this.game.renderer.scene.remove(t.model);
        this.list.splice(this.list.indexOf(t), 1);
      }
    }
  }
}
