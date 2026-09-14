// Every surface texture is painted into a canvas at load time. The school has
// to look like a school without shipping a single image file.
import * as THREE from 'three';
import { makeRng } from '../util/util.js?v=2026-09-13e';

const SIZE = 128;

function canvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d') };
}

function toTex(c, repeat = 1, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function grain(g, size, amount, alpha) {
  const rng = makeRng(1234 + amount * 97);
  for (let i = 0; i < amount; i++) {
    const x = rng() * size, y = rng() * size;
    const v = Math.floor(rng() * 60);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 2);
  }
}

// ------------------------------------------------------------------ surfaces

// Speckled institutional lino, the pale kind with flecks in it.
function linoleum(base, fleck) {
  const { c, g } = canvas(128);
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(7);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rng() < 0.5 ? fleck : 'rgba(255,255,255,0.35)';
    g.globalAlpha = 0.25 + rng() * 0.5;
    g.fillRect(rng() * 128, rng() * 128, 1 + rng() * 2, 1 + rng() * 2);
  }
  g.globalAlpha = 1;
  // faint tile seams every 64px so the floor reads as squares
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, 0.5); g.lineTo(128, 0.5);
  g.moveTo(0.5, 0); g.lineTo(0.5, 128);
  g.moveTo(0, 64.5); g.lineTo(128, 64.5);
  g.moveTo(64.5, 0); g.lineTo(64.5, 128);
  g.stroke();
  return c;
}

// The classic two-tone corridor floor.
function checkerLino() {
  const { c, g } = canvas(128);
  const a = linoleum('#cbc7bb', '#8d8878');
  const b = linoleum('#9aa3a8', '#6d757a');
  g.drawImage(a, 0, 0, 64, 64); g.drawImage(b, 64, 0, 64, 64);
  g.drawImage(b, 0, 64, 64, 64); g.drawImage(a, 64, 64, 64, 64);
  return c;
}

function cinderblock(top, bottom) {
  const { c, g } = canvas(128);
  g.fillStyle = top; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(31);
  const bh = 32, bw = 64;
  for (let row = 0; row < 128 / bh; row++) {
    const off = (row % 2) * (bw / 2);
    for (let col = -1; col < 128 / bw + 1; col++) {
      const x = col * bw + off, y = row * bh;
      const shade = 8 - rng() * 16;
      g.fillStyle = `rgba(${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${Math.abs(shade) / 90})`;
      g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      g.strokeStyle = bottom;
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
  grain(g, 128, 500, 0.05);
  return c;
}

// Glossy wainscot tiles for the lower half of hallway walls.
function wallTile(col, groutCol) {
  const { c, g } = canvas(128);
  g.fillStyle = col; g.fillRect(0, 0, 128, 128);
  g.fillStyle = groutCol;
  for (let i = 0; i <= 128; i += 32) { g.fillRect(0, i - 1, 128, 2); g.fillRect(i - 1, 0, 2, 128); }
  const rng = makeRng(99);
  for (let y = 0; y < 128; y += 32) {
    for (let x = 0; x < 128; x += 32) {
      g.fillStyle = `rgba(255,255,255,${0.03 + rng() * 0.07})`;
      g.fillRect(x + 2, y + 2, 28, 12);
    }
  }
  grain(g, 128, 260, 0.04);
  return c;
}

function ceilingTile() {
  const { c, g } = canvas(128);
  g.fillStyle = '#d9d7cf'; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(404);
  for (let i = 0; i < 2400; i++) {
    g.fillStyle = `rgba(120,118,110,${0.05 + rng() * 0.25})`;
    g.fillRect(rng() * 128, rng() * 128, 1.5, 1.5);
  }
  g.strokeStyle = '#b0aea6'; g.lineWidth = 3;
  g.strokeRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1;
  g.strokeRect(2.5, 2.5, 123, 123);
  return c;
}

function carpet(base, alt) {
  const { c, g } = canvas(128);
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(17);
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = rng() < 0.5 ? alt : 'rgba(0,0,0,0.14)';
    g.globalAlpha = 0.2 + rng() * 0.5;
    g.fillRect(rng() * 128, rng() * 128, 2, 1);
  }
  g.globalAlpha = 1;
  return c;
}

function gymFloor() {
  const { c, g } = canvas(128);
  g.fillStyle = '#c98f4e'; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(55);
  for (let i = 0; i < 128; i += 16) {
    g.fillStyle = `rgba(0,0,0,${0.06 + rng() * 0.08})`;
    g.fillRect(0, i, 128, 1.5);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(${120 + rng() * 60},${70 + rng() * 40},${20 + rng() * 30},0.18)`;
      g.fillRect(rng() * 128, i + rng() * 14, 6 + rng() * 20, 1.5);
    }
  }
  return c;
}

function asphalt() {
  const { c, g } = canvas(128);
  g.fillStyle = '#3f4245'; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(88);
  for (let i = 0; i < 3000; i++) {
    const v = 40 + rng() * 60;
    g.fillStyle = `rgba(${v},${v + 2},${v + 4},${0.2 + rng() * 0.4})`;
    g.fillRect(rng() * 128, rng() * 128, 1 + rng() * 2, 1 + rng() * 2);
  }
  return c;
}

function grass() {
  const { c, g } = canvas(128);
  g.fillStyle = '#4a6b34'; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(303);
  for (let i = 0; i < 4000; i++) {
    const v = rng();
    g.strokeStyle = `rgba(${50 + v * 60},${90 + v * 70},${40 + v * 30},0.55)`;
    g.lineWidth = 1;
    const x = rng() * 128, y = rng() * 128;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 3, y - 2 - rng() * 3); g.stroke();
  }
  return c;
}

function lockerFront() {
  const { c, g } = canvas(128);
  g.fillStyle = '#3f6f8c'; g.fillRect(0, 0, 128, 128);
  // two lockers side by side across the 128px width
  for (let i = 0; i < 2; i++) {
    const x = i * 64;
    g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x + 4, 2, 56, 124);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 3;
    g.strokeRect(x + 4, 2, 56, 124);
    // vent slats
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let s = 0; s < 5; s++) g.fillRect(x + 16, 12 + s * 6, 32, 2.5);
    // handle + lock
    g.fillStyle = '#d8d8d0'; g.fillRect(x + 48, 58, 6, 20);
    g.fillStyle = '#22262a'; g.beginPath(); g.arc(x + 44, 72, 4, 0, Math.PI * 2); g.fill();
  }
  grain(g, 128, 600, 0.06);
  return c;
}

function corkboard() {
  const { c, g } = canvas(128);
  g.fillStyle = '#b98d55'; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(66);
  for (let i = 0; i < 3000; i++) {
    const v = rng();
    g.fillStyle = `rgba(${150 + v * 60},${110 + v * 50},${60 + v * 40},${0.25 + v * 0.4})`;
    g.fillRect(rng() * 128, rng() * 128, 2, 2);
  }
  // pinned children's drawings
  const paper = ['#f4f0e4', '#eef4f7', '#f7eef2'];
  for (let i = 0; i < 5; i++) {
    const w = 26 + rng() * 16, h = 22 + rng() * 14;
    const x = rng() * (128 - w), y = rng() * (128 - h);
    g.save();
    g.translate(x + w / 2, y + h / 2); g.rotate((rng() - 0.5) * 0.3);
    g.fillStyle = paper[Math.floor(rng() * 3)];
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 1; g.strokeRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad'][Math.floor(rng() * 4)];
    g.lineWidth = 1.5;
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      g.moveTo(-w / 2 + 3 + rng() * (w - 6), -h / 2 + 3 + rng() * (h - 6));
      g.lineTo(-w / 2 + 3 + rng() * (w - 6), -h / 2 + 3 + rng() * (h - 6));
    }
    g.stroke();
    g.fillStyle = '#c0392b';
    g.beginPath(); g.arc(0, -h / 2 + 3, 2, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  return c;
}

function chalkboard() {
  const { c, g } = canvas(128);
  g.fillStyle = '#243b2e'; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(21);
  for (let i = 0; i < 1200; i++) {
    g.fillStyle = `rgba(220,230,220,${rng() * 0.05})`;
    g.fillRect(rng() * 128, rng() * 128, 3 + rng() * 8, 1);
  }
  // smeared eraser arcs
  g.strokeStyle = 'rgba(230,240,230,0.07)'; g.lineWidth = 7;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.arc(rng() * 128, rng() * 128, 14 + rng() * 24, 0, Math.PI * (0.7 + rng()));
    g.stroke();
  }
  g.strokeStyle = 'rgba(240,245,240,0.8)'; g.lineWidth = 2;
  g.font = 'bold 22px monospace';
  g.fillStyle = 'rgba(240,245,240,0.8)';
  g.fillText('LAST DAY!', 12, 40);
  g.fillText('BYE :)', 24, 78);
  return c;
}

function woodTex(base, dark) {
  const { c, g } = canvas(128);
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(919);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = dark;
    g.globalAlpha = 0.06 + rng() * 0.14;
    g.lineWidth = 1 + rng() * 2;
    const y = rng() * 128;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + Math.sin(x * 0.09 + i) * 2.5);
    g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}

function metalTex(base) {
  const { c, g } = canvas(128);
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(1717);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(255,255,255,${rng() * 0.06})`;
    g.fillRect(rng() * 128, rng() * 128, 12 + rng() * 30, 1);
  }
  grain(g, 128, 400, 0.07);
  return c;
}

function paintedWall(col) {
  const { c, g } = canvas(128);
  g.fillStyle = col; g.fillRect(0, 0, 128, 128);
  const rng = makeRng(5);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(0,0,0,${rng() * 0.045})`;
    g.fillRect(rng() * 128, rng() * 128, 2, 2);
  }
  // scuffs near the bottom edge, where small hands and trolleys hit
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(60,55,50,${0.05 + rng() * 0.12})`;
    g.lineWidth = 1 + rng() * 2;
    const y = 96 + rng() * 30;
    g.beginPath(); g.moveTo(rng() * 128, y); g.lineTo(rng() * 128, y + (rng() - 0.5) * 6); g.stroke();
  }
  return c;
}

// A tiled surface used for the ceiling light panels when they are lit.
function lightPanel() {
  const { c, g } = canvas(64);
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#fffdf2');
  grd.addColorStop(0.5, '#fff7d8');
  grd.addColorStop(1, '#fffdf2');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(180,180,170,0.5)';
  for (let i = 8; i < 64; i += 16) g.fillRect(0, i, 64, 2);
  return c;
}

export const TEX = {};

export function initTextures() {
  TEX.floorRoom = toTex(linoleum('#c3bfae', '#8a856f'), 1);
  TEX.floorHall = toTex(checkerLino(), 1);
  TEX.floorCarpet = toTex(carpet('#5a4a63', '#7b6a85'), 1);
  TEX.floorGym = toTex(gymFloor(), 1);
  TEX.floorConcrete = toTex(cinderblock('#6e6e6a', '#4c4c49'), 1);
  TEX.asphalt = toTex(asphalt(), 1);
  TEX.grass = toTex(grass(), 1);

  TEX.wallPaint = toTex(paintedWall('#d5cdb4'), 1);
  TEX.wallPaintBlue = toTex(paintedWall('#b9c9cf'), 1);
  TEX.wallTile = toTex(wallTile('#9fb7bd', '#dfe4e2'), 1);
  TEX.cinder = toTex(cinderblock('#8e8b80', '#6c6a61'), 1);
  TEX.ceiling = toTex(ceilingTile(), 1);

  TEX.locker = toTex(lockerFront(), 1);
  TEX.cork = toTex(corkboard(), 1);
  TEX.chalk = toTex(chalkboard(), 1);
  TEX.wood = toTex(woodTex('#a8763f', '#5d3d19'), 1);
  TEX.woodDark = toTex(woodTex('#6d4a26', '#33220f'), 1);
  TEX.metal = toTex(metalTex('#8a8f93'), 1);
  TEX.metalDark = toTex(metalTex('#4a4f54'), 1);
  TEX.panel = toTex(lightPanel(), 1);
  return TEX;
}

// Clone a texture with a different tiling density. Cheap: the image data is
// shared, only the repeat differs.
export function tiled(tex, rx, ry) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry === undefined ? rx : ry);
  return t;
}
