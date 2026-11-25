// 《栗子与萤 · 火山星》: boot, input, movement, the companion, pickups, camera, HUD, and a small test handle (window.G).
import * as THREE from 'three';
import { SUN, FOG_COLOR, installFog, makeSky, makeLava, makeGrit, Post } from './gfx.js';
import { LAVA_Y, START, height, slope, groundAt, platforms, colliders, crystals, buildWorld } from './world.js';
import { loadActors } from './actors.js';

installFog();
const $ = id => document.getElementById(id);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDamp = (a, b, k, dt) => { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * (1 - Math.exp(-k * dt)); };

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0105);
const camera = new THREE.PerspectiveCamera(58, 1, 0.2, 4000);
const post = new Post(renderer);

// light: one low sun with long shadows, warm bounce from the lava below
const sun = new THREE.DirectionalLight(0xffb070, 5.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 1, far: 460 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target, new THREE.HemisphereLight(0xc9584a, 0xff8a4a, 1.5));
const sky = makeSky(), lava = makeLava(6000); lava.position.y = LAVA_Y; scene.add(sky, lava);
const world = buildWorld(scene, makeGrit());

// ---------------------------------------------------------------- state
const G = window.G = {
  pos: new THREE.Vector3(START.x, height(START.x, START.z), START.z), vel: new THREE.Vector3(), vy: 0, heading: Math.PI, grounded: true,
  yaw: 0.5, pitch: 0.2, dist: 6.5, riding: false, energy: 100, got: 0, total: crystals.length, safe: new THREE.Vector3(), dead: 0, t: 0,
  lamp: false, scan: 0, started: false, done: false, keys: {}, speed: 0, turn: 0, morph: 1, fps: 0,
};
G.safe.copy(G.pos);
let actors = null, hero, drone, skiff;
const dronePos = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), target = new THREE.Vector3();

// small glow / dust particles
const parts = (() => {
  const tex = (inner, outer) => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d'), g = cx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, inner); g.addColorStop(1, outer); cx.fillStyle = g; cx.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); };
  const glow = tex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), pool = [];
  for (let i = 0; i < 90; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, depthWrite: false, transparent: true })); s.visible = false; scene.add(s); pool.push({ s, life: 0, max: 1, v: new THREE.Vector3(), size: 1, grow: 0 }); }
  let k = 0;
  return {
    emit(p, n, o) { for (let i = 0; i < n; i++) { const q = pool[k = (k + 1) % pool.length]; q.s.visible = true; q.s.position.copy(p).add(tmp2.set((Math.random() - 0.5) * o.spread, (Math.random() - 0.5) * o.spread * 0.5, (Math.random() - 0.5) * o.spread));
      q.v.set((Math.random() - 0.5) * o.speed, Math.random() * o.up, (Math.random() - 0.5) * o.speed); if (o.dir) q.v.add(o.dir); q.life = q.max = o.life * (0.6 + Math.random() * 0.7); q.size = o.size * (0.6 + Math.random() * 0.8); q.grow = o.grow || 0;
      q.s.material.color.set(o.color); q.s.material.blending = o.add ? THREE.AdditiveBlending : THREE.NormalBlending; q.s.material.fog = !o.add; q.a = o.alpha || 1; } },
    update(dt) { for (const q of pool) if (q.life > 0) { q.life -= dt; if (q.life <= 0) { q.s.visible = false; continue; } q.s.position.addScaledVector(q.v, dt); q.v.multiplyScalar(1 - 1.5 * dt);
      const f = q.life / q.max, sz = q.size * (1 + q.grow * (1 - f)); q.s.scale.set(sz, sz, 1); q.s.material.opacity = f * q.a; } },
  };
})();
const GLOW = { color: 0xd6ff4a, add: true, spread: 0.5, speed: 3, up: 2.5, life: 0.6, size: 0.35 };
const DUST = { color: 0xc9987c, add: false, spread: 0.35, speed: 1.4, up: 0.9, life: 0.7, size: 0.5, grow: 1.6, alpha: 0.5 };

// scan beams over the crystals that are still out there
const beams = crystals.map(c => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 70, 8, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.35), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); m.position.set(c.x, c.y + 35, c.z); m.visible = false; scene.add(m); return m; });
const lamp = new THREE.SpotLight(0xcffff0, 0, 46, 0.5, 0.7, 1.2); scene.add(lamp, lamp.target);

// ---------------------------------------------------------------- HUD
let toastT = 0;
function toast(msg, sec = 2.6) { $('toast').textContent = msg; $('toast').classList.add('on'); toastT = sec; }
function hud() {
  $('count').textContent = `${G.got} / ${G.total}`;
  $('energy').hidden = !G.riding; $('bar').style.width = Math.max(0, G.energy) + '%'; $('bar').classList.toggle('low', G.energy < 30);
  $('rideBtn').innerHTML = (G.riding ? '下舟步行' : '变成叶舟') + '<small>E</small>'; $('lampBtn').classList.toggle('on', G.lamp);
}

// ---------------------------------------------------------------- actions
function overLava(x, z, y) { return height(x, z) < 0.25 && groundAt(x, z, y) < 0.3; }
function mount() {
  if (G.dead > 0 || !actors) return;
  if (!G.riding) { G.riding = true; G.morph = 0; G.vy = 0; parts.emit(G.pos, 16, GLOW); toast('萤变成了叶舟：可以飞越熔岩，留意能量'); }
  else { if (overLava(G.pos.x, G.pos.z, G.pos.y)) { toast('下面是熔岩，先回到岸上'); return; } dismount(); }
  hud();
}
function dismount() {
  if (!G.riding) return; G.riding = false; G.morph = 0; scene.attach(hero.root); G.pos.y = Math.max(groundAt(G.pos.x, G.pos.z, G.pos.y + 1), G.pos.y - 0.55);
  hero.root.rotation.set(0, G.heading, 0); dronePos.copy(G.pos).y += 0.6; parts.emit(G.pos, 14, GLOW); hud();
}
function toggleLamp() { G.lamp = !G.lamp; toast(G.lamp ? '探照灯：开' : '探照灯：关', 1.2); hud(); }
function scan() { const left = G.total - G.got; G.scan = 7; toast(left ? `扫描：还有 ${left} 颗余烬晶，光柱会亮 7 秒` : '扫描：余烬晶已经全部找到'); }
function ring(show) { $('ring').classList.toggle('on', show ?? !$('ring').classList.contains('on')); }
function burn() { if (G.dead > 0) return; G.dead = 1.0; G.vel.set(0, 0, 0); parts.emit(G.pos, 22, { ...GLOW, color: 0xff7a2a, up: 5, size: 0.5 }); toast('掉进熔岩了，回到上一个安全点'); }
function respawn() { if (G.riding) dismount(); G.pos.copy(G.safe); G.vel.set(0, 0, 0); G.vy = 0; G.energy = 100; dronePos.copy(G.pos).y += 1.5; hero.root.visible = true; }

addEventListener('keydown', e => {
  if (e.repeat) return; G.keys[e.code] = true;
  if (!G.started) return;
  if (e.code === 'KeyE') mount(); else if (e.code === 'KeyF') toggleLamp(); else if (e.code === 'KeyC') scan(); else if (e.code === 'KeyQ') ring(); else if (e.code === 'KeyR') { G.dead = 0.01; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { G.keys[e.code] = false; });
addEventListener('blur', () => { G.keys = {}; });
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (!drag) return; G.yaw -= (e.clientX - drag.x) * 0.005; G.pitch = THREE.MathUtils.clamp(G.pitch + (e.clientY - drag.y) * 0.004, -0.12, 1.25); drag.x = e.clientX; drag.y = e.clientY; });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', e => { G.dist = THREE.MathUtils.clamp(G.dist * (1 + Math.sign(e.deltaY) * 0.1), 3, 16); e.preventDefault(); }, { passive: false });
$('rideBtn').onclick = () => { mount(); ring(false); }; $('lampBtn').onclick = () => { toggleLamp(); ring(false); }; $('scanBtn').onclick = () => { scan(); ring(false); };
$('go').onclick = () => { G.started = true; $('start').classList.add('off'); canvas.focus(); toast('收集 10 颗余烬晶，点亮台地上的信标', 4); };

// ---------------------------------------------------------------- one step of the game
function step(dt) {
  G.t += dt; const k = G.keys;
  if (G.dead > 0) { G.dead -= dt; G.pos.y -= dt * 0.6; if (G.dead <= 0) { G.dead = 0; respawn(); } }
  else {
    // camera keys
    G.yaw += ((k.ArrowLeft ? 1 : 0) - (k.ArrowRight ? 1 : 0)) * 1.9 * dt; G.pitch = THREE.MathUtils.clamp(G.pitch + ((k.ArrowUp ? 1 : 0) - (k.ArrowDown ? 1 : 0)) * 1.0 * dt, -0.12, 1.25);
    // wish direction, relative to the camera
    const ix = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), iz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), fx = -Math.sin(G.yaw), fz = -Math.cos(G.yaw);
    let mx = fx * iz - fz * ix, mz = fz * iz + fx * ix; const ml = Math.hypot(mx, mz); if (ml > 0) { mx /= ml; mz /= ml; }
    const fast = k.ShiftLeft || k.ShiftRight, top = G.riding ? (fast ? 14 : 9.5) : (fast ? 6.0 : 3.6);
    const grip = G.riding ? 2.6 : (G.grounded ? 11 : 2.5);
    G.vel.x = damp(G.vel.x, mx * top, grip, dt); G.vel.z = damp(G.vel.z, mz * top, grip, dt);
    const prevH = G.heading; if (ml > 0) G.heading = angDamp(G.heading, Math.atan2(mx, mz), G.riding ? 4.5 : 12, dt); G.turn = ((G.heading - prevH + Math.PI * 3) % (Math.PI * 2) - Math.PI) / Math.max(dt, 1e-4);
    let nx = G.pos.x + G.vel.x * dt, nz = G.pos.z + G.vel.z * dt;
    // steep ground stops you going up it
    const g = slope(nx, nz), gl = Math.hypot(g.gx, g.gz);
    if (gl > (G.riding ? 1.5 : 1.15) && height(nx, nz) > G.pos.y - 0.4) { const up = (G.vel.x * g.gx + G.vel.z * g.gz) / gl; if (up > 0) { G.vel.x -= g.gx / gl * up; G.vel.z -= g.gz / gl * up; nx = G.pos.x + G.vel.x * dt; nz = G.pos.z + G.vel.z * dt; } }
    // solid things and the sides of columns
    const rad = G.riding ? 0.55 : 0.32;
    for (const c of colliders) { const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz), R = c.r + rad; if (d < R && d > 1e-4) { nx = c.x + dx / d * R; nz = c.z + dz / d * R; } }
    for (const p of platforms) { if (G.pos.y >= p.top - 0.45) continue; const dx = nx - p.x, dz = nz - p.z, d = Math.hypot(dx, dz), R = p.r / 0.92 + rad; if (d < R && d > 1e-4) { nx = p.x + dx / d * R; nz = p.z + dz / d * R; } }
    const moved = Math.hypot(nx - G.pos.x, nz - G.pos.z); G.speed = moved / Math.max(dt, 1e-4); G.stepDist = moved;
    G.pos.x = nx; G.pos.z = nz;
    const gy = groundAt(nx, nz, G.pos.y);
    if (G.riding) {
      G.pos.y = damp(G.pos.y, Math.max(gy, LAVA_Y) + 0.55, 7, dt); G.grounded = true;
      const lavaBelow = overLava(nx, nz, G.pos.y);
      G.energy = THREE.MathUtils.clamp(G.energy + (lavaBelow ? -(fast ? 15 : 8.5) : 34) * dt, 0, 100);
      if (G.energy <= 0) { toast(lavaBelow ? '叶舟没能量了！' : '叶舟没能量了，歇一会儿'); dismount(); }
      if (G.speed > 2 && Math.random() < dt * 30) parts.emit(tmp.set(nx - Math.sin(G.heading) * 1.05, G.pos.y + 0.05, nz - Math.cos(G.heading) * 1.05), 1, { ...GLOW, speed: 0.6, up: 0.3, life: 0.5, size: 0.3 });
    } else {
      const wasAir = !G.grounded;
      G.vy -= 22 * dt; G.pos.y += G.vy * dt;
      if (G.pos.y <= gy) { G.pos.y = gy; if (wasAir && G.vy < -4) parts.emit(G.pos, 6, DUST); G.vy = 0; G.grounded = true; } else G.grounded = G.pos.y - gy < 0.06;
      if (k.Space && G.grounded) { G.vy = 7.2; G.grounded = false; parts.emit(G.pos, 5, DUST); parts.emit(tmp.copy(G.pos).setY(G.pos.y + 0.4), 4, { ...GLOW, color: 0xffb060, size: 0.22, life: 0.35 }); }
      if (G.pos.y < LAVA_Y + 0.12 && height(nx, nz) < 0.1) burn();
      else if (G.grounded && G.pos.y > 1.0 && Math.floor(G.t * 2) !== Math.floor((G.t - dt) * 2)) G.safe.copy(G.pos);
    }
    // pickups
    for (let i = 0; i < crystals.length; i++) { const c = crystals[i]; if (c.taken) continue;
      if (tmp.set(c.x, c.mesh.position.y, c.z).distanceTo(tmp2.copy(G.pos).setY(G.pos.y + 0.6)) < (G.riding ? 2.5 : 1.8)) { c.taken = true; c.mesh.visible = false; beams[i].visible = false; G.got++;
        parts.emit(tmp, 18, { ...GLOW, color: 0xffb050, size: 0.4 });
        if (G.got === G.total) { world.beacon.lit = true; G.done = true; toast('全部找到了！台地上的信标亮了', 6); $('done').classList.add('on'); } else toast(`余烬晶 ${G.got} / ${G.total}`, 1.6); hud(); } }
  }
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('on');
  if (G.scan > 0) { G.scan -= dt; const a = Math.min(1, G.scan, (7 - G.scan) * 3) * (0.5 + 0.2 * Math.sin(G.t * 6)); beams.forEach((b, i) => { b.visible = !crystals[i].taken && G.scan > 0; b.material.opacity = Math.max(0, a); }); }
  parts.update(dt); world.update(G.t);
  pose(dt);
}

// place the models and the camera for the current state
function pose(dt) {
  if (!actors) return;
  G.morph = Math.min(1, G.morph + dt * 3.2); const pop = 0.25 + 0.75 * (1 - Math.pow(1 - G.morph, 3));
  if (G.riding) {
    skiff.root.visible = true; drone.root.visible = false; skiff.root.position.copy(G.pos); skiff.root.rotation.y = G.heading; skiff.model.scale.setScalar(1.12 * pop);
    if (hero.root.parent !== skiff.tilt) { skiff.tilt.add(hero.root); hero.root.position.set(0, 0.07, -0.2); hero.root.rotation.set(0, 0, 0); }
    skiff.update(dt, G.turn, Math.min(G.speed / 9.5, 1.4));
  } else {
    skiff.root.visible = false; drone.root.visible = true; if (hero.root.parent !== scene) scene.attach(hero.root);
    hero.root.position.copy(G.pos); hero.root.rotation.set(0, G.heading, 0);
    // 萤 hovers over the hero's left shoulder and trails a little behind
    const s = Math.sin(G.heading), c = Math.cos(G.heading);
    target.set(G.pos.x + c * 0.95 - s * 0.55, G.pos.y + 1.75 + Math.sin(G.t * 2.3) * 0.09, G.pos.z - s * 0.95 - c * 0.55);
    dronePos.x = damp(dronePos.x, target.x, 5, dt); dronePos.y = damp(dronePos.y, target.y, 5, dt); dronePos.z = damp(dronePos.z, target.z, 5, dt);
    drone.root.position.copy(dronePos); drone.root.rotation.y = angDamp(drone.root.rotation.y, G.heading, 4, dt); drone.root.scale.setScalar(pop); drone.update(dt);
  }
  hero.root.visible = G.dead <= 0 || G.dead > 0.55;
  hero.update(dt, { speed: G.speed, grounded: G.grounded, vy: G.vy, riding: G.riding, dist: G.stepDist || 0 });
  // headlight from 萤's eye
  const src = G.riding ? tmp.set(G.pos.x + Math.sin(G.heading) * 0.9, G.pos.y + 0.4, G.pos.z + Math.cos(G.heading) * 0.9) : dronePos;
  lamp.position.copy(src); lamp.target.position.set(src.x + Math.sin(G.heading) * 10, src.y - 2.2, src.z + Math.cos(G.heading) * 10); lamp.intensity = damp(lamp.intensity, G.lamp ? 420 : 0, 8, dt);
  // camera
  const d = damp(camera.userData.d || G.dist, G.dist * (G.riding ? 1.3 : 1), 4, dt); camera.userData.d = d;
  target.set(G.pos.x, G.pos.y + 1.25, G.pos.z);
  camera.position.set(target.x + Math.sin(G.yaw) * Math.cos(G.pitch) * d, target.y + Math.sin(G.pitch) * d, target.z + Math.cos(G.yaw) * Math.cos(G.pitch) * d);
  const floor = Math.max(height(camera.position.x, camera.position.z), LAVA_Y) + 0.45; if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(target);
  sun.target.position.copy(G.pos); sun.position.copy(G.pos).addScaledVector(SUN, 190);
  sky.position.copy(camera.position); lava.position.x = camera.position.x; lava.position.z = camera.position.z;
  sky.material.uniforms.uTime.value = G.t; lava.material.uniforms.uTime.value = G.t;
  post.mOut.uniforms.flash.value = G.dead > 0 ? Math.max(0, (G.dead - 0.6) * 1.6) * 0.5 : 0;
}

function draw() { post.render(scene, camera, null); }
function resize() { const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); post.resize(); }
addEventListener('resize', resize);

// ---------------------------------------------------------------- test handle
G.api = {
  step(n = 1, keys = null, dt = 1 / 60) { const old = G.keys; if (keys) G.keys = keys; for (let i = 0; i < n; i++) step(dt); G.keys = old; draw(); return { x: +G.pos.x.toFixed(2), y: +G.pos.y.toFixed(2), z: +G.pos.z.toFixed(2), riding: G.riding, energy: Math.round(G.energy), got: G.got, dead: G.dead > 0 }; },
  tp(x, z, yaw) { G.dead = 0; if (G.riding) dismount(); hero.root.visible = true; G.pos.set(x, groundAt(x, z, 99), z); G.vel.set(0, 0, 0); G.vy = 0; G.safe.copy(G.pos); dronePos.copy(G.pos).y += 1.6; if (yaw !== undefined) G.yaw = yaw; step(0.016); draw(); return G.pos.toArray().map(v => +v.toFixed(2)); },
  view(yaw, pitch, dist) { G.yaw = yaw; if (pitch !== undefined) G.pitch = pitch; if (dist) { G.dist = dist; camera.userData.d = dist * (G.riding ? 1.3 : 1); } step(0); draw(); },
  mount, scan, toggleLamp,
  // eight phases of one state, side by side, for checking a motion cycle: kind = walk | run | jump | ride | idle
  sheet(kind = 'walk', yaw = 2.2) {
    let cv = $('sheet'); if (!cv) { cv = document.createElement('canvas'); cv.id = 'sheet'; cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99;width:100%;height:100%;object-fit:contain;background:#111'; document.body.appendChild(cv); }
    const W = 400, H = 400; cv.width = W * 4; cv.height = H * 2; const cx = cv.getContext('2d'), keep = { yaw: G.yaw, pitch: G.pitch, dist: G.dist };
    if ((kind === 'ride') !== G.riding) mount(); G.morph = 1;
    for (let i = 0; i < 8; i++) {
      const sp = kind === 'run' ? 6 : kind === 'walk' ? 3.6 : kind === 'ride' ? 9 : 0;
      hero.phase = i / 8 * Math.PI * 2; hero.amp = sp ? 1 : 0; hero.air = kind === 'jump' ? 1 : 0; hero.ride = kind === 'ride' ? 1 : 0; hero.flap = sp / 7; hero.t = i * 0.35; hero.blink = kind === 'idle' && i === 5 ? -0.05 : 2;
      G.speed = sp; G.stepDist = 0; G.grounded = kind !== 'jump'; G.yaw = yaw + (kind === 'idle' ? i * 0.785 : 0); G.pitch = 0.16; camera.userData.d = G.dist = kind === 'ride' ? 3.6 : 2.4;
      if (G.riding) { skiff.t = i * 0.4; G.turn = (i - 3.5) * 0.4; } else { drone.t = i * 0.019; }
      pose(0); draw(); const sw = canvas.width, sh = canvas.height, cs = sh * (kind === 'ride' ? 0.8 : 0.62); cx.drawImage(canvas, (sw - cs) / 2, Math.min(sh - cs, sh * (kind === 'ride' ? 0.56 : 0.68) - cs * 0.5), cs, cs, (i % 4) * W, Math.floor(i / 4) * H, W, H);
    }
    Object.assign(G, keep); return kind;
  },
  noSheet() { const cv = $('sheet'); if (cv) cv.remove(); if (G.riding) dismount(); step(0.016); draw(); },
};

// ---------------------------------------------------------------- go
resize();
loadActors().then(a => {
  actors = a; ({ hero, drone, skiff } = a); scene.add(hero.root, drone.root, skiff.root); dronePos.copy(G.pos).y += 1.7; hud(); step(0.016); draw();
  $('loading').remove(); $('go').disabled = false; G.ready = true;
  let last = performance.now(), acc = 0, n = 0;
  const loop = now => { const dt = Math.min((now - last) / 1000, 0.05); last = now; if (!$('sheet')) { step(G.started ? dt : 0.0001); draw(); } acc += dt; if (++n === 30) { G.fps = Math.round(30 / acc); acc = 0; n = 0; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}).catch(e => { $('loading').textContent = '模型加载失败：' + e.message; console.error(e); });
