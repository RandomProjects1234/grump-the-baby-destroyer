// Jerry the gym teacher.
//
// Red tracksuit, whistle, headband. He lives in the gym and every so often,
// during the day, he comes sprinting out to find you -- because you are
// slacking off -- and you are doing gym class now, like it or not. He picks
// one of three: laps round the gym, the dumbbells, or jump rope.
//
// Like the card boy, each player gets their own Jerry: he is a local
// encounter and nobody else sees him. He is never a threat, only a nuisance.
// Beat his game and you are fitter for the rest of the day.
import { makeJerry, animateWalk } from '../render/models.js?v=2026-09-13f';
import { Walker } from './nav.js?v=2026-09-13f';
import { dist2, approachAngle, clamp } from '../util/util.js?v=2026-09-13f';

const GAMES = ['laps', 'dumbbells', 'rope'];

const CALLS = {
  laps: { voice: 'jerryLaps', text: 'Jerry: "Are you slacking off? Three laps around this gym, now!"' },
  dumbbells: { voice: 'jerryLift', text: 'Jerry: "Yeah, strength! Lift those dumbbells -- it\'s dumbbell time! Let\'s go, almost there! Let\'s go! W, you did it!"' },
  rope: { voice: 'jerryRope', text: 'Jerry: "Jump rope time! One, two, three, four, five, six -- let\'s go!"' }
};

export class Jerry {
  constructor(game) {
    this.game = game;
    this.model = makeJerry();
    this.model.visible = false;
    game.renderer.scene.add(this.model);
    this.walker = new Walker(game.school, game.nav, game.collider, 0.34);
    this.state = 'off';       // off | run | wait | class | leave
    this.x = 0; this.z = 0; this.yaw = 0;
    this.animT = 0;
    this.cd = 70 + Math.random() * 40;
    this.timer = 0;
    this.lastGame = null;
    this.gym = game.school.rooms.find(r => r.type === 'gym') || null;
    this.classesToday = 0;
    this.fitT = 0;            // seconds of "fit" left: stamina drains slower
  }

  get active() { return this.state !== 'off'; }
  get visible() { return this.state !== 'off'; }

  resetDay() {
    this.classesToday = 0;
    this.cd = 60 + Math.random() * 40;
    if (this.state !== 'off' && this.state !== 'class') this.hide();
  }

  hide() {
    this.state = 'off';
    this.model.visible = false;
    this.walker.clear();
  }

  // Can he come for you right now?
  canCome() {
    const g = this.game;
    const p = g.player;
    if (!this.gym || g.phase !== 'day') return false;
    if (g.phaseTime < 110) return false;                    // never runs into the dark
    if (this.classesToday >= 2) return false;
    if (p.dead || p.downed || p.hidden || p.carryingToddler) return false;
    if (g.minigames.active || g.overlayOpen()) return false;
    if (g.cardKid.active || (g.bullies && g.bullies.active)) return false;
    if (g.meredith && g.meredith.serving) return false;
    // not with something hunting you nearby
    if (g.threatPressure && g.threatPressure(p.x, p.z) > 0.25) return false;
    return true;
  }

  come() {
    const g = this.game;
    const p = g.player;
    // out of the gym doors, or from wherever is a sensible distance away
    let sx, sz;
    const inGym = g.school.roomAt(p.x, p.z) === this.gym;
    if (!inGym) [sx, sz] = g.freeSpotIn(this.gym, 0.4);
    if (inGym || !g.nav.path(sx, sz, p.x, p.z) || dist2(sx, sz, p.x, p.z) > 60) {
      // far away: he appears round a corner nearer to you
      const spot = this.nearbySpot(p.x, p.z);
      if (!spot) return false;
      [sx, sz] = spot;
    }
    this.x = sx; this.z = sz;
    this.yaw = Math.atan2(p.x - sx, p.z - sz);
    this.model.visible = true;
    this.state = 'run';
    this.timer = 25;
    this.walker.clear();
    this.walker.setGoal(p.x, p.z, true);
    g.sfx.tone(2600, 0.5, 'square', 0.07, -200);          // whistle, far off
    g.ui.subtitle('A whistle. Somebody in a red tracksuit is running at you.');
    return true;
  }

  nearbySpot(px, pz) {
    const g = this.game;
    const s = g.school;
    for (let i = 0; i < 80; i++) {
      const gx = (Math.random() * s.W) | 0, gy = (Math.random() * s.H) | 0;
      const id = s.cells[gy * s.W + gx];
      if (id < 0 || s.blocked[gy * s.W + gx] || s.rooms[id].outdoor) continue;
      const x = s.cwx(gx), z = s.cwz(gy);
      const d = dist2(px, pz, x, z);
      if (d < 9 || d > 22) continue;
      if (g.collider.lineClear(px, pz, x, z)) continue;       // round a corner
      if (!g.nav.path(x, z, px, pz)) continue;
      return [x, z];
    }
    return null;
  }

  startClass() {
    const g = this.game;
    this.state = 'class';
    this.walker.clear();
    let pick = GAMES[(Math.random() * GAMES.length) | 0];
    if (pick === this.lastGame) pick = GAMES[(GAMES.indexOf(pick) + 1) % GAMES.length];
    this.lastGame = pick;
    const call = CALLS[pick];
    if (call.voice) g.sfx.voice(call.voice, 1);
    else g.sfx.tone(2800, 0.6, 'square', 0.12, -150);
    g.ui.subtitle(call.text);
    g.ui.subT = 5;
    this.classesToday++;
    g.minigames.open(pick, r => this.endClass(pick, r));
  }

  endClass(kind, r) {
    const g = this.game;
    const p = g.player;
    this.state = 'leave';
    this.timer = 12;
    if (r.win) {
      this.fitT = 150;
      p.stamina = 100;
      g.score += 60;
      g.ui.toast('Gym class passed! You feel fit: stamina lasts longer for a while.');
      g.ui.subtitle(kind === 'dumbbells' ? 'Jerry: "W! You did it!"' : 'Jerry: "Now THAT is what I call hustle! Dismissed!"');
      g.questAction('gym');
    } else {
      p.food = Math.max(0, p.food - 8);
      g.ui.toast('Jerry is not impressed. All that effort made you hungry.');
      g.ui.subtitle('Jerry: "Pathetic. We go again next time, champ."');
    }
    this.goGym();
  }

  goGym() {
    if (!this.gym) return;
    const [gx, gz] = this.game.freeSpotIn(this.gym, 0.4);
    this.walker.setGoal(gx, gz, true);
  }

  update(dt) {
    const g = this.game;
    this.fitT = Math.max(0, this.fitT - dt);
    if (this.state === 'off') {
      if (g.phase !== 'day') return;
      this.cd -= dt;
      if (this.cd <= 0) {
        this.cd = 20;                       // try again soon if now is a bad time
        if (this.canCome() && this.come()) this.cd = 110 + Math.random() * 70;
      }
      return;
    }
    // night falls: gone
    if (g.phase !== 'day' && this.state !== 'class') { this.hide(); return; }

    const p = g.player;
    this.animT += dt;
    let speed = 0;
    switch (this.state) {
      case 'run': {
        speed = 4.6;
        this.timer -= dt;
        this.walker.setGoal(p.x, p.z);
        const d = dist2(this.x, this.z, p.x, p.z);
        if (Math.random() < dt * 0.6) g.sfx.tone(2700, 0.18, 'square', 0.05 * clamp(1 - d / 20, 0, 1), -120);
        // you hid, or he could not get to you: he gives up
        if (p.hidden || p.dead || this.timer <= 0 || g.overlayOpen() || (g.bullies && g.bullies.active) || g.cardKid.active) {
          this.state = 'leave'; this.timer = 10;
          this.goGym();
          if (p.hidden) g.ui.subtitle('Jerry: "I know you\'re in there! Next time, champ!"');
          break;
        }
        if (d < 1.7) {
          if (g.minigames.active || p.carryingToddler) { this.state = 'leave'; this.timer = 10; this.goGym(); break; }
          this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
          this.startClass();
        }
        break;
      }
      case 'class': {
        // The game was cut short (you went down, a new run): he wanders off.
        if (!g.minigames.active) { this.state = 'leave'; this.timer = 10; this.goGym(); break; }
        // stand there with the clipboard while you suffer
        this.yaw = approachAngle(this.yaw, Math.atan2(p.x - this.x, p.z - this.z), dt * 4);
        break;
      }
      case 'leave': {
        speed = 2.2;
        this.timer -= dt;
        if (this.timer <= 0) this.hide();
        break;
      }
    }
    if (this.state === 'off') return;

    if (speed > 0 && this.walker.goal) {
      const moved = this.walker.step(this, dt, speed, dd => g.aiOpenDoor(dd));
      if (moved > 0) this.yaw = approachAngle(this.yaw, this.walker.heading, dt * 7);
      else speed = 0;
      // back in the gym, or out of sight of you: he is gone
      if (this.state === 'leave' && this.walker.path && this.walker.arrived) { this.hide(); return; }
    }
    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.yaw + Math.PI;
    animateWalk(this.model, this.animT, speed);
    const parts = this.model.userData.parts;
    if (this.state === 'class') {
      // whistle to the mouth, clipboard up
      parts.arms[1].rotation.x = -2.3 + Math.sin(this.animT * 3) * 0.08;
      parts.arms[0].rotation.x = -0.9;
    } else if (this.state === 'run') {
      parts.arms[0].rotation.x *= 1.6;
      parts.arms[1].rotation.x *= 1.6;
    }
  }

  dispose() {
    this.game.renderer.scene.remove(this.model);
  }
}
