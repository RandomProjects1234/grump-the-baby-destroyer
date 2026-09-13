// Bob the janitor and Grump.
//
// Each threat is split in two:
//   update()  -- the AI. Runs on the host only. Decides where to go and who to
//                hurt. Anything that should be seen or heard is sent through
//                game.fx(), which plays it locally and on every client.
//   present() -- the body. Runs on EVERY player's machine. Animation,
//                footsteps, ambience and the effects that depend on where *you*
//                are standing, so a joiner hears Bob coming as clearly as the
//                host does.
//
// Who is dangerous when: the nights belong to Bob. Grump only watches until day
// 4, and after that he hunts you in daylight as well as the dark.
import * as THREE from 'three';
import { Walker, canSee } from './nav.js';
import { makeBob, makeGrump, setGrumpStage, animateWalk, poseCarry } from '../render/models.js';
import { clamp, approachAngle, dist2, lerp } from '../util/util.js';
import { AMBIENT } from './dialogue.js';

// A room this bright counts as "lit", and neither threat behaves the same in it.
export const LIT = 0.55;

// The day Grump stops being a creepy boy and becomes the thing the game is
// named after. Provoking him hard enough can bring this forward, but it never
// slips past day 4 -- the story does not wait on the player being rude.
export const GRUMP_TURNS_ON_DAY = 4;

// Shared by both: estimate speed from how far the body moved, so clients that
// only receive positions still animate properly.
function trackMotion(t, dt) {
  const moved = t.px === undefined ? 0 : Math.hypot(t.x - t.px, t.z - t.pz);
  t.px = t.x; t.pz = t.z;
  // Teleports should not register as a sprint.
  const m = moved > 3 ? 0 : moved;
  t.vis = lerp(t.vis || 0, m / Math.max(dt, 0.001), Math.min(1, dt * 10));
  return m;
}

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
    this.grabCd = 0;
    this.lightsOffCd = 6;
    this.messLineCd = 8;
    this.messCheckT = 1;
    this.animT = 0;
    this.stepAcc = 0;
    this.humT = 3;
    this.lastVisible = {};
    this.certainSpot = null;
    // night modifiers
    this.hearMult = 1;
    this.speedBonus = 0;
  }

  activate(night) {
    const s = this.game.school;
    const start = s.rooms.find(r => r.type === 'storage') || s.hallB;
    this.x = start.cx; this.z = start.cz;
    this.px = undefined;
    this.state = 'patrol';
    this.night = night;
    this.walker.clear();
    this.timer = 0;
    this.grabCd = 0;
    this.lastVisible = {};
    this.certainSpot = null;
  }

  deactivate() {
    this.state = 'off';
    this.walker.clear();
  }

  get active() { return this.state !== 'off'; }

  patrolTarget() {
    const g = this.game, s = g.school;
    if (this.night >= 2 && Math.random() < 0.45) {
      const lit = s.rooms.filter(r => !r.outdoor && r.type !== 'hall' && r.lightsOn && r !== s.home && r.type !== 'boiler');
      if (lit.length && g.generator.running) {
        const r = lit[(Math.random() * lit.length) | 0];
        return [r.cx, r.cz];
      }
    }
    const halls = s.rooms.filter(r => r.type === 'hall');
    const r = halls[(Math.random() * halls.length) | 0];
    return [s.cwx(r.x0 + Math.floor(Math.random() * r.w)), s.cwz(r.y0 + Math.floor(Math.random() * r.h))];
  }

  // Whoever he can currently see. Lit rooms read as "allowed to be there".
  spot(game) {
    let best = null, bestScore = 0;
    for (const t of game.threatTargets()) {
      if (t.hidden) continue;
      const bright = game.roomBrightness(t.x, t.z);
      if (bright > LIT && this.state !== 'chase') continue;
      const cone = canSee(game.collider, this.x, this.z, this.yaw + this.sweep, t.x, t.z, 15, 0.5);
      const close = canSee(game.collider, this.x, this.z, 0, t.x, t.z, 4.5, Math.PI);
      const score = Math.max(cone, close * 0.9) * (t.crawling ? 0.55 : 1) * (1 - bright * 0.5);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return bestScore > 0.14 ? best : null;
  }

  // "These darn kids..." -- not every time, or it stops being funny.
  grumble(game) {
    if (this.messLineCd > 0) return;
    this.messLineCd = 35;
    game.fx('bobMess', this.x, this.z);
  }

  update(dt, game) {
    if (this.state === 'off') return;
    this.grabCd = Math.max(0, this.grabCd - dt);
    this.messLineCd = Math.max(0, this.messLineCd - dt);
    this.animT += dt;

    let speed = 0;
    const seen = this.spot(game);
    if (seen) this.lastVisible[seen.id] = game.time;

    switch (this.state) {
      case 'patrol': {
        this.sweep = Math.sin(this.animT * 0.9) * 0.55;
        speed = 1.5 + Math.min(0.7, (this.night - 1) * 0.12) + this.speedBonus * 0.5;
        if (this.walker.arrived || !this.walker.goal) {
          const [tx, tz] = this.patrolTarget();
          this.walker.setGoal(tx, tz, true);
        }
        // Lights out behind him, one room at a time.
        this.lightsOffCd -= dt;
        if (this.lightsOffCd <= 0) {
          this.lightsOffCd = 5;
          const r = game.school.roomAt(this.x, this.z);
          if (r && this.night >= 2 && r !== game.school.home && r.type !== 'boiler' && r.type !== 'hall' && r.lightsOn) {
            game.setRoomLights(r, false, 'bob');
            game.fx('switch', this.x, this.z);
            this.grumble(game);
          }
        }
        // Walking past a mess nobody cleaned up sets him off too.
        this.messCheckT -= dt;
        if (this.messCheckT <= 0) {
          this.messCheckT = 1;
          if (game.messes.nearest(this.x, this.z, 3.2)) this.grumble(game);
        }
        if (seen) this.startChase(seen, game);
        break;
      }
      case 'investigate': {
        this.sweep = Math.sin(this.animT * 2.2) * 0.8;
        speed = 2.0 + this.speedBonus * 0.5;
        this.timer -= dt;
        if (this.walker.arrived || this.timer <= 0) {
          // He opens the locker he saw you climb into. Anything else is a gamble
          // on his part -- hiding is supposed to work.
          const certain = !!this.certainSpot;
          const spot = this.certainSpot || game.nearestHideSpot(this.x, this.z, 2.2);
          this.certainSpot = null;
          if (spot && !spot.checked) {
            spot.checked = true;
            game.fx('lockerOpen', spot.x, spot.z);
            const chance = certain ? 1 : clamp(0.18 + this.night * 0.025, 0.18, 0.42) * this.hearMult;
            if (Math.random() < chance) {
              const occupant = game.occupantOf(spot);
              if (occupant) { game.forceUnhide(occupant); this.startChase(occupant, game); break; }
            }
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
        speed = 3.6 + Math.min(1.0, (this.night - 1) * 0.16) + this.speedBonus;
        const t = game.targetById(this.targetId);
        if (!t || t.dead) { this.state = 'patrol'; this.walker.clear(); break; }

        if (t.hidden) {
          // Did he see them get in? Then he knows exactly which door to open.
          const saw = game.time - (this.lastVisible[t.id] || -99) < 1.6;
          const spot = game.hideSpotOf(t);
          if (saw && spot) {
            this.certainSpot = spot;
            spot.checked = false;
            this.state = 'investigate';
            this.timer = 9;
            this.walker.setGoal(spot.x + Math.sin(spot.rot) * 0.9, spot.z + Math.cos(spot.rot) * 0.9, true);
            game.fx('sub', this.x, this.z, { text: 'Bob: "I saw that."', range: 20 });
          } else {
            this.state = 'investigate';
            this.timer = 6;
            game.fx('sub', this.x, this.z, { text: '...hm.', range: 16 });
          }
          break;
        }

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
            game.fx('sub', this.x, this.z, { text: '...hm.', range: 16 });
            break;
          }
        }
        // Giving up when the target reaches a lit room is what makes lights matter.
        if (game.roomBrightness(t.x, t.z) > LIT && dist2(this.x, this.z, t.x, t.z) > 2.2) {
          this.state = 'patrol';
          this.walker.clear();
          game.fx('sub', this.x, this.z, { text: 'Bob turns away.', range: 20 });
          break;
        }
        if (this.grabCd <= 0 && dist2(this.x, this.z, t.x, t.z) < 1.05) this.grab(t, game);
        break;
      }
    }

    this.walker.step(this, dt, speed, d => game.aiOpenDoor(d));
    if (this.walker.goal) this.yaw = approachAngle(this.yaw, this.walker.heading, dt * 5);
  }

  // Runs everywhere.
  present(dt, game) {
    const on = this.state !== 'off';
    this.model.visible = on;
    if (!on) { this.px = undefined; return; }
    if (!game.isHost) this.animT += dt;
    const moved = trackMotion(this, dt);
    const me = game.player;
    const att = clamp(1 - dist2(this.x, this.z, me.x, me.z) / 26, 0, 1);

    this.stepAcc += moved;
    if (this.stepAcc > 0.85) {
      this.stepAcc = 0;
      if (att > 0.03) game.sfx.bobStep(att);
    }
    this.humT -= dt;
    if (this.humT <= 0) {
      this.humT = 4 + Math.random() * 5;
      if (this.state === 'patrol' && att > 0.05) game.sfx.bobHum(att);
    }

    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.yaw + Math.PI;
    animateWalk(this.model, this.animT, this.vis);
    const p = this.model.userData.parts;
    p.torch.rotation.y = this.sweep;
    p.head.rotation.y = this.sweep * 0.7;
  }

  startChase(t, game) {
    if (this.state !== 'chase') game.fx('bobSpot', this.x, this.z, { id: t.id });
    this.state = 'chase';
    this.targetId = t.id;
    this.lastSeen = [t.x, t.z];
    this.loseTimer = 4.5;
    this.walker.setGoal(t.x, t.z, true);
  }

  hearNoise(x, z, level, game) {
    if (this.state === 'chase' || this.state === 'off') return;
    const d = dist2(this.x, this.z, x, z);
    const hearing = (7 + level * 16) * this.hearMult;
    if (d > hearing) return;
    this.state = 'investigate';
    this.timer = 10;
    this.walker.setGoal(x + (Math.random() - 0.5), z + (Math.random() - 0.5), true);
    for (const s of game.school.props) if (s.hide) s.checked = false;
  }

  grab(t, game) {
    this.grabCd = 6;
    game.fx('bobGrab', this.x, this.z, { id: t.id });
    game.hitPlayer(t, 'bob');
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
    this.talkCd = 0;
    this.whisperT = 4;
    this.litTimer = 0;
    this.pauseT = 0;
    this.listening = false;
    this.grabCd = 0;
    this.chargeCd = 0;
    this.popCd = 12;
    this.relocateCd = 25;
    this.knockCd = 15;
    this.saidT = 6;
    this.campSpot = null;
    this.campTarget = null;
    this.ignore = {};
    this.memory = [];        // the player's own answers, saved for later
    this.busy = false;       // true while a dialogue is open
    this.stepAcc = 0;
    this.breathT = 0;
  }

  get stage() {
    if (this.turned) return 4;
    return this.resent >= 75 ? 3 : this.resent >= 50 ? 2 : this.resent >= 22 ? 1 : 0;
  }
  get hunting() { return this.state === 'hunt' || this.state === 'camp'; }

  // Has he stopped asking questions? Either he ran out of patience early, or
  // day 4 arrived.
  get turned() { return !!this._turned || this.resent >= 100; }

  // Called at each dawn. Returns true on the day he flips.
  checkSchedule(night) {
    if (this._turned) return false;
    if (night < GRUMP_TURNS_ON_DAY && this.resent < 100) return false;
    this._turned = true;
    this.resent = Math.max(this.resent, 100);
    setGrumpStage(this.model, 4);
    return true;
  }

  place(x, z) { this.x = x; this.z = z; this.px = undefined; this.walker.clear(); }

  anger(amount, game, why) {
    const before = this.stage;
    this.resent = clamp(this.resent + amount, 0, 130);
    setGrumpStage(this.model, this.stage);
    if (this.stage > before) game.onGrumpStageUp(this.stage, why);
  }

  beginDay(game) {
    this.state = this.turned ? 'hunt' : 'wander';
    this.litTimer = 0;
    this.campSpot = null;
    const rooms = game.school.rooms.filter(r => r.type !== 'hall' && !r.outdoor && r !== game.school.home);
    const r = rooms[(Math.random() * rooms.length) | 0];
    this.place(r.cx, r.cz);
  }

  beginNight(game, closer) {
    this.state = this.turned ? 'hunt' : 'stalk';
    this.campSpot = null;
    if (closer) {
      const h = game.school.home;
      const d = game.school.doors.find(dd => h.doors.includes(dd.id));
      if (d) this.place(d.x + (Math.random() - 0.5) * 3, d.z + (Math.random() - 0.5) * 3);
    }
    if (this.turned) game.fx('big', 0, 0, { text: 'NO MORE QUESTIONS', reveal: true });
    this.walker.clear();
  }

  // Ceiling lights still stop him before he turns. After, only slow him.
  canEnter(game, x, z) {
    if (this.turned) return true;
    return game.roomBrightness(x, z) < 0.62;
  }

  update(dt, game) {
    this.animT += dt;
    this.talkCd = Math.max(0, this.talkCd - dt);
    this.grabCd = Math.max(0, this.grabCd - dt);
    this.chargeCd = Math.max(0, this.chargeCd - dt);
    this.relocateCd = Math.max(0, this.relocateCd - dt);
    this.knockCd = Math.max(0, this.knockCd - dt);
    this.popCd = Math.max(0, this.popCd - dt);
    for (const k in this.ignore) { this.ignore[k] -= dt; if (this.ignore[k] <= 0) delete this.ignore[k]; }
    if (this.busy) return;

    const night = game.phase === 'night';
    const near = game.nearestTarget(this.x, this.z);
    const player = near || game.player;
    const d = dist2(this.x, this.z, player.x, player.z);
    let speed = 0;

    switch (this.state) {
      case 'wander': {
        speed = 1.25;
        this.timer -= dt;
        if (this.walker.arrived || !this.walker.goal || this.timer <= 0) {
          this.timer = 8 + Math.random() * 8;
          let goTo;
          if (Math.random() < 0.55 && d < 40) {
            goTo = [player.x + (Math.random() - 0.5) * 10, player.z + (Math.random() - 0.5) * 10];
          } else {
            const rooms = game.school.rooms.filter(r => !r.outdoor);
            const r = rooms[(Math.random() * rooms.length) | 0];
            goTo = [r.cx, r.cz];
          }
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
        this.timer -= dt;
        this.yaw = approachAngle(this.yaw, Math.atan2(player.x - this.x, player.z - this.z), dt * 3);
        if (this.timer <= 0) this.state = 'wander';
        if (this.talkCd <= 0 && Math.random() < dt * 0.5 && d < 12) {
          this.talkCd = 12;
          this.say(game);
        }
        break;
      }
      case 'stalk': {
        // Present, patient, never quite arriving -- and before day 4, never
        // actually dangerous. The dread is the point.
        const keep = 7.5;
        speed = d > keep ? 1.9 : 0;
        if (d > keep) this.walker.setGoal(player.x, player.z);
        else { this.walker.clear(); this.yaw = approachAngle(this.yaw, Math.atan2(player.x - this.x, player.z - this.z), dt * 2.5); }

        this.saidT -= dt;
        if (this.saidT <= 0) { this.saidT = 9 + Math.random() * 8; if (d < 20) this.say(game); }

        // Out of sight, he gets closer without walking there.
        if (d > 24 && this.relocateCd <= 0 && this.relocateNear(game, player, 10, 13)) this.relocateCd = 30;

        // Knocking on your classroom door while you are inside it.
        if (near && game.school.roomAt(near.x, near.z) === game.school.home && d < 14 && this.knockCd <= 0) {
          this.knockCd = 22 + Math.random() * 18;
          const h = game.school.home;
          const door = game.school.doors.find(dd => h.doors.includes(dd.id));
          if (door) game.fx('knock', door.x, door.z);
        }

        // A blackout brings him in close. Before he has turned, he only looks.
        if (!game.generator.running && game.roomBrightness(player.x, player.z) < 0.2) {
          this.state = 'loom';
          game.fx('sub', this.x, this.z, { text: 'Something is standing very close to you.', range: 14 });
        }
        break;
      }
      case 'loom': {
        speed = d > 2.2 ? 1.7 : 0;
        if (d > 2.2) this.walker.setGoal(player.x, player.z);
        else { this.walker.clear(); this.yaw = approachAngle(this.yaw, Math.atan2(player.x - this.x, player.z - this.z), dt * 4); }
        this.breathT -= dt;
        if (this.breathT <= 0 && d < 6) { this.breathT = 2.6; game.fx('breath', this.x, this.z); }
        if (game.generator.running || game.roomBrightness(player.x, player.z) > 0.4) this.state = 'stalk';
        break;
      }
      case 'hunt': {
        speed = clamp(3.3 + game.night * 0.18, 3.3, 5.2) * (night ? 1 : 0.85);
        // He stops to listen, which is the only reason you can ever get away.
        this.pauseT -= dt;
        if (this.pauseT <= 0) {
          this.listening = !this.listening;
          this.pauseT = this.listening ? 0.7 : 3.4 + Math.random() * 2.4;
          if (this.listening) this.walker.clear();
        }
        if (this.listening) speed = 0;

        // Somebody hiding close by? He waits for them.
        const hider = game.threatTargets().find(t => t.hidden && !this.ignore[t.id] &&
          dist2(this.x, this.z, t.x, t.z) < 4.2 && game.hideSpotOf(t));
        if (hider) { this.beginCamp(hider, game); break; }

        const target = game.huntTarget(this);
        if (target) {
          const lit = game.roomBrightness(target.x, target.z);
          if (!this.canEnter(game, target.x, target.z)) {
            const ang = this.animT * 0.6;
            this.walker.setGoal(target.x + Math.cos(ang) * 7, target.z + Math.sin(ang) * 7);
            speed *= 0.8;
          } else {
            this.walker.setGoal(target.x, target.z);
            // He runs at you the moment he has a clear look.
            const sees = !this.listening && canSee(game.collider, this.x, this.z, this.yaw, target.x, target.z, 18, 1.1);
            if (sees) {
              speed *= 1.45;
              if (this.chargeCd <= 0) { this.chargeCd = 9; game.fx('charge', this.x, this.z, { id: target.id }); }
            }
            // Ceiling lights hurt him at night. Daylight does not.
            if (night && lit > LIT) {
              speed *= 0.5;
              this.litTimer += dt;
              if (this.litTimer > 4 + Math.min(10, game.night) * 0.6) {
                this.state = 'retreat';
                this.timer = 6;
                game.fx('grumpAngry', this.x, this.z);
              }
            } else this.litTimer = Math.max(0, this.litTimer - dt * 0.5);
          }
          if (this.grabCd <= 0 && !target.hidden && dist2(this.x, this.z, target.x, target.z) < 1.15) {
            this.catchTarget(target, game);
          }
          // Far away and unseen, he simply arrives somewhere nearer.
          if (d > 22 && this.relocateCd <= 0 && this.relocateNear(game, target, 9, 13)) {
            this.relocateCd = 20 + Math.random() * 14;
          }
        }

        // Bulbs die when he walks under them.
        if (night && this.popCd <= 0) {
          this.popCd = 9 + Math.random() * 9;
          game.popLightNear(this.x, this.z, 6);
        }

        this.saidT -= dt;
        if (this.saidT <= 0) { this.saidT = 7 + Math.random() * 6; if (d < 22) this.say(game); }
        break;
      }
      case 'camp': {
        // Standing outside the locker, breathing, waiting for you to get out.
        const t = game.targetById(this.campTarget);
        this.timer -= dt;
        const spot = this.campSpot;
        if (spot) {
          const fx = spot.x + Math.sin(spot.rot) * 1.0, fz = spot.z + Math.cos(spot.rot) * 1.0;
          if (dist2(this.x, this.z, fx, fz) > 0.4) { this.walker.setGoal(fx, fz); speed = 2.2; }
          else { this.walker.clear(); this.yaw = approachAngle(this.yaw, Math.atan2(spot.x - this.x, spot.z - this.z), dt * 4); }
        }
        this.breathT -= dt;
        if (this.breathT <= 0) { this.breathT = 2.4; game.fx('breath', this.x, this.z, { strong: true }); }
        if (t && !t.hidden && !t.dead && dist2(this.x, this.z, t.x, t.z) < 2.8) {
          this.catchTarget(t, game);
          break;
        }
        if (!t || t.dead || this.timer <= 0) {
          if (t) this.ignore[t.id] = 8;
          this.state = 'hunt';
          this.campSpot = null;
          const dark = game.darkRoom();
          if (dark) this.walker.setGoal(dark.cx, dark.cz, true);
          game.fx('sub', this.x, this.z, { text: 'The breathing moves away.', range: 10 });
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

    this.walker.step(this, dt, speed, dd => game.aiOpenDoor(dd));
    if (this.walker.goal && speed > 0) this.yaw = approachAngle(this.yaw, this.walker.heading, dt * 4.5);
  }

  beginCamp(t, game) {
    this.state = 'camp';
    this.campTarget = t.id;
    this.campSpot = game.hideSpotOf(t);
    this.timer = 7 + Math.random() * 5;
    this.breathT = 0.5;
    this.walker.clear();
    game.fx('camp', this.x, this.z, { id: t.id });
  }

  // Teleport to somewhere between minD and maxD from the target that they
  // cannot currently see. Returns true if it found somewhere.
  relocateNear(game, t, minD, maxD) {
    const s = game.school;
    if (game.collider.lineClear(t.x, t.z, this.x, this.z)) return false;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, r = minD + Math.random() * (maxD - minD);
      const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
      const room = s.roomAt(x, z);
      if (!room || room.outdoor) continue;
      if (!game.collider.free(x, z, 0.4)) continue;
      if (game.collider.lineClear(t.x, t.z, x, z)) continue;
      if (!game.nav.path(x, z, t.x, t.z)) continue;
      this.place(x, z);
      game.fx('whisper', x, z, { strong: true });
      return true;
    }
    return false;
  }

  // Runs everywhere.
  present(dt, game) {
    if (!game.isHost) this.animT += dt;
    const moved = trackMotion(this, dt);
    const me = game.player;
    const d = dist2(this.x, this.z, me.x, me.z);
    const att = clamp(1 - d / 24, 0, 1);
    const night = game.phase === 'night';

    this.stepAcc += moved;
    if (this.stepAcc > 0.62) {
      this.stepAcc = 0;
      if (att > 0.04 && this.stage >= 2) game.sfx.grumpStep(att * (0.4 + this.stage * 0.18));
    }
    this.whisperT -= dt;
    if (this.whisperT <= 0) {
      this.whisperT = 4 + Math.random() * 5;
      const menacing = this.state === 'stalk' || this.hunting || this.state === 'loom';
      if (menacing && att > 0.08) game.sfx.whisper(att * (this.turned ? 1.6 : 1));
    }

    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.yaw + Math.PI;
    animateWalk(this.model, this.animT, this.vis, { amp: 0.8 + this.stage * 0.16 });
    if (this.hunting && this.vis > 0.5) poseCarry(this.model, this.animT);
    // While camping outside a hiding spot his head tilts, slowly, to one side.
    this.model.userData.parts.head.rotation.z = this.state === 'camp' ? Math.sin(this.animT * 0.7) * 0.5 : 0;

    const glow = (this.stage >= 3 && night) || this.turned;
    game.renderer.setGrumpGlow(glow && d < 24,
      new THREE.Vector3(this.x, 1.0 * this.model.scale.y, this.z), this.stage >= 4 ? 1.5 : 0.7);

    // How close he feels, for the static overlay and flickering lights.
    const menace = this.turned || (night && (this.state === 'stalk' || this.state === 'loom'));
    this.dread = menace ? clamp(1 - d / (this.turned ? 16 : 10), 0, 1) : 0;
  }

  // Everything he says goes out as an fx event, so every player hears it from
  // where they are standing.
  say(game) {
    let line;
    if (this.turned && this.memory.length && Math.random() < 0.45) {
      // He remembers what you told him.
      line = 'You said "' + this.memory[(Math.random() * this.memory.length) | 0] + '"';
    } else {
      const lines = AMBIENT[Math.min(AMBIENT.length - 1, this.stage)];
      line = lines[(Math.random() * lines.length) | 0];
    }
    const voice = this.stage >= 3 ? 'angry' : this.stage >= 1 ? 'mean' : 'greeting';
    game.fx('say', this.x, this.z, { text: line, voice, rate: this.turned ? 0.8 : 1, stage: this.stage });
  }

  catchTarget(t, game) {
    this.grabCd = 8;
    game.fx('grumpCatch', this.x, this.z, { id: t.id });
    game.grumpCaught(t);
    this.state = 'retreat';
    this.timer = 5;
    this.campSpot = null;
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
