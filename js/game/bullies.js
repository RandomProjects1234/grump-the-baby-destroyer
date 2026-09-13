// The Big Boys Club.
//
// Once a run, on day 2 or 3 (before Grump stops asking questions), three big
// kids from the top year corner you in a hallway. They push you over. Then
// they start on Grump, who has wandered up behind you -- and Grump, for the
// first and only time, is on your side. He grows. He puts all three of them
// on the floor. They run. He turns round and looks at you like you belong
// to him now.
//
// A cutscene: your camera is taken over and you cannot move until it ends.
// Like the card boy it is local -- every player gets their own -- so the
// Grump in it is a stand-in and the real one is hidden from you while it
// plays. When it ends the real Grump is a little fonder of you.
import { makeBigKid, makeGrump, setGrumpStage, animateWalk } from '../render/models.js';
import { clamp, lerp, approachAngle, makeRng, hashStr } from '../util/util.js';
import { GRUMP_TURNS_ON_DAY } from './threats.js';

const LENGTH = 29;
const EYE = 0.6;

// [time, text] -- the subtitles, in order.
const SCRIPT = [
  [1.2, 'Three big kids from the top year block the hall. Their jackets say BIG BOYS CLUB.'],
  [3.8, 'Leader: "Well, well. Look. The baby nobody came to pick up."'],
  [6.6, 'Big kid: "Aww. Is it gonna cry? Go on. Cry, baby."'],
  [8.9, 'Big kid: "Ew, it\'s Grump. Hey Grump! Still eating the crayons?"'],
  [11.6, 'Leader: "Get lost, freak. This is Big Boys Club business."'],
  [13.8, 'Grump: "Why you being mean?"'],
  [15.8, 'The big kids stop laughing.'],
  [17.1, 'Grump hits the first one so hard his shoe comes off.'],
  [18.1, 'The second one goes into the lockers.'],
  [19.1, 'The leader tries to run. He does not get far.'],
  [20.9, 'Big kids: "RUN! RUN!"'],
  [22.6, 'Leader: "We\'re telling Mrs. Honeywell!"'],
  [24.4, 'Grump: "Nobody is mean to the baby. Nobody but Grump."'],
  [27.0, '(Grump stood up for you. He looks very pleased with himself.)']
];

export class Bullies {
  constructor(game) {
    this.game = game;
    this.kids = [0, 1, 2].map(i => {
      const m = makeBigKid(i);
      m.visible = false;
      game.renderer.scene.add(m);
      return { model: m, x: 0, z: 0, yaw: 0, sx: 0, sz: 0, ex: 0, ez: 0, fall: 0, animT: Math.random() * 3, speed: 0, gone: false };
    });
    this.grumpModel = makeGrump();
    this.grumpModel.visible = false;
    game.renderer.scene.add(this.grumpModel);

    this.state = 'off';
    this.t = 0;
    this.done = false;
    const rng = makeRng(hashStr(game.seed + ':bullies'));
    this.day = rng() < 0.5 ? 2 : 3;
    this.checkT = 1;
    this.lineIdx = 0;
  }

  get locksPlayer() { return this.state === 'play'; }
  get active() { return this.state === 'play'; }

  // --------------------------------------------------------------- trigger

  maybeStart(dt) {
    const g = this.game;
    if (this.done || this.state !== 'off') return;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 1;
    if (g.phase !== 'day' || g.grump.turned) return;
    // Day 2 or 3; if the planned day slipped by, the next one before Grump turns.
    if (g.night < this.day || g.night >= GRUMP_TURNS_ON_DAY) return;
    const dayAge = g.diff.day - g.phaseTime;
    if (dayAge < 35 || g.phaseTime < LENGTH + 25) return;
    const p = g.player;
    if (p.dead || p.downed || p.hidden || p.carryingToddler) return;
    if (g.cardKid.active || g.overlayOpen() || g.sfx.isSpeaking) return;
    const room = g.school.roomAt(p.x, p.z);
    if (!room || room === g.school.home) return;
    // Not every second of every eligible moment.
    if (Math.random() > 0.08) return;
    this.start();
  }

  // Test hook / forced start. Returns false if there is no room for it here.
  start() {
    const g = this.game;
    const p = g.player;
    const spot = this.findStage(p.x, p.z);
    if (!spot) return false;
    const { ax, az, bx, bz } = spot;
    this.px = p.x; this.pz = p.z;
    this.ax = ax; this.az = az;            // towards the bullies
    this.bx = bx; this.bz = bz;            // where Grump comes from

    const perpX = az, perpZ = -ax;
    const slots = [[1.55, 0], [2.0, 0.85], [2.0, -0.85]];
    const far = Math.min(5.5, spot.aheadClear - 0.4);
    this.kids.forEach((k, i) => {
      const [f, side] = slots[i];
      k.ex = p.x + ax * f + perpX * side;
      k.ez = p.z + az * f + perpZ * side;
      k.sx = p.x + ax * far + perpX * side * 0.6;
      k.sz = p.z + az * far + perpZ * side * 0.6;
      k.x = k.sx; k.z = k.sz;
      k.yaw = Math.atan2(p.x - k.x, p.z - k.z);
      k.fall = 0; k.gone = false; k.speed = 0;
      k.model.visible = true;
      k.model.rotation.x = 0;
    });

    const stage = g.grump.stage || 0;
    this.grumpStage = stage;
    setGrumpStage(this.grumpModel, stage);
    const gd = Math.min(5, spot.behindClear - 0.4);
    this.gx = p.x + bx * gd; this.gz = p.z + bz * gd;
    this.gyaw = Math.atan2(p.x - this.gx, p.z - this.gz);
    this.grumpModel.visible = true;
    this.grumpAnimT = 0;

    this.camYaw = p.yaw;
    this.camPitch = p.pitch;
    this.pushT = 0;
    this.t = 0;
    this.lineIdx = 0;
    this.hits = [false, false, false];
    this.state = 'play';
    g.player.torchOn = false;
    g.ui.setPrompt(null);
    g.ui.letterbox(true);
    g.ui.bigLine('THE BIG BOYS CLUB');
    g.sfx.stinger();
    return true;
  }

  // Somewhere with a clear run ahead (for the bullies) and behind (for Grump).
  findStage(px, pz) {
    const g = this.game;
    const clearFor = (dx, dz, max) => {
      let d = 0;
      for (let t = 0.5; t <= max; t += 0.25) {
        const x = px + dx * t, z = pz + dz * t;
        if (!g.collider.free(x, z, 0.32) || !g.collider.lineClear(px, pz, x, z)) break;
        d = t;
      }
      return d;
    };
    let best = null;
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < 16; i++) {
      const a = base + i / 16 * Math.PI * 2;
      const ax = Math.sin(a), az = Math.cos(a);
      const ahead = clearFor(ax, az, 6);
      if (ahead < 3) continue;
      // the two flankers need room beside the leader
      const perpX = az, perpZ = -ax;
      let flanks = true;
      for (const s of [0.85, -0.85]) {
        const x = px + ax * 2.0 + perpX * s, z = pz + az * 2.0 + perpZ * s;
        if (!g.collider.free(x, z, 0.3) || !g.collider.lineClear(px + ax * 2.0, pz + az * 2.0, x, z)) flanks = false;
      }
      if (!flanks) continue;
      for (const off of [Math.PI, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 0.5, Math.PI * 1.5]) {
        const bx = Math.sin(a + off), bz = Math.cos(a + off);
        const behind = clearFor(bx, bz, 5.5);
        if (behind < 2.5) continue;
        const scoreV = ahead + behind;
        if (!best || scoreV > best.score) best = { ax, az, bx, bz, aheadClear: ahead, behindClear: behind, score: scoreV };
        break;
      }
    }
    return best;
  }

  // --------------------------------------------------------------- playback

  update(dt) {
    if (this.state !== 'play') return;
    const g = this.game;
    const p = g.player;
    // If something drags you out of it (a menu, death, the day ending), stop.
    if (p.dead || g.phase !== 'day') { this.finish(false); return; }

    const before = this.t;
    this.t += dt;
    const t = this.t;
    const at = x => before < x && t >= x;

    while (this.lineIdx < SCRIPT.length && t >= SCRIPT[this.lineIdx][0]) {
      g.ui.subtitle(SCRIPT[this.lineIdx][1]);
      g.ui.subT = 4;
      this.lineIdx++;
    }

    // Hold the baby still.
    p.x = this.px; p.z = this.pz;

    // ---- the bullies walk in, laugh, shove
    this.kids.forEach((k, i) => {
      k.animT += dt;
      let speed = 0;
      if (t < 3.2) {
        const f = clamp((t - i * 0.15) / 2.9, 0, 1);
        const nx = lerp(k.sx, k.ex, f), nz = lerp(k.sz, k.ez, f);
        speed = Math.hypot(nx - k.x, nz - k.z) / Math.max(dt, 1e-3);
        k.x = nx; k.z = nz;
        k.yaw = approachAngle(k.yaw, Math.atan2(this.px - k.x, this.pz - k.z), dt * 5);
      }
      if (t >= 3.2 && t < 13.5) {
        // mocking: little bounces, pointing
        const look = t > 8.6 ? Math.atan2(this.gx - k.x, this.gz - k.z) : Math.atan2(this.px - k.x, this.pz - k.z);
        k.yaw = approachAngle(k.yaw, look, dt * 3);
      }
      if (t >= 15.8 && k.fall === 0) {
        k.yaw = approachAngle(k.yaw, Math.atan2(this.gx - k.x, this.gz - k.z), dt * 4);
      }
      k.model.position.set(k.x, 0, k.z);
      k.model.rotation.y = k.yaw + Math.PI;
      animateWalk(k.model, k.animT, speed);
      const parts = k.model.userData.parts;
      // laughing
      if (t > 3.6 && t < 8.6) {
        parts.body.rotation.x = Math.max(0, Math.sin(k.animT * 9 + i)) * 0.12;
        parts.head.rotation.x = -Math.max(0, Math.sin(k.animT * 9 + i)) * 0.15;
        if (i === 1) { parts.arms[1].rotation.x = -1.4; parts.arms[1].rotation.z = -0.1; }
      }
    });
    if (at(4.0)) this.laugh();
    if (at(7.2)) this.laugh();

    // the leader shoves you over
    const leader = this.kids[0];
    if (t >= 7.0 && t < 7.6) {
      const f = Math.sin((t - 7.0) / 0.6 * Math.PI);
      leader.model.userData.parts.arms[0].rotation.x = -1.5 * f;
      leader.model.userData.parts.arms[1].rotation.x = -1.5 * f;
    }
    if (at(7.3)) {
      p.shake = 1.0;
      g.sfx.hurt();
      g.ui.flash('hurt');
      this.pushT = 1;
      // knocked back a little, if there is room
      const nx = this.px - this.ax * 0.45, nz = this.pz - this.az * 0.45;
      if (g.collider.free(nx, nz, 0.26)) { this.px = nx; this.pz = nz; }
    }
    if (at(7.8)) g.sfx.babyCry();
    this.pushT = Math.max(0, this.pushT - dt * 0.35);

    // ---- Grump walks up behind you and between you and them
    const gm = this.grumpModel;
    this.grumpAnimT += dt;
    let gSpeed = 0;
    // a little in front and to one side, so you can see him and them
    const standX = this.px + this.ax * 1.05 + this.az * 0.45, standZ = this.pz + this.az * 1.05 - this.ax * 0.45;
    if (t >= 8.4 && t < 11.2) {
      // round the side of you, not through you
      const f = clamp((t - 8.4) / 2.8, 0, 1);
      const sideX = this.az * 0.7, sideZ = -this.ax * 0.7;
      const mx = lerp(this.gx, standX, f) + sideX * Math.sin(f * Math.PI);
      const mz = lerp(this.gz, standZ, f) + sideZ * Math.sin(f * Math.PI);
      gSpeed = Math.hypot(mx - this.gx, mz - this.gz) / Math.max(dt, 1e-3);
      if (f < 1) { this.gyaw = Math.atan2(mx - this.gx, mz - this.gz); }
      this.gx = mx; this.gz = mz;
      if (at(8.5)) g.sfx.grumpStep(0.8);
      if (Math.random() < dt * 3) g.sfx.grumpStep(0.6);
    }
    if (t >= 11.2 && t < 16.8) {
      this.gyaw = approachAngle(this.gyaw, Math.atan2(leader.x - this.gx, leader.z - this.gz), dt * 4);
    }
    // the leader shoves Grump
    if (t >= 11.9 && t < 12.5) {
      const f = Math.sin((t - 11.9) / 0.6 * Math.PI);
      leader.model.userData.parts.arms[0].rotation.x = -1.5 * f;
      leader.model.userData.parts.arms[1].rotation.x = -1.5 * f;
    }
    if (at(12.2)) {
      this.gx -= this.ax * 0.3; this.gz -= this.az * 0.3;
      g.sfx.noise(0.12, 0.2, 500, 0.8);
    }
    // he stops, and says it
    if (at(13.8)) {
      g.sfx.voice('mean', 1, 0.92);
      g.sfx.setDrone(0.5);
    }
    // he grows
    if (t >= 15.4 && t < 16.6) {
      const f = clamp((t - 15.4) / 1.2, 0, 1);
      setGrumpStage(gm, Math.round(lerp(this.grumpStage, Math.max(3, this.grumpStage), f)));
      gm.userData.parts.head.rotation.z = Math.sin(t * 50) * 0.08 * (1 - f);
    }
    if (at(15.5)) { g.sfx.grumpReveal(); g.ui.flash('grump'); p.shake = 0.8; }

    // ---- three hits
    [17.0, 18.0, 19.0].forEach((ht, i) => {
      const k = this.kids[i];
      if (t >= ht - 0.35 && t < ht) {
        // lunge at them
        const f = clamp((t - (ht - 0.35)) / 0.35, 0, 1);
        const tx = k.x - Math.sin(this.gyaw) * 0.55, tz = k.z - Math.cos(this.gyaw) * 0.55;
        this.gx = lerp(this.gx, tx, f * 0.6);
        this.gz = lerp(this.gz, tz, f * 0.6);
        this.gyaw = approachAngle(this.gyaw, Math.atan2(k.x - this.gx, k.z - this.gz), dt * 12);
        gSpeed = 5;
      }
      if (t >= ht - 0.1 && t < ht + 0.3) {
        const f = Math.sin(clamp((t - (ht - 0.1)) / 0.4, 0, 1) * Math.PI);
        gm.userData.parts.arms[i % 2].rotation.x = -2.2 * f;
      }
      if (at(ht)) this.hit(k, i);
      // flying back
      if (k.fall > 0 && k.fall < 1) {
        k.fall = Math.min(1, k.fall + dt * 2.6);
        const step = dt * 6 * (1 - k.fall);
        const nx = k.x + k.kx * step, nz = k.z + k.kz * step;
        if (g.collider.free(nx, nz, 0.25)) { k.x = nx; k.z = nz; }
        k.model.rotation.x = -1.45 * k.fall;
        k.model.position.set(k.x, 0.12 * Math.sin(k.fall * Math.PI), k.z);
      } else if (k.fall >= 1 && t < 20.6) {
        k.model.rotation.x = -1.45;
        k.model.position.set(k.x, 0.02, k.z);
      }
    });

    // ---- they scramble up and run
    if (t >= 20.6) {
      this.kids.forEach((k, i) => {
        if (k.gone) return;
        if (t < 21.2) {
          k.model.rotation.x = -1.45 * (1 - (t - 20.6) / 0.6);
          return;
        }
        k.model.rotation.x = 0;
        // away from Grump
        const away = Math.atan2(k.x - this.gx, k.z - this.gz);
        k.yaw = approachAngle(k.yaw, away, dt * 8);
        const sp = 5.2 + i * 0.4;
        const nx = k.x + Math.sin(k.yaw) * sp * dt, nz = k.z + Math.cos(k.yaw) * sp * dt;
        const moved = g.collider.free(nx, nz, 0.25);
        if (moved) { k.x = nx; k.z = nz; } else k.yaw += dt * 3;
        k.animT += dt;
        k.model.position.set(k.x, 0, k.z);
        k.model.rotation.y = k.yaw + Math.PI;
        animateWalk(k.model, k.animT, sp);
        if (t > 24.5 || Math.hypot(k.x - this.px, k.z - this.pz) > 11) { k.gone = true; k.model.visible = false; }
      });
    }
    if (at(20.9)) { g.sfx.tone(700, 0.25, 'square', 0.08, 300); g.sfx.tone(820, 0.25, 'square', 0.07, 280, 0.12); }

    // ---- Grump shrinks back, turns, comes close
    if (t >= 21.6 && t < 22.8) {
      const f = clamp((t - 21.6) / 1.2, 0, 1);
      setGrumpStage(gm, Math.round(lerp(Math.max(3, this.grumpStage), this.grumpStage, f)));
      g.sfx.setDrone(0.5 * (1 - f));
    }
    if (t >= 22.4) {
      this.gyaw = approachAngle(this.gyaw, Math.atan2(this.px - this.gx, this.pz - this.gz), dt * 3);
      const tx = this.px + this.ax * 1.2, tz = this.pz + this.az * 1.2;
      if (t < 24.2) {
        const nx = lerp(this.gx, tx, dt * 2), nz = lerp(this.gz, tz, dt * 2);
        gSpeed = Math.hypot(nx - this.gx, nz - this.gz) / Math.max(dt, 1e-3);
        this.gx = nx; this.gz = nz;
      }
    }
    if (at(24.4)) g.sfx.grumpGiggle();
    if (t >= 24.6 && t < 27.5) {
      // he pats you on the head
      const pat = Math.max(0, Math.sin((t - 24.6) * 7));
      gm.userData.parts.arms[1].rotation.x = -1.9 + pat * 0.35;
      gm.userData.parts.head.rotation.z = Math.sin(t * 2) * 0.12;
    }

    gm.position.set(this.gx, 0, this.gz);
    gm.rotation.y = this.gyaw + Math.PI;
    if (t < 15.4 || t > 22.8) animateWalk(gm, this.grumpAnimT, gSpeed, { armsBusy: t > 24.6 || (t > 16.6 && t < 19.4) });

    // ---- camera
    let fx, fy, fz;
    if (t < 8.4) {
      fx = leader.x; fz = leader.z; fy = 1.25 - this.pushT * 0.5;
    } else if (t < 11.4) {
      fx = this.gx; fz = this.gz; fy = 0.55;
    } else if (t < 16.8) {
      // Grump and the leader
      fx = lerp(this.gx, leader.x, 0.4); fz = lerp(this.gz, leader.z, 0.4); fy = t > 15.4 ? 1.1 : 0.9;
    } else if (t < 20.6) {
      const k = this.kids[clamp(Math.floor(t - 16.6), 0, 2)];
      fx = lerp(this.gx, k.x, 0.5); fz = lerp(this.gz, k.z, 0.5); fy = 0.6;
    } else if (t < 22.6) {
      const k = this.kids[0];
      fx = k.x; fz = k.z; fy = 0.8;
    } else {
      fx = this.gx; fz = this.gz; fy = 0.7;
    }
    const wantYaw = Math.atan2(-(fx - this.px), -(fz - this.pz));
    const flat = Math.max(0.4, Math.hypot(fx - this.px, fz - this.pz));
    const wantPitch = clamp(Math.atan2(fy - EYE, flat), -0.9, 0.9);
    const rate = t > 8.4 && t < 9.4 ? 5 : 3.2;
    this.camYaw = approachAngle(this.camYaw, wantYaw, dt * rate);
    this.camPitch = lerp(this.camPitch, wantPitch, Math.min(1, dt * rate));
    p.yaw = this.camYaw;
    p.pitch = this.camPitch;

    if (t >= LENGTH) this.finish(true);
  }

  laugh() {
    const s = this.game.sfx;
    for (let i = 0; i < 3; i++) {
      const b = 190 + i * 35;
      for (let j = 0; j < 3; j++) s.tone(b + j * 10, 0.08, 'square', 0.05, -30, i * 0.07 + j * 0.13);
    }
  }

  hit(k, i) {
    const g = this.game;
    const p = g.player;
    const dx = k.x - this.gx, dz = k.z - this.gz;
    const l = Math.hypot(dx, dz) || 1;
    k.kx = dx / l; k.kz = dz / l;
    k.fall = 0.01;
    p.shake = 1.2;
    g.ui.flash('hurt');
    g.sfx.noise(0.25, 0.4, 260, 0.6, 'lowpass');
    g.sfx.tone(70, 0.3, 'square', 0.25, -30);
    if (i === 1) g.sfx.noise(0.35, 0.3, 1800, 1.4, 'bandpass', 0.12);   // lockers
    if (i === 0) g.sfx.voice('kidScream', 0.9, 0.72);
    else g.sfx.tone(900 - i * 120, 0.4, 'sawtooth', 0.09, -500, 0.05);
  }

  finish(completed) {
    const g = this.game;
    this.state = 'off';
    this.done = true;
    for (const k of this.kids) k.model.visible = false;
    this.grumpModel.visible = false;
    g.ui.letterbox(false);
    g.sfx.setDrone(0);
    if (!completed) return;
    g.player.x = this.px; g.player.z = this.pz;
    g.player.shake = 0;
    g.ui.toast('Grump likes you a bit more now. For now.');
    // The real Grump remembers.
    if (g.isHost) {
      if (!g.grump.turned) g.grump.anger(-20, g, 'bullies');
      if (g.collider.free(this.gx, this.gz, 0.4)) g.grump.place(this.gx, this.gz);
    } else {
      g.net.send({ t: 'act', k: 'bullied' });
    }
    g.score += 50;
  }

  // Runs after grump.present(): the real Grump is not in this scene.
  hideRealGrump() {
    if (this.state === 'play') this.game.grump.model.visible = false;
  }

  dispose() {
    const g = this.game;
    if (this.state === 'play') g.ui.letterbox(false);
    for (const k of this.kids) g.renderer.scene.remove(k.model);
    g.renderer.scene.remove(this.grumpModel);
  }
}
