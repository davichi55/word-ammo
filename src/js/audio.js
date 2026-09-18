// Sound: synthesized effects (WebAudio, no files) + the helper's Korean voice clips (Piper, pre-generated).
let AC = null, master = null, volume = 0.8;
export function initAudio(){
  if (!AC) { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = volume; master.connect(AC.destination); }
  if (AC.state === "suspended") AC.resume();
}
export function setVolume(v){ volume = v; if (master) master.gain.value = v; voiceVol = v; }
let voiceVol = 0.8;

function tone(f, dur, type = "square", vol = .1, slide = 0, delay = 0){
  if (!AC) return; const t = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g).connect(master); o.start(t); o.stop(t + dur + .05);
}
function noise(dur, vol = .3, lp = 1500, delay = 0, hp = 0){
  if (!AC) return; const t = AC.currentTime + delay;
  const b = AC.createBuffer(1, Math.max(1, Math.floor(AC.sampleRate * dur)), AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = b; f.type = "lowpass"; f.frequency.value = lp; g.gain.value = vol;
  let node = s.connect(f);
  if (hp) { const h = AC.createBiquadFilter(); h.type = "highpass"; h.frequency.value = hp; node = node.connect(h); }
  node.connect(g).connect(master); s.start(t);
}
export const SFX = {
  shot(){ noise(.12, .35, 4000, 0, 400); tone(520, .1, "sawtooth", .07, -300); },
  shotGood(){ noise(.12, .35, 5000, 0, 400); tone(880, .14, "square", .06, -500); tone(1320, .1, "triangle", .05, 0, .02); },
  resist(){ tone(200, .12, "square", .06, -60); noise(.06, .15, 900); },
  hit(){ tone(660, .06, "triangle", .08); },
  kill(){ noise(.6, .5, 1200); tone(90, .5, "sine", .3, -50); [784, 988, 1175, 1568].forEach((f, i) => tone(f, .18, "triangle", .07, 0, .05 + i * .06)); },
  reload(){ tone(300, .06, "square", .06); tone(420, .06, "square", .06, 0, .12); noise(.08, .2, 3000, .2); tone(760, .1, "triangle", .07, 0, .3); },
  open(){ tone(420, .1, "triangle", .08, 200); },
  close(){ tone(620, .1, "triangle", .08, -200); },
  select(){ tone(990, .06, "triangle", .07); },
  dash(){ noise(.25, .3, 2500, 0, 600); tone(300, .2, "sine", .08, 400); },
  hurt(){ tone(160, .3, "sawtooth", .15, -80); noise(.2, .35, 800); },
  charge(){ tone(220, .9, "sine", .06, 500); tone(110, .9, "sawtooth", .03, 250); },
  orb(){ tone(500, .4, "sine", .08, -300); noise(.3, .1, 1200); },
  slam(){ noise(.7, .7, 400); tone(60, .6, "sine", .35, -30); },
  groan(){ tone(rnd(70, 110), .9, "sawtooth", .035, rnd(-30, 20)); tone(rnd(140, 190), .7, "sine", .025, -40, .1); },
  pickup(){ [523, 659, 784, 1046].forEach((f, i) => tone(f, .12, "triangle", .08, 0, i * .06)); },
  heal(){ [660, 880].forEach((f, i) => tone(f, .16, "sine", .08, 0, i * .08)); },
  empty(){ tone(1200, .03, "square", .05); },
};
const rnd = (a, b) => a + Math.random() * (b - a);

// ---- voice: a queue so the helper never talks over herself ----
const clipCache = new Map();
function clip(url){ if (!clipCache.has(url)) { const a = new Audio(url); a.preload = "auto"; clipCache.set(url, a); } return clipCache.get(url); }
let queue = [], playing = null;
export function say(urls, { interrupt = false, rate = 1 } = {}){
  if (interrupt) { queue = []; if (playing) { playing.pause(); playing.currentTime = 0; playing = null; } }
  queue.push(...urls.map(u => ({ u, rate })));
  if (!playing) next();
}
function next(){
  const it = queue.shift(); if (!it) { playing = null; return; }
  const a = clip(it.u); a.currentTime = 0; a.volume = Math.min(1, voiceVol * 1.1); a.playbackRate = it.rate;
  playing = a;
  a.onended = a.onerror = () => { if (playing === a) { playing = null; setTimeout(next, 90); } };
  a.play().catch(() => { playing = null; setTimeout(next, 50); });
}
export const wordClip = id => `audio/ko/${id}.wav`;
export const lineClip = key => `audio/lines/${key}.wav`;
export function preload(ids){ ids.forEach(id => clip(wordClip(id))); }
