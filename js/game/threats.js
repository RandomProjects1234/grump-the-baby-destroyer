// Bob the janitor and Grump.
//
// Both run only on the host; clients receive positions over the wire. The two
// of them work on opposite principles: Bob is a patrol you can hear coming and
// hide from, Grump is a slow-building consequence you cannot apologise your way
// out of.
import * as THREE from 'three';
import { Walker, canSee } from './nav.js';
import { makeBob, makeGrump, setGrumpStage, animateWalk, poseCarry } from '../render/models.js';
import { clamp, angDiff, approachAngle, dist2 } from '../util/util.js';
import { AMBIENT } from './dialogue.js';

// A room this bright counts as "lit", and neither threat behaves the same in it.
export const LIT = 0.55;

// The day Grump stops being a creepy boy and becomes the thing the game is
// named after. Provoking him hard enough can bring this forward, but it never
// slips past day 4 -- the story does not wait on the player being rude.
export const GRUMP_TURNS_ON_DAY = 4;

// ---------------------------------------------------------------- Bob

export class Bob {
  constructor(game) {
    this.game = game;
    this.model = makeBob();
    this.model.visible = false;
    game.renderer.scene.add(this.model);

    this.x = 0; this.z = 0; this.yaw = 0;
    this.state = 'off';
    this.walker = new Walker(game.school, game.nav, game.collider, 0.36);
    this.timer = 0;
    this.sweep = 0;
    this.targetId = null;
    this.lastSeen = null;
    this.loseTimer = 0;
    this.stepT = 0;
    this.humT = 3;
    this.grabCd = 0;
    this.lightsOffCd = 6;
    this.animT = 0;
    this.speed = 0;
  }

  activate(night) {
    const s = this.game.school;
    // He starts his round from the far end of the building.
    const start = s.rooms.find(r => r.type === 'storage') || s.hallB;
    this.x = start.cx; this.z = start.cz;
    this.state = 'patrol';
    this.model.visible = true;
    this.night = night;
    this.walker.clear();
    this.timer = 0;
    this.grabCd = 0;
  }

  deactivate() {
    this.state = 'off';
    this.model.visible = false;
    this.walker.clear();
  }

  get active() { return this.state !== 'off'; }

  patrolTarget() {
    const s = this.game.school;
    const halls = s.rooms.filter(r => r.type === 'hall');
    const g = this.game;
    // Half the time he heads for a room with its lights on, to switch them off.
    if (this.night >= 2 && Math.random() < 0.45) {
      const lit = s.rooms.filter(r => !r.outdoor && r.type !== 'hall' && g.roomLit(r) > LIT && r !== s.home);
      if (lit.length) {
        const r = lit[(Math.random() * lit.length) | 0];
        return [r.cx, r.cz, r];
      }
    }
    const r = halls[(Math.random() * halls.length) | 0];
    const x = s.cwx(r.x0 + Math.floor(Math.random() * r.w));
    const z = s.cwz(r.y0 + Math.floor(Math.random() * r.h));
    return [x, z, null];
  }

  // Whoever he can currently see. Lit rooms read as "allowed to be there".
  spot(game) {
    let best = null, bestScore = 0;
    for (const t of game.threatTargets()) {
      if (t.hidden || t.dead) continue;
      const bright = game.roomBrightness(t.x, t.z);
      if (bright > LIT && this.state !== 'chase') continue;
      const cone = canSee(game.collider, this.x, this.z, this.yaw + this.sweep, t.x, t.z, 15, 0.5);
      const close = canSee(game.collider, this.x, this.z, 0, t.x, t.z, 4.5, Math.PI);
      const score = Math.max(cone, close * 0.9) * (t.crawling ? 0.55 : 1) * (1 - bright * 0.5);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return bestScore > 0.14 ? best : null;
  }

  update(dt, game) {
    if (this.state === 'off') return;
    this.animT += dt;
    this.grabCd = Math.max(0, this.grabCd - dt);
    this.humT -= dt;
    const distToCam = dist2(this.x, this.z, game.player.x, game.player.z);
    const att = clamp(1 - distToCam / 26, 0, 1);

    if (this.humT <= 0 && this.state === 'patrol') {
      this.humT = 4 + Math.random() * 5;
      if (att > 0.05) game.sfx.bobHum(att);
    }

    let speed = 0;
    const seen = this.spot(game);

    switch (this.state) {
      case 'patrol': {
        this.sweep = Math.sin(this.animT * 0.9) * 0.55;
        speed = 1.5 + Math.min(0.7, (this.night - 1) * 0.12);
        if (this.walker.arrived || !this.walker.goal) {
          const [tx, tz, room] = this.patrolTarget();
          this.walker.setGoal(tx, tz, true);
          this.pendingRoom = room;
        }
        // Lights out behind him, one room at a time.
        this.lightsOffCd -= dt;
        if (this.lightsOffCd <= 0) {
          this.lightsOffCd = 5;
          const r = game.school.roomAt(this.x, this.z);
          if (r && this.night >= 2 && r !== game.school.home && r.type !== 'boiler' && game.roomLit(r) > LIT) {
            game.setRoomLights(r, false, 'bob');
            game.sfx.lightOff();
            game.ui.subtitle('a switch clicks somewhere');
          }
        }
        if (seen) this.startChase(seen, game);
        break;
      }
      case 'investigate': {
        this.sweep = Math.sin(this.animT * 2.2) * 0.8;
        speed = 2.0;
        this.timer -= dt;
        if (this.walker.arrived || this.timer <= 0) {
          // Check any hiding place right next to the noise before giving up.
          const spot = game.nearestHideSpot(this.x, this.z, 2.2);
          if (spot && !spot.checked) {
            spot.checked = true;
            game.sfx.lockerOpen();
            const occupant = game.occupantOf(spot);
            if (occupant) { this.startChase(occupant, game); break; }
          }
          this.state = 'patrol';
          this.walker.clear();
        }
        if (seen) this.startChase(seen, game);
        break;
      }
      case 'chase': {
        this.sweep = 0;
        // The nights are his. He gets quicker every one of them.
        speed = 3.6 + Math.min(1.0, (this.night - 1) * 0.16);
        const t = game.targetById(this.targetId);
        if (seen && seen === t) {
          this.lastSeen = [t.x, t.z];
          this.loseTimer = 4.5;
          this.walker.setGoal(t.x, t.z);
        } else {
          this.loseTimer -= dt;
          if (this.lastSeen) this.walker.setGoal(this.lastSeen[0], this.lastSeen[1]);
          if (this.loseTimer <= 0) {
            this.state = 'investigate';
            this.timer = 6;
            game.ui.subtitle('...hm.');
            break;
          }
        }
        // Giving up when the target reaches a lit room is what makes lights matter.
        if (t && game.roomBrightness(t.x, t.z) > LIT && dist2(this.x, this.z, t.x, t.z) > 2.2) {
          this.state = 'patrol';
          this.walker.clear();
          game.ui.subtitle('Bob turns away.');
          break;
        }
        if (t && this.grabCd <= 0 && dist2(this.x, this.z, t.x, t.z) < 1.05) this.grab(t, game);
        break;
      }
    }

    // Torch and steps
    const moved = this.walker.step(this, dt, speed, d => game.aiOpenDoor(d));
    this.speed = moved / Math.max(dt, 0.0001);
    if (this.walker.goal) this.yaw = approachAngle(this.yaw, this.walker.heading, dt * 5);

    this.stepT -= moved;
    if (this.stepT <= 0) {
      this.stepT = 0.85;
      if (att > 0.03) game.sfx.bobStep(att);
      game.emitNoise(this.x, this.z, 0.25, 'bob');
    }

    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.yaw + Math.PI;
    animateWalk(this.model, this.animT, this.speed);
    const p = this.model.userData.parts;
    p.torch.rotation.y = this.sweep;
    p.head.rotation.y = this.sweep * 0.7;
  }

  startChase(t, game) {
    if (this.state !== 'chase') {
      game.sfx.bobSpot();
      const att = clamp(1 - dist2(this.x, this.z, game.player.x, game.player.z) / 30, 0.25, 1);
      game.sfx.voice('bobClass', att);
      game.ui.subtitle('Bob: "GET BACK TO YOUR CLASSROOM."');
      game.ui.flash('spotted');
    }
    this.state = 'chase';
    this.targetId = t.id;
    this.lastSeen = [t.x, t.z];
    this.loseTimer = 4.5;
    this.walker.setGoal(t.x, t.z, true);
  }

  hearNoise(x, z, level, game) {
    if (this.state === 'chase' || this.state === 'off') return;
    const d = dist2(this.x, this.z, x, z);
    const hearing = 7 + level * 16;
    if (d > hearing) return;
    this.state = 'investigate';
    this.timer = 10;
    this.walker.setGoal(x + (Math.random() - 0.5), z + (Math.random() - 0.5), true);
    for (const s of game.school.props) if (s.hide) s.checked = false;
  }

  grab(t, game) {
    this.grabCd = 6;
    game.sfx.bobGrab();
    game.sfx.voice('bobScream', 1);
    game.onBobGrab(t);
    this.state = 'patrol';
    this.walker.clear();
  }
}

// ---------------------------------------------------------------- Grump

export class Grump {
  constructor(game) {
    this.game = game;
    this.model = makeGrump();
    game.renderer.scene.add(this.model);

    this.x = 0; this.z = 0; this.yaw = 0;
    this.resent = 0;
    this.state = 'wander';
    this.walker = new Walker(game.school, game.nav, game.collider, 0.34);
    this.animT = 0;
    this.timer = 0;
    this.speed = 0;
    this.stepT = 0;
    this.talkCd = 0;
    this.whisperT = 4;
    this.litTimer = 0;
    this.pauseT = 0;
    this.listening = false;
    this.grabCd = 0;
    this.askedToday = false;
    this.lastLine = 0;
    this.busy = false;      // true while a dialogue is open
  }

  get stage() {
    if (this.turned) return 4;
    return this.resent >= 100 ? 4 : this.resent >= 75 ? 3 : this.resent >= 50 ? 2 : this.resent >= 22 ? 1 : 0;
  }
  get hunting() { return this.state === 'hunt'; }

  // Has he stopped asking questions? Either he ran out of patience early, or
  // day 4 arrived.
  get turned() { return this._turned || this.resent >= 100; }

  // Called at each dawn. Returns true on the day he flips, so the game can
  // make a moment of it.
  checkSchedule(night) {
    if (this._turned) return false;
    if (night < GRUMP_TURNS_ON_DAY && this.resent < 100) return false;
    this._turned = true;
    this.resent = Math.max(this.resent, 100);
    setGrumpStage(this.model, 4);
    return true;
  }

  place(x, z) { this.x = x; this.z = z; this.walker.clear(); }

  anger(amount, game, why) {
    const before = this.stage;
    this.resent = clamp(this.resent + amount, 0, 130);
    setGrumpStage(this.model, this.stage);
    if (this.stage > before) {
      game.onGrumpStageUp(this.stage, why);
    }
  }

  beginDay(game) {
    this.state = this.turned ? 'hunt' : 'wander';
    this.askedToday = false;
    this.litTimer = 0;
    this.model.visible = true;
    const rooms = game.school.rooms.filter(r => r.type !== 'hall' && !r.outdoor && r !== game.school.home);
    const r = rooms[(Math.random() * rooms.length) | 0];
    this.place(r.cx, r.cz);
    this.walker.clear();
  }

  beginNight(game) {
    // Once he has turned he stops asking and starts hunting.
    this.state = this.turned ? 'hunt' : 'stalk';
    if (this.state === 'hunt') {
      game.sfx.voice('angry');
      game.sfx.grumpReveal();
      game.ui.bigLine('NO MORE QUESTIONS');
    }
    this.walker.clear();
  }

  // How much light he will tolerate. Fully provoked, he comes in anyway.
  canEnter(game, x, z) {
    if (this.turned) return true;
    return game.roomBrightness(x, z) < 0.62;
  }

  update(dt, game) {
    this.animT += dt;
    this.talkCd = Math.max(0, this.talkCd - dt);
    this.grabCd = Math.max(0, this.grabCd - dt);
    if (this.busy) { this.faceModel(); return; }

    const player = game.player;
    const d = dist2(this.x, this.z, player.x, player.z);
    const att = clamp(1 - d / 24, 0, 1);
    let speed = 0;

    switch (this.state) {
      case 'wander': {
        speed = 1.25;
        this.timer -= dt;
        if (this.walker.arrived || !this.walker.goal || this.timer <= 0) {
          this.timer = 8 + Math.random() * 8;
          // He drifts toward wherever the player has been working.
          const goTo = Math.random() < 0.55 && d < 40
            ? [player.x + (Math.random() - 0.5) * 10, player.z + (Math.random() - 0.5) * 10]
            : (() => {
              const rooms = game.school.rooms.filter(r => !r.outdoor);
              const r = rooms[(Math.random() * rooms.length) | 0];
              return [r.cx, r.cz];
            })();
          this.walker.setGoal(goTo[0], goTo[1], true);
        }
        // Standing and staring, which is worse than following.
        if (d < 13 && Math.random() < dt * 0.28 && canSee(game.collider, this.x, this.z, 0, player.x, player.z, 14, Math.PI)) {
          this.state = 'watch';
          this.timer = 3 + Math.random() * 4;
          this.walker.clear();
        }
        break;
      }
      case 'watch': {
        speed = 0;
        this.timer -= dt;
        this.yaw = approachAngle(this.yaw, Math.atan2(player.x - this.x, player.z - this.z), dt * 3);
        if (this.timer <= 0) this.state = 'wander';
        if (this.talkCd <= 0 && Math.random() < dt * 0.5 && d < 12) {
          this.talkCd = 12;
          this.say(game, att);
        }
        break;
      }
      case 'stalk': {
        // Present, patient, never quite arriving.
        const keep = 7.5;
        speed = d > keep ? 1.9 : 0;
        if (d > keep) this.walker.setGoal(player.x, player.z);
        else { this.walker.clear(); this.yaw = approachAngle(this.yaw, Math.atan2(player.x - this.x, player.z - this.z), dt * 2.5); }
        this.whisperT -= dt;
        if (this.whisperT <= 0) {
          this.whisperT = 5 + Math.random() * 6;
          if (att > 0.1) { game.sfx.whisper(att); if (Math.random() < 0.45) this.say(game, att); }
        }
        // If the lights fail he stops being patient.
        if (game.roomBrightness(player.x, player.z) < 0.2 && !game.generator.running) {
          this.state = 'hunt';
          game.sfx.grumpAngry();
          game.sfx.voice('angry', 0.9);
          game.ui.bigLine('IT IS DARK NOW');
        }
        break;
      }
      case 'hunt': {
        speed = clamp(3.15 + game.night * 0.22, 3.15, 4.9);
        // He stops to listen, which is the only reason you can ever get away.
        this.pauseT -= dt;
        if (this.pauseT <= 0) {
          this.listening = !this.listening;
          this.pauseT = this.listening ? 0.7 : 3.4 + Math.random() * 2.4;
          if (this.listening) this.walker.clear();
        }
        if (this.listening) speed = 0;

        const target = game.huntTarget(this);
        if (target) {
          const lit = game.roomBrightness(target.x, target.z);
          if (!this.canEnter(game, target.x, target.z)) {
            // He circles the lit room instead of entering it.
            const ang = this.animT * 0.6;
            this.walker.setGoal(target.x + Math.cos(ang) * 7, target.z + Math.sin(ang) * 7);
            speed *= 0.8;
          } else {
            this.walker.setGoal(target.x, target.z);
            if (lit > LIT) {
              // Being in the light costs him. He can do it, but not for long.
              speed *= 0.42;
              this.litTimer += dt;
              if (this.litTimer > 4 + game.night * 0.6) {
                this.state = 'retreat';
                this.timer = 6;
                game.sfx.grumpAngry();
              }
            } else this.litTimer = Math.max(0, this.litTimer - dt * 0.5);
          }
          if (this.grabCd <= 0 && dist2(this.x, this.z, target.x, target.z) < 1.15 && !target.hidden) {
            this.catchTarget(target, game);
          }
        }
        this.whisperT -= dt;
        if (this.whisperT <= 0) {
          this.whisperT = 4 + Math.random() * 4;
          if (att > 0.08) { game.sfx.whisper(att * 1.5); if (Math.random() < 0.5) this.say(game, att); }
        }
        break;
      }
      case 'retreat': {
        speed = 3.4;
        this.timer -= dt;
        if (!this.walker.goal || this.walker.arrived) {
          const dark = game.darkRoom();
          if (dark) this.walker.setGoal(dark.cx, dark.cz, true);
        }
        if (this.timer <= 0) { this.state = 'hunt'; this.litTimer = 0; this.walker.clear(); }
        break;
      }
    }

    const moved = this.walker.step(this, dt, speed, dd => game.aiOpenDoor(dd));
    this.speed = moved / Math.max(dt, 0.0001);
    if (this.walker.goal && moved > 0.001) this.yaw = approachAngle(this.yaw, this.walker.heading, dt * 4.5);

    this.stepT -= moved;
    if (this.stepT <= 0) {
      this.stepT = 0.62;
      if (att > 0.04 && this.stage >= 2) game.sfx.grumpStep(att * (0.4 + this.stage * 0.18));
    }

    this.faceModel();
    animateWalk(this.model, this.animT, this.speed, { amp: 0.8 + this.stage * 0.16 });
    if (this.hunting && this.speed > 0.5) poseCarry(this.model, this.animT);

    // Glowing eyes light their own little patch of corridor.
    const glow = this.stage >= 3 && game.phase === 'night';
    game.renderer.setGrumpGlow(glow && d < 22,
      new THREE.Vector3(this.x, 1.0 * this.model.scale.y, this.z), this.stage >= 4 ? 1.4 : 0.7);
  }

  faceModel() {
    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.yaw + Math.PI;
  }

  say(game, att) {
    const lines = AMBIENT[Math.min(AMBIENT.length - 1, this.stage)];
    const line = lines[(Math.random() * lines.length) | 0];
    game.ui.subtitle('Grump: "' + line + '"');
    if (att > 0.25 && !game.sfx.isSpeaking) {
      game.sfx.voice(this.stage >= 3 ? 'angry' : this.stage >= 1 ? 'mean' : 'greeting', Math.min(1, att + 0.35));
    } else if (this.stage < 2) game.sfx.grumpGiggle();
  }

  catchTarget(t, game) {
    this.grabCd = 8;
    game.sfx.stinger();
    game.sfx.voice('angry');
    game.onGrumpCatch(t);
    this.state = 'retreat';
    this.timer = 5;
    this.walker.clear();
  }

  hearNoise(x, z, level, game) {
    if (this.state !== 'hunt') return;
    if (dist2(this.x, this.z, x, z) > 10 + level * 22) return;
    this.walker.setGoal(x, z, true);
    this.listening = false;
    this.pauseT = 3;
  }
}
