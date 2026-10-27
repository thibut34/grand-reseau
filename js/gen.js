// Génération de la ville de départ et croissance des quartiers.
import { S, G, NN, DIRS, cx, cy, cellOf, inGrid, mulberry32, hsh, BT, rebuildAdj } from './state.js';

const C = G / 2;
export const distC = c => Math.hypot(cx(c) - C, cy(c) - C);

function roadNeighbor(c) {
  const x = cx(c), y = cy(c);
  // On préfère une rue à une avenue pour l'accès des voitures
  let best = -1, bd = -1;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (!inGrid(nx, ny)) continue;
    const n = cellOf(nx, ny);
    if (S.road[n]) { if (best < 0 || S.road[n] < S.road[best]) { best = n; bd = d } }
  }
  return best < 0 ? null : { n: best, d: bd };
}

function zoneType(c, r) {
  const d = distC(c), x = cx(c), y = cy(c);
  if (x > C + 3 && y > C + 3 && d > 7.5) return 4;
  if (d < 5.2) return r < .72 ? 2 : 3;
  if (d < 10) return r < .58 ? 1 : r < .8 ? 3 : 2;
  return r < .82 ? 0 : r < .92 ? 3 : 1;
}

export function addBuilding(c, type, rnd = Math.random) {
  const rn = roadNeighbor(c); if (!rn) return null;
  const d = distC(c), k = hsh(c, 7);
  let h;
  if (type === 0) h = 4.6;
  else if (type === 1) h = 11 + k * 12 + Math.max(0, 9 - d) * 1.6;
  else if (type === 2) h = 20 + k * 22 + Math.max(0, 6 - d) * 9;
  else if (type === 3) h = 5 + k * 2;
  else h = 8 + k * 4;
  const b = { c, type, h, dd: rn.d, drive: rn.n, seed: rnd() };
  S.buildings.push(b); S.bld[c] = S.buildings.length - 1;
  return b;
}
export function reindexBuildings() {
  S.bld.fill(-1);
  S.buildings.forEach((b, i) => { S.bld[b.c] = i });
}
export function removeBuilding(c) {
  const i = S.bld[c]; if (i < 0) return;
  S.buildings.splice(i, 1); reindexBuildings();
}
// Après une modification des routes : chaque bâtiment retrouve un accès
export function refreshDrives() {
  for (const b of S.buildings) {
    const rn = roadNeighbor(b.c);
    if (rn) { b.drive = rn.n; b.dd = rn.d; b.cut = false } else b.cut = true;
  }
}

export function genCity(seed) {
  S.seed = seed;
  const r = mulberry32(seed);
  for (const k of ['road', 'z30', 'roc', 'ech', 'ctrl', 'stopAxis', 'park']) S[k].fill(0);
  S.oneway.fill(-1); S.bld.fill(-1); S.block.fill(0);
  S.buildings = []; S.lights = new Map();
  for (let c = 0; c < NN; c++) {
    const x = cx(c), y = cy(c), d = distC(c);
    if (x === C || y === C) S.road[c] = 2;
    else if (d <= 14.6 && (x % 5 === 0 || y % 5 === 0)) S.road[c] = 1;
  }
  // Quartiers périphériques moins réguliers : quelques tronçons manquent
  for (let line = 0; line < G; line += 5) for (let seg = 0; seg < G; seg += 5) {
    for (const horiz of [true, false]) {
      const mx = horiz ? seg + 2 : line, my = horiz ? line : seg + 2;
      if (line === C || !inGrid(mx, my) || distC(cellOf(mx, my)) < 8.5 || r() > .2) continue;
      for (let k = 1; k < 5; k++) { const x = horiz ? seg + k : line, y = horiz ? line : seg + k; if (inGrid(x, y)) S.road[cellOf(x, y)] = 0 }
    }
  }
  // On ne garde que ce qui est relié au centre
  const seen = new Uint8Array(NN), q = [cellOf(C, C)]; seen[q[0]] = 1;
  while (q.length) { const c = q.pop(); for (const [dx, dy] of DIRS) { const x = cx(c) + dx, y = cy(c) + dy; if (!inGrid(x, y)) continue; const n = cellOf(x, y); if (S.road[n] && !seen[n]) { seen[n] = 1; q.push(n) } } }
  for (let c = 0; c < NN; c++) if (S.road[c] && !seen[c]) S.road[c] = 0;
  // Bâtiments, parcs
  for (let c = 0; c < NN; c++) {
    if (S.road[c]) continue;
    const d = distC(c);
    if (d > 15.5) continue;
    if (roadNeighbor(c)) addBuilding(c, zoneType(c, r()), r);
    else if (d < 15) S.park[c] = 1;
  }
  S.entries = [cellOf(C, 0), cellOf(C, G - 1), cellOf(0, C), cellOf(G - 1, C)];
  // Signalisation de départ : stops sur les rues qui croisent les avenues, feux aux grands carrefours.
  // Les quartiers restent en priorité à droite : c'est au joueur de les améliorer.
  rebuildAdj();
  for (let c = 0; c < NN; c++) {
    if (!S.road[c]) continue;
    const x = cx(c), y = cy(c);
    let n = 0; for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (inGrid(nx, ny) && S.road[cellOf(nx, ny)]) n++ }
    if (n < 3) continue;
    if (x === C && y === C) setCtrl(c, 2);
    else if ((x === C && Math.abs(y - C) === 5) || (y === C && Math.abs(x - C) === 5)) { setCtrl(c, 2); S.lights.get(c).split = x === C ? .62 : .38 }
    else if (x === C) { setCtrl(c, 1); S.stopAxis[c] = 0 }
    else if (y === C) { setCtrl(c, 1); S.stopAxis[c] = 1 }
  }
  rebuildAdj();
}

export function setCtrl(c, k) {
  S.ctrl[c] = k;
  if (k === 2 && !S.lights.has(c)) S.lights.set(c, { cycle: 60, split: .5, offset: 0, smart: 0, p: 0, t: 0 });
  if (k !== 2) S.lights.delete(c);
}

// Croissance quotidienne : de nouveaux bâtiments le long des routes
export function grow(n) {
  const cand = [];
  for (let c = 0; c < NN; c++) {
    if (S.road[c] || S.roc[c] || S.ech[c] || S.bld[c] >= 0 || S.park[c]) continue;
    if (distC(c) > 19 || !roadNeighbor(c)) continue;
    cand.push(c);
  }
  let added = 0;
  for (let k = 0; k < n && cand.length; k++) {
    const j = (Math.random() * cand.length) | 0, c = cand.splice(j, 1)[0];
    if (addBuilding(c, zoneType(c, Math.random()))) added++;
  }
  return added;
}
