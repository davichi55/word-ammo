// 단어 탄창 · Word Ammo — main game.
// Loop: aliens walk at you; Lumi (the friendly alien) names the Korean word each one is weak to; you open
// the backpack (world slows down), find that word in its meaning category, load it, and shoot.
import * as THREE from "../../node_modules/three/build/three.module.js";
import { EffectComposer } from "../../node_modules/three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../../node_modules/three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../../node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../../node_modules/three/examples/jsm/postprocessing/OutputPass.js";
import { buildWorld } from "./world.js";
import { buildSanctuaryWorld } from "./sanctuary-world.js";
import { Alien, Orb, glowTexture } from "./enemies.js";
import { initAudio, setVolume, SFX, say, wordClip, lineClip, preload } from "./audio.js";
import { Net } from "./coop.js";

const D = window.WORD_DATA;
const $ = s => document.querySelector(s);
const store = { get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e) { return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} } };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const shirtMode = () => G.mode === "escape" || G.mode === "fortress" || G.mode === "deer";
// the words on keys 1–9 (every word you own)
const ammoWords = () => G.unlocked || [];
const CAT = Object.fromEntries(D.categories.map(c => [c.id, c]));
const POS_KO = { noun: "명사", verb: "동사", adjective: "형용사", adverb: "부사", other: "표현" };   // 표현 = an expression / phrase (most "other" entries are several words)

/* ================================ settings / progress ================================ */
const settings = Object.assign({ lang: store.get("k5a_lang_wa", "en"), labels: "ko", bpMode: "type", subs: "type", sens: 1, vol: .8,
  ch: ["ch3"], cls: ["v", "r1", "r2", "s1"], star: false }, store.get("wa_settings", {}));
if (settings.bpMode === "grow") settings.bpMode = "type";   // the upgrade to category tabs was dropped: the word-type list stays
const stats = store.get("wa_stats", {});          // per word id: {r: right, w: wrong/slow, t: last seen ms}
const saveSettings = () => store.set("wa_settings", settings);
const saveStats = () => store.set("wa_stats", stats);
const meaning = w => w.m[settings.lang] || w.m.en;
function selectedPool(){
  const secs = new Set(D.sections.filter(s => settings.ch.includes(s.ch) && settings.cls.includes(s.cls)).map(s => s.id));
  const seen = new Set();
  return D.words.filter(w => secs.has(w.sec) && (!settings.star || w.star) && !seen.has(w.kr) && seen.add(w.kr));
}

/* ================================ renderer / scene ================================ */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.55;
$("#game").appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, (innerWidth / innerHeight) || 16 / 9, .05, 900);
scene.add(camera);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .8, .5, .72);
composer.addPass(bloom); composer.addPass(new OutputPass());
addEventListener("resize", () => { if (!innerWidth || !innerHeight) return;   // a hidden/minimised window reports 0×0: keep the last good size
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });
// two maps, one shown at a time: the old town (district, escape, survival, fortress) and the snowy valley (deer sanctuary)
const districtRoot = new THREE.Group(), deerRoot = new THREE.Group(); scene.add(districtRoot, deerRoot); deerRoot.visible = false;
const districtWorld = buildWorld(districtRoot);
let deerWorld = null;   // built the first time the sanctuary is played
let world = districtWorld;
scene.background = world.env.bg; scene.fog = world.env.fog;
const getDeerWorld = () => deerWorld || (deerWorld = buildSanctuaryWorld(deerRoot));
function useWorld(w){
  world = w; G.world = w; districtRoot.visible = w === districtWorld; deerRoot.visible = w !== districtWorld;
  scene.background = w.env.bg; scene.fog = w.env.fog; mmStatic = null;
}

/* ================================ player ================================ */
const player = { body: { x: 0, y: 0, z: 62, vy: 0 }, feet: 0, pos: new THREE.Vector3(0, 1.7, 62), yaw: 0, pitch: 0, vel: new THREE.Vector3(), hp: 100, dashes: 2, dashCd: 0,
  dashing: 0, dashDir: new THREE.Vector3(), lastHurt: -99, bob: 0, hasGun: false, moved: 0 };
const keys = {};

/* ---------- gun viewmodel ---------- */
const gun = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3d, roughness: .35, metalness: .8 });
const gunMat2 = new THREE.MeshStandardMaterial({ color: 0x151722, roughness: .5, metalness: .6 });
const glowMat = new THREE.MeshBasicMaterial({ color: 0x7cf7d4 });
const gb = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); gun.add(b); return b; };
gb(.11, .13, .5, 0, 0, 0, gunMat); gb(.08, .2, .1, 0, -.14, .12, gunMat2); gb(.13, .05, .3, 0, .09, -.02, gunMat2);
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, .32, 12), gunMat2); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, .01, -.38); gun.add(barrel);
const chamber = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .18, 16), glowMat); chamber.rotation.x = Math.PI / 2; chamber.position.set(0, -.02, -.12); gun.add(chamber);
const muzzle = new THREE.Object3D(); muzzle.position.set(0, .01, -.56); gun.add(muzzle);
// a little screen on the side of the gun that shows the loaded word
const screenCanvas = document.createElement("canvas"); screenCanvas.width = 256; screenCanvas.height = 96;
const screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace;
const screen = new THREE.Mesh(new THREE.PlaneGeometry(.28, .105), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
screen.position.set(-.058, .02, -.02); screen.rotation.y = -Math.PI / 2; gun.add(screen);
const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9ffff0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
flash.scale.set(.5, .5, 1); flash.position.copy(muzzle.position); gun.add(flash);
gun.position.set(.28, -.27, -.5); gun.scale.setScalar(.8); gun.visible = false; camera.add(gun);
const gunLight = new THREE.PointLight(0x7cf7d4, 0, 6, 2); gunLight.position.set(.3, -.2, -1); camera.add(gunLight);
const fillLight = new THREE.PointLight(0xc8d0ff, 1.4, 2.2, 2); fillLight.position.set(.1, .1, -.1); camera.add(fillLight);   // keeps the gun readable
function drawGunScreen(){
  const g = screenCanvas.getContext("2d"); g.fillStyle = "#04110d"; g.fillRect(0, 0, 256, 96);
  g.strokeStyle = "#7cf7d4"; g.lineWidth = 4; g.strokeRect(3, 3, 250, 90);
  const w = G.loaded; g.fillStyle = "#7cf7d4"; g.textAlign = "center"; g.textBaseline = "middle";
  let fs = 44; g.font = `bold ${fs}px "Malgun Gothic", sans-serif`;
  const txt = w ? w.kr : G.duel ? "👑 DUEL" : "EMPTY"; while (g.measureText(txt).width > 230 && fs > 18) { fs -= 2; g.font = `bold ${fs}px "Malgun Gothic", sans-serif`; }
  g.fillText(txt, 128, 50); screenTex.needsUpdate = true;
}
// the gun lying on a pedestal at the start (tutorial)
const pedestal = new THREE.Group();
{ const st = new THREE.Mesh(new THREE.CylinderGeometry(.5, .6, 1, 16), new THREE.MeshStandardMaterial({ color: 0x3a3646, roughness: .9 })); st.position.y = .5; pedestal.add(st);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.7, .03, 8, 40), glowMat); ring.rotation.x = Math.PI / 2; ring.position.y = 1.05; pedestal.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 6, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x7cf7d4, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 3.5; pedestal.add(beam);
  const pl = new THREE.PointLight(0x7cf7d4, 12, 8, 2); pl.position.y = 2; pedestal.add(pl); }
const pedGun = gun.clone(); pedGun.visible = true; pedGun.position.set(0, 1.25, 0); pedGun.scale.setScalar(2.2); pedestal.add(pedGun);
pedestal.position.copy(world.gunSpot); scene.add(pedestal);

/* ================================ game state ================================ */
const G = {
  running: false, paused: false, over: false, time: 0, timeScale: 1, slowmo: 1,
  aliens: [], orbs: [], bursts: [], tracers: [], pickups: [], floaters: [],
  pool: [], loaded: null, rounds: 6, maxRounds: 6, reloadT: 0, fireCd: 0, recent: [],
  total: 0, score: 0, kills: 0, perfect: 0, quietT: 0,
  tut: null, backpackOpen: false, bpTab: 0, bpPos: "all", aimed: null, aimT: 0, shake: 0,
  helperT: 0, lineCd: {}, runMissed: new Map(), runRight: new Set(), difficulty: 1,
  world, player,
  sfx: k => SFX[k] && SFX[k](),
  groan: a => { if (a.pos.distanceTo(player.pos) < 25) SFX.groan(); },
  canOrb: a => G.orbs.length < 4 && G.aliens.filter(o => o.state === "charge").length < 2,
  // an alien that sees you wakes up and alerts the ones standing near it
  wakeAlien(a){ if (!a.wake()) return; ensureWord(a); G.quietT = 0;
    for (const o of G.aliens) if (o !== a && o.state === "idle" && !o.dead && o.pos.distanceTo(a.pos) < 11 && Math.abs(o.pos.y - a.pos.y) < 2) { o.wake(); ensureWord(o); } },
  spawnOrb(from, a){ const target = (G.targetFor ? G.targetFor(a) : player).pos.clone(); target.y -= .4; G.orbs.push(new Orb(scene, from, target)); SFX.orb(); },
  slam(center, r, a){ if (G.mode === "deer") { deerSlam(center, r, a); return; } SFX.slam(); G.shake = .5; burst(center.clone().setY(.2), 0xff2244, 40, 7); fxOut({ b: [center.x, center.y + .2, center.z, 0xff2244] });
    for (const T of G.targets()) if (!T.dashing && Math.hypot(T.pos.x - center.x, T.pos.z - center.z) < r && Math.abs(T.feet - center.y) < 1.5) {
      hurt(24, center, T); if (T === player) { const d = player.pos.clone().sub(center).setY(0).normalize(); player.vel.addScaledVector(d, 9); } } },
  hurt: (n, from, t) => hurt(n, from, t),
  burst: (p, c, n, s) => burst(p, c, n, s),
};
window.__G = G;   // debugging handle

/* ================================ word picking (spaced repetition light) ================================ */
function nextWeakWord(){
  if (G.mode === "deer" && G.unlocked.length) return pick(G.waveWords && G.waveWords.length ? G.waveWords : G.unlocked);   // shirts show this wave's words
  if (shirtMode() && G.unlocked.length) return pick(G.unlocked);   // 2 words = 50/50, 3 = 33% each …
  if (G.mode === "survival" && G.unlocked.length) {
    const L = G.unlocked, newest = L[L.length - 1];
    const wts = L.map(w => { const s = stats[w.id]; return (w === newest && L.length > 1 ? 2.2 : 1) * (s ? Math.max(.4, 1 + s.w * .8 - s.r * .2) : 1); });
    let r = Math.random() * wts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < L.length; i++) { r -= wts[i]; if (r <= 0) return L[i]; }
    return newest;
  }
  const taken = new Set(G.aliens.filter(a => !a.dead && a.word).map(a => a.word.id));
  const now = Date.now();
  const cands = G.pool.filter(w => !taken.has(w.id) && w.id !== (G.loaded && G.loaded.id));
  // weight: struggled words come back more, well-known words less, unseen words normal; not the last few again
  const weights = cands.map(w => {
    const s = stats[w.id]; let k = 1;
    if (s) { k = Math.max(.25, 1 + s.w * 1.2 - s.r * .45); if (now - s.t < 60 * 1000) k *= .2; }
    if (G.recent.includes(w.id)) k *= .05;
    return k;
  });
  let tot = weights.reduce((a, b) => a + b, 0), r = Math.random() * tot;
  for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) { G.recent.push(cands[i].id); if (G.recent.length > 8) G.recent.shift(); return cands[i]; } }
  return pick(cands.length ? cands : G.pool);
}
function ensureWord(a){ if (!a.word) a.word = nextWeakWord(); return a.word; }
function markKill(w){ const s = stats[w.id] || (stats[w.id] = { r: 0, w: 0, t: 0 }); s.k = (s.k || 0) + 1; saveStats(); }
function mark(w, right){ const s = stats[w.id] || (stats[w.id] = { r: 0, w: 0, t: 0 }); if (right) s.r++; else s.w++; s.t = Date.now(); saveStats();
  if (!right) G.runMissed.set(w.id, (G.runMissed.get(w.id) || 0) + 1); else G.runRight.add(w.id); }

/* ================================ helper (Lumi) ================================ */
let helperHide = 0;
function helperShow(html, secs = 4){ $("#helper").hidden = false; $("#helperText").innerHTML = html; helperHide = secs; }
function helperLine(key, ko, en, cd = 5){
  if ((G.lineCd[key] || 0) > G.time) return; G.lineCd[key] = G.time + cd;
  say([lineClip(key)]); G.lineUntil = G.time + 2.2; helperShow(`${esc(ko)} <small>${esc(en)}</small>`, 2.5);
}
function announce(a, repeat){
  ensureWord(a);
  const first = !a.announced;
  a.announced = true; a.lastAnnounce = G.time; if (!a.heardAt) a.heardAt = G.time;
  say([wordClip(a.word.id)], { interrupt: true });   // only the word: nothing may cover it
  G.speaking = a;
  updateHelperHint(a, true);
}
// Lumi TYPES the word while she says it, the way Korean is typed: ㅈ → 저 → 전 → 전ㅁ → 전무 → 전문.
// (settings.subs "audio" = voice only, for ear training.)
const L_JAMO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function typingSteps(word){
  const steps = []; let done = "";
  for (const ch of word) {
    const c = ch.charCodeAt(0) - 0xAC00;
    if (c >= 0 && c < 11172) {
      const L = Math.floor(c / 588), V = Math.floor((c % 588) / 28), T = c % 28;
      steps.push(done + L_JAMO[L]);                                        // initial consonant
      steps.push(done + String.fromCharCode(0xAC00 + L * 588 + V * 28));    // + vowel
      if (T) steps.push(done + ch);                                        // + final consonant
    } else if (ch !== " ") steps.push(done + ch);
    done += ch;
  }
  steps.push(word);
  return steps;
}
function updateHelperHint(a, force){
  if (!a || a.dead) return;
  if (force) G.typing = { a, steps: settings.subs === "audio" ? null : typingSteps(a.word.kr), i: 0, t: 0 };
  if (!force && $("#helperText").dataset.for !== String(a.id)) return;
  const dot = `<span style="color:#${new THREE.Color().setHSL(a.hue, .9, .6).getHexString()}">●</span>`;
  const T = G.typing && G.typing.a === a && G.typing.steps ? G.typing : null;
  const typing = T && T.i < T.steps.length - 1;
  const text = T ? T.steps[Math.min(T.i, T.steps.length - 1)] : "🔊";
  helperShow(`${dot} <b class="typed">${esc(text)}</b>${typing ? '<i class="caret">▍</i>' : ""} <small>🔊 Q</small>`, 8);
  $("#helperText").dataset.for = String(a.id);
}

/* ================================ shooting ================================ */
const ray = new THREE.Raycaster(); ray.far = 120;
function aimAlien(withDogs = false){
  camera.updateMatrixWorld();
  ray.setFromCamera({ x: 0, y: 0 }, camera);
  const meshes = []; if (withDogs) (G.dogs || []).forEach(h => { if (h.sleepT <= 0) meshes.push(...h.hitMeshes); }); G.aliens.forEach(a => { if (!a.dead && a.spawnT >= 1 && a.root.visible) meshes.push(...a.hitMeshes); });
  const hit = ray.intersectObjects(meshes, false)[0];
  if (!hit) return null;
  if (world.rayBlock(ray.ray.origin, ray.ray.direction, hit.distance) !== Infinity) return null;   // a wall is in the way
  if (hit.object.userData.dog) return { dog: hit.object.userData.dog, point: hit.point };
  ensureWord(hit.object.userData.alien);
  return { alien: hit.object.userData.alien, point: hit.point, head: !!hit.object.userData.head };
}
function fire(){
  if (!player.hasGun || G.backpackOpen || G.noteOpen || player.downed || G.reloadT > 0 || G.fireCd > 0) return;
  if (!G.loaded) { SFX.empty(); objectiveFlash("🎒 Tab — 탄창이 비었어요 · load a word first"); return; }
  if (G.rounds <= 0) { startReload(); return; }
  G.rounds--; G.fireCd = .2; renderAmmo();
  gun.userData.kick = 1; flash.material.opacity = 1; gunLight.intensity = 6;
  const from = new THREE.Vector3(); muzzle.getWorldPosition(from);
  const h = aimAlien(true);
  let to;
  if (h && h.dog) { SFX.shot(); if (isClient()) { coopAct({ a: "hound", i: G.dogs.indexOf(h.dog) }); floater(h.point, "🐕", "#ffd23f", 22); } else hitHound(h.dog, h.point); tracer(from, h.point, 0xffd23f); hitmarker(false); if (G.rounds <= 0) setTimeout(() => { if (G.rounds <= 0) startReload(); }, 250); return; }
  if (h) {
    to = h.point;
    const a = h.alien, good = a.special || G.loaded.id === a.word.id;
    if (isClient()) {   // co-op client: show the hit now, let the host apply it
      coopAct({ a: "shot", id: a.id, head: h.head ? 1 : 0, w: G.loaded.id });
      if (good) { SFX.shotGood(); burst(h.point, 0x7cf7d4, 26, 6); hitmarker(true); floater(h.point, h.head ? "💥" : "✓", "#7cf7d4", 26); }
      else { SFX.shot(); SFX.resist(); burst(h.point, 0x9a93c2, 10, 3); hitmarker(false); floater(h.point, a.word.kr, "#ffcf5c", 30, 1.8, "w" + a.id); }
      tracer(from, to, good ? 0x7cf7d4 : 0xb8b0ff, true); if (G.rounds <= 0) setTimeout(() => { if (G.rounds <= 0) startReload(); }, 250); return;
    }
    G.wakeAlien(a);
    if (a.firstShotWrong === null) a.firstShotWrong = !good;
    if (good) {
      SFX.shotGood(); const dmg = h.head ? 55 : 36; a.stagger = a.special ? .08 : .3;
      const killed = a.damage(dmg);
      burst(h.point, 0x7cf7d4, 26, 6); hitmarker(true); floater(h.point, h.head ? `💥 ${dmg}` : `${dmg}`, "#7cf7d4", 26);
      if (killed) onKill(a);
      if (G.up && G.up.pierce && !a.special) {
        const hits = ray.intersectObjects(G.aliens.filter(o => o !== a && !o.dead && o.root.visible && o.word && o.word.id === a.word.id).flatMap(o => o.hitMeshes), false);
        const done = new Set();
        for (const ht of hits) { const o = ht.object.userData.alien; if (done.has(o) || done.size >= 2) continue;
          if (world.rayBlock(ray.ray.origin, ray.ray.direction, ht.distance) !== Infinity) break;
          done.add(o); burst(ht.point, 0x7cf7d4, 16, 5); if (o.damage(36)) onKill(o); }
      }
    } else {
      SFX.shot(); SFX.resist(); a.damage(2); a.wrongHits++;
      burst(h.point, 0x9a93c2, 10, 3); hitmarker(false); floater(h.point, a.word.kr, "#ffcf5c", 30, 1.8, "w" + a.id);   // wrong ammo shows the word it IS weak to
      if (!a.announced && !(G.tut && G.tut.step === "shoot") && !shirtMode()) announce(a);
      if (G.tut && G.tut.step === "shoot") tutNext("listen");
    }
  } else {
    SFX.shot();
    ray.setFromCamera({ x: 0, y: 0 }, camera); const bd = world.rayBlock(ray.ray.origin, ray.ray.direction, 60);
    to = ray.ray.origin.clone().addScaledVector(ray.ray.direction, bd === Infinity ? 60 : bd);
    if (bd !== Infinity) burst(to, 0xb8b0ff, 8, 2);
  }
  tracer(from, to, h && (h.alien.special || G.loaded.id === h.alien.word.id) ? 0x7cf7d4 : 0xb8b0ff);
  if (G.rounds <= 0) setTimeout(() => { if (G.rounds <= 0) startReload(); }, 250);
}
const reloadTime = () => .9 * Math.pow(.65, (G.up && G.up.reload) || 0);
function startReload(){ if (!G.loaded || G.reloadT > 0) return; G.reloadT = reloadTime(); SFX.reload(); $("#loaded").classList.remove("reload"); void $("#loaded").offsetWidth; $("#loaded").classList.add("reload"); }
function loadWord(w){
  if (G.newIds) G.newIds.delete(w.id);
  const was = G.loaded; G.loaded = w; G.rounds = G.maxRounds; G.reloadT = .5 * reloadTime() / .9; SFX.reload();
  G.recentLoads = [w.id, ...(G.recentLoads || []).filter(id => id !== w.id)].slice(0, 4);
  $("#loaded").classList.remove("reload"); void $("#loaded").offsetWidth; $("#loaded").classList.add("reload");
  glowMat.color.setHSL(.45 + Math.random() * .1, .9, .65);
  drawGunScreen(); renderAmmo(); renderQuick();
  if (G.tut && G.tut.step === "backpack") {
    const a = G.aliens.find(x => !x.dead);
    if (a && a.word.id === w.id) tutNext("kill"); else if (a) objectiveFlash("그거 아니야 · Not that word — open the backpack again (<b>Tab</b>)");
  }
}
function onKill(a, byTower = false){
  if (isHost()) fxOut({ k: [a.id, a.word ? a.word.id : "", byTower === "partner" ? 1 : 0] });
  SFX.kill(); G.kills++; G.shake = .25;
  const quick = G.time - (a.heardAt || G.time) < 8, perfect = a.firstShotWrong === false || (a.firstShotWrong === true && false);
  const pts = 100 + (quick ? 50 : 0) + (a.wrongHits === 0 ? 50 : 0);
  G.score += pts;
  if (!byTower) { mark(a.word, a.wrongHits === 0 && quick); markKill(a.word); }
  burst(a.aimPoint(), 0x7cf7d4, 90, 10); burst(a.aimPoint(), 0xffcf5c, 40, 8);
  if (!a.special) wordGhost(a);
  const st = bpStage();
  if (!a.special) killfeed(`<b>${esc(a.word.kr)}</b> = ${esc(meaning(a.word))} <small style="color:#9a93c2">· ${POS_KO[a.word.pos]}${" · " + CAT[a.word.cat].icon + " " + esc(CAT[a.word.cat].ko)}</small>`);
  floater(a.aimPoint().add(new THREE.Vector3(0, .8, 0)), `+${pts}`, "#ffcf5c", 30);
  if (a.wrongHits === 0 && quick) G.perfect++;
  bpUnlockCheck();
  // health drops: rare in the horde modes (they'd clutter the map), a bit more when you're low
  const dropP = G.mode === "deer" ? 0 : (shirtMode() ? .06 : G.mode === "survival" ? .12 : .25) + (player.hp < 35 ? .1 : 0);   // deer sanctuary: you can't get hurt
  if (Math.random() < dropP) spawnPickup(a.pos.clone());
  if (G.speaking === a) { $("#helperText").dataset.for = ""; helperHide = 1.2; }
  if (G.tut) { if (G.tut.step === "kill") tutNext("dodge"); else if (G.tut.step === "dodge" || G.tut.step === "dodge2") tutNext("done"); }
  else if (G.mode === "escape") { if (a.special) specialKill(a); renderTop(); }
  else if (G.mode === "deer") { if (a.special) deerBossKill(a); else { G.waveKills++; G.coins++; } renderTop(); }   // 💰 1 gold per alien
  else if (G.mode === "fortress") { if (a.special) bossKill(a); else { G.waveKills++; G.coins++; } renderTop(); }
  else if (G.mode === "survival") { if (G.kills >= G.nextUnlockAt) { G.nextUnlockAt += 5; unlockWord(); } renderTop(); }
  else { renderTop(); if (!G.aliens.some(x => !x.dead)) setTimeout(victory, 1600); }
}

/* ================================ FX ================================ */
function burst(pos, color, n = 30, speed = 5){
  const geo = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) { p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
    const d = new THREE.Vector3(rnd(-1, 1), rnd(-.3, 1.2), rnd(-1, 1)).normalize().multiplyScalar(rnd(.3, 1) * speed); v.push(d); }
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const m = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: .12, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTexture() }));
  scene.add(m); G.bursts.push({ m, v, life: .9, max: .9 });
}
function tracer(from, to, color, noNet){
  if (!noNet) fxOut({ tr: [from.x, from.y, from.z, to.x, to.y, to.z, color] });
  const len = from.distanceTo(to);
  const m = new THREE.Mesh(new THREE.BoxGeometry(.025, .025, len), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(from).lerp(to, .5); m.lookAt(to); scene.add(m); G.tracers.push({ m, life: .09 });
}
function wordGhost(a){   // the word floats up out of the dead alien — a last look at it
  const c = document.createElement("canvas"); c.width = 512; c.height = 160; const g = c.getContext("2d");
  g.font = `bold 84px "Malgun Gothic", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "#7cf7d4"; g.shadowBlur = 24; g.fillStyle = "#e9fffa"; g.fillText(a.word.kr, 256, 70);
  g.shadowBlur = 0; g.font = `30px "Segoe UI", "Malgun Gothic", sans-serif`; g.fillStyle = "#ffcf5c"; g.fillText(meaning(a.word).slice(0, 34), 256, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  s.position.copy(a.aimPoint()).add(new THREE.Vector3(0, .9, 0)); s.scale.set(3.2, 1, 1); scene.add(s);
  G.bursts.push({ sprite: s, life: 2.4, max: 2.4 });
}
function spawnPickup(pos){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6dff8a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(.9, .9, 1); s.position.set(pos.x, world.groundY(pos.x, pos.z) + .7, pos.z); s.userData.base = s.position.y; scene.add(s);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(.18), new THREE.MeshBasicMaterial({ color: 0xb8ffc6 })); s.add(core);
  G.pickups.push({ s, t: 0 });
  while (G.pickups.length > 6) { const old = G.pickups.shift(); scene.remove(old.s); }   // never more than 6 on the map
}
function hurt(n, from, target = player){
  if (G.over || G.mode === "deer") return;   // deer sanctuary: the aliens only want the deer
  if (target === partner) {   // host: the co-op partner got hit
    if (partner.dashing || partner.downed) return;
    partner.hp = Math.max(0, partner.hp - n); partner.lastHurt = G.time; fxOut({ hurt: n });
    if (partner.hp <= 0) { partner.downed = true; partner.bleedT = 30; objectiveFlash("🆘 파트너가 쓰러졌어요! · Your partner is down — go to them and <b>hold E</b> (30 s)"); }
    return;
  }
  if (player.dashing || player.downed) return;
  player.hp = Math.max(0, player.hp - n); player.lastHurt = G.time; hurtFx();
  renderHP();
  if (player.hp <= 0) { if (G.coop && G.mode === "fortress") goDown(); else gameOver(); }
}
function hurtFx(){ SFX.hurt(); G.shake = .35; const v = $("#vignette"); v.classList.remove("hurt"); void v.offsetWidth; v.classList.add("hurt"); setTimeout(() => v.classList.remove("hurt"), 250); }
const vec = new THREE.Vector3();
function floater(pos, text, color, size, life = .9, key = null){
  if (key) for (const f of G.floaters) if (f.key === key) { f.life = 0; f.el.remove(); }   // one label per key (no stacking)
  const el = document.createElement("div"); el.className = "fl"; el.textContent = text; el.style.color = color; el.style.fontSize = size + "px";
  $("#floaters").appendChild(el); G.floaters.push({ el, pos: pos.clone(), life, max: life, key });
}
function hitmarker(good){ const h = $("#hitmarker"); h.className = good ? "good" : ""; void h.offsetWidth; h.classList.add("show"); }
function killfeed(html, bad){ const d = document.createElement("div"); d.className = "kf" + (bad ? " bad" : ""); d.innerHTML = html; $("#killfeed").prepend(d); setTimeout(() => d.remove(), 5000); }
let objTimer = 0;
function objective(html){ $("#objective").innerHTML = html; }
function objectiveFlash(html){ const prev = $("#objective").innerHTML; objective(html); clearTimeout(objTimer); objTimer = setTimeout(() => { if ($("#objective").innerHTML === html) objective(G.tut ? G.tut.text : prev); }, 2000); }

/* ================================ HUD ================================ */
function renderHP(){ $("#hpFill").style.width = (G.mode === "deer" && G.sanct ? Math.max(0, G.sanct.hp / G.sanct.max * 100) : player.hp) + "%"; }   // deer sanctuary: the bar is the deer
function renderAmmo(){
  const w = G.loaded;
  $("#loadedWord").textContent = w ? (settings.labels === "ko" ? w.kr : meaning(w)) : "—";
  $("#loadedSub").textContent = w ? `${CAT[w.cat].icon} ${CAT[w.cat].ko}` : "";
  $("#rounds").innerHTML = Array.from({ length: G.maxRounds }, (_, i) => `<i class="${i < G.rounds ? "" : "off"}"></i>`).join("");
}
function renderQuick(){
  const ids = (shirtMode() ? ammoWords().slice(0, 9).map(w => w.id) : G.recentLoads) || [];
  $("#quick").innerHTML = ids.map((id, i) => { const w = D.words.find(x => x.id === id); return `<div class="q${G.loaded && G.loaded.id === id ? " on" : ""}"><div class="k">${i + 1}</div><div class="w">${esc(settings.labels === "ko" ? w.kr : meaning(w))}</div></div>`; }).join("");
}
function renderDash(){ const k = 1 - player.dashCd / .55; $("#dashPips").innerHTML = `<i style="width:${Math.round(20 + 50 * k)}px" class="${k < 1 ? "off" : ""}"></i>`; }
function renderTop(){ const left = G.aliens.filter(a => !a.dead).length;
  if (G.mode === "deer" && G.sanct) { const b = G.bossOut;
    $("#waveLbl").textContent = `🦌 Wave ${G.wave} · ${b ? "👑 결투 · duel" : `${Math.min(G.waveKills, G.waveSize)}/${G.waveSize}`} · 💎 ${G.sanct.ammo} · 💰 ${G.coins} · 🎒 ${G.unlocked.length}/${G.pool.length} words${G.calmT > 0 ? ` · 😮‍💨 ${Math.ceil(G.calmT)}s` : ""}`;
    $("#scoreLbl").textContent = `🦌 ❤ ${Math.ceil(G.sanct.hp)}`; return; }
  if (G.mode === "fortress") { const z = world.zones[G.zone];
    $("#waveLbl").textContent = `🏰 Wave ${G.wave} · ${G.bossOut ? "👑 BOSS" : `${Math.min(G.waveKills, G.waveSize)}/${G.waveSize}`} · 💰 ${G.coins} · 🎒 ${G.unlocked.length} words · 📍 ${z.ko}${G.calmT > 0 ? ` · 😮‍💨 ${Math.ceil(G.calmT)}s` : ""}`; $("#scoreLbl").textContent = `★ ${G.score}`; return; }
  if (G.mode === "escape") { const cp = world.route[Math.min(G.cp, world.route.length - 1)];
    $("#waveLbl").textContent = `🏃 ${Math.min(G.cp + 1, world.route.length)}/${world.route.length} ${cp.ko} · 🎒 ${G.unlocked.length} words${G.calmT > 0 ? ` · 😮‍💨 ${Math.ceil(G.calmT)}s` : ""}`; $("#scoreLbl").textContent = `★ ${G.score}`; return; }
  if (G.mode === "survival" && !G.tut) { const t = Math.floor(G.survT || 0);
    $("#waveLbl").textContent = `⏱ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} · 🎒 ${G.unlocked.length} words · next in ${Math.max(0, G.nextUnlockAt - G.kills)} kills`; $("#scoreLbl").textContent = `★ ${G.score}`; return; }
  $("#waveLbl").textContent = G.tut ? "TUTORIAL" : `👽 남은 외계인 ${left} / ${G.total}`; $("#scoreLbl").textContent = `★ ${G.score}`; }

/* ================================ backpack ================================ */
function openBackpack(){
  if ((!player.hasGun && G.mode !== "deer") || G.over) return;   // the sanctuary has no gun, but you can still look at your words
  G.backpackOpen = true; G.timeScale = G.mode === "deer" ? .3 : .15; SFX.open();
  $("#bpFoot").innerHTML = G.mode === "deer" ? "🎒 지금까지 배운 단어 · every word you know (🦌 = taught by the deer) · click a word to hear it · Tab / Q = close" : "Tab 닫기 · 클릭해서 장전 · ←/→ 탭";
  $("#backpack").hidden = false; if (!liveCoop()) $("#vignette").classList.add("slow"); $("#clickToPlay").hidden = true; $("#bpGrid").scrollTop = 0;
  // start on the tab of the current loaded word, or keep the last tab
  renderBackpack();
  document.exitPointerLock && document.exitPointerLock();
  if (G.tut && G.tut.step === "backpack") $("#bpFoot").innerHTML = `💡 Lumi said a word 🔊 — find it in the list (ㄱㄴㄷ order) and click it. The glowing word is a tutorial hint. Later your backpack gets tabs.`;
}
function closeBackpack(relock = true){
  if (!G.backpackOpen) return;
  G.backpackOpen = false; G.timeScale = 1; SFX.close();
  $("#backpack").hidden = true; $("#vignette").classList.remove("slow");
  if (relock && G.running && !G.paused && !G.over) lock();
}
// The backpack GROWS during a run so you learn the words before you need to know how they're sorted:
//   stage 1 = ONE list grouped under 명사/동사/형용사/부사/표현 headers (jump bar on top),
//   stage 2 = tabs by meaning category (after 15 kills), still grouped by word type inside a tab.
// Only ever one sorting system at a time. settings.bpMode "type"/"cat" skips ahead for players who know the words.
const STAGE_AT = { 2: 15 };
const INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function initial(kr){ if (/^[-~(]/.test(kr)) return "문법"; const c = kr.charCodeAt(0) - 0xAC00; return c >= 0 && c < 11172 ? INITIALS[Math.floor(c / 588)] : kr[0]; }
const bpSort = (a, b) => (initial(a.kr) === "문법") - (initial(b.kr) === "문법") || a.kr.localeCompare(b.kr, "ko");
function bpStage(){ return settings.bpMode === "cat" ? 2 : 1; }   // 1 = one list grouped by word type (default, stays)
const POS_ORDER = { noun: 0, verb: 1, adjective: 2, adverb: 3, other: 4 };
const group = w => POS_KO[w.pos] || POS_KO.other;
const typeSort = (a, b) => (POS_ORDER[a.pos] ?? 4) - (POS_ORDER[b.pos] ?? 4) || bpSort(a, b);
const POS_TABS = ["noun", "verb", "adjective", "adverb", "other"];
const bpPool = () => G.mode === "survival" || shirtMode() ? G.unlocked : G.pool;
function bpTabsList(){
  const st = bpStage();
  if (st === 1) return [];
  return D.categories.filter(c => bpPool().some(w => w.cat === c.id)).map(c => ({ label: c.ko, icon: c.icon + " ", test: w => w.cat === c.id }));
}
function renderBackpack(){
  const st = bpStage(), tabs = bpTabsList(); if (G.bpTab >= tabs.length) G.bpTab = 0;
  const tutWord = G.tut && G.tut.step === "backpack" ? (G.aliens.find(a => !a.dead) || {}).word : null;
  $("#bpCount").textContent = `${bpPool().length} words · ${st === 1 ? "품사별 · by word type" : tabs.length + " categories"}`;
  $("#bpPos").innerHTML = "";
  if (!tabs.length) {
    const inis = [...new Set(bpPool().slice().sort(typeSort).map(group))];
    $("#bpTabs").innerHTML = inis.map(x => `<button class="jump" data-jump="${esc(x)}">${esc(x)}</button>`).join("");
  } else $("#bpTabs").innerHTML = tabs.map((t, i) => {
    const n = bpPool().filter(t.test).length;
    return `<button data-tab="${i}" class="${i === G.bpTab ? "on" : ""}${tutWord && t.test(tutWord) ? " hintTab" : ""}">${t.icon}${esc(t.label)} <span class="n">${n}</span>${i < 10 ? `<span class="hk">${(i + 1) % 10}</span>` : ""}</button>`;
  }).join("");
  const list = (tabs.length ? bpPool().filter(tabs[G.bpTab].test) : bpPool()).slice().sort(typeSort);
  let lastIni = "", html = "";
  for (const w of list) {
    const ini = group(w);
    if (ini !== lastIni) { html += `<div class="ini" data-ini="${esc(ini)}">${esc(ini)}</div>`; lastIni = ini; }   // 명사 / 동사 / … headers
    const main = settings.labels === "ko" ? w.kr : meaning(w);
    html += `<button data-w="${w.id}" class="${G.loaded && G.loaded.id === w.id ? "cur" : ""}${tutWord && tutWord.id === w.id ? " hintWord" : ""}"><span class="w">${esc(main)}</span>${G.newIds && G.newIds.has(w.id) ? '<span class="new">NEW</span>' : ""}${G.mode === "deer" && G.sanct && G.sanct.learned.includes(w.id) ? '<span class="new">🦌</span>' : ""}${stats[w.id] && stats[w.id].k ? `<span class="m">${esc(settings.labels === "ko" ? meaning(w) : w.kr)}</span>` : ""}</button>`;   // defeated words show their translation
  }
  $("#bpGrid").innerHTML = html || `<div style="color:#9a93c2">—</div>`;
}
function bpUnlockCheck(){
  return;   // no more upgrade
  if (G.kills === STAGE_AT[2]) { SFX.pickup(); G.bpTab = 0; objectiveFlash("🎒 가방 업그레이드! 이제 <b>의미</b>별로 정리돼요 · Backpack upgrade: sorted by <b>meaning category</b>"); }
}
$("#bpTabs").onclick = e => {
  const j = e.target.closest("[data-jump]");
  if (j) { const h = [...document.querySelectorAll("#bpGrid .ini")].find(x => x.dataset.ini === j.dataset.jump); if (h) h.scrollIntoView({ block: "start" }); SFX.select(); return; }
  const b = e.target.closest("[data-tab]"); if (!b) return; G.bpTab = +b.dataset.tab; SFX.select(); renderBackpack(); $("#bpGrid").scrollTop = 0; };
$("#bpGrid").onclick = e => { const b = e.target.closest("[data-w]"); if (!b) return; const w = D.words.find(x => x.id === b.dataset.w);
  if (G.mode === "deer") { say([wordClip(w.id)], { interrupt: true }); return; }   // no ammo to load here: just hear it
  closeBackpack(true); loadWord(w); };
$("#bpClose").onclick = () => closeBackpack(true);

/* ================================ input ================================ */
function lock(){ const c = renderer.domElement; if (document.pointerLockElement !== c && c.requestPointerLock) { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } }
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked && G.panel === "demon") { document.exitPointerLock(); return; }   // a late lock during a deer lesson: let it go again
  // Esc while the mouse is captured releases it without a keydown: treat losing the lock as pause (not right after a deer lesson)
  if (!locked && G.running && !G.paused && !G.over && !G.backpackOpen && !G.noteOpen && !G.chatting && G.wasLocked && !justClosed() && performance.now() > (G.noPauseUntil || 0)) pauseGame();   // (opening the chat is not a pause)
  G.wasLocked = locked;
  $("#clickToPlay").hidden = locked || !G.running || G.paused || G.over || G.backpackOpen || G.chatting || G.noteOpen;
});
$("#clickToPlay").onclick = () => { initAudio(); lock(); };
renderer.domElement.addEventListener("mousedown", e => {
  if (!G.running || G.paused || G.over) return;
  if (G.chatting) { $("#chatInput").focus(); return; }   // clicking while chatting = back into the chat box
  if (document.pointerLockElement !== renderer.domElement) { lock(); return; }
  if (G.duel) { if (e.button === 0) duelFire(); return; }   // 👑 the boss duel: shoot an answer
  if (G.aiming) { if (e.button === 0) confirmAim(); return; }   // 🎯 aiming a catapult
  if (e.button === 0) { G.firing = true; fire(); }
});
addEventListener("mouseup", e => { if (e.button === 0) G.firing = false; });
addEventListener("mousemove", e => {
  if (document.pointerLockElement !== renderer.domElement || G.backpackOpen) return;
  const s = .0022 * settings.sens;
  player.yaw -= e.movementX * s; player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * s));
});
addEventListener("keydown", e => {
  if (!G.running || G.over) return;
  if (G.chatting) { if (e.code === "Escape") closeChat(); else if (e.code === "Enter" || e.code === "Tab") { e.preventDefault(); $("#chatInput").focus(); } return; }   // the box lost focus: Esc still closes, Enter/Tab refocus
  const k = e.code;
  if (k === "Enter" && G.coop && !G.noteOpen && !G.backpackOpen) { e.preventDefault(); openChat(); return; }   // 💬 co-op chat
  if (G.aiming && !G.noteOpen) { if (k === "KeyE" || k === "Digit1") { confirmAim(); return; } if (k === "Digit2") { aimPickup(); return; } if (k === "KeyQ" || k === "Escape") { G.aiming = null; return; } }
  // after Esc closed a panel the mouse is free: any other key (a real user gesture, unlike Esc) captures it again
  if (!G.noteOpen && !G.backpackOpen && !G.paused && k !== "Escape" && document.pointerLockElement !== renderer.domElement) { initAudio(); lock(); }
  const shut = k === "Escape" || k === "KeyQ";   // Q closes everything too — unlike Esc it keeps the mouse captured
  if (G.noteOpen) { e.preventDefault();
    if (G.panel === "picker") { const n = /^(?:Digit|Numpad)([1-9])$/.exec(k); if (n && G.unlocked[+n[1] - 1]) { pickWordFor(G.pickerTower, G.unlocked[+n[1] - 1]); closePanel(); } if (shut || k === "KeyE") closePanel(); return; }
    if (G.panel === "shop") { const n = /^(?:Digit|Numpad)([1-9])$/.exec(k); if (n) buy(+n[1] - 1); if (shut || k === "KeyE") closePanel(); return; }
    if (G.panel === "brief") { if (k === "KeyE" || k === "Space" || k === "Enter" || shut) closeBrief();
      const n = /^(?:Digit|Numpad)([1-4])$/.exec(k); if (n && G.waveWords[+n[1] - 1]) say([wordClip(G.waveWords[+n[1] - 1].id)], { interrupt: true }); return; }
    if (G.panel === "demon") { if (k === "KeyQ" || k === "Escape") { closeDemon(); objectiveFlash("🦌 수업을 그만뒀어요 · Lesson stopped"); } return; }
    if (G.panel === "pedestal" || G.panel === "workshop") { if (k === "Digit1" || k === "Numpad1" || k === "KeyE") deerAct(G.panel === "pedestal" ? "ammo" : "trap"); else if (G.panel === "workshop" && (k === "Digit2" || k === "Numpad2")) deerAct("cat"); else if (shut) closePanel(); return; }
    if (G.panel === "shelter") { if (k === "Digit1" || k === "Numpad1" || k === "KeyE") deerAct("train"); else if (shut) closePanel(); return; }
    if (G.panel === "lessons") { const n = /^(?:Digit|Numpad)([1-6])$/.exec(k); if (n) deerAct("lesson" + (+n[1] - 1)); else if (shut || k === "KeyE") closePanel(); return; }
    if (G.panel === "lessoncard") { if (k === "KeyE" || k === "Space" || k === "Enter") lessonQuiz(); else if (k === "Escape" || k === "KeyQ") closePanel(); return; }
    // any build / repair / safe quiz can be left (Esc, Q or the Exit button) — only a hound bite can't
    if (Q && Q.onPass && G.panel !== "bite" && (k === "Escape" || k === "KeyQ")) { closePanel(); return; }
    if (!Q) { if (k === "KeyE" || k === "Space" || k === "Enter") startQuiz(); return; }
    const n = /^(?:Digit|Numpad)([1-5])$/.exec(k); if (n) answerQuiz(+n[1] - 1); return; }
  if (k === "Tab" || k === "KeyB") { e.preventDefault(); if (G.backpackOpen) closeBackpack(true); else if (!G.paused) openBackpack(); return; }
  if (G.backpackOpen) {
    const cats = bpTabsList();
    if (shut) { closeBackpack(true); return; }
    if (!cats.length) return;
    if (k === "ArrowRight") { G.bpTab = (G.bpTab + 1) % cats.length; renderBackpack(); SFX.select(); }
    if (k === "ArrowLeft") { G.bpTab = (G.bpTab - 1 + cats.length) % cats.length; renderBackpack(); SFX.select(); }
    const d = /^Digit(\d)$/.exec(k); if (d) { const i = (+d[1] + 9) % 10; if (i < cats.length) { G.bpTab = i; renderBackpack(); SFX.select(); } }
    return;
  }
  if (G.paused) { if (k === "KeyQ") resumeGame(); return; }   // Q (or the button) resumes
  if (k === "Escape") { if (!G.paused && !e.repeat && !justClosed()) pauseGame(); return; }
  keys[k] = true;
  if (k === "Space") { e.preventDefault(); if (G.mode !== "deer") dash(); }   // deer sanctuary: Space = sprint (held), no dash
  if (k === "KeyR") startReload();
  if (k === "KeyE" && G.mode === "deer" && G.interact) { deerUse(G.interact); return; }
  if (k === "KeyE" && G.mode === "fortress" && G.interact && G.interact.kind !== "revive" && !player.downed) { const it = G.interact; if (it.kind === "pad") towerQuiz(it.o); else if (it.kind === "tower") towerPicker(it.o); else if (it.kind === "event") useEvent(it.o); else openShop(); return; }
  if (k === "KeyF") nukeWord();
  if (k === "KeyQ") { const h = aimAlien(); const a = h ? h.alien : nearestAlien(); if (a) announce(a, true); }
  if (shirtMode()) { const n = /^Digit([1-9])$/.exec(k); if (n) { const w = ammoWords()[+n[1] - 1]; if (w && (!G.loaded || w.id !== G.loaded.id)) loadWord(w); } if (n) return; }
  const d = /^Digit([1-4])$/.exec(k);
  if (d && G.recentLoads && G.recentLoads[+d[1] - 1]) { const w = D.words.find(x => x.id === G.recentLoads[+d[1] - 1]); if (w && (!G.loaded || w.id !== G.loaded.id)) loadWord(w); }
});
addEventListener("keyup", e => { keys[e.code] = false; });
// mouse wheel cycles through the words you know (escape / survival)
addEventListener("wheel", e => { const L = ammoWords(); if (!G.running || G.backpackOpen || G.noteOpen || L.length < 2 || (!shirtMode() && G.mode !== "survival")) return;
  const i = Math.max(0, L.findIndex(w => G.loaded && w.id === G.loaded.id)), n = L.length;
  loadWord(L[(i + (e.deltaY > 0 ? 1 : -1) + n) % n]); }, { passive: true });
function nearestAlien(){ let best = null, bd = 1e9; for (const a of G.aliens) if (!a.dead) { const d = a.pos.distanceTo(player.pos) - (a.active ? 1000 : 0); if (d < bd) { bd = d; best = a; } } return best; }
function dash(){
  if (player.dashCd > 0 || player.dashing > 0 || !G.running) return;
  player.dashCd = .55; player.dashing = .2; SFX.dash();   // unlimited: only a short cooldown
  const f = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)), r = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const d = new THREE.Vector3();
  if (keys.KeyW) d.add(f); if (keys.KeyS) d.sub(f); if (keys.KeyD) d.add(r); if (keys.KeyA) d.sub(r);
  if (d.lengthSq() < .01) d.copy(f);
  player.dashDir.copy(d.normalize());
  if (G.tut && G.tut.step === "dodge") G.tut.dashed = true;
}

/* ================================ tutorial ================================ */
const TUT = {
  move:    { text: "<b>WASD</b>로 걸어 보세요 · Walk with <b>WASD</b>, look with the <b>mouse</b>" },
  gun:     { text: "빛나는 총을 주우세요 · Walk to the glowing <b>gun</b> to pick it up" },
  shoot:   { text: "외계인이 온다! 쏘세요 · An alien! <b>Shoot it</b> (left mouse)" },
  listen:  { text: "안 먹혀요! 루미의 말을 들어 보세요 · It <b>resists</b> your ammo. Listen to Lumi 🔊 (Q = hear again)" },
  backpack:{ text: "<b>Tab</b> — 가방을 열어서 그 단어를 장전하세요 · Open your <b>backpack</b> and load that word" },
  kill:    { text: "이제 쏘세요! · Now <b>shoot</b> it!" },
  dodge:   { text: "가까이 오면 내려쳐요 — 빨간 원에서 <b>Space</b>로 피하세요 · Up close they <b>slam</b>: dash (<b>Space</b>) out of the red circle. Look at it to hear its word" },
  dodge2:  { text: "그 단어를 찾아서 처치하세요 · Find its word and take it down" },
  done:    { text: "훈련 끝! 이제 구역을 정화하세요 · Training done — now clear the district" },
};
function tutNext(step){
  if (!G.tut) return;
  G.tut.step = step; G.tut.text = TUT[step].text; objective(TUT[step].text);
  if (step === "gun") helperShow("안녕! 나는 루미야. <small>Hi, I'm Lumi — I'll tell you which word each alien is weak to.</small>", 5);
  if (step === "shoot") { spawnAlien(world.tutorialSpawns[0].clone(), { rise: true, speed: .55, skills: { orb: false, slam: false } }); say([lineClip("careful")]); }
  if (step === "listen") { setTimeout(() => { const a = G.aliens.find(x => !x.dead); if (a) { announce(a); setTimeout(() => G.tut && G.tut.step === "listen" && tutNext("backpack"), 1800); } }, 500); }
  if (step === "backpack") say([lineClip("backpack")]);
  if (step === "dodge") { G.tut.dashed = false; spawnAlien(new THREE.Vector3(player.pos.x, 0, player.pos.z - 14), { rise: true, speed: .8, skills: { orb: false, slam: true } }); setTimeout(() => G.tut && G.tut.step === "dodge" && tutNext("dodge2"), 9000); }
  if (step === "done") { store.set("wa_tutorial_done", true); setTimeout(() => { G.tut = null; populateDistrict(); }, 3000); }
}

/* ================================ the district ================================ */
function spawnAlien(pos, opt = {}){
  const f = world.freeSpot(pos.x, pos.z); pos.x = f.x; pos.z = f.z;   // never inside a table or crate
  pos.y = world.groundY(pos.x, pos.z);
  const a = new Alien(scene, pos, opt.dormant ? null : nextWeakWord(), opt); a.id = Math.random().toString(36).slice(2);
  G.aliens.push(a); return a;
}
// aliens wait in houses, squares, the cathedral and on the wall (world.nests); one caster where flagged
function populateDistrict(){
  for (const [x, z, n, flags] of world.nests) {
    for (let i = 0; i < n; i++) {
      const caster = flags.includes("c") && i === n - 1;
      const ang = i / n * Math.PI * 2, r = n > 1 ? 1.6 : 0;
      spawnAlien(new THREE.Vector3(x + Math.cos(ang) * r, 0, z + Math.sin(ang) * r), {
        dormant: true, roam: flags.includes("r"), caster, speed: caster ? .9 : rnd(.85, 1.15),
        skills: caster ? { orb: true, slam: false } : { orb: false, slam: true } });
    }
  }
  G.total = G.aliens.filter(a => !a.dead).length;
  objective(`구역을 정화하세요 · Clear the district — <b>${G.total}</b> aliens are hiding in houses, squares and the cathedral`);
  setTimeout(() => { if (!G.tut && G.running) objective(""); }, 7000);
  renderTop();
}
// Lumi's radar: when nothing is happening for a while, an arrow points at the nearest alien
function districtTick(rdt){
  if (G.tut || G.mode === "survival" || shirtMode()) { if (!shirtMode()) $("#radar").hidden = true; return; }
  const active = G.aliens.some(a => a.active);
  G.quietT = active ? 0 : G.quietT + rdt;
  const near = nearestAlien();
  const show = near && G.quietT > 2 && !G.backpackOpen;
  $("#radar").hidden = !show;
  if (show) {
    const dx = near.pos.x - player.pos.x, dz = near.pos.z - player.pos.z;
    const ang = Math.atan2(dx, -dz) + player.yaw;   // 0 = straight ahead
    $("#radarArrow").style.transform = `rotate(${ang - Math.PI / 2}rad)`;   // the ➤ glyph points right
    const up = near.pos.y - player.feet > 1.5 ? " ↑" : near.pos.y - player.feet < -1.5 ? " ↓" : "";
    $("#radarDist").textContent = Math.round(Math.hypot(dx, dz)) + " m" + up;
  }
}
// minimap: static layer drawn once, dynamic dots every few frames
const MM = { S: 170, W: 136 };
let mmStatic = null, mmT = 0;
function mmXY(x, z){ const b = world.bounds, W = Math.max(b.x1 - b.x0, b.z1 - b.z0), ox = (W - (b.x1 - b.x0)) / 2; return [(x - b.x0 + ox) / W * MM.S, (z - b.z0) / W * MM.S]; }
function drawMinimapStatic(){
  const c = document.createElement("canvas"); c.width = c.height = MM.S; const g2 = c.getContext("2d");
  g2.fillStyle = "#15131f"; g2.fillRect(0, 0, MM.S, MM.S);
  const rect = (x0, x1, z0, z1, col) => { const [a, b] = mmXY(x0, z0), [c2, d] = mmXY(x1, z1); g2.fillStyle = col; g2.fillRect(a, b, c2 - a, d - b); };
  for (const [x0, x1, z0, z1, col] of world.mm.areas || []) rect(x0, x1, z0, z1, col);   // raised ground, stairs & ramps
  if (world.mm.road2) { g2.strokeStyle = "#ffc26b"; g2.lineWidth = 2.5; g2.beginPath(); world.mm.road2.forEach(([x, z], i) => { const [a, b] = mmXY(x, z); if (i) g2.lineTo(a, b); else g2.moveTo(a, b); }); g2.stroke(); }
  if (world.mm.roadB) { g2.strokeStyle = "#5fd4ff"; g2.lineWidth = 3; g2.beginPath(); world.mm.roadB.forEach(([x, z], i) => { const [a, b] = mmXY(x, z); if (i) g2.lineTo(a, b); else g2.moveTo(a, b); }); g2.stroke(); }
  if (world.mm.road) { g2.strokeStyle = "#5fd4ff"; g2.lineWidth = 3; g2.beginPath(); world.mm.road.forEach(([x, z], i) => { const [a, b] = mmXY(x, z); if (i) g2.lineTo(a, b); else g2.moveTo(a, b); }); g2.stroke(); }
  for (const b of world.mm.solid) rect(b[0], b[1], b[2], b[3], "#4a4560");
  for (const b of world.mm.enter) { rect(b[0], b[1], b[2], b[3], "#2d4a47"); }
  g2.fillStyle = "#7cf7d4"; for (const [x, z] of world.mm.doors) { const [a, b] = mmXY(x, z); g2.fillRect(a - 2, b - 2, 4, 4); }
  mmStatic = c;
}
function drawMinimap(){
  const cv = $("#minimap"), g2 = cv.getContext("2d");
  if (!mmStatic) drawMinimapStatic();
  g2.drawImage(mmStatic, 0, 0);
  for (const a of G.aliens) { if (a.dead) continue; const d = a.pos.distanceTo(player.pos);
    if (!a.active && d > 30) continue;   // sleeping aliens only show up when you're close
    const [x, y] = mmXY(a.pos.x, a.pos.z); g2.fillStyle = a.active ? "#ff4d6d" : "rgba(255,77,109,.45)"; g2.beginPath(); g2.arc(x, y, a.active ? 3 : 2.2, 0, 7); g2.fill(); }
  if (G.mode === "deer" && G.sanct) { const S = G.sanct, dot = (o, col, r) => { const [x, y] = mmXY(o.x, o.z); g2.fillStyle = col; g2.beginPath(); g2.arc(x, y, r, 0, 7); g2.fill(); };
    for (const t of S.traps) dot(t, t.cd > 0 ? "#6a5a4a" : "#ff9a3a", 2.8);
    for (const r of S.runners) if (r.delay <= 0) dot(r, "#ffd08a", 2); dot(world.hive, "#ff4fd8", 4); dot(world.shelter, "#ffd08a", 3.2);
    dot(world.pedestal, "#b388ff", 3.2); dot(world.workshop, "#ffb070", 3.2); dot(world.deer, G.time - S.lastHit < .4 ? "#ff4d6d" : "#9fdcff", 4.5); }
  if (G.mode === "fortress" || G.mode === "deer") { for (const p of fort.pads) { const [x, y] = mmXY(p.x, p.z); g2.strokeStyle = "#7cf7d4"; g2.strokeRect(x - 3, y - 3, 6, 6); }
    for (const t of fort.towers) { const [x, y] = mmXY(t.x, t.z); g2.fillStyle = t.broken ? "#8a3a4a" : "#7cf7d4"; g2.fillRect(x - 3, y - 3, 6, 6); }
    for (const ev of fort.events) { const [x, y] = mmXY(ev.x, ev.z); g2.fillStyle = "#c77dff"; g2.beginPath(); g2.arc(x, y, 3.5, 0, 7); g2.fill(); }
    for (const m of G.mercs) { const [x, y] = mmXY(m.x, m.z); g2.fillStyle = "#9fb8ff"; g2.beginPath(); g2.arc(x, y, 2.5, 0, 7); g2.fill(); }
    for (const h of G.dogs || []) { const [x, y] = mmXY(h.x, h.z); g2.fillStyle = h.sleepT > 0 ? "#6a4a20" : "#ff9a3a"; g2.beginPath(); g2.arc(x, y, 2.6, 0, 7); g2.fill(); }
    if (G.deer) { const [x, y] = mmXY(G.deer.x, G.deer.z); g2.strokeStyle = "rgba(159,220,255,.6)"; g2.beginPath(); g2.arc(x, y, 8 / 136 * 170, 0, 7); g2.stroke(); }
    if (fort.merchant) { const [x, y] = mmXY(fort.merchant.x, fort.merchant.z); g2.fillStyle = "#ffcf5c"; g2.beginPath(); g2.arc(x, y, 3.5, 0, 7); g2.fill(); } }
  const [px, py] = mmXY(player.pos.x, player.pos.z);
  g2.save(); g2.translate(px, py); g2.rotate(-player.yaw); g2.fillStyle = "#ffcf5c";
  g2.beginPath(); g2.moveTo(0, -6); g2.lineTo(4, 4); g2.lineTo(-4, 4); g2.closePath(); g2.fill(); g2.restore();
}
/* ---------------- ⏱ survival ---------------- */
// pick a new word you don't own yet: words you struggled with before come first, then unseen ones
function unlockWord(first){
  const own = new Set(G.unlocked.map(w => w.id));
  const cands = G.pool.filter(w => !own.has(w.id));
  if (!cands.length) return null;
  const wts = cands.map(w => { const s = stats[w.id]; return s ? Math.max(.3, 1 + s.w * 1.5 - s.r * .4) : 1.2; });
  let r = Math.random() * wts.reduce((a, b) => a + b, 0), pickW = cands[0];
  for (let i = 0; i < cands.length; i++) { r -= wts[i]; if (r <= 0) { pickW = cands[i]; break; } }
  G.unlocked.push(pickW); G.newIds.add(pickW.id);
  if (!first) {
    SFX.pickup(); say([wordClip(pickW.id)], { interrupt: true });
    helperShow(`새 단어! <b class="typed">${esc(pickW.kr)}</b> <small>= ${esc(meaning(pickW))} · ${POS_KO[pickW.pos]}</small>`, 5);
    $("#helperText").dataset.for = "";
    objectiveFlash(`🎒 새 단어 해금 · New word: <b>${esc(pickW.kr)}</b> — ${G.unlocked.length} words in your backpack`);
  }
  return pickW;
}
function survivalTick(dt){
  if (G.mode !== "survival" || G.tut || G.over) return;
  G.survT += dt;
  const words = G.unlocked.length, alive = G.aliens.filter(a => !a.dead).length;
  const cap = Math.min(30, 6 + words);
  G.spawnT -= dt;
  if (G.spawnT <= 0 && alive < cap) {
    G.spawnT = Math.max(.9, 3.4 - words * .07 - G.survT * .004);
    const casters = G.aliens.filter(a => !a.dead && a.caster).length;
    const caster = words >= 10 && casters < 2 && Math.random() < .08;
    spawnAlien(world.farSpot(player.pos.x, player.pos.z, 26, 70), { rise: true, caster,
      speed: caster ? .9 : Math.min(1.5, rnd(.85, 1.1) + words * .01), skills: caster ? { orb: true, slam: false } : { orb: false, slam: true } });
  }
  if (Math.floor(G.survT) !== G.lastSec) { G.lastSec = Math.floor(G.survT); renderTop(); }
}
/* ---------------- 🏃 escape ---------------- */
const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 60, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffcf5c, transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
beam.visible = false; scene.add(beam);
function placeBeam(){ const cp = world.route[G.cp]; if (!cp) { beam.visible = false; return; } beam.visible = true; beam.position.set(cp.x, world.groundY(cp.x, cp.z) + 30, cp.z); }
function escapeTick(dt, rdt){
  if (G.mode !== "escape" || G.over) return;
  G.escT += dt;
  beam.material.opacity = .16 + Math.sin(G.time * 3) * .06;
  // checkpoint reached?
  const cp = world.route[G.cp];
  if (cp && Math.hypot(player.pos.x - cp.x, player.pos.z - cp.z) < 4 && Math.abs(player.feet - world.groundY(cp.x, cp.z)) < 2) {
    G.cp++; SFX.pickup(); player.hp = Math.min(100, player.hp + 30); renderHP();
    if (G.cp >= world.route.length) { G.won = true; beam.visible = false; say([lineClip("clear")]); setTimeout(gameOver, 600); return; }
    objectiveFlash(`✓ ${cp.ko} — 다음 · next: <b>${world.route[G.cp].ko}</b> <small>${world.route[G.cp].en} · +30 HP</small>`); placeBeam();
  }
  // goal arrow (or the note, while it waits to be read)
  const tgt = G.note ? { x: G.note.s.position.x, z: G.note.s.position.z, label: "📜 쪽지 · read the note" } : cp ? { x: cp.x, z: cp.z, label: `🏃 ${cp.ko} · ${cp.en}` } : null;
  $("#radar").hidden = !tgt || G.backpackOpen || G.noteOpen;
  if (tgt) { const dx = tgt.x - player.pos.x, dz = tgt.z - player.pos.z;
    $("#radarArrow").style.transform = `rotate(${Math.atan2(dx, -dz) + player.yaw - Math.PI / 2}rad)`;
    $("#radarDist").textContent = Math.round(Math.hypot(dx, dz)) + " m"; $("#radar small").textContent = tgt.label; }
  // the note: walk into it to read
  if (G.note) { G.note.t += rdt; G.note.s.position.y = G.note.y + Math.sin(G.note.t * 3) * .15; G.note.s.material.rotation = Math.sin(G.note.t * 2) * .15;
    if (!G.noteOpen && Math.hypot(G.note.s.position.x - player.pos.x, G.note.s.position.z - player.pos.z) < 1.6) openNote(); }
  // the horde: calm after a special, otherwise a steady stream from all around, harder every checkpoint
  if (G.calmT > 0) { G.calmT -= dt; if (Math.floor(G.calmT) !== G.lastCalm) { G.lastCalm = Math.floor(G.calmT); renderTop(); } return; }
  const alive = G.aliens.filter(a => !a.dead).length, cap = Math.min(28, 10 + G.cp * 4 + G.unlocked.length);
  G.spawnT -= dt;
  if (G.spawnT <= 0 && alive < cap) {
    G.spawnT = Math.max(.45, 1.3 - G.cp * .15 - G.escT * .002);
    G.spawned++;
    const special = G.spawned % 25 === 0 && !G.aliens.some(a => a.special && !a.dead) && !G.note && G.unlocked.length < G.pool.length;
    if (special) {
      const nw = nextNewWord();
      const a = new Alien(scene, world.farSpot(player.pos.x, player.pos.z, 18, 34), nw, { rise: true, special: true, shirt: "?", hp: 320, speed: 1.1, skills: { orb: false, slam: true } });
      a.id = "sp" + G.spawned; a.pos.y = world.groundY(a.pos.x, a.pos.z); a.baseY = a.pos.y; G.aliens.push(a);
      objectiveFlash("⭐ 특별한 적이 나타났다! · A <b>special</b> enemy appeared — any word hurts it. Kill it for a new word!"); SFX.charge();
    } else {
      const caster = G.cp >= 2 && Math.random() < .06 && G.aliens.filter(a => a.caster && !a.dead).length < 2;
      const w = nextWeakWord();
      spawnAlienShirt(world.farSpot(player.pos.x, player.pos.z, 22, 55), w, { rise: true, caster,
        speed: caster ? 1.1 : rnd(1.5, 2.1) + G.cp * .08, skills: caster ? { orb: true, slam: false } : { orb: false, slam: true } });
    }
  }
}
function spawnAlienShirt(pos, w, opt){
  const f = world.freeSpot(pos.x, pos.z); pos.x = f.x; pos.z = f.z; pos.y = world.groundY(pos.x, pos.z);
  const a = new Alien(scene, pos, w, { ...opt, shirt: opt.shirtText || w.kr }); a.id = Math.random().toString(36).slice(2); G.aliens.push(a); return a;
}
function nextNewWord(){
  const own = new Set(G.unlocked.map(w => w.id)), cands = G.pool.filter(w => !own.has(w.id) && !(G.mode === "deer" && G.sanct && G.sanct.deerIds && G.sanct.deerIds.has(w.id)));   // the deer's words only come from the deer
  const wts = cands.map(w => { const s = stats[w.id]; return s ? Math.max(.3, 1 + s.w * 1.5 - s.r * .4) : 1.2; });
  let r = Math.random() * wts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cands.length; i++) { r -= wts[i]; if (r <= 0) return cands[i]; }
  return cands[0];
}
// the special dies: a huge blast clears the street, 10 s of calm, and a note with the new word is left behind
function specialKill(a){
  fxOut({ blast: [a.pos.x, a.pos.y, a.pos.z] }); if (G.coop) G.notePass = { host: false, client: false };
  G.shake = 1.2; SFX.slam(); SFX.kill();
  const v = $("#vignette"); v.classList.remove("hurt"); v.style.boxShadow = "inset 0 0 400px 200px rgba(255,230,160,.8)"; setTimeout(() => v.style.boxShadow = "", 350);
  for (let i = 0; i < 4; i++) burst(a.aimPoint(), [0xffcf5c, 0xffffff, 0xff8a3a, 0x7cf7d4][i], 120, 16 + i * 4);
  for (const o of G.aliens) if (!o.dead && o !== a) { burst(o.aimPoint(), 0xffcf5c, 30, 7); o.die(); G.kills++; G.score += 50; }
  G.calmT = 10; G.lastCalm = -1; G.spawnT = 1.5;
  const c = document.createElement("canvas"); c.width = c.height = 128; const g2 = c.getContext("2d");
  g2.fillStyle = "#f6e7c1"; g2.beginPath(); g2.roundRect(24, 14, 80, 100, 8); g2.fill(); g2.strokeStyle = "#8a6a2a"; g2.lineWidth = 4; g2.stroke();
  g2.fillStyle = "#8a6a2a"; for (let i = 0; i < 5; i++) g2.fillRect(36, 34 + i * 14, i === 4 ? 36 : 56, 5);
  g2.font = "bold 30px sans-serif"; g2.fillStyle = "#d4552a"; g2.fillText("★", 70, 104);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false }));
  const y = world.groundY(a.pos.x, a.pos.z) + 1.3; s.position.set(a.pos.x, y, a.pos.z); s.scale.set(1.1, 1.1, 1); scene.add(s);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffcf5c, transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.set(3, 3, 1); s.add(glow);
  G.note = { s, y, t: 0, w: a.word };
  objective("💥 쾅! 잠깐 조용해졌어요 — 쪽지를 읽으세요 · The street is clear for 10 s — go read the <b>note</b> 📜");
  setTimeout(() => { if (G.running && G.mode === "escape") objective(""); }, 6000);
  renderTop();
}
function openNote(){
  const w = G.note.w; G.noteOpen = true; G.panel = "note"; G.timeScale = 0; $("#note .nHead").textContent = "📜 새 단어 · New word"; document.exitPointerLock && document.exitPointerLock();
  say([wordClip(w.id)], { interrupt: true });
  const C = CAT[w.cat];
  $("#noteBody").innerHTML = `<div class="nKr">${esc(w.kr)} <button id="noteSay">🔊</button></div>
    <div class="nMean">${esc(meaning(w))}</div>
    <div class="nTags"><span>${POS_KO[w.pos]} · ${esc({ noun: "noun", verb: "verb", adjective: "adjective", adverb: "adverb", other: "expression" }[w.pos] || "")}</span><span>${C.icon} ${esc(C.ko)} · ${esc(C.en)}</span></div>
    ${w.ex ? `<div class="nEx">${esc(w.ex)}${w.exEn ? `<small>${esc(w.exEn)}</small>` : ""}</div>` : ""}
    <div class="nHint">읽고 나서 퀴즈를 통과하면 이 단어가 내 것이 돼요 · Pass the quiz and this word is yours (key <b>${G.unlocked.length + 1}</b>).</div>`;
  Q = null; $("#noteClose").hidden = false; $("#noteClose").textContent = "퀴즈 시작 · Start the quiz (E)";
  $("#note").hidden = false; $("#noteSay").onclick = () => say([wordClip(w.id)], { interrupt: true });
}
/* ---- the quiz: new word → meaning, new word → type, then earlier words (meaning → Korean). Perfect round to pass. ---- */
let Q = null;
const POS_LIST = ["명사", "동사", "형용사", "부사", "표현"];
const shuffleA = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function distinct(list, n, key, avoid){
  const out = [], seen = new Set(avoid.map(key));
  for (const x of shuffleA(list)) { const k = key(x); if (!k || seen.has(k)) continue; seen.add(k); out.push(x); if (out.length >= n) break; }
  return out;
}
function buildQuiz(){
  const w = G.note.w, prev = G.unlocked.slice();
  const samePos = G.pool.filter(x => x.pos === w.pos && x.id !== w.id);
  let wrongMeans = distinct(samePos, 3, meaning, [w]);
  if (wrongMeans.length < 3) wrongMeans = wrongMeans.concat(distinct(G.pool, 3 - wrongMeans.length, meaning, [w, ...wrongMeans]));
  const qs = [
    { w, audio: true, prompt: `<b>${esc(w.kr)}</b> — 뜻은? <small>What does it mean?</small>`, opts: shuffleA([meaning(w), ...wrongMeans.map(meaning)]), ans: meaning(w) },
    { w, prompt: `<b>${esc(w.kr)}</b> — 품사는? <small>What type of word is it?</small>`, opts: POS_LIST, fixed: true, ans: POS_KO[w.pos] || "표현" },
  ];
  // earlier words: struggled-with ones first; shown in YOUR language, answer in Korean
  const weight = x => { const s = stats[x.id]; return (s ? 1 + s.w - s.r * .3 : 1) + Math.random(); };
  const review = prev.slice().sort((a, b) => weight(b) - weight(a)).slice(0, 3);
  for (const r of review) {
    let wrong = distinct(prev.filter(x => x.id !== r.id), 3, x => x.kr, [r]);
    if (wrong.length < 3) wrong = wrong.concat(distinct(G.pool, 3 - wrong.length, x => x.kr, [r, ...wrong]));
    qs.push({ w: r, prompt: `<b>${esc(meaning(r))}</b> — 한국어로? <small>Which Korean word?</small>`, opts: shuffleA([r.kr, ...wrong.map(x => x.kr)]), ans: r.kr, audioAfter: true });
  }
  return qs;
}
function startQuiz(){ Q = { qs: buildQuiz(), i: 0, wrong: 0, round: 1, lock: false }; $("#noteClose").hidden = true; renderQuiz(); }
function renderQuiz(msg){
  const q = Q.qs[Q.i];
  if (q.audio && !msg) say([wordClip(q.w.id)], { interrupt: true });
  $("#noteBody").innerHTML = `<div class="qHead">📝 퀴즈 ${Q.i + 1} / ${Q.qs.length}${Q.round > 1 ? ` · 도전 ${Q.round}번째 · try ${Q.round}` : ""}</div>
    <div class="qPrompt">${q.prompt}</div>
    <div class="qOpts">${q.opts.map((o, i) => `<button data-opt="${i}"><span class="k">${i + 1}</span>${esc(o)}</button>`).join("")}</div>
    <div class="qMsg">${msg || `숫자 키 1–${q.opts.length} 또는 클릭 · keys 1–${q.opts.length} or click`}</div>`;
}
function answerQuiz(idx){
  if (!Q || Q.lock) return; const q = Q.qs[Q.i]; if (idx < 0 || idx >= q.opts.length) return;
  Q.lock = true; const ok = q.opts[idx] === q.ans;
  const btns = [...document.querySelectorAll("#noteBody [data-opt]")];
  btns[idx].classList.add(ok ? "right" : "wrong"); if (!ok) btns[q.opts.indexOf(q.ans)].classList.add("right");
  if (ok) SFX.select(); else { SFX.resist(); Q.wrong++; (Q.missed || (Q.missed = [])).push(q); }
  mark(q.w, ok);
  if (q.audioAfter) say([wordClip(q.w.id)], { interrupt: true });
  $("#noteBody .qMsg").innerHTML = ok ? "✅ 맞아요! · Correct" : `❌ 정답: <b>${esc(q.ans)}</b>`;
  setTimeout(() => {
    Q.lock = false; Q.i++;
    if (Q.i < Q.qs.length) { renderQuiz(); return; }
    if (Q.wrong === 0 && Q.onPass) { SFX.pickup(); const cb = Q.onPass; Q = null; cb(); return; }
    if (Q.wrong === 0) { SFX.pickup(); $("#noteBody").innerHTML = `<div class="qPass">🎉 통과! · Passed</div><div class="qMsg">${esc(G.note.w.kr)} = ${esc(meaning(G.note.w))}</div>`; setTimeout(closeNote, 1100); return; }
    // not perfect: only the questions you missed come back (reshuffled), until each one is right
    $("#noteBody").innerHTML = `<div class="qPass" style="color:#b8323f">다시! · Again</div><div class="qMsg">${Q.wrong} 틀렸어요 — 틀린 문제만 다시 · only the ${Q.wrong} you missed</div>`;
    setTimeout(() => { Q.round++; Q.qs = Q.missed; Q.missed = []; Q.i = 0; Q.wrong = 0; Q.qs.forEach(x => { if (!x.fixed) x.opts = shuffleA(x.opts); }); renderQuiz(); }, 1400);
  }, ok ? 650 : 1700);
}
$("#noteBody").addEventListener("click", e => { const b = e.target.closest("[data-opt]"); if (b) answerQuiz(+b.dataset.opt); });
function closeNote(){
  if (!G.noteOpen) return;
  if (G.coop && G.mode === "fortress") {   // co-op: my part is done; the word counts when both have passed
    G.noteOpen = false; G.panel = null; G.timeScale = 1; $("#note").hidden = true; Q = null; lock();
    const w = G.note.w; loadWord(w); markKill(w); G.note.s.visible = false; G.note.passed = true;
    if (isClient()) { coopAct({ a: "note" }); objective("✓ 통과! 파트너를 기다려요 · Passed — waiting for your partner to pass the note too"); }
    else { G.notePass.host = true; tryFinishNote(); if (!G.notePass.client) objective("✓ 통과! 파트너를 기다려요 · Passed — waiting for your partner to pass the note too"); }
    return;
  }
  const w = G.note.w; scene.remove(G.note.s); G.note = null; G.noteOpen = false; G.panel = null; G.timeScale = 1; $("#note").hidden = true;
  G.unlocked.push(w); loadWord(w); markKill(w); renderQuick(); renderTop(); lock();
  Q = null; G.calmT = Math.max(G.calmT, 5);   // a short breather after the quiz
  if (G.mode === "fortress") { G.waveActive = true; startWave(); if (G.unlocked.length >= 5) spawnMerchant(); }
}
$("#noteClose").onclick = () => { if (G.panel === "brief") closeBrief(); else if (G.panel === "lessoncard") lessonQuiz(); else if (CLOSABLE.has(G.panel) || EXITABLE.has(G.panel)) closePanel(); else if (!Q) startQuiz(); };
/* ---------------- 🏰 fortress ---------------- */
const fort = { pads: [], towers: [], merchant: null, events: [] };
function signTexture(text, sub){
  const c = document.createElement("canvas"); c.width = 256; c.height = 128; const g2 = c.getContext("2d");
  g2.fillStyle = "rgba(8,20,18,.85)"; g2.beginPath(); g2.roundRect(4, 4, 248, 120, 16); g2.fill(); g2.strokeStyle = "#7cf7d4"; g2.lineWidth = 5; g2.stroke();
  g2.fillStyle = "#e9fffa"; g2.textAlign = "center"; g2.textBaseline = "middle";
  let fs2 = 56; g2.font = `900 ${fs2}px "Malgun Gothic", sans-serif`; while (g2.measureText(text).width > 230 && fs2 > 20) { fs2 -= 3; g2.font = `900 ${fs2}px "Malgun Gothic", sans-serif`; }
  g2.fillText(text, 128, sub ? 54 : 64);
  if (sub) { g2.font = `22px "Malgun Gothic", sans-serif`; g2.fillStyle = "#7cf7d4"; g2.fillText(sub, 128, 102); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function clearFortifications(blast){
  for (const p of fort.pads) scene.remove(p.g);
  for (const t of fort.towers) { if (blast) { burst(t.crystalPos.clone(), 0x7cf7d4, 60, 9); burst(t.crystalPos.clone(), 0xffcf5c, 30, 6); } scene.remove(t.g); }
  if (fort.merchant) scene.remove(fort.merchant.g);
  for (const e of fort.events || []) scene.remove(e.g);
  fort.pads = []; fort.towers = []; fort.merchant = null; fort.events = [];
}
function setupZone(i){
  clearFortifications(false);
  G.zone = i % world.zones.length; const z = world.zones[G.zone];
  beam.visible = true; beam.position.set(z.x, world.groundY(z.x, z.z) + 30, z.z);
  for (const [px, pz] of z.pads) addPad(px, pz);
  for (let k = 0; k < (G.extraPads || 0); k++) addPad(z.x + Math.cos(k * 2.4 + .6) * 8, z.z + Math.sin(k * 2.4 + .6) * 8);
  if (G.unlocked.length >= 5) spawnMerchant();
}
function addPad(px, pz){
  const f = world.freeSpot(px, pz), y = world.groundY(f.x, f.z), grp = new THREE.Group(); grp.position.set(f.x, y, f.z);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.15, .35, 20), new THREE.MeshStandardMaterial({ color: 0x3a3646, roughness: .8 })); base.position.y = .17; grp.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.85, .05, 8, 40), new THREE.MeshBasicMaterial({ color: 0x7cf7d4 })); ring.rotation.x = Math.PI / 2; ring.position.y = .38; grp.add(ring);
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture("🔨 E", "탑 짓기 · build"), transparent: true, depthWrite: false })); icon.position.y = 1.6; icon.scale.set(1.6, .8, 1); grp.add(icon);
  scene.add(grp); const p = { g: grp, x: f.x, z: f.z, y, icon }; fort.pads.push(p); return p;
}
function spawnMerchant(at){
  if (fort.merchant) return; const z = world.zones[G.zone], f = at || world.freeSpot(z.shop[0], z.shop[1]), y = world.groundY(f.x, f.z);
  const grp = new THREE.Group(); grp.position.set(f.x, y, f.z);
  const robe = new THREE.Mesh(new THREE.ConeGeometry(.55, 1.7, 14), new THREE.MeshStandardMaterial({ color: 0x5a2d6a, roughness: .8 })); robe.position.y = .85; grp.add(robe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.28, 14, 10), new THREE.MeshStandardMaterial({ color: 0x8ab89a })); head.position.y = 1.85; grp.add(head);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(.36, .6, 14), new THREE.MeshStandardMaterial({ color: 0x3a1d45 })); hood.position.y = 2.15; grp.add(hood);
  const lantern = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffcf5c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); lantern.position.set(.5, 1.3, .2); lantern.scale.set(.8, .8, 1); grp.add(lantern);
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture("🛒 E", "상인 · shop"), transparent: true, depthWrite: false })); sign.position.y = 3; sign.scale.set(1.6, .8, 1); grp.add(sign);
  scene.add(grp); fort.merchant = { g: grp, x: f.x, z: f.z, y };
  if (!G.quietBuild) objectiveFlash("🛒 상인이 왔어요! · A <b>merchant</b> set up shop at your fortification (E)");
}
function buildTower(pad, word){
  scene.remove(pad.g); fort.pads = fort.pads.filter(p => p !== pad);
  const grp = new THREE.Group(); grp.position.set(pad.x, pad.y, pad.z);
  const stone = new THREE.MeshStandardMaterial({ color: 0x4a4658, roughness: .85 });
  const b = new THREE.Mesh(new THREE.CylinderGeometry(.7, .9, .5, 8), stone); b.position.y = .25; grp.add(b);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(.35, .5, 2.6, 8), stone); col.position.y = 1.8; grp.add(col);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(.6, .35, .4, 8), stone); cup.position.y = 3.2; grp.add(cup);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.38), new THREE.MeshBasicMaterial({ color: 0x7cf7d4 })); crystal.position.y = 3.85; grp.add(crystal);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7cf7d4, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.y = 3.85; glow.scale.set(2, 2, 1); grp.add(glow);
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(word.kr, "E: 단어 바꾸기"), transparent: true, depthWrite: false })); sign.position.y = 5; sign.scale.set(2.2, 1.1, 1); grp.add(sign);
  scene.add(grp);
  const t = { g: grp, x: pad.x, z: pad.z, y: pad.y, word, crystal, glow, sign, cd: 0, crystalPos: new THREE.Vector3(pad.x, pad.y + 3.85, pad.z), idle: 0 };
  fort.towers.push(t); if (!G.quietBuild) { SFX.pickup(); burst(t.crystalPos.clone(), 0x7cf7d4, 50, 6); }
  return t;
}
function setTowerWord(t, w){ t.word = w; t.sign.material.map = signTexture(w.kr, "E: 단어 바꾸기"); t.sign.material.needsUpdate = true; SFX.select(); }
/* ---------- random events at a new site (the merchant is always there from 5 words) ---------- */
const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .7 });
const EVENTS = {
  engineer: { ko: "엔지니어", en: "Engineer: +1 tower pad at every site", cost: 400, icon: "🛠" },
  merc: { ko: "용병", en: "Mercenary: a walking tower that follows you", cost: 100, icon: "🗡" },
  deer: { ko: "얼음 사슴", en: "Ice deer: slowing aura + charges enemies", cost: 150, icon: "🦌" },
};
// TEST_EVENTS = true: every event shows up at EVERY site from wave 2 (for play-testing). false = the real
// balance: engineer from wave 3 (30 %), mercenary from wave 10 (35 %), deer waves 10–20 (30 %).
const TEST_EVENTS = false;
function rollEvents(){
  const w = G.wave, spots = [];
  if (TEST_EVENTS) {
    spots.push("engineer");
    if (G.mercs.length < 3) spots.push("merc");
    if (!G.deer) spots.push("deer");
    spots.forEach((k, i) => spawnEvent(k, i)); return;
  }
  if (w >= 3 && Math.random() < .3) spots.push("engineer");
  if (w >= 10 && G.mercs.length < 3 && Math.random() < .35) spots.push("merc");
  if (w >= 10 && w <= 20 && !G.deer && Math.random() < .3) spots.push("deer");
  spots.forEach((k, i) => spawnEvent(k, i));
}
function spawnEvent(kind, i = 0, at){
  const z = world.zones[G.zone], ang = 1.1 + i * 2.1, f = at || world.freeSpot(z.x + Math.cos(ang) * 9, z.z + Math.sin(ang) * 9), y = world.groundY(f.x, f.z);
  const grp = kind === "deer" ? deerMesh() : kind === "merc" ? mercMesh() : engineerMesh();
  grp.position.set(f.x, y, f.z);
  const E = EVENTS[kind];
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(E.icon + " E", `${E.ko} · 💰${E.cost}`), transparent: true, depthWrite: false })); sign.position.y = 3.2; sign.scale.set(1.8, .9, 1); grp.add(sign);
  scene.add(grp); fort.events.push({ kind, g: grp, x: f.x, z: f.z, y });
  if (!G.quietBuild) objectiveFlash(`${E.icon} 누군가 왔어요! · <b>${E.ko}</b> — ${E.en} (💰${E.cost}, E)`);
}
function useEvent(ev){
  if (isClient()) { coopAct({ a: "event", i: fort.events.indexOf(ev) }); return; }
  const E = EVENTS[ev.kind];
  if (G.coins < E.cost) { SFX.empty(); objectiveFlash(`💰 ${E.cost} 필요해요 · You need 💰${E.cost}`); return; }
  G.coins -= E.cost; SFX.pickup(); scene.remove(ev.g); fort.events = fort.events.filter(e => e !== ev);
  if (ev.kind === "engineer") { G.extraPads = (G.extraPads || 0) + 1; const z = world.zones[G.zone], k = G.extraPads - 1; addPad(z.x + Math.cos(k * 2.4 + .6) * 8, z.z + Math.sin(k * 2.4 + .6) * 8);
    objectiveFlash("🛠 탑 자리 +1 · One more tower pad — at every site from now on"); }
  if (ev.kind === "merc") { hireMerc(ev); objectiveFlash("🗡 용병 고용! · Mercenary hired — he follows you. Walk up + <b>E</b> to set his word."); }
  if (ev.kind === "deer") { adoptDeer(ev); objectiveFlash("🦌 얼음 사슴이 함께해요! · The ice deer joins you — enemies near it are slowed. Upgrade its aura at the merchant."); }
  renderTop();
}
function engineerMesh(){
  const g2 = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.32, .7, 4, 10), mat(0xd9731f)); body.position.y = 1.05; g2.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.26, 14, 10), mat(0xc9a27a)); head.position.y = 1.85; g2.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(.3, .32, .16, 16), mat(0xffd23f)); hat.position.y = 2.05; g2.add(hat);
  const wrench = new THREE.Mesh(new THREE.BoxGeometry(.08, .6, .08), mat(0x9aa0aa)); wrench.position.set(.42, 1.1, .1); wrench.rotation.z = .5; g2.add(wrench);
  return g2;
}
function mercMesh(){
  const g2 = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.3, .8, 4, 10), mat(0x2f5fa8)); body.position.y = 1.1; g2.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.25, 14, 10), mat(0xc9a27a)); head.position.y = 1.95; g2.add(head);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(.28, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x8a9ab8)); helm.position.y = 1.98; g2.add(helm);
  const gunM = new THREE.Mesh(new THREE.BoxGeometry(.1, .12, .7), mat(0x222733)); gunM.position.set(.3, 1.3, .35); g2.add(gunM);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7cf7d4 })); tip.position.set(.3, 1.3, .72); g2.add(tip);
  return g2;
}
function deerMesh(){
  const g2 = new THREE.Group(), ice = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: .3, metalness: .2, emissive: 0x3fa8ff, emissiveIntensity: .25 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.32, .9, 4, 10), ice); body.rotation.z = Math.PI / 2; body.position.y = 1.1; body.rotation.y = Math.PI / 2; g2.add(body);
  for (const [x, z] of [[-.18, .4], [.18, .4], [-.18, -.4], [.18, -.4]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(.06, .05, .9, 6), ice); l.position.set(x, .5, z); g2.add(l); }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(.1, .14, .6, 8), ice); neck.position.set(0, 1.45, .55); neck.rotation.x = .5; g2.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.18, 12, 8), ice); head.position.set(0, 1.75, .75); head.scale.set(1, .9, 1.4); g2.add(head);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const a = new THREE.Mesh(new THREE.CylinderGeometry(.02, .03, .45, 5), new THREE.MeshBasicMaterial({ color: 0xe8fbff })); a.position.set(s * (.12 + k * .07), 2.05 + k * .1, .7 - k * .05); a.rotation.z = s * (.4 + k * .3); g2.add(a); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9fdcff, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.y = 1.3; glow.scale.set(3, 3, 1); g2.add(glow);
  return g2;
}
function hireMerc(ev){
  const grp = mercMesh(); scene.add(grp);
  const word = G.loaded || G.unlocked[0];
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(word.kr, "E: 단어 바꾸기"), transparent: true, depthWrite: false })); sign.position.y = 2.9; sign.scale.set(2, 1, 1); grp.add(sign);
  G.mercs.push({ g: grp, x: ev.x, y: ev.y, z: ev.z, vy: 0, word, sign, cd: 0, idx: G.mercs.length });
}
function adoptDeer(ev){
  const grp = deerMesh(); scene.add(grp);
  const aura = new THREE.Mesh(new THREE.RingGeometry(7.4, 8, 56), new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false }));
  aura.rotation.x = -Math.PI / 2; aura.position.y = .06; grp.add(aura);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(7.4, 56), new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: .06, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2; fill.position.y = .05; grp.add(fill);
  G.deer = { g: grp, x: ev.x, y: ev.y, z: ev.z, vy: 0, cd: 2, charge: null, aura };
}
const deerSlow = () => .2 + .1 * ((G.up && G.up.deer) || 0);
G.speedMul = a => G.mode === "deer" ? ((a.frozenUntil || 0) > G.time ? .3 : 1) : (G.deer && Math.hypot(a.pos.x - G.deer.x, a.pos.z - G.deer.z) < 8) ? 1 - deerSlow() : 1;   // ❄️ frost traps / the ice deer's aura
function companionsTick(dt){
  const follow = (c, slot, maxSp) => {
    const dx = slot.x - c.x, dz = slot.z - c.z, d = Math.hypot(dx, dz);
    if (d > 26) { const f = world.freeSpot(slot.x, slot.z); c.x = f.x; c.z = f.z; c.y = world.groundY(f.x, f.z); return; }   // got lost: catch up
    if (d > .6) { const s = Math.min(d, Math.min(maxSp, 1.5 + d * 1.6) * dt); world.moveEntity(c, dx / d * s, dz / d * s, .4, dt); c.g.rotation.y = Math.atan2(dx, dz); }
  };
  // mercenaries: walk around you, shoot enemies wearing their word
  G.mercs.forEach((m, i) => {
    const ang = player.yaw + Math.PI + (i - 1) * .9;
    follow(m, { x: player.pos.x + Math.sin(ang) * 3, z: player.pos.z + Math.cos(ang) * 3 }, 8.5);
    m.g.position.set(m.x, m.y, m.z); m.cd -= dt;
    if (m.cd > 0) return;
    const from = new THREE.Vector3(m.x, m.y + 1.4, m.z); let best = null, bd = 20;
    for (const a of G.aliens) { if (a.dead || a.spawnT < 1 || !(a.special || (a.word && a.word.id === m.word.id))) continue;
      const d = a.pos.distanceTo(from); if (d < bd && world.losClear(from, a.aimPoint())) { bd = d; best = a; } }
    if (!best) { m.cd = .25; return; }
    m.cd = .8; m.g.rotation.y = Math.atan2(best.pos.x - m.x, best.pos.z - m.z);
    tracer(from, best.aimPoint(), 0x9fb8ff); burst(best.aimPoint(), 0x9fb8ff, 10, 4); best.stagger = best.special ? .05 : .12;
    if (best.damage(30)) onKill(best, true);
  });
  // the ice deer: follows you, charges an enemy every few seconds and knocks it back
  const D2 = G.deer; if (!D2) return;
  D2.aura.rotation.z += dt * .4; D2.aura.material.opacity = .25 + deerSlow() * .4;
  if (D2.charge) {
    const a = D2.charge.a; D2.charge.t += dt;
    if (a.dead || D2.charge.t > 1.2) D2.charge = null;
    else { const dx = a.pos.x - D2.x, dz = a.pos.z - D2.z, d = Math.hypot(dx, dz);
      if (d < 1.4) { world.moveEntity(a.pos, dx / d * 3.5, dz / d * 3.5, .45, 0); a.stagger = .9; burst(a.aimPoint(), 0xbfe8ff, 30, 6); SFX.dash(); D2.charge = null; }
      else { const s = Math.min(d, 14 * dt); world.moveEntity(D2, dx / d * s, dz / d * s, .4, dt); D2.g.rotation.y = Math.atan2(dx, dz); } }
  } else {
    const ang = player.yaw + Math.PI * .75;
    follow(D2, { x: player.pos.x + Math.sin(ang) * 2.6, z: player.pos.z + Math.cos(ang) * 2.6 }, 9);
    D2.cd -= dt;
    if (D2.cd <= 0) { let best = null, bd = 10; for (const a of G.aliens) { if (a.dead || a.spawnT < 1 || a.special) continue; const d = Math.hypot(a.pos.x - D2.x, a.pos.z - D2.z); if (d < bd) { bd = d; best = a; } }
      if (best) { D2.charge = { a: best, t: 0 }; D2.cd = 3.5; } else D2.cd = .4; }
  }
  D2.g.position.set(D2.x, D2.y, D2.z);
}
function towersTick(dt){
  for (const t of fort.towers) {
    const dm = G.mode === "deer", lv = t.lvl || 0;   // deer sanctuary: towers shoot anything but the boss, with the shared ammo
    t.crystal.rotation.y += dt * 2; t.cd -= dt;
    if (t.cd > 0) continue;
    let best = null, bd = dm ? (towerLv() >= 2 ? 26 : 22) : 22 + 3 * lv;
    for (const a of G.aliens) { if (a.dead || a.spawnT < 1 || (dm ? a.special : !(a.special || (a.word && a.word.id === t.word.id)))) continue;
      const d = a.pos.distanceTo(t.crystalPos); if (d < bd && world.losClear(t.crystalPos, a.aimPoint())) { bd = d; best = a; } }
    // no enemy with this tower's word in range: the crystal dims — time to change its word?
    const dry = dm && G.sanct.ammo <= 0;   // out of ammo: the crystal goes dark
    t.glow.material.opacity = best && !dry ? .7 : .15; t.crystal.material.color.setHex(dry ? 0x444455 : best ? 0x7cf7d4 : 0x3a6a60);
    if (!best || dry) { t.cd = .25; continue; }
    if (dm) G.sanct.ammo--;
    t.cd = dm ? .8 : .95 * Math.pow(.85, lv);
    tracer(t.crystalPos.clone(), best.aimPoint(), 0x7cf7d4); SFX.shotGood();
    const dmg = dm ? SANCT.towerDmg[towerLv()] : 34 * (1 + .5 * ((G.up && G.up.tower) || 0)) * (1 + .4 * lv); burst(best.aimPoint(), 0x7cf7d4, 12, 4); best.stagger = best.special ? .05 : .15;
    if (best.damage(dmg)) { if (dm) t.kills = (t.kills || 0) + 1; onKill(best, true); }
  }
}
// what can I interact with (E)?
function nearestInteract(){
  const near = (o, r) => o && Math.hypot(o.x - player.pos.x, o.z - player.pos.z) < r && Math.abs(o.y - player.feet) < 2;
  if (G.coop && partner.downed && !player.downed && near({ x: partner.pos.x, z: partner.pos.z, y: partner.feet }, 2.4)) return { kind: "revive", label: `E 꾹 누르기 · hold E to revive your partner ${Math.round((G.reviveT || 0) / 3 * 100)}%` };
  for (const t of fort.towers) if (near(t, 2.6)) return { kind: "tower", o: t, label: `E · 탑 단어 바꾸기 · change tower word (${esc(t.word.kr)})` };
  for (const p of fort.pads) if (near(p, 2.2)) return { kind: "pad", o: p, label: "E · 탑 짓기 — 퀴즈 · build a tower (quiz)" };
  if (near(fort.merchant, 2.6)) return { kind: "shop", o: fort.merchant, label: "E · 상인 · shop" };
  for (const ev of fort.events) if (near(ev, 2.8)) { const E = EVENTS[ev.kind]; return { kind: "event", o: ev, label: `E · ${E.icon} ${E.ko} — ${esc(E.en)} · 💰${E.cost}` }; }
  for (const m of G.mercs) if (near(m, 2.4)) return { kind: "tower", o: m, label: `E · 용병 단어 바꾸기 · mercenary word (${esc(m.word.kr)})` };
  return null;
}
// ---- panels on the paper (#note): tower quiz, tower word picker, shop. The world slows, it doesn't stop. ----
const CLOSABLE = new Set(["picker", "shop", "pedestal", "workshop", "lessons", "shelter"]), EXITABLE = new Set(["towerquiz", "ammoq", "trapq", "buildq", "lessonq", "trainq", "catq"]);
function openPanel(kind, head){
  G.noteOpen = true; G.panel = kind; G.timeScale = G.mode === "deer" ? .3 : .15; document.exitPointerLock && document.exitPointerLock();
  $("#note .nHead").textContent = head; $("#noteClose").hidden = !CLOSABLE.has(kind) && !EXITABLE.has(kind); $("#noteClose").textContent = EXITABLE.has(kind) ? "나가기 · Exit (Q)" : "닫기 · Close (Q)";
  $("#note").hidden = false; if (!liveCoop()) $("#vignette").classList.add("slow");
}
function closePanel(){ G.noteOpen = false; G.panel = null; G.timeScale = 1; Q = null; G.panelClosedAt = performance.now(); $("#note").hidden = true; $("#vignette").classList.remove("slow"); lock();
  // Esc can't re-capture the mouse (browsers ignore it as a click): show "click to play" instead of leaving you stuck
  setTimeout(() => { if (document.pointerLockElement !== renderer.domElement && G.running && !G.paused && !G.over && !G.noteOpen && !G.backpackOpen) $("#clickToPlay").hidden = false; }, 200); }
const justClosed = () => performance.now() - (G.panelClosedAt || 0) < 600;
function knownQuestion(w0, kinds = ["mean", "kr", "pos"]){   // one question about a word you own (w0, or a random one)
  const known = G.unlocked, w = w0 || pick(known);
  let kind = pick(kinds);
  // a word-type question only makes sense for a single word: expressions made of several words get "which Korean?" instead
  if (kind === "pos" && /\s/.test(w.kr.trim())) kind = "kr";
  if (kind === "mean") { const wrong = distinct(G.pool.filter(x => x.pos === w.pos), 3, meaning, [w]); while (wrong.length < 3) wrong.push(...distinct(G.pool, 3 - wrong.length, meaning, [w, ...wrong]));
    return { w, audio: true, prompt: `<b>${esc(w.kr)}</b> — 뜻은? <small>What does it mean?</small>`, opts: shuffleA([meaning(w), ...wrong.map(meaning)]), ans: meaning(w) }; }
  if (kind === "kr") { let wrong = distinct(known.filter(x => x.id !== w.id), 3, x => x.kr, [w]); if (wrong.length < 3) wrong = wrong.concat(distinct(G.pool, 3 - wrong.length, x => x.kr, [w, ...wrong]));
    return { w, prompt: `<b>${esc(meaning(w))}</b> — 한국어로? <small>Which Korean word?</small>`, opts: shuffleA([w.kr, ...wrong.map(x => x.kr)]), ans: w.kr, audioAfter: true }; }
  return { w, prompt: `<b>${esc(w.kr)}</b> — 품사는? <small>What type of word is it?</small>`, opts: POS_LIST, fixed: true, ans: POS_KO[w.pos] || "표현" };
}
function towerQuiz(pad){
  openPanel("towerquiz", "🔨 탑 짓기 퀴즈 · Build quiz");
  const known = G.unlocked, qs = [];
  for (let i = 0; i < 3; i++) {
    const w = pick(known), kind = pick(known.length > 1 ? ["mean", "kr", "pos"] : ["mean", "kr", "pos"]);
    if (kind === "mean") { const wrong = distinct(G.pool.filter(x => x.pos === w.pos), 3, meaning, [w]); while (wrong.length < 3) wrong.push(...distinct(G.pool, 3 - wrong.length, meaning, [w, ...wrong]));
      qs.push({ w, audio: true, prompt: `<b>${esc(w.kr)}</b> — 뜻은? <small>What does it mean?</small>`, opts: shuffleA([meaning(w), ...wrong.map(meaning)]), ans: meaning(w) }); }
    else if (kind === "kr") { let wrong = distinct(known.filter(x => x.id !== w.id), 3, x => x.kr, [w]); if (wrong.length < 3) wrong = wrong.concat(distinct(G.pool, 3 - wrong.length, x => x.kr, [w, ...wrong]));
      qs.push({ w, prompt: `<b>${esc(meaning(w))}</b> — 한국어로? <small>Which Korean word?</small>`, opts: shuffleA([w.kr, ...wrong.map(x => x.kr)]), ans: w.kr, audioAfter: true }); }
    else qs.push({ w, prompt: `<b>${esc(w.kr)}</b> — 품사는? <small>What type of word is it?</small>`, opts: POS_LIST, fixed: true, ans: POS_KO[w.pos] || "표현" });
  }
  Q = { qs, i: 0, wrong: 0, round: 1, lock: false, onPass: () => { closePanel();
    if (isClient()) { coopAct({ a: "build", i: fort.pads.indexOf(pad), w: (G.loaded || G.unlocked[0]).id }); objectiveFlash("🗼 탑 완성! · Tower built"); return; }
    const t = buildTower(pad, G.loaded || G.unlocked[0]);
    objectiveFlash(`🗼 탑 완성! · Tower built — it shoots enemies wearing <b>${esc(t.word.kr)}</b>. Walk up + <b>E</b> to change its word.`); } };
  renderQuiz();
}
function towerPicker(t){
  openPanel("picker", "🗼 탑 단어 · Tower word");
  G.pickerTower = t;
  $("#noteBody").innerHTML = `<div class="qPrompt">이 탑이 쏠 단어 · <small>Which word should this tower shoot?</small></div>
    <div class="qOpts">${G.unlocked.slice(0, 9).map((w, i) => `<button data-pick="${i}" class="${w.id === t.word.id ? "right" : ""}"><span class="k">${i + 1}</span>${esc(w.kr)}</button>`).join("")}</div>
    <div class="qMsg">숫자 키 또는 클릭 · keys or click</div>`;
}
const SHOP = [
  { id: "mag", ko: "탄창 확장", en: "Bigger magazine (+4)", max: 3, cost: l => 150 + l * 50 },
  { id: "reload", ko: "빠른 장전", en: "Faster reload (−35%)", max: 2, cost: l => 150 + l * 50 },
  { id: "pierce", ko: "관통탄", en: "Piercing shots — also hit 2 enemies behind with the same word", max: 1, cost: () => 200 },
  { id: "tower", ko: "탑 강화", en: "Towers +50% damage", max: 2, cost: l => 150 + l * 50 },
  { id: "deer", ko: "얼음 사슴 오라", en: "Ice deer aura: enemies +10% slower", max: 4, cost: () => 200, show: () => !!G.deer },
  { id: "nuke", ko: "말살", en: "Wipe-out (F): every enemy with your loaded word dies · 45 s cooldown · needs 30 words", max: 1, cost: () => 350, need: 30 },
];
const shopList = () => SHOP.filter(s => !s.show || s.show());
function openShop(){ openPanel("shop", "🛒 상인 · Merchant"); renderShop(); }
function renderShop(){
  $("#noteBody").innerHTML = `<div class="qHead">💰 ${G.coins} coins</div><div class="shop">${shopList().map((s, i) => { const l = G.up[s.id] || 0, maxed = l >= s.max, locked = s.need && G.unlocked.length < s.need;
    return `<button data-buy="${i}" ${maxed || locked ? "disabled" : ""}><span class="k">${i + 1}</span><b>${esc(s.ko)}</b> <small>${esc(s.en)}</small><span class="c">${maxed ? "MAX" : locked ? `🔒 ${s.need} words` : "💰 " + s.cost(l)}${s.max > 1 ? ` · Lv ${l}/${s.max}` : ""}</span></button>`; }).join("")}</div>`;
}
function buy(i){
  const s = shopList()[i]; if (!s) return; const l = G.up[s.id] || 0;
  if (isClient()) { if (G.coins < s.cost(l)) { SFX.empty(); objectiveFlash("💰 코인이 부족해요 · Not enough coins"); return; } coopAct({ a: "buy", id: s.id }); SFX.pickup(); return; }
  if (l >= s.max || (s.need && G.unlocked.length < s.need)) return;
  if (G.coins < s.cost(l)) { SFX.empty(); objectiveFlash("💰 코인이 부족해요 · Not enough coins"); return; }
  G.coins -= s.cost(l); G.up[s.id] = l + 1; SFX.pickup();
  if (s.id === "mag") { G.maxRounds = 6 + 4 * G.up.mag; G.rounds = G.maxRounds; renderAmmo(); }
  renderShop(); renderTop();
}
$("#noteBody").addEventListener("click", e => {
  const p = e.target.closest("[data-pick]"); if (p && G.panel === "picker") { pickWordFor(G.pickerTower, G.unlocked[+p.dataset.pick]); closePanel(); return; }
  const b = e.target.closest("[data-buy]"); if (b && G.panel === "shop") buy(+b.dataset.buy);
});
$("#noteBody").addEventListener("click", e => {   // deer sanctuary: 🔊 buttons, pedestal / workshop / lesson buttons
  const sb = e.target.closest("[data-say]"); if (sb && (G.panel === "brief" || G.panel === "lessoncard")) { say([wordClip(sb.dataset.say)], { interrupt: true }); return; }
  const ab = e.target.closest("[data-act]"); if (ab && !ab.disabled) deerAct(ab.dataset.act);
});
function nukeWord(){
  if (G.mode !== "fortress" || !G.up.nuke || G.nukeCd > 0 || !G.loaded) return;
  if (isClient()) { coopAct({ a: "nuke", w: G.loaded.id }); G.nukeCd = 45; return; }
  G.nukeCd = 45; G.shake = .8; SFX.slam();
  const v = $("#vignette"); v.style.boxShadow = "inset 0 0 300px 150px rgba(124,247,212,.7)"; setTimeout(() => v.style.boxShadow = "", 300);
  let n = 0; for (const a of G.aliens) if (!a.dead && !a.special && a.word && a.word.id === G.loaded.id) { burst(a.aimPoint(), 0x7cf7d4, 40, 8); a.damage(9999); onKill(a); n++; }
  objectiveFlash(`☄️ 말살! · Wipe-out: <b>${n}</b> × ${esc(G.loaded.kr)}`);
}
function startWave(){
  G.wave++; G.waveKills = 0; G.waveSpawned = 0; G.bossOut = false; G.calmT = 15; G.lastCalm = -1; G.spawnT = 3;   // 15 s to walk over + build before the first enemy
  G.waveSize = 50 + (G.wave - 1) * 2;   // 50, 52, 54 … ~250 at wave 100
  if (G.wave > 1) { setupZone(G.zone + 1); rollEvents(); }
  const z = world.zones[G.zone];
  objective(`🏰 Wave ${G.wave} — 요새로 가세요 · go to the fortification at <b>${z.ko}</b> (${z.en}) and build towers. ${G.waveSize} enemies, then the boss.`);
  setTimeout(() => { if (G.mode === "fortress" && G.running) objective(""); }, 7000);
  renderTop();
}
/* ---------- boss hounds 🐕 ---------- */
function makeHound(x, z){
  const f = world.freeSpot(x, z), y = world.groundY(f.x, f.z), grp = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x5a1a22, roughness: .6, emissive: 0x3a0610, emissiveIntensity: .3 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.26, .8, 4, 10), fur); body.rotation.x = Math.PI / 2; body.position.y = .75; grp.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.24, 12, 10), fur); head.position.set(0, .95, .62); grp.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(.18, .14, .3), fur); snout.position.set(0, .88, .86); grp.add(snout);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), eyeM); e.position.set(s * .1, 1.02, .8); grp.add(e);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(.07, .2, 6), fur); ear.position.set(s * .13, 1.18, .58); grp.add(ear); }
  const legs = [];
  for (const [lx, lz] of [[-.16, .38], [.16, .38], [-.16, -.38], [.16, -.38]]) { const p = new THREE.Group(); p.position.set(lx, .7, lz); grp.add(p);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(.06, .05, .7, 6), fur); l.position.y = -.35; p.add(l); legs.push(p); }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(.03, .05, .5, 6), fur); tail.position.set(0, .95, -.65); tail.rotation.x = -.8; grp.add(tail);
  const zzz = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture("💤", "10 s"), transparent: true, depthWrite: false })); zzz.position.y = 1.9; zzz.scale.set(1.2, .6, 1); zzz.visible = false; grp.add(zzz);
  grp.position.set(f.x, y, f.z); scene.add(grp);
  const h = { g: grp, x: f.x, y, z: f.z, vy: 0, hits: 0, sleepT: 0, cd: 2, path: null, repathT: 0, t: Math.random() * 5, legs, eyeM, zzz, body };
  body.userData.dog = h; head.userData.dog = h; h.hitMeshes = [body, head];
  return h;
}
function hitHound(h, point){
  if (h.sleepT > 0) return;
  h.hits++; burst(point, 0xffd23f, 10, 4); floater(point, `🐕 ${h.hits}/10`, "#ffd23f", 22, .9, "dog" + G.dogs.indexOf(h));
  if (h.hits >= 10) { h.sleepT = 10; h.hits = 0; h.zzz.visible = true; SFX.pickup(); objectiveFlash("💤 사냥개가 잠들었어요 · A hound is asleep for 10 s"); }
}
function houndsTick(dt){
  for (const h of G.dogs) {
    h.t += dt;
    if (h.sleepT > 0) {   // lying down, snoring
      h.sleepT -= dt; h.legs.forEach(l => l.rotation.x = 1.4); h.g.position.set(h.x, h.y - .35, h.z); h.eyeM.color.setHex(0x331010);
      h.zzz.position.y = 1.5 + Math.sin(h.t * 2) * .12;
      if (h.sleepT <= 0) { h.zzz.visible = false; h.eyeM.color.setHex(0xffd23f); objectiveFlash("🐕 사냥개가 깼어요! · A hound woke up"); }
      continue;
    }
    h.cd -= dt;
    const T = houndTarget(h), px = T.pos.x, pz = T.pos.z, dx = px - h.x, dz = pz - h.z, d = Math.hypot(dx, dz);
    // chase: straight if the ground allows, else the nav graph
    h.repathT -= dt;
    if (h.repathT <= 0) { h.repathT = .4; h.path = world.walkable(h.x, h.z, px, pz) ? null : world.findPath(h.x, h.z, px, pz); }
    let tx = px, tz = pz;
    if (h.path && h.path.length) { tx = h.path[0].x; tz = h.path[0].z; if (Math.hypot(tx - h.x, tz - h.z) < 1.2) h.path.shift(); }
    const mx = tx - h.x, mz = tz - h.z, md = Math.hypot(mx, mz);
    if (d > 1.1 && md > .05 && h.cd < 3) { const s = Math.min(md, 5.5 * dt); world.moveEntity(h, mx / md * s, mz / md * s, .35, dt); h.g.rotation.y = Math.atan2(mx, mz); }
    h.legs.forEach((l, i) => l.rotation.x = Math.sin(h.t * 16 + (i % 2 ? Math.PI : 0) + (i > 1 ? 1 : 0)) * .7);
    h.g.position.set(h.x, h.y + Math.abs(Math.sin(h.t * 16)) * .06, h.z);
    // bite!
    if (T === partner) { if (d < 1.4 && h.cd <= 0 && !partner.stuck && !partner.dashing && Math.abs(h.y - partner.feet) < 1.5) { partner.stuck = h; h.cd = 999; hurt(5, h.g.position, partner); fxOut({ bite: 1 }); } }
    else if (d < 1.4 && h.cd <= 0 && !G.noteOpen && !player.dashing && !player.downed && Math.abs(h.y - player.feet) < 1.5) biteQuiz(h);
  }
}
function biteQuiz(h){
  hurt(5, h.g.position); if (G.over) return;
  if (G.backpackOpen) closeBackpack(false);
  openPanel("bite", "🐕 물렸다! · Bitten — answer to break free");
  G.timeScale = 1; $("#vignette").classList.remove("slow");   // the world does NOT slow down: the boss keeps coming
  Q = { qs: [knownQuestion()], i: 0, wrong: 0, round: 1, lock: false, onPass: () => {
    closePanel(); for (const o of G.dogs) o.cd = Math.max(o.cd, 2); h.cd = 4;   // grace: no instant second bite from the other hound
    const dx = h.x - player.pos.x, dz = h.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
    world.moveEntity(h, dx / d * 3, dz / d * 3, .35, 0); objectiveFlash("🐕 벗어났어요! · Free — the hound backs off for 4 s"); } };
  renderQuiz();
}
function removeHounds(blast){ for (const h of G.dogs || []) { if (blast) burst(new THREE.Vector3(h.x, h.y + .8, h.z), 0xffd23f, 30, 6); scene.remove(h.g); } G.dogs = []; }
function bossKill(a){
  removeHounds(true); if (G.panel === "bite") closePanel();
  specialKill(a); clearFortifications(true); beam.visible = false; G.coins += 20; G.bossOut = false; G.waveActive = false;
  objective("💥 보스 처치! 탑도 무너졌어요 — 쪽지를 읽으세요 · Boss down — the blast wrecked your towers. Read the <b>note</b> 📜");
}
function fortressTick(dt, rdt){
  if (G.mode !== "fortress" || G.over) return;
  G.fortT += dt; G.nukeCd = Math.max(0, (G.nukeCd || 0) - dt);
  beam.material.opacity = .16 + Math.sin(G.time * 3) * .06;
  const client = isClient();
  if (!client) { towersTick(dt); companionsTick(dt); houndsTick(dt); }
  if (fort.merchant) fort.merchant.g.rotation.y += dt * .3;
  for (const p of fort.pads) p.icon.position.y = 1.6 + Math.sin(G.time * 2 + p.x) * .1;
  // interaction prompt
  const it = !G.noteOpen && !G.backpackOpen ? nearestInteract() : null;
  $("#interact").hidden = !it; if (it) $("#interact").innerHTML = it.label; G.interact = it;
  // arrow: the note if there is one, else the fortification when you're away from it
  const z = world.zones[G.zone], dz0 = Math.hypot(z.x - player.pos.x, z.z - player.pos.z);
  const tgt = G.note && !G.note.passed ? { x: G.note.s.position.x, z: G.note.s.position.z, label: "📜 쪽지 · read the note" } : dz0 > 18 ? { x: z.x, z: z.z, label: `🏰 ${z.ko} · ${z.en}` } : null;
  $("#radar").hidden = !tgt || G.backpackOpen || G.noteOpen;
  if (tgt) { const dx = tgt.x - player.pos.x, dzz = tgt.z - player.pos.z;
    $("#radarArrow").style.transform = `rotate(${Math.atan2(dx, -dzz) + player.yaw - Math.PI / 2}rad)`;
    $("#radarDist").textContent = Math.round(Math.hypot(dx, dzz)) + " m"; $("#radar small").textContent = tgt.label; }
  if (G.note && !G.note.passed) { G.note.t += rdt; G.note.s.position.y = G.note.y + Math.sin(G.note.t * 3) * .15;
    if (!G.noteOpen && Math.hypot(G.note.s.position.x - player.pos.x, G.note.s.position.z - player.pos.z) < 1.6) openNote(); }
  if (client || !G.waveActive) return;
  if (G.calmT > 0) { G.calmT -= dt; if (Math.floor(G.calmT) !== G.lastCalm) { G.lastCalm = Math.floor(G.calmT); renderTop(); } return; }
  // the boss after 50 kills
  if (G.waveKills >= G.waveSize && !G.bossOut) {
    G.bossOut = true;
    const nw = nextNewWord();
    const a = new Alien(scene, world.farSpot(player.pos.x, player.pos.z, 20, 36), nw, { rise: true, special: true, shirt: "?", hp: 900 + G.wave * 150, speed: 1.7, skills: { orb: false, slam: true } });
    a.id = "boss" + G.wave; a.pos.y = world.groundY(a.pos.x, a.pos.z); a.baseY = a.pos.y; G.aliens.push(a);
    G.dogs = [makeHound(a.pos.x + 2, a.pos.z + 2), makeHound(a.pos.x - 2, a.pos.z + 2)];
    objective("👑 보스 등장! + 🐕🐕 · The <b>boss</b> is here with two hounds — a bite = a quiz (you're stuck till you answer). Hounds can't die: hit one 10× and it sleeps for 10 s.");
    setTimeout(() => { if (G.mode === "fortress" && G.running) objective(""); }, 7000); SFX.charge(); renderTop();
  }
  const alive = G.aliens.filter(a => !a.dead).length, cap = Math.min(26, 8 + G.wave * 2 + G.unlocked.length);
  G.spawnT -= dt;
  if (G.spawnT <= 0 && alive < cap && G.waveSpawned < G.waveSize) {
    G.spawnT = Math.max(.5, 1.6 - G.wave * .08); G.waveSpawned++;
    const caster = G.wave >= 3 && Math.random() < .05 && G.aliens.filter(a => a.caster && !a.dead).length < 2;
    spawnAlienShirt(world.farSpot(player.pos.x, player.pos.z, 18, 40), nextWeakWord(), { rise: true, caster,   // close enough that the fortress is never quiet for long
      speed: caster ? 1.1 : Math.min(2.6, rnd(1.7, 2.3) + G.wave * .05), skills: caster ? { orb: true, slam: false } : { orb: false, slam: true } });
  }
}
function victory(){
  if (G.over || G.tut || G.aliens.some(a => !a.dead)) return;
  G.won = true; say([lineClip("clear")]); gameOver();
}

/* ================================ 🦌 deer sanctuary ================================ */
// Protect the baby ice deer at the back of a snowy valley. The aliens come through ONE gate and follow the
// glowing road. You can't get hurt and you have no gun: you build the defence out of quizzes.
//   🔨 tower spots → a tower (2 questions). Towers shoot EVERY alien but share one ammo supply.
//   💎 pedestal → ammo: 2 questions about ONE word (meaning, then word type) = +30 ammo. ~50 aliens a wave ≈ 5 quizzes.
//   🔧 workshop → a trap kit: 8 questions on this wave's 4 new words. Place it on the road (E). A trap kills what
//      steps on it (costs ammo) and is the ONLY thing that hurts the boss — towers can't.
//   🦌 the deer → lessons: words ONLY the deer knows (≥ 20 % of your words). Each lesson = the word card, 2 questions,
//      then a 단어 퇴마사 fight with every word you know. Most lessons unlock a technology (stronger traps/towers …).
// The deer grows with every word you know. Every wave still brings 4 forced new words (the card at the start).
const SANCT = { ammoQuiz: 30, trapCost: 4, trapRearm: 2.5, deerMax: 1000, towerDmg: [34, 54, 80], trapDmg: [100, 180, 320] };
const TECHS = [
  { id: "tower2", icon: "🗼", ko: "탑 강화 I", en: "Towers Lv 2: +60% damage" },
  { id: "trap2", icon: "🪤", ko: "함정 강화 I", en: "Traps Lv 2: re-arm twice as fast" },
  { id: "slot3", icon: "➕", ko: "함정 자리 +1", en: "+1 trap (3 on the road)" },
  { id: "battery", icon: "🔋", ko: "수정 배터리", en: "Every ammo quiz gives +50% ammo" },
  { id: "frost", icon: "❄️", ko: "얼음 함정", en: "A trap that fires also freezes aliens within 5 m for 3 s" },
  { id: "tower3", icon: "🗼", ko: "탑 강화 II", en: "Towers Lv 3: +50% damage, +4 m range", need: "tower2" },
  { id: "trap3", icon: "🪤", ko: "함정 강화 II", en: "Traps Lv 3: half the ammo per shot", need: "trap2" },
  { id: "slot4", icon: "➕", ko: "함정 자리 +1", en: "+1 trap (4 on the road)", need: "slot3" },
  { id: "pad5", icon: "🔨", ko: "다섯 번째 탑", en: "A 5th tower spot on the terrace" },
  { id: "slot5", icon: "➕", ko: "함정 자리 +1", en: "+1 trap (5 on the road)", need: "slot4" },
];
const has = id => !!(G.sanct && G.sanct.tech.has(id));
const towerLv = () => has("tower3") ? 2 : has("tower2") ? 1 : 0;
const trapLv = () => has("trap3") ? 2 : has("trap2") ? 1 : 0;
const trapCost = () => [4, 4, 2][trapLv()], trapRearm = () => [2.5, 1.25, 1.25][trapLv()];
const trapSlots = () => 2 + (has("slot3") ? 1 : 0) + (has("slot4") ? 1 : 0) + (has("slot5") ? 1 : 0);
// The deer grows in 10 stages spread over your word list (capped at 120 words), so a 20-word game and a 100-word game
// pace the same way. Each stage raises the herd limit; the hive's shield only drops at stage 8.
const targetWords = () => Math.max(10, Math.min(G.pool.length, 120));
const deerStage = () => Math.min(10, Math.floor(G.unlocked.length / (targetWords() / 10)));
// the deer army scales with the word list (100 words = the reference): 20 words ≈ a fifth of the herd, gate, camps
const armyScale = () => Math.max(.2, Math.min(1.2, targetWords() / 100));
const herdCap = () => Math.max(3, Math.round((6 + 6 * deerStage()) * armyScale()));
const SHIELD_STAGE = 8;
const gateShielded = () => deerStage() < SHIELD_STAGE;
const armySize = () => { const S = G.sanct; return S.herd.length + (isClient() ? (S.runnerMeshes || []).length : S.runners.length); };
const deerSize = () => .55 + .17 * deerStage();
const shortWord = w => w.kr.replace(/\s/g, "").length <= 7 && !/[?!_~…]/.test(w.kr);   // fits a 퇴마사 sticker
const bossHpFor = wave => Math.round(200 * Math.pow(1.45, wave - 1));
// every wave the aliens get tougher AND faster, so the towers / tech have to keep up
const ammoPerQuiz = () => Math.round(SANCT.ammoQuiz * Math.pow(1.12, G.wave - 1) * (has("battery") ? 1.5 : 1));   // grows with the waves (+12 %)
const alienHp = wave => Math.round(100 * Math.pow(1.15, wave - 1));                   // 100, 115, 132 … 352 at wave 10
const alienSpeed = wave => Math.min(3.4, rnd(1.5, 1.9) * Math.pow(1.05, wave - 1));   // +5 % a wave, max ≈ ×2
function deerStart(client = false){   // client = the co-op partner: same scene, but the host runs the game and sends the state
  const W = world, S = G.sanct = { hp: SANCT.deerMax, max: SANCT.deerMax, ammo: 20, kits: 0, traps: [], tech: new Set(), learned: [], techWord: {}, growWords: [],
    nextWaveT: 0, lastHit: -99, lastWarn: -99, lastAmmoWarn: -99, missionsT: 0, bossHp: 0,
    deerTgt: { pos: new THREE.Vector3(W.deer.x, W.deer.y + 1.7, W.deer.z), feet: W.deer.y, deer: true } };
  // words only the deer can teach: at least 20 % of the pool, short enough for the 퇴마사 stickers
  const shorts = client ? [] : shuffleA(G.pool.filter(shortWord)), n = Math.min(shorts.length, Math.max(2, Math.ceil(G.pool.length * .2)));   // 20 % of the list (a small list = fewer technologies)
  S.deerWords = shorts.slice(0, n); S.deerIds = new Set(S.deerWords.map(w => w.id));
  TECHS.forEach((t, i) => { if (S.deerWords[i]) S.techWord[t.id] = S.deerWords[i]; });
  S.growWords = S.deerWords.slice(TECHS.length);
  // the deer, the pedestal crystal, signs
  S.deerMesh = deerMesh(); S.deerMesh.position.set(W.deer.x, W.deer.y + .4, W.deer.z); scene.add(S.deerMesh); S.deerMesh.scale.setScalar(deerSize());
  const tag = (text, sub, x, y, z, sc = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(text, sub), transparent: true, depthWrite: false })); s.position.set(x, y, z); s.scale.set(1.8 * sc, .9 * sc, 1); scene.add(s); return s; };
  S.signs = [tag("🦌 E", "수업 · lessons", W.deer.x, W.deer.y + 4.6, W.deer.z), tag("💎 E", "탄약 · ammo", W.pedestal.x, W.pedestal.y + 3.6, W.pedestal.z), tag("🔧 E", "함정 · traps", W.workshop.x, W.workshop.y + 5.2, W.workshop.z), tag("🦌 E", "목장 · shelter", W.shelter.x, W.shelter.y + 6.4, W.shelter.z - 4)];
  // the attack lane: a herd that gathers at the shelter, and the hive's gate
  const gate = Math.max(8, Math.round(40 * armyScale()));
  Object.assign(S, { herd: [], runners: [], gateHp: gate, gateMax: gate, turretCd: 0, hiveBroken: false, cats: [], catKits: 0, boulders: [] });
  W.hive.membrane.opacity = .55; W.hive.gate.rotation.x = 0; W.hive.gate.position.y = 0;
  S.gateSign = tag(`🚪 ${gate}/${gate}`, "외계인 둥지 · hive gate", W.hive.x, 9.5, W.hive.z - .5, 1.8); S.signs.push(S.gateSign);
  // a pink pillar over the hive: the goal, visible from the sanctuary
  S.hiveBeam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 80, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  S.hiveBeam.position.set(W.hive.x, 40, W.hive.z + 3); scene.add(S.hiveBeam); S.signs.push(S.hiveBeam);
  // 🛡 the hive's shield: a glowing bubble over the gate until the deer is big enough
  S.shield = new THREE.Mesh(new THREE.SphereGeometry(6.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: .25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  S.shield.position.set(W.hive.x, 0, W.hive.z); scene.add(S.shield); S.signs.push(S.shield);
  // 🏕 enemy camps on the gold road: conquered by a march with more deer than defenders (they refill every 30 s)
  S.camps = CAMPS.map(([wp, n, gold]) => makeCamp(wp, n, gold)); S.camps.forEach(c => S.signs.push(c.g)); S.marchT = 30;
  S.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.36), new THREE.MeshBasicMaterial({ color: 0xc9a2ff })); S.crystal.position.set(W.pedestal.x, W.pedestal.y + 2.4, W.pedestal.z); scene.add(S.crystal);
  S.crystalGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb388ff, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending })); S.crystalGlow.scale.set(2, 2, 1); S.crystal.add(S.crystalGlow);
  S.trapBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 60, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  S.trapBeam.position.set(W.workshop.x, W.workshop.y + 30, W.workshop.z); S.trapBeam.visible = false; scene.add(S.trapBeam);
  if (client) { S.briefWave = 0; S.runnerMeshes = []; return; }
  for (const [x, z] of W.pads.slice(0, 4)) addPad(x, z);
  deerWave();
}
function deerWave(){
  const S = G.sanct, fresh = [];
  for (let i = 0; i < 4; i++) { const w = nextNewWord(); if (!w) break; G.unlocked.push(w); G.newIds.add(w.id); markKill(w); fresh.push(w); }
  if (!fresh.length && S.deerWords.every(w => G.unlocked.includes(w))) { G.won = true; say([lineClip("clear")]); gameOver(); return; }   // every word known
  G.wave++; if (fresh.length) G.waveWords = fresh;
  G.waveKills = 0; G.waveSpawned = 0; G.bossOut = false; G.waveSize = 45 + 3 * G.wave; G.calmT = G.wave === 1 ? 35 : 20; G.lastCalm = -1; G.spawnT = 2;
  S.bossHp = bossHpFor(G.wave); S.hp = Math.min(S.max, S.hp + 200);
  growDeer(); renderHP();
  if (G.wave === WEST_GATE_WAVE) setTimeout(() => { if (G.mode === "deer" && G.running) helperShow("⚠️ 서쪽 문이 열렸어요! <small>A second gate opened in the <b>west</b> — some aliens now take a shorter road that joins the main road halfway.</small>", 10); }, 1500);
  if (fresh.length) openBrief(fresh); else objectiveFlash("📚 새 웨이브 단어가 없어요 — 사슴에게 배우세요 · No new wave words left — learn the rest from the deer");
  renderTop(); renderMissions();
}
function openBrief(words){
  Q = null; openPanel("brief", `🦌 Wave ${G.wave} — 새 단어 · ${words.length} new words`); G.timeScale = 0;
  $("#noteBody").innerHTML = `<div class="brief">${words.map((w, i) => `<div class="bRow"><span class="k">${i + 1}</span><div class="bKr"><b class="${w.kr.length > 9 ? "long" : ""}">${esc(w.kr)}</b><button data-say="${w.id}">🔊</button></div><small>${POS_KO[w.pos] || ""} · ${CAT[w.cat].icon}</small><span class="m">${esc(meaning(w))}</span></div>`).join("")}</div>
    <div class="nHint">잘 외우세요! 이번 웨이브의 모든 퀴즈에 나와요 · Learn these — this wave's quizzes use them.<br>
    💎 탄약 = 문제 2개 · ammo: 2 questions at the pedestal · 🔧 함정 = 문제 8개 (이 4단어) · a trap: 8 questions on these 4 words<br>
    👑 웨이브 끝에 보스와 결투: 이 4단어! · at the end of the wave the boss duels you on these 4 words · 🦌 사슴의 수업 = new technology</div>`;
  $("#noteClose").hidden = false; $("#noteClose").textContent = "시작 · Start (E)";
  say(words.map(w => wordClip(w.id)));
}
function closeBrief(){
  closePanel();
  objective(`🦌 Wave ${G.wave}: ${G.waveSize} aliens, then a 👑 boss duel on these words`);
  setTimeout(() => { if (G.mode === "deer" && G.running && G.panel !== "brief") objective(""); }, 7000);
}
function growDeer(){
  const S = G.sanct; if (!S || !S.deerMesh) return;
  const st = deerStage(); S.deerMesh.scale.setScalar(deerSize());
  if (S.stage != null && st > S.stage) {
    SFX.pickup(); burst(S.deerMesh.position.clone().setY(S.deerMesh.position.y + 2), 0x9fdcff, 120, 10);
    floater(S.deerMesh.position.clone().setY(S.deerMesh.position.y + 4), `🦌 Lv ${st}`, "#9fdcff", 40, 2);
    helperShow(`🦌 사슴이 자랐어요! <small>The deer grew — stage <b>${st}/10</b> · herd limit <b>${herdCap()}</b>${st === SHIELD_STAGE ? " · 🛡 the hive's shield is DOWN — charge!" : ""}</small>`, 7);   // Lumi says it (the objective line is often busy)
  }
  if (st !== S.stage && S.signs && S.signs[0]) { const old = S.signs[0].material.map; S.signs[0].material.map = signTexture("🦌 E", `Lv ${st}/10 · 수업`); S.signs[0].material.needsUpdate = true; old.dispose(); }
  S.stage = st;
}
// ---- quizzes ----
function pickQuizWord(){   // 60 % this wave's words, else older ones (struggled-with first)
  const older = G.unlocked.filter(w => !G.waveWords.includes(w));
  const cands = older.length && Math.random() < .4 ? older : G.waveWords.length ? G.waveWords : G.unlocked;
  const wts = cands.map(w => { const st = stats[w.id]; return st ? Math.max(.4, 1 + st.w * 1.2 - st.r * .25) : 1.2; });
  let r = Math.random() * wts.reduce((a, b) => a + b, 0);
  for (let k = 0; k < cands.length; k++) { r -= wts[k]; if (r <= 0) return cands[k]; }
  return cands[0];
}
const twoQ = w => [knownQuestion(w, ["mean"]), knownQuestion(w, ["pos"])];   // the meaning, then the word type — same word
function deerQuiz(kind, head, qs, onPass){
  openPanel(kind, head);
  Q = { qs, i: 0, wrong: 0, round: 1, lock: false, onPass: () => { closePanel(); onPass(); } };
  renderQuiz();
}
// ---- pedestal: ammo ----
function openPedestal(){ openPanel("pedestal", "💎 수정 받침대 · Pedestal"); renderPedestal(); }
function renderPedestal(){
  const S = G.sanct, per = ammoPerQuiz(), left = Math.max(0, G.waveSize - G.waveKills), need = left * Math.ceil(alienHp(G.wave) / SANCT.towerDmg[towerLv()]);
  $("#noteBody").innerHTML = `<div class="qHead">💎 탄약 · Ammo: <b>${S.ammo}</b> ${S.ammo < need ? `· ⚠ ~${need} needed for ${left} aliens` : "· ✓ enough for now"}</div>
    <div class="dList">${fort.towers.map((t, i) => `<div>🗼 ${i + 1} · Lv ${towerLv() + 1} · ${t.kills || 0} kills</div>`).join("") || "<div>🔨 탑이 없어요 · no towers yet — E at a 🔨 spot</div>"}
    <div>🪤 ${S.traps.length}/${trapSlots()} traps on the road${S.kits ? ` · 📦 ${S.kits} kit${S.kits > 1 ? "s" : ""} to place` : ""} · each shot = ${trapCost()} ammo</div></div>
    <div class="shop" style="margin-top:10px"><button data-act="ammo"><span class="k">1</span><b>탄약 만들기 · Make ammo</b> <small>2 questions about one word (meaning, word type)</small><span class="c">+${per}</span></button></div>`;
}
function ammoQuiz(){
  const w = pickQuizWord();
  deerQuiz("ammoq", "💎 탄약 퀴즈 · Ammo quiz", twoQ(w), () => {
    const S = G.sanct, add = ammoPerQuiz(); SFX.pickup();
    if (isClient()) { coopAct({ a: "ammo" }); objectiveFlash(`💎 +${add} 탄약 · ammo`); openPedestal(); return; }
    S.ammo += add;
    burst(S.crystal.position.clone(), 0xb388ff, 50, 6); objectiveFlash(`💎 +${add} 탄약 · ammo (${S.ammo})`); openPedestal(); });
}
// ---- workshop: traps ----
function openWorkshop(){ openPanel("workshop", "🔧 작업장 · Workshop"); renderWorkshop(); }
function renderWorkshop(){
  const S = G.sanct, full = S.traps.length + S.kits >= trapSlots();
  $("#noteBody").innerHTML = `<div class="qHead">🪤 ${S.traps.length}/${trapSlots()} on the road${S.kits ? ` · 📦 ${S.kits} to place` : ""} · Lv ${trapLv() + 1}${has("frost") ? " · ❄️ freezes" : ""}</div>
    <div class="dList"><div>🪤 −${trapHit()} to every alien on it (💎 ${trapCost()}), re-arms in ${trapRearm()} s · 🎯 catapults: ${S.cats.length}${S.catKits ? ` · 📦 ${S.catKits} to place` : ""} — splash −${Math.round(catDmg())}, 💎 ${CATA.ammo} per shot</div></div>
    <div class="shop" style="margin-top:10px"><button data-act="trap" ${full ? "disabled" : ""}><span class="k">1</span><b>함정 만들기 · Build a trap</b> <small>8 questions on this wave's 4 new words</small><span class="c">${full ? "FULL" : "🪤 +1"}</span></button>
    <button data-act="cat"><span class="k">2</span><b>투석기 · Catapult</b> <small>5 questions · place it off the road, aim at the road</small><span class="c">🎯 +1</span></button></div>`;
}
function trapQuiz(){
  const S = G.sanct; if (S.traps.length + S.kits >= trapSlots()) return;
  const ws = G.waveWords.length ? G.waveWords : G.unlocked.slice(-4), qs = [];
  for (const w of ws) qs.push(knownQuestion(w, ["mean"]), knownQuestion(w, ["kr"]));
  while (qs.length < 8) qs.push(knownQuestion(pick(ws), ["pos"]));
  deerQuiz("trapq", "🔧 함정 퀴즈 · Trap quiz (8)", shuffleA(qs).slice(0, 8), () => {
    if (isClient()) coopAct({ a: "kit" }); else S.kits++;
    SFX.pickup(); objectiveFlash("📦 함정 완성! · Trap ready — walk onto the glowing road and press <b>E</b> to place it"); renderMissions(); });
}
function placeTrap(at){
  const S = G.sanct; if (!S.kits) return;
  const x = at ? at.x : player.pos.x, z = at ? at.z : player.pos.z;
  if (isClient()) { coopAct({ a: "place", x: r2(x), z: r2(z) }); SFX.reload(); objectiveFlash("🪤 함정 설치! · Trap placed"); return; }
  S.traps.push(makeTrap(x, z)); S.kits--;
  SFX.reload(); objectiveFlash(`🪤 함정 설치! · Trap placed (${S.traps.length}/${trapSlots()})`); renderMissions();
}
function makeTrap(x, z){
  const y = world.groundY(x, z), grp = new THREE.Group(); grp.position.set(x, y + .02, z);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, .12, 20), new THREE.MeshStandardMaterial({ color: 0x3a4458, roughness: .5, metalness: .6 })); plate.position.y = .06; grp.add(plate);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, .05, 8, 36), new THREE.MeshBasicMaterial({ color: 0xff9a3a })); ring.rotation.x = Math.PI / 2; ring.position.y = .14; grp.add(ring);
  const spikes = new THREE.Group(); grp.add(spikes);
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, r = i ? .6 : 0, c = new THREE.Mesh(new THREE.ConeGeometry(.12, .7, 6), new THREE.MeshStandardMaterial({ color: 0xd8e2f0, metalness: .8, roughness: .3 })); c.position.set(Math.cos(a) * r, .35, Math.sin(a) * r); spikes.add(c); }
  spikes.position.y = -.5;
  scene.add(grp); return { g: grp, x, y, z, ring, spikes, cd: 0, pop: 0 };
}
function pickUpTrap(t){ const S = G.sanct;
  if (isClient()) { coopAct({ a: "pick", i: S.traps.indexOf(t) }); SFX.select(); return; } scene.remove(t.g); S.traps = S.traps.filter(x => x !== t); S.kits++; SFX.select(); objectiveFlash("📦 함정을 들었어요 · Trap picked up — E on the road to place it again"); renderMissions(); }
function trapsTick(dt){
  const S = G.sanct;
  for (const t of S.traps) {
    t.cd -= dt; t.pop = Math.max(0, t.pop - dt * 2.5); t.spikes.position.y = -.5 + .55 * Math.min(1, t.pop * 2);
    t.ring.material.color.setHex(t.cd > 0 ? 0x5a4a3a : S.ammo < trapCost() ? 0x884444 : 0xff9a3a);
    if (t.cd > 0) continue;
    const victims = G.aliens.filter(a => !a.dead && a.spawnT >= 1 && Math.hypot(a.pos.x - t.x, a.pos.z - t.z) < (a.special ? 2.6 : 2) && Math.abs(a.pos.y - t.y) < 1.5);
    if (!victims.length) continue;
    if (S.ammo < trapCost()) { if (G.time - S.lastAmmoWarn > 6) { S.lastAmmoWarn = G.time; objectiveFlash("⚠️ 함정에 탄약이 없어요! · A trap has no ammo — make ammo at the 💎 pedestal"); } continue; }
    S.ammo -= trapCost(); t.cd = trapRearm(); t.pop = 1; SFX.slam(); G.shake = Math.max(G.shake, player.pos.distanceTo(t.g.position) < 20 ? .3 : 0);
    burst(new THREE.Vector3(t.x, t.y + .6, t.z), 0xff9a3a, 40, 7); fxOut({ b: [t.x, t.y + .6, t.z, 0xff9a3a] });
    for (const a of victims) {
      if (a.special) { const dmg = SANCT.trapDmg[trapLv()]; floater(a.aimPoint(), `👑 −${dmg}`, "#ff9a3a", 32, 1.2); a.stagger = .5; if (a.damage(dmg)) onKill(a, true); }
      else { const dmg = trapHit(); floater(a.aimPoint(), `-${dmg}`, "#ff9a3a", 24, .8); a.stagger = .4; if (a.damage(dmg)) onKill(a, true); }   // no more one-hit kills
    }
    if (has("frost")) { for (const a of G.aliens) if (!a.dead && Math.hypot(a.pos.x - t.x, a.pos.z - t.z) < 5) a.frozenUntil = G.time + 3; burst(new THREE.Vector3(t.x, t.y + .4, t.z), 0x9fdcff, 40, 8); }
  }
}
// ---- the deer's lessons ----
function lessonOptions(){
  const S = G.sanct, out = [];
  for (const t of TECHS) { const w = S.techWord[t.id]; if (!w || S.tech.has(t.id) || (t.need && !S.tech.has(t.need))) continue; out.push({ tech: t, w }); }
  const g = S.growWords.find(w => !G.unlocked.includes(w));
  return [...out.slice(0, g ? 5 : 6), ...(g ? [{ tech: null, w: g }] : [])];   // the free "just grow" lesson is always on the list
}
function openLessons(){ openPanel("lessons", "🦌 사슴의 수업 · The deer's lessons"); renderLessons(); }
function renderLessons(){
  const S = G.sanct, opts = lessonOptions(); G.lessonOpts = opts;
  $("#noteBody").innerHTML = `<div class="qHead">🦌 stage ${deerStage()}/10 · ${G.unlocked.length}/${targetWords()} words · ${S.learned.length} lessons · 💰 ${G.coins} (1 per alien)</div>
    <div class="qPrompt"><small>새 단어 하나 + 문제 2개 + 퇴마사 한 판 (아는 단어 모두) · one new word, 2 questions, then a 퇴마사 fight with every word you know. Q = quit anytime.</small></div>
    <div class="shop">${opts.map((o, i) => `<button data-act="lesson${i}" ${o.tech && G.coins < techCost() ? "disabled" : ""}><span class="k">${i + 1}</span><b>${o.tech ? `${o.tech.icon} ${esc(o.tech.ko)}` : "🌱 그냥 자라기 · just grow"}</b> <small>${o.tech ? esc(o.tech.en) + " — " : ""}must know <b>${esc(o.w.kr)}</b></small><span class="c">${o.tech ? "💰 " + techCost() : "free"}</span></button>`).join("") || "<div>🎓 사슴이 가르칠 게 없어요 · the deer has taught you everything!</div>"}</div>`;
}
function lessonCard(o){
  openPanel("lessoncard", "🦌 새 단어 · A word from the deer"); G.lesson = o; const w = o.w, C = CAT[w.cat];
  $("#noteBody").innerHTML = `<div class="nKr">${esc(w.kr)} <button data-say="${w.id}">🔊</button></div><div class="nMean">${esc(meaning(w))}</div>
    <div class="nTags"><span>${POS_KO[w.pos]}</span><span>${C.icon} ${esc(C.ko)} · ${esc(C.en)}</span></div>${w.ex ? `<div class="nEx">${esc(w.ex)}${w.exEn ? `<small>${esc(w.exEn)}</small>` : ""}</div>` : ""}
    <div class="nHint">${o.tech ? `${o.tech.icon} <b>${esc(o.tech.ko)}</b> — ${esc(o.tech.en)}` : "🌱 사슴이 자라요 · the deer grows"} · 퀴즈 2개, 그다음 퇴마사 · 2 questions, then the 퇴마사 fight</div>`;
  $("#noteClose").hidden = false; $("#noteClose").textContent = "퀴즈 시작 · Start (E)";
  say([wordClip(w.id)], { interrupt: true });
}
function lessonQuiz(){ const o = G.lesson; if (!o) return; deerQuiz("lessonq", "🦌 수업 퀴즈 · Lesson quiz", twoQ(o.w), () => openDemon(o)); }
const shortMeaning = s => { let t = String(s || "").replace(/\s*[（(][^()（）]*[)）]/g, "").trim() || String(s || ""); t = t.split(/\s*[;；]\s*/)[0]; return t.length > 40 ? t.slice(0, 38) + "…" : t; };
function openDemon(o){
  closePanel(); G.noteOpen = true; G.panel = "demon"; G.timeScale = .3; document.exitPointerLock && document.exitPointerLock();
  const bank = G.pool.filter(shortWord), idx = new Map(bank.map((w, i) => [w.id, i]));
  const cards = bank.map(w => [w.kr, { [settings.lang]: shortMeaning(meaning(w)), en: shortMeaning(w.m.en) }, 0, "x"]);
  const play = G.unlocked.filter(w => idx.has(w.id) && w.id !== o.w.id).map(w => idx.get(w.id));
  const f = document.createElement("iframe"); f.id = "lessonFrame"; f.src = "demon-lesson.html"; document.body.appendChild(f); G.demon = { f, o, data: { type: "lesson", cards, play, newIdx: idx.get(o.w.id), lang: settings.lang } };
  f.addEventListener("load", () => { try { f.contentWindow.focus(); } catch (e) {} });
}
function closeDemon(){ if (G.demon) { G.demon.f.remove(); G.demon = null; } G.noPauseUntil = performance.now() + 2500; G.wasLocked = false; G.noteOpen = false; G.panel = null; G.timeScale = 1; G.panelClosedAt = performance.now(); $("#clickToPlay").hidden = false; }
addEventListener("message", e => {
  const d = e.data; if (!d || d.from !== "demon-lesson" || !G.demon || e.source !== G.demon.f.contentWindow) return;
  if (d.type === "ready") { G.demon.f.contentWindow.postMessage(G.demon.data, "*"); try { G.demon.f.contentWindow.focus(); } catch (err) {} return; }
  const o = G.demon.o; closeDemon();
  if (d.type === "win") { if (isClient()) { coopAct({ a: "learn", w: o.w.id, t: o.tech ? o.tech.id : "" }); objective(`🎓 <b>${esc(o.w.kr)}</b> = ${esc(meaning(o.w))}${o.tech ? ` · ${o.tech.icon} ${esc(o.tech.ko)}` : ""}`); setTimeout(() => objective(""), 6000); } else learnDeerWord(o); }
  else if (d.type === "lose") objectiveFlash("😵 퇴마사에게 졌어요 · The demon won — try the lesson again");
  else objectiveFlash("🦌 수업을 그만뒀어요 · Lesson stopped — come back any time");
});
function learnDeerWord(o){
  const S = G.sanct, w = o.w; if (G.unlocked.includes(w)) return;
  G.unlocked.push(w); markKill(w); S.learned.push(w.id);
  if (o.tech) { G.coins = Math.max(0, G.coins - techCost()); applyTech(o.tech); }   // paid when the lesson succeeds
  growDeer(); SFX.pickup(); burst(S.deerMesh.position.clone().setY(S.deerMesh.position.y + 1.5), 0x9fdcff, 90, 8);
  floater(S.deerMesh.position.clone().setY(S.deerMesh.position.y + 3), "🦌 +1", "#9fdcff", 34, 1.6);
  objective(`🎓 <b>${esc(w.kr)}</b> = ${esc(meaning(w))} · ${o.tech ? `${o.tech.icon} ${esc(o.tech.ko)} unlocked — ${esc(o.tech.en)}` : "🌱 the deer grew"}`);
  setTimeout(() => { if (G.mode === "deer" && G.running) objective(""); }, 7000); renderMissions(); renderTop();
}
function applyTech(t){
  const S = G.sanct; S.tech.add(t.id);
  if (t.id === "pad5") addPad(world.pads[4][0], world.pads[4][1]);
  for (const tw of fort.towers) towerSignDeer(tw);
}
// ---- towers (shared ammo, shoot anything but the boss) ----
function towerSignDeer(t){ const old = t.sign.material.map; t.sign.material.map = signTexture("🗼", `Lv ${towerLv() + 1}`); t.sign.material.needsUpdate = true; if (old && old !== t.sign.material.map) old.dispose(); }
function deerBuildTower(pad){ const t = buildTower(pad, G.waveWords[0] || G.unlocked[0]); t.kills = 0; towerSignDeer(t); objectiveFlash("🗼 탑 완성! · Tower built — it shoots every alien, using the shared 💎 ammo"); renderMissions(); return t; }
// ---- aliens: follow the road, then go for the deer ----
function deerTarget(a){
  const S = G.sanct, R = a.route || world.road; if (!S) return player;   // west-gate aliens follow their own road
  if (a.wp == null) a.wp = 1;
  while (a.wp < R.length && Math.hypot(R[a.wp].x - a.pos.x, R[a.wp].z - a.pos.z) < 3.8) a.wp++;
  if (a.wp >= R.length) return S.deerTgt;
  const p = R[a.wp]; a.wpT = a.wpT || { pos: new THREE.Vector3(), feet: 0 }; a.wpT.pos.set(p.x, p.y + 1.7, p.z); a.wpT.feet = p.y; return a.wpT;
}
function deerSlam(center, r, a){
  const S = G.sanct; if (!S || G.over) return;
  SFX.slam(); burst(center.clone().setY(center.y + .2), 0xff2244, 30, 6);
  if (Math.hypot(world.deer.x - center.x, world.deer.z - center.z) > r + 2.5) return;
  const dmg = a.special ? 250 : 25; S.hp = Math.max(0, S.hp - dmg); S.lastHit = G.time; renderHP();
  if (player.pos.distanceTo(center) < 16) G.shake = .35;
  burst(S.deerMesh.position.clone().setY(S.deerMesh.position.y + 1.2), 0x9fdcff, 30, 6); floater(S.deerMesh.position.clone().setY(S.deerMesh.position.y + 2.5), `−${dmg}`, "#ff6b8a", 28, 1);
  if (G.time - S.lastWarn > 6) { S.lastWarn = G.time; objectiveFlash("🚨 사슴이 공격받고 있어요! · The deer is being attacked!"); }
  if (S.hp <= 0) { gameOver(); return; }
  if (a.special) {   // the boss hits once, then goes back to the gate and walks the road (and your traps) again
    const [ex, ez] = world.entries[0]; a.pos.set(ex, 0, ez); a.baseY = 0; a.spawnT = 0; a.wp = 1; a.state = "walk";
    objectiveFlash("👑 보스가 문으로 돌아갔어요 — 함정을 더! · The boss went back to the gate — more traps before it returns!");
  } else { a.die(); a.removeT = .6; G.waveKills++; }   // a normal alien leaks: one hit, then it's gone
}
function deerBossKill(a){
  const S = G.sanct; G.shake = 1.2; SFX.slam(); SFX.kill();
  const v = $("#vignette"); v.style.boxShadow = "inset 0 0 400px 200px rgba(200,235,255,.8)"; setTimeout(() => v.style.boxShadow = "", 350);
  for (let i = 0; i < 4; i++) burst(a.aimPoint(), [0x9fdcff, 0xffffff, 0xff9a3a, 0x7cf7d4][i], 120, 16 + i * 4);
  for (const o of G.aliens) if (!o.dead && o !== a) { burst(o.aimPoint(), 0x9fdcff, 30, 7); o.die(); G.kills++; }
  G.bossOut = false; S.nextWaveT = 4; G.coins += 20;
  objective("💥 보스 처치! · Boss down — the next wave brings 4 new words"); renderTop();
}
function spawnDeerBoss(){
  const S = G.sanct; G.bossOut = true; const [ex, ez] = world.entries[0], f = world.freeSpot(ex, ez);
  const a = new Alien(scene, new THREE.Vector3(f.x, world.groundY(f.x, f.z), f.z), pick(G.unlocked), { rise: true, special: true, shirt: "👑", hp: S.bossHp, speed: 2.4, skills: { orb: false, slam: true } });
  a.id = "boss" + G.wave; G.aliens.push(a);
  objective(`👑 보스 등장! · The <b>boss</b> is coming (❤ ${S.bossHp}) — towers can't hurt it, only your 🪤 traps (−${SANCT.trapDmg[trapLv()]} each)`);
  setTimeout(() => { if (G.mode === "deer" && G.running && G.bossOut) objective(""); }, 8000);
  SFX.charge(); renderTop(); renderMissions();
}
// ---- 👑 the boss duel: the boss pulls you (and your partner) onto floating platforms. A plain gun; the boss shows a word,
// you shoot the right answer among 4 panels. 4 questions each (this wave's words). Wrong = your TEAMMATE gets zapped
// (just for fun; solo: you) and you redo it. Both done = the boss is beaten. Nobody can lose here.
const DUEL = { y: 40, z: 0, left: 21, right: 29, bossZ: 27 };
function textTex(main, sub, w = 1024, h = 256, bg = "rgba(8,16,30,.85)", fg = "#e9fffa"){
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g2 = c.getContext("2d");
  g2.fillStyle = bg; g2.beginPath(); g2.roundRect(6, 6, w - 12, h - 12, 28); g2.fill(); g2.strokeStyle = "#7ce8ff"; g2.lineWidth = 8; g2.stroke();
  g2.fillStyle = fg; g2.textAlign = "center"; g2.textBaseline = "middle";
  let fs2 = Math.round(h * (sub ? .42 : .5)); const font = () => g2.font = `900 ${fs2}px "Malgun Gothic", sans-serif`; font();
  while (g2.measureText(main).width > w - 60 && fs2 > 20) { fs2 -= 4; font(); }
  g2.fillText(main, w / 2, sub ? h * .42 : h / 2);
  if (sub) { g2.font = `${Math.round(h * .16)}px "Malgun Gothic", sans-serif`; g2.fillStyle = "#7ce8ff"; g2.fillText(sub, w / 2, h * .82); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildArena(){
  const S = G.sanct; if (S.arena) { S.arena.g.visible = true; return S.arena; }
  const g = new THREE.Group(); scene.add(g); S.signs.push(g);
  const stone = new THREE.MeshStandardMaterial({ color: 0x8fa6c8, roughness: .6, emissive: 0x1a3050, emissiveIntensity: .5 });
  for (const x of [DUEL.left, DUEL.right]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1, 1.2, 24), stone); p.position.set(x, DUEL.y - .6, DUEL.z); g.add(p);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, .07, 8, 40), new THREE.MeshBasicMaterial({ color: 0x7ce8ff })); ring.rotation.x = Math.PI / 2; ring.position.set(x, DUEL.y + .02, DUEL.z); g.add(ring);
  }
  const boss = new Alien(g, new THREE.Vector3(25, DUEL.y + 9.8, DUEL.bossZ), G.unlocked[0], { special: true, shirt: "👑", hp: 1e9 });
  boss.root.scale.setScalar(4.6); boss.root.rotation.y = Math.PI;   // floats ABOVE the board, not behind the answers
  boss.root.traverse(o => { if (o.isSprite) o.material.opacity = Math.min(o.material.opacity, .1); });   // a softer golden glow
  const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: textTex("…", ""), transparent: true, toneMapped: false })); board.position.set(25, DUEL.y + 7, DUEL.bossZ - 9); board.rotation.y = Math.PI; g.add(board);
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(10, .9), new THREE.MeshBasicMaterial({ map: textTex("👑", "", 1024, 96), transparent: true, toneMapped: false })); bar.position.set(25, DUEL.y + 9.3, DUEL.bossZ - 9); bar.rotation.y = Math.PI; g.add(bar);
  return (S.arena = { g, boss, board, bar, targets: [] });
}
function duelQuestions(){
  const ws = (G.waveWords.length ? G.waveWords : G.unlocked.slice(-4)).slice(0, 4);
  while (ws.length < 4 && G.unlocked.length) ws.push(pick(G.unlocked));
  return shuffleA(ws).map((w, i) => knownQuestion(w, [i % 2 ? "kr" : "mean"]));
}
function setTex(mesh, tex){ const old = mesh.material.map; mesh.material.map = tex; mesh.material.needsUpdate = true; if (old) old.dispose(); }
function renderDuel(){
  const D = G.duel, A = G.sanct.arena; if (!D) return;
  for (const t of A.targets) A.g.remove(t); A.targets = [];
  if (D.i >= D.qs.length) { setTex(A.board, textTex("✓", G.coop ? "파트너를 기다려요 · waiting for your partner" : "")); return; }
  const q = D.qs[D.i], showKr = !!q.audio;
  setTex(A.board, textTex(showKr ? q.w.kr : meaning(q.w), `${D.i + 1}/${D.qs.length} · ${showKr ? "뜻은? · the meaning?" : "한국어로? · in Korean?"}`));
  if (showKr) say([wordClip(q.w.id)], { interrupt: true });
  q.opts.forEach((o, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.3), new THREE.MeshBasicMaterial({ map: textTex(o, "", 768, 290, "rgba(20,30,50,.92)"), transparent: true, toneMapped: false }));
    m.position.set(D.x + (i % 2 ? 1.85 : -1.85), DUEL.y + 1.2 + (i < 2 ? 1.6 : 0), DUEL.z + 8); m.rotation.y = Math.PI; m.userData.opt = i; A.g.add(m); A.targets.push(m);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 1.8), new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: .9, toneMapped: false }));
    glow.position.set(0, 0, -.06); glow.visible = false; m.add(glow); m.userData.glow = glow;   // the gold frame behind the aimed-at panel
  });
}
function duelBar(){
  const S = G.sanct, H = S.duelHits || { me: 0, p: 0 }, need = G.coop ? 8 : 4, done = Math.min(need, H.me + H.p);
  setTex(S.arena.bar, textTex(`👑 ${"■".repeat(need - done)}${"□".repeat(done)}`, "", 1024, 96));
}
function startDuelLocal(){
  const S = G.sanct; if (G.duel) return;
  if (G.demon) closeDemon(); if (G.noteOpen) closePanel(); if (G.backpackOpen) closeBackpack(false);
  const A = buildArena(), side = isClient() ? "right" : "left", x = DUEL[side];
  G.duel = { side, x, qs: duelQuestions(), i: 0, zapT: 0, back: { x: player.body.x, y: player.body.y, z: player.body.z, yaw: player.yaw } };
  S.duelHits = { me: 0, p: 0 };
  Object.assign(player.body, { x, y: DUEL.y, z: DUEL.z, vy: 0 }); player.feet = DUEL.y; player.pos.set(x, DUEL.y + 1.7, DUEL.z); player.vel.set(0, 0, 0);
  player.yaw = Math.PI; player.pitch = .08; player.hasGun = true; gun.visible = true; G.firing = false;
  A.boss.word = G.unlocked[0]; renderDuel(); duelBar(); drawGunScreen(); SFX.charge();
  burst(player.pos.clone(), 0x7ce8ff, 60, 8);
  objective("👑 결투! · DUEL — shoot the right answer (click). A wrong one zaps " + (G.coop ? "your partner ⚡" : "you ⚡"));
  setTimeout(() => { if (G.duel) objective(""); }, 6000);
}
function finishDuelLocal(){
  const S = G.sanct, D = G.duel; if (!D) return;
  const A = S.arena; for (let i = 0; i < 5; i++) burst(A.boss.aimPoint(), [0x9fdcff, 0xffffff, 0xff9a3a, 0x7cf7d4, 0xffcf5c][i], 140, 14 + i * 4);
  SFX.slam(); SFX.kill(); G.shake = 1;
  setTimeout(() => {
    A.g.visible = false; for (const t of A.targets) A.g.remove(t); A.targets = [];
    Object.assign(player.body, { x: D.back.x, y: D.back.y, z: D.back.z, vy: 0 }); player.feet = D.back.y; player.pos.set(D.back.x, D.back.y + 1.7, D.back.z); player.yaw = D.back.yaw;
    player.hasGun = false; gun.visible = false; G.duel = null;
    objective("💥 보스를 이겼어요! · Boss beaten — the next wave brings 4 new words"); setTimeout(() => objective(""), 5000);
  }, 1200);
}
function beginDuel(){ const S = G.sanct; G.bossOut = true; S.duelT = 3; SFX.charge();
  objective("👑 보스가 결투를 신청해요! · The boss challenges you to a duel — 3 s…"); renderTop(); }
function duelFire(){
  const D = G.duel, A = G.sanct.arena; if (!D || D.zapT > 0 || D.i >= D.qs.length) return;
  camera.updateMatrixWorld(); ray.setFromCamera({ x: 0, y: 0 }, camera);
  gun.userData.kick = 1; flash.material.opacity = 1; gunLight.intensity = 6;
  const hit = ray.intersectObjects(A.targets, false)[0], from = new THREE.Vector3(); muzzle.getWorldPosition(from);
  if (!hit) { SFX.shot(); tracer(from, ray.ray.origin.clone().addScaledVector(ray.ray.direction, 30), 0xb8b0ff, true); return; }
  const q = D.qs[D.i], ok = q.opts[hit.object.userData.opt] === q.ans; tracer(from, hit.point, ok ? 0x7cf7d4 : 0xff6b8a, true);
  mark(q.w, ok);
  if (ok) {
    SFX.shotGood(); burst(hit.point, 0x7cf7d4, 30, 6); burst(A.boss.aimPoint(), 0xffcf5c, 50, 8); hitmarker(true);
    if (q.audioAfter) say([wordClip(q.w.id)], { interrupt: true });
    D.i++; G.sanct.duelHits.me++; duelBar(); renderDuel();
    if (isClient()) coopAct({ a: "duelOk" }); else checkDuelEnd();
  } else {
    SFX.resist(); hitmarker(false); floater(hit.point, "✗", "#ff6b8a", 40);
    if (!q.fixed) q.opts = shuffleA(q.opts); renderDuel();
    if (!G.coop) zapMe(); else if (isHost()) fxOut({ zap: 1 }); else coopAct({ a: "zap" });
  }
}
// the answer panel under the centre of the screen lights up gold (no crosshair needed)
function duelHover(){
  const A = G.sanct.arena; if (!A || !A.targets.length) return;
  camera.updateMatrixWorld(); ray.setFromCamera({ x: 0, y: 0 }, camera);
  const hit = ray.intersectObjects(A.targets, false)[0], on = hit ? hit.object : null;
  for (const m of A.targets) { const h = m === on && !(G.duel.zapT > 0); m.material.color.setHex(h ? 0xfff2c4 : 0xffffff); m.scale.setScalar(h ? 1.12 : 1); if (m.userData.glow) m.userData.glow.visible = h; }
}
function zapMe(){   // ⚡ purely for fun: blue flash, shake, a few bolts, 0.9 s without shooting
  if (G.duel) G.duel.zapT = .9;
  SFX.hurt(); G.shake = .7; const v = $("#vignette"); v.style.boxShadow = "inset 0 0 300px 140px rgba(140,220,255,.85)"; setTimeout(() => v.style.boxShadow = "", 450);
  for (let i = 0; i < 6; i++) { const to = player.pos.clone().add(new THREE.Vector3(rnd(-.6, .6), -.6, rnd(-.6, .6))); tracer(to.clone().add(new THREE.Vector3(rnd(-2, 2), 4, rnd(-2, 2))), to, 0x9fe8ff, true); }
  burst(player.pos.clone().setY(player.pos.y - .5), 0x9fe8ff, 40, 6);
  objectiveFlash(G.coop ? "⚡ 찌릿! 파트너가 틀렸어요 · zzzt — your partner got one wrong" : "⚡ 찌릿! · zzzt — wrong answer");
}
function checkDuelEnd(){
  const S = G.sanct, H = S.duelHits;
  if (!G.duel || H.me < 4 || (G.coop && H.p < 4)) { if (G.coop) fxOut({ duelbar: [H.me, H.p] }); return; }
  if (G.coop) fxOut({ duel: 0 });
  finishDuelLocal(); G.bossOut = false; S.nextWaveT = 5; G.coins += 20; renderTop();
}
// ---- interactions ----
function deerInteract(){
  const S = G.sanct, W = world, near = (o, r) => o && Math.hypot(o.x - player.pos.x, o.z - player.pos.z) < r && Math.abs(o.y - player.feet) < 2;
  for (const t of S.traps) if (near(t, 1.8)) return { kind: "pickup", o: t, label: "E · 🪤 함정 들기 · pick up this trap (to move it)" };
  for (const c of S.cats) if (near(c, 2.4)) return { kind: "cataim", o: c, label: "E · 🎯 투석기 조준 · aim this catapult (then 2 = pick up)" };
  if (S.kits && W.roadDist(player.pos.x, player.pos.z) < 2.6 && !S.traps.some(t => Math.hypot(t.x - player.pos.x, t.z - player.pos.z) < 3.2))
    return { kind: "place", label: `E · 🪤 여기에 함정 놓기 · place a trap here (📦 ${S.kits})` };
  for (const p of fort.pads) if (near(p, 2.2)) return { kind: "build", o: p, label: "E · 🔨 탑 짓기 — 문제 2개 · build a tower (2 questions)" };
  if (near(W.pedestal, 3)) return { kind: "pedestal", label: `E · 💎 탄약 · ammo (${S.ammo}) — towers & traps` };
  if (near(W.workshop, 3.6)) return { kind: "workshop", label: "E · 🔧 작업장 · workshop — build traps" };
  if (near(W.shelter, 3.8)) return { kind: "shelter", label: `E · 🦌 사슴 목장 · deer shelter — herd ${S.herd.length}, hive gate ❤ ${S.gateHp}` };
  if (near(W.deer, 4.5)) return { kind: "lessons", label: "E · 🦌 사슴의 수업 · learn from the deer" };
  for (const t of fort.towers) if (near(t, 2.6)) return { kind: "none", label: `🗼 Lv ${towerLv() + 1} · ${t.kills || 0} kills · 💎 ${S.ammo} shared ammo` };
  if (S.catKits && W.roadDist(player.pos.x, player.pos.z) > 3 && !S.cats.some(c => Math.hypot(c.x - player.pos.x, c.z - player.pos.z) < 3))
    return { kind: "catplace", label: `E · 🎯 투석기 놓기 · place a catapult here (📦 ${S.catKits})` };
  return null;
}
// ---- 🎯 catapults: 5 questions each, placed off the road, aimed at a spot on it; free splash shots (¼ of a tower) ----
const CATA = { quiz: 5, range: 45, radius: 3.5, cd: 1.5, flight: .9, ammo: 2 };
const WEST_GATE_WAVE = 3;
const catDmg = () => SANCT.towerDmg[towerLv()] * .25;
const trapHit = () => Math.round(alienHp(G.wave) * .6);   // a trap takes ~60 % of an alien: 2 hits (or a tower's help)
function catQuiz(){
  const qs = [], used = new Set();
  for (let i = 0; i < CATA.quiz; i++) { let w = pickQuizWord(); for (let k = 0; k < 5 && used.has(w.id); k++) w = pickQuizWord(); used.add(w.id); qs.push(knownQuestion(w)); }
  deerQuiz("catq", "🎯 투석기 · Catapult (5)", qs, () => {
    if (isClient()) coopAct({ a: "catkit" }); else G.sanct.catKits++;
    SFX.pickup(); objectiveFlash("🎯 투석기 완성! · Catapult ready — stand OFF the road and press <b>E</b> to place it, then aim at the road"); openWorkshop(); });
}
function makeCatapult(x, z, tx, tz){
  const y = world.groundY(x, z), g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: .85 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, .35, 2.2), wood); base.position.y = .35; g.add(base);
  for (const s of [-1, 1]) { const u = new THREE.Mesh(new THREE.BoxGeometry(.18, 1.4, .18), wood); u.position.set(s * .6, 1.1, 0); g.add(u); }
  for (const [wx, wz] of [[-.8, .8], [.8, .8], [-.8, -.8], [.8, -.8]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .15, 12), wood); wh.rotation.z = Math.PI / 2; wh.position.set(wx, .3, wz); g.add(wh); }
  const pivot = new THREE.Group(); pivot.position.y = 1.7; g.add(pivot);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(.14, .14, 2.8), wood); arm.position.z = -.5; pivot.add(arm);
  const cup = new THREE.Mesh(new THREE.SphereGeometry(.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), wood); cup.rotation.x = Math.PI; cup.position.set(0, .15, -1.8); pivot.add(cup);
  const wt = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), new THREE.MeshStandardMaterial({ color: 0x555a66, metalness: .6 })); wt.position.set(0, -.3, .85); pivot.add(wt);
  g.position.set(x, y, z); scene.add(g);
  const ring = new THREE.Mesh(new THREE.RingGeometry(CATA.radius - .3, CATA.radius, 36), new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; scene.add(ring);
  const c = { g, pivot, ring, x, y, z, tx, tz, ty: 0, cd: Math.random() * CATA.cd, swing: 0 }; aimCatapult(c, tx, tz); return c;
}
function aimCatapult(c, tx, tz){ c.tx = tx; c.tz = tz; c.ty = world.groundY(tx, tz); c.g.rotation.y = Math.atan2(c.x - tx, c.z - tz); c.ring.position.set(tx, c.ty + .06, tz); }
function removeCatapult(c){ scene.remove(c.g); scene.remove(c.ring); }
function launchBoulder(fx, fy, fz, tx, ty, tz, dmg){
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(.35, 0), new THREE.MeshStandardMaterial({ color: 0x8a8f9a, roughness: .9, flatShading: true }));
  m.position.set(fx, fy, fz); scene.add(m); G.sanct.boulders.push({ m, fx, fy, fz, tx, ty, tz, t: 0, dmg });
}
function catapultsTick(dt){   // host: fire at the spot whenever an alien is there
  const S = G.sanct;
  for (const c of S.cats) {
    c.cd -= dt;
    if (c.cd > 0) continue;
    if (!G.aliens.some(a => !a.dead && a.spawnT >= 1 && Math.hypot(a.pos.x - c.tx, a.pos.z - c.tz) < CATA.radius + 1)) { c.cd = .25; continue; }
    if (S.ammo < CATA.ammo) { c.cd = .5; continue; }   // a shot costs 2 ammo
    S.ammo -= CATA.ammo;
    c.cd = CATA.cd; c.swing = 1; const f = { x: c.x - Math.sin(c.g.rotation.y) * 1.2, y: c.y + 2.6, z: c.z - Math.cos(c.g.rotation.y) * 1.2 };
    launchBoulder(f.x, f.y, f.z, c.tx, c.ty, c.tz, catDmg()); fxOut({ cp: [r2(f.x), r2(f.y), r2(f.z), r2(c.tx), r2(c.ty), r2(c.tz)] });
  }
}
function bouldersTick(dt){   // host and partner: fly, land, (host) hurt everything in the splash
  const S = G.sanct;
  for (const c of S.cats) { c.swing = Math.max(0, c.swing - dt * 2.5); c.pivot.rotation.x = -1.1 * Math.sin(Math.min(1, c.swing) * Math.PI); }
  for (const b of S.boulders) {
    b.t += dt / CATA.flight; const t = Math.min(1, b.t);
    b.m.position.set(b.fx + (b.tx - b.fx) * t, b.fy + (b.ty - b.fy) * t + Math.sin(t * Math.PI) * 7, b.fz + (b.tz - b.fz) * t); b.m.rotation.x += dt * 8;
    if (t < 1) continue;
    b.done = true; scene.remove(b.m); burst(new THREE.Vector3(b.tx, b.ty + .4, b.tz), 0xc49a6a, 26, 6);
    if (player.pos.distanceTo(b.m.position) < 12) G.shake = Math.max(G.shake, .12);
    if (b.dmg) for (const a of G.aliens) if (!a.dead && a.spawnT >= 1 && Math.hypot(a.pos.x - b.tx, a.pos.z - b.tz) < CATA.radius) { a.stagger = .15; if (a.damage(b.dmg)) onKill(a, true); }
  }
  S.boulders = S.boulders.filter(b => !b.done);
}
// ---- aim mode: a ring follows where you look; click / E = fire there (green = on the road, in range) ----
function startAim(c){
  const S = G.sanct; G.aiming = { c, x: c ? c.x : player.pos.x, z: c ? c.z : player.pos.z, ok: false, hx: 0, hz: 0 };
  if (!S.aimRing) { S.aimRing = new THREE.Mesh(new THREE.RingGeometry(CATA.radius - .4, CATA.radius, 40), new THREE.MeshBasicMaterial({ color: 0x7cf7b0, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false })); S.aimRing.rotation.x = -Math.PI / 2; scene.add(S.aimRing); S.signs.push(S.aimRing); }
  S.aimRing.visible = true; SFX.select();
}
function aimTick(){
  const S = G.sanct, A = G.aiming; if (!A) { if (S.aimRing) S.aimRing.visible = false; return; }
  camera.updateMatrixWorld(); ray.setFromCamera({ x: 0, y: 0 }, camera);
  const o = ray.ray.origin, d = ray.ray.direction; let hit = null;
  for (let t = 1; t < 80; t += .5) { const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t; if (y <= world.groundY(x, z)) { hit = { x, z }; break; } }
  A.ok = !!hit && Math.hypot(hit.x - A.x, hit.z - A.z) <= CATA.range && world.roadDist(hit.x, hit.z) < 4;
  if (hit) { A.hx = hit.x; A.hz = hit.z; S.aimRing.position.set(hit.x, world.groundY(hit.x, hit.z) + .08, hit.z); }
  S.aimRing.visible = !!hit; S.aimRing.material.color.setHex(A.ok ? 0x7cf7b0 : 0xff5a6a);
  $("#interact").hidden = false; $("#interact").innerHTML = `🎯 조준 · aim: <b>click / E</b> = fire here ${A.ok ? "✓" : "(the road, ≤ 45 m)"}${A.c ? " · <b>2</b> = pick up" : ""} · <b>Q</b> = cancel`;
}
function confirmAim(){
  const S = G.sanct, A = G.aiming; if (!A) return;
  if (!A.ok) { SFX.empty(); objectiveFlash("🎯 길을 겨냥하세요 · Aim at the glowing road, within 45 m"); return; }
  const tx = r2(A.hx), tz = r2(A.hz);
  if (A.c) { if (isClient()) coopAct({ a: "caim", i: S.cats.indexOf(A.c), tx, tz }); aimCatapult(A.c, tx, tz); }
  else if (isClient()) coopAct({ a: "cplace", x: r2(A.x), z: r2(A.z), tx, tz });
  else if (S.catKits > 0) { S.catKits--; S.cats.push(makeCatapult(A.x, A.z, tx, tz)); }
  SFX.reload(); G.aiming = null; objectiveFlash("🎯 조준 완료 · Catapult aimed"); renderMissions();
}
function aimPickup(){
  const S = G.sanct, A = G.aiming; if (!A || !A.c) return;
  if (isClient()) coopAct({ a: "cpick", i: S.cats.indexOf(A.c) });
  else { removeCatapult(A.c); S.cats = S.cats.filter(x => x !== A.c); S.catKits++; }
  G.aiming = null; SFX.select(); objectiveFlash("📦 투석기를 들었어요 · Catapult picked up — E off the road to place it again");
}
function deerUse(it){
  if (it.kind === "pickup") pickUpTrap(it.o);
  else if (it.kind === "place") placeTrap();
  else if (it.kind === "build") { const w = pickQuizWord(); deerQuiz("buildq", "🔨 탑 짓기 · Build quiz", twoQ(w), () => { if (!fort.pads.includes(it.o)) return;
    if (isClient()) { coopAct({ a: "dbuild", i: fort.pads.indexOf(it.o) }); objectiveFlash("🗼 탑 완성! · Tower built"); } else deerBuildTower(it.o); }); }
  else if (it.kind === "pedestal") openPedestal();
  else if (it.kind === "workshop") openWorkshop();
  else if (it.kind === "lessons") openLessons();
  else if (it.kind === "shelter") openShelter();
  else if (it.kind === "cataim") startAim(it.o);
  else if (it.kind === "catplace") startAim(null);
}
function deerAct(act){
  if (act === "ammo" && G.panel === "pedestal") ammoQuiz();
  else if (act === "trap" && G.panel === "workshop") trapQuiz();
  else if (act === "cat" && G.panel === "workshop") catQuiz();
  else if (/^lesson\d$/.test(act) && G.panel === "lessons") { const o = (G.lessonOpts || [])[+act.slice(6)];
    if (o && o.tech && G.coins < techCost()) { SFX.empty(); objectiveFlash(`💰 ${techCost()} 필요해요 · You need 💰${techCost()} (1 per alien)`); return; }
    if (o) lessonCard(o); }
  else if (act === "train" && G.panel === "shelter") { if (armySize() >= herdCap()) { SFX.empty(); objectiveFlash(`🦌 무리가 꽉 찼어요 · The herd is full (${herdCap()}) — grow the deer (learn words) for more`); return; } trainQuiz(); }
  else if (act === "charge" && G.panel === "shelter") charge();
}
// ---- missions (top left) ----
function renderMissions(){
  const S = G.sanct; if (!S) return;
  const left = Math.max(0, G.waveSize - G.waveKills), perKill = Math.ceil(alienHp(G.wave) / SANCT.towerDmg[towerLv()]), need = left * perKill;
  const dmg = SANCT.trapDmg[trapLv()], hits = S.traps.length + S.kits, bossHp = bossLiveHp();
  const next = lessonOptions().find(o => o.tech);
  const row = (ok, html) => `<div class="${ok ? "ok" : ""}">${ok ? "✓" : "•"} ${html}</div>`;
  $("#missions").innerHTML = `<div class="mGoal">🏆 목표 · GOAL: 둥지의 문을 부숴요 · break the alien hive's gate ${gateShielded() ? `— 🛡 shielded until the deer reaches stage ${SHIELD_STAGE} (now ${deerStage()}/10)` : `🚪 ${S.gateHp}/${S.gateMax} <small>(🦌 shelter → charge)</small>`}</div>
    <div class="mHead">🦌 사슴 · Deer ❤ ${Math.ceil(S.hp)}/${S.max} · 🌱 ${G.unlocked.length} words <small>— don't let it fall</small></div>
    ${row(fort.towers.length >= fort.towers.length + fort.pads.length, `🗼 탑 짓기 · build towers <b>${fort.towers.length}/${fort.towers.length + fort.pads.length}</b> <small>(🔨 E)</small>`)}
    ${row(S.ammo >= need, `💎 탄약 · ammo <b>${S.ammo}</b> / ~${need} for ${left} aliens <small>(pedestal)</small>`)}
    ${row(hits >= trapSlots(), `🪤 함정 · traps <b>${S.traps.length}</b>/${trapSlots()}${S.kits ? ` · 📦 ${S.kits} to place` : ""} · 🎯 <b>${S.cats.length}</b>${S.catKits ? ` · 📦 ${S.catKits}` : ""} <small>(workshop)</small>`)}
    ${next ? row(false, `🦌 수업 · lesson: ${next.tech.icon} ${esc(next.tech.ko)} — must know <b>${esc(next.w.kr)}</b> · 💰 ${G.coins}/${techCost()}`) : ""}
    ${row(S.hiveBroken, `⚔️ 사슴 군대 · deer army: herd <b>${S.herd.length}</b>/${herdCap()}${(S.runnerMeshes || S.runners).length ? ` (+${(isClient() ? S.runnerMeshes : S.runners).length} out)` : ""} · march in ${Math.ceil(S.marchT || 0)} s · 🏕 ${S.camps.filter(c => c.conquered).length}/${S.camps.length} <small>(8 questions per deer)</small>`)}
    <div class="mFoot">Tab 🎒 내 단어 · your words</div>`;
}
function deerTick(dt, rdt){
  if (G.mode !== "deer" || G.over || !G.sanct) return;
  const S = G.sanct;
  if (!isClient()) { towersTick(dt); trapsTick(dt); runnersTick(dt); marchTick(dt); catapultsTick(dt); }   // the partner only mirrors
  bouldersTick(dt);
  for (const p of fort.pads) p.icon.position.y = 1.6 + Math.sin(G.time * 2 + p.x) * .1;
  // 🔧 a light over the workshop while your traps can't kill this wave's boss
  const bossLeft = bossLiveHp();
  S.trapBeam.visible = S.traps.length + S.kits === 0 && !G.duel;   // no traps at all yet: the workshop lights up
  S.trapBeam.material.opacity = .18 + Math.sin(G.time * 3) * .07;
  S.shield.visible = gateShielded() && !S.hiveBroken; S.shield.material.opacity = .22 + Math.sin(G.time * 2) * .06;
  S.crystal.rotation.y += rdt * 1.5; S.crystal.position.y = world.pedestal.y + 2.4 + Math.sin(G.time * 2) * .12; S.crystalGlow.material.opacity = S.ammo > 0 ? .7 : .2;
  S.deerMesh.rotation.y = Math.sin(G.time * .4) * .5; S.deerMesh.position.y = world.deer.y + .4 + Math.abs(Math.sin(G.time * 1.3)) * .05;
  // interaction prompt
  const it = !G.noteOpen && !G.backpackOpen && !G.aiming ? deerInteract() : null;
  $("#interact").hidden = !it; if (it) $("#interact").innerHTML = it.label; G.interact = it;
  aimTick();   // 🎯 aim mode shows its own prompt
  // arrow: the deer while it's being hit, else the road when you carry a trap
  let tgt = null;
  if (G.time - S.lastHit < 3 && Math.hypot(world.deer.x - player.pos.x, world.deer.z - player.pos.z) > 12) tgt = { x: world.deer.x, z: world.deer.z, label: "🚨 사슴 · the deer" };
  $("#radar").hidden = !tgt || G.noteOpen;
  if (tgt) { const dx = tgt.x - player.pos.x, dz = tgt.z - player.pos.z;
    $("#radarArrow").style.transform = `rotate(${Math.atan2(dx, -dz) + player.yaw - Math.PI / 2}rad)`; $("#radarDist").textContent = Math.round(Math.hypot(dx, dz)) + " m"; $("#radar small").textContent = tgt.label; }
  if (G.duel) { G.duel.zapT = Math.max(0, G.duel.zapT - rdt); duelHover(); }
  S.missionsT -= rdt; if (S.missionsT <= 0) { S.missionsT = .5; renderMissions(); if (G.panel === "shelter") renderShelter(); }
  // waves (the host runs them)
  if (isClient()) return;
  if (S.nextWaveT > 0) { S.nextWaveT -= dt; if (S.nextWaveT <= 0) { if (G.noteOpen && !G.coop) S.nextWaveT = .2; else deerWave(); } return; }
  if (G.calmT > 0) { G.calmT -= dt; if (Math.floor(G.calmT) !== G.lastCalm) { G.lastCalm = Math.floor(G.calmT); renderTop(); } return; }
  if (S.introTip && G.waveSpawned > 0) { S.introTip = false; helperHide = .1; }   // the aliens are coming: Lumi's intro can go
  if (S.duelT > 0) { S.duelT -= dt; if (S.duelT <= 0) { if (G.coop) fxOut({ duel: 1 }); startDuelLocal(); } }
  if (G.waveKills >= G.waveSize && !G.bossOut) beginDuel();
  const alive = G.aliens.filter(a => !a.dead).length, cap = Math.min(30, 12 + G.wave * 2);
  G.spawnT -= dt;
  if (G.spawnT <= 0 && alive < cap && G.waveSpawned < G.waveSize) {
    G.spawnT = Math.max(.55, 1.6 - G.wave * .07);
    // from wave 3 some aliens come as a pack of 3 at once: one tower at the gate can't take them all
    const west = G.wave >= WEST_GATE_WAVE && Math.random() < .4;   // from wave 3 about 40 % come through the west gate
    const pack = G.wave >= 3 && Math.random() < Math.min(.45, .15 + G.wave * .03) ? 3 : 1, [ex, ez] = world.entries[west ? 1 : 0];
    for (let i = 0; i < pack && G.waveSpawned < G.waveSize; i++) {
      G.waveSpawned++;
      const a = spawnAlienShirt(new THREE.Vector3(ex + (pack > 1 ? (i - 1) * 2.2 : rnd(-2.5, 2.5)), 0, ez + rnd(-1, 1) - i * .8), nextWeakWord(), { rise: true, speed: alienSpeed(G.wave), skills: { orb: false, slam: true } });
      a.hp = a.maxHp = alienHp(G.wave); if (west) a.route = world.roadB;
    }
    if (pack > 1) G.spawnT += .8;
  }
}
// ---- ⚔️ the attack lane: train deer at the shelter (8 questions each), gather a herd, charge the hive ----
// Technology prices follow the gold this run will pay: all techs together ≈ 80 % of what the waves give
// (1 per alien, 20 per boss) before the wave words run out — still rising (1×, 2×, 3× …) as you buy more.
function techCost(){
  const S = G.sanct; if (!S) return 40;
  const n = Math.max(1, Object.keys(S.techWord).length), W = Math.max(1, Math.ceil((G.pool.length - S.deerWords.length) / 4));
  const income = 45 * W + 1.5 * W * (W + 1) + 20 * W, scale = Math.min(1, .8 * income / (20 * n * (n + 1)));
  return Math.max(10, Math.round(40 * (S.tech.size + 1) * scale / 5) * 5);
}
function openShelter(){ openPanel("shelter", "🦌 사슴 목장 · Deer shelter"); renderShelter(); }
function renderShelter(){   // no explanations: the numbers + watching the herd march teach how it works
  const S = G.sanct, n = S.herd.length, full = armySize() >= herdCap();
  const camps = S.camps.map(c => `<span class="${c.conquered ? "won" : n > c.max ? "ok" : ""}">${c.conquered ? "🚩" : "🏕 " + c.max}</span>`).join("");
  $("#noteBody").innerHTML = `<div class="shel">
      <div class="herd">🦌 <b>${n}</b><small>/${herdCap()}</small></div>
      <div class="road">⚔️ <b>${Math.ceil(S.marchT)}s</b> ${camps}<span>${S.hiveBroken ? "🏆" : gateShielded() ? "🛡" : "🚪 " + S.gateHp}</span></div></div>
    <div class="shop"><button data-act="train" ${full ? "disabled" : ""}><span class="k">1</span><b>사슴 훈련 · Train a deer</b> <small>4 questions</small><span class="c">${full ? "FULL" : "🦌 +1"}</span></button></div>`;
}
const CAMPS = [[3, 10, 60], [4, 22, 120], [5, 34, 200]];   // [gold-road waypoint, defenders, 💰 reward] — about what the herd holds at stages 1, 3, 5
const MARCH_EVERY = 30;
function makeCamp(wp, n, gold){
  n = Math.max(2, Math.round(n * armyScale()));   // camp size follows the word list too
  const p = world.road2[wp], q = world.road2[wp + 1], ang = Math.atan2(q.x - p.x, q.z - p.z), side = { x: Math.cos(ang) * 6, z: -Math.sin(ang) * 6 };
  const g = new THREE.Group(); g.position.set(p.x, p.y, p.z); scene.add(g);
  const cloth = new THREE.MeshStandardMaterial({ color: 0x4a2a5a, roughness: .8, flatShading: true });
  for (const k of [-1, 1]) { const t = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.4, 6), cloth); t.position.set(side.x + k * 2.2, 1.2, side.z + k * 1.2); g.add(t); }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 4.5, 6), new THREE.MeshStandardMaterial({ color: 0x3b2c22 })); pole.position.set(side.x, 2.25, side.z); g.add(pole);
  const flagMat = new THREE.MeshBasicMaterial({ color: 0xff4fd8, side: THREE.DoubleSide }); const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, .9), flagMat); flag.position.set(side.x + .7, 4, side.z); g.add(flag);
  const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff7a3a, transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending })); fire.position.set(side.x * .5, .6, side.z * .5); fire.scale.set(2, 2, 1); g.add(fire);
  // the defenders: small purple aliens standing on the road (one figure shows ~1/12 of the camp)
  const skin = new THREE.MeshStandardMaterial({ color: 0x6c5b82, roughness: .5, emissive: 0xff7de0, emissiveIntensity: .08 }), eye = new THREE.MeshBasicMaterial({ color: 0xff7de0 });
  const defs = [];
  for (let i = 0; i < Math.min(12, n); i++) { const a = i / Math.min(12, n) * Math.PI * 2, r = 1 + (i % 3) * .8, d = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.22, .6, 4, 8), skin); body.position.y = .6; d.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 10, 8), skin); head.position.y = 1.25; head.scale.set(.85, 1.25, 1); d.add(head);
    const e = new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 5), eye); e.position.set(0, 1.28, .18); d.add(e);
    d.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); d.rotation.y = Math.random() * 6; g.add(d); defs.push(d); }
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(`🏕 ${n}/${n}`, `camp · +💰${gold}`), transparent: true, depthWrite: false })); sign.position.set(side.x, 6.2, side.z); sign.scale.set(2.6, 1.3, 1); g.add(sign);
  return { wp, max: n, alive: n, conquered: false, gold, g, defs, sign, flagMat, x: p.x, z: p.z };
}
function campVisual(c){
  const key = c.alive + "/" + c.conquered; if (c.shown === key) return; c.shown = key;
  const vis = c.conquered ? 0 : Math.ceil(c.alive / c.max * c.defs.length); c.defs.forEach((d, i) => d.visible = i < vis);
  const old = c.sign.material.map; c.sign.material.map = c.conquered ? signTexture("🚩", "우리 땅 · conquered") : signTexture(`🏕 ${c.alive}/${c.max}`, `camp · +💰${c.gold}`); c.sign.material.needsUpdate = true; old.dispose();
  c.flagMat.color.setHex(c.conquered ? 0x9fdcff : 0xff4fd8);
}
function campFight(c, r){   // one deer and one defender fall; the deer comes back in the pen (it marches again next time)
  const S = G.sanct; c.alive--; r.done = true; r.home = true;
  const at = new THREE.Vector3(r.x, r.g.position.y + 1, r.z); burst(at, 0xff7de0, 18, 5); burst(at, 0x9fdcff, 12, 4); fxOut({ b: [at.x, at.y, at.z, 0xff7de0] });
  if (c.alive > 0) { campVisual(c); return; }
  c.conquered = true; campVisual(c); G.coins += c.gold; SFX.pickup(); SFX.kill();
  burst(new THREE.Vector3(c.x, 3, c.z), 0xffcf5c, 90, 9); floater(new THREE.Vector3(c.x, 5, c.z), `🚩 +💰${c.gold}`, "#ffcf5c", 38, 2);
  helperShow(`🚩 캠프 점령! <small>Camp conquered — <b>+💰${c.gold}</b>. ${S.camps.filter(x => !x.conquered).length ? "Next camp further down the gold road." : "Only the hive is left!"}</small>`, 7);
  renderMissions(); renderTop();
}
function marchTick(dt){   // every 30 s: the camps refill, and the whole herd marches
  const S = G.sanct; S.marchT -= dt; if (S.marchT > 0) return;
  S.marchT = MARCH_EVERY;
  for (const c of S.camps) if (!c.conquered) { c.alive = c.max; campVisual(c); }
  if (S.herd.length) charge(true);   // silent: the march countdown is in the missions box
}
function trainQuiz(){
  const qs = [], used = new Set();
  for (let i = 0; i < 4; i++) { let w = pickQuizWord(); for (let k = 0; k < 5 && used.has(w.id); k++) w = pickQuizWord(); used.add(w.id); qs.push(knownQuestion(w)); }
  deerQuiz("trainq", "🦌 사슴 훈련 · Training (4)", qs, () => { if (isClient()) { coopAct({ a: "train" }); SFX.pickup(); objectiveFlash("🦌 +1 · 무리 · herd"); } else addHerdDeer(); openShelter(); });
}
function herdMesh(i){
  const g = deerMesh(); g.scale.setScalar(.42);
  g.position.set(world.rally.x - 2.4 + (i % 5) * 1.2, world.rally.y, world.rally.z - 2 + Math.floor(i / 5) % 6 * 1.2); g.rotation.y = Math.PI / 2 + rnd(-.3, .3); g.visible = i < 30;
  scene.add(g); return g;
}
function addHerdDeer(quiet){
  const S = G.sanct; S.herd.push(herdMesh(S.herd.length)); if (quiet) return;
  SFX.pickup(); objectiveFlash(`🦌 +1 · 무리 · herd ${S.herd.length}`); renderMissions();
}
function charge(fromPartner){
  const S = G.sanct, n = S.herd.length; if (!n) return;
  if (isClient()) { coopAct({ a: "charge" }); closePanel(); SFX.charge(); objectiveFlash(`⚔️ 돌격! · ${n} deer charge the hive!`); return; }
  S.herd.forEach((g, i) => { g.visible = true; S.runners.push({ g, wp: 0, x: g.position.x, z: g.position.z, delay: i * .18 }); });
  S.herd = []; if (!fromPartner) closePanel(); SFX.charge();
  if (!fromPartner) objectiveFlash(`⚔️ 돌격! · ${n} deer charge the hive!`); renderMissions();
}
function runnersTick(dt){
  const S = G.sanct, R = world.road2, Hv = world.hive, T = Hv.turret;
  S.turretCd -= dt;
  for (const r of S.runners) {
    if (r.delay > 0) { r.delay -= dt; continue; }
    const p = R[Math.max(0, Math.min(r.wp, R.length - 1))], dx = p.x - r.x, dz = p.z - r.z, d = Math.hypot(dx, dz), sp = (r.back ? 5 : 7) * dt;
    if (d < sp + .3) {
      if (r.back) { r.wp--; if (r.wp < 0) { r.done = true; r.home = true; continue; } }   // made it home: back into the herd
      else { const camp = S.camps.find(c => c.wp === r.wp && !c.conquered && c.alive > 0); if (camp) { campFight(camp, r); continue; }   // 🏕 a camp in the way: fight
        r.wp++; if (r.wp >= R.length) {
        if (gateShielded()) { r.back = true; r.wp = R.length - 2; burst(new THREE.Vector3(r.x, r.g.position.y + 1, r.z), 0x7ce8ff, 16, 5); continue; }   // 🛡 bounces off, runs home
        hitGate(); r.done = true; r.home = true; continue; } } }   // it hits the gate once and comes home
    else { r.x += dx / d * sp; r.z += dz / d * sp; r.g.rotation.y = Math.atan2(dx, dz); }
    r.g.position.set(r.x, world.groundY(r.x, r.z) + Math.abs(Math.sin(G.time * 14 + r.x)) * .25, r.z);
  }
  // the spire spits at the nearest running deer within 28 m
  if (S.turretCd <= 0) {
    let best = null, bd = 28;
    for (const r of S.runners) { if (r.done || r.back || r.delay > 0) continue; const d = Math.hypot(r.x - T.x, r.z - T.z); if (d < bd) { bd = d; best = r; } }
    // a hit deer isn't lost: it turns around and runs home to the herd (sending early only costs time)
    if (best) { S.turretCd = 1 / armyScale();   // a small word list = a slower spire
      const at = best.g.position.clone().setY(best.g.position.y + .6);
      tracer(new THREE.Vector3(T.x, T.y, T.z), at, 0xff4fd8); burst(at, 0xff4fd8, 22, 5); fxOut({ b: [at.x, at.y, at.z, 0xff4fd8] });
      best.back = true; best.wp = Math.min(best.wp, R.length - 1) - 1; }
    else S.turretCd = .2;
  }
  for (const r of S.runners) if (r.done) { if (r.home) { const i = S.herd.length, g = r.g; g.position.set(world.rally.x - 2.4 + (i % 5) * 1.2, world.rally.y, world.rally.z - 2 + Math.floor(i / 5) % 6 * 1.2); g.rotation.y = Math.PI / 2; g.visible = i < 30; S.herd.push(g); } else scene.remove(r.g); }
  S.runners = S.runners.filter(r => !r.done);
  Hv.eye.material.color.setHex(S.turretCd > .75 ? 0xffffff : 0xff4fd8);
}
function hitGate(){
  const S = G.sanct, Hv = world.hive; if (S.hiveBroken) return;
  S.gateHp = Math.max(0, S.gateHp - 1); burst(new THREE.Vector3(Hv.x, 2.5, Hv.z), 0x9fdcff, 30, 6); fxOut({ b: [Hv.x, 2.5, Hv.z, 0x9fdcff] });
  gateVisual();
  if (S.gateHp > 0) return;
  S.hiveBroken = true; G.won = true; gateVisual();
  setTimeout(() => { if (G.mode === "deer" && G.running) gameOver(); }, 3000);
}
function gateVisual(){   // the gate's sign + membrane follow its HP (host and partner)
  const S = G.sanct, Hv = world.hive; if (S.shownGate === S.gateHp && S.shownBroken === S.hiveBroken) return;
  S.shownGate = S.gateHp; Hv.membrane.opacity = .15 + .4 * S.gateHp / S.gateMax;
  const old = S.gateSign.material.map; S.gateSign.material.map = signTexture(`🚪 ${S.gateHp}/${S.gateMax}`, "외계인 둥지 · hive gate"); S.gateSign.material.needsUpdate = true; old.dispose();
  if (S.hiveBroken && !S.shownBroken) { SFX.slam(); SFX.kill();
    for (let i = 0; i < 5; i++) burst(new THREE.Vector3(Hv.x, 3, Hv.z), [0xff4fd8, 0xffffff, 0x9fdcff, 0xffcf5c, 0x7cf7d4][i], 140, 12 + i * 4);
    Hv.gate.rotation.x = -1.2; Hv.gate.position.y = -1.5; Hv.membrane.opacity = 0;
    objective("⚔️ 둥지의 문이 무너졌어요! · The hive gate fell — the invasion is over!"); }
  S.shownBroken = S.hiveBroken;
}
// ---- 👥 co-op: what the host sends about the sanctuary, and how the partner mirrors it ----
const bossLiveHp = () => { const S = G.sanct; if (isClient()) return S.bossLive || 0; const b = G.bossOut && G.aliens.find(a => a.special && !a.dead); return G.bossOut ? (b ? b.hp : 0) : S.bossHp; };
function deerSnap(){
  const S = G.sanct;
  return { sd: [Math.round(S.hp), S.max, S.ammo, S.kits, S.herd.length, S.gateHp, S.gateMax, S.hiveBroken ? 1 : 0, Math.round(bossLiveHp()), G.time - S.lastHit < .5 ? 1 : 0,
      Math.ceil(S.marchT), S.camps.map(c => c.conquered ? -1 : c.alive), S.catKits],
    rn: S.runners.filter(r => r.delay <= 0).map(r => [r2(r.x), r2(r.z)]) };
}
function deerFort(){
  const S = G.sanct, ids = a => a.map(w => w.id);
  return { ww: ids(G.waveWords), wv: G.wave, tr: S.traps.map(t => [r2(t.x), r2(t.z)]), ct: S.cats.map(c => [r2(c.x), r2(c.z), r2(c.tx), r2(c.tz)]), dw: ids(S.deerWords), tech: [...S.tech], ln: S.learned };
}
function applyDeerFort(f){
  const S = G.sanct; if (!S || !f.dw) return;
  G.waveWords = f.ww.map(wordById).filter(Boolean);
  S.deerWords = f.dw.map(wordById).filter(Boolean); S.deerIds = new Set(f.dw); S.techWord = {};
  TECHS.forEach((t, i) => { if (S.deerWords[i]) S.techWord[t.id] = S.deerWords[i]; }); S.growWords = S.deerWords.slice(TECHS.length);
  const had = S.tech.size; S.tech = new Set(f.tech); S.learned = f.ln; if (S.tech.size !== had) fort.towers.forEach(towerSignDeer);
  const ck = JSON.stringify(f.ct || []); if (ck !== S.catKey) { S.catKey = ck; S.cats.forEach(removeCatapult); S.cats = (f.ct || []).map(([x, z, tx, tz]) => makeCatapult(x, z, tx, tz)); }
  const tk = JSON.stringify(f.tr); if (tk !== S.trapKey) { S.trapKey = tk; for (const t of S.traps) scene.remove(t.g); S.traps = f.tr.map(([x, z]) => makeTrap(x, z)); }
  growDeer();
  if (f.wv > S.briefWave && G.waveWords.length) { if (G.noteOpen || G.backpackOpen) S.pendingBrief = true; else { S.briefWave = f.wv; openBrief(G.waveWords); } }
}
function applyDeerSnap(s){
  const S = G.sanct; if (!S || !s.sd) return;
  const [hp, max, ammo, kits, herd, gate, gmax, broken, boss, hit, march, camps, catKits] = s.sd; S.catKits = catKits || 0;
  S.marchT = march; (camps || []).forEach((v, i) => { const c = S.camps[i]; if (!c) return; if (v < 0) { if (!c.conquered) { c.conquered = true; burst(new THREE.Vector3(c.x, 3, c.z), 0xffcf5c, 90, 9); } } else c.alive = v; campVisual(c); });
  Object.assign(S, { hp, max, ammo, kits, gateHp: gate, gateMax: gmax, hiveBroken: !!broken, bossLive: boss }); if (!G.bossOut) S.bossHp = boss; if (hit) S.lastHit = G.time;
  renderHP(); gateVisual();
  while (S.herd.length < herd) S.herd.push(herdMesh(S.herd.length));
  while (S.herd.length > herd) scene.remove(S.herd.pop());
  const R = S.runnerMeshes; while (R.length < s.rn.length) R.push(herdMesh(99)); while (R.length > s.rn.length) scene.remove(R.pop());
  s.rn.forEach(([x, z], i) => { const g = R[i]; g.visible = true; const dx = x - g.position.x, dz = z - g.position.z; if (dx * dx + dz * dz > .001) g.rotation.y = Math.atan2(dx, dz); g.position.set(x, world.groundY(x, z) + Math.abs(Math.sin(G.time * 14 + x)) * .25, z); });
  if (S.pendingBrief && !G.noteOpen && !G.backpackOpen) { S.pendingBrief = false; S.briefWave = G.wave; openBrief(G.waveWords); }
}
function deerHostAction(ev){
  const S = G.sanct; if (!S) return;
  const who = "👥 파트너 · partner";
  if (ev.a === "ammo") { S.ammo += ammoPerQuiz(); objectiveFlash(`${who}: 💎 +${ammoPerQuiz()} ammo`); }
  else if (ev.a === "kit") { if (S.traps.length + S.kits < trapSlots()) { S.kits++; objectiveFlash(`${who}: 📦 +1 trap`); } }
  else if (ev.a === "place") placeTrap({ x: ev.x, z: ev.z });
  else if (ev.a === "pick") { const t = S.traps[ev.i]; if (t) pickUpTrap(t); }
  else if (ev.a === "dbuild") { const p = fort.pads[ev.i]; if (p) deerBuildTower(p); }
  else if (ev.a === "train") { if (armySize() < herdCap()) addHerdDeer(); }
  else if (ev.a === "charge") charge(true);
  else if (ev.a === "catkit") { S.catKits++; objectiveFlash(`${who}: 🎯 +1 catapult`); }
  else if (ev.a === "cplace") { if (S.catKits > 0) { S.catKits--; S.cats.push(makeCatapult(ev.x, ev.z, ev.tx, ev.tz)); } }
  else if (ev.a === "caim") { const c = S.cats[ev.i]; if (c) aimCatapult(c, ev.tx, ev.tz); }
  else if (ev.a === "cpick") { const c = S.cats[ev.i]; if (c) { removeCatapult(c); S.cats = S.cats.filter(x => x !== c); S.catKits++; } }
  else if (ev.a === "learn") { const w = wordById(ev.w), tech = TECHS.find(t => t.id === ev.t) || null;
    if (w && !G.unlocked.includes(w) && (!tech || (G.coins >= techCost() && !S.tech.has(tech.id)))) learnDeerWord({ w, tech }); }
}
// ---- 💬 chat (co-op): Enter opens it, Enter sends, Esc cancels ----
function addChat(who, text){
  const d = document.createElement("div"); d.innerHTML = `<b>${esc(who)}</b> ${esc(text)}`; $("#chatLog").appendChild(d);
  while ($("#chatLog").children.length > 7) $("#chatLog").firstChild.remove();
  setTimeout(() => d.classList.add("old"), 15000);
}
function openChat(){
  G.chatting = true; for (const k in keys) keys[k] = false; G.firing = false;
  $("#chatBox").hidden = false; $("#chatInput").value = ""; document.exitPointerLock && document.exitPointerLock(); setTimeout(() => $("#chatInput").focus(), 0);
}
function closeChat(){ G.chatting = false; $("#chatBox").hidden = true; $("#chatInput").blur(); G.panelClosedAt = performance.now();
  if (G.running && !G.noteOpen) { lock(); setTimeout(() => { if (G.running && !G.chatting && !G.noteOpen && !G.paused && document.pointerLockElement !== renderer.domElement) $("#clickToPlay").hidden = false; }, 350); }   // Enter is a real key press: take the mouse back right away
}
$("#chatInput").addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.key === "Escape") { closeChat(); return; }
  if (e.key !== "Enter" || e.isComposing) return;   // (Korean IME: Enter finishes the syllable first)
  const t = $("#chatInput").value.trim().slice(0, 200);
  if (t && G.coop) { if (isHost()) fxOut({ chat: t }); else coopAct({ a: "chat", t }); addChat("나 · me", t); }
  closeChat();
});
function clearDeer(){
  const S = G.sanct;
  if (S) { (S.cats || []).forEach(removeCatapult); for (const b of S.boulders || []) scene.remove(b.m);
    for (const g of S.herd || []) scene.remove(g); for (const r of S.runners || []) scene.remove(r.g);
    for (const g of S.runnerMeshes || []) scene.remove(g);
    for (const t of S.traps) scene.remove(t.g); if (S.trapBeam) scene.remove(S.trapBeam); if (S.deerMesh) scene.remove(S.deerMesh); (S.signs || []).forEach(s => scene.remove(s)); if (S.crystal) scene.remove(S.crystal); }
  if (G.demon) { G.demon.f.remove(); G.demon = null; }
  G.sanct = null; G.waveWords = [];
}

/* ================================ 👥 co-op (fortress) ================================ */
// host-authoritative: the host runs everything; the client moves/shoots locally and mirrors the host's world.
const isHost = () => !!(G.coop && G.coop.role === "host");
const isClient = () => !!(G.coop && G.coop.role === "client");
const partner = { pos: new THREE.Vector3(0, 1.7, 60), feet: 0, yaw: 0, pitch: 0, hp: 100, downed: false, bleedT: 0, dashing: 0, stuck: null, lastHurt: -99, seen: false, target: new THREE.Vector3(0, 1.7, 60), avatar: null, reviving: 0 };
G.targets = () => { const t = []; if (!player.downed) t.push(player); if (isHost() && partner.seen && !partner.downed) t.push(partner); return t.length ? t : [player]; };
G.targetFor = a => { if (G.mode === "deer") return deerTarget(a); let best = player, bd = 1e9; for (const t of G.targets()) { const d = (t.pos.x - a.pos.x) ** 2 + (t.pos.z - a.pos.z) ** 2; if (d < bd) { bd = d; best = t; } } return best; };
function houndTarget(h){ let best = player, bd = 1e9; for (const t of G.targets()) { if (t === partner && partner.stuck) continue; const d = (t.pos.x - h.x) ** 2 + (t.pos.z - h.z) ** 2; if (d < bd) { bd = d; best = t; } } return best; }
function fxOut(ev){ if (isHost()) (G.fxQ || (G.fxQ = [])).push(ev); }
function coopAct(ev){ if (isClient()) (G.actQ || (G.actQ = [])).push(ev); }
function pickWordFor(t, w){ if (isClient()) { const mi = G.mercs.indexOf(t); coopAct(mi >= 0 ? { a: "mword", i: mi, w: w.id } : { a: "tword", i: fort.towers.indexOf(t), w: w.id }); setTowerWord(t, w); } else setTowerWord(t, w); }
const wordById = id => D.words.find(w => w.id === id);
const r2 = v => Math.round(v * 100) / 100;

function makeAvatar(){
  const grp = new THREE.Group(), m = c => new THREE.MeshStandardMaterial({ color: c, roughness: .6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.3, .8, 4, 10), m(0x1f8a74)); body.position.y = 1.05; grp.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.24, 14, 10), m(0xd9b48f)); head.position.y = 1.78; grp.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(.26, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), m(0x7cf7d4)); cap.position.y = 1.82; grp.add(cap);
  const gn = new THREE.Mesh(new THREE.BoxGeometry(.1, .12, .6), m(0x2b2f3d)); gn.position.set(.28, 1.3, .3); grp.add(gn);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture("👥 파트너", "partner"), transparent: true, depthWrite: false })); tag.position.y = 2.6; tag.scale.set(1.6, .8, 1); grp.add(tag);
  scene.add(grp); return grp;
}
function coopBegin(){
  partner.seen = isClient(); partner.hp = 100; partner.downed = false; partner.stuck = null;
  if (partner.avatar) scene.remove(partner.avatar); partner.avatar = makeAvatar();
  G.fxQ = []; G.actQ = []; G.fxIn = []; G.sendT = 0; G.fortT2 = 0; G.lastFort = ""; G.puppets = new Map(); G.coopDogs = []; G.coopMercs = []; G.coopDeer = null; G.coopOrbs = []; G.coopPickups = [];
  G.coop.net.onMsg = isHost() ? hostMsg : clientMsg;
}
function goDown(){
  player.downed = true; player.bleedT = 30; player.hp = 0; renderHP();
  objective("🆘 쓰러졌어요! 파트너가 E를 꾹 눌러 살려줄 수 있어요 · You're down — your partner can revive you (hold E) · 30 s");
}
function revive(who){ who.downed = false; who.hp = 40; who.bleedT = 0; if (who === player) { renderHP(); objective(""); objectiveFlash("💚 살아났어요! · Revived"); } else objectiveFlash("💚 파트너를 살렸어요! · Partner revived"); SFX.heal(); }

// ---------------- host ----------------
function hostMsg(d){
  if (!d) return;
  if (d.s) { const [x, y, z, yaw, pitch, dash, rev] = d.s; partner.pos.set(x, y + 1.7, z); partner.feet = y; partner.yaw = yaw; partner.pitch = pitch; partner.dashing = dash ? .2 : 0; partner.target.set(x, y, z); partner.seen = true; partner.reviving = rev || 0; }
  for (const ev of d.ev || []) {
    if (ev.a === "shot") { const a = G.aliens.find(x => x.id === ev.id && !x.dead); if (!a || !a.word) continue;
      G.wakeAlien(a); const good = a.special || a.word.id === ev.w;
      tracer(new THREE.Vector3(partner.pos.x, partner.pos.y - .3, partner.pos.z), a.aimPoint(), good ? 0x7cf7d4 : 0xb8b0ff, true);
      if (good) { const dmg = ev.head ? 55 : 36; a.stagger = a.special ? .08 : .3; burst(a.aimPoint(), 0x7cf7d4, 16, 5); if (a.damage(dmg)) onKill(a, "partner"); } else a.damage(2); }
    else if (ev.a === "hound") { const h = G.dogs[ev.i]; if (h) hitHound(h, new THREE.Vector3(h.x, h.y + .8, h.z)); }
    else if (ev.a === "build") { const pad = fort.pads[ev.i], w = wordById(ev.w); if (pad && w) { buildTower(pad, w); objectiveFlash(`🗼 파트너가 탑을 지었어요 · Partner built a tower (${esc(w.kr)})`); } }
    else if (ev.a === "tword") { const t = fort.towers[ev.i], w = wordById(ev.w); if (t && w) setTowerWord(t, w); }
    else if (ev.a === "mword") { const m = G.mercs[ev.i], w = wordById(ev.w); if (m && w) setTowerWord(m, w); }
    else if (ev.a === "buy") { const i = shopList().findIndex(s => s.id === ev.id); if (i >= 0) buy(i); }
    else if (ev.a === "event") { const evn = fort.events[ev.i]; if (evn) useEvent(evn); }
    else if (ev.a === "nuke") { const w = wordById(ev.w); if (w && G.up.nuke) { const keep = G.loaded; G.loaded = w; G.nukeCd = 0; nukeWord(); G.loaded = keep; } }
    else if (ev.a === "note") { G.notePass.client = true; tryFinishNote(); }
    else if (ev.a === "chat") addChat("👥 파트너 · partner", String(ev.t || "").slice(0, 200));
    else if (ev.a === "duelOk" && G.sanct) { G.sanct.duelHits.p++; if (G.duel) duelBar(); checkDuelEnd(); }
    else if (ev.a === "zap") zapMe();
    else if (G.mode === "deer" && ["ammo", "kit", "place", "pick", "dbuild", "train", "charge", "learn", "catkit", "cplace", "caim", "cpick"].includes(ev.a)) deerHostAction(ev);
    else if (ev.a === "free") { const h = partner.stuck; partner.stuck = null; for (const o of G.dogs) o.cd = Math.max(o.cd, 2); if (h && h !== true) { h.cd = 4; const dx = h.x - partner.pos.x, dz = h.z - partner.pos.z, dd = Math.hypot(dx, dz) || 1; world.moveEntity(h, dx / dd * 3, dz / dd * 3, .35, 0); } }
  }
}
function tryFinishNote(){
  if (!G.note || !G.notePass.host || !G.notePass.client) return;
  const w = G.note.w; scene.remove(G.note.s); G.note = null;
  if (!G.unlocked.includes(w)) G.unlocked.push(w); renderQuick(); objective("");
  G.calmT = Math.max(G.calmT, 5); G.waveActive = true; startWave(); if (G.unlocked.length >= 5) spawnMerchant();
  fxOut({ unlock: w.id });
}
function hostSnapshot(){
  const a = G.aliens.filter(x => x.id && (!x.dead || x.removeT > 0)).map(x => [x.id, r2(x.pos.x), r2(x.pos.y), r2(x.pos.z), r2(x.root.rotation.y), x.dead ? 1 : 0, x.special ? 1 : 0, x.caster ? 1 : 0,
    x.word ? x.word.id : "", x.state === "slam" ? 2 : x.state === "charge" ? 1 : 0, r2(x.spawnT), r2(x.stateT || 0)]);
  return { t: "s", a,
    h: G.dogs.map(h => [r2(h.x), r2(h.y), r2(h.z), r2(h.g.rotation.y), h.sleepT > 0 ? 1 : 0]),
    o: G.orbs.map(o => [r2(o.mesh.position.x), r2(o.mesh.position.y), r2(o.mesh.position.z)]),
    k: G.pickups.map(p => [r2(p.s.position.x), r2(p.s.position.y), r2(p.s.position.z)]),
    p: [r2(player.pos.x), r2(player.feet), r2(player.pos.z), r2(player.yaw), r2(player.pitch), Math.round(player.hp), player.downed ? 1 : 0, Math.ceil(player.bleedT)],
    me: [Math.round(partner.hp), partner.downed ? 1 : 0, Math.ceil(partner.bleedT)],
    g: [G.wave, G.waveKills, G.waveSize, G.bossOut ? 1 : 0, Math.ceil(G.calmT), G.coins, G.zone, G.waveActive ? 1 : 0, Math.ceil(G.nukeCd || 0)],
    n: G.note ? [r2(G.note.s.position.x), r2(G.note.y), r2(G.note.s.position.z), G.note.w.id, G.notePass.client ? 1 : 0] : null,
    c: G.mercs.map(m => [r2(m.x), r2(m.y), r2(m.z), r2(m.g.rotation.y), m.word.id]),
    dr: G.deer ? [r2(G.deer.x), r2(G.deer.y), r2(G.deer.z), r2(G.deer.g.rotation.y), r2(deerSlow())] : null,
    ...(G.mode === "deer" && G.sanct ? deerSnap() : {}),
    fx: G.fxQ.splice(0, 80) };
}
function hostFort(){
  return { t: "f", pads: fort.pads.map(p => [r2(p.x), r2(p.z)]), towers: fort.towers.map(t => [r2(t.x), r2(t.z), t.word.id]),
    m: fort.merchant ? [r2(fort.merchant.x), r2(fort.merchant.z)] : null, ev: fort.events.map(e2 => [e2.kind, r2(e2.x), r2(e2.z)]),
    words: G.unlocked.map(w => w.id), up: G.up, beam: [r2(beam.position.x), r2(beam.position.z), beam.visible ? 1 : 0], zone: G.zone,
    ...(G.mode === "deer" && G.sanct ? deerFort() : {}) };
}
// ---------------- client ----------------
function clientMsg(d){
  if (!d || !d.t) return;
  if (d.t === "start") { Object.assign(settings, d.sel); startGame(false, d.mode || "fortress"); return; }
  if (d.t === "s") { (G.fxIn || (G.fxIn = [])).push(...(d.fx || [])); G.snap = d; }   // keep every event, even if snapshots arrive faster than frames
  else if (d.t === "f") applyFort(d);
  else if (d.t === "over") { $("#overStats").innerHTML = d.stats; G.won = false;
    $("#reviewList").innerHTML = G.unlocked.map(w => `<div><button data-say="${w.id}">🔊</button><b>${esc(w.kr)}</b><span>${esc(meaning(w))}</span><small>${POS_KO[w.pos]}</small></div>`).join("");
    G.over = true; G.running = false; closeBackpack(false); $("#note").hidden = true; document.exitPointerLock && document.exitPointerLock();
    $("#over .logo").textContent = d.title || "🏰 Game over"; setTimeout(() => { $("#hud").hidden = true; $("#over").hidden = false; }, 700); }
}
function applyFort(f){
  if (G.mode === "deer") applyDeerFort(f);
  const key = JSON.stringify([f.pads, f.towers, f.m, f.ev, f.zone]);
  // words / upgrades always
  const before = G.unlocked.length;
  G.unlocked = f.words.map(wordById).filter(Boolean); G.up = f.up || {}; G.maxRounds = 6 + 4 * (G.up.mag || 0);
  if (!G.loaded && G.unlocked.length) loadWord(G.unlocked[0]);
  if (G.unlocked.length !== before) { renderQuick(); renderAmmo(); }
  beam.visible = !!f.beam[2]; beam.position.set(f.beam[0], world.groundY(f.beam[0], f.beam[1]) + 30, f.beam[1]); G.zone = f.zone;
  if (key === G.lastFort) return; G.lastFort = key;
  G.quietBuild = true;
  clearFortifications(false);
  const pads = f.pads.map(([x, z]) => addPad(x, z));
  for (const [x, z, wid] of f.towers) { const p = addPad(x, z); const w = wordById(wid); if (w) buildTower(p, w); }
  if (f.m) spawnMerchant({ x: f.m[0], z: f.m[1] });
  f.ev.forEach(([kind, x, z], i) => spawnEvent(kind, i, { x, z }));
  G.quietBuild = false;
  if (G.mode === "deer") fort.towers.forEach(t => { t.kills = 0; towerSignDeer(t); });
}
function clientPuppets(dt, rdt){
  const s = G.snap; if (!s) return;
  const seen = new Set();
  for (const [id, x, y, z, ry, dead, special, caster, wid, st, spT, stT] of s.a) {
    seen.add(id);
    let a = G.puppets.get(id);
    if (!a) { const w = wordById(wid) || G.unlocked[0];
      a = new Alien(scene, new THREE.Vector3(x, y, z), w, { special: !!special, caster: !!caster, shirt: special ? "?" : w.kr, hp: 1e9 });
      a.id = id; a.tgt = new THREE.Vector3(x, y, z); G.puppets.set(id, a); G.aliens.push(a); }
    a.tgt.set(x, y, z); a.spawnT = spT;
    if (dead && !a.dead) { a.die(); a.removeT = 1.4; burst(a.aimPoint(), 0x7cf7d4, 60, 9); }
    if (a.dead) { a.update(dt, G); continue; }
    const p = a.root.position, before = p.clone(); p.lerp(a.tgt, Math.min(1, rdt * 12));
    a.root.rotation.y += ((((ry - a.root.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, rdt * 10);
    a.t += dt; a.state = st === 2 ? "slam" : st === 1 ? "charge" : "walk";
    a.walkCycle(before.distanceTo(p) > .005, 1.6);
    if (st === 2) { const k = Math.min(1, stT); a.warn.position.set(p.x, p.y + .05, p.z); a.warn.material.opacity = .15 + .35 * k; a.warn.scale.setScalar(.4 + .6 * k); a.arms.forEach(ar => ar.sh.rotation.x = -2.6 * k); }
    else a.warn.material.opacity = 0;
  }
  for (const [id, a] of G.puppets) if (!seen.has(id)) { a.dispose(); G.puppets.delete(id); G.aliens = G.aliens.filter(x => x !== a); }
}
function clientSync(dt, rdt){
  const s = G.snap; if (!s) return;
  // host avatar
  const [hx, hy, hz, hyaw, hpitch, hhp, hdown, hbleed] = s.p;
  partner.target.set(hx, hy, hz); partner.pos.set(hx, hy + 1.7, hz); partner.feet = hy; partner.yaw = hyaw; partner.downed = !!hdown; partner.hp = hhp; partner.bleedT = hbleed;
  // me
  const [mhp, mdown, mbleed] = s.me;
  if (mhp !== Math.round(player.hp)) { player.hp = mhp; renderHP(); }
  if (mdown && !player.downed) goDown(); else if (!mdown && player.downed) revive(player);
  player.bleedT = mbleed;
  // game state
  const [wave, wk, ws, boss, calm, coins, zone, active, nuke] = s.g;
  const changed = wave !== G.wave || wk !== G.waveKills || coins !== G.coins || boss !== (G.bossOut ? 1 : 0) || calm !== Math.ceil(G.calmT);
  Object.assign(G, { wave, waveKills: wk, waveSize: ws, bossOut: !!boss, calmT: calm, coins, zone, waveActive: !!active });
  if (changed) renderTop();
  // hounds
  while (G.dogs.length < s.h.length) G.dogs.push(makeHound(s.h[G.dogs.length][0], s.h[G.dogs.length][2]));
  while (G.dogs.length > s.h.length) { const h = G.dogs.pop(); scene.remove(h.g); }
  s.h.forEach(([x, y, z, ry, sleep], i) => { const h = G.dogs[i]; h.t += dt; h.x = x; h.y = y; h.z = z; h.sleepT = sleep ? 1 : 0; h.zzz.visible = !!sleep;
    h.g.position.lerp(new THREE.Vector3(x, y - (sleep ? .35 : 0), z), Math.min(1, rdt * 12)); h.g.rotation.y = ry;
    h.legs.forEach((l, k) => l.rotation.x = sleep ? 1.4 : Math.sin(h.t * 16 + (k % 2 ? Math.PI : 0)) * .7); });
  // orbs, pickups (render only)
  const syncPool = (pool, list, make) => { while (pool.length < list.length) pool.push(make()); while (pool.length > list.length) scene.remove(pool.pop());
    list.forEach(([x, y, z], i) => pool[i].position.set(x, y, z)); };
  syncPool(G.coopOrbs, s.o, () => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff5ad2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); m.scale.set(1.4, 1.4, 1); scene.add(m); return m; });
  syncPool(G.coopPickups, s.k, () => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6dff8a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); m.scale.set(.9, .9, 1); scene.add(m); return m; });
  // mercenaries + deer
  while (G.coopMercs.length < s.c.length) { const g2 = mercMesh(); scene.add(g2); const w = wordById(s.c[G.coopMercs.length][4]);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(w ? w.kr : "?", "E: 단어 바꾸기"), transparent: true, depthWrite: false })); sign.position.y = 2.9; sign.scale.set(2, 1, 1); g2.add(sign);
    G.coopMercs.push({ g: g2, sign, word: w }); }
  s.c.forEach(([x, y, z, ry, wid], i) => { const m = G.coopMercs[i]; m.x = x; m.y = y; m.z = z; m.g.position.set(x, y, z); m.g.rotation.y = ry;
    if (!m.word || m.word.id !== wid) { const w = wordById(wid); if (w) setTowerWord(m, w); } });
  G.mercs = G.coopMercs;
  if (s.dr && !G.coopDeer) { G.coopDeer = deerMesh(); scene.add(G.coopDeer); G.deer = { x: 0, y: 0, z: 0, g: G.coopDeer }; }
  if (s.dr) { G.coopDeer.position.set(s.dr[0], s.dr[1], s.dr[2]); G.coopDeer.rotation.y = s.dr[3]; Object.assign(G.deer, { x: s.dr[0], y: s.dr[1], z: s.dr[2] }); }
  // the boss note
  if (s.n && !s.n[4]) {
    if (!G.note || G.note.w.id !== s.n[3]) { if (G.note) scene.remove(G.note.s);
      const c = document.createElement("canvas"); c.width = c.height = 128; const g2 = c.getContext("2d"); g2.font = "90px sans-serif"; g2.textAlign = "center"; g2.fillText("📜", 64, 100);
      const t = new THREE.CanvasTexture(c); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); sp.scale.set(1.1, 1.1, 1); scene.add(sp);
      G.note = { s: sp, y: s.n[1], t: 0, w: wordById(s.n[3]), passed: false }; }
    G.note.s.position.x = s.n[0]; G.note.s.position.z = s.n[2];
  } else if (G.note && (!s.n || s.n[4])) { scene.remove(G.note.s); G.note = null; }
  if (G.mode === "deer") applyDeerSnap(s);
  // events from the host
  const fxList = (G.fxIn || []).splice(0);
  for (const ev of fxList) {
    if (ev.tr) tracer(new THREE.Vector3(ev.tr[0], ev.tr[1], ev.tr[2]), new THREE.Vector3(ev.tr[3], ev.tr[4], ev.tr[5]), ev.tr[6], true);
    else if (ev.b) burst(new THREE.Vector3(ev.b[0], ev.b[1], ev.b[2]), ev.b[3], 30, 6);
    else if (ev.k) { const [id, wid, mine] = ev.k, a = G.puppets.get(id), w = wordById(wid);
      if (a && !a.dead) { a.die(); a.removeT = 1.4; burst(a.aimPoint(), 0x7cf7d4, 70, 10); if (!a.special) wordGhost(a); }
      if (mine && w) { SFX.kill(); mark(w, true); markKill(w); G.kills++; killfeed(`<b>${esc(w.kr)}</b> = ${esc(meaning(w))}`); } }
    else if (ev.blast) { G.shake = 1.2; SFX.slam(); const v = $("#vignette"); v.style.boxShadow = "inset 0 0 400px 200px rgba(255,230,160,.8)"; setTimeout(() => v.style.boxShadow = "", 350);
      burst(new THREE.Vector3(ev.blast[0], ev.blast[1] + 1.5, ev.blast[2]), 0xffcf5c, 150, 18); G.note && (G.note.passed = false);
      objective("💥 보스 처치! 쪽지를 읽으세요 (둘 다 통과해야 해요) · Boss down — read the note 📜 (both of you must pass it)"); }
    else if (ev.chat) addChat("👥 파트너 · partner", String(ev.chat).slice(0, 200));
    else if (ev.cp && G.sanct) { const c = ev.cp; launchBoulder(c[0], c[1], c[2], c[3], c[4], c[5], 0); }
    else if (ev.duel === 1) startDuelLocal();
    else if (ev.duel === 0) finishDuelLocal();
    else if (ev.zap) zapMe();
    else if (ev.duelbar && G.sanct && G.duel) { G.sanct.duelHits = { me: ev.duelbar[1], p: ev.duelbar[0] }; duelBar(); }
    else if (ev.hurt) hurtFx();
    else if (ev.heal) { SFX.heal(); floater(player.pos.clone().add(new THREE.Vector3(0, .3, -1)), "+20 HP", "#6dff8a", 22); }
    else if (ev.bite) biteRemote();
    else if (ev.unlock) { const w = wordById(ev.unlock); objective(""); if (w) { objectiveFlash(`📜 새 단어 · New word: <b>${esc(w.kr)}</b> = ${esc(meaning(w))}`); } }
  }
}
function biteRemote(){
  if (G.backpackOpen) closeBackpack(false);
  if (G.noteOpen) { $("#note").hidden = true; G.noteOpen = false; G.panel = null; Q = null; }
  openPanel("bite", "🐕 물렸다! · Bitten — answer to break free"); G.timeScale = 1; $("#vignette").classList.remove("slow"); hurtFx();
  Q = { qs: [knownQuestion()], i: 0, wrong: 0, round: 1, lock: false, onPass: () => { closePanel(); coopAct({ a: "free" }); objectiveFlash("🐕 벗어났어요! · Free"); } };
  renderQuiz();
}
function coopTick(dt, rdt){
  if (!G.coop || (G.mode !== "fortress" && G.mode !== "deer") || G.over) return;
  const net = G.coop.net;
  // partner avatar
  if (partner.avatar) { partner.avatar.visible = partner.seen; partner.avatar.position.lerp(partner.target, Math.min(1, rdt * 12)); partner.avatar.rotation.y = partner.yaw + Math.PI;
    partner.avatar.rotation.z = partner.downed ? 1.35 : 0; }
  // revive: hold E next to a downed partner (the client tells the host via its state)
  const nearP = Math.hypot(partner.pos.x - player.pos.x, partner.pos.z - player.pos.z) < 2.4;
  const holding = keys.KeyE && partner.downed && nearP && !player.downed && !G.noteOpen;
  G.reviveT = holding ? (G.reviveT || 0) + rdt : 0;
  if (holding && G.interact && G.interact.kind === "revive") $("#interact").innerHTML = `E 꾹 누르기 · reviving ${Math.min(100, Math.round(G.reviveT / 3 * 100))}%`;
  G.sendT -= rdt;
  if (isHost()) {
    if (holding && G.reviveT >= 3) { revive(partner); G.reviveT = 0; }
    if (partner.reviving && player.downed && nearP) { G.revByP = (G.revByP || 0) + rdt; if (G.revByP >= 3) { revive(player); G.revByP = 0; } } else G.revByP = 0;
    // bleeding out / both down = game over; the partner regenerates like you do
    if (player.downed) { player.bleedT -= dt; if (player.bleedT <= 0 || (partner.downed && partner.seen) || !net.partner) { gameOver(); return; } }
    if (partner.downed) { partner.bleedT -= dt; if (partner.bleedT <= 0) { gameOver(); return; } }
    if (!partner.downed && G.time - partner.lastHurt > 5 && partner.hp < 100) partner.hp = Math.min(100, partner.hp + rdt * 3);
    if (G.sendT <= 0) { G.sendT = .07; net.send(hostSnapshot()); G.fortT2 -= .07; if (G.fortT2 <= 0) { G.fortT2 = .5; net.send(hostFort()); } }
  } else {
    clientSync(dt, rdt);
    if (player.downed) { const b = Math.ceil(player.bleedT); if (b !== G.lastBleed) { G.lastBleed = b; objective(`🆘 쓰러졌어요 · You're down — your partner can revive you (hold E) · ${b} s`); } }
    if (G.sendT <= 0) { G.sendT = .085;   // ≤ 12 messages a second (the relay allows 15)
      net.send({ s: [r2(player.pos.x), r2(player.feet), r2(player.pos.z), r2(player.yaw), r2(player.pitch), player.dashing ? 1 : 0, holding ? 1 : 0], ev: (G.actQ || []).splice(0, 20) }); }
  }
}

/* ---- lobby ---- */
function coopStatus(html){ $("#coopStatus").innerHTML = html; }
$("#hostBtn").onclick = () => {
  if (G.coop) G.coop.net.close();
  const net = new Net(); G.coop = { role: "host", net }; const code = net.host();
  coopStatus(`방 코드 · Room code: <b class="code">${code}</b><br><small>친구에게 알려주세요 · Tell your partner this code. Waiting…</small>`);
  net.onStatus = (k, x) => { if (k === "partner-join") { coopStatus(`방 코드 <b class="code">${code}</b> · ✅ 파트너가 들어왔어요! · Partner joined`); $("#coopStart").hidden = false; }
    if (k === "partner-leave") { coopStatus(`방 코드 <b class="code">${code}</b> · 파트너가 나갔어요 · Partner left — waiting…`); $("#coopStart").hidden = true; if (G.running) { partner.seen = false; objectiveFlash("👥 파트너 연결이 끊겼어요 · Partner disconnected"); } }
    if (k === "closed" && x === 4009) coopStatus("코드가 이미 사용 중 · Code taken — press Host again"); };
};
$("#coopStart").onclick = () => {
  if (!G.coop || G.coop.role !== "host") return;
  G.coop.net.send({ t: "start", mode: "deer", sel: { ch: settings.ch, cls: settings.cls, star: settings.star } });
  startGame(false, "deer");
};
$("#joinBtn").onclick = () => {
  const code = $("#joinCode").value.trim().toUpperCase(); if (!/^[A-Z]{4}$/.test(code)) { coopStatus("4글자 코드를 입력하세요 · Enter the 4-letter code"); return; }
  if (G.coop) G.coop.net.close();
  const net = new Net(); G.coop = { role: "client", net }; net.join(code);
  coopStatus("연결 중… · Connecting…");
  net.onStatus = (k, x) => { if (k === "open") coopStatus("✅ 연결됐어요! 호스트가 시작하길 기다려요 · Connected — waiting for the host to start");
    if (k === "closed") { coopStatus(x === 4004 ? "그 방은 없어요 · No room with that code" : x === 4000 ? "호스트가 나갔어요 · The host left" : "연결이 끊겼어요 · Disconnected");
      if (G.running && isClient()) { G.over = true; G.running = false; objective("👥 호스트 연결이 끊겼어요 · Lost the host"); setTimeout(() => { $("#hud").hidden = true; $("#menu").hidden = false; renderMenu(); }, 2000); } } };
  net.onMsg = d => { if (d && d.t === "start") { Object.assign(settings, d.sel); startGame(false, d.mode || "fortress"); } };
};

/* ================================ start / pause / over ================================ */
function resetRun(){
  clearFortifications(false); clearDeer(); $("#interact").hidden = true; G.chatting = false; $("#chatBox").hidden = true; G.aiming = null;
  removeHounds(false);
  (G.mercs || []).forEach(m => scene.remove(m.g)); if (G.deer) scene.remove(G.deer.g);
  if (G.note) scene.remove(G.note.s); $("#note").hidden = true; beam.visible = false;
  for (const a of G.aliens) a.dispose(); for (const o of G.orbs) o.pop(G);
  G.bursts.forEach(b => scene.remove(b.m || b.sprite)); G.tracers.forEach(t => scene.remove(t.m)); G.pickups.forEach(p => scene.remove(p.s));
  G.floaters.forEach(f => f.el.remove());
  Object.assign(G, { aliens: [], orbs: [], bursts: [], tracers: [], pickups: [], floaters: [], loaded: null, rounds: 6, reloadT: 0, fireCd: 0, recent: [],
    total: 0, won: false, quietT: 0, unlocked: [], newIds: new Set(), nextUnlockAt: 5, survT: 0, spawnT: 2, lastSec: -1, cp: 0, escT: 0, spawned: 0, calmT: 0, note: null, noteOpen: false, panel: null, wave: 0, waveKills: 0, waveSpawned: 0, bossOut: false, waveActive: false, coins: 0, up: {}, nukeCd: 0, zone: 0, fortT: 0, maxRounds: 6, interact: null, waveSize: 50, mercs: [], deer: null, extraPads: 0, dogs: [], score: 0, kills: 0, perfect: 0, tut: null, over: false, paused: false, time: 0, timeScale: 1, runMissed: new Map(), runRight: new Set(), recentLoads: [], speaking: null });
  Object.assign(player, { hp: 100, dashes: 2, dashCd: 0, dashing: 0, yaw: 0, pitch: 0, hasGun: false, moved: 0, downed: false, bleedT: 0 });
  Object.assign(player.body, { x: world.spawn.x, z: world.spawn.z, y: world.groundY(world.spawn.x, world.spawn.z), vy: 0 });
  player.feet = player.body.y; player.pos.set(player.body.x, player.feet + 1.7, player.body.z); player.vel.set(0, 0, 0);
  $("#killfeed").innerHTML = ""; $("#helper").hidden = true;
}
function startGame(tutorial, mode = "district"){
  G.mode = mode; if (mode === "survival" || mode === "escape" || mode === "fortress" || mode === "deer") tutorial = false;
  G.pool = selectedPool(); if (G.pool.length < 6) return;
  initAudio(); setVolume(settings.vol); preload(G.pool.map(w => w.id));
  useWorld(mode === "deer" ? getDeerWorld() : districtWorld);
  resetRun();
  $("#health .lbl").textContent = mode === "deer" ? "🦌 DEER" : "HP";
  for (const id of ["#quick", "#loaded", "#crosshair", "#keys"]) $(id).hidden = mode === "deer";   // the sanctuary has no gun
  $("#missions").hidden = mode !== "deer";
  G.running = true; $("#menu").hidden = true; $("#over").hidden = true; $("#hud").hidden = false;
  if (tutorial) { pedestal.visible = true; G.tut = { step: "move", text: TUT.move.text }; objective(TUT.move.text); }
  else if (mode === "fortress" && isClient()) { pedestal.visible = false; player.hasGun = true; gun.visible = true;
    helperShow("👥 파트너의 요새에 들어왔어요 · You joined your partner's fortress", 5); }
  else if (mode === "fortress") { pedestal.visible = false; player.hasGun = true; gun.visible = true;
    const w0 = nextNewWord(); G.unlocked.push(w0); loadWord(w0); markKill(w0); G.waveActive = true; setupZone(0); startWave();
    helperShow(`첫 단어: <b class="typed">${esc(w0.kr)}</b> <small>= ${esc(meaning(w0))} · walk to a 🔨 pad + E to build a tower (quiz)</small>`, 7); say([wordClip(w0.id)]); }
  else if (mode === "deer" && isClient()) { pedestal.visible = false; player.hasGun = false; gun.visible = false;
    deerStart(true); helperShow("👥 파트너의 성소에 들어왔어요 · You joined your partner's sanctuary — everything you build counts for both. <b>Enter</b> = chat", 8); }
  else if (mode === "deer") { pedestal.visible = false; player.hasGun = false; gun.visible = false;
    deerStart();
    helperShow("🏆 <small><b>Goal: break the alien hive's gate</b> (the pink light, east) with a deer army from the 🦌 shelter — and don't let your baby deer fall. 🔨 towers · 💎 ammo · 🔧 traps (the only thing that hurts the boss) · 🦌 lessons. Missions: top left.</small>", 1e9); G.sanct.introTip = true; }   // stays up until the first aliens come
  else if (mode === "escape") { pedestal.visible = false; player.hasGun = true; gun.visible = true;
    const w0 = nextNewWord(); G.unlocked.push(w0); loadWord(w0); markKill(w0); placeBeam();
    objective(`🏃 탈출 모드 · Fight your way to the <b>cathedral altar</b> — follow the golden light. Read the word on their shirts! <small>1–9 / mouse wheel = switch word · first word: <b>${esc(w0.kr)}</b> = ${esc(meaning(w0))}</small>`);
    setTimeout(() => { if (G.mode === "escape" && G.running) objective(""); }, 8000); }
  else if (mode === "survival") { pedestal.visible = false; player.hasGun = true; gun.visible = true;
    const w0 = unlockWord(true); G.newIds.clear(); loadWord(w0); G.total = 0;
    helperShow(`첫 단어: <b class="typed">${esc(w0.kr)}</b> <small>= ${esc(meaning(w0))} · every 5 kills a new word</small>`, 6); say([wordClip(w0.id)]);
    objective("⏱ 생존 모드 · Survive! They come from everywhere — keep moving, dash (<b>Space</b>), and grow your backpack"); setTimeout(() => { if (G.mode === "survival" && G.running) objective(""); }, 6000); }
  else { pedestal.visible = false; player.hasGun = true; gun.visible = true; loadWord(pick(G.pool)); populateDistrict();
    helperShow("가방은 <b>Tab</b>! <small>Look at an alien to hear its word · Tab = backpack</small>", 4); say([lineClip("listen")]); }
  renderHP(); renderAmmo(); renderDash(); renderTop(); renderQuick(); drawGunScreen();
  if (G.coop) coopBegin();
  if (!G.noteOpen) lock();   // (the deer sanctuary opens with the new-word card: the mouse stays free for it)
}
// co-op fortress never freezes or slows the world: menus/panels only cover your own screen
const liveCoop = () => !!(G.coop && (G.mode === "fortress" || G.mode === "deer"));
function pauseGame(){ G.paused = true; G.firing = false; for (const k in keys) keys[k] = false;
  $("#pauseCoop").hidden = !liveCoop(); $("#pause").hidden = false; $("#clickToPlay").hidden = true; document.exitPointerLock && document.exitPointerLock(); }
function resumeGame(){ G.paused = false; $("#pause").hidden = true; lock(); }
function gameOver(){
  if (G.over) return;
  if (isHost()) setTimeout(() => G.coop && G.coop.net.send({ t: "over", stats: $("#overStats").innerHTML, title: $("#over .logo").textContent }), 50);
  G.over = true; G.running = false; closeBackpack(false); $("#note").hidden = true; G.noteOpen = false; G.panel = null; Q = null; document.exitPointerLock && document.exitPointerLock();
  const best = store.get("wa_best", 0); if (G.score > best) store.set("wa_best", G.score);
  if (G.mode === "deer") {
    const S = G.sanct || { learned: [], tech: new Set() }, bw = store.get("wa_best_deer", 0), size = G.unlocked.length, isBest = size > bw; if (isBest) store.set("wa_best_deer", size);
    $("#overStats").innerHTML = [[size, isBest ? "🏆 words · deer size (best)" : `words · best ${Math.max(bw, size)}`], [G.won ? G.wave : G.wave - 1, "waves"], [S.learned.length, "deer lessons"], [S.tech.size, "technologies"]].map(([b, s2]) => `<div><b>${b}</b><span>${s2}</span></div>`).join("");
    $("#reviewList").innerHTML = G.unlocked.map(w => `<div><button data-say="${w.id}">🔊</button><b>${esc(w.kr)}</b><span>${esc(meaning(w))}</span><small>${POS_KO[w.pos]}</small></div>`).join("");
  } else if (G.mode === "fortress") {
    const bw = store.get("wa_best_fort", 0), cleared = G.wave - 1, isBest = cleared > bw; if (isBest) store.set("wa_best_fort", cleared);
    $("#overStats").innerHTML = [[cleared, isBest ? "🏆 waves (best)" : `waves · best ${Math.max(bw, cleared)}`], [G.kills, "enemies"], [G.unlocked.length, "words learned"], ["💰 " + G.coins, "coins left"]].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");
    $("#reviewList").innerHTML = G.unlocked.map(w => `<div><button data-say="${w.id}">🔊</button><b>${esc(w.kr)}</b><span>${esc(meaning(w))}</span><small>${POS_KO[w.pos]}</small></div>`).join("");
  } else if (G.mode === "escape") {
    const t = Math.floor(G.escT), fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, eb = store.get("wa_best_esc", 0), isBest = G.won && (!eb || t < eb); if (isBest) store.set("wa_best_esc", t);
    $("#overStats").innerHTML = [[G.won ? fmt(t) : `${G.cp}/${world.route.length}`, G.won ? (isBest ? "🏆 best time" : "time") : "checkpoints"], [G.kills, "enemies"], [G.unlocked.length, "words learned"], ["★ " + G.score, "score"]].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");
    $("#reviewList").innerHTML = G.unlocked.map(w => `<div><button data-say="${w.id}">🔊</button><b>${esc(w.kr)}</b><span>${esc(meaning(w))}</span><small>${POS_KO[w.pos]}</small></div>`).join("");
  } else if (G.mode === "survival") {
    const t = Math.floor(G.survT), sb = store.get("wa_best_surv", 0), isBest = t > sb; if (isBest) store.set("wa_best_surv", t);
    const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    $("#overStats").innerHTML = [[fmt(t), isBest ? "🏆 new best" : "best " + fmt(Math.max(sb, t))], [G.kills, "aliens"], [G.unlocked.length, "words"], ["★ " + G.score, "score"]].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");
  } else $("#overStats").innerHTML = [["★ " + G.score, "score"], [G.kills, "aliens"], [G.perfect, "perfect"], [(G.total - G.aliens.filter(a => !a.dead).length) + "/" + G.total, "cleared"]].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");
  const list = [...G.runMissed.keys()].map(id => D.words.find(w => w.id === id));
  if (!shirtMode()) $("#reviewList").innerHTML = list.length ? list.map(w => `<div><button data-say="${w.id}">🔊</button><b>${esc(w.kr)}</b><span>${esc(meaning(w))}</span><small>${CAT[w.cat].icon}</small></div>`).join("") : `<div>👏 no weak words this run</div>`;
  $("#over .logo").textContent = G.mode === "district" && G.won ? "구역 정화 완료! · District cleared" : G.mode === "survival" ? "⏱ 생존 끝 · Survival over" : G.mode === "escape" ? (G.won ? "🏃 탈출 성공! · You escaped" : "🏃 탈출 실패 · Didn't make it") : G.mode === "fortress" ? `🏰 요새 함락 · Wave ${G.wave}` : G.mode === "deer" ? (G.won ? (G.sanct && G.sanct.hiveBroken ? "⚔️ 둥지를 부쉈어요! · You broke the hive — you win!" : "🦌 사슴이 모든 단어를 알아요! · Your deer knows every word") : `🦌 사슴이 쓰러졌어요 · The deer fell — wave ${G.wave}`) : "Game over";
  setTimeout(() => { $("#hud").hidden = true; $("#over").hidden = false; }, 900);
}
$("#reviewList").onclick = e => { const b = e.target.closest("[data-say]"); if (b) say([wordClip(b.dataset.say)], { interrupt: true }); };
$("#resumeBtn").onclick = resumeGame;
$("#quitBtn").onclick = () => { $("#pause").hidden = true; G.paused = false; gameOver(); };
// solo buttons leave any co-op room; Again in co-op = the host restarts both, the partner waits for the host
const solo = f => () => { if (G.coop) { G.coop.net.close(); G.coop = null; if (partner.avatar) partner.avatar.visible = false; coopStatus(""); $("#coopStart").hidden = true; } f(); };
$("#againBtn").onclick = () => { if (!G.coop) return startGame(false, G.mode); if (isHost()) $("#coopStart").click(); else { $("#over").hidden = true; $("#menu").hidden = false; renderMenu(); coopStatus("호스트가 다시 시작하길 기다려요 · Waiting for the host to start again"); } };
$("#menuBtn").onclick = () => { $("#over").hidden = true; $("#menu").hidden = false; renderMenu(); };
$("#playBtn").onclick = solo(() => startGame(!store.get("wa_tutorial_done", false)));
$("#tutBtn").onclick = solo(() => startGame(true));
$("#survBtn").onclick = solo(() => startGame(false, "survival"));
$("#escBtn").onclick = solo(() => startGame(false, "escape"));
$("#fortBtn").onclick = solo(() => startGame(false, "fortress"));
$("#deerBtn").onclick = solo(() => startGame(false, "deer"));

/* ================================ menu ================================ */
const UI = {
  tagline: "외계인마다 약한 단어가 하나 있어요. 루미의 말을 듣고, 가방에서 그 단어를 찾아 장전하고, 쏘세요.<br><small>Every alien is weak to one Korean word. Listen to Lumi, find the word in your backpack, load it, fire.</small>",
  tutorial: "🎓 튜토리얼 · Tutorial", lang: "Meaning language", labels: "Backpack labels", hints: "Lumi shows the word", sens: "Mouse sensitivity", volume: "Volume",
  chapters: "Chapters", classes: "Classes", star: "Priority words only", resume: "▶ Resume (Q)", quit: "Quit run", over: "Game over", review: "Words to review",
  again: "↻ Again", menu: "Menu", click: "Click or press any key to play",
  controls: "<b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> dash · <b>Mouse</b> aim/shoot · <b>Tab</b> backpack (time slows) · <b>1–4</b> recent ammo · <b>R</b> reload · <b>Q</b> hear the word again · <b>Esc</b> pause · <b>F11</b> fullscreen",
};
// The website only offers the deer sanctuary (+ its co-op). The older modes are still here: the desktop app
// (file://) shows them, and so does the website with ?classic in the address.
const CLASSIC = location.protocol === "file:" || /[?&]classic\b/.test(location.search);
function renderMenu(){
  document.querySelectorAll("[data-i]").forEach(el => { const k = el.dataset.i; if (UI[k] != null) el.innerHTML = UI[k]; });
  for (const id of ["#playBtn", "#fortBtn", "#escBtn", "#survBtn", "#tutBtn"]) $(id).hidden = !CLASSIC;
  for (const id of ["#labelSel", "#bpSel", "#subsSel"]) $(id).closest("label").hidden = !CLASSIC;
  if (!CLASSIC) {
    $("[data-i=tagline]").innerHTML = "아기 얼음 사슴을 지키면서 단어를 배워요. 탑, 탄약, 함정, 사슴 군대 — 모두 퀴즈로 만들어요.<br><small>Protect the baby ice deer and learn words: towers, ammo, traps and a deer army — all built from quizzes.</small>";
    $("[data-i=controls]").innerHTML = "<b>WASD</b> move · <b>Shift</b> sprint · <b>Space / Shift</b> sprint (hold) · <b>E</b> use · <b>Tab</b> your words · <b>Enter</b> chat (co-op) · <b>Esc</b> pause · <b>F11</b> fullscreen";
  }
  const done = store.get("wa_tutorial_done", false), best = store.get("wa_best", 0);
  $("#playBtn").textContent = done ? `▶ 시작 · Play${best ? "  (best ★" + best + ")" : ""}` : "▶ 시작 · Play (starts with the tutorial)";
  $("#langSel").innerHTML = D.langs.map(l => `<option value="${l.code}">${esc(l.native)}</option>`).join(""); $("#langSel").value = settings.lang;
  $("#labelSel").value = settings.labels; $("#bpSel").value = settings.bpMode; $("#subsSel").value = settings.subs; $("#sensSel").value = settings.sens; $("#volSel").value = settings.vol;
  $("#chChips").innerHTML = D.chapters.map(c => `<button class="chip${settings.ch.includes(c.id) ? " on" : ""}" data-ch="${c.id}">${esc(c.title)}<small>${esc(c.theme)}</small></button>`).join("");
  const CL = { v: "비디오", r1: "읽기 1", r2: "읽기 2", s1: "말하기 1" };
  $("#clsChips").innerHTML = Object.entries(CL).map(([k, t]) => `<button class="chip${settings.cls.includes(k) ? " on" : ""}" data-cls="${k}">${t}</button>`).join("");
  $("#starChip").classList.toggle("on", settings.star);
  const n = selectedPool().length;
  $("#poolCount").textContent = n >= 6 ? `🎒 ${n} words in your backpack` : "Pick at least 6 words";
  $("#poolCount").classList.toggle("bad", n < 6); $("#playBtn").disabled = $("#tutBtn").disabled = $("#survBtn").disabled = $("#escBtn").disabled = $("#fortBtn").disabled = $("#deerBtn").disabled = n < 6;
  const fb = store.get("wa_best_fort", 0); $("#fortBtn").textContent = `🏰 요새 모드 · Fortress — waves, towers by quiz, a new word per boss${fb ? `  (best: wave ${fb})` : ""}`;
  const hb = store.get("wa_best_deer", 0); $("#deerBtn").textContent = `🦌 사슴 지키기 · Deer Sanctuary — towers, traps and lessons, all built from quizzes${hb ? `  (best: ${hb} words)` : ""}`;
  const eb = store.get("wa_best_esc", 0); $("#escBtn").textContent = `🏃 탈출 모드 · Escape — read their shirts, reach the cathedral${eb ? `  (best ${Math.floor(eb / 60)}:${String(eb % 60).padStart(2, "0")})` : ""}`;
  const sb = store.get("wa_best_surv", 0); $("#survBtn").textContent = `⏱ 생존 모드 · Survival — start with 1 word${sb ? `  (best ${Math.floor(sb / 60)}:${String(sb % 60).padStart(2, "0")})` : ""}`;
}
$("#langSel").onchange = e => { settings.lang = e.target.value; saveSettings(); };
$("#labelSel").onchange = e => { settings.labels = e.target.value; saveSettings(); };
$("#bpSel").onchange = e => { settings.bpMode = e.target.value; saveSettings(); };
$("#subsSel").onchange = e => { settings.subs = e.target.value; saveSettings(); };
$("#sensSel").oninput = e => { settings.sens = +e.target.value; saveSettings(); };
$("#volSel").oninput = e => { settings.vol = +e.target.value; setVolume(settings.vol); saveSettings(); };
$("#chChips").onclick = e => { const b = e.target.closest("[data-ch]"); if (!b) return; const id = b.dataset.ch; settings.ch = settings.ch.includes(id) ? settings.ch.filter(x => x !== id) : [...settings.ch, id]; saveSettings(); renderMenu(); };
$("#clsChips").onclick = e => { const b = e.target.closest("[data-cls]"); if (!b) return; const id = b.dataset.cls; settings.cls = settings.cls.includes(id) ? settings.cls.filter(x => x !== id) : [...settings.cls, id]; saveSettings(); renderMenu(); };
$("#starChip").onclick = () => { settings.star = !settings.star; saveSettings(); renderMenu(); };
renderMenu();

/* ================================ update ================================ */
const clock = new THREE.Clock();
function update(rdt){
  const dt = rdt * (liveCoop() ? 1 : G.timeScale);
  G.time += dt;
  world.update(G.time, rdt, player.pos.x, player.pos.z);
  pedestal.rotation.y += rdt * .8; pedGun.position.y = 1.25 + Math.sin(G.time * 2) * .08;
  if (!G.running || (G.paused && !liveCoop())) return;

  // ---- player movement (real time, not slowed: you can still reposition while the backpack is open? no — frozen) ----
  if (!G.backpackOpen && !G.noteOpen && !player.downed && !G.paused && !G.duel) {   // no walking while a panel is open, you're down or in the boss duel
    const f = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)), r = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const want = new THREE.Vector3();
    if (keys.KeyW) want.add(f); if (keys.KeyS) want.sub(f); if (keys.KeyD) want.add(r); if (keys.KeyA) want.sub(r);
    const deerRun = G.mode === "deer" && (keys.Space || keys.ShiftLeft || keys.ShiftRight), sprint = keys.ShiftLeft || keys.ShiftRight;
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(deerRun ? 12.5 : sprint ? 9.5 : 6.2);   // you can't get hurt here: no reason to cap running
    player.vel.x += (want.x - player.vel.x) * Math.min(1, rdt * 10); player.vel.z += (want.z - player.vel.z) * Math.min(1, rdt * 10);
    if (player.dashing > 0) { player.dashing -= rdt; player.vel.copy(player.dashDir).multiplyScalar(19); if (player.dashing <= 0) { player.dashing = 0; player.vel.multiplyScalar(.3); } }   // exactly 0: "dashing" is checked as truthy elsewhere
    const before = player.pos.clone();
    world.moveEntity(player.body, player.vel.x * rdt, player.vel.z * rdt, .45, rdt);
    player.feet = player.body.y; player.pos.set(player.body.x, player.feet + 1.7, player.body.z);
    const moved = Math.hypot(before.x - player.pos.x, before.z - player.pos.z); player.moved += moved;
    player.bob += moved * 2.2;
    if (player.dashCd > 0) { player.dashCd = Math.max(0, player.dashCd - rdt); renderDash(); }
    if (G.time - player.lastHurt > 5 && player.hp < 100) { player.hp = Math.min(100, player.hp + rdt * 3); renderHP(); }
  }
  // camera
  const shake = G.shake > 0 ? G.shake * .15 : 0; G.shake = Math.max(0, G.shake - rdt);
  camera.position.set(player.pos.x + rnd(-shake, shake), (player.downed ? player.feet + .5 : player.pos.y + Math.sin(player.bob) * .05) + rnd(-shake, shake), player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
  // gun sway + kick
  const kick = gun.userData.kick || 0; gun.userData.kick = Math.max(0, kick - rdt * 8);
  gun.position.set(.28 + Math.sin(player.bob * .5) * .012, -.27 + Math.abs(Math.cos(player.bob * .5)) * .01 - (G.reloadT > 0 ? .12 : 0), -.5 + kick * .08);
  gun.rotation.x = kick * .15 + (G.reloadT > 0 ? .5 : 0);
  flash.material.opacity = Math.max(0, flash.material.opacity - rdt * 14); gunLight.intensity = Math.max(0, gunLight.intensity - rdt * 60);
  if (G.fireCd > 0) G.fireCd -= rdt;
  if (G.reloadT > 0) { G.reloadT -= rdt; if (G.reloadT <= 0) { G.rounds = G.maxRounds; renderAmmo(); } }
  if (G.firing && G.fireCd <= 0 && G.rounds > 0 && !G.backpackOpen && !G.duel) fire();

  // ---- tutorial triggers ----
  if (G.tut) {
    if (G.tut.step === "move" && player.moved > 3) tutNext("gun");
    if (G.tut.step === "gun" && Math.hypot(player.pos.x - world.gunSpot.x, player.pos.z - world.gunSpot.z) < 1.8) {
      player.hasGun = true; gun.visible = true; pedestal.visible = false; SFX.pickup();
      loadWord(pick(G.pool)); tutNext("shoot");
    }
  }
  // ---- aliens ----
  const h = !G.backpackOpen ? aimAlien() : null;
  $("#crosshair").classList.toggle("enemy", !!h);
  if (h) { if (G.aimed === h.alien) G.aimT += rdt; else { G.aimed = h.alien; G.aimT = 0; }
    if (G.aimT > .35 && !h.alien.announced && (!G.tut || G.tut.step !== "shoot") && !shirtMode()) announce(h.alien); }
  else G.aimed = null;
  if (isClient()) clientPuppets(dt, rdt); else for (const a of G.aliens) a.update(dt, G);
  for (const a of G.aliens) if (a.dead && a.removeT <= 0) a.dispose();
  G.aliens = G.aliens.filter(a => !(a.dead && a.removeT <= 0));
  if (!isClient()) { for (const o of G.orbs) o.update(dt, G); G.orbs = G.orbs.filter(o => !o.dead); }
  if (G.typing && G.typing.steps) { G.typing.t += rdt; while (G.typing.t > .06) { G.typing.t -= .06; G.typing.i++; } }
  if (G.speaking && !G.speaking.dead) updateHelperHint(G.speaking);
  // an alien too slow to kill counts as "struggled" once
  for (const a of G.aliens) if (!a.dead && a.word && a.heardAt && !a.slowMarked && G.time - a.heardAt > 25) { a.slowMarked = true; mark(a.word, false); }
  // pickups
  if (!isClient()) for (const p of G.pickups) { p.t += dt; p.s.position.y = p.s.userData.base + Math.sin(p.t * 3) * .12; p.s.children[0].rotation.y += dt * 3;
    // gone after 20 s (blinking the last 5), and pulled towards you when you're within 4 m
    if (p.t > 20) { scene.remove(p.s); p.done = true; continue; }
    p.s.visible = p.t < 15 || Math.sin(p.t * 18) > 0;
    const pdx = player.pos.x - p.s.position.x, pdz = player.pos.z - p.s.position.z, pd = Math.hypot(pdx, pdz);
    if (pd < 4 && pd > .1 && Math.abs(p.s.userData.base - .7 - player.feet) < 1.5) { const k = Math.min(1, dt * 6); p.s.position.x += pdx * k; p.s.position.z += pdz * k; }
    if (G.coop && !partner.downed && Math.hypot(p.s.position.x - partner.pos.x, p.s.position.z - partner.pos.z) < 1.2) { partner.hp = Math.min(100, partner.hp + 20); fxOut({ heal: 20 }); scene.remove(p.s); p.done = true; continue; }
    if (Math.hypot(p.s.position.x - player.pos.x, p.s.position.z - player.pos.z) < 1.2 && Math.abs(p.s.userData.base - .7 - player.feet) < 1.5) { player.hp = Math.min(100, player.hp + 20); renderHP(); SFX.heal(); floater(p.s.position, "+20 HP", "#6dff8a", 22); scene.remove(p.s); p.done = true; } }
  G.pickups = G.pickups.filter(p => !p.done);
  districtTick(rdt);
  survivalTick(dt);
  escapeTick(dt, rdt);
  fortressTick(dt, rdt);
  deerTick(dt, rdt);
  coopTick(dt, rdt);
  mmT -= rdt; if (mmT <= 0) { mmT = .1; drawMinimap(); }
  // ---- FX ----
  for (const b of G.bursts) {
    b.life -= b.sprite ? rdt : dt;
    if (b.m) { const pa = b.m.geometry.attributes.position; b.v.forEach((v, i) => { v.y -= 9 * dt; pa.array[i * 3] += v.x * dt; pa.array[i * 3 + 1] += v.y * dt; pa.array[i * 3 + 2] += v.z * dt; }); pa.needsUpdate = true; b.m.material.opacity = Math.max(0, b.life / b.max); }
    if (b.sprite) { b.sprite.position.y += rdt * .5; b.sprite.material.opacity = Math.min(1, b.life / b.max * 2.5); }
    if (b.life <= 0) { scene.remove(b.m || b.sprite); (b.m || b.sprite).geometry && b.m && b.m.geometry.dispose(); }
  }
  G.bursts = G.bursts.filter(b => b.life > 0);
  for (const t of G.tracers) { t.life -= rdt; t.m.material.opacity = Math.max(0, t.life / .09); if (t.life <= 0) { scene.remove(t.m); t.m.geometry.dispose(); } }
  G.tracers = G.tracers.filter(t => t.life > 0);
  for (const f of G.floaters) {
    f.life -= rdt; f.pos.y += rdt * .8; vec.copy(f.pos).project(camera);
    const vis = vec.z < 1 && f.life > 0; f.el.style.display = vis ? "" : "none";
    if (vis) { f.el.style.left = (vec.x * .5 + .5) * innerWidth + "px"; f.el.style.top = (-vec.y * .5 + .5) * innerHeight + "px"; f.el.style.opacity = Math.min(1, f.life / f.max * 2); }
    if (f.life <= 0) f.el.remove();
  }
  G.floaters = G.floaters.filter(f => f.life > 0);
  if (document.pointerLockElement === renderer.domElement && !$("#clickToPlay").hidden) $("#clickToPlay").hidden = true;   // never stuck on screen while you play
  if (helperHide > 0) { helperHide -= rdt; if (helperHide <= 0) $("#helper").hidden = true; }
  renderTop();
}
function frame(){
  const rdt = Math.min(.05, clock.getDelta());
  update(rdt);
  composer.render();
  requestAnimationFrame(frame);
}
drawGunScreen();
requestAnimationFrame(frame);
window.__step = (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) update(1 / 60); composer.render(); };   // for automated testing
window.__api = { get world(){ return world; }, get Q(){ return Q; }, answerQuiz, onKill, openBrief, addHerdDeer, charge, hitGate, beginDuel, startDuelLocal, duelFire, zapMe, get duel(){ return G.duel; }, sanct: () => G.sanct, deerWave, deerUse, deerInteract, deerAct, placeTrap, ammoQuiz, trapQuiz, openDemon, closeDemon, learnDeerWord, spawnDeerBoss, lessonOptions, renderMissions, useWorld, partner, hostSnapshot, hostFort, applyFort, spawnPickup, biteQuiz, hitHound, spawnEvent, useEvent, fort, towerQuiz, buildTower, openShop, buy, bossKill, setupZone, spawnAlienShirt, specialKill, closeNote, unlockWord, populateDistrict, startGame, openBackpack, closeBackpack, loadWord, fire, announce, tutNext, player, camera, spawnAlien, D };
