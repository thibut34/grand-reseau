// Interface : outils, fiche de sélection, barre d'infos, fenêtres. Très peu de texte, des icônes.
import { S, G, NN, CS, DIRS, OPP, RT, RC, COST, BT, CTRL, cx, cy, cellOf, inGrid, earn, spend, connDirs, inter, deg, clamp, hour, dayNum, rebuildAdj } from './state.js';
import { setCtrl, removeBuilding, refreshDrives } from './gen.js';
import { syncLight, unlocked, objProgress, objDone, checkObjectives, totals, waitE, spdE, incomePerHour } from './sim.js';
import { cellAt, focus, panBy, rotateBy, setPanMode, setQuality } from './render.js';

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString('fr-FR');
const eur = n => fmt(n) + ' €';
export const U = { tool: 'inspect', sel: -1, selEl: false, hover: -1, hoverEl: false, preview: null, paused: false, speed: 1, lastSpeed: 1, muted: false, drag: null };
const ELEV_TOOLS = ['roc', 'ech'];

// ---------------------------------------------------------------- Sons
let actx = null;
function initAudio() { if (actx) return; try { actx = new (window.AudioContext || window.webkitAudioContext)() } catch (e) { actx = null } }
function beep(f, d, type = 'sine', vol = .05) { if (!actx || U.muted) return; try { const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d) } catch (e) { } }
export const sfx = { build() { beep(520, .07, 'square', .022); setTimeout(() => beep(390, .06, 'square', .018), 50) }, coin() { beep(880, .08); setTimeout(() => beep(1320, .14), 70) }, err() { beep(190, .12, 'square', .022) }, bad() { beep(150, .3, 'sawtooth', .03) } };

// ---------------------------------------------------------------- Messages
export function toast(text, kind = '', cell = -1) {
  const el = document.createElement('div'); el.className = 'toast chip ' + kind + (cell >= 0 ? ' click' : ''); el.textContent = text;
  if (cell >= 0) el.onclick = () => { focus(cell, 120); select(cell) };
  const box = $('#toasts'); box.prepend(el); while (box.children.length > 4) box.lastChild.remove();
  if (kind === 'bad') sfx.bad();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320) }, 4200);
}

// ---------------------------------------------------------------- Icônes
const I = {
  inspect: '<svg width="22" height="22" viewBox="0 0 20 20"><path d="M4 2l11 7-5 1.2L13 17l-2 1-3-6.6L4 14z" fill="currentColor"/></svg>',
  pan: '<svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M10 2v16M2 10h16M10 2l-2.5 2.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5"/></svg>',
  rue: '<svg width="30" height="22" viewBox="0 0 30 22"><rect width="30" height="22" rx="5" fill="#5d8f3c"/><rect y="5" width="30" height="12" fill="#cfcac0"/><rect y="7" width="30" height="8" fill="#4a4c51"/><path d="M2 11h26" stroke="#fff" stroke-width="1" stroke-dasharray="3 2.5"/></svg>',
  avenue: '<svg width="30" height="22" viewBox="0 0 30 22"><rect width="30" height="22" rx="5" fill="#5d8f3c"/><rect y="2" width="30" height="18" fill="#4a4c51"/><path d="M0 10.4h30M0 11.6h30" stroke="#fff" stroke-width=".8"/><path d="M1 6h28M1 16h28" stroke="#fff" stroke-width=".8" stroke-dasharray="3 2.5"/></svg>',
  roc: '<svg width="30" height="24" viewBox="0 0 30 24"><rect x="0" y="4" width="30" height="7" fill="#505257"/><rect x="0" y="11" width="30" height="2.5" fill="#b4b1aa"/><rect x="5" y="13" width="3" height="10" fill="#b4b1aa"/><rect x="22" y="13" width="3" height="10" fill="#b4b1aa"/><path d="M1 7.5h28" stroke="#fff" stroke-width=".8" stroke-dasharray="3 2"/></svg>',
  ech: '<svg width="28" height="24" viewBox="0 0 28 24"><rect x="0" y="3" width="28" height="5" fill="#505257"/><path d="M14 8 L26 21 H18 L10 8z" fill="#6a6c72"/><rect x="0" y="20" width="28" height="3" fill="#4a4c51"/></svg>',
  ow: '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#c8241f"/><rect x="5" y="10" width="14" height="4" fill="#fff"/></svg>',
  z30: '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#fff" stroke="#c8241f" stroke-width="3"/><text x="12" y="16.3" text-anchor="middle" font-size="11" font-weight="800" font-family="Barlow,sans-serif" fill="#111">30</text></svg>',
  feux: '<svg width="14" height="26" viewBox="0 0 14 26"><rect x="1" y="1" width="12" height="24" rx="4" fill="#1d2025"/><circle cx="7" cy="6.5" r="3" fill="#ff4a3d"/><circle cx="7" cy="13" r="3" fill="#ffb52e"/><circle cx="7" cy="19.5" r="3" fill="#3ddc84"/></svg>',
  stop: '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M8 1h8l7 7v8l-7 7H8l-7-7V8z" fill="#c8241f" stroke="#fff" stroke-width="1.4"/><text x="12" y="15" text-anchor="middle" font-size="6.6" font-weight="800" font-family="Barlow,sans-serif" fill="#fff">STOP</text></svg>',
  rond: '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#2f6fd6"/><g fill="none" stroke="#fff" stroke-width="2"><path d="M12 5a7 7 0 0 1 6.5 4.5"/><path d="M18.4 15a7 7 0 0 1-9.2 3.6"/><path d="M5.6 15.5A7 7 0 0 1 8 6"/></g><path d="M19.8 7.3l-.6 3.8-3.4-1.8zM7 21l-1.2-3.7 3.8-.3zM6 3.4l3.6 1.6-2.7 2.6z" fill="#fff"/></svg>',
  prio: '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2l10 18H2z" fill="#fff" stroke="#c8241f" stroke-width="2.4" stroke-linejoin="round"/><path d="M12 8v8M8.5 12h7" stroke="#111" stroke-width="2"/></svg>',
  bull: '<svg width="24" height="22" viewBox="0 0 24 22" fill="none"><path d="M3 15h12v-5H9L7 6H4v9z" fill="#f2a33a"/><circle cx="6" cy="17" r="2.5" fill="#39404c"/><circle cx="13" cy="17" r="2.5" fill="#39404c"/><path d="M15 9l4-2 3 9h-6" stroke="#f2a33a" stroke-width="2" stroke-linejoin="round"/></svg>',
  lock: '<svg width="12" height="12" viewBox="0 0 12 12" fill="#cfd7e8"><rect x="2" y="5" width="8" height="6.5" rx="1.5"/><path d="M4 5V3.5a2 2 0 0 1 4 0V5" stroke="#cfd7e8" stroke-width="1.4" fill="none"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>',
  up: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 10h6.4L12 4"/></svg>',
  tow: '<svg width="22" height="16" viewBox="0 0 22 16" fill="currentColor"><path d="M1 11V6h8l2-3h4v8z"/><circle cx="5" cy="12.5" r="2"/><circle cx="13" cy="12.5" r="2"/><path d="M15 6l5-4v6" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
  clock: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="9" r="7"/><path d="M9 5v4l3 2"/></svg>',
  gauge: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2.5 13a6.5 6.5 0 1 1 13 0"/><path d="M9 13l3.5-4"/></svg>',
  people: '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><circle cx="7" cy="6" r="3"/><circle cx="14" cy="7.5" r="2.4"/><path d="M1.5 17c.4-4 2.6-6 5.5-6s5.1 2 5.5 6z"/></svg>',
  brief: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="5" width="14" height="10" rx="1.5"/><path d="M6.5 5V3h5v2"/></svg>',
  smart: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="9" r="2.2" fill="currentColor"/><path d="M5.5 5.5a5 5 0 0 0 0 7M12.5 5.5a5 5 0 0 1 0 7M3 3a8.5 8.5 0 0 0 0 12M15 3a8.5 8.5 0 0 1 0 12"/></svg>',
  swap: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h11l-3-3M15 12H4l3 3"/></svg>',
};

// ---------------------------------------------------------------- Outils
const TOOLS = [
  { id: 'inspect', key: 'I', t: 'Inspecter' }, { id: 'pan', key: 'M', t: 'Déplacer la carte' }, { sep: 1 },
  { id: 'rue', key: '1', t: 'Rue', p: RT[1].cost, line: 1 }, { id: 'avenue', key: '2', t: 'Avenue 2×2 voies', p: RT[2].cost, line: 1 },
  { id: 'roc', key: '3', t: 'Rocade surélevée 90 km/h', p: RC.cost, line: 1, lock: 'roc' }, { id: 'ech', key: '4', t: 'Échangeur (bretelles vers les rues voisines)', p: COST.ech, lock: 'ech' }, { sep: 1 },
  { id: 'ow', key: '5', t: 'Sens unique (glisser dans le sens voulu)', p: COST.oneway, line: 1 }, { id: 'z30', key: '6', t: 'Zone 30', p: COST.z30, line: 1 }, { sep: 1 },
  { id: 'feux', key: '7', t: 'Feux tricolores', p: COST.feux }, { id: 'stop', key: '8', t: 'Stop', p: COST.stop }, { id: 'rond', key: '9', t: 'Rond-point', p: COST.rond }, { id: 'prio', key: '0', t: 'Priorité à droite' }, { sep: 1 },
  { id: 'bull', key: 'B', t: 'Démolir', line: 1 },
];
const lockN = { roc: 2, ech: 2, smart: 4 };
export function buildDock() {
  const el = $('#dock'); el.innerHTML = '';
  for (const t of TOOLS) {
    if (t.sep) { const s = document.createElement('div'); s.className = 'dsep'; el.appendChild(s); continue }
    const b = document.createElement('button'); b.className = 'tool'; b.dataset.tool = t.id;
    const locked = t.lock && !unlocked(t.lock);
    b.innerHTML = `<kbd>${t.key}</kbd>${locked ? `<span class="lk">${I.lock}</span>` : ''}${I[t.id]}${t.p ? `<span class="p">${fmt(t.p)}</span>` : ''}`;
    b.title = t.t + (t.p ? ` · ${eur(t.p)}` : '') + (locked ? ` · débloqué après ${lockN[t.lock]} objectifs` : '') + ` (${t.key})`;
    if (locked) b.classList.add('locked'); if (t.id === U.tool) b.classList.add('on');
    b.onclick = () => setTool(t.id); el.appendChild(b);
  }
}
export function setTool(id) {
  const t = TOOLS.find(t => t.id === id);
  if (t && t.lock && !unlocked(t.lock)) { toast(`${t.t} : ${lockN[t.lock]} objectifs`, 'warn'); sfx.err(); return }
  U.tool = id; U.drag = null; U.preview = null; $('#tip').hidden = true;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  setPanMode(id === 'pan');
  $('#cv').style.cursor = id === 'pan' ? 'grab' : id === 'inspect' ? 'default' : 'crosshair';
}

// ---------------------------------------------------------------- Actions de construction
function lineCells(a, b, firstX) {
  const out = [a]; let x = cx(a), y = cy(a); const gx = cx(b), gy = cy(b);
  const stepX = () => { while (x !== gx) { x += Math.sign(gx - x); out.push(cellOf(x, y)) } };
  const stepY = () => { while (y !== gy) { y += Math.sign(gy - y); out.push(cellOf(x, y)) } };
  if (firstX) { stepX(); stepY() } else { stepY(); stepX() }
  return out;
}
const expCost = c => S.bld[c] >= 0 ? BT[S.buildings[S.bld[c]].type].exp : 0;
function cellCost(tool, c) {
  if (tool === 'rue' || tool === 'avenue') {
    const L = tool === 'rue' ? 1 : 2; if (S.ech[c]) return -1; if (S.road[c] >= L) return 0;
    return RT[L].cost - (S.road[c] ? RT[S.road[c]].cost : 0) + expCost(c) + (S.park[c] ? 100 : 0);
  }
  if (tool === 'roc') return S.roc[c] ? 0 : RC.cost + expCost(c);
  if (tool === 'ow') return S.road[c] && isStraight(c) ? COST.oneway : 0;
  if (tool === 'z30') return S.road[c] && !S.z30[c] ? COST.z30 : 0;
  if (tool === 'bull') return 0;
  return 0;
}
const isStraight = c => { const d = connDirs(c, false); return !inter[c] && d.length <= 2 && (d.length < 2 || OPP[d[0]] === d[1]) };
function previewFor(cells, tool) {
  let cost = 0; for (const c of cells) { const k = cellCost(tool, c); if (k > 0) cost += k }
  const ok = cost <= S.money, el = tool === 'roc';
  U.preview = cells.map(c => { const k = cellCost(tool, c); return [c, k < 0 ? 0xee5a5a : tool === 'bull' ? ((S.road[c] || S.roc[c]) ? 0xee5a5a : 0xffffff) : k === 0 ? 0xffffff : ok ? 0x45c08a : 0xee5a5a, el] });
  return { cost, ok };
}
function changed() { S.dirty.net = true; S.dirty.map = true; rebuildAdj() }
function commitLine(cells, tool, dir) {
  let cost = 0; for (const c of cells) { const k = cellCost(tool, c); if (k > 0) cost += k }
  if (tool !== 'bull' && cost > S.money) { toast('Fonds insuffisants', 'bad'); sfx.err(); return }
  let n = 0;
  if (tool === 'rue' || tool === 'avenue') {
    const L = tool === 'rue' ? 1 : 2;
    for (const c of cells) { if (S.ech[c] || S.road[c] >= L) continue; if (S.bld[c] >= 0) removeBuilding(c); S.park[c] = 0; S.road[c] = L; n++ }
  } else if (tool === 'roc') {
    for (const c of cells) { if (S.roc[c]) continue; if (S.bld[c] >= 0) removeBuilding(c); S.park[c] = 0; S.roc[c] = 1; n++ }
  } else if (tool === 'ow') {
    // Sens unique : chaque case suit le sens du glissé ; un clic simple fait tourner le sens
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]; if (!S.road[c] || !isStraight(c)) continue;
      const conn = connDirs(c, false); let d = dir;
      if (d == null || d < 0) {
        const axis = conn.length ? conn[0] : 0, a = axis < 2 ? 0 : 2;
        d = S.oneway[c] < 0 ? a : S.oneway[c] === a ? a + 1 : -1;
      } else if (cells.length > 1) {
        const a = i < cells.length - 1 ? c : cells[i - 1], b = i < cells.length - 1 ? cells[i + 1] : c;
        const nx = cx(b) - cx(a), ny = cy(b) - cy(a); d = DIRS.findIndex(v => v[0] === nx && v[1] === ny);
      } else continue;
      if (d >= 0 && conn.length && !conn.some(k => k === d || k === OPP[d])) continue;
      S.oneway[c] = d; n++;
    }
    cost = n * COST.oneway;
  } else if (tool === 'z30') {
    const all = cells.every(c => !S.road[c] || S.z30[c]);
    for (const c of cells) if (S.road[c]) { S.z30[c] = all ? 0 : 1; n++ }
    if (all) cost = 0;
  } else if (tool === 'bull') {
    for (const c of cells) {
      if (S.roc[c]) { S.roc[c] = 0; S.ech[c] = 0; n++ }
      else if (S.road[c]) { S.road[c] = 0; S.oneway[c] = -1; S.z30[c] = 0; setCtrl(c, 0); n++ }
    }
    cost = 0;
  }
  if (!n) return;
  spend(cost); changed(); refreshDrives(); sfx.build();
  if (cost) toast(`−${eur(cost)}`, 'ok');
}
function clickTool(c) {
  const t = U.tool;
  if (t === 'ech') {
    if (!S.roc[c]) { toast('Sur une rocade', 'bad'); sfx.err(); return }
    if (S.road[c]) { toast('Pas de rue sous un échangeur', 'bad'); sfx.err(); return }
    if (S.ech[c]) { select(c); return }
    if (S.money < COST.ech) { toast('Fonds insuffisants', 'bad'); sfx.err(); return }
    spend(COST.ech); S.ech[c] = 1; changed(); sfx.build(); select(c); return;
  }
  const k = { prio: 0, stop: 1, feux: 2, rond: 3 }[t];
  if (k === undefined) { select(c); return }
  if (!S.road[c] || !inter[c] && !(k === 3 && deg[c] >= 2)) { toast('Sur un carrefour', 'bad'); sfx.err(); return }
  applyCtrl(c, k);
}
function applyCtrl(c, k) {
  if (S.ctrl[c] === k) { select(c); return }
  const cost = COST[CTRL[k]];
  if (cost > S.money) { toast('Fonds insuffisants', 'bad'); sfx.err(); return }
  spend(cost); setCtrl(c, k); if (k === 2) syncLight(S.lights.get(c));
  changed(); sfx.build(); select(c);
}

// ---------------------------------------------------------------- Fiche de sélection
let lastSig = '';
export function select(c, el) { U.sel = c; U.selEl = el ?? (c >= 0 && S.roc[c] === 1); lastSig = ''; renderCard() }
function sig(c) {
  if (c < 0) return 'none';
  const L = S.lights.get(c);
  return [U.selEl, S.road[c], S.roc[c], S.ech[c], S.ctrl[c], S.stopAxis[c], S.oneway[c], S.z30[c], inter[c], S.bld[c], S.block[U.selEl ? NN + c : c] > 0, L ? L.smart : '', unlocked('smart')].join(',');
}
const row = (ic, html, t) => `<div class="row" title="${t}">${I[ic]}<span>${html}</span></div>`;
const bar = (ic, v, t) => `<div class="row" title="${t}">${I[ic]}<div class="bar"><i style="width:${clamp(v, 0, 1) * 100}%;background:${v > .7 ? 'var(--ok)' : v > .45 ? 'var(--yellow)' : v > .25 ? 'var(--warn)' : 'var(--bad)'}"></i></div></div>`;
export function renderCard() {
  const el = $('#card'), c = U.sel;
  if (c < 0) { el.hidden = true; return }
  const s = sig(c);
  if (s === lastSig) { refreshCard(el, c); return }
  lastSig = s; el.hidden = false;
  const n = U.selEl ? NN + c : c;
  let title = '', body = '', acts = '';
  if (S.block[n] > 0) { title = '⚠ Accident'; body = `<div class="row">${I.clock}<span data-f="blk"></span></div>`; acts = `<button class="ab y" id="aTow">${I.tow} ${fmt(COST.tow)}</button>` }
  else if (U.selEl && S.roc[c]) {
    title = S.ech[c] ? 'Échangeur' : 'Rocade';
    body = `<div data-f="flu"></div>`;
    acts = (!S.ech[c] && !S.road[c] && unlocked('ech') ? `<button class="ab y" id="aEch" title="Construire un échangeur">${I.ech} ${fmt(COST.ech)}</button>` : '') + (S.road[c] ? `<button class="ab" id="aDown" title="Voir la rue en dessous">↓</button>` : '') + `<button class="ab r" id="aBull" title="Démolir">${I.trash}</button>`;
  } else if (S.road[c] && inter[c]) {
    const k = S.ctrl[c];
    title = ['Priorité à droite', 'Stop', 'Feux', 'Rond-point'][k];
    body = `<div class="ctrlrow">${['prio', 'stop', 'feux', 'rond'].map((id, j) => `<button class="cb ${j === k ? 'on' : ''}" data-k="${j}" title="${['Priorité à droite', 'Stop', 'Feux tricolores', 'Rond-point'][j]} · ${eur(COST[CTRL[j]])}">${I[id]}</button>`).join('')}</div>`;
    body += `<div data-f="wait"></div><div data-f="flu"></div>`;
    if (k === 1) acts = `<button class="ab" id="aAxis" title="Changer les branches qui ont le stop">${I.swap} ${S.stopAxis[c] ? '↕' : '↔'}</button>`;
    if (k === 2) {
      const L = S.lights.get(c);
      body += `<div class="row" title="Durée du cycle">${I.clock}<input class="range" type="range" id="lCycle" min="30" max="120" step="5" value="${L.cycle}"><b id="lCycleV">${L.cycle} s</b></div>
        <div class="row" title="Part du vert nord-sud / est-ouest"><span class="ax">↕</span><input class="range" type="range" id="lSplit" min="0.2" max="0.8" step="0.05" value="${L.split}"><span class="ax">↔</span></div>
        <div class="row" title="Décalage (onde verte)"><span class="ax">⇥</span><input class="range" type="range" id="lOff" min="0" max="120" step="1" value="${L.offset}"><b id="lOffV">${L.offset} s</b></div>`;
      acts = L.smart ? `<span class="ab on" title="Feu intelligent : s'adapte aux files d'attente">${I.smart}</span><button class="ab" id="aSmart" title="Revenir au cycle fixe">✕</button>`
        : unlocked('smart') ? `<button class="ab y" id="aSmart" title="Feu intelligent : s'adapte aux files d'attente">${I.smart} ${fmt(COST.smart)}</button>` : `<span class="ab" style="opacity:.45" title="Feu intelligent : 4 objectifs">${I.smart}${I.lock}</span>`;
    }
    acts += `<button class="ab r" id="aBull" title="Démolir">${I.trash}</button>`;
  } else if (S.road[c]) {
    title = RT[S.road[c]].name + (S.z30[c] ? ' · 30' : '');
    body = `<div data-f="flu"></div>`;
    const ow = S.oneway[c];
    acts = (S.road[c] === 1 ? `<button class="ab y" id="aUp" title="Passer en avenue">${I.up} ${fmt(RT[2].cost - RT[1].cost)}</button>` : '') +
      (isStraight(c) ? `<button class="ab ${ow >= 0 ? 'on' : ''}" id="aOw" title="Sens unique : changer le sens">${ow >= 0 ? ['→', '←', '↓', '↑'][ow] : '⇄'}</button>` : '') +
      `<button class="ab ${S.z30[c] ? 'on' : ''}" id="aZ30" title="Zone 30">30</button>` + (S.roc[c] ? `<button class="ab" id="aUpL" title="Voir la rocade au-dessus">↑</button>` : '') +
      `<button class="ab r" id="aBull" title="Démolir">${I.trash}</button>`;
  } else if (S.bld[c] >= 0) {
    const b = S.buildings[S.bld[c]], t = BT[b.type];
    title = t.n;
    body = (t.res ? row('people', fmt(t.res), 'Habitants') : '') + (t.jobs ? row('brief', fmt(t.jobs), 'Emplois') : '') + (b.cut ? `<div class="row neg">Sans accès routier</div>` : '');
    acts = `<button class="ab r" id="aExp" title="Exproprier et raser">${I.trash} ${fmt(t.exp)}</button>`;
  } else {
    title = S.park[c] ? 'Parc' : 'Terrain';
    body = row('rue', eur(RT[1].cost + (S.park[c] ? 100 : 0)), 'Rue') + row('avenue', eur(RT[2].cost + (S.park[c] ? 100 : 0)), 'Avenue') + row('roc', eur(RC.cost), 'Rocade');
  }
  el.innerHTML = `<button class="ib x" id="aClose" title="Fermer">${I.x}</button><h3>${title}</h3>${body}${acts ? `<div class="acts">${acts}</div>` : ''}`;
  refreshCard(el, c);
  const on = (id, fn) => { const b = el.querySelector('#' + id); if (b) b.onclick = () => { fn(); lastSig = ''; renderCard() } };
  on('aClose', () => select(-1));
  on('aTow', () => { if (S.money < COST.tow) { toast('Fonds insuffisants', 'bad'); return } spend(COST.tow); S.block[n] = 0; sfx.coin() });
  on('aEch', () => { U.tool = 'ech'; clickTool(c); setTool('inspect') });
  on('aDown', () => { U.selEl = false });
  on('aUpL', () => { U.selEl = true });
  on('aBull', () => { if (U.selEl && S.roc[c]) { S.roc[c] = 0; S.ech[c] = 0 } else { S.road[c] = 0; S.oneway[c] = -1; S.z30[c] = 0; setCtrl(c, 0) } changed(); refreshDrives(); sfx.build(); select(-1) });
  on('aUp', () => commitLine([c], 'avenue'));
  on('aOw', () => commitLine([c], 'ow', -1));
  on('aZ30', () => commitLine([c], 'z30'));
  on('aAxis', () => { S.stopAxis[c] ^= 1; changed() });
  on('aExp', () => { const b = S.buildings[S.bld[c]], k = BT[b.type].exp; if (S.money < k) { toast('Fonds insuffisants', 'bad'); return } spend(k); removeBuilding(c); S.dirty.map = true; S.dirty.net = true; sfx.build(); select(-1) });
  on('aSmart', () => { const L = S.lights.get(c); if (L.smart) { L.smart = 0; syncLight(L) } else { if (S.money < COST.smart) { toast('Fonds insuffisants', 'bad'); return } spend(COST.smart); L.smart = 1 } });
  el.querySelectorAll('.cb').forEach(b => b.onclick = () => { applyCtrl(c, +b.dataset.k); lastSig = ''; renderCard() });
  const L = S.lights.get(c);
  const rg = (id, key, lbl) => { const r = el.querySelector('#' + id); if (r) r.oninput = () => { L[key] = +r.value; if (lbl) el.querySelector('#' + lbl).textContent = r.value + ' s'; syncLight(L) } };
  rg('lCycle', 'cycle', 'lCycleV'); rg('lSplit', 'split'); rg('lOff', 'offset', 'lOffV');
}
function refreshCard(el, c) {
  const n = U.selEl ? NN + c : c;
  const f = el.querySelector('[data-f="flu"]'); if (f) f.innerHTML = bar('gauge', spdE[n], 'Fluidité');
  const w = el.querySelector('[data-f="wait"]');
  if (w) { let s = 0, k = 0; for (let d = 0; d < 4; d++) if (waitE[c * 4 + d] > 0) { s += waitE[c * 4 + d]; k++ } w.innerHTML = row('clock', (k ? (s / k).toFixed(1) : '0') + ' s', 'Attente moyenne au carrefour') }
  const b = el.querySelector('[data-f="blk"]'); if (b) b.textContent = Math.ceil(S.block[n]) + ' s';
}

// ---------------------------------------------------------------- Barre du haut, objectif
const SUN = '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="4.2" fill="#f5cf4f"/><g stroke="#f5cf4f" stroke-width="1.8" stroke-linecap="round"><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4"/></g></svg>';
const MOON = '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M14.5 13.5A6.5 6.5 0 0 1 8 3a7 7 0 1 0 9 9 6.4 6.4 0 0 1-2.5 1.5z" fill="#cfd7e8"/></svg>';
const WICO = [SUN, '<svg width="22" height="20" viewBox="0 0 22 20"><path d="M6 12a4 4 0 0 1 .5-8 5 5 0 0 1 9.4 1.6A3.3 3.3 0 0 1 16 12z" fill="#cfd7e8"/><g stroke="#7fb4f0" stroke-width="1.7" stroke-linecap="round"><path d="M7 14.5l-1 3M11 14.5l-1 3M15 14.5l-1 3"/></g></svg>', '<svg width="22" height="20" viewBox="0 0 22 20" stroke="#cfd7e8" stroke-width="1.9" stroke-linecap="round"><path d="M2 6h16M4 10h16M2 14h14"/></svg>'];
const satCol = s => s < .4 ? '#ee5a5a' : s < .6 ? '#f2a33a' : '#45c08a';
let lastW = -1, lastN = -1;
export function updateHud() {
  $('#sMoney').textContent = fmt(S.money); $('#sMoney').className = S.money < 0 ? 'neg' : '';
  $('#sInc').textContent = '+' + fmt(incomePerHour()) + '/h';
  $('#sPop').textContent = fmt(totals().res);
  $('#sSat').textContent = Math.round(S.sat * 100) + ' %'; $('#satIco').setAttribute('fill', satCol(S.sat));
  $('#satMouth').setAttribute('d', S.sat < .4 ? 'M6.5 14q3.5-3 7 0' : S.sat < .6 ? 'M6.5 13h7' : 'M6.5 12.2q3.5 3 7 0');
  $('#sFlu').textContent = Math.round(S.flu * 100) + ' %'; $('#sFlu').style.color = satCol(S.flu);
  $('#sCars').textContent = fmt(S.cars.length);
  const h = hour(), ni = h < 6.5 || h >= 20 ? 1 : 0; if (ni !== lastN) { $('#sunIco').innerHTML = ni ? MOON : SUN; lastN = ni }
  const m = Math.floor((S.clock / 60) % 1440); $('#sTime').textContent = `J${dayNum()} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  if (S.weather.t !== lastW) { $('#wIco').innerHTML = S.weather.t ? WICO[S.weather.t] : ''; lastW = S.weather.t }
  document.querySelectorAll('#speeds .ib').forEach(b => b.classList.toggle('on', (U.paused ? 0 : U.speed) === +b.dataset.speed));
  $('#bHeat').classList.toggle('on2', S.heat); $('#bHQ').classList.toggle('on2', S.quality === 1); $('#sndW').style.display = U.muted ? 'none' : '';
  const o = S.objectives.find(o => !o.done);
  if (o) { $('#obj').hidden = false; $('#oText').textContent = o.t; $('#oBar').style.width = clamp(objProgress(o), 0, 1) * 100 + '%'; $('#oRw').textContent = '+' + fmt(o.r) } else $('#obj').hidden = true;
}
export function tickUi() {
  const before = ['roc', 'ech', 'smart'].map(unlocked);
  const o = checkObjectives();
  if (o) {
    toast(`✓ ${o.t}  +${eur(o.r)}`, 'gold'); sfx.coin();
    const names = ['Rocade', 'Échangeur', 'Feux intelligents'];
    ['roc', 'ech', 'smart'].forEach((k, i) => { if (!before[i] && unlocked(k)) toast('Débloqué : ' + names[i], 'ok') });
    buildDock(); lastSig = '';
  }
  updateHud(); renderCard();
}
export function setSpeed(s) { if (s === 0) U.paused = true; else { U.paused = false; U.speed = s; U.lastSpeed = s } updateHud() }

// ---------------------------------------------------------------- Fenêtres
let onClose = null;
export function modal(html, binds, close) { $('#mc').innerHTML = html; $('#modal').hidden = false; onClose = close || null; for (const k in binds) { const b = $('#' + k); if (b) b.onclick = binds[k] } const f = $('#mc .ab'); if (f) f.focus() }
export function closeModal() { $('#modal').hidden = true; const f = onClose; onClose = null; if (f) f() }
export function helpModal() {
  const wp = U.paused; U.paused = true; updateHud();
  modal(`<h1 style="font-size:40px;margin-bottom:18px">Commandes</h1><div class="keys">
  <kbd>Glisser</kbd><span>Tracer une rue, une rocade…</span><kbd>Clic droit</kbd><span>Déplacer</span><kbd>Clic molette</kbd><span>Tourner</span><kbd>Molette</kbd><span>Zoom</span>
  <kbd>ZQSD · A E</kbd><span>Déplacer · tourner</span><kbd>1 · 2 · 3 · 4</kbd><span>Rue · avenue · rocade · échangeur</span><kbd>5 · 6</kbd><span>Sens unique · zone 30</span>
  <kbd>7 · 8 · 9 · 0</kbd><span>Feux · stop · rond-point · priorité</span><kbd>B · I</kbd><span>Démolir · inspecter</span><kbd>H</kbd><span>Bouchons</span><kbd>Espace</kbd><span>Pause</span></div>
  <div class="mbtn"><button class="ab y" id="mOk">OK</button></div>`, { mOk: closeModal }, () => { U.paused = wp; updateHud() });
}

// ---------------------------------------------------------------- Entrées
export function initInput(api) {
  const cv = $('#cv'), tip = $('#tip');
  const placeTip = e => { tip.style.left = Math.min(e.clientX + 18, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(e.clientY + 20, innerHeight - 44) + 'px' };
  const isLine = () => !!(TOOLS.find(t => t.id === U.tool) || {}).line;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    initAudio();
    if (e.button !== 0 || U.tool === 'pan' || e.pointerType === 'touch' && !e.isPrimary) return;
    const el = ELEV_TOOLS.includes(U.tool), c = cellAt(e.clientX, e.clientY, false); if (c < 0) return;
    if (isLine()) { U.drag = { start: c, end: c, firstX: true, moved: false }; const p = previewFor([c], U.tool); showTip(p); placeTip(e) }
    else if (U.tool === 'inspect') {
      const blk = S.block[c] > 0 || S.block[NN + c] > 0;
      select(c, S.roc[c] === 1 && !(blk && S.block[c] > 0));
    }
    else clickTool(c);
  });
  const showTip = p => { if (U.tool === 'bull') tip.innerHTML = I.trash; else tip.innerHTML = `${I[U.tool] || ''}<span class="${p.ok ? '' : 'neg'}">${eur(p.cost)}</span>`; tip.hidden = false };
  cv.addEventListener('pointermove', e => {
    const c = cellAt(e.clientX, e.clientY, false); U.hover = U.tool === 'pan' ? -1 : c; U.hoverEl = ELEV_TOOLS.includes(U.tool);
    if (!U.drag || c < 0) return;
    if (c !== U.drag.end) {
      if (!U.drag.moved) { U.drag.firstX = Math.abs(cx(c) - cx(U.drag.start)) >= Math.abs(cy(c) - cy(U.drag.start)); U.drag.moved = true }
      U.drag.end = c; showTip(previewFor(lineCells(U.drag.start, c, U.drag.firstX), U.tool));
    }
    placeTip(e);
  });
  const end = (e, ok) => {
    if (!U.drag) return; const d = U.drag; U.drag = null; tip.hidden = true;
    const cells = lineCells(d.start, d.end, d.firstX); U.preview = null;
    if (ok) commitLine(cells, U.tool, d.moved ? 0 : -1);
  };
  cv.addEventListener('pointerup', e => end(e, true));
  cv.addEventListener('pointercancel', e => end(e, false));
  cv.addEventListener('pointerleave', () => { U.hover = -1 });
  const keys = new Set(), PAN = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (!$('#modal').hidden) { if (e.key === 'Escape') { const b = $('#mOk') || $('#mCont'); if (b) b.click() } return }
    if (PAN.includes(e.code)) { keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); return }
    if (e.code === 'Space') { e.preventDefault(); setSpeed(U.paused ? U.lastSpeed : 0); return }
    if (e.key === 'Escape') { if (U.drag) { U.drag = null; U.preview = null; tip.hidden = true } else { setTool('inspect'); select(-1) } return }
    if (e.repeat) return;
    const dig = /^(Digit|Numpad)(\d)$/.exec(e.code);
    if (dig) { const id = TOOLS.find(t => t.key === dig[2]); if (id) setTool(id.id); return }
    const k = e.key.toLowerCase(), map = { b: 'bull', i: 'inspect', m: 'pan' };
    if (map[k]) setTool(map[k]); else if (k === 'h') { S.heat = !S.heat; updateHud() }
  });
  addEventListener('keyup', e => keys.delete(e.code)); addEventListener('blur', () => keys.clear());
  api.keysTick = rdt => {
    let dx = 0, dz = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) dx--; if (keys.has('ArrowRight') || keys.has('KeyD')) dx++;
    if (keys.has('ArrowUp') || keys.has('KeyW')) dz++; if (keys.has('ArrowDown') || keys.has('KeyS')) dz--;
    if (dx || dz) panBy(dx * 900 * rdt, dz * 900 * rdt);
    if (keys.has('KeyQ')) rotateBy(1.4 * rdt); if (keys.has('KeyE')) rotateBy(-1.4 * rdt);
  };
  document.querySelectorAll('#speeds .ib').forEach(b => b.onclick = () => { initAudio(); setSpeed(+b.dataset.speed) });
  $('#bHeat').onclick = () => { S.heat = !S.heat; updateHud() };
  $('#bHQ').onclick = () => { S.quality = S.quality ? 0 : 1; setQuality(S.quality); updateHud(); try { localStorage.setItem('grandReseauVille.q', S.quality) } catch (e) { } };
  $('#bSound').onclick = () => { initAudio(); U.muted = !U.muted; updateHud() };
  $('#bSave').onclick = () => api.save(false);
  $('#bHelp').onclick = helpModal;
  $('#bNew').onclick = () => {
    const wp = U.paused; U.paused = true; updateHud();
    modal(`<h1 style="font-size:40px">Nouvelle ville ?</h1><p class="sub">La partie actuelle sera remplacée.</p><div class="mbtn"><button class="ab y" id="mYes">Oui</button><button class="ab" id="mSaveNew">Sauver puis oui</button><button class="ab" id="mOk">Annuler</button></div>`,
      { mYes: () => { onClose = null; closeModal(); api.newGame() }, mSaveNew: () => { api.save(false); onClose = null; closeModal(); api.newGame() }, mOk: closeModal }, () => { U.paused = wp; updateHud() });
  };
  $('#obj').onclick = () => { };
}
