// The district: an open Gothic old town with a lower town, an upper town (+4 m) reached by a grand
// staircase and a ramp, a city-wall walk (+6 m), enterable houses + the cathedral with aliens inside.
// Everything is generated from primitives + canvas textures (no model files). Static geometry is merged
// per material. Height comes from an analytic ground function (boxes + ramps), which also drives
// movement (you can't step up more than STEP, you can drop down), line of sight and a small nav graph.
import * as THREE from "../../node_modules/three/build/three.module.js";
import { mergeGeometries } from "../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowTexture } from "./enemies.js?v=202609201807";

let seed = 1337;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + rand() * (b - a);
export const STEP = .6;

export function canvasTex(w, h, draw, repeat){
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
export function cobbles(g, w, h){
  g.fillStyle = "#1c1b22"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -16 : 0; x < w; x += 32) {
    const l = 26 + rand() * 18; g.fillStyle = `rgb(${l},${l - 2},${l + 6})`;
    g.beginPath(); g.roundRect(x + 2, y + 2, 28, 28, 8); g.fill();
    g.fillStyle = "rgba(255,255,255,.04)"; g.beginPath(); g.roundRect(x + 5, y + 4, 16, 8, 4); g.fill();
  }
}
export function stoneWall(g, w, h){
  g.fillStyle = "#2a2833"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 24) for (let x = (y / 24) % 2 ? -30 : 0; x < w; x += 60) {
    const l = 36 + rand() * 16; g.fillStyle = `rgb(${l},${l - 3},${l + 4})`; g.fillRect(x + 1, y + 1, 58, 22);
  }
  g.fillStyle = "rgba(0,0,0,.25)"; for (let i = 0; i < 40; i++) g.fillRect(rand() * w, rand() * h, 2 + rand() * 30, 2 + rand() * 4);
}
export function planks(g, w, h){
  g.fillStyle = "#2b1d14"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) { const l = 46 + rand() * 18; g.fillStyle = `rgb(${l},${l * .7 | 0},${l * .5 | 0})`; g.fillRect(0, y + 1, w, 30);
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(rand() * w, y, 3, 32); }
}
export function gothicWindow(lit){
  return (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const path = () => { g.beginPath(); g.moveTo(8, h - 6); g.lineTo(8, h * .42); g.quadraticCurveTo(8, 10, w / 2, 4); g.quadraticCurveTo(w - 8, 10, w - 8, h * .42); g.lineTo(w - 8, h - 6); g.closePath(); };
    g.fillStyle = "#0d0c14"; path(); g.fill(); g.save(); path(); g.clip();
    const gr = g.createLinearGradient(0, 0, 0, h);
    if (lit) { gr.addColorStop(0, "#ffd27a"); gr.addColorStop(1, "#ff8a2a"); } else { gr.addColorStop(0, "#1b2a44"); gr.addColorStop(1, "#0b1020"); }
    g.fillStyle = gr; g.fillRect(12, 10, w - 24, h - 20);
    g.strokeStyle = "#0d0c14"; g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h); g.moveTo(8, h * .6); g.lineTo(w - 8, h * .6); g.stroke();
    g.restore();
  };
}

/* ------------------------------------------------------------------ layout ------------------------------------------------------------------ */
// ground: max of these (default 0). box: {x0,x1,z0,z1,h}; ramp: {x0,x1,z0,z1,axis:"z",h0 (at z0), h1 (at z1)}
const SURF = [
  { x0: -68, x1: 68, z0: -68, z1: -14, h: 4 },                                // upper town
  { x0: -68, x1: -61, z0: -14, z1: 44, h: 6 },                                // city-wall walk (west)
  { ramp: true, x0: -7, x1: 7, z0: -14, z1: -4, h0: 4, h1: 0 },               // grand staircase
  { ramp: true, x0: 46, x1: 54, z0: -14, z1: 4, h0: 4, h1: 0 },               // east ramp
  { ramp: true, x0: -68, x1: -61, z0: -32, z1: -14, h0: 4, h1: 6 },           // ramp up to the wall walk
];
const BOUNDS = { x0: -68, x1: 68, z0: -68, z1: 68 };
// buildings: [x0,x1,z0,z1,height, enterable door side ("n"=-z,"s"=+z,"e"=+x,"w"=-x) or null]
const BUILDINGS = [
  // south: gate courtyard (tutorial) is x -12..12, z 44..66
  [-30, -12, 46, 66, 14], [12, 30, 46, 66, 14], [-50, -30, 50, 66, 12], [30, 50, 50, 66, 12], [-61, -50, 46, 66, 10], [50, 68, 46, 66, 10],
  // main street (x -8..8, z 12..44)
  [-24, -10, 26, 40, 7, "e"], [-24, -10, 12, 22, 12], [10, 24, 28, 44, 13], [10, 24, 12, 24, 7, "w"],
  // west lower district
  [-52, -36, -2, 12, 7, "e"], [-54, -36, 20, 32, 12], [-58, -44, 36, 44, 10],
  // east lower district
  [34, 50, 18, 30, 7, "s"], [56, 66, 8, 30, 12], [34, 48, 36, 44, 10],
  // upper town
  [-46, -30, -42, -28, 7, "s"], [30, 46, -46, -32, 7, "w"],
  [-60, -50, -62, -48, 12], [-44, -28, -62, -52, 11], [26, 40, -62, -54, 12], [50, 64, -62, -46, 13], [50, 62, -40, -24, 10],
];
const CATHEDRAL = { x0: -15, x1: 15, z0: -62, z1: -34, h: 18 };
// aliens waiting around the district: [x, z, count, flags] — r = roams a little, c = one of them is a caster
const NESTS = [
  [-12, 2, 2, "r"], [14, 6, 2, "r"],                          // market square
  [0, 20, 2, "r"], [-30, 20, 2, "r"], [40, 4, 2, "r"],        // main street, west alley, east yard
  [-17, 33, 3, "in"], [17, 18, 3, "in"], [-44, 5, 3, "in"], [42, 24, 3, "in"],   // lower houses
  [-46, -8, 3, "r"], [58, 38, 3, "r"],                        // side districts
  [-20, -22, 2, "r"], [20, -22, 2, "r"], [0, -17, 1, "c"],    // upper plaza (caster above the stairs)
  [-50, -30, 2, "r"], [40, -20, 2, "r"],                      // upper town corners
  [-38, -35, 3, "in"], [38, -39, 3, "in c"],                  // upper houses
  [0, -50, 5, "in c"],                                        // cathedral
  [-64.5, 12, 1, "c"], [-64.5, 22, 1, ""],                    // on the city wall
];
const LAMPS = [[-7, 42], [7, 34], [-7, 26], [7, 16], [-22, 9], [22, 9], [-28, -2], [28, -2], [-44, 16], [-40, 42], [44, 34], [62, 36], [58, 4],
  [-9, -16], [9, -16], [-26, -20], [26, -20], [-40, -24], [40, -26], [-64.5, 30], [-64.5, -4]];

export function groundY(x, z){
  let y = 0;
  for (const s of SURF) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    const h = s.ramp ? s.h0 + (s.h1 - s.h0) * (z - s.z0) / (s.z1 - s.z0) : s.h;
    if (h > y) y = h;
  }
  return y;
}

// scene = the Group this world is built into (the game shows one world at a time)
export function buildWorld(scene){
  seed = 1337;
  const colliders = [];   // 3D boxes: {minX,maxX,minY,maxY,minZ,maxZ}
  const addCol = (x0, x1, z0, z1, y0, y1) => colliders.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), minY: y0, maxY: y1 });
  const doors = [];       // nav helpers: [{out:{x,z}, in:{x,z}}]
  const lightSpots = [];  // positions the moving light pool snaps to
  const mm = { solid: [], enter: [], doors: [], areas: [   // minimap drawing data; areas = raised ground [x0,x1,z0,z1,colour]
    [-68, 68, -68, -14, "#231f33"], [-68, -61, -14, 44, "#2c2640"], [-7, 7, -14, -4, "#3a3352"], [46, 54, -14, 4, "#3a3352"], [-68, -61, -32, -14, "#3a3352"]] };

  // ---- sky / fog / light ----
  const env = { bg: new THREE.Color(0x0e1222), fog: new THREE.FogExp2(0x151a2c, 0.013) };   // lighter night so enemies read better, still gothic
  scene.add(new THREE.HemisphereLight(0x8a90c8, 0x2a2232, 1.35));
  const moonLight = new THREE.DirectionalLight(0xb4c6ff, 1.0); moonLight.position.set(-40, 80, -60); scene.add(moonLight);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(256, 256, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 10, w / 2, w / 2, w / 2); gr.addColorStop(0, "rgba(255,248,220,1)"); gr.addColorStop(.35, "rgba(255,240,200,.95)");
    gr.addColorStop(.42, "rgba(200,210,255,.25)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, w); }), fog: false, depthWrite: false }));
  moon.position.set(-120, 160, -300); moon.scale.set(90, 90, 1); scene.add(moon);
  const starGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 700; i++) { const a = rand() * Math.PI * 2, e = rr(.15, 1.3), R = 380; sp.push(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R); }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfc8ff, size: 1.2, sizeAttenuation: false, fog: false })));

  // ---- materials ----
  const cobTex = canvasTex(512, 512, cobbles); cobTex.wrapS = cobTex.wrapT = THREE.RepeatWrapping;
  const groundMat = new THREE.MeshStandardMaterial({ map: cobTex, roughness: .9 });
  const wallTex = canvasTex(512, 512, stoneWall); wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  const wallMats = [0x8a8698, 0x7a8090, 0x958a86, 0x6f6a80].map(c => new THREE.MeshStandardMaterial({ map: wallTex, color: c, roughness: .95 }));
  const innerMat = new THREE.MeshStandardMaterial({ map: wallTex, color: 0x6a5a55, roughness: .95 });
  const floorTex = canvasTex(256, 256, planks); floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: .8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1824, roughness: .8, metalness: .1, flatShading: true });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2c2838, roughness: .9 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x14131a, roughness: .5, metalness: .6 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: .9 });
  const litWin = new THREE.MeshBasicMaterial({ map: canvasTex(64, 128, gothicWindow(true)), transparent: true });
  const darkWin = new THREE.MeshStandardMaterial({ map: canvasTex(64, 128, gothicWindow(false)), transparent: true, roughness: .3, metalness: .4 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc36b });

  const geos = new Map();
  const add = (mat, geo) => { if (!geos.has(mat)) geos.set(mat, []); geos.get(mat).push(geo); };
  // box with world-size uvs (texture keeps its scale on any box)
  const box = (x0, x1, y0, y1, z0, z1, mat, uvScale = 6) => {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0; if (w <= 0 || h <= 0 || d <= 0) return;
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) / uvScale, uv.getY(i) * Math.max(h, Math.min(w, d)) / uvScale);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); add(mat, g);
  };
  const plane = (x0, x1, z0, z1, y, mat, tile = 4) => {   // horizontal, facing up
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / tile, uv.getY(i) * (z1 - z0) / tile);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); add(mat, g);
  };
  const wins = { lit: [], dark: [] };
  const windowRow = (face, fixed, from, to, base, h, skip) => {   // pointed windows along one wall
    const floors = Math.max(1, Math.floor((h - 2) / 3.4)), cols = Math.max(1, Math.floor((to - from) / 3.4));
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const along = from + (c + .5) * (to - from) / cols, y = base + 2.6 + f * 3.4;
      if (skip && skip(along, y)) continue; if (rand() < .12) continue;
      const ry = face === "e" ? Math.PI / 2 : face === "w" ? -Math.PI / 2 : face === "s" ? 0 : Math.PI;
      const o = face === "e" || face === "w" ? { x: fixed, z: along } : { x: along, z: fixed };
      (rand() < .3 ? wins.lit : wins.dark).push({ x: o.x, y, z: o.z, ry });
    }
  };
  const roof = (x0, x1, z0, z1, base) => {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (rand() < .22) { const t = new THREE.ConeGeometry(Math.min(w, d) * .6, rr(8, 14), 4); t.rotateY(Math.PI / 4); t.translate(cx, base + t.parameters.height / 2, cz); add(roofMat, t); return; }
    const alongX = w > d, span = alongX ? d : w, len = alongX ? w : d, rh = rr(3.5, 6.5);
    const shape = new THREE.Shape([new THREE.Vector2(-span / 2 - .4, 0), new THREE.Vector2(span / 2 + .4, 0), new THREE.Vector2(0, rh)]);
    const r = new THREE.ExtrudeGeometry(shape, { depth: len + .4, bevelEnabled: false });
    if (alongX) { r.rotateY(Math.PI / 2); r.translate(x0 - .2, base, cz); } else r.translate(cx, base, z0 - .2);
    add(roofMat, r);
    if (rand() < .5) box(cx + rr(-w / 4, w / 4) - .4, cx + rr(-w / 4, w / 4) + .4, base + rh * .4, base + rh * .4 + rr(2, 3), cz - .4, cz + .4, trimMat);
  };

  // ---- terrain: lower ground, upper town block, wall walk, stairs and ramps ----
  plane(-68, 68, -14, 68, 0, groundMat);
  box(-68, 68, 0, 4, -68, -14, wallMats[1]); plane(-68, 68, -68, -14, 4.01, groundMat);
  box(-68, -61, 0, 6, -14, 44, wallMats[3]); plane(-68, -61, -14, 44, 6.01, groundMat);
  for (let z = 44 - 3; z > -14; z -= 3) box(-61.4, -60.6, 6, 7.1, z - .6, z + .6, trimMat);   // crenellations on the wall walk
  const steps = (s, n) => { for (let i = 0; i < n; i++) { const za = s.z0 + (s.z1 - s.z0) * i / n, zb = s.z0 + (s.z1 - s.z0) * (i + 1) / n;
    const top = Math.max(groundY((s.x0 + s.x1) / 2, za + .01), groundY((s.x0 + s.x1) / 2, zb - .01));
    box(s.x0, s.x1, 0, top, Math.min(za, zb), Math.max(za, zb), wallMats[2], 3); plane(s.x0, s.x1, Math.min(za, zb), Math.max(za, zb), top + .01, groundMat, 3); } };
  steps(SURF[2], 10); steps(SURF[3], 18); steps(SURF[4], 14);
  for (const x of [-7.4, 7.4]) box(x - .4, x + .4, 0, 4.6, -14, -4, trimMat);   // stair balustrades
  addCol(-7.8, -7, -14, -4, 0, 5); addCol(7, 7.8, -14, -4, 0, 5);
  // perimeter city wall
  for (const [x0, x1, z0, z1] of [[-72, 72, -72, -68], [-72, 72, 68, 72], [-72, -68, -68, 68], [68, 72, -68, 68]]) { box(x0, x1, 0, 14, z0, z1, wallMats[0]); addCol(x0, x1, z0, z1, -5, 30); }

  // ---- buildings ----
  function solidHouse(x0, x1, z0, z1, h){
    const base = groundY((x0 + x1) / 2, (z0 + z1) / 2), mat = wallMats[Math.floor(rand() * wallMats.length)];
    box(x0, x1, base - 1, base + h, z0, z1, mat);
    box(x0 - .15, x1 + .15, base + h, base + h + .35, z0 - .15, z1 + .15, trimMat);
    box(x0 - .1, x1 + .1, base, base + .6, z0 - .1, z1 + .1, trimMat);
    roof(x0, x1, z0, z1, base + h);
    windowRow("e", x1 + .03, z0, z1, base, h); windowRow("w", x0 - .03, z0, z1, base, h);
    windowRow("s", z1 + .03, x0, x1, base, h); windowRow("n", z0 - .03, x0, x1, base, h);
    addCol(x0, x1, z0, z1, base - 1, base + h + 8);
    mm.solid.push([x0, x1, z0, z1]);
  }
  // enterable: 4 walls with a door gap, a ceiling, a roof, a plank floor and some furniture
  function enterHouse(x0, x1, z0, z1, h, door, opt = {}){
    const base = groundY((x0 + x1) / 2, (z0 + z1) / 2), t = opt.thick || .45, mat = opt.mat || wallMats[Math.floor(rand() * wallMats.length)];
    const dw = opt.doorW || 2.6, dh = opt.doorH || 3.2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const sides = { n: [x0, x1, z0, z0 + t], s: [x0, x1, z1 - t, z1], w: [x0, x0 + t, z0, z1], e: [x1 - t, x1, z0, z1] };
    for (const [k, [a0, a1, b0, b1]] of Object.entries(sides)) {
      const wall = (ax0, ax1, bz0, bz1, y0, y1) => { box(ax0, ax1, y0, y1, bz0, bz1, mat); addCol(ax0, ax1, bz0, bz1, y0, y1); };
      if (k !== door) { wall(a0, a1, b0, b1, base, base + h); continue; }
      if (k === "n" || k === "s") { wall(a0, cx - dw / 2, b0, b1, base, base + h); wall(cx + dw / 2, a1, b0, b1, base, base + h); wall(cx - dw / 2, cx + dw / 2, b0, b1, base + dh, base + h); }
      else { wall(a0, a1, b0, cz - dw / 2, base, base + h); wall(a0, a1, cz + dw / 2, b1, base, base + h); wall(a0, a1, cz - dw / 2, cz + dw / 2, base + dh, base + h); }
    }
    // inner skin so the inside isn't the same grey as the street, floor, ceiling, roof
    box(x0 + t, x1 - t, base + h - .35, base + h, z0 + t, z1 - t, trimMat);
    plane(x0 + t, x1 - t, z0 + t, z1 - t, base + .02, floorMat, 3);
    box(x0 - .15, x1 + .15, base + h, base + h + .35, z0 - .15, z1 + .15, trimMat);
    if (!opt.noRoof) roof(x0, x1, z0, z1, base + h);
    const skipDoor = (along, y) => (along > (door === "n" || door === "s" ? cx : cz) - dw && along < (door === "n" || door === "s" ? cx : cz) + dw);
    windowRow("e", x1 + .03, z0, z1, base, h, door === "e" && skipDoor); windowRow("w", x0 - .03, z0, z1, base, h, door === "w" && skipDoor);
    windowRow("s", z1 + .03, x0, x1, base, h, door === "s" && skipDoor); windowRow("n", z0 - .03, x0, x1, base, h, door === "n" && skipDoor);
    // door frame (dark arch) and a warm lamp over it
    const dir = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[door];
    const dx = door === "e" ? x1 : door === "w" ? x0 : cx, dz = door === "s" ? z1 : door === "n" ? z0 : cz;
    const lamp = new THREE.BoxGeometry(.35, .45, .35); lamp.translate(dx + dir[0] * .5, base + dh + .6, dz + dir[1] * .5); add(lampMat, lamp);
    doors.push({ out: { x: dx + dir[0] * 2.2, z: dz + dir[1] * 2.2 }, in: { x: dx - dir[0] * 2.2, z: dz - dir[1] * 2.2 } });
    // furniture = cover inside
    if (!opt.noFurniture) {
      const tx = cx + rr(-1.5, 1.5), tz = cz + rr(-1.5, 1.5);
      box(tx - 1.1, tx + 1.1, base + .8, base + .95, tz - .6, tz + .6, woodMat); box(tx - .1, tx + .1, base, base + .8, tz - .1, tz + .1, woodMat); addCol(tx - 1.1, tx + 1.1, tz - .6, tz + .6, base, base + 1);
      for (let i = 0; i < 3; i++) { const bx = rr(x0 + t + .8, x1 - t - .8), bz = rr(z0 + t + .8, z1 - t - .8);
        if (Math.hypot(bx - (door === "e" || door === "w" ? dx : cx), bz - (door === "n" || door === "s" ? dz : cz)) < 3.5) continue;
        const s = rr(.8, 1.2); box(bx - s / 2, bx + s / 2, base, base + s, bz - s / 2, bz + s / 2, woodMat); addCol(bx - s / 2, bx + s / 2, bz - s / 2, bz + s / 2, base, base + s); }
    }
    lightSpots.push({ x: cx, y: base + h - 1.2, z: cz, color: 0xffa860, power: 18, dist: 16 });
    const candle = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb070, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
    candle.position.set(cx, base + h - 1.2, cz); candle.scale.set(2.4, 2.4, 1); scene.add(candle);
    mm.enter.push([x0, x1, z0, z1]); mm.doors.push([dx, dz, door]);
    return { base, cx, cz };
  }
  for (const b of BUILDINGS) { if (b[5]) enterHouse(b[0], b[1], b[2], b[3], b[4], b[5]); else solidHouse(b[0], b[1], b[2], b[3], b[4]); }

  // ---- cathedral: a big enterable hall with pillars, towers with spires, rose window ----
  { const C = CATHEDRAL, base = 4;
    const ch = enterHouse(C.x0, C.x1, C.z0, C.z1, C.h, "s", { thick: 1, doorW: 6, doorH: 7.5, noRoof: true, noFurniture: true, mat: wallMats[0] });
    const naveRoof = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-15.6, 0), new THREE.Vector2(15.6, 0), new THREE.Vector2(0, 13)]), { depth: C.z1 - C.z0 + .4, bevelEnabled: false });
    naveRoof.translate(0, base + C.h, C.z0 - .2); add(roofMat, naveRoof);
    for (const px of [-7, 7]) for (let pz = C.z0 + 6; pz < C.z1 - 4; pz += 6) { box(px - .7, px + .7, base, base + C.h, pz - .7, pz + .7, trimMat); addCol(px - .7, px + .7, pz - .7, pz + .7, base, base + C.h); }
    box(-3, 3, base, base + 1.2, C.z0 + 2, C.z0 + 4, woodMat); addCol(-3, 3, C.z0 + 2, C.z0 + 4, base, base + 1.2);   // altar
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -21 : 15, x1 = x0 + 6; box(x0, x1, base, base + 30, -40, -34, wallMats[3]); addCol(x0, x1, -40, -34, base, base + 30);
      const spire = new THREE.ConeGeometry(4.4, 18, 8); spire.translate((x0 + x1) / 2, base + 30 + 9, -37); add(roofMat, spire);
      mm.solid.push([x0, x1, -40, -34]);
      wins.lit.push({ x: (x0 + x1) / 2, y: base + 18, z: -33.95, ry: 0, s: 1.4 }); wins.dark.push({ x: (x0 + x1) / 2, y: base + 24, z: -33.95, ry: 0, s: 1.4 });
    }
    const roseTex = canvasTex(256, 256, (g, w) => {
      g.fillStyle = "#1a0a14"; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 12; i++) { g.save(); g.translate(w / 2, w / 2); g.rotate(i * Math.PI / 6);
        const gr = g.createLinearGradient(0, 0, 0, w / 2); gr.addColorStop(0, "#ff5a8a"); gr.addColorStop(1, i % 2 ? "#6a5aff" : "#ffcf5c");
        g.fillStyle = gr; g.beginPath(); g.ellipse(0, w / 4, 14, w / 4 - 8, 0, 0, 7); g.fill(); g.restore(); }
      g.fillStyle = "#ffe9a8"; g.beginPath(); g.arc(w / 2, w / 2, 18, 0, 7); g.fill(); });
    for (const [z, ry] of [[C.z1 + .05, 0], [C.z1 - 1.05, Math.PI]]) { const rose = new THREE.Mesh(new THREE.CircleGeometry(4.5, 32), new THREE.MeshBasicMaterial({ map: roseTex })); rose.position.set(0, base + 12.5, z); rose.rotation.y = ry; scene.add(rose); }
    lightSpots.push({ x: 0, y: base + 10, z: -40, color: 0xff6a9a, power: 40, dist: 34 }, { x: 0, y: base + 8, z: -56, color: 0xffb070, power: 30, dist: 26 });
  }

  // ---- lamps: every lamp glows (sprite); the nearest ones get a real light from the pool ----
  for (const [x, z] of LAMPS) {
    const y0 = groundY(x, z);
    const pole = new THREE.CylinderGeometry(.09, .14, 5, 8); pole.translate(x, y0 + 2.5, z); add(ironMat, pole);
    const head = new THREE.BoxGeometry(.45, .6, .45); head.translate(x, y0 + 5.2, z); add(lampMat, head);
    colliders.push({ minX: x - .2, maxX: x + .2, minZ: z - .2, maxZ: z + .2, minY: y0, maxY: y0 + 5 });
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa24a, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.set(x, y0 + 5.2, z); glow.scale.set(3, 3, 1); scene.add(glow);
    lightSpots.push({ x, y: y0 + 4.6, z, color: 0xffa24a, power: 26, dist: 20 });
  }
  // fountain in the market square (cover)
  { const fx = -18, fz = 3, g1 = new THREE.CylinderGeometry(3.4, 3.8, 1, 24); g1.translate(fx, .5, fz); add(trimMat, g1);
    const g2 = new THREE.CylinderGeometry(.5, .7, 4, 12); g2.translate(fx, 2.5, fz); add(wallMats[0], g2); addCol(fx - 3.6, fx + 3.6, fz - 3.6, fz + 3.6, 0, 1.1); addCol(fx - .7, fx + .7, fz - .7, fz + .7, 0, 4.5); }
  // crates & barrels as cover in the streets
  for (const [x, z] of [[-5, 36], [5, 22], [-24, 6], [25, 0], [-40, 28], [46, 12], [-30, -24], [34, -20], [-12, -28], [60, 22], [-54, -10], [4, 58], [-8, 50]]) {
    const y0 = groundY(x, z), s = rr(.9, 1.3); box(x - s / 2, x + s / 2, y0, y0 + s, z - s / 2, z + s / 2, woodMat); addCol(x - s / 2, x + s / 2, z - s / 2, z + s / 2, y0, y0 + s);
    const s2 = s * .7; box(x + s / 2, x + s / 2 + s2, y0, y0 + s2, z - s2 / 2, z + s2 / 2, woodMat); addCol(x + s / 2, x + s / 2 + s2, z - s2 / 2, z + s2 / 2, y0, y0 + s2);
  }

  // ---- merge static geometry per material ----
  for (const [mat, list] of geos) {
    const clean = list.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(k)) n.deleteAttribute(k); return n; });
    scene.add(new THREE.Mesh(mergeGeometries(clean, false), mat));
  }
  const winGeo = new THREE.PlaneGeometry(1.3, 2.3);
  for (const [key, mat] of [["lit", litWin], ["dark", darkWin]]) {
    const list = wins[key], im = new THREE.InstancedMesh(winGeo, mat, list.length), o = new THREE.Object3D();
    list.forEach((w, i) => { o.position.set(w.x, w.y, w.z); o.rotation.set(0, w.ry, 0); o.scale.setScalar(w.s || 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    scene.add(im);
  }

  // ---- a pool of 10 real point lights that follow the player to the nearest light spots ----
  // (a constant light count means no shader recompiles; far lamps are just glowing sprites)
  const pool = Array.from({ length: 10 }, () => { const L = new THREE.PointLight(0xffa24a, 0, 20, 1.7); scene.add(L); return L; });
  let poolT = 0;
  function updateLights(px, pz){
    const near = lightSpots.map(s => ({ s, d: (s.x - px) ** 2 + (s.z - pz) ** 2 })).sort((a, b) => a.d - b.d).slice(0, pool.length);
    near.forEach(({ s }, i) => { const L = pool[i]; L.position.set(s.x, s.y, s.z); L.color.setHex(s.color); L.userData.power = s.power; L.distance = s.dist; });
  }

  // ---- dust ----
  const dustN = 900, dustGeo = new THREE.BufferGeometry(), dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dp[i * 3] = rr(-66, 66); dp[i * 3 + 1] = rr(0, 16); dp[i * 3 + 2] = rr(-66, 66); }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xaab0d8, size: .06, transparent: true, opacity: .5, depthWrite: false })));

  const P = makePhysics(groundY, BOUNDS, colliders, doors);
  return {
    ...P, colliders, groundY, nests: NESTS, mm, bounds: BOUNDS, env,
    // escape route (left-4-dead style): checkpoints in order, the last one is the way out
    route: [
      { x: -10, z: 7, ko: "시장", en: "Market square" },
      { x: 40, z: 7, ko: "동쪽 마당", en: "East yard" },
      { x: 50, z: -20, ko: "윗마을", en: "Upper town (east ramp)" },
      { x: -64.5, z: 18, ko: "성벽 위", en: "On the city wall" },
      { x: 0, z: -54, ko: "대성당 제단", en: "Cathedral altar — escape!" },
    ],
    // fortress mode: fortification sites (4 build pads + a merchant spot each), used in this order
    zones: [
      { ko: "성문 마당", en: "Gate courtyard", x: 0, z: 52, pads: [[-9, 46], [9, 46], [-9, 57], [9, 55]], shop: [0, 60] },
      { ko: "시장", en: "Market square", x: 2, z: 4, pads: [[-6, -1], [8, -1], [-6, 10], [10, 9]], shop: [2, 11] },
      { ko: "동쪽 마당", en: "East yard", x: 42, z: 8, pads: [[35, 2], [43, 13], [35, 13], [51, 12]], shop: [42, 3] },
      { ko: "윗마을 동쪽", en: "Upper town east", x: 40, z: -21, pads: [[35, -16], [46, -16], [35, -27], [46, -27]], shop: [41, -21] },
      { ko: "대성당 광장", en: "Cathedral plaza", x: 0, z: -24, pads: [[-11, -20], [11, -20], [-11, -29], [11, -29]], shop: [0, -30] },
      { ko: "서쪽 골목", en: "West quarter", x: -46, z: -8, pads: [[-55, -5], [-38, -5], [-55, -12], [-38, -12]], shop: [-46, -11] },
    ],
    spawn: { x: 0, z: 62 }, gunSpot: new THREE.Vector3(0, 0, 51),
    tutorialSpawns: [new THREE.Vector3(0, 0, 30), new THREE.Vector3(0, 0, 32)],
    update(t, dt, px, pz){
      for (let i = 0; i < dustN; i++) { dp[i * 3 + 1] -= dt * .15; dp[i * 3] += Math.sin(t * .3 + i) * dt * .1; if (dp[i * 3 + 1] < 0) dp[i * 3 + 1] = 16; }
      dustGeo.attributes.position.needsUpdate = true;
      poolT -= dt; if (poolT <= 0) { poolT = .4; updateLights(px, pz); }
      pool.forEach((L, i) => L.intensity = (L.userData.power || 0) + Math.sin(t * 7 + i * 3) * 1.2);
    },
  };
}

/* ------------------------------------------------------------------ physics (shared by every world) ------------------------------------------------------------------ */
// groundY(x,z) = walkable height, colliders = 3D boxes, doors = nav helpers through doorways
export function makePhysics(groundY, BOUNDS, colliders, doors = []){
  /* ------------------------------ physics helpers ------------------------------ */
  const insideCol = (x, z, y, r) => colliders.some(c => c.minY < y + 1.7 && c.maxY > y + .3 && x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r);
  // push a circle (feet at e.y) out of colliders that overlap its height
  function collide(e, r){
    for (const c of colliders) {
      if (!(c.minY < e.y + 1.7 && c.maxY > e.y + .3)) continue;
      const cx = Math.max(c.minX, Math.min(e.x, c.maxX)), cz = Math.max(c.minZ, Math.min(e.z, c.maxZ));
      const dx = e.x - cx, dz = e.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) { const d = Math.sqrt(d2); e.x = cx + dx / d * r; e.z = cz + dz / d * r; }
        else { const o = [e.x - c.minX, c.maxX - e.x, e.z - c.minZ, c.maxZ - e.z], k = o.indexOf(Math.min(...o));
          if (k === 0) e.x = c.minX - r; else if (k === 1) e.x = c.maxX + r; else if (k === 2) e.z = c.minZ - r; else e.z = c.maxZ + r; }
      }
    }
    e.x = Math.max(BOUNDS.x0 + r, Math.min(BOUNDS.x1 - r, e.x)); e.z = Math.max(BOUNDS.z0 + r, Math.min(BOUNDS.z1 - r, e.z));
  }
  // horizontal move that refuses to climb more than STEP (dropping down is fine), then gravity/snap
  function moveEntity(e, dx, dz, r, dt){
    const ok = (x, z) => groundY(x, z) - e.y <= STEP;
    let nx = e.x + dx, nz = e.z + dz;
    if (!ok(nx, nz)) { if (ok(e.x + dx, e.z)) nz = e.z; else if (ok(e.x, e.z + dz)) nx = e.x; else { nx = e.x; nz = e.z; } }
    e.x = nx; e.z = nz; collide(e, r);
    const gy = groundY(e.x, e.z);
    if (e.y > gy + .02) { e.vy = (e.vy || 0) - 22 * dt; e.y = Math.max(gy, e.y + e.vy * dt); if (e.y === gy) e.vy = 0; }
    else { e.y = gy; e.vy = 0; }
  }
  // distance along a ray until it hits a wall/box or the ground (Infinity if clear up to maxD)
  function rayBlock(o, d, maxD){
    let best = maxD;
    for (const c of colliders) {
      let t0 = 0, t1 = best, hit = true;
      for (const [oa, da, mn, mx] of [[o.x, d.x, c.minX, c.maxX], [o.y, d.y, c.minY, c.maxY], [o.z, d.z, c.minZ, c.maxZ]]) {
        if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) { hit = false; break; } continue; }
        let ta = (mn - oa) / da, tb = (mx - oa) / da; if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 < best) best = t0;
    }
    for (let t = .3; t < best; t += .35) { if (o.y + d.y * t < groundY(o.x + d.x * t, o.z + d.z * t) - .05) { best = t; break; } }
    return best < maxD ? best : Infinity;
  }
  const _d = new THREE.Vector3();
  function losClear(a, b){ _d.subVectors(b, a); const L = _d.length(); _d.divideScalar(L); return rayBlock(a, _d, L - .3) === Infinity; }
  function walkable(ax, az, bx, bz, r = .45){
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / .4));
    let py = groundY(ax, az);
    for (let i = 1; i <= n; i++) { const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n, y = groundY(x, z);
      if (y - py > STEP || py - y > 1.2 || insideCol(x, z, y, r)) return false; py = y; }
    return true;
  }
  
  /* ------------------------------ nav graph (grid + door nodes) + A* ------------------------------ */
  const nodes = [], adj = [];
  const G4 = 4;
  const gridIdx = new Map();
  for (let x = BOUNDS.x0 + 2; x <= BOUNDS.x1 - 2; x += G4) for (let z = BOUNDS.z0 + 2; z <= BOUNDS.z1 - 2; z += G4) {
    const y = groundY(x, z); if (insideCol(x, z, y, .7)) continue;
    gridIdx.set(x + "," + z, nodes.length); nodes.push({ x, z, y }); adj.push([]);
  }
  const link = (i, j) => { if (!adj[i].includes(j)) adj[i].push(j); };
  for (const [k, i] of gridIdx) { const [x, z] = k.split(",").map(Number);
    for (const [ox, oz] of [[G4, 0], [0, G4], [G4, G4], [G4, -G4]]) { const j = gridIdx.get((x + ox) + "," + (z + oz)); if (j === undefined) continue;
      const a = nodes[i], b = nodes[j]; if (walkable(a.x, a.z, b.x, b.z, .4)) link(i, j); if (walkable(b.x, b.z, a.x, a.z, .4)) link(j, i); } }
  for (const d of doors) {   // door pairs: outside <-> inside, each tied to nearby grid nodes
    const io = nodes.length; nodes.push({ ...d.out, y: groundY(d.out.x, d.out.z) }); adj.push([]);
    const ii = nodes.length; nodes.push({ ...d.in, y: groundY(d.in.x, d.in.z) }); adj.push([]);
    link(io, ii); link(ii, io);
    for (const k of [io, ii]) for (let j = 0; j < io; j++) { const a = nodes[k], b = nodes[j]; if (Math.hypot(a.x - b.x, a.z - b.z) < 7 && walkable(a.x, a.z, b.x, b.z, .4)) { link(k, j); link(j, k); } }
  }
  function nearestNode(x, z){
    let cands = nodes.map((n, i) => ({ i, d: (n.x - x) ** 2 + (n.z - z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 8);
    for (const c of cands) if (walkable(x, z, nodes[c.i].x, nodes[c.i].z, .3)) return c.i;
    return cands.length ? cands[0].i : -1;
  }
  function findPath(ax, az, bx, bz){
    const s = nearestNode(ax, az), t = nearestNode(bx, bz); if (s < 0 || t < 0) return null;
    const gS = new Map([[s, 0]]), came = new Map(), open = [{ i: s, f: 0 }], closed = new Set();
    const hf = i => Math.hypot(nodes[i].x - nodes[t].x, nodes[i].z - nodes[t].z);
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
      const { i } = open.splice(bi, 1)[0]; if (i === t) break; if (closed.has(i)) continue; closed.add(i);
      for (const j of adj[i]) { const g = gS.get(i) + Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
        if (g < (gS.get(j) ?? Infinity)) { gS.set(j, g); came.set(j, i); open.push({ i: j, f: g + hf(j) }); } }
    }
    if (!came.has(t) && s !== t) return null;
    const path = []; for (let c = t; c !== undefined && c !== s; c = came.get(c)) path.unshift({ x: nodes[c].x, z: nodes[c].z });
    return path;
  }
  
  // nearest spot around (x,z) where an alien fits (rings of 0.5 m out to 4 m)
  function freeSpot(x, z){
    for (let r = 0; r <= 4; r += .5) for (let k = 0; k < (r ? 12 : 1); k++) { const a = k / 12 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!insideCol(px, pz, groundY(px, pz), .5)) return { x: px, z: pz }; }
    return { x, z };
  }
  // a random walkable spot between min and max metres from (px,pz)
  function farSpot(px, pz, min, max){
    const c = nodes.filter(n => { const d = Math.hypot(n.x - px, n.z - pz); return d > min && d < max; });
    const n = c.length ? c[Math.floor(Math.random() * c.length)] : nodes[Math.floor(Math.random() * nodes.length)];
    return new THREE.Vector3(n.x, n.y, n.z);
  }
  return { collide, moveEntity, rayBlock, losClear, walkable, findPath, freeSpot, farSpot, insideCol, navSize: nodes.length };
}
