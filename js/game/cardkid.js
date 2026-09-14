// The boy with the cards.
//
// He turns up while you are working on the generator, tells you about his
// collection, and does not need you to say anything -- which is fortunate,
// because you are a baby and you cannot. Then something takes him.
//
// The thing that takes him never touches the player. It is not a threat you
// can fight, hide from or outrun; it is only ever a thing you watch happen.
// This is a local encounter, not a networked one: everybody gets their own.
import * as THREE from 'three';
import { makeCardKid, makeTaker, animateWalk } from '../render/models.js?v=2026-09-13e';
import { Walker } from './nav.js?v=2026-09-13e';
import { clamp, dist2, approachAngle } from '../util/util.js?v=2026-09-13e';

const SUBS = [
  'A boy you have not seen before holds up a fan of cards.',
  'He is telling you about them. All of them. In order.',
  'He does not seem to need you to answer.',
  '(you are a baby. you have no words yet.)'
];

export class CardKid {
  constructor(game) {
    this.game = game;
    this.model = makeCardKid();
    this.model.visible = false;
    game.renderer.scene.add(this.model);

    this.taker = makeTaker();
    this.taker.visible = false;
    game.renderer.scene.add(this.taker);

    this.state = 'off';
    this.x = 0; this.z = 0; this.yaw = 0;
    this.tx = 0; this.tz = 0; this.tyaw = 0;
    this.walker = new Walker(game.school, game.nav, game.collider, 0.3);
    this.animT = 0;
    this.timer = 0;
    this.subIdx = 0;
    this.subT = 0;
    this.usedThisPhase = false;
    this.speed = 0;
    this.dragDir = [0, 1];
  }

  get speaking() { return this.state === 'talk'; }
  get active() { return this.state !== 'off'; }

  resetPhase() { this.usedThisPhase = false; }

  // Called whenever the player does something at the generator.
  maybeTrigger() {
    if (this.active || this.usedThisPhase) return;
    if (Math.random() > 0.72) return;
    this.usedThisPhase = true;
    this.spawn();
  }

  spawn() {
    const g = this.game;
    const p = g.player;
    // Come in from somewhere the player is not looking, far enough away to walk.
    const spot = this.findApproach(p.x, p.z);
    if (!spot) { this.usedThisPhase = false; return; }
    this.x = spot[0]; this.z = spot[1];
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    this.model.visible = true;
    this.model.position.set(this.x, 0, this.z);
    this.state = 'approach';
    this.timer = 16;
    this.walker.clear();
    this.walker.setGoal(p.x, p.z, true);
  }

  findApproach(px, pz) {
    const s = this.game.school;
    const best = [];
    for (let i = 0; i < 60; i++) {
      const gx = (Math.random() * s.W) | 0, gy = (Math.random() * s.H) | 0;
      const id = s.cells[gy * s.W + gx];
      if (id < 0 || s.blocked[gy * s.W + gx]) continue;
      if (s.rooms[id].outdoor) continue;
      const x = s.cwx(gx), z = s.cwz(gy);
      const d = dist2(px, pz, x, z);
      if (d < 8 || d > 20) continue;
      if (!this.game.nav.path(x, z, px, pz)) continue;
      best.push([x, z, d]);
      if (best.length > 4) break;
    }
    if (!best.length) return null;
    best.sort((a, b) => a[2] - b[2]);
    return best[0];
  }

  update(dt, game) {
    if (this.state === 'off') return;
    this.animT += dt;
    const p = game.player;
    const d = dist2(this.x, this.z, p.x, p.z);
    let speed = 0;

    switch (this.state) {
      case 'approach': {
        speed = 1.75;
        this.timer -= dt;
        this.walker.setGoal(p.x, p.z);
        if (d < 2.0 || this.timer <= 0) this.beginTalk(game);
        break;
      }
      case 'talk': {
        this.walker.clear();
        this.yaw = approachAngle(this.yaw, Math.atan2(p.x - this.x, p.z - this.z), dt * 4);
        // He shuffles the cards while he talks.
        const fan = this.model.userData.parts.fan;
        fan.rotation.z = Math.sin(this.animT * 3.1) * 0.14;
        fan.position.y = 0.86 + Math.sin(this.animT * 2.3) * 0.03;
        this.model.userData.parts.head.rotation.y = Math.sin(this.animT * 1.7) * 0.25;

        this.subT -= dt;
        if (this.subT <= 0 && this.subIdx < SUBS.length) {
          this.subT = this.talkLen / SUBS.length;
          game.ui.subtitle(SUBS[this.subIdx++]);
        }
        this.timer -= dt;
        if (this.timer <= 0) this.beginGrab(game);
        break;
      }
      case 'grab': {
        // The Taker closes on him from behind, fast and quiet.
        const dx = this.x - this.tx, dz = this.z - this.tz;
        const td = Math.hypot(dx, dz);
        this.tyaw = Math.atan2(dx, dz);
        const mv = 7.5 * dt;
        if (td > 0.9) {
          this.tx += dx / td * mv;
          this.tz += dz / td * mv;
        } else {
          this.beginDrag(game);
        }
        this.timer -= dt;
        if (this.timer <= 0) this.beginDrag(game);
        break;
      }
      case 'drag': {
        // Both of them go, backwards, quickly, into somewhere darker.
        const mv = 6.2 * dt;
        this.tx += this.dragDir[0] * mv;
        this.tz += this.dragDir[1] * mv;
        this.x = this.tx + this.dragDir[0] * -0.55;
        this.z = this.tz + this.dragDir[1] * -0.55;
        this.model.position.y = 0.45 + Math.sin(this.animT * 22) * 0.06;
        this.model.rotation.z = 0.9;
        this.timer -= dt;
        if (this.timer <= 0) this.finish();
        break;
      }
    }

    if (this.state === 'approach') {
      const moved = this.walker.step(this, dt, speed, dd => game.aiOpenDoor(dd));
      this.speed = moved / Math.max(dt, 0.0001);
      if (moved > 0.001) this.yaw = approachAngle(this.yaw, this.walker.heading, dt * 6);
    } else this.speed = 0;

    this.model.position.x = this.x;
    this.model.position.z = this.z;
    if (this.state !== 'drag') this.model.position.y = 0;
    this.model.rotation.y = this.yaw + Math.PI;
    if (this.state === 'approach') animateWalk(this.model, this.animT, this.speed, { armsBusy: true });

    if (this.taker.visible) {
      this.taker.position.set(this.tx, 0, this.tz);
      this.taker.rotation.y = this.tyaw + Math.PI;
      animateWalk(this.taker, this.animT * 1.6, 4, { armsBusy: this.state === 'drag' });
      if (this.state === 'drag') {
        // arms down and forward, holding him
        const a = this.taker.userData.parts.arms;
        a[0].rotation.x = -1.9; a[1].rotation.x = -1.9;
      }
      // It bends its head toward the player exactly once, then loses interest.
      const look = Math.atan2(game.player.x - this.tx, game.player.z - this.tz);
      this.taker.userData.parts.head.rotation.y = (look - this.tyaw) * 0.35;
    }
  }

  beginTalk(game) {
    this.state = 'talk';
    this.walker.clear();
    const len = game.sfx.voice('kidLine', 1);
    this.talkLen = Math.max(3.4, len || 4.5);
    this.timer = this.talkLen + 0.9;
    this.subIdx = 0;
    this.subT = 0;
    game.ui.toast('A boy is telling you about his cards.');
  }

  beginGrab(game) {
    this.state = 'grab';
    this.timer = 2.6;
    // Arrive from the darkest direction that is not through the player.
    const away = Math.atan2(this.x - game.player.x, this.z - game.player.z);
    this.tx = this.x + Math.sin(away) * 6.5;
    this.tz = this.z + Math.cos(away) * 6.5;
    this.dragDir = [Math.sin(away), Math.cos(away)];
    this.tyaw = away + Math.PI;
    this.taker.visible = true;
    this.taker.position.set(this.tx, 0, this.tz);
    game.sfx.whisper(1);
    game.sfx.tone(44, 2.2, 'sine', 0.18, -8);
  }

  beginDrag(game) {
    if (this.state === 'drag') return;
    this.state = 'drag';
    this.timer = 2.4;
    game.sfx.voice('kidScream', 1);
    game.sfx.stinger();
    game.ui.flash('grump');
    game.ui.bigLine('SOMETHING TAKES HIM');
    game.ui.subtitle('It does not look at you.');
    const p = game.player;
    p.fear = clamp(p.fear + 55, 0, 100);
    p.shake = 1.2;
    // Watching it happen is worth remembering, and Grump notices that you did
    // nothing -- because there was nothing to do.
    if (game.isHost) game.grump.anger(3, game, 'witness');
    game.score += 25;
    game.seenTaking = (game.seenTaking || 0) + 1;
  }

  finish() {
    this.state = 'off';
    this.model.visible = false;
    this.taker.visible = false;
    this.model.rotation.z = 0;
    this.model.position.y = 0;
    this.walker.clear();
    this.game.ui.subtitle('The corridor is empty again.');
  }

  dispose() {
    this.game.renderer.scene.remove(this.model);
    this.game.renderer.scene.remove(this.taker);
  }
}
