// Turns the generated school description into Three.js meshes.
//
// Almost everything is merged into a few big geometries. Only things that move
// or switch state (door leaves, light panels, hideable locker doors) stay as
// their own objects.
import * as THREE from 'three';
import { MeshBuilder } from '../render/meshbuilder.js?v=2026-09-13c';
import { TEX, tiled } from '../render/textures.js?v=2026-09-13c';
import { CELL, WALL_T, T } from './schoolgen.js?v=2026-09-13c';

const DOOR_H = 2.08;
const OPEN_W = { door: 1.15, double: 2.0 };

// ---------------------------------------------------------------- materials

const matCache = new Map();

export function materialFor(key) {
  if (matCache.has(key)) return matCache.get(key);
  let m;
  if (key.startsWith('c:')) {
    m = new THREE.MeshPhongMaterial({ color: parseInt(key.slice(2), 16), shininess: 4, specular: 0x0a0a0a });
  } else if (key === 'glass') {
    m = new THREE.MeshPhongMaterial({
      color: 0x9fc4d8, transparent: true, opacity: 0.24, side: THREE.DoubleSide,
      depthWrite: false, shininess: 60
    });
  } else if (key === 'glassNight') {
    m = new THREE.MeshBasicMaterial({ color: 0x0a1626, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  } else {
    const tex = TEX[key];
    m = new THREE.MeshPhongMaterial({ map: tex ? tiled(tex, 1) : null, color: tex ? 0xffffff : 0xcccccc, shininess: 3, specular: 0x080808 });
  }
  matCache.set(key, m);
  return m;
}

export function resetMaterials() { matCache.clear(); }

// ---------------------------------------------------------------- helpers

// Local-space point on a prop -> world space (props are rotated about Y only).
function L(p, x, y, z) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [p.x + x * c + z * s, y, p.z - x * s + z * c];
}

// A quad on the prop's front plane (local +Z), facing outward.
function face(mb, mat, p, x0, x1, y0, y1, z, us = 1, vs = 1) {
  mb.quad(mat, L(p, x0, y0, z), L(p, x1, y0, z), L(p, x1, y1, z), L(p, x0, y1, z), us, vs);
}

function pbox(mb, mat, p, x, y, z, hw, hh, hd) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  mb.box(mat, p.x + x * c + z * s, y, p.z - x * s + z * c, hw, hh, hd, p.rot);
}

// ---------------------------------------------------------------- props

const WOOD = 'wood', DARK = 'woodDark', MET = 'metal', METD = 'metalDark';
const C = h => 'c:' + h;

function buildProp(mb, p) {
  switch (p.type) {
    // ---- storage & searchables
    case 'lockerBank': {
      pbox(mb, METD, p, 0, 0.86, 0, 1.13, 0.86, 0.21);
      face(mb, 'locker', p, -1.13, 1.13, 0.02, 1.72, 0.212, 1.2, 1.72);
      pbox(mb, METD, p, 0, 1.75, 0, 1.15, 0.04, 0.23);
      break;
    }
    case 'cabinet':
    case 'medCabinet': {
      const hh = p.type === 'medCabinet' ? 0.5 : 0.85;
      const yc = p.type === 'medCabinet' ? 1.35 : 0.85;
      pbox(mb, WOOD, p, 0, yc, 0, p.hw, hh, p.hd);
      face(mb, DARK, p, -p.hw + 0.06, -0.02, yc - hh + 0.06, yc + hh - 0.06, p.hd + 0.005, 0.8, 0.8);
      face(mb, DARK, p, 0.02, p.hw - 0.06, yc - hh + 0.06, yc + hh - 0.06, p.hd + 0.005, 0.8, 0.8);
      pbox(mb, MET, p, -0.08, yc, p.hd + 0.02, 0.02, 0.06, 0.02);
      pbox(mb, MET, p, 0.08, yc, p.hd + 0.02, 0.02, 0.06, 0.02);
      break;
    }
    case 'crate': {
      pbox(mb, WOOD, p, 0, 0.42, 0, p.hw, 0.42, p.hd);
      for (const dz of [p.hd + 0.006, -p.hd - 0.006]) {
        mb.quad(DARK, L(p, -p.hw, 0.08, dz), L(p, p.hw, 0.08, dz), L(p, p.hw, 0.2, dz), L(p, -p.hw, 0.2, dz), 1, 1);
        mb.quad(DARK, L(p, -p.hw, 0.64, dz), L(p, p.hw, 0.64, dz), L(p, p.hw, 0.76, dz), L(p, -p.hw, 0.76, dz), 1, 1);
      }
      break;
    }
    case 'lostBin': {
      pbox(mb, C('3b6ea5'), p, 0, 0.34, 0, p.hw, 0.34, p.hd);
      pbox(mb, C('2b527d'), p, 0, 0.7, 0, p.hw - 0.04, 0.03, p.hd - 0.04);
      // spilled clothes on top
      pbox(mb, C('c05a6a'), p, -0.1, 0.76, 0.05, 0.2, 0.06, 0.16);
      pbox(mb, C('7ba05b'), p, 0.15, 0.75, -0.08, 0.16, 0.05, 0.12);
      break;
    }
    case 'bin': {
      mb.cylinder(C('47504f'), p.x, 0, p.z, p.hw, 0.62, 8);
      mb.cylinder(C('2c3230'), p.x, 0.62, p.z, p.hw + 0.02, 0.05, 8);
      break;
    }
    case 'shelf':
    case 'pipeRack': {
      const isPipe = p.type === 'pipeRack';
      const mat = isPipe ? METD : MET;
      for (const dx of [-p.hw + 0.05, p.hw - 0.05]) {
        pbox(mb, mat, p, dx, 0.95, 0, 0.05, 0.95, p.hd);
      }
      const levels = isPipe ? 3 : 4;
      for (let i = 0; i < levels; i++) {
        const y = 0.28 + i * (1.7 / levels);
        pbox(mb, isPipe ? METD : WOOD, p, 0, y, 0, p.hw, 0.03, p.hd);
      }
      if (isPipe) for (let i = 0; i < 3; i++) mb.cylinder(MET, p.x, 0.3 + i * 0.55, p.z, 0.07, 0.02, 6);
      break;
    }
    case 'bookcase': {
      pbox(mb, DARK, p, 0, 0.9, 0, p.hw, 0.9, p.hd);
      for (let i = 0; i < 4; i++) {
        const y = 0.28 + i * 0.44;
        face(mb, C('241a10'), p, -p.hw + 0.05, p.hw - 0.05, y, y + 0.36, p.hd + 0.004, 1, 1);
        // a row of book spines
        let x = -p.hw + 0.08;
        let k = 0;
        while (x < p.hw - 0.12) {
          const w = 0.035 + ((k * 37) % 5) * 0.012;
          const h = 0.24 + ((k * 53) % 4) * 0.03;
          const cols = ['9c2b2b', '2b5a9c', '2b7d4a', 'a3822b', '6b3b8c', 'b05a2b'];
          face(mb, C(cols[k % cols.length]), p, x, x + w, y + 0.02, y + 0.02 + h, p.hd + 0.012, 1, 1);
          x += w + 0.008; k++;
        }
      }
      break;
    }
    case 'vending': {
      pbox(mb, C('b4342e'), p, 0, 0.95, 0, p.hw, 0.95, p.hd);
      face(mb, C('101418'), p, -p.hw + 0.07, p.hw - 0.24, 0.42, 1.72, p.hd + 0.006, 1, 1);
      for (let r = 0; r < 4; r++) for (let c2 = 0; c2 < 4; c2++) {
        face(mb, C(['e8c34a', '7ac6e8', 'e87a9c', '9ce87a'][(r + c2) % 4]), p,
          -p.hw + 0.13 + c2 * 0.17, -p.hw + 0.26 + c2 * 0.17, 0.52 + r * 0.3, 0.72 + r * 0.3, p.hd + 0.014, 1, 1);
      }
      face(mb, C('2a2f33'), p, p.hw - 0.2, p.hw - 0.06, 0.9, 1.5, p.hd + 0.008, 1, 1);
      break;
    }
    case 'fridge': {
      pbox(mb, C('cfd4d6'), p, 0, 0.9, 0, p.hw, 0.9, p.hd);
      face(mb, C('b9c0c3'), p, -p.hw + 0.04, p.hw - 0.04, 0.06, 1.1, p.hd + 0.006, 1, 1);
      face(mb, C('b9c0c3'), p, -p.hw + 0.04, p.hw - 0.04, 1.16, 1.74, p.hd + 0.006, 1, 1);
      pbox(mb, MET, p, p.hw - 0.14, 0.9, p.hd + 0.03, 0.02, 0.22, 0.02);
      break;
    }

    // ---- classroom
    case 'desk':
    case 'teacherDesk':
    case 'prepTable':
    case 'readingTable':
    case 'roundTable': {
      const top = p.type === 'desk' ? 0.62 : 0.74;
      const mat = p.type === 'prepTable' ? MET : WOOD;
      pbox(mb, mat, p, 0, top, 0, p.hw, 0.035, p.hd);
      const legs = [[-p.hw + 0.08, -p.hd + 0.08], [p.hw - 0.08, -p.hd + 0.08],
                    [-p.hw + 0.08, p.hd - 0.08], [p.hw - 0.08, p.hd - 0.08]];
      for (const [lx, lz] of legs) pbox(mb, METD, p, lx, top / 2, lz, 0.025, top / 2, 0.025);
      if (p.type === 'desk') {
        // a shallow book cubby under the top
        pbox(mb, DARK, p, 0, top - 0.16, -0.02, p.hw - 0.06, 0.02, p.hd - 0.06);
        face(mb, DARK, p, -p.hw + 0.06, p.hw - 0.06, top - 0.2, top - 0.06, p.hd - 0.04, 1, 1);
      }
      if (p.type === 'teacherDesk') {
        pbox(mb, DARK, p, 0, 0.36, -0.04, p.hw - 0.06, 0.34, p.hd - 0.08);
        for (let i = 0; i < 3; i++) pbox(mb, MET, p, p.hw - 0.4, 0.2 + i * 0.2, p.hd - 0.03, 0.16, 0.015, 0.02);
      }
      break;
    }
    case 'chair': {
      pbox(mb, C('c4682e'), p, 0, 0.42, 0, 0.2, 0.025, 0.2);
      pbox(mb, C('c4682e'), p, 0, 0.66, -0.18, 0.2, 0.22, 0.025);
      for (const [lx, lz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]])
        pbox(mb, METD, p, lx, 0.21, lz, 0.02, 0.21, 0.02);
      break;
    }
    case 'crib': {
      pbox(mb, C('e8dfc8'), p, 0, 0.34, 0, p.hw, 0.05, p.hd);
      for (const dz of [-p.hd, p.hd]) {
        pbox(mb, C('e8dfc8'), p, 0, 0.78, dz, p.hw, 0.04, 0.03);
        for (let x = -p.hw + 0.06; x <= p.hw - 0.06; x += 0.16)
          pbox(mb, C('e8dfc8'), p, x, 0.58, dz, 0.02, 0.24, 0.02);
      }
      for (const dx of [-p.hw, p.hw]) {
        pbox(mb, C('e8dfc8'), p, dx, 0.78, 0, 0.03, 0.04, p.hd);
        for (let z = -p.hd + 0.06; z <= p.hd - 0.06; z += 0.16)
          pbox(mb, C('e8dfc8'), p, dx, 0.58, z, 0.02, 0.24, 0.02);
      }
      pbox(mb, C('9ec8e0'), p, 0, 0.41, 0, p.hw - 0.06, 0.05, p.hd - 0.06);
      break;
    }
    case 'toybox': {
      pbox(mb, C('d8a13a'), p, 0, 0.28, 0, p.hw, 0.28, p.hd);
      pbox(mb, C('c4432e'), p, 0, 0.59, 0, p.hw + 0.02, 0.04, p.hd + 0.02);
      pbox(mb, C('3b7dc4'), p, -0.2, 0.68, 0.05, 0.09, 0.09, 0.09);
      pbox(mb, C('4aa34a'), p, 0.16, 0.66, -0.06, 0.07, 0.07, 0.07);
      break;
    }
    case 'rug': {
      mb.slab(C('a34a5a'), p.x - 1.0, p.z - 0.8, p.x + 1.0, p.z + 0.8, 0.012, true, 1.2);
      mb.slab(C('d8c86a'), p.x - 0.75, p.z - 0.58, p.x + 0.75, p.z + 0.58, 0.016, true, 1.2);
      break;
    }
    case 'beanbag': {
      mb.cylinder(C(['7a4ac4', 'c47a4a', '4ac47a'][p.id % 3]), p.x, 0, p.z, 0.42, 0.34, 9);
      break;
    }

    // ---- fixtures & fittings
    case 'sink': {
      pbox(mb, C('e4e6e2'), p, 0, 0.72, 0, p.hw, 0.09, p.hd);
      pbox(mb, C('cfd2ce'), p, 0, 0.4, 0, p.hw - 0.06, 0.24, p.hd - 0.04);
      { const t = L(p, 0, 0.81, -p.hd + 0.1); mb.cylinder(MET, t[0], t[1], t[2], 0.02, 0.16, 6); }
      break;
    }
    case 'fountain': {
      pbox(mb, C('d8dad6'), p, 0, 0.62, 0, p.hw, 0.16, p.hd);
      pbox(mb, MET, p, 0, 0.4, 0, p.hw - 0.1, 0.24, p.hd - 0.04);
      break;
    }
    case 'stall': {
      for (const dx of [-p.hw, p.hw]) pbox(mb, C('7d9ba3'), p, dx, 1.0, 0, 0.03, 0.75, p.hd);
      pbox(mb, C('7d9ba3'), p, 0, 1.0, -p.hd, p.hw, 0.75, 0.03);
      pbox(mb, C('eceee9'), p, 0, 0.3, -p.hd + 0.32, 0.19, 0.3, 0.24);
      pbox(mb, C('eceee9'), p, 0, 0.63, -p.hd + 0.42, 0.21, 0.05, 0.16);
      break;
    }
    case 'cot': {
      pbox(mb, C('d8dcd4'), p, 0, 0.5, 0, p.hw, 0.07, p.hd);
      pbox(mb, C('f0f2ee'), p, -p.hw + 0.3, 0.6, 0, 0.24, 0.05, p.hd - 0.06);
      for (const [lx, lz] of [[-p.hw + 0.1, -p.hd + 0.08], [p.hw - 0.1, -p.hd + 0.08],
                              [-p.hw + 0.1, p.hd - 0.08], [p.hw - 0.1, p.hd - 0.08]])
        pbox(mb, MET, p, lx, 0.23, lz, 0.02, 0.23, 0.02);
      break;
    }
    case 'couch': {
      pbox(mb, C('4a6a52'), p, 0, 0.34, 0, p.hw, 0.16, p.hd);
      pbox(mb, C('3d5a45'), p, 0, 0.62, -p.hd + 0.08, p.hw, 0.3, 0.1);
      for (const dx of [-p.hw + 0.08, p.hw - 0.08]) pbox(mb, C('3d5a45'), p, dx, 0.48, 0, 0.08, 0.24, p.hd);
      break;
    }
    case 'scale': {
      pbox(mb, C('9aa0a4'), p, 0, 0.06, 0, 0.24, 0.06, 0.2);
      pbox(mb, MET, p, 0, 0.5, -0.14, 0.02, 0.44, 0.02);
      pbox(mb, C('d8dad6'), p, 0, 0.94, -0.12, 0.16, 0.05, 0.03);
      break;
    }
    case 'easel': {
      pbox(mb, WOOD, p, -0.24, 0.6, 0.06, 0.02, 0.6, 0.02);
      pbox(mb, WOOD, p, 0.24, 0.6, 0.06, 0.02, 0.6, 0.02);
      pbox(mb, WOOD, p, 0, 0.5, -0.2, 0.02, 0.5, 0.02);
      pbox(mb, C('f2efe4'), p, 0, 0.9, 0.07, 0.24, 0.3, 0.01);
      pbox(mb, C(['c4432e', '3b7dc4', 'd8a13a'][p.id % 3]), p, 0.03, 0.92, 0.085, 0.1, 0.12, 0.004);
      break;
    }
    case 'piano': {
      pbox(mb, C('231a14'), p, 0, 0.62, 0, p.hw, 0.24, p.hd);
      pbox(mb, C('231a14'), p, 0, 0.3, -p.hd + 0.1, p.hw - 0.06, 0.3, 0.08);
      pbox(mb, C('f0ece0'), p, 0, 0.79, p.hd - 0.16, p.hw - 0.1, 0.03, 0.14);
      for (let i = 0; i < 12; i++)
        pbox(mb, C('16120e'), p, -p.hw + 0.16 + i * ((p.hw * 2 - 0.32) / 12), 0.815, p.hd - 0.2, 0.018, 0.01, 0.07);
      for (const [lx, lz] of [[-p.hw + 0.1, -p.hd + 0.1], [p.hw - 0.1, -p.hd + 0.1], [0, p.hd - 0.1]])
        pbox(mb, C('231a14'), p, lx, 0.19, lz, 0.05, 0.19, 0.05);
      break;
    }
    case 'drum': {
      mb.cylinder(C('c4432e'), p.x, 0.45, p.z, 0.32, 0.4, 12);
      mb.cylinder(C('f0ece0'), p.x, 0.85, p.z, 0.33, 0.03, 12);
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1;
        mb.cylinder(METD, p.x + Math.cos(a) * 0.3, 0, p.z + Math.sin(a) * 0.3, 0.02, 0.46, 5);
      }
      break;
    }

    // ---- gym & cafeteria
    case 'hoop': {
      pbox(mb, METD, p, 0, 1.6, -0.2, 0.05, 1.6, 0.05);
      pbox(mb, C('f0f0ea'), p, 0, 3.0, 0, 0.85, 0.5, 0.04);
      pbox(mb, C('d8642e'), p, 0, 2.7, 0.14, 0.24, 0.02, 0.2);
      break;
    }
    case 'mat': {
      const hw = p.rot === 0 ? 1.2 : 0.7, hd = p.rot === 0 ? 0.7 : 1.2;
      mb.slab(C(['2e5aa3', 'a32e4a', '2ea35a'][p.id % 3]), p.x - hw, p.z - hd, p.x + hw, p.z + hd, 0.05, true, 1.4);
      mb.box(C(['24488a', '8a2440', '248a48'][p.id % 3]), p.x, 0.025, p.z, hw, 0.025, hd, 0);
      break;
    }
    case 'bleacher': {
      for (let i = 0; i < 3; i++) {
        pbox(mb, WOOD, p, 0, 0.22 + i * 0.28, -p.hd + 0.18 + i * 0.22, p.hw, 0.04, 0.2);
        pbox(mb, METD, p, 0, (0.22 + i * 0.28) / 2, -p.hd + 0.18 + i * 0.22, p.hw - 0.08, (0.22 + i * 0.28) / 2, 0.03);
      }
      break;
    }
    case 'ballCart': {
      for (const dx of [-p.hw + 0.04, p.hw - 0.04]) for (const dz of [-p.hd + 0.04, p.hd - 0.04])
        pbox(mb, METD, p, dx, 0.4, dz, 0.03, 0.4, 0.03);
      for (let i = 0; i < 4; i++) pbox(mb, METD, p, 0, 0.2 + i * 0.2, -p.hd + 0.04, p.hw, 0.015, 0.015);
      for (let i = 0; i < 5; i++) {
        const a = i * 1.3;
        mb.cylinder(C(['d8642e', 'd8a13a', '3b7dc4'][i % 3]),
          p.x + Math.cos(a) * 0.22, 0.06 + (i % 2) * 0.24, p.z + Math.sin(a) * 0.22, 0.13, 0.24, 7);
      }
      break;
    }
    case 'vault': {
      pbox(mb, C('c8a86a'), p, 0, 0.5, 0, p.hw, 0.5, p.hd);
      pbox(mb, C('8a6a3a'), p, 0, 1.02, 0, p.hw + 0.02, 0.04, p.hd + 0.02);
      break;
    }
    case 'cafeTable': {
      pbox(mb, C('c8b48a'), p, 0, 0.66, 0, p.hw, 0.035, p.hd);
      for (const dz of [-p.hd - 0.32, p.hd + 0.32]) {
        pbox(mb, C('b4a078'), p, 0, 0.42, dz, p.hw - 0.1, 0.03, 0.16);
        for (const dx of [-p.hw + 0.3, p.hw - 0.3]) pbox(mb, METD, p, dx, 0.21, dz, 0.03, 0.21, 0.03);
      }
      for (const dx of [-p.hw + 0.25, p.hw - 0.25]) pbox(mb, METD, p, dx, 0.33, 0, 0.04, 0.33, 0.04);
      break;
    }
    case 'servingCounter':
    case 'counter': {
      pbox(mb, p.type === 'counter' ? MET : C('9aa8a4'), p, 0, 0.45, 0, p.hw, 0.45, p.hd);
      pbox(mb, MET, p, 0, 0.93, 0, p.hw + 0.02, 0.03, p.hd + 0.02);
      if (p.type === 'servingCounter') {
        for (const dx of [-p.hw + 0.3, p.hw - 0.3]) pbox(mb, METD, p, dx, 1.4, -0.1, 0.02, 0.44, 0.02);
        pbox(mb, MET, p, 0, 1.84, -0.1, p.hw, 0.03, p.hd - 0.1);
      }
      break;
    }

    // ---- boiler room
    case 'generator': {
      pbox(mb, C('3f5a3a'), p, 0, 0.55, 0, 1.05, 0.55, 0.62);
      pbox(mb, C('32472e'), p, 0, 1.16, 0, 1.08, 0.07, 0.65);
      pbox(mb, METD, p, -0.55, 1.4, 0, 0.34, 0.24, 0.34);          // fuel tank
      mb.cylinder(MET, p.x, 0, p.z, 0.06, 0.1, 6);
      pbox(mb, C('b4342e'), p, 0.62, 1.34, 0.2, 0.1, 0.1, 0.1);    // start button
      pbox(mb, METD, p, 0.5, 0.9, 0.66, 0.28, 0.05, 0.05);         // pull handle
      mb.cylinder(METD, p.x + Math.sin(p.rot) * 0.9, 1.2, p.z + Math.cos(p.rot) * 0.9, 0.07, 1.4, 6);
      for (const dx of [-0.9, 0.9]) pbox(mb, METD, p, dx, 0.12, 0, 0.1, 0.12, 0.66);
      break;
    }
    case 'boilerTank': {
      mb.cylinder(C('6a5a4a'), p.x, 0, p.z, 0.5, 2.2, 10);
      mb.cylinder(METD, p.x, 2.2, p.z, 0.52, 0.12, 10);
      mb.cylinder(MET, p.x + 0.5, 1.6, p.z, 0.07, 1.4, 6);
      break;
    }
    case 'fusebox': {
      pbox(mb, C('9aa0a4'), p, 0, 1.5, -0.02, 0.3, 0.38, 0.08);
      face(mb, C('7d8388'), p, -0.24, 0.24, 1.18, 1.82, 0.07, 1, 1);
      for (let i = 0; i < 6; i++)
        face(mb, C(i % 2 ? 'd8d8d0' : '2a2f33'), p, -0.18 + (i % 3) * 0.13, -0.12 + (i % 3) * 0.13,
          1.62 - Math.floor(i / 3) * 0.24, 1.72 - Math.floor(i / 3) * 0.24, 0.075, 1, 1);
      break;
    }

    // ---- decals hung flat on a wall
    case 'cork': {
      face(mb, 'cork', p, -0.85, 0.85, 1.05, 2.05, 0.03, 1.7, 1.0);
      pbox(mb, DARK, p, 0, 1.55, 0.01, 0.88, 0.53, 0.02);
      break;
    }
    case 'chalkboard': {
      face(mb, 'chalk', p, -1.6, 1.6, 0.95, 2.15, 0.035, 3.2, 1.2);
      pbox(mb, WOOD, p, 0, 1.55, 0.015, 1.66, 0.64, 0.02);
      pbox(mb, WOOD, p, 0, 0.9, 0.06, 1.66, 0.03, 0.06);
      break;
    }

    // ---- playground
    case 'slide': {
      for (const dx of [-0.5, 0.5]) {
        pbox(mb, METD, p, dx, 0.9, -1.2, 0.05, 0.9, 0.05);
        pbox(mb, METD, p, dx, 0.9, -0.5, 0.05, 0.9, 0.05);
      }
      pbox(mb, C('c4432e'), p, 0, 1.82, -0.85, 0.55, 0.05, 0.4);
      // the slide itself, a few tilted plates
      for (let i = 0; i < 6; i++) {
        const t = i / 6;
        const y = 1.8 - t * 1.55, z = -0.45 + t * 1.6;
        mb.box(C('d8a13a'), ...(() => { const q = L(p, 0, y, z); return [q[0], q[1], q[2]]; })(), 0.42, 0.04, 0.17, p.rot);
      }
      for (let i = 0; i < 4; i++) pbox(mb, METD, p, 0, 0.35 + i * 0.4, -1.15, 0.4, 0.03, 0.03);
      break;
    }
    case 'sandbox': {
      for (const [dx, dz, hw2, hd2] of [[0, -1.5, 1.6, 0.1], [0, 1.5, 1.6, 0.1], [-1.5, 0, 0.1, 1.6], [1.5, 0, 0.1, 1.6]])
        pbox(mb, WOOD, p, dx, 0.14, dz, hw2, 0.14, hd2);
      mb.slab(C('d8c48a'), p.x - 1.5, p.z - 1.5, p.x + 1.5, p.z + 1.5, 0.1, true, 1.5);
      break;
    }
    case 'swings': {
      for (const dx of [-1.9, 1.9]) {
        pbox(mb, METD, p, dx - 0.25, 1.1, 0, 0.05, 1.1, 0.05);
        pbox(mb, METD, p, dx + 0.25, 1.1, 0, 0.05, 1.1, 0.05);
      }
      pbox(mb, METD, p, 0, 2.2, 0, 2.0, 0.06, 0.06);
      for (const dx of [-0.8, 0.8]) {
        pbox(mb, C('2a2f33'), p, dx - 0.16, 1.5, 0, 0.015, 0.7, 0.015);
        pbox(mb, C('2a2f33'), p, dx + 0.16, 1.5, 0, 0.015, 0.7, 0.015);
        pbox(mb, C('1a1e22'), p, dx, 0.78, 0, 0.2, 0.03, 0.12);
      }
      break;
    }
    case 'seesaw': {
      pbox(mb, METD, p, 0, 0.22, 0, 0.12, 0.22, 0.12);
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      mb.quad(C('3b7dc4'),
        [p.x - 1.4 * c, 0.3, p.z + 1.4 * s], [p.x + 1.4 * c, 0.62, p.z - 1.4 * s],
        [p.x + 1.4 * c + 0.12 * s, 0.62, p.z - 1.4 * s + 0.12 * c],
        [p.x - 1.4 * c + 0.12 * s, 0.3, p.z + 1.4 * s + 0.12 * c], 1, 1);
      break;
    }
    case 'tube': {
      // a concrete crawl tube -- one of the best hiding spots in the yard
      const sides = 10;
      for (let i = 0; i < sides; i++) {
        const a0 = Math.PI * (i / sides), a1 = Math.PI * ((i + 1) / sides);
        const y0 = 0.06 + Math.sin(a0) * 0.62, y1 = 0.06 + Math.sin(a1) * 0.62;
        const x0 = Math.cos(a0) * 0.62, x1 = Math.cos(a1) * 0.62;
        mb.quad(C('9a9a92'), L(p, x0, y0, -0.7), L(p, x1, y1, -0.7), L(p, x1, y1, 0.7), L(p, x0, y0, 0.7), 1, 1);
        mb.quad(C('8a8a82'), L(p, x1 * 0.86, y1 * 0.86, 0.7), L(p, x0 * 0.86, y0 * 0.86, 0.7),
          L(p, x0 * 0.86, y0 * 0.86, -0.7), L(p, x1 * 0.86, y1 * 0.86, -0.7), 1, 1);
      }
      break;
    }
    case 'tree': {
      mb.cylinder(C('5a4230'), p.x, 0, p.z, 0.22, 2.0, 7);
      mb.cylinder(C('3f6b32'), p.x, 1.9, p.z, 1.5, 0.9, 9);
      mb.cylinder(C('4a7d3a'), p.x, 2.7, p.z, 1.0, 0.8, 8);
      break;
    }
    case 'bench': {
      pbox(mb, WOOD, p, 0, 0.44, 0, p.hw, 0.04, 0.22);
      pbox(mb, WOOD, p, 0, 0.74, -0.2, p.hw, 0.22, 0.04);
      for (const dx of [-p.hw + 0.14, p.hw - 0.14]) pbox(mb, METD, p, dx, 0.22, 0, 0.04, 0.22, 0.2);
      break;
    }
    default:
      pbox(mb, C('8a8a84'), p, 0, 0.4, 0, p.hw, 0.4, p.hd);
  }
}

// ---------------------------------------------------------------- the school

export function buildSchool(school, scene) {
  const mb = new MeshBuilder();
  const { rooms, wallFaces, doors, fixtures, fences, props } = school;
  const { wx, wz } = school;

  // --- ground ---------------------------------------------------------------
  const span = Math.max(school.W, school.H) * CELL * 1.4;
  mb.slab('asphalt', -span, -span, span, span, -0.04, true, 6);

  // --- floors, ceilings, roof ----------------------------------------------
  for (const r of rooms) {
    const x0 = wx(r.x0), x1 = wx(r.x1 + 1), z0 = wz(r.y0), z1 = wz(r.y1 + 1);
    mb.slab(r.floorTex, x0, z0, x1, z1, 0, true, r.type === T.GYM ? 3.2 : 2.4);
    if (!r.outdoor) {
      mb.slab('ceiling', x0, z0, x1, z1, r.ceil, false, 1.2);
      mb.slab('asphalt', x0, z0, x1, z1, Math.max(3.4, r.ceil + 0.5), true, 4);
      // skirting board, a small thing that sells the interior
      const T2 = WALL_T / 2 + 0.005;
      mb.panel(C('6a6259'), 'x', z0 + T2, x0, x1, 0, 0.12, 1);
      mb.panel(C('6a6259'), 'x', z1 - T2, x0, x1, 0, 0.12, -1);
      mb.panel(C('6a6259'), 'z', x0 + T2, z0, z1, 0, 0.12, 1);
      mb.panel(C('6a6259'), 'z', x1 - T2, z0, z1, 0, 0.12, -1);
    }
  }

  // --- walls ----------------------------------------------------------------
  const T2 = WALL_T / 2;
  const WIN_LO = 1.0, WIN_HI = 2.2;

  for (const s of wallFaces) {
    const along = s.dir === 'w' ? 'z' : 'x';
    const a0 = s.dir === 'w' ? wz(s.gy) : wx(s.gx);
    const a1 = s.dir === 'w' ? wz(s.gy + 1) : wx(s.gx + 1);
    const line = s.dir === 'w' ? wx(s.gx) : wz(s.gy);

    // side A is west / north, side B is east / south
    const sides = [
      { h: s.hA, tex: s.texA, off: -T2, facing: -1 },
      { h: s.hB, tex: s.texB, off: +T2, facing: +1 }
    ];
    for (const side of sides) {
      if (side.h <= 0) continue;
      const fixed = line + side.off;
      if (s.windowed && side.h > WIN_HI) {
        mb.panel(side.tex, along, fixed, a0, a1, 0, WIN_LO, side.facing, 2.4, 2.4);
        mb.panel(side.tex, along, fixed, a0, a1, WIN_HI, side.h, side.facing, 2.4, 2.4);
        // reveal sides of the opening
        mb.panel(C('cfc9ba'), along, line, a0, a1, WIN_LO, WIN_LO + 0.02, side.facing, 2.4, 2.4);
      } else {
        mb.panel(side.tex, along, fixed, a0, a1, 0, side.h, side.facing, 2.4, 2.4);
      }
    }
    if (s.windowed) {
      // one shared pane in the middle of the wall
      mb.panel('glass', along, line, a0 + 0.1, a1 - 0.1, WIN_LO + 0.06, WIN_HI - 0.06, 1, 2.4, 2.4);
      for (const off of [-T2, T2]) {
        mb.panel(C('e4e0d4'), along, line + off, a0, a0 + 0.1, WIN_LO, WIN_HI, off < 0 ? -1 : 1);
        mb.panel(C('e4e0d4'), along, line + off, a1 - 0.1, a1, WIN_LO, WIN_HI, off < 0 ? -1 : 1);
      }
    }
  }

  // --- doorways -------------------------------------------------------------
  const doorGroups = [];
  for (const d of doors) {
    const along = d.dir === 'w' ? 'z' : 'x';
    const a0 = d.dir === 'w' ? wz(d.gy) : wx(d.gx);
    const a1 = d.dir === 'w' ? wz(d.gy + 1) : wx(d.gx + 1);
    const line = d.dir === 'w' ? wx(d.gx) : wz(d.gy);
    const roomA = d.a >= 0 ? rooms[d.a] : null;
    const roomB = d.b >= 0 ? rooms[d.b] : null;
    const hA = roomA ? (roomA.outdoor ? 3.4 : roomA.ceil) : 3.4;
    const hB = roomB ? (roomB.outdoor ? 3.4 : roomB.ceil) : 3.4;
    const texA = roomA && !roomA.outdoor ? roomA.wallTex : 'cinder';
    const texB = roomB && !roomB.outdoor ? roomB.wallTex : 'cinder';

    const ow = OPEN_W[d.style] || OPEN_W.door;
    const mid = (a0 + a1) / 2;
    const oA = mid - ow / 2, oB = mid + ow / 2;

    for (const [h, tex, off, facing] of [[hA, texA, -T2, -1], [hB, texB, T2, 1]]) {
      mb.panel(tex, along, line + off, a0, oA, 0, h, facing);
      mb.panel(tex, along, line + off, oB, a1, 0, h, facing);
      mb.panel(tex, along, line + off, oA, oB, DOOR_H, h, facing);      // header
    }
    // jamb lining
    mb.panel(C('7a6a52'), along, line - T2, oA, oB, DOOR_H, DOOR_H + 0.02, 1);
    for (const e of [oA, oB]) {
      if (along === 'x') mb.box(C('7a6a52'), e, DOOR_H / 2, line, 0.03, DOOR_H / 2, T2 + 0.01, 0);
      else mb.box(C('7a6a52'), line, DOOR_H / 2, e, T2 + 0.01, DOOR_H / 2, 0.03, 0);
    }

    // The leaf(s): a pivoting group per door so it can swing.
    const grp = new THREE.Group();
    const leaves = d.style === 'double' ? 2 : 1;
    const lw = ow / leaves;
    for (let i = 0; i < leaves; i++) {
      const hingeAlong = i === 0 ? oA : oB;
      const swingSign = i === 0 ? 1 : -1;
      const pivot = new THREE.Group();
      if (along === 'x') pivot.position.set(hingeAlong, 0, line);
      else pivot.position.set(line, 0, hingeAlong);
      const geo = new THREE.BoxGeometry(lw - 0.04, DOOR_H - 0.06, 0.06);
      const leaf = new THREE.Mesh(geo, materialFor(d.exit ? C('7a4a2a') : C('8a6a44')));
      const half = (lw - 0.04) / 2 + 0.02;
      if (along === 'x') leaf.position.set(swingSign * half, (DOOR_H - 0.06) / 2, 0);
      else { leaf.position.set(0, (DOOR_H - 0.06) / 2, swingSign * half); leaf.rotation.y = Math.PI / 2; }
      pivot.add(leaf);
      // small wired-glass window in the leaf
      const winGeo = new THREE.BoxGeometry(Math.min(0.34, lw * 0.4), 0.5, 0.08);
      const win = new THREE.Mesh(winGeo, materialFor('glass'));
      win.position.set(leaf.position.x, 1.5, leaf.position.z);
      win.rotation.y = leaf.rotation.y;
      pivot.add(win);
      pivot.userData.swingSign = swingSign * (along === 'x' ? 1 : -1);
      grp.add(pivot);
    }
    grp.userData.door = d;
    d.mesh = grp;
    scene.add(grp);
    doorGroups.push(grp);
  }

  // --- fences ---------------------------------------------------------------
  for (const f of fences) {
    const dx = f.x2 - f.x1, dz = f.z2 - f.z1;
    const len = Math.hypot(dx, dz);
    const cx = (f.x1 + f.x2) / 2, cz = (f.z1 + f.z2) / 2;
    const rot = Math.atan2(dx, dz);
    const fake = { x: cx, z: cz, rot };
    for (let i = 0; i <= 1; i++) {
      const t = -len / 2 + i * len;
      pbox(mb, METD, fake, t, 1.0, 0, 0.05, 1.0, 0.05);
    }
    for (const y of [0.35, 1.05, 1.75]) pbox(mb, METD, fake, 0, y, 0, len / 2, 0.025, 0.025);
    for (let t = -len / 2 + 0.15; t < len / 2; t += 0.3) pbox(mb, C('6a7076'), fake, t, 1.05, 0, 0.012, 0.72, 0.012);
  }

  // --- furniture ------------------------------------------------------------
  // Hideable containers get a separate door mesh so it can swing open.
  const hideDoors = [];
  for (const p of props) {
    buildProp(mb, p);
    if (p.hide === 'locker') {
      const geo = new THREE.BoxGeometry(1.06, 1.66, 0.05);
      const m = new THREE.Mesh(geo, materialFor(METD));
      const pivot = new THREE.Group();
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      pivot.position.set(p.x + (-1.1) * c + 0.23 * s, 0, p.z - (-1.1) * s + 0.23 * c);
      pivot.rotation.y = p.rot;
      m.position.set(0.55, 0.88, 0);
      pivot.add(m);
      pivot.visible = false;
      pivot.userData.prop = p;
      p.doorMesh = pivot;
      scene.add(pivot);
      hideDoors.push(pivot);
    }
  }

  // --- light fixtures -------------------------------------------------------
  const panelMat = new THREE.MeshBasicMaterial({ map: tiled(TEX.panel, 1), color: 0xffffff });
  const panelOff = new THREE.MeshPhongMaterial({ color: 0x5a5a54, shininess: 2 });
  const panelGeo = new THREE.PlaneGeometry(1.0, 0.5);
  panelGeo.rotateX(Math.PI / 2);
  const bulbGeo = new THREE.SphereGeometry(0.16, 8, 6);

  for (const f of fixtures) {
    if (f.pole) {
      mb.cylinder(METD, f.x, 0, f.z, 0.09, f.y, 7);
      mb.box(METD, f.x, f.y + 0.1, f.z, 0.28, 0.08, 0.28, 0);
      const bulb = new THREE.Mesh(bulbGeo, panelMat);
      bulb.position.set(f.x, f.y - 0.02, f.z);
      scene.add(bulb);
      f.mesh = bulb;
    } else {
      mb.box(METD, f.x, f.y + 0.07, f.z, 0.56, 0.06, 0.3, 0);
      const pm = new THREE.Mesh(panelGeo, panelMat);
      pm.position.set(f.x, f.y, f.z);
      scene.add(pm);
      f.mesh = pm;
    }
    f.onMat = panelMat;
    f.offMat = panelOff;
  }

  // --- commit ---------------------------------------------------------------
  const meshes = mb.build(materialFor);
  for (const m of meshes) { m.updateMatrix(); scene.add(m); }

  return {
    meshes, doorGroups, hideDoors, panelMat, panelOff,
    dispose() {
      for (const m of meshes) { m.geometry.dispose(); scene.remove(m); }
      for (const g of doorGroups) scene.remove(g);
      for (const g of hideDoors) scene.remove(g);
      for (const f of fixtures) if (f.mesh) scene.remove(f.mesh);
    }
  };
}
