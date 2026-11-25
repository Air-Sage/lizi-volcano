// 栗子 (the hero) and 萤 (the companion, as drone and as skiff): load the GLB models and move their parts.
// The models have no skeleton: each moving part is a named node with its origin at the joint.
// In the game the models face +Z, +Y is up and +X is the character's left.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const QX = new THREE.Quaternion(), EU = new THREE.Euler(), AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

function prep(root) {
  const nodes = {}, rest = {};
  root.traverse(o => { nodes[o.name] = o; rest[o.name] = { q: o.quaternion.clone(), p: o.position.clone(), s: o.scale.clone() };
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false;
      if (o.material.transparent || o.material.opacity < 1) { o.material.transparent = true; o.material.depthWrite = false; o.material.side = THREE.DoubleSide; o.castShadow = false; } } });
  return { nodes, rest };
}
// turn a node about its own X axis, starting from the pose it was modelled in
function swingX(n, r, a) { n.quaternion.copy(r.q).multiply(QX.setFromAxisAngle(AX, a)); }

export async function loadActors() {
  const L = new GLTFLoader(), load = u => new Promise((res, rej) => L.load(u, g => res(g.scene), undefined, rej));
  const [h, d, s] = await Promise.all(['hero', 'drone', 'skiff'].map(n => load(`./assets/${n}.glb`).catch(() => load(`./assets/${n}.wasm`))));
  return { hero: new Hero(h), drone: new Drone(d), skiff: new Skiff(s) };
}

export const HERO_SCALE = 1.2;

export class Hero {
  constructor(model) {
    this.root = new THREE.Group(); this.model = model; model.scale.setScalar(HERO_SCALE); this.root.add(model);
    Object.assign(this, prep(model));
    this.phase = 0; this.amp = 0; this.air = 0; this.ride = 0; this.blink = 2; this.flap = 0; this.t = 0;
  }
  // st: { speed (m/s), grounded, vy, riding, dist (metres moved this frame) }
  update(dt, st) {
    const n = this.nodes, r = this.rest; this.t += dt;
    const run = Math.min(st.speed / 5.6, 1.2);
    this.amp = damp(this.amp, st.grounded && !st.riding ? Math.min(st.speed / 2.2, 1) : 0, 10, dt);
    this.air = damp(this.air, st.grounded || st.riding ? 0 : 1, 12, dt);
    this.ride = damp(this.ride, st.riding ? 1 : 0, 9, dt);
    this.flap = damp(this.flap, Math.min(st.speed / 7, 1.3), 5, dt);
    if (st.grounded && !st.riding) this.phase += st.dist * (5.4 - run * 1.2);             // steps follow the ground covered
    const sw = Math.sin(this.phase) * this.amp, A = 0.62 + run * 0.22;
    const walk = 1 - this.air, foot = 1 - this.ride;
    // legs: stride on the ground, tucked in the air, braced on the skiff
    swingX(n.LegL, r.LegL, (-sw * A) * walk * foot + 0.55 * this.air * foot - 0.22 * this.ride);
    swingX(n.LegR, r.LegR, (sw * A) * walk * foot + 0.25 * this.air * foot + 0.16 * this.ride);
    // arms: counter-swing, thrown up in a jump, forward to the rail when riding
    swingX(n.ArmL, r.ArmL, (sw * A * 0.85) * walk * foot - 1.25 * this.air * foot - 1.15 * this.ride);
    swingX(n.ArmR, r.ArmR, (-sw * A * 0.85) * walk * foot - 1.05 * this.air * foot - 1.15 * this.ride);
    // torso: bob twice per stride, lean into the run, breathe when idle
    const idle = (1 - this.amp) * foot;
    n.Torso.position.y = r.Torso.p.y + Math.abs(Math.sin(this.phase)) * 0.022 * this.amp + Math.sin(this.t * 2.2) * 0.006 * idle - 0.02 * this.ride;
    n.Torso.rotation.set(0.05 * this.amp + 0.1 * run * this.amp + 0.12 * this.ride - 0.1 * this.air, Math.sin(this.t * 0.7) * 0.08 * idle, Math.sin(this.phase) * 0.035 * this.amp);
    n.Cap.rotation.z = Math.sin(this.phase * 2 + 1) * 0.02 * this.amp;
    // scarf tails stream out behind with speed
    for (const [k, off] of [['ScarfTailL', 0], ['ScarfTailR', 1.7]]) swingX(n[k], r[k], this.flap * 1.05 + Math.sin(this.t * (6 + this.flap * 9) + off) * (0.05 + 0.16 * this.flap));
    // blink
    this.blink -= dt; if (this.blink < -0.12) this.blink = 1.6 + Math.random() * 3.2;
    const ey = this.blink < 0 ? 0.12 : 1; n.EyeL.scale.y = r.EyeL.s.y * ey; n.EyeR.scale.y = r.EyeR.s.y * ey;
  }
}

export class Drone {
  constructor(model) {
    this.root = new THREE.Group(); model.scale.setScalar(1.25); this.root.add(model); Object.assign(this, prep(model));
    this.t = 0; this.glow = this.nodes.BulbGlow.material; this.vel = new THREE.Vector3();
  }
  update(dt) {
    this.t += dt; const n = this.nodes, r = this.rest, f = Math.sin(this.t * 42) * 0.42, f2 = Math.sin(this.t * 42 + 0.9) * 0.36;
    // wings beat about the body's long axis
    n.WingL.quaternion.copy(QX.setFromAxisAngle(AZ, f)).multiply(r.WingL.q); n.WingR.quaternion.copy(QX.setFromAxisAngle(AZ, -f)).multiply(r.WingR.q);
    n.Wing2L.quaternion.copy(QX.setFromAxisAngle(AZ, f2)).multiply(r.Wing2L.q); n.Wing2R.quaternion.copy(QX.setFromAxisAngle(AZ, -f2)).multiply(r.Wing2R.q);
    this.glow.emissiveIntensity = 2.0 + Math.sin(this.t * 3.1) * 0.7;
  }
}

export class Skiff {
  constructor(model) {
    this.root = new THREE.Group(); this.tilt = new THREE.Group(); this.model = model; model.scale.setScalar(1.12); this.tilt.add(model); this.root.add(this.tilt); Object.assign(this, prep(model));
    this.t = 0; this.glow = this.nodes.BulbGlow.material; this.roll = 0; this.pitch = 0;
  }
  // turn: yaw rate (rad/s), thrust: 0..1
  update(dt, turn, thrust) {
    this.t += dt; const n = this.nodes, r = this.rest;
    this.roll = damp(this.roll, THREE.MathUtils.clamp(-turn * 0.22, -0.4, 0.4), 5, dt); this.pitch = damp(this.pitch, -thrust * 0.07, 4, dt);
    this.tilt.rotation.set(this.pitch + Math.sin(this.t * 1.7) * 0.012, 0, this.roll + Math.sin(this.t * 1.3) * 0.015);
    this.tilt.position.y = Math.sin(this.t * 2.1) * 0.035;
    const f = Math.sin(this.t * 3.2) * 0.07 + thrust * 0.1;
    n.WingL.quaternion.copy(QX.setFromAxisAngle(AZ, f)).multiply(r.WingL.q); n.WingR.quaternion.copy(QX.setFromAxisAngle(AZ, -f)).multiply(r.WingR.q);
    this.glow.emissiveIntensity = 1.1 + thrust * 1.5 + Math.sin(this.t * 9) * 0.15;
  }
}
