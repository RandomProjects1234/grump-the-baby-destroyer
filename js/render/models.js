// Characters and hand-held items, built from boxes. Every model exposes its
// limbs on userData.parts so one animation helper can walk all of them.
import * as THREE from 'three';

const geoCache = new Map();
const matCache = new Map();

function box(w, h, d) {
  const k = `b${w},${h},${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
function sphere(r, s = 8) {
  const k = `s${r},${s}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, s, Math.max(4, s - 2)));
  return geoCache.get(k);
}
function cyl(rt, rb, h, s = 8) {
  const k = `c${rt},${rb},${h},${s}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, s));
  return geoCache.get(k);
}
function mat(color, opts = {}) {
  const k = color + JSON.stringify(opts);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhongMaterial(Object.assign({ color, shininess: 6, specular: 0x101010 }, opts)));
  return matCache.get(k);
}
function emissive(color) {
  const k = 'e' + color;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshBasicMaterial({ color }));
  return matCache.get(k);
}

function part(geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

// ---------------------------------------------------------------- babies

export const BABY_COLORS = [0xf2c9a0, 0xe0a878, 0xc08a5e, 0x8a5f3c, 0xf7d9bd];
export const OUTFIT_COLORS = [0x7fb2e5, 0xe57f9c, 0x8ce57f, 0xe5c97f, 0xb98ce5, 0xe58c6a];

// A baby: mostly head. Camera sits at the eyes when this is the local player.
export function makeBaby(skin = BABY_COLORS[0], outfit = OUTFIT_COLORS[0], scale = 1) {
  const g = new THREE.Group();
  const skinM = mat(skin), outM = mat(outfit);

  const body = new THREE.Group();
  body.position.y = 0.30;
  body.add(part(box(0.30, 0.26, 0.20), outM, 0, 0, 0));
  body.add(part(box(0.32, 0.14, 0.22), mat(0xf4f2ea), 0, -0.15, 0));   // nappy
  g.add(body);

  const head = new THREE.Group();
  head.position.y = 0.30 + 0.13 + 0.14;
  const skull = part(sphere(0.20, 10), skinM, 0, 0.02, 0);
  skull.scale.set(1, 0.95, 0.92);
  head.add(skull);
  // eyes + a single curl of hair
  head.add(part(sphere(0.038, 6), mat(0x1a1a1a), -0.075, 0.04, -0.175));
  head.add(part(sphere(0.038, 6), mat(0x1a1a1a), 0.075, 0.04, -0.175));
  head.add(part(sphere(0.026, 6), mat(0xffffff), -0.082, 0.055, -0.196));
  head.add(part(sphere(0.026, 6), mat(0xffffff), 0.068, 0.055, -0.196));
  head.add(part(box(0.06, 0.02, 0.03), mat(0xc4736a), 0, -0.06, -0.18));  // mouth
  const curl = part(cyl(0.012, 0.012, 0.09, 5), mat(0x6a4a2a), 0.02, 0.21, 0.02);
  curl.rotation.z = 0.5;
  head.add(curl);
  g.add(head);

  const arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.18, 0.40, 0);
    a.add(part(cyl(0.045, 0.05, 0.20, 6), skinM, 0, -0.10, 0));
    a.add(part(sphere(0.055, 6), skinM, 0, -0.21, 0));
    g.add(a); arms.push(a);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group();
    l.position.set(s * 0.085, 0.17, 0);
    l.add(part(cyl(0.055, 0.055, 0.18, 6), skinM, 0, -0.09, 0));
    l.add(part(box(0.09, 0.06, 0.14), mat(0xe8e4d8), 0, -0.19, -0.02));
    g.add(l); legs.push(l);
  }

  g.scale.setScalar(scale);
  g.userData.parts = { body, head, arms, legs, skinM, outM };
  g.userData.eyeHeight = 0.60 * scale;
  return g;
}

// ---------------------------------------------------------------- grump

// Grump grows as he sours. Stage 0 is a slightly odd toddler; stage 4 is not.
export const GRUMP_STAGES = [
  { scale: 1.05, skin: 0xf0c49a, out: 0x6f8f5a, eye: 0x1a1a1a, arm: 1.0, glow: 0 },
  { scale: 1.15, skin: 0xe6bb92, out: 0x5f7c4e, eye: 0x231a10, arm: 1.1, glow: 0 },
  { scale: 1.32, skin: 0xd2a884, out: 0x4a6140, eye: 0x3a1010, arm: 1.3, glow: 0.15 },
  { scale: 1.6, skin: 0xb08d70, out: 0x35462f, eye: 0x8a1010, arm: 1.6, glow: 0.5 },
  { scale: 2.0, skin: 0x8d6f58, out: 0x1f2a1c, eye: 0xff2a1a, arm: 2.1, glow: 1.0 }
];

export function makeGrump() {
  const g = new THREE.Group();
  const st = GRUMP_STAGES[0];

  const body = new THREE.Group();
  body.position.y = 0.34;
  const torso = part(box(0.36, 0.34, 0.24), mat(st.out), 0, 0, 0);
  body.add(torso);
  // dungaree straps
  body.add(part(box(0.06, 0.30, 0.02), mat(0x8a5a3a), -0.10, 0.06, -0.13));
  body.add(part(box(0.06, 0.30, 0.02), mat(0x8a5a3a), 0.10, 0.06, -0.13));
  g.add(body);

  const head = new THREE.Group();
  head.position.y = 0.34 + 0.17 + 0.17;
  const skull = part(sphere(0.235, 12), mat(st.skin), 0, 0.02, 0);
  skull.scale.set(1, 0.97, 0.94);
  head.add(skull);
  const eyeL = part(sphere(0.05, 7), mat(st.eye), -0.085, 0.03, -0.205);
  const eyeR = part(sphere(0.05, 7), mat(st.eye), 0.085, 0.03, -0.205);
  head.add(eyeL); head.add(eyeR);
  // heavy brows -- the permanent frown
  const browL = part(box(0.11, 0.028, 0.03), mat(0x4a3524), -0.085, 0.10, -0.215);
  const browR = part(box(0.11, 0.028, 0.03), mat(0x4a3524), 0.085, 0.10, -0.215);
  browL.rotation.z = -0.42; browR.rotation.z = 0.42;
  head.add(browL); head.add(browR);
  const mouth = part(box(0.13, 0.025, 0.03), mat(0x6a2a2a), 0, -0.085, -0.21);
  mouth.rotation.z = 0;
  head.add(mouth);
  const glowL = part(sphere(0.062, 7), emissive(0xff2a1a), -0.085, 0.03, -0.208);
  const glowR = part(sphere(0.062, 7), emissive(0xff2a1a), 0.085, 0.03, -0.208);
  glowL.visible = glowR.visible = false;
  head.add(glowL); head.add(glowR);
  g.add(head);

  const arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.21, 0.46, 0);
    const upper = part(cyl(0.05, 0.055, 0.24, 6), mat(st.skin), 0, -0.12, 0);
    const hand = part(sphere(0.07, 7), mat(st.skin), 0, -0.26, 0);
    a.add(upper); a.add(hand);
    a.userData.limb = { upper, hand };
    g.add(a); arms.push(a);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group();
    l.position.set(s * 0.10, 0.20, 0);
    l.add(part(cyl(0.06, 0.06, 0.22, 6), mat(st.out), 0, -0.11, 0));
    l.add(part(box(0.10, 0.07, 0.16), mat(0x3a2a1a), 0, -0.23, -0.02));
    g.add(l); legs.push(l);
  }

  g.userData.parts = { body, head, arms, legs, torso, skull, eyeL, eyeR, glowL, glowR, mouth, browL, browR };
  g.userData.stage = -1;
  setGrumpStage(g, 0);
  return g;
}

export function setGrumpStage(g, stage) {
  stage = Math.max(0, Math.min(GRUMP_STAGES.length - 1, Math.round(stage)));
  if (g.userData.stage === stage) return;
  g.userData.stage = stage;
  const st = GRUMP_STAGES[stage];
  const p = g.userData.parts;
  g.scale.setScalar(st.scale);
  p.torso.material = mat(st.out);
  p.skull.material = mat(st.skin);
  p.eyeL.material = p.eyeR.material = mat(st.eye);
  for (const a of p.arms) {
    a.userData.limb.upper.scale.y = st.arm;
    a.userData.limb.upper.position.y = -0.12 * st.arm;
    a.userData.limb.hand.position.y = -0.26 * st.arm;
  }
  const glowing = st.glow > 0.4;
  p.glowL.visible = p.glowR.visible = glowing;
  // the smile inverts entirely by the last stage
  p.mouth.scale.set(1 + stage * 0.35, 1 + stage * 0.6, 1);
  p.mouth.position.y = -0.085 - stage * 0.006;
  p.browL.rotation.z = -0.42 - stage * 0.12;
  p.browR.rotation.z = 0.42 + stage * 0.12;
}

// ---------------------------------------------------------------- bob

export function makeBob() {
  const g = new THREE.Group();
  const skinM = mat(0xd9ab84), suit = mat(0x2f4a6b), suitDark = mat(0x24384f);

  const body = new THREE.Group();
  body.position.y = 1.02;
  body.add(part(box(0.46, 0.66, 0.28), suit, 0, 0, 0));
  body.add(part(box(0.48, 0.10, 0.30), suitDark, 0, -0.28, 0));       // tool belt
  body.add(part(box(0.10, 0.14, 0.06), mat(0xd8c04a), 0.16, -0.28, -0.16));
  g.add(body);

  const head = new THREE.Group();
  head.position.y = 1.02 + 0.33 + 0.16;
  head.add(part(box(0.26, 0.30, 0.24), skinM, 0, 0, 0));
  head.add(part(box(0.28, 0.07, 0.26), mat(0x24384f), 0, 0.18, 0));   // cap
  head.add(part(box(0.26, 0.03, 0.12), mat(0x24384f), 0, 0.15, -0.17));
  head.add(part(box(0.05, 0.03, 0.02), mat(0x101010), -0.06, 0.02, -0.125));
  head.add(part(box(0.05, 0.03, 0.02), mat(0x101010), 0.06, 0.02, -0.125));
  head.add(part(box(0.16, 0.05, 0.03), mat(0x4a3a2a), 0, -0.07, -0.12));  // moustache
  g.add(head);

  const arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.29, 1.30, 0);
    a.add(part(cyl(0.06, 0.06, 0.56, 6), suit, 0, -0.28, 0));
    a.add(part(sphere(0.07, 6), skinM, 0, -0.58, 0));
    g.add(a); arms.push(a);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group();
    l.position.set(s * 0.13, 0.70, 0);
    l.add(part(cyl(0.075, 0.075, 0.70, 6), suitDark, 0, -0.35, 0));
    l.add(part(box(0.14, 0.09, 0.26), mat(0x1a1a1a), 0, -0.73, -0.04));
    g.add(l); legs.push(l);
  }

  // The torch he sweeps down the corridors, plus its visible beam.
  const torch = new THREE.Group();
  torch.position.set(0.29, 1.02, 0);
  const body2 = part(cyl(0.035, 0.045, 0.22, 6), mat(0x2a2a2a), 0, -0.55, -0.12);
  body2.rotation.x = Math.PI / 2;
  torch.add(body2);
  const lens = part(cyl(0.05, 0.05, 0.02, 8), emissive(0xfff2c0), 0, -0.55, -0.23);
  lens.rotation.x = Math.PI / 2;
  torch.add(lens);
  g.add(torch);

  g.userData.parts = { body, head, arms, legs, torch, lens };
  g.userData.eyeHeight = 1.62;
  return g;
}

// ---------------------------------------------------------------- mrs honeywell

// The teacher. Cardigan, long skirt, grey bun, glasses on a chain, and the
// clipboard with the day's list on it. She is the only grown-up in the building
// who is kind to you, which is its own kind of unsettling.
export function makeHoneywell() {
  const g = new THREE.Group();
  const skin = mat(0xe8c4a0), cardigan = mat(0xc89a3a), blouse = mat(0xf0ece0);
  const skirt = mat(0x2f3a5a), hair = mat(0xb8b4ac);

  const legs = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group();
    l.position.set(s * 0.1, 0.5, 0);
    l.add(part(cyl(0.05, 0.05, 0.5, 6), mat(0xd8b898), 0, -0.25, 0));
    l.add(part(box(0.1, 0.07, 0.22), mat(0x4a2a1a), 0, -0.5, -0.04));
    g.add(l); legs.push(l);
  }
  // a long A-line skirt hides most of the legs
  g.add(part(cyl(0.2, 0.3, 0.62, 10), skirt, 0, 0.62, 0));

  const body = new THREE.Group();
  body.position.y = 1.18;
  body.add(part(box(0.38, 0.5, 0.24), cardigan, 0, 0, 0));
  body.add(part(box(0.16, 0.44, 0.012), blouse, 0, 0.02, -0.126));
  for (let i = 0; i < 3; i++) body.add(part(sphere(0.012, 5), mat(0x6a4a2a), 0.1, 0.12 - i * 0.12, -0.13));
  g.add(body);

  const head = new THREE.Group();
  head.position.y = 1.18 + 0.25 + 0.17;
  head.add(part(cyl(0.05, 0.06, 0.1, 6), skin, 0, -0.14, 0));
  head.add(part(sphere(0.14, 10), skin, 0, 0, 0));
  const bun = part(sphere(0.085, 8), hair, 0, 0.08, 0.1);
  head.add(bun);
  const cap = part(sphere(0.148, 10), hair, 0, 0.03, 0.02);
  cap.scale.set(1, 0.72, 1);
  head.add(cap);
  // glasses
  for (const s of [-1, 1]) {
    const lens = part(box(0.06, 0.035, 0.008), mat(0x1a1a1a), s * 0.05, 0.01, -0.135);
    head.add(lens);
    head.add(part(box(0.045, 0.022, 0.006), mat(0xcfe4ec, { transparent: true, opacity: 0.5 }), s * 0.05, 0.01, -0.14));
  }
  head.add(part(box(0.03, 0.006, 0.008), mat(0x1a1a1a), 0, 0.02, -0.136));
  head.add(part(box(0.06, 0.012, 0.01), mat(0xa05a5a), 0, -0.06, -0.13));   // a small smile
  g.add(head);

  const arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.22, 1.4, 0);
    a.add(part(cyl(0.05, 0.045, 0.5, 6), cardigan, 0, -0.25, 0));
    a.add(part(sphere(0.05, 6), skin, 0, -0.52, 0));
    g.add(a); arms.push(a);
  }
  // the clipboard, held against her in the left hand
  const clip = new THREE.Group();
  clip.add(part(box(0.22, 0.3, 0.015), mat(0x8a6a44), 0, 0, 0));
  clip.add(part(box(0.19, 0.25, 0.004), mat(0xf4f0e4), 0, -0.01, -0.01));
  clip.add(part(box(0.08, 0.03, 0.02), mat(0x9aa0a4), 0, 0.15, -0.01));
  for (let i = 0; i < 4; i++) clip.add(part(box(0.14, 0.008, 0.002), mat(0x3b5a9a), 0, 0.07 - i * 0.045, -0.013));
  clip.position.set(0, -0.48, -0.1);
  clip.rotation.x = -0.4;
  arms[0].add(clip);
  arms[0].rotation.x = -0.6;

  g.userData.parts = { body, head, arms, legs, clip };
  g.userData.eyeHeight = 1.6;
  return g;
}

// ---------------------------------------------------------------- toddlers

export function makeToddler(seedIdx = 0) {
  const skin = BABY_COLORS[seedIdx % BABY_COLORS.length];
  const outfit = OUTFIT_COLORS[(seedIdx * 3 + 1) % OUTFIT_COLORS.length];
  const g = makeBaby(skin, outfit, 0.82);
  // a dummy, so you can tell them from other players at a glance
  const dummy = part(sphere(0.035, 6), mat(0xe58ca8), 0, 0.62, -0.19);
  g.add(dummy);
  g.userData.parts.dummy = dummy;
  return g;
}

// ---------------------------------------------------------------- card kid

// An older boy. Not a toddler, not staff. He is holding a fan of cards and he
// is going to tell you about them whether you want him to or not.
export function makeCardKid() {
  const g = new THREE.Group();
  const skin = mat(0xe8bd94), shirt = mat(0xd8452e), jeans = mat(0x3a4a6b);

  const body = new THREE.Group();
  body.position.y = 0.56;
  body.add(part(box(0.34, 0.44, 0.22), shirt, 0, 0, 0));
  body.add(part(box(0.30, 0.06, 0.20), mat(0xf0e4d0), 0, 0.16, -0.115));  // collar
  g.add(body);

  const head = new THREE.Group();
  head.position.y = 0.56 + 0.22 + 0.19;
  head.add(part(sphere(0.19, 10), skin, 0, 0, 0));
  head.add(part(sphere(0.036, 6), mat(0x1a1a1a), -0.068, 0.03, -0.165));
  head.add(part(sphere(0.036, 6), mat(0x1a1a1a), 0.068, 0.03, -0.165));
  head.add(part(box(0.09, 0.025, 0.03), mat(0xa8564a), 0, -0.07, -0.17));
  const hair = part(sphere(0.20, 10), mat(0x4a3220), 0, 0.05, 0.015);
  hair.scale.set(1, 0.62, 1);
  head.add(hair);
  g.add(head);

  const arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.21, 0.74, 0);
    a.add(part(cyl(0.048, 0.05, 0.34, 6), skin, 0, -0.17, 0));
    a.add(part(sphere(0.055, 6), skin, 0, -0.36, 0));
    g.add(a); arms.push(a);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group();
    l.position.set(s * 0.10, 0.36, 0);
    l.add(part(cyl(0.06, 0.06, 0.38, 6), jeans, 0, -0.19, 0));
    l.add(part(box(0.11, 0.07, 0.19), mat(0xdedad0), 0, -0.40, -0.03));
    g.add(l); legs.push(l);
  }

  // The fan of cards, held up at chest height for your inspection.
  const fan = new THREE.Group();
  fan.position.set(0.0, 0.86, -0.26);
  const cardCols = [0xf0d84a, 0x4a8fd8, 0xd84a5a, 0x6ad84a, 0xd88f4a];
  for (let i = 0; i < 5; i++) {
    const c = part(box(0.11, 0.16, 0.004), mat(cardCols[i]), 0, 0, i * 0.003);
    c.rotation.z = (i - 2) * 0.17;
    c.position.x = (i - 2) * 0.035;
    c.position.y = -Math.abs(i - 2) * 0.012;
    fan.add(c);
  }
  g.add(fan);

  // Arms come forward to present them.
  arms[0].rotation.x = -1.25; arms[1].rotation.x = -1.25;
  arms[0].rotation.z = 0.3; arms[1].rotation.z = -0.3;

  g.userData.parts = { body, head, arms, legs, fan };
  g.userData.eyeHeight = 1.05;
  return g;
}

// ---------------------------------------------------------------- the taker

// Whatever takes him. Deliberately unlike Grump and unlike Bob: too tall, too
// thin, no face, and it has no interest in you at all.
export function makeTaker() {
  const g = new THREE.Group();
  const skin = mat(0x14161a, { shininess: 34, specular: 0x2a2f38 });

  const body = new THREE.Group();
  body.position.y = 1.55;
  const torso = part(box(0.30, 0.95, 0.19), skin, 0, 0, 0);
  torso.scale.set(1, 1, 1);
  body.add(torso);
  body.add(part(box(0.42, 0.12, 0.20), skin, 0, 0.48, 0));   // shoulders
  g.add(body);

  const head = new THREE.Group();
  head.position.y = 2.28;
  const skull = part(sphere(0.16, 10), skin, 0, 0, 0);
  skull.scale.set(0.82, 1.5, 0.82);
  head.add(skull);
  // one pale seam where a face would be
  const seam = part(box(0.015, 0.2, 0.02), emissive(0xb9c6cf), 0, 0.02, -0.125);
  head.add(seam);
  head.rotation.z = 0.14;
  g.add(head);

  const arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.24, 2.0, 0);
    a.add(part(cyl(0.035, 0.028, 1.15, 6), skin, 0, -0.58, 0));
    // long splayed fingers
    for (let f = 0; f < 4; f++) {
      const fg = part(cyl(0.011, 0.006, 0.26, 4), skin, (f - 1.5) * 0.032, -1.28, 0);
      fg.rotation.z = (f - 1.5) * 0.16;
      a.add(fg);
    }
    g.add(a); arms.push(a);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group();
    l.position.set(s * 0.11, 1.1, 0);
    l.add(part(cyl(0.05, 0.038, 1.1, 6), skin, 0, -0.55, 0));
    l.add(part(box(0.09, 0.05, 0.26), skin, 0, -1.12, -0.05));
    g.add(l); legs.push(l);
  }

  g.userData.parts = { body, head, arms, legs, seam };
  g.userData.eyeHeight = 2.3;
  return g;
}

// ---------------------------------------------------------------- items

const ITEM_BUILDERS = {
  fuel(g) {
    g.add(part(box(0.22, 0.28, 0.14), mat(0xc4342a), 0, 0.14, 0));
    g.add(part(box(0.06, 0.06, 0.06), mat(0x2a2a2a), 0, 0.31, 0));
    g.add(part(box(0.16, 0.04, 0.03), mat(0x2a2a2a), 0, 0.30, -0.06));
    g.add(part(box(0.14, 0.10, 0.005), mat(0xf0e8d0), 0, 0.16, -0.072));
  },
  part(g) {
    g.add(part(box(0.20, 0.05, 0.05), mat(0x9aa0a4), 0, 0.06, 0));
    g.add(part(cyl(0.055, 0.055, 0.04, 8), mat(0x7a8084), 0.08, 0.06, 0));
    g.add(part(box(0.05, 0.12, 0.05), mat(0x6a7074), -0.08, 0.10, 0));
  },
  battery(g) {
    g.add(part(cyl(0.045, 0.045, 0.16, 8), mat(0x2a6a3a), 0, 0.08, 0));
    g.add(part(cyl(0.02, 0.02, 0.02, 6), mat(0xc8b04a), 0, 0.17, 0));
  },
  snack(g) {
    g.add(part(box(0.16, 0.20, 0.05), mat(0xe5a83a), 0, 0.10, 0));
    g.add(part(box(0.10, 0.06, 0.006), mat(0x9c2b2b), 0, 0.11, -0.027));
  },
  juice(g) {
    g.add(part(box(0.10, 0.16, 0.08), mat(0xe57fa0), 0, 0.08, 0));
    g.add(part(cyl(0.01, 0.01, 0.14, 5), mat(0xf0f0f0), 0.03, 0.20, 0));
  },
  teddy(g) {
    g.add(part(sphere(0.09, 8), mat(0xa8763f), 0, 0.20, 0));
    g.add(part(sphere(0.11, 8), mat(0xa8763f), 0, 0.09, 0));
    g.add(part(sphere(0.035, 6), mat(0xa8763f), -0.07, 0.27, 0));
    g.add(part(sphere(0.035, 6), mat(0xa8763f), 0.07, 0.27, 0));
    g.add(part(sphere(0.022, 6), mat(0x2a1a10), -0.035, 0.22, -0.075));
    g.add(part(sphere(0.022, 6), mat(0x2a1a10), 0.035, 0.22, -0.075));
    for (const s of [-1, 1]) g.add(part(sphere(0.045, 6), mat(0xa8763f), s * 0.12, 0.11, 0));
  },
  glowstick(g) {
    const m = part(cyl(0.018, 0.018, 0.16, 6), emissive(0x6cff9a), 0, 0.08, 0);
    m.rotation.z = 0.3;
    g.add(m);
  },
  nightlight(g) {
    g.add(part(box(0.14, 0.14, 0.08), mat(0xf0e8d8), 0, 0.08, 0));
    g.add(part(sphere(0.05, 8), emissive(0xffd88a), 0, 0.13, -0.03));
  },
  key(g) {
    g.add(part(cyl(0.035, 0.035, 0.012, 8), mat(0xc8a83a), 0, 0.06, 0));
    g.add(part(box(0.014, 0.12, 0.012), mat(0xc8a83a), 0, 0.11, 0));
    g.add(part(box(0.035, 0.012, 0.012), mat(0xc8a83a), 0.02, 0.16, 0));
  },
  tape(g) {
    g.add(part(cyl(0.07, 0.07, 0.05, 10), mat(0xb4b0a0), 0, 0.05, 0));
    g.add(part(cyl(0.03, 0.03, 0.055, 8), mat(0x8a8678), 0, 0.05, 0));
  },
  flashlight(g) {
    const b = part(cyl(0.028, 0.036, 0.2, 8), mat(0xd8c43a), 0, 0.1, 0);
    g.add(b);
    g.add(part(cyl(0.045, 0.045, 0.03, 8), emissive(0xfff2c0), 0, 0.21, 0));
  },
  wrench(g) {
    g.add(part(box(0.04, 0.24, 0.02), mat(0x9aa0a4), 0, 0.12, 0));
    g.add(part(box(0.10, 0.05, 0.025), mat(0x9aa0a4), 0, 0.24, 0));
    g.add(part(box(0.09, 0.045, 0.025), mat(0x9aa0a4), 0, 0.02, 0));
  },
  apple(g) {
    g.add(part(sphere(0.07, 8), mat(0xc4342a), 0, 0.07, 0));
    g.add(part(cyl(0.006, 0.006, 0.04, 4), mat(0x4a3220), 0, 0.15, 0));
    g.add(part(box(0.04, 0.012, 0.02), mat(0x4a9a3a), 0.02, 0.15, 0));
  },
  sandwich(g) {
    g.add(part(box(0.16, 0.025, 0.16), mat(0xe8d2a0), 0, 0.02, 0));
    g.add(part(box(0.17, 0.02, 0.17), mat(0x6aa04a), 0, 0.045, 0));
    g.add(part(box(0.16, 0.025, 0.16), mat(0xe8d2a0), 0, 0.07, 0));
  },
  milk(g) {
    g.add(part(box(0.08, 0.14, 0.08), mat(0xf2f2ee), 0, 0.07, 0));
    g.add(part(box(0.08, 0.04, 0.08), mat(0x3b7dc4), 0, 0.16, 0));
  },
  lunchbox(g) {
    g.add(part(box(0.24, 0.14, 0.12), mat(0x3b7dc4), 0, 0.07, 0));
    g.add(part(box(0.1, 0.03, 0.03), mat(0x2a2a2a), 0, 0.16, 0));
    g.add(part(box(0.14, 0.06, 0.005), mat(0xf0d84a), 0, 0.08, -0.062));
  },
  hamster(g) {
    // a wire cage with a small orange occupant
    g.add(part(box(0.3, 0.02, 0.2), mat(0x3a8a4a), 0, 0.01, 0));
    for (const x of [-0.14, 0.14]) for (const z of [-0.09, 0.09])
      g.add(part(cyl(0.006, 0.006, 0.2, 4), mat(0xc8c8c8), x, 0.11, z));
    g.add(part(box(0.3, 0.02, 0.2), mat(0xc8c8c8), 0, 0.21, 0));
    const body = part(sphere(0.055, 8), mat(0xd89050), 0, 0.06, 0);
    body.scale.set(1.3, 0.9, 1);
    g.add(body);
    g.add(part(sphere(0.012, 5), mat(0x111111), -0.06, 0.08, -0.03));
  },
  crayon(g) {
    const c = part(cyl(0.012, 0.012, 0.09, 6), mat(0x3a9a2a), 0, 0.02, 0);
    c.rotation.z = Math.PI / 2;
    g.add(c);
    const tip = part(cyl(0.001, 0.012, 0.025, 6), mat(0x2a7a1a), 0.057, 0.02, 0);
    tip.rotation.z = -Math.PI / 2;
    g.add(tip);
  },
  holocard(g) {
    const c = part(box(0.11, 0.004, 0.16), emissive(0xd8b8ff), 0, 0.01, 0);
    c.rotation.y = 0.3;
    g.add(c);
    g.add(part(box(0.09, 0.006, 0.07), mat(0xf0d84a), 0, 0.012, -0.02));
  },
  drawing(g) {
    const m = part(box(0.20, 0.26, 0.004), mat(0xf2eee0), 0, 0.13, 0);
    g.add(m);
    g.add(part(box(0.05, 0.09, 0.006), mat(0xc4432e), -0.03, 0.16, -0.004));
    g.add(part(box(0.11, 0.02, 0.006), mat(0x3b7dc4), 0.01, 0.07, -0.004));
  }
};

export function makeItem(kind) {
  const g = new THREE.Group();
  (ITEM_BUILDERS[kind] || ITEM_BUILDERS.part)(g);
  g.userData.kind = kind;
  return g;
}

// ---------------------------------------------------------------- animation

// One walk cycle for every biped in the game.
export function animateWalk(model, time, speed, opts = {}) {
  const p = model.userData.parts;
  if (!p) return;
  const amp = Math.min(1, speed / 3) * (opts.amp || 1);
  const w = time * (6 + speed * 1.6);
  const swing = Math.sin(w) * 0.7 * amp;
  if (p.legs) {
    p.legs[0].rotation.x = swing;
    p.legs[1].rotation.x = -swing;
  }
  if (p.arms && !opts.armsBusy) {
    p.arms[0].rotation.x = -swing * 0.7;
    p.arms[1].rotation.x = swing * 0.7;
    p.arms[0].rotation.z = 0.12;
    p.arms[1].rotation.z = -0.12;
  }
  if (p.body) {
    p.body.position.y = (opts.bodyY !== undefined ? opts.bodyY : p.body.userData.baseY || p.body.position.y);
    p.body.rotation.z = Math.sin(w * 2) * 0.04 * amp;
  }
  if (p.head) p.head.rotation.z = Math.sin(w) * 0.05 * amp;
}

// Arms up and forward -- carrying something, or reaching for you.
export function poseCarry(model, t) {
  const p = model.userData.parts;
  if (!p || !p.arms) return;
  p.arms[0].rotation.x = -1.5 + Math.sin(t * 3) * 0.05;
  p.arms[1].rotation.x = -1.5 - Math.sin(t * 3) * 0.05;
  p.arms[0].rotation.z = 0.25;
  p.arms[1].rotation.z = -0.25;
}
