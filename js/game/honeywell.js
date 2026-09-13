// Mrs. Honeywell, your teacher.
//
// Every morning she is standing at the chalkboard in your classroom. She reads
// out the day, the list appears, and she stays by the board while you work --
// the one grown-up in the building who is on your side. Talk to her and she
// goes over the list again.
//
// Just before dark she is not there any more. Nobody sees her leave.
//
// She lives entirely on each player's own machine: her spot is fixed by the
// school layout and her routine by the phase clock, so nothing about her ever
// needs to be sent over the network.
import { makeHoneywell, animateWalk } from '../render/models.js';
import { approachAngle, dist2 } from '../util/util.js';

// Things she says when you walk up to her. Her two recorded lines are the
// morning one and the one about the lights; these appear as subtitles.
const TALK = [
  'Off you go, then. The list will not do itself.',
  'Stay busy, little one. Busy is safe.',
  'Anything you finish, I will leave something in the crib for you.',
  'Keep the lights on tonight. Promise me.',
  'Mind the boy in the green dungarees. Be polite. It will not help, but be polite.',
  'If you hear Bob humming, find somewhere small to be.',
  'Eat something. You cannot be brave on an empty tummy.',
  'Meredith in the cafeteria will give you a tray of lunch. Keep the beat for her.',
  'If Jerry comes running with that whistle, just do what he says. It is quicker.'
];

const MORNING_LINE = 'Mrs. Honeywell: "Can you get all these quests done for me? You can go home at the end of ' +
  'the day, but look out for Grump. He\'s kind of a special one."';

const DARK_LINE = 'Mrs. Honeywell: "Hey, make sure there\'s electricity, okay? It\'s kind of dark in here."';

// How many seconds before dark she is gone.
const LEAVES_BEFORE_DARK = 25;

export class Honeywell {
  constructor(game) {
    this.game = game;
    this.model = makeHoneywell();
    this.model.visible = false;
    game.renderer.scene.add(this.model);
    this.x = 0; this.z = 0; this.yaw = 0; this.homeYaw = 0;
    this.animT = 0;
    this.present = false;
    this.lineIdx = 0;
    this.talkCd = 0;
    this.writeT = 3;
    this.darkCd = 0;
    this.darkCheckT = 2;
    this.place();
    // She is solid while she is there.
    this.box = game.collider.addDynamic({ x: this.x, z: this.z, hw: 0.28, hd: 0.28, active: false });
  }

  // In front of the chalkboard, facing the class.
  place() {
    const s = this.game.school;
    const home = s.home;
    const board = s.props.find(p => p.type === 'chalkboard' && p.room === home.id);
    let x, z, yaw;
    if (board) {
      const fx = Math.sin(board.rot), fz = Math.cos(board.rot);
      x = board.x + fx * 0.9; z = board.z + fz * 0.9;
      yaw = Math.atan2(fx, fz);
    } else {
      [x, z] = this.game.freeSpotIn(home, 0.35);
      yaw = 0;
    }
    // Step away from any desk that happens to be in the way.
    if (!this.game.collider.freeStatic(x, z, 0.3)) [x, z] = this.game.freeSpotIn(home, 0.35);
    this.x = x; this.z = z; this.yaw = yaw; this.homeYaw = yaw;
  }

  get visible() { return this.present; }

  // Start of every day: she is back at the board and reads out the day.
  morning() {
    const g = this.game;
    this.show(true);
    this.lineIdx = 0;
    const len = g.sfx.voice('honeywell', 1);
    g.ui.subtitle(MORNING_LINE);
    // Long line: keep the subtitle up for as long as she is talking.
    clearTimeout(this.subTimer);
    if (len > 3) this.subTimer = setTimeout(() => { if (this.present) g.ui.subtitle(MORNING_LINE); }, 3000);
    g.ui.toast("Mrs. Honeywell's list is up. Talk to her in your classroom any time.");
  }

  show(on) {
    this.present = on;
    this.model.visible = on;
    if (this.box) this.box.active = on;
  }

  // Is your classroom actually lit? The switch has to be on AND the generator
  // has to be running; either one missing and it is dark in here.
  classroomDark() {
    const g = this.game;
    return !(g.generator.running && g.school.home.lightsOn !== false);
  }

  nagAboutLights() {
    const g = this.game;
    this.darkCd = 60;
    g.sfx.voice('honeywellDark', 1);
    g.ui.subtitle(DARK_LINE);
    const reason = g.generator.running ? 'The light switch by the classroom door is off.' : 'The generator in the boiler room is not running.';
    g.ui.toast(reason);
  }

  talk() {
    const g = this.game;
    if (this.talkCd > 0) return;
    this.talkCd = 1.2;
    // In the dark, the lights are all she wants to talk about.
    if (this.classroomDark() && !g.sfx.isSpeaking) {
      this.nagAboutLights();
      g.ui.setObjectives(true, g.objectivesHtml());
      clearTimeout(this.listTimer);
      this.listTimer = setTimeout(() => { if (!g.keys.has('tab')) g.ui.setObjectives(false); }, 6000);
      return;
    }
    const line = TALK[this.lineIdx % TALK.length];
    this.lineIdx++;
    g.ui.subtitle('Mrs. Honeywell: "' + line + '"');
    g.ui.setObjectives(true, g.objectivesHtml());
    clearTimeout(this.listTimer);
    this.listTimer = setTimeout(() => { if (!g.keys.has('tab')) g.ui.setObjectives(false); }, 6000);
    g.sfx.click();
  }

  update(dt) {
    const g = this.game;
    this.talkCd = Math.max(0, this.talkCd - dt);

    // Her routine follows the clock.
    const shouldBeHere = g.phase === 'day' && g.phaseTime > LEAVES_BEFORE_DARK;
    if (this.present && !shouldBeHere) {
      this.show(false);
      if (g.school.roomAt(g.player.x, g.player.z) === g.school.home) {
        g.ui.subtitle('Mrs. Honeywell is not by the board any more.');
      }
    } else if (!this.present && shouldBeHere && g.phase === 'day') {
      // Arrived mid-day (a late joiner, or a restart): just be there, quietly.
      this.show(true);
    }
    if (!this.present) return;

    // Sit in a dark classroom and she will tell you about it -- but not over
    // her morning speech, and not every few seconds.
    this.darkCd = Math.max(0, this.darkCd - dt);
    this.darkCheckT -= dt;
    if (this.darkCheckT <= 0) {
      this.darkCheckT = 2;
      const inClass = g.school.roomAt(g.player.x, g.player.z) === g.school.home;
      const dayAge = g.diff.day - g.phaseTime;
      if (inClass && !g.player.dead && !(g.bullies && g.bullies.active) && this.darkCd <= 0 && dayAge > 45 && this.classroomDark() && !g.sfx.isSpeaking) {
        this.nagAboutLights();
      }
    }

    this.animT += dt;
    // Watch whoever is nearest, otherwise face the class.
    let target = null, best = 9;
    for (const t of [g.player, ...g.remotePlayers.values()]) {
      if (t.dead) continue;
      const d = dist2(this.x, this.z, t.x, t.z);
      if (d < best) { best = d; target = t; }
    }
    this.writeT -= dt;
    const writing = this.writeT < 0 && this.writeT > -2.2 && !target;
    if (this.writeT < -2.2) this.writeT = 6 + Math.random() * 6;
    const want = target ? Math.atan2(target.x - this.x, target.z - this.z)
      : writing ? this.homeYaw + Math.PI : this.homeYaw;
    this.yaw = approachAngle(this.yaw, want, dt * 2.6);

    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.yaw + Math.PI;
    animateWalk(this.model, this.animT, 0, { armsBusy: true });
    const p = this.model.userData.parts;
    p.body.rotation.z = Math.sin(this.animT * 0.8) * 0.02;
    p.head.rotation.x = Math.sin(this.animT * 0.5) * 0.05;

    // Every so often she turns and adds something to the board.
    p.arms[1].rotation.x = writing ? -2.4 + Math.sin(this.animT * 14) * 0.12 : -0.1;
    p.arms[0].rotation.x = -0.6;
  }

  dispose() {
    this.game.renderer.scene.remove(this.model);
    if (this.box) this.box.active = false;
  }
}
