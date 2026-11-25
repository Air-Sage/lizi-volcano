// The volcanic island: one height function, the terrain mesh, rocks, columns, arches, crystals, plants, lander, beacon.
// +X is east, -Z is north, lava lies at y = 0. Everything walkable is defined here, so physics asks this file.
import * as THREE from 'three';
import { SUN, FOG_COLOR, SUN_FOG } from './gfx.js';

export const LAVA_Y = 0;
export const START = { x: 0, z: 62 };
export const CRATER = { x: -58, z: -48 };
export const MESA = { x: 58, z: -52 };

// ---------------------------------------------------------------- noise
function h2(ix, iz) { let n = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function vn(x, z) { const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = h2(ix, iz), b = h2(ix + 1, iz), c = h2(ix, iz + 1), d = h2(ix + 1, iz + 1); return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz; }
export function fbm(x, z, oct = 4) { let a = 0.5, s = 0, n = 0; for (let i = 0; i < oct; i++) { s += a * vn(x, z); n += a; x = x * 2.03 + 17.1; z = z * 2.03 + 9.2; a *= 0.5; } return s / n; }
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function seg(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz))); return { d: Math.hypot(px - ax - dx * t, pz - az - dz * t), t }; }
let seed = 20261126; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

export const riverZ = x => 20 + 10 * Math.sin(x / 28);
const BRIDGE_X = 46;

// ---------------------------------------------------------------- the ground
export function height(x, z) {
  let h = 3.4 + (fbm(x * 0.018 + 3.1, z * 0.018 - 1.7) - 0.5) * 7.0 + (fbm(x * 0.07, z * 0.07, 3) - 0.5) * 1.0;
  h = Math.max(h, 1.5);
  h = mix(h, 3.2, 1 - ss(9, 16, Math.hypot(x - START.x, z - START.z)));                 // landing shelf
  // the mesa in the north-east and the ramp that climbs it
  const em = Math.hypot((x - MESA.x) / 27, (z - MESA.z) / 23) + (fbm(x * 0.05 + 9, z * 0.05, 3) - 0.5) * 0.18;
  h = mix(h, 15.0 + (fbm(x * 0.06, z * 0.06 + 5, 3) - 0.5) * 1.6, 1 - ss(0.80, 1.02, em));
  const r = seg(x, z, 26, -18, 44, -41);
  h = mix(h, mix(3.6, 15.0, ss(0.05, 0.95, r.t)), 1 - ss(3.2, 6.0, r.d));
  // the crater: rim, lava lake, islet, and a low gate with a gentle shore on its east side
  const dc = Math.hypot(x - CRATER.x, z - CRATER.z), east = Math.exp(-((Math.atan2(z - CRATER.z, x - CRATER.x) / 0.55) ** 2));
  h += 3.2 * (1 - 0.9 * east) * Math.exp(-(((dc - 31) / 5.5) ** 2));
  h = mix(h, -3.0, 1 - ss(mix(21, 11, east), 28, dc));
  h = mix(h, 1.8, 1 - ss(2.5, 9.0, dc));
  // the lava river, left uncut where the rock bridge stands
  const carve = (1 - ss(4.2, 8.8, Math.abs(z - riverZ(x)))) * ss(5.5, 11, Math.abs(x - BRIDGE_X));
  h = mix(h, -2.6, carve);
  // the coast
  const d = Math.hypot(x, z) + (fbm(x * 0.03 + 20, z * 0.03 + 7, 3) - 0.5) * 26;
  return mix(h, -5.0, ss(112, 138, d));
}
export function slope(x, z) { const e = 0.6; return { gx: (height(x + e, z) - height(x - e, z)) / (2 * e), gz: (height(x, z + e) - height(x, z - e)) / (2 * e) }; }

export const platforms = [];   // { x, z, r, top }   things you can stand on
export const colliders = [];   // { x, z, r }        solid things you walk around
export const crystals = [];    // { x, y, z, mesh, taken }

// highest surface under a point for something whose feet are at y
export function groundAt(x, z, y) {
  let h = height(x, z);
  for (const p of platforms) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < p.r * p.r && y >= p.top - 0.45 && p.top > h) h = p.top; }
  return h;
}

function fogTint(dir) { return FOG_COLOR.clone().lerp(SUN_FOG, Math.pow(Math.max(dir.dot(SUN), 0), 5) * 0.85); }

// ---------------------------------------------------------------- build
export function buildWorld(scene, grit) {
  const anim = [];
  const C = hex => new THREE.Color(hex);
  const shadow = m => { m.castShadow = true; m.receiveShadow = true; return m; };

  // terrain
  { const SIZE = 300, N = 300, g = new THREE.PlaneGeometry(SIZE, SIZE, N, N).rotateX(-Math.PI / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, height(x, z)); uv.setXY(i, x / 3.4, z / 3.4); }
    g.computeVertexNormals();
    const n = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
    const ash = C('#a9735b'), patch = C('#d6a07c'), rock = C('#7a4a3b'), scorch = C('#3a221d'), glow = C('#ff6a1e'), top = C('#96685a');
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), s = 1 - n.getY(i);
      c.copy(ash).lerp(patch, ss(0.545, 0.575, fbm(x * 0.055 + 40, z * 0.055 + 11, 3)) * 0.85);
      c.lerp(top, ss(9, 13, y) * 0.6);
      c.lerp(rock, ss(0.14, 0.34, s));
      c.lerp(scorch, (1 - ss(0.3, 2.4, y)) * 0.9);
      const k = (1 - ss(-0.2, 1.1, y)) * 0.55; c.r += glow.r * k; c.g += glow.g * k; c.b += glow.b * k;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: grit.color, normalMap: grit.normal, normalScale: new THREE.Vector2(1.15, 1.15), roughness: 0.97 }));
    scene.add(shadow(m)); }

  // low-poly rock, jittered by position so shared corners stay together
  const rockGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.78 + 0.5 * h2(Math.round(x * 97), Math.round(y * 89 + z * 83)); p.setXYZ(i, x * k, y * k * 0.8, z * k); }
    g.computeVertexNormals(); return g; })();
  const rockMat = new THREE.MeshStandardMaterial({ color: C('#7b4b3d'), roughness: 0.95, flatShading: true });
  const colMat = new THREE.MeshStandardMaterial({ color: C('#6e4337'), roughness: 0.93, flatShading: true });
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const clearOf = (x, z) => Math.hypot(x - START.x, z - START.z) > 10 && seg(x, z, 26, -18, 44, -41).d > 6 && seg(x, z, -10, 30, -10, 4).d > 4.5 && Math.abs(x - BRIDGE_X) > 6;

  // scattered rocks
  { const list = [];
    for (let i = 0; i < 620 && list.length < 330; i++) { const x = (rnd() - 0.5) * 250, z = (rnd() - 0.5) * 250, h = height(x, z); if (h < 0.9 || !clearOf(x, z)) continue;
      const big = rnd() < 0.16, s = big ? 1.3 + rnd() * 1.9 : 0.22 + rnd() * 0.7; list.push({ x, z, h, s }); if (s > 1.0) colliders.push({ x, z, r: s * 0.82 }); }
    const im = new THREE.InstancedMesh(rockGeo, rockMat, list.length);
    list.forEach((r, i) => { E.set(rnd() * 0.6, rnd() * 6.3, rnd() * 0.6); Q.setFromEuler(E); M4.compose(V.set(r.x, r.h + r.s * 0.18, r.z), Q, S.set(r.s * (0.8 + rnd() * 0.5), r.s * (0.7 + rnd() * 0.5), r.s * (0.8 + rnd() * 0.5))); im.setMatrixAt(i, M4); });
    scene.add(shadow(im)); }

  // basalt spires in clusters
  { const g = new THREE.ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0), list = [];
    for (const [cx, cz, n, R] of [[-34, 44, 6, 9], [30, 40, 5, 8], [-78, 8, 7, 10], [12, -30, 6, 9], [84, 6, 6, 9], [-20, -74, 6, 10], [20, -84, 5, 8], [-96, -30, 5, 8]]) {
      for (let i = 0; i < n; i++) { const a = rnd() * 6.283, d = rnd() * R, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, h = height(x, z); if (h < 0.8 || !clearOf(x, z)) continue;
        const r = 0.8 + rnd() * 1.5, H = 4 + rnd() * 10; list.push({ x, z, h, r, H }); colliders.push({ x, z, r: r * 0.8 }); } }
    const im = new THREE.InstancedMesh(g, colMat, list.length);
    list.forEach((s, i) => { E.set((rnd() - 0.5) * 0.22, rnd() * 6.3, (rnd() - 0.5) * 0.22); Q.setFromEuler(E); M4.compose(V.set(s.x, s.h - 0.6, s.z), Q, S.set(s.r, s.H, s.r)); im.setMatrixAt(i, M4); });
    scene.add(shadow(im)); }

  // hexagonal columns: stepping stones over the river, stacks in the crater lake, sea stacks off the coast
  { const g = new THREE.CylinderGeometry(1, 1.07, 1, 6, 1).translate(0, -0.5, 0), list = [];
    const put = (x, z, r, top, stand = true) => { list.push({ x, z, r, top }); if (stand) platforms.push({ x, z, r: r * 0.92, top }); else colliders.push({ x, z, r: r * 0.9 }); };
    { const zs = [24.8, 21.93, 19.07, 16.2, 13.33, 10.47, 7.6], xs = [-10.2, -9.8, -10.25, -9.75, -10.2, -9.8, -10.1], hS = height(-10, 27.6), hN = height(-10, 5.2);
      zs.forEach((z, i) => put(xs[i], z, 1.5, mix(hS, hN, (i + 0.5) / zs.length) - 0.12)); }
    for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283 + rnd() * 0.3, d = 10 + rnd() * 12, x = CRATER.x + Math.cos(a) * d, z = CRATER.z + Math.sin(a) * d; if (height(x, z) > -1) continue;
      const tall = rnd() < 0.5; put(x, z, 1.1 + rnd() * 0.9, tall ? 3 + rnd() * 5 : 0.7 + rnd() * 0.5, !tall); }
    put(-70, -37, 1.9, 0.8);                                                          // a low stack that carries a crystal
    for (let i = 0; i < 26; i++) { const a = rnd() * 6.283, d = 142 + rnd() * 70; put(Math.cos(a) * d, Math.sin(a) * d, 1.5 + rnd() * 3, 2 + rnd() * 13, false); }
    const im = new THREE.InstancedMesh(g, colMat, list.length);
    list.forEach((c, i) => { Q.setFromEuler(E.set(0, rnd() * 1.05, 0)); M4.compose(V.set(c.x, c.top, c.z), Q, S.set(c.r, c.top + 6, c.r)); im.setMatrixAt(i, M4); });
    scene.add(shadow(im)); }

  // rock arches over the path
  for (const [x, z, ry] of [[-10, 0, 0], [-25, -46, Math.PI / 2], [34.1, -28.35, -0.664]]) {
    const a = shadow(new THREE.Mesh(new THREE.TorusGeometry(6.2, 1.5, 5, 9, Math.PI), colMat));
    a.position.set(x, height(x, z) - 0.8, z); a.rotation.y = ry; a.scale.set(1, 1.15, 1.25); scene.add(a);
    for (const s of [-1, 1]) colliders.push({ x: x + Math.cos(ry) * 6.2 * s, z: z - Math.sin(ry) * 6.2 * s, r: 1.7 });
  }

  // crystals to collect
  { const g = new THREE.OctahedronGeometry(1, 0), mat = new THREE.MeshStandardMaterial({ color: C('#ffd98a'), emissive: C('#ff8a2c'), emissiveIntensity: 2.4, roughness: 0.25, flatShading: true });
    const halo = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d'), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,200,120,0.9)'); gr.addColorStop(0.4, 'rgba(255,150,60,0.28)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
    const hm = new THREE.SpriteMaterial({ map: halo, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8 });
    const spots = [[7, 51, 0], [-9.75, 16.2, 0], [-18, -6, 0], [18, -10, 0], [BRIDGE_X, riverZ(BRIDGE_X), 0], [-33, -30, 0], [CRATER.x, CRATER.z, 0], [-70, -37, 0.8], [36, -30.5, 0], [62, -56, 0]];
    for (const [x, z, plat] of spots) { const y = Math.max(groundAt(x, z, 99), plat) + 1.0, grp = new THREE.Group();
      const m = new THREE.Mesh(g, mat); m.scale.set(0.3, 0.55, 0.3); m.castShadow = true; grp.add(m);
      const sp = new THREE.Sprite(hm); sp.scale.set(2.6, 2.6, 1); grp.add(sp);
      grp.position.set(x, y, z); scene.add(grp); crystals.push({ x, y, z, mesh: grp, taken: false, ph: rnd() * 6 }); }
    anim.push(t => { for (const c of crystals) if (!c.taken) { c.mesh.rotation.y = t * 1.2 + c.ph; c.mesh.position.y = c.y + Math.sin(t * 1.7 + c.ph) * 0.12; } }); }

  // lantern reeds: thin stalks with a glowing teal bulb, in clumps
  { const sg = new THREE.CylinderGeometry(0.018, 0.03, 1, 5).translate(0, 0.5, 0), bg = new THREE.SphereGeometry(0.1, 8, 6), list = [];
    for (let k = 0; k < 26; k++) { const cx = (rnd() - 0.5) * 200, cz = (rnd() - 0.5) * 200; if (height(cx, cz) < 1.6 || !clearOf(cx, cz)) continue;
      for (let i = 0, n = 4 + Math.floor(rnd() * 6); i < n; i++) { const x = cx + (rnd() - 0.5) * 3.4, z = cz + (rnd() - 0.5) * 3.4, h = height(x, z); if (h > 1.2) list.push({ x, z, h, H: 0.55 + rnd() * 0.95, a: rnd() * 6.3, lean: rnd() * 0.22 }); } }
    const stalks = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: C('#5b4a3e'), roughness: 0.9 }), list.length);
    const bulbs = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: C('#bfffe6'), emissive: C('#49f0c0'), emissiveIntensity: 2.2, roughness: 0.4 }), list.length);
    list.forEach((r, i) => { Q.setFromEuler(E.set(Math.cos(r.a) * r.lean, 0, Math.sin(r.a) * r.lean)); M4.compose(V.set(r.x, r.h - 0.05, r.z), Q, S.set(1, r.H, 1)); stalks.setMatrixAt(i, M4);
      const tip = new THREE.Vector3(0, r.H, 0).applyQuaternion(Q); M4.compose(V.set(r.x + tip.x, r.h - 0.05 + tip.y, r.z + tip.z), Q, S.set(1, 1.25, 1)); bulbs.setMatrixAt(i, M4); });
    stalks.castShadow = true; scene.add(stalks, bulbs); }

  // fumaroles: small vents with drifting smoke
  { const smoke = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d'), gr = cx.createRadialGradient(32, 32, 2, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,225,200,0.5)'); gr.addColorStop(1, 'rgba(255,200,170,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
    const vg = new THREE.CylinderGeometry(0.45, 0.95, 0.55, 7, 1, true), vm = new THREE.MeshStandardMaterial({ color: C('#4a2c25'), roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const puffs = [];
    for (const [x, z] of [[16, 30], [-28, -2], [22, -6], [-44, 22], [70, -18], [-8, -44], [48, 50], [-60, -8], [66, -44]]) { const h = height(x, z); if (h < 1) continue;
      const v = shadow(new THREE.Mesh(vg, vm)); v.position.set(x, h + 0.2, z); scene.add(v);
      for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke, depthWrite: false, transparent: true })); scene.add(s); puffs.push({ s, x, z, h, ph: i / 6 + rnd() * 0.1 }); } }
    anim.push(t => { for (const p of puffs) { const k = (t * 0.11 + p.ph) % 1; p.s.position.set(p.x + k * k * 3.5, p.h + 0.5 + k * 9, p.z + k * 1.2); const sc = 0.9 + k * 5.5; p.s.scale.set(sc, sc, 1); p.s.material.opacity = Math.sin(k * Math.PI) * 0.55; } }); }

  // the lander: a seed-pod capsule on three legs, with a lit porthole
  { const pod = new THREE.Group(), y0 = height(START.x, START.z + 6);
    const shell = shadow(new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.9, 0.15], [1.45, 0.9], [1.55, 1.9], [1.25, 3.0], [0.7, 3.8], [0, 4.15]].map(p => new THREE.Vector2(p[0], p[1])), 20), new THREE.MeshStandardMaterial({ color: C('#d2d8c6'), roughness: 0.55 })));
    shell.position.y = 0.9; pod.add(shell);
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.09, 8, 28), new THREE.MeshStandardMaterial({ color: C('#c4622d'), roughness: 0.6 })); band.rotation.x = Math.PI / 2; band.position.y = 2.75; pod.add(band);
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshStandardMaterial({ color: C('#fff0c0'), emissive: C('#ffc45a'), emissiveIntensity: 2.2 })); port.position.set(0, 2.55, -1.5); port.rotation.y = Math.PI; pod.add(port);
    for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283 + 0.5, leg = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.9, 6), new THREE.MeshStandardMaterial({ color: C('#3a3f47'), roughness: 0.6 })));
      leg.position.set(Math.cos(a) * 1.35, 0.75, Math.sin(a) * 1.35); leg.rotation.z = -Math.cos(a) * 0.5; leg.rotation.x = Math.sin(a) * 0.5; pod.add(leg); }
    pod.position.set(START.x - 9, y0, START.z + 5); scene.add(pod); colliders.push({ x: pod.position.x, z: pod.position.z, r: 2.0 }); }

  // the beacon on the mesa: lights up when every crystal is home
  const beacon = { lit: false };
  { const g = new THREE.Group(), x = 64, z = -58, y = height(x, z), dark = new THREE.MeshStandardMaterial({ color: C('#3a3f47'), roughness: 0.6 });
    for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283, leg = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5.2, 6), dark)); leg.position.set(Math.cos(a) * 0.9, 2.4, Math.sin(a) * 0.9); leg.rotation.z = Math.cos(a) * 0.34; leg.rotation.x = -Math.sin(a) * 0.34; g.add(leg); }
    const mast = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 8), dark)); mast.position.y = 5.6; g.add(mast);
    beacon.mat = new THREE.MeshStandardMaterial({ color: C('#6b5a50'), emissive: C('#7dffd0'), emissiveIntensity: 0, roughness: 0.4 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), beacon.mat); lamp.position.y = 7.0; g.add(lamp);
    beacon.light = new THREE.PointLight(0x7dffd0, 0, 60, 1.6); beacon.light.position.y = 7; g.add(beacon.light);
    g.position.set(x, y - 0.2, z); scene.add(g); colliders.push({ x, z, r: 1.3 }); beacon.pos = new THREE.Vector3(x, y + 7, z); }
  anim.push(t => { if (beacon.lit) { const k = 4 + Math.sin(t * 3) * 1.5; beacon.mat.emissiveIntensity = k; beacon.light.intensity = k * 40; } });

  // far volcano cones: unlit silhouettes already tinted by the haze in their direction
  { const prof = [[1, 0], [0.74, 0.2], [0.5, 0.46], [0.33, 0.72], [0.22, 0.93], [0.17, 1], [0.1, 0.9]].map(p => new THREE.Vector2(p[0], p[1]));
    for (const [a, d, r, H] of [[3.55, 560, 230, 150], [4.0, 800, 330, 210], [3.15, 930, 300, 170], [2.65, 660, 210, 105], [4.55, 640, 240, 120], [5.3, 720, 280, 160], [0.3, 780, 300, 180], [1.2, 620, 220, 115], [2.0, 850, 320, 165]]) {
      const g = new THREE.LatheGeometry(prof, 16), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.84 + 0.36 * h2(Math.round(p.getX(i) * 31 + a * 100), Math.round(p.getZ(i) * 37 + p.getY(i) * 11)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
      const dir = new THREE.Vector3(Math.cos(a), 0.05, Math.sin(a)).normalize(), col = fogTint(dir).multiplyScalar(d > 700 ? 0.8 : 0.62);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, fog: false, side: THREE.DoubleSide })); m.position.set(Math.cos(a) * d, -4, Math.sin(a) * d); m.scale.set(r, H, r); scene.add(m); }
    // ridge: a jagged wall far out, each vertex tinted for its own direction
    const NR = 220, pos = [], colr = [], idx = [], R = 1250;
    for (let i = 0; i <= NR; i++) { const a = i / NR * 6.2832, top = 26 + 120 * Math.pow(fbm(i * 0.09 + 3, 1.3, 3), 1.6) + 34 * h2(i, 7) * (i % 2);
      const dir = new THREE.Vector3(Math.cos(a), 0.03, Math.sin(a)).normalize(), c = fogTint(dir).multiplyScalar(0.9);
      pos.push(Math.cos(a) * R, -6, Math.sin(a) * R, Math.cos(a) * R, top, Math.sin(a) * R); colr.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < NR) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); rg.setIndex(idx);
    const ridge = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide })); ridge.frustumCulled = false; scene.add(ridge); }

  return { beacon, update(t) { for (const f of anim) f(t); } };
}
