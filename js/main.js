// Grump the Baby Destroyer -- entry point, game loop, and the glue that owns
// every subsystem.
//
// Co-op authority model, which everything below is organised around:
//   * The HOST owns the world: phase clock, generator, Bob, Grump, toddlers,
//     messes, loot, ground items, quests. It simulates all of it, always --
//     including while its own player has the pause menu open.
//   * A CLIENT owns only its own body. Anything it does to the world is sent to
//     the host as an `act`; the host applies it and the result comes back in a
//     snapshot or event. Nothing a client does is allowed to exist only on the
//     client's own screen.
//   * Anything that should be SEEN or HEARD goes through fx(), which plays it
//     locally and on every client, attenuated by each player's own position.
import * as THREE from 'three';
import { Renderer } from './render/renderer.js?v=2026-09-13d';
import { initTextures } from './render/textures.js?v=2026-09-13d';
import { buildSchool, materialFor, resetMaterials } from './world/build.js?v=2026-09-13d';
import { generateSchool } from './world/schoolgen.js?v=2026-09-13d';
import { buildCollider, computeNavBlocking, repairConnectivity } from './game/collide.js?v=2026-09-13d';
import { Nav } from './game/nav.js?v=2026-09-13d';
import { Player } from './game/player.js?v=2026-09-13d';
import { Bob, Grump } from './game/threats.js?v=2026-09-13d';
import { Toddlers } from './game/toddlers.js?v=2026-09-13d';
import { Generator, Messes, GroundItems, PortableLights } from './game/systems.js?v=2026-09-13d';
import { findInteraction, useSelected, dropHands } from './game/interact.js?v=2026-09-13d';
import { CardKid } from './game/cardkid.js?v=2026-09-13d';
import { Honeywell } from './game/honeywell.js?v=2026-09-13d';
import { Bullies } from './game/bullies.js?v=2026-09-13d';
import { Jerry } from './game/jerry.js?v=2026-09-13d';
import { Meredith } from './game/meredith.js?v=2026-09-13d';
import { Minigames } from './ui/minigames.js?v=2026-09-13d';
import { Quests } from './game/quests.js?v=2026-09-13d';
import { rollLoot, DRAWINGS, ITEMS, itemName, isBig, lunchboxContents } from './game/items.js?v=2026-09-13d';
import { pickQuestion } from './game/dialogue.js?v=2026-09-13d';
import { makeBaby, makeGrump, setGrumpStage, animateWalk, BABY_COLORS, OUTFIT_COLORS } from './render/models.js?v=2026-09-13d';
import { Sfx } from './audio/sfx.js?v=2026-09-13d';
import { UI } from './ui/ui.js?v=2026-09-13d';
import { MapView } from './ui/map.js?v=2026-09-13d';
import { Net } from './net/net.js?v=2026-09-13d';
import { clamp, lerp, dist2, makeRng, hashStr, fmtTime } from './util/util.js?v=2026-09-13d';

const SET_KEY = 'grump.settings.v1';

// One body per device. Every browser gets a random id the first time it runs
// the game; the host allows each id in a room once. (?device=name overrides it,
// for testing two players on one computer.)
const DEVICE_ID = (() => {
  const forced = new URLSearchParams(location.search).get('device');
  if (forced) return 'dev-' + forced.slice(0, 24);
  try {
    let id = localStorage.getItem('grump.device');
    if (!id) { id = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('grump.device', id); }
    return id;
  } catch (e) { return 'dev-' + Math.random().toString(36).slice(2); }
})();
const $ = s => document.querySelector(s);

const DIFF = {
  gentle: { day: 300, night: 150, anger: 8, bobFrom: 1 },
  normal: { day: 240, night: 180, anger: 11, bobFrom: 1 },
  nasty: { day: 205, night: 215, anger: 15, bobFrom: 1 }
};

// From night 5 each night rolls a twist; from night 10, two.
const NIGHT_MODS = [
  { id: 'storm', name: 'Storm', desc: 'Thunder outside. The lights stutter and the generator wears twice as fast.' },
  { id: 'overtime', name: 'Overtime', desc: 'Bob is on a double shift. He is faster, and he hears everything.' },
  { id: 'hungry', name: 'Hungry night', desc: 'The little ones get hungry twice as fast.' },
  { id: 'long', name: 'The long night', desc: 'This night lasts longer than the others.' },
  { id: 'closer', name: 'He is closer', desc: 'Grump starts the night outside your classroom.' },
  { id: 'cold', name: 'Cold night', desc: 'Your torch battery drains twice as fast.' }
];

// Client actions the host accepts for quest progress on trust.
// Bump on every release that changes the school layout or the network
// messages. Players on different versions build different schools (door and
// prop numbers stop matching), so co-op refuses to mix them.
export const GAME_VERSION = '2026-09-13d';

const CLIENT_QUEST_EVENTS = new Set(['eat', 'hide', 'drawing', 'lunch', 'gym']);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- remote peer

function makeNameTag(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(250, g.measureText(name).width + 28);
  g.fillRect(128 - w / 2, 12, w, 42);
  g.fillStyle = '#efe9dc';
  g.fillText(name, 128, 44);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(0.9, 0.225, 1);
  sprite.renderOrder = 10;
  return sprite;
}

class RemotePlayer {
  constructor(game, id, name, idx) {
    this.game = game;
    this.id = id;
    this.name = name || 'Baby';
    this.x = 0; this.z = 0; this.yaw = 0;
    this.crawling = false; this.hidden = false; this.downed = false; this.dead = false;
    this.torch = false; this.health = 100;
    this.hiddenPropId = null; this.taped = false; this.carrying = null;
    this.model = makeBaby(BABY_COLORS[idx % BABY_COLORS.length], OUTFIT_COLORS[idx % OUTFIT_COLORS.length]);
    this.setName(this.name);
    this.animT = 0; this.speed = 0;
    this.lastX = 0; this.lastZ = 0;
    game.renderer.scene.add(this.model);
  }
  setName(name) {
    if (this.tag && this.tagName === name) return;
    if (this.tag) this.model.remove(this.tag);
    this.tagName = name;
    this.tag = makeNameTag(name);
    this.tag.position.y = 1.0;
    this.model.add(this.tag);
  }
  apply(s) {
    this.x = s.x; this.z = s.z; this.yaw = s.yaw;
    this.crawling = !!s.c; this.hidden = !!s.h; this.downed = !!s.d;
    this.torch = !!s.t; this.health = s.hp;
    this.hiddenPropId = s.hid === undefined ? null : s.hid;
    this.taped = !!s.tp;
    this.dead = !!s.dd;
    this.busy = !!s.mg;
    if (s.tod !== undefined) this.carrying = s.tod;
    if (s.n) { this.name = s.n; this.setName(s.n); }
  }
  update(dt) {
    this.animT += dt;
    const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
    this.speed = lerp(this.speed, moved > 3 ? 0 : moved / Math.max(dt, 0.001), 0.25);
    this.lastX = this.x; this.lastZ = this.z;
    this.model.visible = !this.hidden && !this.dead;
    this.model.position.set(this.x, this.downed ? -0.18 : 0, this.z);
    // Baby models face -Z, the same way the camera looks, so no half-turn here
    // (NPCs add PI because their yaw is the direction they walk, atan2(dx, dz)).
    this.model.rotation.y = this.yaw;
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
    { const v = document.getElementById('gamever'); if (v) v.textContent = 'version ' + GAME_VERSION + ' -- co-op players need the same version'; }
    this.minigames = new Minigames(this);
    this.map = new MapView(this);
    this.net = new Net(this);

    this.school = null;
    this.built = null;
    this.player = new Player(this);
    this.remotePlayers = new Map();
    this.switches = [];
    this.fusebox = null;
    this.running = false;
    this.paused = false;
    this.score = 0;
    this.night = 1;
    this.phase = 'day';
    this.phaseTime = 0;
    this.time = 0;
    this.escapeOpen = false;
    this.drawingsFound = 0;
    this.talkedToday = false;
    this.noiseEvents = [];
    this.mods = {};
    this.modText = '';
    this.snapT = 0;
    this.posT = 0;
    this.visitT = 0;
    this.deadCheckT = 0;
    this.lastStep = performance.now();
    this.input = { fwd: 0, right: 0, sprint: false, crawl: false, peek: false, lookX: 0, lookY: 0, interact: false };
    this.holdT = 0;
    this.holdLabel = null;
    this.needRelease = false;
    this.lastInteraction = null;
    this.pendingTakes = new Map();
    this.jumpT = 0;

    this.bindUi();
    this.bindInput();
    this.ui.screen('menu');
    this.loadVoices();
    this.startWatchdog();
    requestAnimationFrame(() => this.loop());
  }

  async loadVoices() {
    try {
      await this.sfx.loadVoices({
        greeting: 'audio/grump-greeting.ogg',
        mean: 'audio/grump-mean.ogg',
        angry: 'audio/grump-angry.ogg',
        kidLine: 'audio/kid-line.ogg',
        kidScream: 'audio/kid-scream.ogg',
        bobClass: 'audio/bob-class.ogg',
        bobScream: 'audio/bob-scream.ogg',
        bobMess: 'audio/bob-mess.ogg',
        honeywell: 'audio/honeywell-morning.ogg',
        honeywellDark: 'audio/honeywell-dark.ogg',
        jerryLaps: 'audio/jerry-laps.ogg',
        jerryLift: 'audio/jerry-2.ogg',
        jerryRope: 'audio/jerry-3.ogg',
        meredith: 'audio/meredith-lunch.ogg'
      });
    } catch (e) { /* synth fallback is fine */ }
  }

  get isHost() { return !this.net.online || this.net.isHost; }
  get online() { return this.net.online; }
  // The id the host's AI uses for the player on THIS machine.
  get myTargetId() { return this.isHost ? this.player.id : this.net.myId; }

  // ================================================================= setup

  bindUi() {
    document.querySelectorAll('[data-go]').forEach(b => {
      b.onclick = () => {
        this.sfx.resume(); this.sfx.click();
        const go = b.dataset.go;
        if (go === 'settings' && this.running) { this.ui.showPause(false); this.ui.screen('settings'); this.fromPause = true; }
        else if (go === 'menu' && this.fromPause) { this.fromPause = false; this.ui.hideScreens(); this.ui.showPause(true, this.online ? this.net.code : null); }
        else this.ui.screen(go);
      };
    });

    $('#solo-start').onclick = () => {
      this.sfx.resume();
      this.startGame({ nights: parseInt($('#solo-nights').value, 10), diff: $('#solo-diff').value });
    };

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

    $('#host-name').value = s.name || '';
    $('#join-name').value = s.name || '';
    this.resetLobbyButtons();
    $('#join-go').onclick = () => this.doJoin();
    $('#copycode').onclick = () => {
      navigator.clipboard.writeText(this.net.code || '').then(() => this.ui.toast('Copied.'));
    };
    $('#join-code').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };

    $('#draw-close').onclick = () => { this.ui.closeDrawing(); this.resumeFromOverlay(); };
    $('#dawn-go').onclick = () => { this.ui.closeDawn(); this.resumeFromOverlay(); };
    $('#over-again').onclick = () => { this.ui.closeOver(); this.startGame(Object.assign({}, this.lastOpts, { seed: undefined })); };
    $('#over-menu').onclick = () => { this.ui.closeOver(); this.quitToMenu(); };
    $('#pause-resume').onclick = () => this.setPaused(false);
    $('#pause-quit').onclick = () => { this.ui.showPause(false); this.quitToMenu(); };
  }

  resetLobbyButtons() {
    const hs = $('#host-start');
    hs.disabled = false;
    hs.textContent = 'Open the room';
    hs.onclick = () => this.doHost();
    $('#hostcode').classList.add('hidden');
    $('#join-go').disabled = false;
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
      if (!this.locked && this.running && !this.overlayOpen() && !this.paused && !this.chatOpen) this.setPaused(true);
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.input.lookX += e.movementX;
      this.input.lookY += e.movementY * (this.settings.invert ? -1 : 1);
    });
    document.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (this.minigames.active) { if (e.button === 0) this.minigames.key('click'); return; }
      if (e.button === 0) { this.input.interact = true; this.clickQueued = true; }
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
        if (e.key === 'Escape') { this.chatOpen = false; this.ui.openChat(false); }
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
    window.addEventListener('blur', () => { keys.clear(); this.input.interact = false; });
  }

  onKeyDown(k, e) {
    if (k === 'escape') {
      if (this.overlayOpen()) return;
      if (this.running) this.setPaused(!this.paused);
      return;
    }
    if (!this.running || this.paused) return;

    if (this.dialogueOpen && '123'.includes(k)) {
      const b = this.ui.dlgButtons && this.ui.dlgButtons[parseInt(k, 10) - 1];
      if (b && !b.disabled) b.click();
      return;
    }
    if (this.minigames.active) { this.minigames.key(k); return; }
    if (this.overlayOpen()) {
      if (k === 'e' || k === ' ' || k === 'enter') {
        if (!$('#drawing').classList.contains('hidden')) $('#draw-close').click();
        else if (!$('#dawn').classList.contains('hidden')) $('#dawn-go').click();
      }
      return;
    }
    if (this.player.dead) return;
    // During a cutscene you can look at the map or the list, nothing else.
    if (this.bullies && this.bullies.locksPlayer && k !== 'm' && k !== 'tab') return;

    if (k === 'e') { this.input.interact = true; e.preventDefault(); }
    else if (k === 'r') this.onSecondary();
    else if (k === 'q') dropHands(this);
    else if (k === 'f') this.toggleTorch();
    else if (k === 'tab') { this.ui.setObjectives(true, this.objectivesHtml()); e.preventDefault(); }
    else if (k === 'm') this.map.toggle();
    else if (k === 't' && this.online) { this.chatOpen = true; this.ui.openChat(true); document.exitPointerLock(); }
    else if (k >= '1' && k <= '6') this.player.selected = parseInt(k, 10) - 1;
  }

  lockPointer() {
    const r = $('#game').requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  }

  overlayOpen() {
    return !$('#dialogue').classList.contains('hidden')
      || !$('#drawing').classList.contains('hidden')
      || !$('#dawn').classList.contains('hidden')
      || !$('#over').classList.contains('hidden')
      || !!(this.minigames && this.minigames.active);
  }

  setPaused(on) {
    this.paused = on;
    this.ui.showPause(on, this.online ? this.net.code : null);
    if (!on) this.lockPointer();
  }

  resumeFromOverlay() {
    if (this.running && !this.paused) this.lockPointer();
  }

  // ================================================================= lobby

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
      this.resetLobbyButtons();
    });
  }

  doJoin() {
    // A second click (or Enter and a click) must not open a second connection.
    if (this.joining || (this.net.online && !this.net.isHost)) return;
    const code = $('#join-code').value.trim().toUpperCase();
    const name = ($('#join-name').value || 'Baby').slice(0, 12);
    if (code.length < 4) { $('#join-err').textContent = 'That code looks short.'; return; }
    this.settings.name = name;
    localStorage.setItem(SET_KEY, JSON.stringify(this.settings));
    $('#join-err').textContent = '';
    $('#join-go').disabled = true;
    this.joining = true;
    this.ui.loading(true, 'Knocking…');
    this.net.join(code, () => {
      this.joining = false;
      this.myName = name;
      this.net.send({ t: 'hello', name, v: GAME_VERSION, dev: DEVICE_ID });
      this.ui.loading(true, 'Waiting for the host to start…');
    }, err => {
      this.joining = false;
      this.ui.loading(false);
      $('#join-err').textContent = err;
      $('#join-go').disabled = false;
    });
  }

  // ================================================================= start

  startGame(opts = {}) {
    this.lastOpts = opts;
    this.diff = DIFF[opts.diff] || DIFF.normal;
    this.diffName = DIFF[opts.diff] ? opts.diff : 'normal';
    // 0 means endless.
    this.requiredNights = opts.nights === undefined || isNaN(opts.nights) ? 7 : opts.nights;
    this.myName = opts.name || this.settings.name || 'Baby';
    this.seed = opts.seed !== undefined ? opts.seed : (Math.random() * 0xffffffff) >>> 0;
    this.running = false;      // ignore snapshots until the school exists

    this.ui.loading(true, 'Unlocking the school…');
    this.ui.hideScreens();
    this.ui.closeOver();
    this.ui.closeDawn();
    this.ui.closeDrawing();
    this.ui.closeDialogue();
    this.ui.showPause(false);
    this.dialogueOpen = false;
    this.paused = false;

    // A quit (or being kicked) before the build runs cancels it.
    const token = this.startToken = (this.startToken || 0) + 1;
    setTimeout(() => {
      if (token !== this.startToken) return;
      this.buildWorld(this.seed);
      this.night = opts.night || 1;
      this.phase = 'day';
      this.phaseTime = this.diff.day;
      this.score = 0;
      this.time = 0;
      this.escapeOpen = false;
      this.drawingsFound = 0;
      this.mods = {};
      this.modText = '';
      this.askedQs = new Set();
      $('#over-again').classList.toggle('hidden', this.online);

      if (this.isHost) {
        this.beginDay(true);
        // only to players who have said hello and passed the checks
        if (this.online) for (const rp of this.remotePlayers.values()) if (rp.greeted) this.net.sendTo(rp.id, this.worldMessage());
      } else if (this.pendingWorld) {
        this.applyWorldState(this.pendingWorld);
        this.pendingWorld = null;
        if (this.phase === 'day' && this.phaseTime > this.diff.day - 20) this.honeywell.morning();
      }
      this.running = true;
      this.ui.loading(false);
      this.ui.showHud(true);
      this.lockPointer();
      this.sfx.resume();
      this.ui.bigLine((this.phase === 'night' ? 'NIGHT ' : 'DAY ') + this.night);
      if (this.night === 1) this.ui.toast('Everyone went home. Check Mrs. Honeywell\'s list, and press M for the map.');
    }, 60);
  }

  buildWorld(seed) {
    if (this.built) this.built.dispose();
    if (this.toddlers) this.toddlers.clear();
    if (this.messes) this.messes.clear();
    if (this.groundItems) this.groundItems.clearAll();
    if (this.portableLights) this.portableLights.clearAll();
    for (const sw of this.switches) this.renderer.scene.remove(sw.mesh);
    for (const rp of this.remotePlayers.values()) this.renderer.scene.remove(rp.model);
    if (this.bob) this.renderer.scene.remove(this.bob.model);
    if (this.grump) this.renderer.scene.remove(this.grump.model);
    if (this.cardKid) this.cardKid.dispose();
    if (this.honeywell) this.honeywell.dispose();
    if (this.bullies) this.bullies.dispose();
    if (this.jerry) this.jerry.dispose();
    if (this.meredith) this.meredith.dispose();
    if (this.minigames) this.minigames.abort();
    if (this.jumpModel) { this.renderer.scene.remove(this.jumpModel); this.jumpModel = null; }
    resetMaterials();

    this.school = generateSchool(seed);
    this.collider = buildCollider(this.school);
    computeNavBlocking(this.school, this.collider);
    if (repairConnectivity(this.school)) {
      this.collider = buildCollider(this.school);
      computeNavBlocking(this.school, this.collider);
    }
    this.built = buildSchool(this.school, this.renderer.scene);
    this.nav = new Nav(this.school, this.collider);
    this.propById = new Map(this.school.props.map(p => [p.id, p]));

    this.toddlers = new Toddlers(this);
    this.messes = new Messes(this);
    this.groundItems = new GroundItems(this);
    this.portableLights = new PortableLights(this);
    this.quests = new Quests(this);

    this.generator = new Generator(this, this.school.props.find(p => p.generator));
    this.fusebox = this.school.props.find(p => p.fusebox) || null;
    this.crib = this.school.props.find(p => p.crib) || null;

    this.grump = new Grump(this);
    this.bob = new Bob(this);
    this.cardKid = new CardKid(this);
    this.buildSwitches();
    this.honeywell = new Honeywell(this);
    this.bullies = new Bullies(this);
    this.jerry = new Jerry(this);
    this.meredith = new Meredith(this);

    // Rebuilding the scene must not lose anyone already in the room -- this is
    // what made joiners invisible to the host.
    for (const rp of this.remotePlayers.values()) this.renderer.scene.add(rp.model);

    this.map.buildBase(this.school);
    this.map.toggle(false);

    const home = this.school.home;
    this.player = new Player(this);
    [this.player.x, this.player.z] = this.freeSpotIn(home, 0.3);
    this.player.give('flashlight');
    this.player.torchBattery = 60;

    for (const r of this.school.rooms) {
      r.lightsOn = r === home || r.type === 'hall' || r.type === 'boiler';
    }
    this.applyPower();
  }

  // Somewhere in a room a body of radius r can actually stand.
  freeSpotIn(room, r = 0.35) {
    const s = this.school;
    if (this.collider.free(room.cx, room.cz, r)) return [room.cx, room.cz];
    for (let k = 0; k < 40; k++) {
      const x = room.cx + (Math.random() - 0.5) * (room.w - 1) * s.CELL;
      const z = room.cz + (Math.random() - 0.5) * (room.h - 1) * s.CELL;
      if (this.collider.free(x, z, r)) return [x, z];
    }
    return [room.cx, room.cz];
  }

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
        const sc = this.school;
        let spot = null;
        for (let x = r.x0; x <= r.x1 && !spot; x++) {
          if (sc.wallH[x + r.y0 * sc.W] === 1 && (x < 15 || x > 20)) spot = [sc.cwx(x), sc.wz(r.y0) + 0.36];
        }
        if (!spot) for (let y = r.y0; y <= r.y1 && !spot; y++) {
          if (sc.wallV[r.x0 + y * (sc.W + 1)] === 1 && y > 2) spot = [sc.wx(r.x0) + 0.36, sc.cwz(y)];
        }
        if (spot) place(spot[0], spot[1], r);
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
    this.startToken = (this.startToken || 0) + 1;
    this.net.close();
    for (const rp of this.remotePlayers.values()) this.renderer.scene.remove(rp.model);
    this.remotePlayers.clear();
    this.sfx.setGenerator(false, 0);
    this.sfx.setDrone(0);
    this.sfx.stopVoice();
    this.ui.closeOver(); this.ui.closeDawn(); this.ui.closeDrawing(); this.ui.closeDialogue();
    this.ui.showPause(false);
    this.ui.loading(false);
    this.ui.showHud(false);
    this.map.toggle(false);
    this.resetLobbyButtons();
    this.ui.screen('menu');
    document.exitPointerLock();
  }

  // ================================================================= phases

  beginDay(first) {
    this.phase = 'day';
    this.phaseTime = this.diff.day;
    this.talkedToday = false;
    this.mods = {};
    this.modText = '';
    this.bob.hearMult = 1;
    this.bob.speedBonus = 0;

    const justTurned = this.grump.checkSchedule(this.night);
    this.grump.beginDay(this);
    if (justTurned) {
      this.fx('big', 0, 0, { text: 'GRUMP THE BABY DESTROYER', reveal: true });
      this.fx('toast', 0, 0, { text: 'He is not asking questions any more. He is in the building with you.' });
    }
    this.cardKid.resetPhase();
    this.jerry.resetDay();
    this.meredith.resetDay();
    this.bob.deactivate();
    for (const d of this.school.yardDoors) if (d.locked) { d.locked = false; this.netEvent({ k: 'door', id: d.id, open: d.open, locked: false }); }
    this.messes.spawnForDay(this.night, this.seed);
    this.toddlers.pruneTaken();
    this.toddlers.spawnForDay(this.night, this.seed);
    for (const p of this.school.props) { p.searched = false; p.checked = false; p.searchCount = 0; }

    if (first) {
      this.spawnGroundItem('fuel', this.school.boiler.cx + 1.4, this.school.boiler.cz + 1.0);
      this.spawnGroundItem('part', this.school.boiler.cx - 1.4, this.school.boiler.cz - 0.8);
    }
    this.spawnLunchboxes();

    const spec = this.quests.plan(this.night, this.seed);
    this.quests.load(spec, this.night);
    this.quests.spawnItems();

    this.sfx.phaseDay();
    this.sfx.setDrone(0);
    this.applyPower();
    this.honeywell.morning();
    this.netEvent({
      k: 'phase', phase: 'day', night: this.night, quests: spec, eo: this.escapeOpen,
      dawn: this.pendingDawn || null
    });
    this.pendingDawn = null;
  }

  // Food does not only live in lockers: a few lunchboxes turn up every morning.
  spawnLunchboxes() {
    const s = this.school;
    const rooms = s.rooms.filter(r => ['cafeteria', 'library', 'gym', 'classroom', 'yard', 'music', 'art'].includes(r.type));
    const n = 2 + (this.night % 2);
    for (let i = 0; i < n; i++) {
      const r = rooms[(Math.random() * rooms.length) | 0];
      for (let k = 0; k < 10; k++) {
        const x = r.cx + (Math.random() - 0.5) * (r.w - 1.2) * s.CELL;
        const z = r.cz + (Math.random() - 0.5) * (r.h - 1.2) * s.CELL;
        if (this.collider.free(x, z, 0.3)) { this.spawnGroundItem('lunchbox', x, z); break; }
      }
    }
  }

  pickMods(night) {
    if (night < 5) return [];
    const rng = makeRng(hashStr(this.seed + ':mods:' + night));
    const pool = rng.shuffle(NIGHT_MODS.map(m => m.id));
    return pool.slice(0, night >= 10 ? 2 : 1);
  }

  applyMods(ids) {
    this.mods = {};
    for (const id of ids || []) this.mods[id] = true;
    this.modText = (ids || []).map(id => NIGHT_MODS.find(m => m.id === id).name).join(' · ');
    this.bob.hearMult = this.mods.overtime ? 1.6 : 1;
    this.bob.speedBonus = this.mods.overtime ? 0.45 : 0;
  }

  beginNight() {
    this.phase = 'night';
    this.phaseTime = this.diff.night;

    let anger = this.diff.anger;
    if (!this.talkedToday) anger += 6;
    anger += this.messes.remaining * 0.8;
    if (!this.grump.turned) this.grump.anger(anger, this, 'nightfall');

    const takenNames = [];
    const outCount = this.toddlers.lost;
    for (let i = 0; i < outCount; i++) {
      const t = this.toddlers.takeOne(this);
      if (t) takenNames.push(t.name);
    }
    if (takenNames.length) {
      this.fx('big', 0, 0, { text: takenNames.join(' and ') + '\nis not here any more', stinger: true });
    }

    for (const d of this.school.doors) {
      if (!d.yard) continue;
      d.locked = true;
      d.open = false;
      if (d.box) d.box.active = true;
      this.netEvent({ k: 'door', id: d.id, open: false, locked: true });
    }
    // anybody standing in a playground doorway as it locks is moved inside
    for (const d of this.school.yardDoors) {
      const p = this.player;
      if (d.box && Math.abs(p.x - d.box.x) < d.box.hw + 0.26 && Math.abs(p.z - d.box.z) < d.box.hd + 0.26) {
        const spot = this.collider.nearestFree(p.x, p.z, 0.26, 2.5);
        if (spot) { p.x = spot[0]; p.z = spot[1]; }
      }
    }

    const modIds = this.pickMods(this.night);
    this.applyMods(modIds);
    if (this.mods.long) this.phaseTime += 50;

    if (this.night >= this.diff.bobFrom) {
      this.bob.activate(this.night);
      const st = this.school.rooms.find(r => r.type === 'storage') || this.school.hallB;
      [this.bob.x, this.bob.z] = this.freeSpotIn(st, 0.4);
    }
    this.grump.beginNight(this, !!this.mods.closer);
    this.cardKid.resetPhase();
    this.sfx.phaseNight();
    this.sfx.setDrone(0.5);
    this.ui.bigLine('NIGHT ' + this.night);
    if (modIds.length) {
      for (const id of modIds) this.ui.toast(NIGHT_MODS.find(m => m.id === id).desc);
    } else {
      this.ui.toast('Get to your classroom. Keep the lights on.');
    }
    this.netEvent({ k: 'phase', phase: 'night', night: this.night, mods: modIds, pt: this.phaseTime });
  }

  endNight() {
    const survivedNight = this.night;
    this.bob.deactivate();
    this.sfx.setDrone(0);

    const lines = [];
    lines.push([`Night ${survivedNight} survived.`, 'good']);
    lines.push([`Little ones safe: ${this.toddlers.saved}`, this.toddlers.saved ? 'good' : '']);
    const qDone = this.quests.list.filter(q => q.done).length;
    lines.push([`Mrs. Honeywell's list: ${qDone} of ${this.quests.list.length} done`, qDone === this.quests.list.length ? 'good' : '']);
    lines.push([`Generator: ${Math.round(this.generator.fuel)}% fuel, ${Math.round(this.generator.condition)}% condition`,
      this.generator.fuel < 25 ? 'bad' : '']);
    lines.push([`Grump: ${this.grumpMood()}`, this.grump.turned ? 'bad' : '']);
    if (!this.grump.turned) {
      const left = 4 - (survivedNight + 1);
      if (left <= 0) lines.push(['Today he stops asking.', 'bad']);
    }

    this.score += 200 + this.toddlers.saved * 60;
    this.night++;

    let title = `Day ${this.night}.`, kicker = 'THE SUN COMES UP';
    if (this.requiredNights > 0 && this.night > this.requiredNights && !this.escapeOpen) {
      this.escapeOpen = true;
      for (const d of this.school.exitDoors) d.locked = false;
      lines.push(['The chains on the front doors are gone. Leave, or stay for the score.', 'good']);
      title = 'The front doors are open.';
      kicker = 'YOU MADE IT';
      this.sfx.win();
    } else {
      this.sfx.phaseDay();
    }
    this.ui.showDawn(title, kicker, lines);
    this.pendingDawn = { title, kicker, lines };
    this.beginDay(false);
  }

  grumpMood() {
    const r = this.grump.resent;
    if (this.grump.turned) return 'hunting you';
    return r >= 75 ? 'not speaking to you' : r >= 50 ? 'cold' : r >= 22 ? 'keeping score' : 'friendly, apparently';
  }

  // ================================================================= loop

  loop() {
    requestAnimationFrame(() => this.loop());
    this.step();
  }

  // Some embedded viewers -- and any backgrounded tab -- stall
  // requestAnimationFrame entirely. A slow watchdog keeps the clock running.
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

    if (this.minigames.active && !this.paused) this.minigames.update(dt);
    const blocked = this.paused || this.overlayOpen();
    // Solo pauses the world. Co-op never does: the school keeps going for
    // everyone else while one player has a menu open.
    if (!blocked) this.update(dt, false);
    else if (this.online) this.update(dt, true);
    else { this.input.fwd = 0; this.input.right = 0; }

    if (this.player.dead && this.online) this.spectateCamera(dt);
    else this.player.applyCamera(this.renderer.camera, dt);
    this.updateJumpscare(dt);
    this.updateLightJitter(dt);
    this.renderer.updateLights(this.school.fixtures, this.renderer.camera.position);
    this.updateTorches();
    this.renderer.render();
  }

  update(dt, blocked) {
    this.time += dt;
    const k = this.keys;
    const inScene = !!(this.bullies && this.bullies.locksPlayer);
    if (blocked || this.chatOpen || this.player.dead || inScene) {
      this.input.fwd = 0; this.input.right = 0;
      this.input.sprint = false; this.input.crawl = false;
      this.input.lookX = 0; this.input.lookY = 0;
      this.input.interact = false;
    } else {
      this.input.fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      this.input.right = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      this.input.sprint = k.has('shift');
      this.input.crawl = k.has('control');
    }

    // --- phase clock (host owns it)
    if (this.isHost) {
      const before = this.phaseTime;
      this.phaseTime -= dt;
      if (this.phase === 'day' && before > 30 && this.phaseTime <= 30) {
        this.fx('big', 0, 0, { text: 'IT IS GETTING DARK', stinger: true });
      }
      if (this.phaseTime <= 0) {
        if (this.phase === 'day') this.beginNight();
        else this.endNight();
      }
    }

    this.player.update(dt, this.input, this);
    if (!blocked && !inScene) { this.handleInteraction(dt); this.pushDoors(dt); }
    else this.ui.setPrompt(null);

    if (this.isHost) {
      this.generator.update(dt, this);
      // Alone, the real Grump waits while the Big Boys Club scene plays.
      if (!(inScene && !this.online)) this.grump.update(dt, this);
      this.bob.update(dt, this);
      this.tickBrokenLights(dt);
      this.hostChecks(dt);
      this.flushNoise();
    }
    this.sfx.setGenerator(this.generator.running, this.generator.condition / 100);
    if (this.generator.running) {
      this.sfx.setGeneratorProximity(clamp(1 - dist2(this.player.x, this.player.z, this.generator.x, this.generator.z) / 26, 0, 1));
    }
    this.toddlers.update(dt, this);
    this.grump.present(dt, this);
    this.bob.present(dt, this);
    this.cardKid.update(dt, this);
    this.bullies.maybeStart(dt);
    this.bullies.update(dt);
    this.bullies.hideRealGrump();
    this.honeywell.update(dt);
    this.jerry.update(dt);
    this.meredith.update(dt);
    this.groundItems.update(dt);
    this.portableLights.update(dt);
    for (const rp of this.remotePlayers.values()) rp.update(dt);
    this.animateDoors(dt);

    if (this.mods.storm && Math.random() < dt * 0.05) {
      this.sfx.thunder();
      this.stormFlashT = 0.6;
    }

    // --- mood
    const lightHere = this.roomBrightness(this.player.x, this.player.z);
    const daylight = this.phase === 'day'
      ? clamp(0.35 + this.phaseTime / this.diff.day * 0.65, 0.3, 1)
      : 0.02;
    this.renderer.setMood(daylight, this.generator.running, Math.max(this.player.fear / 100, this.grump.dread || 0));
    this.sfx.updateHeartbeat(dt, Math.max(this.player.fear / 100, (this.grump.dread || 0) * 0.9));
    if (this.phase === 'night' || this.grump.turned) {
      this.sfx.setDrone(0.25 + (1 - lightHere) * 0.4 + this.threatPressure(this.player.x, this.player.z) * 0.5);
    }

    this.ui.update(dt, this);
    this.map.update(dt);
    if (this.keys.has('tab')) this.ui.setObjectives(true, this.objectivesHtml());

    // --- networking
    if (this.online) {
      if (!this.isHost) {
        this.posT -= dt;
        if (this.posT <= 0) {
          this.posT = 0.075;
          // Our noise rides along with our position, strongest first.
          const nz = this.noiseEvents.sort((a, b) => b.level - a.level).slice(0, 6)
            .map(n => [+n.x.toFixed(1), +n.z.toFixed(1), +n.level.toFixed(2)]);
          this.noiseEvents.length = 0;
          this.net.send({ t: 'pos', s: Object.assign({ n: this.myName }, this.player.serialize()), nz });
        }
      } else {
        this.snapT -= dt;
        if (this.snapT <= 0) { this.snapT = 0.085; this.sendSnapshot(); }
      }
    } else if (!this.isHost) {
      this.noiseEvents.length = 0;
    }
  }

  // Host-side periodic checks: quest visits and whether everyone is gone.
  hostChecks(dt) {
    this.visitT -= dt;
    if (this.visitT <= 0) {
      this.visitT = 0.5;
      for (const t of this.threatTargets()) {
        const r = this.school.roomAt(t.x, t.z);
        if (r) this.questEvent('visit', { room: r.type });
      }
    }
    if (this.online) {
      this.deadCheckT -= dt;
      if (this.deadCheckT <= 0) {
        this.deadCheckT = 1;
        const everyone = [this.player, ...this.remotePlayers.values()];
        if (everyone.every(p => p.dead)) this.gameOverAll();
      }
    }
  }

  updateTorches() {
    const p = this.player;
    const f = p.forward();
    this.renderer.setTorch(p.torchOn && !p.hidden && !p.dead, clamp(p.torchBattery / 40, 0.2, 1),
      this.renderer.camera.position, f);
    if (this.bob && this.bob.active) {
      const yaw = this.bob.yaw + this.bob.sweep;
      const dir = new THREE.Vector3(Math.sin(yaw), -0.22, Math.cos(yaw)).normalize();
      const pos = new THREE.Vector3(this.bob.x + dir.x * 0.4, 1.05, this.bob.z + dir.z * 0.4);
      this.renderer.setBobTorch(true, pos, dir, 14);
    } else this.renderer.setBobTorch(false);
  }

  // Purely visual: lights stutter near Grump and during a storm. Runs on every
  // machine, so it never needs to be sent anywhere.
  updateLightJitter(dt) {
    this.stormFlashT = Math.max(0, (this.stormFlashT || 0) - dt);
    const g = this.grump;
    const near = g && (g.turned || g.dread > 0) && this.phase === 'night';
    for (const f of this.school.fixtures) {
      f.jit = this.stormFlashT > 0 || (near && Math.hypot(f.x - g.x, f.z - g.z) < 8);
    }
  }

  animateDoors(dt) {
    for (const d of this.school.doors) {
      if (!d.mesh) continue;
      d.swing = lerp(d.swing, d.open ? 1 : 0, Math.min(1, dt * 7));
      for (const pivot of d.mesh.children) pivot.rotation.y = d.swing * 1.45 * (pivot.userData.swingSign || 1);
    }
  }

  // Dead in co-op -- host included -- the game carries on without you, and the
  // camera follows whoever is still alive. Click cycles between them.
  spectateCamera(dt) {
    const alive = [...this.remotePlayers.values()].filter(p => !p.dead);
    const cam = this.renderer.camera;
    if (!alive.length) { this.player.applyCamera(cam, dt); return; }
    if (this.clickQueued) {
      this.clickQueued = false;
      this.spectateIdx = ((this.spectateIdx || 0) + 1) % alive.length;
      this.ui.toast('Watching ' + alive[this.spectateIdx % alive.length].name);
    }
    const t = alive[(this.spectateIdx || 0) % alive.length];
    const back = 2.4, yaw = t.yaw;
    const tx = t.x + Math.sin(yaw) * back, tz = t.z + Math.cos(yaw) * back;
    const k = Math.min(1, dt * 5);
    cam.position.x = lerp(cam.position.x, tx, k);
    cam.position.z = lerp(cam.position.z, tz, k);
    cam.position.y = lerp(cam.position.y, 1.7, k);
    cam.lookAt(t.x, 0.5, t.z);
  }

  updateJumpscare(dt) {
    if (this.jumpT <= 0) { if (this.jumpModel) this.jumpModel.visible = false; return; }
    this.jumpT -= dt;
    if (!this.jumpModel) {
      this.jumpModel = makeGrump();
      setGrumpStage(this.jumpModel, 4);
      this.renderer.scene.add(this.jumpModel);
    }
    const cam = this.renderer.camera;
    const f = this.player.forward();
    const m = this.jumpModel;
    m.visible = true;
    // Starts a little way off and lunges at the lens, so his whole face fills
    // the screen rather than the camera clipping into his chest. His head sits
    // 1.36m up the scaled model, so that is how far down it has to go.
    const dist = 0.8 + Math.max(0, this.jumpT - 0.45) * 1.1;
    m.position.set(cam.position.x + f.x * dist, cam.position.y - 1.36, cam.position.z + f.z * dist);
    // Face the camera, and light the face from below so it reads in the dark.
    m.rotation.y = this.player.yaw + Math.PI;
    m.userData.parts.head.rotation.z = Math.sin(this.jumpT * 40) * 0.2;
    this.renderer.setGrumpGlow(true, new THREE.Vector3(
      cam.position.x + f.x * 0.3, cam.position.y - 0.3, cam.position.z + f.z * 0.3), 2.2);
    this.player.shake = 1.4;
  }

  // ================================================================= fx

  // Play something for everyone. Positional kinds are attenuated per player.
  fx(kind, x, z, e = {}) {
    this.playFx(kind, x, z, e);
    if (this.online && this.isHost) {
      this.net.broadcast({ t: 'ev', k: 'fx', f: kind, x: +(+x).toFixed(1), z: +(+z).toFixed(1), e });
    }
  }

  playFx(kind, x, z, e) {
    const p = this.player, sfx = this.sfx, ui = this.ui;
    const d = dist2(p.x, p.z, x, z);
    const att = r => clamp(1 - d / r, 0, 1);
    const mine = e.id !== undefined && e.id === this.myTargetId;
    switch (kind) {
      case 'switch': if (d < 26) { sfx.lightOff(); ui.subtitle('a switch clicks somewhere'); } break;
      case 'lockerOpen': if (d < 22) sfx.lockerOpen(); break;
      case 'sub': if (d < (e.range || 20)) ui.subtitle(e.text); break;
      case 'bobSpot':
        if (d < 34) {
          sfx.bobSpot();
          sfx.voice('bobClass', clamp(att(34) + 0.2, 0.25, 1));
          ui.subtitle('Bob: "GET BACK TO YOUR CLASSROOM."');
        }
        if (mine) ui.flash('spotted');
        break;
      case 'bobMess':
        if (d < 30) {
          sfx.voice('bobMess', clamp(att(30) + 0.25, 0.2, 1));
          ui.subtitle('Bob: "These darn kids, leaving the lights on and making a mess."');
        }
        break;
      case 'bobGrab': if (d < 30) { sfx.bobGrab(); sfx.voice('bobScream', clamp(att(30) + 0.3, 0.2, 1)); } break;
      case 'say':
        if (d < 22) {
          ui.subtitle('Grump: "' + e.text + '"');
          if (!sfx.isSpeaking) sfx.voice(e.voice, Math.min(1, att(22) + 0.35), e.rate || 1);
        }
        break;
      case 'charge':
        if (d < 28) sfx.voice('angry', clamp(att(28) + 0.3, 0.2, 1), 0.78);
        if (mine) {
          sfx.stinger();
          ui.flash('grump');
          ui.subtitle('He has seen you. RUN.');
          p.fear = Math.min(100, p.fear + 35);
        }
        break;
      case 'camp':
        if (mine) { ui.subtitle('Something has stopped right outside. Do not move.'); p.fear = 100; }
        break;
      case 'breath': if (d < 9) sfx.breath(att(9) * (e.strong ? 1.4 : 1)); break;
      case 'whisper': if (d < 18) sfx.whisper(att(18) * (e.strong ? 2 : 1)); break;
      case 'knock':
        if (d < 30) { sfx.knock(clamp(att(30) + 0.25, 0, 1)); if (d < 18) ui.subtitle('Knock. Knock. Knock.'); }
        break;
      case 'grumpAngry': if (d < 28) sfx.grumpAngry(); break;
      case 'grumpCatch': if (d < 30 && !mine) sfx.voice('angry', att(30), 0.8); break;
      case 'pop': if (d < 24) sfx.bulbPop(att(24)); break;
      case 'cry': if (d < 30) { sfx.babyCry(); if (d < 14) ui.subtitle(e.name + ' is crying.'); } break;
      case 'genStart': if (d < 30) sfx.genStart(); break;
      case 'blackout': sfx.blackout(); ui.flash('blackout'); break;
      case 'big':
        ui.bigLine(e.text);
        if (e.reveal) { sfx.grumpReveal(); sfx.voice('angry', 1, 0.8); }
        if (e.stinger) sfx.stinger();
        break;
      case 'toast': ui.toast(e.text); break;
      case 'quest':
        ui.toast(`✓ ${e.title} — ${e.reward} left in the crib`);
        sfx.ding();
        break;
    }
  }

  // Report the outcome of an action to whoever did it, and only them.
  feedback(actor, text, sound) {
    if (!actor || actor === 'me' || actor === this.player.id) {
      this.ui.toast(text);
      if (sound && this.sfx[sound]) this.sfx[sound]();
    } else if (this.isHost && this.online) {
      this.net.sendTo(actor, { t: 'ev', k: 'fb', text, sound });
    }
  }

  triggerCardKid(actor) {
    if ((!actor || actor === 'me') && !this.bullies.active) this.cardKid.maybeTrigger();
    else if (this.isHost && this.online) this.net.sendTo(actor, { t: 'ev', k: 'cardkid' });
  }

  // ================================================================= actions

  handleInteraction(dt) {
    // (The card boy talking used to block every interaction for several
    // seconds -- doors included. He talks; you can still do things.)
    // Keep the thing you are holding E on as the target until you let go.
    this.holdKey = this.input.interact && this.holdT > 0 ? this.holdKeyLast : null;
    const inter = findInteraction(this);
    this.lastInteraction = inter;
    if (!inter) { this.holdT = 0; this.holdLabel = null; this.holdKeyLast = null; this.ui.setPrompt(null); return; }
    const id = inter.key || inter.label;
    if (id !== this.holdLabel) { this.holdT = 0; this.holdLabel = id; }
    this.holdKeyLast = inter.key || null;

    if (this.input.interact) {
      // After an action fires, E has to be let go before the next one starts.
      // Without this, holding E to hide carried straight into "Get out".
      if (!this.needRelease) {
        if (!inter.hold) {
          this.needRelease = true;
          inter.act();
        } else {
          this.holdT += dt;
          if (!this.player.hidden && Math.random() < dt * 3) this.sfx.searchTick();
          if (this.holdT >= inter.hold) {
            this.holdT = 0;
            this.needRelease = true;
            inter.act();
          }
        }
      }
    } else {
      this.needRelease = false;
      this.holdT = Math.max(0, this.holdT - dt * 2.5);
    }
    this.ui.setPrompt(inter, this.holdT);
  }

  onSecondary() {
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

  // --- searching
  searchProp(prop) {
    if (!this.isHost) {
      prop.searched = true;
      this.net.send({ t: 'act', k: 'search', id: prop.id });
      return;
    }
    const first = !prop.searchCount;
    const found = this.rollSearch(prop);
    this.giveFound(found, first);
    this.netEvent({ k: 'search', id: prop.id, found, by: 'host', c: prop.searchCount });
  }

  // Every search of the same thing on the same day finds less: the first roll
  // is the normal loot table, then 45%, 20%, 9%... of that.
  rollSearch(prop) {
    prop.searched = true;
    const n = prop.searchCount || 0;
    prop.searchCount = n + 1;
    const rng = makeRng(hashStr(this.seed + ':' + prop.id + ':' + this.night + ':' + n));
    let found = rollLoot(prop.search, rng, this.night);
    if (n > 0 && rng() > Math.pow(0.45, n)) found = null;
    this.emitNoise(prop.x, prop.z, prop.search === 'locker' ? 0.45 : 0.3, 'search');
    const room = this.school.rooms[prop.room];
    this.questEvent('search', { room: room ? room.type : null });
    return found;
  }

  giveFound(found, first = true) {
    this.player.stats.searched++;
    if (first) this.score += 8;
    if (!found) { this.sfx.searchTick(); this.ui.toast('Nothing in there.'); return; }
    if (this.player.give(found)) {
      this.sfx.pickup();
      this.ui.toast(`Found: ${itemName(found)}`);
    } else {
      this.spawnGroundItem(found, this.player.x, this.player.z);
      this.ui.toast(`Found ${itemName(found)} — no room, dropped it.`);
    }
  }

  hideIn(prop) { this.player.enterHide(prop, this); }

  // --- items on the floor
  spawnGroundItem(kind, x, z) {
    if (!this.isHost) { this.net.send({ t: 'act', k: 'drop', kind, x, z }); return null; }
    return this.groundItems.spawn(kind, x, z);
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
    if (!this.isHost) {
      this.pendingTakes.set(it.id, this.time + 2);
      this.net.send({ t: 'act', k: 'take', id: it.id, kind: it.kind });
    }
  }

  // --- food
  eat(kind) {
    const def = ITEMS[kind];
    if (!def || !def.food) return;
    const p = this.player;
    p.take(kind);
    p.food = Math.min(100, p.food + def.food);
    if (def.stamina) p.stamina = Math.min(100, p.stamina + def.stamina);
    p.fear = Math.max(0, p.fear - 6);
    this.sfx.eat();
    this.ui.toast(`${def.name}. ${p.food > 80 ? 'Full tummy.' : 'Better.'}`);
    this.questAction('eat');
  }

  openLunchbox() {
    const p = this.player;
    p.take('lunchbox');
    const got = lunchboxContents(Math.random);
    const kept = [];
    for (const k of got) {
      if (p.give(k)) kept.push(k);
      else this.spawnGroundItem(k, p.x + (Math.random() - 0.5), p.z + (Math.random() - 0.5));
    }
    this.sfx.pickup();
    this.ui.toast('Inside: ' + got.map(itemName).join(', ') + (kept.length < got.length ? ' (some fell out)' : ''));
  }

  // --- toddlers
  carryToddler(t) {
    if (!this.player.handsFree) { this.sfx.deny(); return; }
    this.toddlers.pickUp(t, this);
    this.player.hands = { toddler: t.id };
    if (!this.isHost) this.net.send({ t: 'act', k: 'carry', id: t.id });
  }

  putDownToddler() {
    const id = this.player.hands && this.player.hands.toddler;
    if (id === undefined) return;
    const t = this.toddlers.byId(id);
    this.player.hands = null;
    const f = this.player.forward();
    const x = this.player.x + f.x * 0.7, z = this.player.z + f.z * 0.7;
    if (t) this.toddlers.place(t, x, z, this, true);
    if (!this.isHost) this.net.send({ t: 'act', k: 'drop_toddler', id, x, z });
  }

  releaseToddler(id, x, z) {
    const t = this.toddlers.byId(id);
    if (t) this.toddlers.place(t, x, z, this, true);
    if (!this.isHost) this.net.send({ t: 'act', k: 'drop_toddler', id, x, z });
  }

  carrierOf(id) {
    if (this.player.carryingToddler && this.player.hands.toddler === id) return this.player;
    for (const rp of this.remotePlayers.values()) if (rp.carrying === id) return rp;
    return null;
  }

  feedToddler(t, food) {
    this.player.take(food);
    this.sfx.eat();
    this.ui.toast(t.name + ' stops crying.');
    this.score += 15;
    if (this.isHost) { this.toddlers.feed(t); this.questEvent('fed'); }
    else this.net.send({ t: 'act', k: 'feed', id: t.id });
  }

  teddyToddler(t) {
    this.player.hands = null;
    this.sfx.ding();
    this.ui.toast(t.name + ' holds the teddy and goes quiet.');
    this.score += 45;
    if (this.isHost) this.toddlers.calm(t);
    else this.net.send({ t: 'act', k: 'teddy', id: t.id });
  }

  // --- chores
  cleanMess(m) {
    if (!this.messes.remove(m)) return;
    this.sfx.clean();
    this.player.stats.cleaned++;
    this.score += 35;
    this.ui.toast(`Cleaned up ${m.label}. (${this.messes.remaining} left)`);
    if (this.isHost) {
      this.messCleanedByAnyone();
      this.netEvent({ k: 'mess', id: m.id });
    } else {
      this.net.send({ t: 'act', k: 'mess', id: m.id });
    }
  }

  messCleanedByAnyone() {
    // Tidying is the one thing that reliably takes the edge off him.
    if (!this.grump.turned) this.grump.anger(-1.5, this, 'tidy');
    this.questEvent('clean');
  }

  genAction(kind) {
    if (this.isHost) this.generator[kind](this, 'me');
    else this.net.send({ t: 'act', k: 'gen', kind });
  }

  placeLight(kind, x, z) {
    this.portableLights.place(kind, x, z);
    if (this.isHost) this.netEvent({ k: 'light', kind, x, z });
    else this.net.send({ t: 'act', k: 'light', kind, x, z });
  }

  readDrawing() {
    const page = DRAWINGS[Math.min(this.drawingsFound, DRAWINGS.length - 1)];
    this.drawingsFound++;
    this.score += 60;
    this.player.stats.drawings++;
    document.exitPointerLock();
    this.ui.showDrawing(page);
    this.sfx.ding();
    this.questAction('drawing');
  }

  // --- doors and lights
  // --- doors
  //
  // One place changes a door. It refuses to open a locked door, refuses to
  // shut a door on anybody standing in the doorway (the old way of getting
  // stuck inside a wall), remembers when we touched it so the host's next
  // snapshot does not undo our press, and tells everyone.
  toggleDoor(d, open, silent, by) {
    if (!d || d.exit && !this.escapeOpen && open) { this.sfx.deny(); return false; }
    if (d.locked && open) { this.sfx.deny(); return false; }
    if (!open && d.open && this.somethingInDoorway(d)) {
      if (by === 'player') { this.ui.toast('Something is in the way of the door.'); this.sfx.deny(); }
      return false;
    }
    d.touchT = this.time;
    d.open = open;
    if (d.box) d.box.active = !open;
    if (!silent) {
      this.sfx.doorMove(open);
      this.emitNoise(d.x, d.z, 0.4, 'door');
    }
    this.netEvent({ k: 'door', id: d.id, open, locked: d.locked });
    return true;
  }

  // Tell one joiner the real state of a door they tried to change.
  sendDoorState(d, to) {
    this.net.sendTo(to, { t: 'ev', k: 'door', id: d.id, open: d.open, locked: d.locked, ack: 1 });
  }

  unlockDoor(d) {
    const p = this.player;
    if (!d.locked) { this.toggleDoor(d, true, false, 'player'); return; }
    if (!p.take('key')) { this.ui.toast('You need a staff key.'); this.sfx.deny(); return; }
    d.locked = false;
    d.touchT = this.time;
    this.toggleDoor(d, true, false, 'player');
    this.ui.toast('Unlocked. The key stays in the lock.');
  }

  // Anyone (you, a friend, a toddler, Bob, Grump) standing where the door
  // would swing shut?
  somethingInDoorway(d) {
    const b = d.box;
    if (!b) return false;
    const inside = (x, z, r) => Math.abs(x - b.x) < b.hw + r && Math.abs(z - b.z) < b.hd + r;
    if (!this.player.dead && inside(this.player.x, this.player.z, 0.26)) return true;
    for (const rp of this.remotePlayers.values()) if (!rp.dead && inside(rp.x, rp.z, 0.26)) return true;
    for (const t of this.toddlers.list) if (t.state !== 'carried' && t.state !== 'taken' && inside(t.x, t.z, 0.2)) return true;
    if (this.bob && this.bob.active && inside(this.bob.x, this.bob.z, 0.36)) return true;
    if (this.grump && inside(this.grump.x, this.grump.z, 0.36)) return true;
    return false;
  }

  // Walking into a closed door that is not locked pushes it open -- nobody
  // should ever be stuck in front of a door because a prompt did not show.
  pushDoors(dt) {
    const p = this.player;
    if (p.dead || p.hidden || p.busy) { this.pushT = 0; return; }
    const i = this.input;
    if (!i.fwd && !i.right) { this.pushT = 0; return; }
    const sinY = Math.sin(p.yaw), cosY = Math.cos(p.yaw);
    let mx = i.right * cosY - i.fwd * sinY, mz = -i.right * sinY - i.fwd * cosY;
    const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
    let pushing = null;
    for (const d of this.school.doors) {
      if (d.open || d.locked || d.exit || !d.box) continue;
      const b = d.box;
      // the point just ahead of us is inside the door's box
      const ax = p.x + mx * 0.45, az = p.z + mz * 0.45;
      if (Math.abs(ax - b.x) < b.hw + 0.05 && Math.abs(az - b.z) < b.hd + 0.3) {
        // and we are heading into it, not along it
        const towards = d.dir === 'w' ? Math.abs(mx) > 0.5 : Math.abs(mz) > 0.5;
        if (towards) { pushing = d; break; }
      }
    }
    if (!pushing) { this.pushT = 0; return; }
    this.pushT = (this.pushT || 0) + dt;
    if (this.pushT > 0.18) { this.pushT = 0; this.toggleDoor(pushing, true, false, 'player'); }
  }

  aiOpenDoor(d) {
    if (!this.isHost) return;                    // only the host's AI moves doors
    if (d.open || d.locked || d.exit) return;
    d.open = true;
    d.touchT = this.time;
    if (d.box) d.box.active = false;
    if (dist2(d.x, d.z, this.player.x, this.player.z) < 24) this.sfx.doorMove(true);
    this.netEvent({ k: 'door', id: d.id, open: true, locked: d.locked });
  }

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
        f.mesh.material = f.on && !f.broken ? this.built.panelMat : this.built.panelOff;
      }
    }
  }

  onPowerChanged(on) {
    this.applyPower();
    if (this.online && this.isHost) this.netEvent({ k: 'gen', on });
  }

  setRoomLights(room, on, by) {
    room.touchT = this.time;
    room.lightsOn = on;
    this.applyPower();
    if (by === 'player') this.sfx[on ? 'lightOn' : 'lightOff']();
    if (this.isHost) this.questEvent('lights', { room: room.type, on });
    this.netEvent({ k: 'lights', room: room.id, on });
  }

  resetBreakers() {
    for (const r of this.school.rooms) r.lightsOn = true;
    this.applyPower();
    this.sfx.lightOn();
    this.ui.toast('Every light in the school comes on.');
    this.emitNoise(this.fusebox.x, this.fusebox.z, 0.6, 'breaker');
    this.netEvent({ k: 'breakers' });
  }

  // Grump walking under a light kills the bulb for a while. Host only.
  popLightNear(x, z, r) {
    let best = null, bd = r;
    for (const f of this.school.fixtures) {
      if (f.portable || !f.on || f.broken) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) return;
    best.broken = true;
    best.brokenT = 25;
    this.fx('pop', best.x, best.z);
    this.applyPower();
  }

  tickBrokenLights(dt) {
    let changed = false;
    for (const f of this.school.fixtures) {
      if (!f.broken || f.portable) continue;
      f.brokenT -= dt;
      if (f.brokenT <= 0) { f.broken = false; changed = true; }
    }
    if (changed) this.applyPower();
  }

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
    const out = [];
    // Nobody hunts a baby who is busy with a teacher's minigame.
    if (!this.player.dead && !this.player.busy) out.push(this.player);
    for (const rp of this.remotePlayers.values()) if (!rp.dead && !rp.busy) out.push(rp);
    return out;
  }

  targetById(id) {
    if (id === this.player.id) return this.player;
    return this.remotePlayers.get(id) || null;
  }

  nearestTarget(x, z) {
    let best = null, bd = Infinity;
    for (const t of this.threatTargets()) {
      const d = dist2(x, z, t.x, t.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  huntTarget(grump) {
    let best = null, bestScore = -Infinity;
    for (const t of this.threatTargets()) {
      if (grump.ignore[t.id]) continue;
      const d = dist2(grump.x, grump.z, t.x, t.z);
      const lit = this.roomBrightness(t.x, t.z);
      const s = (1 - lit) * 2 + clamp(1 - d / 60, 0, 1) + (t.hidden ? -0.8 : 0) + (t.downed ? 0.6 : 0);
      if (s > bestScore) { bestScore = s; best = t; }
    }
    return best;
  }

  threatPressure(x, z) {
    let p = 0;
    if (this.bob && this.bob.active) {
      const d = dist2(x, z, this.bob.x, this.bob.z);
      p = Math.max(p, clamp(1 - d / 18, 0, 1) * (this.bob.state === 'chase' ? 1.6 : 0.7));
    }
    if (this.grump) {
      const d = dist2(x, z, this.grump.x, this.grump.z);
      const w = this.grump.hunting ? 1.8 : (this.grump.state === 'stalk' || this.grump.state === 'loom') ? 0.9 : 0.3;
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
      if (this.bob.active) this.bob.hearNoise(n.x, n.z, n.level, this);
      this.grump.hearNoise(n.x, n.z, n.level, this);
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

  hideSpotOf(t) {
    if (t === this.player) return this.player.hidden || null;
    return t.hiddenPropId !== null && t.hiddenPropId !== undefined ? this.propById.get(t.hiddenPropId) || null : null;
  }

  // Who is inside this hiding place, if anyone -- local or remote.
  occupantOf(prop) {
    if (this.player.hidden === prop) {
      if (this.player.tapedIn > 0) { this.ui.toast('The door rattles. The tape holds.'); return null; }
      return this.player;
    }
    for (const rp of this.remotePlayers.values()) {
      if (rp.hidden && rp.hiddenPropId === prop.id && !rp.taped) return rp;
    }
    return null;
  }

  forceUnhide(t) {
    if (t === this.player) {
      if (this.player.hidden) { this.player.exitHide(this); this.ui.toast('The door is pulled open.'); }
    } else if (this.isHost && this.online) {
      this.net.sendTo(t.id, { t: 'ev', k: 'unhide' });
    }
  }

  // Damage goes to whoever was actually caught -- never to whoever happens to
  // be running the simulation.
  hitPlayer(t, src, extra = {}) {
    if (t === this.player) this.applyHit(src, extra);
    else if (this.isHost && this.online) this.net.sendTo(t.id, { t: 'ev', k: 'hit', src, e: extra });
  }

  grumpCaught(t) {
    // The world consequence is decided by the host...
    let text = 'HE FOUND YOU';
    const safe = this.toddlers.list.filter(x => x.state === 'safe');
    if (safe.length && Math.random() < 0.7) {
      const t2 = safe[(Math.random() * safe.length) | 0];
      t2.state = 'taken';
      t2.model.visible = false;
      this.score -= 100;
      text = t2.name.toUpperCase() + ' IS GONE';
      this.fx('toast', 0, 0, { text: `Grump took ${t2.name}.` });
    }
    // ...and the pain goes to the one he caught.
    this.hitPlayer(t, 'grump', { text });
  }

  applyHit(src, e = {}) {
    const p = this.player;
    if (p.dead) return;
    if (src === 'bob') {
      p.invuln = 0;
      p.hurt(28, this, 'bob');
      if (p.hidden) p.exitHide(this);
      const n = p.dropAll(this);
      const lf = this.school.lostfound;
      [p.x, p.z] = this.freeSpotIn(lf, 0.3);
      p.fear = Math.min(100, p.fear + 30);
      this.ui.flash('spotted');
      this.ui.bigLine('LOST AND FOUND');
      this.ui.toast(n ? `Bob took ${n} of your things.` : 'Bob put you back where you belong.');
    } else if (src === 'grump') {
      p.invuln = 0;
      if (p.hidden) p.exitHide(this);
      this.jumpT = 0.9;
      this.sfx.jumpscare();
      this.sfx.voice('angry', 1, 0.75);
      this.ui.flash('grump');
      p.hurt(62, this, 'grump');
      p.fear = 100;
      this.ui.bigLine(e.text || 'HE FOUND YOU');
    }
  }

  onGrumpStageUp(stage) {
    const lines = ['', 'HE IS KEEPING SCORE', 'HE HAS STOPPED SMILING', 'HE KNOWS WHERE YOU SLEEP', 'GRUMP THE BABY DESTROYER'];
    if (lines[stage]) {
      this.ui.bigLine(lines[stage]);
      this.sfx.grumpReveal();
    }
  }

  onPlayerDowned() {
    this.ui.bigLine(this.online ? 'YOU CANNOT GET UP\nA FRIEND CAN PAT YOU' : 'YOU CANNOT GET UP');
  }

  onPlayerDead() {
    this.minigames.abort();
    if (this.online) {
      // Co-op: you become a ghost and watch. The game is over when everyone is.
      this.ui.bigLine('YOU ARE GONE');
      this.ui.toast('Spectating. If anyone escapes, everyone does.');
      this.player.hidden = null;
      this.player.torchOn = false;
      return;
    }
    this.running = false;
    document.exitPointerLock();
    this.sfx.lose();
    this.sfx.setDrone(0);
    this.sfx.setGenerator(false, 0);
    this.showLoss();
  }

  showLoss() {
    const s = this.player.stats;
    this.ui.showOver('THE SCHOOL KEEPS YOU', 'Bob will put you in Lost and Found in the morning.', [
      `Nights survived: <b>${this.night - 1}</b>`,
      `Little ones safe: <b>${this.toddlers.saved}</b>`,
      `Jobs finished: <b>${this.quests.completed}</b>`,
      `Containers searched: <b>${s.searched}</b> · Messes cleaned: <b>${s.cleaned}</b>`,
      `Drawings found: <b>${s.drawings}</b> of ${DRAWINGS.length}`,
      `Score: <b>${Math.round(this.score)}</b>`
    ]);
  }

  gameOverAll() {
    this.net.broadcast({ t: 'ev', k: 'gameover' });
    this.endRun(false);
  }

  endRun(won) {
    this.running = false;
    document.exitPointerLock();
    this.sfx.setDrone(0);
    this.sfx.setGenerator(false, 0);
    if (won) {
      this.sfx.win();
      const total = Math.round(this.score + this.toddlers.saved * 150 + this.night * 100);
      this.ui.showOver('YOU GOT OUT', 'The gate closes behind you. Nobody follows.', [
        `Nights survived: <b>${this.night - 1}</b>`,
        `Little ones carried out: <b>${this.toddlers.saved}</b>`,
        `Jobs finished: <b>${this.quests.completed}</b>`,
        `Drawings found: <b>${this.player.stats.drawings}</b> of ${DRAWINGS.length}`,
        `Grump, at the end: <b>${this.grumpMood()}</b>`,
        `Final score: <b>${total}</b>`
      ]);
    } else {
      this.sfx.lose();
      this.showLoss();
    }
  }

  escape() {
    if (!this.online) { this.endRun(true); return; }
    if (this.isHost) { this.net.broadcast({ t: 'ev', k: 'win' }); this.endRun(true); }
    else this.net.send({ t: 'act', k: 'escape' });
  }

  requestRevive(rp) {
    if (this.isHost) {
      rp.downed = false;
      this.net.sendTo(rp.id, { t: 'ev', k: 'revive' });
    } else {
      this.net.send({ t: 'act', k: 'revive', id: rp.id });
    }
    this.ui.toast(`${rp.name} is up.`);
  }

  fuelTimeLeft() {
    const r = this.generator.burnRate(this);
    return fmtTime(this.generator.fuel / Math.max(r, 0.01)) + ' of burn';
  }

  // ================================================================= quests

  questEvent(type, data) {
    if (this.isHost && this.quests) this.quests.event(type, data);
  }

  // Something the local player did that counts for the list.
  questAction(type, data) {
    if (this.isHost) this.questEvent(type, data);
    else this.net.send({ t: 'act', k: 'quest', type });
  }

  questDeliver(item) {
    const p = this.player;
    if (!p.take(item)) return;
    this.sfx.ding();
    if (item === 'hamster') this.ui.toast('Mr. Wiggles is home. He runs straight into his wheel.');
    if (item === 'holocard') this.ui.toast('You leave the card on the shelf. Nobody comes for it.');
    if (item === 'crayon') this.ui.toast('Grump takes the crayon without looking at you.');
    if (this.isHost) this.handleDeliver(item);
    else this.net.send({ t: 'act', k: 'deliver', item });
  }

  handleDeliver(item) {
    if (item === 'crayon' && !this.grump.turned) {
      this.grump.anger(-15, this, 'crayon');
      this.fx('say', this.grump.x, this.grump.z, { text: 'That is mine. You touched it.', voice: 'mean' });
    }
    this.questEvent('deliver', { item });
  }

  questReward(q, items) {
    const c = this.crib;
    const fx = c ? c.x + Math.sin(c.rot) * 1.1 : this.school.home.cx;
    const fz = c ? c.z + Math.cos(c.rot) * 1.1 : this.school.home.cz;
    items.forEach((k, i) => this.spawnGroundItem(k, fx + (i - (items.length - 1) / 2) * 0.45, fz));
    this.score += 90;
    this.fx('quest', 0, 0, { title: q.title, reward: items.map(itemName).join(' + ') });
    if (this.quests.allDone) this.fx('toast', 0, 0, { text: 'The whole list is done. Mrs. Honeywell would be proud.' });
  }

  onQuestSeenDone() { /* clients hear about completion through the quest fx */ }

  // ================================================================= grump talk

  tryTalkToGrump() {
    const g = this.grump;
    if (g.hunting || g.turned) {
      this.ui.subtitle('Grump: "No more questions."');
      this.sfx.grumpAngry();
      return;
    }
    this.talkedToday = true;
    this.dialogueOpen = true;
    if (this.isHost) g.busy = true;
    else this.net.send({ t: 'act', k: 'talk', on: true });
    document.exitPointerLock();
    const rng = makeRng(hashStr(this.seed + ':q:' + this.night + ':' + Math.floor(g.resent) + ':' + this.myTargetId));
    const q = pickQuestion(g.resent, this.askedQs, rng);
    this.askedQs.add(q.q);
    this.sfx.voice('greeting');
    this.ui.showDialogue(q, g.resent, ans => {
      if (this.isHost) {
        g.anger(ans.r, this, 'answer');
        this.rememberAnswer(ans.t);
      } else {
        // Show the meter move now; the host's number arrives with the next snapshot.
        g.resent = clamp(g.resent + ans.r, 0, 130);
        this.net.send({ t: 'act', k: 'answer', r: ans.r, text: ans.t });
      }
      this.sfx.voice(g.stage >= 3 ? 'angry' : 'mean');
      this.ui.showDialogueReply(ans.reply, g.resent, () => {
        this.ui.closeDialogue();
        this.dialogueOpen = false;
        if (this.isHost) g.busy = false;
        else this.net.send({ t: 'act', k: 'talk', on: false });
        g.talkCd = 25;
        this.resumeFromOverlay();
      });
    });
  }

  rememberAnswer(text) {
    const m = this.grump.memory;
    if (!m.includes(text)) m.push(String(text).slice(0, 60));
    while (m.length > 8) m.shift();
  }

  objectivesHtml() {
    const g = this.generator;
    const rows = [];
    rows.push(`<h5>Mrs. Honeywell's list</h5>`);
    rows.push(this.quests.detailHtml() || '<div>No list today.</div>');
    rows.push(`<h5 style="margin-top:8px">The school</h5>`);
    rows.push(`<div>Generator — ${Math.round(g.fuel)}% fuel, ${Math.round(g.condition)}% condition</div>`);
    rows.push(`<div class="${this.messes.remaining === 0 ? 'done' : ''}">Messes left — ${this.messes.remaining}</div>`);
    rows.push(`<div class="${this.toddlers.lost === 0 ? 'done' : 'warn'}">Little ones still out — ${this.toddlers.lost}</div>`);
    rows.push(`<div class="${this.player.food > 35 ? '' : 'warn'}">Tummy — ${Math.round(this.player.food)}%</div>`);
    rows.push(`<h5 style="margin-top:8px">Tonight</h5>`);
    rows.push(`<div>Night ${this.night}${this.requiredNights > 0 ? ' of ' + this.requiredNights : ' (endless)'}</div>`);
    rows.push(`<div>Grump is ${this.grumpMood()}</div>`);
    if (!this.grump.turned) {
      const left = Math.max(0, 4 - this.night);
      rows.push(`<div class="warn">${left ? `He stops asking in ${left} day${left === 1 ? '' : 's'}.` : 'He stops asking today.'}</div>`);
    }
    if (this.modText) rows.push(`<div class="warn">${this.modText}</div>`);
    if (this.escapeOpen) rows.push(`<div class="warn">The front doors are open.</div>`);
    return rows.join('');
  }

  // ================================================================= net

  netEvent(ev) {
    if (!this.online) return;
    if (this.isHost) this.net.broadcast(Object.assign({ t: 'ev' }, ev));
    else this.net.send(Object.assign({ t: 'ev' }, ev));
  }

  // Everything a late joiner needs that the seed alone cannot rebuild.
  worldMessage() {
    const s = this.school;
    return {
      t: 'world', v: GAME_VERSION, seed: this.seed, nights: this.requiredNights, diff: this.diffName,
      st: {
        night: this.night, phase: this.phase, phaseTime: this.phaseTime,
        doors: s.doors.map(d => (d.open ? 1 : 0) | (d.locked ? 2 : 0)),
        lights: s.rooms.map(r => r.lightsOn ? 1 : 0),
        searched: s.props.filter(p => p.searchCount).map(p => [p.id, p.searchCount]),
        messes: this.messes.serialize(),
        quests: this.quests.list.map(q => q.spec),
        qp: this.quests.serialize(),
        mods: Object.keys(this.mods),
        eo: this.escapeOpen ? 1 : 0,
        turned: this.grump._turned ? 1 : 0,
        resent: this.grump.resent
      }
    };
  }

  applyWorldState(st) {
    const s = this.school;
    this.night = st.night;
    this.phase = st.phase;
    this.phaseTime = st.phaseTime;
    st.doors.forEach((v, i) => {
      const d = s.doors[i];
      if (!d) return;
      d.open = !!(v & 1); d.locked = !!(v & 2);
      if (d.box) d.box.active = !d.open;
    });
    st.lights.forEach((v, i) => { if (s.rooms[i]) s.rooms[i].lightsOn = !!v; });
    for (const e of st.searched) {
      const [id, c] = Array.isArray(e) ? e : [e, 1];
      const p = this.propById.get(id);
      if (p) { p.searched = true; p.searchCount = c; }
    }
    this.messes.spawnForDay(this.night, this.seed);
    for (const id of st.messes) this.messes.remove(this.messes.list[id]);
    this.quests.load(st.quests, this.night);
    this.quests.apply(st.qp);
    this.applyMods(st.mods);
    this.escapeOpen = !!st.eo;
    if (this.escapeOpen) for (const d of s.exitDoors) d.locked = false;
    if (st.turned) this.grump.checkSchedule(99);
    this.grump.resent = st.resent;
    setGrumpStage(this.grump.model, this.grump.stage);
    this.applyPower();
  }

  sendSnapshot() {
    const players = [Object.assign({ id: 'host', n: this.myName }, this.player.serialize())];
    for (const rp of this.remotePlayers.values()) {
      players.push({
        id: rp.id, n: rp.name, x: +rp.x.toFixed(2), z: +rp.z.toFixed(2), yaw: +rp.yaw.toFixed(2),
        c: rp.crawling ? 1 : 0, h: rp.hidden ? 1 : 0, d: rp.downed ? 1 : 0, t: rp.torch ? 1 : 0,
        hp: rp.health, dd: rp.dead ? 1 : 0, hid: rp.hiddenPropId
      });
    }
    const broken = [];
    for (const f of this.school.fixtures) if (f.broken && !f.portable) broken.push(f.id);
    this.net.broadcast({
      t: 'snap',
      p: players,
      b: this.bob.active ? { x: +this.bob.x.toFixed(2), z: +this.bob.z.toFixed(2), y: +this.bob.yaw.toFixed(2), s: this.bob.state, w: +this.bob.sweep.toFixed(2) } : null,
      g: { x: +this.grump.x.toFixed(2), z: +this.grump.z.toFixed(2), y: +this.grump.yaw.toFixed(2), s: this.grump.state, r: Math.round(this.grump.resent), tn: this.grump._turned ? 1 : 0 },
      gen: this.generator.serialize(),
      tod: this.toddlers.serialize(),
      it: this.groundItems.serialize(),
      ms: this.messes.serialize(),
      bf: broken,
      q: this.quests.serialize(),
      eo: this.escapeOpen ? 1 : 0,
      dr: this.school.doors.map(d => (d.open ? 1 : 0) | (d.locked ? 2 : 0)).join(''),
      lt: this.school.rooms.map(r => r.lightsOn === false ? 0 : 1).join(''),
      ph: this.phase, pt: +this.phaseTime.toFixed(1), nt: this.night
    });
  }

  onPeerJoin(id) {
    if (!this.remotePlayers.has(id)) {
      const rp = new RemotePlayer(this, id, 'Baby', this.remotePlayers.size + 1);
      this.remotePlayers.set(id, rp);
    }
    // The world is sent once they have said hello (see 'hello'), so a
    // duplicate or rejected connection never starts building a school.
  }

  onPeerLeave(id) {
    const rp = this.remotePlayers.get(id);
    if (rp) {
      this.renderer.scene.remove(rp.model);
      this.remotePlayers.delete(id);
      this.ui.chat(`<b>${escapeHtml(rp.name)}</b> left`);
    }
  }

  onHostGone() {
    if (this.kicked) return;
    this.ui.toast('The host closed the room.');
    this.quitToMenu();
  }

  // Host: remove a connection and its body for good.
  kick(id, why) {
    this.net.sendTo(id, { t: 'kick', why });
    const c = this.net.conns.get(id);
    setTimeout(() => { try { if (c) c.close(); } catch (e) { /* gone */ } }, 300);
    this.net.conns.delete(id);
    const rp = this.remotePlayers.get(id);
    if (rp) {
      if (rp.carrying !== null && rp.carrying !== undefined) {
        const t = this.toddlers.byId(rp.carrying);
        if (t) this.toddlers.place(t, rp.x, rp.z, this, false);
      }
      this.renderer.scene.remove(rp.model);
      this.remotePlayers.delete(id);
    }
  }

  sendChat() {
    const v = $('#chatinput').value.trim();
    this.chatOpen = false;
    this.ui.openChat(false);
    this.resumeFromOverlay();
    if (!v) return;
    this.net.send({ t: 'chat', n: this.myName, m: v.slice(0, 120) });
    this.ui.chat(`<b>${escapeHtml(this.myName)}:</b> ${escapeHtml(v)}`);
  }

  onNetMessage(msg, from) {
    switch (msg.t) {
      case 'hello': {
        const rp = this.remotePlayers.get(from);
        if (this.isHost) {
          const dev = String(msg.dev || '');
          // the host's own device, joining its own room
          if (dev && dev === DEVICE_ID) { this.kick(from, 'You are already the host of this room on this device.'); return; }
          // the same device joined twice (two tabs, a double click): keep the
          // newest connection, drop the old body completely
          if (dev) {
            for (const [id, other] of this.remotePlayers) {
              if (id !== from && other.dev === dev) this.kick(id, 'You joined this room again from another tab or window, so this one was closed.');
            }
          }
          if (rp) {
            rp.dev = dev;
            if (!rp.greeted) { rp.greeted = true; if (this.running) this.net.sendTo(from, this.worldMessage()); }
          }
        }
        if (rp) { rp.name = String(msg.name || 'Baby').slice(0, 12); rp.setName(rp.name); }
        this.ui.chat(`<b>${escapeHtml(rp ? rp.name : 'someone')}</b> joins the school`);
        if (this.isHost && msg.v !== GAME_VERSION) {
          this.ui.chat(`<b>${escapeHtml(rp ? rp.name : 'someone')}</b> has a different version of the game. You both need to refresh the page (Ctrl+F5).`);
          this.ui.toast('A joiner is on a different game version -- both of you refresh (Ctrl+F5).');
        }
        break;
      }
      case 'kick': {
        if (this.isHost) break;
        this.kicked = true;
        this.quitToMenu();
        this.net.close();
        setTimeout(() => {
          this.ui.screen('joinscreen');
          $('#join-err').textContent = String(msg.why || 'The host closed this connection.');
          $('#join-go').disabled = false;
          this.kicked = false;
        }, 300);
        break;
      }
      case 'world': {
        if (this.isHost) break;
        // the same world twice (a duplicate message): just refresh the state
        if (this.running && this.seed === msg.seed && msg.v === GAME_VERSION) { this.applyWorldState(msg.st); break; }
        if (msg.v !== GAME_VERSION) {
          // Different code builds a different school: doors, lockers and
          // messes would not line up. Say so instead of playing broken.
          this.ui.loading(false);
          this.net.close();
          // after the disconnect handling has had its say, show why
          setTimeout(() => {
            this.ui.screen('joinscreen');
            $('#join-err').textContent = 'The host is running a different version of the game. Both of you refresh the page (Ctrl+F5), then try again.';
            $('#join-go').disabled = false;
          }, 400);
          break;
        }
        this.ui.loading(false);
        this.pendingWorld = msg.st;
        this.startGame({ seed: msg.seed, nights: msg.nights, diff: msg.diff, night: msg.st.night, online: true, name: this.myName });
        break;
      }
      case 'pos': {
        if (!this.isHost) break;
        const rp = this.remotePlayers.get(from);
        if (!rp) break;
        msg.s.n = rp.name;     // the host decides what a player is called
        rp.apply(msg.s);
        if (Array.isArray(msg.nz)) {
          for (const n of msg.nz.slice(0, 6)) this.emitNoise(+n[0], +n[1], clamp(+n[2], 0, 1.6), 'client');
        }
        break;
      }
      case 'snap': this.applySnapshot(msg); break;
      case 'chat': {
        const line = `<b>${escapeHtml(String(msg.n).slice(0, 12))}:</b> ${escapeHtml(String(msg.m).slice(0, 120))}`;
        this.ui.chat(line);
        if (this.isHost) this.net.broadcast(msg, from);
        break;
      }
      case 'ev': this.applyEvent(msg, from); break;
      case 'act': this.applyAction(msg, from); break;
    }
  }

  applySnapshot(m) {
    if (this.isHost || !this.running) return;

    const seen = new Set();
    for (const s of m.p) {
      if (s.id === this.net.myId) continue;
      seen.add(s.id);
      let rp = this.remotePlayers.get(s.id);
      if (!rp) {
        rp = new RemotePlayer(this, s.id, s.n, this.remotePlayers.size + 1);
        this.remotePlayers.set(s.id, rp);
      }
      rp.apply(s);
    }
    for (const [id, rp] of this.remotePlayers) {
      if (!seen.has(id)) { this.renderer.scene.remove(rp.model); this.remotePlayers.delete(id); }
    }

    if (m.b) {
      this.bob.x = m.b.x; this.bob.z = m.b.z; this.bob.yaw = m.b.y;
      this.bob.state = m.b.s; this.bob.sweep = m.b.w;
    } else this.bob.state = 'off';

    const g = this.grump;
    g.x = m.g.x; g.z = m.g.z; g.yaw = m.g.y; g.state = m.g.s;
    if (m.g.tn && !g._turned) g.checkSchedule(99);
    if (!this.dialogueOpen && m.g.r !== Math.round(g.resent)) g.anger(m.g.r - g.resent, this, 'sync');

    this.generator.fuel = m.gen.f;
    this.generator.condition = m.gen.c;
    if (!!m.gen.r !== this.generator.running) {
      this.generator.running = !!m.gen.r;
      this.sfx.setGenerator(this.generator.running, this.generator.condition / 100);
      this.applyPower();
    }

    // Keep the toddler we are carrying in our arms while the host catches up.
    const mine = this.player.carryingToddler ? this.player.hands.toddler : null;
    this.toddlers.applySnapshot(m.tod.map(r => r.i === mine ? Object.assign({}, r, { s: 'carried' }) : r));

    // Do not let an item we just picked up reappear before the host hears.
    for (const [id, until] of this.pendingTakes) if (this.time > until) this.pendingTakes.delete(id);
    this.groundItems.applySnapshot(m.it.filter(r => !this.pendingTakes.has(r.i)));

    for (const id of m.ms) this.messes.remove(this.messes.list[id]);

    const broken = new Set(m.bf);
    let changed = false;
    for (const f of this.school.fixtures) {
      if (f.portable) continue;
      const b = broken.has(f.id);
      if (!!f.broken !== b) { f.broken = b; changed = true; }
    }
    if (changed) this.applyPower();

    this.quests.apply(m.q);

    // Doors and lights: the host's word is final, except for a door or switch
    // we touched ourselves a moment ago (our message may still be on its way).
    if (typeof m.dr === 'string') {
      this.school.doors.forEach((d, i) => {
        const v = +m.dr[i];
        if (isNaN(v) || (d.touchT && this.time - d.touchT < 1.5)) return;
        const open = !!(v & 1), locked = !!(v & 2);
        if (d.open !== open || d.locked !== locked) {
          d.open = open; d.locked = locked;
          if (d.box) d.box.active = !open;
        }
      });
    }
    if (typeof m.lt === 'string') {
      let lit = false;
      this.school.rooms.forEach((r, i) => {
        const on = m.lt[i] !== '0';
        if (r.touchT && this.time - r.touchT < 1.5) return;
        if ((r.lightsOn !== false) !== on) { r.lightsOn = on; lit = true; }
      });
      if (lit) this.applyPower();
    }

    if (m.eo && !this.escapeOpen) {
      this.escapeOpen = true;
      for (const d of this.school.exitDoors) d.locked = false;
    }
    this.phase = m.ph; this.phaseTime = m.pt; this.night = m.nt;
  }

  applyEvent(m, from) {
    if (!this.running || !this.school) return;
    switch (m.k) {
      case 'fx': if (!this.isHost) this.playFx(m.f, m.x, m.z, m.e || {}); return;
      case 'search': {
        const p = this.propById.get(m.id);
        if (p) { p.searched = true; if (m.c) p.searchCount = m.c; }
        if (!this.isHost && m.by === this.net.myId) this.giveFound(m.found, m.c === 1);
        break;
      }
      case 'mess': this.messes.remove(this.messes.list[m.id]); break;
      case 'door': {
        const d = this.school.doors[m.id];
        if (!d) return;
        if (this.isHost && from !== undefined) {
          // A joiner asked. The host decides: a door only unlocks if it was
          // unlocked by a key (the joiner spent it), exits stay chained until
          // the run is won, and nothing shuts on someone standing in it.
          if (d.exit && !this.escapeOpen) { this.sendDoorState(d, from); return; }
          if (d.locked && !m.locked) d.locked = false;
          if (m.open && d.locked) { this.sendDoorState(d, from); return; }
          if (!m.open && d.open && this.somethingInDoorway(d)) { this.sendDoorState(d, from); return; }
          d.open = !!m.open;
          d.touchT = this.time;
          if (d.box) d.box.active = !d.open;
          this.net.broadcast({ t: 'ev', k: 'door', id: d.id, open: d.open, locked: d.locked }, from);
          return;
        }
        if (d.touchT && this.time - d.touchT < 0.4 && from === undefined && !this.isHost && m.ack === undefined) {
          // our own press is newer than this echo
        }
        d.open = !!m.open; d.locked = !!m.locked;
        if (d.box) d.box.active = !d.open;
        if (m.ack) d.touchT = 0;
        break;
      }
      case 'lights': {
        const r = this.school.rooms[m.room];
        if (r) {
          r.lightsOn = m.on;
          this.applyPower();
          if (this.isHost) this.questEvent('lights', { room: r.type, on: m.on });
        }
        break;
      }
      case 'breakers': for (const r of this.school.rooms) r.lightsOn = true; this.applyPower(); break;
      case 'gen':
        if (!this.isHost && typeof m.on === 'boolean' && this.generator.running !== m.on) {
          this.generator.running = m.on;
          this.sfx.setGenerator(m.on, this.generator.condition / 100);
        }
        this.applyPower();
        break;
      case 'light': if (from !== undefined) this.portableLights.place(m.kind, m.x, m.z); break;
      case 'phase': {
        if (this.isHost) return;
        this.phase = m.phase;
        this.night = m.night;
        if (m.phase === 'day') {
          this.applyMods([]);
          this.messes.spawnForDay(m.night, this.seed);
          for (const p of this.school.props) { p.searched = false; p.checked = false; p.searchCount = 0; }
          if (m.quests) this.quests.load(m.quests, m.night);
          if (m.eo) { this.escapeOpen = true; for (const d of this.school.exitDoors) d.locked = false; }
          if (m.dawn) this.ui.showDawn(m.dawn.title, m.dawn.kicker, m.dawn.lines);
          this.honeywell.morning();
          this.jerry.resetDay();
          this.meredith.resetDay();
          this.sfx.phaseDay();
          this.sfx.setDrone(0);
        } else {
          this.applyMods(m.mods || []);
          if (m.pt) this.phaseTime = m.pt;
          this.ui.bigLine('NIGHT ' + m.night);
          this.sfx.phaseNight();
          for (const id of m.mods || []) this.ui.toast(NIGHT_MODS.find(x => x.id === id).desc);
        }
        this.cardKid.resetPhase();
        return;
      }
      // --- messages addressed to this player only
      case 'hit': if (!this.isHost) this.applyHit(m.src, m.e || {}); return;
      case 'unhide': if (!this.isHost && this.player.hidden) { this.player.exitHide(this); this.ui.toast('The door is pulled open.'); } return;
      case 'revive': if (!this.isHost && this.player.downed) { this.player.revive(); this.ui.toast('Someone patted you until you got up.'); } return;
      case 'fb': if (!this.isHost) { this.ui.toast(m.text); if (m.sound && this.sfx[m.sound]) this.sfx[m.sound](); } return;
      case 'cardkid': if (!this.isHost) this.cardKid.maybeTrigger(); return;
      case 'lostitem': if (!this.isHost) { this.player.take(m.kind); this.ui.toast('Someone else got to it first.'); } return;
      case 'win': if (!this.isHost) this.endRun(true); return;
      case 'gameover': if (!this.isHost) this.endRun(false); return;
    }
    // Client-originated world events get passed on to everyone else.
    if (this.isHost && from !== undefined) this.net.broadcast(m, from);
  }

  // Host-side handling of a client's request.
  applyAction(m, from) {
    if (!this.isHost) return;
    const rp = this.remotePlayers.get(from);
    if (!rp) return;
    switch (m.k) {
      case 'search': {
        const p = this.propById.get(m.id);
        if (!p) return;
        // Two babies can rummage in the same cupboard; it just runs out faster.
        const found = this.rollSearch(p);
        this.net.broadcast({ t: 'ev', k: 'search', id: p.id, found, by: from, c: p.searchCount });
        break;
      }
      case 'take': {
        const it = this.groundItems.list.find(i => i.id === m.id);
        if (it) this.groundItems.remove(it);
        else this.net.sendTo(from, { t: 'ev', k: 'lostitem', kind: m.kind });
        break;
      }
      case 'drop': if (ITEMS[m.kind]) this.groundItems.spawn(m.kind, +m.x, +m.z); break;
      case 'carry': {
        const t = this.toddlers.byId(m.id);
        if (t) { t.state = 'carried'; t.model.visible = false; rp.carrying = m.id; }
        break;
      }
      case 'drop_toddler': {
        const t = this.toddlers.byId(m.id);
        rp.carrying = null;
        if (t) this.toddlers.place(t, +m.x || rp.x, +m.z || rp.z, this, false);
        break;
      }
      case 'feed': { const t = this.toddlers.byId(m.id); if (t) { this.toddlers.feed(t); this.questEvent('fed'); } break; }
      case 'teddy': { const t = this.toddlers.byId(m.id); if (t) this.toddlers.calm(t); break; }
      case 'mess': {
        const mm = this.messes.list[m.id];
        if (this.messes.remove(mm)) {
          this.messCleanedByAnyone();
          this.net.broadcast({ t: 'ev', k: 'mess', id: m.id }, from);
        }
        break;
      }
      case 'gen': if (['start', 'refuel', 'repair'].includes(m.kind)) this.generator[m.kind](this, from); break;
      case 'light': {
        this.portableLights.place(m.kind, +m.x, +m.z);
        this.net.broadcast({ t: 'ev', k: 'light', kind: m.kind, x: m.x, z: m.z }, from);
        break;
      }
      case 'quest': if (CLIENT_QUEST_EVENTS.has(m.type)) this.questEvent(m.type); break;
      case 'deliver': if (['hamster', 'crayon', 'holocard'].includes(m.item)) this.handleDeliver(m.item); break;
      case 'bullied': {
        // A friend just watched Grump take on the Big Boys Club for them.
        if (rp.bullied) break;
        rp.bullied = true;
        if (!this.grump.turned) this.grump.anger(-20, this, 'bullies');
        break;
      }
      case 'answer': {
        this.talkedToday = true;
        if (!this.grump.turned) this.grump.anger(clamp(+m.r || 0, 0, 25), this, 'answer');
        this.rememberAnswer(m.text);
        break;
      }
      case 'talk': {
        this.grump.busy = !!m.on;
        clearTimeout(this.busyTimer);
        if (m.on) this.busyTimer = setTimeout(() => { this.grump.busy = false; }, 30000);
        break;
      }
      case 'revive': {
        if (m.id === 'host') { if (this.player.downed) { this.player.revive(); this.ui.toast(`${rp.name} patted you until you got up.`); } }
        else {
          const r2 = this.remotePlayers.get(m.id);
          if (r2) { r2.downed = false; this.net.sendTo(m.id, { t: 'ev', k: 'revive' }); }
        }
        break;
      }
      case 'escape': if (this.escapeOpen) this.escape(); break;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__GRUMP = new Game();
});
