// Little 2D games that pop up over the school.
//
// Jerry the gym teacher makes you do one of three: lift the dumbbells (spam
// click), run three laps of the gym (a top-down racer -- stay off the grass),
// or jump rope (press on the beat, six in a row). Meredith the lunch lady
// makes you earn lunch with a tiny three-lane rhythm game.
//
// While one is up you cannot move. Alone, the school waits for you; in co-op
// it does not, but nothing will hunt you while you are busy with a teacher.
// Every game is beatable in well under a minute by someone who is good at it.
import { clamp, lerp } from '../util/util.js?v=2026-09-13f';

const W = 560, H = 380;

const $ = s => document.querySelector(s);

export class Minigames {
  constructor(game) {
    this.game = game;
    this.el = $('#minigame');
    this.canvas = $('#mg-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.title = $('#mg-title');
    this.timerEl = $('#mg-timer');
    this.help = $('#mg-help');
    this.cur = null;
    this.canvas.addEventListener('mousedown', e => { e.preventDefault(); this.key('click'); });
    this.canvas.addEventListener('touchstart', e => { e.preventDefault(); this.key('click'); }, { passive: false });
  }

  get active() { return !!this.cur; }

  // kind: 'dumbbells' | 'laps' | 'rope' | 'lunch'. onDone(result) gets
  // { win, score } (score 0..1 for the rhythm game).
  open(kind, onDone) {
    const makers = { dumbbells: Dumbbells, laps: Laps, rope: Rope, lunch: Lunch, bandage: Bandage };
    const M = makers[kind];
    if (!M || this.cur) return false;
    this.cur = new M(this.game);
    this.onDone = onDone;
    this.kind = kind;
    this.title.textContent = this.cur.title;
    this.help.innerHTML = this.cur.help;
    this.el.classList.remove('hidden');
    this.game.ui.setPrompt(null);
    this.game.player.busy = true;
    this.endT = 0;
    return true;
  }

  key(k) {
    if (!this.cur || this.endT > 0) return;
    this.cur.press(k);
  }

  update(dt) {
    const c = this.cur;
    if (!c) return;
    if (this.endT > 0) {
      this.endT -= dt;
      c.draw(this.ctx, dt, true);
      if (this.endT <= 0) this.close();
      return;
    }
    c.time += dt;
    c.update(dt, this.game.keys);
    const left = c.limit - c.time;
    this.timerEl.textContent = left > 0 ? `${Math.ceil(left)}s` : '0s';
    this.timerEl.classList.toggle('low', left < 10);
    if (left <= 0 && c.result === null) c.result = { win: false, score: c.partial ? c.partial() : 0 };
    c.draw(this.ctx, dt, false);
    if (c.result !== null) {
      this.endT = 1.6;
      this.result = c.result;
      if (c.result.win) this.game.sfx.ding(); else this.game.sfx.deny();
    }
  }

  close() {
    const r = this.result || { win: false, score: 0 };
    this.cur = null;
    this.result = null;
    this.el.classList.add('hidden');
    this.game.player.busy = false;
    this.game.resumeFromOverlay();
    // If Esc let go of the mouse during the game, re-locking needs a click:
    // show the pause menu so there is a Resume button to click.
    const g = this.game;
    setTimeout(() => {
      if (g.running && !g.locked && !g.paused && !g.overlayOpen() && !g.player.dead && !g.chatOpen) g.setPaused(true);
    }, 400);
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb(r);
  }

  // Walking away from the game (dying, the day ending under you).
  abort() {
    if (!this.cur) return;
    this.cur = null;
    this.onDone = null;
    this.el.classList.add('hidden');
    this.game.player.busy = false;
  }
}

// ---------------------------------------------------------------- shared bits

function banner(g, text, sub, good) {
  g.fillStyle = 'rgba(10,12,10,.72)';
  g.fillRect(0, H / 2 - 48, W, 96);
  g.fillStyle = good ? '#9fd36a' : '#e0674f';
  g.font = 'bold 34px "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.fillText(text, W / 2, H / 2 + 4);
  if (sub) {
    g.fillStyle = '#e8e2d0';
    g.font = '15px "Trebuchet MS", sans-serif';
    g.fillText(sub, W / 2, H / 2 + 30);
  }
}

function drawBaby(g, x, y, s, lean = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(lean);
  g.scale(s, s);
  // nappy + body
  g.fillStyle = '#6f8f5a'; g.fillRect(-14, -10, 28, 26);
  g.fillStyle = '#f4f2ea'; g.fillRect(-15, 10, 30, 12);
  // head
  g.fillStyle = '#f0c49a';
  g.beginPath(); g.arc(0, -26, 18, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1a1a1a';
  g.beginPath(); g.arc(-6, -28, 2.4, 0, Math.PI * 2); g.arc(6, -28, 2.4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#6a4a2a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(1, -44); g.quadraticCurveTo(6, -50, 2, -54); g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- dumbbells

class Dumbbells {
  constructor(game) {
    this.game = game;
    this.title = 'DUMBBELL TIME';
    this.help = 'Spam <b>click</b>, <b>Space</b> or <b>E</b> to lift. Get the bar to the top <b>4 times</b>. Let go and it sinks.';
    this.limit = 60;
    this.time = 0;
    this.result = null;
    this.lift = 0.15;
    this.reps = 0;
    this.need = 4;
    this.pressT = 0;
    this.flashT = 0;
    this.sweat = [];
  }
  press(k) {
    if (k !== 'click' && k !== ' ' && k !== 'e') return;
    this.lift = Math.min(1, this.lift + 0.062);
    this.pressT = 0.08;
    if (Math.random() < 0.3) this.sweat.push({ x: (Math.random() - 0.5) * 30, y: -40, vy: -40 - Math.random() * 30, vx: (Math.random() - 0.5) * 60, t: 0.6 });
  }
  partial() { return (this.reps + this.lift) / this.need; }
  update(dt) {
    this.pressT = Math.max(0, this.pressT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    // at the top: that is a rep (checked before it sinks again)
    if (this.lift >= 0.999) {
      this.reps++;
      this.lift = 0.3;
      this.flashT = 0.5;
      this.game.sfx.tone(520 + this.reps * 90, 0.15, 'triangle', 0.12, 120);
      if (this.reps >= this.need) this.result = { win: true, score: 1 };
    }
    // heavier the higher it is
    this.lift = Math.max(0, this.lift - dt * (0.1 + 0.18 * this.lift));
    for (const s of this.sweat) { s.t -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 200 * dt; }
    this.sweat = this.sweat.filter(s => s.t > 0);
  }
  draw(g, dt, ended) {
    g.fillStyle = '#3a2f24'; g.fillRect(0, 0, W, H);
    // gym wall + floor
    g.fillStyle = '#d9c9a4'; g.fillRect(0, 0, W, 250);
    g.fillStyle = '#b8864e'; g.fillRect(0, 250, W, H - 250);
    for (let x = 0; x < W; x += 40) { g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(x, 250, 2, H); }
    g.fillStyle = '#8a1f24'; g.fillRect(0, 214, W, 10);

    const cx = 230, baseY = 300;
    const y = lerp(250, 110, this.lift);
    drawBaby(g, cx, baseY - 10, 2.2, this.pressT > 0 ? 0.04 : 0);
    // arms up to the bar
    g.strokeStyle = '#f0c49a'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - 24, baseY - 50); g.lineTo(cx - 44, y + 4); g.moveTo(cx + 24, baseY - 50); g.lineTo(cx + 44, y + 4); g.stroke();
    // the bar
    g.fillStyle = '#9aa0a6'; g.fillRect(cx - 110, y - 3, 220, 6);
    for (const s of [-1, 1]) {
      g.fillStyle = '#2a2d31';
      g.fillRect(cx + s * 110 - 14, y - 34, 28, 68);
      g.fillRect(cx + s * 86 - 9, y - 26, 18, 52);
    }
    for (const s of this.sweat) { g.fillStyle = '#8fd0ff'; g.beginPath(); g.arc(cx + s.x, baseY - 70 + s.y, 3, 0, Math.PI * 2); g.fill(); }

    // meter
    const mx = 440, my = 60, mh = 250;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(mx, my, 38, mh);
    g.fillStyle = this.flashT > 0 ? '#9fd36a' : '#e5a83a';
    g.fillRect(mx + 4, my + mh - 4 - (mh - 8) * this.lift, 30, (mh - 8) * this.lift);
    g.fillStyle = '#fff'; g.fillRect(mx - 6, my, 50, 3);
    g.font = 'bold 22px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#2a2016';
    g.fillText(`REPS ${this.reps}/${this.need}`, mx + 19, my + mh + 30);

    if (ended) banner(g, this.result && this.result.win ? 'W! YOU DID IT!' : 'TOO SLOW', this.result && this.result.win ? 'Jerry is weeping with pride.' : 'Jerry blows the whistle, disappointed.', this.result && this.result.win);
  }
}

// ---------------------------------------------------------------- laps

// A painted oval track round the gym, with astroturf infield and outfield.
// Car-ish physics: throttle, brake, steering that bites harder at speed,
// grip that lets go if you turn too hard, and grass that drags you down.
class Laps {
  constructor(game) {
    this.game = game;
    this.title = 'THREE LAPS AROUND THIS GYM';
    this.help = '<b>W / ↑</b> run · <b>S / ↓</b> brake · <b>A D / ← →</b> turn. Stay on the track -- the grass is slow. Go through the flags in order.';
    this.limit = 75;
    this.time = 0;
    this.result = null;
    this.cx = W / 2; this.cy = H / 2 + 8;
    this.rx = 196; this.ry = 118; this.half = 36;
    // start on the bottom straight, heading right (anticlockwise on screen? no: clockwise)
    this.x = this.cx; this.y = this.cy + this.ry;
    this.a = 0;            // heading, radians, 0 = +x
    this.vx = 0; this.vy = 0;
    this.lap = 0; this.need = 3;
    this.cp = 1;           // next checkpoint (0 = finish line)
    this.trail = [];
    this.lapTimes = [];
    this.lapStart = 0;
    this.stepT = 0;
  }
  // distance from the centre line of the oval, normalised roughly to pixels
  offTrack(x, y) {
    const dx = (x - this.cx) / this.rx, dy = (y - this.cy) / this.ry;
    const r = Math.hypot(dx, dy);
    const scale = Math.hypot(dx * this.rx, dy * this.ry) / Math.max(r, 1e-3);
    return Math.abs(r - 1) * scale;
  }
  angleOf(x, y) {
    // clockwise from bottom: 0 bottom, 1 right, 2 top, 3 left
    const t = Math.atan2((y - this.cy) / this.ry, (x - this.cx) / this.rx);
    return t;
  }
  press() {}
  partial() { return (this.lap + (this.cp - 1) / 4) / this.need; }
  update(dt, keys) {
    const up = keys.has('w') || keys.has('arrowup');
    const down = keys.has('s') || keys.has('arrowdown');
    const left = keys.has('a') || keys.has('arrowleft');
    const right = keys.has('d') || keys.has('arrowright');
    const grass = this.offTrack(this.x, this.y) > this.half;

    const fx = Math.cos(this.a), fy = Math.sin(this.a);
    const speed = this.vx * fx + this.vy * fy;               // forward speed
    const side = -this.vx * fy + this.vy * fx;               // sideways slip
    const maxSp = grass ? 95 : 250;
    let acc = 0;
    if (up) acc = grass ? 260 : 420;
    if (down) acc = speed > 10 ? -520 : -160;
    let fwd = speed + acc * dt;
    // rolling drag, much worse on grass
    fwd -= fwd * (grass ? 3.2 : 0.9) * dt;
    fwd = clamp(fwd, -70, maxSp);
    // steering bites with speed
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const turnRate = 3.4 * clamp(Math.abs(fwd) / 120, 0, 1) * Math.sign(fwd || 1);
    this.a += steer * turnRate * dt;
    // grip: sideways velocity dies off, but not instantly (a little drift)
    let slip = side * Math.max(0, 1 - dt * (grass ? 5 : 9));
    const nfx = Math.cos(this.a), nfy = Math.sin(this.a);
    this.vx = nfx * fwd - nfy * slip;
    this.vy = nfy * fwd + nfx * slip;
    this.x = clamp(this.x + this.vx * dt, 12, W - 12);
    this.y = clamp(this.y + this.vy * dt, 12, H - 12);

    this.trail.push([this.x, this.y]);
    if (this.trail.length > 40) this.trail.shift();
    this.stepT -= Math.abs(fwd) * dt;
    if (this.stepT <= 0) { this.stepT = 28; this.game.sfx.step(grass); }

    // checkpoints: bottom (finish), right, top, left -- in the direction you
    // start facing (bottom straight heading right = anticlockwise in screen
    // space means next is the right side).
    const t = this.angleOf(this.x, this.y);
    const targets = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];   // bottom, right, top, left
    const near = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.28;
    if (near(t, targets[this.cp]) && this.offTrack(this.x, this.y) < this.half + 30) {
      if (this.cp === 0) {
        this.lap++;
        this.lapTimes.push(this.time - this.lapStart);
        this.lapStart = this.time;
        this.game.sfx.tone(660 + this.lap * 110, 0.2, 'triangle', 0.14, 160);
        if (this.lap >= this.need) { this.result = { win: true, score: 1 }; return; }
      } else this.game.sfx.tone(900, 0.05, 'square', 0.06);
      this.cp = (this.cp + 1) % 4;
    }
  }
  draw(g, dt, ended) {
    // grass
    g.fillStyle = '#3f8a3a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect((i * 97) % W, (i * 53) % H, 3, 7); }
    // track
    g.strokeStyle = '#c96a3c'; g.lineWidth = this.half * 2;
    g.beginPath(); g.ellipse(this.cx, this.cy, this.rx, this.ry, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.setLineDash([10, 12]);
    g.beginPath(); g.ellipse(this.cx, this.cy, this.rx, this.ry, 0, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#f4f0e6'; g.lineWidth = 3;
    for (const d of [-this.half, this.half]) {
      g.beginPath(); g.ellipse(this.cx, this.cy, this.rx + d, this.ry + d, 0, 0, Math.PI * 2); g.stroke();
    }
    // finish line
    g.fillStyle = '#fff';
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
      if ((i + j) % 2) g.fillRect(this.cx - 6 + j * 6, this.cy + this.ry - this.half + i * 12, 6, 12);
    }
    // flags
    const targets = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];
    targets.forEach((a, i) => {
      const x = this.cx + Math.cos(a) * this.rx, y = this.cy + Math.sin(a) * this.ry;
      const next = i === this.cp;
      g.fillStyle = next ? '#ffd23f' : 'rgba(255,255,255,.35)';
      g.beginPath(); g.arc(x, y, next ? 9 : 5, 0, Math.PI * 2); g.fill();
    });
    // Jerry in the infield with his clipboard
    g.fillStyle = '#c23a2a'; g.fillRect(this.cx - 12, this.cy - 20, 24, 34);
    g.fillStyle = '#d9a27a'; g.beginPath(); g.arc(this.cx, this.cy - 30, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2efe6'; g.fillRect(this.cx - 12, this.cy - 38, 24, 4);
    g.fillStyle = '#4a2e1c'; g.fillRect(this.cx - 7, this.cy - 27, 14, 3);
    // trail
    g.fillStyle = 'rgba(255,255,255,.25)';
    for (const [x, y] of this.trail) g.fillRect(x - 1, y - 1, 2, 2);
    // the baby, top-down
    g.save();
    g.translate(this.x, this.y); g.rotate(this.a);
    g.fillStyle = '#6f8f5a'; g.fillRect(-9, -8, 16, 16);
    g.fillStyle = '#f0c49a'; g.beginPath(); g.arc(7, 0, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a1a1a'; g.fillRect(11, -4, 2, 2); g.fillRect(11, 2, 2, 2);
    g.restore();
    // HUD
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(8, 8, 150, 50);
    g.fillStyle = '#fff'; g.font = 'bold 20px "Trebuchet MS", sans-serif'; g.textAlign = 'left';
    g.fillText(`LAP ${Math.min(this.lap + 1, this.need)}/${this.need}`, 18, 32);
    g.font = '13px "Trebuchet MS", sans-serif';
    g.fillText(this.offTrack(this.x, this.y) > this.half ? 'ON THE GRASS!' : 'follow the yellow flag', 18, 50);
    if (ended) banner(g, this.result && this.result.win ? 'W! THREE LAPS!' : 'OUT OF TIME', this.result && this.result.win ? `Best lap ${Math.min(...this.lapTimes).toFixed(1)}s` : 'Jerry shakes his head.', this.result && this.result.win);
  }
}

// ---------------------------------------------------------------- jump rope

class Rope {
  constructor(game) {
    this.game = game;
    this.title = 'JUMP ROPE';
    this.help = 'Press <b>Space</b> or <b>click</b> when the rope is at your feet (the ring lights up). <b>6 in a row.</b> Miss and you start again.';
    this.limit = 60;
    this.time = 0;
    this.result = null;
    this.phase = 0.5;        // 0 = rope at the top, 0.5 = at the feet... we start mid-swing
    this.period = 1.25;
    this.streak = 0;
    this.best = 0;
    this.need = 6;
    this.jumpT = 0;
    this.jumpedThisPass = false;
    this.missT = 0;
    this.phase = 0.05;
  }
  // how close the rope is to the feet (phase 0.5)
  footDist() { return Math.abs(this.phase - 0.5); }
  press(k) {
    if (k !== 'click' && k !== ' ' && k !== 'e') return;
    if (this.jumpT > 0) return;
    this.jumpT = 0.42;
    if (this.footDist() < 0.16 && !this.jumpedThisPass) {
      this.jumpedThisPass = true;
      this.streak++;
      this.best = Math.max(this.best, this.streak);
      this.game.sfx.tone(500 + this.streak * 60, 0.08, 'triangle', 0.1, 80);
      if (this.streak >= this.need) this.result = { win: true, score: 1 };
    } else {
      this.fail();
    }
  }
  fail() {
    if (this.streak > 0) this.game.sfx.tone(200, 0.2, 'square', 0.1, -80);
    this.streak = 0;
    this.missT = 0.5;
  }
  partial() { return this.best / this.need; }
  update(dt) {
    this.jumpT = Math.max(0, this.jumpT - dt);
    this.missT = Math.max(0, this.missT - dt);
    const before = this.phase;
    // a touch faster as your streak grows
    const period = this.period - this.streak * 0.03;
    this.phase = (this.phase + dt / period) % 1;
    // the rope just went past your feet
    if (before < 0.5 + 0.16 && this.phase >= 0.5 + 0.16) {
      if (!this.jumpedThisPass) this.fail();
      this.jumpedThisPass = false;
    }
    if (before > this.phase) this.jumpedThisPass = false;
  }
  draw(g, dt, ended) {
    g.fillStyle = '#d9c9a4'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#b8864e'; g.fillRect(0, 290, W, H - 290);
    const cx = W / 2, feetY = 290;
    // the two turners (big kids)
    for (const s of [-1, 1]) {
      const x = cx + s * 190;
      g.fillStyle = s < 0 ? '#8a1f24' : '#1f3f7a'; g.fillRect(x - 16, feetY - 110, 32, 60);
      g.fillStyle = '#e3b48a'; g.beginPath(); g.arc(x, feetY - 128, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2c3340'; g.fillRect(x - 14, feetY - 50, 12, 50); g.fillRect(x + 2, feetY - 50, 12, 50);
    }
    // rope: an arc whose height follows the phase
    const ang = this.phase * Math.PI * 2;
    const sag = Math.cos(ang);      // 1 at top, -1 at feet
    const handY = feetY - 90;
    const ropeY = handY - sag * 120;
    const front = Math.sin(ang) > 0;
    const drawRope = () => {
      g.strokeStyle = '#f2e24a'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(cx - 172, handY); g.quadraticCurveTo(cx, ropeY + (sag < 0 ? 60 : -40) * Math.abs(sag), cx + 172, handY); g.stroke();
    };
    if (!front) drawRope();
    // baby, jumping
    const hop = this.jumpT > 0 ? Math.sin((1 - this.jumpT / 0.42) * Math.PI) * 60 : 0;
    drawBaby(g, cx, feetY - 22 - hop, 1.9, this.missT > 0 ? Math.sin(this.missT * 30) * 0.2 : 0);
    if (front) drawRope();
    // timing ring at the feet
    const close = this.footDist() < 0.16;
    g.strokeStyle = close ? '#9fd36a' : 'rgba(0,0,0,.25)'; g.lineWidth = close ? 5 : 3;
    g.beginPath(); g.ellipse(cx, feetY + 6, 46, 10, 0, 0, Math.PI * 2); g.stroke();
    // streak pips
    for (let i = 0; i < this.need; i++) {
      g.fillStyle = i < this.streak ? '#9fd36a' : 'rgba(0,0,0,.2)';
      g.beginPath(); g.arc(cx - (this.need - 1) * 14 + i * 28, 36, 10, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#2a2016'; g.font = 'bold 16px "Trebuchet MS", sans-serif'; g.textAlign = 'center';
    g.fillText(this.missT > 0 ? 'MISSED! AGAIN!' : `${this.streak} in a row`, cx, 70);
    if (ended) banner(g, this.result && this.result.win ? 'W! SIX IN A ROW!' : 'TIME!', this.result && this.result.win ? 'Jerry blows the whistle. Happily, for once.' : `Best streak: ${this.best}`, this.result && this.result.win);
  }
}

// ---------------------------------------------------------------- lunch rhythm

// Three lanes -- A, S, D (or ← ↓ →). Food slides down the tray line to the
// plate; press its lane as it lands. A short tune, sixteen notes, and you
// get something whatever happens -- more if you keep the beat.
class Lunch {
  constructor(game) {
    this.game = game;
    this.title = "MEREDITH'S LUNCH LINE";
    this.help = 'Press <b>A S D</b> (or <b>← ↓ →</b>) as each food reaches the plate. Keep the beat and your tray gets fuller.';
    this.limit = 30;
    this.time = 0;
    this.result = null;
    this.bpm = 104;
    const beat = 60 / this.bpm;
    // a little pattern: [beat, lane]
    const pattern = [
      [0, 1], [1, 1], [2, 0], [3, 2],
      [4, 1], [4.5, 0], [5, 2], [6, 1],
      [8, 0], [9, 1], [10, 2], [11, 1],
      [12, 0], [12.5, 1], [13, 2], [14, 1]
    ];
    this.lead = 2.2;                         // seconds of travel before the first note
    this.notes = pattern.map(([b, lane], i) => ({ t: this.lead + b * beat, lane, hit: false, miss: false, kind: i % 5 }));
    this.end = this.lead + 15.5 * beat;
    this.hits = 0;
    this.fb = [];
    this.tick = -1;
    this.beat = beat;
  }
  press(k) {
    const lane = { a: 0, arrowleft: 0, s: 1, arrowdown: 1, d: 2, arrowright: 2 }[k];
    if (lane === undefined) return;
    let best = null, bestD = 0.16;
    for (const n of this.notes) {
      if (n.hit || n.miss || n.lane !== lane) continue;
      const d = Math.abs(n.t - this.time);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) {
      best.hit = true;
      this.hits++;
      this.fb.push({ lane, text: bestD < 0.06 ? 'YUM!' : 'OK', t: 0.5, good: true });
      this.game.sfx.tone([523, 659, 784][lane], 0.12, 'triangle', 0.13, 40);
    } else {
      this.fb.push({ lane, text: 'SPLAT', t: 0.5, good: false });
      this.game.sfx.tone(160, 0.08, 'square', 0.07, -40);
    }
  }
  partial() { return this.hits / this.notes.length; }
  update(dt) {
    // backing beat: a soft kick every beat, a hat on the off-beat
    const b = Math.floor((this.time - this.lead) / this.beat * 2);
    if (b !== this.tick && this.time > this.lead - this.beat * 4) {
      this.tick = b;
      if (b % 2 === 0) this.game.sfx.tone(90, 0.1, 'sine', 0.14, -30);
      else this.game.sfx.noise(0.04, 0.05, 6000, 1.5, 'highpass');
    }
    for (const n of this.notes) if (!n.hit && !n.miss && this.time - n.t > 0.16) {
      n.miss = true;
      this.fb.push({ lane: n.lane, text: 'MISS', t: 0.5, good: false });
    }
    for (const f of this.fb) f.t -= dt;
    this.fb = this.fb.filter(f => f.t > 0);
    if (this.time > this.end + 0.4) {
      const score = this.hits / this.notes.length;
      this.result = { win: score >= 0.6, score };
    }
  }
  draw(g, dt, ended) {
    g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, W, H);
    // counter + tray rails
    const laneX = [W / 2 - 110, W / 2, W / 2 + 110];
    const hitY = 300, speed = 170;
    g.fillStyle = '#9aa0a6'; g.fillRect(W / 2 - 170, 0, 340, H);
    for (const x of laneX) {
      g.fillStyle = '#c8ccd0'; g.fillRect(x - 42, 0, 84, H);
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, hitY, 44, 16, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#6a9a8a'; g.lineWidth = 3; g.stroke();
    }
    // lane keys
    g.font = 'bold 18px "Trebuchet MS", sans-serif'; g.textAlign = 'center';
    ['A', 'S', 'D'].forEach((k, i) => { g.fillStyle = '#2a2016'; g.fillText(k, laneX[i], hitY + 46); });
    // Meredith behind the counter
    g.fillStyle = '#6a9a8a'; g.fillRect(24, 170, 70, 120);
    g.fillStyle = '#f4f1ea'; g.fillRect(34, 190, 50, 100);
    g.fillStyle = '#e8bf9c'; g.beginPath(); g.arc(59, 146, 28, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(216,212,232,.8)'; g.beginPath(); g.arc(59, 136, 29, Math.PI, 0); g.fill();
    g.fillStyle = '#1a1a1a'; g.fillRect(49, 144, 4, 4); g.fillRect(65, 144, 4, 4);
    g.strokeStyle = '#b04a4a'; g.lineWidth = 3; g.beginPath(); g.arc(59, 154, 9, 0.2, Math.PI - 0.2); g.stroke();
    // bob to the beat
    const bounce = Math.abs(Math.sin((this.time - this.lead) / this.beat * Math.PI)) * 6;
    g.fillStyle = '#c8c8c8'; g.fillRect(90, 200 - bounce, 8, 60);
    // notes: food
    const cols = ['#d84a3a', '#f0d84a', '#f4f4f0', '#8ac04a', '#c8783a'];
    for (const n of this.notes) {
      if (n.hit) continue;
      const y = hitY - (n.t - this.time) * speed;
      if (y < -30 || y > H + 30) continue;
      const x = laneX[n.lane];
      g.globalAlpha = n.miss ? 0.35 : 1;
      g.fillStyle = cols[n.kind];
      if (n.kind === 2) { g.fillRect(x - 16, y - 20, 32, 40); g.fillStyle = '#4a8fd8'; g.fillRect(x - 16, y - 8, 32, 10); }   // milk
      else if (n.kind === 1) { g.beginPath(); g.moveTo(x - 24, y + 10); g.lineTo(x + 24, y + 10); g.lineTo(x, y - 18); g.fill(); }  // sandwich
      else { g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    }
    for (const f of this.fb) {
      g.fillStyle = f.good ? '#3a8a3a' : '#c0442f';
      g.font = 'bold 20px "Trebuchet MS", sans-serif';
      g.fillText(f.text, laneX[f.lane], hitY - 40 - (0.5 - f.t) * 60);
    }
    g.fillStyle = '#2a2016'; g.font = 'bold 18px "Trebuchet MS", sans-serif';
    g.fillText(`${this.hits} / ${this.notes.length}`, W - 60, 34);
    if (ended) {
      const s = this.result ? this.result.score : 0;
      banner(g, s >= 0.9 ? 'GOLD TRAY!' : s >= 0.6 ? 'NICE TRAY' : 'SOGGY TRAY', s >= 0.6 ? 'Meredith piles it on.' : 'Meredith gives you something anyway.', s >= 0.6);
    }
  }
}

// ---------------------------------------------------------------- bandage

// The nurse's office. A toddler with a scraped knee sits on the bed and
// wriggles. First wipe the scrape clean (A and D, back and forth), then stick
// the plaster on: it slides across -- press Space or click when it is over
// the scrape. Two plasters to finish. Twenty-five seconds is plenty.
class Bandage {
  constructor(game) {
    this.game = game;
    this.title = "THE NURSE'S OFFICE";
    this.help = '<b>1.</b> Wipe the scrape: tap <b>A</b> and <b>D</b> back and forth. <b>2.</b> Stick the plaster on: press <b>Space</b> or <b>click</b> when it is over the scrape. Two plasters.';
    this.limit = 30;
    this.time = 0;
    this.result = null;
    this.stage = 'wipe';
    this.wipes = 0;
    this.needWipes = 8;
    this.lastWipe = null;
    this.dirt = 1;
    this.stuck = 0;
    this.needStuck = 2;
    this.plasterX = 0;
    this.plasterDir = 1;
    this.plasterSpeed = 250;
    this.woundX = 280;
    this.flash = 0;
    this.flashGood = false;
    this.wiggle = 0;
    this.placed = [];
  }
  press(k) {
    if (this.stage === 'wipe') {
      if (k !== 'a' && k !== 'd' && k !== 'arrowleft' && k !== 'arrowright') return;
      const side = (k === 'a' || k === 'arrowleft') ? 'l' : 'r';
      if (side === this.lastWipe) return;              // it has to go back and forth
      this.lastWipe = side;
      this.wipes++;
      this.dirt = Math.max(0, 1 - this.wipes / this.needWipes);
      this.game.sfx.noise(0.08, 0.06, 1800, 1.2);
      if (this.wipes >= this.needWipes) {
        this.stage = 'stick';
        this.plasterX = 60;
        this.game.sfx.ding();
      }
      return;
    }
    if (this.stage === 'stick') {
      if (k !== ' ' && k !== 'click' && k !== 'e') return;
      const off = Math.abs(this.plasterX - (this.woundX + this.wiggle));
      if (off < 38) {
        this.stuck++;
        this.placed.push(this.plasterX - this.wiggle - this.woundX);
        this.flash = 0.35; this.flashGood = true;
        this.game.sfx.tone(700 + this.stuck * 120, 0.12, 'triangle', 0.12, 120);
        if (this.stuck >= this.needStuck) { this.result = { win: true, score: 1 }; return; }
        this.plasterSpeed += 70;
        this.plasterX = this.plasterDir > 0 ? 60 : 500;
      } else {
        this.flash = 0.35; this.flashGood = false;
        this.game.sfx.tone(180, 0.15, 'square', 0.08, -60);
        this.game.sfx.babyCry();
      }
    }
  }
  partial() { return this.stage === 'wipe' ? this.wipes / this.needWipes * 0.4 : 0.4 + this.stuck / this.needStuck * 0.6; }
  update(dt) {
    this.flash = Math.max(0, this.flash - dt);
    // the little one wriggles
    this.wiggle = Math.sin(this.time * 2.3) * 18 + Math.sin(this.time * 5.1) * 6;
    if (this.stage === 'stick') {
      this.plasterX += this.plasterDir * this.plasterSpeed * dt;
      if (this.plasterX > 500) { this.plasterX = 500; this.plasterDir = -1; }
      if (this.plasterX < 60) { this.plasterX = 60; this.plasterDir = 1; }
    }
  }
  draw(g, dt, ended) {
    // the nurse's office: mint walls, a bed
    g.fillStyle = '#cfe6dd'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e9f2ee'; g.fillRect(0, 250, W, H - 250);
    g.fillStyle = '#d84a4a'; g.fillRect(470, 30, 60, 18); g.fillRect(491, 9, 18, 60);   // red cross on the wall
    g.fillStyle = '#f7f7f4'; g.fillRect(70, 200, 420, 70);                               // bed
    g.fillStyle = '#9aa6a0'; g.fillRect(70, 270, 12, 60); g.fillRect(478, 270, 12, 60);

    // a big chubby leg across the bed, knee in the middle
    const kx = this.woundX + this.wiggle, ky = 196;
    const skin = '#f0c49a';
    g.fillStyle = skin;
    g.beginPath(); g.ellipse(kx - 120, ky + 8, 150, 44, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(kx + 110, ky + 14, 130, 40, 0.05, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(kx, ky, 52, 0, Math.PI * 2); g.fill();
    // the scrape
    g.fillStyle = `rgba(200, 50, 40, ${0.55 + this.dirt * 0.35})`;
    g.beginPath(); g.ellipse(kx, ky - 4, 30, 18, 0.2, 0, Math.PI * 2); g.fill();
    if (this.dirt > 0) {
      g.fillStyle = `rgba(110, 80, 50, ${this.dirt * 0.8})`;
      for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(kx - 20 + (i * 37 % 40), ky - 14 + (i * 23 % 22), 3.5, 0, Math.PI * 2); g.fill(); }
    }
    // plasters already on
    for (const off of this.placed) {
      g.save(); g.translate(kx + off, ky - 4); g.rotate(-0.2);
      g.fillStyle = '#e8c49a'; g.fillRect(-42, -12, 84, 24);
      g.fillStyle = '#f7e6cc'; g.fillRect(-12, -9, 24, 18);
      g.restore();
    }

    if (this.stage === 'wipe') {
      // a wipe going back and forth
      const wx = kx + (this.lastWipe === 'l' ? -24 : 24);
      g.fillStyle = '#ffffff'; g.fillRect(wx - 22, ky - 46, 44, 30);
      g.fillStyle = '#9ad0f0'; g.fillRect(wx - 22, ky - 20, 44, 4);
      g.fillStyle = '#2a2016'; g.font = 'bold 20px "Trebuchet MS", sans-serif'; g.textAlign = 'center';
      g.fillText(`WIPE IT CLEAN   ${this.wipes}/${this.needWipes}`, W / 2, 40);
      g.font = 'bold 26px "Trebuchet MS", sans-serif';
      g.fillStyle = this.lastWipe === 'd' || !this.lastWipe ? '#e5a83a' : '#8a8f86'; g.fillText('A', W / 2 - 40, 80);
      g.fillStyle = this.lastWipe === 'l' ? '#e5a83a' : '#8a8f86'; g.fillText('D', W / 2 + 40, 80);
    } else {
      // the plaster sliding above the knee
      g.save(); g.translate(this.plasterX, 110);
      g.fillStyle = '#e8c49a'; g.fillRect(-42, -12, 84, 24);
      g.fillStyle = '#f7e6cc'; g.fillRect(-12, -9, 24, 18);
      g.restore();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.setLineDash([6, 6]); g.lineWidth = 2;
      g.beginPath(); g.moveTo(this.plasterX, 126); g.lineTo(this.plasterX, ky - 26); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#2a2016'; g.font = 'bold 20px "Trebuchet MS", sans-serif'; g.textAlign = 'center';
      g.fillText(`STICK IT ON   ${this.stuck}/${this.needStuck}`, W / 2, 40);
    }
    if (this.flash > 0) {
      g.fillStyle = this.flashGood ? 'rgba(120, 200, 110, .25)' : 'rgba(220, 70, 60, .25)';
      g.fillRect(0, 0, W, H);
    }
    // the toddler's face at the end of the bed, not impressed
    g.fillStyle = '#f0c49a'; g.beginPath(); g.arc(40 + this.wiggle * 0.2, 170, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a1a1a'; g.fillRect(28 + this.wiggle * 0.2, 162, 5, 5); g.fillRect(48 + this.wiggle * 0.2, 162, 5, 5);
    g.strokeStyle = '#8a4a3a'; g.lineWidth = 3; g.beginPath();
    if (this.result && this.result.win) g.arc(40 + this.wiggle * 0.2, 176, 10, 0.2, Math.PI - 0.2);
    else g.arc(40 + this.wiggle * 0.2, 188, 10, Math.PI + 0.3, -0.3);
    g.stroke();
    if (ended) banner(g, this.result && this.result.win ? 'ALL BETTER!' : 'THEY WRIGGLED FREE', this.result && this.result.win ? 'A plaster and a brave face.' : 'Try again -- the little one is still hurt.', this.result && this.result.win);
  }
}
