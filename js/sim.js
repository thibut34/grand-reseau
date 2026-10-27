// Simulation microscopique : chaque voiture suit sa voie (modèle IDM),
// s'arrête aux feux, aux stops, cède à droite, s'insère dans les ronds-points.
import {
  S, G, NN, NODES, CS, H2, RH, CLOCK, DIRS, OPP, LEFT, RIGHT, turnOf, adj, deg, inter, rebuildAdj, ctrlOf, vlim, laneOff, lanesOf,
  cx, cy, wx, wz, clamp, lerp, hour, dayNum, earn, spend, toast, RT, RC, BT
} from './state.js';
import { grow, refreshDrives } from './gen.js';

export const MAXV = 900;
const DEMAND = 0.00034;          // départs par habitant et par seconde (facteur horaire 1)
const TAU = Math.PI * 2;
export const spdE = new Float32Array(NODES).fill(1);
export const waitE = new Float32Array(NODES * 4);
const queueNow = new Float32Array(NODES * 4), queueLast = new Float32Array(NODES * 4);
const nodeCnt = new Uint16Array(NODES);
const spdAcc = new Float32Array(NODES), spdN = new Float32Array(NODES);

// ---------------------------------------------------------------- Géométrie des trajectoires dans une case
const geoCache = new Map();
export function travGeom(din, dout, offIn, offOut, rond) {
  const key = din * 4 + dout + '|' + offIn + '|' + offOut + '|' + (rond ? 1 : 0);
  let g = geoCache.get(key); if (g) return g;
  const [ix, iz] = DIRS[din], [ox, oz] = DIRS[dout], h = H2;
  const p0x = -ix * h - iz * offIn, p0z = -iz * h + ix * offIn;
  const p2x = ox * h - oz * offOut, p2z = oz * h + ox * offOut;
  const pts = [p0x, p0z];
  if (rond) {
    const R = 4.4, aIn = Math.atan2(-iz, -ix), aOut = Math.atan2(oz, ox);
    const a1 = aIn - .42; let delta = a1 - (aOut + .42);
    while (delta <= .05) delta += TAU; while (delta > TAU) delta -= TAU;
    const n = Math.max(3, Math.ceil(delta / .22));
    for (let i = 0; i <= n; i++) { const a = a1 - delta * i / n; pts.push(Math.cos(a) * R, Math.sin(a) * R) }
  } else if (dout === din) {
    // ligne droite
  } else if (dout === OPP[din]) {
    // demi-tour en bout d'impasse
    const ax = p0x + ix * h * .85, az = p0z + iz * h * .85, bx = p2x + ix * h * .85, bz = p2z + iz * h * .85;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, r = Math.hypot(ax - bx, az - bz) / 2 || 1, a0 = Math.atan2(az - mz, ax - mx);
    const sg = Math.cos(a0 + Math.PI / 2) * ix + Math.sin(a0 + Math.PI / 2) * iz > 0 ? 1 : -1;
    pts.push(ax, az);
    for (let i = 1; i < 8; i++) { const a = a0 + sg * Math.PI * i / 8; pts.push(mx + Math.cos(a) * r, mz + Math.sin(a) * r) }
    pts.push(bx, bz);
  } else {
    const p1x = ix !== 0 ? p2x : p0x, p1z = iz !== 0 ? p2z : p0z;
    for (let i = 1; i < 10; i++) { const t = i / 10, u = 1 - t; pts.push(u * u * p0x + 2 * u * t * p1x + t * t * p2x, u * u * p0z + 2 * u * t * p1z + t * t * p2z) }
  }
  pts.push(p2x, p2z);
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  g = { pts, cum, L: Math.max(.5, cum[cum.length - 1]) };
  geoCache.set(key, g); return g;
}
export function makeTrav(car, k) {
  const n = car.nodes[k], last = car.nodes.length - 1;
  const din = k === 0 ? car.din0 : car.douts[k - 1], dout = car.douts[k];
  const offIn = laneOff(n, car.lanes[k]), offOut = k < last ? laneOff(car.nodes[k + 1], car.lanes[k + 1]) : offIn;
  const rond = n < NN && S.ctrl[n] === 3 && inter[n] === 1;
  const el = n >= NN, prevEl = k > 0 ? car.nodes[k - 1] >= NN : el, nextEl = k < last ? car.nodes[k + 1] >= NN : el;
  const c = n % NN;
  car.trav = { g: travGeom(din, dout, offIn, offOut, rond), ox: wx(cx(c)), oz: wz(cy(c)), yIn: el ? (prevEl ? RH : 0) : 0, yOut: el ? (nextEl ? RH : 0) : 0, n, din, dout, t: turnOf(din, dout), rond, seg: 0 };
}
export function posAt(car) {
  const T = car.trav, g = T.g, cum = g.cum, p = g.pts, s = clamp(car.s, 0, g.L);
  let i = T.seg;
  while (i < cum.length - 2 && cum[i + 1] < s) i++;
  while (i > 0 && cum[i] > s) i--;
  T.seg = i;
  const sl = cum[i + 1] - cum[i] || 1, f = (s - cum[i]) / sl;
  const dx = p[2 * i + 2] - p[2 * i], dz = p[2 * i + 3] - p[2 * i + 1];
  car.px = T.ox + p[2 * i] + dx * f; car.pz = T.oz + p[2 * i + 1] + dz * f;
  if (dx || dz) car.hd = Math.atan2(-dz, dx);
  const L2 = g.L / 2;
  car.py = T.yIn === T.yOut ? T.yIn : T.yIn < T.yOut ? (s < L2 ? lerp(T.yIn, RH, s / L2) : RH) : (s < L2 ? RH : lerp(RH, T.yOut, (s - L2) / L2));
}

// ---------------------------------------------------------------- Itinéraires (A* sur nœud + direction d'arrivée)
const NS4 = NODES * 4;
const gS = new Float32Array(NS4), fromS = new Int32Array(NS4), stamp = new Uint32Array(NS4), closed = new Uint32Array(NS4);
const hI = new Int32Array(NS4 * 2), hF = new Float32Array(NS4 * 2); let hn = 0, gen = 0;
function hpush(i, f) { let k = hn++; while (k > 0) { const p = (k - 1) >> 1; if (hF[p] <= f) break; hI[k] = hI[p]; hF[k] = hF[p]; k = p } hI[k] = i; hF[k] = f }
function hpop() { const top = hI[0]; hn--; if (hn > 0) { const i = hI[hn], f = hF[hn]; let k = 0; for (; ;) { let c = 2 * k + 1; if (c >= hn) break; if (c + 1 < hn && hF[c + 1] < hF[c]) c++; if (hF[c] >= f) break; hI[k] = hI[c]; hF[k] = hF[c]; k = c } hI[k] = i; hF[k] = f } return top }
const uturnOK = n => deg[n] <= 1 || (n < NN && S.ctrl[n] === 3 && inter[n] === 1);
const ctrlDelay = { prio: 3, stop: 5, feux: 11, rond: 2.5, merge: 2 };
function edgeCost(din, d, m) {
  let c = CS / (vlim(m) * clamp(spdE[m], .12, 1));
  const t = turnOf(din, d); c += t === 1 ? 1.5 : t === 2 ? 3 : t === 3 ? 7 : 0;
  if (inter[m]) c += ctrlDelay[ctrlOf(m)] + waitE[m * 4 + d];
  return c;
}
export function findPath(sn, sdin, goal) {
  gen++; hn = 0;
  const s = sn * 4 + sdin, gc = goal % NN, gx = cx(gc), gy = cy(gc);
  stamp[s] = gen; gS[s] = 0; fromS[s] = -1;
  hpush(s, 0);
  while (hn > 0) {
    const cur = hpop(); if (closed[cur] === gen) continue; closed[cur] = gen;
    const n = cur >> 2, din = cur & 3;
    if (n === goal) {
      const st = []; for (let i = cur; i !== -1; i = fromS[i]) st.push(i); st.reverse();
      return { nodes: st.map(v => v >> 2), douts: st.slice(1).map(v => v & 3) };
    }
    const A = adj[n];
    for (let j = 0; j < A.length; j++) {
      const m = A[j][0], d = A[j][1];
      if (d === OPP[din] && !uturnOK(n)) continue;
      if (S.block[m] > 0) continue;
      const ns = m * 4 + d; if (closed[ns] === gen) continue;
      const c = gS[cur] + edgeCost(din, d, m);
      if (stamp[ns] !== gen || c < gS[ns]) { stamp[ns] = gen; gS[ns] = c; fromS[ns] = cur; const mc = m % NN; hpush(ns, c + (Math.abs(cx(mc) - gx) + Math.abs(cy(mc) - gy)) * CS / 25) }
    }
  }
  return null;
}
function assignLanes(car, from) {
  const N = car.nodes.length;
  for (let k = from; k < N; k++) {
    const n = car.nodes[k];
    if (lanesOf(n) < 2) { car.lanes[k] = 0; continue }
    const t = k + 1 < N ? turnOf(car.douts[k], car.douts[k + 1]) : 0;
    car.lanes[k] = t === 2 || t === 3 ? 1 : t === 1 ? 0 : car.pref;
  }
}

// ---------------------------------------------------------------- Demande de déplacements
let resCum = [], jobCum = [], shopCum = [], indB = [], R = { res: 0, jobs: 0 };
export function rebuildDemand() {
  resCum = []; jobCum = []; shopCum = []; indB = []; let r = 0, j = 0, sh = 0;
  for (const b of S.buildings) {
    if (b.cut) continue;
    const t = BT[b.type]; r += t.res; j += t.jobs; if (t.shop) sh += t.jobs;
    resCum.push([r, b]); jobCum.push([j, b]); shopCum.push([sh, b]); if (t.ind) indB.push(b);
  }
  R.res = r; R.jobs = j;
}
export const totals = () => R;
function pick(cum) {
  if (!cum.length) return null; const tot = cum[cum.length - 1][0]; if (!tot) return null;
  const x = Math.random() * tot; let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m][0] < x) lo = m + 1; else hi = m }
  return cum[lo][1];
}
export function todF(h) { return .12 + 2.1 * Math.exp(-((h - 8) ** 2) / 1.4) + 2.3 * Math.exp(-((h - 17.8) ** 2) / 2) + .9 * Math.exp(-((h - 12.5) ** 2) / 6) }
const entryIn = c => { const x = cx(c), y = cy(c); return y === 0 ? 2 : y === G - 1 ? 3 : x === 0 ? 0 : 1 };
let carId = 0;
function createCar(start, din0, goal, fdout, endB, truck) {
  if (nodeCnt[start] > 1 || S.cars.length >= MAXV) return false;
  const p = findPath(start, din0, goal);
  if (!p) { S.stats.unreach++; return false }
  p.douts.push(fdout);
  const car = {
    id: carId++, nodes: p.nodes, douts: p.douts, lanes: [], din0, k: 0, s: 0, v: 3, a: 0, len: truck ? 7.6 : 4.4, truck,
    go: -1, waitT: 0, stopT: 0, idle: 0, t0: S.simT, endB, goal, pref: Math.random() < .55 ? 0 : 1, rr: 4 + ((Math.random() * 4) | 0),
    col: truck ? 0xeeeeea : CARC[(Math.random() * CARC.length) | 0], px: 0, py: 0, pz: 0, hd: 0
  };
  let ideal = 2; for (const n of p.nodes) ideal += CS / vlim(n); car.ideal = ideal;
  assignLanes(car, 0); makeTrav(car, 0); posAt(car);
  S.cars.push(car); nodeCnt[start]++;
  return true;
}
const CARC = [0xc62828, 0x1e4fbf, 0xf2f2f2, 0x24272d, 0x2e7d4f, 0xe8730c, 0x7b3fb5, 0xf2c230, 0x8a96a3, 0x0f8f86, 0xb0b6bd, 0x5a3825];
function spawnTrip(h) {
  const r = Math.random();
  let o, d, truck = false;
  const morning = h >= 6 && h < 10.5, evening = h >= 15.5 && h < 20.5;
  if (r < .1 && indB.length) { o = indB[(Math.random() * indB.length) | 0]; d = Math.random() < .6 ? pick(shopCum) : pick(jobCum); truck = true }
  else if (morning) { if (r < .78) { o = pick(resCum); d = pick(jobCum) } else { o = pick(resCum); d = pick(shopCum) } }
  else if (evening) { if (r < .75) { o = pick(jobCum); d = pick(resCum) } else { o = pick(shopCum); d = pick(resCum) } }
  else { if (r < .45) { o = pick(resCum); d = pick(shopCum) } else if (r < .75) { o = pick(shopCum); d = pick(resCum) } else { o = pick(jobCum); d = pick(resCum) } }
  if (!o || !d || o === d || o.cut || d.cut) return;
  createCar(o.drive, o.dd, d.drive, OPP[d.dd], true, truck);
}
function spawnTransit() {
  const E = S.entries.filter(c => S.road[c]); if (E.length < 2) return;
  const a = E[(Math.random() * E.length) | 0]; let b = a; while (b === a) b = E[(Math.random() * E.length) | 0];
  createCar(a, entryIn(a), b, OPP[entryIn(b)], false, Math.random() < .2);
}

// ---------------------------------------------------------------- Feux tricolores
const phaseDur = (L, p) => { const g1 = Math.max(6, L.cycle * L.split - 5), g2 = Math.max(6, L.cycle * (1 - L.split) - 5); return [g1, 3, 2, g2, 3, 2][p] };
export function lightState(c, axis) { const L = S.lights.get(c); if (!L) return 'g'; const p = L.p; return axis === 0 ? (p === 0 ? 'g' : p === 1 ? 'y' : 'r') : (p === 3 ? 'g' : p === 4 ? 'y' : 'r') }
// Recale un feu fixe sur l'horloge commune + décalage, pour faire des ondes vertes
export function syncLight(L) {
  if (L.smart) return;
  let tot = 0; for (let p = 0; p < 6; p++) tot += phaseDur(L, p);
  let pos = ((S.simT + L.offset) % tot + tot) % tot;
  for (let p = 0; p < 6; p++) { const d = phaseDur(L, p); if (pos < d) { L.p = p; L.t = pos; return } pos -= d }
}
const qOf = (c, ds) => ds.reduce((a, d) => a + queueLast[c * 4 + d], 0);
function updateLights(dt) {
  for (const [c, L] of S.lights) {
    L.t += dt; let end = L.t >= phaseDur(L, L.p);
    if (L.smart && (L.p === 0 || L.p === 3)) {
      const gA = L.p === 0 ? [2, 3] : [0, 1], oA = L.p === 0 ? [0, 1] : [2, 3], qG = qOf(c, gA), qO = qOf(c, oA);
      if (L.t > 7 && qG === 0 && qO > 0) end = true;
      else if (end && qG > 0 && qO === 0 && L.t < 50) end = false;
    }
    if (end) { L.p = (L.p + 1) % 6; L.t = 0 }
  }
}

// ---------------------------------------------------------------- Règles de passage
function conflicts(d1, o1, d2, o2) {
  if (d1 === d2) return false;
  if (o1 === o2) return true;
  const t1 = turnOf(d1, o1), t2 = turnOf(d2, o2);
  if (t1 === 1 || t2 === 1) return false;
  if (d1 === OPP[d2]) return (t1 >= 2) !== (t2 >= 2) || (t1 === 3 || t2 === 3);
  return true;
}
const buckets = new Map(), appr = new Map(), insideM = new Map();
const EMPTY = [];
function addInside(m, car, din, dout, committed) { let a = insideM.get(m); if (!a) { a = []; insideM.set(m, a) } a.push({ car, din, dout, committed }) }
function exitFree(car, dout, ins) {
  const kk = car.k + 2; if (kk >= car.nodes.length) return true;
  const b = buckets.get(car.nodes[kk] * 8 + dout * 2 + car.lanes[kk]);
  let space = CS;
  if (b && b.length) { const f = b[0]; if (f.v < 2.5) space = f.s - f.len }
  for (const o of ins) if (o.car !== car && o.dout === dout) space -= o.car.len + 2;
  return space > car.len + .5;
}
function oppComing(m, din, car) { const a = appr.get(m * 4 + OPP[din]); return a && a.car !== car && a.dist < 22 && a.car.v > 1.5 }
function grant(car, m, dB) {
  const k = car.k, din = car.douts[k], dout = car.douts[k + 1], c = m % NN, ctl = ctrlOf(m), t = turnOf(din, dout);
  const ins = insideM.get(m) || EMPTY;
  if (!exitFree(car, dout, ins)) return false;
  if (ctl === 'rond') {
    if (ins.length >= 6) return false;
    const aIn = Math.atan2(-DIRS[din][1], -DIRS[din][0]), ox = wx(cx(c)), oz = wz(cy(c));
    for (const o of ins) {
      if (o.car === car || o.committed) continue;
      let df = Math.atan2(o.car.pz - oz, o.car.px - ox) - aIn; while (df < 0) df += TAU; while (df > TAU) df -= TAU;
      if (df > .05 && df < 1.9) return false;
    }
    return true;
  }
  for (const o of ins) if (o.car !== car && conflicts(din, dout, o.din, o.dout)) return false;
  const left = t >= 2;
  if (ctl === 'feux') {
    const st = lightState(c, din >= 2 ? 0 : 1);
    if (st === 'r') return false;
    if (st === 'y' && dB > car.v * car.v / 6 + 3) return false;
    return !(left && oppComing(m, din, car));
  }
  if (ctl === 'stop') {
    const minor = S.stopAxis[c] === 0 ? din < 2 : din >= 2;
    if (minor) {
      if (car.stopT < 1) return false;
      for (const d of (din < 2 ? [2, 3] : [0, 1])) { const a = appr.get(m * 4 + d); if (a && a.dist < 34 && a.car.v > .8) return false }
      return !(left && oppComing(m, din, car));
    }
    return !(left && oppComing(m, din, car));
  }
  if (ctl === 'merge') {
    if (car.nodes[k] < NN) for (let d = 0; d < 4; d++) { if (d === din) continue; const a = appr.get(m * 4 + d); if (a && a.dist < 36 && a.car.v > 1) return false }
    return true;
  }
  // Priorité à droite
  const a = appr.get(m * 4 + LEFT[din]);
  if (a && a.car !== car && a.dist < 24 && !(a.car.v < .5 && car.waitT > 3.5 && ins.length === 0)) return false;
  return !(left && oppComing(m, din, car));
}

// ---------------------------------------------------------------- Pas de simulation
let demAcc = 0, trAcc = 0, lastHour = -1, emaT = 0;
const removeIdx = [];
export function step(dt) {
  S.simT += dt; S.clock += dt * CLOCK;
  if (S.dirty.net) { rebuildAdj(); refreshDrives(); rebuildDemand(); validateCars(); S.dirty.net = false }
  if (S.clock >= S.weather.until) changeWeather();
  updateLights(dt);
  for (let n = 0; n < NODES; n++) if (S.block[n] > 0) S.block[n] = Math.max(0, S.block[n] - dt);
  // Répartition des voitures par voie et approche des carrefours
  buckets.clear(); appr.clear(); insideM.clear(); nodeCnt.fill(0);
  queueLast.set(queueNow); queueNow.fill(0);
  const cars = S.cars;
  for (const car of cars) {
    const k = car.k, n = car.nodes[k];
    nodeCnt[n]++;
    const key = n * 8 + car.trav.din * 2 + car.lanes[k];
    let b = buckets.get(key); if (!b) { b = []; buckets.set(key, b) } b.push(car);
    if (inter[n]) addInside(n, car, car.trav.din, car.trav.dout, false);
    if (car.go >= 0 && car.go === car.nodes[k + 1]) addInside(car.go, car, car.douts[k], car.douts[k + 1], true);
    let dist = car.trav.g.L - car.s;
    for (let j = 1; j <= 2; j++) {
      const kk = k + j; if (kk >= car.nodes.length) break;
      const m = car.nodes[kk];
      if (inter[m]) { const ak = m * 4 + car.douts[kk - 1], a = appr.get(ak); if (!a || dist < a.dist) appr.set(ak, { dist, car }); break }
      dist += CS;
    }
  }
  for (const b of buckets.values()) { if (b.length > 1) b.sort((p, q) => p.s - q.s); for (let i = 0; i < b.length; i++) b[i]._bi = i }
  const wf = S.weather.t === 1 ? .85 : 1, Th = S.weather.t === 1 ? 1.6 : 1.3;
  // Accélérations
  for (const car of cars) {
    const T = car.trav, L = T.g.L, k = car.k, last = car.nodes.length - 1;
    let v0 = vlim(T.n) * wf;
    if (T.rond) v0 = Math.min(v0, 7.5); else if (T.t === 1) v0 = Math.min(v0, 6); else if (T.t === 2) v0 = Math.min(v0, 8); else if (T.t === 3) v0 = Math.min(v0, 4);
    if ((k === last && car.endB) || (k === 0 && car.endB)) v0 = Math.min(v0, 6);
    let gap = 1e9, vl = 0;
    const b = buckets.get(T.n * 8 + T.din * 2 + car.lanes[k]), i = car._bi;
    if (i + 1 < b.length) { const l = b[i + 1]; gap = l.s - car.s - l.len; vl = l.v }
    else {
      let dist = L - car.s;
      for (let j = 1; j <= 2; j++) {
        const kk = k + j; if (kk > last) break;
        const b2 = buckets.get(car.nodes[kk] * 8 + car.douts[kk - 1] * 2 + car.lanes[kk]);
        if (b2 && b2.length) { const l = b2[0]; gap = dist + l.s - l.len; vl = l.v; break }
        dist += CS;
      }
    }
    car.waiting = false;
    if (k < last) {
      const m = car.nodes[k + 1], dB = L - car.s;
      if (S.block[m] > 0) { if (dB - 1 < gap) { gap = dB - 1; vl = 0 } }
      else if (inter[m] && car.go !== m && i + 1 >= b.length && dB < 36) {
        if (car.v < .3 && dB < 5) car.stopT += dt;
        if (grant(car, m, dB)) {
          car.go = m; addInside(m, car, car.douts[k], car.douts[k + 1], true);
          const wk = m * 4 + car.douts[k]; waitE[wk] += (car.waitT - waitE[wk]) * .15;
          maybeAccident(m);
        } else {
          if (dB - 1.2 < gap) { gap = dB - 1.2; vl = 0 }
          car.waiting = true;
        }
      }
      if (inter[m] && car.v < 1) queueNow[m * 4 + car.douts[k]]++;
    }
    const A = car.truck ? 1.0 : 1.7, B = 2.8, dv = car.v - vl;
    const ss = 2.2 + Math.max(0, car.v * Th + car.v * dv / (2 * Math.sqrt(A * B)));
    let acc = A * (1 - Math.pow(car.v / Math.max(v0, .5), 4) - (ss / Math.max(gap, .1)) ** 2);
    car.a = acc < -9 ? -9 : acc; car.gap = gap;
  }
  // Intégration et changements de case
  removeIdx.length = 0;
  let fsum = 0;
  for (let idx = 0; idx < cars.length; idx++) {
    const car = cars[idx];
    let v = car.v + car.a * dt; if (v < 0) v = 0;
    let mv = v * dt;
    if (car.gap < .4) { mv = 0; v = 0 } else if (mv > car.gap - .3) mv = Math.max(0, car.gap - .3);
    car.v = v; car.s += mv;
    if (v < .3) { car.waitT += dt; car.idle += dt } else car.idle = 0;
    if (v > 2) fsum++;               // fluidité : part des voitures qui roulent
    spdAcc[car.trav.n] += clamp(v / vlim(car.trav.n), 0, 1); spdN[car.trav.n]++;
    if (car.idle > 100) { endTrip(car, false); removeIdx.push(idx); continue }
    const last = car.nodes.length - 1;
    let gone = false;
    while (true) {
      const L = car.trav.g.L;
      if (car.k === last) { if (car.s >= L * (car.endB ? .55 : 1)) { endTrip(car, true); gone = true } break }
      if (car.s < L) break;
      car.s -= L;
      if (car.go === car.nodes[car.k]) car.go = -1;
      car.k++; car.waitT = 0; car.stopT = 0;
      makeTrav(car, car.k);
      if (--car.rr <= 0) { car.rr = 5 + ((Math.random() * 4) | 0); reroute(car) }
    }
    if (gone) removeIdx.push(idx);
  }
  for (let j = removeIdx.length - 1; j >= 0; j--) { const i = removeIdx[j]; cars[i] = cars[cars.length - 1]; cars.pop() }
  // Statistiques lissées
  if (cars.length) S.flu += (fsum / cars.length - S.flu) * .004;
  emaT += dt;
  if (emaT >= 1) {
    for (let n = 0; n < NODES; n++) {
      if (spdN[n]) spdE[n] += (spdAcc[n] / spdN[n] - spdE[n]) * .25; else spdE[n] += (1 - spdE[n]) * .05;
      spdAcc[n] = 0; spdN[n] = 0;
    }
    for (let i = 0; i < waitE.length; i++) if (waitE[i]) waitE[i] *= .97;
    emaT = 0;
  }
  // Nouveaux départs
  const h = hour(), tod = todF(h);
  demAcc += R.res * DEMAND * tod * dt; while (demAcc >= 1) { demAcc--; spawnTrip(h) }
  trAcc += .1 * tod * dt; while (trAcc >= 1) { trAcc--; spawnTransit() }
  const hr = Math.floor(S.clock / 3600);
  if (hr !== lastHour) { if (lastHour >= 0) hourTick(hr); lastHour = hr }
}
let rrBudget = 0, rrT = 0;
function reroute(car) {
  if (S.simT - rrT > .05) { rrT = S.simT; rrBudget = 25 }
  if (rrBudget <= 0) return; rrBudget--;
  const k = car.k; if (k + 2 >= car.nodes.length || car.go === car.nodes[k + 1]) return;
  const p = findPath(car.nodes[k + 1], car.douts[k], car.goal); if (!p) return;
  const fd = car.douts[car.douts.length - 1];
  p.douts.push(fd);
  car.nodes = car.nodes.slice(0, k + 1).concat(p.nodes);
  car.douts = car.douts.slice(0, k + 1).concat(p.douts);
  car.lanes.length = k + 2;
  assignLanes(car, k + 2);
}
function endTrip(car, ok) {
  let s = 0;
  if (ok) { S.stats.trips++; s = clamp(car.ideal / Math.max(1, S.simT - car.t0) * 1.3, 0, 1) }
  else S.stats.failed++;
  S.sat += (s - S.sat) * .004;
}
function maybeAccident(m) {
  const ctl = ctrlOf(m), f = { prio: 3, stop: 1.2, feux: .8, rond: .5, merge: 1.5 }[ctl];
  if (Math.random() < .00009 * f * (S.weather.t === 1 ? 2.2 : 1) && S.block.reduce((a, b) => a + (b > 0), 0) < 3) {
    S.block[m] = 90; toast('Accident !', 'bad', m % NN);
  }
}
// Après un changement du réseau, chaque voiture vérifie que sa route existe encore
function validateCars() {
  const valid = n => n < NN ? S.road[n] > 0 : S.roc[n - NN] > 0;
  const hasEdge = (a, b, d) => adj[a].some(e => e[0] === b && e[1] === d);
  for (let i = S.cars.length - 1; i >= 0; i--) {
    const car = S.cars[i], k = car.k;
    let ok = valid(car.nodes[k]);
    if (ok && k < car.nodes.length - 1) {
      if (!hasEdge(car.nodes[k], car.nodes[k + 1], car.douts[k])) ok = false;
      else {
        let broken = false;
        for (let j = k + 1; j < car.nodes.length - 1; j++) if (!hasEdge(car.nodes[j], car.nodes[j + 1], car.douts[j])) { broken = true; break }
        if (broken) {
          const p = findPath(car.nodes[k + 1], car.douts[k], car.goal);
          if (!p) ok = false;
          else { p.douts.push(car.douts[car.douts.length - 1]); car.nodes = car.nodes.slice(0, k + 1).concat(p.nodes); car.douts = car.douts.slice(0, k + 1).concat(p.douts); car.lanes.length = k + 2; assignLanes(car, k + 2) }
        }
      }
    }
    if (!ok) { S.cars[i] = S.cars[S.cars.length - 1]; S.cars.pop(); continue }
    car.go = -1; makeTrav(car, k); car.s = Math.min(car.s, car.trav.g.L - .01);
  }
}

// ---------------------------------------------------------------- Économie, météo, objectifs
export function upkeepPerDay() {
  let u = 0;
  for (let c = 0; c < NN; c++) {
    if (S.road[c]) u += RT[S.road[c]].up;
    if (S.roc[c]) u += RC.up + (S.ech[c] ? 30 : 0);
    if (S.ctrl[c] === 2) u += 15; else if (S.ctrl[c] === 3) u += 10;
  }
  for (const L of S.lights.values()) if (L.smart) u += 10;
  return u;
}
export const incomePerHour = () => (R.res * .05 + R.jobs * .06) * (.4 + S.sat);
function hourTick(hr) {
  const inc = incomePerHour(), up = upkeepPerDay() / 24;
  earn(inc); spend(up);
  if (hr % 24 === 0) {
    const net = S.today.inc - S.today.exp;
    S.history.push({ d: dayNum() - 1, net }); if (S.history.length > 30) S.history.shift();
    toast(`Jour ${dayNum() - 1} : ${net >= 0 ? '+' : ''}${Math.round(net).toLocaleString('fr-FR')} €`, net >= 0 ? 'gold' : 'bad');
    S.today = { inc: 0, exp: 0 };
    const n = S.sat > .45 ? Math.round((S.sat - .4) * 22) : 0;
    if (n > 0 && grow(n) > 0) { S.dirty.map = true; rebuildDemand(); toast(`+${n} bâtiments`, 'ok') }
    S.on.change('day');
  }
}
function changeWeather() {
  const r = Math.random(), old = S.weather.t;
  S.weather.t = r < .65 ? 0 : r < .87 ? 1 : 2;
  S.weather.until = S.clock + 3600 * (2 + Math.random() * 6);
  if (S.weather.t !== old && S.weather.t) toast(S.weather.t === 1 ? 'Pluie' : 'Brouillard', 'warn');
}
export function makeObjectives() {
  const P = Math.round(R.res / 1000) * 1000;
  // Les feux et stops déjà en place au départ ne comptent pas
  const f0 = cnt(c => S.ctrl[c] === 2 && inter[c]), s0 = cnt(c => S.ctrl[c] === 1 && inter[c]);
  return [
    { k: 'feux', n: f0 + 2, t: '2 nouveaux carrefours à feux', r: 2000 },
    { k: 'stop', n: s0 + 3, t: '3 nouveaux stops', r: 1500 },
    { k: 'ow', n: 4, t: '4 rues en sens unique', r: 1500 },
    { k: 'rond', n: 1, t: '1 rond-point', r: 3000 },
    { k: 'flu', n: .62, t: 'Fluidité 62 % en heure de pointe', r: 5000 },
    { k: 'roc', n: 20, t: '20 tronçons de rocade', r: 8000 },
    { k: 'ech', n: 2, t: '2 échangeurs', r: 6000 },
    { k: 'smart', n: 2, t: '2 feux intelligents', r: 4000 },
    { k: 'trips', n: 5000, t: '5 000 trajets', r: 8000 },
    { k: 'pop', n: P * 1.3, t: `${Math.round(P * 1.3).toLocaleString('fr-FR')} habitants`, r: 12000 },
    { k: 'flu', n: .72, t: 'Fluidité 72 % en heure de pointe', r: 12000 },
    { k: 'pop', n: P * 1.8, t: `${Math.round(P * 1.8).toLocaleString('fr-FR')} habitants`, r: 25000 },
  ].map(o => ({ ...o, done: false }));
}
const cnt = f => { let n = 0; for (let c = 0; c < NN; c++) if (f(c)) n++; return n };
export function objProgress(o) {
  const peak = (h => (h >= 7.5 && h < 9.5) || (h >= 17 && h < 19))(hour());
  switch (o.k) {
    case 'feux': return cnt(c => S.ctrl[c] === 2 && inter[c]) / o.n;
    case 'stop': return cnt(c => S.ctrl[c] === 1 && inter[c]) / o.n;
    case 'ow': return cnt(c => S.oneway[c] >= 0 && S.road[c]) / o.n;
    case 'rond': return cnt(c => S.ctrl[c] === 3 && inter[c]) / o.n;
    case 'flu': return peak && S.cars.length > 60 ? S.flu / o.n : Math.min(.99, S.flu / o.n);
    case 'roc': return cnt(c => S.roc[c]) / o.n;
    case 'ech': return cnt(c => S.ech[c]) / o.n;
    case 'smart': { let n = 0; for (const L of S.lights.values()) if (L.smart) n++; return n / o.n }
    case 'trips': return S.stats.trips / o.n;
    case 'pop': return R.res / o.n;
  }
  return 0;
}
export const objDone = () => S.objectives.filter(o => o.done).length;
export const unlocked = k => objDone() >= ({ roc: 2, ech: 2, smart: 4 }[k] ?? 0);
export function checkObjectives() {
  const o = S.objectives.find(o => !o.done); if (!o) return null;
  if (objProgress(o) >= 1) { o.done = true; earn(o.r); return o }
  return null;
}
export function resetSimCaches() { spdE.fill(1); waitE.fill(0); queueNow.fill(0); queueLast.fill(0); lastHour = -1; demAcc = 0; trAcc = 0 }
