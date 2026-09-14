// Scene setup, plus the light pool.
//
// The school has ~80 ceiling fixtures but a GPU will not shade 80 point lights.
// A small pool of real lights is reassigned every frame to whichever switched-on
// fixtures are nearest the camera, which is indistinguishable from the real
// thing when you can only see one or two rooms at a time.
import * as THREE from 'three';
import { clamp, lerp } from '../util/util.js?v=2026-09-13f';

const POOL = 6;

export class Renderer {
  constructor(canvas, settings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.quality === 'high' ? 2 : 1.4));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x0a0c10);

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(0x1a2028, 0.012);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(settings.fov || 78, 1, 0.04, 160);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xbcd4ef, 0x54503f, 0.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 0.9);
    this.sun.position.set(30, 60, 20);
    this.scene.add(this.sun);

    // pooled room lights
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(0xfff2d4, 0, 13, 1.6);
      l.visible = false;
      this.scene.add(l);
      this.pool.push(l);
    }

    // the player's torch
    this.torch = new THREE.SpotLight(0xfff4d0, 0, 26, 0.52, 0.55, 1.1);
    this.torch.visible = false;
    this.torchTarget = new THREE.Object3D();
    this.scene.add(this.torch);
    this.scene.add(this.torchTarget);
    this.torch.target = this.torchTarget;

    // Bob's torch: its own light plus a visible beam you can spot down a hall
    this.bobTorch = new THREE.SpotLight(0xffe9b0, 0, 24, 0.42, 0.5, 1.2);
    this.bobTorch.visible = false;
    this.bobTarget = new THREE.Object3D();
    this.scene.add(this.bobTorch);
    this.scene.add(this.bobTarget);
    this.bobTorch.target = this.bobTarget;

    const coneGeo = new THREE.ConeGeometry(1, 1, 12, 1, true);
    coneGeo.translate(0, -0.5, 0);
    coneGeo.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: 0xffe9b0, transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    this.beam.visible = false;
    this.scene.add(this.beam);

    // grump's eyes glowing in the dark get their own faint red light
    this.grumpLight = new THREE.PointLight(0xff2a1a, 0, 8, 2);
    this.grumpLight.visible = false;
    this.scene.add(this.grumpLight);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setFov(v) { this.camera.fov = v; this.camera.updateProjectionMatrix(); }

  setQuality(q) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'low' ? 1 : 1.4));
  }

  // daylight -> pitch black, driven by the phase clock and the generator
  setMood(daylight, powered, dread) {
    const dl = clamp(daylight, 0, 1);
    // Ambient never reaches zero: total black is unreadable, so the night floor
    // is a very dim cold blue that reads as "your eyes have adjusted".
    const amb = lerp(0.035, 0.62, dl) + (powered ? 0.06 : 0);
    this.ambient.intensity = amb;
    this.ambient.color.setHSL(0.58, lerp(0.5, 0.06, dl), 0.5);
    this.hemi.intensity = lerp(0.05, 0.75, dl);
    this.sun.intensity = lerp(0, 0.95, Math.max(0, dl * 1.2 - 0.2));

    const nightFog = lerp(0.052, 0.010, dl);
    this.fog.density = nightFog * (powered ? 1 : 1.5) * (1 + dread * 0.5);
    const c = new THREE.Color().setHSL(0.6, lerp(0.4, 0.12, dl), lerp(0.045, 0.55, dl));
    this.fog.color.copy(c);
    this.renderer.setClearColor(c);
    this.scene.background = c;
  }

  // Give the pool to the nearest lit fixtures.
  updateLights(fixtures, camPos) {
    const near = [];
    for (const f of fixtures) {
      if (!f.on || f.broken) continue;
      const dx = f.x - camPos.x, dz = f.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 34 * 34) continue;
      near.push({ f, d2 });
    }
    near.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < POOL; i++) {
      const l = this.pool[i];
      const e = near[i];
      if (!e) { l.visible = false; l.intensity = 0; continue; }
      const f = e.f;
      l.visible = true;
      l.position.set(f.x, f.y - 0.1, f.z);
      const flick = (f.flicker > 0 || f.jit) ? (Math.random() < 0.35 ? 0.15 : 1) : 1;
      l.intensity = (f.pole ? 6.5 : 4.2) * flick;
      l.distance = f.pole ? 20 : 13;
      l.color.setHex(f.pole ? 0xd8e4ff : 0xfff2d4);
    }
  }

  setTorch(on, intensity, pos, dir) {
    this.torch.visible = on;
    if (!on) return;
    this.torch.intensity = intensity * 5.5;
    this.torch.position.copy(pos);
    this.torchTarget.position.set(pos.x + dir.x * 6, pos.y + dir.y * 6, pos.z + dir.z * 6);
  }

  setBobTorch(on, pos, dir, length = 15) {
    this.bobTorch.visible = on;
    this.beam.visible = on;
    if (!on) return;
    this.bobTorch.intensity = 5;
    this.bobTorch.position.copy(pos);
    this.bobTarget.position.set(pos.x + dir.x * 8, pos.y + dir.y * 8, pos.z + dir.z * 8);
    this.beam.position.copy(pos);
    this.beam.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    this.beam.scale.set(length * 0.42, length * 0.42, length);
  }

  setGrumpGlow(on, pos, intensity = 1) {
    this.grumpLight.visible = on;
    if (on) { this.grumpLight.position.copy(pos); this.grumpLight.intensity = 2.4 * intensity; }
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
