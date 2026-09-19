// 🦌 Deer sanctuary map: a snowy valley at night. The aliens enter through ONE gate in the south and follow a
// glowing road (S-bends through the pines) up a ramp to the sanctuary terrace at the back (+4 m), where the
// baby ice deer lives next to the 💎 ammo pedestal and the 🔧 trap workshop.
// Same physics as the other maps (makePhysics); the aliens walk the road's waypoints (world.road).
import * as THREE from "../../node_modules/three/build/three.module.js";
import { mergeGeometries } from "../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js";
import { canvasTex, stoneWall, makePhysics } from "./world.js";
import { glowTexture } from "./enemies.js";

let seed = 777;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + rand() * (b - a);

const H = 4;   // the sanctuary terrace
const BOUNDS = { x0: -50, x1: 50, z0: -70, z1: 70 };
const SURF = [
  { x0: -50, x1: 50, z0: -70, z1: -40, h: H },                          // sanctuary terrace
  { ramp: true, x0: -4, x1: 4, z0: -40, z1: -28, h0: H, h1: 0 },        // the ramp up (part of the road)
];
function groundY(x, z){
  let y = 0;
  for (const s of SURF) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    const h = s.ramp ? s.h0 + (s.h1 - s.h0) * (z - s.z0) / (s.z1 - s.z0) : s.h;
    if (h > y) y = h;
  }
  return y;
}
// the road the aliens follow, from the gate to the deer
const ROAD = [[0, 66], [0, 46], [-28, 40], [-30, 18], [26, 12], [28, -10], [0, -18], [0, -28], [0, -42], [0, -53]];
function roadDist(x, z){
  let best = Infinity;
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [ax, az] = ROAD[i], [bx, bz] = ROAD[i + 1], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)), px = ax + vx * t, pz = az + vz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}
const PADS = [[-12, 52], [-14, 27], [14, 2], [-11, -45], [16, -44]];   // the 5th only with the tech
const DEER = { x: 0, z: -60 }, PEDESTAL = { x: 10, z: -49 }, WORKSHOP = { x: -14, z: -50 };

export function buildSanctuaryWorld(root){
  seed = 777;
  const colliders = [];
  const addCol = (x0, x1, z0, z1, y0, y1) => colliders.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), minY: y0, maxY: y1 });
  const lightSpots = [];
  const mm = { solid: [], enter: [], doors: [], areas: [[-50, 50, -70, -40, "#243049"], [-4, 4, -40, -28, "#34466a"]], road: ROAD };
  const env = { bg: new THREE.Color(0x0b1628), fog: new THREE.FogExp2(0x18263e, 0.012) };

  // ---- sky: moon, stars, an aurora ----
  root.add(new THREE.HemisphereLight(0x9ab4e8, 0x2a3040, 1.45));
  const moonLight = new THREE.DirectionalLight(0xc4d6ff, 1.05); moonLight.position.set(40, 80, 60); root.add(moonLight);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(256, 256, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 10, w / 2, w / 2, w / 2); gr.addColorStop(0, "rgba(240,248,255,1)"); gr.addColorStop(.35, "rgba(220,235,255,.95)");
    gr.addColorStop(.42, "rgba(170,200,255,.25)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, w); }), fog: false, depthWrite: false }));
  moon.position.set(-160, 170, 300); moon.scale.set(90, 90, 1); root.add(moon);
  const starGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 800; i++) { const a = rand() * Math.PI * 2, e = rr(.15, 1.3), R = 380; sp.push(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R); }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  root.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xd4e2ff, size: 1.2, sizeAttenuation: false, fog: false })));
  const auroraTex = canvasTex(512, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "rgba(120,255,200,0)"); gr.addColorStop(.55, "rgba(120,255,200,.55)"); gr.addColorStop(1, "rgba(80,160,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const auroras = [];
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(420, 70, 24, 1), new THREE.MeshBasicMaterial({ map: auroraTex, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    m.position.set(-40 + i * 50, 120 + i * 18, -260 + i * 30); m.rotation.y = .2 - i * .15; root.add(m); auroras.push(m); }

  // ---- materials ----
  const snowTex = canvasTex(512, 512, (g, w, h) => { g.fillStyle = "#c9d6ea"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const l = 190 + rand() * 60; g.fillStyle = `rgba(${l - 20},${l - 8},${l},${rand() * .5})`; g.fillRect(rand() * w, rand() * h, 1 + rand() * 4, 1 + rand() * 3); } });
  snowTex.wrapS = snowTex.wrapT = THREE.RepeatWrapping;
  const snowMat = new THREE.MeshStandardMaterial({ map: snowTex, roughness: .95 });
  const roadTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#3a4458"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -16 : 0; x < w; x += 32) { const l = 70 + rand() * 30; g.fillStyle = `rgb(${l - 8},${l},${l + 18})`; g.beginPath(); g.roundRect(x + 2, y + 2, 28, 28, 7); g.fill(); } });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: .8, emissive: 0x1a3a50, emissiveIntensity: .35 });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: .75 });
  const wallTex = canvasTex(512, 512, stoneWall); wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  const stoneMat = new THREE.MeshStandardMaterial({ map: wallTex, color: 0x9aa8c0, roughness: .95 });
  const cliffMat = new THREE.MeshStandardMaterial({ map: wallTex, color: 0x9aa6c0, roughness: 1 });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x1f3b36, roughness: .9, flatShading: true });
  const pineSnow = new THREE.MeshStandardMaterial({ color: 0xe6f0ff, roughness: .9, flatShading: true });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: .9 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6c7890, roughness: .9, flatShading: true });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: .85 });
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: .15, metalness: .2, emissive: 0x3fa8ff, emissiveIntensity: .45, transparent: true, opacity: .9 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });

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

  // ---- ground, terrace, ramp, parapet ----
  plane(-50, 50, -40, 70, 0, snowMat, 8);
  box(-50, 50, 0, H, -70, -40, cliffMat); plane(-50, 50, -70, -40, H + .01, snowMat, 8);
  for (let i = 0; i < 12; i++) { const za = -40 + 12 * i / 12, zb = -40 + 12 * (i + 1) / 12, top = Math.max(groundY(0, za + .01), groundY(0, zb - .01));
    box(-4, 4, 0, top, za, zb, stoneMat, 3); plane(-4, 4, za, zb, top + .01, roadMat, 3);
    for (const x of [-4.5, 4]) { box(x, x + .5, 0, top + 1.1, za, zb, stoneMat, 3); addCol(x, x + .5, za, zb, 0, top + 1.2); } }   // side walls follow the slope
  for (const [a0, a1] of [[-50, -4.5], [4.5, 50]]) { box(a0, a1, H, H + 1.1, -40.5, -40, stoneMat); addCol(a0, a1, -40.5, -40, H, H + 1.2); }
  // valley walls (cliffs) with a gate in the south
  for (const [x0, x1, z0, z1] of [[-54, -50, -74, 74], [50, 54, -74, 74], [-54, 54, -74, -70], [-54, -4, 70, 74], [4, 54, 70, 74]]) { box(x0, x1, 0, 16, z0, z1, cliffMat, 8); addCol(x0, x1, z0, z1, -5, 30); }
  for (const x of [-5.5, 4.5]) box(x, x + 1, 0, 11, 69.5, 74.5, stoneMat);
  box(-5.5, 5.5, 9.5, 11.5, 69.5, 74.5, stoneMat);   // gate arch
  addCol(-4, 4, 73, 74, 0, 30);                       // (nobody leaves through the gate)

  // ---- the glowing road ----
  const roadY = (x, z) => groundY(x, z) + .03;
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [ax, az] = ROAD[i], [bx, bz] = ROAD[i + 1];
    if (az <= -28 && bz <= -28 && az > -40.5) continue;   // the ramp already is road
    const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bx - ax, bz - az), y = roadY((ax + bx) / 2, (az + bz) / 2);
    const g = new THREE.PlaneGeometry(5, len + 5); g.rotateX(-Math.PI / 2); g.rotateY(ang);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 5 / 3, uv.getY(k) * (len + 5) / 3);
    g.translate((ax + bx) / 2, y + i * .002, (az + bz) / 2); add(roadMat, g);
    for (const s of [-1, 1]) { const e = new THREE.BoxGeometry(.18, .06, len + 1); e.rotateY(ang); const ox = Math.cos(ang) * 2.6 * s, oz = -Math.sin(ang) * 2.6 * s;
      e.translate((ax + bx) / 2 + ox, y + .03, (az + bz) / 2 + oz); add(edgeMat, e); }
  }
  // lanterns along the road (ice-blue)
  for (let i = 0; i < ROAD.length - 1; i++) { const [ax, az] = ROAD[i], [bx, bz] = ROAD[i + 1], len = Math.hypot(bx - ax, bz - az);
    for (let d = 6; d < len - 3; d += 13) { const t = d / len, s = (i + Math.round(d)) % 2 ? 1 : -1, ang = Math.atan2(bx - ax, bz - az);
      const x = ax + (bx - ax) * t + Math.cos(ang) * 4.2 * s, z = az + (bz - az) * t - Math.sin(ang) * 4.2 * s, y0 = groundY(x, z);
      if (Math.abs(x) < 5.5 && z < -27 && z > -41) continue;
      const pole = new THREE.CylinderGeometry(.08, .12, 3, 8); pole.translate(x, y0 + 1.5, z); add(woodMat, pole);
      const head = new THREE.BoxGeometry(.4, .5, .4); head.translate(x, y0 + 3.2, z); add(lampMat, head);
      colliders.push({ minX: x - .2, maxX: x + .2, minZ: z - .2, maxZ: z + .2, minY: y0, maxY: y0 + 3 });
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7ce8ff, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.set(x, y0 + 3.2, z); glow.scale.set(2.6, 2.6, 1); root.add(glow);
      lightSpots.push({ x, y: y0 + 3, z, color: 0x8fdcff, power: 18, dist: 16 }); } }

  // ---- pines and rocks, never on the road or the build spots ----
  const clear = (x, z, r) => roadDist(x, z) > r && PADS.every(([px, pz]) => Math.hypot(px - x, pz - z) > 4.5) && Math.hypot(x - DEER.x, z - DEER.z) > 12
    && Math.hypot(x - PEDESTAL.x, z - PEDESTAL.z) > 6 && Math.hypot(x - WORKSHOP.x, z - WORKSHOP.z) > 7 && !(Math.abs(x) < 7 && z > -42 && z < -26);
  let trees = 0;
  for (let k = 0; k < 900 && trees < 120; k++) {
    const x = rr(-47, 47), z = rr(-67, 67); if (!clear(x, z, 6.5)) continue; if (Math.abs(z + 40) < 2) continue;
    const y0 = groundY(x, z), s = rr(.8, 1.5); trees++;
    const trunk = new THREE.CylinderGeometry(.18 * s, .26 * s, 1.4 * s, 6); trunk.translate(x, y0 + .7 * s, z); add(barkMat, trunk);
    for (let l = 0; l < 3; l++) { const c = new THREE.ConeGeometry((1.9 - l * .45) * s, (2.2 - l * .3) * s, 7); c.translate(x, y0 + (1.6 + l * 1.25) * s, z); add(l === 2 ? pineSnow : pineMat, c); }
    addCol(x - .35 * s, x + .35 * s, z - .35 * s, z + .35 * s, y0, y0 + 5 * s);
  }
  for (let k = 0; k < 300; k++) { const x = rr(-47, 47), z = rr(-67, 67); if (!clear(x, z, 5)) continue; if (rand() < .7) continue;
    const y0 = groundY(x, z), s = rr(.5, 1.3), g = new THREE.DodecahedronGeometry(s, 0); g.scale(1.3, .8, 1); g.translate(x, y0 + s * .4, z); add(rockMat, g);
    addCol(x - s, x + s, z - s, z + s, y0, y0 + s); }

  // ---- the sanctuary: the deer's dais with ice crystals, the pedestal, the workshop ----
  const dais = new THREE.CylinderGeometry(5.5, 6, .4, 32); dais.translate(DEER.x, H + .2, DEER.z); add(stoneMat, dais);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, x = DEER.x + Math.cos(a) * 7.2, z = DEER.z + Math.sin(a) * 7.2;
    if (Math.abs(x) < 3 && z > DEER.z) continue;   // leave the front open (the road ends here)
    const c = new THREE.OctahedronGeometry(.9, 0); c.scale(.6, 1.8, .6); c.translate(x, H + 1.6, z); add(iceMat, c); addCol(x - .5, x + .5, z - .5, z + .5, H, H + 3);
    lightSpots.push({ x, y: H + 2, z, color: 0x7ce8ff, power: 12, dist: 10 }); }
  { const { x, z } = PEDESTAL;   // pedestal: a stone column with a floating crystal (the crystal itself is added by the game)
    const col = new THREE.CylinderGeometry(.7, .9, 1.4, 12); col.translate(x, H + .7, z); add(stoneMat, col);
    const top = new THREE.CylinderGeometry(1.1, .8, .3, 12); top.translate(x, H + 1.55, z); add(stoneMat, top); addCol(x - 1.5, x + 1.5, z - 1.5, z + 1.5, H, H + 1.7); }   // keeps you a step back from the crystal
  { const { x, z } = WORKSHOP;   // workshop: an open stall with a roof, a workbench and an anvil
    for (const [px, pz] of [[-2.5, -2], [2.5, -2], [-2.5, 2], [2.5, 2]]) { const p = new THREE.CylinderGeometry(.14, .14, 3, 8); p.translate(x + px, H + 1.5, z + pz); add(woodMat, p); addCol(x + px - .2, x + px + .2, z + pz - .2, z + pz + .2, H, H + 3); }
    const rf = new THREE.ConeGeometry(4.3, 1.6, 4); rf.rotateY(Math.PI / 4); rf.translate(x, H + 3.8, z); add(pineSnow, rf);
    box(x - 2, x + 2, H, H + 1, z - 1.6, z - .6, woodMat); addCol(x - 2, x + 2, z - 1.6, z - .6, H, H + 1);
    box(x + .6, x + 1.4, H, H + .8, z + .6, z + 1.2, rockMat); }
  lightSpots.push({ x: DEER.x, y: H + 3, z: DEER.z, color: 0x9fdcff, power: 30, dist: 18 }, { x: PEDESTAL.x, y: H + 3, z: PEDESTAL.z, color: 0xb388ff, power: 20, dist: 12 }, { x: WORKSHOP.x, y: H + 2.5, z: WORKSHOP.z, color: 0xffb070, power: 20, dist: 12 });

  // ---- merge ----
  for (const [mat, list] of geos) {
    const clean = list.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(k)) n.deleteAttribute(k); return n; });
    root.add(new THREE.Mesh(mergeGeometries(clean, false), mat));
  }

  // ---- lights + snow ----
  const pool = Array.from({ length: 10 }, () => { const L = new THREE.PointLight(0x8fdcff, 0, 20, 1.7); root.add(L); return L; });
  let poolT = 0;
  function updateLights(px, pz){
    const near = lightSpots.map(s => ({ s, d: (s.x - px) ** 2 + (s.z - pz) ** 2 })).sort((a, b) => a.d - b.d).slice(0, pool.length);
    near.forEach(({ s }, i) => { const L = pool[i]; L.position.set(s.x, s.y, s.z); L.color.setHex(s.color); L.userData.power = s.power; L.distance = s.dist; });
  }
  const snowN = 1400, snowGeo = new THREE.BufferGeometry(), dp = new Float32Array(snowN * 3);
  for (let i = 0; i < snowN; i++) { dp[i * 3] = rr(-50, 50); dp[i * 3 + 1] = rr(0, 22); dp[i * 3 + 2] = rr(-70, 70); }
  snowGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  root.add(new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xf2f7ff, size: .09, transparent: true, opacity: .8, depthWrite: false })));

  const P = makePhysics(groundY, BOUNDS, colliders, []);
  const at = (o, dy = 0) => ({ x: o.x, y: groundY(o.x, o.z) + dy, z: o.z });
  return {
    ...P, colliders, groundY, mm, bounds: BOUNDS, env, hill: H, roadDist,
    road: ROAD.map(([x, z]) => ({ x, z, y: groundY(x, z) })),
    pads: PADS, deer: at(DEER), pedestal: at(PEDESTAL), workshop: at(WORKSHOP),
    nests: [], route: [], zones: [{ ko: "사슴의 성소", en: "Deer sanctuary", x: 0, z: -55, pads: [], shop: [0, -50] }],
    entries: [[0, 66]], spawn: { x: 6, z: -52 }, gunSpot: new THREE.Vector3(6, 0, -52), tutorialSpawns: [],
    update(t, dt, px, pz){
      for (let i = 0; i < snowN; i++) { dp[i * 3 + 1] -= dt * .9; dp[i * 3] += Math.sin(t * .4 + i) * dt * .25; if (dp[i * 3 + 1] < 0) dp[i * 3 + 1] = 22; }
      snowGeo.attributes.position.needsUpdate = true;
      auroras.forEach((m, i) => { m.material.opacity = .22 + Math.sin(t * .3 + i * 2) * .12; });
      poolT -= dt; if (poolT <= 0) { poolT = .4; updateLights(px, pz); }
      pool.forEach((L, i) => L.intensity = (L.userData.power || 0) + Math.sin(t * 7 + i * 3) * 1);
    },
  };
}
