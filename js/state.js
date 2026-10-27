// État partagé de la ville : grille, réseau, bâtiments, argent, horloge.
export const G = 40;            // cases par côté
export const CS = 14;           // taille d'une case en mètres
export const H2 = CS / 2;
export const NN = G * G;        // cases au sol ; les nœuds NN.. sont la rocade surélevée
export const NODES = NN * 2;
export const RH = 6.5;          // hauteur de la rocade
export const CLOCK = 48;        // secondes d'horloge par seconde de simulation

export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // E, O, S, N  (z vers le sud)
export const OPP = [1, 0, 3, 2];
export const RIGHT = [2, 3, 1, 0];
export const LEFT = [3, 2, 0, 1];
// 0 tout droit, 1 droite, 2 gauche, 3 demi-tour
export const turnOf = (a, b) => b === a ? 0 : b === RIGHT[a] ? 1 : b === LEFT[a] ? 2 : 3;

export const RT = {
  1: { name: 'Rue', w: 7, lanes: [1.75], v: 13.9, cost: 200, up: 2 },
  2: { name: 'Avenue', w: 12, lanes: [1.5, 4.5], v: 13.9, cost: 600, up: 5 },
};
export const RC = { name: 'Rocade', w: 12, lanes: [1.5, 4.5], v: 25, cost: 900, up: 10 };
export const COST = { feux: 2000, smart: 1500, stop: 200, rond: 3500, prio: 0, oneway: 100, z30: 250, ech: 3000, tow: 400 };
export const CTRL = ['prio', 'stop', 'feux', 'rond'];
export const BT = [
  { n: 'Maison', res: 5, jobs: 0, exp: 1500 },
  { n: 'Immeuble', res: 60, jobs: 4, exp: 6000 },
  { n: 'Bureaux', res: 0, jobs: 120, exp: 15000 },
  { n: 'Commerces', res: 0, jobs: 20, shop: 1, exp: 3000 },
  { n: 'Usine', res: 0, jobs: 80, ind: 1, exp: 8000 },
];

export const cx = c => c % G, cy = c => (c / G) | 0;
export const cellOf = (x, y) => y * G + x;
export const inGrid = (x, y) => x >= 0 && y >= 0 && x < G && y < G;
export const wx = x => (x - G / 2 + .5) * CS;
export const wz = y => (y - G / 2 + .5) * CS;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
export function hsh(i, k) { let h = Math.imul(i * 374761393 + k * 668265263 | 0, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ h >>> 16) >>> 0) / 4294967296 }

export const S = {
  seed: 0,
  road: new Uint8Array(NN),        // 0 rien, 1 rue, 2 avenue
  oneway: new Int8Array(NN),       // -1 double sens, sinon direction autorisée
  z30: new Uint8Array(NN),
  roc: new Uint8Array(NN),         // rocade surélevée
  ech: new Uint8Array(NN),         // échangeur sur une case de rocade
  ctrl: new Uint8Array(NN),        // 0 priorité à droite, 1 stop, 2 feux, 3 rond-point
  stopAxis: new Uint8Array(NN),    // 0 : stops sur les branches est-ouest ; 1 : sur nord-sud
  lights: new Map(),               // case -> réglages et état des feux
  bld: new Int32Array(NN),         // indice du bâtiment, -1 sinon
  park: new Uint8Array(NN),
  buildings: [],
  entries: [],
  block: new Float32Array(NODES),  // accident : secondes restantes
  money: 0, simT: 0, clock: 0,
  stats: { trips: 0, failed: 0, unreach: 0 },
  hourAcc: { inc: 0, exp: 0 }, today: { inc: 0, exp: 0 }, history: [],
  sat: .6, flu: 1, objectives: [], weather: { t: 0, until: 0 },
  cars: [], heat: false, quality: 1,
  dirty: { net: true, map: true },
  on: { toast: () => { }, change: () => { } },
};
S.oneway.fill(-1); S.bld.fill(-1);

export const hour = () => (S.clock / 3600) % 24;
export const dayNum = () => Math.floor(S.clock / 86400) + 1;
export function earn(v) { S.money += v; S.today.inc += v }
export function spend(v) { S.money -= v; S.today.exp += v }
export const toast = (t, k, cell) => S.on.toast(t, k, cell);

// ---------------------------------------------------------------- Réseau
export const adj = new Array(NODES);
export const deg = new Uint8Array(NODES);
export const inter = new Uint8Array(NODES);
const owOK = (a, b, d) => (S.oneway[a] < 0 || S.oneway[a] === d) && (S.oneway[b] < 0 || S.oneway[b] === d);
export function connDirs(c, elevated) {
  // directions physiquement reliées (sans tenir compte des sens uniques)
  const x = cx(c), y = cy(c), out = [];
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (!inGrid(nx, ny)) continue;
    const n = cellOf(nx, ny);
    if (!elevated) { if (S.road[n] || (S.roc[n] && S.ech[n])) out.push(d) }
    else { if (S.roc[n] || (S.ech[c] && S.road[n])) out.push(d) }
  }
  return out;
}
export function rebuildAdj() {
  for (let n = 0; n < NODES; n++) { adj[n] = []; deg[n] = 0; inter[n] = 0 }
  for (let c = 0; c < NN; c++) {
    const x = cx(c), y = cy(c);
    if (S.road[c]) {
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (!inGrid(nx, ny)) continue;
        const n = cellOf(nx, ny);
        if (S.road[n]) { deg[c]++; if (owOK(c, n, d)) adj[c].push([n, d]) }
        else if (S.roc[n] && S.ech[n]) { deg[c]++; if (S.oneway[c] < 0 || S.oneway[c] === d) adj[c].push([NN + n, d]) }
      }
      inter[c] = deg[c] >= 3 || (S.ctrl[c] === 3 && deg[c] >= 2) ? 1 : 0;
    }
    if (S.roc[c]) {
      const m = NN + c;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (!inGrid(nx, ny)) continue;
        const n = cellOf(nx, ny);
        if (S.roc[n]) { deg[m]++; adj[m].push([NN + n, d]) }
        else if (S.ech[c] && S.road[n]) { deg[m]++; if (S.oneway[n] < 0 || S.oneway[n] === d) adj[m].push([n, d]) }
      }
      inter[m] = deg[m] >= 3 ? 1 : 0;
    }
  }
}
export const ctrlOf = n => n >= NN ? 'merge' : CTRL[S.ctrl[n]];
export const vlim = n => n >= NN ? RC.v : S.z30[n] ? 8.3 : 13.9;
export function laneOff(n, lane) {
  if (n >= NN) return RC.lanes[Math.min(lane, 1)];
  const r = RT[S.road[n]] || RT[1];
  return r.lanes[Math.min(lane, r.lanes.length - 1)];
}
export const lanesOf = n => n >= NN ? 2 : (RT[S.road[n]] || RT[1]).lanes.length;
