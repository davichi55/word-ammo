// 🏦 Heist map: the bank's courtyard on a hill (+5 m) in the middle of a small night-time town.
// You hold the courtyard with the loot pile in the centre; aliens come from the town's edges, walk up one of
// four ramps and try to smash the loot (and any tower in their way). Safes to crack stand on the hill and
// down in the streets. Same physics/nav as the district (makePhysics), built into its own Group.
import * as THREE from "../../node_modules/three/build/three.module.js";
import { mergeGeometries } from "../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js";
import { canvasTex, cobbles, stoneWall, gothicWindow, makePhysics } from "./world.js";
import { glowTexture } from "./enemies.js";

let seed = 4242;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + rand() * (b - a);

const H = 5;   // height of the hill
const BOUNDS = { x0: -60, x1: 60, z0: -60, z1: 60 };
// ground: max of these. box {x0,x1,z0,z1,h}; ramp along z (h0 at z0 → h1 at z1) or along x (h0 at x0 → h1 at x1)
const SURF = [
  { x0: -22, x1: 22, z0: -22, z1: 22, h: H },                                   // the courtyard
  { ramp: "z", x0: -4, x1: 4, z0: -36, z1: -22, h0: 0, h1: H },                 // north ramp
  { ramp: "z", x0: -4, x1: 4, z0: 22, z1: 36, h0: H, h1: 0 },                   // south ramp
  { ramp: "x", x0: -36, x1: -22, z0: -4, z1: 4, h0: 0, h1: H },                 // west ramp
  { ramp: "x", x0: 22, x1: 36, z0: -4, z1: 4, h0: H, h1: 0 },                   // east ramp
];
function groundY(x, z){
  let y = 0;
  for (const s of SURF) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    const h = s.ramp === "z" ? s.h0 + (s.h1 - s.h0) * (z - s.z0) / (s.z1 - s.z0) : s.ramp === "x" ? s.h0 + (s.h1 - s.h0) * (x - s.x0) / (s.x1 - s.x0) : s.h;
    if (h > y) y = h;
  }
  return y;
}
// town blocks around the hill: [x0,x1,z0,z1,height] for the south-east quarter, mirrored to the other three
// (streets stay open along both axes, between the blocks, and as a ring road around the hill)
const QUARTER = [[8, 22, 40, 56, 10], [26, 38, 44, 56, 13], [44, 56, 8, 22, 10], [44, 56, 26, 38, 12]];
const BANK = { x0: -18, x1: 18, z0: -58, z1: -44, h: 16 };   // the bank itself, north of the hill (we robbed it)

export function buildHeistWorld(root){
  seed = 4242;
  const colliders = [];
  const addCol = (x0, x1, z0, z1, y0, y1) => colliders.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), minY: y0, maxY: y1 });
  const lightSpots = [];
  const mm = { solid: [], enter: [], doors: [], areas: [[-22, 22, -22, 22, "#2c2a44"], [-4, 4, -36, -22, "#3a3352"], [-4, 4, 22, 36, "#3a3352"], [-36, -22, -4, 4, "#3a3352"], [22, 36, -4, 4, "#3a3352"]] };
  const env = { bg: new THREE.Color(0x10142a), fog: new THREE.FogExp2(0x161c30, 0.011) };

  // ---- sky / light ----
  root.add(new THREE.HemisphereLight(0x8a90c8, 0x2a2232, 1.35));
  const moonLight = new THREE.DirectionalLight(0xb4c6ff, 1.0); moonLight.position.set(-40, 80, -60); root.add(moonLight);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(256, 256, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 10, w / 2, w / 2, w / 2); gr.addColorStop(0, "rgba(255,248,220,1)"); gr.addColorStop(.35, "rgba(255,240,200,.95)");
    gr.addColorStop(.42, "rgba(200,210,255,.25)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, w); }), fog: false, depthWrite: false }));
  moon.position.set(140, 150, -300); moon.scale.set(90, 90, 1); root.add(moon);
  const starGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 700; i++) { const a = rand() * Math.PI * 2, e = rr(.15, 1.3), R = 380; sp.push(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R); }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  root.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfc8ff, size: 1.2, sizeAttenuation: false, fog: false })));

  // ---- materials ----
  const cobTex = canvasTex(512, 512, cobbles); cobTex.wrapS = cobTex.wrapT = THREE.RepeatWrapping;
  const groundMat = new THREE.MeshStandardMaterial({ map: cobTex, roughness: .9 });
  const marbleTex = canvasTex(256, 256, (g, w, h) => { for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) {
    const l = ((x + y) / 64) % 2 ? 150 : 118; g.fillStyle = `rgb(${l},${l - 6},${l + 10})`; g.fillRect(x, y, 64, 64);
    g.strokeStyle = "rgba(0,0,0,.25)"; g.strokeRect(x + .5, y + .5, 63, 63); } });
  marbleTex.wrapS = marbleTex.wrapT = THREE.RepeatWrapping;
  const marbleMat = new THREE.MeshStandardMaterial({ map: marbleTex, roughness: .45, metalness: .05 });
  const wallTex = canvasTex(512, 512, stoneWall); wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  const wallMats = [0x8a8698, 0x7a8090, 0x958a86, 0x6f6a80].map(c => new THREE.MeshStandardMaterial({ map: wallTex, color: c, roughness: .95 }));
  const bankMat = new THREE.MeshStandardMaterial({ map: wallTex, color: 0xc8c0b0, roughness: .8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1824, roughness: .8, metalness: .1, flatShading: true });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2c2838, roughness: .9 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x14131a, roughness: .5, metalness: .6 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: .9 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc36b });
  const litWin = new THREE.MeshBasicMaterial({ map: canvasTex(64, 128, gothicWindow(true)), transparent: true });
  const darkWin = new THREE.MeshStandardMaterial({ map: canvasTex(64, 128, gothicWindow(false)), transparent: true, roughness: .3, metalness: .4 });

  const geos = new Map();
  const add = (mat, geo) => { if (!geos.has(mat)) geos.set(mat, []); geos.get(mat).push(geo); };
  const box = (x0, x1, y0, y1, z0, z1, mat, uvScale = 6) => {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0; if (w <= 0 || h <= 0 || d <= 0) return;
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) / uvScale, uv.getY(i) * Math.max(h, Math.min(w, d)) / uvScale);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); add(mat, g);
  };
  const plane = (x0, x1, z0, z1, y, mat, tile = 4) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / tile, uv.getY(i) * (z1 - z0) / tile);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); add(mat, g);
  };
  const wins = { lit: [], dark: [] };
  const windowRow = (face, fixed, from, to, h) => {
    const floors = Math.max(1, Math.floor((h - 2) / 3.4)), cols = Math.max(1, Math.floor((to - from) / 3.4));
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) { if (rand() < .12) continue;
      const along = from + (c + .5) * (to - from) / cols, y = 2.6 + f * 3.4;
      const ry = face === "e" ? Math.PI / 2 : face === "w" ? -Math.PI / 2 : face === "s" ? 0 : Math.PI;
      (rand() < .3 ? wins.lit : wins.dark).push(face === "e" || face === "w" ? { x: fixed, y, z: along, ry } : { x: along, y, z: fixed, ry }); }
  };
  const roof = (x0, x1, z0, z1, base) => {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, alongX = w > d, span = alongX ? d : w, len = alongX ? w : d, rh = rr(3.5, 6);
    const r = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-span / 2 - .4, 0), new THREE.Vector2(span / 2 + .4, 0), new THREE.Vector2(0, rh)]), { depth: len + .4, bevelEnabled: false });
    if (alongX) { r.rotateY(Math.PI / 2); r.translate(x0 - .2, base, cz); } else r.translate(cx, base, z0 - .2);
    add(roofMat, r);
  };
  function house(x0, x1, z0, z1, h){
    box(x0, x1, -1, h, z0, z1, wallMats[Math.floor(rand() * wallMats.length)]);
    box(x0 - .15, x1 + .15, h, h + .35, z0 - .15, z1 + .15, trimMat); box(x0 - .1, x1 + .1, 0, .6, z0 - .1, z1 + .1, trimMat);
    roof(x0, x1, z0, z1, h);
    windowRow("e", x1 + .03, z0, z1, h); windowRow("w", x0 - .03, z0, z1, h); windowRow("s", z1 + .03, x0, x1, h); windowRow("n", z0 - .03, x0, x1, h);
    addCol(x0, x1, z0, z1, -1, h + 8); mm.solid.push([x0, x1, z0, z1]);
  }

  // ---- ground, the hill, ramps, parapets ----
  plane(-60, 60, -60, 60, 0, groundMat);
  box(-22, 22, 0, H, -22, 22, wallMats[1]); plane(-22, 22, -22, 22, H + .01, marbleMat, 5);
  const rampSteps = (s, n) => { for (let i = 0; i < n; i++) {
    if (s.ramp === "z") { const za = s.z0 + (s.z1 - s.z0) * i / n, zb = s.z0 + (s.z1 - s.z0) * (i + 1) / n, top = Math.max(groundY(0, za + .01), groundY(0, zb - .01));
      box(s.x0, s.x1, 0, top, za, zb, wallMats[2], 3); plane(s.x0, s.x1, za, zb, top + .01, groundMat, 3); }
    else { const xa = s.x0 + (s.x1 - s.x0) * i / n, xb = s.x0 + (s.x1 - s.x0) * (i + 1) / n, top = Math.max(groundY(xa + .01, 0), groundY(xb - .01, 0));
      box(xa, xb, 0, top, s.z0, s.z1, wallMats[2], 3); plane(xa, xb, s.z0, s.z1, top + .01, groundMat, 3); } } };
  for (const s of SURF.slice(1)) {
    rampSteps(s, 16);
    // balustrades along both sides of the ramp
    if (s.ramp === "z") for (const x of [s.x0 - .5, s.x1]) { box(x, x + .5, 0, H + 1.1, s.z0, s.z1, trimMat); addCol(x, x + .5, s.z0, s.z1, 0, H + 1.2); }
    else for (const z of [s.z0 - .5, s.z1]) { box(s.x0, s.x1, 0, H + 1.1, z, z + .5, trimMat); addCol(s.x0, s.x1, z, z + .5, 0, H + 1.2); }
  }
  // parapet around the hill with a gap at the top of every ramp
  const parapet = (x0, x1, z0, z1) => { box(x0, x1, H, H + 1.1, z0, z1, trimMat); addCol(x0, x1, z0, z1, H, H + 1.2); };
  for (const [a0, a1] of [[-22, -4], [4, 22]]) { parapet(a0, a1, -22, -21.5); parapet(a0, a1, 21.5, 22); parapet(-22, -21.5, a0, a1); parapet(21.5, 22, a0, a1); }
  for (const [x, z] of [[-22, -22], [22, -22], [-22, 22], [22, 22]]) {   // corner posts with a lamp
    box(x - .8, x + .8, H, H + 1.8, z - .8, z + .8, wallMats[0]); addCol(x - .8, x + .8, z - .8, z + .8, H, H + 1.9);
    const head = new THREE.BoxGeometry(.5, .6, .5); head.translate(x, H + 2.3, z); add(lampMat, head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa24a, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.set(x, H + 2.3, z); glow.scale.set(3, 3, 1); root.add(glow); lightSpots.push({ x, y: H + 2.2, z, color: 0xffa24a, power: 26, dist: 22 });
  }
  // perimeter wall
  for (const [x0, x1, z0, z1] of [[-64, 64, -64, -60], [-64, 64, 60, 64], [-64, -60, -60, 60], [60, 64, -60, 60]]) { box(x0, x1, 0, 12, z0, z1, wallMats[0]); addCol(x0, x1, z0, z1, -5, 30); }

  // ---- the town ----
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]])
    for (const [x0, x1, z0, z1, h] of QUARTER) {
      const X0 = sx > 0 ? x0 : -x1, X1 = sx > 0 ? x1 : -x0, Z0 = sz > 0 ? z0 : -z1, Z1 = sz > 0 ? z1 : -z0;
      if (sz < 0 && Math.max(X0, BANK.x0) < Math.min(X1, BANK.x1) && Math.max(Z0, BANK.z0) < Math.min(Z1, BANK.z1)) continue;   // the bank stands there
      house(X0, X1, Z0, Z1, h);
    }
  // the bank: pale stone, a row of columns, steps, a gold sign
  { const B = BANK;
    box(B.x0, B.x1, -1, B.h, B.z0, B.z1, bankMat); addCol(B.x0, B.x1, B.z0, B.z1, -1, B.h + 10); mm.solid.push([B.x0, B.x1, B.z0, B.z1]);
    const ped = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(B.x0 - .5, 0), new THREE.Vector2(B.x1 + .5, 0), new THREE.Vector2(0, 5)]), { depth: 3, bevelEnabled: false });
    ped.translate(0, B.h, B.z1 - 1); add(bankMat, ped);
    box(B.x0 - .6, B.x1 + .6, B.h - .6, B.h, B.z1, B.z1 + 3, bankMat);
    for (let x = B.x0 + 1.5; x <= B.x1 - 1.4; x += 3.3) { const c = new THREE.CylinderGeometry(.55, .65, B.h - .6, 16); c.translate(x, (B.h - .6) / 2, B.z1 + 2.2); add(bankMat, c); addCol(x - .6, x + .6, B.z1 + 1.6, B.z1 + 2.8, 0, B.h); }
    for (let i = 0; i < 3; i++) box(B.x0 - .6, B.x1 + .6, 0, .3 * (3 - i), B.z1 + i * .6, B.z1 + (i + 1) * .6 + .01, bankMat);
    const signC = document.createElement("canvas"); signC.width = 1024; signC.height = 160; const g = signC.getContext("2d");
    g.fillStyle = "#1b1407"; g.fillRect(0, 0, 1024, 160); g.strokeStyle = "#ffcf5c"; g.lineWidth = 8; g.strokeRect(8, 8, 1008, 144);
    g.fillStyle = "#ffcf5c"; g.font = `900 92px "Malgun Gothic", serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("중앙은행 · CENTRAL BANK", 512, 84);
    const st = new THREE.CanvasTexture(signC); st.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(24, 3.75), new THREE.MeshBasicMaterial({ map: st, toneMapped: false })); sign.position.set(0, B.h + 1.6, B.z1 + 2.05); root.add(sign);
    lightSpots.push({ x: 0, y: 6, z: B.z1 + 5, color: 0xffd27a, power: 30, dist: 26 });
    for (const x of [-12, 0, 12]) windowRow("s", B.z1 + .03, x - 3, x + 3, B.h);
  }
  // crates & barrels in the streets (cover / landmarks)
  for (const [x, z] of [[-30, 14], [30, -14], [14, 30], [-14, -30], [-40, 40], [40, -40], [30, 30], [-30, -30]]) {
    const s = rr(.9, 1.3); box(x - s / 2, x + s / 2, 0, s, z - s / 2, z + s / 2, woodMat); addCol(x - s / 2, x + s / 2, z - s / 2, z + s / 2, 0, s);
  }
  // the getaway van on the hill
  { const vx = 11, vz = 7;
    box(vx - 1.2, vx + 1.2, H + .5, H + 2.7, vz - 2.6, vz + 2.6, new THREE.MeshStandardMaterial({ color: 0x2d3a55, roughness: .5, metalness: .3 }), 3);
    box(vx - 1.1, vx + 1.1, H + 1.7, H + 2.5, vz + 1.6, vz + 2.62, new THREE.MeshStandardMaterial({ color: 0x9fc0e0, roughness: .1, metalness: .6 }), 3);
    for (const [wx, wz] of [[-1.2, -1.7], [1.2, -1.7], [-1.2, 1.7], [1.2, 1.7]]) { const w = new THREE.CylinderGeometry(.45, .45, .3, 14); w.rotateZ(Math.PI / 2); w.translate(vx + wx, H + .45, vz + wz); add(ironMat, w); }
    addCol(vx - 1.3, vx + 1.3, vz - 2.7, vz + 2.7, H, H + 2.8);
  }
  // lamps along the ring road + streets
  for (const [x, z] of [[-28, -28], [28, -28], [-28, 28], [28, 28], [-7, -40], [7, 40], [-40, 7], [40, -7], [-50, -24], [50, 24], [24, -50], [-24, 50]]) {
    const pole = new THREE.CylinderGeometry(.09, .14, 5, 8); pole.translate(x, 2.5, z); add(ironMat, pole);
    const head = new THREE.BoxGeometry(.45, .6, .45); head.translate(x, 5.2, z); add(lampMat, head);
    colliders.push({ minX: x - .2, maxX: x + .2, minZ: z - .2, maxZ: z + .2, minY: 0, maxY: 5 });
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa24a, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.set(x, 5.2, z); glow.scale.set(3, 3, 1); root.add(glow);
    lightSpots.push({ x, y: 4.6, z, color: 0xffa24a, power: 26, dist: 20 });
  }

  // ---- merge static geometry ----
  for (const [mat, list] of geos) {
    const clean = list.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(k)) n.deleteAttribute(k); return n; });
    root.add(new THREE.Mesh(mergeGeometries(clean, false), mat));
  }
  const winGeo = new THREE.PlaneGeometry(1.3, 2.3);
  for (const [key, mat] of [["lit", litWin], ["dark", darkWin]]) {
    const list = wins[key], im = new THREE.InstancedMesh(winGeo, mat, list.length), o = new THREE.Object3D();
    list.forEach((w, i) => { o.position.set(w.x, w.y, w.z); o.rotation.set(0, w.ry, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    root.add(im);
  }

  // ---- the loot: a pallet of gold bars and money bags; pieces disappear as it takes damage ----
  const loot = { x: 0, y: H, z: 0, group: new THREE.Group(), pieces: [] };
  { const gold = new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: .25, metalness: .9, emissive: 0x6a4a00, emissiveIntensity: .35 });
    const bag = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: .9 });
    const pal = new THREE.Mesh(new THREE.BoxGeometry(4, .3, 4), new THREE.MeshStandardMaterial({ color: 0x5a3f22, roughness: .9 })); pal.position.y = .15; loot.group.add(pal);
    const bar = new THREE.BoxGeometry(.55, .22, .28);
    for (let layer = 0; layer < 4; layer++) for (let i = 0; i < 5 - layer; i++) for (let j = 0; j < 3; j++) {
      const m = new THREE.Mesh(bar, gold); m.position.set((i - (4 - layer) / 2) * .6, .41 + layer * .23, (j - 1) * .36 + .3); m.rotation.y = layer % 2 ? .08 : -.05; loot.group.add(m); loot.pieces.push(m); }
    for (let i = 0; i < 8; i++) { const a = Math.PI * (1.05 + i / 7 * .9), m = new THREE.Mesh(new THREE.SphereGeometry(.42, 12, 10), bag);   // bags behind the gold
      m.scale.set(1, 1.15, 1); m.position.set(Math.cos(a) * 1.5, .7, Math.sin(a) * 1.3); loot.group.add(m); loot.pieces.push(m);
      const knot = new THREE.Mesh(new THREE.ConeGeometry(.1, .22, 8), bag); knot.position.set(0, .45, 0); m.add(knot); }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffcf5c, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.y = 1.4; glow.scale.set(7, 5, 1); loot.group.add(glow); loot.glow = glow;
    loot.group.position.set(loot.x, H, loot.z); root.add(loot.group);
    addCol(-2.1, 2.1, -2.1, 2.1, H, H + 2);
    lightSpots.push({ x: 0, y: H + 3, z: 0, color: 0xffcf5c, power: 34, dist: 20 });
  }

  // ---- light pool (same trick as the district: 10 real lights follow the player) ----
  const pool = Array.from({ length: 10 }, () => { const L = new THREE.PointLight(0xffa24a, 0, 20, 1.7); root.add(L); return L; });
  let poolT = 0;
  function updateLights(px, pz){
    const near = lightSpots.map(s => ({ s, d: (s.x - px) ** 2 + (s.z - pz) ** 2 })).sort((a, b) => a.d - b.d).slice(0, pool.length);
    near.forEach(({ s }, i) => { const L = pool[i]; L.position.set(s.x, s.y, s.z); L.color.setHex(s.color); L.userData.power = s.power; L.distance = s.dist; });
  }
  const dustN = 700, dustGeo = new THREE.BufferGeometry(), dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dp[i * 3] = rr(-58, 58); dp[i * 3 + 1] = rr(0, 16); dp[i * 3 + 2] = rr(-58, 58); }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  root.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xaab0d8, size: .06, transparent: true, opacity: .5, depthWrite: false })));

  const P = makePhysics(groundY, BOUNDS, colliders, []);
  return {
    ...P, colliders, groundY, mm, bounds: BOUNDS, env, loot, hill: H,
    nests: [], route: [], zones: [{ ko: "은행 언덕", en: "Bank hill", x: 0, z: 0, pads: [], shop: [0, 8] }],
    // 8 tower pads: two at the top of every ramp
    pads: [[-8, -16], [8, -16], [-8, 16], [8, 16], [16, -8], [16, 8], [-16, -8], [-16, 8]],
    // where safes can appear: the hill's corners and in front of the town houses
    safeSpots: [[-17, -17], [17, -17], [-17, 17], [17, 17], [12, 37.5], [-12, 37.5], [30, -41.5], [-30, -41.5], [41.5, 13], [41.5, -13], [-41.5, 13], [-41.5, -13]],
    // where the aliens enter: the four corners and three street ends (the bank blocks the north one)
    entries: [[52, 52], [-52, 52], [52, -52], [-52, -52], [0, 55], [55, 0], [-55, 0]],
    spawn: { x: 0, z: 9 }, gunSpot: new THREE.Vector3(0, 0, 9), tutorialSpawns: [],
    update(t, dt, px, pz){
      for (let i = 0; i < dustN; i++) { dp[i * 3 + 1] -= dt * .15; dp[i * 3] += Math.sin(t * .3 + i) * dt * .1; if (dp[i * 3 + 1] < 0) dp[i * 3 + 1] = 16; }
      dustGeo.attributes.position.needsUpdate = true;
      poolT -= dt; if (poolT <= 0) { poolT = .4; updateLights(px, pz); }
      pool.forEach((L, i) => L.intensity = (L.userData.power || 0) + Math.sin(t * 7 + i * 3) * 1.2);
      loot.glow.material.opacity = .35 + Math.sin(t * 2) * .12;
    },
  };
}
