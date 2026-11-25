// Look of the game: thick warm fog that glows toward a low sun, sunset sky, molten lava, bloom and light shafts.
import * as THREE from 'three';

// direction from the scene toward the sun: low in the west-north-west (about 11 degrees up)
export const SUN = new THREE.Vector3(-0.80, 0.20, -0.56).normalize();
export const FOG_COLOR = new THREE.Color().setRGB(0.60, 0.215, 0.115);     // fog looking away from the sun (linear)
export const SUN_FOG = new THREE.Color().setRGB(1.9, 1.22, 0.60);          // fog looking into the sun (linear, HDR)
const v3 = v => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
const c3 = c => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

// One fog for every material: denser near the ground, tinted by the angle to the sun.
// It replaces three's fog chunks, so built-in materials and the lava shader all get it.
export function installFog() {
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth; varying vec3 vFogView;
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z; vFogView = mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  vec3 fogW = (vec4(vFogView, 0.0) * viewMatrix).xyz;
  float fogD = length(fogW);
  vec3 fogDir = fogW / max(fogD, 1e-4);
  float fogMidY = cameraPosition.y + 0.5 * fogW.y;
  float fogH = exp(-max(fogMidY, 0.0) / 24.0);
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-pow(fogD * fogDensity, 1.35) * (0.30 + 1.35 * fogH));
  #else
    float fogFactor = smoothstep(fogNear, fogFar, fogD);
  #endif
  float fogSun = pow(max(dot(fogDir, ${v3(SUN)}), 0.0), 5.0);
  vec3 fogCol = mix(fogColor, ${c3(SUN_FOG)}, fogSun * 0.85);
  #ifndef FOG_SCALE
    #define FOG_SCALE 1.0
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogFactor * FOG_SCALE, 0.0, 1.0));
#endif`;
}

const NOISE = `
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x), mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
`;

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uFog: { value: FOG_COLOR }, uSunFog: { value: SUN_FOG }, uSun: { value: SUN } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform float uTime; uniform vec3 uFog, uSunFog, uSun; ${NOISE}
    void main(){
      vec3 d = normalize(vDir);
      float s = max(dot(d, uSun), 0.0);
      vec3 horizon = mix(uFog, uSunFog, pow(s, 5.0) * 0.85);
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(horizon, vec3(0.46, 0.085, 0.055), smoothstep(0.0, 0.30, h));
      col = mix(col, vec3(0.13, 0.028, 0.065), smoothstep(0.22, 0.9, h));
      // wispy clouds, lit where they are near the sun
      vec2 uv = d.xz / (d.y + 0.16);
      float c = fbm(uv * vec2(0.55, 1.25) + vec2(uTime * 0.004, 3.7));
      c = smoothstep(0.50, 0.74, c) * smoothstep(0.03, 0.22, d.y);
      float c2 = fbm(uv * vec2(1.6, 3.4) + vec2(9.0 - uTime * 0.006, 1.0));
      c *= 0.55 + 0.6 * c2;
      vec3 cloud = mix(vec3(0.50, 0.13, 0.085), uSunFog * 0.85, clamp(pow(s, 2.5) * 0.9 + 0.12, 0.0, 1.0));
      col = mix(col, cloud, clamp(c, 0.0, 1.0) * 0.8);
      // the sun: wide glow, tight glow, disc
      col += uSunFog * (pow(s, 30.0) * 0.5 + pow(s, 250.0) * 1.2 + smoothstep(0.9995, 0.9998, s) * 9.0);
      if (d.y < 0.0) col = horizon;
      gl_FragColor = vec4(col, 1.0);
    }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}

export function makeLava(size) {
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: `#include <common>
    #include <fog_pars_vertex>
    varying vec3 vW;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
    fragmentShader: `#define FOG_SCALE 0.62
    #include <common>
    #include <fog_pars_fragment>
    varying vec3 vW; uniform float uTime; ${NOISE}
    void main(){
      vec2 p = vW.xz * 0.055; float t = uTime * 0.025;
      float n1 = fbm(p + vec2(t, t * 0.6));
      float n2 = fbm(p * 2.2 - vec2(t * 1.3, -t) + n1 * 1.5);
      float crust = smoothstep(0.41, 0.57, n2);
      float crack = 1.0 - smoothstep(0.0, 0.07, abs(n2 - 0.47));
      vec3 hot = vec3(1.75, 0.50, 0.05), warm = vec3(0.95, 0.125, 0.018), dark = vec3(0.10, 0.015, 0.009);
      vec3 col = mix(mix(hot, warm, smoothstep(0.22, 0.44, n2)), dark, crust);
      col += hot * crack * 0.45;
      gl_FragColor = vec4(col, 1.0);
      #include <fog_fragment>
    }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2), mat);
  return mesh;
}

// Fine grit for the ground: a tiling colour map and a normal map made from the same height field.
export function makeGrit(size = 256) {
  const H = new Float32Array(size * size);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const layer = (cells, amp) => {
    const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rnd();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / size * cells, fy = y / size * cells, ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = g[(iy % cells) * cells + ix % cells], b = g[(iy % cells) * cells + (ix + 1) % cells];
      const c = g[((iy + 1) % cells) * cells + ix % cells], d = g[((iy + 1) % cells) * cells + (ix + 1) % cells];
      H[y * size + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
    }
  };
  layer(8, 0.30); layer(20, 0.28); layer(48, 0.24); layer(110, 0.18);
  for (let i = 0; i < 2600; i++) {                       // pebbles and pits
    const x = Math.floor(rnd() * size), y = Math.floor(rnd() * size), r = 1 + Math.floor(rnd() * 2.2), up = rnd() < 0.6 ? 0.35 : -0.3;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const q = dx * dx + dy * dy; if (q <= r * r) H[((y + dy + size) % size) * size + (x + dx + size) % size] += up * (1 - q / (r * r + 1)); }
  }
  const mk = fill => { const cv = document.createElement('canvas'); cv.width = cv.height = size; const cx = cv.getContext('2d'); const im = cx.createImageData(size, size); fill(im.data); cx.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  const at = (x, y) => H[((y + size) % size) * size + (x + size) % size];
  const color = mk(d => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const v = Math.max(0, Math.min(1, 0.62 + (at(x, y) - 0.5) * 0.62)) * 255, i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } });
  color.colorSpace = THREE.SRGBColorSpace;
  const normal = mk(d => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 2.6, dy = (at(x, y + 1) - at(x, y - 1)) * 2.6, l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (-dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255; } });
  return { color, normal };
}

// Post chain: scene (HDR) -> bloom from the bright parts, light shafts from the sky around the sun, tone map and grade.
export class Post {
  constructor(renderer) {
    this.r = renderer; this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.sceneQ = new THREE.Scene(); this.sceneQ.add(this.quad);
    const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    const M = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    this.mBright = M(`varying vec2 vUv; uniform sampler2D t; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = dot(c, vec3(0.3, 0.59, 0.11));
      gl_FragColor = vec4(c * smoothstep(0.85, 1.7, l), 1.0); }`, { t: { value: null } });
    this.mBlur = M(`varying vec2 vUv; uniform sampler2D t; uniform vec2 d; void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227;
      c += (texture2D(t, vUv + d * 1.385).rgb + texture2D(t, vUv - d * 1.385).rgb) * 0.316;
      c += (texture2D(t, vUv + d * 3.231).rgb + texture2D(t, vUv - d * 3.231).rgb) * 0.070; gl_FragColor = vec4(c, 1.0); }`, { t: { value: null }, d: { value: new THREE.Vector2() } });
    this.mRays = M(`varying vec2 vUv; uniform sampler2D t, tDepth; uniform vec2 sun; uniform float amt;
      void main(){ vec2 uv = vUv; vec2 stp = (sun - uv) / 44.0 * 0.92; float w = 1.0; vec3 acc = vec3(0.0);
        for (int i = 0; i < 44; i++){ uv += stp; if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
          float sky = step(0.99999, texture2D(tDepth, uv).r); acc += min(texture2D(t, uv).rgb, vec3(6.0)) * sky * w; w *= 0.962; }
        gl_FragColor = vec4(acc / 44.0 * amt, 1.0); }`, { t: { value: null }, tDepth: { value: null }, sun: { value: new THREE.Vector2(0.5, 0.5) }, amt: { value: 0 } });
    this.mOut = M(`varying vec2 vUv; uniform sampler2D t, b1, b2, rays; uniform float flash; uniform vec3 flashCol;
      void main(){ vec3 c = texture2D(t, vUv).rgb; c += texture2D(b1, vUv).rgb * 0.50 + texture2D(b2, vUv).rgb * 0.55; c += texture2D(rays, vUv).rgb * 0.85;
        c = mix(c, flashCol, flash);
        c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
        float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, 0.93) * vec3(1.03, 0.99, 0.95);
        c *= 1.0 - 0.28 * pow(length(vUv - 0.5) * 1.25, 2.4);
        gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0); }`,
      { t: { value: null }, b1: { value: null }, b2: { value: null }, rays: { value: null }, flash: { value: 0 }, flashCol: { value: new THREE.Color(3, 1.2, 0.3) } });
    this.sunNdc = new THREE.Vector3(); this.fwd = new THREE.Vector3();
    this.resize();
  }
  resize() {
    const s = this.r.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(2, s.x), h = Math.max(2, s.y);
    const rt = (W, H, o = {}) => new THREE.WebGLRenderTarget(Math.max(2, W | 0), Math.max(2, H | 0), { type: THREE.HalfFloatType, depthBuffer: false, ...o });
    for (const k of ['scene', 'half', 'q1', 'q2', 'e1', 'e2', 'rays']) this[k] && this[k].dispose();
    this.scene = rt(w, h, { depthBuffer: true, samples: 4, depthTexture: new THREE.DepthTexture(w, h) });
    this.half = rt(w / 2, h / 2); this.q1 = rt(w / 4, h / 4); this.q2 = rt(w / 4, h / 4); this.e1 = rt(w / 8, h / 8); this.e2 = rt(w / 8, h / 8); this.rays = rt(w / 2, h / 2);
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.sceneQ, this.cam); }
  render(scene, camera, toScreen = null) {
    const r = this.r;
    r.setRenderTarget(this.scene); r.render(scene, camera);
    this.mBright.uniforms.t.value = this.scene.texture; this.pass(this.mBright, this.half);
    const blur = (src, tmp, dst) => { const u = this.mBlur.uniforms; u.t.value = src.texture; u.d.value.set(1 / tmp.width, 0); this.pass(this.mBlur, tmp);
      u.t.value = tmp.texture; u.d.value.set(0, 1 / dst.height); this.pass(this.mBlur, dst); };
    blur(this.half, this.q1, this.q2); blur(this.q2, this.e1, this.e2);
    // where the sun is on screen, and how much we face it
    this.sunNdc.copy(camera.position).addScaledVector(SUN, 1000).project(camera);
    camera.getWorldDirection(this.fwd); const facing = this.fwd.dot(SUN);
    const u = this.mRays.uniforms; u.t.value = this.scene.texture; u.tDepth.value = this.scene.depthTexture;
    u.sun.value.set(this.sunNdc.x * 0.5 + 0.5, this.sunNdc.y * 0.5 + 0.5); u.amt.value = THREE.MathUtils.smoothstep(facing, 0.15, 0.6) * 1.0;
    this.pass(this.mRays, this.rays);
    const o = this.mOut.uniforms; o.t.value = this.scene.texture; o.b1.value = this.q2.texture; o.b2.value = this.e2.texture; o.rays.value = this.rays.texture;
    this.pass(this.mOut, toScreen);
  }
}
