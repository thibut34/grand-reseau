// Démarrage, boucle principale, sauvegarde.
import { S, NN, rebuildAdj } from './state.js';
import { genCity, reindexBuildings, refreshDrives } from './gen.js';
import { step, rebuildDemand, makeObjectives, resetSimCaches, syncLight } from './sim.js';
import { initRender, buildCity, frame, setQuality, V, focus } from './render.js';
import { U, toast, buildDock, setTool, select, updateHud, tickUi, initInput, modal, closeModal, setSpeed } from './ui.js';

const SAVE_KEY = 'grandReseauVille.v1';
const api = {};
S.on.toast = toast;
S.on.change = k => { if (k === 'day') save(true) };

function hasSave() { try { return !!localStorage.getItem(SAVE_KEY) } catch (e) { return false } }
function save(auto) {
  const arr = a => Array.from(a);
  const d = {
    v: 1, seed: S.seed, money: S.money, clock: S.clock, simT: S.simT, stats: S.stats, sat: S.sat, objectives: S.objectives, weather: S.weather, history: S.history, today: S.today,
    road: arr(S.road), oneway: arr(S.oneway), z30: arr(S.z30), roc: arr(S.roc), ech: arr(S.ech), ctrl: arr(S.ctrl), stopAxis: arr(S.stopAxis), park: arr(S.park),
    lights: [...S.lights.entries()], buildings: S.buildings.map(b => ({ c: b.c, type: b.type, h: b.h, seed: b.seed })), entries: S.entries,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); if (!auto) toast('Sauvegardé', 'ok') } catch (e) { if (!auto) toast('Sauvegarde impossible', 'bad') }
}
function load() {
  let d; try { d = JSON.parse(localStorage.getItem(SAVE_KEY)) } catch (e) { d = null }
  if (!d || d.v !== 1) return false;
  try {
    for (const k of ['road', 'oneway', 'z30', 'roc', 'ech', 'ctrl', 'stopAxis', 'park']) S[k].set(d[k]);
    Object.assign(S, { seed: d.seed, money: d.money, clock: d.clock, simT: d.simT, stats: d.stats, sat: d.sat, objectives: d.objectives, weather: d.weather, history: d.history || [], today: d.today || { inc: 0, exp: 0 }, entries: d.entries });
    S.lights = new Map(d.lights);
    S.buildings = d.buildings.map(b => ({ ...b, dd: 0, drive: 0 })); reindexBuildings();
    S.block.fill(0);
    start();
    return true;
  } catch (e) { console.error(e); toast('Sauvegarde abîmée', 'bad'); return false }
}
function start() {
  S.cars = []; resetSimCaches();
  rebuildAdj(); refreshDrives(); rebuildDemand();
  for (const L of S.lights.values()) syncLight(L);
  S.dirty.net = false; S.dirty.map = true;
  buildDock(); setTool('inspect'); select(-1); updateHud();
  U.paused = false;
}
function newGame() {
  genCity((Math.random() * 2 ** 31) | 0);
  Object.assign(S, { money: 40000, clock: 6.5 * 3600, simT: 0, stats: { trips: 0, failed: 0, unreach: 0 }, sat: .6, flu: 1, history: [], today: { inc: 0, exp: 0 }, weather: { t: 0, until: 11 * 3600 } });
  rebuildAdj(); refreshDrives(); rebuildDemand();
  S.objectives = makeObjectives();
  start();
}
Object.assign(api, { save, newGame });

// ---------------------------------------------------------------- Lancement
const cv = document.getElementById('cv');
try { initRender(cv) } catch (e) {
  console.error(e);
  document.getElementById('boot').innerHTML = '<p>La 3D ne démarre pas sur cet appareil (WebGL indisponible).</p>';
  throw e;
}
document.getElementById('boot').remove();
try { const q = localStorage.getItem('grandReseauVille.q'); if (q === '0') { S.quality = 0; setQuality(0) } } catch (e) { }
initInput(api);
newGame(); U.paused = true;
const PICTOS = `<div class="picto">
  <div><svg width="44" height="34" viewBox="0 0 44 34" fill="none"><rect x="2" y="2" width="40" height="30" rx="6" stroke="currentColor" stroke-width="1.6" opacity=".35"/><path d="M8 26V10h28" stroke="#cfcac0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="26" r="3" fill="#f5cf4f"/><circle cx="36" cy="10" r="3" fill="#f5cf4f"/></svg>Glisser = route</div>
  <div><svg width="18" height="34" viewBox="0 0 14 26"><rect x="1" y="1" width="12" height="24" rx="4" fill="#1d2025"/><circle cx="7" cy="6.5" r="3" fill="#ff4a3d"/><circle cx="7" cy="13" r="3" fill="#ffb52e"/><circle cx="7" cy="19.5" r="3" fill="#3ddc84"/></svg>Clic = carrefour</div>
  <div><svg width="30" height="34" viewBox="0 0 30 34" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="2" width="24" height="30" rx="12"/><path d="M15 2v12M3 14h24"/><path d="M15 2h0a12 12 0 0 1 12 12H15z" fill="#f5cf4f" stroke="none"/></svg>Clic droit = déplacer</div></div>`;
const intro = () => modal(`<div class="signs"><span style="background:#2f6fd6">A 12</span><span style="background:#dc4437">N 7</span><span style="background:#c9a21d">D 104</span></div>
  <h1>Grand Réseau</h1><p class="sub">Feux, stops, ronds-points, rocade. La ville compte sur vous.</p>${PICTOS}
  <div class="mbtn">${hasSave() ? '<button class="ab y" id="mCont">Continuer</button><button class="ab" id="mNew">Nouvelle ville</button>' : '<button class="ab y" id="mNew">Jouer</button>'}</div>
  <p style="margin:18px 0 0;display:flex;gap:16px;justify-content:center"><a href="region.html">Mode région</a><a href="classique.html">Version 2D</a></p>`,
  { mCont: () => { closeModal(); if (!load()) newGame() }, mNew: () => { closeModal(); newGame() } }, () => { U.paused = false; updateHud() });
intro();

const PHYS = 1 / 30;
let last = performance.now(), acc = 0, lastBuild = 0, lastUi = 0;
function loop(now) {
  const rdt = Math.min(.1, (now - last) / 1000); last = now;
  if (!U.paused) {
    acc += rdt * U.speed; let n = 0;
    while (acc >= PHYS && n < 14) { step(PHYS); acc -= PHYS; n++ }
    if (n >= 14) acc = 0;
  }
  if (api.keysTick) api.keysTick(rdt);
  if (S.dirty.map && now - lastBuild > 120) { lastBuild = now; buildCity() }
  frame(now, rdt, U);
  if (now - lastUi > 250) { lastUi = now; tickUi() }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
if (/debug/.test(location.search)) window.__g = { S, U, V, focus, step, save, load, newGame, setSpeed };
