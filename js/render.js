// Rendu Three.js : tonemapping ACES, ombres douces, ciel physique, reflets, halo lumineux la nuit.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S, G, NN, CS, H2, RH, DIRS, OPP, RIGHT, RT, RC, cx, cy, wx, wz, hsh, inter, connDirs, clamp, lerp, hour } from './state.js';
import { posAt, lightState, spdE } from './sim.js';

export const V = {};
let renderer, scene, camera, controls, composer, bloom, sun, hemi, sky, stars, rain;
const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
const M = {}, P = {};

// ---------------------------------------------------------------- Textures procédurales
function canvasTex(w, h, draw, srgb = true, rep = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function noise(g, w, h, base, amp, n) { for (let i = 0; i < n; i++) { const v = base + (Math.random() - .5) * amp; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2) } }
function makeTextures() {
  const T = {};
  T.asphalt = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h); noise(g, w, h, 215, 70, 9000) }, true, 1);
  T.grass = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#5f8f3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = `hsla(${85 + Math.random() * 25},${35 + Math.random() * 20}%,${28 + Math.random() * 14}%,.35)`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 8 + Math.random() * 30, 0, 7); g.fill() }
    for (let i = 0; i < 9000; i++) { g.fillStyle = `hsla(${80 + Math.random() * 30},45%,${25 + Math.random() * 25}%,.6)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2) }
  }, true, 60);
  // Façades : 8 x 8 modules de fenêtres ; carte émissive séparée pour les fenêtres allumées la nuit
  const lit = []; for (let i = 0; i < 64; i++) lit.push(Math.random() < .42);
  const facade = (g, w, h, emissive) => {
    g.fillStyle = emissive ? '#000' : '#e9e6df'; g.fillRect(0, 0, w, h);
    const m = w / 8;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = i * m + m * .18, y = j * m + m * .2, ww = m * .64, hh = m * .55;
      if (emissive) { if (lit[j * 8 + i]) { const k = 170 + Math.random() * 85; g.fillStyle = `rgb(255,${k},${k * .55})`; g.fillRect(x, y, ww, hh) } }
      else { const gr = g.createLinearGradient(x, y, x + ww, y + hh); gr.addColorStop(0, '#3d4a5c'); gr.addColorStop(1, '#6f8197'); g.fillStyle = gr; g.fillRect(x, y, ww, hh); g.fillStyle = '#cfcac0'; g.fillRect(x - 2, y + hh, ww + 4, 3) }
    }
  };
  T.facade = canvasTex(512, 512, (g, w, h) => facade(g, w, h, false));
  T.lit = canvasTex(512, 512, (g, w, h) => facade(g, w, h, true));
  T.paving = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#d9d5cc'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,.09)'; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke() } noise(g, w, h, 200, 40, 600) }, true, 1);
  return T;
}

// ---------------------------------------------------------------- Groupes d'instances
class Pool {
  constructor(geo, mat, cap, cast = true, recv = true) { this.geo = geo; this.mat = mat; this.cast = cast; this.recv = recv; this.mesh = null; this.n = 0; this.grow(cap) }
  grow(cap) {
    if (this.mesh) { scene.remove(this.mesh); this.mesh.dispose() }
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = this.cast; m.receiveShadow = this.recv; m.frustumCulled = false; m.setColorAt(0, tmpC.set(0xffffff)); m.count = 0;
    scene.add(m); this.mesh = m; this.cap = cap; this.buf = [];
  }
  begin() { this.list = [] }
  add(x, y, z, sx, sy, sz, ry, col, rx = 0, rz = 0) { this.list.push(x, y, z, sx, sy, sz, ry, rx, rz, col); return this.list.length / 10 - 1 }
  commit() {
    const n = this.list.length / 10; if (n > this.cap) this.grow(Math.ceil(n * 1.3) + 8);
    const m = this.mesh, L = this.list;
    for (let j = 0; j < n; j++) {
      const k = j * 10; dummy.position.set(L[k], L[k + 1], L[k + 2]); dummy.rotation.set(L[k + 7], L[k + 6], L[k + 8], 'YXZ'); dummy.scale.set(L[k + 3], L[k + 4], L[k + 5]); dummy.updateMatrix();
      m.setMatrixAt(j, dummy.matrix); const c = L[k + 9]; m.setColorAt(j, typeof c === 'number' ? tmpC.setHex(c) : c);
    }
    m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; this.n = n;
  }
}

// ---------------------------------------------------------------- Géométries
function colored(geo, c) { const n = geo.attributes.position.count, a = new Float32Array(n * 3); tmpC.setHex(c); for (let i = 0; i < n; i++) { a[i * 3] = tmpC.r; a[i * 3 + 1] = tmpC.g; a[i * 3 + 2] = tmpC.b } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo }
function carGeo() {
  const parts = [];
  const body = new THREE.BoxGeometry(4.3, .72, 1.82); body.translate(0, .62, 0); parts.push(colored(body, 0xffffff));
  const hood = new THREE.BoxGeometry(1.1, .2, 1.7); hood.translate(1.55, 1.02, 0); parts.push(colored(hood, 0xffffff));
  const cab = new THREE.BoxGeometry(2.25, .66, 1.64); cab.translate(-.3, 1.31, 0); parts.push(colored(cab, 0x2a3038));
  const roof = new THREE.BoxGeometry(1.9, .08, 1.5); roof.translate(-.35, 1.68, 0); parts.push(colored(roof, 0xffffff));
  for (const [x, z] of [[1.35, .86], [1.35, -.86], [-1.35, .86], [-1.35, -.86]]) { const w = new THREE.CylinderGeometry(.34, .34, .26, 12); w.rotateX(Math.PI / 2); w.translate(x, .34, z); parts.push(colored(w, 0x111111)) }
  return mergeGeometries(parts.map(g => g.toNonIndexed()));
}
function truckGeo() {
  const parts = [];
  const cab = new THREE.BoxGeometry(1.9, 2.1, 2.3); cab.translate(2.75, 1.45, 0); parts.push(colored(cab, 0xffffff));
  const glass = new THREE.BoxGeometry(.06, .8, 2.0); glass.translate(3.72, 1.95, 0); parts.push(colored(glass, 0x2a3038));
  const box = new THREE.BoxGeometry(5.4, 2.8, 2.45); box.translate(-.9, 1.85, 0); parts.push(colored(box, 0xf3f3f0));
  const ch = new THREE.BoxGeometry(7.4, .35, 1.9); ch.translate(0, .55, 0); parts.push(colored(ch, 0x2b2b2b));
  for (const x of [2.6, -.6, -2.6]) for (const z of [1, -1]) { const w = new THREE.CylinderGeometry(.48, .48, .34, 12); w.rotateX(Math.PI / 2); w.translate(x, .48, z * 1.02); parts.push(colored(w, 0x111111)) }
  return mergeGeometries(parts.map(g => g.toNonIndexed()));
}
function lightsGeo(front, half) {
  const parts = [];
  for (const z of [.62, -.62]) { const b = new THREE.BoxGeometry(.08, .2, .42); b.translate(front ? half : -half, .78, z); parts.push(b) }
  return mergeGeometries(parts);
}
function arrowGeo() {
  const s = new THREE.Shape(); s.moveTo(-2.2, -.28); s.lineTo(.6, -.28); s.lineTo(.6, -.85); s.lineTo(2.2, 0); s.lineTo(.6, .85); s.lineTo(.6, .28); s.lineTo(-2.2, .28); s.closePath();
  const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); return g;
}

// ---------------------------------------------------------------- Initialisation
export function initRender(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .85;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 2, 6000);
  camera.position.set(140, 260, 330);
  controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: .09, screenSpacePanning: false, maxPolarAngle: 1.22, minDistance: 22, maxDistance: 820, zoomToCursor: true, zoomSpeed: 1.1, panSpeed: 1.1 });
  controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.target.set(0, 0, 20);
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .3, .45, .92); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture;
  sky = new Sky(); sky.scale.setScalar(20000); scene.add(sky);
  Object.assign(sky.material.uniforms, {}); sky.material.uniforms.turbidity.value = 6; sky.material.uniforms.rayleigh.value = 1.6; sky.material.uniforms.mieCoefficient.value = .005; sky.material.uniforms.mieDirectionalG.value = .8;
  hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4d5a3a, .55); scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -.0004; sun.shadow.normalBias = .4;
  scene.add(sun, sun.target);
  scene.fog = new THREE.Fog(0xbfd4e6, 500, 3200);
  // Étoiles
  const sp = new Float32Array(1500 * 3); for (let i = 0; i < 1500; i++) { const t = Math.random() * 6.28, p = Math.random() * 1.3, r = 9000; sp[i * 3] = Math.cos(t) * Math.cos(p) * r; sp[i * 3 + 1] = Math.sin(p) * r + 200; sp[i * 3 + 2] = Math.sin(t) * Math.cos(p) * r }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 14, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false })); scene.add(stars);
  // Pluie
  const rp = new Float32Array(4000 * 6); for (let i = 0; i < 4000; i++) { const x = (Math.random() - .5) * 400, y = Math.random() * 220, z = (Math.random() - .5) * 400; rp.set([x, y, z, x - .4, y - 3.2, z], i * 6) }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaac4e0, transparent: true, opacity: .35, depthWrite: false })); rain.frustumCulled = false; rain.visible = false; scene.add(rain);

  const T = makeTextures(); V.tex = T;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  M.asph = std({ map: T.asphalt, roughness: .9, metalness: 0 });
  M.side = std({ map: T.paving, roughness: .95 });
  M.curb = std({ color: 0xc9c5bc, roughness: .85 });
  M.mark = std({ color: 0xf2f2ee, roughness: .6 });
  M.grass = std({ map: T.grass, roughness: 1 });
  M.lot = std({ roughness: .95 });
  M.conc = std({ color: 0xb4b1aa, roughness: .82 });
  M.wall = std({ map: T.facade, emissiveMap: T.lit, emissive: 0xffd7a0, emissiveIntensity: 0, vertexColors: true, roughness: .62, metalness: .15 });
  M.roof = std({ vertexColors: true, roughness: .92 });
  M.inst = std({ roughness: .75, metalness: .05 });
  M.foliage = std({ roughness: .9, flatShading: true });
  M.car = std({ vertexColors: true, roughness: .38, metalness: .2, envMapIntensity: .9 });
  M.glowF = new THREE.MeshBasicMaterial({ toneMapped: false });
  M.glowR = new THREE.MeshBasicMaterial({ toneMapped: false });
  M.lamp = new THREE.MeshBasicMaterial({ toneMapped: false });
  M.street = new THREE.MeshBasicMaterial({ color: 0x333333, toneMapped: false });
  M.prev = new THREE.MeshBasicMaterial({ transparent: true, opacity: .42, depthWrite: false });
  M.water = std({ color: 0x3d7fb8, roughness: .15, metalness: .1 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(G * CS * 3.2, G * CS * 3.2), M.grass); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.position.y = -.02; scene.add(ground);

  const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(.5, .5, 1, 10);
  P.asph = new Pool(BOX, M.asph, 3000, false, true);
  P.side = new Pool(BOX, M.side, 4000, false, true);
  P.mark = new Pool(BOX, M.mark, 6000, false, true);
  P.arrow = new Pool(arrowGeo(), M.mark, 300, false, true);
  P.disc = new Pool(new THREE.CylinderGeometry(1, 1, 1, 40), M.asph, 60, false, true);
  P.island = new Pool(new THREE.CylinderGeometry(1, 1, 1, 32), M.inst, 120, true, true);
  P.lot = new Pool(BOX, M.lot, 2000, false, true);
  P.conc = new Pool(BOX, M.conc, 3000, true, true);
  P.pillar = new Pool(CYL, M.conc, 1500, true, true);
  P.prop = new Pool(BOX, M.inst, 4000, true, false);
  P.pole = new Pool(new THREE.CylinderGeometry(.5, .5, 1, 6), M.inst, 3000, true, false);
  P.sign = new Pool(new THREE.CylinderGeometry(.5, .5, 1, 8), M.inst, 400, false, false);
  P.tri = new Pool(new THREE.CylinderGeometry(.5, .5, 1, 3), M.inst, 200, false, false);
  P.lamp = new Pool(new THREE.SphereGeometry(.5, 10, 8), M.lamp, 1500, false, false);
  P.streetGlow = new Pool(BOX, M.street, 1500, false, false);
  P.roofHouse = new Pool((() => { const g = new THREE.ConeGeometry(.7071, 1, 4); g.rotateY(Math.PI / 4); return g })(), M.inst, 1500, true, true);
  P.tree = new Pool(new THREE.IcosahedronGeometry(1, 1), M.foliage, 5000, true, false);
  P.trunk = new Pool(new THREE.CylinderGeometry(.12, .18, 1, 6), M.inst, 5000, true, false);
  P.car = new Pool(carGeo(), M.car, 1000, true, false);
  P.truck = new Pool(truckGeo(), M.car, 300, true, false);
  P.carF = new Pool(lightsGeo(true, 2.16), M.glowF, 1000, false, false);
  P.carR = new Pool(lightsGeo(false, 2.16), M.glowR, 1000, false, false);
  P.trF = new Pool(lightsGeo(true, 3.72), M.glowF, 300, false, false);
  P.trR = new Pool(lightsGeo(false, 3.72), M.glowR, 300, false, false);
  P.prev = new Pool(BOX, M.prev, 600, false, false);
  P.acc = new Pool(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color: 0xff4040, toneMapped: false }), 10, false, false);
  V.selRing = new THREE.Mesh(new THREE.RingGeometry(9.2, 10.2, 4, 1), new THREE.MeshBasicMaterial({ color: 0xffd34d, toneMapped: false, side: THREE.DoubleSide, depthWrite: false, transparent: true }));
  V.selRing.rotation.x = -Math.PI / 2; V.selRing.visible = false; scene.add(V.selRing);
  V.hover = new THREE.Mesh(new THREE.PlaneGeometry(CS * .96, CS * .96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .16, depthWrite: false }));
  V.hover.rotation.x = -Math.PI / 2; V.hover.visible = false; scene.add(V.hover);
  V.wallsMesh = null; V.roofMesh = null;
  Object.assign(V, { renderer, scene, camera, controls, composer, bloom });
  addEventListener('resize', resize);
}
export function resize() {
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
export function setQuality(q) {
  renderer.setPixelRatio(q ? Math.min(devicePixelRatio, 1.75) : 1);
  bloom.enabled = !!q;
  sun.shadow.mapSize.set(q ? 4096 : 2048, q ? 4096 : 2048); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null }
  resize();
}

// ---------------------------------------------------------------- Construction du décor
const asphInfo = [];   // [instance, nœud, couleur] pour la carte des bouchons
const lampInfo = [];   // [instance, case, axe, 0 rouge | 1 orange | 2 vert]
const ASPH = 0x4a4c51, ASPH_ROC = 0x505257;
export function buildCity() {
  S.dirty.map = false;
  for (const k in P) if (!['car', 'truck', 'carF', 'carR', 'trF', 'trR', 'prev', 'acc'].includes(k)) P[k].begin();
  asphInfo.length = 0; lampInfo.length = 0;
  const A = P.asph, SW = P.side, MK = P.mark;
  for (let c = 0; c < NN; c++) {
    const L = S.road[c]; if (!L) continue;
    const x = wx(cx(c)), z = wz(cy(c)), w = RT[L].w, sa = (CS - w) / 2, conn = connDirs(c, false), isI = inter[c] === 1, rond = isI && S.ctrl[c] === 3;
    const has = d => conn.includes(d);
    // Chaussée
    if (rond) { const i = P.disc.add(x, .05, z, 6.95, .1, 6.95, 0, ASPH); asphInfo.push([P.disc, i, c, ASPH]); P.island.add(x, .3, z, 3, .5, 3, 0, 0x6f9a45); P.island.add(x, .22, z, 3.25, .35, 3.25, 0, 0xd8d4ca); P.tree.add(x, 3.2, z, 1.6, 1.9, 1.6, 0, 0x3f7a2c); P.trunk.add(x, 1.4, z, 1, 2.2, 1, 0, 0x5b4330) }
    else asphInfo.push([A, A.add(x, .05, z, w, .1, w, 0, ASPH), c, ASPH]);
    for (const d of conn) { const [dx, dz] = DIRS[d], o = w / 2 + sa / 2; asphInfo.push([A, A.add(x + dx * o, .05, z + dz * o, dx ? sa + .02 : w, .1, dz ? sa + .02 : w, 0, ASPH), c, ASPH]) }
    // Trottoirs
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) SW.add(x + sx * (w / 2 + sa / 2), .12, z + sz * (w / 2 + sa / 2), sa, .24, sa, 0, 0xffffff);
    for (let d = 0; d < 4; d++) if (!has(d)) { const [dx, dz] = DIRS[d], o = w / 2 + sa / 2; SW.add(x + dx * o, .12, z + dz * o, dx ? sa : w, .24, dz ? sa : w, 0, 0xffffff) }
    // Marquages
    if (!isI) {
      for (const d of conn) {
        const [dx, dz] = DIRS[d], nx = -dz, nz = dx;
        if (L === 1) for (const p of [1.4, 5.2]) MK.add(x + dx * p, .105, z + dz * p, dx ? 2.2 : .14, .012, dz ? 2.2 : .14, 0, 0xffffff);
        else {
          for (const o of [-.16, .16]) MK.add(x + dx * CS / 4 + nx * o, .105, z + dz * CS / 4 + nz * o, dx ? CS / 2 : .1, .012, dz ? CS / 2 : .1, 0, 0xffffff);
          for (const o of [-3, 3]) for (const p of [1.6, 5.2]) MK.add(x + dx * p + nx * o, .105, z + dz * p + nz * o, dx ? 2 : .12, .012, dz ? 2 : .12, 0, 0xffffff);
        }
      }
    } else if (!rond && (S.ctrl[c] === 1 || S.ctrl[c] === 2)) {
      for (const d of conn) {
        const [dx, dz] = DIRS[d], nx = -dz, nz = dx, din = OPP[d];
        const minor = S.ctrl[c] === 1 && (S.stopAxis[c] === 0 ? din < 2 : din >= 2);
        // Passage piéton
        const n = Math.floor(w / 1.05), dist = w / 2 + 1.7;
        for (let i = 0; i < n; i++) { const off = -w / 2 + .55 + i * 1.05; MK.add(x + dx * dist + nx * off, .105, z + dz * dist + nz * off, dx ? 2.6 : .5, .012, dz ? 2.6 : .5, 0, 0xffffff) }
        // Ligne d'arrêt sur la voie entrante
        if (S.ctrl[c] === 2 || minor) { const [rx, rz] = DIRS[RIGHT[din]], sl = w / 2 + 3.4; MK.add(x + dx * sl + rx * w / 4, .106, z + dz * sl + rz * w / 4, dx ? .45 : w / 2, .012, dz ? .45 : w / 2, 0, 0xffffff) }
      }
    }
    if (S.oneway[c] >= 0) { const d = S.oneway[c], ry = Math.atan2(-DIRS[d][1], DIRS[d][0]); for (const o of (L === 2 ? [-3, 3] : [0])) { const [nx, nz] = [-DIRS[d][1], DIRS[d][0]]; P.arrow.add(x + nx * o, .108, z + nz * o, .8, 1, .8, ry, 0xffffff) } }
    if (S.z30[c]) { P.sign.add(x + w / 2 + 1.2, 2.4, z + w / 2 + 1.2, .9, .06, .9, 0, 0xd8322b, Math.PI / 2); P.pole.add(x + w / 2 + 1.2, 1.1, z + w / 2 + 1.2, .1, 2.2, .1, 0, 0x8f959c) }
    // Lampadaires le long des rues
    if (!isI && ((cx(c) + cy(c)) % 2 === 0)) {
      const sx = (hsh(c, 3) < .5 ? -1 : 1) * (w / 2 + sa * .45), sz = (hsh(c, 4) < .5 ? -1 : 1) * (w / 2 + sa * .45);
      P.pole.add(x + sx, 3.2, z + sz, .16, 6.4, .16, 0, 0x5c6168);
      P.streetGlow.add(x + sx * .8, 6.35, z + sz * .8, .9, .18, .9, 0, 0xffffff);
    }
    // Signalisation des carrefours
    if (isI) for (const d of conn) {
      const din = OPP[d], [dx, dz] = DIRS[d], [rx, rz] = DIRS[RIGHT[din]], px = x + dx * (w / 2 + 1.2) + rx * (w / 2 + 1.2), pz = z + dz * (w / 2 + 1.2) + rz * (w / 2 + 1.2), face = Math.atan2(-DIRS[din][1], DIRS[din][0]) + Math.PI / 2;
      if (S.ctrl[c] === 2) {
        P.pole.add(px, 1.9, pz, .16, 3.8, .16, 0, 0x2f343b);
        P.prop.add(px, 3.6, pz, .5, 1.5, .5, 0, 0x1d2025);
        const axis = din >= 2 ? 0 : 1;
        for (let j = 0; j < 3; j++) lampInfo.push([P.lamp.add(px + dx * .3, 4.1 - j * .47, pz + dz * .3, .42, .42, .42, 0, 0x333333), c, axis, j]);
      } else if (S.ctrl[c] === 1 && (S.stopAxis[c] === 0 ? din < 2 : din >= 2)) {
        P.pole.add(px, 1.1, pz, .1, 2.2, .1, 0, 0x8f959c); P.sign.add(px, 2.4, pz, .95, .06, .95, face, 0xc8241f, Math.PI / 2);
      } else if (S.ctrl[c] === 3) {
        P.pole.add(px, 1.1, pz, .1, 2.2, .1, 0, 0x8f959c); P.tri.add(px, 2.45, pz, 1.1, .06, 1.1, face, 0xf2f2f2, Math.PI / 2, Math.PI);
      }
    }
  }
  // Rocade surélevée, piliers, rampes des échangeurs
  for (let c = 0; c < NN; c++) {
    if (!S.roc[c]) continue;
    const x = wx(cx(c)), z = wz(cy(c)), w = RC.w, sa = (CS - w) / 2, conn = connDirs(c, true), n = NN + c;
    P.conc.add(x, RH - .5, z, w, .9, w, 0, 0xffffff);
    asphInfo.push([A, A.add(x, RH + .01, z, w, .04, w, 0, ASPH_ROC), n, ASPH_ROC]);
    for (const d of conn) {
      const [dx, dz] = DIRS[d], o = w / 2 + sa / 2, nb = S.roc[cx(c) + dx + (cy(c) + dz) * G];
      if (nb) {
        P.conc.add(x + dx * o, RH - .5, z + dz * o, dx ? sa + .02 : w, .9, dz ? sa + .02 : w, 0, 0xffffff);
        asphInfo.push([A, A.add(x + dx * o, RH + .01, z + dz * o, dx ? sa + .02 : w, .04, dz ? sa + .02 : w, 0, ASPH_ROC), n, ASPH_ROC]);
        for (const s of [-1, 1]) P.conc.add(x + dx * o - dz * s * (w / 2 + .15), RH + .45, z + dz * o + dx * s * (w / 2 + .15), dx ? sa : .3, .9, dz ? sa : .3, 0, 0xffffff);
      } else {
        // Rampe vers la rue : du centre de la case (en haut) jusqu'au bord (au sol)
        const len = Math.hypot(H2, RH), ang = Math.atan2(RH, H2), mx = x + dx * H2 / 2, mz = z + dz * H2 / 2, rw = w * .62;
        const rot = dx ? [0, 0, -dx * ang] : [dz * ang, 0, 0];
        P.conc.add(mx, RH / 2 - .45, mz, dx ? len : rw, .9, dz ? len : rw, 0, 0xffffff, rot[0], rot[2]);
        // même centre que le béton, un peu plus épais : le bitume dépasse juste au-dessus
        asphInfo.push([A, A.add(mx, RH / 2 - .45, mz, dx ? len + .02 : rw - .4, .96, dz ? len + .02 : rw - .4, 0, ASPH_ROC, rot[0], rot[2]), n, ASPH_ROC]);
      }
    }
    for (let d = 0; d < 4; d++) if (!conn.includes(d)) { const [dx, dz] = DIRS[d]; P.conc.add(x + dx * (w / 2 + .15), RH + .45, z + dz * (w / 2 + .15), dx ? .3 : w + .6, .9, dz ? .3 : w + .6, 0, 0xffffff) }
    if (!inter[n] && conn.length === 2 && OPP[conn[0]] === conn[1] && !S.ech[c]) {
      const ax = DIRS[conn[0]][0] !== 0;
      P.conc.add(x, RH + .35, z, ax ? CS : .5, .7, ax ? .5 : CS, 0, 0xffffff);
      for (const o of [-3, 3]) for (const p of [-3.5, 3.5]) P.mark.add(x + (ax ? p : o), RH + .04, z + (ax ? o : p), ax ? 2.2 : .14, .012, ax ? .14 : 2.2, 0, 0xffffff);
    }
    // Au-dessus d'une rue, les piliers vont dans les coins de trottoir
    if (S.road[c]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.pillar.add(x + sx * (H2 - .6), (RH - .9) / 2, z + sz * (H2 - .6), 1.1, RH - .9, 1.1, 0, 0xffffff);
    else P.pillar.add(x, (RH - .9) / 2, z, 2.2, RH - .9, 2.2, 0, 0xffffff);
    if (!S.road[c]) P.lot.add(x, .03, z, CS, .02, CS, 0, 0x8d8a83);
  }
  buildBuildings();
  // Parcs et campagne
  for (let c = 0; c < NN; c++) {
    if (S.road[c] || S.roc[c] || S.bld[c] >= 0) continue;
    const x = wx(cx(c)), z = wz(cy(c)), park = S.park[c];
    if (park) P.lot.add(x, .03, z, CS, .02, CS, 0, 0x6c9a47);
    const n = park ? 3 : (hsh(c, 9) < .3 ? 2 : 0);
    for (let k = 0; k < n; k++) tree(x + (hsh(c, 10 + k) - .5) * 10, z + (hsh(c, 20 + k) - .5) * 10, .8 + hsh(c, 30 + k) * .7, c * 7 + k);
  }
  for (const k in P) if (!['car', 'truck', 'carF', 'carR', 'trF', 'trR', 'prev', 'acc'].includes(k)) P[k].commit();
  lastHeat = -1;
}
function tree(x, z, s, seed) {
  P.trunk.add(x, 1.1 * s, z, s, 2.2 * s, s, 0, 0x5b4330);
  tmpC.setHSL(.25 + hsh(seed, 1) * .08, .45 + hsh(seed, 2) * .2, .26 + hsh(seed, 3) * .1);
  P.tree.add(x, 3.1 * s, z, 1.7 * s, 2 * s, 1.7 * s, hsh(seed, 4) * 6, tmpC.clone());
}
// Palettes [teinte, saturation, luminosité] : brique, sable, crème, gris, terre cuite ; verre bleuté pour les bureaux
const APT = [[.03, .42, .5], [.09, .38, .66], [.12, .3, .76], [.6, .05, .62], [.05, .45, .58], [.11, .18, .7], [.08, .25, .55]];
const OFF = [[.58, .22, .58], [.6, .12, .46], [.55, .18, .68], [.62, .08, .72], [.1, .06, .62]];
const SHOP = [[.0, .45, .62], [.12, .5, .68], [.33, .3, .6], [.58, .35, .62], [.09, .3, .74]];
const FACT = [[.1, .05, .58], [.08, .12, .5], [.6, .04, .66]];
// Bâtiments fusionnés : les fenêtres gardent leur taille quelle que soit la hauteur
function buildBuildings() {
  const pos = [], nor = [], uv = [], col = [], rpos = [], rnor = [], rcol = [];
  const face = (ax, ay, az, bx, by, bz, cxp, cyp, czp, dx_, dy_, dz_, nx, ny, nz, u, v, c) => {
    pos.push(ax, ay, az, bx, by, bz, cxp, cyp, czp, ax, ay, az, cxp, cyp, czp, dx_, dy_, dz_);
    for (let i = 0; i < 6; i++) { nor.push(nx, ny, nz); col.push(c.r, c.g, c.b) }
    uv.push(0, 0, u, 0, u, v, 0, 0, u, v, 0, v);
  };
  const box = (x, z, w, d, h, c, rc, y0 = 0) => {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h, uw = w / 32, ud = d / 32, vh = h / 28;
    face(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, uw, vh, c);
    face(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, uw, vh, c);
    face(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, ud, vh, c);
    face(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, ud, vh, c);
    rpos.push(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z1, x1, y1, z0, x0, y1, z0);
    for (let i = 0; i < 6; i++) { rnor.push(0, 1, 0); rcol.push(rc.r, rc.g, rc.b) }
  };
  const C = new THREE.Color(), RCc = new THREE.Color();
  for (const b of S.buildings) {
    const x = wx(cx(b.c)), z = wz(cy(b.c)), k = b.seed, [fx, fz] = DIRS[OPP[b.dd]];
    if (b.type === 0) {
      P.lot.add(x, .03, z, CS, .02, CS, 0, 0x6f9c4a);
      const s = 7.4, ox = -fx * 1, oz = -fz * 1;
      C.setHSL(.08 + k * .06, .25, .78 + k * .08); RCc.setHSL(.03, .5, .35);
      box(x + ox, z + oz, s, s, b.h, C, RCc);
      P.roofHouse.add(x + ox, b.h + 1.55, z + oz, s * 1.06, 3.1, s * 1.06, 0, new THREE.Color().setHSL(.02 + k * .03, .55, .3 + k * .08));
      tree(x - fx * 0 + (fz ? 4.6 : 0) * (k < .5 ? 1 : -1) + fx * 4.5, z + (fx ? 4.6 : 0) * (k < .5 ? 1 : -1) + fz * 4.5, .7, b.c);
    } else {
      P.lot.add(x, .03, z, CS, .02, CS, 0, 0xb9b4aa);
      const pal = b.type === 1 ? APT : b.type === 2 ? OFF : b.type === 3 ? SHOP : FACT, p = pal[(k * pal.length) | 0];
      C.setHSL(p[0], p[1], p[2] + (hsh(b.c, 5) - .5) * .06); RCc.setHSL(p[0], .06, .36 + hsh(b.c, 6) * .12);
      const s = b.type === 3 ? 11.2 : b.type === 4 ? 12 : 10.6;
      box(x, z, s, s, b.h, C, RCc);
      if (b.type === 2 && b.h > 30) box(x, z, s * .7, s * .7, b.h * .18, C, RCc, b.h);
      if (b.type === 3) P.prop.add(x + fx * (s / 2 + .5), 3.1, z + fz * (s / 2 + .5), fx ? 1 : s * .9, .16, fz ? 1 : s * .9, 0, new THREE.Color().setHSL(k, .7, .45), fz ? -.25 * fz : 0, fx ? .25 * fx : 0);
      if (b.type === 4) { P.pillar.add(x + 3.5, b.h + 6, z - 3.5, 1.6, 12, 1.6, 0, 0x8b8680); P.prop.add(x - 2, b.h + .8, z + 2, 4, 1.6, 3, 0, 0x7d7a74) }
      if (b.type === 1 || b.type === 2) { P.prop.add(x + (k - .5) * 4, b.h + .6, z + (hsh(b.c, 2) - .5) * 4, 2.2, 1.2, 1.6, 0, 0x9a9a98) }
    }
  }
  const mk = (p, n, c, u) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); if (u) g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); return g };
  if (V.wallsMesh) { scene.remove(V.wallsMesh, V.roofMesh); V.wallsMesh.geometry.dispose(); V.roofMesh.geometry.dispose() }
  V.wallsMesh = new THREE.Mesh(mk(pos, nor, col, uv), M.wall); V.wallsMesh.castShadow = V.wallsMesh.receiveShadow = true;
  V.roofMesh = new THREE.Mesh(mk(rpos, rnor, rcol), M.roof); V.roofMesh.castShadow = V.roofMesh.receiveShadow = true;
  scene.add(V.wallsMesh, V.roofMesh);
}

// ---------------------------------------------------------------- Image par image
let lastHeat = -1;
const skyDay = new THREE.Color(0xbfd4e6), skyNight = new THREE.Color(0x0a1224), sunV = new THREE.Vector3();
const night = h => h < 5 || h >= 21 ? 1 : h < 7 ? (7 - h) / 2 : h >= 19 ? (h - 19) / 2 : 0;
export function frame(now, rdt, ui) {
  const h = hour(), dk = night(h);
  // Soleil et ciel
  const el = Math.sin((h - 6) / 12 * Math.PI) * 62, az = (h / 24) * 360 - 90;
  sunV.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - Math.max(el, -8)), THREE.MathUtils.degToRad(az));
  sky.material.uniforms.sunPosition.value.copy(sunV);
  const t = controls.target;
  if (el > 2) { sun.position.copy(t).addScaledVector(sunV, 600); sun.intensity = 2.6 * clamp(el / 25, .2, 1); sun.color.setHSL(.1, .5, clamp(.6 + el / 100, .6, .96)) }
  else { sun.position.set(t.x - 300, 420, t.z + 200); sun.intensity = .22; sun.color.setHex(0x8fa8ff) }
  sun.target.position.copy(t);
  const dist = camera.position.distanceTo(t), sc = clamp(dist * .95, 70, 420), sh = sun.shadow.camera;
  sh.left = -sc; sh.right = sc; sh.top = sc; sh.bottom = -sc; sh.near = 10; sh.far = 1400; sh.updateProjectionMatrix();
  hemi.intensity = lerp(.55, .14, dk); renderer.toneMappingExposure = lerp(.85, .62, dk);
  M.wall.emissiveIntensity = dk * 1.4;
  // L'éclairage d'ambiance (reflets de l'environnement) baisse avec la nuit
  for (const k in M) { const m = M[k]; if (m.isMeshStandardMaterial) { if (m.userData.env == null) m.userData.env = m.envMapIntensity; m.envMapIntensity = m.userData.env * lerp(1, .1, dk) } }
  M.street.color.setScalar(lerp(.25, 4.2, dk));
  stars.material.opacity = dk;
  bloom.strength = lerp(.25, .85, dk);
  scene.fog.color.copy(skyDay).lerp(skyNight, dk);
  const fogK = S.weather.t === 2 ? 1 : S.weather.t === 1 ? .45 : 0;
  scene.fog.near = lerp(600, 60, fogK); scene.fog.far = lerp(3400, 520, fogK);
  sky.material.uniforms.turbidity.value = S.weather.t ? 14 : 6;
  M.asph.roughness = S.weather.t === 1 ? .38 : .9;
  rain.visible = S.weather.t === 1;
  if (rain.visible) { rain.position.set(t.x, 0, t.z); const p = rain.geometry.attributes.position.array; for (let i = 0; i < p.length; i += 6) { let y = p[i + 1] - rdt * 140; if (y < 0) y += 220; p[i + 1] = y; p[i + 4] = y - 3.2 } rain.geometry.attributes.position.needsUpdate = true }
  // Voitures
  const cars = S.cars, Pc = P.car, Pt = P.truck;
  let nc = 0, nt = 0;
  const fL = tmpC.clone().setRGB(lerp(.9, 4, dk), lerp(.9, 3.7, dk), lerp(.8, 3, dk)), rL = new THREE.Color(), brake = new THREE.Color(5, .15, .1);
  rL.setRGB(lerp(.6, 2.2, dk), .05, .04);
  const carC = new THREE.Color();
  for (const car of cars) {
    posAt(car);
    dummy.position.set(car.px, car.py + .1, car.pz); dummy.rotation.set(0, car.hd, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    carC.setHex(car.col);
    if (car.truck) { if (nt >= Pt.cap) continue; Pt.mesh.setMatrixAt(nt, dummy.matrix); Pt.mesh.setColorAt(nt, carC); P.trF.mesh.setMatrixAt(nt, dummy.matrix); P.trF.mesh.setColorAt(nt, fL); P.trR.mesh.setMatrixAt(nt, dummy.matrix); P.trR.mesh.setColorAt(nt, car.a < -1.2 ? brake : rL); nt++ }
    else { if (nc >= Pc.cap) continue; Pc.mesh.setMatrixAt(nc, dummy.matrix); Pc.mesh.setColorAt(nc, carC); P.carF.mesh.setMatrixAt(nc, dummy.matrix); P.carF.mesh.setColorAt(nc, fL); P.carR.mesh.setMatrixAt(nc, dummy.matrix); P.carR.mesh.setColorAt(nc, car.a < -1.2 ? brake : rL); nc++ }
  }
  for (const [p, n] of [[Pc, nc], [P.carF, nc], [P.carR, nc], [Pt, nt], [P.trF, nt], [P.trR, nt]]) { p.mesh.count = n; p.mesh.instanceMatrix.needsUpdate = true; if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true }
  // Feux tricolores
  const lm = P.lamp.mesh;
  for (const [i, c, axis, j] of lampInfo) {
    const st = lightState(c, axis), on = (j === 0 && st === 'r') || (j === 1 && st === 'y') || (j === 2 && st === 'g');
    lm.setColorAt(i, on ? (j === 0 ? tmpC.setRGB(6, .25, .15) : j === 1 ? tmpC.setRGB(6, 3.2, .2) : tmpC.setRGB(.3, 5, 1.6)) : tmpC.setRGB(.06, .06, .06));
  }
  if (lm.instanceColor) lm.instanceColor.needsUpdate = true;
  // Carte des bouchons
  if ((S.heat && now - lastHeat > 400) || (!S.heat && lastHeat >= 0)) {
    for (const [pool, i, n, base] of asphInfo) {
      if (S.heat) { const r = spdE[n]; tmpC.setHex(r > .7 ? 0x2fa866 : r > .45 ? 0xe3b52d : r > .25 ? 0xe8731f : 0xd83a32) } else tmpC.setHex(base);
      pool.mesh.setColorAt(i, tmpC);
    }
    P.asph.mesh.instanceColor.needsUpdate = true; P.disc.mesh.instanceColor.needsUpdate = true;
    lastHeat = S.heat ? now : -1;
  }
  // Accidents
  P.acc.begin();
  for (let n = 0; n < S.block.length; n++) if (S.block[n] > 0) { const c = n % NN; P.acc.add(wx(cx(c)), (n >= NN ? RH : 0) + 5 + Math.sin(now / 200) * .6, wz(cy(c)), 1.2, 1.6, 1.2, now / 400, 0xffffff) }
  P.acc.commit();
  // Aperçu, survol, sélection
  P.prev.begin();
  if (ui.preview) for (const [c, col, el] of ui.preview) P.prev.add(wx(cx(c)), el ? RH + .6 : .5, wz(cy(c)), CS * .92, .5, CS * .92, 0, col);
  P.prev.commit();
  if (ui.hover >= 0) { V.hover.visible = true; V.hover.position.set(wx(cx(ui.hover)), ui.hoverEl ? RH + .2 : .4, wz(cy(ui.hover))) } else V.hover.visible = false;
  if (ui.sel >= 0) { V.selRing.visible = true; V.selRing.position.set(wx(cx(ui.sel)), ui.selEl ? RH + .3 : .45, wz(cy(ui.sel))); V.selRing.rotation.z = Math.PI / 4 + now / 1400 } else V.selRing.visible = false;
  controls.update();
  if (innerWidth < 2 || innerHeight < 2) return;   // fenêtre réduite : rien à dessiner
  if (V.w !== innerWidth || V.h !== innerHeight) { V.w = innerWidth; V.h = innerHeight; resize() }
  composer.render();
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane0 = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), planeR = new THREE.Plane(new THREE.Vector3(0, 1, 0), -RH), hit = new THREE.Vector3();
export function cellAt(mx, my, elevated) {
  ndc.set(mx / innerWidth * 2 - 1, -(my / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(elevated ? planeR : plane0, hit)) return -1;
  const x = Math.floor(hit.x / CS + G / 2), y = Math.floor(hit.z / CS + G / 2);
  return x < 0 || y < 0 || x >= G || y >= G ? -1 : y * G + x;
}
export function focus(c, d) {
  const x = wx(cx(c)), z = wz(cy(c)), dx = x - controls.target.x, dz = z - controls.target.z;
  controls.target.x += dx; controls.target.z += dz; camera.position.x += dx; camera.position.z += dz;
  if (d) { const v = camera.position.clone().sub(controls.target).setLength(d); camera.position.copy(controls.target).add(v) }
}
export function panBy(dx, dz) {
  const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize(); const r = new THREE.Vector3(-f.z, 0, f.x);
  const k = camera.position.distanceTo(controls.target) * .0016;
  const mv = r.multiplyScalar(dx * k).add(f.multiplyScalar(dz * k));
  controls.target.add(mv); camera.position.add(mv);
}
export function rotateBy(a) {
  const off = camera.position.clone().sub(controls.target); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), a); camera.position.copy(controls.target).add(off);
}
export function setPanMode(on) { controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : -1; controls.touches.ONE = on ? THREE.TOUCH.PAN : -1 }
