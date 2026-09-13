// Meredith the lunch lady.
//
// Hairnet, apron, a ladle, and a smile that is genuinely pleased to see you.
// She stands at the serving counter in the cafeteria all day. Go to her and
// she will give you a tray of lunch -- after you keep the beat in her little
// lunch-line rhythm game. Keep it well and the tray is piled high; do badly
// and she still gives you something, because she is Meredith.
//
// One tray each, each day. Like Mrs. Honeywell she lives on every player's
// own machine: her spot comes from the layout, her hours from the clock.
import { makeMeredith, animateWalk } from '../render/models.js';
import { approachAngle, dist2 } from '../util/util.js';

const LINE = 'Meredith: "Here\'s your reward for being so good at your quests. Have some lunch, kid!"';

const TRAYS = [
  { min: 0.9, name: 'Gold tray', items: ['sandwich', 'apple', 'milk', 'snack'] },
  { min: 0.6, name: 'Nice tray', items: ['sandwich', 'apple', 'milk'] },
  { min: 0, name: 'Soggy tray', items: ['snack', 'milk'] }
];

const LEAVES_BEFORE_DARK = 25;

export class Meredith {
  constructor(game) {
    this.game = game;
    this.model = makeMeredith();
    this.model.visible = false;
    game.renderer.scene.add(this.model);
    this.present = false;
    this.serving = false;
    this.servedToday = false;
    this.animT = 0;
    this.room = game.school.rooms.find(r => r.type === 'cafeteria')
      || game.school.rooms.find(r => r.type === 'kitchen') || null;
    this.place();
    this.box = game.collider.addDynamic({ x: this.x, z: this.z, hw: 0.3, hd: 0.3, active: false });
  }

  place() {
    const g = this.game;
    const s = g.school;
    this.x = 0; this.z = 0; this.yaw = 0; this.homeYaw = 0;
    if (!this.room) return;
    const counter = s.props.find(p => p.type === 'servingCounter' && p.room === this.room.id)
      || s.props.find(p => p.type === 'counter' && p.room === this.room.id);
    let x, z, yaw = 0;
    if (counter) {
      const fx = Math.sin(counter.rot), fz = Math.cos(counter.rot);
      x = counter.x + fx * (counter.hd + 0.55); z = counter.z + fz * (counter.hd + 0.55);
      yaw = Math.atan2(fx, fz);
    }
    if (!counter || !g.collider.free(x, z, 0.32)) [x, z] = g.freeSpotIn(this.room, 0.4);
    this.x = x; this.z = z; this.yaw = yaw; this.homeYaw = yaw;
  }

  get visible() { return this.present; }

  resetDay() { this.servedToday = false; }

  show(on) {
    this.present = on;
    this.model.visible = on;
    if (this.box) this.box.active = on;
  }

  // The interaction prompt for her.
  interaction() {
    if (this.serving) return null;
    if (this.game.phaseTime < 50) {
      return { label: 'Meredith', hint: 'She is packing up for the day.', hold: 0,
        act: () => this.game.ui.subtitle('Meredith: "Kitchen\'s closing, hon. Get yourself somewhere safe."') };
    }
    if (this.servedToday) {
      return {
        label: 'Meredith', hint: 'One tray each, sweetie. Come back tomorrow.', hold: 0,
        act: () => this.game.ui.subtitle('Meredith: "Already had yours, sweetie! Tomorrow, same time."')
      };
    }
    return {
      label: 'Get lunch from Meredith',
      hint: 'Keep the beat in the lunch line -- the better you do, the fuller your tray.',
      hold: 0,
      act: () => this.serve()
    };
  }

  serve() {
    const g = this.game;
    if (this.serving || this.servedToday || g.minigames.active) return;
    this.serving = true;
    g.ui.subtitle('Meredith: "Ooh, a hungry one! Grab a tray and keep the beat, hon."');
    g.sfx.ding();
    g.minigames.open('lunch', r => this.finish(r));
  }

  finish(r) {
    const g = this.game;
    const p = g.player;
    this.serving = false;
    this.servedToday = true;
    const tray = TRAYS.find(t => r.score >= t.min) || TRAYS[TRAYS.length - 1];
    g.sfx.voice('meredith', 1);
    g.ui.subtitle(LINE);
    g.ui.subT = 7;
    const dropped = [];
    for (const kind of tray.items) {
      if (!p.give(kind)) {
        g.spawnGroundItem(kind, p.x + (Math.random() - 0.5) * 0.8, p.z + (Math.random() - 0.5) * 0.8);
        dropped.push(kind);
      }
    }
    g.sfx.pickup();
    g.ui.toast(`${tray.name}: ${tray.items.length} things to eat.` + (dropped.length ? ' Your bag was full -- some of it is on the floor.' : ''));
    g.score += Math.round(20 + r.score * 40);
    g.questEvent('lunch');
  }

  update(dt) {
    const g = this.game;
    if (!this.room) return;
    const shouldBeHere = g.phase === 'day' && (g.phaseTime > LEAVES_BEFORE_DARK || this.serving);
    if (this.present !== shouldBeHere) this.show(shouldBeHere);
    if (!this.present) return;

    this.animT += dt;
    let target = null, best = 10;
    for (const t of [g.player, ...g.remotePlayers.values()]) {
      if (t.dead) continue;
      const d = dist2(this.x, this.z, t.x, t.z);
      if (d < best) { best = d; target = t; }
    }
    const want = target ? Math.atan2(target.x - this.x, target.z - this.z) : this.homeYaw;
    this.yaw = approachAngle(this.yaw, want, dt * 2.4);
    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.yaw + Math.PI;
    animateWalk(this.model, this.animT, 0, { armsBusy: true });
    const parts = this.model.userData.parts;
    // stirring, and a little dance while she serves
    parts.arms[1].rotation.x = -0.9 + Math.sin(this.animT * (this.serving ? 7 : 2.2)) * (this.serving ? 0.5 : 0.25);
    parts.arms[0].rotation.x = -0.4;
    parts.body.rotation.z = this.serving ? Math.sin(this.animT * 5.4) * 0.08 : Math.sin(this.animT * 0.9) * 0.02;
    parts.head.rotation.z = this.serving ? Math.sin(this.animT * 5.4 + 1) * 0.12 : 0;
  }

  dispose() {
    this.game.renderer.scene.remove(this.model);
    if (this.box) this.box.active = false;
  }
}
