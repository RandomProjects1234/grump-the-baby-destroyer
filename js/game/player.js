// The local baby: movement, stats, carrying, hiding.
import * as THREE from 'three';
import { clamp, lerp } from '../util/util.js?v=2026-09-13f';
import { isBig, ITEMS } from './items.js?v=2026-09-13f';

export const BAG_SLOTS = 6;

const EYE_STAND = 0.62;
const EYE_CRAWL = 0.34;
const RADIUS = 0.26;

const SPEED = { walk: 2.55, sprint: 4.25, crawl: 1.35, downed: 0.55 };

export class Player {
  constructor(game) {
    this.game = game;
    this.id = 'me';
    this.x = 0; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.vx = 0; this.vz = 0;

    this.health = 100;
    this.stamina = 100;
    this.fear = 0;
    this.food = 100;
    this.torchOn = false;
    this.torchBattery = 55;

    this.hands = null;            // a big item, or { toddler: id }
    this.bag = new Array(BAG_SLOTS).fill(null);
    this.selected = 0;

    this.crawling = false;
    this.sprinting = false;
    this.hidden = null;           // the prop we are inside
    this.peeking = false;
    this.downed = false;
    this.downTimer = 0;
    this.dead = false;
    this.invuln = 0;

    this.bob = 0;
    this.stepPhase = 0;
    this.noise = 0;               // 0..1.5, read by the AI each frame
    this.shake = 0;
    this.eye = EYE_STAND;
    this.crySoon = 0;
    this.lastRoom = null;
    this.tapedIn = 0;             // seconds a taped locker stays shut
    this.stats = { searched: 0, cleaned: 0, saved: 0, drawings: 0, fuelPoured: 0, repairs: 0 };
  }

  get carryingToddler() { return this.hands && this.hands.toddler !== undefined; }
  get handsFree() { return !this.hands; }

  // ---------------------------------------------------------------- inventory
  bagCount(kind) { return this.bag.filter(s => s === kind).length; }
  hasItem(kind) { return this.bag.indexOf(kind) >= 0; }
  freeSlot() { return this.bag.indexOf(null); }

  give(kind) {
    if (isBig(kind)) {
      if (this.hands) return false;
      this.hands = kind;
      return true;
    }
    const i = this.freeSlot();
    if (i < 0) return false;
    this.bag[i] = kind;
    return true;
  }

  take(kind) {
    if (this.hands === kind) { this.hands = null; return true; }
    const i = this.bag.indexOf(kind);
    if (i < 0) return false;
    this.bag[i] = null;
    return true;
  }

  // What the player is currently pointing at with the hotbar.
  get selectedItem() { return this.bag[this.selected]; }

  dropAll(game) {
    const dropped = [];
    if (this.hands && !this.carryingToddler) { dropped.push(this.hands); this.hands = null; }
    for (let i = 0; i < this.bag.length; i++) {
      if (this.bag[i] && Math.random() < 0.7) { dropped.push(this.bag[i]); this.bag[i] = null; }
    }
    for (const k of dropped) {
      game.spawnGroundItem(k, this.x + (Math.random() - 0.5) * 1.6, this.z + (Math.random() - 0.5) * 1.6);
    }
    return dropped.length;
  }

  // ---------------------------------------------------------------- damage
  hurt(amount, game, source) {
    if (this.invuln > 0 || this.dead) return false;
    this.health = clamp(this.health - amount, 0, 100);
    this.invuln = 1.2;
    this.shake = Math.min(1.4, this.shake + amount / 40);
    this.fear = clamp(this.fear + amount * 0.8, 0, 100);
    game.sfx.hurt();
    game.ui.flash('hurt');
    if (this.health <= 0 && !this.downed) this.goDown(game, source);
    return true;
  }

  goDown(game, source) {
    this.downed = true;
    this.downTimer = game.online ? 45 : 4;
    this.hidden = null;
    this.torchOn = false;
    if (this.carryingToddler) game.releaseToddler(this.hands.toddler, this.x, this.z);
    this.hands = null;
    game.sfx.babyCry();
    game.onPlayerDowned(source);
  }

  revive(amount = 45) {
    this.downed = false;
    this.health = amount;
    this.downTimer = 0;
    this.invuln = 2.5;
  }

  // ---------------------------------------------------------------- hiding
  enterHide(prop, game) {
    this.hidden = prop;
    this.x = prop.x; this.z = prop.z;
    this.crawling = prop.hide === 'under';
    game.sfx[prop.hide === 'locker' ? 'lockerShut' : 'clean']();
    if (prop.doorMesh) prop.doorMesh.visible = true;
    // Quiet enough that a careful baby is not advertising where they went.
    game.emitNoise(this.x, this.z, 0.18);
    game.questAction('hide');
  }

  exitHide(game) {
    const p = this.hidden;
    this.hidden = null;
    this.tapedIn = 0;
    if (p) {
      if (p.doorMesh) p.doorMesh.visible = false;
      game.sfx[p.hide === 'locker' ? 'lockerOpen' : 'clean']();
      // Step out to a free spot: in front of the container if there is room,
      // otherwise the nearest open floor on this side of the walls. Never stay
      // inside the furniture itself.
      const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
      let spot = null;
      for (const d of [0.85, 1.2, 1.6]) {
        const tx = p.x + fx * d, tz = p.z + fz * d;
        if (game.collider.free(tx, tz, RADIUS) && game.collider.wallsClear(p.x, p.z, tx, tz)) { spot = [tx, tz]; break; }
      }
      if (!spot) spot = game.collider.nearestFree(p.x + fx * (p.hd + 0.3), p.z + fz * (p.hd + 0.3), RADIUS, 2.4);
      if (!spot) spot = game.collider.nearestFree(p.x, p.z, RADIUS, 3.5);
      if (!spot) spot = game.freeSpotIn(game.school.rooms[p.room] || game.school.home, RADIUS);
      this.x = spot[0]; this.z = spot[1];
      game.emitNoise(this.x, this.z, 0.3);
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, input, game) {
    if (this.dead) return;
    this.invuln = Math.max(0, this.invuln - dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);

    // --- look
    const sens = game.settings.sens * 0.0022;
    this.yaw -= input.lookX * sens;
    this.pitch = clamp(this.pitch - input.lookY * sens, -1.35, 1.35);
    input.lookX = 0; input.lookY = 0;

    // --- state
    this.peeking = !!input.peek && !!this.hidden;
    if (this.downed) {
      this.downTimer -= dt;
      if (this.downTimer <= 0) { this.dead = true; game.onPlayerDead(); return; }
    }

    // Wedged inside something (a door that shut on you, a bad landing): ease
    // out to the nearest open floor instead of being stuck or flung.
    if (!this.hidden && !game.collider.free(this.x, this.z, RADIUS - 0.04)) {
      const spot = game.collider.nearestFree(this.x, this.z, RADIUS, 1.6);
      if (spot) { this.x = lerp(this.x, spot[0], Math.min(1, dt * 10)); this.z = lerp(this.z, spot[1], Math.min(1, dt * 10)); }
    }
    // Somehow outside the building (not the playground): back inside.
    this.oobT = game.school.roomAt(this.x, this.z) ? 0 : (this.oobT || 0) + dt;
    if (this.oobT > 0.5) {
      const room = game.school.roomAt(this.lastGoodX, this.lastGoodZ) || game.school.home;
      [this.x, this.z] = game.freeSpotIn(room, RADIUS);
      this.oobT = 0;
      game.ui.toast('You squeeze back inside.');
    } else if (this.oobT === 0 && game.collider.free(this.x, this.z, RADIUS)) {
      this.lastGoodX = this.x; this.lastGoodZ = this.z;
    }

    let moved = 0;
    if (this.hidden) {
      this.noise = 0;
      this.eye = lerp(this.eye, this.hidden.hide === 'under' ? EYE_CRAWL : 0.75, dt * 8);
      this.tapedIn = Math.max(0, this.tapedIn - dt);
    } else {
      this.crawling = !!input.crawl || this.downed;
      const wantSprint = input.sprint && !this.crawling && this.stamina > 3 && !this.downed;
      this.sprinting = wantSprint && (input.fwd !== 0 || input.right !== 0);

      let speed = this.downed ? SPEED.downed
        : this.crawling ? SPEED.crawl
          : this.sprinting ? SPEED.sprint : SPEED.walk;
      if (this.hands) speed *= this.carryingToddler ? 0.76 : 0.87;
      if (this.food < 20) speed *= 0.82;
      if (this.fear > 80) speed *= 0.92;

      // Move relative to where we are looking.
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      let mx = input.right * cosY - input.fwd * sinY;
      let mz = -input.right * sinY - input.fwd * cosY;
      const len = Math.hypot(mx, mz);
      if (len > 0.001) { mx /= len; mz /= len; } else { mx = mz = 0; }

      const dx = mx * speed * dt, dz = mz * speed * dt;
      const [nx, nz] = game.collider.move(this.x, this.z, RADIUS, dx, dz);
      moved = Math.hypot(nx - this.x, nz - this.z);
      this.x = nx; this.z = nz;

      // --- stamina
      // Passing Jerry's gym class leaves you fit for a while: half the drain.
      const fit = game.jerry && game.jerry.fitT > 0;
      if (this.sprinting && moved > 0.001) this.stamina = clamp(this.stamina - dt * (fit ? 10.5 : 21), 0, 100);
      else this.stamina = clamp(this.stamina + dt * (this.crawling ? 15 : 9), 0, 100);

      // --- footsteps and the noise they make
      const eyeTarget = this.crawling ? EYE_CRAWL : EYE_STAND;
      this.eye = lerp(this.eye, eyeTarget, dt * 9);
      if (moved > 0.0005) {
        this.stepPhase += moved * (this.crawling ? 1.6 : 2.6);
        this.bob = Math.sin(this.stepPhase * Math.PI) * (this.sprinting ? 0.035 : 0.022);
        if (this.stepPhase >= 1) {
          this.stepPhase -= 1;
          game.sfx.step(this.crawling);
          game.emitNoise(this.x, this.z, this.crawling ? 0.16 : this.sprinting ? 1.0 : 0.5);
        }
      } else {
        this.bob = lerp(this.bob, 0, dt * 6);
      }
      this.noise = moved > 0.0005 ? (this.crawling ? 0.16 : this.sprinting ? 1.0 : 0.5) : 0;
    }

    // --- hunger
    // Roughly one proper meal every day-and-night cycle.
    this.food = clamp(this.food - dt * 0.25, 0, 100);
    if (this.food <= 0) {
      this.health = clamp(this.health - dt * 1.6, 0, 100);
      if (this.health <= 0 && !this.downed) this.goDown(game, 'hunger');
    }
    this.hungerWarnings(dt, game);

    // --- torch
    if (this.torchOn) {
      this.torchBattery = clamp(this.torchBattery - dt * 2.6 * (game.mods.cold ? 2 : 1), 0, 100);
      if (this.torchBattery <= 0) { this.torchOn = false; game.ui.toast('The torch dies.'); }
    }

    // --- fear
    const room = game.school.roomAt(this.x, this.z);
    this.lastRoom = room;
    const litHere = game.roomBrightness(this.x, this.z);
    let fearRate = 0;
    if (game.phase === 'night') {
      fearRate += (1 - litHere) * 7.5;
      fearRate -= litHere * 5.5;
      if (this.hidden) fearRate -= 3.0;
      if (this.hands === 'teddy') fearRate -= 5.0;
      fearRate += game.threatPressure(this.x, this.z) * 16;
    } else {
      fearRate -= 9;
      fearRate += game.threatPressure(this.x, this.z) * 6;
    }
    if (this.torchOn) fearRate -= 2.2;
    if (this.food < 15) fearRate += 1.5;
    this.fear = clamp(this.fear + fearRate * dt, 0, 100);

    // At maximum fear a baby does the one thing a baby does, and every
    // hunting thing in the building hears it.
    if (this.fear >= 99.5) {
      this.crySoon -= dt;
      if (this.crySoon <= 0) {
        this.crySoon = 3.2;
        game.sfx.babyCry();
        game.emitNoise(this.x, this.z, 1.6);
        game.ui.flash('cry');
      }
    } else {
      this.crySoon = 0.6;
    }

    if (!this.downed && this.health < 100 && game.phase === 'day') this.health = clamp(this.health + dt * 0.9, 0, 100);
  }

  // Where the camera goes. Hiding pushes the eye inside the container and
  // narrows the view, unless you lean out to peek.
  applyCamera(camera, dt) {
    const shake = this.shake;
    const sx = shake ? (Math.random() - 0.5) * shake * 0.12 : 0;
    const sy = shake ? (Math.random() - 0.5) * shake * 0.12 : 0;
    let x = this.x, z = this.z, y = this.eye + this.bob;
    if (this.hidden && this.peeking) {
      const fx = Math.sin(this.hidden.rot), fz = Math.cos(this.hidden.rot);
      x += fx * 0.45; z += fz * 0.45;
    }
    camera.position.set(x + sx, y + sy, z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch;
    camera.rotation.z = shake * 0.05 * Math.sin(performance.now() * 0.03);
  }

  // Hunger gets louder the longer you ignore it: a reminder, then a growling
  // stomach and a warning that stays on screen, then a big STARVING, then
  // repeated alarms while it eats your health.
  hungerWarnings(dt, game) {
    const f = this.food;
    const level = f <= 0 ? 4 : f < 10 ? 3 : f < 25 ? 2 : f < 50 ? 1 : 0;
    if (this.hungerLevel === undefined) this.hungerLevel = level;
    const where = game.meredith && game.meredith.room && !game.meredith.servedToday && game.phase === 'day'
      ? 'Meredith in the cafeteria will give you lunch.'
      : 'Search lockers, desks and the kitchen, or find a lunchbox.';
    const hasFood = this.bag.some(k => k && ITEMS[k] && ITEMS[k].food);
    const how = hasFood ? 'You have food: pick it with 1-6 and press R to eat.' : where;
    if (level > this.hungerLevel) {
      if (level === 1) game.ui.toast('You are getting hungry. ' + how);
      if (level === 2) { game.ui.toast('HUNGRY! Your tummy hurts. ' + how); game.sfx.growl(); game.ui.flash('hunger'); }
      if (level === 3) { game.ui.bigLine('YOU ARE STARVING'); game.sfx.growl(); game.ui.flash('hunger'); game.ui.toast('Eat something NOW. ' + how); }
      if (level === 4) { game.ui.bigLine('STARVING\nYOU ARE LOSING HEALTH'); game.sfx.growl(); game.ui.flash('hurt'); }
      this.growlT = 0;
    }
    this.hungerLevel = level;
    // keep nagging while it is bad
    if (level >= 2) {
      this.growlT = (this.growlT || 0) + dt;
      const every = level === 4 ? 6 : level === 3 ? 12 : 22;
      if (this.growlT > every) {
        this.growlT = 0;
        game.sfx.growl();
        game.ui.flash(level === 4 ? 'hurt' : 'hunger');
        game.ui.toast((level === 4 ? 'You are starving and losing health! ' : level === 3 ? 'You are starving! ' : 'Still hungry. ') + how);
      }
    }
    game.ui.hunger(level, how);
  }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  serialize() {
    return {
      x: +this.x.toFixed(2), z: +this.z.toFixed(2),
      yaw: +this.yaw.toFixed(2),
      c: this.crawling ? 1 : 0,
      h: this.hidden ? 1 : 0,
      d: this.downed ? 1 : 0,
      t: this.torchOn ? 1 : 0,
      hp: Math.round(this.health),
      it: this.hands && !this.carryingToddler ? this.hands : null,
      tod: this.carryingToddler ? this.hands.toddler : null,
      hid: this.hidden ? this.hidden.id : null,
      tp: this.tapedIn > 0 ? 1 : 0,
      mg: this.busy ? 1 : 0,
      dd: this.dead ? 1 : 0
    };
  }
}

export function itemInfo(kind) { return ITEMS[kind] || null; }
