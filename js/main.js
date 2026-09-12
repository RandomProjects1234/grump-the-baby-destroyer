// Grump the Baby Destroyer -- entry point, game loop, and the glue that owns
// every subsystem.
import * as THREE from 'three';
import { Renderer } from './render/renderer.js';
import { initTextures } from './render/textures.js';
import { buildSchool, materialFor, resetMaterials } from './world/build.js';
import { generateSchool, CELL } from './world/schoolgen.js';
import { buildCollider, computeNavBlocking, repairConnectivity } from './game/collide.js';
import { Nav } from './game/nav.js';
import { Player } from './game/player.js';
import { Bob, Grump, LIT } from './game/threats.js';
import { Toddlers } from './game/toddlers.js';
import { Generator, Messes, GroundItems, PortableLights } from './game/systems.js';
import { findInteraction, useSelected, dropHands } from './game/interact.js';
import { CardKid } from './game/cardkid.js';
import { rollLoot, DRAWINGS, ITEMS, itemName, isBig } from './game/items.js';
import { pickQuestion } from './game/dialogue.js';
import { makeBaby, animateWalk, BABY_COLORS, OUTFIT_COLORS } from './render/models.js';
import { Sfx } from './audio/sfx.js';
import { UI } from './ui/ui.js';
import { Net, makeCode } from './net/net.js';
import { clamp, lerp, dist2, makeRng, hashStr, fmtTime } from './util/util.js';

const SET_KEY = 'grump.settings.v1';
const $ = s => document.querySelector(s);

const DIFF = {
  gentle: { day: 300, night: 150, anger: 8, bobFrom: 1 },
  normal: { day: 240, night: 180, anger: 11, bobFrom: 1 },
  nasty: { day: 205, night: 215, anger: 15, bobFrom: 1 }
};

// ---------------------------------------------------------------- remote peer

class RemotePlayer {
  constructor(game, id, name, idx) {
    this.id = id; this.name = name || 'Baby';
    this.x = 0; this.z = 0; this.yaw = 0;
    this.crawling = false; this.hidden = false; this.downed = false;
    this.torch = false; this.health = 100; this.dead = false;
    this.model = makeBaby(BABY_COLORS[idx % BABY_COLORS.length], OUTFIT_COLORS[idx % OUTFIT_COLORS.length]);
    this.animT = 0; this.speed = 0;
    this.lastX = 0; this.lastZ = 0;
    game.renderer.scene.add(this.model);
  }
  apply(s) {
    this.lastX = this.x; this.lastZ = this.z;
    this.x = s.x; this.z = s.z; this.yaw = s.yaw;
    this.crawling = !!s.c; this.hidden = !!s.h; this.downed = !!s.d;
    this.torch = !!s.t; this.health = s.hp;
  }
  update(dt) {
    this.animT += dt;
    const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
    this.speed = lerp(this.speed, moved / Math.max(dt, 0.001), 0.25);
    this.lastX = this.x; this.lastZ = this.z;
    this.model.visible = !this.hidden;
    this.model.position.set(this.x, this.downed ? -0.18 : 0, this.z);
    this.model.rotation.y = this.yaw + Math.PI;
    this.model.rotation.x = this.downed ? -1.2 : 0;
    this.model.scale.setScalar(this.crawling && !this.downed ? 0.8 : 1);
    animateWalk(this.model, this.animT, this.speed);
  }
}

// ---------------------------------------------------------------- game

class Game {
  constructor() {
    this.settings = Object.assign(
      { sens: 1.0, fov: 78, vol: 0.7, quality: 'med', invert: false, name: '' },
      JSON.parse(localStorage.getItem(SET_KEY) || '{}'));

    initTextures();
    this.renderer = new Renderer($('#game'), this.settings);
    this.sfx = new Sfx();
    this.sfx.setVolume(this.settings.vol);
    this.ui = new UI(this);
    this.net = new Net(this);

    this.school = null;
    this.built = null;
    this.player = new Player(this);
    this.remotePlayers = new Map();
    this.switches = [];
    this.fusebox = null;
    this.running = false;
    this.paused = false;
    this.state = 'menu';
    this.score = 0;
    this.night = 1;
    this.phase = 'day';
    this.phaseTime = 0;
    this.escapeOpen = false;
    this.drawingsFound = 0;
    this.talkedToday = false;
    this.noiseEvents = [];
    this.brightCache = { t: -1, v: 0 };
    this.snapT = 0;
    this.posT = 0;
    this.lastStep = performance.now();
    this.input = {
      fwd: 0, right: 0, sprint: false, crawl: false, peek: false,
      lookX: 0, lookY: 0, interact: false, secondary: false
    };
    this.holdT = 0;
    this.lastInteraction = null;

    this.bindUi();
    this.bindInput();
    this.ui.screen('menu');
    this.loadVoices();
    this.startWatchdog();
    requestAnimationFrame(() => this.loop());
  }

  async loadVoices() {
    // Fire and forget: if the clips fail, Grump falls back to synth noises.
    try {
      await this.sfx.loadVoices({
        greeting: 'audio/grump-greeting.ogg',
        mean: 'audio/grump-mean.ogg',
        angry: 'audio/grump-angry.ogg',
        kidLine: 'audio/kid-line.ogg',
        kidScream: 'audio/kid-scream.ogg',
        bobClass: 'audio/bob-class.ogg',
        bobScream: 'audio/bob-scream.ogg'
      });
    } catch (e) { /* synth fallback is fine */ }
  }

  get isHost() { return !this.net.online || this.net.isHost; }

  // ================================================================= setup

  bindUi() {
    document.querySelectorAll('[data-go]').forEach(b => {
      b.onclick = () => {
        this.sfx.resume(); this.sfx.click();
        const go = b.dataset.go;
        if (go === 'play') this.startGame({ solo: true });
        else if (go === 'settings' && this.running) { this.ui.showPause(false); this.ui.screen('settings'); this.fromPause = true; }
        else if (go === 'menu' && this.fromPause) { this.fromPause = false; this.ui.hideScreens(); this.ui.showPause(true, this.net.code); }
        else this.ui.screen(go);
      };
    });

    // --- settings
    const s = this.settings;
    const bind = (id, key, fmt, apply) => {
      const el = $('#set-' + id), val = $('#val-' + id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!s[key]; else el.value = s[key];
      const sync = () => {
        s[key] = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? parseFloat(el.value) : el.value);
        if (val) val.textContent = fmt ? fmt(s[key]) : s[key];
        if (apply) apply(s[key]);
        localStorage.setItem(SET_KEY, JSON.stringify(s));
      };
      el.oninput = sync; el.onchange = sync; sync();
    };
    bind('sens', 'sens', v => v.toFixed(2));
    bind('fov', 'fov', v => v + '°', v => this.renderer.setFov(v));
    bind('vol', 'vol', v => Math.round(v * 100) + '%', v => this.sfx.setVolume(v));
    bind('quality', 'quality', null, v => this.renderer.setQuality(v));
    bind('invert', 'invert');

    // --- host / join
    $('#host-name').value = s.name || '';
    $('#join-name').value = s.name || '';
    $('#host-start').onclick = () => this.doHost();
    $('#join-go').onclick = () => this.doJoin();
    $('#copycode').onclick = () => {
      navigator.clipboard.writeText(this.net.code || '').then(() => this.ui.toast('Copied.'));
    };
    $('#join-code').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };

    // --- overlays
    $('#draw-close').onclick = () => { this.ui.closeDrawing(); this.resumeFromOverlay(); };
    $('#dawn-go').onclick = () => { this.ui.closeDawn(); this.resumeFromOverlay(); };
    $('#over-again').onclick = () => { this.ui.closeOver(); this.startGame(this.lastOpts); };
    $('#over-menu').onclick = () => { this.ui.closeOver(); this.quitToMenu(); };
    $('#pause-resume').onclick = () => this.setPaused(false);
    $('#pause-quit').onclick = () => { this.ui.showPause(false); this.quitToMenu(); };
  }

  bindInput() {
    const canvas = $('#game');
    canvas.addEventListener('click', () => {
      if (this.running && !this.paused && !this.overlayOpen()) {
        this.sfx.resume();
        this.lockPointer();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && this.running && !this.overlayOpen() && !this.paused) this.setPaused(true);
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.input.lookX += e.movementX;
      this.input.lookY += e.movementY * (this.settings.invert ? -1 : 1);
    });
    document.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) this.input.interact = true;
      if (e.button === 2) this.input.peek = true;
    });
    document.addEventListener('mouseup', e => {
      if (e.button === 0) this.input.interact = false;
      if (e.button === 2) this.input.peek = false;
    });
    document.addEventListener('contextmenu', e => { if (this.locked) e.preventDefault(); });

    const keys = this.keys = new Set();
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') {
        if (e.key === 'Enter') this.sendChat();
        if (e.key === 'Escape') this.ui.openChat(false);
        return;
      }
      const k = e.key.toLowerCase();
      if (keys.has(k)) return;
      keys.add(k);
      this.onKeyDown(k, e);
    });
    document.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      keys.delete(k);
      if (k === 'e') this.input.interact = false;
      if (k === 'tab') this.ui.setObjectives(false);
    });
    window.addEventListener('blur', () => { keys.clear(); this.input.fwd = this.input.right = 0; });
  }

  onKeyDown(k, e) {
    if (k === 'escape') {
      if (this.overlayOpen()) return;
      if (this.running) this.setPaused(!this.paused);
      return;
    }
    if (!this.running || this.paused) return;

    // dialogue answers by number
    if (this.dialogueOpen && '123'.includes(k)) {
      const b = this.ui.dlgButtons && this.ui.dlgButtons[parseInt(k, 10) - 1];
      if (b && !b.disabled) b.click();
      return;
    }
    if (this.overlayOpen()) {
      if (k === 'e' || k === ' ' || k === 'enter') {
        if (!$('#drawing').classList.contains('hidden')) $('#draw-close').click();
        else if (!$('#dawn').classList.contains('hidden')) $('#dawn-go').click();
      }
      return;
    }

    if (k === 'e') { this.input.interact = true; e.preventDefault(); }
    else if (k === 'r') this.onSecondary();
    else if (k === 'q') dropHands(this);
    else if (k === 'f') this.toggleTorch();
    else if (k === 'tab') { this.ui.setObjectives(true, this.objectivesHtml()); e.preventDefault(); }
    else if (k === 't' && this.net.online) { this.ui.openChat(true); document.exitPointerLock(); }
    else if (k >= '1' && k <= '6') this.player.selected = parseInt(k, 10) - 1;
  }

  // Pointer lock rejects in some embedded contexts; that is not an error worth
  // surfacing, the game just stays in click-to-look mode.
  lockPointer() {
    const r = $('#game').requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  }

  overlayOpen() {
    return !$('#dialogue').classList.contains('hidden')
      || !$('#drawing').classList.contains('hidden')
      || !$('#dawn').classList.contains('hidden')
      || !$('#over').classList.contains('hidden');
  }

  setPaused(on) {
    this.paused = on;
    this.ui.showPause(on, this.net.online ? this.net.code : null);
    if (!on) this.lockPointer();
  }

  resumeFromOverlay() {
    if (this.running && !this.paused) this.lockPointer();
  }

  // ================================================================= start

  doHost() {
    const name = ($('#host-name').value || 'Baby').slice(0, 12);
    this.settings.name = name;
    localStorage.setItem(SET_KEY, JSON.stringify(this.settings));
    $('#host-err').textContent = '';
    $('#host-start').disabled = true;
    $('#host-start').textContent = 'Opening…';
    this.net.host(code => {
      $('#hostcode').classList.remove('hidden');
      $('#hostcode b').textContent = code;
      $('#host-start').textContent = 'Start the day';
      $('#host-start').disabled = false;
      $('#host-start').onclick = () => this.startGame({
        nights: parseInt($('#host-nights').value, 10),
        diff: $('#host-diff').value,
        online: true, name
      });
      this.ui.toast('Room open. Share the code, then start.');
    }, err => {
      $('#host-err').textContent = err;
      $('#host-start').disabled = false;
      $('#host-start').textContent = 'Open the room';
    });
  }

  doJoin() {
    const code = $('#join-code').value.trim().toUpperCase();
    const name = ($('#join-name').value || 'Baby').slice(0, 12);
    if (code.length < 4) { $('#join-err').textContent = 'That code looks short.'; return; }
    this.settings.name = name;
    localStorage.setItem(SET_KEY, JSON.stringify(this.settings));
    $('#join-err').textContent = '';
    $('#join-go').disabled = true;
    this.ui.loading(true, 'Knocking…');
    this.net.join(code, () => {
      this.myName = name;
      this.net.send({ t: 'hello', name });
      this.ui.loading(true, 'Waiting for the host to start…');
    }, err => {
      this.ui.loading(false);
      $('#join-err').textContent = err;
      $('#join-go').disabled = false;
    });
  }

  startGame(opts = {}) {
    this.lastOpts = opts;
    const diff = DIFF[opts.diff || 'normal'] || DIFF.normal;
    this.diff = diff;
    this.diffName = opts.diff || 'normal';
    this.requiredNights = opts.nights || 5;
    this.myName = opts.name || this.settings.name || 'Baby';
    this.seed = opts.seed !== undefined ? opts.seed : (Math.random() * 0xffffffff) >>> 0;

    this.ui.loading(true, 'Unlocking the school…');
    this.ui.hideScreens();
    // Any leftover overlay would block update() entirely -- the game would run
    // its render loop and simulate nothing at all.
    this.ui.closeOver();
    this.ui.closeDawn();
    this.ui.closeDrawing();
    this.ui.closeDialogue();
    this.ui.showPause(false);
    this.dialogueOpen = false;
    this.paused = false;

    // Build on the next frame so the loading card actually paints.
    setTimeout(() => {
      this.buildWorld(this.seed);
      this.night = opts.night || 1;
      this.phase = 'day';
      this.phaseTime = diff.day;
      this.score = 0;
      this.escapeOpen = false;
      this.drawingsFound = 0;
      this.state = 'play';
      this.running = true;
      this.paused = false;
      this.ui.loading(false);
      this.ui.showHud(true);

      if (this.isHost) {
        this.beginDay(true);
        if (this.net.online) this.broadcastWorld();
      }
      this.lockPointer();
      this.sfx.resume();
      this.ui.bigLine('DAY 1');
      this.ui.toast('Everyone went home. Find the boiler room.');
    }, 60);
  }

  buildWorld(seed) {
    if (this.built) this.built.dispose();
    if (this.toddlers) this.toddlers.clear();
    if (this.messes) this.messes.clear();
    if (this.groundItems) this.groundItems.clearAll();
    if (this.portableLights) this.portableLights.clearAll();
    for (const rp of this.remotePlayers.values()) this.renderer.scene.remove(rp.model);
    if (this.bob) this.renderer.scene.remove(this.bob.model);
    if (this.grump) this.renderer.scene.remove(this.grump.model);
    if (this.cardKid) this.cardKid.dispose();
    resetMaterials();

    this.school = generateSchool(seed);
    // Work out what is standable, prune any furniture that seals off a pocket,
    // and only then build the geometry -- so removed props are never drawn.
    this.collider = buildCollider(this.school);
    computeNavBlocking(this.school, this.collider);
    if (repairConnectivity(this.school)) {
      this.collider = buildCollider(this.school);
      computeNavBlocking(this.school, this.collider);
    }
    this.built = buildSchool(this.school, this.renderer.scene);
    this.nav = new Nav(this.school);

    this.toddlers = new Toddlers(this);
    this.messes = new Messes(this);
    this.groundItems = new GroundItems(this);
    this.portableLights = new PortableLights(this);

    const genProp = this.school.props.find(p => p.generator);
    this.generator = new Generator(this, genProp);
    this.fusebox = this.school.props.find(p => p.fusebox) || null;

    this.grump = new Grump(this);
    this.bob = new Bob(this);
    this.cardKid = new CardKid(this);

    this.buildSwitches();

    // Player starts in their own classroom, which is the one room they can trust.
    const home = this.school.home;
    this.player = new Player(this);
    this.player.x = home.cx; this.player.z = home.cz;
    this.player.yaw = 0;
    this.player.give('flashlight');
    this.player.torchBattery = 60;

    // The school is closed, so most of it starts dark. Deciding which rooms are
    // worth the fuel is the whole light-management game.
    for (const r of this.school.rooms) {
      r.lightsOn = r === home || r.type === 'hall' || r.type === 'boiler';
    }
    this.applyPower();
  }

  // A light switch on the wall beside each room's first door.
  buildSwitches() {
    this.switches = [];
    const geo = new THREE.BoxGeometry(0.14, 0.2, 0.05);
    const mat = materialFor('c:e8e4d8');
    const place = (x, z, room) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 1.25, z);
      this.renderer.scene.add(m);
      this.switches.push({ x, z, room, mesh: m });
    };
    for (const r of this.school.rooms) {
      if (r.outdoor) continue;
      if (r.type === 'hall') {
        place(r.cx, this.school.wz(r.y0) + 0.36, r);
        continue;
      }
      const d = this.school.doors.find(dd => r.doors.includes(dd.id));
      if (!d) { place(r.cx, r.cz, r); continue; }
      const insideB = d.b === r.id;
      if (d.dir === 'w') place(d.x + (insideB ? 0.34 : -0.34), d.z + 0.85, r);
      else place(d.x + 0.85, d.z + (insideB ? 0.34 : -0.34), r);
    }
  }

  quitToMenu() {
    this.running = false;
    this.state = 'menu';
    this.net.close();
    this.remotePlayers.clear();
    this.sfx.setGenerator(false, 0);
    this.sfx.setDrone(0);
    this.ui.showHud(false);
    this.ui.screen('menu');
    document.exitPointerLock();
  }

  // ================================================================= phases

  beginDay(first) {
    this.phase = 'day';
    this.phaseTime = this.diff.day;
    this.talkedToday = false;
    // Day 4 is when he stops asking. If the player has already pushed him that
    // far, it simply happens sooner.
    const justTurned = this.grump.checkSchedule(this.night);
    this.grump.beginDay(this);
    if (justTurned) {
      this.ui.bigLine('GRUMP THE BABY DESTROYER');
      this.sfx.grumpReveal();
      this.sfx.voice('angry');
      this.ui.toast('He is not asking questions any more. He is in the building with you.');
    }
    if (this.cardKid) this.cardKid.resetPhase();
    this.bob.deactivate();
    this.messes.spawnForDay(this.night, this.seed);
    this.toddlers.spawnForDay(this.night, this.seed);
    for (const p of this.school.props) { p.searched = false; p.checked = false; }
    // Seed a few useful things where a desperate baby will actually look.
    if (first) {
      this.spawnGroundItem('fuel', this.school.boiler.cx + 1.4, this.school.boiler.cz + 1.0);
      this.spawnGroundItem('part', this.school.boiler.cx - 1.4, this.school.boiler.cz - 0.8);
    }
    this.sfx.phaseDay();
    this.sfx.setDrone(0);
    this.applyPower();
    this.netEvent({ k: 'phase', phase: 'day', night: this.night });
  }

  beginNight() {
    this.phase = 'night';
    this.phaseTime = this.diff.night;

    // Everything you did not do today is charged at the door.
    let anger = this.diff.anger;
    if (!this.talkedToday) anger += 6;
    anger += this.messes.remaining * 0.8;
    this.grump.anger(anger, this, 'nightfall');

    // Whoever is still out in the building does not stay out there alone.
    const takenNames = [];
    const outCount = this.toddlers.lost;
    for (let i = 0; i < outCount; i++) {
      const t = this.toddlers.takeOne(this);
      if (t) takenNames.push(t.name);
    }
    if (takenNames.length) {
      this.grump.anger(-2 * takenNames.length, this, 'fed');
      this.ui.bigLine(takenNames.join(' and ') + '\nis not here any more');
      this.sfx.stinger();
    }

    for (const d of this.school.doors) if (d.yard) { d.locked = true; this.toggleDoor(d, false); }
    if (this.night >= this.diff.bobFrom) this.bob.activate(this.night);
    this.grump.beginNight(this);
    if (this.cardKid) this.cardKid.resetPhase();
    this.sfx.phaseNight();
    this.sfx.setDrone(0.5);
    this.ui.bigLine('NIGHT ' + this.night);
    this.ui.toast('Get to your classroom. Keep the lights on.');
    this.netEvent({ k: 'phase', phase: 'night', night: this.night });
  }

  endNight() {
    const survivedNight = this.night;
    this.bob.deactivate();
    this.sfx.setDrone(0);

    const lines = [];
    lines.push([`Night ${survivedNight} survived.`, 'good']);
    lines.push([`Little ones safe: ${this.toddlers.saved}`, this.toddlers.saved ? 'good' : '']);
    lines.push([`Generator: ${Math.round(this.generator.fuel)}% fuel, ${Math.round(this.generator.condition)}% condition`,
      this.generator.fuel < 25 ? 'bad' : '']);
    lines.push([`Grump: ${this.grumpMood()}`, this.grump.resent >= 75 ? 'bad' : '']);
    lines.push([`Score: ${Math.round(this.score)}`, '']);

    this.score += 200 + this.toddlers.saved * 60;
    this.night++;

    if (this.night > this.requiredNights && !this.escapeOpen) {
      this.escapeOpen = true;
      for (const d of this.school.exitDoors) d.locked = false;
      lines.push(['The chains on the front doors are gone.', 'good']);
      this.ui.showDawn('The front doors are open.', 'YOU MADE IT', lines);
      this.sfx.win();
    } else {
      this.ui.showDawn(`Day ${this.night}.`, 'THE SUN COMES UP', lines);
      this.sfx.phaseDay();
    }
    document.exitPointerLock();
    this.beginDay(false);
  }

  grumpMood() {
    const r = this.grump.resent;
    if (this.grump.turned) return 'finished asking';
    return r >= 100 ? 'finished asking' : r >= 75 ? 'not speaking to you'
      : r >= 50 ? 'cold' : r >= 22 ? 'keeping score' : 'friendly, apparently';
  }

  // ================================================================= loop

  loop() {
    requestAnimationFrame(() => this.loop());
    this.step();
  }

  // Some embedded viewers -- and any backgrounded tab -- stall
  // requestAnimationFrame entirely. A slow watchdog keeps the night clock
  // running so the game can never silently freeze mid-night.
  startWatchdog() {
    setInterval(() => {
      if (performance.now() - this.lastStep > 220) this.step();
    }, 100);
  }

  step() {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastStep) / 1000));
    this.lastStep = now;
    if (!this.running) { this.renderer.render(); return; }

    if (!this.paused && !this.overlayOpen()) this.update(dt);
    else { this.input.fwd = 0; this.input.right = 0; }

    this.player.applyCamera(this.renderer.camera, dt);
    this.renderer.updateLights(this.school.fixtures, this.renderer.camera.position);
    this.updateTorches();
    this.renderer.render();
  }

  update(dt) {
    // --- input axes
    const k = this.keys;
    this.input.fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    this.input.right = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    this.input.sprint = k.has('shift');
    this.input.crawl = k.has('control');

    // --- phase clock (host owns it)
    if (this.isHost) {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) {
        if (this.phase === 'day') this.beginNight();
        else this.endNight();
      }
      if (this.phase === 'day' && Math.abs(this.phaseTime - 30) < dt) {
        this.ui.bigLine('IT IS GETTING DARK');
        this.sfx.stinger();
      }
    }

    this.player.update(dt, this.input, this);
    this.handleInteraction(dt);

    if (this.isHost) {
      this.generator.update(dt, this);
      this.grump.update(dt, this);
      this.bob.update(dt, this);
      this.toddlers.update(dt, this);
      this.flushNoise();
    } else {
      this.toddlers.update(dt, this);
    }
    this.cardKid.update(dt, this);

    this.groundItems.update(dt);
    this.portableLights.update(dt);
    for (const rp of this.remotePlayers.values()) rp.update(dt);
    this.animateDoors(dt);

    // --- mood
    const lightHere = this.roomBrightness(this.player.x, this.player.z);
    const daylight = this.phase === 'day'
      ? clamp(0.35 + this.phaseTime / this.diff.day * 0.65, 0.3, 1)
      : 0.02;
    this.renderer.setMood(daylight, this.generator.running, this.player.fear / 100);
    this.sfx.updateHeartbeat(dt, this.player.fear / 100);
    if (this.phase === 'night') {
      this.sfx.setDrone(0.35 + (1 - lightHere) * 0.45 + this.threatPressure(this.player.x, this.player.z) * 0.5);
    }

    this.ui.update(dt, this);
    if (this.keys.has('tab')) this.ui.setObjectives(true, this.objectivesHtml());

    // --- networking
    if (this.net.online) {
      this.posT -= dt;
      if (this.posT <= 0) {
        this.posT = 0.075;
        if (!this.isHost) this.net.send({ t: 'pos', s: this.player.serialize() });
      }
      if (this.isHost) {
        this.snapT -= dt;
        if (this.snapT <= 0) { this.snapT = 0.085; this.sendSnapshot(); }
      }
    }
  }

  updateTorches() {
    const p = this.player;
    const f = p.forward();
    this.renderer.setTorch(p.torchOn && !p.hidden, clamp(p.torchBattery / 40, 0.2, 1),
      this.renderer.camera.position, f);

    if (this.bob && this.bob.active) {
      const yaw = this.bob.yaw + this.bob.sweep;
      const dir = new THREE.Vector3(Math.sin(yaw), -0.22, Math.cos(yaw)).normalize();
      const pos = new THREE.Vector3(this.bob.x + dir.x * 0.4, 1.05, this.bob.z + dir.z * 0.4);
      this.renderer.setBobTorch(true, pos, dir, 14);
    } else this.renderer.setBobTorch(false);
  }

  animateDoors(dt) {
    for (const d of this.school.doors) {
      if (!d.mesh) continue;
      const target = d.open ? 1 : 0;
      d.swing = lerp(d.swing, target, Math.min(1, dt * 7));
      for (const pivot of d.mesh.children) {
        pivot.rotation.y = d.swing * 1.45 * (pivot.userData.swingSign || 1);
      }
    }
  }

  // ================================================================= actions

  handleInteraction(dt) {
    // While the boy is talking there is nothing to do but stand there.
    if (this.cardKid && this.cardKid.speaking) {
      this.holdT = 0;
      this.lastInteraction = null;
      this.ui.setPrompt({ label: 'You cannot say anything', hint: 'You are a baby. He does not mind.', key: '—', hold: 0 }, 0);
      return;
    }
    const inter = findInteraction(this);
    this.lastInteraction = inter;
    if (!inter) { this.holdT = 0; this.ui.setPrompt(null); return; }

    if (this.input.interact) {
      if (!inter.hold) {
        if (!this.firedTap) { this.firedTap = true; inter.act(); }
      } else {
        this.holdT += dt;
        if (this.player.hidden === null && Math.random() < dt * 3) this.sfx.searchTick();
        if (this.holdT >= inter.hold) {
          this.holdT = 0;
          this.firedTap = true;
          inter.act();
        }
      }
    } else {
      this.firedTap = false;
      this.holdT = Math.max(0, this.holdT - dt * 2.5);
    }
    this.ui.setPrompt(inter, this.holdT);
  }

  onSecondary() {
    // R takes the prompt's second option when there is one -- hiding rather than
    // searching, taping a locker shut. It fires immediately even where E would
    // hold, because the second option is always the panic option.
    const inter = this.lastInteraction;
    if (inter && inter.extra) { inter.extra.act(); return; }
    useSelected(this);
  }

  toggleTorch() {
    const p = this.player;
    if (!p.hasItem('flashlight')) { this.ui.toast('You have no torch.'); this.sfx.deny(); return; }
    if (p.torchBattery <= 0) { this.ui.toast('Flat battery.'); this.sfx.deny(); return; }
    p.torchOn = !p.torchOn;
    this.sfx.click();
  }

  searchProp(prop) {
    if (prop.searched) return;
    if (!this.isHost) { this.net.send({ t: 'act', k: 'search', id: prop.id }); prop.searched = true; return; }
    const found = this.doSearch(prop, this.player);
    this.netEvent({ k: 'search', id: prop.id, found, by: this.net.myId });
  }

  doSearch(prop, who) {
    prop.searched = true;
    const rng = makeRng(hashStr(this.seed + ':' + prop.id + ':' + this.night));
    const found = rollLoot(prop.search, rng, this.night);
    if (who === this.player) {
      this.player.stats.searched++;
      this.score += 8;
      if (found) {
        if (this.player.give(found)) {
          this.sfx.pickup();
          this.ui.toast(`Found: ${itemName(found)}`);
        } else {
          this.spawnGroundItem(found, this.player.x, this.player.z);
          this.ui.toast(`Found ${itemName(found)} — no room, dropped it.`);
        }
      } else {
        this.sfx.searchTick();
        this.ui.toast('Nothing in there.');
      }
    }
    this.emitNoise(prop.x, prop.z, prop.search === 'locker' ? 0.55 : 0.35, 'search');
    return found;
  }

  hideIn(prop) {
    this.player.enterHide(prop, this);
  }

  spawnGroundItem(kind, x, z) {
    const it = this.groundItems.spawn(kind, x, z);
    if (this.isHost && this.net.online) this.netEvent({ k: 'drop', id: it.id, kind, x, z });
    return it;
  }

  pickUpGroundItem(it) {
    if (!this.player.give(it.kind)) {
      this.ui.toast(isBig(it.kind) ? 'Your hands are full.' : 'Your bag is full.');
      this.sfx.deny();
      return;
    }
    this.sfx.pickup();
    this.ui.toast(itemName(it.kind));
    this.groundItems.remove(it);
    if (this.net.online) this.net.send({ t: 'act', k: 'take', id: it.id });
  }

  carryToddler(t) {
    if (!this.player.handsFree) { this.sfx.deny(); return; }
    this.toddlers.pickUp(t, this);
    this.player.hands = { toddler: t.id };
    if (this.net.online) this.net.send({ t: 'act', k: 'carry', id: t.id });
  }

  putDownToddler() {
    const id = this.player.hands && this.player.hands.toddler;
    if (id === undefined) return;
    const t = this.toddlers.byId(id);
    this.player.hands = null;
    if (t) {
      const f = this.player.forward();
      this.toddlers.place(t, this.player.x + f.x * 0.7, this.player.z + f.z * 0.7, this);
    }
    if (this.net.online) this.net.send({ t: 'act', k: 'drop_toddler', id });
  }

  releaseToddler(id, x, z) {
    const t = this.toddlers.byId(id);
    if (t) this.toddlers.place(t, x, z, this);
  }

  carrierOf(id) {
    if (this.player.carryingToddler && this.player.hands.toddler === id) return this.player;
    for (const rp of this.remotePlayers.values()) if (rp.carrying === id) return rp;
    return null;
  }

  placeLight(kind, x, z) {
    this.portableLights.place(kind, x, z);
    if (this.net.online) this.net.send({ t: 'act', k: 'light', kind, x, z });
  }

  readDrawing() {
    const page = DRAWINGS[Math.min(this.drawingsFound, DRAWINGS.length - 1)];
    this.drawingsFound++;
    this.score += 60;
    this.player.stats.drawings++;
    document.exitPointerLock();
    this.ui.showDrawing(page);
    this.sfx.ding();
  }

  toggleDoor(d, open) {
    if (d.locked && open) { this.sfx.deny(); return; }
    d.open = open;
    if (d.box) d.box.active = !open;
    this.sfx.doorMove(open);
    this.emitNoise(d.x, d.z, 0.4, 'door');
    if (this.net.online) this.netEvent({ k: 'door', id: d.id, open, locked: d.locked });
  }

  aiOpenDoor(d) {
    if (d.open) return;
    if (d.locked) return;
    d.open = true;
    if (d.box) d.box.active = false;
    const dd = dist2(d.x, d.z, this.player.x, this.player.z);
    if (dd < 24) this.sfx.doorMove(true);
    if (this.net.online && this.isHost) this.netEvent({ k: 'door', id: d.id, open: true, locked: d.locked });
  }

  escape() {
    this.running = false;
    document.exitPointerLock();
    const total = Math.round(this.score + this.toddlers.saved * 150 + this.night * 100);
    this.sfx.win();
    this.sfx.setDrone(0);
    this.sfx.setGenerator(false, 0);
    this.ui.showOver('YOU GOT OUT', 'The gate closes behind you. Nobody follows.', [
      `Nights survived: <b>${this.night - 1}</b>`,
      `Little ones carried out: <b>${this.toddlers.saved}</b>`,
      `Drawings found: <b>${this.player.stats.drawings}</b> of ${DRAWINGS.length}`,
      `Grump, at the end: <b>${this.grumpMood()}</b>`,
      `Final score: <b>${total}</b>`
    ]);
  }

  // ================================================================= light

  applyPower() {
    const on = this.generator.running;
    for (const f of this.school.fixtures) {
      if (f.portable) continue;
      const r = this.school.rooms[f.room];
      f.on = on && r && r.lightsOn !== false;
      f.flicker = on && this.generator.condition < 45 ? 1 : 0;
    }
    if (this.built) {
      for (const f of this.school.fixtures) {
        if (!f.mesh || f.portable) continue;
        f.mesh.material = f.on ? this.built.panelMat : this.built.panelOff;
      }
    }
  }

  onPowerChanged(on) {
    this.applyPower();
    if (this.net.online && this.isHost) this.netEvent({ k: 'gen', on });
  }

  setRoomLights(room, on, by) {
    room.lightsOn = on;
    this.applyPower();
    if (by === 'player') this.sfx[on ? 'lightOn' : 'lightOff']();
    if (this.net.online) this.netEvent({ k: 'lights', room: room.id, on });
  }

  resetBreakers() {
    // The school is closed, so most of it starts dark. Deciding which rooms are
    // worth the fuel is the whole light-management game.
    for (const r of this.school.rooms) {
      r.lightsOn = r === home || r.type === 'hall' || r.type === 'boiler';
    }
    this.applyPower();
    this.sfx.lightOn();
    this.ui.toast('Every light in the school comes on.');
    this.emitNoise(this.fusebox.x, this.fusebox.z, 0.6, 'breaker');
    if (this.net.online) this.netEvent({ k: 'breakers' });
  }

  // Brightness at a point: ceiling fixtures light only their own room, portable
  // lights leak anywhere. This one number drives fear, Bob and Grump.
  roomBrightness(x, z) {
    const room = this.school.roomAt(x, z);
    let b = 0;
    if (this.phase === 'day') b = room && room.outdoor ? 1 : 0.72;
    for (const f of this.school.fixtures) {
      if (!f.on || f.broken) continue;
      if (!f.portable) {
        if (!room || f.room !== room.id) continue;
        const d = Math.hypot(f.x - x, f.z - z);
        b = Math.max(b, clamp(1.25 - d / (f.pole ? 14 : 9), 0, 1));
      } else {
        const d = Math.hypot(f.x - x, f.z - z);
        b = Math.max(b, f.power * clamp(1 - d / f.radius, 0, 1));
      }
    }
    return clamp(b, 0, 1);
  }

  roomLit(room) { return this.roomBrightness(room.cx, room.cz); }

  darkRoom() {
    const cands = this.school.rooms.filter(r => !r.outdoor && this.roomLit(r) < 0.3);
    if (!cands.length) return this.school.rooms.find(r => r.type === 'boiler');
    return cands[(Math.random() * cands.length) | 0];
  }

  // ================================================================= threats

  threatTargets() {
    const out = [this.player];
    for (const rp of this.remotePlayers.values()) if (!rp.dead) out.push(rp);
    return out;
  }
  targetById(id) {
    if (id === this.player.id || id === undefined || id === null) return this.player;
    return this.remotePlayers.get(id) || this.player;
  }
  huntTarget(grump) {
    // Grump prefers whoever is least protected by light.
    let best = null, bestScore = -1;
    for (const t of this.threatTargets()) {
      if (t.dead) continue;
      const d = dist2(grump.x, grump.z, t.x, t.z);
      const lit = this.roomBrightness(t.x, t.z);
      const s = (1 - lit) * 2 + clamp(1 - d / 60, 0, 1) + (t.hidden ? -0.6 : 0);
      if (s > bestScore) { bestScore = s; best = t; }
    }
    return best;
  }

  // How close the nearest threat feels. Drives fear and the drone.
  threatPressure(x, z) {
    let p = 0;
    if (this.bob && this.bob.active) {
      const d = dist2(x, z, this.bob.x, this.bob.z);
      p = Math.max(p, clamp(1 - d / 18, 0, 1) * (this.bob.state === 'chase' ? 1.6 : 0.7));
    }
    if (this.grump) {
      const d = dist2(x, z, this.grump.x, this.grump.z);
      const w = this.grump.hunting ? 1.7 : this.grump.state === 'stalk' ? 0.9 : 0.3;
      p = Math.max(p, clamp(1 - d / 20, 0, 1) * w);
    }
    return clamp(p, 0, 1.6);
  }

  emitNoise(x, z, level, src) {
    if (level <= 0.02) return;
    this.noiseEvents.push({ x, z, level, src });
  }

  flushNoise() {
    for (const n of this.noiseEvents) {
      if (this.bob && this.bob.active) this.bob.hearNoise(n.x, n.z, n.level, this);
      if (this.grump) this.grump.hearNoise(n.x, n.z, n.level, this);
    }
    this.noiseEvents.length = 0;
  }

  nearestHideSpot(x, z, maxD) {
    let best = null, bd = maxD;
    for (const p of this.school.props) {
      if (!p.hide) continue;
      const d = dist2(x, z, p.x, p.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  occupantOf(prop) {
    if (this.player.hidden === prop) {
      if (this.player.tapedIn > 0) { this.ui.toast('The door holds.'); return null; }
      this.player.exitHide(this);
      return this.player;
    }
    return null;
  }

  // ---- consequences

  onBobGrab(t) {
    if (t !== this.player) return;
    const p = this.player;
    p.hurt(28, this, 'bob');
    const n = p.dropAll(this);
    const lf = this.school.lostfound;
    p.x = lf.cx; p.z = lf.cz;
    p.hidden = null;
    p.fear = Math.min(100, p.fear + 30);
    this.ui.flash('spotted');
    this.ui.bigLine('LOST AND FOUND');
    this.ui.toast(n ? `Bob took ${n} of your things.` : 'Bob put you back where you belong.');
  }

  onGrumpCatch(t) {
    if (t !== this.player) return;
    const p = this.player;
    this.ui.flash('grump');
    p.hurt(62, this, 'grump');
    p.fear = 100;
    // He takes one of the children with him.
    const safe = this.toddlers.list.filter(x => x.state === 'safe');
    if (safe.length && Math.random() < 0.7) {
      const t2 = safe[(Math.random() * safe.length) | 0];
      t2.state = 'taken';
      t2.model.visible = false;
      this.score -= 100;
      this.ui.bigLine(t2.name.toUpperCase() + ' IS GONE');
    } else {
      this.ui.bigLine('HE FOUND YOU');
    }
  }

  onPlayerDowned(source) {
    this.ui.bigLine('YOU CANNOT GET UP');
    if (this.net.online) this.net.send({ t: 'act', k: 'downed' });
  }

  onPlayerDead() {
    this.running = false;
    document.exitPointerLock();
    this.sfx.lose();
    this.sfx.setDrone(0);
    this.sfx.setGenerator(false, 0);
    const s = this.player.stats;
    this.ui.showOver('THE SCHOOL KEEPS YOU', 'Bob will put you in Lost and Found in the morning.', [
      `Nights survived: <b>${this.night - 1}</b>`,
      `Little ones safe: <b>${this.toddlers.saved}</b>`,
      `Containers searched: <b>${s.searched}</b> · Messes cleaned: <b>${s.cleaned}</b>`,
      `Drawings found: <b>${s.drawings}</b> of ${DRAWINGS.length}`,
      `Score: <b>${Math.round(this.score)}</b>`
    ]);
  }

  onGrumpStageUp(stage, why) {
    const lines = [
      '', 'HE IS KEEPING SCORE', 'HE HAS STOPPED SMILING',
      'HE KNOWS WHERE YOU SLEEP', 'GRUMP THE BABY DESTROYER'
    ];
    if (lines[stage]) {
      this.ui.bigLine(lines[stage]);
      this.sfx.grumpReveal();
      if (stage >= 4) this.sfx.voice('angry');
    }
  }

  requestRevive(rp) {
    this.net.send({ t: 'act', k: 'revive', id: rp.id });
    this.ui.toast(`${rp.name} is up.`);
  }

  fuelTimeLeft() {
    const r = this.generator.burnRate(this);
    return fmtTime(this.generator.fuel / Math.max(r, 0.01)) + ' of burn';
  }

  // ================================================================= grump talk

  tryTalkToGrump() {
    const g = this.grump;
    if (g.hunting || g.turned) {
      this.ui.subtitle('Grump: "' + 'No more questions.' + '"');
      this.sfx.grumpAngry();
      return;
    }
    g.busy = true;
    this.talkedToday = true;
    this.dialogueOpen = true;
    document.exitPointerLock();
    const rng = makeRng(hashStr(this.seed + ':q:' + this.night + ':' + Math.floor(g.resent)));
    this.askedQs = this.askedQs || new Set();
    const q = pickQuestion(g.resent, this.askedQs, rng);
    this.askedQs.add(q.q);
    this.sfx.voice('greeting');
    this.ui.showDialogue(q, g.resent, (ans) => {
      g.anger(ans.r, this, 'answer');
      this.sfx.voice(g.stage >= 3 ? 'angry' : 'mean');
      this.ui.showDialogueReply(ans.reply, g.resent, () => {
        this.ui.closeDialogue();
        this.dialogueOpen = false;
        g.busy = false;
        g.talkCd = 25;
        this.resumeFromOverlay();
      });
    });
  }

  objectivesHtml() {
    const g = this.generator;
    const rows = [];
    rows.push(`<h5>Today</h5>`);
    rows.push(`<div class="${g.fuel > 55 ? 'done' : ''}">Fuel the generator — ${Math.round(g.fuel)}%</div>`);
    rows.push(`<div class="${g.condition > 75 ? 'done' : ''}">Repair the generator — ${Math.round(g.condition)}%</div>`);
    rows.push(`<div class="${this.messes.remaining === 0 ? 'done' : ''}">Clean up — ${this.messes.remaining} left</div>`);
    rows.push(`<div class="${this.toddlers.lost === 0 ? 'done' : ''}">Carry the little ones home — ${this.toddlers.lost} still out</div>`);
    rows.push(`<div class="${this.talkedToday ? 'done' : 'warn'}">Talk to Grump ${this.talkedToday ? '' : '(ignoring him is worse)'}</div>`);
    rows.push(`<h5 style="margin-top:8px">Tonight</h5>`);
    rows.push(`<div>Night ${this.night} of ${this.requiredNights}</div>`);
    rows.push(`<div>Grump is ${this.grumpMood()}</div>`);
    if (!this.grump.turned) {
      const left = Math.max(0, 4 - this.night);
      rows.push(`<div class="warn">${left ? `He stops asking in ${left} day${left === 1 ? '' : 's'}.` : 'He stops asking today.'}</div>`);
    } else {
      rows.push(`<div class="warn">He hunts you, day and night.</div>`);
    }
    if (this.escapeOpen) rows.push(`<div class="warn">The front doors are open.</div>`);
    return rows.join('');
  }

  // ================================================================= net

  broadcastWorld() {
    this.net.broadcast({
      t: 'world', seed: this.seed, nights: this.requiredNights, diff: this.diffName,
      night: this.night, phase: this.phase, phaseTime: this.phaseTime
    });
  }

  netEvent(ev) {
    if (!this.net.online) return;
    if (this.isHost) this.net.broadcast(Object.assign({ t: 'ev' }, ev));
    else this.net.send(Object.assign({ t: 'ev' }, ev));
  }

  sendSnapshot() {
    const players = [];
    players.push(Object.assign({ id: 'host', n: this.myName }, this.player.serialize()));
    for (const rp of this.remotePlayers.values()) {
      players.push({
        id: rp.id, n: rp.name, x: +rp.x.toFixed(2), z: +rp.z.toFixed(2), yaw: +rp.yaw.toFixed(2),
        c: rp.crawling ? 1 : 0, h: rp.hidden ? 1 : 0, d: rp.downed ? 1 : 0, t: rp.torch ? 1 : 0, hp: rp.health
      });
    }
    this.net.broadcast({
      t: 'snap',
      p: players,
      b: this.bob.active ? { x: +this.bob.x.toFixed(2), z: +this.bob.z.toFixed(2), y: +this.bob.yaw.toFixed(2), s: this.bob.state, w: +this.bob.sweep.toFixed(2) } : null,
      g: { x: +this.grump.x.toFixed(2), z: +this.grump.z.toFixed(2), y: +this.grump.yaw.toFixed(2), s: this.grump.state, r: Math.round(this.grump.resent) },
      gen: this.generator.serialize(),
      tod: this.toddlers.serialize(),
      it: this.groundItems.serialize(),
      ph: this.phase, pt: +this.phaseTime.toFixed(1), nt: this.night
    });
  }

  onPeerJoin(id) {
    if (!this.remotePlayers.has(id)) {
      const rp = new RemotePlayer(this, id, 'Baby', this.remotePlayers.size + 1);
      this.remotePlayers.set(id, rp);
    }
    this.ui.chat('<b>someone joins the school</b>');
    if (this.running) {
      this.net.sendTo(id, {
        t: 'world', seed: this.seed, nights: this.requiredNights, diff: this.diffName,
        night: this.night, phase: this.phase, phaseTime: this.phaseTime
      });
    }
  }

  onPeerLeave(id) {
    const rp = this.remotePlayers.get(id);
    if (rp) { this.renderer.scene.remove(rp.model); this.remotePlayers.delete(id); }
    this.ui.chat('<b>someone leaves</b>');
  }

  onHostGone() {
    this.ui.toast('The host closed the room.');
    this.quitToMenu();
  }

  sendChat() {
    const v = $('#chatinput').value.trim();
    this.ui.openChat(false);
    this.resumeFromOverlay();
    if (!v) return;
    this.net.send({ t: 'chat', n: this.myName, m: v });
    this.ui.chat(`<b>${this.myName}:</b> ${escapeHtml(v)}`);
  }

  onNetMessage(msg, from) {
    switch (msg.t) {
      case 'hello': {
        const rp = this.remotePlayers.get(from);
        if (rp) rp.name = String(msg.name || 'Baby').slice(0, 12);
        this.ui.chat(`<b>${rp ? rp.name : 'someone'} joins</b>`);
        break;
      }
      case 'world': {
        // A client builds the same school from the same number.
        this.ui.loading(false);
        this.startGame({
          seed: msg.seed, nights: msg.nights, diff: msg.diff,
          night: msg.night, online: true, name: this.myName
        });
        this.phase = msg.phase;
        this.phaseTime = msg.phaseTime;
        break;
      }
      case 'pos': {
        const rp = this.remotePlayers.get(from);
        if (rp) {
          rp.apply(msg.s);
          rp.carrying = msg.s.tod;
        }
        break;
      }
      case 'snap': this.applySnapshot(msg); break;
      case 'chat': this.ui.chat(`<b>${escapeHtml(String(msg.n).slice(0, 12))}:</b> ${escapeHtml(String(msg.m).slice(0, 120))}`); break;
      case 'ev': this.applyEvent(msg, from); break;
      case 'act': this.applyAction(msg, from); break;
    }
  }

  applySnapshot(m) {
    if (this.isHost || !this.running) return;
    for (const s of m.p) {
      if (s.id === this.net.myId) continue;
      let rp = this.remotePlayers.get(s.id);
      if (!rp) {
        rp = new RemotePlayer(this, s.id, s.n, this.remotePlayers.size + 1);
        this.remotePlayers.set(s.id, rp);
      }
      rp.name = s.n || rp.name;
      rp.apply(s);
    }
    if (m.b) {
      this.bob.x = m.b.x; this.bob.z = m.b.z; this.bob.yaw = m.b.y;
      this.bob.state = m.b.s; this.bob.sweep = m.b.w;
      this.bob.model.visible = true;
      this.bob.model.position.set(m.b.x, 0, m.b.z);
      this.bob.model.rotation.y = m.b.y + Math.PI;
    } else this.bob.model.visible = false;

    this.grump.x = m.g.x; this.grump.z = m.g.z; this.grump.yaw = m.g.y;
    this.grump.state = m.g.s;
    if (m.g.r !== Math.round(this.grump.resent)) this.grump.anger(m.g.r - this.grump.resent, this, 'sync');
    this.grump.faceModel();

    this.generator.fuel = m.gen.f;
    this.generator.condition = m.gen.c;
    if (!!m.gen.r !== this.generator.running) {
      this.generator.running = !!m.gen.r;
      this.sfx.setGenerator(this.generator.running, this.generator.condition / 100);
      if (!this.generator.running) { this.sfx.blackout(); this.ui.flash('blackout'); }
      this.applyPower();
    }

    this.toddlers.applySnapshot(m.tod);
    this.groundItems.applySnapshot(m.it);
    this.phase = m.ph; this.phaseTime = m.pt; this.night = m.nt;
  }

  applyEvent(m, from) {
    switch (m.k) {
      case 'search': {
        const p = this.school.props.find(pp => pp.id === m.id);
        if (p) p.searched = true;
        if (m.by === this.net.myId && m.found) {
          if (!this.player.give(m.found)) this.ui.toast('No room for it.');
          else { this.sfx.pickup(); this.ui.toast(`Found: ${itemName(m.found)}`); }
        }
        break;
      }
      case 'mess': { const mm = this.messes.list[m.id]; if (mm && !mm.done) this.messes.clean(mm, this); break; }
      case 'door': {
        const d = this.school.doors[m.id];
        if (d) { d.open = m.open; d.locked = m.locked; if (d.box) d.box.active = !m.open; }
        break;
      }
      case 'lights': { const r = this.school.rooms[m.room]; if (r) { r.lightsOn = m.on; this.applyPower(); } break; }
      case 'breakers': { for (const r of this.school.rooms) r.lightsOn = true; this.applyPower(); break; }
      case 'gen': { this.applyPower(); break; }
      case 'phase': {
        if (this.isHost) break;
        this.phase = m.phase; this.night = m.night;
        this.ui.bigLine(m.phase === 'night' ? 'NIGHT ' + m.night : 'DAY ' + m.night);
        this.sfx[m.phase === 'night' ? 'phaseNight' : 'phaseDay']();
        break;
      }
      case 'drop': if (!this.isHost) this.groundItems.spawn(m.kind, m.x, m.z, m.id); break;
    }
    if (this.isHost) this.net.broadcast(m, from);
  }

  // Host-side handling of a client's request.
  applyAction(m, from) {
    if (!this.isHost) return;
    const rp = this.remotePlayers.get(from);
    switch (m.k) {
      case 'search': {
        const p = this.school.props.find(pp => pp.id === m.id);
        if (!p || p.searched) return;
        const rng = makeRng(hashStr(this.seed + ':' + p.id + ':' + this.night));
        p.searched = true;
        const found = rollLoot(p.search, rng, this.night);
        this.emitNoise(p.x, p.z, 0.4, 'search');
        this.net.broadcast({ t: 'ev', k: 'search', id: p.id, found, by: from });
        break;
      }
      case 'take': {
        const it = this.groundItems.list.find(i => i.id === m.id);
        if (it) this.groundItems.remove(it);
        break;
      }
      case 'carry': { const t = this.toddlers.byId(m.id); if (t && rp) { t.state = 'carried'; t.model.visible = false; rp.carrying = m.id; } break; }
      case 'drop_toddler': {
        const t = this.toddlers.byId(m.id);
        if (t && rp) { rp.carrying = null; this.toddlers.place(t, rp.x, rp.z, this); }
        break;
      }
      case 'light': this.portableLights.place(m.kind, m.x, m.z); break;
      case 'downed': if (rp) rp.downed = true; break;
      case 'revive': {
        if (m.id === 'host') { this.player.revive(); }
        else { const r2 = this.remotePlayers.get(m.id); if (r2) r2.downed = false; }
        this.net.broadcast({ t: 'ev', k: 'revive', id: m.id });
        break;
      }
      case 'mess': { const mm = this.messes.list[m.id]; if (mm && !mm.done) { this.messes.clean(mm, this); this.net.broadcast({ t: 'ev', k: 'mess', id: m.id }); } break; }
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.addEventListener('DOMContentLoaded', () => {
  window.__GRUMP = new Game();
});
