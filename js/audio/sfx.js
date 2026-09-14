// Every sound is synthesised at runtime with the Web Audio API. Nothing to
// download, which keeps the whole game a static folder.
import { clamp } from '../util/util.js?v=2026-09-13f';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.noiseBuf = null;
    this.drone = null;
    this.heart = { t: 0 };
    this.genHum = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 6;
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return this.ctx;
  }

  resume() { const c = this.ensure(); if (c && c.state === 'suspended') c.resume(); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  // ---------------------------------------------------------------- voice
  // Grump is the one character with a real recorded voice. The clips are
  // decoded once and then played through the same master bus as everything
  // else, so the volume slider and distance falloff apply to him too.
  async loadVoices(map) {
    const ctx = this.ensure(); if (!ctx) return;
    this.voices = this.voices || {};
    await Promise.all(Object.entries(map).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        this.voices[name] = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) {
        console.warn('voice line failed to load:', name, e);
      }
    }));
  }

  // Returns the clip length in seconds so callers can hold a dialogue beat for
  // exactly as long as Grump is talking. 0 means it did not play.
  // `rate` below 1 drags the clip slower and lower -- used once Grump has turned.
  voice(name, gain = 1, rate = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.voices || !this.voices[name] || gain <= 0.01) return 0;
    if (this.speaking && this.speaking.src) {
      try { this.speaking.src.stop(); } catch (e) { /* already finished */ }
    }
    const buf = this.voices[name];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, gain) * 1.35;
    src.connect(g); g.connect(this.master);
    src.start();
    const len = buf.duration / rate;
    this.speaking = { src, until: ctx.currentTime + len };
    return len;
  }

  get isSpeaking() {
    return !!(this.speaking && this.ctx && this.ctx.currentTime < this.speaking.until);
  }

  stopVoice() {
    if (this.speaking && this.speaking.src) {
      try { this.speaking.src.stop(); } catch (e) { /* already finished */ }
      this.speaking = null;
    }
  }

  // ---------------------------------------------------------------- atoms
  tone(freq, dur, type = 'square', gain = 0.16, slide = 0, delay = 0) {
    // exponential ramps cannot reach zero: a silent tone is simply skipped
    if (!(gain > 0.001)) return;
    const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(25, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  noise(dur = 0.12, gain = 0.18, freq = 1200, q = 1, type = 'bandpass', delay = 0) {
    if (!(gain > 0.001)) return;
    const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.03);
  }

  // ---------------------------------------------------------------- player
  step(crawl) {
    if (crawl) this.noise(0.09, 0.035, 420, 0.7);
    else { this.noise(0.07, 0.075, 900, 1.1); this.tone(110, 0.04, 'sine', 0.05); }
  }
  hurt() {
    this.tone(500, 0.18, 'sawtooth', 0.2, -320);
    this.tone(340, 0.26, 'square', 0.12, -220, 0.05);
  }
  // a long low rumble with a gurgle on the end
  growl() {
    this.tone(70, 0.9, 'sawtooth', 0.12, 25);
    this.tone(95, 0.7, 'sine', 0.1, -30, 0.25);
    this.noise(0.9, 0.08, 180, 0.6, 'lowpass', 0.05);
    this.tone(160, 0.18, 'sine', 0.06, 90, 0.85);
  }

  babyCry() {
    this.tone(620, 0.42, 'sawtooth', 0.15, -260);
    this.tone(720, 0.5, 'sawtooth', 0.13, -380, 0.3);
    this.tone(560, 0.6, 'sawtooth', 0.11, -300, 0.75);
  }
  babble() {
    const f = 420 + Math.random() * 260;
    this.tone(f, 0.1, 'square', 0.1, 120);
    this.tone(f * 0.8, 0.12, 'square', 0.08, -80, 0.11);
  }
  pickup() { this.tone(720, 0.06, 'square', 0.1, 320); this.tone(980, 0.07, 'square', 0.07, 200, 0.05); }
  drop() { this.tone(300, 0.09, 'square', 0.09, -140); }
  deny() { this.tone(180, 0.14, 'square', 0.12, -60); }
  click() { this.tone(640, 0.03, 'square', 0.06); }
  ding() { this.tone(880, 0.14, 'sine', 0.11, 240); this.tone(1320, 0.18, 'sine', 0.06, 180, 0.04); }
  searchTick() { this.noise(0.05, 0.05, 2600, 2.4); }
  clean() { this.noise(0.16, 0.07, 700, 0.5); }
  eat() { this.noise(0.1, 0.09, 380, 1.4); this.tone(200, 0.07, 'sine', 0.08, 60, 0.08); }

  // ---------------------------------------------------------------- world
  doorMove(open) {
    this.noise(0.28, 0.06, open ? 520 : 380, 0.8);
    this.tone(open ? 150 : 120, 0.16, 'sine', 0.05, -30);
  }
  lockerOpen() { this.noise(0.2, 0.12, 2200, 1.6); this.tone(420, 0.1, 'triangle', 0.07, -180); }
  lockerShut() { this.noise(0.12, 0.18, 1600, 1.2); this.tone(160, 0.12, 'square', 0.1, -60); }
  lightOn() { this.noise(0.06, 0.09, 3200, 1.6); this.tone(120, 0.5, 'sine', 0.03, 8); }
  lightOff() { this.tone(90, 0.18, 'sine', 0.06, -40); this.noise(0.05, 0.05, 1800, 1.4); }
  blackout() {
    this.tone(220, 0.9, 'sawtooth', 0.16, -190);
    this.tone(70, 1.6, 'sine', 0.2, -20, 0.05);
    this.noise(0.5, 0.1, 300, 0.4, 'lowpass', 0.02);
  }
  genStart() {
    this.tone(60, 0.5, 'square', 0.1, 40);
    this.noise(0.4, 0.1, 300, 0.6);
    this.tone(110, 0.3, 'sawtooth', 0.09, 30, 0.35);
  }
  genFail() { this.tone(140, 0.7, 'sawtooth', 0.16, -110); this.noise(0.5, 0.12, 260, 0.5); }
  pour() { this.noise(0.8, 0.07, 900, 0.5); }
  wrench() { this.noise(0.09, 0.13, 3400, 3); this.tone(260, 0.07, 'triangle', 0.07, -80); }

  // ---------------------------------------------------------------- threats
  bobStep(a) { this.noise(0.1, 0.13 * a, 620, 0.9); this.tone(80, 0.08, 'sine', 0.09 * a); }
  bobHum(a) {
    const base = [196, 220, 247, 262][Math.floor(Math.random() * 4)];
    this.tone(base, 0.5, 'sine', 0.05 * a, -14);
    this.tone(base * 1.5, 0.4, 'sine', 0.02 * a, -10, 0.06);
  }
  bobSpot() { this.tone(150, 0.5, 'sawtooth', 0.2, 260); this.noise(0.4, 0.12, 900, 0.6); }
  bobGrab() { this.tone(90, 0.8, 'square', 0.22, -40); this.noise(0.6, 0.18, 400, 0.5); }

  grumpGiggle() {
    const b = 300 + Math.random() * 80;
    for (let i = 0; i < 4; i++) this.tone(b + i * 40, 0.07, 'square', 0.07, -60, i * 0.09);
  }
  grumpAngry() {
    this.tone(160, 0.5, 'sawtooth', 0.2, -70);
    this.tone(82, 0.9, 'square', 0.18, -20, 0.05);
    this.noise(0.6, 0.1, 200, 0.4, 'lowpass', 0.1);
  }
  grumpReveal() {
    this.tone(1200, 0.06, 'square', 0.18, -900);
    this.tone(58, 2.4, 'sawtooth', 0.22, -12, 0.04);
    this.noise(2.0, 0.12, 160, 0.3, 'lowpass', 0.04);
  }
  grumpStep(a) { this.tone(64, 0.14, 'sine', 0.16 * a, -12); this.noise(0.12, 0.07 * a, 300, 0.6); }
  stinger() {
    this.tone(1600, 0.5, 'sawtooth', 0.2, -1400);
    this.tone(120, 0.9, 'square', 0.16, -50, 0.02);
  }
  whisper(a) { this.noise(0.7, 0.05 * a, 1700, 0.8, 'bandpass'); }
  knock(a) {
    for (let i = 0; i < 3; i++) {
      this.noise(0.09, 0.22 * a, 320, 1.2, 'bandpass', i * 0.24);
      this.tone(95, 0.1, 'sine', 0.2 * a, -20, i * 0.24);
    }
  }
  breath(a) {
    this.noise(1.1, 0.06 * a, 480, 0.6, 'lowpass');
    this.noise(0.9, 0.05 * a, 380, 0.6, 'lowpass', 1.3);
  }
  thunder() {
    this.noise(2.6, 0.24, 90, 0.5, 'lowpass');
    this.noise(1.2, 0.14, 240, 0.4, 'lowpass', 0.12);
  }
  bulbPop(a) {
    this.noise(0.08, 0.3 * a, 3800, 2);
    this.tone(1800, 0.05, 'square', 0.08 * a, -1200);
  }
  jumpscare() {
    this.noise(1.2, 0.34, 1200, 0.3);
    this.tone(90, 1.4, 'sawtooth', 0.28, -40);
    this.tone(1400, 0.6, 'square', 0.14, -1100);
  }

  // ---------------------------------------------------------------- ui
  phaseDay() { [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.1, 0, i * 0.11)); }
  phaseNight() { [330, 262, 196, 147].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.12, -10, i * 0.16)); }
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.13, 0, i * 0.13)); }
  lose() { [300, 250, 200, 140].forEach((f, i) => this.tone(f, 0.7, 'sawtooth', 0.15, -40, i * 0.22)); }

  // ---------------------------------------------------------------- beds
  // A low generator hum whose pitch reports the machine's health, and a
  // heartbeat that speeds up with fear. Both are continuous, so they live as
  // long-running nodes rather than one-shots.
  setGenerator(running, health) {
    const ctx = this.ensure(); if (!ctx) return;
    if (running && !this.genHum) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator();
      const g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'square';
      f.type = 'lowpass'; f.frequency.value = 220;
      g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o.start(); o2.start();
      this.genHum = { o, o2, g, f };
    }
    if (!running && this.genHum) {
      const h = this.genHum;
      this.genHum = null;
      h.g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => { try { h.o.stop(); h.o2.stop(); } catch (e) { /* already stopped */ } }, 600);
    }
    if (this.genHum) {
      const wob = 1 - health * 0.35;
      this.genHum.o.frequency.setTargetAtTime(41 * wob, ctx.currentTime, 0.3);
      this.genHum.o2.frequency.setTargetAtTime(20.5 * wob, ctx.currentTime, 0.3);
    }
  }

  // Volume of the generator bed by distance, called every frame.
  setGeneratorProximity(a) {
    if (this.genHum && this.ctx) this.genHum.g.gain.setTargetAtTime(0.015 + 0.08 * a, this.ctx.currentTime, 0.25);
  }

  setDrone(level) {
    const ctx = this.ensure(); if (!ctx) return;
    if (!this.drone) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 140;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 47;
      const og = ctx.createGain(); og.gain.value = 0.35;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); o.connect(og); og.connect(g); g.connect(this.master);
      src.start(); o.start();
      this.drone = { g, f, o };
    }
    this.drone.g.gain.setTargetAtTime(clamp(level, 0, 1) * 0.16, ctx.currentTime, 0.8);
    this.drone.o.frequency.setTargetAtTime(42 + level * 16, ctx.currentTime, 1.2);
  }

  updateHeartbeat(dt, fear) {
    if (fear < 0.35) { this.heart.t = 0; return; }
    const rate = 1.1 - (fear - 0.35) * 0.9;      // seconds between double-thumps
    this.heart.t -= dt;
    if (this.heart.t <= 0) {
      this.heart.t = Math.max(0.34, rate);
      const g = 0.06 + fear * 0.14;
      this.tone(56, 0.13, 'sine', g, -14);
      this.tone(48, 0.16, 'sine', g * 0.8, -10, 0.16);
    }
  }
}
