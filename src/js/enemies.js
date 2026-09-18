// Humanoid aliens: tall, thin, slow. Each one is weak to ONE word (assigned when it first matters).
// They wait around the district (idle / wandering), wake up when they see or hear you, then walk at you
// along the nav graph (around houses, up the stairs). Melee = ground slam. Rare casters throw orbs.
import * as THREE from "../../node_modules/three/build/three.module.js";

const SKINS = [
  { skin: 0x56705f, dark: 0x2c3a31, eye: 0x7dffb0 },
  { skin: 0x6c5b82, dark: 0x362c45, eye: 0xff7de0 },   // casters only
  { skin: 0x4f6f86, dark: 0x263847, eye: 0x7de9ff },
  { skin: 0x7d6a55, dark: 0x3f3327, eye: 0xffc27d },
];
let glowTex = null;
export function glowTexture(){
  if (glowTex) return glowTex;
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.25, "rgba(255,255,255,.7)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); glowTex = new THREE.CanvasTexture(c); return glowTex;
}
// white t-shirt panels with the word printed on them (escape mode). One texture per text, shared.
const shirtCache = new Map();
function shirtTexture(text, gold){
  const key = (gold ? "g:" : "") + text;
  if (shirtCache.has(key)) return shirtCache.get(key);
  const c = document.createElement("canvas"); c.width = 256; c.height = 200; const g = c.getContext("2d");
  g.fillStyle = gold ? "#ffd766" : "#f4f1ea"; g.fillRect(0, 0, 256, 200);
  g.fillStyle = gold ? "#3a2400" : "#15121c"; g.textAlign = "center"; g.textBaseline = "middle";
  const words = text.split(" "), lines = [];
  let fs2 = 76; const fit = () => { g.font = `900 ${fs2}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`; };
  fit();
  // one line if it fits, else wrap by words, shrinking until it fits in 2–3 lines
  for (;;) { lines.length = 0; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > 236 && cur) { lines.push(cur); cur = w; } else cur = t; }
    lines.push(cur);
    if ((lines.length * fs2 * 1.05 <= 190 && lines.every(l => g.measureText(l).width <= 240)) || fs2 <= 22) break;
    fs2 -= 4; fit(); }
  lines.forEach((l, i) => g.fillText(l, 128, 100 + (i - (lines.length - 1) / 2) * fs2 * 1.05));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  shirtCache.set(key, t); return t;
}
const cap = (r, l, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), mat);
const rnd = (a, b) => a + Math.random() * (b - a);
function angleDiff(a, b){ let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
const _eye = new THREE.Vector3(), _pe = new THREE.Vector3();

export class Alien {
  constructor(scene, pos, word, opt = {}){
    this.scene = scene; this.word = word;
    this.hp = this.maxHp = opt.hp || 100;
    this.speed = opt.speed || 1.0;
    this.skills = opt.skills || { orb: false, slam: true };
    this.caster = !!opt.caster; this.special = !!opt.special;
    this.state = opt.dormant ? "idle" : "walk";
    this.roam = !!opt.roam; this.home = pos.clone(); this.wander = null; this.wanderT = rnd(1, 4);
    this.t = Math.random() * 10; this.stateT = 0; this.aggroT = Math.random() * .3; this.repathT = 0; this.path = null;
    this.orbCd = 2.5 + Math.random() * 2.5; this.slamCd = 1.5; this.stagger = 0; this.dead = false; this.removeT = 0;
    this.announced = false; this.lastAnnounce = -99; this.hue = Math.random();
    this.wrongHits = 0; this.heardAt = 0; this.firstShotWrong = null;
    const S = this.special ? { skin: 0xb8963a, dark: 0x5a4210, eye: 0xffe27d } : this.caster ? SKINS[1] : SKINS[[0, 2, 3][Math.floor(Math.random() * 3)]];
    const skin = new THREE.MeshStandardMaterial({ color: S.skin, roughness: .5, metalness: .1, emissive: S.eye, emissiveIntensity: .04 });
    const dark = new THREE.MeshStandardMaterial({ color: S.dark, roughness: .7 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: S.eye });
    this.handMat = new THREE.MeshBasicMaterial({ color: S.eye, transparent: true, opacity: this.caster ? .35 : 0 });
    const root = this.root = new THREE.Group(); root.position.copy(pos); root.rotation.y = rnd(-Math.PI, Math.PI);
    const body = this.body = new THREE.Group(); root.add(body);
    const torso = cap(.3, .85, skin); torso.position.y = 1.62; torso.scale.set(1, 1, .75); body.add(torso);
    const hips = cap(.24, .2, dark); hips.position.y = 1.08; hips.rotation.z = Math.PI / 2; body.add(hips);
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(.29, .025, 6, 16), dark); r.rotation.x = Math.PI / 2; r.position.y = 1.45 + i * .16; r.scale.set(1, .75, 1); body.add(r); }
    const neck = cap(.08, .22, dark); neck.position.y = 2.18; body.add(neck);
    const head = this.head = new THREE.Mesh(new THREE.SphereGeometry(.32, 18, 14), skin);
    head.position.set(0, 2.5, -.05); head.scale.set(.82, 1.35, 1.05); head.rotation.x = -.35; body.add(head);
    for (const [x, y, s] of [[-.11, 2.5, .065], [.11, 2.5, .065], [0, 2.63, .05]]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), this.eyeMat); e.position.set(x, y, .26); e.scale.set(1, .7, .6); body.add(e);
    }
    const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: S.eye, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
    eyeGlow.position.set(0, 2.52, .32); eyeGlow.scale.set(.9, .5, 1); body.add(eyeGlow);
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: S.eye, transparent: true, opacity: .07, depthWrite: false, blending: THREE.AdditiveBlending }));
    aura.position.y = 1.6; aura.scale.set(1.8, 3.2, 1); body.add(aura);
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * .38, 2.02, 0); body.add(sh);
      const up = cap(.07, .55, skin); up.position.y = -.35; sh.add(up);
      const el = new THREE.Group(); el.position.y = -.7; sh.add(el);
      const fo = cap(.06, .6, skin); fo.position.y = -.38; el.add(fo);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 8), dark); hand.position.y = -.78; el.add(hand);
      const hg = new THREE.Mesh(new THREE.SphereGeometry(.2, 12, 10), this.handMat); hg.position.y = -.78; el.add(hg);
      for (let k = -1; k <= 1; k++) { const f = cap(.018, .16, dark); f.position.set(k * .045, -.92, 0); el.add(f); }
      this.arms.push({ sh, el, hand, s });
    }
    this.legs = [];
    for (const s of [-1, 1]) {
      const hp = new THREE.Group(); hp.position.set(s * .16, 1.05, 0); body.add(hp);
      const th = cap(.09, .42, skin); th.position.y = -.28; hp.add(th);
      const kn = new THREE.Group(); kn.position.y = -.55; hp.add(kn);
      const sh = cap(.07, .42, skin); sh.position.y = -.26; kn.add(sh);
      const ft = new THREE.Mesh(new THREE.BoxGeometry(.14, .06, .3), dark); ft.position.set(0, -.5, .07); kn.add(ft);
      this.legs.push({ hp, kn, s });
    }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(.55, .7, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(this.hue, .9, .6), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = .04; root.add(this.ring);
    this.warn = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0, depthWrite: false }));
    this.warn.rotation.x = -Math.PI / 2; scene.add(this.warn);
    torso.userData.alien = this; head.userData.alien = this; head.userData.head = true; hips.userData.alien = this;
    this.hitMeshes = [torso, head, hips];
    if (opt.shirt) {   // a loose shirt around the torso + the word printed front and back
      const shirtMat = new THREE.MeshStandardMaterial({ color: this.special ? 0xffd766 : 0xefeae0, roughness: .9 });
      const body2 = new THREE.Mesh(new THREE.CylinderGeometry(.37, .33, .82, 16), shirtMat); body2.position.y = 1.6; body2.scale.set(1, 1, .8); body.add(body2);
      const tex = shirtTexture(opt.shirt, this.special);
      // print colour is matte (below the bloom threshold) so the word stays sharp
      for (const [z, ry] of [[.31, 0], [-.31, Math.PI]]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(.7, .55), new THREE.MeshBasicMaterial({ map: tex, color: this.special ? 0xd8c070 : 0xbdb9b0 }));
        p.position.set(0, 1.6, z); p.rotation.y = ry; body.add(p); (this.shirtPlanes || (this.shirtPlanes = [])).push(p);
      }
      for (const s of [-1, 1]) { const sl = new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, .26, 10), shirtMat); sl.position.set(s * .38, 1.9, 0); body.add(sl); }
      body2.userData.alien = this; this.hitMeshes.push(body2);
    }
    if (this.special) { root.scale.setScalar(1.35); aura.material.opacity = .28; aura.scale.set(2.4, 3.8, 1); }
    scene.add(root);
    this.rise = !!opt.rise; this.spawnT = this.rise ? 0 : 1; this.baseY = pos.y;
    if (this.rise) root.position.y = this.baseY - 2.7;
  }
  setShirt(text){ const t = shirtTexture(text, this.special); for (const p of this.shirtPlanes || []) { p.material.map = t; p.material.needsUpdate = true; } }   // heist boss: a new clue per lock
  get pos(){ return this.root.position; }
  get active(){ return !this.dead && this.state !== "idle"; }
  aimPoint(){ return new THREE.Vector3(this.pos.x, this.pos.y + 1.8, this.pos.z); }
  eye(){ return _eye.set(this.pos.x, this.pos.y + 2.4, this.pos.z); }

  wake(){ if (this.state === "idle" && !this.dead) { this.state = "walk"; this.repathT = 0; this.wander = null; return true; } return false; }
  damage(n){ if (this.dead) return false; this.hp -= n; if (this.hp <= 0) { this.die(); return true; } return false; }
  die(){ this.dead = true; this.state = "dead"; this.removeT = 1.4; this.warn.material.opacity = 0; this.handMat.opacity = 0; }
  dispose(){ this.scene.remove(this.root); this.scene.remove(this.warn); this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

  walkCycle(moving, speed){
    const w = this.t * speed * 3.2;
    this.legs.forEach((l, i) => { l.hp.rotation.x = moving ? Math.sin(w + i * Math.PI) * .5 : 0; l.kn.rotation.x = moving ? Math.max(0, -Math.sin(w + i * Math.PI)) * .7 : 0; });
    if (this.state === "walk" || this.state === "idle") this.arms.forEach((a, i) => { a.sh.rotation.x = moving ? -Math.sin(w + i * Math.PI) * .35 : Math.sin(this.t * 1.3 + i) * .06; a.sh.rotation.z = a.s * .12; a.el.rotation.x = -.35; });
    this.body.position.y = moving ? Math.abs(Math.sin(w)) * .05 : Math.sin(this.t * 1.5) * .02;
  }
  stepToward(tx, tz, speed, dt, W){
    const p = this.root.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < .05) return 0;
    const s = Math.min(d, speed * dt);
    W.moveEntity(p, dx / d * s, dz / d * s, .45, dt);
    this.root.rotation.y += angleDiff(this.root.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 4);
    return d;
  }

  update(dt, G){
    this.t += dt;
    const p = this.root.position, W = G.world;
    const T = G.targetFor ? G.targetFor(this) : G.player;   // co-op: the nearest player who is still standing
    const player = T.pos, feet = T.feet;
    const dx = player.x - p.x, dz = player.z - p.z, dist = Math.hypot(dx, dz);
    this.root.visible = dist < 80 || this.dead;
    if (this.spawnT < 1) { this.spawnT = Math.min(1, this.spawnT + dt * .7); p.y = this.baseY - 2.7 * (1 - this.spawnT) ** 2; if (this.spawnT < 1) return; }
    if (this.dead) { this.removeT -= dt; this.body.rotation.x = Math.min(1.4, this.body.rotation.x + dt * 3); p.y -= dt * .6; return; }
    this.ring.material.opacity += ((this.announced ? .75 : 0) - this.ring.material.opacity) * Math.min(1, dt * 4);
    this.ring.rotation.z += dt;

    // ---- waiting: stand, sway, maybe wander near home; wake when it sees (≤22 m, line of sight) or hears (≤5 m) you
    if (this.state === "idle") {
      if (this.roam) {
        this.wanderT -= dt;
        if (!this.wander && this.wanderT <= 0) { const a = rnd(0, Math.PI * 2), r = rnd(1, 4.5); const tx = this.home.x + Math.cos(a) * r, tz = this.home.z + Math.sin(a) * r;
          if (W.walkable(p.x, p.z, tx, tz)) this.wander = { x: tx, z: tz }; this.wanderT = rnd(3, 7); }
        if (this.wander) { const d = this.stepToward(this.wander.x, this.wander.z, .45, dt, W); this.walkCycle(true, .5); if (d < .3) this.wander = null; }
        else this.walkCycle(false, 0);
      } else this.walkCycle(false, 0);
      this.aggroT -= dt;
      if (this.aggroT <= 0) { this.aggroT = .3;
        const close = dist < 5 && Math.abs(feet - p.y) < 2.5;
        if (close || (dist < 22 && W.losClear(this.eye(), _pe.set(player.x, player.y, player.z)))) G.wakeAlien(this);
      }
      return;
    }

    this.root.rotation.y += angleDiff(this.root.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 3);
    if (this.stagger > 0) { this.stagger -= dt; this.body.rotation.x = -.25 * (this.stagger / .3); return; }
    this.body.rotation.x *= .9;
    this.orbCd -= dt; this.slamCd -= dt;
    const sameLevel = Math.abs(feet - p.y) < 1.5;

    if (this.state === "walk") {
      const keep = this.caster ? 11 : 2.0;
      let moving = false;
      if (dist > keep || !sameLevel) {
        // route: straight at you if the ground allows it, else along the nav graph (re-planned twice a second)
        this.repathT -= dt;
        if (this.repathT <= 0) { this.repathT = .5 + Math.random() * .2;
          this.path = W.walkable(p.x, p.z, player.x, player.z) ? null : W.findPath(p.x, p.z, player.x, player.z); }
        let tx = player.x, tz = player.z;
        if (this.path && this.path.length) { const n = this.path[0]; tx = n.x; tz = n.z; if (Math.hypot(n.x - p.x, n.z - p.z) < 1.2) this.path.shift(); }
        this.stepToward(tx, tz, this.speed * (G.speedMul ? G.speedMul(this) : 1), dt, W); moving = true;   // ice deer aura slows
        for (const o of G.aliens) if (o !== this && !o.dead) { const ox = p.x - o.pos.x, oz = p.z - o.pos.z, od = Math.hypot(ox, oz);
          if (od < 1.1 && od > 0 && Math.abs(o.pos.y - p.y) < 1) W.moveEntity(p, ox / od * (1.1 - od) * .5, oz / od * (1.1 - od) * .5, .45, 0); }
      }
      this.walkCycle(moving, this.speed);
      if (Math.random() < dt * .08) G.groan(this);
      if (this.skills.slam && dist < 3.3 && sameLevel && this.slamCd <= 0) { this.state = "slam"; this.stateT = 0; this.warn.position.set(p.x, p.y + .05, p.z); G.sfx("charge"); }
      else if (this.skills.orb && dist > 4 && dist < 30 && this.orbCd <= 0 && G.canOrb(this) && W.losClear(this.eye(), _pe.set(player.x, player.y, player.z))) { this.state = "charge"; this.stateT = 0; G.sfx("charge"); }
    } else if (this.state === "charge") {
      this.stateT += dt; this.walkCycle(false, 0);
      const a = this.arms[1], k = Math.min(1, this.stateT / 1.1);
      a.sh.rotation.x = -1.4 * k; a.el.rotation.x = -.2; a.sh.rotation.z = .1;
      this.handMat.opacity = .25 + .6 * k + Math.sin(this.stateT * 30) * .1;
      if (this.stateT >= 1.1) { const hand = new THREE.Vector3(); a.hand.getWorldPosition(hand); G.spawnOrb(hand, this);
        this.handMat.opacity = .35; this.state = "walk"; this.orbCd = rnd(5.5, 8.5); }
    } else if (this.state === "slam") {
      this.stateT += dt; const k = Math.min(1, this.stateT / 1.0);
      this.arms.forEach(a => { a.sh.rotation.x = -2.6 * k; a.el.rotation.x = -.3; });
      this.warn.material.opacity = .15 + .35 * k + Math.sin(this.stateT * 25) * .08; this.warn.scale.setScalar(.4 + .6 * k);
      if (this.stateT >= 1.0) { this.arms.forEach(a => { a.sh.rotation.x = -.2; }); this.warn.material.opacity = 0;
        G.slam(this.warn.position, 3.4, this); this.state = "walk"; this.slamCd = 3.2; }
    }
  }
}

export class Orb {
  constructor(scene, from, target, color = 0xff5ad2){
    this.scene = scene;
    this.vel = target.clone().sub(from).normalize().multiplyScalar(9);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(.22, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.scale.set(1.6, 1.6, 1); this.mesh.add(this.glow);
    this.mesh.position.copy(from); scene.add(this.mesh);
    this.life = 6; this.dead = false;
  }
  update(dt, G){
    this.life -= dt;
    const m = this.mesh.position, step = this.vel.length() * dt, dir = this.vel.clone().normalize();
    const blocked = step > 0 && G.world.rayBlock(m, dir, step) !== Infinity;
    m.addScaledVector(this.vel, dt); this.glow.material.rotation += dt * 4;
    for (const T of (G.targets ? G.targets() : [G.player])) { const pp = T.pos;
      if (!T.dashing && Math.hypot(pp.x - m.x, pp.z - m.z) < .65 && Math.abs(m.y - (pp.y - .6)) < 1.1) { G.hurt(14, m, T); this.pop(G); return; } }
    if (blocked || this.life <= 0) this.pop(G);
  }
  pop(G){ if (this.dead) return; this.dead = true; G.burst(this.mesh.position, 0xff5ad2, 24, 5); this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}
